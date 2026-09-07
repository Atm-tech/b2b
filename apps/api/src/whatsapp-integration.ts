import { randomUUID } from "node:crypto";
import type { AppUser, GstRate, PaymentMode, ProductMaster, TaxMode } from "@aapoorti-b2b/domain";
import { calculateSalesAmounts } from "@aapoorti-b2b/domain";
import { createSalesCart, executeDatabaseQuery, getSnapshot } from "./db.js";
import { runAssistant } from "./assistant-service.js";
import { downloadAndCompressCatalogImage } from "./catalog-images.js";
import { getCatalogImageObject, putCatalogImageObject } from "./object-storage.js";
import { discountPercentFromMrp, isValidMetaSignature, isValidWebhookChallenge, normalizeWhatsAppPhone, scoreWhatsAppProductQuery } from "./whatsapp-utils.js";

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
  marketingOptIn: boolean;
  pausedAt?: string;
  tags: string[];
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
type CartSession = {
  selectedProductSku: string;
  stage: string;
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

function whatsappAdminUsernames() {
  return new Set(
    String(process.env.WHATSAPP_ADMIN_USERNAMES || process.env.WHATSAPP_PILOT_USERNAMES || "wa.sales")
      .split(",")
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function isWhatsAppAdminUser(user: StaffUser) {
  return user.roles.includes("Admin") || whatsappAdminUsernames().has(user.username.trim().toLowerCase());
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

async function sendFlow(phone: string, flowId: string, body: string, cta: string, flowToken: string, relatedEntityType?: string, relatedEntityId?: string) {
  return sendGraphMessage(phone, {
    type: "interactive",
    interactive: {
      type: "flow",
      body: { text: compact(body, 1024) },
      action: {
        name: "flow",
        parameters: {
          flow_message_version: "3",
          flow_token: flowToken,
          flow_id: flowId,
          flow_cta: compact(cta, 20),
          flow_action: "navigate",
          flow_action_payload: { screen: "WELCOME" }
        }
      }
    }
  }, relatedEntityType, relatedEntityId);
}

function productSaleRate(product: ProductMaster) {
  return product.offerPrice || product.rsp || product.mrp || 0;
}

function compact(value: string, max: number) {
  return value.trim().slice(0, max);
}

function mrpDiscountLabel(mrpValue: unknown, rateValue: unknown) {
  const mrp = numberValue(mrpValue);
  if (!(mrp > 0)) return "MRP not configured";
  return `MRP Rs.${mrp.toFixed(2)} | ${discountPercentFromMrp(mrp, rateValue).toFixed(2)}% off`;
}

function quantityChoices(minimumQuantity: number) {
  return [minimumQuantity, minimumQuantity * 2, minimumQuantity * 5];
}

async function matchingProducts(query = "", limit = 10) {
  const snapshot = await getSnapshot();
  const historicallyPricedSkus = new Set(
    snapshot.salesOrders.filter((order) => order.status !== "Cancelled" && order.rate > 0).map((order) => order.productSku)
  );
  return snapshot.products
    .filter((product) => {
      if (!product.whatsappCatalogEnabled) return false;
      if (productSaleRate(product) <= 0 && !historicallyPricedSkus.has(product.sku)) return false;
      return true;
    })
    .map((product) => ({
      product,
      score: scoreWhatsAppProductQuery(query, [product.name, product.sku, product.brand, product.shortName, product.articleName, product.itemName, product.size, product.remarks])
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))
    .slice(0, limit)
    .map((item) => item.product);
}

async function sendProductPicker(phone: string, query = "", profile?: RetailerProfile, messageId = "", intro = "") {
  const products = await matchingProducts(query);
  if (!products.length) {
    if (query && profile) return offerWishlist(profile, query, messageId);
    return sendText(phone, `“${compact(query, 80)}” ka product nahi mila. Dusra naam type karein, jaise: Lux`);
  }
  return sendGraphMessage(phone, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: compact(query ? `Did you mean: ${query}?` : "Aapoorti Catalogue", 60) },
      body: { text: [intro, "Kya aap inmein se koi product chahte hain? Select kijiye; phir aapka rate aur quantity options milenge."].filter(Boolean).join("\n\n") },
      footer: { text: "Final stock & special rate salesperson verify karega." },
      action: {
        button: "View products",
        sections: [{
          title: "Products",
          rows: products.map((product) => ({
            id: `wa-product:${encodeURIComponent(product.sku)}`,
            title: compact(product.shortName || product.name, 24),
            description: compact([product.brand, product.size, numberValue(product.mrp) > 0 ? `MRP Rs.${numberValue(product.mrp).toFixed(2)}` : "MRP pending", `Min qty ${Math.max(1, numberValue(product.minimumOrderQuantity, 1))}`].filter(Boolean).join(" · "), 72)
          }))
        }]
      }
    }
  }, "CatalogueSearch", query || "featured");
}

let nativeCatalogUnavailableUntil = 0;

async function sendCatalog(profile: RetailerProfile) {
  const phone = profile.phoneE164;
  const greeting = `Hi ${profile.retailerName} 👋`;
  if (!process.env.WHATSAPP_CATALOG_ID || nativeCatalogUnavailableUntil > Date.now()) {
    return sendProductPicker(phone, "", profile, "", greeting);
  }
  try {
    return await sendGraphMessage(phone, {
      type: "interactive",
      interactive: {
        type: "catalog_message",
        body: { text: `${greeting}\n\nAapoorti Wholesale catalogue kholiye, items select kijiye aur cart WhatsApp par bhej dijiye.` },
        action: { name: "catalog_message" },
        footer: { text: "Special retailer rates are applied during sales review." }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/131009|catalog/i.test(message)) throw error;
    nativeCatalogUnavailableUntil = Date.now() + 10 * 60 * 1000;
    return sendProductPicker(phone, "", profile, "", greeting);
  }
}

async function sendMainMenu(profile: RetailerProfile) {
  return sendGraphMessage(profile.phoneE164, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Aapoorti Wholesale" },
      body: { text: `Namaste ${profile.retailerName} 👋\nKya karna chahenge? Neeche Menu button dabakar option select karein.` },
      footer: { text: compact(`Aapke salesperson: ${profile.salesmanName}`, 60) },
      action: {
        button: "Open Menu",
        sections: [
          {
            title: "Order & catalogue",
            rows: [
              { id: "wa-menu:catalogue", title: "Browse catalogue", description: "Products, MRP, rate aur MOQ dekhein" },
              { id: "wa-menu:order", title: "Start new order", description: "Product select karke order banayein" },
              { id: "wa-menu:reorder", title: "Repeat last order", description: "Pichhla completed order dobara mangayein" },
              { id: "wa-menu:wishlist", title: "Add to wishlist", description: "Unavailable product aur quantity batayein" }
            ]
          },
          {
            title: "Account & support",
            rows: [
              { id: "wa-menu:status", title: "Track my order", description: "Latest order ka live status" },
              { id: "wa-menu:account", title: "Balance & ledger", description: "Outstanding aur recent account summary" },
              { id: "wa-menu:service", title: "Return or damage", description: "Claim/service request banayein" },
              { id: "wa-menu:agent", title: "Chat with salesperson", description: compact(`${profile.salesmanName} se seedhi baat karein`, 72) }
            ]
          }
        ]
      }
    }
  }, "MainMenu", profile.counterpartyId);
}

async function sendOrderGuide(profile: RetailerProfile) {
  await sendButtons(profile.phoneE164,
    "Aapoorti order demo:\n1. Product name type karein (example: Lux)\n2. Suggested item select karein\n3. Apna special rate dekhein\n4. Quantity choose karein\n5. Aur items add karein\n6. Total dekhkar Finalize karein\n7. Salesperson stock/rate approve karega\n\nDemo shuru karein?",
    [
      { id: "wa-guide:start", title: "Start guided order" },
      { id: "wa-cart:checkout", title: "View my cart" }
    ], "OrderGuide", profile.counterpartyId);
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

async function sendFirstTimeWelcome(counterpartyId: string) {
  const retailerResult = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name
     FROM whatsapp_retailers wr
     JOIN counterparties c ON c.id=wr.counterparty_id
     JOIN users u ON u.id=wr.salesman_id
     WHERE wr.counterparty_id=$1 AND wr.active=TRUE`, [counterpartyId]
  );
  if (!retailerResult.rows[0]) return;
  const retailer = mapRetailer(retailerResult.rows[0]);
  if (!retailer.optedInAt) return;
  const alreadyWelcomed = await executeDatabaseQuery(
    `SELECT id FROM whatsapp_messages
     WHERE related_entity_type='BroadcastWelcome' AND related_entity_id=$1 AND status<>'Failed'
     LIMIT 1`, [counterpartyId]
  );
  if (alreadyWelcomed.rowCount) return;
  const welcomeTemplate = text(process.env.WHATSAPP_WELCOME_TEMPLATE);
  if (welcomeTemplate) {
    await sendTemplate(retailer.phoneE164, welcomeTemplate, [retailer.retailerName, retailer.salesmanName], "BroadcastWelcome", counterpartyId);
  } else {
    await sendText(retailer.phoneE164,
      `Namaste ${retailer.retailerName} 👋\n\nAapoorti Wholesale WhatsApp ordering mein aapka swagat hai. Aapko ${retailer.salesmanName} ke saath map kar diya gaya hai.\n\nYahan aap product dhoondh sakte hain, apna rate/MRP/discount dekh sakte hain, quantity select karke cart bana sakte hain aur order finalize kar sakte hain.\n\nOrder kaise karein:\n1. Product ka naam type karein — jaise Lux\n2. Sahi item select karein\n3. Quantity bhejein\n4. Aur item chahiye to Add More choose karein\n5. Total check karke Finalize karein\n\nDemo ke liye *demo*, catalogue ke liye *catalogue* aur madad ke liye *help* bhejein.`,
      "BroadcastWelcome", counterpartyId);
  }
}

async function createServiceTicket(profile: RetailerProfile, input: {
  kind: "Live Chat" | "Return" | "Damage" | "Voice Order" | "Support";
  subject?: string;
  details?: string;
  linkedOrderId?: string;
  mediaId?: string;
  mediaType?: string;
}) {
  if (input.kind === "Live Chat") {
    const existing = await executeDatabaseQuery<{ id: string }>(
      `SELECT id FROM whatsapp_service_tickets
       WHERE counterparty_id=$1 AND kind='Live Chat' AND status='Open'
       ORDER BY updated_at DESC LIMIT 1`, [profile.counterpartyId]
    );
    if (existing.rows[0]?.id) return existing.rows[0].id;
  }
  const ticketId = id("WAT");
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_service_tickets (
       id,counterparty_id,phone_e164,salesman_id,kind,subject,details,linked_order_id,
       media_id,media_type,status,priority,last_message_at,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Open',$11,NOW(),NOW(),NOW())`,
    [ticketId, profile.counterpartyId, profile.phoneE164, profile.salesmanId, input.kind,
      compact(input.subject || input.kind, 160), compact(input.details || "", 2000),
      input.linkedOrderId || null, input.mediaId || null, input.mediaType || null,
      input.kind === "Damage" || input.kind === "Return" ? "High" : "Normal"]
  );
  return ticketId;
}

async function sendLatestOrderStatus(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT d.id,d.sales_cart_id,d.status,d.created_at,
            COALESCE((SELECT so.status FROM sales_orders so
                      WHERE COALESCE(so.cart_id,so.id)=d.sales_cart_id
                      ORDER BY so.created_at DESC LIMIT 1), d.status) AS live_status
     FROM whatsapp_order_drafts d
     WHERE d.counterparty_id=$1
     ORDER BY d.created_at DESC LIMIT 1`,
    [profile.counterpartyId]
  );
  const order = result.rows[0];
  if (!order) {
    await sendText(profile.phoneE164, "Abhi koi WhatsApp order nahi mila. Order shuru karne ke liye product ka naam bhejein.");
    return;
  }
  await sendText(profile.phoneE164,
    `Order status\n${text(order.sales_cart_id) || text(order.id)}\nStatus: *${text(order.live_status)}*\nLast update: ${new Date(String(order.created_at)).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
    "OrderStatus", text(order.id));
}

async function offerLatestReorder(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT id,sales_cart_id,created_at FROM whatsapp_order_drafts
     WHERE counterparty_id=$1 AND status='Completed'
     ORDER BY completed_at DESC NULLS LAST,created_at DESC LIMIT 1`,
    [profile.counterpartyId]
  );
  const previous = result.rows[0];
  if (!previous) {
    await sendText(profile.phoneE164, "Repeat karne ke liye koi completed WhatsApp order nahi mila. Product ka naam bhejkar naya order shuru karein.");
    return;
  }
  const lines = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT l.approved_quantity,p.name FROM whatsapp_order_draft_lines l
     JOIN products p ON p.sku=l.product_sku WHERE l.draft_id=$1 ORDER BY l.id`, [text(previous.id)]
  );
  const summary = lines.rows.slice(0, 6).map((line) => `${text(line.name)} x ${numberValue(line.approved_quantity)}`).join("\n");
  await sendButtons(profile.phoneE164,
    `Last order${text(previous.sales_cart_id) ? ` ${text(previous.sales_cart_id)}` : ""}:\n${summary}\n\nCurrent rates, MOQ aur stock dobara verify honge. Repeat karein?`,
    [{ id: `wa-reorder:${text(previous.id)}`, title: "Repeat Order" }, { id: "wa-guide:start", title: "New Order" }],
    "Reorder", text(previous.id));
}

async function createReorder(profile: RetailerProfile, previousDraftId: string, messageId: string) {
  const previous = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT id FROM whatsapp_order_drafts WHERE id=$1 AND counterparty_id=$2 AND status='Completed'`,
    [previousDraftId, profile.counterpartyId]
  );
  if (!previous.rows[0]) throw new Error("Previous order is unavailable.");
  const oldLines = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT product_sku,approved_quantity FROM whatsapp_order_draft_lines WHERE draft_id=$1 ORDER BY id`, [previousDraftId]
  );
  const lines: DraftLineInput[] = [];
  for (const oldLine of oldLines.rows) {
    const pricing = await productPricing(profile.counterpartyId, text(oldLine.product_sku));
    lines.push({
      productSku: pricing.sku,
      quantity: Math.max(pricing.minimumQuantity, numberValue(oldLine.approved_quantity, pricing.minimumQuantity)),
      rate: pricing.rate,
      cdPercent: pricing.cdPercent,
      todPercent: pricing.todPercent,
      gstRate: pricing.gstRate,
      taxMode: pricing.taxMode,
      note: `Repeat of ${previousDraftId}`
    });
  }
  if (!lines.length) throw new Error("Previous order has no reusable items.");
  const draftId = await createDraft(profile, "Reorder", messageId, lines);
  await sendText(profile.phoneE164, `Repeat order request ${draftId} bana di gayi hai. ${profile.salesmanName} current stock aur rate verify karega.`, "Reorder", draftId);
}

