import { randomUUID } from "node:crypto";
import type { AppUser, GstRate, PaymentMode, ProductMaster, TaxMode } from "@aapoorti-b2b/domain";
import { calculateSalesAmounts } from "@aapoorti-b2b/domain";
import { createSalesCart, executeDatabaseQuery, getSnapshot } from "./db.js";
import { runAssistant } from "./assistant-service.js";
import { isValidMetaSignature, isValidWebhookChallenge, normalizeWhatsAppPhone } from "./whatsapp-utils.js";

type JsonObject = Record<string, unknown>;
type StaffUser = Pick<AppUser, "id" | "username" | "fullName" | "role" | "roles">;
type RetailerProfile = {
  counterpartyId: string;
  retailerName: string;
  phoneE164: string;
  salesmanId: number;
  salesmanName: string;
  defaultWarehouseId: string;
  billingType: "B2B" | "B2C";
  paymentMode: PaymentMode;
  cashTiming?: string;
  deliveryMode: "Delivery" | "Self Collection";
  optedInAt?: string;
  active: boolean;
};
type DraftLineInput = {
  productSku: string;
  quantity: number;
  rate: number;
  cdPercent?: number;
  todPercent?: number;
  gstRate?: GstRate;
  taxMode?: TaxMode;
  note?: string;
};

const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v23.0";
const graphBase = `https://graph.facebook.com/${graphVersion}`;

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function configured() {
  return Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function recordMessage(input: {
  waMessageId?: string;
  direction: "Inbound" | "Outbound";
  phone: string;
  type: string;
  contextMessageId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  status?: string;
  payload?: unknown;
  errorMessage?: string;
}) {
  const result = await executeDatabaseQuery<{ id: string }>(
    `INSERT INTO whatsapp_messages (
       id, wa_message_id, direction, phone_e164, message_type, context_message_id,
       related_entity_type, related_entity_id, status, payload_json, error_message, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,NOW())
     ON CONFLICT (wa_message_id) DO NOTHING
     RETURNING id`,
    [
      id("WAM"), input.waMessageId || null, input.direction, input.phone, input.type,
      input.contextMessageId || null, input.relatedEntityType || null, input.relatedEntityId || null,
      input.status || "Received", JSON.stringify(input.payload || {}), input.errorMessage || null
    ]
  );
  return result.rows[0]?.id || "";
}

async function updateMessageStatus(waMessageId: string, status: string, errorMessage = "") {
  if (!waMessageId) return;
  await executeDatabaseQuery(
    `UPDATE whatsapp_messages SET status = $2, error_message = NULLIF($3, '') WHERE wa_message_id = $1`,
    [waMessageId, status, errorMessage]
  );
}

async function sendGraphMessage(phoneValue: string, message: JsonObject, relatedEntityType?: string, relatedEntityId?: string) {
  const phone = normalizeWhatsAppPhone(phoneValue);
  const localMessageId = `simulated-${randomUUID()}`;
  if (!configured()) {
    await recordMessage({
      waMessageId: localMessageId,
      direction: "Outbound",
      phone,
      type: text(message.type) || "text",
      relatedEntityType,
      relatedEntityId,
      status: "Simulated",
      payload: message
    });
    return { messageId: localMessageId, simulated: true };
  }

  const response = await fetch(`${graphBase}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: phone, ...message })
  });
  const body = await response.json() as { messages?: Array<{ id?: string }>; error?: { message?: string } };
  const messageId = body.messages?.[0]?.id || localMessageId;
  await recordMessage({
    waMessageId: messageId,
    direction: "Outbound",
    phone,
    type: text(message.type) || "text",
    relatedEntityType,
    relatedEntityId,
    status: response.ok ? "Sent" : "Failed",
    payload: { request: message, response: body },
    errorMessage: response.ok ? "" : text(body.error?.message) || `Meta returned HTTP ${response.status}`
  });
  if (!response.ok) throw new Error(text(body.error?.message) || `WhatsApp send failed (${response.status}).`);
  return { messageId, simulated: false };
}

async function sendText(phone: string, body: string, relatedEntityType?: string, relatedEntityId?: string) {
  return sendGraphMessage(phone, { type: "text", text: { preview_url: false, body } }, relatedEntityType, relatedEntityId);
}

async function sendButtons(phone: string, body: string, buttons: Array<{ id: string; title: string }>, relatedEntityType?: string, relatedEntityId?: string) {
  return sendGraphMessage(phone, {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body.slice(0, 1024) },
      action: { buttons: buttons.slice(0, 3).map((button) => ({ type: "reply", reply: { id: button.id, title: button.title.slice(0, 20) } })) }
    }
  }, relatedEntityType, relatedEntityId);
}

async function sendCatalog(phone: string) {
  if (!process.env.WHATSAPP_CATALOG_ID) {
    return sendText(phone, "Catalogue setup is in progress. For now, type item name and quantity, for example: Lux 100g 24 pcs.");
  }
  return sendGraphMessage(phone, {
    type: "interactive",
    interactive: {
      type: "catalog_message",
      body: { text: "Aapoorti Wholesale catalogue kholiye, items select kijiye aur cart WhatsApp par bhej dijiye." },
      action: { name: "catalog_message" },
      footer: { text: "Special retailer rates are applied during sales review." }
    }
  });
}

async function sendTemplate(phone: string, name: string, parameters: string[], relatedEntityType?: string, relatedEntityId?: string) {
  return sendGraphMessage(phone, {
    type: "template",
    template: {
      name,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
      components: [{ type: "body", parameters: parameters.map((parameter) => ({ type: "text", text: parameter.slice(0, 1024) })) }]
    }
  }, relatedEntityType, relatedEntityId);
}

async function getRetailerByPhone(phoneValue: string) {
  const phone = normalizeWhatsAppPhone(phoneValue);
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name
     FROM whatsapp_retailers wr
     JOIN counterparties c ON c.id = wr.counterparty_id AND c.type = 'Shop'
     JOIN users u ON u.id = wr.salesman_id
     WHERE wr.phone_e164 = $1 AND wr.active = TRUE`,
    [phone]
  );
  return result.rows[0] ? mapRetailer(result.rows[0]) : null;
}

function mapRetailer(row: Record<string, unknown>): RetailerProfile {
  return {
    counterpartyId: text(row.counterparty_id),
    retailerName: text(row.retailer_name),
    phoneE164: text(row.phone_e164),
    salesmanId: numberValue(row.salesman_id),
    salesmanName: text(row.salesman_name),
    defaultWarehouseId: text(row.default_warehouse_id),
    billingType: text(row.billing_type) === "B2C" ? "B2C" : "B2B",
    paymentMode: text(row.payment_mode) as PaymentMode,
    cashTiming: text(row.cash_timing) || undefined,
    deliveryMode: text(row.delivery_mode) === "Self Collection" ? "Self Collection" : "Delivery",
    optedInAt: row.opted_in_at ? String(row.opted_in_at) : undefined,
    active: Boolean(row.active)
  };
}

async function productPricing(counterpartyId: string, productSku: string) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT p.sku, p.name, p.default_gst_rate, p.default_tax_mode, p.mrp, p.rsp, p.offer_price,
            rule.special_rate, rule.cd_percent, rule.tod_percent, rule.minimum_quantity
     FROM products p
     LEFT JOIN LATERAL (
       SELECT special_rate, cd_percent, tod_percent, minimum_quantity
       FROM whatsapp_price_rules
       WHERE counterparty_id = $1 AND product_sku = p.sku AND active = TRUE
         AND valid_from <= NOW() AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY updated_at DESC LIMIT 1
     ) rule ON TRUE
     WHERE p.sku = $2`,
    [counterpartyId, productSku]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Product ${productSku} was not found.`);
  const fallbackRate = numberValue(row.offer_price) || numberValue(row.rsp) || numberValue(row.mrp);
  const rate = numberValue(row.special_rate) || fallbackRate;
  if (!(rate > 0)) throw new Error(`No selling rate is configured for ${productSku}.`);
  return {
    sku: text(row.sku),
    name: text(row.name),
    rate,
    cdPercent: numberValue(row.cd_percent),
    todPercent: numberValue(row.tod_percent),
    minimumQuantity: Math.max(1, numberValue(row.minimum_quantity, 1)),
    gstRate: numberValue(row.default_gst_rate) as GstRate,
    taxMode: (text(row.default_tax_mode) === "Inclusive" ? "Inclusive" : "Exclusive") as TaxMode
  };
}

