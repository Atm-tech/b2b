import {notifyCollection} from './retailer-finance.js';
import type {FinanceDeps} from './retailer-finance.js';
export function createOpenCaseService(deps:FinanceDeps){
 async function list(){const rows=(await deps.query(`WITH cases AS (
 SELECT 'draft:'||d.id AS case_key,'Retailer confirmation / stock' AS kind,d.id AS reference,d.status,d.salesman_id AS owner_id,d.created_at,
 COALESCE(f.due_at,d.created_at+INTERVAL '1 day') AS due_at,'Review stock or contact retailer; confirm, reschedule or explicitly cancel remaining demand.' AS next_action
 FROM whatsapp_order_drafts d LEFT JOIN whatsapp_confirmation_followups f ON f.draft_id=d.id
 WHERE d.sales_cart_id IS NULL AND d.status NOT IN ('Denied','Superseded','Completed')
 UNION ALL SELECT 'shortage:'||s.id,'Stock / purchase',s.id,s.status,s.salesman_id,s.created_at,s.created_at+INTERVAL '1 day','Review purchase approval, expected stock date and remaining demand.' FROM whatsapp_shortage_cases s WHERE s.status<>'Closed'
 UNION ALL SELECT 'packing:'||p.id,'Packing',p.id,p.status,p.salesman_id,p.created_at,p.created_at+INTERVAL '1 day','Complete warehouse recheck, required approval and retailer acceptance.' FROM whatsapp_packing_reviews p WHERE p.status<>'Finalized'
 UNION ALL SELECT 'return:'||e.id,'Delivery / return',e.id,e.status,e.salesman_id,e.created_at,e.created_at+INTERVAL '1 day','Review agent report, seller decision, physical return receipt or financial reconciliation.' FROM delivery_exceptions e WHERE e.status NOT IN ('Closed','Withdrawn','Retry Scheduled')
 UNION ALL SELECT 'message:'||o.id,'Message failure',o.related_entity_id,o.status,r.salesman_id,o.created_at,o.available_at,'Retry message or record confirmed communication through another channel.' FROM whatsapp_outbox o LEFT JOIN whatsapp_retailers r ON r.phone_e164=o.phone_e164 WHERE o.status IN ('Pending','Failed','Sending') AND o.last_error<>''
 UNION ALL SELECT 'collection:'||f.order_id,'Collection',f.order_id,f.status,f.owner_id,f.created_at,f.due_at,CASE WHEN f.amount_due>0 THEN 'Collect outstanding delivered bill or schedule the next collection.' ELSE 'Verify the submitted payment.' END FROM retailer_collection_followups f WHERE f.status<>'Closed'
 UNION ALL SELECT 'refund:'||f.id,'Refund',f.id,f.status,r.salesman_id,f.created_at,f.created_at+INTERVAL '1 day','Seller approves; Accounts records refund evidence and verifies payment.' FROM retailer_refunds f LEFT JOIN whatsapp_retailers r ON r.counterparty_id=f.shop_id WHERE f.status NOT IN ('Verified','Rejected','Cancelled')
 UNION ALL SELECT 'finance:'||f.order_id,'Financial reconciliation',f.order_id,'Needs Review',(SELECT MIN(salesman_id) FROM sales_orders WHERE COALESCE(cart_id,id)=f.order_id),f.created_at,f.created_at,f.error FROM retailer_finance_failures f
 UNION ALL SELECT 'closure:'||d.id,'Final closure',d.id,d.status,d.salesman_id,d.created_at,COALESCE(d.order_created_at,d.created_at)+INTERVAL '1 day',COALESCE(NULLIF(array_to_string(ARRAY(SELECT jsonb_array_elements_text(d.closure_reasons_json)),'; '),''),'Check delivery, demand, collection, return and notification completion.') FROM whatsapp_order_drafts d WHERE d.sales_cart_id IS NOT NULL AND d.status<>'Completed'
 ) SELECT c.*,COALESCE(a.owner_id,c.owner_id) AS assigned_owner_id,u.full_name AS owner_name,COALESCE(a.due_at,c.due_at) AS deadline,
 COALESCE(a.next_action,c.next_action) AS action_required,COALESCE(a.due_at,c.due_at)<NOW() AS overdue
 FROM cases c LEFT JOIN whatsapp_open_case_assignments a ON a.case_key=c.case_key LEFT JOIN users u ON u.id=COALESCE(a.owner_id,c.owner_id)
 ORDER BY COALESCE(a.due_at,c.due_at),c.case_key`)).rows;
 return {items:rows,staff:(await deps.query('SELECT id,full_name FROM users WHERE active ORDER BY full_name')).rows};}
 async function assign(key:string,input:any,actor:string){
  if(!(await list()).items.some(r=>r.case_key===key))throw Error('This case is no longer open.');
  const due=new Date(input.dueAt);if(!Number.isFinite(due.getTime())||!String(input.nextAction||'').trim())throw Error('A deadline and next action are required.');
  if(!(await deps.query('SELECT 1 FROM users WHERE id=$1 AND active',[Number(input.ownerId)])).rowCount)throw Error('Choose an active owner.');
  if(key.startsWith('collection:')){
   if(!(await deps.query("SELECT 1 FROM users WHERE id=$1 AND active AND (role='Sales' OR roles_json ? 'Sales')",[Number(input.ownerId)])).rowCount)throw Error('Collection follow-up requires an active Sales owner.');
   await deps.transaction(async db=>{const row=(await db.query("UPDATE retailer_collection_followups SET owner_id=$2,due_at=$3,note=$4,version=version+1,escalated_at=NULL,updated_at=NOW() WHERE order_id=$1 AND status='Open' RETURNING *",[key.slice(11),Number(input.ownerId),due,input.nextAction.trim()])).rows[0];if(!row)throw Error('Collection is already settled.');await db.query('DELETE FROM whatsapp_open_case_assignments WHERE case_key=$1',[key]);await db.query("INSERT INTO retailer_finance_events(shop_id,order_id,action,actor,detail_json) VALUES($1,$2,'Admin follow-up assignment',$3,$4::jsonb)",[row.shop_id,key.slice(11),actor,JSON.stringify(input)]);await notifyCollection(db,row,'scheduled');});return;
  }
  await deps.query(`INSERT INTO whatsapp_open_case_assignments(case_key,owner_id,due_at,next_action,updated_by) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(case_key) DO UPDATE SET owner_id=EXCLUDED.owner_id,due_at=EXCLUDED.due_at,next_action=EXCLUDED.next_action,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[key,Number(input.ownerId),due,input.nextAction.trim(),actor]);
 }
 return {list,assign};
}
