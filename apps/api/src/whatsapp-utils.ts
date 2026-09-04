import { createHmac, timingSafeEqual } from "node:crypto";

function text(value: unknown) {
  return String(value ?? "").trim();
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
