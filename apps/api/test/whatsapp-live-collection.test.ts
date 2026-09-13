import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["handleStaffWhatsAppMessage", "collectionRemaining"];
const code = ts.transpileModule(source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text || "")).map((node) => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture(privileged = true) {
  let task: any = { id: "TASK-1", side: "Sales", status: "Out for Delivery", assignedTo: "driver", linkedOrderIds: ["SO-1"], routeStops: [{ orderId: "SO-1", supplierId: "SHOP-1", supplierName: "Retailer", delivered: true, paid: false, paymentRequired: true, amountToPay: 100, collectionStatus: "Pending" }] };
  const replies: any[] = []; const payments: any[] = [];
  const maps = Object.fromEntries(["staffProofs", "deliveryProofPending", "cashCollectionPending", "paymentProofPending", "packingPhotoPending", "packingWeightResults", "packingPhotoProofs", "packingManualWeightPending", "packingChangePending", "dcoBuildSessions", "dcoHandoverSelections", "receiptSessions", "collectionConfirmations"].map((name) => [name, new Map()]));
  const dependencies = {
    ...maps, cashDenominations: [500, 200, 100, 50, 20, 10],
    text: (value: unknown) => String(value ?? ""), numberValue: (value: unknown) => Number(value || 0),
    staffHasRole: () => true, deliveryTaskAllowed: () => true,
    getSnapshot: async () => ({ deliveryTasks: [task], counterparties: [{id:"SHOP-1", allowPartialCollection:privileged, allowLaterCollection:privileged,allowChequeCollection:privileged}], salesOrders: [], purchaseOrders: [] }),
    sendText: async (_phone: string, body: string) => { replies.push(body); },
    sendButtons: async (_phone: string, body: string, buttons: any[]) => { replies.push({body,buttons}); },
    sendCollectionQr: async () => {},
    createPayment: async (payment: any) => { payments.push(payment); },
    updateDeliveryTask: async (_id: string, payload: any) => { task = {...task,...payload}; },
    collectionExceptionApproved: async () => false,
    alertWhatsAppAdminForCollection: async () => { throw new Error("Unexpected collection exception"); },
    executeDatabaseQuery: async () => ({rows: []}), id: () => "note",
    readWhatsAppPaymentProof: async () => ({visible:true,amount:100,payeeName:"Aapoorti",transactionDate:""})
  };
  const handler = new Function(...Object.keys(dependencies), `${code}; return handleStaffWhatsAppMessage;`)(...Object.values(dependencies));
  const run = (message: any) => handler(message, "919999999999", {id:2,username:"driver",fullName:"Driver",roles:["Delivery","Collection Agent"]});
  return { action: (id:string) => run({type:"interactive",interactive:{button_reply:{id}}}), text: (body:string) => run({type:"text",text:{body}}), photo: () => run({type:"image",image:{id:"proof"}}), replies, payments, task: () => task };
}
test("real cash flow supports partial then remaining full collection and rejects replay", async () => {
  const f = fixture();
  await f.action("wa-collect:partial:TASK-1:0");
  assert.equal(f.replies.at(-1).buttons[0].id, "wa-mop:cash:partial:TASK-1:0");
  await f.action("wa-mop:cash:partial:TASK-1:0");
  for (const value of [0,0,0,1,0,0,0]) await f.text(String(value));
  const first = f.replies.at(-1).buttons[0].id;
  await f.action(first); await f.action(first);
  assert.equal(f.payments.length, 1);
  assert.equal(f.task().routeStops[0].collectionStatus, "Pending");
  assert.equal(f.task().routeStops[0].collectionAmount, 50);
  await f.action("wa-collect:full:TASK-1:0");
  await f.action("wa-mop:cash:full:TASK-1:0");
  assert.match(f.replies.at(-1), /50.00/);
  for (const value of [0,0,0,0,2,0,10]) await f.text(String(value));
  await f.action(f.replies.at(-1).buttons[0].id);
  assert.equal(f.payments.length, 2);
  assert.equal(f.task().routeStops[0].paid, true);
  assert.equal(f.task().routeStops[0].collectionAmount, 100);
});
test("real UPI/cheque use photo OCR confirmation with correct task and amount", async () => {
  for (const mode of ["upi", "cheque"]) {
    const f = fixture();
    await f.action("wa-collect:full:TASK-1:0");
    await f.action(`wa-mop:${mode}:full:TASK-1:0`);
    await f.text("100");
    assert.match(f.replies.at(-1), /photo/);
    assert.equal(f.payments.length, 0);
    await f.photo();
    const confirm = f.replies.at(-1).buttons[0].id;
    await f.action(confirm); await f.action(confirm);
    assert.equal(f.payments.length, 1);
    assert.equal(f.payments[0].amount, 100);
    assert.equal(f.payments[0].mode, mode === "upi" ? "UPI" : "Cheque");
    assert.equal(f.task().routeStops[0].paid, true);
  }
});
test("stale later, partial and cheque choices require current privileges", async () => {
  for (const action of ["wa-collect:later:TASK-1:0", "wa-collect:partial:TASK-1:0", "wa-mop:cheque:full:TASK-1:0"]) {
    const f = fixture(false); await f.action(action);
    assert.equal(f.payments.length, 0);
    assert.equal(f.task().routeStops[0].collectionStatus, "Pending");
    assert.match(f.replies.at(-1), /privilege|allowed/);
  }
});
