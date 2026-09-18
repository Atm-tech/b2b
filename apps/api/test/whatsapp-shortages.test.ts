import { createConfirmationService } from "../src/whatsapp-confirmations.js";
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";
import ts from "typescript";
import { createShortageService, splitDemand, validatePurchaseApproval } from "../src/whatsapp-shortages.js";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
test("shortage arithmetic preserves demand and rejects invalid numbers",()=>{
  assert.deepEqual(splitDemand(60,24),{requested:60,available:24,pending:36});
  assert.deepEqual(splitDemand(60,100),{requested:60,available:60,pending:0});
  assert.deepEqual(splitDemand(60,-5),{requested:60,available:0,pending:60});
  assert.throws(()=>splitDemand(NaN,10));assert.throws(()=>splitDemand(0,10));
});
test("purchase approval requires real supplier, future date and valid rates",()=>{
  const valid={supplierId:"SUP",expectedAt:new Date(Date.now()+86400000).toISOString(),lines:[{productSku:"SOAP",rate:20,gstRate:18}]};
  assert.doesNotThrow(()=>validatePurchaseApproval(valid));
  assert.throws(()=>validatePurchaseApproval({...valid,supplierId:""}));
  assert.throws(()=>validatePurchaseApproval({...valid,expectedAt:"2000-01-01"}));
  assert.throws(()=>validatePurchaseApproval({...valid,lines:[{productSku:"SOAP",rate:NaN,gstRate:18}]}));
});

test("purchase cancellation endpoint accepts an empty item list and preserves the reason",async()=>{
  const source=fs.readFileSync(path.join(root,"apps/api/src/server.ts"),"utf8");
  const start=source.indexOf('app.post("/whatsapp/shortages/:id/:action"');
  const snippet=source.slice(start,source.indexOf('app.post("/whatsapp/drafts/:id/review"',start));
  let route:any;let decision:any;
  const deps={app:{post:(_path:string,handler:any)=>{route=handler;}},wrap:(_res:any,run:any)=>run(),requireWhatsAppPilot:async()=>({id:2,role:'Purchaser',roles:['Purchaser']}),isWhatsAppAdminUser:()=>false,optionalString:(v:any)=>v,requiredString:(v:any)=>{if(!v)throw Error('Required');return v;},requiredNumber:Number,parseCartLines:(v:any)=>{if(!v?.length)throw Error('Empty cart');return v;},shortageService:{purchase:async(_id:any,input:any)=>{decision=input;},list:async()=>({cases:[]})},processWhatsAppShortages:async()=>{}};
  new Function(...Object.keys(deps),ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText)(...Object.values(deps));
  await route({params:{id:'CASE',action:'purchase'},body:{decision:'Cancel',note:'Supplier unavailable',lines:[]}},{});
  assert.equal(decision.decision,'Cancel');assert.equal(decision.note,'Supplier unavailable');assert.deepEqual(decision.lines,[]);
});

test("supplier alerts reach other staff despite one missing phone and retries do not resend successful alerts",async()=>{
  const source=fs.readFileSync(path.join(root,'apps/api/src/whatsapp-integration.ts'),'utf8');
  const snippet=source.slice(source.indexOf('async function sendShortageNotification('),source.indexOf('let confirmationSweepRunning='));
  const sent=new Set<string>();const calls:string[]=[];
  const deps={text:(v:any)=>String(v||''),numberValue:(v:any)=>Number(v||0),whatsappAdminUsernames:()=>new Set(['wa.sales']),
    executeDatabaseQuery:async(sql:string,params:any[])=>{
      if(sql.includes('SELECT s.*'))return {rows:[{id:'CASE',salesman_id:1,purchaser_id:2,draft_id:'WAD',retailer_name:'Retailer',purchase_order_id:'PO'}]};
      if(sql.includes('SELECT l.*'))return {rows:[]};
      if(sql.includes('FROM users'))return {rowCount:3,rows:[{id:3,mobile_number:''},{id:1,mobile_number:'911111111111'},{id:2,mobile_number:'912222222222'}]};
      if(sql.includes('FROM whatsapp_messages'))return {rowCount:sent.has(params[0])?1:0,rows:[]};throw Error(sql);
    },sendText:async(phone:string,body:string,_type:string,id:string)=>{calls.push(phone);sent.add(id);assert.match(body,/Supplier follow-up required/);}};
  const send=new Function(...Object.keys(deps),ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';return sendShortageNotification;')(...Object.values(deps));
  const notification={id:'ALERT',case_id:'CASE',kind:'SupplyAlert',payload_json:{status:'Supplier overdue',items:[]}};
  await assert.rejects(()=>send(notification),/no WhatsApp number/);assert.equal(calls.length,2);
  await assert.rejects(()=>send(notification),/no WhatsApp number/);assert.equal(calls.length,2);
});

