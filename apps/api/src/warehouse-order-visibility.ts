import type { AppSnapshot } from "@aapoorti-b2b/domain";

export function isWhatsAppWarehouseUser(user?: { role: string; roles: string[] }) {
  const roles = user ? [user.role, ...user.roles] : [];
  return roles.includes("Warehouse Manager") && !roles.includes("Admin");
}

// The confirmation marker survives draft cleanup. A product's test SKU or a
// payment/packing note mentioning WhatsApp does not establish order origin.
export function whatsappWarehouseSnapshot<T extends Omit<AppSnapshot, "metrics">>(snapshot: T, draftCartIds: Set<string>): T {
  const salesOrders = snapshot.salesOrders.filter((order) =>
    draftCartIds.has(order.cartId || order.id) || /^WhatsApp confirmed order WAD-\S+(?:\s|$)/.test(order.note));
  const allowed = new Set(salesOrders.flatMap((order) => [order.id, order.cartId || order.id]));
  const hidden = new Set(snapshot.salesOrders.filter((order) => !allowed.has(order.id)).flatMap((order) => [order.id, order.cartId || order.id]));
  const dockets = snapshot.deliveryDockets.filter((docket) => allowed.has(docket.salesOrderId));
  const docketIds = new Set(dockets.map((docket) => docket.id));
  const tasks = snapshot.deliveryTasks.filter((task) => task.side !== "Sales" ||
    (task.linkedOrderIds.length > 0 && task.linkedOrderIds.every((id) => allowed.has(id))));
  const hiddenTaskIds = new Set(snapshot.deliveryTasks.filter((task) => !tasks.includes(task)).map((task) => task.id));
  return {
    ...snapshot, salesOrders,
    salesReturns: snapshot.salesReturns.filter((item) => allowed.has(item.linkedOrderLineId || item.linkedOrderId || "")),
    probationarySales: snapshot.probationarySales.filter((item) => allowed.has(item.salesOrderId)),
    payments: snapshot.payments.filter((item) => item.side !== "Sales" || allowed.has(item.linkedOrderId)),
    ledgerEntries: snapshot.ledgerEntries.filter((item) => item.side !== "Sales" || allowed.has(item.linkedOrderId)),
    deliveryTasks: tasks,
    deliveryDockets: dockets,
    deliveryConsignments: snapshot.deliveryConsignments.filter((item) => item.docketIds.length > 0 && item.docketIds.every((id) => docketIds.has(id))),
    notes: snapshot.notes.filter((item) => !hidden.has(item.entityId) && !hiddenTaskIds.has(item.entityId))
  };
}
