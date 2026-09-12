import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { discountPercentFromMrp, isValidMetaSignature, isValidWebhookChallenge, normalizeWhatsAppPhone, parseWhatsAppAction, prepareWhatsAppListMessage, scoreWhatsAppProductQuery } from "../src/whatsapp-utils.js";

test("prevents Meta section-title rejection for SO, delivery and supplier menus without changing actions", () => {
  const titles = ["Dispatch-ready sales orders", "Delivery / pending collection", "A VERY LONG SUPPLIER BUSINESS NAME", "Ready for DCO"];
  const rows = [{ id: "wa-so:order:SCART-1789195005-792", title: "SO 05-792", description: "Order for packing" }];
  const message = { type: "interactive", interactive: { type: "list", body: { text: "Select an order" }, action: { button: "View SO", sections: titles.map((title) => ({ title, rows })) } } };
  const result = prepareWhatsAppListMessage(message) as typeof message;
  assert.deepEqual(result.interactive.action.sections.map((section) => section.title), ["Dispatch-ready sales ord", "Delivery / pending colle", "A VERY LONG SUPPLIER BUS", "Ready for DCO"]);
  assert.deepEqual(result.interactive.body, message.interactive.body);
  assert.equal(result.interactive.action.button, "View SO");
  for (const section of result.interactive.action.sections) assert.deepEqual(section.rows, rows);
  assert.deepEqual(message.interactive.action.sections.map((section) => section.title), titles);
});

test("leaves non-list messages and optional section titles unchanged", () => {
  for (const message of [{ type: "text", text: { body: "SO" } }, { type: "interactive", interactive: { type: "button", action: { buttons: [] } } }]) {
    assert.equal(prepareWhatsAppListMessage(message), message);
  }
  const message = { type: "interactive", interactive: { type: "list", action: { sections: [{ rows: [{ id: "1", title: "Order" }] }] } } };
  assert.deepEqual(prepareWhatsAppListMessage(message), message);
});

test("normalizes Indian local and international WhatsApp numbers", () => {
  assert.equal(normalizeWhatsAppPhone("98765 43210"), "919876543210");
  assert.equal(normalizeWhatsAppPhone("+91-98765-43210"), "919876543210");
  assert.equal(normalizeWhatsAppPhone("0091 98765 43210"), "919876543210");
});

test("rejects an invalid WhatsApp number", () => {
  assert.throws(() => normalizeWhatsAppPhone("123"), /valid WhatsApp number/);
});

test("validates the Meta webhook challenge token", () => {
  assert.equal(isValidWebhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "secret" }, "secret"), true);
  assert.equal(isValidWebhookChallenge({ "hub.mode": "subscribe", "hub.verify_token": "wrong" }, "secret"), false);
});

test("validates webhook HMAC signatures without leaking the secret", () => {
  const body = Buffer.from('{"entry":[]}');
  const secret = "app-secret";
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal(isValidMetaSignature(body, `sha256=${signature}`, secret), true);
  assert.equal(isValidMetaSignature(Buffer.from("tampered"), `sha256=${signature}`, secret), false);
});

test("parses only supported interactive action identifiers", () => {
  assert.deepEqual(parseWhatsAppAction("wa-confirm:WAD-123"), { action: "confirm", entityId: "WAD-123" });
  assert.equal(parseWhatsAppAction("delete-everything"), null);
});

test("matches WhatsApp product searches without spaces and across common misspellings", () => {
  assert.ok(scoreWhatsAppProductQuery("itc", ["I T C Sunfeast Biscuit"]) >= 800);
  assert.ok(scoreWhatsAppProductQuery("magi", ["MAGGI 2-Minute Noodles"]) >= 800);
  assert.ok(scoreWhatsAppProductQuery("gudday", ["Britannia Good Day Biscuit"]) >= 800);
  assert.ok(scoreWhatsAppProductQuery("colget", ["Colgate Strong Teeth"]) >= 600);
  assert.ok(scoreWhatsAppProductQuery("coke", ["COCA COLA 250ML"]) >= 800);
  assert.equal(scoreWhatsAppProductQuery("coke", ["GHADI DETERGENT CAKE 80G"]), 0);
  assert.equal(scoreWhatsAppProductQuery("coke", ["BRITANNIA GOOD DAY COOKIE"]), 0);
  assert.equal(scoreWhatsAppProductQuery("coke", ["AMUL MILK CHOCOLATE 150GM"]), 0);
  assert.equal(scoreWhatsAppProductQuery("unrelated item", ["Maggi Noodles"]), 0);
});

test("calculates honest MRP discounts and rejects missing or invalid MRP", () => {
  assert.equal(discountPercentFromMrp(100, 82.5), 17.5);
  assert.equal(discountPercentFromMrp(0, 9), 0);
  assert.equal(discountPercentFromMrp(100, 110), 0);
});
