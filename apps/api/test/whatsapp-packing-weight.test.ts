import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { unpackedWhatsAppSalesOrders } from "../src/whatsapp-utils.js";
const source = ts.createSourceFile("integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const code = ts.transpileModule(source.statements.filter((s) => ts.isFunctionDeclaration(s) && ["handleStaffWhatsAppMessage", "packingResultButtons"].includes(s.name?.text || "")).map((s) => s.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function fixture(testProduct = true) {
  const sku = testProduct ? "WA-TEST-SOAP-12" : "REAL-SOAP";
  const replies: any[] = []; const packed: any[] = [];
  const maps = Object.fromEntries(["staffProofs", "deliveryProofPending", "cashCollectionPending", "paymentProofPending", "packingPhotoPending", "packingWeightResults", "packingPhotoProofs", "packingManualWeightPending", "packingChangePending", "dcoBuildSessions", "dcoHandoverSelections", "receiptSessions", "collectionConfirmations"].map((key) => [key, new Map()]));
  const deps = {...maps, unpackedWhatsAppSalesOrders, text: (v: unknown) => String(v ?? ""), numberValue: (v: unknown) => Number(v), staffHasRole: () => true, shortId: (s: string) => s,
    getSnapshot: async () => ({ salesOrders: [{id:"SO-1",cartId:"CART-1",status:"Booked",deliveryMode:"Delivery",productSku:sku,quantity:10,shopName:"Test Shop"}], products:[{sku,defaultWeightKg:0.1,toleranceKg:0,tolerancePercent:0}], deliveryTasks:[],deliveryDockets:[],counterparties:[] }),
    sendText: async (_p: string, body: string) => { replies.push({body,buttons:[]}); },
    sendButtons: async (_p: string, body: string, buttons: any[]) => { replies.push({body,buttons}); },
    executeDatabaseQuery: async () => ({rows:[]}), id: () => "NOTE", createSalesDockets: async (input: any) => {packed.push(input);}
  };
  const run = new Function(...Object.keys(deps), `${code};return handleStaffWhatsAppMessage;`)(...Object.values(deps));
  const user={id:1,roles:["Warehouse Manager"],fullName:"Warehouse"};
  return { action:(id:string)=>run({type:"interactive",interactive:{button_reply:{id}}},"phone",user), weight:(body:string)=>run({type:"text",text:{body}},"phone",user),replies,packed };
}
test("test packing shows Packed only after manual weight and creates real dockets", async () => {
  const f=fixture(); await f.action("wa-so:order:CART-1");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Enter weight","Change"]);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
  await f.action("wa-so:weight:CART-1");
  await f.weight("NaN"); assert.equal(f.packed.length,0);
  await f.weight("1"); assert.equal(f.replies.at(-1).buttons[0].title,"Packed");
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,1);
});
test("out of tolerance weight does not expose Packed", async () => {
  const f=fixture(); await f.action("wa-so:order:CART-1"); await f.action("wa-so:weight:CART-1"); await f.weight("5");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Change"]);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
});
test("normal products cannot use photo-free test weight", async () => {
  const f=fixture(false); await f.action("wa-so:order:CART-1");
  assert.deepEqual(f.replies.at(-1).buttons.map((b:any)=>b.title),["Change"]);
  await f.action("wa-so:weight:CART-1"); assert.match(f.replies.at(-1).body,/test order dobara/);
  await f.action("wa-so:packed:CART-1"); assert.equal(f.packed.length,0);
});

