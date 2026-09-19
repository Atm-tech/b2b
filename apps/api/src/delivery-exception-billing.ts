import {reconcileRetailerFinance,settlement} from './retailer-finance.js';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {returnFinancialStatus} from './delivery-return-receipts.js';
import {calculateSalesAmounts} from '@aapoorti-b2b/domain';
type Db=Pick<PoolClient,'query'>;
const money=(value:number)=>Math.round((value+Number.EPSILON)*100)/100;
const paidSql="SELECT COALESCE(SUM(amount) FILTER (WHERE verification_status IN ('Submitted','Verified','Resolved')),0) AS paid,COALESCE(SUM(amount) FILTER (WHERE verification_status<>'Rejected'),0) AS reserved FROM payments WHERE side='Sales' AND linked_order_id=$1";
export function deliveryAmendment(row:any){
 const accepted=row.original_json.map((line:any)=>{
  const returned=Number(row.report_json.lines.find((r:any)=>r.id===line.id)?.quantity||0);const quantity=Number(line.quantity)-returned;
  if(!Number.isFinite(quantity)||quantity<0)throw Error('The returned quantity exceeds the dispatched quantity.');
  const ratio=quantity/Number(line.quantity);const amounts=quantity?calculateSalesAmounts({quantity,rate:Number(line.rate),cdTodRate:Number(line.cd_tod_rate),cdAmount:Number(line.cd_amount)*ratio,todAmount:Number(line.tod_amount)*ratio,gstRate:Number(line.gst_rate) as 0,taxMode:line.tax_mode}):{cdAmount:0,todAmount:0,taxableAmount:0,gstAmount:0,totalAmount:0};
  return {id:line.id,productSku:line.product_sku,productName:line.product_name,dispatched:Number(line.quantity),returned,quantity,...amounts,deliveryCharge:0};
 });
 const first=accepted.find((l:any)=>l.quantity>0);if(first)first.deliveryCharge=money(row.original_json.reduce((s:number,l:any)=>s+Number(l.delivery_charge),0));
 return {lines:accepted,total:money(accepted.reduce((s:number,l:any)=>s+l.totalAmount+l.deliveryCharge,0))};
}
export async function applyDeliveryAmendment(db:Db,row:any,task:any){
 if(row.bill_adjusted_at)return;
 const live=(await db.query('SELECT * FROM sales_orders WHERE COALESCE(cart_id,id)=$1 ORDER BY id FOR UPDATE',[row.order_id])).rows.filter((l:any)=>Number(l.quantity)>0);
 const fields=['id','quantity','rate','cd_tod_rate','cd_amount','tod_amount','taxable_amount','gst_rate','gst_amount','total_amount','delivery_charge','tax_mode','warehouse_id'];
 if(live.length!==row.original_json.length||live.some((l:any,i:number)=>l.status!=='Out for Delivery'||fields.some(k=>String(l[k])!==String(row.original_json[i][k]))))throw Error('The dispatched order changed. Review the report again before approving the bill.');
 const bill=deliveryAmendment(row);const paid=Number((await db.query(paidSql,[row.order_id])).rows[0].paid);
 const latestPaid=(await db.query("SELECT mode FROM payments WHERE side='Sales' AND linked_order_id=$1 AND verification_status IN ('Submitted','Verified','Resolved') ORDER BY created_at DESC,id DESC LIMIT 1",[row.order_id])).rows[0];
 for(const line of bill.lines){await db.query(`UPDATE sales_orders SET quantity=$2,cd_amount=$3,tod_amount=$4,taxable_amount=$5,gst_amount=$6,total_amount=$7,delivery_charge=$8,status=$9,note=CONCAT(note,' | Delivery return approved ',$10::text) WHERE id=$1`,[line.id,line.quantity,line.cdAmount,line.todAmount,line.taxableAmount,line.gstAmount,line.totalAmount,line.deliveryCharge,line.quantity>0?'Out for Delivery':'Cancelled',row.id]);}
 await reconcileRetailerFinance(db,row.order_id);
 const effectivePaid=Number((await settlement(db,row.order_id))?.paid||paid);
 const ledger=(await db.query("SELECT id FROM ledger_entries WHERE side='Sales' AND linked_order_id=$1 FOR UPDATE",[row.order_id])).rows[0];
 const state=bill.total<=effectivePaid?'Settled':effectivePaid>0?'Partial':'Pending';
 if(ledger)await db.query('UPDATE ledger_entries SET goods_value=$2,paid_amount=$3,pending_amount=$4,status=$5 WHERE id=$1',[ledger.id,bill.total,effectivePaid,money(bill.total-effectivePaid),state]);
 else await db.query("INSERT INTO ledger_entries(id,side,linked_order_id,party_name,goods_value,paid_amount,pending_amount,status) SELECT $1,'Sales',$2,name,$3,$4,$5,$6 FROM counterparties WHERE id=$7",[`LED-${randomUUID()}`,row.order_id,bill.total,paid,money(bill.total-paid),state,row.shop_id]);
 const positive=bill.lines.filter((l:any)=>l.quantity>0);const stops=task.route_json.map((stop:any)=>stop.orderId!==row.order_id?stop:{...stop,productSummary:positive.map((l:any)=>`${l.productName} x ${l.quantity}`).join(', ')||'All goods returned',amountToPay:bill.total,collectionAmount:effectivePaid,collectionMode:latestPaid?.mode||stop.collectionMode,paymentRequired:bill.total>effectivePaid,paid:effectivePaid>=bill.total,collectionStatus:effectivePaid>=bill.total?'Collected':'Pending',reached:true,checked:true,delivered:positive.length>0,picked:effectivePaid>=bill.total,deliveryExceptionId:row.id});
 await db.query('UPDATE delivery_tasks SET route_json=$2::jsonb,last_action_at=NOW() WHERE id=$1',[task.id,JSON.stringify(stops)]);
 await db.query('UPDATE delivery_exceptions SET bill_adjusted_at=NOW(),adjusted_total=$2,accepted_json=$3::jsonb,credit_amount=$4 WHERE id=$1',[row.id,bill.total,JSON.stringify(bill.lines),Math.max(0,money(effectivePaid-bill.total))]);
 // Outbound inventory and docket quantities remain unchanged until physical return receipt.
}
export async function prepareDeliveryExceptionPayment(db:Db,payload:any,actor:any){
 if(payload.side!=='Sales')return null;
 const canonical=(await db.query('SELECT COALESCE(cart_id,id) AS id FROM sales_orders WHERE id=$1',[payload.linkedOrderId])).rows[0]?.id||payload.linkedOrderId;
 await db.query("SELECT id FROM delivery_tasks WHERE side='Sales' AND route_json @> $1::jsonb ORDER BY id FOR UPDATE",[JSON.stringify([{orderId:canonical}])]);
 const ref=(await db.query("SELECT e.id,e.task_id FROM delivery_exceptions e WHERE (e.order_id=$1 OR e.order_id=(SELECT COALESCE(cart_id,id) FROM sales_orders WHERE id=$1)) AND e.status NOT IN ('Withdrawn','Retry Scheduled') ORDER BY e.created_at DESC LIMIT 1",[payload.linkedOrderId])).rows[0];if(!ref)return null;
 await db.query('SELECT id FROM delivery_tasks WHERE id=$1 FOR UPDATE',[ref.task_id]);
 const row=(await db.query('SELECT * FROM delivery_exceptions WHERE id=$1 FOR UPDATE',[ref.id])).rows[0];
 if(!row.bill_adjusted_at)throw Error('Collection is on hold until the seller approves the return and revised bill.');
 const roles=[actor.role,...(actor.roles||[])];if(roles.some(r=>['Delivery','Out Delivery','Collection Agent'].includes(r))&&!roles.includes('Admin')&&row.agent_username.toLowerCase()!==String(actor.username).toLowerCase()&&!(await db.query("SELECT 1 FROM retailer_collection_followups WHERE order_id=$1 AND collector_username=$2 AND status='Open'",[row.order_id,actor.username])).rowCount)throw Error('Only the assigned delivery agent can collect this adjusted bill.');
 if(payload.exceptionId&&(payload.exceptionId!==row.id||payload.exceptionRevision!==row.revision))throw Error('This collection request is out of date. Refresh the adjusted bill.');
 if(payload.linkedOrderId!==row.order_id)throw Error('Collect against the adjusted order reference, not an individual product line.');
 if(!Number.isFinite(payload.amount)||payload.amount<=0||Math.abs(payload.amount-money(payload.amount))>0.000001||!payload.referenceNumber?.trim())throw Error('A positive collection amount with at most two decimal places and a payment reference are required.');
 const existing=(await db.query("SELECT * FROM payments WHERE side='Sales' AND linked_order_id=$1 AND reference_number=$2",[row.order_id,payload.referenceNumber.trim()])).rows[0];
 if(existing){if(Number(existing.amount)!==payload.amount||existing.mode!==payload.mode)throw Error('This payment reference was already used for a different collection.');return {...row,duplicate:true};}
 await reconcileRetailerFinance(db,row.order_id);const totals=(await db.query(paidSql,[row.order_id])).rows[0];const balance=await settlement(db,row.order_id);const remaining=money(Number(row.adjusted_total)-Number(totals.reserved)-Number(balance?.applied_credit||0));
 if(payload.amount>remaining+0.001)throw Error(`Collect only the adjusted outstanding amount: Rs.${Math.max(0,remaining).toFixed(2)}. Refresh before collecting.`);
 return row;
}
export async function syncDeliveryExceptionPayment(db:Db,row:any){
 if(!row)return;
 await reconcileRetailerFinance(db,row.order_id);const paid=Number((await settlement(db,row.order_id))?.paid||0);const total=Number(row.adjusted_total);
 const task=(await db.query('SELECT * FROM delivery_tasks WHERE id=$1 FOR UPDATE',[row.task_id])).rows[0];
 const latest=(await db.query("SELECT mode,reference_number,proof_name FROM payments WHERE side='Sales' AND linked_order_id=$1 AND verification_status IN ('Submitted','Verified','Resolved') ORDER BY created_at DESC,id DESC LIMIT 1",[row.order_id])).rows[0];
 const stops=task.route_json.map((s:any)=>s.orderId!==row.order_id?s:{...s,amountToPay:total,collectionAmount:paid,paid:paid>=total,collectionStatus:paid>=total?'Collected':'Pending',paymentRequired:total>paid,picked:paid>=total,collectionMode:latest?.mode,collectionReference:latest?.reference_number,collectionProofName:latest?.proof_name||s.collectionProofName});
 await db.query('UPDATE delivery_tasks SET route_json=$2::jsonb,last_action_at=NOW() WHERE id=$1',[row.task_id,JSON.stringify(stops)]);
 await db.query('UPDATE delivery_exceptions SET credit_amount=$2,updated_at=NOW() WHERE id=$1',[row.id,Math.max(0,money(paid-total))]);
 if(row.warehouse_received_at){const status=await returnFinancialStatus(db,row);const next=(await db.query('UPDATE delivery_exceptions SET status=$2,revision=revision+1 WHERE id=$1 AND status<>$2 RETURNING revision',[row.id,status])).rows[0];if(next){await db.query("INSERT INTO delivery_exception_events(case_id,action,actor,note) VALUES($1,$2,'System',$3)",[row.id,status==='Closed'?'Return financially closed':'Financial review reopened','Physical warehouse receipt retained; status reconciled against verified payments.']);await db.query('INSERT INTO delivery_exception_notifications(id,case_id,revision) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[`${row.id}:${next.revision}`,row.id,next.revision]);}}
}