test("confirmation reminders ignore cancelled or superseded confirmations and overdue alerts retry per recipient",async()=>{
  const source=fs.readFileSync(path.join(root,'apps/api/src/whatsapp-integration.ts'),'utf8');
  const snippet=source.slice(source.indexOf('async function sendConfirmationFollowupNotification('));
  const row:any={id:'DRAFT',status:'Awaiting Retailer',version:2,due_at:'2020-01-01',phone_e164:'919999999999',salesman_id:1,retailer_name:'Retailer',salesman_name:'Sales'};
  const sent=new Set<string>();const messages:string[]=[];let buttons=0;
  const deps={text:(v:any)=>String(v||''),numberValue:(v:any)=>Number(v||0),whatsappAdminUsernames:()=>new Set(['wa.sales']),compactProforma:()=>'',loadDraft:async()=>({draft:row,lines:[{approved_quantity:24}]}),
    executeDatabaseQuery:async(sql:string,params:any[])=>{
      if(sql.includes('SELECT d.*'))return {rows:[row]};
      if(sql.includes('FROM users'))return {rows:[{id:3,mobile_number:''},{id:1,mobile_number:'911111111111'}]};
      if(sql.includes('FROM whatsapp_messages'))return {rowCount:sent.has(params[0])?1:0};
      if(sql.includes('UPDATE whatsapp_order_drafts'))return {rowCount:1};throw Error(sql);
    },sendText:async(_phone:string,body:string,_kind:string,id:string)=>{messages.push(body);sent.add(id);},sendButtons:async()=>{buttons++;return {messageId:'MSG'};}};
  const send=new Function(...Object.keys(deps),ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+';return sendConfirmationFollowupNotification;')(...Object.values(deps));
  assert.equal(await send({draft_id:'DRAFT',kind:'Resend',version:1}),false);assert.equal(buttons,0);
  assert.equal(await send({draft_id:'DRAFT',kind:'Resend',version:2}),true);assert.equal(buttons,1);
  const overdue={id:'DUE',draft_id:'DRAFT',kind:'Overdue',version:2};
  await assert.rejects(()=>send(overdue),/no WhatsApp number/);assert.equal(messages.length,1);
  await assert.rejects(()=>send(overdue),/no WhatsApp number/);assert.equal(messages.length,1);
  row.status='Denied';assert.equal(await send({draft_id:'DRAFT',kind:'Resend',version:2}),false);assert.equal(buttons,1);
  assert.equal(await send({id:'CANCEL',draft_id:'DRAFT',kind:'Cancelled',version:3,payload_json:{reason:'Retailer declined'}}),true);assert.match(messages[1],/Retailer declined/);
});