async function createDraft(profile: RetailerProfile, source: string, sourceMessageId: string, lines: DraftLineInput[], sourceOfferId = "") {
  if (lines.length === 0) throw new Error("The order did not contain any products.");
  const draftId = id("WAD");
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_order_drafts (
       id, counterparty_id, phone_e164, salesman_id, warehouse_id, source, source_message_id,
       source_offer_id, status, billing_type, payment_mode, cash_timing, delivery_mode, note, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'Needs Review',$9,$10,$11,$12,$13,NOW())`,
    [draftId, profile.counterpartyId, profile.phoneE164, profile.salesmanId, profile.defaultWarehouseId,
      source, sourceMessageId || null, sourceOfferId || null, profile.billingType, profile.paymentMode,
      profile.cashTiming || null, profile.deliveryMode, `WhatsApp ${source} order from ${profile.retailerName}`]
  );
  for (const line of lines) {
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_order_draft_lines (
         id, draft_id, product_sku, requested_quantity, approved_quantity, rate,
         cd_percent, tod_percent, gst_rate, tax_mode, note
       ) VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10)`,
      [id("WADL"), draftId, line.productSku, line.quantity, line.rate, line.cdPercent || 0,
        line.todPercent || 0, line.gstRate === "NA" ? 0 : line.gstRate || 0,
        line.taxMode === "Inclusive" ? "Inclusive" : "Exclusive", line.note || ""]
    );
  }
  await sendText(profile.phoneE164,
    `✅ Order request ${draftId} received. ${profile.salesmanName} will verify stock and your special rate, then send the final summary for confirmation.`,
    "Draft", draftId);
  const template = text(process.env.WHATSAPP_SALESPERSON_ALERT_TEMPLATE);
  if (template) {
    const user = (await getSnapshot()).users.find((item) => item.id === profile.salesmanId);
    if (user?.mobileNumber) await sendTemplate(user.mobileNumber, template, [draftId, profile.retailerName], "Draft", draftId).catch(() => undefined);
  }
  return draftId;
}

async function createDraftFromCatalogOrder(profile: RetailerProfile, messageId: string, order: JsonObject) {
  const rawItems = Array.isArray(order.product_items) ? order.product_items as JsonObject[] : [];
  const lines: DraftLineInput[] = [];
  for (const item of rawItems) {
    const sku = text(item.product_retailer_id);
    const pricing = await productPricing(profile.counterpartyId, sku);
    const quantity = Math.max(pricing.minimumQuantity, numberValue(item.quantity, 1));
    lines.push({ productSku: sku, quantity, rate: pricing.rate, cdPercent: pricing.cdPercent, todPercent: pricing.todPercent, gstRate: pricing.gstRate, taxMode: pricing.taxMode });
  }
  return createDraft(profile, "Catalogue", messageId, lines);
}

