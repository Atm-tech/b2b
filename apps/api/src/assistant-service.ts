import type { AppSnapshot, AppUser, Counterparty, ProductMaster, PurchaseOrder, SalesOrder, Warehouse } from "@aapoorti-b2b/domain";
import { classifyOfflineIntent, expandProductAlias, OFFLINE_FILTER_WORDS } from "./assistant-language-data.js";

type AssistantMetric = "highest_margin" | "lowest_margin" | "highest_sales" | "lowest_sales" | "none";
type AssistantIntent = "analytics" | "order" | "help";
type OrderSide = "Sales" | "Purchase" | "Unknown";
export type AssistantResponseLanguage = "english" | "hinglish";

type ParsedAssistantRequest = {
  intent: AssistantIntent;
  side: OrderSide;
  metric: AssistantMetric;
  productFilter: string;
  partyQuery: string;
  warehouseQuery: string;
  paymentMode: string;
  deliveryMode: string;
  billingType: "B2B" | "B2C" | "Unknown";
  lines: Array<{ productQuery: string; quantity: number; rate: number }>;
};

export type AssistantCandidate = {
  id: string;
  label: string;
  detail: string;
  score: number;
};

export type AssistantOrderLineDraft = {
  query: string;
  quantity: number;
  rate: number;
  candidates: Array<AssistantCandidate & { gstRate: number; taxMode: "Exclusive" | "Inclusive"; availableStock: number; lastPurchaseRate: number }>;
};

export type AssistantOrderDraft = {
  side: "Sales" | "Purchase";
  partyLabel: string;
  partyCandidates: AssistantCandidate[];
  warehouseCandidates: AssistantCandidate[];
  paymentMode: string;
  cashTiming: string;
  deliveryMode: string;
  billingType: "B2B" | "B2C";
  note: string;
  lines: AssistantOrderLineDraft[];
};

export type AssistantAnalyticsRow = {
  sku: string;
  product: string;
  quantitySold: number;
  salesValue: number;
  purchaseCost: number;
  sellingRate: number;
  marginAmount: number;
  marginPercent: number;
};

export type AssistantReply = {
  kind: "answer" | "order_draft";
  message: string;
  spokenMessage?: string;
  engine: "openai" | "local";
  analytics?: { metric: AssistantMetric; filter: string; rows: AssistantAnalyticsRow[]; costBasis: string };
  draft?: AssistantOrderDraft;
};

const EMPTY_PARSE: ParsedAssistantRequest = {
  intent: "help",
  side: "Unknown",
  metric: "none",
  productFilter: "",
  partyQuery: "",
  warehouseQuery: "",
  paymentMode: "",
  deliveryMode: "",
  billingType: "Unknown",
  lines: []
};

const HINDI_NUMBER_WORDS: Array<[string, number]> = [
  ["शून्य", 0], ["एक", 1], ["दो", 2], ["तीन", 3], ["चार", 4], ["पांच", 5], ["पाँच", 5], ["छह", 6], ["छः", 6], ["सात", 7], ["आठ", 8], ["नौ", 9], ["दस", 10],
  ["ग्यारह", 11], ["बारह", 12], ["तेरह", 13], ["चौदह", 14], ["पंद्रह", 15], ["पन्द्रह", 15], ["सोलह", 16], ["सत्रह", 17], ["अठारह", 18], ["उन्नीस", 19], ["बीस", 20],
  ["इक्कीस", 21], ["बाईस", 22], ["तेईस", 23], ["चौबीस", 24], ["पच्चीस", 25], ["छब्बीस", 26], ["सत्ताईस", 27], ["अट्ठाईस", 28], ["उनतीस", 29], ["तीस", 30],
  ["इकतीस", 31], ["बत्तीस", 32], ["तैंतीस", 33], ["चौंतीस", 34], ["चौतीस", 34], ["पैंतीस", 35], ["छत्तीस", 36], ["सैंतीस", 37], ["अड़तीस", 38], ["अड़तीस", 38], ["उनतालीस", 39], ["चालीस", 40],
  ["इकतालीस", 41], ["बयालीस", 42], ["तैंतालीस", 43], ["चवालीस", 44], ["पैंतालीस", 45], ["छियालीस", 46], ["सैंतालीस", 47], ["अड़तालीस", 48], ["अड़तालीस", 48], ["उनचास", 49], ["पचास", 50],
  ["इक्यावन", 51], ["बावन", 52], ["तिरपन", 53], ["चौवन", 54], ["पचपन", 55], ["छप्पन", 56], ["सत्तावन", 57], ["अट्ठावन", 58], ["उनसठ", 59], ["साठ", 60],
  ["इकसठ", 61], ["बासठ", 62], ["तिरसठ", 63], ["चौंसठ", 64], ["पैंसठ", 65], ["छियासठ", 66], ["सड़सठ", 67], ["अड़सठ", 68], ["उनहत्तर", 69], ["सत्तर", 70],
  ["इकहत्तर", 71], ["बहत्तर", 72], ["तिहत्तर", 73], ["चौहत्तर", 74], ["पचहत्तर", 75], ["छिहत्तर", 76], ["सतहत्तर", 77], ["अठहत्तर", 78], ["उन्नासी", 79], ["अस्सी", 80],
  ["इक्यासी", 81], ["बयासी", 82], ["तिरासी", 83], ["चौरासी", 84], ["पचासी", 85], ["छियासी", 86], ["सतासी", 87], ["अट्ठासी", 88], ["नवासी", 89], ["नब्बे", 90],
  ["इक्यानवे", 91], ["बानवे", 92], ["तिरानवे", 93], ["चौरानवे", 94], ["पंचानवे", 95], ["छियानवे", 96], ["सत्तानवे", 97], ["अट्ठानवे", 98], ["निन्यानवे", 99], ["सौ", 100]
];