async function sendAccountSummary(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT COALESCE(SUM(pending_amount),0) AS pending_amount,
            COALESCE(SUM(goods_value),0) AS goods_value,
            COALESCE(SUM(paid_amount),0) AS paid_amount
     FROM ledger_entries ledger
     WHERE ledger.side='Sales' AND EXISTS (
       SELECT 1 FROM sales_orders orders
       WHERE orders.shop_id=$1 AND COALESCE(orders.cart_id,orders.id)=ledger.linked_order_id
     )`, [profile.counterpartyId]
  );
  const row = result.rows[0] || {};
  const paymentBase = text(process.env.WHATSAPP_PAYMENT_LINK_BASE_URL).replace(/\/$/, "");
  const paymentLink = paymentBase ? `${paymentBase}?retailer=${encodeURIComponent(profile.counterpartyId)}` : "";
  await sendText(profile.phoneE164,
    `Aapoorti account summary\nBilled: Rs.${numberValue(row.goods_value).toFixed(2)}\nReceived: Rs.${numberValue(row.paid_amount).toFixed(2)}\n*Pending: Rs.${numberValue(row.pending_amount).toFixed(2)}*${paymentLink ? `\nSecure payment: ${paymentLink}` : ""}\nDetailed statement ke liye ${profile.salesmanName} se contact karein.`,
    "Ledger", profile.counterpartyId);
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
    marketingOptIn: row.marketing_opt_in !== false,
    pausedAt: row.paused_at ? String(row.paused_at) : undefined,
    tags: Array.isArray(row.tags_json) ? row.tags_json.map(text).filter(Boolean) : [],
    active: Boolean(row.active)
  };
}

async function notifyWhatsAppAdmins(body: string, relatedEntityId: string) {
  const admins = whatsappAdminUsernames();
  const snapshot = await getSnapshot();
  const recipients = snapshot.users.filter((user) => user.active && admins.has(user.username.trim().toLowerCase()) && user.mobileNumber);
  await Promise.all(recipients.map((user) => sendText(user.mobileNumber, body, "Registration", relatedEntityId).catch(() => undefined)));
}

async function submitRegistration(request: Record<string, unknown>) {
  const requestId = text(request.id);
  await executeDatabaseQuery(
    `UPDATE whatsapp_registration_requests
     SET status = 'Pending', stage = 'Submitted', submitted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND status = 'Draft'`,
    [requestId]
  );
  await sendText(text(request.phone_e164),
    `Registration submitted ✅\nShop: ${text(request.shop_name)}\nOwner: ${text(request.owner_name)}\nGSTIN: ${text(request.gstin)}\nCity: ${text(request.city)}\n\nWhatsApp admin verification ke baad aapko salesperson map karega.`,
    "Registration", requestId);
  await notifyWhatsAppAdmins(
    `New retailer registration: ${text(request.shop_name)} (${text(request.phone_e164)}), ${text(request.city)}, GSTIN ${text(request.gstin)}. App ke WhatsApp Registration queue mein salesperson map karein.`,
    requestId);
}

async function handleRetailerRegistration(message: JsonObject, phone: string, messageId: string) {
  const flowReply = ((message.interactive as JsonObject | undefined)?.nfm_reply as JsonObject | undefined);
  if (flowReply?.response_json) {
    try {
      const response = JSON.parse(text(flowReply.response_json)) as JsonObject;
      const shopName = compact(text(response.shop_name || response.shopName), 160);
      const ownerName = compact(text(response.owner_name || response.ownerName), 160);
      const gstin = text(response.gstin || "NA").replace(/\s+/g, "").toUpperCase();
      const city = compact(text(response.city), 120);
      const deliveryAddress = compact(text(response.delivery_address || response.deliveryAddress), 300);
      if (!shopName || !ownerName || !city || !deliveryAddress) throw new Error("Flow details are incomplete.");
      const requestId = id("WAREG");
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_registration_requests (id,phone_e164,shop_name,owner_name,gstin,city,delivery_address,stage,status,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'AwaitingConfirmation','Draft',NOW(),NOW())`,
        [requestId, phone, shopName, ownerName, gstin || "NA", city, deliveryAddress]
      );
      const request = (await executeDatabaseQuery<Record<string, unknown>>(`SELECT * FROM whatsapp_registration_requests WHERE id=$1`, [requestId])).rows[0];
      await submitRegistration(request);
      return;
    } catch {
      await sendText(phone, "Registration form read nahi ho paya. Details chat mein step-by-step lete hain.");
    }
  }
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT * FROM whatsapp_registration_requests
     WHERE phone_e164 = $1 AND status IN ('Draft','Pending')
     ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  let request = result.rows[0];
  if (!request) {
    const requestId = id("WAREG");
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_registration_requests (id, phone_e164, stage, status, created_at, updated_at)
       VALUES ($1,$2,'AwaitingShopName','Draft',NOW(),NOW())`,
      [requestId, phone]
    );
    const registrationFlowId = text(process.env.WHATSAPP_REGISTRATION_FLOW_ID);
    if (registrationFlowId) {
      await sendFlow(phone, registrationFlowId, "Aapoorti Wholesale retailer registration form complete karein.", "Register now", requestId, "Registration", requestId);
    } else {
      await sendText(phone, "Welcome to Aapoorti Wholesale registration. Step 1/5: Apni shop/business ka naam bhejein.", "Registration", requestId);
    }
    return;
  }
  if (text(request.status) === "Pending") {
    await sendText(phone, "Aapki registration WhatsApp admin ke paas pending hai. Mapping complete hote hi yahin confirmation milega.", "Registration", text(request.id));
    return;
  }
  const interactive = message.interactive as JsonObject | undefined;
  const button = interactive?.button_reply as JsonObject | undefined;
  const buttonId = text(button?.id);
  const body = text((message.text as JsonObject | undefined)?.body);
  const normalized = body.toLowerCase();
  if (text(request.stage) === "AwaitingConfirmation") {
    if (buttonId === "wa-register:confirm" || /^(yes|confirm|submit|haan|ok)$/i.test(normalized)) {
      await submitRegistration(request);
      return;
    }
    if (buttonId === "wa-register:restart" || /^(edit|restart|change)$/i.test(normalized)) {
      await executeDatabaseQuery(
        `UPDATE whatsapp_registration_requests
         SET shop_name='', owner_name='', gstin='', city='', delivery_address='', stage='AwaitingShopName', updated_at=NOW()
         WHERE id=$1`, [text(request.id)]
      );
      await sendText(phone, "Registration restart ho gayi. Step 1/5: Shop/business ka naam bhejein.");
      return;
    }
    await sendText(phone, "Details submit karne ke liye Confirm Registration button dabayein, ya Edit Details choose karein.");
    return;
  }
  if (!body) {
    await sendText(phone, "Please requested detail text mein bhejein.");
    return;
  }
  const requestId = text(request.id);
  if (text(request.stage) === "AwaitingShopName") {
    if (body.length < 2) throw new Error("Valid shop name bhejein.");
    await executeDatabaseQuery(`UPDATE whatsapp_registration_requests SET shop_name=$2,stage='AwaitingOwnerName',updated_at=NOW() WHERE id=$1`, [requestId, compact(body, 160)]);
    await sendText(phone, "Step 2/5: Owner/contact person ka poora naam bhejein.");
    return;
  }
  if (text(request.stage) === "AwaitingOwnerName") {
    if (body.length < 2) throw new Error("Valid owner name bhejein.");
    await executeDatabaseQuery(`UPDATE whatsapp_registration_requests SET owner_name=$2,stage='AwaitingGstin',updated_at=NOW() WHERE id=$1`, [requestId, compact(body, 160)]);
    await sendText(phone, "Step 3/5: 15-character GSTIN bhejein. GST registered nahi hain to NA bhejein.");
    return;
  }
  if (text(request.stage) === "AwaitingGstin") {
    const gstin = body.replace(/\s+/g, "").toUpperCase();
    if (gstin !== "NA" && !/^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/.test(gstin)) {
      await sendText(phone, "GSTIN format valid nahi hai. 15-character GSTIN dobara bhejein, ya GST registered nahi hain to NA bhejein.");
      return;
    }
    await executeDatabaseQuery(`UPDATE whatsapp_registration_requests SET gstin=$2,stage='AwaitingCity',updated_at=NOW() WHERE id=$1`, [requestId, gstin]);
    await sendText(phone, "Step 4/5: Apna city/area bhejein.");
    return;
  }
  if (text(request.stage) === "AwaitingCity") {
    await executeDatabaseQuery(`UPDATE whatsapp_registration_requests SET city=$2,stage='AwaitingAddress',updated_at=NOW() WHERE id=$1`, [requestId, compact(body, 120)]);
    await sendText(phone, "Step 5/5: Complete delivery address bhejein.");
    return;
  }
  if (text(request.stage) === "AwaitingAddress") {
    await executeDatabaseQuery(`UPDATE whatsapp_registration_requests SET delivery_address=$2,stage='AwaitingConfirmation',updated_at=NOW() WHERE id=$1`, [requestId, compact(body, 300)]);
    request = { ...request, delivery_address: compact(body, 300) };
    const refreshed = await executeDatabaseQuery<Record<string, unknown>>(`SELECT * FROM whatsapp_registration_requests WHERE id=$1`, [requestId]);
    request = refreshed.rows[0];
    await sendButtons(phone,
      `Please verify:\nShop: ${text(request.shop_name)}\nOwner: ${text(request.owner_name)}\nGSTIN: ${text(request.gstin)}\nCity: ${text(request.city)}\nAddress: ${text(request.delivery_address)}`,
      [
        { id: "wa-register:confirm", title: "Confirm Registration" },
        { id: "wa-register:restart", title: "Edit Details" }
      ], "Registration", requestId);
  }
}

async function productPricing(counterpartyId: string, productSku: string) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT p.sku, p.name, p.default_gst_rate, p.default_tax_mode, p.mrp, p.rsp, p.offer_price,
            p.minimum_order_quantity AS catalog_minimum_quantity,
            rule.special_rate, rule.cd_percent, rule.tod_percent, rule.minimum_quantity,
            history.rate AS latest_sale_rate
     FROM products p
     LEFT JOIN LATERAL (
       SELECT special_rate, cd_percent, tod_percent, minimum_quantity
       FROM whatsapp_price_rules
       WHERE counterparty_id = $1 AND product_sku = p.sku AND active = TRUE
         AND valid_from <= NOW() AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY updated_at DESC LIMIT 1
     ) rule ON TRUE
     LEFT JOIN LATERAL (
       SELECT rate
       FROM sales_orders
       WHERE product_sku = p.sku AND rate > 0 AND status <> 'Cancelled'
       ORDER BY (shop_id = $1) DESC, created_at DESC
       LIMIT 1
     ) history ON TRUE
     WHERE p.sku = $2 AND p.whatsapp_catalog_enabled = TRUE`,
    [counterpartyId, productSku]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Product ${productSku} was not found.`);
  const fallbackRate = numberValue(row.offer_price) || numberValue(row.rsp) || numberValue(row.mrp) || numberValue(row.latest_sale_rate);
  const rate = numberValue(row.special_rate) || fallbackRate;
  if (!(rate > 0)) throw new Error(`No selling rate is configured for ${productSku}.`);
  return {
    sku: text(row.sku),
    name: text(row.name),
    rate,
    mrp: numberValue(row.mrp),
    cdPercent: numberValue(row.cd_percent),
    todPercent: numberValue(row.tod_percent),
    minimumQuantity: Math.max(1, numberValue(row.catalog_minimum_quantity, 1), numberValue(row.minimum_quantity, 1)),
    gstRate: numberValue(row.default_gst_rate) as GstRate,
    taxMode: (text(row.default_tax_mode) === "Inclusive" ? "Inclusive" : "Exclusive") as TaxMode
  };
}

async function loadCartSession(phone: string): Promise<CartSession | null> {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT selected_product_sku, stage FROM whatsapp_cart_sessions WHERE phone_e164 = $1`,
    [phone]
  );
  if (!result.rows[0]) return null;
  return {
    selectedProductSku: text(result.rows[0].selected_product_sku),
    stage: text(result.rows[0].stage)
  };
}

