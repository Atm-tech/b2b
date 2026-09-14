export const WHATSAPP_COLLECTION_TOLERANCE = 5;
export const collectionDenominations = [500, 200, 100, 50, 20, 10] as const;
export function paymentOcrAmount(raw: string): number | null {
  // Use a currency/amount label, never whichever number happens to be closest
  // to the bill (which might be a date, account number or UPI reference).
  const matches = [...raw.matchAll(/(?:₹|rs\.?|inr|amount(?:\s+(?:paid|received|in\s+figures))?\s*[:=]?)\s*(?:₹|rs\.?|inr)?\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi)];
  const amounts = [...new Set(matches.map((match) => Number(match[1].replace(/,/g, ""))).filter((amount) => amount > 0 && amount <= 10_000_000))];
  return amounts.length === 1 ? amounts[0] : null;
}

export type PaymentPhotoReading = { visible: boolean; amount: number; payeeName: string; transactionDate: string };
