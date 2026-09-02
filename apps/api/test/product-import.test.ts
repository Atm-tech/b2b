import assert from "node:assert/strict";
import test from "node:test";
import { deriveRetailTaxonomy } from "../src/product-import.js";

test("taxonomy ignores contaminated legacy category labels", () => {
  const result = deriveRetailTaxonomy({
    name: "HIMALAYA COMPLETE CARE TOOTHPASTE 150G",
    division: "Staples & Cooking",
    department: "Sugar & Sweeteners",
    section: "Sugar",
    category: "Edible Oils",
    subCategory: "Powder"
  });
  assert.deepEqual(result, {
    division: "Personal Care",
    department: "Oral Care",
    section: "Toothpaste & Powder",
    category: "Oral Care",
    subCategory: "Toothpaste"
  });
});

test("taxonomy keeps refill packs in their real product family", () => {
  assert.equal(deriveRetailTaxonomy({ name: "AMUL COW GHEE REFILL 500ML" }).department, "Ghee & Cooking Fats");
  assert.equal(deriveRetailTaxonomy({ name: "ALL OUT ULTRA REFILL 45ML" }).department, "Pest Control");
});

test("taxonomy recognizes stationery and ground spices", () => {
  assert.equal(deriveRetailTaxonomy({ name: "KANGARO STAPLER" }).division, "Stationery");
  assert.equal(deriveRetailTaxonomy({ name: "HALDI POWDER 100GM" }).department, "Spices & Masala");
});
