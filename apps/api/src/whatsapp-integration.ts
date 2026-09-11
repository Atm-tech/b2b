import { randomUUID } from "node:crypto";
import { prepareTrainingBroadcast, trainingBroadcastMessage, trainingLinkReply, trainingUrl } from "./training-links.js";
import type { AppUser, DeliveryRouteStop, DeliveryTask, GstRate, PaymentMode, ProductMaster, TaxMode } from "@aapoorti-b2b/domain";
import { calculateSalesAmounts } from "@aapoorti-b2b/domain";
import { createDeliveryConsignment, createPayment, createReceiptCheck, createSalesCart, createSalesDockets, executeDatabaseQuery, getSnapshot, updateDeliveryTask } from "./db.js";
import { runAssistant } from "./assistant-service.js";
import { downloadAndCompressCatalogImage } from "./catalog-images.js";
import { getCatalogImageObject, putCatalogImageObject } from "./object-storage.js";
import { sendPushToUser } from "./push-notifications.js";
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
  allowLaterCollection: boolean;
  allowPartialCollection: boolean;
  allowChequeCollection: boolean;
  collectionTolerance: number;
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

async function sendLongText(phone: string, body: string, relatedEntityType?: string, relatedEntityId?: string) {
  const chunks: string[] = [];
  let current = "";
  for (const block of body.trim().split(/\n{2,}/)) {
    if (block.length > 3900) {
      if (current) chunks.push(current);
      for (let start = 0; start < block.length; start += 3900) chunks.push(block.slice(start, start + 3900));
      current = "";
      continue;
    }
    const candidate = current ? `${current}\n\n${block}` : block;
    if (candidate.length > 3900) {
      chunks.push(current);
      current = block;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  for (const chunk of chunks) await sendText(phone, chunk, relatedEntityType, relatedEntityId);
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

async function sendCollectionQr(phone: string, amount: number, relatedEntityId: string) {
  const imageUrl = text(process.env.WHATSAPP_COLLECTION_QR_IMAGE_URL);
  if (imageUrl) await sendGraphMessage(phone, { type: "image", image: { link: imageUrl, caption: `UPI collection QR - amount Rs.${amount.toFixed(2)}` } }, "CollectionQR", relatedEntityId);
  else await sendText(phone, `UPI QR image is not configured yet. Amount payable: Rs.${amount.toFixed(2)}. WhatsApp Admin must upload/set WHATSAPP_COLLECTION_QR_IMAGE_URL.`, "CollectionQR", relatedEntityId);
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

async function matchingProducts(query = "", limit = 10, department = "") {
  const snapshot = await getSnapshot();
  const normalizedDepartment = department.trim().toLowerCase();
  const historicallyPricedSkus = new Set(
    snapshot.salesOrders.filter((order) => order.status !== "Cancelled" && order.rate > 0).map((order) => order.productSku)
  );
  return snapshot.products
    .filter((product) => {
      if (!product.whatsappCatalogEnabled) return false;
      if (productSaleRate(product) <= 0 && !historicallyPricedSkus.has(product.sku)) return false;
      if (normalizedDepartment && product.department.trim().toLowerCase() !== normalizedDepartment) return false;
      return true;
    })
    .map((product) => ({
      product,
      score: query
        ? scoreWhatsAppProductQuery(query, [product.name, product.sku, product.brand, product.shortName, product.articleName, product.itemName, product.size, product.remarks])
        : 1
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name))
    .slice(0, limit)
    .map((item) => item.product);
}

async function sendProductPicker(phone: string, query = "", profile?: RetailerProfile, messageId = "", intro = "", department = "") {
  const products = await matchingProducts(query, 10, department);
  if (!products.length) {
    if (query && profile) return offerWishlist(profile, query, messageId);
    return sendText(phone, `“${compact(query, 80)}” ka product nahi mila. Dusra naam type karein, jaise: Lux`);
  }
  return sendGraphMessage(phone, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: compact(query ? `Did you mean: ${query}?` : department || "Aapoorti Catalogue", 60) },
      body: { text: [intro, `${department ? `${department} ke top products` : "Kya aap inmein se koi product chahte hain?"} Select kijiye; phir aapka rate aur quantity options milenge.`].filter(Boolean).join("\n\n") },
      footer: { text: "MOQ aur displayed rate proforma mein confirm hoga." },
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
        footer: { text: "Special retailer rates proforma mein clearly shown honge." }
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
      header: { type: "text", text: "AAPOORTI B CONNECT" },
      body: { text: `Namaste ${profile.retailerName} 👋\n\nOrder, catalogue aur support—sab yahin WhatsApp par. Neeche *Open Menu* dabakar apna option choose karein.` },
      footer: { text: compact(`Your sales contact: ${profile.salesmanName}`, 60) },
      action: {
        button: "Open Menu",
        sections: [
          {
            title: "Order & catalogue",
            rows: [
              { id: "wa-menu:catalogue", title: "Browse catalogue", description: "Products, MRP, rate aur MOQ dekhein" },
              { id: "wa-menu:departments", title: "Shop by department", description: "Grocery, personal care aur more" },
              { id: "wa-menu:offers", title: "Best offers", description: "Highest savings wale products" },
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

async function sendDepartmentPicker(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT department,COUNT(*)::int AS product_count
     FROM products
     WHERE whatsapp_catalog_enabled=TRUE AND COALESCE(department,'')<>''
     GROUP BY department ORDER BY product_count DESC,department ASC LIMIT 10`
  );
  const rows = result.rows
    .map((item) => ({ department: text(item.department), count: numberValue(item.product_count) }))
    .filter((item) => item.department);
  if (!rows.length) return sendText(profile.phoneE164, "Department list abhi available nahi hai. Product naam type karke search karein.");
  return sendGraphMessage(profile.phoneE164, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "SHOP BY DEPARTMENT" },
      body: { text: "Apna department select karein. Product list, MRP, rate aur MOQ mil jayega." },
      footer: { text: "Best offers Menu mein available hain." },
      action: {
        button: "Select department",
        sections: [{
          title: "Departments",
          rows: rows.map((item) => ({
            id: `wa-department:${encodeURIComponent(item.department)}`,
            title: compact(item.department, 24),
            description: `${item.count} catalogue products`
          }))
        }]
      }
    }
  }, "DepartmentPicker", profile.counterpartyId);
}

async function sendFeaturedDeals(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `SELECT p.sku,p.name,p.mrp,p.minimum_order_quantity,
            COALESCE(NULLIF(rule.special_rate,0),NULLIF(p.offer_price,0),NULLIF(p.rsp,0),NULLIF(p.mrp,0),history.rate,0) AS rate
     FROM products p
     LEFT JOIN LATERAL (
       SELECT special_rate
       FROM whatsapp_price_rules
       WHERE counterparty_id=$1 AND product_sku=p.sku AND active=TRUE
         AND valid_from<=NOW() AND (valid_until IS NULL OR valid_until>NOW())
       ORDER BY updated_at DESC LIMIT 1
     ) rule ON TRUE
     LEFT JOIN LATERAL (
       SELECT rate FROM sales_orders
       WHERE product_sku=p.sku AND rate>0 AND status<>'Cancelled'
       ORDER BY (shop_id=$1) DESC,created_at DESC LIMIT 1
     ) history ON TRUE
     WHERE p.whatsapp_catalog_enabled=TRUE AND COALESCE(p.mrp,0)>0
     ORDER BY ((p.mrp-COALESCE(NULLIF(rule.special_rate,0),NULLIF(p.offer_price,0),NULLIF(p.rsp,0),NULLIF(p.mrp,0),history.rate,0))/NULLIF(p.mrp,0)) DESC,p.name
     LIMIT 3`,
    [profile.counterpartyId]
  );
  const deals = result.rows
    .map((item) => ({
      name: compact(text(item.name), 56),
      mrp: numberValue(item.mrp),
      rate: numberValue(item.rate),
      minimumQuantity: Math.max(1, numberValue(item.minimum_order_quantity, 1))
    }))
    .filter((item) => item.mrp > item.rate && item.rate > 0);
  if (!deals.length) return;
  const lines = deals.map((item, index) => {
    const saving = ((item.mrp - item.rate) / item.mrp) * 100;
    return `*${index + 1}. ${item.name}*\nMRP ₹${item.mrp.toFixed(2)}  →  *Your rate ₹${item.rate.toFixed(2)}*  (${saving.toFixed(1)}% OFF)\nMOQ: ${item.minimumQuantity}`;
  });
  await sendButtons(profile.phoneE164,
    `🔥 *Best savings for you*\n\n${lines.join("\n\n")}\n\nRates aur MOQ proforma mein final verify honge.`,
    [
      { id: "wa-menu:catalogue", title: "Browse catalogue" },
      { id: "wa-menu:order", title: "Start order" },
      { id: "wa-menu:agent", title: "Chat with sales" }
    ],
    "FeaturedDeals", profile.counterpartyId
  );
}

async function sendOrderGuide(profile: RetailerProfile) {
  await sendButtons(profile.phoneE164,
    "Aapoorti B Connect order demo:\n\n1. Product ka naam type karein — jaise Lux, Maggi ya Coke\n2. Sahi item select karein\n3. MRP, aapka rate aur saving dekhein\n4. Quantity bhejein\n5. Aur item chahiye ho to Add More karein\n6. Total check karke Finalize karein\n7. Proforma check karke khud Confirm Order karein\n\nChaliye, demo shuru karein?",
    [
      { id: "wa-guide:start", title: "Start guided order" },
      { id: "wa-cart:checkout", title: "View my cart" }
    ], "OrderGuide", profile.counterpartyId);
}

async function sendRetailerTrainingGuide(profile: RetailerProfile) {
  await sendButtons(profile.phoneE164,
    "Retailer ordering training ready hai. Registration, catalogue, MOQ, cart, proforma aur order confirmation step-by-step seekhein.",
    [
      { id: "wa-guide:open", title: "Open guide" },
      { id: "wa-guide:start", title: "Start demo" }
    ], "TrainingGuide", profile.counterpartyId);
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

async function sendWelcomeTemplate(phone: string, retailerName: string, salespersonName: string, counterpartyId: string) {
  const name = text(process.env.WHATSAPP_WELCOME_TEMPLATE);
  if (!name) throw new Error("WHATSAPP_WELCOME_TEMPLATE is required outside the 24-hour chat window.");
  const urlButton = text(process.env.WHATSAPP_WELCOME_TEMPLATE_URL_BUTTON).toLowerCase() === "true";
  if (!urlButton) throw new Error("Welcome template must include the approved Open guide URL button. Set WHATSAPP_WELCOME_TEMPLATE_URL_BUTTON=true only after it is approved in Meta.");
  return sendGraphMessage(phone, {
    type: "template",
    template: {
      name,
      language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
      components: [
        { type: "body", parameters: [retailerName, salespersonName].map((value) => ({ type: "text", text: value.slice(0, 1024) })) }
      ]
    }
  }, "BroadcastWelcome", counterpartyId);
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
  const activeWindow = await executeDatabaseQuery(`SELECT id FROM whatsapp_messages WHERE phone_e164=$1 AND direction='Inbound' AND created_at >= NOW() - INTERVAL '24 hours' LIMIT 1`, [retailer.phoneE164]);
  if (activeWindow.rowCount) {
    await sendButtons(retailer.phoneE164,
      `Namaste ${retailer.retailerName} 👋\n\n*Aapoorti B Connect* mein aapka swagat hai. Aapke order ${retailer.salesmanName} handle karenge.\n\nYahin par product dhoondhiye, MRP aur apna special rate dekhiye, quantity choose kijiye aur cart finalize kijiye.\n\n*Order kaise karein*\n1. Product ka naam type karein — jaise Lux, Maggi ya Coke\n2. Sahi item select karein\n3. Quantity bhejein\n4. Aur item chahiye to Add More choose karein\n5. Total check karke Finalize karein\n\n*Quick commands*\n• *demo* — step-by-step practice\n• *catalogue* — poori product list\n• *help* — madad\n• *chat* — salesperson se baat\n\nAap product ka naam bhejkar order shuru kar sakte hain.`,
      [
        { id: "wa-guide:open", title: "Open guide" },
        { id: "wa-menu:catalogue", title: "View catalogue" },
        { id: "wa-menu:agent", title: "Chat with sales" }
      ], "BroadcastWelcome", counterpartyId);
  } else {
    await sendWelcomeTemplate(retailer.phoneE164, retailer.retailerName, retailer.salesmanName, counterpartyId);
  }
}

async function sendFirstStaffTraining(phone: string, user: StaffUser) {
  const alreadySent = await executeDatabaseQuery(`SELECT id FROM whatsapp_messages WHERE related_entity_type='StaffTraining' AND related_entity_id=$1 AND status<>'Failed' LIMIT 1`, [String(user.id)]);
  if (alreadySent.rowCount) return;
  const reply = trainingLinkReply("guide", user.roles.length ? user.roles : [user.role], isWhatsAppAdminUser(user));
  if (reply) await sendText(phone, `Welcome ${user.fullName}. Aapke assigned modules ki training yahan hai:\n\n${reply}`, "StaffTraining", String(user.id));
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
  await createDraft(profile, "Reorder", messageId, lines);
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
    allowLaterCollection: Boolean(row.allow_later_collection),
    allowPartialCollection: Boolean(row.allow_partial_collection),
    allowChequeCollection: Boolean(row.allow_cheque_collection),
    collectionTolerance: Math.max(0, numberValue(row.collection_tolerance)),
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
  if (!body && !(text(request.stage) === "AwaitingAddress" && message.location)) {
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
    await sendText(phone, "Step 5/5: Complete delivery address type karein, ya WhatsApp attachment mein Location share karein.");
    return;
  }
  if (text(request.stage) === "AwaitingAddress") {
    const location = message.location as JsonObject | undefined;
    const latitude = numberValue(location?.latitude);
    const longitude = numberValue(location?.longitude);
    if (location && latitude && longitude) {
      const locationLabel = compact([text(location.name), text(location.address)].filter(Boolean).join(", "), 300);
      const address = locationLabel || `Location pin: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
      await executeDatabaseQuery(
        `UPDATE whatsapp_registration_requests SET delivery_address=$2,latitude=$3,longitude=$4,location_label=$5,stage='AwaitingConfirmation',updated_at=NOW() WHERE id=$1`,
        [requestId, address, latitude, longitude, locationLabel]
      );
      const refreshed = await executeDatabaseQuery<Record<string, unknown>>(`SELECT * FROM whatsapp_registration_requests WHERE id=$1`, [requestId]);
      request = refreshed.rows[0];
      await sendButtons(phone,
        `Location received. Please verify:\nShop: ${text(request.shop_name)}\nOwner: ${text(request.owner_name)}\nGSTIN: ${text(request.gstin)}\nCity: ${text(request.city)}\nAddress: ${text(request.delivery_address)}`,
        [{ id: "wa-register:confirm", title: "Confirm Registration" }, { id: "wa-register:restart", title: "Edit Details" }],
        "Registration", requestId);
      return;
    }
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
  // There is only one retailer-facing approval at a time. As soon as an item
  // is added after a proforma exists, replace it with one fresh combined
  // proforma instead of leaving an invisible second temporary cart behind.
  if (lines.length && await getRetailerOpenProforma(profile)) {
    await finalizeCart(profile, "");
    return;
  }
  const summary = cartSummary(lines);
  await sendButtons(profile.phoneE164,
    `Added to cart.\n\n${summary.body}\n\nEstimated total: Rs.${summary.total.toFixed(2)}\n\nAur product add karna hai?`,
    [
      { id: "wa-cart:add", title: "Add another" },
      { id: "wa-cart:checkout", title: "View total" },
      { id: "wa-cart:clear", title: "Clear cart" }
    ], "Cart", profile.phoneE164);
}

async function getRetailerOpenProforma(profile: RetailerProfile) {
  const result = await executeDatabaseQuery<{ id: string }>(
    `SELECT id FROM whatsapp_order_drafts
     WHERE counterparty_id=$1 AND source IN ('Catalogue','Retailer cart')
       AND status IN ('Needs Review','Change Requested','Awaiting Retailer')
     ORDER BY created_at DESC LIMIT 1`, [profile.counterpartyId]
  );
  return result.rows[0]?.id || "";
}

async function sendCartCheckout(profile: RetailerProfile) {
  const lines = await loadCartLines(profile.phoneE164);
  if (lines.length && await getRetailerOpenProforma(profile)) {
    await finalizeCart(profile, "");
    return;
  }
  if (!lines.length) {
    const draftId = await getRetailerOpenProforma(profile);
    if (draftId) {
      await sendDraftForRetailerApproval(draftId);
      return;
    }
    await sendText(profile.phoneE164, "Your cart is empty. Product name type karein, jaise: Lux");
    return;
  }
  const summary = cartSummary(lines);
  await executeDatabaseQuery(
    `UPDATE whatsapp_cart_sessions SET stage = 'AwaitingCheckout', updated_at = NOW() WHERE phone_e164 = $1`,
    [profile.phoneE164]
  );
  await sendButtons(profile.phoneE164,
    `Your cart\n\n${summary.body}\n\nEstimated total: Rs.${summary.total.toFixed(2)}\nFinalize karein; aapko proforma invoice approval ke liye turant milega.`,
    [
      { id: "wa-cart:finalize", title: "Finalize" },
      { id: "wa-cart:add", title: "Add more" },
      { id: "wa-cart:clear", title: "Clear cart" }
    ], "Cart", profile.phoneE164);
}

async function clearCart(profile: RetailerProfile) {
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_lines WHERE phone_e164 = $1`, [profile.phoneE164]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164 = $1`, [profile.phoneE164]);
  const draftId = await getRetailerOpenProforma(profile);
  await sendText(profile.phoneE164, draftId
    ? `Temporary cart clear ho gaya. Existing proforma ${draftId} cancel nahi hua; catalogue se aur item add kar sakte hain ya latest proforma par Confirm Order karein.`
    : "Cart cleared. Naya order shuru karne ke liye product name type karein, jaise: Lux");
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

async function createDraft(profile: RetailerProfile, source: string, sourceMessageId: string, lines: DraftLineInput[], sourceOfferId = "", sendRetailerProforma = true) {
  if (lines.length === 0) throw new Error("The order did not contain any products.");
  const isRetailerCartSource = source === "Catalogue" || source === "Retailer cart";
  if (isRetailerCartSource) {
    const openDraft = await executeDatabaseQuery<{ id: string }>(
      `SELECT id FROM whatsapp_order_drafts
       WHERE counterparty_id=$1 AND source IN ('Catalogue','Retailer cart')
         AND status IN ('Needs Review','Change Requested','Awaiting Retailer')
       ORDER BY created_at DESC LIMIT 1`, [profile.counterpartyId]
    );
    if (openDraft.rows[0]?.id) {
      const previousDraftId = openDraft.rows[0].id;
      const existing = await loadDraft(previousDraftId);
      const combinedLines = new Map<string, DraftLineInput>();
      for (const line of existing.lines) {
        combinedLines.set(text(line.product_sku), {
          productSku: text(line.product_sku), quantity: numberValue(line.approved_quantity), rate: numberValue(line.rate),
          cdPercent: numberValue(line.cd_percent), todPercent: numberValue(line.tod_percent),
          gstRate: numberValue(line.gst_rate) as GstRate,
          taxMode: text(line.tax_mode) === "Inclusive" ? "Inclusive" : "Exclusive", note: text(line.note)
        });
      }
      for (const line of lines) {
        const current = combinedLines.get(line.productSku);
        combinedLines.set(line.productSku, current ? { ...current, quantity: current.quantity + line.quantity } : line);
      }
      // The prior approval message must never remain actionable once the cart changes.
      // Replace its draft with one fresh combined proforma for this retailer.
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_events WHERE draft_id=$1`, [previousDraftId]);
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1`, [previousDraftId]);
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_drafts WHERE id=$1`, [previousDraftId]);
      lines.splice(0, lines.length, ...combinedLines.values());
    }
  }
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
  if (sendRetailerProforma) await sendDraftForRetailerApproval(draftId);
  return draftId;
}

async function createDraftFromCatalogOrder(profile: RetailerProfile, messageId: string, order: JsonObject) {
  const rawItems = Array.isArray(order.product_items) ? order.product_items as JsonObject[] : [];
  const lines: DraftLineInput[] = [];
  const minimumAdjustments: string[] = [];
  const minimumSummary: string[] = [];
  const unavailableItems: Array<{ name: string; quantity: number }> = [];
  for (const item of rawItems) {
    const sku = text(item.product_retailer_id);
    const requestedQuantity = Math.max(1, numberValue(item.quantity, 1));
    let pricing: Awaited<ReturnType<typeof productPricing>>;
    try {
      pricing = await productPricing(profile.counterpartyId, sku);
    } catch {
      unavailableItems.push({ name: sku || "Catalogue item", quantity: requestedQuantity });
      continue;
    }
    const quantity = Math.max(pricing.minimumQuantity, requestedQuantity);
    if (requestedQuantity < pricing.minimumQuantity) {
      minimumAdjustments.push(`${pricing.name}: ${requestedQuantity} to ${pricing.minimumQuantity}`);
    }
    minimumSummary.push(`${pricing.name}: MOQ ${pricing.minimumQuantity} | Cart qty ${quantity}`);
    lines.push({ productSku: sku, quantity, rate: pricing.rate, cdPercent: pricing.cdPercent, todPercent: pricing.todPercent, gstRate: pricing.gstRate, taxMode: pricing.taxMode });
  }
  for (const item of unavailableItems) {
    await executeDatabaseQuery(
      `INSERT INTO whatsapp_wishlist_requests (
         id, counterparty_id, phone_e164, salesman_id, requested_product,
         requested_quantity, status, source_message_id, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,'Pending',$7,NOW(),NOW())`,
      [id("WAW"), profile.counterpartyId, profile.phoneE164, profile.salesmanId,
        item.name, item.quantity, messageId || null]
    );
  }
  if (!lines.length) {
    await sendText(profile.phoneE164,
      `Yeh catalogue items abhi available catalogue list mein nahi hain, isliye order create nahi hua. Wishlist sales team ko bhej di gayi hai:\n${unavailableItems.map((item) => `- ${item.name} | Qty ${item.quantity}`).join("\n")}`,
      "Wishlist", profile.counterpartyId);
    return "";
  }
  const draftId = await createDraft(profile, "Catalogue", messageId, lines, "", false);
  const adjustedNote = minimumAdjustments.length
    ? `\n\nCart minimum quantity ke hisaab se update hua:\n${minimumAdjustments.map((item) => `- ${item}`).join("\n")}`
    : "";
  await sendText(profile.phoneE164,
    `Catalogue cart mil gaya.\n\n*Minimum order quantity (MOQ)*\n${minimumSummary.map((item) => `- ${item}`).join("\n")}${adjustedNote}\n\nNeeche proforma invoice hai. Aap ise approve ya change request kar sakte hain.`,
    "Draft", draftId);
  await sendDraftForRetailerApproval(draftId);
  if (unavailableItems.length) {
    await sendText(profile.phoneE164,
      `In items ka live product record available nahi tha, isliye unhe order se alag karke wishlist mein bhej diya hai:\n${unavailableItems.map((item) => `- ${item.name} | Qty ${item.quantity}`).join("\n")}\n\nBaaki available items ki proforma upar bhej di gayi hai.`,
      "Wishlist", draftId);
  }
  return draftId;
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

function formatProformaDate(value: unknown) {
  const date = new Date(text(value) || Date.now());
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(date);
}

function proformaTotals(rows: Record<string, unknown>[]) {
  return rows.reduce<{ taxable: number; discount: number; gst: number; grand: number }>((totals, line) => {
    const amounts = lineAmounts(line);
    totals.taxable += amounts.taxableAmount;
    totals.discount += amounts.cdAmount + amounts.todAmount;
    totals.gst += amounts.gstAmount;
    totals.grand += amounts.totalAmount;
    return totals;
  }, { taxable: 0, discount: 0, gst: 0, grand: 0 });
}

function proformaFooter(draft: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const totals = proformaTotals(rows);
  const discount = totals.discount > 0 ? `\nDiscount: -₹${totals.discount.toFixed(2)}` : "";
  return `Subtotal: ₹${totals.taxable.toFixed(2)}${discount}\nGST: ₹${totals.gst.toFixed(2)}\n*Grand total: ₹${totals.grand.toFixed(2)}*\nPayment: ${text(draft.payment_mode) || "Pending"} | Delivery: ${text(draft.delivery_mode) || "Pending"}`;
}

function proformaGstDistribution(rows: Record<string, unknown>[]) {
  const buckets = new Map<number, { taxable: number; gst: number }>();
  for (const line of rows) {
    const amounts = lineAmounts(line);
    const current = buckets.get(amounts.gstRate) || { taxable: 0, gst: 0 };
    current.taxable += amounts.taxableAmount;
    current.gst += amounts.gstAmount;
    buckets.set(amounts.gstRate, current);
  }
  return Array.from(buckets.entries())
    .sort(([left], [right]) => left - right)
    .map(([rate, amounts]) => `${rate}%: taxable INR ${amounts.taxable.toFixed(2)} | GST INR ${amounts.gst.toFixed(2)}`)
    .join("\n");
}

function compactProforma(draftId: string, draft: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const header = `🧾 *PROFORMA INVOICE*\n*NOT A TAX INVOICE*\nNo: ${draftId}\nDate: ${formatProformaDate(draft.reviewed_at || draft.created_at)}\nRetailer: ${text(draft.retailer_name)}`;
  const footer = `${proformaFooter(draft, rows)}\nGST breakup\n${proformaGstDistribution(rows)}`;
  const lines: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const line = rows[index];
    const amounts = lineAmounts(line);
    const productName = compact(text(line.product_name), 46);
    const detail = `${index + 1}. ${productName}\n${numberValue(line.approved_quantity)} × ₹${numberValue(line.rate).toFixed(2)} | GST ${amounts.gstRate}% | ₹${amounts.totalAmount.toFixed(2)}`;
    const remaining = rows.length - lines.length - 1;
    const more = remaining > 0 ? `\n+${remaining} more item${remaining === 1 ? "" : "s"} — View Proforma` : "";
    if (`${header}\n\n${[...lines, detail].join("\n")}\n${more}\n\n${footer}\n\nPlease confirm or request a change.`.length > 1024) break;
    lines.push(detail);
  }
  const hidden = rows.length - lines.length;
  const hiddenLabel = hidden > 0 ? `\n+${hidden} more item${hidden === 1 ? "" : "s"} — tap View Proforma` : "";
  return `${header}\n\n${lines.join("\n")}${hiddenLabel}\n\n${footer}\n\nPlease confirm or request a change.`;
}

function detailedProforma(draftId: string, draft: Record<string, unknown>, rows: Record<string, unknown>[]) {
  const details = rows.map((line, index) => {
    const amounts = lineAmounts(line);
    const discount = amounts.cdAmount + amounts.todAmount;
    const rateAdjustment = numberValue(line.cd_percent) || numberValue(line.tod_percent)
      ? `\nCD ${numberValue(line.cd_percent)}% | TOD ${numberValue(line.tod_percent)}%`
      : "";
    const discountAmount = discount > 0 ? ` | Discount ₹${discount.toFixed(2)}` : "";
    return `*${index + 1}. ${text(line.product_name)}*\n${mrpDiscountLabel(line.mrp, line.rate)}\nQty ${numberValue(line.approved_quantity)} × Rate ₹${numberValue(line.rate).toFixed(2)}${rateAdjustment}\nGST ${amounts.gstRate}% ${amounts.taxMode}\nTaxable ₹${amounts.taxableAmount.toFixed(2)}${discountAmount} | GST ₹${amounts.gstAmount.toFixed(2)}\nLine total: ₹${amounts.totalAmount.toFixed(2)}`;
  }).join("\n\n");
  return `🧾 *AAPOORTI WHOLESALE — PROFORMA INVOICE*\n*NOT A TAX INVOICE*\nNo: ${draftId}\nDate: ${formatProformaDate(draft.reviewed_at || draft.created_at)}\nRetailer: ${text(draft.retailer_name)}\nSalesperson: ${text(draft.salesman_name)}\nWarehouse: ${text(draft.warehouse_id)}\n\n${details}\n\n${proformaFooter(draft, rows)}\nGST breakup\n${proformaGstDistribution(rows)}\n\nFinal tax invoice will be generated after order confirmation and processing.`;
}

async function sendDraftForRetailerApproval(draftId: string) {
  const loaded = await loadDraft(draftId);
  const summary = compactProforma(draftId, loaded.draft, loaded.lines);
  const sent = await sendButtons(text(loaded.draft.phone_e164), summary,
    [
      { id: `wa-confirm:${draftId}`, title: "Confirm Order" },
      { id: `wa-change:${draftId}`, title: "Request Change" },
      { id: `wa-proforma:${draftId}`, title: "View Proforma" }
    ], "Draft", draftId);
  await executeDatabaseQuery(
    `UPDATE whatsapp_order_drafts
     SET status='Awaiting Retailer', confirmation_message_id=$2, reviewed_at=NOW()
     WHERE id=$1`, [draftId, sent.messageId]
  );
}

async function sendDraftChangeProductPicker(profile: RetailerProfile, draftId: string) {
  const loaded = await loadDraft(draftId);
  if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) throw new Error("This proforma does not belong to your retailer account.");
  await sendGraphMessage(profile.phoneE164, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Change quantity" },
      body: { text: "Is proforma mein jis product ki quantity change karni hai, use select karein. Rate change available nahi hai." },
      action: {
        button: "Select product",
        sections: [{
          title: "Invoice products",
          rows: loaded.lines.slice(0, 10).map((line) => ({
            id: `wa-change-product:${encodeURIComponent(draftId)}:${encodeURIComponent(text(line.product_sku))}`,
            title: compact(text(line.product_name), 24),
            description: compact(`Current qty ${numberValue(line.approved_quantity)} | Rate Rs.${numberValue(line.rate).toFixed(2)}`, 72)
          }))
        }]
      }
    }
  }, "Draft", draftId);
}

async function sendDraftRemoveProductPicker(profile: RetailerProfile, draftId: string) {
  const loaded = await loadDraft(draftId);
  if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) throw new Error("This proforma does not belong to your retailer account.");
  await sendGraphMessage(profile.phoneE164, {
    type: "interactive",
    interactive: {
      type: "list",
      header: { type: "text", text: "Remove product" },
      body: { text: "Proforma se hatane wala product select karein. Baaki items ki updated proforma turant bhej di jayegi." },
      action: {
        button: "Select product",
        sections: [{
          title: "Invoice products",
          rows: loaded.lines.slice(0, 10).map((line) => ({
            id: `wa-remove-product:${encodeURIComponent(draftId)}:${encodeURIComponent(text(line.product_sku))}`,
            title: compact(text(line.product_name), 24),
            description: compact(`Qty ${numberValue(line.approved_quantity)} | Rate Rs.${numberValue(line.rate).toFixed(2)}`, 72)
          }))
        }]
      }
    }
  }, "Draft", draftId);
}

async function sendDraftEditOptions(profile: RetailerProfile, draftId: string) {
  const loaded = await loadDraft(draftId);
  if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) throw new Error("This proforma does not belong to your retailer account.");
  await sendButtons(profile.phoneE164,
    "Proforma mein kya change karna hai? Quantity update karein, ek product remove karein, ya poori temporary cart clear karein.",
    [
      { id: `wa-edit:quantity:${encodeURIComponent(draftId)}`, title: "Change quantity" },
      { id: `wa-edit:remove:${encodeURIComponent(draftId)}`, title: "Remove product" },
      { id: `wa-edit:clear:${encodeURIComponent(draftId)}`, title: "Clear cart" }
    ], "Draft", draftId);
}

async function clearRetailerProforma(profile: RetailerProfile, draftId: string) {
  const loaded = await loadDraft(draftId);
  if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) throw new Error("This proforma does not belong to your retailer account.");
  if (["Processing", "Completed", "Denied"].includes(text(loaded.draft.status))) throw new Error("This order is already being processed and cannot be cleared.");
  await executeDatabaseQuery(`DELETE FROM whatsapp_order_events WHERE draft_id=$1`, [draftId]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1`, [draftId]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_order_drafts WHERE id=$1`, [draftId]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164=$1`, [profile.phoneE164]);
  await sendText(profile.phoneE164, "Temporary proforma clear ho gayi. Naya order shuru karne ke liye product ka naam type karein, ya catalogue kholiye.", "Draft", draftId);
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
    const stockBySku = new Map(snapshot.stockSummary
      .filter((item) => item.warehouseId === text(draft.warehouse_id))
      .map((item) => [item.productSku, item.availableQuantity]));
    const shortages = lines.filter((line) => numberValue(line.approved_quantity) > (stockBySku.get(text(line.product_sku)) || 0));
    if (shortages.length) {
      for (const line of lines) {
        await executeDatabaseQuery(
          `UPDATE whatsapp_order_draft_lines SET stock_at_review=$3 WHERE id=$1 AND draft_id=$2`,
          [text(line.id), draftId, stockBySku.get(text(line.product_sku)) || 0]
        );
      }
      const shortageNames = shortages.map((line) => `${text(line.product_name)} (requested ${numberValue(line.approved_quantity)}, available ${stockBySku.get(text(line.product_sku)) || 0})`).join(", ");
      await executeDatabaseQuery(
        `UPDATE whatsapp_order_drafts
         SET status='Needs Review', reviewed_at=NOW(), confirmation_message_id=NULL,
             note=$2
         WHERE id=$1`,
        [draftId, compact(`${text(draft.note)} | Stock review: ${shortageNames}`, 1000)]
      );
      await sendText(text(draft.phone_e164),
        `Order mil gaya hai. ${text(draft.salesman_name)} se stock check aur final order confirmation pending hai. Confirmation isi WhatsApp par bheja jayega.`,
        "Draft", draftId
      );
      return;
    }
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
  const lines: DraftLineInput[] = offerLines.rows.map((line) => {
    const minimum = numberValue(line.minimum_quantity, 1);
    const maximum = Math.max(0, numberValue(line.max_quantity));
    const requested = quantityOverride || numberValue(line.quantity);
    if (quantityOverride && quantityOverride < minimum) throw new Error(`Minimum offer quantity is ${minimum}. Please reply with ${minimum} or more.`);
    if (maximum > 0 && requested > maximum) throw new Error(`Maximum offer quantity is ${maximum}. Please reply with ${maximum} or less.`);
    return { productSku: text(line.product_sku), quantity: Math.max(minimum, requested), rate: numberValue(line.rate), cdPercent: numberValue(line.cd_percent), todPercent: numberValue(line.tod_percent) };
  });
  for (const line of lines) {
    const pricing = await productPricing(profile.counterpartyId, line.productSku);
    line.gstRate = pricing.gstRate;
    line.taxMode = pricing.taxMode;
  }
  const draftId = await createDraft(profile, "Offer", inboundMessageId, lines, offerId);
  await executeDatabaseQuery(`UPDATE whatsapp_offers SET status = 'Accepted', accepted_at = NOW() WHERE id = $1`, [offerId]);
  return draftId;
}

const staffProofs = new Map<string, string>();
const deliveryProofPending = new Map<string, { taskId: string; stopIndex: number }>();
const cashCollectionPending = new Map<string, { taskId: string; stopIndex: number; kind: "full" | "partial"; step: number; counts: number[] }>();
const paymentProofPending = new Map<string, { taskId: string; stopIndex: number; kind: "full" | "partial"; mode: "UPI" | "Cheque" }>();
const cashDenominations = [500, 200, 100, 50, 20, 10] as const;

function staffHasRole(user: StaffUser, roles: string[]) {
  return user.roles.some((role) => roles.includes(role)) || roles.includes(user.role);
}

function shortId(value: string) {
  return value.slice(-6);
}

async function alertWhatsAppAdminForCollection(taskId: string, retailer: string, due: number, received: number, reason: string) {
  const admins = await executeDatabaseQuery<{ mobile_number: string }>(`SELECT mobile_number FROM users WHERE active=TRUE AND (role='Admin' OR roles_json ? 'Admin') AND COALESCE(mobile_number,'')<>''`);
  const body = `Collection approval alert\nRetailer: ${retailer}\nTask: ${shortId(taskId)}\nDue: Rs.${due.toFixed(2)}\nReceived: Rs.${received.toFixed(2)}\nDifference: Rs.${(due - received).toFixed(2)}\nReason: ${reason}`;
  await Promise.all(admins.rows.map((admin) => sendText(text(admin.mobile_number), body, "CollectionAlert", taskId).catch(() => undefined)));
  await executeDatabaseQuery(`INSERT INTO note_records (id,entity_type,entity_id,note,created_by,visibility,created_at) VALUES ($1,'Delivery',$2,$3,'System','Operational',NOW())`, [id("COLALERT"), taskId, body]);
}

async function sendStaffHelp(phone: string, user: StaffUser) {
  const warehouse = staffHasRole(user, ["Admin", "Warehouse Manager"]);
  const delivery = staffHasRole(user, ["Admin", "Delivery", "Out Delivery", "Collection Agent", "Delivery Manager"]);
  const lines = ["*B CONNECT staff WhatsApp commands*"];
  if (warehouse) lines.push("Warehouse: IN, OUT, READY <SO last 4>, DCO <SO last4,SO last4>");
  if (delivery) lines.push("Delivery: LIST (DCO/retailer select), SUM, LIST COLLECTION, SETTLE. Buttons se delivery aur collection complete karein.");
  lines.push("Weight/delivery/payment photo maange jaane par bhejein; phir screen par aane wala button select karein.");
  await sendText(phone, lines.join("\n"), "StaffCommandHelp");
}

async function handleStaffWhatsAppMessage(message: JsonObject, from: string, user: StaffUser): Promise<boolean> {
  const messageType = text(message.type);
  if (["image", "document"].includes(messageType)) {
    const media = (message[messageType] as JsonObject | undefined)?.id || (message[messageType] as JsonObject | undefined)?.media_id;
    staffProofs.set(from, `WhatsApp ${messageType} ${text(media) || new Date().toISOString()}`);
    const pending = deliveryProofPending.get(from);
    if (pending) {
      deliveryProofPending.delete(from);
      const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === pending.taskId); const stop = task?.routeStops[pending.stopIndex];
      const party = snapshot.counterparties.find((item) => item.id === stop?.supplierId) as { allowLaterCollection?: boolean; allowPartialCollection?: boolean; allowChequeCollection?: boolean } | undefined;
      if (task && stop) {
        const stops: DeliveryRouteStop[] = task.routeStops.map((item, index) => index === pending.stopIndex ? { ...item, delivered: true, deliveryProofName: staffProofs.get(from) } : item);
        const allDelivered = stops.every((item) => item.delivered);
        await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: task.cashProofName, status: allDelivered ? "Delivered" : "Handed Over" });
        const buttons = party?.allowLaterCollection ? [{ id: `wa-collect:later:${task.id}:${pending.stopIndex}`, title: "Collect later" }, { id: `wa-collect:now:${task.id}:${pending.stopIndex}`, title: "Collect now" }] : [{ id: `wa-collect:now:${task.id}:${pending.stopIndex}`, title: "Collect now" }];
        await sendButtons(from, `${stop.supplierName} delivery photo saved. Collection amount: Rs.${stop.amountToPay.toFixed(2)}`, buttons, "Delivery", task.id);
        return true;
      }
    }
    const paymentPending = paymentProofPending.get(from);
    if (paymentPending) {
      paymentProofPending.delete(from);
      const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === paymentPending.taskId); const stop = task?.routeStops[paymentPending.stopIndex];
      if (task && stop) {
        if (paymentPending.kind === "full") {
          await sendButtons(from, `${paymentPending.mode} proof saved. Amount Rs.${stop.amountToPay.toFixed(2)} confirm karein.`, [{ id: `wa-proof:confirm:${paymentPending.mode.toLowerCase()}:full:${task.id}:${paymentPending.stopIndex}:${stop.amountToPay}`, title: `Confirm Rs.${stop.amountToPay.toFixed(2)}` }], "Collection", task.id);
        } else {
          paymentProofPending.set(from, paymentPending);
          await sendText(from, `${paymentPending.mode} proof saved. Partial amount type karein: AMOUNT ${shortId(task.id)} ${paymentPending.stopIndex + 1} <amount>.` , "Collection", task.id);
        }
        return true;
      }
    }
    await sendText(from, "Proof saved. Ab apna command type karein.", "StaffProof");
    return true;
  }
  const interactive = message.interactive as JsonObject | undefined;
  const reply = (interactive?.button_reply || interactive?.list_reply) as JsonObject | undefined;
  const action = text(reply?.id);
  if (action.startsWith("wa-delivery:task:")) {
    const taskId = decodeURIComponent(action.slice("wa-delivery:task:".length)); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId && item.assignedTo.toLowerCase() === user.username.toLowerCase());
    if (!task) { await sendText(from, "Delivery task no longer active hai. LIST type karein."); return true; }
    await sendGraphMessage(from, { type: "interactive", interactive: { type: "list", body: { text: `DCO ${shortId(task.consignmentId || task.id)} - retailer select karein.` }, action: { button: "Retailers", sections: [{ title: "Delivery stops", rows: task.routeStops.filter((stop) => !stop.delivered).slice(0, 10).map((stop, index) => ({ id: `wa-delivery:stop:${task.id}:${index}`, title: compact(stop.supplierName, 24), description: compact(stop.productSummary, 72) })) }] } } }, "Delivery", task.id); return true;
  }
  if (action.startsWith("wa-delivery:stop:")) {
    const [, , taskId, indexText] = action.split(":"); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stopIndex = Number(indexText); const stop = task?.routeStops[stopIndex];
    if (!task || !stop) { await sendText(from, "Stop unavailable hai. LIST type karein."); return true; }
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId);
    await sendButtons(from, `*${stop.supplierName}*\nAddress: ${stop.locationLabel || "Not recorded"}\nContact: ${party?.mobileNumber || "Not recorded"}\nOrder amount: Rs.${stop.amountToPay.toFixed(2)}\n\nRetailer ko stock handover karke Done dabayein.`, [{ id: `wa-delivery:done:${task.id}:${stopIndex}`, title: "Done" }], "Delivery", task.id); return true;
  }
  if (action.startsWith("wa-delivery:done:")) { const [, , taskId, indexText] = action.split(":"); deliveryProofPending.set(from, { taskId, stopIndex: Number(indexText) }); await sendText(from, "Ab retailer ko stock dete hue clear photo click karke isi WhatsApp chat mein send karein.", "Delivery", taskId); return true; }
  if (action.startsWith("wa-collect:now:")) {
    const [, , taskId, indexText] = action.split(":"); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stopIndex = Number(indexText); const stop = task?.routeStops[stopIndex]; const party = snapshot.counterparties.find((item) => item.id === stop?.supplierId) as { allowPartialCollection?: boolean } | undefined;
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai. LIST type karein."); return true; }
    const choices = party?.allowPartialCollection ? [{ id: `wa-collect:full:${taskId}:${stopIndex}`, title: "Full" }, { id: `wa-collect:partial:${taskId}:${stopIndex}`, title: "Partial" }] : [{ id: `wa-collect:full:${taskId}:${stopIndex}`, title: "Collect full" }];
    await sendButtons(from, `Collection due: Rs.${stop.amountToPay.toFixed(2)}. Amount choice select karein.`, choices, "Collection", taskId); return true;
  }
  if (action.startsWith("wa-collect:later:")) {
    const [, , taskId, indexText] = action.split(":"); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stopIndex = Number(indexText); const stop = task?.routeStops[stopIndex];
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai. LIST type karein."); return true; }
    const stops = task.routeStops.map((item, index) => index === stopIndex ? { ...item, collectionStatus: "Later" as const, paid: false } : item);
    await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: task.cashProofName, status: task.status });
    await sendText(from, `${stop.supplierName} ke liye Collect Later recorded. LIST type karke agla retailer/DCO select karein.`, "Collection", task.id); return true;
  }
  if (action.startsWith("wa-collect:full:") || action.startsWith("wa-collect:partial:")) {
    const [, , kind, taskId, indexText] = action.split(":"); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stop = task?.routeStops[Number(indexText)]; const party = snapshot.counterparties.find((item) => item.id === stop?.supplierId) as { allowChequeCollection?: boolean } | undefined;
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai."); return true; }
    const modes = [{ id: `wa-mop:cash:${kind}:${taskId}:${indexText}`, title: "Cash" }, { id: `wa-mop:upi:${kind}:${taskId}:${indexText}`, title: "UPI" }]; if (party?.allowChequeCollection) modes.push({ id: `wa-mop:cheque:${kind}:${taskId}:${indexText}`, title: "Cheque" });
    await sendButtons(from, `${kind === "partial" ? "Partial" : "Full"} collection selected. Payment mode select karein.`, modes, "Collection", taskId); return true;
  }
  if (action.startsWith("wa-mop:")) {
    const [, mode, kind, taskId, indexText] = action.split(":"); const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stop = task?.routeStops[Number(indexText)];
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai."); return true; }
    if (mode === "cash") {
      cashCollectionPending.set(from, { taskId, stopIndex: Number(indexText), kind: kind === "partial" ? "partial" : "full", step: 0, counts: [] });
      await sendText(from, `Cash collection due: Rs.${stop.amountToPay.toFixed(2)}. ₹500 ke notes kitne hain? Sirf number bhejein (0 bhi chalega).`, "Collection", taskId);
    }
    else {
      const proofMode = mode === "upi" ? "UPI" : "Cheque";
      paymentProofPending.set(from, { taskId, stopIndex: Number(indexText), kind: kind === "partial" ? "partial" : "full", mode: proofMode });
      if (mode === "upi") await sendCollectionQr(from, stop.amountToPay, taskId);
      await sendText(from, `${proofMode} proof photo bhejein. Photo ke baad confirmation button aa jayega.`, "Collection", taskId);
    }
    return true;
  }
  if (action.startsWith("wa-cash:confirm:")) {
    const [, , , taskId, indexText, amountText] = action.split(":"); const amount = numberValue(amountText);
    const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stopIndex = Number(indexText); const stop = task?.routeStops[stopIndex];
    if (!task || !stop || amount <= 0) { await sendText(from, "Cash collection unavailable hai. LIST se retailer dobara select karein."); return true; }
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId) as { allowPartialCollection?: boolean; collectionTolerance?: number } | undefined;
    const tolerance = numberValue(party?.collectionTolerance);
    if (amount + tolerance < stop.amountToPay && !party?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, amount, "Cash confirmation below required amount"); await sendText(from, "Full collection required hai. WhatsApp Admin ko alert bhej diya gaya hai; Contact Admin."); return true; }
    await createPayment({ side: "Sales", linkedOrderId: stop.orderId, amount, mode: "Cash", referenceNumber: `WA-${task.id}-${stopIndex + 1}-${Date.now()}`, verificationStatus: "Submitted", verificationNote: `WhatsApp cash collection by ${user.fullName}` }, user);
    const stops: DeliveryRouteStop[] = task.routeStops.map((item, index) => index === stopIndex ? { ...item, paid: amount + tolerance >= item.amountToPay, collectionStatus: "Collected", collectionMode: "Cash", collectionAmount: amount } : item);
    await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: task.cashProofName, status: task.status });
    await sendText(from, `Rs.${amount.toFixed(2)} cash collection recorded. LIST type karke agla retailer/DCO select karein.`, "Collection", task.id);
    return true;
  }
  if (action.startsWith("wa-proof:confirm:")) {
    const [, , , modeText, kind, taskId, indexText, amountText] = action.split(":"); const amount = numberValue(amountText); const mode = modeText === "cheque" ? "Cheque" : "UPI";
    const snapshot = await getSnapshot(); const task = snapshot.deliveryTasks.find((item) => item.id === taskId); const stopIndex = Number(indexText); const stop = task?.routeStops[stopIndex];
    if (!task || !stop || amount <= 0) { await sendText(from, "Collection unavailable hai. LIST se retailer dobara select karein."); return true; }
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId) as { allowPartialCollection?: boolean; collectionTolerance?: number } | undefined;
    const tolerance = numberValue(party?.collectionTolerance);
    if (kind === "partial" && !party?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, amount, "Partial UPI/cheque without privilege"); await sendText(from, "Is retailer ke liye partial collection allowed nahi hai. WhatsApp Admin ko alert bhej diya gaya hai."); return true; }
    if (amount + tolerance < stop.amountToPay && !party?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, amount, "Short UPI/cheque collection without privilege"); await sendText(from, "Full collection required hai. WhatsApp Admin ko alert bhej diya gaya hai."); return true; }
    const proof = staffProofs.get(from); if (!proof) { await sendText(from, "Proof photo missing hai. Payment mode dobara select karein."); return true; }
    await createPayment({ side: "Sales", linkedOrderId: stop.orderId, amount, mode, referenceNumber: `WA-${task.id}-${stopIndex + 1}-${Date.now()}`, proofName: proof, verificationStatus: "Submitted", verificationNote: `WhatsApp ${mode} collection by ${user.fullName}` }, user);
    const stops: DeliveryRouteStop[] = task.routeStops.map((item, index) => index === stopIndex ? { ...item, paid: amount + tolerance >= item.amountToPay, collectionStatus: "Collected", collectionMode: mode, collectionAmount: amount, collectionProofName: proof } : item);
    await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: task.cashProofName, status: task.status });
    staffProofs.delete(from); paymentProofPending.delete(from); await sendText(from, `Rs.${amount.toFixed(2)} ${mode} collection recorded. LIST type karke agla retailer/DCO select karein.`, "Collection", task.id);
    return true;
  }
  if (action === "wa-settlement:list") { await sendText(from, "LIST COLLECTION type karein."); return true; }
  if (action === "wa-settlement:confirm") {
    const totals = await executeDatabaseQuery<Record<string, unknown>>(`SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE side='Sales' AND created_by=$1 AND reference_number LIKE 'WA-%'`, [user.fullName]);
    await executeDatabaseQuery(`INSERT INTO note_records (id,entity_type,entity_id,note,created_by,visibility,created_at) VALUES ($1,'Delivery',$2,$3,$4,'Operational',NOW())`, [id("SETTLE"), String(user.id), `WhatsApp settlement: Rs.${numberValue(totals.rows[0]?.amount).toFixed(2)}`, user.fullName]);
    await sendText(from, "Settlement recorded. Agla SUM sirf is settlement ke baad ki collection dikhayega.", "CollectionSettlement", String(user.id)); return true;
  }
  if (messageType !== "text") return false;
  const command = text((message.text as JsonObject | undefined)?.body).trim();
  const normalized = command.toUpperCase().replace(/\s+/g, " ");
  const warehouseUser = staffHasRole(user, ["Admin", "Warehouse Manager"]);
  const deliveryUser = staffHasRole(user, ["Admin", "Delivery", "Out Delivery", "Collection Agent", "Delivery Manager"]);
  const snapshot = await getSnapshot();
  const matchSuffix = (value: string, suffix: string) => value.toUpperCase().endsWith(suffix.toUpperCase());

  const cashSession = cashCollectionPending.get(from);
  if (deliveryUser && cashSession) {
    const count = Number(command);
    if (!Number.isInteger(count) || count < 0 || count > 10000) { await sendText(from, `Sirf valid number bhejein. ₹${cashSession.step < cashDenominations.length ? cashDenominations[cashSession.step] : "coins"} ke liye quantity chahiye.`); return true; }
    cashSession.counts.push(count);
    cashSession.step += 1;
    if (cashSession.step <= cashDenominations.length) {
      const next = cashSession.step < cashDenominations.length ? `₹${cashDenominations[cashSession.step]}` : "coins ki total value";
      await sendText(from, `${next} kitna hai? Sirf number bhejein.`);
      return true;
    }
    cashCollectionPending.delete(from);
    const task = snapshot.deliveryTasks.find((item) => item.id === cashSession.taskId); const stop = task?.routeStops[cashSession.stopIndex];
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai. LIST type karein."); return true; }
    const total = cashSession.counts.slice(0, cashDenominations.length).reduce((sum, item, index) => sum + item * cashDenominations[index], 0) + cashSession.counts[cashDenominations.length];
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId) as { allowPartialCollection?: boolean; collectionTolerance?: number } | undefined;
    const tolerance = numberValue(party?.collectionTolerance); const short = stop.amountToPay - total;
    if (short > tolerance && !party?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, total, "Cash short collection without partial privilege"); await sendText(from, `Cash total Rs.${total.toFixed(2)}, bill Rs.${stop.amountToPay.toFixed(2)}. WhatsApp Admin ko alert bhej diya gaya hai; Contact Admin.`); return true; }
    await sendButtons(from, `Cash total: Rs.${total.toFixed(2)}\nBill: Rs.${stop.amountToPay.toFixed(2)}${short > tolerance ? `\nBalance: Rs.${short.toFixed(2)}` : "\nTally OK"}\n\nConfirm karke collection record karein.`, [{ id: `wa-cash:confirm:${task.id}:${cashSession.stopIndex}:${total}`, title: "Confirm cash" }], "Collection", task.id);
    return true;
  }
  if (deliveryUser && normalized.startsWith("AMOUNT ")) {
    const parts = normalized.split(" "); const pending = paymentProofPending.get(from); const amount = numberValue(parts[3]);
    if (!pending || parts.length < 4 || !matchSuffix(pending.taskId, parts[1]) || Number(parts[2]) !== pending.stopIndex + 1 || amount <= 0) { await sendText(from, "Format: AMOUNT <task last6> <stop no> <amount>. Pehle payment mode aur proof photo complete karein."); return true; }
    const task = snapshot.deliveryTasks.find((item) => item.id === pending.taskId); const stop = task?.routeStops[pending.stopIndex];
    if (!task || !stop) { await sendText(from, "Collection task unavailable hai. LIST type karein."); return true; }
    if (amount > stop.amountToPay) { await sendText(from, `Bill Rs.${stop.amountToPay.toFixed(2)} hai. Isse zyada amount confirm nahi kar sakte.`); return true; }
    await sendButtons(from, `${pending.mode} partial collection: Rs.${amount.toFixed(2)}. Confirm karein.`, [{ id: `wa-proof:confirm:${pending.mode.toLowerCase()}:partial:${task.id}:${pending.stopIndex}:${amount}`, title: `Confirm Rs.${amount.toFixed(2)}` }], "Collection", task.id);
    return true;
  }

  if (normalized === "HELP" || normalized === "MENU" || normalized === "START") {
    await sendStaffHelp(from, user);
    return true;
  }
  if (warehouseUser && (normalized === "OUT" || normalized.startsWith("OUT "))) {
    const suffix = normalized.slice(3).trim();
    const carts = new Map<string, typeof snapshot.salesOrders>();
    for (const order of snapshot.salesOrders.filter((item) => ["Booked", "Ready for Dispatch"].includes(item.status) && item.deliveryMode === "Delivery")) {
      const key = order.cartId || order.id;
      if (!suffix || matchSuffix(key, suffix) || matchSuffix(order.id, suffix)) carts.set(key, [...(carts.get(key) || []), order]);
    }
    const rows = [...carts.entries()].slice(0, 10);
    if (!rows.length) await sendText(from, "Koi dispatch-ready sales order nahi mila. OUT <last 4 digits> type karein.");
    else await sendText(from, ["*OUT - sales orders*", ...rows.map(([key, lines]) => `${shortId(key)} | ${lines[0].shopName} | ${lines.map((line) => `${line.productSku} x ${line.quantity}`).join(", ")}`), "Ready karne ke liye: READY <last 6>"].join("\n"));
    return true;
  }
  if (warehouseUser && normalized.startsWith("READY ")) {
    const suffix = normalized.slice(6).trim();
    const order = snapshot.salesOrders.find((item) => ["Booked", "Ready for Dispatch"].includes(item.status) && matchSuffix(item.cartId || item.id, suffix));
    if (!order) { await sendText(from, "Sales order nahi mila. OUT type karke last digits check karein."); return true; }
    if (!staffProofs.get(from)) { await sendText(from, "Pehle packed weight/photo bhejein, phir READY command dobara type karein."); return true; }
    await createSalesDockets({ linkedOrderIds: [order.cartId || order.id] }, user);
    staffProofs.delete(from);
    await sendText(from, `Order ${shortId(order.cartId || order.id)} dispatch-ready hai. DCO ${shortId(order.cartId || order.id)} type karke bundle banayein.`, "SalesDocket", order.cartId || order.id);
    return true;
  }
  if (warehouseUser && (normalized === "IN" || normalized.startsWith("IN "))) {
    const suffix = normalized.slice(2).trim();
    const carts = new Map<string, typeof snapshot.purchaseOrders>();
    for (const order of snapshot.purchaseOrders.filter((item) => !["Received", "Closed", "Cancelled"].includes(item.status))) {
      const key = order.cartId || order.id;
      if (!suffix || matchSuffix(key, suffix) || matchSuffix(order.id, suffix)) carts.set(key, [...(carts.get(key) || []), order]);
    }
    const rows = [...carts.entries()].slice(0, 10);
    if (!rows.length) await sendText(from, "Active PO nahi mila. IN <last 4 digits> try karein.");
    else await sendText(from, ["*IN - active purchase orders*", ...rows.map(([key, lines]) => `${shortId(key)} | ${lines[0].supplierName} | ${lines.map((line) => `${line.productSku} ${line.quantityReceived}/${line.quantityOrdered}`).join(", ")}`), "Receive: RECEIVE <PO last6> <SKU> <qty> <gross weight kg>"].join("\n"));
    return true;
  }
  if (warehouseUser && normalized.startsWith("RECEIVE ")) {
    const parts = command.trim().split(/\s+/);
    if (parts.length < 5) { await sendText(from, "Format: RECEIVE <PO last6> <SKU> <qty> <gross weight kg>"); return true; }
    const [,, ...rest] = parts;
    const suffix = parts[1]; const sku = parts[2]; const qty = numberValue(parts[3]); const weight = numberValue(parts[4]);
    const order = snapshot.purchaseOrders.find((item) => matchSuffix(item.cartId || item.id, suffix) && item.productSku.toUpperCase() === sku.toUpperCase());
    if (!order || qty <= 0 || weight <= 0) { await sendText(from, "PO/SKU/quantity/weight check karein. IN command se active PO dekhein."); return true; }
    const proof = staffProofs.get(from);
    if (!proof) { await sendText(from, "Pehle weight photo bhejein, phir RECEIVE command type karein."); return true; }
    await createReceiptCheck({ purchaseOrderId: order.id, warehouseId: order.warehouseId, receivedQuantity: qty, actualWeightKg: weight, weighingProofName: proof, note: `WhatsApp IN by ${user.fullName}`, confirmPartial: qty < (order.quantityOrdered - order.quantityReceived) }, user);
    staffProofs.delete(from);
    await sendText(from, `${order.productSku}: ${qty} received and stock recorded at warehouse.`, "Receipt", order.id);
    return true;
  }
  if (warehouseUser && normalized.startsWith("DCO ")) {
    const suffixes = normalized.slice(4).split(",").map((item) => item.trim()).filter(Boolean);
    const dockets = snapshot.deliveryDockets.filter((docket) => docket.status === "Ready" && suffixes.some((suffix) => {
      const sales = snapshot.salesOrders.find((item) => item.id === docket.salesOrderId);
      return matchSuffix(sales?.cartId || sales?.id || "", suffix);
    }));
    if (!dockets.length) { await sendText(from, "Ready dockets nahi mile. Pehle OUT aur READY complete karein."); return true; }
    const warehouseId = dockets[0].warehouseId;
    if (dockets.some((docket) => docket.warehouseId !== warehouseId)) { await sendText(from, "Ek DCO mein sirf ek warehouse ke bills select karein."); return true; }
    const agent = snapshot.users.find((item) => item.active && staffHasRole(item, ["Delivery", "Out Delivery", "Collection Agent"]));
    if (!agent) { await sendText(from, "Delivery+Collection agent registered nahi hai. WhatsApp Admin se user add karein."); return true; }
    await createDeliveryConsignment({ docketIds: dockets.map((item) => item.id), warehouseId, assignedTo: agent.username }, user);
    const fresh = await getSnapshot(); const consignment = fresh.deliveryConsignments.find((item) => item.docketIds.every((docketId) => dockets.some((docket) => docket.id === docketId)) && item.assignedTo === agent.username);
    await sendText(from, `DCO ${shortId(consignment?.id || "created")} created. ${agent.fullName} ko handover/WhatsApp task mil gaya.`, "DCO", consignment?.id);
    return true;
  }
  if (deliveryUser && normalized === "LIST") {
    const tasks = snapshot.deliveryTasks.filter((task) => task.side === "Sales" && task.assignedTo.toLowerCase() === user.username.toLowerCase() && task.status !== "Delivered");
    if (!tasks.length) await sendText(from, "Aapke paas koi active DCO delivery nahi hai.");
    else await sendGraphMessage(from, { type: "interactive", interactive: { type: "list", body: { text: "Apna DCO select karein. Phir retailer list khulegi." }, action: { button: "View DCO", sections: [{ title: "Assigned DCO", rows: tasks.slice(0, 10).map((task) => ({ id: `wa-delivery:task:${encodeURIComponent(task.id)}`, title: `DCO ${shortId(task.consignmentId || task.id)}`, description: compact(task.routeStops.filter((stop) => !stop.delivered).map((stop) => stop.supplierName).join(", "), 72) })) }] } } }, "Delivery");
    return true;
  }
  if (deliveryUser && (normalized === "SUM" || normalized === "LIST COLLECTION")) {
    const since = await executeDatabaseQuery<{ created_at: string }>(`SELECT created_at FROM note_records WHERE entity_type='Delivery' AND entity_id=$1 AND note LIKE 'WhatsApp settlement%' ORDER BY created_at DESC LIMIT 1`, [String(user.id)]);
    const totals = await executeDatabaseQuery<Record<string, unknown>>(`SELECT mode,COALESCE(SUM(amount),0) AS amount FROM payments WHERE side='Sales' AND created_by=$1 AND created_at > COALESCE($2::timestamptz,'epoch'::timestamptz) AND reference_number LIKE 'WA-%' GROUP BY mode ORDER BY mode`, [user.fullName, since.rows[0]?.created_at || null]);
    if (normalized === "LIST COLLECTION") {
      const rows = await executeDatabaseQuery<Record<string, unknown>>(`SELECT c.name, p.amount,p.mode,p.created_at FROM payments p LEFT JOIN sales_orders so ON so.id=p.linked_order_id LEFT JOIN counterparties c ON c.id=so.shop_id WHERE p.side='Sales' AND p.created_by=$1 AND p.created_at > COALESCE($2::timestamptz,'epoch'::timestamptz) AND p.reference_number LIKE 'WA-%' ORDER BY p.created_at`, [user.fullName, since.rows[0]?.created_at || null]);
      await sendText(from, rows.rows.length ? ["*Collection list since last settlement*", ...rows.rows.map((row) => `${text(row.name) || "Retailer"}: Rs.${numberValue(row.amount).toFixed(2)} ${text(row.mode)}`)].join("\n") : "Last settlement ke baad koi collection nahi hai.");
    } else {
      const byMode = new Map(totals.rows.map((row) => [text(row.mode), numberValue(row.amount)])); const grand = totals.rows.reduce((sum, row) => sum + numberValue(row.amount), 0);
      await sendButtons(from, `*Collection summary since last settlement*\nCash: Rs.${(byMode.get("Cash") || 0).toFixed(2)}\nUPI: Rs.${(byMode.get("UPI") || 0).toFixed(2)}\nCheque: Rs.${(byMode.get("Cheque") || 0).toFixed(2)}\n*Grand total: Rs.${grand.toFixed(2)}*\n\nOffice mein cash tally karke hi settlement karein.`, [{ id: "wa-settlement:confirm", title: "Settle" }, { id: "wa-settlement:list", title: "Retailer list" }], "CollectionSummary", String(user.id));
    }
    return true;
  }
  if (deliveryUser && normalized.startsWith("CASH ")) {
    const parts = normalized.split(" ");
    const task = snapshot.deliveryTasks.find((item) => item.side === "Sales" && item.assignedTo.toLowerCase() === user.username.toLowerCase() && matchSuffix(item.id, parts[1] || ""));
    const stopIndex = Number(parts[2]) - 1;
    const stop = task?.routeStops[stopIndex];
    if (!task || !stop) { await sendText(from, "Cash task nahi mila. LIST se delivery select karein."); return true; }
    const counts = Object.fromEntries([500, 200, 100, 50, 20, 10].map((note) => [note, numberValue((parts.find((item) => item.startsWith(`${note}X`)) || "").split("X")[1])])) as Record<string, number>;
    const coins = numberValue((parts.find((item) => item.startsWith("COINSX")) || "").split("X")[1]);
    const total = Object.entries(counts).reduce((sum, [note, count]) => sum + Number(note) * Math.max(0, count), 0) + Math.max(0, coins);
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId) as { allowPartialCollection?: boolean; collectionTolerance?: number } | undefined;
    const tolerance = numberValue(party?.collectionTolerance); const short = stop.amountToPay - total;
    if (short > tolerance && !party?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, total, "Cash short collection without partial privilege"); await sendText(from, `Cash total Rs.${total.toFixed(2)} hai, bill Rs.${stop.amountToPay.toFixed(2)} hai. Difference Rs.${short.toFixed(2)}. WhatsApp Admin ko alert bhej diya gaya hai; Contact Admin.`); return true; }
    await sendText(from, `Cash counted: Rs.${total.toFixed(2)}. Bill: Rs.${stop.amountToPay.toFixed(2)}.${short > tolerance ? ` Pending: Rs.${short.toFixed(2)}.` : " Tally OK."}\nAb proof photo bhejkar COLLECT ${shortId(task.id)} ${stopIndex + 1} ${total.toFixed(2)} CASH type karein.`, "CashCount", task.id);
    return true;
  }
  if (deliveryUser && normalized.startsWith("DELIVERED ")) {
    const [, taskSuffix, stopText] = normalized.split(" "); const stopIndex = Number(stopText) - 1;
    const task = snapshot.deliveryTasks.find((item) => item.side === "Sales" && item.assignedTo.toLowerCase() === user.username.toLowerCase() && matchSuffix(item.id, taskSuffix));
    if (!task || !task.routeStops[stopIndex]) { await sendText(from, "Task/stop nahi mila. LIST type karke list dekhein."); return true; }
    const proof = staffProofs.get(from); if (!proof) { await sendText(from, "Pehle delivery photo bhejein, phir DELIVERED command type karein."); return true; }
    const stops: DeliveryRouteStop[] = task.routeStops.map((stop, index) => index === stopIndex ? { ...stop, delivered: true, deliveryProofName: proof } : stop);
    const allDone = stops.every((stop) => stop.delivered);
    await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: task.cashProofName, status: allDone ? "Delivered" : "Handed Over" });
    staffProofs.delete(from);
    const stop = stops[stopIndex];
    await sendText(from, stop.paymentRequired ? `${stop.supplierName} delivered. Collection buttons ke liye LIST se retailer select karein.` : `${stop.supplierName} delivered. LIST type karke agla stop select karein.`, "Delivery", task.id);
    return true;
  }
  if (deliveryUser && normalized.startsWith("COLLECT ")) {
    const parts = normalized.split(" ");
    if (parts.length < 6) { await sendText(from, "Format: COLLECT <task last6> <stop no> <amount> CASH|UPI|CHEQUE|LATER"); return true; }
    const task = snapshot.deliveryTasks.find((item) => item.side === "Sales" && item.assignedTo.toLowerCase() === user.username.toLowerCase() && matchSuffix(item.id, parts[1]));
    const stopIndex = Number(parts[2]) - 1; const amount = numberValue(parts[3]);
    const mode = ({ CASH: "Cash", UPI: "UPI", CHEQUE: "Cheque", LATER: "LATER" } as const)[parts[4] as "CASH" | "UPI" | "CHEQUE" | "LATER"];
    if (!mode || !task || !task.routeStops[stopIndex] || !task.routeStops[stopIndex].delivered || (mode !== "LATER" && amount <= 0)) { await sendText(from, "Collection details check karein; stop pehle DELIVERED hona chahiye."); return true; }
    const stop = task.routeStops[stopIndex];
    const party = snapshot.counterparties.find((item) => item.id === stop.supplierId);
    const privilege = party as typeof party & { allowLaterCollection?: boolean; allowPartialCollection?: boolean; allowChequeCollection?: boolean; collectionTolerance?: number } | undefined;
    if (mode === "LATER" && !privilege?.allowLaterCollection) { await sendText(from, "Is retailer ke liye later collection allowed nahi hai."); return true; }
    if (mode === "Cheque" && !privilege?.allowChequeCollection) { await sendText(from, "Is retailer ke liye cheque collection allowed nahi hai."); return true; }
    const tolerance = numberValue(privilege?.collectionTolerance); if (mode !== "LATER" && amount + tolerance < stop.amountToPay && !privilege?.allowPartialCollection) { await alertWhatsAppAdminForCollection(task.id, stop.supplierName, stop.amountToPay, amount, "Short collection without partial privilege"); await sendText(from, `Full collection required: ₹${stop.amountToPay.toFixed(2)}. WhatsApp Admin ko approval alert bhej diya gaya hai; Contact Admin.`); return true; }
    const proof = staffProofs.get(from);
    if (mode !== "LATER" && !proof) { await sendText(from, "Pehle UPI/cash/cheque proof photo bhejein, phir COLLECT command type karein."); return true; }
    if (mode !== "LATER") await createPayment({ side: "Sales", linkedOrderId: stop.orderId, amount, mode, referenceNumber: `WA-${task.id}-${stopIndex + 1}-${Date.now()}`, proofName: proof, verificationStatus: "Submitted", verificationNote: `WhatsApp collection by ${user.fullName}` }, user);
    const stops: DeliveryRouteStop[] = task.routeStops.map((item, index) => index === stopIndex ? { ...item, paid: mode !== "LATER" && amount + tolerance >= item.amountToPay, collectionStatus: mode === "LATER" ? "Later" : "Collected", collectionMode: mode === "LATER" ? undefined : mode, collectionAmount: mode === "LATER" ? undefined : amount, collectionProofName: proof } : item);
    await updateDeliveryTask(task.id, { linkedOrderIds: task.linkedOrderIds, consignmentId: task.consignmentId, assignedTo: task.assignedTo, transportType: task.transportType, vehicleNumber: task.vehicleNumber, freightAmount: task.freightAmount, routeStops: stops, pickupAt: task.pickupAt, dropAt: task.dropAt, routeHint: task.routeHint, paymentAction: task.paymentAction, cashCollectionRequired: task.cashCollectionRequired, cashHandoverMarked: task.cashHandoverMarked, weightProofName: task.weightProofName, cashProofName: proof, status: task.status });
    staffProofs.delete(from); await sendText(from, mode === "LATER" ? "Later collection recorded. LIST se pending deliveries dekhein." : `Rs.${amount.toFixed(2)} ${mode} collection recorded. LIST se pending deliveries dekhein.`, "Collection", task.id);
    return true;
  }
  if (warehouseUser || deliveryUser) { await sendStaffHelp(from, user); return true; }
  return false;
}