function replaceHindiNumberWords(value: string) {
  return HINDI_NUMBER_WORDS.reduce((result, [word, number]) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return result.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), `$1${number}`);
  }, value);
}

function normalize(value: string) {
  return replaceHindiNumberWords(value.toLowerCase())
    .replace(/[०-९]/g, (digit) => String("०१२३४५६७८९".indexOf(digit)))
    .replace(/\b(?:bada|bade|badi|badhiya|achha|acha|accha|zyada|jyada|jyaada|high|best)\s+(?:margin|margen|marjin|munafa|munaafa|fayda|faayda|profit)\b/g, " highest margin ")
    .replace(/\b(?:margin|margen|marjin|munafa|munaafa|fayda|faayda|profit)\s+(?:bada|bade|badi|badhiya|achha|acha|accha|zyada|jyada|jyaada|high|best)\b/g, " highest margin ")
    .replace(/\b(?:kam|chhota|chote|choti|low)\s+(?:margin|margen|marjin|munafa|munaafa|fayda|faayda|profit)\b/g, " lowest margin ")
    .replace(/\b(?:margin|margen|marjin|munafa|munaafa|fayda|faayda|profit)\s+(?:kam|chhota|chote|choti|low)\b/g, " lowest margin ")
    .replace(/\b(?:sabse\s+)?(?:zyada|jyada|jyaada|adhik|most)\s+(?:bikne|bikta|bika|selling)\b/g, " highest sales ")
    .replace(/\b(?:sabse\s+)?(?:kam|least)\s+(?:bikne|bikta|bika|selling)\b/g, " lowest sales ")
    .replace(/सबसे\s+(?:ज़्यादा|ज्यादा|अधिक)/g, " highest ")
    .replace(/सबसे\s+कम/g, " lowest ")
    .replace(/(?:मार्जिन|मुनाफा|लाभ)/g, " margin ")
    .replace(/(?:बिक्री|सेल्स?)/g, " sales ")
    .replace(/sales\s+ऑर्डर/g, " sales order ")
    .replace(/(?:सेल|सेल्स|बिक्री)\s*(?:ऑर्डर|आर्डर|आदेश)/g, " sales order ")
    .replace(/(?:परचेज|खरीद)\s+ऑर्डर/g, " purchase order ")
    .replace(/(?:परचेस|परचेज|पर्चेस|पर्चेज|खरीद)\s*(?:ऑर्डर|आर्डर|आदेश)/g, " purchase order ")
    .replace(/(?:लाख|लख|लक्स)\s*(?:का\s*)?(?:साबुन|सोप)/g, " lux soap ")
    .replace(/(\d+)\s*(?:लाख|लख)(?=\s|$)/g, " $1 lux ")
    .replace(/(?:कुक|कूक)?\s*(?:डव|डोव|दव|दोव)/g, " dove ")
    .replace(/(?:लक्स)/g, " lux ")
    .replace(/(?:साबुन|सोप)/g, " soap ")
    .replace(/(?:उत्पाद|प्रोडक्ट्स?)/g, " product ")
    .replace(/(?:दिखाओ|बताओ|बता\s+दो)/g, " show ")
    .replace(/(?:बना\s+दो|बनाओ|बना|तैयार\s+करो)/g, " create ")
    .replace(/(?:सेल्स\s+ऑर्डर|बिक्री\s+ऑर्डर)/g, " sales order ")
    .replace(/(?:परचेज\s+ऑर्डर|खरीद\s+ऑर्डर)/g, " purchase order ")
    .replace(/(?:एस\s*ओ|एसओ)/g, " so ")
    .replace(/(?:पी\s*ओ|पीओ)/g, " po ")
    .replace(/(?:ग्राहक|कस्टमर)/g, " customer ")
    .replace(/(?:दुकान|शॉप|स्टोर|स्टोर्स)/g, " store ")
    .replace(/(?:सप्लायर|आपूर्तिकर्ता|वेंडर)/g, " supplier ")
    .replace(/(?:रेट|भाव|कीमत)/g, " rate ")
    .replace(/(?:मात्रा|क्वांटिटी)/g, " quantity ")
    .replace(/के\s+लिए/g, " for ")
    .replace(/(?:और|फिर|उसके\s+बाद)/g, " and ")
    .replace(/से/g, " from ")
    .replace(/(?:^|\s)1(?=\s+(?:sales|purchase)\s+order)/g, " ")
    .replace(/(?:^|\s)(?:एक)(?=\s|$)/g, " 1 ")
    .replace(/(?:^|\s)(?:दो)(?=\s|$)/g, " 2 ")
    .replace(/(?:^|\s)(?:तीन)(?=\s|$)/g, " 3 ")
    .replace(/(?:^|\s)(?:चार)(?=\s|$)/g, " 4 ")
    .replace(/(?:^|\s)(?:पांच|पाँच)(?=\s|$)/g, " 5 ")
    .replace(/(?:^|\s)(?:छह)(?=\s|$)/g, " 6 ")
    .replace(/(?:^|\s)(?:सात)(?=\s|$)/g, " 7 ")
    .replace(/(?:^|\s)(?:आठ)(?=\s|$)/g, " 8 ")
    .replace(/(?:^|\s)(?:नौ)(?=\s|$)/g, " 9 ")
    .replace(/(?:^|\s)(?:दस)(?=\s|$)/g, " 10 ")
    .replace(/(?:^|\s)(?:बीस)(?=\s|$)/g, " 20 ")
    .replace(/(?:^|\s)(?:तीस)(?=\s|$)/g, " 30 ")
    .replace(/(?:^|\s)(?:चालीस)(?=\s|$)/g, " 40 ")
    .replace(/(?:^|\s)(?:पचास)(?=\s|$)/g, " 50 ")
    .replace(/(?:^|\s)(?:सौ)(?=\s|$)/g, " 100 ")
    .replace(/\b(?:sabse\s+jyaada|sabse\s+jyada|sabse\s+zyada|sabse\s+adhik)\b/g, " highest ")
    .replace(/\bsabse\s+kam\b/g, " lowest ")
    .replace(/\b(?:munafa|munaafa|fayda|faayda|laabh)\b/g, " margin ")
    .replace(/\b(?:bikri|becha|selling)\b/g, " sales ")
    .replace(/\b(?:sabun|saboon|saabun)\b/g, " soap ")
    .replace(/\b(?:dikhao|batao|bataye|bataiye)\b/g, " show ")
    .replace(/\b(?:banao|banaao|bana\s+do|taiyar\s+karo)\b/g, " create ")
    .replace(/\b(?:grahak|dukaan|dukan)\b/g, " customer ")
    .replace(/\bke\s+liye\b/g, " for ")
    .replace(/\bse\b/g, " from ")
    .replace(/\b(?:kharid|khareed)\s+order\b/g, " purchase order ")
    .replace(/\b(?:bechne|bikri)\s+(?:ka\s+)?order\b/g, " sales order ")
    .replace(/\b(?:sale|selling|customer)\s+order\b/g, " sales order ")
    .replace(/\b(?:buy|buying|supplier|vendor)\s+order\b/g, " purchase order ")
    .replace(/\bs\s+o\b/g, " so ")
    .replace(/\bp\s+o\b/g, " po ")
    .replace(/\b(?:das)\b/g, "10")
    .replace(/\b(?:bees|bis)\b/g, "20")
    .replace(/\b(?:tees|tis)\b/g, "30")
    .replace(/\b(?:pachas)\b/g, "50")
    .replace(/[^a-z0-9\s.]/g, " ")
    .replace(/\ba\s*1\b/g, "a one")
    .replace(/\b(?:higest|heighest|higgest)\b/g, "highest")
    .replace(/\b(?:margen|marjin)\b/g, "margin")
    .replace(/\b(?:loest|lowst)\b/g, "lowest")
    .replace(/\bsoaps\b/g, "soap")
    .replace(/\bproducts\b/g, "product")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalize(value).split(" ").filter((item) => item.length > 1);
}

