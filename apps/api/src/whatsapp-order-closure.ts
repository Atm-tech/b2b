import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
type Db=Pick<PoolClient,'query'>;
type Deps={query:(sql:string,args?:unknown[])=>Promise<{rows:any[];rowCount:number|null}>;transaction:<T>(run:(db:Db)=>Promise<T>)=>Promise<T>};
export function createOrderClosureService(deps:Deps){
 async function reconcile(id:string){const result=await deps.transaction(async db=>{
  const linked=(await db.query(`WITH RECURSIVE edges(a,b) AS (
    SELECT s.draft_id,p.draft_id FROM whatsapp_shortage_cases s JOIN whatsapp_shortage_portions p ON p.case_id=s.id
    UNION SELECT d.id,p.balance_draft_id FROM whatsapp_order_drafts d JOIN whatsapp_packing_reviews p ON p.cart_id=d.sales_cart_id WHERE p.balance_draft_id IS NOT NULL
   ),connected(id) AS (SELECT $1::text UNION SELECT CASE WHEN e.a=c.id THEN e.b ELSE e.a END FROM connected c JOIN edges e ON e.a=c.id OR e.b=c.id)
   SELECT d.* FROM whatsapp_order_drafts d JOIN connected c ON c.id=d.id ORDER BY d.id FOR UPDATE OF d`,[id])).rows;
  if(!linked.length)throw Error('Order unavailable.');
  const ids=linked.map(d=>d.id);const carts=linked.flatMap(d=>d.sales_cart_id?[d.sales_cart_id]:[]);const reasons:string[]=[];
  if(linked.some(d=>!d.sales_cart_id&&!['Denied','Superseded'].includes(d.status)))reasons.push('Remaining quantity or retailer confirmation pending');
  if(!carts.length)reasons.push('Sales order not created');
  const cases=(await db.query('SELECT * FROM whatsapp_shortage_cases WHERE draft_id=ANY($1::text[])',[ids])).rows;
  const caseIds=cases.map(s=>s.id);
  if((await db.query('SELECT 1 FROM whatsapp_shortage_lines WHERE case_id=ANY($1::text[]) AND pending_quantity>released_quantity',[caseIds])).rowCount)reasons.push('Remaining demand pending');
  if(cases.some(s=>s.supply_review_required)||(await db.query("SELECT 1 FROM purchase_orders WHERE cart_id=ANY($1::text[]) AND status NOT IN ('Cancelled','Closed') AND quantity_received<quantity_ordered",[cases.flatMap(s=>s.purchase_order_id?[s.purchase_order_id]:[])])).rowCount)reasons.push('Supplier resolution pending');
  const orders=(await db.query('SELECT * FROM sales_orders WHERE COALESCE(cart_id,id)=ANY($1::text[])',[carts])).rows;
  if(carts.some(c=>!orders.some(o=>(o.cart_id||o.id)===c))||orders.some(o=>!['Delivered','Closed'].includes(o.status)&&!(o.status==='Cancelled'&&Number(o.quantity)===0)))reasons.push('Delivery pending');
  for(const cart of carts){
   const lines=orders.filter(o=>(o.cart_id||o.id)===cart);const total=lines.reduce((sum,o)=>sum+Number(o.total_amount)+Number(o.delivery_charge),0);
   const payments=(await db.query("SELECT COALESCE(SUM(amount) FILTER(WHERE verification_status IN ('Verified','Resolved')),0) AS verified,COUNT(*) FILTER(WHERE verification_status NOT IN ('Verified','Resolved','Rejected'))::int AS unverified FROM payments WHERE side='Sales' AND (linked_order_id=$1 OR linked_order_id=ANY($2::text[]))",[cart,lines.map(o=>o.id)])).rows[0];
   if(Number(payments.unverified))reasons.push('Payment verification pending');
   if(Number(payments.verified)<total-.005)reasons.push('Collection pending');
   if(Number(payments.verified)>total+.005)reasons.push('Credit or refund resolution pending');
   const ledger=(await db.query("SELECT * FROM ledger_entries WHERE side='Sales' AND linked_order_id=$1",[cart])).rows;
   if(ledger.length!==1||![total,Number(payments.verified),Number(ledger[0]?.goods_value),Number(ledger[0]?.pending_amount)].every(Number.isFinite)||Math.abs(Number(ledger[0]?.goods_value)-total)>.005||Math.abs(Number(ledger[0]?.pending_amount))>.005)reasons.push('Financial reconciliation pending');
  }
  const packing=(await db.query('SELECT * FROM whatsapp_packing_reviews WHERE cart_id=ANY($1::text[])',[carts])).rows;
  if(packing.some(p=>p.status!=='Finalized'))reasons.push('Packing or packing credit resolution pending');
  const returns=(await db.query('SELECT * FROM delivery_exceptions WHERE order_id=ANY($1::text[])',[carts])).rows;
  if(returns.some(r=>!['Withdrawn','Retry Scheduled','Closed'].includes(r.status)))reasons.push('Return receipt or return financial resolution pending');
  const refs=[...ids,...carts,...caseIds,...packing.map(p=>p.id),...returns.map(r=>r.id)];
  const outbox=await db.query(`SELECT 1 FROM whatsapp_outbox o WHERE o.status NOT IN ('Sent','Delivered','Read','Manual Resolved','Superseded') AND (
   o.related_entity_id=ANY($1::text[]) OR EXISTS(SELECT 1 FROM unnest($1::text[]) ref WHERE LEFT(o.related_entity_id,LENGTH(ref)+1)=ref||':')
   OR EXISTS(SELECT 1 FROM whatsapp_order_events e WHERE e.draft_id=ANY($2::text[]) AND (e.id=o.related_entity_id OR e.outbound_message_id=o.id OR e.outbound_message_id=o.wa_message_id))) LIMIT 1`,[refs,ids]);
  const notifications=await db.query(`SELECT 1 FROM whatsapp_shortage_notifications WHERE case_id=ANY($1::text[]) AND status NOT IN ('Sent','Superseded')
   UNION ALL SELECT 1 FROM whatsapp_confirmation_notifications WHERE draft_id=ANY($2::text[]) AND status NOT IN ('Sent','Superseded')
   UNION ALL SELECT 1 FROM whatsapp_packing_notifications WHERE case_id=ANY($3::text[]) AND status NOT IN ('Sent','Superseded')
   UNION ALL SELECT 1 FROM delivery_exception_notifications WHERE case_id=ANY($4::text[]) AND status NOT IN ('Sent','Superseded')`,[caseIds,ids,packing.map(p=>p.id),returns.map(r=>r.id)]);
  if(outbox.rowCount||notifications.rowCount)reasons.push('WhatsApp message or manual follow-up pending');
  const unique=[...new Set(reasons)];const complete=!unique.length;
  await db.query(`UPDATE whatsapp_order_drafts SET status=CASE WHEN sales_cart_id IS NOT NULL THEN $2 ELSE status END,
    completed_at=CASE WHEN sales_cart_id IS NOT NULL AND $3 THEN COALESCE(completed_at,NOW()) ELSE NULL END,
    closure_checked_at=NOW(),closure_reasons_json=$4::jsonb WHERE id=ANY($1::text[])`,[ids,complete?'Completed':'Order Created',complete,JSON.stringify(unique)]);
  for(const d of linked.filter(d=>d.sales_cart_id&&(d.status==='Completed')!==complete))await db.query("INSERT INTO whatsapp_order_events(id,draft_id,sales_cart_id,event_type,status_label,note,created_by) VALUES($1,$2,$3,'Closure',$4,$5,'System')",[`WAC-${randomUUID()}`,d.id,d.sales_cart_id,complete?'Completed':'Order Created',complete?'Delivery, demand, finances and notifications reconciled.':unique.join('; ')]);
  return {ids,caseIds,hasOrders:carts.length>0,complete,reasons:unique};
 });
 // Keep the linked shortage case aligned after releasing draft locks; confirmation locks cases first.
 if(result.hasOrders&&result.caseIds.length)await deps.query("UPDATE whatsapp_shortage_cases SET status=CASE WHEN $2 THEN 'Closed' WHEN status='Closed' THEN 'Fulfilment Pending' ELSE status END,closed_at=CASE WHEN $2 THEN COALESCE(closed_at,NOW()) ELSE NULL END,updated_at=NOW() WHERE id=ANY($1::text[])",[result.caseIds,result.complete]);
 return result;
 }
 async function sweep(){const rows=(await deps.query("SELECT id FROM whatsapp_order_drafts WHERE sales_cart_id IS NOT NULL ORDER BY closure_checked_at NULLS FIRST,id LIMIT 100")).rows;const seen=new Set<string>();for(const row of rows){if(seen.has(row.id))continue;try{const result=await reconcile(row.id);result.ids.forEach(id=>seen.add(id));}catch(error){console.error('Order closure check failed',{draftId:row.id,error:error instanceof Error?error.message:'Unknown error'});await deps.query("UPDATE whatsapp_order_drafts SET status='Order Created',completed_at=NULL,closure_checked_at=NOW(),closure_reasons_json='[\"Closure check failed; staff review required\"]'::jsonb WHERE id=$1",[row.id]);}}}
 async function assertComplete(id:string){const result=await reconcile(id);if(!result.complete)throw Error(`Order cannot be completed: ${result.reasons.join('; ')}.`);}
 return {reconcile,sweep,assertComplete};
}