async function selectCartProduct(profile: RetailerProfile, sku: string, messageId: string) {
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_cart_sessions (
       phone_e164, counterparty_id, selected_product_sku, stage, last_inbound_message_id, created_at, updated_at
     ) VALUES ($1,$2,$3,'AwaitingQuantity',$4,NOW(),NOW())
     ON CONFLICT (phone_e164) DO UPDATE SET
       counterparty_id = EXCLUDED.counterparty_id,
       selected_product_sku = EXCLUDED.selected_product_sku,
       stage = 'AwaitingQuantity',
       last_inbound_message_id = EXCLUDED.last_inbound_message_id,
       updated_at = NOW()`,
    [profile.phoneE164, profile.counterpartyId, sku, messageId || null]
  );
}

async function offerWishlist(profile: RetailerProfile, query: string, messageId: string) {
  const requestedProduct = compact(query, 160);
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_cart_sessions (
       phone_e164, counterparty_id, selected_product_sku, stage, last_inbound_message_id, created_at, updated_at
     ) VALUES ($1,$2,$3,'AwaitingWishlistConfirmation',$4,NOW(),NOW())
     ON CONFLICT (phone_e164) DO UPDATE SET
       counterparty_id = EXCLUDED.counterparty_id,
       selected_product_sku = EXCLUDED.selected_product_sku,
       stage = 'AwaitingWishlistConfirmation',
       last_inbound_message_id = EXCLUDED.last_inbound_message_id,
       updated_at = NOW()`,
    [profile.phoneE164, profile.counterpartyId, requestedProduct, messageId || null]
  );
  return sendButtons(profile.phoneE164,
    `“${requestedProduct}” abhi available nahi hai. Order reject nahi hoga—kya ise wishlist mein add karein?`,
    [
      { id: "wa-wishlist:yes", title: "Add to wishlist" },
      { id: "wa-wishlist:no", title: "No thanks" }
    ], "Wishlist", requestedProduct);
}

async function askWishlistQuantity(profile: RetailerProfile) {
  const session = await loadCartSession(profile.phoneE164);
  if (!session?.selectedProductSku || session.stage !== "AwaitingWishlistConfirmation") {
    await sendText(profile.phoneE164, "Wishlist item expire ho gaya. Product name dobara type karein.");
    return;
  }
  await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions SET stage = 'AwaitingWishlistQuantity', updated_at = NOW() WHERE phone_e164 = $1`,
    [profile.phoneE164]
  );
  await sendButtons(profile.phoneE164,
    `“${session.selectedProductSku}” ki required quantity batayein. Button choose karein ya quantity type karein.`,
    [1, 5, 10].map((quantity) => ({ id: `wa-wishlist-qty:${quantity}`, title: `Qty ${quantity}` })),
    "Wishlist", session.selectedProductSku);
}

async function saveWishlist(profile: RetailerProfile, quantity: number, messageId: string) {
  const session = await loadCartSession(profile.phoneE164);
  if (!session?.selectedProductSku || session.stage !== "AwaitingWishlistQuantity") {
    await sendText(profile.phoneE164, "Wishlist item expire ho gaya. Product name dobara type karein.");
    return "";
  }
  const wishlistId = id("WAW");
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_wishlist_requests (
       id, counterparty_id, phone_e164, salesman_id, requested_product,
       requested_quantity, status, source_message_id, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,NOW(),NOW())`,
    [wishlistId, profile.counterpartyId, profile.phoneE164, profile.salesmanId,
      session.selectedProductSku, Math.max(1, quantity), messageId || null]
  );
  await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions
     SET selected_product_sku = NULL, stage = 'Browsing', last_inbound_message_id = $2, updated_at = NOW()
     WHERE phone_e164 = $1`,
    [profile.phoneE164, messageId || null]
  );
  await sendText(profile.phoneE164,
    `Wishlist saved: ${session.selectedProductSku} × ${Math.max(1, quantity)}. ${profile.salesmanName} ko request mil gayi hai; availability aate hi team update karegi.`,
    "Wishlist", wishlistId);
  return wishlistId;
}

async function declineWishlist(profile: RetailerProfile) {
  await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions SET selected_product_sku = NULL, stage = 'Browsing', updated_at = NOW() WHERE phone_e164 = $1`,
    [profile.phoneE164]
  );
  await sendText(profile.phoneE164, "Theek hai. Dusra product name type karein, ya cart total dekhne ke liye “total” bhejein.");
}

async function loadCartLines(phone: string) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT lines.product_sku, products.name AS product_name, products.mrp,
            lines.quantity AS approved_quantity, lines.rate, lines.cd_percent,
            lines.tod_percent, lines.gst_rate, lines.tax_mode, lines.note
     FROM whatsapp_cart_lines lines
     JOIN products ON products.sku = lines.product_sku
     WHERE lines.phone_e164 = $1
     ORDER BY lines.created_at, lines.product_sku`,
    [phone]
  );
  return result.rows;
}

function cartSummary(lines: Record<string, unknown>[]) {
  let total = 0;
  const details = lines.map((line, index) => {
    const amounts = lineAmounts(line);
    total += amounts.totalAmount;
    return `${index + 1}. ${text(line.product_name)} — ${numberValue(line.approved_quantity)} × Rs.${numberValue(line.rate).toFixed(2)} (${mrpDiscountLabel(line.mrp, line.rate)}) = Rs.${amounts.totalAmount.toFixed(2)}`;
  });
  const visible = details.slice(0, 5);
  if (details.length > visible.length) visible.push(`+ ${details.length - visible.length} more item(s)`);
  return { total, body: visible.join("\n") };
}

async function addCartLines(profile: RetailerProfile, messageId: string, lines: DraftLineInput[]) {
  if (!lines.length) throw new Error("No product was selected.");
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_cart_sessions (
       phone_e164, counterparty_id, selected_product_sku, stage, last_inbound_message_id, created_at, updated_at
     ) VALUES ($1,$2,NULL,'Browsing',$3,NOW(),NOW())
     ON CONFLICT (phone_e164) DO UPDATE SET
       counterparty_id = EXCLUDED.counterparty_id,
       selected_product_sku = NULL,
       stage = 'Browsing',
       last_inbound_message_id = EXCLUDED.last_inbound_message_id,
       updated_at = NOW()`,
    [profile.phoneE164, profile.counterpartyId, messageId || null]
  );
  for (const line of lines) {
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_cart_lines (
         phone_e164, product_sku, quantity, rate, cd_percent, tod_percent,
         gst_rate, tax_mode, note, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
       ON CONFLICT (phone_e164, product_sku) DO UPDATE SET
         quantity = whatsapp_cart_lines.quantity + EXCLUDED.quantity,
         rate = EXCLUDED.rate,
         cd_percent = EXCLUDED.cd_percent,
         tod_percent = EXCLUDED.tod_percent,
         gst_rate = EXCLUDED.gst_rate,
         tax_mode = EXCLUDED.tax_mode,
         note = EXCLUDED.note,
         updated_at = NOW()`,
      [profile.phoneE164, line.productSku, line.quantity, line.rate, line.cdPercent || 0,
        line.todPercent || 0, line.gstRate === "NA" ? 0 : line.gstRate || 0,
        line.taxMode === "Inclusive" ? "Inclusive" : "Exclusive", line.note || ""]
    );
  }
}

async function sendCartChoices(profile: RetailerProfile) {
  const lines = await loadCartLines(profile.phoneE164);
  const summary = cartSummary(lines);
  await sendButtons(profile.phoneE164,
    `Added to cart.\n\n${summary.body}\n\nEstimated total: Rs.${summary.total.toFixed(2)}\n\nAur product add karna hai?`,
    [
      { id: "wa-cart:add", title: "Add another" },
      { id: "wa-cart:checkout", title: "View total" },
      { id: "wa-cart:clear", title: "Clear cart" }
    ], "Cart", profile.phoneE164);
}

async function sendCartCheckout(profile: RetailerProfile) {
  const lines = await loadCartLines(profile.phoneE164);
  if (!lines.length) {
    await sendText(profile.phoneE164, "Your cart is empty. Product name type karein, jaise: Lux");
    return;
  }
  const summary = cartSummary(lines);
  await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions SET stage = 'AwaitingCheckout', updated_at = NOW() WHERE phone_e164 = $1`,
    [profile.phoneE164]
  );
  await sendButtons(profile.phoneE164,
    `Your cart\n\n${summary.body}\n\nEstimated total: Rs.${summary.total.toFixed(2)}\nFinal stock aur rate ${profile.salesmanName} approve karega. Submit karein?`,
    [
      { id: "wa-cart:finalize", title: "Finalize" },
      { id: "wa-cart:add", title: "Add more" },
      { id: "wa-cart:clear", title: "Clear cart" }
    ], "Cart", profile.phoneE164);
}

async function clearCart(profile: RetailerProfile) {
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_lines WHERE phone_e164 = $1`, [profile.phoneE164]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164 = $1`, [profile.phoneE164]);
  await sendText(profile.phoneE164, "Cart cleared. Naya order shuru karne ke liye product name type karein, jaise: Lux");
}