function levenshtein(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = previous;
    }
  }
  return row[b.length];
}

function phoneticInitial(value: string) {
  const initial = value[0] || "";
  if (/[kgq]/.test(initial)) return "k";
  if (/[pbvf]/.test(initial)) return "p";
  if (/[td]/.test(initial)) return "t";
  if (/[szx]/.test(initial)) return "s";
  if (/[cj]/.test(initial)) return "c";
  return initial;
}

function correctSpokenQuery(query: string, vocabularyValues: string[]) {
  const normalizedQuery = expandProductAlias(normalize(query));
  const vocabulary = Array.from(new Set(vocabularyValues.flatMap((value) => tokens(value)).filter((token) => token.length >= 3)));
  return normalizedQuery.split(" ").map((token) => {
    if (token.length < 3 || /^\d/.test(token) || vocabulary.includes(token)) return token;
    let best = token;
    let bestScore = 0;
    vocabulary.forEach((candidate) => {
      if (Math.abs(candidate.length - token.length) > 2) return;
      const similarity = 1 - levenshtein(token, candidate) / Math.max(token.length, candidate.length, 1);
      const score = similarity
        + (phoneticInitial(token) === phoneticInitial(candidate) ? 0.08 : 0)
        + (token.at(-1) === candidate.at(-1) ? 0.04 : 0);
      if (score > bestScore) { best = candidate; bestScore = score; }
    });
    return bestScore >= 0.68 ? best : token;
  }).join(" ");
}

function correctPartySpokenQuery(query: string, vocabularyValues: string[]) {
  const contextCorrected = query
    .replace(/(?:कुत्ता|कुट्टा|गुत्ता)\s*(?=(?:सेल|सेल्स|स्टोर|ट्रेडर्स))/g, "gupta ")
    .replace(/\b(?:kutta|kuta|gutta|guptha)\b(?=\s+(?:sales|store|stores|traders|agency)\b)/gi, "gupta");
  return correctSpokenQuery(contextCorrected, vocabularyValues);
}

function matchScore(query: string, values: string[]) {
  const needle = normalize(query);
  if (!needle) return 1;
  const normalizedValues = values.map(normalize).filter(Boolean);
  if (normalizedValues.some((value) => value === needle)) return 1000;
  if (normalizedValues.some((value) => value.startsWith(needle))) return 850;
  if (normalizedValues.some((value) => value.includes(needle))) return 700;
  const queryTokens = tokens(needle);
  const haystack = normalizedValues.join(" ");
  const matchedTokens = queryTokens.filter((token) => haystack.includes(token));
  if (queryTokens.length > 0 && matchedTokens.length === queryTokens.length) return 500 + matchedTokens.length * 20;
  if (matchedTokens.length > 0) return 250 + matchedTokens.length * 20;
  const distances = normalizedValues.map((value) => levenshtein(needle, value));
  const distance = Math.min(...distances, 999);
  const longest = Math.max(needle.length, ...normalizedValues.map((value) => value.length), 1);
  const similarity = 1 - distance / longest;
  return similarity >= 0.55 ? Math.round(similarity * 200) : 0;
}

function productValues(product: ProductMaster) {
  return [product.sku, product.name, product.brand || "", product.shortName || "", product.barcode || "", product.articleName || "", product.itemName || "", product.division, product.department, product.section, product.category, product.subCategory, product.size || ""];
}