async function handleInboundMessage(message: JsonObject) {
  const from = normalizeWhatsAppPhone(text(message.from));
  const messageId = text(message.id);
  const messageType = text(message.type) || "unknown";
  const context = message.context as JsonObject | undefined;
  const saved = await recordMessage({ waMessageId: messageId, direction: "Inbound", phone: from, type: messageType, contextMessageId: text(context?.id), payload: message });
  if (!saved) return;
  const guideCommand = messageType === "text" ? text((message.text as JsonObject | undefined)?.body) : "";
  if (trainingLinkReply(guideCommand) !== null) {
    const staff = await executeDatabaseQuery<StaffUser>(`SELECT id,username,full_name AS "fullName",role,roles_json AS roles
      FROM users WHERE active=TRUE AND regexp_replace(COALESCE(mobile_number,''),'[^0-9]','','g') IN ($1,$2,$3)`,
      [from.replace(/\D/g, ""), from.replace(/\D/g, "").slice(-10), `0${from.replace(/\D/g, "").slice(-10)}`]);
    // Ambiguous shared numbers never combine staff permissions.
    const user = staff.rows.length === 1 ? staff.rows[0] : undefined;
    await sendText(from, trainingLinkReply(guideCommand, user?.roles?.length ? user.roles : user ? [user.role] : [], user ? isWhatsAppAdminUser(user) : false)!, user ? "StaffTraining" : "TrainingGuide", user ? String(user.id) : undefined);
    return;
  }
  const staff = await executeDatabaseQuery<StaffUser>(`SELECT id,username,full_name AS "fullName",role,roles_json AS roles
    FROM users WHERE active=TRUE AND regexp_replace(COALESCE(mobile_number,''),'[^0-9]','','g') IN ($1,$2,$3)`,
    [from.replace(/\D/g, ""), from.replace(/\D/g, "").slice(-10), `0${from.replace(/\D/g, "").slice(-10)}`]);
  // Staff numbers take command precedence. A shared/ambiguous number stays out of
  // the command path so permissions can never be accidentally combined.
  if (staff.rows.length === 1) {
    await sendFirstStaffTraining(from, staff.rows[0]);
    if (await handleStaffWhatsAppMessage(message, from, staff.rows[0])) return;
  }
  const profile = await getRetailerByPhone(from);
  if (!profile) {
    try {
      await handleRetailerRegistration(message, from, messageId);
    } catch (error) {
      await sendText(from, error instanceof Error ? error.message : "Registration detail process nahi ho payi. Dobara try karein.").catch(() => undefined);
    }
    return;
  }
  void sendPushToUser(profile.salesmanId, "New retailer WhatsApp message", `${profile.retailerName} sent a message.`, "/");
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
    if (buttonId === "wa-guide:open") {
      await sendText(from, `Retailer ordering training:\n${trainingUrl("retailer")}\n\nLink par tap karke guide kholo.`, "TrainingGuide", profile.counterpartyId);
      return;
    }
    if (buttonId === "wa-menu:departments") {
      await sendDepartmentPicker(profile);
      return;
    }
    if (buttonId === "wa-menu:offers") {
      await sendFeaturedDeals(profile);
      return;
    }
    if (buttonId.startsWith("wa-department:")) {
      const department = decodeURIComponent(buttonId.slice("wa-department:".length));
      await sendProductPicker(from, "", profile, messageId, "Department select ho gaya.", department);
      return;
    }
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
      await sendFeaturedDeals(profile).catch(() => undefined);
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
      const draftId = buttonId.slice("wa-confirm:".length);
      const loaded = await loadDraft(draftId);
      const expectedMessageId = text(loaded.draft.confirmation_message_id);
      if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) {
        await sendText(from, "This order does not belong to your retailer account.");
        return;
      }
      if (!expectedMessageId || (text(context?.id) && text(context?.id) !== expectedMessageId)) {
        await sendText(from, "Yeh proforma update ho chuka hai. Kripya sabse naya proforma check karke confirm karein.");
        return;
      }
      await finalizeDraft(draftId);
      return;
    }
    if (buttonId.startsWith("wa-proforma:")) {
      const draftId = buttonId.slice("wa-proforma:".length);
      const loaded = await loadDraft(draftId);
      if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) {
        await sendText(from, "This proforma does not belong to your retailer account.");
        return;
      }
      await sendLongText(from, detailedProforma(draftId, loaded.draft, loaded.lines), "Draft", draftId);
      const sent = await sendButtons(from, "Proforma check kar lijiye. Confirm Order se order process hoga, ya Request Change se quantity update kar sakte hain.", [
        { id: `wa-confirm:${draftId}`, title: "Confirm Order" },
        { id: `wa-change:${draftId}`, title: "Request Change" }
      ], "Draft", draftId);
      await executeDatabaseQuery(
        `UPDATE whatsapp_order_drafts SET confirmation_message_id=$2, reviewed_at=NOW() WHERE id=$1`,
        [draftId, sent.messageId]
      );
      return;
    }
    if (buttonId.startsWith("wa-change:")) {
      const draftId = buttonId.slice("wa-change:".length);
      await sendDraftEditOptions(profile, draftId);
      return;
    }
    if (buttonId.startsWith("wa-edit:")) {
      const match = buttonId.match(/^wa-edit:(quantity|remove|clear):(.+)$/);
      if (!match) throw new Error("Invalid proforma edit action.");
      const action = match[1];
      const draftId = decodeURIComponent(match[2]);
      const loaded = await loadDraft(draftId);
      if (text(loaded.draft.counterparty_id) !== profile.counterpartyId) throw new Error("This proforma does not belong to your retailer account.");
      if (action === "clear") {
        await clearRetailerProforma(profile, draftId);
        return;
      }
      await executeDatabaseQuery(`UPDATE whatsapp_order_drafts SET status = 'Change Requested', confirmation_message_id=NULL WHERE id = $1 AND counterparty_id = $2`, [draftId, profile.counterpartyId]);
      if (action === "quantity") await sendDraftChangeProductPicker(profile, draftId);
      else await sendDraftRemoveProductPicker(profile, draftId);
      return;
    }
    if (buttonId.startsWith("wa-change-product:")) {
      const match = buttonId.match(/^wa-change-product:([^:]+):(.+)$/);
      if (!match) throw new Error("Invalid product change selection.");
      const draftId = decodeURIComponent(match[1]);
      const productSku = decodeURIComponent(match[2]);
      const loaded = await loadDraft(draftId);
      const line = loaded.lines.find((candidate) => text(candidate.product_sku) === productSku);
      if (text(loaded.draft.counterparty_id) !== profile.counterpartyId || !line) throw new Error("That product is not part of this proforma.");
      const pricing = await productPricing(profile.counterpartyId, productSku);
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_cart_sessions (phone_e164,counterparty_id,selected_product_sku,stage,last_inbound_message_id,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
         ON CONFLICT (phone_e164) DO UPDATE SET counterparty_id=EXCLUDED.counterparty_id,selected_product_sku=EXCLUDED.selected_product_sku,stage=EXCLUDED.stage,last_inbound_message_id=EXCLUDED.last_inbound_message_id,updated_at=NOW()`,
        [profile.phoneE164, profile.counterpartyId, productSku, `AwaitingDraftChangeQuantity:${draftId}`, messageId]
      );
      await sendText(from, `${pricing.name}\nCurrent quantity: ${numberValue(line.approved_quantity)}\nMinimum order quantity: ${pricing.minimumQuantity}\n\nRequired quantity type karein. Rate change available nahi hai.`, "Draft", draftId);
      return;
    }
    if (buttonId.startsWith("wa-remove-product:")) {
      const match = buttonId.match(/^wa-remove-product:([^:]+):(.+)$/);
      if (!match) throw new Error("Invalid product removal selection.");
      const draftId = decodeURIComponent(match[1]);
      const productSku = decodeURIComponent(match[2]);
      const loaded = await loadDraft(draftId);
      const line = loaded.lines.find((candidate) => text(candidate.product_sku) === productSku);
      if (text(loaded.draft.counterparty_id) !== profile.counterpartyId || !line) throw new Error("That product is not part of this proforma.");
      if (["Processing", "Completed", "Denied"].includes(text(loaded.draft.status))) throw new Error("This order is already being processed and cannot be edited.");
      if (loaded.lines.length === 1) {
        await clearRetailerProforma(profile, draftId);
        return;
      }
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1 AND product_sku=$2`, [draftId, productSku]);
      await executeDatabaseQuery(
        `UPDATE whatsapp_order_drafts
         SET status='Change Requested', note=CONCAT(note,CASE WHEN note='' THEN '' ELSE ' | ' END,$2::text),confirmation_message_id=NULL
         WHERE id=$1`,
        [draftId, `Retailer removed: ${text(line.product_name)}`]
      );
      await sendText(from, `${text(line.product_name)} proforma se remove ho gaya. Updated proforma neeche bhej di gayi hai.`, "Draft", draftId);
      await sendDraftForRetailerApproval(draftId);
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
    if (/^(chat|salesman|agent|live chat|talk to sales|human)$/i.test(normalized)) {
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
      await sendFeaturedDeals(profile).catch(() => undefined);
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
    if (/^guide$/i.test(normalized)) {
      await sendRetailerTrainingGuide(profile);
      return;
    }
    if (/^(demo|demo order|how to order|help)$/i.test(normalized)) {
      await sendOrderGuide(profile);
      return;
    }
    if (/^(hi|hello|hey|namaste|menu)$/i.test(normalized)) {
      await sendMainMenu(profile);
      await sendFeaturedDeals(profile).catch(() => undefined);
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
      const changeSession = await loadCartSession(profile.phoneE164);
      const draftChangeMatch = changeSession?.stage.match(/^AwaitingDraftChangeQuantity:(.+)$/);
      if (draftChangeMatch && changeSession?.selectedProductSku) {
        if (!/^\d+(?:\.\d+)?$/.test(normalized)) {
          await sendText(from, "Required quantity type karein. Rate change available nahi hai.");
          return;
        }
        const draftId = draftChangeMatch[1];
        const loaded = await loadDraft(draftId);
        if (text(loaded.draft.counterparty_id) !== profile.counterpartyId || text(loaded.draft.status) !== "Change Requested") {
          await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164=$1`, [profile.phoneE164]);
          await sendText(from, "Yeh change request expire ho gayi hai. Latest proforma se Request Change select karein.");
          return;
        }
        const pricing = await productPricing(profile.counterpartyId, changeSession.selectedProductSku);
        const quantity = numberValue(normalized);
        if (quantity < pricing.minimumQuantity) {
          await sendText(from, `${pricing.name} ki minimum order quantity ${pricing.minimumQuantity} hai. Required quantity ${pricing.minimumQuantity} ya usse zyada type karein.`);
          return;
        }
        await executeDatabaseQuery(
          `UPDATE whatsapp_order_draft_lines SET requested_quantity=$3,approved_quantity=$3 WHERE draft_id=$1 AND product_sku=$2`,
          [draftId, changeSession.selectedProductSku, quantity]
        );
        await executeDatabaseQuery(
          `UPDATE whatsapp_order_drafts SET note=CONCAT(note,CASE WHEN note='' THEN '' ELSE ' | ' END,$2::text) WHERE id=$1`,
          [draftId, `Retailer quantity changed: ${pricing.name} to ${quantity}`]
        );
        await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164=$1`, [profile.phoneE164]);
        await sendDraftForRetailerApproval(draftId);
        return;
      }
      const pendingChange = await executeDatabaseQuery<{ id: string }>(
        `SELECT id FROM whatsapp_order_drafts WHERE counterparty_id = $1 AND status = 'Change Requested' ORDER BY created_at DESC LIMIT 1`,
        [profile.counterpartyId]
      );
      if (pendingChange.rows[0]) {
        await sendDraftChangeProductPicker(profile, pendingChange.rows[0].id);
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

export async function autoCloseInactiveWhatsAppLiveChats() {
  const closed = await executeDatabaseQuery<{ id: string }>(
    `UPDATE whatsapp_service_tickets
     SET status='Resolved',resolved_at=NOW(),closed_by='System — inactive for 15 minutes',
         unread_staff_count=0,updated_at=NOW()
     WHERE kind='Live Chat' AND status='Open'
       AND COALESCE(last_message_at,updated_at,created_at) <= NOW() - INTERVAL '15 minutes'
     RETURNING id`
  );
  return closed.rowCount || 0;
}

export async function handleWhatsAppWebhook(payload: JsonObject) {
  // Close any expired human-chat session before routing a new retailer message.
  // A new message after the 15-minute window therefore returns to the normal bot flow.
  await autoCloseInactiveWhatsAppLiveChats();
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
      `SELECT wr.*, c.name AS retailer_name, c.allow_later_collection, c.allow_partial_collection, c.allow_cheque_collection, c.collection_tolerance, u.full_name AS salesman_name FROM whatsapp_retailers wr JOIN counterparties c ON c.id = wr.counterparty_id JOIN users u ON u.id = wr.salesman_id ${filter} ORDER BY c.name`, params),
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
      `SELECT d.*, c.name AS retailer_name, u.full_name AS salesman_name FROM whatsapp_order_drafts d JOIN counterparties c ON c.id = d.counterparty_id JOIN users u ON u.id = d.salesman_id ${isAdmin ? "WHERE NOT (d.source IN ('Catalogue','Retailer cart') AND d.status='Needs Review' AND COALESCE(d.note,'') NOT ILIKE '%Stock review:%')" : "WHERE d.salesman_id = $1 AND NOT (d.source IN ('Catalogue','Retailer cart') AND d.status='Needs Review' AND COALESCE(d.note,'') NOT ILIKE '%Stock review:%')"} ORDER BY d.created_at DESC LIMIT 150`, params),
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
    trainingBroadcast: { message: trainingBroadcastMessage(), url: trainingUrl("retailer") },
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
           closed_by=CASE WHEN $2::text='Resolved' THEN $3::text ELSE NULL END,
           last_message_at=CASE WHEN $2::text='Open' THEN NOW() ELSE last_message_at END,
           updated_at=NOW()
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
  draftId?: string;
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
  let draftId = text(input.draftId);
  const updatingExistingDraft = Boolean(draftId);
  if (updatingExistingDraft) {
    const existing = await loadDraft(draftId);
    if (text(existing.draft.counterparty_id) !== profile.counterpartyId || text(existing.draft.source) !== "Live chat") {
      throw new Error("This live-chat order cannot be updated from the selected conversation.");
    }
    if (["Processing", "Completed", "Denied"].includes(text(existing.draft.status))) {
      throw new Error("This order is already closed. Start a new order instead.");
    }
    const replacementLines = draftLines.map((line) => ({
      id: id("WADL"),
      ...line,
      gstRate: line.gstRate === "NA" ? 0 : line.gstRate || 0,
      taxMode: line.taxMode === "Inclusive" ? "Inclusive" : "Exclusive"
    }));
    await executeDatabaseQuery(
      `WITH removed AS (
         DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1 RETURNING id
       )
       INSERT INTO whatsapp_order_draft_lines (
         id,draft_id,product_sku,requested_quantity,approved_quantity,rate,
         cd_percent,tod_percent,gst_rate,tax_mode,note
       )
       SELECT item.id,$1,item.product_sku,item.quantity,item.quantity,item.rate,
              item.cd_percent,item.tod_percent,item.gst_rate,item.tax_mode,item.note
       FROM jsonb_to_recordset($2::jsonb) AS item(
         id text,product_sku text,quantity double precision,rate double precision,
         cd_percent double precision,tod_percent double precision,gst_rate double precision,tax_mode text,note text
       )`,
      [draftId, JSON.stringify(replacementLines.map((line) => ({
        id: line.id, product_sku: line.productSku, quantity: line.quantity, rate: line.rate,
        cd_percent: line.cdPercent || 0, tod_percent: line.todPercent || 0,
        gst_rate: line.gstRate, tax_mode: line.taxMode, note: line.note || ""
      })))]
    );
    await executeDatabaseQuery(
      `UPDATE whatsapp_order_drafts
       SET warehouse_id=$2,payment_mode=$3,cash_timing=$4,delivery_mode=$5,note=$6,
           status='Needs Review',reviewed_at=NULL,confirmation_message_id=NULL
       WHERE id=$1`,
      [draftId, input.warehouseId || profile.defaultWarehouseId, input.paymentMode || profile.paymentMode,
        input.cashTiming || null, input.deliveryMode || profile.deliveryMode,
        compact(input.note || `Updated from live chat ${ticketId}`, 1000)]
    );
  } else {
    draftId = await createDraft(profile, "Live chat", "", draftLines, "", false);
  }
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
        billingType: "B2C",
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
    if (!updatingExistingDraft) {
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1`, [draftId]);
      await executeDatabaseQuery(`DELETE FROM whatsapp_order_drafts WHERE id=$1`, [draftId]);
    }
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

export async function seedWhatsAppTestProducts(currentUser: StaffUser) {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `WITH seed (sku,name,department,category,unit,weight,moq,stock,rsp,mrp) AS (
       VALUES
         ('WA-TEST-BISCUIT-5','WA TEST BISCUIT 100G','Grocery','Biscuits','Pack',0.10,5,50,18,20),
         ('WA-TEST-SOAP-12','WA TEST SOAP 100G','Personal Care','Bath Soap','Piece',0.10,12,120,27,30),
         ('WA-TEST-DRINK-24','WA TEST DRINK 750ML','Beverages','Soft Drinks','Bottle',0.75,24,240,45,50),
         ('WA-TEST-TEA-10','WA TEST TEA 250G','Grocery','Tea','Pack',0.25,10,100,72,80),
         ('WA-TEST-OIL-6','WA TEST REFINED OIL 1L','Grocery','Edible Oil','Bottle',1.00,6,60,126,140),
         ('WA-TEST-NOODLES-12','WA TEST NOODLES 280G','Grocery','Instant Food','Pack',0.28,12,120,36,40),
         ('WA-TEST-SHAMPOO-8','WA TEST SHAMPOO 180ML','Personal Care','Hair Care','Bottle',0.18,8,80,81,90),
         ('WA-TEST-DETERGENT-6','WA TEST DETERGENT 1KG','Home Care','Laundry','Pack',1.00,6,60,108,120),
         ('WA-TEST-CHOCOLATE-20','WA TEST CHOCOLATE 25G','Confectionery','Chocolate','Piece',0.03,20,200,9,10),
         ('WA-TEST-ATTA-3','WA TEST ATTA 5KG','Grocery','Flour','Bag',5.00,3,30,360,400)
     ), hidden_catalogue AS (
       UPDATE products SET whatsapp_catalog_enabled=FALSE WHERE sku NOT LIKE 'WA-TEST-%' RETURNING sku
     ), products_upserted AS (
       INSERT INTO products (
         sku,name,division,department,section_name,category,sub_category,unit,
         default_gst_rate,default_tax_mode,default_weight_kg,tolerance_kg,tolerance_percent,
         allowed_warehouse_ids_json,slabs_json,remarks,brand,short_name,size,rsp,mrp,
         offer_label,offer_price,minimum_order_quantity,whatsapp_catalog_enabled,created_by,created_at
       )
       SELECT sku,name,'Test',department,'WhatsApp Test',category,'Test Products',unit,
              18,'Exclusive',weight,0.01,10,'["C21"]'::jsonb,'[]'::jsonb,
              'WhatsApp ordering and proforma test product','Aapoorti Test',name,
              CASE WHEN unit='Bottle' THEN '750ML' ELSE '100G' END,rsp,mrp,
              'Test rate',rsp,moq,TRUE,$1,NOW()
       FROM seed
       ON CONFLICT (sku) DO UPDATE SET
         name=EXCLUDED.name,division=EXCLUDED.division,department=EXCLUDED.department,
         section_name=EXCLUDED.section_name,category=EXCLUDED.category,sub_category=EXCLUDED.sub_category,
         unit=EXCLUDED.unit,default_gst_rate=EXCLUDED.default_gst_rate,
         default_tax_mode=EXCLUDED.default_tax_mode,default_weight_kg=EXCLUDED.default_weight_kg,
         allowed_warehouse_ids_json=EXCLUDED.allowed_warehouse_ids_json,rsp=EXCLUDED.rsp,mrp=EXCLUDED.mrp,
         offer_label=EXCLUDED.offer_label,offer_price=EXCLUDED.offer_price,
         minimum_order_quantity=EXCLUDED.minimum_order_quantity,whatsapp_catalog_enabled=TRUE
       RETURNING sku
     ), lots_inserted AS (
       INSERT INTO inventory_lots (
         lot_id,source_order_id,source_type,warehouse_id,product_sku,
         quantity_available,quantity_reserved,quantity_blocked,status,created_at
       )
       SELECT 'LOT-' || sku || '-C21','WA-TEST-SETUP','WhatsApp Test Setup','C21',sku,stock,0,0,'Available',NOW()
       FROM seed
       ON CONFLICT (lot_id) DO NOTHING
       RETURNING product_sku
     )
     SELECT sku,name,moq,rsp,mrp,stock AS available_c21 FROM seed ORDER BY sku`,
    [currentUser.username]
  );
  return { products: result.rows };
}

export async function clearWhatsAppTestActivity() {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `WITH
     test_retailers AS MATERIALIZED (
       SELECT id FROM counterparties WHERE id LIKE 'WA-TEST-%'
     ),
     test_drafts AS MATERIALIZED (
       SELECT DISTINCT d.id,d.sales_cart_id,d.phone_e164
       FROM whatsapp_order_drafts d
       LEFT JOIN whatsapp_order_draft_lines line ON line.draft_id=d.id
       WHERE d.counterparty_id IN (SELECT id FROM test_retailers) OR line.product_sku LIKE 'WA-TEST-%'
     ),
     test_orders AS MATERIALIZED (
       SELECT DISTINCT so.id,COALESCE(so.cart_id,so.id) AS cart_id
       FROM sales_orders so
       WHERE so.shop_id IN (SELECT id FROM test_retailers)
          OR so.product_sku LIKE 'WA-TEST-%'
          OR COALESCE(so.cart_id,so.id) IN (SELECT sales_cart_id FROM test_drafts WHERE sales_cart_id IS NOT NULL)
     ),
     test_offers AS MATERIALIZED (
       SELECT DISTINCT offer.id
       FROM whatsapp_offers offer
       LEFT JOIN whatsapp_offer_lines line ON line.offer_id=offer.id
       WHERE offer.counterparty_id IN (SELECT id FROM test_retailers) OR line.product_sku LIKE 'WA-TEST-%'
     ),
     test_tickets AS MATERIALIZED (
       SELECT id,phone_e164 FROM whatsapp_service_tickets
       WHERE counterparty_id IN (SELECT id FROM test_retailers)
     ),
     test_phones AS MATERIALIZED (
       SELECT phone_e164 FROM whatsapp_retailers WHERE counterparty_id IN (SELECT id FROM test_retailers) AND phone_e164 IS NOT NULL
       UNION SELECT phone_e164 FROM test_drafts WHERE phone_e164 IS NOT NULL
       UNION SELECT phone_e164 FROM test_tickets WHERE phone_e164 IS NOT NULL
     ),
     deleted_order_events AS (
       DELETE FROM whatsapp_order_events
       WHERE draft_id IN (SELECT id FROM test_drafts)
          OR sales_cart_id IN (SELECT cart_id FROM test_orders)
       RETURNING id
     ),
     deleted_messages AS (
       DELETE FROM whatsapp_messages
       WHERE phone_e164 IN (SELECT phone_e164 FROM test_phones)
          OR (related_entity_type='Draft' AND related_entity_id IN (SELECT id FROM test_drafts))
          OR (related_entity_type='ServiceTicket' AND related_entity_id IN (SELECT id FROM test_tickets))
          OR (related_entity_type='Offer' AND related_entity_id IN (SELECT id FROM test_offers))
       RETURNING id
     ),
     deleted_cart_lines AS (
       DELETE FROM whatsapp_cart_lines
       WHERE phone_e164 IN (SELECT phone_e164 FROM test_phones) OR product_sku LIKE 'WA-TEST-%'
       RETURNING phone_e164
     ),
     deleted_cart_sessions AS (
       DELETE FROM whatsapp_cart_sessions
       WHERE phone_e164 IN (SELECT phone_e164 FROM test_phones)
          OR counterparty_id IN (SELECT id FROM test_retailers)
       RETURNING phone_e164
     ),
     deleted_offer_lines AS (
       DELETE FROM whatsapp_offer_lines WHERE offer_id IN (SELECT id FROM test_offers) RETURNING id
     ),
     deleted_offers AS (
       DELETE FROM whatsapp_offers WHERE id IN (SELECT id FROM test_offers) RETURNING id
     ),
     deleted_price_rules AS (
       DELETE FROM whatsapp_price_rules
       WHERE counterparty_id IN (SELECT id FROM test_retailers) OR product_sku LIKE 'WA-TEST-%'
       RETURNING id
     ),
     deleted_wishlists AS (
       DELETE FROM whatsapp_wishlist_requests
       WHERE counterparty_id IN (SELECT id FROM test_retailers)
          OR phone_e164 IN (SELECT phone_e164 FROM test_phones)
          OR matched_product_sku LIKE 'WA-TEST-%'
       RETURNING id
     ),
     deleted_registrations AS (
       DELETE FROM whatsapp_registration_requests
       WHERE counterparty_id IN (SELECT id FROM test_retailers) OR phone_e164 IN (SELECT phone_e164 FROM test_phones)
       RETURNING id
     ),
     deleted_tickets AS (
       DELETE FROM whatsapp_service_tickets WHERE id IN (SELECT id FROM test_tickets) RETURNING id
     ),
     deleted_draft_lines AS (
       DELETE FROM whatsapp_order_draft_lines WHERE draft_id IN (SELECT id FROM test_drafts) RETURNING id
     ),
     deleted_drafts AS (
       DELETE FROM whatsapp_order_drafts WHERE id IN (SELECT id FROM test_drafts) RETURNING id
     ),
     deleted_dockets AS (
       DELETE FROM delivery_dockets WHERE sales_order_id IN (SELECT id FROM test_orders) RETURNING id
     ),
     deleted_probationary AS (
       DELETE FROM probationary_sales
       WHERE sales_order_id IN (SELECT id FROM test_orders) OR sales_cart_id IN (SELECT cart_id FROM test_orders)
       RETURNING id
     ),
     deleted_returns AS (
       DELETE FROM sales_returns
       WHERE linked_order_id IN (SELECT id FROM test_orders) OR linked_order_id IN (SELECT cart_id FROM test_orders)
       RETURNING id
     ),
     deleted_payments AS (
       DELETE FROM payments WHERE linked_order_id IN (SELECT cart_id FROM test_orders) RETURNING id
     ),
     deleted_ledger AS (
       DELETE FROM ledger_entries WHERE linked_order_id IN (SELECT cart_id FROM test_orders) RETURNING id
     ),
     deleted_delivery AS (
       DELETE FROM delivery_tasks
       WHERE linked_order_id IN (SELECT cart_id FROM test_orders)
          OR linked_order_ids_json ?| ARRAY(SELECT cart_id FROM test_orders)
       RETURNING id
     ),
     deleted_orders AS (
       DELETE FROM sales_orders WHERE id IN (SELECT id FROM test_orders) RETURNING id
     )
     SELECT
       (SELECT COUNT(*) FROM deleted_drafts)::int AS drafts,
       (SELECT COUNT(*) FROM deleted_draft_lines)::int AS draft_lines,
       (SELECT COUNT(*) FROM deleted_tickets)::int AS chats,
       (SELECT COUNT(*) FROM deleted_messages)::int AS messages,
       (SELECT COUNT(*) FROM deleted_orders)::int AS sales_orders,
       (SELECT COUNT(*) FROM deleted_offers)::int AS offers,
       (SELECT COUNT(*) FROM deleted_wishlists)::int AS wishlists`,
    []
  );
  return { cleared: true, ...(result.rows[0] || {}) };
}

// Removes order workflow data only. Retailer mappings, chats, catalogue and
// audit messages are intentionally preserved so the WhatsApp desk stays usable.
export async function clearWhatsAppOrderDrafts() {
  const result = await executeDatabaseQuery<Record<string, unknown>>(
    `WITH drafts AS MATERIALIZED (
       SELECT id FROM whatsapp_order_drafts
     ), updated_retailers AS (
       UPDATE whatsapp_retailers SET billing_type='B2C',updated_at=NOW() WHERE billing_type <> 'B2C' RETURNING counterparty_id
     ), deleted_events AS (
       DELETE FROM whatsapp_order_events WHERE draft_id IN (SELECT id FROM drafts) RETURNING id
     ), deleted_lines AS (
       DELETE FROM whatsapp_order_draft_lines WHERE draft_id IN (SELECT id FROM drafts) RETURNING id
     ), deleted_drafts AS (
       DELETE FROM whatsapp_order_drafts WHERE id IN (SELECT id FROM drafts) RETURNING id
     )
     SELECT (SELECT COUNT(*) FROM deleted_drafts)::int AS drafts,
            (SELECT COUNT(*) FROM deleted_lines)::int AS draft_lines,
            (SELECT COUNT(*) FROM deleted_events)::int AS events,
            (SELECT COUNT(*) FROM updated_retailers)::int AS retailers_set_b2c`,
    []
  );
  return { cleared: true, ...(result.rows[0] || {}) };
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

export async function removeWhatsAppRetailer(counterpartyId: string, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can remove a retailer mapping.");
  const retailer = await executeDatabaseQuery<{ phone_e164: string }>(
    `SELECT phone_e164 FROM whatsapp_retailers WHERE counterparty_id=$1`, [counterpartyId]
  );
  const phone = text(retailer.rows[0]?.phone_e164);
  if (!phone) throw new Error("WhatsApp retailer mapping was not found.");
  const drafts = await executeDatabaseQuery<{ id: string }>(
    `SELECT id FROM whatsapp_order_drafts WHERE counterparty_id=$1 OR phone_e164=$2`, [counterpartyId, phone]
  );
  const draftIds = drafts.rows.map((item) => item.id);
  if (draftIds.length) {
    await executeDatabaseQuery(`DELETE FROM whatsapp_order_events WHERE draft_id = ANY($1::text[])`, [draftIds]);
    await executeDatabaseQuery(`DELETE FROM whatsapp_order_draft_lines WHERE draft_id = ANY($1::text[])`, [draftIds]);
    await executeDatabaseQuery(`DELETE FROM whatsapp_order_drafts WHERE id = ANY($1::text[])`, [draftIds]);
  }
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_lines WHERE phone_e164=$1`, [phone]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_cart_sessions WHERE phone_e164=$1`, [phone]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_registration_requests WHERE phone_e164=$1 AND status IN ('Draft','Pending')`, [phone]);
  await executeDatabaseQuery(`DELETE FROM whatsapp_retailers WHERE counterparty_id=$1`, [counterpartyId]);
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
         address,city,delivery_address,delivery_city,contact_person,latitude,longitude,location_label,channel_scope,created_by,created_at
       ) VALUES ($1,'Shop',$2,$3,'N/A','N/A','N/A',$4,$5,$6,$5,$6,$7,$8,$9,$10,'WhatsApp',$11,NOW())`,
      [counterpartyId, text(registration.shop_name), gstin, phone, text(registration.delivery_address),
        text(registration.city), text(registration.owner_name), registration.latitude || null, registration.longitude || null,
        text(registration.location_label), currentUser.fullName]
    );
  }
  await executeDatabaseQuery(
    `INSERT INTO whatsapp_retailers (
       counterparty_id,phone_e164,salesman_id,default_warehouse_id,billing_type,payment_mode,
       delivery_mode,opted_in_at,active,created_by,created_at,updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),TRUE,$8,NOW(),NOW())`,
    [counterpartyId, phone, input.salesmanId, input.defaultWarehouseId, "B2C",
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
  lines: Array<{ productSku: string; quantity: number; rate: number; cdPercent: number; todPercent: number; minimumQuantity: number; maxQuantity: number }>;
}, currentUser: StaffUser) {
  if (!input.counterpartyIds.length || !input.lines.length) throw new Error("Select retailers and at least one product.");
  if (new Date(input.expiresAt).getTime() <= Date.now()) throw new Error("Offer expiry must be in the future.");
  const stockSnapshot = await getSnapshot();
  const wholesaleWarehouseId = stockSnapshot.warehouses.find((warehouse) => warehouse.id === "C21" || warehouse.name.trim().toLowerCase() === "wholesale warehouse")?.id;
  if (!wholesaleWarehouseId) throw new Error("Wholesale Warehouse is not configured.");
  const wholesaleAvailableSkus = new Set(stockSnapshot.stockSummary
    .filter((stock) => stock.warehouseId === wholesaleWarehouseId && stock.availableQuantity > 0)
    .map((stock) => stock.productSku));
  for (const line of input.lines) {
    if (!wholesaleAvailableSkus.has(line.productSku)) {
      const product = stockSnapshot.products.find((item) => item.sku === line.productSku);
      throw new Error(`${product?.name || line.productSku} is not available at Wholesale Warehouse and cannot be offered.`);
    }
  }
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
      const maxQuantity = Math.max(0, line.maxQuantity || 0);
      if (maxQuantity > 0 && maxQuantity < minimumQuantity) throw new Error(`${pricing.name}: maximum quantity must be at least the MOQ (${minimumQuantity}).`);
      await executeDatabaseQuery(
        `INSERT INTO whatsapp_offer_lines (id,offer_id,product_sku,quantity,rate,cd_percent,tod_percent,minimum_quantity,max_quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id("WAOL"), offerId, line.productSku, Math.max(minimumQuantity, line.quantity), rate, line.cdPercent, line.todPercent, minimumQuantity, maxQuantity]
      );
        const adjustment = line.cdPercent || line.todPercent ? ` | CD ${line.cdPercent}% | TOD ${line.todPercent}%` : "";
        const limit = maxQuantity > 0 ? ` | Max ${maxQuantity}` : " | Max unlimited";
        namedLines.push(`${pricing.name}: ${mrpDiscountLabel(pricing.mrp, rate)} | Your rate ₹${rate.toFixed(2)} | Qty ${Math.max(minimumQuantity, line.quantity)} | Min ${minimumQuantity}${limit}${adjustment}`);
    }
    const expiry = new Date(input.expiresAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const body = `🎯 *Special rate for ${retailer.retailerName}*\n${namedLines.join("\n")}\nValid until ${expiry}. Tap Order Now, or reply to this message with your required quantity.`;
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
  training?: boolean;
  title?: string;
  templateName?: string;
  templateParameters?: string[];
}, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can send broadcasts.");
  const counterpartyIds = Array.from(new Set(input.counterpartyIds)).slice(0, 500);
  const prepared = prepareTrainingBroadcast(input);
  const message = prepared.message;
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
        const parameters = (prepared.parameters || [retailer.retailerName])
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
  warehouseId: string; billingType: "B2B" | "B2C"; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Delivery" | "Self Collection";
  note?: string; lines: Array<{ id: string; quantity: number; rate: number; cdPercent: number; todPercent: number }>;
}, currentUser: StaffUser) {
  const loaded = await loadDraft(draftId);
  if (!isWhatsAppAdminUser(currentUser) && numberValue(loaded.draft.salesman_id) !== currentUser.id) throw new Error("This order belongs to another salesperson.");
  if (["Processing", "Completed"].includes(text(loaded.draft.status))) throw new Error("A confirmed order cannot be edited.");
  if (!input.lines.length) throw new Error("Keep at least one product, or deny the complete order.");
  if (input.lines.length > loaded.lines.length || new Set(input.lines.map((line) => line.id)).size !== input.lines.length) throw new Error("Review contains invalid order lines.");
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
    `DELETE FROM whatsapp_order_draft_lines WHERE draft_id=$1 AND id <> ALL($2::text[])`,
    [draftId, input.lines.map((line) => line.id)]
  );
  await executeDatabaseQuery(
    `UPDATE whatsapp_order_drafts SET warehouse_id=$2,billing_type=$3,payment_mode=$4,cash_timing=$5,delivery_mode=$6,note=$7,status='Staff Approved',reviewed_at=NOW() WHERE id=$1`,
    [draftId, input.warehouseId, input.billingType, input.paymentMode, input.cashTiming || null, input.deliveryMode, input.note || text(loaded.draft.note)]
  );
  const finalDraft = await loadDraft(draftId);
  const summary = compactProforma(draftId, finalDraft.draft, finalDraft.lines);
  const sent = await sendButtons(text(finalDraft.draft.phone_e164), summary,
    [
      { id: `wa-confirm:${draftId}`, title: "Confirm Order" },
      { id: `wa-change:${draftId}`, title: "Request Change" },
      { id: `wa-proforma:${draftId}`, title: "View Proforma" }
    ], "Draft", draftId);
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

