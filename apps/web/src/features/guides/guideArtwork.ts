import type { GuideSlug } from "@aapoorti-b2b/domain";

type Illustration = { file: string; x: number; y: number; height: number; alt: string };

// Each sheet contains separate portrait scenes. The SVG viewport crops a single
// scene without stretching it on desktop or mobile.
export const guideArtwork: Record<Exclude<GuideSlug, "retailer">, Illustration> = {
  "warehouse-manager": { file: "operations", x: 0, y: 0, height: 2048, alt: "Warehouse manager scanner aur tablet se cartons check karte hue" },
  purchaser: { file: "operations", x: 768, y: 0, height: 2048, alt: "Purchaser supplier ke saath purchase order discuss karte hue" },
  sales: { file: "operations", x: 0, y: 1024, height: 2048, alt: "Salesman customer ko tablet par products aur order dikhate hue" },
  accounts: { file: "operations", x: 768, y: 1024, height: 2048, alt: "Accounts officer payment receipt ko laptop ke ledger se match karte hue" },
  "delivery-manager": { file: "delivery", x: 0, y: 0, height: 2048, alt: "Delivery manager dispatch desk par routes aur assignments plan karte hue" },
  delivery: { file: "delivery", x: 768, y: 0, height: 2048, alt: "Delivery executive helmet aur parcel ke saath customer ke darwaze par" },
  collection: { file: "delivery", x: 0, y: 1024, height: 2048, alt: "Collection agent customer ko payment receipt aur payment terminal dikhate hue" },
  "delivery-collection": { file: "delivery", x: 768, y: 1024, height: 2048, alt: "Delivery aur collection executive carton dete hue phone par payment check karte hue" },
  analyst: { file: "office", x: 0, y: 0, height: 1024, alt: "Data analyst monitors par inventory graphs aur reports analyse karte hue" },
  admin: { file: "office", x: 768, y: 0, height: 1024, alt: "System admin office mein staff accounts aur role settings manage karte hue" }
};