function productSearchScore(query: string, product: ProductMaster) {
  query = expandProductAlias(query);
  const directValues = [product.sku, product.name, product.brand || "", product.shortName || "", product.barcode || "", product.articleName || "", product.itemName || ""];
  const direct = matchScore(query, directValues);
  const classification = matchScore(query, [product.division, product.department, product.section, product.category, product.subCategory, product.size || ""]);
  const firstToken = tokens(query)[0] || "";
  const firstTokenBonus = firstToken && normalize(directValues.join(" ")).includes(firstToken) ? 300 : 0;
  // Product-name/brand evidence should beat a coincidental category token when a
  // salesperson says something like "Dove soap" and no exact SKU exists.
  return direct > 0 ? direct + 250 + firstTokenBonus : classification;
}

function namedEntityScore(query: string, name: string, otherValues: string[]) {
  const base = matchScore(query, [name, ...otherValues]);
  const queryTokens = tokens(query);
  const normalizedName = normalize(name);
  const firstTokenBonus = queryTokens[0] && normalizedName.includes(queryTokens[0]) ? 350 : 0;
  const allTokensBonus = queryTokens.length > 1 && queryTokens.every((token) => normalizedName.includes(token)) ? 300 : 0;
  return base + firstTokenBonus + allTokensBonus;
}

function productLabel(product: ProductMaster) {
  return [product.name, product.brand, product.size].filter(Boolean).join(" · ") || product.sku;
}

function latestPurchaseBySku(snapshot: AppSnapshot) {
  const result = new Map<string, PurchaseOrder>();
  [...snapshot.purchaseOrders]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .forEach((order) => {
      if (!result.has(order.productSku)) result.set(order.productSku, order);
    });
  return result;
}

function recentSalesRate(snapshot: AppSnapshot, sku: string) {
  const sale = [...snapshot.salesOrders]
    .filter((item) => item.productSku === sku && item.status !== "Cancelled")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  return sale ? (sale.cdTodRate > 0 ? sale.cdTodRate : sale.rate) : 0;
}

function lastPurchaseRate(snapshot: AppSnapshot, product: ProductMaster, latestPurchases = latestPurchaseBySku(snapshot)) {
  return latestPurchases.get(product.sku)?.rate || product.rsp || product.slabs[0]?.purchaseRate || 0;
}

function splitOrderSegments(value: string) {
  const normalizedValue = normalize(value.replace(/,/g, " and "));
  const chunks = normalizedValue
    .split(/\band\b|\baur\b|\bphir\b|\bplus\b|(?=\b\d+(?:\.\d+)?\s*(?:ka|ki|ke)?\s*rate\b)|(?=\brate\s*\d)/gi)
    .map((item) => item.trim())
    .filter(Boolean);
  return chunks.reduce<string[]>((segments, chunk) => {
    const modifierRemainder = normalize(chunk)
      .replace(/\d+(?:\.\d+)?/g, " ")
      .replace(/\b(?:qty|quantity|rate|at|rs|inr|piece|pieces|pcs|unit|units|ka|ki|ke|se|from)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!modifierRemainder && segments.length > 0) segments[segments.length - 1] += ` ${chunk}`;
    else segments.push(chunk);
    return segments;
  }, []);
}

