import assert from "node:assert/strict";
import test from "node:test";
import type { AppSnapshot } from "@aapoorti-b2b/domain";
import { isWhatsAppWarehouseUser, whatsappWarehouseSnapshot } from "../src/warehouse-order-visibility.js";

test("warehouse visibility uses order origin, not product SKU or payment channel", () => {
  const snapshot = {
    salesOrders: [
      { id: "confirmed", cartId: "cart1", note: "WhatsApp confirmed order WAD-123" },
      { id: "linked", cartId: "cart2", note: "Edited note" },
      { id: "manual", cartId: "cart3", note: "WhatsApp payment received", productSku: "WA-TEST-SOAP-12" }
    ],
    deliveryDockets: [{ id: "d1", salesOrderId: "confirmed" }, { id: "d2", salesOrderId: "manual" }],
    deliveryConsignments: [{ id: "ok", docketIds: ["d1"] }, { id: "mixed", docketIds: ["d1", "d2"] }],
    deliveryTasks: [{ id: "ok", side: "Sales", linkedOrderIds: ["cart1"] }, { id: "mixed", side: "Sales", linkedOrderIds: ["cart1", "cart3"] }, { id: "purchase", side: "Purchase", linkedOrderIds: ["PO1"] }],
    payments: [{ side: "Sales", linkedOrderId: "cart3" }, { side: "Purchase", linkedOrderId: "PO1" }],
    ledgerEntries: [{ side: "Sales", linkedOrderId: "cart3" }],
    salesReturns: [{ linkedOrderId: "cart3" }], probationarySales: [{ salesOrderId: "manual" }],
    notes: [{ entityId: "cart3" }, { entityId: "mixed" }, { entityId: "cart1" }]
  } as unknown as Omit<AppSnapshot, "metrics">;
  const visible = whatsappWarehouseSnapshot(snapshot, new Set(["cart2"]));
  assert.deepEqual(visible.salesOrders.map((o) => o.id), ["confirmed", "linked"]);
  assert.deepEqual(visible.deliveryTasks.map((o) => o.id), ["ok", "purchase"]);
  assert.deepEqual(visible.deliveryConsignments.map((o) => o.id), ["ok"]);
  assert.equal(visible.deliveryDockets.length, 1);
  assert.equal(visible.payments.length, 1);
  assert.equal(visible.ledgerEntries.length, 0);
  assert.equal(visible.salesReturns.length, 0);
  assert.equal(visible.probationarySales.length, 0);
  assert.deepEqual(visible.notes.map((n) => n.entityId), ["cart1"]);
  assert.equal(snapshot.salesOrders.length, 3);
});

test("applies to warehouse accounts, including legacy roles, while preserving admin access", () => {
  assert.equal(isWhatsAppWarehouseUser({ role: "Warehouse Manager", roles: [] }), true);
  assert.equal(isWhatsAppWarehouseUser({ role: "Sales", roles: ["Warehouse Manager"] }), true);
  assert.equal(isWhatsAppWarehouseUser({ role: "Admin", roles: ["Warehouse Manager"] }), false);
  assert.equal(isWhatsAppWarehouseUser({ role: "Sales", roles: ["Sales"] }), false);
  assert.equal(isWhatsAppWarehouseUser(), false);
});