async function finalizeCart(profile: RetailerProfile, messageId: string) {
  const locked = await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions
     SET stage = 'Submitting', last_inbound_message_id = $2, updated_at = NOW()
     WHERE phone_e164 = $1 AND stage <> 'Submitting'
     RETURNING phone_e164`,
    [profile.phoneE164, messageId || null]
  );
  if (!locked.rows[0]) {
    await sendText(profile.phoneE164, "Cart already submit ho raha hai, ya empty hai.");
    return "";
  }
  const rows = await loadCartLines(profile.phoneE164);
  if (!rows.length) {
    await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164 = $1`, [profile.phoneE164]);
    await sendText(profile.phoneE164, "Your cart is empty. Product name type karein, jaise: Lux");
    return "";
  }
  const lines: DraftLineInput[] = rows.map((row) => ({
    productSku: text(row.product_sku),
    quantity: numberValue(row.approved_quantity),
    rate: numberValue(row.rate),
    cdPercent: numberValue(row.cd_percent),
    todPercent: numberValue(row.tod_percent),
    gstRate: numberValue(row.gst_rate) as GstRate,
    taxMode: text(row.tax_mode) === "Inclusive" ? "Inclusive" : "Exclusive",
    note: text(row.note)
  }));
  try {
    const draftId = await createDraft(profile, "Retailer cart", messageId, lines);
    await executeDatabaseQuery(`DELETE FROM whatsapp_cart_lines WHERE phone_e164 = $1`, [profile.phoneE164]);
    await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164 = $1`, [profile.phoneE164]);
    return draftId;
  } catch (error) {
    await executeDatabaseQuery(
      `UPDATE whatsapp_cart_sessions SET stage = 'AwaitingCheckout', updated_at = NOW() WHERE phone_e164 = $1`,
      [profile.phoneE164]
    );
    throw error;
  }
}

async function createDraft(profile: RetailerProfile, source: string, sourceMessageId: string, lines: DraftLineInput[], sourceOfferId = "", notifyReceived = true) {
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
  if (notifyReceived) await sendText(profile.phoneE164,
    `✅ Order request ${draftId} received. ${profile.salesmanName} will verify stock and your special rate, then send the final summary for confirmation.`,
    "Draft", draftId);
  const template = text(process.env.WHATSAPP_SALESPERSON_ALERT_TEMPLATE);
  if (notifyReceived && template) {
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

async function addNaturalTextToCart(profile: RetailerProfile, messageId: string, body: string) {
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
  await addCartLines(profile, messageId, lines);
  await sendCartChoices(profile);
  return profile.phoneE164;
}

function lineAmounts(line: Record<string, unknown>) {
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
    `SELECT l.*, p.name AS product_name, p.mrp FROM whatsapp_order_draft_lines l JOIN products p ON p.sku = l.product_sku WHERE l.draft_id = $1 ORDER BY l.id`, [draftId]
  );
  return { draft: drafts.rows[0], lines: lines.rows };
}

function draftSummary(draftId: string, retailerName: string, rows: Record<string, unknown>[]) {
  let total = 0;
  const details = rows.map((line, index) => {
    const amounts = lineAmounts(line as never);
    total += amounts.totalAmount;
    return `${index + 1}. ${text(line.product_name)}\n   ${mrpDiscountLabel(line.mrp, line.rate)}\n   ${numberValue(line.approved_quantity)} × ₹${numberValue(line.rate).toFixed(2)} | CD ${numberValue(line.cd_percent)}% | TOD ${numberValue(line.tod_percent)}%\n   ₹${amounts.totalAmount.toFixed(2)} incl. tax`;
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
    try {
      await handleRetailerRegistration(message, from, messageId);
    } catch (error) {
      await sendText(from, error instanceof Error ? error.message : "Registration detail process nahi ho payi. Dobara try karein.").catch(() => undefined);
    }
    return;
  }
  try {
    if (messageType === "order" && message.order && typeof message.order === "object") {
      await createDraftFromCatalogOrder(profile, messageId, message.order as JsonObject);
      return;
    }
    const interactive = message.interactive as JsonObject | undefined;
    const flowReply = interactive?.nfm_reply as JsonObject | undefined;
    if (flowReply?.response_json) {
      const response = JSON.parse(text(flowReply.response_json)) as JsonObject;
      const kind = /damage/i.test(text(response.kind || response.request_type)) ? "Damage" : "Return";
      const details = [response.order_id, response.product, response.quantity, response.reason, response.details].map(text).filter(Boolean).join(" | ");
      const ticketId = await createServiceTicket(profile, {
        kind,
        subject: `${kind} request from ${profile.retailerName}`,
        details,
        linkedOrderId: text(response.order_id)
      });
      await sendText(from, `${kind} ticket ${ticketId} create ho gaya. Photo/proof isi chat mein attach kar sakte hain.`, "ServiceTicket", ticketId);
      return;
    }
    const buttonReply = interactive?.button_reply as JsonObject | undefined;
    const listReply = interactive?.list_reply as JsonObject | undefined;
    const buttonId = text(buttonReply?.id || listReply?.id);
    if (buttonId === "wa-menu:catalogue") {
      await sendCatalog(profile);
      return;
    }
    if (buttonId === "wa-menu:order") {
      await sendProductPicker(from, "", profile, messageId, "Naya order shuru karein.");
      return;
    }
    if (buttonId === "wa-menu:status") {
      await sendLatestOrderStatus(profile);
      return;
    }
    if (buttonId === "wa-menu:reorder") {
      await offerLatestReorder(profile);
      return;
    }
    if (buttonId === "wa-menu:account") {
      await sendAccountSummary(profile);
      return;
    }
    if (buttonId === "wa-menu:wishlist") {
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_cart_sessions (phone_e164,counterparty_id,selected_product_sku,stage,last_inbound_message_id,created_at,updated_at)
         VALUES ($1,$2,NULL,'AwaitingWishlistProduct',$3,NOW(),NOW())
         ON CONFLICT (phone_e164) DO UPDATE SET selected_product_sku=NULL,stage='AwaitingWishlistProduct',last_inbound_message_id=EXCLUDED.last_inbound_message_id,updated_at=NOW()`,
        [profile.phoneE164, profile.counterpartyId, messageId]
      );
      await sendText(from, "Wishlist mein kaunsa product chahiye? Product ka naam type karein.");
      return;
    }
    if (buttonId === "wa-menu:service") {
      await sendButtons(from, "Service request select karein:", [
        { id: "wa-service:return", title: "Return" },
        { id: "wa-service:damage", title: "Damage" },
        { id: "wa-menu:agent", title: "Talk to sales" }
      ], "ServiceMenu", profile.counterpartyId);
      return;
    }
    if (buttonId === "wa-service:return" || buttonId === "wa-service:damage") {
      const kind = buttonId.endsWith("damage") ? "Damage" : "Return";
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_cart_sessions (phone_e164,counterparty_id,selected_product_sku,stage,last_inbound_message_id,created_at,updated_at)
         VALUES ($1,$2,$3,'AwaitingServiceDetails',$4,NOW(),NOW())
         ON CONFLICT (phone_e164) DO UPDATE SET selected_product_sku=EXCLUDED.selected_product_sku,stage='AwaitingServiceDetails',last_inbound_message_id=EXCLUDED.last_inbound_message_id,updated_at=NOW()`,
        [profile.phoneE164, profile.counterpartyId, kind, messageId]
      );
      await sendText(from, `${kind} request ke liye order number, product, quantity aur problem ek message mein bhejein.`);
      return;
    }
    if (buttonId === "wa-menu:agent") {
      const ticketId = await createServiceTicket(profile, { kind: "Live Chat", subject: "Retailer requested live salesperson" });
      await executeDatabaseQuery(`UPDATE whatsapp_messages SET related_entity_type='ServiceTicket',related_entity_id=$2 WHERE id=$1`, [saved, ticketId]);
      await executeDatabaseQuery(
        `UPDATE whatsapp_service_tickets SET unread_staff_count=unread_staff_count+1,last_message_preview='Live chat requested',last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [ticketId]
      );
      await sendText(from, `${profile.salesmanName} ko live-chat request bhej di gayi hai. Aap apna message yahin type kar sakte hain.`, "ServiceTicket", ticketId);
      return;
    }
    if (buttonId.startsWith("wa-product:")) {
      const sku = decodeURIComponent(buttonId.slice("wa-product:".length));
      const pricing = await productPricing(profile.counterpartyId, sku);
      await selectCartProduct(profile, sku, messageId);
      const quantities = quantityChoices(pricing.minimumQuantity);
      await sendButtons(from,
        `${pricing.name}\n${mrpDiscountLabel(pricing.mrp, pricing.rate)}\nYour rate: Rs.${pricing.rate.toFixed(2)}\nMinimum order: ${pricing.minimumQuantity}\nQuantity choose karein, ya quantity type karein.`,
        quantities.map((quantity) => ({ id: `wa-qty:${encodeURIComponent(sku)}:${quantity}`, title: `Qty ${quantity}` })),
        "ProductSelection", sku);
      return;
    }
    if (buttonId === "wa-guide:start") {
      await sendProductPicker(from);
      return;
    }
    if (buttonId.startsWith("wa-qty:")) {
      const match = buttonId.match(/^wa-qty:(.+):(\d+(?:\.\d+)?)$/);
      if (!match) throw new Error("Invalid product quantity selection.");
      const sku = decodeURIComponent(match[1]);
      const pricing = await productPricing(profile.counterpartyId, sku);
      const quantity = Math.max(pricing.minimumQuantity, numberValue(match[2], pricing.minimumQuantity));
      await addCartLines(profile, messageId, [{
        productSku: sku,
        quantity,
        rate: pricing.rate,
        cdPercent: pricing.cdPercent,
        todPercent: pricing.todPercent,
        gstRate: pricing.gstRate,
        taxMode: pricing.taxMode
      }]);
      await sendCartChoices(profile);
      return;
    }
    if (buttonId === "wa-wishlist:yes") {
      await askWishlistQuantity(profile);
      return;
    }
    if (buttonId === "wa-wishlist:no") {
      await declineWishlist(profile);
      return;
    }
    if (buttonId.startsWith("wa-wishlist-qty:")) {
      const quantity = numberValue(buttonId.slice("wa-wishlist-qty:".length));
      if (!(quantity > 0)) throw new Error("Invalid wishlist quantity.");
      await saveWishlist(profile, quantity, messageId);
      return;
    }
    if (buttonId === "wa-cart:add") {
      await executeDatabaseQuery(
        `UPDATE whatsapp_cart_sessions SET stage = 'Browsing', selected_product_sku = NULL, updated_at = NOW() WHERE phone_e164 = $1`,
        [profile.phoneE164]
      );
      await sendText(from, "Next product ka naam type karein, jaise: Lux");
      return;
    }
    if (buttonId === "wa-cart:checkout") {
      await sendCartCheckout(profile);
      return;
    }
    if (buttonId === "wa-cart:clear") {
      await clearCart(profile);
      return;
    }
    if (buttonId === "wa-cart:finalize") {
      await finalizeCart(profile, messageId);
      return;
    }
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
    if (buttonId.startsWith("wa-reorder:")) {
      await createReorder(profile, buttonId.slice("wa-reorder:".length), messageId);
      return;
    }
    if (buttonId === "wa-ignore:wishlist") {
      await sendText(from, "Theek hai. Jab zarurat ho product ka naam dobara bhej dein.");
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
    if (messageType === "location") {
      const location = message.location as JsonObject | undefined;
      const latitude = numberValue(location?.latitude, Number.NaN);
      const longitude = numberValue(location?.longitude, Number.NaN);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Location coordinates are invalid.");
      await executeDatabaseQuery(
        `UPDATE counterparties SET latitude=$2,longitude=$3,location_label=$4 WHERE id=$1`,
        [profile.counterpartyId, latitude, longitude, compact(text(location?.name || location?.address || "WhatsApp delivery location"), 240)]
      );
      await sendText(from, `Delivery location ${profile.retailerName} ke account mein update ho gayi.`, "Location", profile.counterpartyId);
      return;
    }
    if (messageType === "audio") {
      const audio = message.audio as JsonObject | undefined;
      const liveChat = await executeDatabaseQuery<{ id: string }>(
        `SELECT id FROM whatsapp_service_tickets WHERE counterparty_id=$1 AND kind='Live Chat' AND status='Open' ORDER BY updated_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (liveChat.rows[0]?.id) {
        await executeDatabaseQuery(`UPDATE whatsapp_messages SET related_entity_type='ServiceTicket',related_entity_id=$2 WHERE id=$1`, [saved, liveChat.rows[0].id]);
        await executeDatabaseQuery(
          `UPDATE whatsapp_service_tickets SET unread_staff_count=unread_staff_count+1,last_message_preview='Voice note',last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
          [liveChat.rows[0].id]
        );
        return;
      }
      const ticketId = await createServiceTicket(profile, {
        kind: "Voice Order",
        subject: "Retailer sent a voice order",
        details: "Voice note requires salesperson review before an order is created.",
        mediaId: text(audio?.id),
        mediaType: text(audio?.mime_type) || "audio"
      });
      await sendText(from, `Voice order ${ticketId} mil gaya. ${profile.salesmanName} ise sun kar order draft confirm karega.`, "ServiceTicket", ticketId);
      return;
    }
    if (messageType === "image" || messageType === "document") {
      const media = message[messageType] as JsonObject | undefined;
      const openTicket = await executeDatabaseQuery<Record<string, unknown>>(
        `SELECT id,kind FROM whatsapp_service_tickets WHERE counterparty_id=$1 AND status='Open' ORDER BY updated_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (openTicket.rows[0]) {
        const ticketId = text(openTicket.rows[0].id);
        await executeDatabaseQuery(`UPDATE whatsapp_messages SET related_entity_type='ServiceTicket',related_entity_id=$2 WHERE id=$1`, [saved, ticketId]);
        await executeDatabaseQuery(
          `UPDATE whatsapp_service_tickets
           SET media_id=$2,media_type=$3,details=CASE WHEN kind='Live Chat' THEN details ELSE CONCAT(details,CASE WHEN details='' THEN '' ELSE E'\n' END,$4::text) END,
               unread_staff_count=unread_staff_count+1,last_message_preview=$4,last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
          [ticketId, text(media?.id), text(media?.mime_type) || messageType, text(media?.caption) || `${messageType} received`]
        );
        if (text(openTicket.rows[0].kind) !== "Live Chat") await sendText(from, `Proof ${ticketId} ticket mein attach ho gaya. Team review karegi.`);
      } else {
        await sendText(from, "Photo/document mil gaya. Return ya damage claim shuru karne ke liye *return* ya *damage* bhejein, phir proof dobara attach karein.");
      }
      return;
    }
    if (/^(stop|unsubscribe|pause)$/i.test(normalized)) {
      await executeDatabaseQuery(`UPDATE whatsapp_retailers SET marketing_opt_in=FALSE,paused_at=NOW(),updated_at=NOW() WHERE counterparty_id=$1`, [profile.counterpartyId]);
      await sendText(from, "Promotional updates pause kar diye gaye hain. Order aur service messages chalte rahenge. Dobara shuru karne ke liye START bhejein.");
      return;
    }
    if (/^(start|subscribe|resume)$/i.test(normalized)) {
      await executeDatabaseQuery(`UPDATE whatsapp_retailers SET marketing_opt_in=TRUE,paused_at=NULL,updated_at=NOW() WHERE counterparty_id=$1`, [profile.counterpartyId]);
      await sendText(from, `Promotional updates active hain, ${profile.retailerName}. Catalogue ke liye *catalogue* bhejein.`);
      return;
    }
    if (/^(status|track|track order|order status)$/i.test(normalized)) {
      await sendLatestOrderStatus(profile);
      return;
    }
    if (/^(repeat|reorder|repeat order|last order)$/i.test(normalized)) {
      await offerLatestReorder(profile);
      return;
    }
    if (/^(account|ledger|balance|payment due|outstanding)$/i.test(normalized)) {
      await sendAccountSummary(profile);
      return;
    }
    if (/^(salesman|agent|live chat|talk to sales|human)$/i.test(normalized)) {
      const ticketId = await createServiceTicket(profile, { kind: "Live Chat", subject: "Retailer requested live salesperson" });
      await executeDatabaseQuery(
        `UPDATE whatsapp_messages SET related_entity_type='ServiceTicket',related_entity_id=$2 WHERE id=$1`,
        [saved, ticketId]
      );
      await executeDatabaseQuery(
        `UPDATE whatsapp_service_tickets SET unread_staff_count=unread_staff_count+1,last_message_preview=$2,last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
        [ticketId, compact(body || "Live chat requested", 240)]
      );
      await sendText(from, `${profile.salesmanName} ko live-chat request ${ticketId} bhej di gayi hai. Aap apna message yahin type kar sakte hain.`, "ServiceTicket", ticketId);
      return;
    }
    if (/^(return|damage|damaged|complaint|claim)$/i.test(normalized)) {
      const kind = /damage|damaged/i.test(normalized) ? "Damage" : "Return";
      const serviceFlowId = text(process.env.WHATSAPP_SERVICE_FLOW_ID);
      if (serviceFlowId) {
        await sendFlow(from, serviceFlowId, "Order number, product, quantity aur problem fill karke request submit karein.", "Start request", id("WAFLOW"), "ServiceFlow", profile.counterpartyId);
        return;
      }
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_cart_sessions (phone_e164,counterparty_id,selected_product_sku,stage,last_inbound_message_id,created_at,updated_at)
         VALUES ($1,$2,$3,'AwaitingServiceDetails',$4,NOW(),NOW())
         ON CONFLICT (phone_e164) DO UPDATE SET selected_product_sku=EXCLUDED.selected_product_sku,stage='AwaitingServiceDetails',last_inbound_message_id=EXCLUDED.last_inbound_message_id,updated_at=NOW()`,
        [profile.phoneE164, profile.counterpartyId, kind, messageId]
      );
      await sendText(from, `${kind} request ke liye order number, product, quantity aur problem ek message mein bhejein. Uske baad photo bhi attach kar sakte hain.`);
      return;
    }
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
    if (/^(demo|demo order|how to order|help|guide)$/i.test(normalized)) {
      await sendOrderGuide(profile);
      return;
    }
    if (/^(hi|hello|hey|namaste|menu)$/i.test(normalized)) {
      await sendMainMenu(profile);
      return;
    }
    if (/^(catalog|catalogue|catlog)$/i.test(normalized)) {
      await sendCatalog(profile);
      return;
    }
    const productSearch = /^(?:search|find|product|item)\s+(.+)$/i.exec(body);
    if (productSearch) {
      await sendProductPicker(from, productSearch[1], profile, messageId);
      return;
    }
    if (body) {
      const pendingChange = await executeDatabaseQuery<{ id: string }>(
        `SELECT id FROM whatsapp_order_drafts WHERE counterparty_id = $1 AND status = 'Change Requested' ORDER BY created_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (pendingChange.rows[0]) {
        await executeDatabaseQuery(
          `UPDATE whatsapp_order_drafts SET status = 'Needs Review', note = CONCAT(note, CASE WHEN note = '' THEN '' ELSE ' | ' END, $2::text) WHERE id = $1`,
          [pendingChange.rows[0].id, `Retailer requested: ${body}`]
        );
        await sendText(from, "Change request received. Your salesperson will review stock and rate, then send the revised order here.", "Draft", pendingChange.rows[0].id);
        return;
      }
    }
    if (body) {
      const cartSession = await loadCartSession(profile.phoneE164);
      if (cartSession?.stage === "AwaitingWishlistProduct") {
        await offerWishlist(profile, body, messageId);
        return;
      }
      if (cartSession?.stage === "AwaitingServiceDetails") {
        const kind = cartSession.selectedProductSku === "Damage" ? "Damage" : "Return";
        const linkedOrder = body.match(/(?:SO|WAD|WAO)-[A-Z0-9-]+/i)?.[0] || "";
        const ticketId = await createServiceTicket(profile, { kind, subject: `${kind} request from ${profile.retailerName}`, details: body, linkedOrderId: linkedOrder });
        await executeDatabaseQuery(`UPDATE whatsapp_cart_sessions SET selected_product_sku=NULL,stage='Browsing',updated_at=NOW() WHERE phone_e164=$1`, [profile.phoneE164]);
        await sendText(from, `${kind} ticket ${ticketId} create ho gaya. Photo/proof isi chat mein bhej dein; ${profile.salesmanName} review karega.`, "ServiceTicket", ticketId);
        return;
      }
      const liveChat = await executeDatabaseQuery<Record<string, unknown>>(
        `SELECT id FROM whatsapp_service_tickets WHERE counterparty_id=$1 AND kind='Live Chat' AND status='Open' ORDER BY created_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (liveChat.rows[0] && !/^(menu|catalog|catalogue|order|status|track|stop)$/i.test(normalized)) {
        await executeDatabaseQuery(
          `UPDATE whatsapp_messages SET related_entity_type='ServiceTicket',related_entity_id=$2 WHERE id=$1`,
          [saved, text(liveChat.rows[0].id)]
        );
        await executeDatabaseQuery(
          `UPDATE whatsapp_service_tickets
           SET unread_staff_count=unread_staff_count+1,last_message_preview=$2,last_message_at=NOW(),updated_at=NOW()
           WHERE id=$1`,
          [text(liveChat.rows[0].id), compact(body, 240)]
        );
        return;
      }
      if (cartSession?.stage === "AwaitingWishlistConfirmation" && /^(yes|y|haan|ha|ok|okay|add)$/i.test(normalized)) {
        await askWishlistQuantity(profile);
        return;
      }
      if (cartSession?.stage === "AwaitingWishlistConfirmation" && /^(no|n|nahi|nahin|cancel)$/i.test(normalized)) {
        await declineWishlist(profile);
        return;
      }
      if (cartSession?.stage === "AwaitingWishlistQuantity" && /^\d+(?:\.\d+)?$/.test(normalized)) {
        await saveWishlist(profile, numberValue(normalized), messageId);
        return;
      }
      if (cartSession?.stage === "AwaitingQuantity" && cartSession.selectedProductSku && /^\d+(?:\.\d+)?$/.test(normalized)) {
        const pricing = await productPricing(profile.counterpartyId, cartSession.selectedProductSku);
        const requestedQuantity = numberValue(normalized, pricing.minimumQuantity);
        if (requestedQuantity < pricing.minimumQuantity) {
          await sendButtons(from,
            `${pricing.name} ki minimum order quantity ${pricing.minimumQuantity} hai. Please minimum ya usse zyada quantity choose karein.`,
            quantityChoices(pricing.minimumQuantity).map((quantity) => ({ id: `wa-qty:${encodeURIComponent(pricing.sku)}:${quantity}`, title: `Qty ${quantity}` })),
            "MinimumQuantity", pricing.sku);
          return;
        }
        const quantity = requestedQuantity;
        await addCartLines(profile, messageId, [{
          productSku: pricing.sku,
          quantity,
          rate: pricing.rate,
          cdPercent: pricing.cdPercent,
          todPercent: pricing.todPercent,
          gstRate: pricing.gstRate,
          taxMode: pricing.taxMode
        }]);
        await sendCartChoices(profile);
        return;
      }
      if (cartSession?.stage === "AwaitingCheckout" && /^(yes|y|finalize|confirm|haan|ha|ok|okay|done)$/i.test(normalized)) {
        await finalizeCart(profile, messageId);
        return;
      }
      if (/^(cart|total|checkout|view total)$/i.test(normalized)) {
        await sendCartCheckout(profile);
        return;
      }
      if (/^(clear|clear cart|cancel cart)$/i.test(normalized)) {
        await clearCart(profile);
        return;
      }
      const hasExplicitOrderQuantity = /\b\d+(?:\.\d+)?\s*(?:cartons?|cases?|pcs?|pieces?|boxes?|qty|units?|dozens?)\b/i.test(body);
      if (!hasExplicitOrderQuantity && body.split(/\s+/).length <= 4) {
        await sendProductPicker(from, body, profile, messageId);
        return;
      }
      await addNaturalTextToCart(profile, messageId, body);
    }
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
  const businessAccountId = text(process.env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const catalogId = text(process.env.WHATSAPP_CATALOG_ID);
  if (!accessToken || !phoneNumberId || !businessAccountId || !catalogId) throw new Error("WhatsApp phone, WABA, token and Catalogue ID are required.");
  const linkResponse = await fetch(`${graphBase}/${businessAccountId}/product_catalogs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({ catalog_id: catalogId })
  });
  const linkBody = await linkResponse.json() as JsonObject;
  if (!linkResponse.ok || linkBody.success === false) {
    const error = linkBody.error as JsonObject | undefined;
    const details = text((error?.error_data as JsonObject | undefined)?.details);
    throw new Error([
      text(error?.message),
      text(error?.error_user_title),
      text(error?.error_user_msg),
      details,
      error?.code ? `Code ${text(error.code)}` : ""
    ].filter(Boolean).join(" — ") || `Meta catalogue link failed (${linkResponse.status}).`);
  }
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
  const catalogId = text(process.env.WHATSAPP_CATALOG_ID);
  const appSecret = text(process.env.WHATSAPP_APP_SECRET);
  if (!accessToken || !businessAccountId || !phoneNumberId) throw new Error("WhatsApp credentials are incomplete.");
  const graphGet = async (path: string) => {
    const response = await fetch(`${graphBase}/${path}`, { headers: { authorization: `Bearer ${accessToken}` } });
    const body = await response.json() as JsonObject;
    return response.ok ? { ok: true, body } : { ok: false, error: text((body.error as JsonObject | undefined)?.message) || `HTTP ${response.status}` };
  };
  const [phone, businessAccount, catalogAsset, subscriptions, catalogs, commerceSettings, tokenDebug] = await Promise.all([
    graphGet(`${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,platform_type,code_verification_status`),
    graphGet(`${businessAccountId}?fields=id,name,owner_business_info`),
    catalogId ? graphGet(`${catalogId}?fields=id,name,business`) : Promise.resolve({ ok: false, error: "Catalogue ID is missing." }),
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
    businessAccount,
    catalogAsset,
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
  const isAdmin = isWhatsAppAdminUser(currentUser);
  const filter = isAdmin ? "" : "WHERE wr.salesman_id = $1";
  const params = isAdmin ? [] : [currentUser.id];
  const [retailers, whatsappOnlyRetailers, rules, offers, drafts, lines, wishlists, registrations, messages, imageStats, catalogProducts, tickets, orderEvents, campaigns, analytics] = await Promise.all([
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_retailers wr JOIN counterparties c ON c.id = wr.counterparty_id JOIN users u ON u.id = wr.salesman_id ${filter} ORDER BY c.name`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT id, name, mobile_number, city, contact_person
       FROM counterparties
       WHERE type = 'Shop' AND channel_scope = 'WhatsApp'
       ORDER BY id`),
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
      `SELECT w.*, c.name AS retailer_name, u.full_name AS salesman_name
       FROM whatsapp_wishlist_requests w
       JOIN counterparties c ON c.id = w.counterparty_id
       JOIN users u ON u.id = w.salesman_id
       ${isAdmin ? "" : "WHERE w.salesman_id = $1"}
       ORDER BY w.created_at DESC LIMIT 300`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT * FROM whatsapp_registration_requests
       ${isAdmin ? "WHERE status = 'Pending'" : "WHERE FALSE"}
       ORDER BY submitted_at DESC NULLS LAST, created_at DESC LIMIT 300`),
    executeDatabaseQuery<Record<string, unknown>>(
      isAdmin
        ? `SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT 100`
        : `SELECT m.* FROM whatsapp_messages m
           LEFT JOIN whatsapp_retailers wr ON wr.phone_e164 = m.phone_e164
           WHERE wr.salesman_id = $1 OR wr.counterparty_id IS NULL
           ORDER BY m.created_at DESC LIMIT 100`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `WITH latest_rates AS (
         SELECT DISTINCT ON (product_sku) product_sku,rate
         FROM sales_orders WHERE rate>0 AND status<>'Cancelled'
         ORDER BY product_sku,created_at DESC
       ) SELECT
         COUNT(*) FILTER (WHERE p.whatsapp_catalog_enabled = TRUE)::int AS selected,
         COUNT(*) FILTER (WHERE p.whatsapp_catalog_enabled = TRUE AND (COALESCE(p.offer_price, p.rsp, p.mrp, 0) > 0 OR latest.rate > 0))::int AS eligible,
         COUNT(*) FILTER (WHERE p.whatsapp_catalog_enabled = TRUE AND (COALESCE(p.offer_price, p.rsp, p.mrp, 0) > 0 OR latest.rate > 0) AND p.catalog_image_key IS NOT NULL)::int AS with_image
       FROM products p
       LEFT JOIN latest_rates latest ON latest.product_sku=p.sku`),
    executeDatabaseQuery<Record<string, unknown>>(
      isAdmin
        ? `WITH latest_rates AS (
             SELECT DISTINCT ON (product_sku) product_sku,rate
             FROM sales_orders WHERE rate>0 AND status<>'Cancelled'
             ORDER BY product_sku,created_at DESC
           ) SELECT p.sku, p.name, p.brand, p.size, p.mrp, p.minimum_order_quantity,
                  p.catalog_image_key, p.catalog_image_updated_at,
                  COALESCE(p.offer_price, p.rsp, p.mrp, latest.rate, 0) AS selling_rate
           FROM products p
           LEFT JOIN latest_rates latest ON latest.product_sku=p.sku
           WHERE p.whatsapp_catalog_enabled=TRUE
           ORDER BY p.name`
        : `SELECT NULL WHERE FALSE`),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT ticket.*,c.name AS retailer_name,u.full_name AS salesman_name
       FROM whatsapp_service_tickets ticket
       JOIN counterparties c ON c.id=ticket.counterparty_id
       JOIN users u ON u.id=ticket.salesman_id
       ${isAdmin ? "" : "WHERE ticket.salesman_id=$1"}
       ORDER BY ticket.updated_at DESC LIMIT 200`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT events.* FROM whatsapp_order_events events
       JOIN whatsapp_order_drafts draft ON draft.id=events.draft_id
       ${isAdmin ? "" : "WHERE draft.salesman_id=$1"}
       ORDER BY events.created_at DESC LIMIT 300`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      isAdmin ? `SELECT * FROM whatsapp_broadcast_campaigns ORDER BY created_at DESC LIMIT 100` : `SELECT NULL WHERE FALSE`),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT
         COUNT(*) FILTER (WHERE direction='Outbound')::int AS outbound,
         COUNT(*) FILTER (WHERE direction='Inbound')::int AS inbound,
         COUNT(*) FILTER (WHERE direction='Outbound' AND LOWER(status)='sent')::int AS sent,
         COUNT(*) FILTER (WHERE direction='Outbound' AND LOWER(status)='delivered')::int AS delivered,
         COUNT(*) FILTER (WHERE direction='Outbound' AND LOWER(status)='read')::int AS read,
         COUNT(*) FILTER (WHERE direction='Outbound' AND LOWER(status)='failed')::int AS failed,
         COUNT(DISTINCT phone_e164)::int AS conversations
       FROM whatsapp_messages WHERE created_at>=NOW()-INTERVAL '30 days'`)
  ]);
  const visibleDraftIds = new Set(drafts.rows.map((row) => text(row.id)));
  const catalogToken = text(process.env.WHATSAPP_CATALOG_FEED_TOKEN);
  const publicApi = (process.env.PUBLIC_API_URL || "https://b2b-v8kb.onrender.com").replace(/\/$/, "");
  const publicWeb = (process.env.PUBLIC_WEB_URL || "https://b2b-api-theta.vercel.app").replace(/\/$/, "");
  const displayPhone = text(process.env.WHATSAPP_DISPLAY_PHONE || process.env.WHATSAPP_BUSINESS_PHONE);
  return {
    permissions: { whatsappAdmin: isAdmin },
    configuration: {
      connected: isAdmin && configured(),
      phoneNumberIdPresent: isAdmin && Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
      catalogIdPresent: isAdmin && Boolean(process.env.WHATSAPP_CATALOG_ID),
      verifyTokenPresent: isAdmin && Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
      appSecretPresent: isAdmin && Boolean(process.env.WHATSAPP_APP_SECRET),
      mode: isAdmin ? (configured() ? "Live" : "Simulation") : "Sales workspace"
    },
    retailers: isAdmin ? retailers.rows.map(mapRetailer) : [],
    whatsappOnlyRetailers: isAdmin ? whatsappOnlyRetailers.rows.map((row) => ({
      id: text(row.id),
      name: text(row.name),
      mobileNumber: text(row.mobile_number),
      city: text(row.city),
      contactPerson: text(row.contact_person)
    })) : [],
    priceRules: isAdmin ? rules.rows : [],
    offers: isAdmin ? offers.rows : [],
    drafts: drafts.rows.map((draft) => ({ ...draft, lines: lines.rows.filter((line) => visibleDraftIds.has(text(line.draft_id)) && text(line.draft_id) === text(draft.id)) })),
    wishlists: wishlists.rows,
    registrations: isAdmin ? registrations.rows : [],
    messages: isAdmin ? messages.rows : [],
    serviceTickets: tickets.rows,
    orderEvents: orderEvents.rows,
    campaigns: isAdmin ? campaigns.rows : [],
    analytics: {
      outbound: numberValue(analytics.rows[0]?.outbound),
      inbound: numberValue(analytics.rows[0]?.inbound),
      sent: numberValue(analytics.rows[0]?.sent),
      delivered: numberValue(analytics.rows[0]?.delivered),
      read: numberValue(analytics.rows[0]?.read),
      failed: numberValue(analytics.rows[0]?.failed),
      conversations: numberValue(analytics.rows[0]?.conversations),
      completedOrders: drafts.rows.filter((row) => text(row.status) === "Completed").length
    },
    catalogImageStats: {
      selected: isAdmin ? numberValue(imageStats.rows[0]?.selected) : 0,
      eligible: isAdmin ? numberValue(imageStats.rows[0]?.eligible) : 0,
      withImage: isAdmin ? numberValue(imageStats.rows[0]?.with_image) : 0
    },
    catalogProducts: isAdmin ? catalogProducts.rows.map((row) => ({
      sku: text(row.sku),
      name: text(row.name),
      brand: text(row.brand),
      size: text(row.size),
      mrp: numberValue(row.mrp),
      sellingRate: numberValue(row.selling_rate),
      minimumOrderQuantity: Math.max(1, numberValue(row.minimum_order_quantity, 1)),
      imageUrl: row.catalog_image_key && catalogToken
        ? `${publicApi}/whatsapp/catalog/images/${encodeURIComponent(text(row.sku))}?token=${encodeURIComponent(catalogToken)}&v=${encodeURIComponent(text(row.catalog_image_updated_at))}`
        : `${publicWeb}/business-connect-icon-512.png`
    })) : [],
    catalogFeedUrl: isAdmin
      ? `${process.env.PUBLIC_API_URL || "https://b2b-v8kb.onrender.com"}/whatsapp/catalog/feed.csv?token=${encodeURIComponent(process.env.WHATSAPP_CATALOG_FEED_TOKEN || "SET_A_SECRET")}`
      : "",
    retailerEntryLink: isAdmin && displayPhone
      ? `https://wa.me/${normalizeWhatsAppPhone(displayPhone)}?text=${encodeURIComponent("Hi, I want to register with Aapoorti Wholesale")}`
      : ""
  };
}

