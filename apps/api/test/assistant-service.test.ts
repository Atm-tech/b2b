import assert from "node:assert/strict";
import test from "node:test";
import type { AppSnapshot, AppUser, ProductMaster } from "@aapoorti-b2b/domain";
import { runAssistant } from "../src/assistant-service.js";
import { classifyOfflineIntent, expandProductAlias } from "../src/assistant-language-data.js";

const product = (sku: string, name: string, category: string, rsp: number): ProductMaster => ({
  sku, name, division: category, department: category, section: category, category, subCategory: "", unit: "PCS",
  defaultGstRate: 5, defaultTaxMode: "Exclusive", defaultWeightKg: 0.1, toleranceKg: 0, tolerancePercent: 0,
  allowedWarehouseIds: ["W1"], slabs: [{ minQuantity: 1, purchaseRate: rsp }], rsp, mrp: rsp * 1.25,
  createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z"
});

const snapshot = {
  products: [product("LUX-100", "Lux Soap 100GM", "Soap", 40), product("DOVE-100", "Dove Soap 100GM", "Soap", 60), product("RICE-1", "Rice 1KG", "Staples", 50)],
  counterparties: [
    { id: "SHOP-1", type: "Shop", name: "Gupta Store", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "9999999999", address: "Market", city: "Bhopal", deliveryAddress: "Market", deliveryCity: "Bhopal", contactPerson: "Gupta", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "SUP-1", type: "Supplier", name: "Metro Supplier", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "8888888888", address: "Yard", city: "Bhopal", deliveryAddress: "Yard", deliveryCity: "Bhopal", contactPerson: "Metro", createdBy: "test", createdAt: "2026-01-01T00:00:00.000Z" }
  ],
  warehouses: [{ id: "W1", name: "Main Warehouse", city: "Bhopal", address: "Industrial Area", type: "Warehouse", createdAt: "2026-01-01T00:00:00.000Z" }],
  settings: { paymentMethods: [{ code: "NEFT", label: "NEFT", active: true, allowsCashTiming: false }], deliveryCharge: { model: "Fixed", amount: 0 } },
  purchaseOrders: [
    { id: "PO-1", supplierId: "SUP-1", supplierName: "Metro Supplier", productSku: "LUX-100", purchaserId: 1, purchaserName: "Buyer", warehouseId: "W1", quantityOrdered: 100, quantityReceived: 100, rate: 40, taxableAmount: 4000, gstRate: 5, gstAmount: 200, taxMode: "Exclusive", totalAmount: 4200, expectedWeightKg: 10, deliveryMode: "Dealer Delivery", paymentMode: "NEFT", note: "", status: "Received", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "PO-2", supplierId: "SUP-1", supplierName: "Metro Supplier", productSku: "DOVE-100", purchaserId: 1, purchaserName: "Buyer", warehouseId: "W1", quantityOrdered: 100, quantityReceived: 100, rate: 60, taxableAmount: 6000, gstRate: 5, gstAmount: 300, taxMode: "Exclusive", totalAmount: 6300, expectedWeightKg: 10, deliveryMode: "Dealer Delivery", paymentMode: "NEFT", note: "", status: "Received", createdAt: "2026-01-01T00:00:00.000Z" }
  ],
  salesOrders: [
    { id: "SO-1", shopId: "SHOP-1", shopName: "Gupta Store", billingType: "B2C", productSku: "LUX-100", salesmanId: 2, salesmanName: "Seller", warehouseId: "W1", quantity: 10, rate: 60, cdTodRate: 60, cdAmount: 0, todAmount: 0, taxableAmount: 600, gstRate: 5, gstAmount: 30, taxMode: "Exclusive", totalAmount: 630, paymentMode: "NEFT", deliveryMode: "Delivery", deliveryCharge: 0, note: "", status: "Booked", createdAt: "2026-02-01T00:00:00.000Z" },
    { id: "SO-2", shopId: "SHOP-1", shopName: "Gupta Store", billingType: "B2C", productSku: "DOVE-100", salesmanId: 2, salesmanName: "Seller", warehouseId: "W1", quantity: 5, rate: 75, cdTodRate: 75, cdAmount: 0, todAmount: 0, taxableAmount: 375, gstRate: 5, gstAmount: 18.75, taxMode: "Exclusive", totalAmount: 393.75, paymentMode: "NEFT", deliveryMode: "Delivery", deliveryCharge: 0, note: "", status: "Booked", createdAt: "2026-02-01T00:00:00.000Z" }
  ],
  stockSummary: [
    { warehouseId: "W1", warehouseName: "Main Warehouse", productSku: "LUX-100", productName: "Lux Soap 100GM", availableQuantity: 90, reservedQuantity: 0, blockedQuantity: 0 },
    { warehouseId: "W1", warehouseName: "Main Warehouse", productSku: "DOVE-100", productName: "Dove Soap 100GM", availableQuantity: 95, reservedQuantity: 0, blockedQuantity: 0 }
  ],
  users: [], purchaseReturns: [], salesReturns: [], probationarySales: [], payments: [], receiptChecks: [], inventoryLots: [], ledgerEntries: [], deliveryTasks: [], deliveryDockets: [], deliveryConsignments: [], goodsWarrants: [], notes: [],
  metrics: { totalPurchaseValue: 0, totalSalesValue: 0, pendingPurchasePayments: 0, pendingSalesPayments: 0, availableInventoryUnits: 0, openPurchaseOrders: 0, openSalesOrders: 0, liveDeliveryTasks: 0 }
} as unknown as AppSnapshot;

