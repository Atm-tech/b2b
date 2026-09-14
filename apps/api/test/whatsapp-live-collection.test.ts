import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { WHATSAPP_COLLECTION_TOLERANCE } from "../src/whatsapp-collection-utils.js";

const source = ts.createSourceFile("integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const names = ["handleStaffWhatsAppMessage", "collectionRemaining", "notifyDeliveryAllDone", "getCollectionRetailer"];
const code = ts.transpileModule(source.statements.filter((statement) => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text || "")).map((node) => node.getText(source)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

function fixture(privileged = true) {
  let task: any = { id: "TASK-1", side: "Sales", status: "Out for Delivery", assignedTo: "driver", linkedOrderIds: ["SO-1"], routeStops: [{ orderId: "SO-1", supplierId: "SHOP-1", supplierName: "Retailer", delivered: true, paid: false, paymentRequired: true, amountToPay: 100, collectionStatus: "Pending" }] };
  const replies: any[] = []; const payments: any[] = [];
  const maps = Object.fromEntries(["staffProofs", "deliveryProofPending", "cashCollectionPending", "paymentProofPending", "packingPhotoPending", "packingWeightResults", "packingPhotoProofs", "packingManualWeightPending", "packingChangePending", "dcoBuildSessions", "dcoHandoverSelections", "receiptSessions", "collectionConfirmations"].map((name) => [name, new Map()]));
  const dependencies = {
    ...maps, WHATSAPP_COLLECTION_TOLERANCE, shortId: (value: string) => value, cashDenominations: [500, 200, 100, 50, 20, 10],
    text: (value: unknown) => String(value ?? ""), numberValue: (value: unknown) => Number(value || 0),
    staffHasRole: () => true, deliveryTaskAllowed: () => true,
    getSnapshot: async () => ({ deliveryTasks: [task], counterparties: [], salesOrders: [], purchaseOrders: [] }),
    sendText: async (_phone: string, body: string) => { replies.push(body); },
    sendButtons: async (_phone: string, body: string, buttons: any[]) => { replies.push({body,buttons}); },
    sendCollectionQr: async () => {},
    createPayment: async (payment: any) => { payments.push(payment); },
    updateDeliveryTask: async (_id: string, payload: any) => { task = {...task,...payload}; },
    collectionExceptionApproved: async () => false,
    alertWhatsAppAdminForCollection: async () => { throw new Error("Unexpected collection exception"); },
    executeDatabaseQuery: async (sql: string, params: unknown[]) => ({rows: sql.includes("FROM counterparties") && params[0] === "SHOP-1" ? [{mobile_number: "919999999999", allow_later_collection: privileged, allow_partial_collection: privileged, allow_cheque_collection: privileged, collection_tolerance: 5}] : []}), id: () => "note",
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
    if (mode === "cheque") assert.match(f.replies.at(-1), /photo/);
    else assert.match(f.replies.at(-1).body, /optional/);
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


test("completion is sent only for TOTAL/SUM after all assigned deliveries finish", async () => {
  for (const command of ["TOTAL", "SUM", "SETTLE", "LIST COLLECTION"]) {
    const f = fixture();
    await f.text(command);
    assert.equal(f.replies.some((reply) => typeof reply === "string" && reply.includes("Done for day")), false);
    f.task().status = "Delivered";
    f.replies.length = 0;
    await f.text(command);
    assert.equal(f.replies.some((reply) => typeof reply === "string" && reply.includes("Done for day")), ["TOTAL", "SUM"].includes(command));
  }
});

test("cash full collection accepts inclusive plus/minus Rs.5 and rejects outside", async () => {
  for (const amount of [94.99, 95, 100, 105, 105.01]) {
    const f = fixture(false);
    await f.action("wa-collect:full:TASK-1:0");
    await f.action("wa-mop:cash:full:TASK-1:0");
    for (const value of [0,0,0,0,0,0]) await f.text(String(value));
    if (amount < 95 || amount > 105) {
      await assert.rejects(f.text(String(amount)), /Unexpected collection exception/);
      assert.equal(f.payments.length, 0);
    } else {
      await f.text(String(amount));
      await f.action(f.replies.at(-1).buttons[0].id);
      assert.equal(f.payments[0].amount, amount);
      assert.equal(f.task().routeStops[0].paid, true);
    }
  }
});


test("last retailer handover photo does not announce done for day", async () => {
  const f = fixture();
  f.task().routeStops[0].delivered = false;
  await f.action("wa-delivery:done:TASK-1:0");
  await f.photo();
  assert.equal(f.task().status, "Delivered");
  assert.equal(f.replies.some((reply) => typeof reply === "string" && /done for day|all done/i.test(reply)), false);
  assert.match(f.replies.at(-1).body, /delivery photo saved/);
  await f.text("TOTAL");
  assert.match(f.replies.at(-1), /Done for day/);
});


test("UPI supports full and partial collection without photo and rejects replay", async () => {
  for (const kind of ["full", "partial"]) {
    const f = fixture();
    const amount = kind === "full" ? 100 : 50;
    await f.action(`wa-mop:upi:${kind}:TASK-1:0`);
    await f.text(String(amount));
    assert.equal(f.payments.length, 0);
    const confirmation = f.replies.at(-1).buttons[0].id;
    await f.action(confirmation);
    await f.action(confirmation);
    assert.equal(f.payments.length, 1);
    assert.equal(f.payments[0].mode, "UPI");
    assert.equal(f.payments[0].amount, amount);
    assert.equal(f.payments[0].proofName, undefined);
    assert.equal(f.task().routeStops[0].paid, kind === "full");
  }
});

test("UPI without photo still enforces full collection tolerance", async () => {
  for (const amount of [94.99, 105.01]) {
    const f = fixture(false);
    await f.action("wa-mop:upi:full:TASK-1:0");
    await f.text(String(amount));
    await assert.rejects(f.action(f.replies.at(-1).buttons[0].id), /Unexpected collection exception/);
    assert.equal(f.payments.length, 0);
  }
});


test("WhatsApp-only retailer privileges appear throughout collection chat", async () => {
  const f = fixture();
  await f.action("wa-delivery:stop:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Collect later", "Collect now"]);
  await f.action("wa-collect:now:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Full", "Partial"]);
  await f.action("wa-collect:partial:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Cash", "UPI", "Cheque"]);
});

test("disabled retailer privileges stay hidden in collection chat", async () => {
  const f = fixture(false);
  await f.action("wa-delivery:stop:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Collect now"]);
  await f.action("wa-collect:now:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Collect full"]);
  await f.action("wa-collect:full:TASK-1:0");
  assert.deepEqual(f.replies.at(-1).buttons.map((button: any) => button.title), ["Cash", "UPI"]);
});
