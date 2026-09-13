import assert from "node:assert/strict";
import test from "node:test";
import { paymentOcrAmount } from "../src/whatsapp-collection-utils.js";

test("payment OCR never chooses an unrelated number simply because it matches the bill", () => {
  assert.equal(paymentOcrAmount("UPI reference 123456789012 date 12/09/2026 Amount paid Rs. 1,500.00"), 1500);
  assert.equal(paymentOcrAmount("Reference 1000 Date 12/09/2026"), null);
  assert.equal(paymentOcrAmount("Amount Rs 500 Balance Rs 1500"), null);
  assert.equal(paymentOcrAmount("Cheque Aapoorti INR 750.50"), 750.5);
});
