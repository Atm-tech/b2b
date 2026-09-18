import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { PoolClient } from 'pg';
type Db=Pick<PoolClient,'query'>;
type Actor={id:number;username:string;fullName:string;role:string;roles:string[];warehouseIds?:string[]};
type Deps={query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(fn:(db:Db)=>Promise<T>)=>Promise<T>};
export type DeliveryExceptionReport={kind:'Shop closed'|'Returned';reason:string;lines:Array<{id:string;quantity:number;reason:string}>};
const has=(a:Actor,r:string)=>[a.role,...a.roles].includes(r);
const editable=(r:any)=>['Draft','Correction Requested'].includes(r.status);
export async function assertDeliveryExceptionUpdate(db:Db,task:any,payload:any){
  const cases=(await db.query("SELECT * FROM delivery_exceptions WHERE task_id=$1 AND status NOT IN ('Retry Scheduled','Withdrawn')",[task.id])).rows;
  if(!cases.length)return;
  if(payload.status==='Delivered'||payload.status==='Planned'||payload.assignedTo?.toLowerCase()!==String(task.assigned_to).toLowerCase())throw Error('Resolve delivery exceptions before completing or reassigning this trip.');
  if(payload.linkedOrderIds&&cases.some(row=>!payload.linkedOrderIds.includes(row.order_id)))throw Error('An unresolved delivery exception cannot be removed from the trip.');
  const stops=task.route_json||[];
  for(const row of cases){const before=stops.find((s:any)=>s.orderId===row.order_id);const after=payload.routeStops?.find((s:any)=>s.orderId===row.order_id);if(!after||!isDeepStrictEqual(before,after))throw Error('This stop has a delivery exception. Submit the report and follow the seller decision before changing delivery or collection.');}
}
export function createDeliveryExceptionService(deps:Deps){
  async function audit(db:Db,id:string,action:string,actor:Actor,note=''){await db.query('INSERT INTO delivery_exception_events(case_id,action,actor,note) VALUES($1,$2,$3,$4)',[id,action,actor.fullName,note]);}
  async function notify(db:Db,row:any){await db.query('INSERT INTO delivery_exception_notifications(id,case_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[`${row.id}:${row.revision}`,row.id,row.revision]);}
  async function load(db:Db,id:string){const ref=(await db.query('SELECT task_id FROM delivery_exceptions WHERE id=$1',[id])).rows[0];if(!ref)throw Error('Delivery exception not found.');const task=(await db.query('SELECT * FROM delivery_tasks WHERE id=$1 FOR UPDATE',[ref.task_id])).rows[0];const row=(await db.query('SELECT * FROM delivery_exceptions WHERE id=$1 FOR UPDATE',[id])).rows[0];return {row,task};}
  function agent(row:any,a:Actor,admin:boolean){if(!admin&&(!['Delivery','Out Delivery'].some(r=>has(a,r))||row.agent_username.toLowerCase()!==a.username.toLowerCase()))throw Error('Only the assigned delivery agent can edit this report.');}
  function seller(row:any,a:Actor,admin:boolean){if(!admin&&(!has(a,'Sales')||Number(row.salesman_id)!==a.id))throw Error('Only the assigned seller can decide this report.');}
  function version(row:any,v:number){if(row.revision!==v)throw Error('This report changed. Open the latest version before continuing.');}
  async function open(taskId:string,orderId:string,kind:string,a:Actor,admin=false){return deps.transaction(async db=>{
    const task=(await db.query('SELECT * FROM delivery_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];if(!task||task.side!=='Sales'||task.status!=='Handed Over')throw Error('Select an outbound trip that has been handed to the delivery agent.');
    agent({agent_username:task.assigned_to},a,admin);if(!['Shop closed','Returned'].includes(kind))throw Error('Select Shop closed or Returned.');
    const stop=(task.route_json||[]).find((s:any)=>s.orderId===orderId);if(!stop||stop.delivered||stop.picked)throw Error('Select a delivery stop that is not completed.');
    const existing=(await db.query("SELECT * FROM delivery_exceptions WHERE task_id=$1 AND order_id=$2 AND status NOT IN ('Retry Scheduled','Withdrawn')",[taskId,orderId])).rows[0];if(existing)return existing;
    const lines=(await db.query('SELECT s.*,p.name AS product_name FROM sales_orders s JOIN products p ON p.sku=s.product_sku WHERE COALESCE(s.cart_id,s.id)=$1 AND s.quantity>0 ORDER BY s.id FOR SHARE OF s',[orderId])).rows;
    if(!lines.length||lines.some(l=>l.shop_id!==stop.supplierId||l.warehouse_id!==stop.warehouseId||l.status!=='Out for Delivery'))throw Error('The delivery order changed. Refresh the assigned trip.');
    if(lines.some(l=>Number(l.salesman_id)!==Number(lines[0].salesman_id)))throw Error('This stop requires one seller to own its decision.');
    const report={kind,reason:kind==='Shop closed'?'Shop closed':'',lines:kind==='Shop closed'?lines.map(l=>({id:l.id,quantity:Number(l.quantity),reason:'Shop closed'})):[]};
    const row=(await db.query(`INSERT INTO delivery_exceptions(id,task_id,order_id,shop_id,warehouse_id,salesman_id,agent_username,original_json,report_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING *`,[`DEX-${randomUUID()}`,taskId,orderId,lines[0].shop_id,lines[0].warehouse_id,lines[0].salesman_id,task.assigned_to,JSON.stringify(lines),JSON.stringify(report)])).rows[0];await audit(db,row.id,'Report started',a,kind);return row;
  });}
  function validate(row:any,input:DeliveryExceptionReport,draft=false){
    if(!input||!['Shop closed','Returned'].includes(input.kind)||!input.reason?.trim()||!Array.isArray(input.lines)||(!draft&&!input.lines.length))throw Error('Select products and quantities, and enter a reason.');
    if(new Set(input.lines.map(l=>l.id)).size!==input.lines.length)throw Error('Select each product once.');
    for(const line of input.lines){const original=row.original_json.find((l:any)=>l.id===line.id);if(!original||!Number.isFinite(line.quantity)||line.quantity<=0||line.quantity>Number(original.quantity)||!line.reason?.trim())throw Error('Return quantity must be greater than zero and no more than the dispatched quantity; each product requires a reason.');}
    if(input.kind==='Shop closed'&&(input.lines.length!==row.original_json.length||input.lines.some(l=>l.quantity!==Number(row.original_json.find((o:any)=>o.id===l.id).quantity))))throw Error('Shop closed retains all dispatched goods with the delivery agent.');
  }
  async function save(id:string,input:DeliveryExceptionReport,v:number,a:Actor,admin=false){return deps.transaction(async db=>{const {row}=await load(db,id);agent(row,a,admin);version(row,v);if(!editable(row))throw Error('The submitted report is locked. The seller can request a correction.');validate(row,input,true);const next=(await db.query('UPDATE delivery_exceptions SET report_json=$2::jsonb,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *',[id,JSON.stringify(input)])).rows[0];await audit(db,id,'Report edited',a,input.reason);return next;});}
  async function submit(id:string,v:number,a:Actor,admin=false){return deps.transaction(async db=>{const {row,task}=await load(db,id);agent(row,a,admin);if(row.status==='Awaiting Seller'&&row.submitted_revision===v)return row;version(row,v);if(!editable(row))throw Error('This report has already been submitted.');if(task.assigned_to!==row.agent_username)throw Error('The assigned agent changed.');validate(row,row.report_json);const next=(await db.query("UPDATE delivery_exceptions SET status='Awaiting Seller',submitted_revision=revision,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id])).rows[0];await audit(db,id,'Confirmed and sent to seller',a,row.report_json.reason);await notify(db,next);return next;});}
  async function decide(id:string,input:{decision:string;note:string;dueAt?:string;revision:number},a:Actor,admin=false){return deps.transaction(async db=>{const {row}=await load(db,id);seller(row,a,admin);version(row,input.revision);if(row.status!=='Awaiting Seller')throw Error('This report is not awaiting a seller decision.');if(!input.note?.trim())throw Error('Record the seller decision reason.');
    let status='';if(input.decision==='Correction')status='Correction Requested';else if(input.decision==='Return')status='Return Authorized';else if(input.decision==='Retry'){if(!input.dueAt||!Number.isFinite(Date.parse(input.dueAt))||Date.parse(input.dueAt)<=Date.now())throw Error('Set a future delivery retry date and time.');if(row.report_json.kind!=='Shop closed')throw Error('For an item return, request a correction before changing it to a whole-stop retry.');status='Retry Scheduled';}else throw Error('Choose retry delivery, authorize return, or request correction.');
    const next=(await db.query('UPDATE delivery_exceptions SET status=$2,decision=$3,decision_note=$4,retry_at=$5,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *',[id,status,input.decision,input.note,input.dueAt||null])).rows[0];await audit(db,id,'Seller decision',a,`${input.decision}: ${input.note}`);await notify(db,next);return next;
  });}
  async function withdraw(id:string,v:number,a:Actor,admin=false){return deps.transaction(async db=>{const {row}=await load(db,id);agent(row,a,admin);version(row,v);if(!editable(row))throw Error('A submitted report needs a seller decision.');const next=(await db.query("UPDATE delivery_exceptions SET status='Withdrawn',revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id])).rows[0];await audit(db,id,'Draft withdrawn',a);return next;});}
  async function list(a:Actor,admin=false){const allowed=admin||['Sales','Delivery','Out Delivery','Warehouse Manager'].some(r=>has(a,r));if(!allowed)throw Error('Delivery exception access required.');const cases=(await deps.query(`SELECT e.*,c.name AS retailer_name,u.full_name AS seller_name,
    COALESCE((SELECT jsonb_agg(h ORDER BY h.created_at DESC) FROM delivery_exception_events h WHERE h.case_id=e.id),'[]') AS events,
    (SELECT count(*)::int FROM delivery_exception_notifications n WHERE n.case_id=e.id AND n.status='Failed') AS failed_notifications
    FROM delivery_exceptions e JOIN counterparties c ON c.id=e.shop_id LEFT JOIN users u ON u.id=e.salesman_id
    WHERE e.status<>'Withdrawn' AND ($1 OR e.agent_username=$2 OR ($3 AND e.salesman_id=$4) OR ($5 AND e.original_json->0->>'note' LIKE 'WhatsApp confirmed order WAD-%' AND (cardinality($6::text[])=0 OR e.warehouse_id=ANY($6::text[])))) ORDER BY e.created_at DESC`,[admin,a.username,has(a,'Sales'),a.id,has(a,'Warehouse Manager'),a.warehouseIds||[]])).rows;
    return {cases:cases.map(r=>({...r,canEdit:admin||(['Delivery','Out Delivery'].some(role=>has(a,role))&&r.agent_username.toLowerCase()===a.username.toLowerCase()),canDecide:admin||(has(a,'Sales')&&Number(r.salesman_id)===a.id)}))};}
  async function get(id:string,a:Actor,admin=false){const row=(await list(a,admin)).cases.find(r=>r.id===id);if(!row)throw Error('Delivery exception unavailable.');return row;}
  async function retryNotifications(id:string,a:Actor,admin=false){const row=await get(id,a,admin);if(!row.canDecide)throw Error('Only the seller can retry notifications.');await deps.query("UPDATE delivery_exception_notifications SET status='Pending',attempts=0,available_at=NOW() WHERE case_id=$1 AND status='Failed'",[id]);}
  return {open,save,submit,decide,withdraw,list,get,retryNotifications};
}
