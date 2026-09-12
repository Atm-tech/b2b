import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppTestState } from "../src/whatsapp-test-mode.js";
import { assignedTestDcos, testDeliveryReply } from "../src/whatsapp-test-delivery.js";

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
  const collected = testDeliveryReply(tasks, delivered.progress, action(`collected:${id}:TEST-SO-1`));
  assert.deepEqual(collected.progress[`${id}~TEST-SO-1`], { delivered: true, collected: true });
  assert.match(JSON.stringify(testDeliveryReply(tasks, collected.progress, action(`dco:${id}`)).response), /Test Shop 2/);
  assert.doesNotMatch(JSON.stringify(testDeliveryReply(tasks, collected.progress, action(`dco:${id}`)).response), /Test Shop 1/);
});

test("fresh handovers do not reuse completion of a previous practice run", () => {
  const source = fixture(); const oldId = assignedTestDcos([source], "del1")[0].id;
  source.value_json.dcos![0].handoverId = "fresh-run";
  const tasks = assignedTestDcos([source], "del1");
  assert.notEqual(tasks[0].id, oldId);
  assert.match(JSON.stringify(testDeliveryReply(tasks, { [`${oldId}~TEST-SO-1`]: { collected: true } }, action(`dco:${tasks[0].id}`)).response), /Test Shop 1/);
});
