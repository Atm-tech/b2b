import type { WhatsAppTestState } from "./whatsapp-test-mode.js";

type Message = Record<string, unknown>;
export type TestDeliveryProgress = Record<string, { delivered?: boolean; collected?: boolean }>;
export type TestDeliverySource = { key: string; value_json: WhatsAppTestState };
export type TestDeliveryTask = { id: string; label: string; orders: WhatsAppTestState["orders"] };

export function assignedTestDcos(sources: TestDeliverySource[], username: string): TestDeliveryTask[] {
  return sources.flatMap(({ key, value_json: state }) => (state.dcos || [])
    .filter((dco) => dco.handedOver && dco.assignedTo?.toLowerCase() === username.toLowerCase())
    .map((dco) => ({ id: `${key.split(":").at(-1)}~${dco.id}~${dco.handoverId || "legacy"}`, label: dco.id, orders: state.orders.filter((order) => dco.orderIds.includes(order.id)) })));
}

function text(body: string): Message { return { type: "text", text: { body: `*TEST DELIVERY + COLLECTION*\n${body}` } }; }
function buttons(body: string, choices: Array<[string, string]>): Message {
  return { type: "interactive", interactive: { type: "button", body: { text: `TEST DELIVERY + COLLECTION\n${body}` }, action: { buttons: choices.map(([id, title]) => ({ type: "reply", reply: { id: `wa-test-delivery:${id}`, title } })) } } };
}
function list(body: string, button: string, rows: Array<{ id: string; title: string; description: string }>): Message {
  return { type: "interactive", interactive: { type: "list", body: { text: `TEST DELIVERY + COLLECTION\n${body}` }, action: { button, sections: [{ title: "Assigned test DCOs", rows }] } } };
}

// Reads warehouse simulation assignments; never creates a production task,
// stock movement or payment, and never lets a test button fall through to live.
export function testDeliveryReply(tasks: TestDeliveryTask[], current: TestDeliveryProgress, message: Message) {
  const progress = structuredClone(current);
  const command = String((message.text as Message | undefined)?.body || "").trim().toUpperCase();
  const interactive = message.interactive as Message | undefined;
  const action = String(((interactive?.list_reply || interactive?.button_reply) as Message | undefined)?.id || "");
  const result = (response: Message) => ({ handled: true as const, response, progress });
  const pending = tasks.filter((task) => task.orders.some((order) => !progress[`${task.id}~${order.id}`]?.collected));
  if (command === "TEST LIST" || (command === "LIST" && tasks.length) || action.startsWith("wa-test-delivery:list")) {
    if (!pending.length) return result(text("Saare assigned test DCO complete hain. Real delivery tasks ke liye LIVE LIST type karein."));
    const page = Math.max(0, Number(action.split(":")[2]) || 0);
    const rows = pending.slice(page * 9, page * 9 + 9).map((task) => ({ id: `wa-test-delivery:dco:${task.id}`, title: task.label.slice(0, 24), description: `${task.orders.length} SO | ${task.orders.map((order) => order.shop).join(", ")}`.slice(0, 72) }));
    if (pending.length > page * 9 + 9) rows.push({ id: `wa-test-delivery:list:${page + 1}`, title: "Next test DCOs", description: "Aur assigned test DCO" });
    return result(list("Warehouse ne yeh test DCO aapko tag kiye hain. DCO > retailer select karein. Real tasks: LIVE LIST.", "View test DCO", rows));
  }
  if (!action.startsWith("wa-test-delivery:")) return { handled: false as const, progress };
  const [, kind, taskId, orderId] = action.split(":");
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return result(text("Yeh test DCO ab aapko assigned nahi hai. LIST type karein."));
  if (kind === "dco") {
    const rows = task.orders.filter((order) => !progress[`${task.id}~${order.id}`]?.collected).map((order) => ({ id: `wa-test-delivery:stop:${task.id}:${order.id}`, title: order.shop.slice(0, 24), description: `${order.product} x ${order.quantity} | ${progress[`${task.id}~${order.id}`]?.delivered ? "Collection pending" : "Delivery pending"}`.slice(0, 72) }));
    return result(rows.length ? list(`${task.label}: retailer select karein. Sirf practice; real stock/payment nahi.`, "Test retailers", rows.slice(0, 10)) : text("Is test DCO ki practice complete. LIST se agla dekhein."));
  }
  const order = task.orders.find((item) => item.id === orderId);
  if (!order) return result(text("Test retailer unavailable. LIST se dobara select karein."));
  const key = `${task.id}~${order.id}`; const stop = progress[key] || {};
  if (kind === "delivered") { stop.delivered = true; progress[key] = stop; }
  if (kind === "collected") {
    if (!stop.delivered) return result(text("Pehle test delivery complete karein."));
    stop.collected = true; progress[key] = stop;
  }
  if (stop.collected) return result(buttons(`${order.shop}: delivery aur collection practice complete. Koi real payment record nahi bana.`, [["list", "Next test retailer"]]));
  return result(buttons(`${task.label}\n${order.shop}\n${order.product} x ${order.quantity}\n${stop.delivered ? "Delivery practice done. Ab collection practice." : "Delivery practice. Photo/weight/payment verification is simulation mein nahi hota."}`, [[`${stop.delivered ? "collected" : "delivered"}:${task.id}:${order.id}`, stop.delivered ? "Test collected" : "Test delivered"]]));
}