function parseOrderLine(segment: string, partyQuery: string) {
  let working = normalize(segment);
  working = working.replace(/\b(\d{7,})\b/g, (match, raw: string, offset: number, source: string) => {
    if (/\brate\s*$/i.test(source.slice(Math.max(0, offset - 12), offset))) return match;
    const numeric = Number(raw);
    const lakhQuantity = numeric / 100_000;
    return numeric % 100_000 === 0 && lakhQuantity >= 1 && lakhQuantity <= 999 ? `${lakhQuantity} lux` : match;
  });
  let rate = 0;
  let quantity = 0;
  const rateBeforeLabel = working.match(/\b(\d+(?:\.\d+)?)\s*(?:ka|ki|ke)?\s*rate\b(?:\s*(?:se|from))?/i);
  const rateAfterLabel = working.match(/\b(?:at|rate)\s*(?:rs\.?|inr)?\s*(\d+(?:\.\d+)?)/i);
  const rateMatch = rateBeforeLabel || rateAfterLabel;
  if (rateMatch) {
    rate = Number(rateMatch[1]);
    working = working.replace(rateMatch[0], " ");
  }
  const quantityAfterNumber = working.match(/\b(\d+(?:\.\d+)?)\s*(?:qty|quantity|piece|pieces|pcs|unit|units)\b/i);
  const quantityAfterLabel = working.match(/\b(?:qty|quantity)\s*(\d+(?:\.\d+)?)/i);
  const quantityMatch = quantityAfterNumber || quantityAfterLabel;
  if (quantityMatch) {
    quantity = Number(quantityMatch[1]);
    working = working.replace(quantityMatch[0], " ");
  }
  const remainingNumbers = [...working.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((item) => ({ text: item[0], value: Number(item[0]) }));
  if (!quantity && remainingNumbers.length > 0) {
    quantity = remainingNumbers[0].value;
    working = working.replace(new RegExp(`\\b${remainingNumbers[0].text.replace(".", "\\.")}\\b`), " ");
  }
  if (!rate && remainingNumbers.length > 1) {
    rate = remainingNumbers[remainingNumbers.length - 1].value;
    working = working.replace(new RegExp(`\\b${remainingNumbers[remainingNumbers.length - 1].text.replace(".", "\\.")}\\b`), " ");
  }
  const normalizedParty = normalize(partyQuery);
  let productQuery = working;
  if (normalizedParty) productQuery = productQuery.replace(normalizedParty, " ");
  productQuery = productQuery
    .replace(/\b\d+(?:\.\d+)?\b/g, " ")
    .replace(/\b(create|make|generate|book|prepare|sales|purchase|order|so|po|for|from|to|bana|banao|qty|quantity|piece|pieces|pcs|unit|units|ka|ki|ke|liye|at|rate|rs|inr)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { productQuery: quantity > 0 ? expandProductAlias(productQuery) : "", quantity: quantity || 1, rate };
}

function fallbackParse(text: string, snapshot: AppSnapshot): ParsedAssistantRequest {
  const value = normalize(text);
  const classified = classifyOfflineIntent(value);
  const classifiedOrder = classified.intent === "sales_order" || classified.intent === "purchase_order";
  const isOrder = classifiedOrder || /\b(create|make|generate|book|prepare|order|po|so|purchase|buy|sell)\b/.test(value)
    && !/\b(highest|lowest|widest|best|top|least|margin)\b/.test(value.replace(/sales order/g, "order"));
  const metric: AssistantMetric = classified.intent === "highest_margin" || classified.intent === "lowest_margin"
    || classified.intent === "highest_sales" || classified.intent === "lowest_sales"
    ? classified.intent
    : /\b(highest|widest|best|top|maximum|max)\b/.test(value) && /margin/.test(value)
    ? "highest_margin"
    : /\b(lowest|least|minimum|min)\b/.test(value) && /margin/.test(value)
      ? "lowest_margin"
      : /\b(highest|best|top|maximum|max)\b/.test(value) && /\bsales?\b/.test(value)
        ? "highest_sales"
        : /\b(lowest|least|minimum|min)\b/.test(value) && /\bsales?\b/.test(value)
          ? "lowest_sales"
          : "none";
  const side: OrderSide = classified.intent === "purchase_order" || /\b(po|purchase order|purchase|buy)\b/.test(value)
    ? "Purchase"
    : classified.intent === "sales_order" || /\b(so|sales order|sell)\b/.test(value)
      ? "Sales"
      : "Unknown";
  const productFilter = expandProductAlias(tokens(value).filter((token) => !OFFLINE_FILTER_WORDS.has(token)).join(" "));
  const partyType = side === "Purchase" ? "Supplier" : "Shop";
  const hinglishPartyMatch = side === "Purchase"
    ? text.match(/([^,:]+?)\s+se\s+(?:po|purchase|kharid|khareed)\b/i)
    : text.match(/([^,:]+?)\s+ke\s+liye\s+(?:so|sales|bikri)?\b/i);
  const normalizedPartyMatch = side === "Purchase"
    ? value.match(/([^,:]+?)\s+from\s+(?:po|purchase order|purchase)\b/i)
    : value.match(/([^,:]+?)\s+for\s+(?:so|sales order|sales)?\b/i);
  const explicitPartyMatch = side === "Purchase"
    ? text.match(/(?:\bfrom\b|\bsupplier\b|\bvendor\b)\s+([^,:]+?)(?=\s*:|,|\s+with\b|$)/i)
    : text.match(/(?:\bfor\b|\bcustomer\b|\bshop\b)\s+([^,:]+?)(?=\s*:|,|\s+with\b|$)/i);
  const explicitPartyQuery = (explicitPartyMatch?.[1] || hinglishPartyMatch?.[1] || normalizedPartyMatch?.[1] || "")
    .replace(/\b(?:create|make|banao|banaao|order)\b/gi, " ")
    .trim();
  const eligibleParties = snapshot.counterparties.filter((item) => item.type === partyType);
  const correctedPartyQuery = correctPartySpokenQuery(explicitPartyQuery, eligibleParties.flatMap((item) => [item.name, item.contactPerson, item.city]));
  const party = eligibleParties
    .map((item) => ({ item, score: namedEntityScore(correctedPartyQuery || text, item.name, [item.contactPerson, item.mobileNumber, item.city]) }))
    .sort((left, right) => right.score - left.score)[0];
  const warehouse = snapshot.warehouses
    .map((item) => ({ item, score: matchScore(text, [item.id, item.name, item.city, item.address]) }))
    .sort((left, right) => right.score - left.score)[0];
  const paymentMode = snapshot.settings.paymentMethods.find((item) => value.includes(normalize(item.code)) || value.includes(normalize(item.label)))?.code || "";
  const billingType = /\bb2b\b/.test(value) ? "B2B" : /\bb2c\b/.test(value) ? "B2C" : "Unknown";
  const deliveryMode = /self collection|self pickup|pickup/.test(value) ? "Self Collection" : /delivery|dealer delivery/.test(value) ? (side === "Purchase" ? "Dealer Delivery" : "Delivery") : "";
  const tail = text.includes(":") ? text.slice(text.indexOf(":") + 1) : text;
  const productVocabulary = snapshot.products.flatMap((product) => productValues(product));
  const lines = splitOrderSegments(tail)
    .map((segment) => parseOrderLine(segment, explicitPartyQuery))
    .map((line) => ({ ...line, productQuery: correctSpokenQuery(line.productQuery, productVocabulary) }))
    .filter((line) => line.productQuery && snapshot.products.some((product) => matchScore(line.productQuery, productValues(product)) > 0));

  return {
    ...EMPTY_PARSE,
    intent: metric !== "none" ? "analytics" : isOrder || side !== "Unknown" ? "order" : "help",
    side,
    metric,
    productFilter,
    partyQuery: correctedPartyQuery || (party && party.score >= 500 ? party.item.name : ""),
    warehouseQuery: warehouse && warehouse.score >= 500 ? warehouse.item.name : "",
    paymentMode,
    deliveryMode,
    billingType,
    lines
  };
}

async function openAiParse(text: string): Promise<ParsedAssistantRequest | null> {
  if (process.env.ASSISTANT_USE_OPENAI?.trim().toLowerCase() !== "true") return null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const model = process.env.OPENAI_ASSISTANT_MODEL?.trim() || "gpt-4o-mini";
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["intent", "side", "metric", "productFilter", "partyQuery", "warehouseQuery", "paymentMode", "deliveryMode", "billingType", "lines"],
    properties: {
      intent: { type: "string", enum: ["analytics", "order", "help"] },
      side: { type: "string", enum: ["Sales", "Purchase", "Unknown"] },
      metric: { type: "string", enum: ["highest_margin", "lowest_margin", "highest_sales", "lowest_sales", "none"] },
      productFilter: { type: "string" },
      partyQuery: { type: "string" },
      warehouseQuery: { type: "string" },
      paymentMode: { type: "string" },
      deliveryMode: { type: "string" },
      billingType: { type: "string", enum: ["B2B", "B2C", "Unknown"] },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["productQuery", "quantity", "rate"],
          properties: {
            productQuery: { type: "string" },
            quantity: { type: "number" },
            rate: { type: "number" }
          }
        }
      }
    }
  };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        store: false,
        instructions: "Extract an Aapoorti B2B assistant request written or spoken in English, Hindi, or Roman-script Hinglish. An SO is a Sales order and a PO is a Purchase order. Analytics includes highest/lowest/widest margin and highest/lowest sales. For orders, extract the customer or supplier, warehouse, payment/delivery/billing choices, and every product with quantity and explicit rate. Translate extracted intent fields to English. Use empty strings and zero for details not stated. Never invent product identifiers.",
        input: text,
        text: { format: { type: "json_schema", name: "aapoorti_assistant_request", strict: true, schema } }
      }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return null;
    const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
    const outputText = body.output_text || body.output?.flatMap((item) => item.content || []).map((item) => item.text || "").join("") || "";
    return outputText ? JSON.parse(outputText) as ParsedAssistantRequest : null;
  } catch {
    return null;
  }
}