export async function getWhatsAppPendingOrderCount(currentUser: StaffUser) {
  const isAdmin = isWhatsAppAdminUser(currentUser);
  const params = isAdmin ? [] : [currentUser.id];
  const [orders, chats] = await Promise.all([
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT COUNT(*)::int AS count FROM whatsapp_order_drafts
       WHERE status IN ('Needs Review', 'Change Requested') ${isAdmin ? "" : "AND salesman_id = $1"}`, params),
    executeDatabaseQuery<Record<string, unknown>>(
      `SELECT COALESCE(SUM(unread_staff_count),0)::int AS count FROM whatsapp_service_tickets
       WHERE kind='Live Chat' AND status='Open' ${isAdmin ? "" : "AND salesman_id = $1"}`, params)
  ]);
  const orderCount = numberValue(orders.rows[0]?.count);
  const chatCount = numberValue(chats.rows[0]?.count);
  return { count: orderCount + chatCount, orderCount, chatCount };
}

function liveChatMessageBody(row: Record<string, unknown>) {
  const payload = (row.payload_json || {}) as JsonObject;
  const request = (payload.request || {}) as JsonObject;
  const inboundText = (payload.text || {}) as JsonObject;
  const outboundText = (request.text || {}) as JsonObject;
  const inboundInteractive = (payload.interactive || {}) as JsonObject;
  const outboundInteractive = (request.interactive || {}) as JsonObject;
  const button = (inboundInteractive.button_reply || {}) as JsonObject;
  const list = (inboundInteractive.list_reply || {}) as JsonObject;
  const body = (outboundInteractive.body || {}) as JsonObject;
  return text(inboundText.body || outboundText.body || button.title || list.title || body.text)
    || (text(row.message_type) === "audio" ? "Voice note" : text(row.message_type) === "image" ? "Image" : text(row.message_type) === "document" ? "Document" : text(row.message_type));
}

async function loadLiveChatTicket(ticketId: string, currentUser: StaffUser) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT ticket.*,c.name AS retailer_name,u.full_name AS salesman_name
     FROM whatsapp_service_tickets ticket
     JOIN counterparties c ON c.id=ticket.counterparty_id
     JOIN users u ON u.id=ticket.salesman_id
     WHERE ticket.id=$1 AND ticket.kind='Live Chat'`, [ticketId]
  );
  const ticket = result.rows[0];
  if (!ticket) throw new Error("Live chat not found.");
  if (!isWhatsAppAdminUser(currentUser) && numberValue(ticket.salesman_id) !== currentUser.id) {
    throw new Error("This retailer is mapped to another salesperson.");
  }
  return ticket;
}

export async function getWhatsAppLiveChat(currentUser: StaffUser, selectedTicketId = "") {
  const isAdmin = isWhatsAppAdminUser(currentUser);
  const params = isAdmin ? [] : [currentUser.id];
  const tickets = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT ticket.*,c.name AS retailer_name,u.full_name AS salesman_name
     FROM whatsapp_service_tickets ticket
     JOIN counterparties c ON c.id=ticket.counterparty_id
     JOIN users u ON u.id=ticket.salesman_id
     WHERE ticket.kind='Live Chat' ${isAdmin ? "" : "AND ticket.salesman_id=$1"}
     ORDER BY CASE WHEN ticket.status='Open' THEN 0 ELSE 1 END,
              ticket.last_message_at DESC NULLS LAST,ticket.updated_at DESC LIMIT 100`, params
  );
  const selected = selectedTicketId && tickets.rows.some((ticket) => text(ticket.id) === selectedTicketId)
    ? selectedTicketId
    : text(tickets.rows[0]?.id);
  const selectedTicket = tickets.rows.find((ticket) => text(ticket.id) === selected);
  const messages = selectedTicket
    ? await executeDatabaseQuery<Record<string, unknown>>(
      `SELECT id,wa_message_id,direction,message_type,status,payload_json,error_message,created_at
       FROM whatsapp_messages
       WHERE phone_e164=$1 AND created_at >= $2::timestamptz
         AND ($3::timestamptz IS NULL OR created_at <= $3::timestamptz + INTERVAL '5 minutes')
       ORDER BY created_at ASC,id ASC LIMIT 500`,
      [text(selectedTicket.phone_e164), selectedTicket.created_at, selectedTicket.resolved_at || null])
    : { rows: [] as Record<string, unknown>[] };
  return {
    selectedTicketId: selected,
    unreadTotal: tickets.rows.reduce((total, ticket) => total + numberValue(ticket.unread_staff_count), 0),
    tickets: tickets.rows,
    messages: messages.rows.map((message) => ({
      id: text(message.id),
      waMessageId: text(message.wa_message_id),
      direction: text(message.direction),
      messageType: text(message.message_type),
      status: text(message.status),
      body: liveChatMessageBody(message),
      errorMessage: text(message.error_message),
      createdAt: String(message.created_at || "")
    }))
  };
}

export async function markWhatsAppLiveChatRead(ticketId: string, currentUser: StaffUser) {
  await loadLiveChatTicket(ticketId, currentUser);
  await executeDatabaseQuery(
    `UPDATE whatsapp_service_tickets SET unread_staff_count=0,claimed_at=COALESCE(claimed_at,NOW()) WHERE id=$1`,
    [ticketId]
  );
  return getWhatsAppLiveChat(currentUser, ticketId);
}

export async function updateWhatsAppLiveChat(ticketId: string, input: { status?: string; salesmanId?: number }, currentUser: StaffUser) {
  const ticket = await loadLiveChatTicket(ticketId, currentUser);
  if (input.salesmanId !== undefined) {
    if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can transfer chats.");
    const salesperson = await executeDatabaseQuery(`SELECT id FROM users WHERE id=$1 AND active=TRUE`, [input.salesmanId]);
    if (!salesperson.rowCount) throw new Error("Select an active salesperson.");
    await executeDatabaseQuery(
      `UPDATE whatsapp_service_tickets SET salesman_id=$2,claimed_at=NULL,updated_at=NOW() WHERE id=$1`,
      [ticketId, input.salesmanId]
    );
  }
  if (input.status !== undefined) {
    const status = input.status === "Open" ? "Open" : input.status === "Resolved" ? "Resolved" : "";
    if (!status) throw new Error("Chat status must be Open or Resolved.");
    await executeDatabaseQuery(
      `UPDATE whatsapp_service_tickets
       SET status=$2::text,resolved_at=CASE WHEN $2::text='Resolved' THEN NOW() ELSE NULL END,
           closed_by=CASE WHEN $2::text='Resolved' THEN $3::text ELSE NULL END,updated_at=NOW()
       WHERE id=$1`, [ticketId, status, currentUser.fullName]
    );
    if (status === "Resolved" && text(ticket.phone_e164)) {
      await sendText(text(ticket.phone_e164), `Chat close kar di gayi hai. Dobara madad ke liye *agent* bhejein.`, "ServiceTicket", ticketId)
        .catch((error) => console.error("WhatsApp chat-close notification failed", { ticketId, error }));
    }
  }
  return getWhatsAppLiveChat(currentUser, ticketId);
}

export async function createWhatsAppDraftFromLiveChat(ticketId: string, input: {
  lines: Array<{ productSku: string; quantity: number; rate: number; cdPercent: number; todPercent: number }>;
  warehouseId: string;
  paymentMode: PaymentMode;
  cashTiming?: string;
  deliveryMode: "Delivery" | "Self Collection";
  note?: string;
}, currentUser: StaffUser) {
  const ticket = await loadLiveChatTicket(ticketId, currentUser);
  if (text(ticket.status) !== "Open") throw new Error("Reopen this chat before creating an order.");
  const profile = await getRetailerByPhone(text(ticket.phone_e164));
  if (!profile) throw new Error("Retailer mapping is no longer active.");
  if (!input.lines.length) throw new Error("Add at least one product to the order.");
  if (input.lines.length > 50) throw new Error("A chat order can contain up to 50 products.");
  if (new Set(input.lines.map((line) => line.productSku)).size !== input.lines.length) throw new Error("Each product can appear only once in an order.");
  const draftLines: DraftLineInput[] = [];
  for (const line of input.lines) {
    const pricing = await productPricing(profile.counterpartyId, line.productSku);
    if (!(line.quantity >= pricing.minimumQuantity)) throw new Error(`${pricing.name} has a minimum order quantity of ${pricing.minimumQuantity}.`);
    if (!(line.rate > 0)) throw new Error(`${pricing.name}: rate must be greater than zero.`);
    if (line.cdPercent < 0 || line.todPercent < 0 || line.cdPercent + line.todPercent >= 100) throw new Error(`${pricing.name}: enter valid CD/TOD percentages.`);
    draftLines.push({
      productSku: line.productSku,
      quantity: line.quantity,
      rate: line.rate,
      cdPercent: line.cdPercent,
      todPercent: line.todPercent,
      gstRate: pricing.gstRate,
      taxMode: pricing.taxMode,
      note: compact(input.note || `Created from chat ${ticketId}`, 500)
    });
  }
  const draftId = await createDraft(profile, "Live chat", "", draftLines, "", false);
  const loaded = await loadDraft(draftId);
  const snapshot = await getSnapshot();
  const shortages = loaded.lines.filter((line) => {
    const stock = snapshot.stockSummary.find((item) => item.warehouseId === input.warehouseId && item.productSku === text(line.product_sku));
    return numberValue(line.approved_quantity) > (stock?.availableQuantity || 0);
  });
  try {
    if (shortages.length) {
      for (const line of loaded.lines) {
        const stock = snapshot.stockSummary.find((item) => item.warehouseId === input.warehouseId && item.productSku === text(line.product_sku));
        await executeDatabaseQuery(`UPDATE whatsapp_order_draft_lines SET stock_at_review=$3 WHERE id=$1 AND draft_id=$2`, [text(line.id), draftId, stock?.availableQuantity || 0]);
      }
      const shortageNames = shortages.map((line) => text(line.product_name)).join(", ");
      await executeDatabaseQuery(
        `UPDATE whatsapp_order_drafts SET warehouse_id=$2,payment_mode=$3,cash_timing=$4,delivery_mode=$5,note=$6,status='Needs Review',reviewed_at=NOW() WHERE id=$1`,
        [draftId, input.warehouseId, input.paymentMode, input.cashTiming || null, input.deliveryMode,
          compact(`${input.note || `Created from live chat ${ticketId}`} | Stock review: ${shortageNames}`, 1000)]
      );
      await sendText(profile.phoneE164, `Order ${draftId} note kar liya hai. ${shortageNames} ka stock verify karke ${profile.salesmanName} final confirmation bhejenge.`, "Draft", draftId);
    } else {
      await reviewWhatsAppDraft(draftId, {
        warehouseId: input.warehouseId || profile.defaultWarehouseId,
        paymentMode: input.paymentMode || profile.paymentMode,
        cashTiming: input.cashTiming || profile.cashTiming,
        deliveryMode: input.deliveryMode || profile.deliveryMode,
        note: compact(input.note || `Created from live chat ${ticketId}`, 1000),
        lines: loaded.lines.map((line) => {
          const submitted = input.lines.find((item) => item.productSku === text(line.product_sku))!;
          return { id: text(line.id), quantity: submitted.quantity, rate: submitted.rate, cdPercent: submitted.cdPercent, todPercent: submitted.todPercent };
        })
      }, currentUser);
    }
  } catch (error) {
    await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1`, [draftId]);
    await executeDatabaseQuery(`DELETE FROM whatsapp_order_drafts WHERE id=$1`, [draftId]);
    throw error;
  }
  await executeDatabaseQuery(
    `UPDATE whatsapp_service_tickets SET linked_order_id=$2,last_message_preview=$3,last_message_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [ticketId, draftId, shortages.length
      ? `Order ${draftId} created for stock review`
      : `Order ${draftId} sent for retailer confirmation`]
  );
  return { draftId, confirmationSent: shortages.length === 0, dashboard: await getWhatsAppDashboard(currentUser), liveChat: await getWhatsAppLiveChat(currentUser, ticketId) };
}

export async function seedWhatsAppTestRetailers(currentUser: StaffUser) {
  await executeDatabaseQuery(
    `INSERT INTO counterparties (
       id, type, name, gst_number, bank_name, bank_account_number, ifsc_code,
       mobile_number, address, city, delivery_address, delivery_city,
       contact_person, channel_scope, created_by, created_at
     )
     SELECT
       'WA-TEST-' || LPAD(series::text, 2, '0'),
       'Shop',
       'WhatsApp Retailer ' || series::text,
       'N/A', 'N/A', 'N/A', 'N/A', '', 'WhatsApp pilot only', 'Pilot',
       'WhatsApp pilot only', 'Pilot', 'Test Retailer ' || series::text,
       'WhatsApp', $1, NOW()
     FROM generate_series(1, 10) AS series
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       channel_scope = 'WhatsApp'`,
    [currentUser.username]
  );
  return getWhatsAppDashboard(currentUser);
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
  if (input.optedIn && input.active) await sendFirstTimeWelcome(input.counterpartyId).catch(() => undefined);
  return getWhatsAppDashboard(currentUser);
}

export async function approveWhatsAppRegistration(registrationId: string, input: {
  salesmanId: number;
  defaultWarehouseId: string;
  paymentMode: PaymentMode;
  deliveryMode: "Delivery" | "Self Collection";
}, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can approve and map registrations.");
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT * FROM whatsapp_registration_requests WHERE id=$1 AND status='Pending'`, [registrationId]
  );
  const registration = result.rows[0];
  if (!registration) throw new Error("Pending retailer registration not found.");
  const salesman = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT id, full_name FROM users WHERE id=$1 AND active=TRUE AND (role='Sales' OR roles_json ? 'Sales')`, [input.salesmanId]
  );
  if (!salesman.rows[0]) throw new Error("Select an active salesperson.");
  const warehouse = await executeDatabaseQuery(`SELECT id FROM warehouses WHERE id=$1`, [input.defaultWarehouseId]);
  if (!warehouse.rows[0]) throw new Error("Select a valid warehouse.");
  const phone = text(registration.phone_e164);
  const existingPhone = await executeDatabaseQuery(`SELECT counterparty_id FROM whatsapp_retailers WHERE phone_e164=$1`, [phone]);
  if (existingPhone.rows[0]) throw new Error("This WhatsApp number is already mapped.");
  const gstin = text(registration.gstin).toUpperCase();
  const existingShop = gstin !== "NA"
    ? await executeDatabaseQuery<{ id: string }>(`SELECT id FROM counterparties WHERE type='Shop' AND UPPER(gst_number)=$1 LIMIT 1`, [gstin])
    : { rows: [] as Array<{ id: string }> };
  const counterpartyId = existingShop.rows[0]?.id || `WA-SELF-${Date.now()}-${randomUUID().slice(0, 6)}`;
  if (!existingShop.rows[0]) {
    await executeDatabaseQuery(
      `INSERT INTO counterparties (
         id,type,name,gst_number,bank_name,bank_account_number,ifsc_code,mobile_number,
         address,city,delivery_address,delivery_city,contact_person,channel_scope,created_by,created_at
       ) VALUES ($1,'Shop',$2,$3,'N/A','N/A','N/A',$4,$5,$6,$5,$6,$7,'WhatsApp',$8,NOW())`,
      [counterpartyId, text(registration.shop_name), gstin, phone, text(registration.delivery_address),
        text(registration.city), text(registration.owner_name), currentUser.fullName]
    );
  }
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_retailers (
       counterparty_id,phone_e164,salesman_id,default_warehouse_id,billing_type,payment_mode,
       delivery_mode,opted_in_at,active,created_by,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),TRUE,$8,NOW(),NOW())`,
    [counterpartyId, phone, input.salesmanId, input.defaultWarehouseId, gstin === "NA" ? "B2C" : "B2B",
      input.paymentMode, input.deliveryMode, currentUser.fullName]
  );
  await executeDatabaseQuery(
    `UPDATE whatsapp_registration_requests
     SET status='Approved',stage='Completed',approved_at=NOW(),approved_by=$2,counterparty_id=$3,updated_at=NOW()
     WHERE id=$1`, [registrationId, currentUser.fullName, counterpartyId]
  );
  await sendFirstTimeWelcome(counterpartyId).catch(() => undefined);
  return getWhatsAppDashboard(currentUser);
}

