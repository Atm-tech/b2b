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
    await t.test("old cases remain visible and notification failures can be retried",async()=>{
      const id=await draft();const caseId=(await service.detect(id))!;await pool.query("UPDATE whatsapp_shortage_cases SET created_at=NOW()-INTERVAL '90 days' WHERE id=$1",[caseId]);
      await pool.query("UPDATE whatsapp_shortage_notifications SET status='Failed' WHERE case_id=$1",[caseId]);
      assert.ok((await service.list(sales)).cases.some(c=>c.id===caseId&&c.failed_notifications>0));
      await service.retryNotifications(caseId,sales);assert.equal((await pool.query("SELECT count(*)::int AS n FROM whatsapp_shortage_notifications WHERE case_id=$1 AND status='Failed'",[caseId])).rows[0].n,0);
    });
  }finally{await pool.end();await setup.query(`DROP SCHEMA ${schema} CASCADE`);await setup.end();}
});
