import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { calculateSalesAmounts } from "@aapoorti-b2b/domain";
import { lockPackingCart } from "./packing-guards.js";
type Db=Pick<PoolClient,'query'>;
type Actor={id:number;fullName:string;role:string;roles:string[];warehouseIds?:string[]};
type Deps={query:(sql:string,params?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(fn:(db:Db)=>Promise<T>)=>Promise<T>};
const key=(prefix:string)=>`${prefix}-${randomUUID()}`;
const has=(actor:Actor,role:string)=>[actor.role,...actor.roles].includes(role);
export type PackingReport={lines:Array<{id:string;quantity:number;issue:'None'|'Missing'|'Damaged'}>;weight:number|null;reason:string;machineBroken:boolean};
function amounts(line:any,qty:number) {
  if(qty===0)return {cdAmount:0,todAmount:0,taxableAmount:0,gstAmount:0,totalAmount:0};
  const ratio=qty/Number(line.quantity);
  return calculateSalesAmounts({quantity:qty,rate:Number(line.rate),cdTodRate:Number(line.cd_tod_rate),cdAmount:Number(line.cd_amount)*ratio,todAmount:Number(line.tod_amount)*ratio,gstRate:Number(line.gst_rate) as 0,taxMode:line.tax_mode});
}
export function createPackingService(deps:Deps) {
  async function event(db:Db,id:string,action:string,actor:string,note=''){await db.query('INSERT INTO whatsapp_packing_events(case_id,action,actor,note) VALUES($1,$2,$3,$4)',[id,action,actor,note]);}
  async function notify(db:Db,row:any,kind:string){await db.query('INSERT INTO whatsapp_packing_notifications(id,case_id,revision,kind) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[`${row.id}:${row.revision}:${kind}`,row.id,row.revision,kind]);}
  function warehouse(row:any,actor:Actor,admin:boolean){if(!admin&&(!has(actor,'Warehouse Manager')||(actor.warehouseIds?.length&&!actor.warehouseIds.includes(row.warehouse_id))))throw new Error('Warehouse access is required for this order.');}
  function sales(row:any,actor:Actor,admin:boolean){if(!admin&&(!has(actor,'Sales')||Number(row.salesman_id)!==actor.id))throw new Error('Only the assigned Sales owner can review this amendment.');}
  async function load(db:Db,id:string){const cart=(await db.query('SELECT cart_id FROM whatsapp_packing_reviews WHERE id=$1',[id])).rows[0];if(!cart)throw new Error('Packing review not found.');await lockPackingCart(db,cart.cart_id);return (await db.query('SELECT * FROM whatsapp_packing_reviews WHERE id=$1 FOR UPDATE',[id])).rows[0];}
  async function original(db:Db,cartId:string){return (await db.query('SELECT s.*,p.default_weight_kg,p.tolerance_kg,p.tolerance_percent,p.name AS product_name FROM sales_orders s JOIN products p ON p.sku=s.product_sku WHERE COALESCE(s.cart_id,s.id)=$1 ORDER BY s.id FOR UPDATE OF s',[cartId])).rows;}
  async function unchanged(db:Db,row:any){const lines=await original(db,row.cart_id);if(!lines.length||lines.some(l=>l.status!=='Booked')||(await db.query('SELECT 1 FROM delivery_dockets WHERE sales_order_id=ANY($1::text[])',[lines.map(l=>l.id)])).rowCount)throw new Error('This order is no longer available for packing amendment.');const fields=['id','quantity','rate','cd_tod_rate','cd_amount','tod_amount','gst_rate','tax_mode','delivery_charge','warehouse_id'];if(lines.length!==row.original_json.length||lines.some((line:any,index:number)=>fields.some(field=>String(line[field])!==String(row.original_json[index][field]))))throw new Error('The order changed after recheck started. Refresh the packing review before proceeding.');return lines;}
  async function open(cartId:string,actor:Actor,admin=false,measuredWeight?:number){return deps.transaction(async db=>{
    await lockPackingCart(db,cartId);const existing=(await db.query('SELECT * FROM whatsapp_packing_reviews WHERE cart_id=$1',[cartId])).rows[0];if(existing){warehouse(existing,actor,admin);return existing;}
    const lines=await original(db,cartId);if(!lines.length||lines.some(l=>l.status!=='Booked'||l.delivery_mode!=='Delivery'||!String(l.note).startsWith('WhatsApp confirmed order WAD-')))throw new Error('Select an unpacked WhatsApp sales order.');
    const first=lines[0];if(lines.some(line=>line.warehouse_id!==first.warehouse_id))throw new Error('A packing review must contain only one warehouse.');warehouse(first,actor,admin);if((await db.query('SELECT 1 FROM delivery_dockets WHERE sales_order_id=ANY($1::text[])',[lines.map(l=>l.id)])).rowCount)throw new Error('This order is already packed.');
    const expected=lines.reduce((sum,l)=>sum+Number(l.quantity)*Number(l.default_weight_kg),0);
    const row=(await db.query(`INSERT INTO whatsapp_packing_reviews(id,cart_id,shop_id,salesman_id,warehouse_id,original_json,expected_weight,measured_weight)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8) RETURNING *`,[key('WPK'),cartId,first.shop_id,first.salesman_id,first.warehouse_id,JSON.stringify(lines),expected,Number.isFinite(measuredWeight)?measuredWeight:null])).rows[0];
    await event(db,row.id,'Recheck requested',actor.fullName,'Packing is on hold until the warehouse records its findings.');await notify(db,row,'StaffUpdate');return row;
  });}
  async function report(id:string,input:PackingReport,actor:Actor,admin=false){return deps.transaction(async db=>{
    const row=await load(db,id);warehouse(row,actor,admin);if(row.status!=='Recheck Required')throw new Error('Request a fresh recheck before replacing the warehouse report.');const lines=await unchanged(db,row);
    if(!input.reason?.trim()||!Array.isArray(input.lines)||input.lines.length!==lines.length||new Set(input.lines.map(l=>l.id)).size!==lines.length)throw new Error('Record a reason and the recounted quantity of every item.');
    let expected=0,tolerance=0,changed=false,total=0;
    for(const line of lines){const next=input.lines.find(l=>l.id===line.id);if(!next||!Number.isFinite(next.quantity)||next.quantity<0||next.quantity>Number(line.quantity)||!['None','Missing','Damaged'].includes(next.issue))throw new Error('Recounted quantities must be between zero and the ordered quantity.');const reduced=next.quantity<Number(line.quantity);if(reduced&&next.issue==='None'||!reduced&&next.issue!=='None')throw new Error('Specify Missing or Damaged only for reduced quantities.');changed ||= reduced;expected+=next.quantity*Number(line.default_weight_kg);tolerance+=next.quantity*Number(line.tolerance_kg)+next.quantity*Number(line.default_weight_kg)*Number(line.tolerance_percent)/100;total+=amounts(line,next.quantity).totalAmount;}
    const hasGoods=input.lines.some(l=>l.quantity>0);if(!input.machineBroken&&hasGoods&&(!Number.isFinite(input.weight)||Number(input.weight)<=0))throw new Error('Enter the rechecked weight or report that the weighing machine is unavailable.');
    if(input.weight!==null&&(!Number.isFinite(input.weight)||input.weight<0))throw new Error('Enter a valid weight.');
    const override=hasGoods&&(input.machineBroken||Math.abs(Number(input.weight)-expected)>Math.max(.05,tolerance));
    if(hasGoods)total+=lines.reduce((sum,l)=>sum+Number(l.delivery_charge),0);
    const status=override?'Override Approval Required':changed?'Sales Review Required':'Ready to Finalize';
    const updated=(await db.query(`UPDATE whatsapp_packing_reviews SET report_json=$2::jsonb,reason=$3,expected_weight=$4,measured_weight=$5,override_required=$6,override_approved_by=NULL,override_reason='',status=$7,reported_by=$8,proposed_total=$9,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *`,[id,JSON.stringify({...input,changed}),input.reason,expected,input.weight,override,status,actor.id,total])).rows[0];
    await event(db,id,'Warehouse recheck recorded',actor.fullName,input.reason);await notify(db,updated,'StaffUpdate');return updated;
  });}
  async function act(id:string,input:{action:string;note:string;balance?:string},actor:Actor,admin=false){return deps.transaction(async db=>{
    const row=await load(db,id);if(!input.note.trim())throw new Error('A decision reason is required.');
    if(input.action==='retry'){sales(row,actor,admin);await db.query("UPDATE whatsapp_packing_notifications SET status='Pending',attempts=0,available_at=NOW() WHERE case_id=$1 AND status='Failed'",[id]);return;}
    if(['Finalized','Financial Review'].includes(row.status))throw new Error('This packing review has already been finalized.');await unchanged(db,row);
    if(input.action==='recheck'){sales(row,actor,admin);await db.query("UPDATE whatsapp_packing_reviews SET status='Recheck Required',report_json=NULL,override_approved_by=NULL,retailer_accepted_at=NULL,accepted_revision=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1",[id]);}
    else if(input.action==='override'){
      if(!admin)throw new Error('WhatsApp Admin approval is required for a weight override.');if(row.status!=='Override Approval Required')throw new Error('No weight override is awaiting approval.');
      await db.query('UPDATE whatsapp_packing_reviews SET override_approved_by=$2,override_reason=$3,status=$4,revision=revision+1,updated_at=NOW() WHERE id=$1',[id,actor.fullName,input.note,row.report_json.changed?'Sales Review Required':'Ready to Finalize']);
    } else if(input.action==='propose'){
      sales(row,actor,admin);if(row.status!=='Sales Review Required'||!['Pending','Cancel'].includes(input.balance||''))throw new Error('Choose whether the unavailable balance remains pending or is cancelled.');
      const next=(await db.query("UPDATE whatsapp_packing_reviews SET status='Awaiting Retailer',balance_choice=$2,retailer_accepted_at=NULL,accepted_revision=NULL,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id,input.balance])).rows[0];await notify(db,next,'RetailerAmendment');
    } else throw new Error('Unknown packing decision.');
    await event(db,id,input.action,actor.fullName,input.note);
    const next=(await db.query('SELECT * FROM whatsapp_packing_reviews WHERE id=$1',[id])).rows[0];await notify(db,next,'StaffUpdate');
  });}
  async function retailerDecision(id:string,revision:number,shopId:string,accept:boolean){return deps.transaction(async db=>{
    const row=await load(db,id);if(row.shop_id!==shopId)throw new Error('This amendment belongs to another retailer.');if(accept&&row.retailer_accepted_at&&row.accepted_revision===revision)return;if(row.revision!==revision)throw new Error('This amendment has been replaced. Use the latest confirmation.');if(accept&&['Ready to Finalize','Finalized','Financial Review'].includes(row.status)&&row.retailer_accepted_at)return;
    if(row.status!=='Awaiting Retailer')throw new Error('This amendment is no longer awaiting confirmation.');await unchanged(db,row);
    const updated=(await db.query("UPDATE whatsapp_packing_reviews SET status=$2,retailer_accepted_at=CASE WHEN $3 THEN NOW() ELSE NULL END,accepted_revision=CASE WHEN $3 THEN $4::integer ELSE NULL END,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id,accept?'Ready to Finalize':'Sales Review Required',accept,revision])).rows[0];await event(db,id,accept?'Amendment accepted':'Amendment rejected','Retailer');await notify(db,updated,'StaffUpdate');
  });}
  async function finalize(id:string,actor:Actor,admin=false){return deps.transaction(async db=>{
    const row=await load(db,id);warehouse(row,actor,admin);if(['Finalized','Financial Review'].includes(row.status))return row;if(row.status!=='Ready to Finalize'||!row.report_json||(row.override_required&&!row.override_approved_by)||(row.report_json.changed&&!row.retailer_accepted_at))throw new Error('Complete the recheck and required approvals before finalizing.');const lines=await unchanged(db,row);await db.query("SELECT id FROM ledger_entries WHERE side='Sales' AND linked_order_id=$1 FOR UPDATE",[row.cart_id]);const report=row.report_json as PackingReport;
    // Hold missing/damaged stock so the reduced bill cannot make it available to other orders.
    for(const line of lines){const next=report.lines.find(l=>l.id===line.id)!;let removed=Number(line.quantity)-next.quantity;const lots=(await db.query('SELECT * FROM inventory_lots WHERE warehouse_id=$1 AND product_sku=$2 AND quantity_available>0 ORDER BY lot_id FOR UPDATE',[row.warehouse_id,line.product_sku])).rows;
      for(const lot of lots){const blocked=Math.min(removed,Number(lot.quantity_available));if(blocked<=0)break;await db.query("UPDATE inventory_lots SET quantity_available=quantity_available-$2,quantity_blocked=quantity_blocked+$2 WHERE lot_id=$1",[lot.lot_id,blocked]);removed-=blocked;}
      if(removed>0)await event(db,id,'Inventory discrepancy','System',`${line.product_sku}: ${removed} units were already unavailable in inventory.`);
    }
    for(const line of lines){
      const quantity=lines.filter(item=>item.product_sku===line.product_sku).reduce((sum,item)=>sum+report.lines.find(l=>l.id===item.id)!.quantity,0);
      const available=Number((await db.query(`SELECT (SELECT COALESCE(SUM(quantity_available),0) FROM inventory_lots WHERE warehouse_id=$1 AND product_sku=$2) - (SELECT COALESCE(SUM(quantity),0) FROM sales_orders WHERE warehouse_id=$1 AND product_sku=$2 AND COALESCE(cart_id,id)<>$3 AND status IN ('Booked','Ready for Dispatch','Self Pickup','Pending Pickup') AND note LIKE 'WhatsApp confirmed order WAD-%') AS qty`,[row.warehouse_id,line.product_sku,row.cart_id])).rows[0].qty);
      if(quantity>0&&available<quantity)throw new Error('Available stock changed during review. Sales must request a new warehouse recheck before finalization.');
    }
    const live=report.lines.filter(l=>l.quantity>0);const charge=live.length?lines.reduce((sum,l)=>sum+Number(l.delivery_charge),0):0;
    let total=0;
    for(const line of lines){const next=report.lines.find(l=>l.id===line.id)!;const a=amounts(line,next.quantity);const fee=live[0]?.id===line.id?charge:0;total+=a.totalAmount+fee;
      await db.query(`UPDATE sales_orders SET quantity=$2,cd_amount=$3,tod_amount=$4,taxable_amount=$5,gst_amount=$6,total_amount=$7,delivery_charge=$8,status=$9,note=CONCAT(note,' | Packing review ',$10::text) WHERE id=$1`,[line.id,next.quantity,a.cdAmount,a.todAmount,a.taxableAmount,a.gstAmount,a.totalAmount,fee,next.quantity>0?'Ready for Dispatch':'Cancelled',id]);
      if(next.quantity>0)await db.query(`INSERT INTO delivery_dockets(id,sales_order_id,shop_id,product_sku,warehouse_id,quantity,weight_kg,weighing_proof_name,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Ready')`,[key('DCK'),line.id,row.shop_id,line.product_sku,row.warehouse_id,next.quantity,next.quantity*Number(line.default_weight_kg),`Packing review ${id}; ${row.override_approved_by?`override approved by ${row.override_approved_by}: ${row.override_reason}`:`rechecked weight ${row.measured_weight} kg`}`]);
    }
    total=Number(total.toFixed(2));
    const paid=Number((await db.query("SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE side='Sales' AND linked_order_id=$1 AND verification_status IN ('Submitted','Verified','Resolved')",[row.cart_id])).rows[0].amount);
    await db.query("UPDATE ledger_entries SET goods_value=$2,paid_amount=$3,pending_amount=GREATEST(0,$2::double precision-$3::double precision),status=CASE WHEN $2::double precision<=$3::double precision THEN 'Settled' WHEN $3>0 THEN 'Partial' ELSE 'Pending' END WHERE side='Sales' AND linked_order_id=$1",[row.cart_id,total,paid]);
    let balanceId:string|null=null;
    const missing=lines.filter(line=>report.lines.find(l=>l.id===line.id)!.quantity<Number(line.quantity));
    if(missing.length&&row.balance_choice==='Pending'){
      const profile=(await db.query('SELECT phone_e164 FROM whatsapp_retailers WHERE counterparty_id=$1',[row.shop_id])).rows[0];if(!profile)throw new Error('Retailer WhatsApp profile is unavailable. Resolve it before finalization.');balanceId=key('WAD');const first=lines[0];
      await db.query(`INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source,status,billing_type,payment_mode,cash_timing,delivery_mode,note) VALUES($1,$2,$3,$4,$5,'Packing balance','Needs Review',$6,$7,$8,$9,$10)`,[balanceId,row.shop_id,profile.phone_e164,row.salesman_id,row.warehouse_id,first.billing_type,first.payment_mode,first.cash_timing,first.delivery_mode,`Stock review: pending balance from packing review ${id}; original SO ${row.cart_id}`]);
      await db.query('UPDATE whatsapp_order_drafts SET delivery_charge_waived=$2 WHERE id=$1',[balanceId,live.length>0]);
      for(const line of missing){const qty=Number(line.quantity)-report.lines.find(l=>l.id===line.id)!.quantity;const gross=Number(line.quantity)*Number(line.rate);await db.query(`INSERT INTO whatsapp_order_draft_lines(id,draft_id,product_sku,requested_quantity,approved_quantity,rate,cd_percent,tod_percent,gst_rate,tax_mode,note) VALUES($1,$2,$3,$4,0,$5,$6,$7,$8,$9,$10)`,[key('WADL'),balanceId,line.product_sku,qty,line.rate,gross?Number(line.cd_amount)/gross*100:0,gross?Number(line.tod_amount)/gross*100:0,line.gst_rate,line.tax_mode,`Packing balance from ${row.cart_id}`]);}
    }
    const credit=Math.max(0,Number((paid-total).toFixed(2)));const updated=(await db.query("UPDATE whatsapp_packing_reviews SET status=$2,balance_draft_id=$3,credit_amount=$4,proposed_total=$5,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING *",[id,credit>0?'Financial Review':'Finalized',balanceId,credit,total])).rows[0];
    await event(db,id,'Packing finalized',actor.fullName,`Bill ${total.toFixed(2)}; balance ${row.balance_choice||'None'}${credit?`; credit review ${credit.toFixed(2)}`:''}.`);await notify(db,updated,'Finalized');await notify(db,updated,'StaffUpdate');return updated;
  });}
  async function list(actor:Actor,admin=false){if(!admin&&!['Sales','Warehouse Manager'].some(role=>has(actor,role)))throw new Error('Packing review access is required.');const params:unknown[]=[];let filter='';if(!admin){if(has(actor,'Warehouse Manager')){if(actor.warehouseIds?.length){params.push(actor.warehouseIds);filter='AND r.warehouse_id=ANY($1::text[])';}}else{params.push(actor.id);filter='AND r.salesman_id=$1';}}
    const cases=(await deps.query(`SELECT r.*,c.name AS retailer_name,u.full_name AS salesman_name,
      COALESCE((SELECT jsonb_agg(e ORDER BY e.created_at DESC) FROM whatsapp_packing_events e WHERE e.case_id=r.id),'[]') AS events,
      (SELECT count(*)::int FROM whatsapp_packing_notifications n WHERE n.case_id=r.id AND n.status='Failed') AS failed_notifications
      FROM whatsapp_packing_reviews r JOIN counterparties c ON c.id=r.shop_id LEFT JOIN users u ON u.id=r.salesman_id WHERE (r.status<>'Finalized' OR EXISTS(SELECT 1 FROM whatsapp_packing_notifications n WHERE n.case_id=r.id AND n.status NOT IN ('Sent','Superseded'))) ${filter} ORDER BY r.created_at`,params)).rows;
    return {cases,canWarehouse:admin||has(actor,'Warehouse Manager'),canSales:admin||has(actor,'Sales'),canOverride:admin};
  }
  return {open,report,act,retailerDecision,finalize,list};
}
