export const collectionDenominations = [500, 200, 100, 50, 20, 10] as const;
export type CollectionPrivileges = { amountDue: number; allowLater: boolean; allowPartial: boolean; allowCheque: boolean };

export function testCollectionPrivileges(orderId: string): CollectionPrivileges {
  if (orderId === "TEST-SO-2") return { amountDue: 1500, allowLater: true, allowPartial: true, allowCheque: true };
  if (orderId === "TEST-SO-3") return { amountDue: 750, allowLater: true, allowPartial: true, allowCheque: false };
  return { amountDue: 1000, allowLater: false, allowPartial: false, allowCheque: false };
}

export function paymentOcrAmount(raw: string): number | null {
  // Use a currency/amount label, never whichever number happens to be closest
  // to the bill (which might be a date, account number or UPI reference).
  const matches = [...raw.matchAll(/(?:₹|rs\.?|inr|amount(?:\s+(?:paid|received|in\s+figures))?\s*[:=]?)\s*(?:₹|rs\.?|inr)?\s*([0-9]+(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?)/gi)];
  const amounts = [...new Set(matches.map((match) => Number(match[1].replace(/,/g, ""))).filter((amount) => amount > 0 && amount <= 10_000_000))];
  return amounts.length === 1 ? amounts[0] : null;
}

export type PaymentPhotoReading = { visible: boolean; amount: number; payeeName: string; transactionDate: string };