export async function updateWhatsAppRetailerPreferences(counterpartyId: string, input: { marketingOptIn: boolean; tags: string[]; allowLaterCollection?: boolean; allowPartialCollection?: boolean; allowChequeCollection?: boolean; collectionTolerance?: number }, currentUser: StaffUser) {
  if (!isWhatsAppAdminUser(currentUser)) throw new Error("Only the WhatsApp admin can update retailer preferences.");
  const tags = Array.from(new Set(input.tags.map((tag) => compact(tag, 40)).filter(Boolean))).slice(0, 20);
  await executeDatabaseQuery(
    `UPDATE whatsapp_retailers SET marketing_opt_in=$2,paused_at=CASE WHEN $2 THEN NULL ELSE COALESCE(paused_at,NOW()) END,tags_json=$3::jsonb,updated_at=NOW() WHERE counterparty_id=$1`,
    [counterpartyId, input.marketingOptIn, JSON.stringify(tags)]
  );
  if (input.allowLaterCollection !== undefined || input.allowPartialCollection !== undefined || input.allowChequeCollection !== undefined || input.collectionTolerance !== undefined) {
    await executeDatabaseQuery(
      `UPDATE counterparties
       SET allow_later_collection=COALESCE($2,allow_later_collection), allow_partial_collection=COALESCE($3,allow_partial_collection),
           allow_cheque_collection=COALESCE($4,allow_cheque_collection), collection_tolerance=COALESCE($5,collection_tolerance)
       WHERE id=$1 AND type='Shop'`,
      [counterpartyId, input.allowLaterCollection ?? null, input.allowPartialCollection ?? null, input.allowChequeCollection ?? null, input.collectionTolerance === undefined ? null : Math.max(0, input.collectionTolerance)]
    );
  }
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
  const header = ["id", "title", "description", "availability", "condition", "price", "sale_price", "link", "image_link", "brand", "product_type"];
  const rows = snapshot.products.flatMap((product: ProductMaster) => {
    // A retailer catalogue must never expose an internal purchase rate. Products
    // without a customer-facing price stay out of Meta until their RSP/MRP is set.
    const rate = product.offerPrice || product.rsp || product.mrp || latestSaleRates.get(product.sku) || 0;
    if (!product.whatsappCatalogEnabled || rate <= 0) return [];
    const mrp = numberValue(product.mrp);
    const cataloguePrice = mrp > 0 ? mrp : rate;
    const salePrice = rate > 0 && mrp > rate ? rate : 0;
    const offPercent = discountPercentFromMrp(mrp, rate);
    return [
      [
        product.sku, product.name, [product.size, product.unit, mrp > 0 ? `MRP Rs.${mrp.toFixed(2)}` : "", offPercent > 0 ? `${offPercent.toFixed(2)}% off MRP` : "", `Minimum order ${Math.max(1, numberValue(product.minimumOrderQuantity, 1))}`, product.offerLabel, product.remarks].filter(Boolean).join(" | "),
        "in stock", "new", `${cataloguePrice.toFixed(2)} INR`, salePrice ? `${salePrice.toFixed(2)} INR` : "", `${publicWeb}/?product=${encodeURIComponent(product.sku)}`,
        product.catalogImageKey
          ? `${process.env.PUBLIC_API_URL || "https://b2b-v8kb.onrender.com"}/whatsapp/catalog/images/${encodeURIComponent(product.sku)}?token=${encodeURIComponent(expected)}&v=${encodeURIComponent(product.catalogImageUpdatedAt || product.catalogImageKey)}`
          : `${publicWeb}/business-connect-icon-512.png`,
        product.brand || "Aapoorti",
        product.department || product.division || product.category || "General"
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