async function createDraftFromNaturalText(profile: RetailerProfile, messageId: string, body: string) {
  const snapshot = await getSnapshot();
  const salesperson = snapshot.users.find((item) => item.id === profile.salesmanId);
  if (!salesperson) throw new Error("The assigned salesperson is unavailable.");
  const reply = await runAssistant(`Create sales order for ${profile.retailerName}: ${body}`, snapshot, salesperson, "hinglish");
  if (reply.kind !== "order_draft" || !reply.draft?.lines.length) {
    await sendText(profile.phoneE164, "Product aur quantity samajh nahi aayi. Example: ‘Lux 100g 10 carton’. Catalogue se bhi items bhej sakte hain.");
    return "";
  }
  const lines: DraftLineInput[] = [];
  for (const parsed of reply.draft.lines) {
    const candidate = parsed.candidates[0];
    if (!candidate) continue;
    const pricing = await productPricing(profile.counterpartyId, candidate.id);
    lines.push({
      productSku: candidate.id,
      quantity: Math.max(pricing.minimumQuantity, parsed.quantity || 1),
      rate: pricing.rate,
      cdPercent: pricing.cdPercent,
      todPercent: pricing.todPercent,
      gstRate: pricing.gstRate,
      taxMode: pricing.taxMode,
      note: `Matched from “${parsed.query}” (${Math.round(candidate.score)})`
    });
  }
  if (!lines.length) {
    await sendText(profile.phoneE164, "Product match nahi hua. Please catalogue se item select karke quantity bhejein.");
    return "";
  }
  return createDraft(profile, "Message", messageId, lines);
}

function lineAmounts(line: { approved_quantity: unknown; rate: unknown; cd_percent: unknown; tod_percent: unknown; gst_rate: unknown; tax_mode: unknown }) {
  const quantity = numberValue(line.approved_quantity);
  const rate = numberValue(line.rate);
  const cdAmount = quantity * rate * numberValue(line.cd_percent) / 100;
  const todAmount = quantity * rate * numberValue(line.tod_percent) / 100;
  const netRate = rate - (cdAmount + todAmount) / Math.max(quantity, 1);
  return calculateSalesAmounts({
    quantity,
    rate,
    cdTodRate: netRate,
    cdAmount,
    todAmount,
    gstRate: numberValue(line.gst_rate) as GstRate,
    taxMode: text(line.tax_mode) === "Inclusive" ? "Inclusive" : "Exclusive"
  });
}

async function loadDraft(draftId: string) {
  const drafts = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT d.*, c.name AS retailer_name, u.full_name AS salesman_name
     FROM whatsapp_order_drafts d
     JOIN counterparties c ON c.id = d.counterparty_id
     JOIN users u ON u.id = d.salesman_id
     WHERE d.id = $1`, [draftId]
  );
  if (!drafts.rows[0]) throw new Error("WhatsApp order draft not found.");
  const lines = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT l.*, p.name AS product_name FROM whatsapp_order_draft_lines l JOIN products p ON p.sku = l.product_sku WHERE l.draft_id = $1 ORDER BY l.id`, [draftId]
  );
  return { draft: drafts.rows[0], lines: lines.rows };
}

function draftSummary(draftId: string, retailerName: string, rows: Record<string, unknown>[]) {
  let total = 0;
  const details = rows.map((line, index) => {
    const amounts = lineAmounts(line as never);
    total += amounts.totalAmount;
    return `${index + 1}. ${text(line.product_name)}\n   ${numberValue(line.approved_quantity)} × ₹${numberValue(line.rate).toFixed(2)} | CD ${numberValue(line.cd_percent)}% | TOD ${numberValue(line.tod_percent)}%\n   ₹${amounts.totalAmount.toFixed(2)} incl. tax`;
  }).join("\n");
  return `🧾 *Aapoorti Wholesale Order*\n${draftId} | ${retailerName}\n\n${details}\n\n*Estimated total: ₹${total.toFixed(2)}*\nRates and stock are locked only after you confirm.`;
}

async function finalizeDraft(draftId: string) {
  const claimed = await executeDatabaseQuery(
    `UPDATE whatsapp_order_drafts SET status = 'Processing', retailer_confirmed_at = NOW()
     WHERE id = $1 AND status = 'Awaiting Retailer' RETURNING id`, [draftId]
  );
  if (!claimed.rowCount) return;
  try {
    const { draft, lines } = await loadDraft(draftId);
    const snapshot = await getSnapshot();
    const salesperson = snapshot.users.find((item) => item.id === numberValue(draft.salesman_id));
    if (!salesperson) throw new Error("Assigned salesperson is unavailable.");
    await createSalesCart({
      allowProbationarySale: false,
      shopId: text(draft.counterparty_id),
      billingType: text(draft.billing_type) === "B2C" ? "B2C" : "B2B",
      warehouseId: text(draft.warehouse_id),
      paymentMode: text(draft.payment_mode) as PaymentMode,
      cashTiming: text(draft.cash_timing) as "In Hand" | "At Delivery" | "Later" || undefined,
      deliveryMode: text(draft.delivery_mode) === "Self Collection" ? "Self Collection" : "Delivery",
      note: `WhatsApp confirmed order ${draftId}`,
      lines: lines.map((line) => {
        const amounts = lineAmounts(line as never);
        return {
          productSku: text(line.product_sku), quantity: numberValue(line.approved_quantity), rate: numberValue(line.rate),
          cdTodRate: amounts.cdTodRate, cdAmount: amounts.cdAmount, todAmount: amounts.todAmount,
          gstRate: amounts.gstRate, taxMode: amounts.taxMode, note: text(line.note)
        };
      })
    }, salesperson);
    const order = await executeDatabaseQuery<{ order_id: string }>(
      `SELECT COALESCE(cart_id, id) AS order_id FROM sales_orders WHERE note LIKE $1 ORDER BY created_at DESC LIMIT 1`,
      [`%${draftId}%`]
    );
    const salesCartId = order.rows[0]?.order_id || "";
    await executeDatabaseQuery(
      `UPDATE whatsapp_order_drafts SET status = 'Completed', sales_cart_id = $2, completed_at = NOW() WHERE id = $1`,
      [draftId, salesCartId]
    );
    await sendText(text(draft.phone_e164),
      `✅ Order confirmed${salesCartId ? `: ${salesCartId}` : ""}. Aapoorti team will share dispatch and final invoice updates here.`,
      "Draft", draftId);
  } catch (error) {
    await executeDatabaseQuery(`UPDATE whatsapp_order_drafts SET status = 'Awaiting Retailer', note = note || $2 WHERE id = $1`, [draftId, ` | Finalization failed: ${error instanceof Error ? error.message : "Unknown error"}`]);
    throw error;
  }
}

