import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { isValidMetaSignature, isValidWebhookChallenge, normalizeWhatsAppPhone, parseWhatsAppAction } from "../src/whatsapp-utils.js";

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