export async function saveWhatsAppPriceRule(input: {
  counterpartyId: string; productSku: string; specialRate: number; cdPercent: number;
  todPercent: number; minimumQuantity: number; validUntil?: string; active: boolean;
}, currentUser: StaffUser) {
  if (!(input.specialRate > 0)) throw new Error("Special rate must be greater than zero.");
  if (input.cdPercent < 0 || input.todPercent < 0 || input.cdPercent + input.todPercent >= 100) throw new Error("Enter valid CD/TOD percentages.");
  if (!isWhatsAppAdminUser(currentUser)) {
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
    if (!isWhatsAppAdminUser(currentUser) && retailer.salesmanId !== currentUser.id) throw new Error("You can only message your mapped retailers.");
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
      const minimumQuantity = Math.max(pricing.minimumQuantity, line.minimumQuantity);
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_offer_lines (id,offer_id,product_sku,quantity,rate,cd_percent,tod_percent,minimum_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id("WAOL"), offerId, line.productSku, Math.max(minimumQuantity, line.quantity), rate, line.cdPercent, line.todPercent, minimumQuantity]
      );
      namedLines.push(`${pricing.name}: ${mrpDiscountLabel(pricing.mrp, rate)} | Your rate ₹${rate.toFixed(2)} | Qty ${Math.max(minimumQuantity, line.quantity)} | Min ${minimumQuantity} | CD ${line.cdPercent}% | TOD ${line.todPercent}%`);
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

export async function sendWhatsAppBroadcast(input: {
  counterpartyIds: string[];
  message: string;
  title?: string;
  templateName?: string;
  templateParameters?: string[];
}, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can send broadcasts.");
  const counterpartyIds = Array.from(new Set(input.counterpartyIds)).slice(0, 500);
  const message = input.message.trim();
  if (!counterpartyIds.length) throw new Error("Select at least one retailer.");
  const templateName = text(input.templateName);
  if (!message && !templateName) throw new Error("Enter a message or an approved template name.");
  if (message.length > 3500) throw new Error("Broadcast message must be 3,500 characters or less.");
  const campaignId = id("WABC");

  const results: Array<{ counterpartyId: string; retailer: string; status: "Sent" | "Skipped" | "Failed"; error?: string }> = [];
  for (const counterpartyId of counterpartyIds) {
    const retailerResult = await executeDatabaseQuery<Record<string, unknown>>(
      `SELECT wr.*, c.name AS retailer_name, u.full_name AS salesman_name
       FROM whatsapp_retailers wr
       JOIN counterparties c ON c.id=wr.counterparty_id
       JOIN users u ON u.id=wr.salesman_id
       WHERE wr.counterparty_id=$1 AND wr.active=TRUE`, [counterpartyId]
    );
    if (!retailerResult.rows[0]) {
      results.push({ counterpartyId, retailer: counterpartyId, status: "Failed", error: "Retailer is not actively mapped." });
      continue;
    }
    const retailer = mapRetailer(retailerResult.rows[0]);
    if (!retailer.optedInAt || !retailer.marketingOptIn) {
      results.push({ counterpartyId, retailer: retailer.retailerName, status: "Skipped", error: "WhatsApp consent is not recorded." });
      continue;
    }
    try {
      const personalizedMessage = message.replaceAll("{retailer}", retailer.retailerName);
      if (templateName) {
        const parameters = (input.templateParameters || [retailer.retailerName])
          .map((parameter) => parameter.replaceAll("{retailer}", retailer.retailerName));
        await sendTemplate(retailer.phoneE164, templateName, parameters, "Broadcast", campaignId);
      } else {
        await sendText(retailer.phoneE164, personalizedMessage, "Broadcast", campaignId);
      }
      results.push({ counterpartyId, retailer: retailer.retailerName, status: "Sent" });
    } catch (error) {
      results.push({ counterpartyId, retailer: retailer.retailerName, status: "Failed", error: error instanceof Error ? error.message : "WhatsApp send failed." });
    }
  }
  const sentCount = results.filter((item) => item.status === "Sent").length;
  const failedCount = results.filter((item) => item.status === "Failed").length;
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_broadcast_campaigns (id,title,message_type,template_name,body,audience_count,sent_count,failed_count,created_by,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [campaignId, compact(input.title || (templateName || "Broadcast"), 160), templateName ? "template" : "text",
      templateName || null, message, counterpartyIds.length, sentCount, failedCount, currentUser.fullName]
  );
  return {
    sent: sentCount,
    skipped: results.filter((item) => item.status === "Skipped").length,
    failed: failedCount,
    results,
    dashboard: await getWhatsAppDashboard(currentUser)
  };
}

export async function reviewWhatsAppDraft(draftId: string, input: {
  warehouseId: string; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Delivery" | "Self Collection";
  note?: string; lines: Array<{ id: string; quantity: number; rate: number; cdPercent: number; todPercent: number }>;
}, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!isWhatsAppAdminUser(currentUser) && numberValue(loaded.draft.salesman_id) !== currentUser.id) throw new Error("This order belongs to another salesperson.");
  if (["Processing", "Completed"].includes(text(loaded.draft.status))) throw new Error("A confirmed order cannot be edited.");
  if (input.lines.length !== loaded.lines.length) throw new Error("Review every order line before sending confirmation.");
  const snapshot = await getSnapshot();
  for (const line of input.lines) {
    if (!(line.quantity > 0) || !(line.rate > 0)) throw new Error("Approved quantity and rate must be greater than zero.");
    if (line.cdPercent < 0 || line.todPercent < 0 || line.cdPercent + line.todPercent >= 100) throw new Error("Enter valid CD/TOD percentages.");
    const draftLine = loaded.lines.find((candidate) => text(candidate.id) === line.id);
    if (!draftLine) throw new Error("An order line does not belong to this draft.");
    const pricing = await productPricing(text(loaded.draft.counterparty_id), text(draftLine.product_sku));
    if (line.quantity < pricing.minimumQuantity) throw new Error(`${text(draftLine.product_name)} has a minimum order quantity of ${pricing.minimumQuantity}.`);
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

export async function denyWhatsAppDraft(draftId: string, reason: string, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!isWhatsAppAdminUser(currentUser) && numberValue(loaded.draft.salesman_id) !== currentUser.id) {
    throw new Error("This order belongs to another salesperson.");
  }
  if (!["Needs Review", "Change Requested", "Staff Approved"].includes(text(loaded.draft.status))) {
    throw new Error("This order can no longer be denied.");
  }
  const denialReason = compact(reason || "Unable to fulfil this request right now", 300);
  await executeDatabaseQuery(
    `UPDATE whatsapp_order_drafts
     SET status='Denied', reviewed_at=NOW(), note=CONCAT(COALESCE(note, ''), CASE WHEN COALESCE(note, '')='' THEN '' ELSE ' | ' END, $2::text)
     WHERE id=$1`, [draftId, `Denied: ${denialReason}`]
  );
  await sendText(text(loaded.draft.phone_e164),
    `Order request ${draftId} approve nahi ho payi. Reason: ${denialReason}. Unavailable item ko wishlist mein save karne ke liye uska naam bhejein.`,
    "Draft", draftId);
  return getWhatsAppDashboard(currentUser);
}

export async function sendWhatsAppInvoiceSummary(draftId: string, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!text(loaded.draft.sales_cart_id)) throw new Error("The sales order has not been created yet.");
  if (!currentUser.roles.some((role) => role === "Admin" || role === "Accounts") && numberValue(loaded.draft.salesman_id) !== currentUser.id) throw new Error("This order belongs to another salesperson.");
  const orders = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT so.*, p.name AS product_name, p.mrp FROM sales_orders so JOIN products p ON p.sku=so.product_sku WHERE COALESCE(so.cart_id,so.id)=$1 ORDER BY so.created_at,so.id`, [text(loaded.draft.sales_cart_id)]
  );
  const rows = orders.rows.map((order, index) => `${index + 1}. ${text(order.product_name)} — ${mrpDiscountLabel(order.mrp, order.rate)} — ${numberValue(order.quantity)} × ₹${numberValue(order.rate).toFixed(2)} = ₹${numberValue(order.total_amount).toFixed(2)}`);
  const total = orders.rows.reduce((sum, order) => sum + numberValue(order.total_amount) + numberValue(order.delivery_charge), 0);
  await sendText(text(loaded.draft.phone_e164), `🧾 *Aapoorti Invoice Summary*\nOrder ${text(loaded.draft.sales_cart_id)}\n${rows.join("\n")}\n*Total: ₹${total.toFixed(2)}*\nThe final tax invoice remains available from Aapoorti staff.`, "Draft", draftId);
  return { sent: true };
}

export async function sendWhatsAppOrderUpdate(draftId: string, status: string, note: string, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!isWhatsAppAdminUser(currentUser) && numberValue(loaded.draft.salesman_id) !== currentUser.id) {
    throw new Error("This order belongs to another salesperson.");
  }
  const cleanStatus = compact(status, 80);
  if (!cleanStatus) throw new Error("Order status is required.");
  const eventId = id("WAE");
  const template = text(process.env.WHATSAPP_ORDER_STATUS_TEMPLATE);
  const orderNumber = text(loaded.draft.sales_cart_id) || draftId;
  const sent = template
    ? await sendTemplate(text(loaded.draft.phone_e164), template, [text(loaded.draft.retailer_name), orderNumber, cleanStatus, compact(note || "-", 300)], "OrderStatus", eventId)
    : await sendText(text(loaded.draft.phone_e164),
      `Order update\n${orderNumber}\nStatus: *${cleanStatus}*${note ? `\n${compact(note, 500)}` : ""}`,
      "OrderStatus", eventId);
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_order_events (id,draft_id,sales_cart_id,event_type,status_label,note,outbound_message_id,created_by,created_at)
     VALUES ($1,$2,$3,'Status',$4,$5,$6,$7,NOW())`,
    [eventId, draftId, text(loaded.draft.sales_cart_id) || null, cleanStatus, compact(note, 1000), sent.messageId, currentUser.fullName]
  );
  return getWhatsAppDashboard(currentUser);
}