async function acceptOffer(offerId: string, profile: RetailerProfile, inboundMessageId: string, quantityOverride?: number) {
  const offers = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT * FROM whatsapp_offers WHERE id = $1 AND counterparty_id = $2`, [offerId, profile.counterpartyId]
  );
  const offer = offers.rows[0];
  if (!offer || text(offer.status) !== "Sent") throw new Error("This offer is no longer available.");
  if (new Date(String(offer.expires_at)).getTime() <= Date.now()) {
    await executeDatabaseQuery(`UPDATE whatsapp_offers SET status = 'Expired' WHERE id = $1`, [offerId]);
    throw new Error("This special rate has expired. Please request a fresh rate.");
  }
  const offerLines = await executeDatabaseQuery<Record<string, unknown>>(`SELECT * FROM whatsapp_offer_lines WHERE offer_id = $1 ORDER BY id`, [offerId]);
  const lines: DraftLineInput[] = offerLines.rows.map((line) => ({
    productSku: text(line.product_sku),
    quantity: Math.max(numberValue(line.minimum_quantity, 1), quantityOverride || numberValue(line.quantity)),
    rate: numberValue(line.rate), cdPercent: numberValue(line.cd_percent), todPercent: numberValue(line.tod_percent)
  }));
  for (const line of lines) {
    const pricing = await productPricing(profile.counterpartyId, line.productSku);
    line.gstRate = pricing.gstRate;
    line.taxMode = pricing.taxMode;
  }
  const draftId = await createDraft(profile, "Offer", inboundMessageId, lines, offerId);
  await executeDatabaseQuery(`UPDATE whatsapp_offers SET status = 'Accepted', accepted_at = NOW() WHERE id = $1`, [offerId]);
  return draftId;
}

async function handleInboundMessage(message: JsonObject) {
  const from = normalizeWhatsAppPhone(text(message.from));
  const messageId = text(message.id);
  const messageType = text(message.type) || "unknown";
  const context = message.context as JsonObject | undefined;
  const saved = await recordMessage({ waMessageId: messageId, direction: "Inbound", phone: from, type: messageType, contextMessageId: text(context?.id), payload: message });
  if (!saved) return;
  const profile = await getRetailerByPhone(from);
  if (!profile) {
    await sendText(from, "Welcome to Aapoorti Wholesale. Your number is not mapped yet. Please share shop name, owner name, city and GSTIN; our team will activate ordering.");
    return;
  }
  try {
    if (messageType === "order" && message.order && typeof message.order === "object") {
      await createDraftFromCatalogOrder(profile, messageId, message.order as JsonObject);
      return;
    }
    const interactive = message.interactive as JsonObject | undefined;
    const buttonReply = interactive?.button_reply as JsonObject | undefined;
    const buttonId = text(buttonReply?.id);
    if (buttonId.startsWith("wa-confirm:")) {
      await finalizeDraft(buttonId.slice("wa-confirm:".length));
      return;
    }
    if (buttonId.startsWith("wa-change:")) {
      await executeDatabaseQuery(`UPDATE whatsapp_order_drafts SET status = 'Change Requested' WHERE id = $1 AND counterparty_id = $2`, [buttonId.slice("wa-change:".length), profile.counterpartyId]);
      await sendText(from, "Required quantity/rate change type karke bhejein. Salesperson review karega.");
      return;
    }
    if (buttonId.startsWith("wa-offer:")) {
      await acceptOffer(buttonId.slice("wa-offer:".length), profile, messageId);
      return;
    }
    if (buttonId.startsWith("wa-ignore:")) {
      await executeDatabaseQuery(
        `UPDATE whatsapp_offers SET status = 'Declined' WHERE id = $1 AND counterparty_id = $2 AND status = 'Sent'`,
        [buttonId.slice("wa-ignore:".length), profile.counterpartyId]
      );
      await sendText(from, "No problem. This offer has been closed for your shop.");
      return;
    }
    const body = text((message.text as JsonObject | undefined)?.body);
    const normalized = body.toLowerCase();
    const contextId = text(context?.id);
    const affirmative = /^(yes|y|confirm|confirmed|haan|ha|ok|okay|done)(?:\s+(\d+(?:\.\d+)?))?$/i.exec(normalized);
    if (contextId && affirmative) {
      const draft = await executeDatabaseQuery<{ id: string }>(`SELECT id FROM whatsapp_order_drafts WHERE confirmation_message_id = $1 AND counterparty_id = $2 AND status = 'Awaiting Retailer' ORDER BY created_at DESC LIMIT 1`, [contextId, profile.counterpartyId]);
      if (draft.rows[0]) { await finalizeDraft(draft.rows[0].id); return; }
      const offer = await executeDatabaseQuery<{ id: string }>(`SELECT id FROM whatsapp_offers WHERE outbound_message_id = $1 AND counterparty_id = $2 AND status = 'Sent' ORDER BY created_at DESC LIMIT 1`, [contextId, profile.counterpartyId]);
      if (offer.rows[0]) { await acceptOffer(offer.rows[0].id, profile, messageId, affirmative[1] ? numberValue(affirmative[1]) : undefined); return; }
    }
    if (contextId && /^\d+(?:\.\d+)?$/.test(normalized)) {
      const offer = await executeDatabaseQuery<{ id: string }>(`SELECT id FROM whatsapp_offers WHERE outbound_message_id = $1 AND counterparty_id = $2 AND status = 'Sent' ORDER BY created_at DESC LIMIT 1`, [contextId, profile.counterpartyId]);
      if (offer.rows[0]) { await acceptOffer(offer.rows[0].id, profile, messageId, numberValue(normalized)); return; }
    }
    if (/^(hi|hello|hey|namaste|menu|catalog|catalogue|catlog)$/i.test(normalized)) {
      await sendCatalog(from);
      return;
    }
    if (body) {
      const pendingChange = await executeDatabaseQuery<{ id: string }>(
        `SELECT id FROM whatsapp_order_drafts WHERE counterparty_id = $1 AND status = 'Change Requested' ORDER BY created_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (pendingChange.rows[0]) {
        await executeDatabaseQuery(
          `UPDATE whatsapp_order_drafts SET status = 'Needs Review', note = CONCAT(note, CASE WHEN note = '' THEN '' ELSE ' | ' END, $2) WHERE id = $1`,
          [pendingChange.rows[0].id, `Retailer requested: ${body}`]
        );
        await sendText(from, "Change request received. Your salesperson will review stock and rate, then send the revised order here.", "Draft", pendingChange.rows[0].id);
        return;
      }
    }
    if (body) await createDraftFromNaturalText(profile, messageId, body);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : "Order processing failed.";
    await sendText(from, `⚠️ ${messageText} Your salesperson has been notified.`).catch(() => undefined);
    throw error;
  }
}

