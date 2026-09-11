import type { UserRole } from "./index.js";
export const guideModules = [
  { slug: "retailer", title: "Retailer", roles: [] },
  { slug: "warehouse-manager", title: "Warehouse Manager", roles: ["Warehouse Manager"] },
  { slug: "purchaser", title: "Purchaser", roles: ["Purchaser"] },
  { slug: "sales", title: "Sales", roles: ["Sales"] },
  { slug: "accounts", title: "Accounts", roles: ["Accounts"] },
  { slug: "delivery-manager", title: "Delivery Manager", roles: ["Delivery Manager"] },
  { slug: "delivery", title: "Delivery", roles: ["Delivery", "In Delivery", "Out Delivery"] },
  { slug: "delivery-collection", title: "Delivery + Collection", roles: ["Delivery", "In Delivery", "Out Delivery", "Collection Agent"] },
  { slug: "collection", title: "Collection Agent", roles: ["Collection Agent"] },
  { slug: "analyst", title: "Data Analyst", roles: ["Data Analyst"] },
  { slug: "admin", title: "Admin", roles: ["Admin"] }
] as const;
export type GuideSlug = typeof guideModules[number]["slug"];
export type GuideStep = {
  title: string; screen: string; speech: string; narration: string;
  body: string; example: string; task: string; choices?: string[];
  answer?: number; input?: { expected: string; label: string; numeric?: boolean };
  success: string;
};
export type TrainingGuide = { slug: GuideSlug; title: string; steps: GuideStep[] };
export function normalizeGuideSlug(value: string): string {
  return ({ sell: "sales", salesman: "sales", warehouse: "warehouse-manager", purchase: "purchaser", "delivery+collection": "delivery-collection", "collection-agent": "collection", "data-analyst": "analyst" } as Record<string, string>)[value] || value;
}
export function allowedGuideSlugs(roles: readonly UserRole[], allGuides = false): GuideSlug[] {
  return guideModules.filter((guide) => allGuides || roles.includes("Admin") || (guide.slug === "delivery-collection"
    ? roles.includes("Collection Agent") && roles.some(role => role === "Delivery" || role === "In Delivery" || role === "Out Delivery")
    : guide.roles.some((role) => roles.includes(role)))).map((guide) => guide.slug);
}
