import { createHmac, timingSafeEqual } from "node:crypto";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeProductSearch(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:magi|megi|maggee)\b/g, "maggi")
    .replace(/\b(?:good\s*day|gud\s*day|gudday|good\s*dey)\b/g, "goodday")
    .replace(/\bparle\s+g\b/g, "parleg")
    .replace(/\s+/g, " ")
    .trim();
}

function editDistance(left: string, right: string) {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = row[0];
    row[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const previous = row[rightIndex];
      row[rightIndex] = Math.min(
        row[rightIndex] + 1,
        row[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
      diagonal = previous;
    }
  }
  return row[right.length];
}

function tokenSimilarity(left: string, right: string) {
  return 1 - editDistance(left, right) / Math.max(left.length, right.length, 1);
}

export function scoreWhatsAppProductQuery(query: string, values: unknown[]) {
  const needle = normalizeProductSearch(query);
  if (!needle) return 1;
  const normalizedValues = values.map(normalizeProductSearch).filter(Boolean);
  if (!normalizedValues.length) return 0;
  const compactNeedle = needle.replace(/\s/g, "");
  const compactValues = normalizedValues.map((value) => value.replace(/\s/g, ""));
  if (compactValues.some((value) => value === compactNeedle)) return 1000;
  if (compactValues.some((value) => value.startsWith(compactNeedle))) return 900;
  if (compactValues.some((value) => value.includes(compactNeedle))) return 800;

  const queryTokens = needle.split(" ").filter(Boolean);
  const productTokens = Array.from(new Set(normalizedValues.flatMap((value) => value.split(" ")).filter(Boolean)));
  if (!queryTokens.length || !productTokens.length) return 0;
  const similarities = queryTokens.map((queryToken) => {
    if (queryToken.length < 3) return productTokens.includes(queryToken) ? 1 : 0;
    return Math.max(...productTokens
      .filter((productToken) => Math.abs(productToken.length - queryToken.length) <= 2)
      .map((productToken) => tokenSimilarity(queryToken, productToken)), 0);
  });
  if (similarities.some((similarity) => similarity < 0.66)) return 0;
  return Math.round(400 + similarities.reduce((sum, similarity) => sum + similarity, 0) / similarities.length * 300);
}

export function discountPercentFromMrp(mrpValue: unknown, rateValue: unknown) {
  const mrp = Number(mrpValue);
  const rate = Number(rateValue);
  if (!Number.isFinite(mrp) || !Number.isFinite(rate) || mrp <= 0 || rate < 0 || rate >= mrp) return 0;
  return Math.round((mrp - rate) / mrp * 10000) / 100;
}

export function normalizeWhatsAppPhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 10) digits = `91${digits}`;
  if (digits.length < 10 || digits.length > 15) throw new Error("Enter a valid WhatsApp number with country code.");
  return digits;
}

export function isValidWebhookChallenge(query: Record<string, unknown>, expectedToken: string) {
  return text(query["hub.mode"]) === "subscribe" && Boolean(expectedToken) && text(query["hub.verify_token"]) === expectedToken;
}

export function isValidMetaSignature(rawBody: Buffer, signatureHeader: string, appSecret: string, allowUnsigned = false) {
  if (!appSecret) return allowUnsigned;
  const supplied = signatureHeader.replace(/^sha256=/, "");
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (supplied.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

export function parseWhatsAppAction(value: string) {
  const match = value.match(/^wa-(confirm|change|offer|ignore):(.+)$/);
  return match ? { action: match[1] as "confirm" | "change" | "offer" | "ignore", entityId: match[2] } : null;
}