export function verifyWhatsAppWebhook(query: Record<string, unknown>) {
  return isValidWebhookChallenge(query, text(process.env.WHATSAPP_VERIFY_TOKEN));
}

export function verifyWhatsAppSignature(rawBody: Buffer, signatureHeader: string) {
  return isValidMetaSignature(rawBody, signatureHeader, text(process.env.WHATSAPP_APP_SECRET), process.env.NODE_ENV !== "production");
}

export async function handleWhatsAppWebhook(payload: JsonObject) {
  const entries = Array.isArray(payload.entry) ? payload.entry as JsonObject[] : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as JsonObject[] : [];
    for (const change of changes) {
      const value = change.value as JsonObject | undefined;
      for (const status of Array.isArray(value?.statuses) ? value.statuses as JsonObject[] : []) {
        await updateMessageStatus(text(status.id), text(status.status) || "Unknown", text((status.errors as JsonObject[] | undefined)?.[0]?.title));
      }
      for (const message of Array.isArray(value?.messages) ? value.messages as JsonObject[] : []) {
        await handleInboundMessage(message);
      }
    }
  }
}

export async function subscribeWhatsAppBusinessAccount() {
  const businessAccountId = text(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  if (!configured() || !businessAccountId) throw new Error("WhatsApp credentials and Business Account ID are required.");
  const response = await fetch(`${graphBase}/${businessAccountId}/subscribed_apps`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({})
  });
  const body = await response.json() as { success?: boolean; error?: { message?: string } };
  if (!response.ok || !body.success) {
    throw new Error(text(body.error?.message) || `Meta subscription failed (${response.status}).`);
  }
  return { subscribed: true, businessAccountId };
}

export async function configureWhatsAppCommerce() {
  const accessToken = text(process.env.WHATSAPP_ACCESS_TOKEN);
  const phoneNumberId = text(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const catalogId = text(process.env.WHATSAPP_CATALOG_ID);
  if (!accessToken || !phoneNumberId || !catalogId) throw new Error("WhatsApp phone, token and Catalogue ID are required.");
  const response = await fetch(`${graphBase}/${phoneNumberId}/whatsapp_commerce_settings`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ catalog_id: catalogId, is_catalog_visible: true, is_cart_enabled: true })
  });
  const body = await response.json() as JsonObject;
  if (!response.ok || body.success === false) {
    throw new Error(text((body.error as JsonObject | undefined)?.message) || `Meta commerce setup failed (${response.status}).`);
  }
  return { configured: true, catalogId, catalogVisible: true, cartEnabled: true };
}

