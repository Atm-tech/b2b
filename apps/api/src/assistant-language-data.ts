export type OfflineAssistantIntent =
  | "highest_margin"
  | "lowest_margin"
  | "highest_sales"
  | "lowest_sales"
  | "sales_order"
  | "purchase_order"
  | "unknown";

export type IntentDatasetEntry = {
  intent: Exclude<OfflineAssistantIntent, "unknown">;
  examples: string[];
};

// Canonical training examples for the zero-token assistant. Add phrases here as
// the team uses them; the classifier scores token and two-word phrase overlap.
export const ASSISTANT_INTENT_DATASET: IntentDatasetEntry[] = [
  {
    intent: "highest_margin",
    examples: [
      "highest margin product", "products with best margin", "widest margin items", "high profit product",
      "bade margin wale product", "zyada fayda wala maal", "kis product mein jyada margin hai",
      "sabse zyada munafa kis item mein", "best profit wala product batao", "maximum margin dikhao"
    ]
  },
  {
    intent: "lowest_margin",
    examples: [
      "lowest margin product", "low profit items", "minimum margin products", "least profitable product",
      "kam margin wale product", "sabse kam munafa", "kis product mein kam fayda hai",
      "chhote margin ka maal", "low margin dikhao"
    ]
  },
  {
    intent: "highest_sales",
    examples: [
      "highest sales product", "top selling products", "best selling item", "most sold product",
      "sabse zyada bikne wala product", "maximum bikri kiski hai", "kaunsa maal sabse zyada bika",
      "fast moving products", "sabse zyada sales batao"
    ]
  },
  {
    intent: "lowest_sales",
    examples: [
      "lowest sales product", "least selling item", "slow moving products", "minimum sold product",
      "sabse kam bikne wala maal", "kam sales wale product", "kaunsa item kam bika",
      "slow sale items batao"
    ]
  },
  {
    intent: "sales_order",
    examples: [
      "create sales order", "make so", "book customer order", "prepare so for customer",
      "make sale order", "create s o", "customer order banao", "sales ka order banao",
      "customer ke liye so banao", "sales ka order bana do", "dukan ke liye maal book karo",
      "grahak ka order taiyar karo"
    ]
  },
  {
    intent: "purchase_order",
    examples: [
      "create purchase order", "make po", "buy from supplier", "prepare po for vendor",
      "make supplier order", "create p o", "purchase order taiyar karo", "kharid ka order banao",
      "supplier se po banao", "purchase ka order bana do", "vendor ko order do",
      "kharid ka order taiyar karo"
    ]
  }
];

export const OFFLINE_FILTER_WORDS = new Set([
  "show", "find", "give", "me", "the", "with", "having", "which", "what", "is", "are", "has", "have",
  "highest", "lowest", "widest", "best", "top", "maximum", "minimum", "max", "min", "margin", "sale", "sales",
  "selling", "product", "products", "item", "items", "maal", "by", "of", "please", "wala", "wale", "wali", "mein",
  "mai", "ka", "ki", "ke", "kis", "kisme", "kaun", "kaunsa", "kaunse", "kon", "konsa", "konse", "hai", "hain",
  "mujhe", "jara", "zara", "bata", "batao", "dikha", "dikhao", "tell", "list", "all", "sabse"
]);

export const PRODUCT_LANGUAGE_ALIASES: Record<string, string[]> = {
  soap: ["soap", "sabun", "saboon", "saabun", "साबुन", "सोप"],
  flour: ["flour", "atta", "aata", "आटा"],
  rice: ["rice", "chawal", "chaawal", "चावल"],
  oil: ["oil", "tel", "तेल"],
  sugar: ["sugar", "chini", "cheeni", "चीनी"],
  toothpaste: ["toothpaste", "paste", "manjan", "मंजन", "टूथपेस्ट"],
  detergent: ["detergent", "washing powder", "surf", "kapde ka powder", "डिटर्जेंट"],
  lux: ["lux", "lakh", "lakhs", "lucks", "looks", "locks", "laks", "लक्स", "लख", "लाख"],
  dove: ["dove", "kook dow", "cook dow", "kook dove", "cook dove", "duv", "dov", "dow", "dhove", "डव", "डोव", "दव", "दोव"],
  dettol: ["dettol", "detol", "ditol", "detail", "डेटॉल", "डेटोल"],
  liril: ["liril", "lirill", "lirel", "लीरिल", "लिरिल"],
  pears: ["pears", "peers", "piyars", "पियर्स", "पीयर्स"],
  santoor: ["santoor", "santur", "santor", "संतूर"],
  ghadi: ["ghadi", "gadi", "ghadhi", "घड़ी", "घडी"],
  himalaya: ["himalaya", "himalya", "हिमालय", "हिमालया"],
  patanjali: ["patanjali", "patanjli", "पतंजलि"],
  margo: ["margo", "मार्गो", "मारगो"]
};

function datasetTokens(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((item) => item.length > 1);
}

function features(value: string) {
  const words = datasetTokens(value);
  const result = new Set(words);
  for (let index = 0; index < words.length - 1; index += 1) result.add(`${words[index]}_${words[index + 1]}`);
  return result;
}

function similarity(left: Set<string>, right: Set<string>) {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  left.forEach((item) => { if (right.has(item)) intersection += 1; });
  return intersection / Math.sqrt(left.size * right.size);
}

export function classifyOfflineIntent(canonicalText: string): { intent: OfflineAssistantIntent; confidence: number; matchedExample?: string } {
  const text = canonicalText.toLowerCase();
  if (/\bhighest\b/.test(text) && /\bmargin\b/.test(text)) return { intent: "highest_margin", confidence: 1 };
  if (/\blowest\b/.test(text) && /\bmargin\b/.test(text)) return { intent: "lowest_margin", confidence: 1 };
  if (/\bhighest\b/.test(text) && /\bsales?\b/.test(text)) return { intent: "highest_sales", confidence: 1 };
  if (/\blowest\b/.test(text) && /\bsales?\b/.test(text)) return { intent: "lowest_sales", confidence: 1 };
  if (/\b(?:so|sales order)\b/.test(text) && /\b(?:create|make|book|prepare|order)\b/.test(text)) return { intent: "sales_order", confidence: 1 };
  if (/\b(?:po|purchase order)\b/.test(text) && /\b(?:create|make|buy|book|prepare|order)\b/.test(text)) return { intent: "purchase_order", confidence: 1 };

  const inputFeatures = features(text);
  let best: { intent: OfflineAssistantIntent; confidence: number; matchedExample?: string } = { intent: "unknown", confidence: 0 };
  ASSISTANT_INTENT_DATASET.forEach((entry) => entry.examples.forEach((example) => {
    const score = similarity(inputFeatures, features(example));
    if (score > best.confidence) best = { intent: entry.intent, confidence: score, matchedExample: example };
  }));
  return best.confidence >= 0.42 ? best : { intent: "unknown", confidence: best.confidence, matchedExample: best.matchedExample };
}

export function expandProductAlias(value: string) {
  let expanded = value;
  for (const [canonical, aliases] of Object.entries(PRODUCT_LANGUAGE_ALIASES)) {
    [...aliases].sort((left, right) => right.length - left.length).forEach((alias) => {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expanded = expanded.replace(new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "gi"), canonical);
    });
  }
  return expanded;
}