test("shortage lifecycle against isolated local PostgreSQL",{skip:process.env.SHORTAGE_TEST_LOCAL!=="1"},async t=>{
  const env=dotenv.parse(fs.readFileSync(path.join(root,".env")));
  // Intentionally ignore DATABASE_URL: this test must never connect to production.
  const config={host:"127.0.0.1",port:5432,user:env.POSTGRES_USER||"aapoorti_app",password:env.POSTGRES_PASSWORD||"aapoorti123",database:env.POSTGRES_DB||"aapoorti_b2b",connectionTimeoutMillis:4000};
  const setup=new pg.Client(config);await setup.connect();
  const schema=`shortage_test_${Date.now()}`;
  assert.match(schema,/^shortage_test_\d+$/);
  await setup.query(`CREATE SCHEMA ${schema}`);
  const pool=new pg.Pool({...config,options:`-c search_path=${schema}`});
  const service=createShortageService({query:(sql,params)=>pool.query(sql,params),transaction:async run=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}});
  const confirmations=createConfirmationService({query:(sql,params)=>pool.query(sql,params),transaction:async run=>{const c=await pool.connect();try{await c.query('BEGIN');const result=await run(c);await c.query('COMMIT');return result;}catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}}});
  const sales={id:1,username:"sales",fullName:"Sales",role:"Sales",roles:["Sales"]};
  const purchaser={id:2,username:"purchase",fullName:"Purchaser",role:"Purchaser",roles:["Purchaser"]};
  const approve={decision:"Approve" as const,supplierId:"SUP",expectedAt:new Date(Date.now()+86400000).toISOString(),note:"Approved",lines:[{productSku:"SOAP",rate:20,gstRate:18}]};
  try{
    await pool.query(fs.readFileSync(path.join(root,"postgres/init/001-schema.sql"),"utf8"));
    await pool.query(`INSERT INTO users(id,username,full_name,role,password) VALUES(1,'sales','Sales','Sales','unused'),(2,'purchase','Purchaser','Purchaser','unused');
      INSERT INTO counterparties(id,type,name,created_by) VALUES('SHOP','Shop','Test retailer','test'),('SUP','Supplier','Test supplier','test');
      INSERT INTO products(sku,name,category,unit,default_weight_kg,tolerance_kg,tolerance_percent,allowed_warehouse_ids_json,slabs_json,created_by) VALUES('SOAP','Test Soap','Test','Piece',0.1,0.01,10,'["C21"]','[]','test');
      INSERT INTO inventory_lots(lot_id,source_order_id,source_type,warehouse_id,product_sku,quantity_available,quantity_reserved,quantity_blocked,status) VALUES('LOT','test','Test','C21','SOAP',24,0,0,'Available');
      INSERT INTO settings(key,value_json) VALUES('delivery_charge','{"amount":10}');`);
    let n=0;
    async function draft(available=24){await pool.query("UPDATE sales_orders SET status='Delivered'");const id=`WAD-${++n}`;await pool.query("UPDATE inventory_lots SET quantity_available=$1",[available]);await pool.query("INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source) VALUES($1,'SHOP','919999999999',1,'C21','Retailer cart')",[id]);await pool.query("INSERT INTO whatsapp_order_draft_lines(id,draft_id,product_sku,requested_quantity,approved_quantity,rate,cd_percent) VALUES($1,$2,'SOAP',60,60,30,5)",[id+'-L',id]);return id;}
    await t.test("60/24 creates one draft PO and preserves 36 pending across retries",async()=>{
      const id=await draft();const caseId=await service.detect(id);assert.ok(caseId);assert.equal(await service.detect(id),caseId);
      const lines=(await pool.query('SELECT * FROM whatsapp_shortage_lines WHERE case_id=$1',[caseId])).rows;
      assert.equal(lines[0].pending_quantity,36);assert.equal(lines[0].available_quantity,24);
      const view=await service.list(sales);assert.equal(view.cases[0].purchase_status,'Draft');
      await assert.rejects(()=>service.list({...sales,role:'Warehouse Manager',roles:['Warehouse Manager']}));
      await assert.rejects(()=>service.choose(caseId!,'Split',{counterpartyId:'WRONG'}));
      await assert.rejects(()=>service.purchase(caseId!,approve,sales));
      await service.choose(caseId!,'Split',{counterpartyId:'SHOP'});
      await service.purchase(caseId!,approve,purchaser);
      await assert.rejects(()=>service.purchase(caseId!,approve,purchaser));
      assert.equal((await pool.query('SELECT SUM(quantity_ordered) AS qty FROM purchase_orders')).rows[0].qty,36);
      await service.release(caseId!);assert.equal((await pool.query('SELECT balance_draft_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].balance_draft_id,null);
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);
      const confirmations=await Promise.all([service.confirm(id),service.confirm(id)]);assert.equal(confirmations[0],confirmations[1]);
      assert.equal((await pool.query('SELECT count(*)::int AS count FROM sales_orders')).rows[0].count,1);
      assert.equal((await pool.query('SELECT total_amount FROM sales_orders')).rows[0].total_amount,684);
      await pool.query("UPDATE purchase_orders SET status='Received',quantity_received=quantity_ordered; UPDATE inventory_lots SET quantity_available=60;");
      await service.release(caseId!);await service.release(caseId!);
      const balance=(await pool.query('SELECT balance_draft_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].balance_draft_id;
      assert.ok(balance);assert.equal((await pool.query('SELECT approved_quantity FROM whatsapp_order_draft_lines WHERE draft_id=$1',[balance])).rows[0].approved_quantity,36);
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[balance]);await service.confirm(balance);
      assert.equal((await pool.query('SELECT sum(quantity) AS qty,sum(delivery_charge) AS freight FROM sales_orders')).rows[0].qty,60);
      assert.equal((await pool.query('SELECT sum(delivery_charge) AS freight FROM sales_orders')).rows[0].freight,10);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).closed_at,null);
    });
    await t.test("wait for all invalidates available confirmation and requires accepted stock receipt",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;
      await service.choose(caseId,'Wait',{counterpartyId:'SHOP'});
      await assert.rejects(()=>service.confirm(id));
      await service.purchase(caseId,approve,purchaser);
      await pool.query('UPDATE inventory_lots SET quantity_available=60');await service.release(caseId);
      assert.equal((await pool.query('SELECT balance_draft_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].balance_draft_id,null);
      const po=(await pool.query('SELECT purchase_order_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].purchase_order_id;
      await pool.query("UPDATE purchase_orders SET status='Received',quantity_received=quantity_ordered WHERE cart_id=$1",[po]);await service.release(caseId);
      const balance=(await pool.query('SELECT balance_draft_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].balance_draft_id;
      assert.equal((await pool.query('SELECT approved_quantity FROM whatsapp_order_draft_lines WHERE draft_id=$1',[balance])).rows[0].approved_quantity,60);
      assert.equal((await pool.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0].status,'Superseded');
    });
    await t.test("purchase cancellation preserves demand and Sales can resubmit or cancel balance",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;
      await service.purchase(caseId,{...approve,decision:'Cancel',note:'Supplier unavailable'},purchaser);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).status,'Sales Action Required');
      assert.equal((await pool.query('SELECT pending_quantity FROM whatsapp_shortage_lines WHERE case_id=$1',[caseId])).rows[0].pending_quantity,36);
      await assert.rejects(()=>service.reopenPurchase(caseId,{...sales,id:999},false,'Retry supplier'));
      await service.reopenPurchase(caseId,sales,false,'Retailer agreed to wait');
      await service.choose(caseId,'Cancel Balance',sales,false,'Retailer requested cancellation of the remaining quantity');
      const line=(await pool.query('SELECT * FROM whatsapp_shortage_lines WHERE case_id=$1',[caseId])).rows[0];assert.equal(line.pending_quantity,0);assert.equal(line.cancelled_quantity,36);assert.equal(line.available_quantity,24);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).purchase_status,'Cancelled');
    });
    await t.test("all unavailable and cancelled closes demand without creating an empty SO",async()=>{
      const id=await draft(0);const caseId=(await service.detect(id))!;await service.choose(caseId,'Cancel Balance',{counterpartyId:'SHOP'});
      assert.equal((await pool.query('SELECT status FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].status,'Cancelled');
      await assert.rejects(()=>service.confirm(id));
    });
    await t.test("already replenished historical shortages do not create unnecessary POs",async()=>{
      const id=await draft(100);await pool.query("UPDATE whatsapp_order_draft_lines SET approved_quantity=24 WHERE draft_id=$1",[id]);
      const caseId=(await service.detect(id))!;
      const row=(await pool.query("SELECT * FROM whatsapp_shortage_cases WHERE id=$1",[caseId])).rows[0];assert.equal(row.purchase_status,'Not Required');
      assert.equal((await pool.query("SELECT procurement_quantity FROM whatsapp_shortage_lines WHERE case_id=$1",[caseId])).rows[0].procurement_quantity,0);
      assert.equal((await pool.query("SELECT count(*)::int AS count FROM whatsapp_shortage_notifications WHERE case_id=$1 AND kind='PurchaserAlert'",[caseId])).rows[0].count,0);
    });
    await t.test("approved SO quantities cannot be promised to a second shortage order",async()=>{
      const first=await draft(24);await service.detect(first);await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[first]);await service.confirm(first);
      const second='WAD-STOCK-RACE';await pool.query("INSERT INTO whatsapp_order_drafts(id,counterparty_id,phone_e164,salesman_id,warehouse_id,source) VALUES($1,'SHOP','919999999999',1,'C21','Retailer cart')",[second]);
      await pool.query("INSERT INTO whatsapp_order_draft_lines(id,draft_id,product_sku,requested_quantity,approved_quantity,rate) VALUES('RACE-L',$1,'SOAP',60,60,30)",[second]);
      const secondCase=(await service.detect(second))!;assert.equal((await pool.query("SELECT available_quantity FROM whatsapp_shortage_lines WHERE case_id=$1",[secondCase])).rows[0].available_quantity,0);
    });
    await t.test("full replenishment supersedes an empty original portion",async()=>{
      const id=await draft(0);const caseId=(await service.detect(id))!;await service.choose(caseId,'Split',{counterpartyId:'SHOP'});await service.purchase(caseId,approve,purchaser);
      const po=(await pool.query("SELECT purchase_order_id FROM whatsapp_shortage_cases WHERE id=$1",[caseId])).rows[0].purchase_order_id;
      await pool.query("UPDATE purchase_orders SET status='Received',quantity_received=quantity_ordered WHERE cart_id=$1",[po]);await pool.query("UPDATE inventory_lots SET quantity_available=60");await service.release(caseId);
      assert.equal((await pool.query("SELECT status FROM whatsapp_order_drafts WHERE id=$1",[id])).rows[0].status,'Superseded');
    });
    await t.test("Sales can retain cancelled procurement demand and release it when stock arrives",async()=>{
      const id=await draft(24);const caseId=(await service.detect(id))!;await service.choose(caseId,'Split',{counterpartyId:'SHOP'});
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);await service.confirm(id);
      await service.purchase(caseId,{...approve,decision:'Cancel',note:'Current supplier unavailable'},purchaser);
      await service.choose(caseId,'Split',sales,false,'Retailer agreed to keep the remaining quantity pending');
      await pool.query("UPDATE inventory_lots SET quantity_available=60");await service.release(caseId);
      assert.ok((await pool.query("SELECT balance_draft_id FROM whatsapp_shortage_cases WHERE id=$1",[caseId])).rows[0].balance_draft_id);
    });
    async function approvedSplit(){
      const id=await draft();const caseId=(await service.detect(id))!;
      await service.choose(caseId,'Split',sales,false,'Retailer agreed to separate deliveries');
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);await service.confirm(id);
      await service.purchase(caseId,approve,purchaser);
      const po=(await pool.query('SELECT purchase_order_id FROM whatsapp_shortage_cases WHERE id=$1',[caseId])).rows[0].purchase_order_id;
      return {id,caseId,po};
    }
    await t.test("partial receipts require Sales approval, exclude blocked stock and release repeated portions exactly once",async()=>{
      const {id,caseId,po}=await approvedSplit();
      const lineId=(await pool.query('SELECT id FROM purchase_orders WHERE cart_id=$1',[po])).rows[0].id;
      await pool.query("UPDATE purchase_orders SET quantity_received=18,status='Partially Received' WHERE cart_id=$1",[po]);
      await pool.query("INSERT INTO inventory_lots(lot_id,source_order_id,source_type,warehouse_id,product_sku,quantity_available,quantity_reserved,quantity_blocked,status) VALUES('BLOCKED', $1,'Purchase','C21','SOAP',0,0,18,'Blocked')",[lineId]);
      await service.monitorSupply(caseId);await service.monitorSupply(caseId);
      let view=(await service.list(sales)).cases.find(c=>c.id===caseId);
      assert.equal(view.supply_review_required,true);assert.equal(view.receipts[0].outstanding,18);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_shortage_notifications WHERE case_id=$1 AND kind='SupplyAlert'",[caseId])).rows[0].n,1);
      await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer accepts partial delivery'},sales);
      await pool.query("UPDATE inventory_lots SET quantity_available=100 WHERE lot_id='LOT'");
      await service.release(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).portions.length,0);
      await pool.query("UPDATE inventory_lots SET quantity_blocked=0,quantity_available=18,status='Available' WHERE lot_id='BLOCKED'");
      await service.monitorSupply(caseId);await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer agreed after warehouse acceptance'},sales);
      await Promise.all([service.release(caseId),service.release(caseId)]);
      view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.portions.length,1);assert.equal(view.lines[0].pending,18);assert.equal(view.lines[0].released,18);
      const first=view.portions[0].draftId;
      await service.release(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).portions.length,1);
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[first]);const firstCart=await service.confirm(first);
      await pool.query("UPDATE purchase_orders SET quantity_received=36,status='Received' WHERE cart_id=$1",[po]);
      await service.monitorSupply(caseId);await service.release(caseId);
      view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.portions.length,2);assert.equal(view.lines[0].pending,0);assert.equal(view.lines[0].released,36);
      const second=view.portions.find((p:any)=>p.draftId!==first).draftId;
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[second]);await service.confirm(second);
      assert.equal(await service.confirm(first),firstCart);
      const totals=(await pool.query("SELECT sum(quantity) AS qty,sum(delivery_charge) AS freight FROM sales_orders WHERE cart_id IN (SELECT sales_cart_id FROM whatsapp_order_drafts WHERE id=$1 OR id IN (SELECT draft_id FROM whatsapp_shortage_portions WHERE case_id=$2))",[id,caseId])).rows[0];
      assert.equal(totals.qty,60);assert.equal(totals.freight,10);
      await pool.query("DELETE FROM inventory_lots WHERE lot_id='BLOCKED'");
    });
    await t.test("supplier overdue alerts are idempotent and recur only after the revised deadline",async()=>{
      const {caseId}=await approvedSplit();
      await pool.query("UPDATE whatsapp_shortage_cases SET expected_at=NOW()-INTERVAL '1 hour' WHERE id=$1",[caseId]);
      await service.monitorSupply(caseId);await service.monitorSupply(caseId);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).supply_status,'Supplier overdue');
      await assert.rejects(()=>service.supplyDecision(caseId,{decision:'Wait',note:'Wait',expectedAt:'2000-01-01'},sales));
      await assert.rejects(()=>service.supplyDecision(caseId,{decision:'Dispatch',note:'Wait'},purchaser));
      await assert.rejects(()=>service.supplyDecision(caseId,{decision:'Dispatch',note:'Wait'},{...sales,id:999}));
      await service.supplyDecision(caseId,{decision:'Wait',note:'Retailer agreed to the revised date',expectedAt:approve.expectedAt},sales);
      await service.monitorSupply(caseId);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).supply_review_required,false);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_shortage_notifications WHERE case_id=$1 AND kind='SupplyAlert'",[caseId])).rows[0].n,1);
      await pool.query("UPDATE whatsapp_shortage_cases SET expected_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[caseId]);await service.monitorSupply(caseId);
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_shortage_notifications WHERE case_id=$1 AND kind='SupplyAlert'",[caseId])).rows[0].n,2);
    });
    await t.test("cancelling the unallocated balance preserves an existing partial confirmation and the supplier PO",async()=>{
      const {caseId,po}=await approvedSplit();
      await pool.query("UPDATE purchase_orders SET quantity_received=12,status='Partially Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=36');
      await service.monitorSupply(caseId);await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer accepts 12 now'},sales);await service.release(caseId);
      await service.supplyDecision(caseId,{decision:'Cancel',note:'Retailer cancels only the unallocated 24'},sales);
      const view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.lines[0].pending,0);assert.equal(view.lines[0].released,12);assert.equal(view.lines[0].cancelled,24);assert.equal(view.portions.length,1);assert.equal(view.closed_at,null);
      assert.equal((await pool.query('SELECT quantity_ordered FROM purchase_orders WHERE cart_id=$1',[po])).rows[0].quantity_ordered,36);
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[view.portions[0].draftId]);await service.confirm(view.portions[0].draftId);
      await service.release(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).portions.length,1);
    });
    await t.test("waiting on a partial receipt preserves the remaining demand and does not release prematurely",async()=>{
      const {caseId,po}=await approvedSplit();
      await pool.query("UPDATE purchase_orders SET quantity_received=12,status='Partially Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=60');
      await service.monitorSupply(caseId);await service.supplyDecision(caseId,{decision:'Wait',note:'Retailer waits for remaining 36',expectedAt:approve.expectedAt},sales);await service.monitorSupply(caseId);await service.release(caseId);
      const view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.lines[0].pending,36);assert.equal(view.portions.length,0);assert.equal(view.supply_review_required,false);
    });
    await t.test("schema reinitialization preserves partially released quantities",async()=>{
      const {caseId,po}=await approvedSplit();await pool.query("UPDATE purchase_orders SET quantity_received=12,status='Partially Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=36');
      await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer accepts first 12'},sales);await service.monitorSupply(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).supply_review_required,false);await service.release(caseId);
      await pool.query(fs.readFileSync(path.join(root,'postgres/init/001-schema.sql'),'utf8'));
      const view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.lines[0].released,12);assert.equal(view.lines[0].pending,24);
    });
    await t.test("cancellation after a partial receipt can retain or repurchase only the unallocated remainder",async()=>{
      const {caseId,po}=await approvedSplit();await pool.query("UPDATE purchase_orders SET quantity_received=12,status='Partially Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=36');
      await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer accepts first 12'},sales);await service.monitorSupply(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).supply_review_required,false);await service.release(caseId);
      const portion=(await service.list(sales)).cases.find(c=>c.id===caseId).portions[0].draftId;
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[portion]);await service.confirm(portion);
      await pool.query("UPDATE purchase_orders SET status='Cancelled' WHERE cart_id=$1",[po]);await pool.query("UPDATE whatsapp_shortage_cases SET purchase_status='Cancelled' WHERE id=$1",[caseId]);
      await service.supplyDecision(caseId,{decision:'Wait',note:'Retailer keeps the 24 pending',expectedAt:approve.expectedAt},sales);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).sales_resolution,'Keep Pending');
      await pool.query("UPDATE purchase_orders SET status='Partially Received' WHERE cart_id=$1",[po]);
      await assert.rejects(()=>service.reopenPurchase(caseId,sales,false,'Replacement'),/resolve outstanding lines/);
      await pool.query("UPDATE purchase_orders SET status='Cancelled' WHERE cart_id=$1",[po]);
      await service.reopenPurchase(caseId,sales,false,'Alternate supplier for remaining 24');await service.purchase(caseId,approve,purchaser);
      const nextPo=(await service.list(sales)).cases.find(c=>c.id===caseId).purchase_order_id;
      assert.equal((await pool.query('SELECT quantity_ordered FROM purchase_orders WHERE cart_id=$1',[nextPo])).rows[0].quantity_ordered,24);
    });
    await t.test("a fully cancelled retailer order remains open while its approved supplier PO is unresolved",async()=>{
      const id=await draft(0);const caseId=(await service.detect(id))!;await service.purchase(caseId,approve,purchaser);
      await service.supplyDecision(caseId,{decision:'Cancel',note:'Retailer no longer wants the order'},sales);
      const view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.ok(view);assert.equal(view.status,'Supplier PO resolution required');assert.equal(view.closed_at,null);
      assert.equal((await pool.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0].status,'Denied');
    });
    async function unconfirmed(){const id=await draft(100);await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);await confirmations.begin(id);return id;}
    await t.test("confirmation register retains old orders, requires dates and enforces Sales ownership",async()=>{
      const id=await unconfirmed();await pool.query("UPDATE whatsapp_order_drafts SET created_at=NOW()-INTERVAL '90 days' WHERE id=$1",[id]);
      assert.ok((await confirmations.list(sales)).items.some(item=>item.draft_id===id&&!item.due_at));
      assert.ok(!(await confirmations.list({...sales,id:999})).items.some(item=>item.draft_id===id));
      await assert.rejects(()=>confirmations.list(purchaser));
      await assert.rejects(()=>confirmations.act(id,{action:'schedule',date:approve.expectedAt,note:'Follow-up'},{...sales,id:999}));
      await assert.rejects(()=>confirmations.act(id,{action:'schedule',date:'2000-01-01',note:'Follow-up'},sales));
      await assert.rejects(()=>confirmations.act(id,{action:'cancel',note:''},sales));
      await confirmations.act(id,{action:'schedule',date:approve.expectedAt,note:'Call retailer after stock review'},sales);
      assert.ok((await confirmations.list(sales)).items.find(item=>item.draft_id===id).due_at);
    });
    await t.test("confirmation overdue alerts are durable, deduplicated, superseded on reschedule and never auto-cancel",async()=>{
      const id=await unconfirmed();await confirmations.act(id,{action:'schedule',date:approve.expectedAt,note:'Call tomorrow'},sales);
      await pool.query("UPDATE whatsapp_confirmation_followups SET due_at=NOW()-INTERVAL '1 minute' WHERE draft_id=$1",[id]);
      await confirmations.reconcile();await confirmations.reconcile();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_confirmation_notifications WHERE draft_id=$1 AND kind='Overdue'",[id])).rows[0].n,1);
      assert.equal((await pool.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0].status,'Awaiting Retailer');
      await confirmations.act(id,{action:'schedule',date:approve.expectedAt,note:'Retailer requested a later call'},sales);
      assert.equal((await pool.query("SELECT status FROM whatsapp_confirmation_notifications WHERE draft_id=$1 AND kind='Overdue'",[id])).rows[0].status,'Superseded');
      await pool.query("UPDATE whatsapp_confirmation_followups SET due_at=NOW()-INTERVAL '1 minute' WHERE draft_id=$1",[id]);await confirmations.reconcile();
      assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_confirmation_notifications WHERE draft_id=$1 AND kind='Overdue'",[id])).rows[0].n,2);
    });
    await t.test("resend requires a next date and stale retries are invalidated when the order is cancelled",async()=>{
      const id=await unconfirmed();await assert.rejects(()=>confirmations.act(id,{action:'resend',note:'Reminder'},sales));
      await confirmations.act(id,{action:'resend',date:approve.expectedAt,note:'Retailer requested another copy'},sales);
      await pool.query("UPDATE whatsapp_confirmation_notifications SET status='Failed' WHERE draft_id=$1",[id]);
      await confirmations.act(id,{action:'retry',note:''},sales);
      assert.equal((await pool.query('SELECT attempts FROM whatsapp_confirmation_notifications WHERE draft_id=$1',[id])).rows[0].attempts,0);
      await confirmations.act(id,{action:'cancel',note:'Retailer no longer requires the order'},sales);await confirmations.reconcile();
      assert.equal((await pool.query("SELECT status FROM whatsapp_confirmation_notifications WHERE draft_id=$1 AND kind='Resend'",[id])).rows[0].status,'Superseded');
      await assert.rejects(()=>service.confirm(id));
      assert.ok((await confirmations.list(sales)).items.some(item=>item.draft_id===id));
      await pool.query("UPDATE whatsapp_confirmation_notifications SET status='Sent' WHERE draft_id=$1 AND kind='Cancelled'",[id]);
      assert.ok(!(await confirmations.list(sales)).items.some(item=>item.draft_id===id));
    });
    await t.test("a confirmed sales order cannot be cancelled from confirmation follow-up even after a legacy status reset",async()=>{
      const id=await unconfirmed();await service.confirm(id);
      await assert.rejects(()=>confirmations.act(id,{action:'cancel',note:'Cancel'},sales));
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer',sales_cart_id=NULL WHERE id=$1",[id]);
      await assert.rejects(()=>confirmations.act(id,{action:'cancel',note:'Cancel'},sales),/sales order already exists/);
    });
    await t.test("cancelling an available shortage portion preserves and later fulfils its linked 36 pending units",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);
      await confirmations.act(id,{action:'cancel',note:'Retailer cancels this 24-unit portion only'},sales);
      let view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.lines[0].available,0);assert.equal(view.lines[0].pending,36);assert.equal(view.lines[0].cancelled,24);
      await service.purchase(caseId,approve,purchaser);view=(await service.list(sales)).cases.find(c=>c.id===caseId);
      await pool.query("UPDATE purchase_orders SET quantity_received=36,status='Received' WHERE cart_id=$1",[view.purchase_order_id]);await pool.query('UPDATE inventory_lots SET quantity_available=36');await service.release(caseId);
      view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.portions.length,1);assert.equal(view.lines[0].released,36);
    });
    await t.test("cancelling an unconfirmed partial replenishment preserves the original SO and the remaining demand",async()=>{
      const {caseId,po}=await approvedSplit();await pool.query("UPDATE purchase_orders SET quantity_received=12,status='Partially Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=36');
      await service.supplyDecision(caseId,{decision:'Dispatch',note:'Retailer accepts first 12'},sales);await service.release(caseId);
      let view=(await service.list(sales)).cases.find(c=>c.id===caseId);const portion=view.portions[0].draftId;
      await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[portion]);
      await confirmations.act(portion,{action:'cancel',note:'Retailer cancels these 12; remaining 24 stays pending'},sales);
      view=(await service.list(sales)).cases.find(c=>c.id===caseId);assert.equal(view.lines[0].available,24);assert.equal(view.lines[0].pending,24);assert.equal(view.lines[0].released,0);assert.equal(view.lines[0].cancelled,12);assert.ok(view.available_sales_cart_id);
      await service.release(caseId);assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).portions.length,1);
      await pool.query("UPDATE purchase_orders SET quantity_received=36,status='Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=60');await service.monitorSupply(caseId);await service.release(caseId);
      assert.equal((await service.list(sales)).cases.find(c=>c.id===caseId).portions.length,2);
    });
    await t.test("cancelling a full-quantity wait confirmation accounts for original and replenished units",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;await service.choose(caseId,'Wait',sales,false,'Retailer waits for all 60');await service.purchase(caseId,approve,purchaser);
      const po=(await service.list(sales)).cases.find(c=>c.id===caseId).purchase_order_id;await pool.query("UPDATE purchase_orders SET quantity_received=36,status='Received' WHERE cart_id=$1",[po]);await pool.query('UPDATE inventory_lots SET quantity_available=60');await service.release(caseId);
      const portion=(await service.list(sales)).cases.find(c=>c.id===caseId).portions[0].draftId;await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[portion]);
      await confirmations.act(portion,{action:'cancel',note:'Retailer cancels all 60 before confirmation'},sales);
      const line=(await service.list(sales)).cases.find(c=>c.id===caseId).lines[0];assert.equal(line.available,0);assert.equal(line.pending,0);assert.equal(line.released,0);assert.equal(line.cancelled,60);
    });
    await t.test("retailer confirmation and Sales cancellation cannot both succeed",async()=>{
      const id=await draft();await service.detect(id);await pool.query("UPDATE whatsapp_order_drafts SET status='Awaiting Retailer' WHERE id=$1",[id]);
      const results=await Promise.allSettled([service.confirm(id),confirmations.act(id,{action:'cancel',note:'No response; Sales cancelled'},sales)]);
      assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
      const row=(await pool.query('SELECT status,sales_cart_id FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0];assert.ok(row.status==='Completed'||row.status==='Denied');assert.equal(Boolean(row.sales_cart_id),row.status==='Completed');
    });
    await t.test("retailer clear preserves follow-up history and a stale edit button cannot reopen the cancelled order",async()=>{
      const id=await unconfirmed();await assert.rejects(()=>confirmations.cancelByRetailer(id,'WRONG'));
      await confirmations.cancelByRetailer(id,'SHOP');
      assert.equal((await pool.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0].status,'Denied');
      assert.ok((await pool.query('SELECT 1 FROM whatsapp_confirmation_events WHERE draft_id=$1',[id])).rowCount);
      const source=fs.readFileSync(path.join(root,'apps/api/src/whatsapp-integration.ts'),'utf8');
      const start=source.indexOf('    if (buttonId.startsWith("wa-edit:"))');
      const snippet=source.slice(start,source.indexOf('    if (buttonId.startsWith("wa-change-product:"))',start));
      let picker=false;
      const deps={buttonId:`wa-edit:quantity:${id}`,profile:{counterpartyId:'SHOP'},text:(v:any)=>String(v||''),executeDatabaseQuery:(sql:string,params:any[])=>pool.query(sql,params),loadDraft:async()=>({draft:(await pool.query('SELECT * FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0]}),sendDraftChangeProductPicker:async()=>{picker=true;},sendDraftRemoveProductPicker:async()=>{picker=true;},clearRetailerProforma:async()=>{}};
      const run=new Function(...Object.keys(deps),'return (async()=>{'+ts.transpileModule(snippet,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText+'})()');
      await assert.rejects(()=>run(...Object.values(deps)),/no longer editable/);assert.equal(picker,false);
      assert.equal((await pool.query('SELECT status FROM whatsapp_order_drafts WHERE id=$1',[id])).rows[0].status,'Denied');
    });
    await t.test("old cases remain visible and notification failures can be retried",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;await pool.query("UPDATE whatsapp_shortage_cases SET created_at=NOW()-INTERVAL '90 days' WHERE id=$1",[caseId]);
      await pool.query("UPDATE whatsapp_shortage_notifications SET status='Failed' WHERE case_id=$1",[caseId]);
      assert.ok((await service.list(sales)).cases.some(c=>c.id===caseId&&c.failed_notifications>0));
      await service.retryNotifications(caseId,sales);assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_shortage_notifications WHERE case_id=$1 AND status='Failed'",[caseId])).rows[0].n,0);
    });
  }finally{await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
});