export async function getWhatsAppMetaDiagnostics() {
  const accessToken = text(process.env.WHATSAPP_ACCESS_TOKEN);
  const businessAccountId = text(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const phoneNumberId = text(process.env.WHATSAPP_PHONE_NUMBER_ID);
  const appSecret = text(process.env.WHATSAPP_APP_SECRET);
  if (!accessToken || !businessAccountId || !phoneNumberId) throw new Error("WhatsApp credentials are incomplete.");
  const graphGet = async (path: string) => {
    const response = await fetch(`${graphBase}/${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = await response.json() as JsonObject;
    return response.ok ? { ok: true, body } : { ok: false, error: text((body.error as JsonObject | undefined)?.message) || `HTTP ${response.status}` };
  };
  const [phone, subscriptions, catalogs, commerceSettings, tokenDebug] = await Promise.all([
    graphGet(`${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status`),
    graphGet(`${businessAccountId}/subscribed_apps`),
    graphGet(`${businessAccountId}/product_catalogs`),
    graphGet(`${phoneNumberId}/whatsapp_commerce_settings`),
    graphGet(`debug_token?input_token=${encodeURIComponent(accessToken)}`)
  ]);
  const debugData = tokenDebug.ok && tokenDebug.body
    ? tokenDebug.body.data as JsonObject | undefined
    : undefined;
  const appId = text(debugData?.app_id);
  let webhookSubscription: Record<string, unknown> = { ok: false, error: "App credentials are incomplete." };
  if (appId && appSecret) {
    const response = await fetch(`${graphBase}/${appId}/subscriptions`, {
      headers: { authorization: `Bearer ${appId}|${appSecret}` }
    });
    const body = await response.json() as JsonObject;
    webhookSubscription = response.ok
      ? { ok: true, body }
      : { ok: false, error: text((body.error as JsonObject | undefined)?.message) || `HTTP ${response.status}` };
  }
  return {
    phone,
    subscriptions,
    catalogs,
    commerceSettings,
    webhookSubscription,
    token: tokenDebug.ok ? {
      ok: true,
      appId,
      valid: Boolean(debugData?.is_valid),
      expiresAt: numberValue(debugData?.expires_at),
      scopes: Array.isArray(debugData?.scopes) ? debugData.scopes.map(text) : []
    } : tokenDebug
  };
}

export async function getWhatsAppDashboard(currentUser: StaffUser) {
  const isAdmin = currentUser.roles.includes("Admin");
  const filter = isAdmin ? "" : "WHERE wr.salesman_id = $1";
  const params = isAdmin ? [] : [currentUser.id];
  const [retailers, rules, offers, drafts, lines, messages] = await Promise.all([
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_retailers wr JOIN counterparties c ON c.id = wr.counterparty_id JOIN users u ON u.id = wr.salesman_id ${filter} ORDER BY c.name`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT r.*, c.name AS retailer_name, p.name AS product_name FROM whatsapp_price_rules r JOIN counterparties c ON c.id = r.counterparty_id JOIN products p ON p.sku = r.product_sku ${isAdmin ? "" : "JOIN whatsapp_retailers wr ON wr.counterparty_id = r.counterparty_id WHERE wr.salesman_id = $1"} ORDER BY r.updated_at DESC LIMIT 300`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT o.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_offers o JOIN counterparties c ON c.id = o.counterparty_id JOIN users u ON u.id = o.salesman_id ${isAdmin ? "" : "WHERE o.salesman_id = $1"} ORDER BY o.created_at DESC LIMIT 100`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT d.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_order_drafts d JOIN counterparties c ON c.id = d.counterparty_id JOIN users u ON u.id = d.salesman_id ${isAdmin ? "" : "WHERE d.salesman_id = $1"} ORDER BY d.created_at DESC LIMIT 150`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT l.*, p.name AS product_name
       FROM whatsapp_order_draft_lines l
       JOIN products p ON p.sku = l.product_sku
       JOIN whatsapp_order_drafts d ON d.id = l.draft_id
       ${isAdmin ? "" : "WHERE d.salesman_id = $1"}
       ORDER BY d.created_at DESC, l.id LIMIT 1000`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      isAdmin
        ? `SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT 100`
        : `SELECT m.* FROM whatsapp_messages m
           LEFT JOIN whatsapp_retailers wr ON wr.phone_e164 = m.phone_e164
           WHERE wr.salesman_id = $1 OR wr.counterparty_id IS NULL
           ORDER BY m.created_at DESC LIMIT 100`, params)
  ]);
  const visibleDraftIds = new Set(drafts.rows.map((row) => text(row.id)));
  return {
    configuration: {
      connected: configured(),
      phoneNumberIdPresent: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      catalogIdPresent: Boolean(process.env.WHATSAPP_CATALOG_ID),
      verifyTokenPresent: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecretPresent: Boolean(process.env.WHATSAPP_APP_SECRET),
      mode: configured() ? "Live" : "Simulation"
    },
    retailers: retailers.rows.map(mapRetailer),
    priceRules: rules.rows,
    offers: offers.rows,
    drafts: drafts.rows.map((draft) => ({ ...draft, lines: lines.rows.filter((line) => visibleDraftIds.has(text(line.draft_id)) && text(line.draft_id) === text(draft.id)) })),
    messages: messages.rows,
    catalogFeedUrl: `${process.env.PUBLIC_API_URL || "https://b2b-v8kb.onrender.com"}/whatsapp/catalog/feed.csv?token=${encodeURIComponent(process.env.WHATSAPP_CATALOG_FEED_TOKEN || "SET_A_SECRET")}`
  };
}

export async function saveWhatsAppRetailer(input: {
  counterpartyId: string; phone: string; salesmanId: number; defaultWarehouseId: string;
  billingType: "B2B" | "B2C"; paymentMode: PaymentMode; cashTiming?: string;
  deliveryMode: "Delivery" | "Self Collection"; optedIn: boolean; active: boolean;
}, currentUser: StaffUser) {
  const phone = normalizeWhatsAppPhone(input.phone);
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_retailers (
       counterparty_id, phone_e164, salesman_id, default_warehouse_id, billing_type,
       payment_mode, cash_timing, delivery_mode, opted_in_at, active, created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $9 THEN NOW() ELSE NULL END,$10,$11,NOW(),NOW())
     ON CONFLICT (counterparty_id) DO UPDATE SET
       phone_e164=EXCLUDED.phone_e164, salesman_id=EXCLUDED.salesman_id,
       default_warehouse_id=EXCLUDED.default_warehouse_id, billing_type=EXCLUDED.billing_type,
       payment_mode=EXCLUDED.payment_mode, cash_timing=EXCLUDED.cash_timing,
       delivery_mode=EXCLUDED.delivery_mode,
       opted_in_at=CASE WHEN EXCLUDED.opted_in_at IS NOT NULL THEN COALESCE(whatsapp_retailers.opted_in_at, NOW()) ELSE NULL END,
       active=EXCLUDED.active, updated_at=NOW()`,
    [input.counterpartyId, phone, input.salesmanId, input.defaultWarehouseId, input.billingType,
      input.paymentMode, input.cashTiming || null, input.deliveryMode, input.optedIn, input.active, currentUser.fullName]
  );
  return getWhatsAppDashboard(currentUser);
}

export async function saveWhatsAppPriceRule(input: {
  counterpartyId: string; productSku: string; specialRate: number; cdPercent: number;
  todPercent: number; minimumQuantity: number; validUntil?: string; active: boolean;
}, currentUser: StaffUser) {
  if (!(input.specialRate > 0)) throw new Error("Special rate must be greater than zero.");
  if (input.cdPercent < 0 || input.todPercent < 0 || input.cdPercent + input.todPercent >= 100) throw new Error("Enter valid CD/TOD percentages.");
  if (!currentUser.roles.includes("Admin")) {
    const assigned = await executeDatabaseQuery(`SELECT counterparty_id FROM whatsapp_retailers WHERE counterparty_id=$1 AND salesman_id=$2 AND active=TRUE`, [input.counterpartyId, currentUser.id]);
    if (!assigned.rowCount) throw new Error("You can only set rates for your mapped retailers.");
  }
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_price_rules (id,counterparty_id,product_sku,special_rate,cd_percent,tod_percent,minimum_quantity,valid_from,valid_until,active,created_by,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),$8,$9,$10,NOW(),NOW())`,
    [id("WAPR"), input.counterpartyId, input.productSku, input.specialRate, input.cdPercent,
      input.todPercent, Math.max(1, input.minimumQuantity), input.validUntil || null, input.active, currentUser.fullName]
  );
  return getWhatsAppDashboard(currentUser);
}

