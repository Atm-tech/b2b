import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppTestState } from "../src/whatsapp-test-mode.js";
import { assignedTestDcos, testDeliveryReply, type TestDeliveryProgress } from "../src/whatsapp-test-delivery.js";
import { paymentOcrAmount } from "../src/whatsapp-collection-utils.js";

const text = (body: string) => ({ type: "text", text: { body } });
const action = (id: string) => ({ type: "interactive", interactive: { button_reply: { id: `wa-test-delivery:${id}` } } });
function fixture() {
  const state = createWhatsAppTestState();
  state.dcos = [{ id: "TEST-DCO-1", orderIds: ["TEST-SO-1", "TEST-SO-2"], assignedTo: "del1", handedOver: true }];
  return { key: "whatsapp_test_mode:3735", value_json: state };
}

test("existing warehouse test handover appears in assigned agent LIST with both retailers", () => {
  const tasks = assignedTestDcos([fixture()], "del1");
  assert.equal(tasks.length, 1);
  const response = testDeliveryReply(tasks, {}, text("list"));
  assert.equal(response.handled, true);
  assert.match(JSON.stringify(response.response), /TEST-DCO-1/);
  const retailers = testDeliveryReply(tasks, {}, action(`dco:${tasks[0].id}`));
  assert.match(JSON.stringify(retailers.response), /Test Shop 1/);
  assert.match(JSON.stringify(retailers.response), /Test Shop 2/);
  assert.doesNotMatch(JSON.stringify(retailers.response), /Test Shop 3/);
});

test("assignment isolation excludes other agents, unsent DCOs and stale buttons", () => {
  const source = fixture();
  assert.deepEqual(assignedTestDcos([source], "other"), []);
  source.value_json.dcos![0].handedOver = false;
  assert.deepEqual(assignedTestDcos([source], "del1"), []);
  assert.equal(testDeliveryReply([], {}, action("dco:stale")).handled, true);
  assert.equal(testDeliveryReply([], {}, text("LIST")).handled, false);
  assert.equal(testDeliveryReply(assignedTestDcos([fixture()], "del1"), {}, text("LIVE LIST")).handled, false);
});

test("test delivery precedes test collection and completion is saved only as practice progress", () => {
  const tasks = assignedTestDcos([fixture()], "del1"); const id = tasks[0].id;
  assert.deepEqual(testDeliveryReply(tasks, {}, action(`collected:${id}:TEST-SO-1`)).progress, {});
  const delivered = testDeliveryReply(tasks, {}, action(`delivered:${id}:TEST-SO-1`));
  let progress = testDeliveryReply(tasks, delivered.progress, action(`full:${id}:TEST-SO-1`)).progress;
  progress = testDeliveryReply(tasks, progress, action(`cash:${id}:TEST-SO-1`)).progress;
  for (const count of [2, 0, 0, 0, 0, 0, 0]) progress = testDeliveryReply(tasks, progress, text(String(count))).progress;
  const token = progress[`${id}~TEST-SO-1`].pending!.confirmationId;
  const collected = testDeliveryReply(tasks, progress, action(`confirm:${id}:TEST-SO-1:${token}`));
  assert.equal(collected.progress[`${id}~TEST-SO-1`].collected, true);
  assert.equal(collected.progress[`${id}~TEST-SO-1`].payments?.[0].amount, 1000);
  assert.match(JSON.stringify(testDeliveryReply(tasks, collected.progress, action(`dco:${id}`)).response), /Test Shop 2/);
  assert.doesNotMatch(JSON.stringify(testDeliveryReply(tasks, collected.progress, action(`dco:${id}`)).response), /Test Shop 1/);
});

test("Now/Later, Full/Partial and Cheque are controlled by retailer privileges", () => {
  const tasks = assignedTestDcos([fixture()], "del1"); const id = tasks[0].id;
  for (const [orderId, privileged] of [["TEST-SO-1", false], ["TEST-SO-2", true]] as const) {
    const delivered = testDeliveryReply(tasks, {}, action(`delivered:${id}:${orderId}`));
    assert.equal(JSON.stringify(delivered.response).includes("Collect later"), privileged);
    const now = testDeliveryReply(tasks, delivered.progress, action(`now:${id}:${orderId}`));
    assert.equal(JSON.stringify(now.response).includes('"title":"Partial"'), privileged);
    const full = testDeliveryReply(tasks, now.progress, action(`full:${id}:${orderId}`));
    assert.equal(JSON.stringify(full.response).includes('"title":"Cheque"'), privileged);
    if (!privileged) {
      for (const choice of ["later", "partial", "cheque"]) assert.match(JSON.stringify(testDeliveryReply(tasks, full.progress, action(`${choice}:${id}:${orderId}`)).response), /privilege/);
    }
  }
});

