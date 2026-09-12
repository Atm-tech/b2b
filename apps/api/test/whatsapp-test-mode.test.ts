import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppTestState, handleWhatsAppTestMessage, isDeliveryCollectionAgent } from "../src/whatsapp-test-mode.js";

const text = (body: string) => ({ type: "text", text: { body } });
const action = (id: string) => ({ type: "interactive", interactive: { button_reply: { id } } });

test("packed test SOs disappear from SO/LIST and remain available for DCO", () => {
  const state = createWhatsAppTestState(); state.orders[0].packed = true;
  for (const command of ["SO", "LIST"]) {
    const response = JSON.stringify(handleWhatsAppTestMessage(state, text(command)).response);
    assert.doesNotMatch(response, /wa-test:order:TEST-SO-1/);
    assert.match(response, /wa-test:order:TEST-SO-2/);
  }
  assert.match(JSON.stringify(handleWhatsAppTestMessage(state, action("wa-test:dco-new")).response), /wa-test:dco-add:TEST-SO-1/);
  assert.match(JSON.stringify(handleWhatsAppTestMessage(state, action("wa-test:order:TEST-SO-1")).response), /already packed/);
  state.orders.forEach((order) => { order.packed = true; });
  assert.match(JSON.stringify(handleWhatsAppTestMessage(state, text("SO")).response), /Saare test SO packed/);
});

test("test sessions contain exactly the three requested dummy shops and no live action IDs", () => {
  const result = handleWhatsAppTestMessage(undefined, text("test"));
  assert.deepEqual(result.state?.orders.map((order) => order.shop), ["Test Shop 1", "Test Shop 2", "Test Shop 3"]);
  assert.match(JSON.stringify(result.response), /wa-test:order:TEST-SO-1/);
  assert.doesNotMatch(JSON.stringify(result.response), /wa-so:|wa-dco:|wa-delivery:/);
});

test("active test sessions consume live commands, old live buttons and media without mutating business state", () => {
  const state = createWhatsAppTestState();
  for (const message of [text("SO"), text("List"), text("HANDOVER LIVE-DCO"), text("IN"), action("wa-so:packed:LIVE-SO"), action("wa-delivery:done:LIVE-TASK:0"), { type: "image", image: { id: "test-media" } }]) {
    const result = handleWhatsAppTestMessage(state, message);
    assert.equal(result.handled, true);
    assert.ok(result.response);
    assert.deepEqual(result.state?.orders, state.orders);
  }
  assert.equal(handleWhatsAppTestMessage(undefined, text("SO")).handled, false);
  assert.equal(handleWhatsAppTestMessage(undefined, action("wa-test:packed:TEST-SO-1")).handled, true);
});

test("packing practice requires selection and a new photo after changing quantity", () => {
  const original = createWhatsAppTestState();
  let state = handleWhatsAppTestMessage(original, action("wa-test:order:TEST-SO-1")).state!;
  state = handleWhatsAppTestMessage(state, action("wa-test:packed:TEST-SO-1")).state!;
  assert.equal(state.orders[0].packed, false);
  state = handleWhatsAppTestMessage(state, { type: "image" }).state!;
  state = handleWhatsAppTestMessage(state, action("wa-test:packed:TEST-SO-2")).state!;
  assert.equal(state.orders[1].packed, false);
  state = handleWhatsAppTestMessage(state, action("wa-test:packed:TEST-SO-1")).state!;
  assert.equal(state.orders[0].packed, true);
  state = handleWhatsAppTestMessage(state, action("wa-test:change:TEST-SO-1")).state!;
  state = handleWhatsAppTestMessage(state, text("5")).state!;
  assert.equal(state.orders[0].quantity, 5);
  assert.equal(state.orders[0].photo, false);
  assert.equal(state.orders[0].packed, false);
  assert.deepEqual(original, createWhatsAppTestState());
});

test("reset and explicit exit confirmation stay within the simulator", () => {
  let state = createWhatsAppTestState();
  assert.equal(handleWhatsAppTestMessage(state, action("wa-test:handover")).state?.handedOver, undefined);
  assert.deepEqual(handleWhatsAppTestMessage(state, text("TEST RESET")).state, createWhatsAppTestState());
  assert.ok(handleWhatsAppTestMessage(state, text("TEST EXIT")).state);
  assert.equal(handleWhatsAppTestMessage(state, action("wa-test:exit")).state, undefined);
});

test("multiple SO form one unassigned DCO; only confirmed Send assigns the active agent", () => {
  const agent = { username: "driver", fullName: "Test Driver", active: true, role: "Delivery", roles: ["Delivery"] };
  let state = createWhatsAppTestState();
  state.orders.forEach((order) => { order.packed = true; order.photo = true; });
  const step = (id: string) => { const result = handleWhatsAppTestMessage(state, action(`wa-test:${id}`), [agent]); state = result.state!; return result; };
  step("dco-new"); step("dco-add:TEST-SO-1"); step("dco-more"); step("dco-add:TEST-SO-2"); step("dco-create");
  assert.deepEqual(state.dcos, [{ id: "TEST-DCO-1", orderIds: ["TEST-SO-1", "TEST-SO-2"] }]);
  step("dco-create"); assert.equal(state.dcos?.length, 1);
  step("dco-new"); step("dco-add:TEST-SO-1"); assert.deepEqual(state.chosenSos, []);
  step("dco-ready"); step("dco-open:TEST-DCO-1");
  const list = step("dco-handover:TEST-DCO-1"); assert.match(JSON.stringify(list.response), /Test Driver/);
  step("dco-agent:TEST-DCO-1:driver");
  assert.equal(state.dcos?.[0].assignedTo, undefined);
  const inactive = handleWhatsAppTestMessage(state, action("wa-test:dco-send:TEST-DCO-1:driver"), [{ ...agent, active: false }]);
  assert.equal(inactive.state?.dcos?.[0].handedOver, undefined);
  step("dco-send:TEST-DCO-1:driver");
  assert.equal(state.dcos?.[0].assignedTo, "driver");
  assert.equal(state.dcos?.[0].handedOver, true);
  assert.equal(state.orders[2].packed, true);
  const before = structuredClone(state.dcos);
  step("dco-send:TEST-DCO-1:driver"); assert.deepEqual(state.dcos, before);
});

test("only active outgoing delivery agents are selectable for delivery plus collection", () => {
  const base = { username: "agent", fullName: "Agent", active: true, role: "", roles: [] as string[] };
  assert.equal(isDeliveryCollectionAgent({ ...base, role: "Delivery" }), true);
  assert.equal(isDeliveryCollectionAgent({ ...base, roles: ["Out Delivery", "Collection Agent"] }), true);
  assert.equal(isDeliveryCollectionAgent({ ...base, role: "Delivery", active: false }), false);
  assert.equal(isDeliveryCollectionAgent({ ...base, role: "Collection Agent" }), false);
  assert.equal(isDeliveryCollectionAgent({ ...base, role: "In Delivery" }), false);
});