export async function notifyWhatsAppOrderLifecycle(salesOrderId: string, status: string, note = "") {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT draft.id
     FROM whatsapp_order_drafts draft
     WHERE draft.sales_cart_id=$1
        OR draft.sales_cart_id=(SELECT COALESCE(cart_id,id) FROM sales_orders WHERE id=$1 LIMIT 1)
     ORDER BY draft.completed_at DESC NULLS LAST LIMIT 1`, [salesOrderId]
  );
  const draftId = text(result.rows[0]?.id);
  if (!draftId) return { sent: false, reason: "Not a WhatsApp order" };
  const duplicate = await executeDatabaseQuery(
    `SELECT id FROM whatsapp_order_events WHERE draft_id=$1 AND status_label=$2 ORDER BY created_at DESC LIMIT 1`,
    [draftId, status]
  );
  if (duplicate.rowCount) return { sent: false, reason: "Status already sent" };
  const loaded = await loadDraft(draftId);
  const eventId = id("WAE");
  const orderNumber = text(loaded.draft.sales_cart_id) || draftId;
  try {
    const template = text(process.env.WHATSAPP_ORDER_STATUS_TEMPLATE);
    const sent = template
      ? await sendTemplate(text(loaded.draft.phone_e164), template, [text(loaded.draft.retailer_name), orderNumber, status, compact(note || "-", 300)], "OrderStatus", eventId)
      : await sendText(text(loaded.draft.phone_e164), `Order update\n${orderNumber}\nStatus: *${compact(status, 80)}*${note ? `\n${compact(note, 500)}` : ""}`, "OrderStatus", eventId);
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_order_events (id,draft_id,sales_cart_id,event_type,status_label,note,outbound_message_id,created_by,created_at)
       VALUES ($1,$2,$3,'Automatic',$4,$5,$6,'System',NOW())`,
      [eventId, draftId, orderNumber, compact(status, 80), compact(note, 1000), sent.messageId]
    );
    return { sent: true };
  } catch (error) {
    console.error("WhatsApp lifecycle notification failed", { salesOrderId, status, error });
    return { sent: false, reason: error instanceof Error ? error.message : "Send failed" };
  }
}