test("cash asks 500,200,100,50,20,10 then total coin value and waits for confirmation", () => {
  const tasks = assignedTestDcos([fixture()], "del1"); const id = tasks[0].id; const key = `${id}~TEST-SO-2`;
  let progress: TestDeliveryProgress = { [key]: { delivered: true } };
  progress = testDeliveryReply(tasks, progress, action(`partial:${id}:TEST-SO-2`)).progress;
  let result = testDeliveryReply(tasks, progress, action(`cash:${id}:TEST-SO-2`));
  assert.match(JSON.stringify(result.response), /500/);
  for (const denomination of [200, 100, 50, 20, 10]) { result = testDeliveryReply(tasks, result.progress, text("0")); assert.match(JSON.stringify(result.response), new RegExp(`Rs.${denomination}`)); }
  result = testDeliveryReply(tasks, result.progress, text("0")); assert.match(JSON.stringify(result.response), /Coins/);
  result = testDeliveryReply(tasks, result.progress, text("5.50"));
  assert.equal(result.progress[key].pending?.amount, 5.5);
  assert.equal(result.progress[key].payments, undefined);
  const token = result.progress[key].pending?.confirmationId;
  result = testDeliveryReply(tasks, result.progress, action(`confirm:${id}:TEST-SO-2:${token}`));
  assert.equal(result.progress[key].collected, false);
  assert.equal(result.progress[key].payments?.[0].amount, 5.5);
  const repeat = testDeliveryReply(tasks, result.progress, action(`confirm:${id}:TEST-SO-2:${token}`));
  assert.equal(repeat.progress[key].payments?.length, 1);
});

test("UPI and cheque require a photo and readable OCR, with cheque payee and amount checks", () => {
  const tasks = assignedTestDcos([fixture()], "del1"); const id = tasks[0].id; const key = `${id}~TEST-SO-2`;
  for (const mode of ["upi", "cheque"]) {
    let progress: TestDeliveryProgress = { [key]: { delivered: true } };
    progress = testDeliveryReply(tasks, progress, action(`partial:${id}:TEST-SO-2`)).progress;
    progress = testDeliveryReply(tasks, progress, action(`${mode}:${id}:TEST-SO-2`)).progress;
    assert.match(JSON.stringify(testDeliveryReply(tasks, progress, text("500")).response), /photo/);
    const photo = { type: "image", image: { id: "photo-1" } };
    assert.match(JSON.stringify(testDeliveryReply(tasks, progress, photo, null).response), /clearly read nahi/);
    if (mode === "cheque") assert.match(JSON.stringify(testDeliveryReply(tasks, progress, photo, { visible: true, amount: 500, payeeName: "Someone Else", transactionDate: "" }).response), /payee/);
    const read = testDeliveryReply(tasks, progress, photo, { visible: true, amount: 500, payeeName: "Aapoorti", transactionDate: "" });
    assert.equal(read.progress[key].pending?.amount, 500);
    assert.equal(read.progress[key].pending?.proofId, "photo-1");
    assert.equal(read.progress[key].payments, undefined);
    const saved = testDeliveryReply(tasks, read.progress, action(`confirm:${id}:TEST-SO-2:${read.progress[key].pending?.confirmationId}`));
    assert.equal(saved.progress[key].payments?.[0].amount, 500);
    assert.equal(saved.progress[key].collected, false);
  }
});

test("payment OCR never chooses an unrelated number simply because it matches the bill", () => {
  assert.equal(paymentOcrAmount("UPI reference 123456789012 date 12/09/2026 Amount paid Rs. 1,500.00"), 1500);
  assert.equal(paymentOcrAmount("Reference 1000 Date 12/09/2026"), null);
  assert.equal(paymentOcrAmount("Amount Rs 500 Balance Rs 1500"), null);
  assert.equal(paymentOcrAmount("Cheque Aapoorti INR 750.50"), 750.5);
});

test("full collection rejects short/over payments and confirmation rechecks privileges", () => {
  const tasks = assignedTestDcos([fixture()], "del1"); const id = tasks[0].id; const key = `${id}~TEST-SO-2`;
  const begin = (kind: string) => {
    let progress: TestDeliveryProgress = { [key]: { delivered: true } };
    progress = testDeliveryReply(tasks, progress, action(`${kind}:${id}:TEST-SO-2`)).progress;
    return testDeliveryReply(tasks, progress, action(`upi:${id}:TEST-SO-2`)).progress;
  };
  const photo = { type: "image", image: { id: "proof" } };
  for (const amount of [500, 1600]) {
    const result = testDeliveryReply(tasks, begin("full"), photo, { visible: true, amount, payeeName: "Aapoorti", transactionDate: "" });
    assert.equal(result.progress[key].pending, undefined);
    assert.equal(result.progress[key].payments, undefined);
  }
  const read = testDeliveryReply(tasks, begin("partial"), photo, { visible: true, amount: 500, payeeName: "Aapoorti", transactionDate: "" });
  const token = read.progress[key].pending!.confirmationId;
  tasks[0].orders[1].collection!.allowPartial = false;
  assert.equal(testDeliveryReply(tasks, read.progress, action(`confirm:${id}:TEST-SO-2:${token}`)).progress[key].payments, undefined);
});

test("fresh handovers do not reuse completion of a previous practice run", () => {
  const source = fixture(); const oldId = assignedTestDcos([source], "del1")[0].id;
  source.value_json.dcos![0].handoverId = "fresh-run";
  const tasks = assignedTestDcos([source], "del1");
  assert.notEqual(tasks[0].id, oldId);
  assert.match(JSON.stringify(testDeliveryReply(tasks, { [`${oldId}~TEST-SO-1`]: { collected: true } }, action(`dco:${tasks[0].id}`)).response), /Test Shop 1/);
});
