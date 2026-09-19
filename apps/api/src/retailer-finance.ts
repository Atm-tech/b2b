import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {enqueueWhatsApp} from './whatsapp-outbox.js';
type Db=Pick<PoolClient,'query'>;
export type FinanceDeps={query:(sql:string,args?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(run:(db:Db)=>Promise<T>)=>Promise<T>};
type Actor={id:number;username:string;fullName:string;role:string;roles:string[]};
const cents=(n:unknown)=>Math.round(Number(n)*100);
const money=(n:number)=>n/100;
const uid=()=>randomUUID();
export async function notifyCollection(db:Db,f:any,kind:string){
 const staff=(await db.query('SELECT id,mobile_number FROM users WHERE active AND (id=$1 OR username=$2)',[f.owner_id,f.collector_username||''])).rows;
 for(const u of staff){let phone=String(u.mobile_number||'').replace(/\D/g,'');if(phone.length===10)phone='91'+phone;if(phone.length<11)continue;
  await enqueueWhatsApp(db,phone,{type:'text',text:{body:`Collection follow-up ${kind}: ${f.order_id}\nOutstanding delivered bill: Rs.${Number(f.amount_due).toFixed(2)}\nNext follow-up: ${new Date(f.due_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'})} IST\n${Number(f.amount_due)>0?(f.note||'Collect only the delivered bill balance. Pending goods are billed on their later delivery.'):'Verify the submitted receipt. Do not collect again.'}\nOpen Retailer credit, collections and refunds in BConnect to record the receipt or next action.`}},'CollectionFollowup',f.order_id,`collection-${kind}:${f.order_id}:${f.version}:${u.id}`);
 }
}
export async function financeEvent(db:Db,shop:string,order:string,action:string,actor:string,detail:unknown){await db.query('INSERT INTO retailer_finance_events(shop_id,order_id,action,actor,detail_json) VALUES($1,$2,$3,$4,$5::jsonb)',[shop,order,action,actor,JSON.stringify(detail)]);}

/** No order or task row locks here: callers may already own operational locks. */
export async function reconcileRetailerFinance(db:Db,orderId:string){
 const ref=(await db.query('SELECT shop_id FROM sales_orders WHERE COALESCE(cart_id,id)=$1 OR id=$1 LIMIT 1',[orderId])).rows[0];if(!ref)return;
 await db.query("SELECT pg_advisory_xact_lock(hashtextextended('retailer-finance:'||$1,0))",[ref.shop_id]);
 const orders=(await db.query(`SELECT COALESCE(cart_id,id) AS id,shop_id,MIN(salesman_id) AS salesman_id,MIN(created_at) AS created_at,
 SUM(CASE WHEN status='Cancelled' THEN 0 ELSE total_amount+delivery_charge END) AS total,
 BOOL_AND(status IN ('Delivered','Closed','Cancelled')) AS delivered,
 BOOL_AND(status IN ('Out for Delivery','Delivered','Closed','Cancelled')) AND BOOL_OR(status<>'Cancelled') AS eligible
 FROM sales_orders WHERE shop_id=$1 GROUP BY COALESCE(cart_id,id),shop_id ORDER BY MIN(created_at),COALESCE(cart_id,id)`,[ref.shop_id])).rows;
 const deliveredStops=(await db.query(`SELECT DISTINCT stop->>'orderId' AS id FROM delivery_tasks t,
 jsonb_array_elements(COALESCE(to_jsonb(t)->'route_json','[]'::jsonb)) stop
 WHERE t.side='Sales' AND stop->>'delivered'='true' AND stop->>'orderId'=ANY($1::text[])`,[orders.map(o=>o.id)])).rows;
 for(const o of orders)if(deliveredStops.some(s=>s.id===o.id)){o.delivered=true;o.eligible=true;}
 const payments=(await db.query(`SELECT COALESCE(s.cart_id,s.id,p.linked_order_id) AS id,
 COALESCE(SUM(p.amount) FILTER(WHERE p.verification_status IN ('Verified','Resolved')),0) AS verified,
 COALESCE(SUM(p.amount) FILTER(WHERE p.verification_status IN ('Submitted','Verified','Resolved')),0) AS paid,
 COALESCE(SUM(p.amount) FILTER(WHERE p.verification_status<>'Rejected'),0) AS reserved,
 COUNT(*) FILTER(WHERE p.verification_status NOT IN ('Verified','Resolved','Rejected'))::int AS unverified
 FROM payments p LEFT JOIN sales_orders s ON s.id=p.linked_order_id
 WHERE p.side='Sales' AND (p.linked_order_id=ANY($1::text[]) OR s.shop_id=$2) GROUP BY COALESCE(s.cart_id,s.id,p.linked_order_id)`,[orders.map(o=>o.id),ref.shop_id])).rows;
 for(const o of orders){const p=payments.find(p=>p.id===o.id)||{};Object.assign(o,{total:cents(o.total),verified:cents(p.verified||0),paid:cents(p.paid||0),reserved:cents(p.reserved||0),unverified:Number(p.unverified||0)});}
 const allocations=(await db.query('SELECT * FROM retailer_credit_allocations WHERE shop_id=$1 ORDER BY created_at,id',[ref.shop_id])).rows;
 const refunds=(await db.query("SELECT * FROM retailer_refunds WHERE shop_id=$1 AND status NOT IN ('Rejected','Cancelled')",[ref.shop_id])).rows;
 // Release only unused allocations when a target bill shrinks or an actual receipt replaces credit.
 for(const o of orders){let available=Math.max(0,o.total-o.reserved);for(const a of allocations.filter(a=>a.target_order_id===o.id)){
  const keep=Math.min(cents(a.amount),available);available-=keep;
  if(keep!==cents(a.amount)){await financeEvent(db,ref.shop_id,o.id,'Credit released','System',{allocationId:a.id,amount:money(cents(a.amount)-keep)});await db.query('UPDATE retailer_credit_allocations SET amount=$2 WHERE id=$1',[a.id,money(keep)]);a.amount=money(keep);}
 }}
 for(const o of orders){
  o.capacity=Math.max(0,o.verified-o.total);
  o.outgoing=allocations.filter(a=>a.source_order_id===o.id).reduce((s,a)=>s+cents(a.amount),0);
  o.refundHeld=refunds.filter(r=>r.source_order_id===o.id).reduce((s,r)=>s+cents(r.amount),0);
  o.refunded=refunds.filter(r=>r.source_order_id===o.id&&r.status==='Verified').reduce((s,r)=>s+cents(r.amount),0);
  if(o.outgoing+o.refundHeld>o.capacity)throw Error('This change would reverse credit already allocated or reserved for refund. Resolve the linked credit or refund first.');
  o.available=o.capacity-o.outgoing-o.refundHeld;
  await db.query(`INSERT INTO retailer_credit_balances(source_order_id,shop_id,amount,available_amount) VALUES($1,$2,$3,$4)
   ON CONFLICT(source_order_id) DO UPDATE SET amount=EXCLUDED.amount,available_amount=EXCLUDED.available_amount,updated_at=NOW()`,[o.id,ref.shop_id,money(o.capacity-o.outgoing-o.refunded),money(o.available)]);
 }
 for(const target of [...orders].sort((a,b)=>Number(b.delivered)-Number(a.delivered))){
  if(!target.eligible)continue;
  let need=Math.max(0,target.total-target.reserved-allocations.filter(a=>a.target_order_id===target.id).reduce((s,a)=>s+cents(a.amount),0));
  for(const source of orders){if(!need)break;if(source.id===target.id||source.available<=0)continue;const amount=Math.min(need,source.available);
   const a={id:uid(),shop_id:ref.shop_id,source_order_id:source.id,target_order_id:target.id,amount:money(amount)};
   await db.query('INSERT INTO retailer_credit_allocations(id,shop_id,source_order_id,target_order_id,amount) VALUES($1,$2,$3,$4,$5)',[a.id,a.shop_id,a.source_order_id,a.target_order_id,a.amount]);allocations.push(a);source.available-=amount;source.outgoing+=amount;need-=amount;
   await financeEvent(db,ref.shop_id,target.id,'Credit applied','System',{sourceOrderId:source.id,amount:a.amount,allocationId:a.id});
  }
 }
 const party=(await db.query('SELECT name FROM counterparties WHERE id=$1',[ref.shop_id])).rows[0]?.name||ref.shop_id;
 for(const o of orders){
  const incoming=allocations.filter(a=>a.target_order_id===o.id).reduce((s,a)=>s+cents(a.amount),0);
  const paid=o.paid+incoming-o.outgoing-o.refunded;const pending=o.total-paid;
  await db.query('UPDATE retailer_credit_balances SET amount=$2,available_amount=$3,updated_at=NOW() WHERE source_order_id=$1',[o.id,money(o.capacity-o.outgoing-o.refunded),money(o.available)]);
  const changed=await db.query("UPDATE ledger_entries SET goods_value=$2,paid_amount=$3,pending_amount=$4,status=$5 WHERE side='Sales' AND linked_order_id=$1",[o.id,money(o.total),money(paid),money(pending),pending<=0?'Settled':paid>0?'Partial':'Pending']);
  if(!changed.rowCount)await db.query("INSERT INTO ledger_entries(id,side,linked_order_id,party_name,goods_value,paid_amount,pending_amount,status,created_at) VALUES($1,'Sales',$2,$3,$4,$5,$6,$7,$8)",['LED-'+uid(),o.id,party,money(o.total),money(paid),money(pending),pending<=0?'Settled':paid>0?'Partial':'Pending',o.created_at]);
  const due=Math.max(0,o.total-o.paid-incoming);
  if(o.delivered&&(due>0||o.unverified)){const followup=(await db.query(`INSERT INTO retailer_collection_followups(order_id,shop_id,owner_id,due_at,amount_due,status)
   VALUES($1,$2,$3,NOW()+INTERVAL '1 day',$4,'Open') ON CONFLICT(order_id) DO UPDATE SET amount_due=EXCLUDED.amount_due,
   status=CASE WHEN retailer_collection_followups.status='Closed' THEN 'Open' ELSE retailer_collection_followups.status END,
   version=CASE WHEN retailer_collection_followups.status='Closed' OR retailer_collection_followups.amount_due<>EXCLUDED.amount_due THEN retailer_collection_followups.version+1 ELSE retailer_collection_followups.version END,
   escalated_at=CASE WHEN retailer_collection_followups.status='Closed' OR retailer_collection_followups.amount_due<>EXCLUDED.amount_due THEN NULL ELSE retailer_collection_followups.escalated_at END,
   due_at=CASE WHEN retailer_collection_followups.status='Closed' THEN NOW()+INTERVAL '1 day' ELSE retailer_collection_followups.due_at END,updated_at=NOW() RETURNING *, (xmax=0) AS inserted`,[o.id,ref.shop_id,o.salesman_id,money(due)])).rows[0];if(followup.inserted)await notifyCollection(db,followup,'created');}
  else await db.query("UPDATE retailer_collection_followups SET amount_due=0,status='Closed',updated_at=NOW() WHERE order_id=$1",[o.id]);
 }
 await db.query('DELETE FROM retailer_finance_failures WHERE order_id=ANY($1::text[])',[orders.map(o=>o.id)]);
 return ref.shop_id as string;
}

export async function settlement(db:Db,order:string){
 const row=(await db.query(`SELECT l.goods_value AS total,l.paid_amount AS paid,l.pending_amount AS pending,
 COALESCE(b.amount,0) AS credit,COALESCE(b.available_amount,0) AS available_credit,
 COALESCE((SELECT SUM(amount) FROM retailer_credit_allocations WHERE target_order_id=$1),0) AS applied_credit,
 COALESCE((SELECT SUM(amount) FROM retailer_credit_allocations WHERE source_order_id=$1),0) AS outgoing_credit,
 COALESCE((SELECT SUM(amount) FROM retailer_refunds WHERE source_order_id=$1 AND status='Verified'),0) AS refunded,
 EXISTS(SELECT 1 FROM retailer_refunds WHERE source_order_id=$1 AND status NOT IN ('Verified','Rejected','Cancelled')) AS refund_pending
 FROM ledger_entries l LEFT JOIN retailer_credit_balances b ON b.source_order_id=l.linked_order_id WHERE l.side='Sales' AND l.linked_order_id=$1`,[order])).rows[0];
 return row;
}

export function createRetailerFinanceService(deps:FinanceDeps){
 const has=(a:Actor,r:string)=>[a.role,...a.roles].includes(r);
 async function authorize(db:Db,shop:string,a:Actor,admin:boolean){if(admin||has(a,'Accounts'))return;const own=await db.query('SELECT 1 FROM whatsapp_retailers WHERE counterparty_id=$1 AND salesman_id=$2',[shop,a.id]);if(!has(a,'Sales')||!own.rowCount)throw Error('This retailer belongs to another staff member.');}
 async function list(a:Actor,admin=false){return deps.transaction(async db=>{
  const staff=admin||has(a,'Accounts')||has(a,'Sales');
  const shops=(await db.query('SELECT r.counterparty_id AS id,c.name,r.salesman_id FROM whatsapp_retailers r JOIN counterparties c ON c.id=r.counterparty_id WHERE $1 OR ($4 AND r.salesman_id=$2) OR EXISTS(SELECT 1 FROM retailer_collection_followups f WHERE f.shop_id=r.counterparty_id AND (f.collector_username=$3 OR ($4 AND f.owner_id=$2)) AND f.status<>\'Closed\')',[admin||has(a,'Accounts'),a.id,a.username,has(a,'Sales')])).rows;
  const ids=shops.map(s=>s.id);const financeIds=shops.filter(s=>admin||has(a,'Accounts')||Number(s.salesman_id)===a.id).map(s=>s.id);
  return {shops,credits:staff?(await db.query('SELECT * FROM retailer_credit_balances WHERE shop_id=ANY($1::text[]) AND amount>0 ORDER BY updated_at',[financeIds])).rows:[],refunds:staff?(await db.query('SELECT * FROM retailer_refunds WHERE shop_id=ANY($1::text[]) ORDER BY created_at DESC',[financeIds])).rows:[],collections:(await db.query("SELECT f.*,u.full_name AS owner_name,c.name AS shop_name,f.due_at<NOW() AS overdue FROM retailer_collection_followups f LEFT JOIN users u ON u.id=f.owner_id JOIN counterparties c ON c.id=f.shop_id WHERE f.shop_id=ANY($1::text[]) AND f.status<>'Closed' AND ($2 OR f.collector_username=$3 OR f.owner_id=$4 OR EXISTS(SELECT 1 FROM whatsapp_retailers r WHERE r.counterparty_id=f.shop_id AND r.salesman_id=$4)) ORDER BY f.due_at",[ids,admin||has(a,'Accounts'),a.username,a.id])).rows,staff:staff?(await db.query("SELECT id,username,full_name,role,roles_json AS roles FROM users WHERE active AND (role=ANY($1::text[]) OR roles_json ?| $1::text[])",[['Sales','Collection Agent','Delivery','Out Delivery','Accounts','Admin']])).rows:[]};
 });}
 async function requestRefund(source:string,input:any,a:Actor,admin=false){return deps.transaction(async db=>{
  const shop=await reconcileRetailerFinance(db,source);if(!shop)throw Error('Sales order not found.');await authorize(db,shop,a,admin);
  const amount=cents(input.amount);if(!Number.isFinite(amount)||amount<=0||Math.abs(Number(input.amount)-money(amount))>.000001||!String(input.note||'').trim()||!String(input.requestKey||'').trim())throw Error('Amount, retailer refund request note and request key are required.');
  const existing=(await db.query('SELECT * FROM retailer_refunds WHERE request_key=$1',[input.requestKey])).rows[0];if(existing){if(existing.source_order_id!==source||cents(existing.amount)!==amount)throw Error('This request key has already been used.');return existing;}
  const balance=await settlement(db,source);if(amount>cents(balance.available_credit))throw Error('Refund exceeds available retailer credit.');
  const row=(await db.query("INSERT INTO retailer_refunds(id,request_key,source_order_id,shop_id,amount,note,requested_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *",['REF-'+uid(),input.requestKey,source,shop,money(amount),input.note.trim(),a.username])).rows[0];
  await financeEvent(db,shop,source,'Refund requested',a.username,{id:row.id,amount:row.amount,note:row.note});await reconcileRetailerFinance(db,source);return row;
 });}
 async function refundAction(id:string,action:string,input:any,a:Actor,admin=false){return deps.transaction(async db=>{
  const ref=(await db.query('SELECT * FROM retailer_refunds WHERE id=$1',[id])).rows[0];if(!ref)throw Error('Refund not found.');await reconcileRetailerFinance(db,ref.source_order_id);await authorize(db,ref.shop_id,a,admin);
  const row=(await db.query('SELECT * FROM retailer_refunds WHERE id=$1 FOR UPDATE',[id])).rows[0];if(Number(input.version)!==row.version)throw Error('Refund changed. Refresh before continuing.');
  const seller=admin||has(a,'Sales');const accounts=admin||has(a,'Accounts');const note=String(input.note||'').trim();if(!note)throw Error('Record the decision or verification note.');
  let status='';if(action==='approve'&&row.status==='Requested'&&seller)status='Approved';
  if(action==='reject'&&row.status==='Requested'&&seller)status='Rejected';
  if(action==='cancel'&&['Requested','Approved'].includes(row.status)&&seller)status='Cancelled';
  if(action==='pay'&&row.status==='Approved'&&accounts){if(!String(input.reference||'').trim()||!String(input.proof||'').trim())throw Error('Refund payment reference and evidence are required.');status='Paid';}
  if(action==='verify'&&row.status==='Paid'&&accounts)status='Verified';
  if(!status)throw Error('This refund action is not allowed for the current status or role.');
  await db.query(`UPDATE retailer_refunds SET status=$2,version=version+1,decision_note=$3,
   approved_by=CASE WHEN $2='Approved' THEN $4 ELSE approved_by END,
   paid_by=CASE WHEN $2='Paid' THEN $4 ELSE paid_by END,
   verified_by=CASE WHEN $2='Verified' THEN $4 ELSE verified_by END,
   payment_reference=CASE WHEN $2='Paid' THEN $5 ELSE payment_reference END,
   proof=CASE WHEN $2='Paid' THEN $6 ELSE proof END,updated_at=NOW() WHERE id=$1`,[id,status,note,a.username,input.reference||'',input.proof||'']);
  await financeEvent(db,row.shop_id,row.source_order_id,'Refund '+status.toLowerCase(),a.username,{id,note,reference:input.reference});await reconcileRetailerFinance(db,row.source_order_id);
 });}
 async function schedule(order:string,input:any,a:Actor,admin=false){return deps.transaction(async db=>{
  const shop=await reconcileRetailerFinance(db,order);if(!shop)throw Error('Order not found.');if(!has(a,'Sales')||!(await db.query("SELECT 1 FROM retailer_collection_followups WHERE order_id=$1 AND owner_id=$2",[order,a.id])).rowCount)await authorize(db,shop,a,admin);
  const due=new Date(input.dueAt);if(!Number.isFinite(due.getTime())||due.getTime()<=Date.now()||!String(input.note||'').trim())throw Error('A future collection date and follow-up note are required.');
  const owner=Number(input.ownerId);const collector=String(input.collector||'').trim();
  if(!(await db.query("SELECT 1 FROM users WHERE id=$1 AND active AND (role='Sales' OR roles_json ? 'Sales')",[owner])).rowCount)throw Error('Choose an active Sales owner.');
  if(collector&&!(await db.query("SELECT 1 FROM users WHERE username=$1 AND active AND (role=ANY($2::text[]) OR roles_json ?| $2::text[])",[collector,['Collection Agent','Delivery','Out Delivery']])).rowCount)throw Error('Choose an active collection agent.');
  const r=await db.query("UPDATE retailer_collection_followups SET owner_id=$2,collector_username=$3,due_at=$4,note=$5,version=version+1,escalated_at=NULL,updated_at=NOW() WHERE order_id=$1 AND status='Open' AND version=$6 RETURNING *",[order,owner,collector||null,due,input.note.trim(),Number(input.version)]);if(!r.rowCount)throw Error('Collection changed or is already settled. Refresh the case.');
  await financeEvent(db,shop,order,'Collection scheduled',a.username,{owner,collector,due,note:input.note});
  await notifyCollection(db,r.rows[0],'scheduled');
 });}
 async function sweep(){const rows=(await deps.query("SELECT DISTINCT ON(shop_id) COALESCE(cart_id,id) AS id FROM sales_orders WHERE note LIKE 'WhatsApp confirmed order WAD-%' ORDER BY shop_id,created_at")).rows;for(const row of rows)try{await deps.transaction(db=>reconcileRetailerFinance(db,row.id));}catch(e){const message=e instanceof Error?e.message:'Unknown error';console.error('Retailer finance reconciliation failed',{orderId:row.id,error:message});await deps.query('INSERT INTO retailer_finance_failures(order_id,error) VALUES($1,$2) ON CONFLICT(order_id) DO UPDATE SET error=EXCLUDED.error,updated_at=NOW()',[row.id,message]);}
  await deps.transaction(async db=>{
   const overdue=(await db.query("SELECT * FROM retailer_collection_followups WHERE status='Open' AND due_at<NOW() AND escalated_at IS NULL FOR UPDATE SKIP LOCKED")).rows;
   const adminNames=String(process.env.WHATSAPP_ADMIN_USERNAMES||process.env.WHATSAPP_PILOT_USERNAMES||'wa.sales').split(',').map(s=>s.trim().toLowerCase());
   for(const f of overdue){const staff=(await db.query("SELECT id,mobile_number FROM users WHERE active AND (id=$1 OR role='Admin' OR roles_json ? 'Admin' OR LOWER(username)=ANY($2::text[]))",[f.owner_id,adminNames])).rows;
    for(const u of staff){let phone=String(u.mobile_number||'').replace(/\D/g,'');if(phone.length===10)phone='91'+phone;if(phone.length<11)continue;
     await enqueueWhatsApp(db,phone,{type:'text',text:{body:`${Number(f.amount_due)>0?'Overdue collection':'Overdue payment verification'}: ${f.order_id}\nOutstanding delivered bill: Rs.${Number(f.amount_due).toFixed(2)}\nReview the collection follow-up in BConnect. Record the next action and date.`}},'CollectionFollowup',f.order_id,`collection-overdue:${f.order_id}:${f.version}:${u.id}`);
    }
    await db.query('UPDATE retailer_collection_followups SET escalated_at=NOW() WHERE order_id=$1',[f.order_id]);
   }
  });
  // Operational status updates run separately, in the same task/case lock order used by delivery.
  const returns=(await deps.query("SELECT id,task_id,order_id FROM delivery_exceptions WHERE warehouse_received_at IS NOT NULL AND status IN ('Warehouse Received','Closed')")).rows;
  for(const r of returns)await deps.transaction(async db=>{await db.query('SELECT id FROM delivery_tasks WHERE id=$1 FOR UPDATE',[r.task_id]);const row=(await db.query('SELECT * FROM delivery_exceptions WHERE id=$1 FOR UPDATE',[r.id])).rows[0];await reconcileRetailerFinance(db,r.order_id);const b=await settlement(db,r.order_id);const unverified=(await db.query("SELECT 1 FROM payments WHERE side='Sales' AND linked_order_id=$1 AND verification_status NOT IN ('Verified','Resolved','Rejected')",[r.order_id])).rowCount;
   const status=b&&!unverified&&!b.refund_pending&&Math.abs(Number(b.pending)+Number(b.credit))<.005?'Closed':'Warehouse Received';
   if(row.status!==status){const next=(await db.query('UPDATE delivery_exceptions SET status=$2,revision=revision+1,updated_at=NOW() WHERE id=$1 RETURNING revision',[r.id,status])).rows[0];await db.query("INSERT INTO delivery_exception_events(case_id,action,actor,note) VALUES($1,$2,'System','Verified payments and retailer ledger credit reconciled.')",[r.id,status]);await db.query('INSERT INTO delivery_exception_notifications(id,case_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[`${r.id}:${next.revision}`,r.id,next.revision]);}
  });
  const packing=(await deps.query("SELECT id,cart_id FROM whatsapp_packing_reviews WHERE status='Financial Review'")).rows;
  for(const p of packing)await deps.transaction(async db=>{await db.query('SELECT id FROM whatsapp_packing_reviews WHERE id=$1 FOR UPDATE',[p.id]);await reconcileRetailerFinance(db,p.cart_id);const b=await settlement(db,p.cart_id);const unverified=(await db.query("SELECT 1 FROM payments WHERE side='Sales' AND linked_order_id=$1 AND verification_status NOT IN ('Verified','Resolved','Rejected')",[p.cart_id])).rowCount;if(b&&!unverified&&!b.refund_pending&&Number(b.pending)<=.005&&Math.abs(Number(b.pending)+Number(b.credit))<.005){await db.query("UPDATE whatsapp_packing_reviews SET status='Finalized',revision=revision+1,updated_at=NOW() WHERE id=$1 AND status='Financial Review'",[p.id]);await db.query("INSERT INTO whatsapp_packing_events(case_id,action,actor,note) VALUES($1,'Credit carried forward','System','Verified excess retained in retailer ledger for future bills.')",[p.id]);}});
 }
 return {list,requestRefund,refundAction,schedule,sweep};
}
