import {createWhatsAppOutbox} from '../src/whatsapp-outbox.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import dotenv from 'dotenv';
import {createRetailerFinanceService,reconcileRetailerFinance,settlement} from '../src/retailer-finance.js';
import {createOpenCaseService} from '../src/whatsapp-open-cases.js';
import {createOrderClosureService} from '../src/whatsapp-order-closure.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
test('retailer credit, refund, collection and all-age queue integration',{skip:process.env.SHORTAGE_TEST_LOCAL!=='1'},async t=>{
 const env=dotenv.parse(fs.readFileSync(path.join(root,'.env')));const config={host:'127.0.0.1',port:5432,user:env.POSTGRES_USER||'aapoorti_app',password:env.POSTGRES_PASSWORD||'aapoorti123',database:env.POSTGRES_DB||'aapoorti_b2b'};
 const setup=new pg.Client(config);await setup.connect();const schema=`finance_test_${Date.now()}`;assert.match(schema,/^finance_test_\d+$/);await setup.query(`CREATE SCHEMA ${schema}`);const pool=new pg.Pool({...config,options:`-c search_path=${schema}`});
 const deps={query:(sql:string,args?:unknown[])=>pool.query(sql,args),transaction:async<T>(run:(db:pg.PoolClient)=>Promise<T>)=>{const c=await pool.connect();try{await c.query('BEGIN');const r=await run(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}};
 const finance=createRetailerFinanceService(deps),queue=createOpenCaseService(deps),closure=createOrderClosureService(deps);
 const seller={id:1,username:'sales',fullName:'Seller',role:'Sales',roles:['Sales']};const accounts={id:2,username:'accounts',fullName:'Accounts',role:'Accounts',roles:['Accounts']};let seq=0;
 async function shop(){const id='SHOP-'+(++seq);await pool.query("INSERT INTO counterparties(id,type,name,created_by) VALUES($1,'Shop',$1,'Test')",[id]);await pool.query("INSERT INTO whatsapp_retailers(counterparty_id,phone_e164,salesman_id,default_warehouse_id,created_by) VALUES($1,$2,1,'WH','Test')",[id,'91900000'+String(seq).padStart(4,'0')]);return id;}
 async function order(shop:string,total:number,status='Delivered'){const id='SO-'+(++seq);await pool.query("INSERT INTO sales_orders(id,cart_id,shop_id,product_sku,salesman_id,warehouse_id,quantity,rate,taxable_amount,total_amount,payment_mode,delivery_mode,status,note) VALUES($1,$1,$2,'SOAP',1,'WH',1,$3,$3,$3,'Cash','Delivery',$4,$5)",[id,shop,total,status,`WhatsApp confirmed order WAD-${id}`]);return id;}
 async function pay(order:string,amount:number,status='Verified'){await pool.query("INSERT INTO payments(id,side,linked_order_id,amount,mode,reference_number,verification_status,created_by) VALUES($1,'Sales',$2,$3,'Cash',$1,$4,'Test')",['PAY-'+(++seq),order,amount,status]);}
 async function reconcile(order:string){return deps.transaction(db=>reconcileRetailerFinance(db,order));}
 async function balance(order:string){return settlement(pool,order);}
 try{await pool.query(fs.readFileSync(path.join(root,'postgres/init/001-schema.sql'),'utf8'));await pool.query("INSERT INTO users(id,username,full_name,role,password) VALUES(1,'sales','Seller','Sales','unused'),(2,'accounts','Accounts','Accounts','unused'),(3,'other','Other seller','Sales','unused')");
  await t.test('verified excess stays in the original ledger and is allocated once, oldest delivered bill first',async()=>{
   const s=await shop();const source=await order(s,700);await pay(source,1000);await reconcile(source);assert.equal(Number((await balance(source)).credit),300);assert.equal(Number((await balance(source)).pending),-300);
   const old=await order(s,100);const next=await order(s,500,'Out for Delivery');const pending=await order(s,900,'Booked');await Promise.all([reconcile(source),reconcile(next),reconcile(old)]);
   assert.equal(Number((await balance(old)).applied_credit),100);assert.equal(Number((await balance(next)).applied_credit),200);assert.equal(Number((await balance(next)).pending),300);assert.equal(Number((await balance(pending)).applied_credit),0);assert.equal(Number((await balance(source)).credit),0);
   const total=(await pool.query("SELECT SUM(paid_amount) AS paid FROM ledger_entries WHERE linked_order_id=ANY($1::text[])",[[source,old,next,pending]])).rows[0];assert.equal(Number(total.paid),1000);
   await assert.rejects(()=>deps.transaction(async db=>{await db.query("UPDATE payments SET verification_status='Rejected' WHERE linked_order_id=$1",[source]);await reconcileRetailerFinance(db,source);}),/already allocated/);
   assert.equal(Number((await balance(next)).pending),300);
  });
  await t.test('refund reserves credit, enforces role and revision, records payout separately and closes only after verification',async()=>{
   const s=await shop();const source=await order(s,700);await pay(source,1000);await reconcile(source);
   const input={amount:200,note:'Retailer requested bank refund',requestKey:'refund-request-1'};const [a,b]=await Promise.all([finance.requestRefund(source,input,seller),finance.requestRefund(source,input,seller)]);assert.equal(a.id,b.id);assert.equal(Number((await balance(source)).available_credit),100);
   await assert.rejects(()=>finance.refundAction(a.id,'approve',{version:1,note:'Approve'},accounts),/not allowed/);
   await finance.refundAction(a.id,'approve',{version:1,note:'Approved'},seller);await assert.rejects(()=>finance.refundAction(a.id,'pay',{version:2,note:'Paid',reference:'UTR1',proof:'Bank statement ref'},seller),/not allowed/);
   await finance.refundAction(a.id,'pay',{version:2,note:'Transferred',reference:'UTR1',proof:'Bank statement 001'},accounts);assert.equal(Number((await balance(source)).credit),300);assert.equal((await balance(source)).refund_pending,true);
   await assert.rejects(()=>finance.refundAction(a.id,'cancel',{version:3,note:'Cancel'},seller),/not allowed/);
   await finance.refundAction(a.id,'verify',{version:3,note:'Transfer matched'},accounts);assert.equal(Number((await balance(source)).credit),100);assert.equal(Number((await balance(source)).pending),-100);assert.equal((await balance(source)).refund_pending,false);
   assert.equal(Number((await pool.query("SELECT SUM(amount) AS n FROM payments WHERE linked_order_id=$1",[source])).rows[0].n),1000);
   await assert.rejects(()=>finance.requestRefund(source,{...input,amount:101,requestKey:'too-much'},seller),/exceeds/);
  });
  await t.test('submitted excess cannot be spent and scope is enforced',async()=>{
   const s=await shop();const source=await order(s,100);await pay(source,300,'Submitted');await reconcile(source);assert.equal(Number((await balance(source)).available_credit),0);await assert.rejects(()=>finance.requestRefund(source,{amount:1,note:'Refund',requestKey:'unverified'},seller),/exceeds/);
   await assert.rejects(()=>finance.requestRefund(source,{amount:1,note:'Refund',requestKey:'other'}, {...seller,id:3,username:'other'}),/another staff/);
  });
  await t.test('collection tracks only delivered remainder; verification is mandatory for closure and overdue remains visible beyond seven days',async()=>{
   const s=await shop();const delivered=await order(s,240);const pending=await order(s,360,'Booked');await pay(delivered,100);await reconcile(delivered);
   let row=(await finance.list(seller)).collections.find(f=>f.order_id===delivered)!;assert.equal(Number(row.amount_due),140);assert.ok(!(await finance.list(seller)).collections.some(f=>f.order_id===pending));
   await finance.schedule(delivered,{ownerId:1,collector:'',dueAt:new Date(Date.now()+86400000).toISOString(),note:'Call before collection',version:row.version},seller);
   await pool.query("UPDATE retailer_collection_followups SET due_at=NOW()-INTERVAL '40 days',created_at=NOW()-INTERVAL '60 days' WHERE order_id=$1",[delivered]);const q=await queue.list();assert.ok(q.items.some(c=>c.reference===delivered&&c.kind==='Collection'&&c.overdue));
   await queue.assign('collection:'+delivered,{ownerId:1,dueAt:new Date(Date.now()+86400000).toISOString(),nextAction:'Collect balance tomorrow'},'admin');assert.ok((await queue.list()).items.some(c=>c.reference===delivered));
   await pay(delivered,140,'Submitted');await reconcile(delivered);row=(await finance.list(seller)).collections.find(f=>f.order_id===delivered)!;assert.equal(Number(row.amount_due),0);
   await pool.query("UPDATE payments SET verification_status='Verified' WHERE linked_order_id=$1",[delivered]);await reconcile(delivered);assert.ok(!(await finance.list(seller)).collections.some(f=>f.order_id===delivered));
  });
  await t.test('an unused documented credit permits true order closure; an open refund reopens it',async()=>{
   const s=await shop();const source=await order(s,700);await pay(source,1000);await reconcile(source);const id='WAD-'+source;
   await pool.query("INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source,status,sales_cart_id) VALUES($1,$2,'919999999999',1,'WH','Test','Order Created',$3)",[id,s,source]);assert.equal((await closure.reconcile(id)).complete,true);
   await finance.requestRefund(source,{amount:100,note:'Refund requested',requestKey:'closure-refund'},seller);assert.ok((await closure.reconcile(id)).reasons.includes('Refund verification pending'));
  });
  await t.test('reassignment changes the real collection owner and overdue escalation is durably queued once',async()=>{
   const s=await shop();const orderId=await order(s,120);await reconcile(orderId);
   await queue.assign('collection:'+orderId,{ownerId:3,dueAt:new Date(Date.now()-3600000).toISOString(),nextAction:'Follow up overdue bill'},'admin');
   const other={...seller,id:3,username:'other'};assert.ok((await finance.list(other)).collections.some(f=>f.order_id===orderId));assert.ok(!(await finance.list(other)).credits.some(c=>c.shop_id===s));
   await pool.query("UPDATE users SET mobile_number='919999999999' WHERE id=3");await finance.sweep();await finance.sweep();
   assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM whatsapp_outbox WHERE related_entity_type='CollectionFollowup' AND related_entity_id=$1",[orderId])).rows[0].n,1);
   const message=(await pool.query("SELECT id FROM whatsapp_outbox WHERE related_entity_type='CollectionFollowup' AND related_entity_id=$1",[orderId])).rows[0];
   await pay(orderId,120);await reconcile(orderId);let transported=false;const outbox=createWhatsAppOutbox(deps,async()=>{transported=true;return {messageId:'SHOULD-NOT-SEND'};});await outbox.dispatch(message.id);assert.equal(transported,false);assert.equal((await pool.query('SELECT status FROM whatsapp_outbox WHERE id=$1',[message.id])).rows[0].status,'Superseded');
   assert.ok(!(await queue.list()).items.some(c=>c.kind==='Collection'&&c.reference===orderId));
  });
  await t.test('a single delivered stop gets a follow-up while the rest of its route is still out for delivery',async()=>{
   const s=await shop();const orderId=await order(s,240,'Out for Delivery');const later=await order(s,360,'Out for Delivery');
   await pool.query("ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS route_json JSONB NOT NULL DEFAULT '[]'");
   await pool.query("INSERT INTO delivery_tasks(id,side,linked_order_id,mode,source_location,destination_location,assigned_to,status,route_json) VALUES('PARTIAL-ROUTE','Sales',$1,'Delivery','WH','SHOP','agent','Handed Over',$2::jsonb)",[orderId,JSON.stringify([{orderId,delivered:true},{orderId:later,delivered:false}])]);await reconcile(orderId);
   assert.ok((await finance.list(seller)).collections.some(f=>f.order_id===orderId));assert.ok(!(await finance.list(seller)).collections.some(f=>f.order_id===later));
  });
 }finally{await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
});
