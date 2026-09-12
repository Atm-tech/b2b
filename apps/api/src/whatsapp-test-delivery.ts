import type { WhatsAppTestState } from "./whatsapp-test-mode.js";
import { randomUUID } from "node:crypto";
import { collectionDenominations, testCollectionPrivileges, type PaymentPhotoReading } from "./whatsapp-collection-utils.js";

type Message = Record<string, unknown>;
type PendingCollection = { kind: "full" | "partial"; mode?: "Cash" | "UPI" | "Cheque"; stage: "mode" | "cash" | "proof" | "confirm"; counts?: number[]; amount?: number; proofId?: string; confirmationId?: string };
type TestStopProgress = { delivered?: boolean; collected?: boolean; later?: boolean; payments?: Array<{ amount: number; mode: string; proofId?: string; counts?: number[] }>; pending?: PendingCollection };
export type TestDeliveryProgress = Record<string, TestStopProgress>;
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

export function activeTestCollection(tasks: TestDeliveryTask[], progress: TestDeliveryProgress) {
  for (const task of tasks) for (const order of task.orders) {
    const key = `${task.id}~${order.id}`;
    if (progress[key]?.pending) return { task, order, key, pending: progress[key].pending! };
  }
  return undefined;
}

// Reads warehouse simulation assignments; never creates a production task,
// stock movement or payment, and never lets a test button fall through to live.
export function testDeliveryReply(tasks: TestDeliveryTask[], current: TestDeliveryProgress, message: Message, reading?: PaymentPhotoReading | null) {
  const progress = structuredClone(current);
  // Old one-tap "collected" flags had no payment details. Reopen their collection
  // practice rather than treating that shortcut as a completed payment.
  for (const stop of Object.values(progress)) if (stop.collected && !stop.payments?.length) stop.collected = false;
  const command = String((message.text as Message | undefined)?.body || "").trim().toUpperCase();
  const interactive = message.interactive as Message | undefined;
  const action = String(((interactive?.list_reply || interactive?.button_reply) as Message | undefined)?.id || "");
  const result = (response: Message) => ({ handled: true as const, response, progress });
  const cancelPending = () => { for (const stop of Object.values(progress)) delete stop.pending; };
  const pending = tasks.filter((task) => task.orders.some((order) => !progress[`${task.id}~${order.id}`]?.collected));
  if (command === "TEST LIST" || (command === "LIST" && tasks.length) || action.startsWith("wa-test-delivery:list")) {
    cancelPending();
    if (!pending.length) return result(text("Saare assigned test DCO complete hain. Real delivery tasks ke liye LIVE LIST type karein."));
    const page = Math.max(0, Number(action.split(":")[2]) || 0);
    const rows = pending.slice(page * 9, page * 9 + 9).map((task) => ({ id: `wa-test-delivery:dco:${task.id}`, title: task.label.slice(0, 24), description: `${task.orders.length} SO | ${task.orders.map((order) => order.shop).join(", ")}`.slice(0, 72) }));
    if (pending.length > page * 9 + 9) rows.push({ id: `wa-test-delivery:list:${page + 1}`, title: "Next test DCOs", description: "Aur assigned test DCO" });
    return result(list("Warehouse ne yeh test DCO aapko tag kiye hain. DCO > retailer select karein. Real tasks: LIVE LIST.", "View test DCO", rows));
  }
  const active = activeTestCollection(tasks, progress);
  if (!action.startsWith("wa-test-delivery:") && !active) return { handled: false as const, progress };
  const [, actionKind, actionTaskId, actionOrderId, extra] = action.split(":");
  const kind = actionKind || "input";
  const taskId = actionTaskId || active?.task.id;
  const orderId = actionOrderId || active?.order.id;
  const task = tasks.find((item) => item.id === taskId);
  if (!task) return result(text("Yeh test DCO ab aapko assigned nahi hai. LIST type karein."));
  if (kind === "dco") {
    cancelPending();
    const rows = task.orders.filter((order) => !progress[`${task.id}~${order.id}`]?.collected).map((order) => ({ id: `wa-test-delivery:stop:${task.id}:${order.id}`, title: order.shop.slice(0, 24), description: `${order.product} x ${order.quantity} | ${progress[`${task.id}~${order.id}`]?.delivered ? "Collection pending" : "Delivery pending"}`.slice(0, 72) }));
    return result(rows.length ? list(`${task.label}: retailer select karein. Sirf practice; real stock/payment nahi.`, "Test retailers", rows.slice(0, 10)) : text("Is test DCO ki practice complete. LIST se agla dekhein."));
  }
  const order = task.orders.find((item) => item.id === orderId);
  if (!order) return result(text("Test retailer unavailable. LIST se dobara select karein."));
  const key = `${task.id}~${order.id}`; const stop = progress[key] || {};
  const policy = order.collection || testCollectionPrivileges(order.id);
  const paid = (stop.payments || []).reduce((sum, payment) => sum + payment.amount, 0);
  const due = Math.round((policy.amountDue - paid) * 100) / 100;
  const choice = (verb: string, label: string): [string, string] => [`${verb}:${task.id}:${order.id}`, label];
  const nowLater = () => buttons(`${order.shop}\nTest bill: Rs.${policy.amountDue.toFixed(2)}\nBalance: Rs.${due.toFixed(2)}\nCollection kab karni hai?`, [choice("now", "Collect now"), ...(policy.allowLater ? [choice("later", "Collect later")] : [])]);
  const modeMenu = () => buttons(`${order.shop}: ${stop.pending?.kind === "partial" ? "Partial" : "Full"} collection\nBalance Rs.${due.toFixed(2)}\nPayment mode select karein.`, [choice("cash", "Cash"), choice("upi", "UPI"), ...(policy.allowCheque ? [choice("cheque", "Cheque")] : [])]);
  const checkAmount = (amount: number) => Number.isFinite(amount) && amount > 0 && amount <= due && (stop.pending?.kind === "partial" ? policy.allowPartial && amount < due : Math.abs(amount - due) < 0.005);
  const confirmation = (amount: number) => {
    if (!checkAmount(amount)) { delete stop.pending; progress[key] = stop; return result(buttons(`Amount Rs.${amount.toFixed(2)} balance Rs.${due.toFixed(2)} se match nahi hua. Full mein poora balance; Partial sirf privilege hone par aur balance se kam. Dobara select karein.`, [choice("now", "Collect now")])); }
    stop.pending!.amount = amount; stop.pending!.stage = "confirm"; stop.pending!.confirmationId = randomUUID(); progress[key] = stop;
    const breakdown = stop.pending!.mode === "Cash" ? `\n${collectionDenominations.map((denomination, index) => `${denomination} x ${stop.pending!.counts![index]}`).join(" | ")}\nCoins: Rs.${stop.pending!.counts![6].toFixed(2)}` : "\nAmount photo se OCR ne read kiya hai. Check karke confirm karein.";
    return result(buttons(`${order.shop}\n${stop.pending!.mode}: Rs.${amount.toFixed(2)}${breakdown}\nBaaki balance: Rs.${(due - amount).toFixed(2)}\nConfirm ke baad sirf test collection save hogi.`, [[`confirm:${task.id}:${order.id}:${stop.pending!.confirmationId}`, "Confirm collection"], choice("now", "Change payment")]));
  };
  if (kind === "delivered") { stop.delivered = true; progress[key] = stop; }
  if (stop.collected) return result(buttons(`${order.shop}: delivery aur collection practice complete. Koi real payment record nahi bana.`, [["list", "Next test retailer"]]));
  if (!stop.delivered) return result(buttons(`${task.label}\n${order.shop}\n${order.product} x ${order.quantity}\nTest bill Rs.${policy.amountDue.toFixed(2)}. Pehle delivery practice complete karein.`, [choice("delivered", "Test delivered")]));
  if (["stop", "delivered", "collected"].includes(kind)) { cancelPending(); return result(nowLater()); }
  if (kind === "later") {
    if (!policy.allowLater) return result(text("Is retailer ko Collect Later privilege nahi hai."));
    delete stop.pending; stop.later = true; progress[key] = stop;
    return result(buttons(`${order.shop}: Collect Later saved. Rs.${due.toFixed(2)} pending rahega.`, [["list", "Next retailer"]]));
  }
  if (kind === "now") { cancelPending(); stop.later = false; progress[key] = stop; return result(buttons(`${order.shop}: Rs.${due.toFixed(2)} balance.`, [choice("full", "Full"), ...(policy.allowPartial ? [choice("partial", "Partial")] : [])])); }
  if (kind === "full" || kind === "partial") {
    if (kind === "partial" && !policy.allowPartial) return result(text("Is retailer ko Partial collection privilege nahi hai."));
    cancelPending(); stop.pending = { kind, stage: "mode" }; progress[key] = stop; return result(modeMenu());
  }
  if (["cash", "upi", "cheque"].includes(kind)) {
    if (!stop.pending || (stop.pending.kind === "partial" && !policy.allowPartial)) return result(text("Pehle Collect now aur Full/Partial select karein."));
    if (kind === "cheque" && !policy.allowCheque) return result(text("Is retailer ko Cheque privilege nahi hai."));
    stop.pending = { kind: stop.pending.kind, mode: kind === "cash" ? "Cash" : kind === "upi" ? "UPI" : "Cheque", stage: kind === "cash" ? "cash" : "proof", ...(kind === "cash" ? { counts: [] } : {}) }; progress[key] = stop;
    return result(text(kind === "cash" ? "Rs.500 ke kitne notes? Sirf count bhejein, zero ho to 0. Phir 200, 100, 50, 20, 10 aur coins aayenge." : `${stop.pending.mode} ki clear photo/screenshot bhejein. OCR photo se amount read karega; phir aap confirm karenge.${kind === "cheque" ? " Cheque Aapoorti ke naam hona chahiye." : ""}`));
  }
  if (kind === "confirm") {
    const payment = stop.pending;
    if (!payment || payment.stage !== "confirm" || payment.confirmationId !== extra || !payment.mode || !checkAmount(payment.amount || 0) || (payment.mode === "Cheque" && !policy.allowCheque) || (payment.mode !== "Cash" && !payment.proofId)) return result(text("Confirmation purani/invalid hai. Collect now se dobara shuru karein."));
    stop.payments = [...(stop.payments || []), { amount: payment.amount!, mode: payment.mode, proofId: payment.proofId, counts: payment.counts }];
    stop.collected = due - payment.amount! < 0.005; delete stop.pending; progress[key] = stop;
    return result(buttons(`${order.shop}: Rs.${payment.amount!.toFixed(2)} ${payment.mode} test collection saved.\nBalance Rs.${(due - payment.amount!).toFixed(2)}.\nReal accounts mein payment nahi bana.`, [["list", "Next retailer"]]));
  }
  if (kind === "input" && stop.pending?.stage === "cash") {
    const count = Number(command); const index = stop.pending.counts!.length;
    if (!command || !Number.isFinite(count) || count < 0 || count > 10000 || (index < collectionDenominations.length && !Number.isInteger(count)) || (index === collectionDenominations.length && Math.abs(count * 100 - Math.round(count * 100)) > 0.00001)) return result(text("Valid count bhejein; coins ke liye total rupee value (maximum 2 decimals)."));
    stop.pending.counts!.push(count); progress[key] = stop;
    if (index < collectionDenominations.length) return result(text(index + 1 < collectionDenominations.length ? `Rs.${collectionDenominations[index + 1]} ke kitne notes?` : "Coins ki total rupee value bhejein, example 5.50. Coins ka count nahi."));
    const total = Math.round((stop.pending.counts!.slice(0, 6).reduce((sum, n, i) => sum + n * collectionDenominations[i], 0) + count) * 100) / 100;
    return confirmation(total);
  }
  if (kind === "input" && stop.pending?.stage === "proof") {
    const mediaId = String((message.image as Message | undefined)?.id || "");
    if (message.type !== "image" || !mediaId) return result(text("Payment ki photo/screenshot bhejein. Sirf amount type karne se photo verification complete nahi hogi."));
    if (!reading?.visible || !Number.isFinite(reading.amount) || reading.amount <= 0) return result(text("Photo se amount clearly read nahi hua. Clear/cropped payment photo dobara bhejein; amount guess nahi kiya gaya."));
    if (stop.pending.mode === "Cheque" && !/aapoorti/i.test(reading.payeeName)) return result(text("Cheque payee Aapoorti clearly read nahi hua. Clear cheque photo dobara bhejein."));
    stop.pending.proofId = mediaId;
    const response = confirmation(reading.amount);
    // The confirmation displays the actual OCR amount, never a typed substitute.
    return response;
  }
  return result(text("Collect now se payment select karein, ya LIST type karein."));
}