export async function replyWhatsAppServiceTicket(ticketId: string, message: string, close: boolean, currentUser: StaffUser) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT ticket.*,c.name AS retailer_name FROM whatsapp_service_tickets ticket
     JOIN counterparties c ON c.id=ticket.counterparty_id WHERE ticket.id=$1`, [ticketId]
  );
  const ticket = result.rows[0];
  if (!ticket) throw new Error("Service ticket not found.");
  if (!isWhatsAppAdminUser(currentUser) && numberValue(ticket.salesman_id) !== currentUser.id) {
    throw new Error("This retailer is mapped to another salesperson.");
  }
  const cleanMessage = compact(message, 2000);
  if (!cleanMessage) throw new Error("Reply cannot be empty.");
  await sendText(text(ticket.phone_e164), `${currentUser.fullName}: ${cleanMessage}`, "ServiceTicket", ticketId);
  await executeDatabaseQuery(
    `UPDATE whatsapp_service_tickets
     SET details=CASE WHEN kind='Live Chat' THEN details ELSE CONCAT(details,CASE WHEN details='' THEN '' ELSE E'\n' END,$2::text) END,
         status=$3::text,unread_staff_count=0,last_message_preview=$4::text,last_message_at=NOW(),claimed_at=COALESCE(claimed_at,NOW()),
         updated_at=NOW(),resolved_at=CASE WHEN $3::text='Resolved' THEN NOW() ELSE NULL END,
         closed_by=CASE WHEN $3::text='Resolved' THEN $5::text ELSE NULL END
     WHERE id=$1`,
    [ticketId, `Staff: ${cleanMessage}`, close ? "Resolved" : "Open", cleanMessage, currentUser.fullName]
  );
  return getWhatsAppDashboard(currentUser);
}

export async function resolveWhatsAppWishlist(wishlistId: string, productSku: string, note: string, currentUser: StaffUser) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT wishlist.*,c.name AS retailer_name FROM whatsapp_wishlist_requests wishlist
     JOIN counterparties c ON c.id=wishlist.counterparty_id WHERE wishlist.id=$1`, [wishlistId]
  );
  const wishlist = result.rows[0];
  if (!wishlist) throw new Error("Wishlist request not found.");
  if (!isWhatsAppAdminUser(currentUser) && numberValue(wishlist.salesman_id) !== currentUser.id) {
    throw new Error("This retailer is mapped to another salesperson.");
  }
  const pricing = await productPricing(text(wishlist.counterparty_id), productSku);
  await sendButtons(text(wishlist.phone_e164),
    `${text(wishlist.requested_product)} ab available hai.\n${pricing.name}\n${mrpDiscountLabel(pricing.mrp, pricing.rate)}\nYour rate: Rs.${pricing.rate.toFixed(2)}\nMinimum quantity: ${pricing.minimumQuantity}${note ? `\n${compact(note, 300)}` : ""}`,
    [{ id: `wa-product:${encodeURIComponent(productSku)}`, title: "View & Order" }, { id: "wa-ignore:wishlist", title: "Not now" }],
    "Wishlist", wishlistId);
  await executeDatabaseQuery(
    `UPDATE whatsapp_wishlist_requests SET status='Available',matched_product_sku=$2,resolution_note=$3,resolved_at=NOW(),updated_at=NOW() WHERE id=$1`,
    [wishlistId, productSku, compact(note, 1000)]
  );
  return getWhatsAppDashboard(currentUser);
}

export async function updateWhatsAppRetailerPreferences(counterpartyId: string, input: { marketingOptIn: boolean; tags: string[] }, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can update retailer preferences.");
  const tags = Array.from(new Set(input.tags.map((tag) => compact(tag, 40)).filter(Boolean))).slice(0, 20);
  await executeDatabaseQuery(
    `UPDATE whatsapp_retailers SET marketing_opt_in=$2,paused_at=CASE WHEN $2 THEN NULL ELSE COALESCE(paused_at,NOW()) END,tags_json=$3::jsonb,updated_at=NOW() WHERE counterparty_id=$1`,
    [counterpartyId, input.marketingOptIn, JSON.stringify(tags)]
  );
  return getWhatsAppDashboard(currentUser);
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function getWhatsAppCatalogFeed(token: string) {
  const expected = text(process.env.WHATSAPP_CATALOG_FEED_TOKEN);
  if (!expected || token !== expected) throw new Error("Invalid catalogue feed token.");
  const snapshot = await getSnapshot();
  const latestSaleRates = new Map<string, number>();
  for (const order of [...snapshot.salesOrders].sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (order.status !== "Cancelled" && order.rate > 0 && !latestSaleRates.has(order.productSku)) latestSaleRates.set(order.productSku, order.rate);
  }
  const publicWeb = (process.env.PUBLIC_WEB_URL || "https://b2b-api-theta.vercel.app").replace(/\/$/, "");
  const header = ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"];
  const rows = snapshot.products.flatMap((product: ProductMaster) => {
    // A retailer catalogue must never expose an internal purchase rate. Products
    // without a customer-facing price stay out of Meta until their RSP/MRP is set.
    const rate = product.offerPrice || product.rsp || product.mrp || latestSaleRates.get(product.sku) || 0;
    if (!product.whatsappCatalogEnabled || rate <= 0) return [];
    return [
      [
        product.sku, product.name, [product.size, product.unit, `Minimum order ${Math.max(1, numberValue(product.minimumOrderQuantity, 1))}`, product.offerLabel, product.remarks].filter(Boolean).join(" | "),
        "in stock", "new", `${rate.toFixed(2)} INR`, `${publicWeb}/?product=${encodeURIComponent(product.sku)}`,
        product.catalogImageKey
          ? `${process.env.PUBLIC_API_URL || "https://b2b-v8kb.onrender.com"}/whatsapp/catalog/images/${encodeURIComponent(product.sku)}?token=${encodeURIComponent(expected)}&v=${encodeURIComponent(product.catalogImageUpdatedAt || product.catalogImageKey)}`
          : `${publicWeb}/business-connect-icon-512.png`,
        product.brand || "Aapoorti"
      ].map(csvCell).join(",")
    ];
  });
  return [header.join(","), ...rows].join("\n");
}

function requireCatalogFeedToken(token: string) {
  const expected = text(process.env.WHATSAPP_CATALOG_FEED_TOKEN);
  if (!expected || token !== expected) throw new Error("Invalid catalogue image token.");
}

export async function getWhatsAppCatalogImage(sku: string, token: string) {
  requireCatalogFeedToken(token);
  const product = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT catalog_image_key FROM products WHERE sku=$1 AND whatsapp_catalog_enabled=TRUE`, [sku]
  );
  const key = text(product.rows[0]?.catalog_image_key);
  if (!key) throw new Error("Catalogue image not found.");
  return getCatalogImageObject(key);
}

export async function importWhatsAppCatalogImages(entries: Array<{ sku: string; sourceUrl: string }>) {
  if (!entries.length || entries.length > 6) throw new Error("Import between 1 and 6 product images at a time.");
  const normalized = entries.map((entry) => ({ sku: text(entry.sku), sourceUrl: text(entry.sourceUrl) }));
  if (normalized.some((entry) => !entry.sku || !entry.sourceUrl)) throw new Error("Every image needs a product SKU and source URL.");
  const results: Array<{ sku: string; imported: boolean; bytes?: number; error?: string }> = new Array(normalized.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < normalized.length) {
      const index = cursor++;
      const entry = normalized[index];
      try {
        const product = await executeDatabaseQuery<Record<string, unknown>>(`SELECT sku FROM products WHERE sku=$1 AND whatsapp_catalog_enabled=TRUE`, [entry.sku]);
        if (!product.rows[0]) throw new Error("Product SKU not found.");
        const image = await downloadAndCompressCatalogImage(entry.sourceUrl);
        const key = await putCatalogImageObject(entry.sku, image.body, image.sourceUrl);
        await executeDatabaseQuery(
          `UPDATE products SET catalog_image_key=$1, catalog_image_source_url=$2, catalog_image_updated_at=NOW() WHERE sku=$3`,
          [key, image.sourceUrl, entry.sku]
        );
        results[index] = { sku: entry.sku, imported: true, bytes: image.bytes };
      } catch (error) {
        results[index] = { sku: entry.sku, imported: false, error: error instanceof Error ? error.message : "Image import failed." };
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return {
    imported: results.filter((result) => result.imported).length,
    failed: results.filter((result) => !result.imported).length,
    results
  };
}