function candidate<T>(query: string, items: T[], getId: (item: T) => string, getLabel: (item: T) => string, getDetail: (item: T) => string, getValues: (item: T) => string[], limit = 5) {
  return items
    .map((item) => ({ item, score: matchScore(query, getValues(item)) }))
    .filter((entry) => !query || entry.score > 0)
    .sort((left, right) => right.score - left.score || getLabel(left.item).localeCompare(getLabel(right.item), "en-IN"))
    .slice(0, limit)
    .map((entry) => ({ id: getId(entry.item), label: getLabel(entry.item), detail: getDetail(entry.item), score: entry.score }));
}

function analyticsReply(parsed: ParsedAssistantRequest, snapshot: AppSnapshot, engine: "openai" | "local", language: AssistantResponseLanguage): AssistantReply {
  const latestPurchases = latestPurchaseBySku(snapshot);
  const filter = parsed.productFilter.trim();
  // Keep products close to the best language match. This lets "soap" include all
  // soaps, while "Lux soap" prefers Lux instead of ranking every soap by margin.
  const scoredProducts = snapshot.products.map((product) => ({ product, score: filter ? productSearchScore(filter, product) : 1 }));
  const bestProductScore = Math.max(0, ...scoredProducts.map((entry) => entry.score));
  const productPool = scoredProducts
    .filter((entry) => !filter || (entry.score >= 250 && entry.score >= bestProductScore - 100))
    .map((entry) => entry.product);
  const metric = parsed.metric === "none" ? "highest_sales" : parsed.metric;
  const rows = productPool.map((product) => {
    const sales = snapshot.salesOrders.filter((item) => item.productSku === product.sku && item.status !== "Cancelled");
    const quantitySold = sales.reduce((sum, item) => sum + item.quantity, 0);
    const salesValue = sales.reduce((sum, item) => sum + item.totalAmount, 0);
    const discountedPreTaxSales = sales.reduce((sum, item) => sum + Math.max(0, item.taxableAmount - item.cdAmount - item.todAmount), 0);
    const historicalSellingRate = quantitySold > 0 ? discountedPreTaxSales / quantitySold : 0;
    const purchaseCost = lastPurchaseRate(snapshot, product, latestPurchases);
    const sellingRate = historicalSellingRate || product.mrp || product.rsp || purchaseCost;
    const marginAmount = sellingRate - purchaseCost;
    const marginPercent = sellingRate > 0 ? marginAmount / sellingRate * 100 : 0;
    return {
      sku: product.sku,
      product: productLabel(product),
      quantitySold: Number(quantitySold.toFixed(2)),
      salesValue: Number(salesValue.toFixed(2)),
      purchaseCost: Number(purchaseCost.toFixed(2)),
      sellingRate: Number(sellingRate.toFixed(2)),
      marginAmount: Number(marginAmount.toFixed(2)),
      marginPercent: Number(marginPercent.toFixed(2))
    };
  }).filter((row) => !metric.includes("margin") || (row.purchaseCost > 0 && row.sellingRate > 0));
  rows.sort((left, right) => {
    if (metric === "highest_margin") return right.marginAmount - left.marginAmount;
    if (metric === "lowest_margin") return left.marginAmount - right.marginAmount;
    if (metric === "lowest_sales") return left.salesValue - right.salesValue;
    return right.salesValue - left.salesValue;
  });
  const visibleRows = rows.slice(0, 8);
  const metricLabel = metric === "highest_margin" ? "highest margin" : metric === "lowest_margin" ? "lowest margin" : metric === "lowest_sales" ? "lowest sales" : "highest sales";
  const scopeLabel = filter ? ` matching “${filter}”` : "";
  const lead = visibleRows[0];
  const englishMessage = lead
    ? `${lead.product} has the ${metricLabel}${scopeLabel}. ${metric.includes("margin") ? `Approximate margin is ₹${lead.marginAmount.toFixed(2)} (${lead.marginPercent.toFixed(1)}%).` : `Recorded sales are ₹${lead.salesValue.toFixed(2)} across ${lead.quantitySold} units.`}`
    : `I could not find products${scopeLabel}. Try a product name, brand, department, or category.`;
  const hinglishMetric = metric === "highest_margin" ? "sabse zyada margin" : metric === "lowest_margin" ? "sabse kam margin" : metric === "lowest_sales" ? "sabse kam sales" : "sabse zyada sales";
  const hinglishMessage = lead
    ? `${lead.product} ka ${hinglishMetric} hai${filter ? `, “${filter}” products mein` : ""}. ${metric.includes("margin") ? `Approx margin ₹${lead.marginAmount.toFixed(2)} (${lead.marginPercent.toFixed(1)}%) hai.` : `Recorded sales ₹${lead.salesValue.toFixed(2)} aur quantity ${lead.quantitySold} units hai.`}`
    : `${filter ? `“${filter}” ke liye` : ""} matching product nahi mila. Product name, brand, department ya category bolkar dobara try karein.`;
  const spokenMessage = lead
    ? `${lead.product} का ${metric === "highest_margin" ? "सबसे ज़्यादा मार्जिन" : metric === "lowest_margin" ? "सबसे कम मार्जिन" : metric === "lowest_sales" ? "सबसे कम सेल्स" : "सबसे ज़्यादा सेल्स"} है। ${metric.includes("margin") ? `अनुमानित मार्जिन ${lead.marginAmount.toFixed(2)} रुपये, यानी ${lead.marginPercent.toFixed(1)} प्रतिशत है।` : `रिकॉर्डेड सेल्स ${lead.salesValue.toFixed(2)} रुपये और मात्रा ${lead.quantitySold} यूनिट है।`}`
    : "मिलता हुआ प्रोडक्ट नहीं मिला। प्रोडक्ट का नाम, ब्रांड, डिपार्टमेंट या कैटेगरी बोलकर दोबारा कोशिश करें।";
  return {
    kind: "answer",
    message: language === "hinglish" ? hinglishMessage : englishMessage,
    spokenMessage: language === "hinglish" ? spokenMessage : englishMessage,
    engine,
    analytics: {
      metric,
      filter,
      rows: visibleRows,
      costBasis: "Approximate margin uses the latest purchase rate and the historical net pre-tax selling rate; if no sale exists, MRP/RSP is used."
    }
  };
}

