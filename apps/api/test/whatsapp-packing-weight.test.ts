import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { unpackedWhatsAppSalesOrders } from "../src/whatsapp-utils.js";
const source = ts.createSourceFile("integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(source.statements.filter((s) => ts.isFunctionDeclaration(s) && ["handleStaffWhatsAppMessage", "packingResultButtons"].includes(s.name?.text || "")).map((s) => s.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function fixture(testProduct = true, packingWeightCheckEnabled = true, packingError = "") {
  const sku = testProduct ? "WA-TEST-SOAP-12" : "REAL-SOAP";
  const replies: any[] = []; const packed: any[] = []; const amended: any[] = [];
  const snapshot = { salesOrders: [{id:"SO-1",cartId:"CART-1",status:"Booked",deliveryMode:"Delivery",productSku:sku,quantity:10,shopName:"Test Shop",paymentMode:"Cash",note:"Original order",rate:100,cdAmount:50,todAmount:20,gstRate:5,taxMode:"Exclusive"}], products:[{sku,defaultWeightKg:0.1,toleranceKg:0,tolerancePercent:0}], deliveryTasks:[],deliveryDockets:[] as any[],counterparties:[] };
  const maps = Object.fromEntries(["staffProofs", "deliveryProofPending", "cashCollectionPending", "paymentProofPending", "packingPhotoPending", "packingWeightResults", "packingPhotoProofs", "packingManualWeightPending", "packingChangePending", "dcoBuildSessions", "dcoHandoverSelections", "receiptSessions", "collectionConfirmations"].map((key) => [key, new Map()]));
  const deps = {...maps, packingWeightCheckEnabled, handleDeliveryExceptionMessage:async()=>false, deliveryExceptionService:{list:async()=>({cases:[]})}, packingService:{open:async()=>({id:"CASE",cart_id:"CART-1",original_json:[]})},isWhatsAppAdminUser:()=>false,sendPackingRecheckInstructions:async()=>{replies.push({body:"Recheck required",buttons:[]});}, unpackedWhatsAppSalesOrders, text: (v: unknown) => String(v ?? ""), numberValue: (v: unknown) => Number(v), staffHasRole: () => true, shortId: (s: string) => s,
    getSnapshot: async () => snapshot,
    updateSalesOrderGroup: async (cartId: string, payload: any, _user: any, warehouseQuantityAmend: boolean) => { if(packingError)throw new Error(packingError); amended.push({cartId,payload,warehouseQuantityAmend}); snapshot.salesOrders[0].quantity=payload.lines[0].quantity; return snapshot; },
    compact: (v: string, n: number) => v.slice(0,n),
    sendGraphMessage: async (_p: string, message: any) => { replies.push({body: message.interactive.body.text,buttons:[],rows:message.interactive.action.sections[0].rows}); },
    sendText: async (_p: string, body: string) => { replies.push({body,buttons:[]}); },
    sendButtons: async (_p: string, body: string, buttons: any[]) => { replies.push({body,buttons}); },
    executeDatabaseQuery: async () => ({rows:[]}), id: () => "NOTE", createSalesDockets: async (input: any) => {if(packingError)throw new Error(packingError);packed.push(input);}
  };
  const run = new Function(...Object.keys(deps), `${code};return handleStaffWhatsAppMessage;`)(...Object.values(deps));
  const user={id:1,roles:["Warehouse Manager"],fullName:"Warehouse"};
  return { action:(id:string)=>run({type:"interactive",interactive:{button_reply:{id}}},"phone",user), weight:(body:string)=>run({type:"text",text:{body}},"phone",user),replies,packed,amended,snapshot };
}
test("weight checks disabled lets test and normal orders pack directly", async () => {
  for (const testProduct of [true, false]) {
    const f=fixture(testProduct,false); await f.action("wa-so:order:CART-1");
    assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Packed","Amend"]);
    await f.action("wa-so:packed:CART-1"); assert.deepEqual(f.packed,[{linkedOrderIds:["CART-1"]}]);
    assert.match(f.replies.at(-1).body,/packed and ready/);
  }
});
test("old recheck buttons cannot open a review while checks are disabled", async () => {
  const f=fixture(true,false);
  await f.action("wa-so:recheck:CART-1");
  assert.match(f.replies.at(-1).body,/Recheck abhi disabled/);
  assert.equal(f.packed.length,0);
});
test("prepacking amend scales discounts and preserves all bill inputs", async () => {
  const f=fixture(true,false); await f.action("wa-so:amend:CART-1"); await f.weight("AMEND WA-TEST-SOAP-12 8");
  assert.equal(f.amended.length,1);
  const payload=f.amended[0].payload;
  assert.deepEqual(payload.beforePacking,[{id:"SO-1",quantity:10}]);
  assert.equal(payload.lines[0].quantity,8); assert.equal(payload.lines[0].cdAmount,40); assert.equal(payload.lines[0].todAmount,16);
  assert.equal(payload.lines[0].gstRate,5); assert.equal(payload.note,"Original order");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Packed","Amend"]);
});
test("warehouse selects a product option then sends only the new quantity", async () => {
  const f=fixture(true,false); await f.action("wa-so:amend:CART-1");
  assert.equal(f.replies.at(-1).rows[0].id,"wa-so:amend-line:CART-1:SO-1");
  await f.action(f.replies.at(-1).rows[0].id); assert.match(f.replies.at(-1).body,/Current quantity: 10/);
  await f.weight("0"); assert.equal(f.amended.length,0);
  await f.weight("8"); assert.equal(f.amended[0].payload.lines[0].quantity,8);
  assert.equal(f.amended[0].warehouseQuantityAmend,true);
});
test("all products remain selectable through pagination", async () => {
  const f=fixture(true,false);
  for(let i=2;i<=12;i++) f.snapshot.salesOrders.push({...f.snapshot.salesOrders[0],id:`SO-${i}`,productSku:`SKU-${i}`});
  await f.action("wa-so:amend:CART-1"); assert.equal(f.replies.at(-1).rows.length,10);
  const next=f.replies.at(-1).rows.at(-1).id; await f.action(next);
  assert.equal(f.replies.at(-1).rows.length,3);
  assert.equal(f.replies.at(-1).rows[2].id,"wa-so:amend-line:CART-1:SO-12");
});
test("amend rejects invalid quantities and unknown products", async () => {
  const f=fixture(true,false); await f.action("wa-so:amend:CART-1");
  for(const value of ["0","-1","NaN","Infinity"]) await f.weight(`AMEND WA-TEST-SOAP-12 ${value}`);
  await f.weight("AMEND WRONG-SKU 8"); assert.equal(f.amended.length,0);
});
test("amend rejects packing completed after opening the edit", async () => {
  const f=fixture(true,false); await f.action("wa-so:amend:CART-1");
  f.snapshot.deliveryDockets.push({salesOrderId:"SO-1"});
  await f.weight("AMEND WA-TEST-SOAP-12 8"); assert.equal(f.amended.length,0); assert.match(f.replies.at(-1).body,/Packed se pehle/);
  await f.action("wa-so:amend:CART-1"); assert.match(f.replies.at(-1).body,/packed hai|Packed se pehle/);
});
test("amend surfaces permission and stock failures without success", async () => {
  const f=fixture(true,false,"Only the sales owner can edit this order.");
  await f.action("wa-so:amend:CART-1"); await f.weight("AMEND WA-TEST-SOAP-12 8");
  assert.equal(f.amended.length,0); assert.match(f.replies.at(-1).body,/Amend save nahi hua/);
});
test("packing hold is reported to WhatsApp without confirming packing", async () => {
  const f=fixture(true,false,"Packing recheck is unresolved.");
  await f.action("wa-so:order:CART-1"); await f.action("wa-so:packed:CART-1");
  assert.equal(f.packed.length,0); assert.match(f.replies.at(-1).body,/Packed nahi hua: Packing recheck is unresolved/);
});
test("test packing shows Packed only after manual weight and creates real dockets", async () => {
  const f=fixture(); await f.action("wa-so:order:CART-1");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Enter weight","Recheck"]);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
  await f.action("wa-so:weight:CART-1");
  await f.weight("NaN"); assert.equal(f.packed.length,0);
  await f.weight("1"); assert.equal(f.replies.at(-1).buttons[0].title,"Packed");
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,1);
});
test("out of tolerance weight does not expose Packed", async () => {
  const f=fixture(); await f.action("wa-so:order:CART-1"); await f.action("wa-so:weight:CART-1"); await f.weight("5");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Recheck"]);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
});
test("normal products cannot use photo-free test weight", async () => {
  const f=fixture(false); await f.action("wa-so:order:CART-1");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Recheck"]);
  await f.action("wa-so:weight:CART-1"); assert.match(f.replies.at(-1).body,/test order dobara/);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
});
