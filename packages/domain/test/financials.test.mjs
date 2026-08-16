import test from "node:test";
import assert from "node:assert/strict";
import { calculateSalesAmounts, calculateTaxAmounts } from "../dist/index.js";

test("inclusive GST amounts reconcile to the entered gross amount", () => {
  assert.deepEqual(calculateTaxAmounts(12, 42.5, 5, "Inclusive"), {
    taxableAmount: 485.71,
    gstAmount: 24.29,
    totalAmount: 510,
    gstRate: 5,
    taxMode: "Inclusive"
  });
});

test("CD and TOD reduce the sales line total exactly once", () => {
  assert.deepEqual(calculateSalesAmounts({
    quantity: 12,
    rate: 22.5,
    cdTodRate: 12,
    cdAmount: 63,
    todAmount: 63,
    gstRate: 5,
    taxMode: "Inclusive"
  }), {
    taxableAmount: 257.14,
    gstAmount: 12.86,
    totalAmount: 144,
    gstRate: 5,
    taxMode: "Inclusive",
    cdTodRate: 12,
    cdAmount: 63,
    todAmount: 63
  });
});

test("legacy zero CD/TOD rate without discounts is treated as no discount", () => {
  const result = calculateSalesAmounts({
    quantity: 8,
    rate: 49.5,
    cdTodRate: 0,
    cdAmount: 0,
    todAmount: 0,
    gstRate: 5,
    taxMode: "Inclusive"
  });
  assert.equal(result.cdTodRate, 49.5);
  assert.equal(result.totalAmount, 396);
});

test("zero net rate with a submitted discount is rejected", () => {
  assert.throws(() => calculateSalesAmounts({
    quantity: 8,
    rate: 49.5,
    cdTodRate: 0,
    cdAmount: 198,
    todAmount: 198,
    gstRate: 5,
    taxMode: "Inclusive"
  }), /greater than zero/);
});

test("discount amounts must agree with the entered net rate", () => {
  assert.throws(() => calculateSalesAmounts({
    quantity: 12,
    rate: 22.5,
    cdTodRate: 12,
    cdAmount: 0,
    todAmount: 0,
    gstRate: 5,
    taxMode: "Inclusive"
  }), /do not match/);
});
