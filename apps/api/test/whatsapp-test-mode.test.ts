import assert from "node:assert/strict";
import test from "node:test";
import { createWhatsAppTestState, handleWhatsAppTestMessage } from "../src/whatsapp-test-mode.js";

const text = (body: string) => ({ type: "text", text: { body } });
const action = (id: string) => ({ type: "interactive", interactive: { button_reply: { id } } });

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

test("test handover, reset and explicit exit confirmation stay within the simulator", () => {
  let state = createWhatsAppTestState();
  assert.equal(handleWhatsAppTestMessage(state, action("wa-test:handover")).state?.handedOver, undefined);
  state.orders[0].packed = true;
  state = handleWhatsAppTestMessage(state, action("wa-test:handover")).state!;
  assert.equal(state.handedOver, true);
  assert.deepEqual(handleWhatsAppTestMessage(state, text("TEST RESET")).state, createWhatsAppTestState());
  assert.ok(handleWhatsAppTestMessage(state, text("TEST EXIT")).state);
  assert.equal(handleWhatsAppTestMessage(state, action("wa-test:exit")).state, undefined);
});