function orderReply(parsed: ParsedAssistantRequest, snapshot: AppSnapshot, currentUser: AppUser, engine: "openai" | "local", language: AssistantResponseLanguage): AssistantReply {
  let side = parsed.side;
  const roles = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  if (side === "Unknown") side = roles.includes("Sales") ? "Sales" : roles.includes("Purchaser") ? "Purchase" : "Unknown";
  if (side === "Unknown") {
    return language === "hinglish"
      ? { kind: "answer", engine, message: "Please batayein ki Sales Order (SO) banana hai ya Purchase Order (PO).", spokenMessage: "कृपया बताइए कि सेल्स ऑर्डर बनाना है या परचेज़ ऑर्डर।" }
      : { kind: "answer", engine, message: "Please say whether you want a sales order (SO) or purchase order (PO)." };
  }
  const partyType = side === "Sales" ? "Shop" : "Supplier";
  const parties = snapshot.counterparties.filter((item) => item.type === partyType);
  const partyCandidates = parties
    .map((item) => ({ item, score: namedEntityScore(parsed.partyQuery, item.name, [item.contactPerson, item.mobileNumber, item.city]) }))
    .filter((entry) => !parsed.partyQuery || entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.name.localeCompare(right.item.name, "en-IN"))
    .slice(0, 5)
    .map((entry) => ({ id: entry.item.id, label: entry.item.name, detail: [entry.item.city, entry.item.mobileNumber].filter(Boolean).join(" · "), score: entry.score }));
  const warehouseCandidates = candidate(parsed.warehouseQuery, snapshot.warehouses, (item: Warehouse) => item.id, (item) => item.name, (item) => item.city, (item) => [item.id, item.name, item.city, item.address]);
  const latestPurchases = latestPurchaseBySku(snapshot);
  const lines = parsed.lines.map((line) => ({
    query: line.productQuery,
    quantity: line.quantity > 0 ? line.quantity : 1,
    rate: line.rate,
    candidates: snapshot.products
      .map((item) => ({ item, score: productSearchScore(line.productQuery, item) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || productLabel(left.item).localeCompare(productLabel(right.item), "en-IN"))
      .slice(0, 5)
      .map((entry) => ({ id: entry.item.sku, label: productLabel(entry.item), detail: [entry.item.sku, entry.item.category, entry.item.department, entry.item.size].filter(Boolean).join(" · "), score: entry.score }))
      .map((item) => {
        const product = snapshot.products.find((entry) => entry.sku === item.id)!;
        const purchaseRate = lastPurchaseRate(snapshot, product, latestPurchases);
        const availableStock = snapshot.stockSummary.filter((stock) => stock.productSku === product.sku).reduce((sum, stock) => sum + stock.availableQuantity, 0);
        return {
          ...item,
          gstRate: product.defaultGstRate === "NA" ? 0 : product.defaultGstRate,
          taxMode: product.defaultTaxMode === "Inclusive" ? "Inclusive" as const : "Exclusive" as const,
          availableStock,
          lastPurchaseRate: purchaseRate
        };
      })
  }));
  if (lines.length === 0) {
    const english = `I understood this as a ${side === "Sales" ? "sales" : "purchase"} order, but I could not identify a product and quantity. Try “Create ${side === "Sales" ? "SO" : "PO"} for party name: 10 product name at rate 50”.`;
    return language === "hinglish"
      ? { kind: "answer", engine, message: `${side === "Sales" ? "SO" : "PO"} samajh aa gaya, lekin product aur quantity identify nahi hui. Aise boliye: “${side === "Sales" ? "SO" : "PO"} banao, party name ke liye, 10 product name rate 50”.`, spokenMessage: `${side === "Sales" ? "सेल्स ऑर्डर" : "परचेज़ ऑर्डर"} समझ आ गया, लेकिन प्रोडक्ट और क्वांटिटी नहीं मिली। प्रोडक्ट और मात्रा के साथ दोबारा बोलिए।` }
      : { kind: "answer", engine, message: english };
  }
  lines.forEach((line) => {
    if (line.rate <= 0 && line.candidates[0]) {
      const product = snapshot.products.find((item) => item.sku === line.candidates[0].id)!;
      line.rate = side === "Sales"
        ? recentSalesRate(snapshot, product.sku) || product.mrp || product.rsp || line.candidates[0].lastPurchaseRate
        : line.candidates[0].lastPurchaseRate;
    }
  });
  const defaultPayment = snapshot.settings.paymentMethods.find((item) => item.active)?.code || "NEFT";
  const paymentMode = snapshot.settings.paymentMethods.find((item) => normalize(item.code) === normalize(parsed.paymentMode) || normalize(item.label) === normalize(parsed.paymentMode))?.code || defaultPayment;
  const draft: AssistantOrderDraft = {
    side,
    partyLabel: side === "Sales" ? "Customer / shop" : "Supplier / vendor",
    partyCandidates,
    warehouseCandidates,
    paymentMode,
    cashTiming: paymentMode === "Cash" ? "In Hand" : "",
    deliveryMode: parsed.deliveryMode || (side === "Sales" ? "Delivery" : "Dealer Delivery"),
    billingType: parsed.billingType === "B2B" ? "B2B" : "B2C",
    note: `Created through voice assistant by ${currentUser.fullName}`,
    lines
  };
  const ambiguous = !parsed.partyQuery || partyCandidates.length === 0 || lines.some((line) => line.candidates.length !== 1 && (line.candidates[0]?.score || 0) < 850);
  return {
    kind: "order_draft",
    engine,
    message: language === "hinglish"
      ? (ambiguous
          ? `Maine ${side === "Sales" ? "SO" : "PO"} draft taiyar kar diya hai. Nearest party aur product matches select karke details confirm karein.`
          : `${side === "Sales" ? "SO" : "PO"} draft taiyar hai. Quantity, rate, tax aur delivery details review karke confirm karein.`)
      : (ambiguous
          ? `I prepared a ${side === "Sales" ? "sales" : "purchase"} order draft. Please select the closest matches and confirm the details.`
          : `I prepared the ${side === "Sales" ? "sales" : "purchase"} order. Review the quantities, rates, tax and delivery details before confirming.`),
    spokenMessage: ambiguous
      ? `मैंने ${side === "Sales" ? "सेल्स ऑर्डर" : "परचेज़ ऑर्डर"} ड्राफ्ट तैयार कर दिया है। नज़दीकी पार्टी और प्रोडक्ट चुनकर जानकारी कन्फर्म करें।`
      : `${side === "Sales" ? "सेल्स ऑर्डर" : "परचेज़ ऑर्डर"} ड्राफ्ट तैयार है। मात्रा, रेट, टैक्स और डिलीवरी की जानकारी देखकर कन्फर्म करें।`,
    draft
  };
}

export async function runAssistant(text: string, snapshot: AppSnapshot, currentUser: AppUser, language: AssistantResponseLanguage = "hinglish"): Promise<AssistantReply> {
  const trimmed = text.trim();
  if (!trimmed) return language === "hinglish"
    ? { kind: "answer", engine: "local", message: "Question, SO ya PO request boliye ya type kariye.", spokenMessage: "सवाल, सेल्स ऑर्डर या परचेज़ ऑर्डर की रिक्वेस्ट बोलिए या टाइप कीजिए।" }
    : { kind: "answer", engine: "local", message: "Say or type a question, SO, or PO request." };
  const aiParsed = await openAiParse(trimmed);
  const parsed = aiParsed || fallbackParse(trimmed, snapshot);
  const engine = aiParsed ? "openai" : "local";
  if (parsed.intent === "analytics" || parsed.metric !== "none") return analyticsReply(parsed, snapshot, engine, language);
  if (parsed.intent === "order" || parsed.side !== "Unknown") return orderReply(parsed, snapshot, currentUser, engine, language);
  return language === "hinglish" ? {
    kind: "answer",
    engine,
    message: "Main highest ya lowest margin aur sales bata sakta hoon, aur complete SO/PO draft bana sakta hoon. Example: “Sabse zyada margin wale sabun dikhao” ya “Gupta Store ke liye 10 Lux ka SO banao”.",
    spokenMessage: "मैं सबसे ज़्यादा या सबसे कम मार्जिन और सेल्स बता सकता हूँ, और पूरा सेल्स या परचेज़ ऑर्डर ड्राफ्ट बना सकता हूँ।"
  } : {
    kind: "answer",
    engine,
    message: "I can answer highest or lowest margin and sales questions, or prepare a complete SO/PO. Example: “Show soaps with highest margin” or “Create SO for Gupta Store: 10 Lux at 42”."
  };
}
