import assert from "node:assert/strict";
import test from "node:test";
import { whatsappCatalogBoxPacks } from "../src/whatsapp-catalog-box-packs.js";

test("imports BOX PACK separately from MOQ and preserves the blank pack", () => {
  assert.equal(whatsappCatalogBoxPacks.length, 169);
  const packs = new Map<string, number | null>(whatsappCatalogBoxPacks.map(item => [item.articleName, item.piecesPerBox]));
  assert.equal(packs.size, 169);
  assert.equal(packs.get("ALLOUT ULTRA REFILL 45ML"), 240);
  assert.equal(packs.get("CADBURY DAIRY MILK 6G"), 1728);
  assert.equal(packs.get("CADBURY FUSE TOFF 25GM"), null);
  assert.equal(packs.get("AMUL MASTI CHACH 180ML"), 30);
  assert.equal(packs.has("AMUL MASTI CHACH 100ML"), false);
  for (const { piecesPerBox } of whatsappCatalogBoxPacks) {
    assert.ok(piecesPerBox === null || (Number.isInteger(piecesPerBox) && piecesPerBox > 0));
  }
});