const salesUser = { id: 2, username: "sales", fullName: "Sales User", mobileNumber: "", role: "Sales", roles: ["Sales"], warehouseIds: [], active: true, createdAt: "2026-01-01T00:00:00.000Z" } as AppUser;
const purchaseUser = { ...salesUser, id: 3, username: "buyer", fullName: "Purchase User", role: "Purchaser", roles: ["Purchaser"] } as AppUser;

test("classifies the bundled English and Hinglish dataset without an external AI", () => {
  const cases = [
    ["widest margin items", "highest_margin"],
    ["chhote margin ka maal", "lowest_margin"],
    ["fast moving products", "highest_sales"],
    ["slow sale items batao", "lowest_sales"],
    ["grahak ka order taiyar karo", "sales_order"],
    ["vendor ko order do", "purchase_order"]
  ] as const;
  cases.forEach(([query, intent]) => assert.equal(classifyOfflineIntent(query).intent, intent, query));
  assert.equal(expandProductAlias("sabun"), "soap");
  assert.equal(expandProductAlias("atta"), "flour");
  assert.equal(expandProductAlias("Lux sabun"), "lux soap");
  assert.equal(expandProductAlias("lakh soap aur dow shampoo"), "lux soap aur dove shampoo");
  assert.equal(expandProductAlias("kook dow"), "dove");
});

test("answers a filtered highest-margin question", async () => {
  const result = await runAssistant("Show soaps with highest margin", snapshot, salesUser);
  assert.equal(result.kind, "answer");
  assert.equal(result.analytics?.rows[0]?.sku, "LUX-100");
  assert.equal(result.analytics?.rows[0]?.marginAmount, 20);
});

test("a named brand takes priority over its generic product category", async () => {
  const result = await runAssistant("Lux sabun me sabse jyada margin", snapshot, salesUser, "hinglish");
  assert.equal(result.analytics?.rows[0]?.sku, "LUX-100");
  assert.equal(result.analytics?.filter, "lux soap");
});

test("understands common voice and typing mistakes in margin questions", async () => {
  const result = await runAssistant("show soaps with higest margen", snapshot, salesUser);
  assert.equal(result.kind, "answer");
  assert.equal(result.analytics?.metric, "highest_margin");
  assert.equal(result.analytics?.rows[0]?.sku, "LUX-100");
});

test("understands Roman-script Hinglish analytics and returns a Hinglish answer", async () => {
  const result = await runAssistant("sabse zyada margin wale sabun dikhao", snapshot, salesUser, "hinglish");
  assert.equal(result.analytics?.metric, "highest_margin");
  assert.equal(result.analytics?.rows[0]?.sku, "LUX-100");
  assert.match(result.message, /sabse zyada margin/i);
  assert.match(result.spokenMessage || "", /सबसे ज़्यादा मार्जिन/);
});

test("understands conversational Hinglish margin and sales expressions", async () => {
  const cases: Array<[string, string]> = [
    ["bade margin wale product", "highest_margin"],
    ["kis product mein jyada fayda hai", "highest_margin"],
    ["best profit wala maal batao", "highest_margin"],
    ["kam munafa wale products dikhao", "lowest_margin"],
    ["sabse jyada bikne wala product", "highest_sales"],
    ["kam bikne wale items batao", "lowest_sales"]
  ];
  for (const [query, metric] of cases) {
    const result = await runAssistant(query, snapshot, salesUser, "hinglish");
    assert.equal(result.analytics?.metric, metric, query);
    assert.ok((result.analytics?.rows.length || 0) > 0, query);
  }
});

test("understands Devanagari Hindi analytics", async () => {
  const result = await runAssistant("सबसे ज्यादा मार्जिन वाले साबुन दिखाओ", snapshot, salesUser, "hinglish");
  assert.equal(result.analytics?.metric, "highest_margin");
  assert.equal(result.analytics?.rows[0]?.sku, "LUX-100");
});

test("creates an editable SO draft with matched customer and product", async () => {
  const result = await runAssistant("Create SO for Gupta Store: 10 Lux Soap at rate 55", snapshot, salesUser);
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.side, "Sales");
  assert.equal(result.draft?.partyCandidates[0]?.id, "SHOP-1");
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "LUX-100", JSON.stringify(result.draft?.lines[0]));
  assert.equal(result.draft?.lines[0]?.quantity, 10);
  assert.equal(result.draft?.lines[0]?.rate, 55);
});

