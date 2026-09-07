import assert from "node:assert/strict";
import test from "node:test";
import { whatsappCatalogMinimums, whatsappCatalogProductAliases } from "../src/whatsapp-catalog-minimums.js";

test("keeps every supplied catalogue MOQ valid and unique", () => {
  assert.equal(whatsappCatalogMinimums.length, 169);
  const names = whatsappCatalogMinimums.map((item) => item.articleName);
  assert.equal(new Set(names).size, names.length);
  for (const item of whatsappCatalogMinimums) {
    assert.ok(item.articleName.trim().length > 0);
    assert.ok(Number.isFinite(item.minimumOrderQuantity));
    assert.ok(item.minimumOrderQuantity >= 1);
  }
});

test("catalogue aliases only refer to supplied workbook articles", () => {
  const names = new Set(whatsappCatalogMinimums.map((item) => item.articleName));
  for (const [articleName, productSku] of Object.entries(whatsappCatalogProductAliases)) {
    assert.ok(names.has(articleName), `Unknown workbook article alias: ${articleName}`);
    assert.ok(productSku.trim().length > 0);
  }
});