export async function createWhatsAppOffer(input: {
  counterpartyIds: string[]; expiresAt: string;
  lines: Array<{ productSku: string; quantity: number; rate: number; cdPercent: number; todPercent: number; minimumQuantity: number }>;
}, currentUser: StaffUser) {
  if (!input.counterpartyIds.length || !input.lines.length) throw new Error("Select retailers and at least one product.");
  if (new Date(input.expiresAt).getTime() <= Date.now()) throw new Error("Offer expiry must be in the future.");
  const results: Array<{ offerId: string; retailer: string; simulated: boolean }> = [];
  for (const counterpartyId of input.counterpartyIds) {
    const retailerResult = await executeDatabaseQuery<Record<string, unknown>>(
      `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_retailers wr JOIN counterparties c ON c.id=wr.counterparty_id JOIN users u ON u.id=wr.salesman_id WHERE wr.counterparty_id=$1 AND wr.active=TRUE`, [counterpartyId]
    );
    if (!retailerResult.rows[0]) throw new Error(`Retailer ${counterpartyId} is not mapped to WhatsApp.`);
    const retailer = mapRetailer(retailerResult.rows[0]);
    if (!currentUser.roles.includes("Admin") && retailer.salesmanId !== currentUser.id) throw new Error("You can only message your mapped retailers.");
    if (!retailer.optedInAt) throw new Error(`${retailer.retailerName} has no recorded WhatsApp opt-in.`);
    const offerId = id("WAO");
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_offers (id,counterparty_id,salesman_id,status,expires_at,created_by,created_at) VALUES ($1,$2,$3,'Draft',$4,$5,NOW())`,
      [offerId, counterpartyId, retailer.salesmanId, input.expiresAt, currentUser.fullName]
    );
    const namedLines: string[] = [];
    for (const line of input.lines) {
      const pricing = await productPricing(counterpartyId, line.productSku);
      const rate = line.rate > 0 ? line.rate : pricing.rate;
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_offer_lines (id,offer_id,product_sku,quantity,rate,cd_percent,tod_percent,minimum_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id("WAOL"), offerId, line.productSku, Math.max(line.minimumQuantity, line.quantity), rate, line.cdPercent, line.todPercent, Math.max(1, line.minimumQuantity)]
      );
      namedLines.push(`${pricing.name}: ₹${rate.toFixed(2)} | Qty ${Math.max(line.minimumQuantity, line.quantity)} | CD ${line.cdPercent}% | TOD ${line.todPercent}%`);
    }
    const expiry = new Date(input.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const body = `🎯 *Special rate for ${retailer.retailerName}*\n${namedLines.join("\n")}\nValid until ${expiry}. Reply YES or tap Order Now.`;
    const template = text(process.env.WHATSAPP_OFFER_TEMPLATE);
    const sent = template
      ? await sendTemplate(retailer.phoneE164, template, [retailer.retailerName, namedLines.join("; "), expiry], "Offer", offerId)
      : await sendButtons(retailer.phoneE164, body, [{ id: `wa-offer:${offerId}`, title: "Order Now" }, { id: `wa-ignore:${offerId}`, title: "Not Interested" }], "Offer", offerId);
    await executeDatabaseQuery(`UPDATE whatsapp_offers SET status='Sent', outbound_message_id=$2 WHERE id=$1`, [offerId, sent.messageId]);
    results.push({ offerId, retailer: retailer.retailerName, simulated: sent.simulated });
  }
  return { results, dashboard: await getWhatsAppDashboard(currentUser) };
}

export async function reviewWhatsAppDraft(draftId: string, input: {
  warehouseId: string; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Delivery" | "Self Collection";
  note?: string; lines: Array<{ id: string; quantity: number; rate: number; cdPercent: number; todPercent: number }>;
}, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!currentUser.roles.includes("Admin") && numberValue(loaded.draft.salesman_id) !== currentUser.id) throw new Error("This order belongs to another salesperson.");
  if (["Processing", "Completed"].includes(text(loaded.draft.status))) throw new Error("A confirmed order cannot be edited.");
  if (input.lines.length !== loaded.lines.length) throw new Error("Review every order line before sending confirmation.");
  const snapshot = await getSnapshot();
  for (const line of input.lines) {
    if (!(line.quantity > 0) || !(line.rate > 0)) throw new Error("Approved quantity and rate must be greater than zero.");
    if (line.cdPercent < 0 || line.todPercent < 0 || line.cdPercent + line.todPercent >= 100) throw new Error("Enter valid CD/TOD percentages.");
    const draftLine = loaded.lines.find((candidate) => text(candidate.id) === line.id);
    if (!draftLine) throw new Error("An order line does not belong to this draft.");
    const stock = snapshot.stockSummary.find((item) => item.warehouseId === input.warehouseId && item.productSku === text(draftLine.product_sku));
    if (line.quantity > (stock?.availableQuantity || 0)) throw new Error(`${text(draftLine.product_name)} has only ${stock?.availableQuantity || 0} available at ${input.warehouseId}. Adjust quantity before sending.`);
  }
  for (const line of input.lines) {
    const draftLine = loaded.lines.find((candidate) => text(candidate.id) === line.id)!;
    const stock = snapshot.stockSummary.find((item) => item.warehouseId === input.warehouseId && item.productSku === text(draftLine.product_sku));
    await executeDatabaseQuery(
      `UPDATE whatsapp_order_draft_lines SET approved_quantity=$3, rate=$4, cd_percent=$5, tod_percent=$6, stock_at_review=$7
       WHERE id=$1 AND draft_id=$2`, [line.id, draftId, line.quantity, line.rate, line.cdPercent, line.todPercent, stock?.availableQuantity || 0]
    );
  }
  await executeDatabaseQuery(
    `UPDATE whatsapp_order_drafts SET warehouse_id=$2,payment_mode=$3,cash_timing=$4,delivery_mode=$5,note=$6,status='Staff Approved',reviewed_at=NOW() WHERE id=$1`,
    [draftId, input.warehouseId, input.paymentMode, input.cashTiming || null, input.deliveryMode, input.note || text(loaded.draft.note)]
  );
  const finalDraft = await loadDraft(draftId);
  const summary = draftSummary(draftId, text(finalDraft.draft.retailer_name), finalDraft.lines);
  const sent = await sendButtons(text(finalDraft.draft.phone_e164), summary,
    [{ id: `wa-confirm:${draftId}`, title: "Confirm Order" }, { id: `wa-change:${draftId}`, title: "Request Change" }], "Draft", draftId);
  await executeDatabaseQuery(`UPDATE whatsapp_order_drafts SET status='Awaiting Retailer',confirmation_message_id=$2 WHERE id=$1`, [draftId, sent.messageId]);
  return getWhatsAppDashboard(currentUser);
}

export async function sendWhatsAppInvoiceSummary(draftId: string, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!text(loaded.draft.sales_cart_id)) throw new Error("The sales order has not been created yet.");
  if (!currentUser.roles.some((role) => role === "Admin" || role === "Accounts") && numberValue(loaded.draft.salesman_id) !== currentUser.id) throw new Error("This order belongs to another salesperson.");
  const orders = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT so.*, p.name AS product_name FROM sales_orders so JOIN products p ON p.sku=so.product_sku WHERE COALESCE(so.cart_id,so.id)=$1 ORDER BY so.created_at,so.id`, [text(loaded.draft.sales_cart_id)]
  );
  const rows = orders.rows.map((order, index) => `${index + 1}. ${text(order.product_name)} — ${numberValue(order.quantity)} × ₹${numberValue(order.rate).toFixed(2)} = ₹${numberValue(order.total_amount).toFixed(2)}`);
  const total = orders.rows.reduce((sum, order) => sum + numberValue(order.total_amount) + numberValue(order.delivery_charge), 0);
  await sendText(text(loaded.draft.phone_e164), `🧾 *Aapoorti Invoice Summary*\nOrder ${text(loaded.draft.sales_cart_id)}\n${rows.join("\n")}\n*Total: ₹${total.toFixed(2)}*\nThe final tax invoice remains available from Aapoorti staff.`, "Draft", draftId);
  return { sent: true };
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function getWhatsAppCatalogFeed(token: string) {
  const expected = text(process.env.WHATSAPP_CATALOG_FEED_TOKEN);
  if (!expected || token !== expected) throw new Error("Invalid catalogue feed token.");
  const snapshot = await getSnapshot();
  const publicWeb = (process.env.PUBLIC_WEB_URL || "https://b2b-api-theta.vercel.app").replace(/\/$/, "");
  const header = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];
  const rows = snapshot.products.flatMap((product: ProductMaster) => {
    // A retailer catalogue must never expose an internal purchase rate. Products
    // without a customer-facing price stay out of Meta until their RSP/MRP is set.
    const rate = product.offerPrice || product.rsp || product.mrp || 0;
    if (rate <= 0) return [];
    return [
      [
        product.sku, product.name, [product.size, product.unit, product.offerLabel, product.remarks].filter(Boolean).join(" | "),
        "in stock", "new", `${rate.toFixed(2)} INR`, `${publicWeb}/?product=${encodeURIComponent(product.sku)}`,
        `${publicWeb}/business-connect-icon-512.png`, product.brand || "Aapoorti"
      ].map(csvCell).join(",")
    ];
  });
  return [header.join(","), ...rows].join("\n");
}