test("creates an SO draft from a Roman-script Hinglish request", async () => {
  const result = await runAssistant("Gupta Store ke liye SO banao: 10 Lux Soap rate 55", snapshot, salesUser, "hinglish");
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.partyCandidates[0]?.id, "SHOP-1");
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "LUX-100");
  assert.equal(result.draft?.lines[0]?.quantity, 10);
});

test("combines multiple conversational turns into one SO thread", async () => {
  const result = await runAssistant("sales order, Gupta Store ke liye SO, 10 Lux Soap rate 55", snapshot, salesUser, "hinglish");
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.side, "Sales");
  assert.equal(result.draft?.partyCandidates[0]?.id, "SHOP-1");
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "LUX-100");
  assert.equal(result.draft?.lines[0]?.quantity, 10);
});

test("creates separate lines for multiple Hinglish products and fixes voice pronunciation", async () => {
  const result = await runAssistant("Gupta Store ke liye SO banao: 10 lakh soap rate 55 aur 5 dow shampoo rate 70", snapshot, salesUser, "hinglish");
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.lines.length, 2);
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "LUX-100");
  assert.equal(result.draft?.lines[0]?.quantity, 10);
  assert.equal(result.draft?.lines[1]?.candidates[0]?.id, "DOVE-100");
  assert.equal(result.draft?.lines[1]?.quantity, 5);
});

test("accepts party first and flexible quantity/rate word order", async () => {
  const cases: Array<[string, number, number]> = [
    ["Gupta Store ke liye order bana 10 ke rate se 50 Dove", 50, 10],
    ["Gupta Store ke liye order bana 10 Dove 50 ke rate se", 10, 50],
    ["Gupta Store ke liye order bana Dove 50 qty aur 10 ka rate", 50, 10]
  ];
  for (const [query, quantity, rate] of cases) {
    const result = await runAssistant(query, snapshot, salesUser, "hinglish");
    assert.equal(result.kind, "order_draft", query);
    assert.equal(result.draft?.partyCandidates[0]?.id, "SHOP-1", query);
    assert.equal(result.draft?.lines.length, 1, query);
    assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "DOVE-100", query);
    assert.equal(result.draft?.lines[0]?.quantity, quantity, query);
    assert.equal(result.draft?.lines[0]?.rate, rate, query);
  }
});

test("parses Chrome Hindi phonetics and repeated rate-first products without aur", async () => {
  const result = await runAssistant("Gupta Store के लिए एक सेल्स ऑर्डर बना 50 के rate से 10 डव 15 के rate से 10 लाख साबुन", snapshot, salesUser, "hinglish");
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.partyCandidates[0]?.id, "SHOP-1");
  assert.equal(result.draft?.lines.length, 2);
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "DOVE-100");
  assert.equal(result.draft?.lines[0]?.quantity, 10);
  assert.equal(result.draft?.lines[0]?.rate, 50);
  assert.equal(result.draft?.lines[1]?.candidates[0]?.id, "LUX-100");
  assert.equal(result.draft?.lines[1]?.quantity, 10);
  assert.equal(result.draft?.lines[1]?.rate, 15);
});

test("treats spoken SO/PO aliases as sales and purchase orders", async () => {
  const sales = await runAssistant("sale order for Gupta Store: 10 Lux Soap rate 55", snapshot, salesUser);
  const purchase = await runAssistant("supplier order from Metro Supplier: 20 Dove Soap rate 58", snapshot, purchaseUser);
  const hindiSales = await runAssistant("Gupta Store के लिए सेल्स ऑर्डर बनाओ: दस Lux साबुन rate 55", snapshot, salesUser, "hinglish");
  assert.equal(sales.draft?.side, "Sales");
  assert.equal(purchase.draft?.side, "Purchase");
  assert.equal(hindiSales.draft?.side, "Sales");
  assert.equal(hindiSales.draft?.partyCandidates[0]?.id, "SHOP-1");
  assert.equal(hindiSales.draft?.lines[0]?.quantity, 10);
  assert.equal(hindiSales.draft?.lines[0]?.candidates[0]?.id, "LUX-100");
});

test("creates an editable PO draft with matched supplier and product", async () => {
  const result = await runAssistant("Create PO from Metro Supplier: 20 Dove Soap at rate 58", snapshot, purchaseUser);
  assert.equal(result.kind, "order_draft");
  assert.equal(result.draft?.side, "Purchase");
  assert.equal(result.draft?.partyCandidates[0]?.id, "SUP-1");
  assert.equal(result.draft?.lines[0]?.candidates[0]?.id, "DOVE-100", JSON.stringify(result.draft?.lines[0]));
  assert.equal(result.draft?.lines[0]?.quantity, 20);
  assert.equal(result.draft?.lines[0]?.rate, 58);
});
