import path from "node:path";
import XLSX from "xlsx";
import type { ProductMaster, ProductSlab } from "@aapoorti-b2b/domain";

type ImportRow = Record<string, string>;

export function parseCsvRows(csv: string, defaultWarehouseIds: string[]) {
  const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  if (!header) {
    throw new Error("CSV file is empty.");
  }
  const headers = header.split(",").map((item) => item.trim());
  const rows = lines.map((line) => {
    const cols = line.split(",").map((item) => item.trim());
    return Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])) as ImportRow;
  });
  return mapImportRows(rows, defaultWarehouseIds);
}

export function parseWorkbookRows(filePath: string, defaultWarehouseIds: string[], preferredSheet = "BASE") {
  const workbook = XLSX.readFile(filePath, { raw: true, cellText: false });
  const sheetName = workbook.SheetNames.includes(preferredSheet) ? preferredSheet : workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error("Workbook does not contain any sheet.");
  }
  const sheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true, defval: "" });
  const rows = rawRows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeWorkbookValue(value)])
  )) as ImportRow[];
  if (rows.length === 0) {
    throw new Error(`Sheet ${sheetName} is empty.`);
  }
  return mapImportRows(rows, defaultWarehouseIds);
}

function mapImportRows(rows: ImportRow[], defaultWarehouseIds: string[]): Array<Omit<ProductMaster, "createdBy" | "createdAt">> {
  const seen = new Set<string>();
  const products: Array<Omit<ProductMaster, "createdBy" | "createdAt">> = [];
  for (const row of rows) {
    const barcode = readMapped(row, ["sku", "SKU", "BARCODE"]);
    const name = readMapped(row, ["name", "NAME", "ITEM NAME", "ARTICLE_NAME"]);
    if (!name.trim()) continue;
    const normalizedName = normalizeProductName(name);
    if (seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    const division = readMapped(row, ["division", "DIVISION"], "General");
    const department = readMapped(row, ["department", "DEPARTMENT"], "General");
    const section = readMapped(row, ["section", "SECTION"], "General");
    const sizeText = readMapped(row, ["size", "SIZE"]) || extractSizeText(name);
    const unit = inferUnit(readMapped(row, ["unit", "UNIT", "size", "SIZE"]) || name);
    const rspText = readMapped(row, ["rsp", "RSP"], "0");
    const mrpText = readMapped(row, ["mrp", "MRP"], "0");
    const category = deriveRetailCategory(row);
    const allowedWarehouseIds = readMapped(row, ["allowedWarehouseIds", "ALLOWED_WAREHOUSE_IDS"])
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    const parsedWeightKg = parseProductWeightKg(row);

    products.push({
      sku: requiredString(barcode || makeSkuFromName(name), "SKU"),
      name: requiredString(name, "Product name"),
      division: requiredString(division, "Division"),
      department: requiredString(department, "Department"),
      section: requiredString(section, "Section"),
      category,
      unit: requiredString(unit, "Unit"),
      defaultGstRate: 0,
      defaultTaxMode: "Exclusive",
      defaultWeightKg: parsedWeightKg,
      toleranceKg: requiredNumber(readMapped(row, ["toleranceKg", "TOLERANCE_KG"], "0"), "Tolerance kg"),
      tolerancePercent: requiredNumber(readMapped(row, ["tolerancePercent", "TOLERANCE_PERCENT"], "0"), "Tolerance percent"),
      allowedWarehouseIds: allowedWarehouseIds.length > 0 ? allowedWarehouseIds : defaultWarehouseIds,
      slabs: [makeFutureBaseSlab(rspText)],
      remarks: readMapped(row, ["REMARKS"]),
      category6: readMapped(row, ["CATEGORY 6", "CAT-6"]),
      siteName: readMapped(row, ["SITE NAME", "MKT"]),
      barcode,
      supplierName: "",
      hsnCode: readMapped(row, ["HSN CODE"]),
      articleName: readMapped(row, ["ARTICLE_NAME"]),
      itemName: readMapped(row, ["ITEM NAME"]),
      brand: readMapped(row, ["BRAND"]),
      shortName: readMapped(row, ["NAME"]),
      size: sizeText,
      rsp: Number(rspText || 0),
      mrp: Number(mrpText || 0)
    });
  }
  return products;
}

function parseProductWeightKg(row: ImportRow) {
  const explicitWeight = readMapped(row, ["defaultWeightKg", "DEFAULT_WEIGHT_KG", "WEIGHT_KG", "WEIGHT KG", "WEIGHT"]);
  if (explicitWeight) {
    const explicit = Number(explicitWeight);
    if (!Number.isNaN(explicit) && explicit >= 0) return explicit;
  }

  const searchableText = [
    readMapped(row, ["size", "SIZE"]),
    readMapped(row, ["name", "NAME"]),
    readMapped(row, ["itemName", "ITEM NAME"]),
    readMapped(row, ["articleName", "ARTICLE_NAME"]),
    readMapped(row, ["remarks", "REMARKS"])
  ].join(" ");

  return inferWeightKg(searchableText);
}

function inferWeightKg(text: string) {
  const normalized = text
    .toUpperCase()
    .replace(/×/g, "X")
    .replace(/\bLTRS\b/g, "LTR")
    .replace(/\bLITRES\b/g, "LITRE")
    .replace(/\bLTS\b/g, "LT")
    .replace(/\bGMS\b/g, "GM")
    .replace(/\bGRAMS\b/g, "GRAM");

  const freePack = normalized.match(/(\d+)\s*\+\s*(\d+)\s*(?:X|\*)?\s*(\d+(?:\.\d+)?)\s*(KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (freePack) {
    return (Number(freePack[1]) + Number(freePack[2])) * convertToKg(Number(freePack[3]), freePack[4]);
  }

  const groupedFreePack = normalized.match(/\(?\s*(\d+)\s*\+\s*(\d+)\s*\)?\s*(?:X|\*)\s*(\d+(?:\.\d+)?)\s*(KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (groupedFreePack) {
    return (Number(groupedFreePack[1]) + Number(groupedFreePack[2])) * convertToKg(Number(groupedFreePack[3]), groupedFreePack[4]);
  }

  const packFirst = normalized.match(/(\d+(?:\.\d+)?)\s*(?:X|\*)\s*(\d+(?:\.\d+)?)\s*(KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (packFirst) {
    return Number(packFirst[1]) * convertToKg(Number(packFirst[2]), packFirst[3]);
  }

  const unitFirst = normalized.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\s*(?:X|\*)\s*(\d+(?:\.\d+)?)/);
  if (unitFirst) {
    return convertToKg(Number(unitFirst[1]), unitFirst[2]) * Number(unitFirst[3]);
  }

  const single = normalized.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (single) {
    return convertToKg(Number(single[1]), single[2]);
  }

  return 0;
}

function convertToKg(value: number, unit: string) {
  if (["KG", "KGS", "KILOGRAM"].includes(unit)) return value;
  if (["G", "GM", "GRAM"].includes(unit)) return value / 1000;
  if (["LTR", "LITRE", "LT", "L"].includes(unit)) return value;
  if (unit === "ML") return value / 1000;
  return 0;
}

function makeFutureBaseSlab(rspText: string): ProductSlab {
  return { minQuantity: 1, purchaseRate: requiredNumber(rspText || "0", "RSP") };
}

export function deriveRetailCategory(row: ImportRow) {
  const category6 = readMapped(row, ["category6", "CATEGORY 6", "CAT-6"]).toUpperCase();
  const division = readMapped(row, ["division", "DIVISION"]).toUpperCase();
  const section = readMapped(row, ["section", "SECTION"]).toUpperCase();
  const department = readMapped(row, ["department", "DEPARTMENT"]).toUpperCase();
  const raw = [
    category6,
    division,
    section,
    department,
    readMapped(row, ["articleName", "ARTICLE_NAME"]),
    readMapped(row, ["itemName", "ITEM NAME"]),
    readMapped(row, ["name", "NAME"]),
    readMapped(row, ["brand", "BRAND"]),
    readMapped(row, ["remarks", "REMARKS"])
  ].join(" ").toUpperCase();

  if (matchesAny(division, ["MENS", "LADIES", "GIRLS", "KIDS"])) {
    if (matchesAny(raw, ["FOOTMART", "SHOE", "CHAPPAL", "SANDLE", "SANDAL", "CROCS"])) return "Footwear";
    if (matchesAny(raw, ["BELT", "CAP", "ACCESSORIES"])) return "Fashion Accessories";
    if (matchesAny(raw, ["LOWER", "JEANS", "CAPRI", "CARGO", "BARMUDA", "BERMUDA"])) return "Bottomwear";
    if (matchesAny(raw, ["UPPER", "PULLOVER", "T-SHIRT", "SPORTS WEAR", "BASIC", "BRIEF", "U-GARMENTS"])) return "Topwear & Innerwear";
    if (matchesAny(raw, ["KURTI", "ETHNIC WEAR"])) return "Ethnic Wear";
    if (matchesAny(raw, ["SET", "FROCK", "CASUAL SET"])) return "Sets & Dresses";
    if (matchesAny(raw, ["BAG", "LUGGAGE", "TRAVELLING"])) return "Bags & Luggage";
  }

  if (matchesAny(raw, ["SWEET", "PAPADI", "NAMKEEN", "BISCUIT", "COOKIE", "SNACK"])) return "Snacks & Sweets";
  if (matchesAny(raw, ["WATER BOTTLE", "PACKAGED WATER", "DRINKING WATER"])) return "Packaged Water";
  if (matchesAny(raw, ["COCA COLA", "COCA-COLA", "FANTA", "FENTA", "SPRITE", "THUMS UP", "THUMP UP", "LIMCA", "APPY FIZZ", "COLD DRINK", "SOFT DRINK"])) return "Cold Beverages";
  if (matchesAny(raw, ["MAAZA", "MANGO DRINK", "LITCHI DRINK", "JUICE"])) return "Juices & Fruit Drinks";
  if (matchesAny(raw, ["DRINK", "BEVRAGE", "BEVERAGE", "TEA", "COFFEE"])) return "Tea, Coffee & Beverages";
  if (matchesAny(raw, ["DRY FRUIT", "CASHEW", "ALMOND", "PISTA", "ELAICHEE"])) return "Dry Fruits & Nuts";
  if (matchesAny(raw, ["SUGAR", "ATTA", "FLOUR", "RICE", "PULSE", "DAL", "POHA", "BASMATI", "DUBRAJ", "CHINNOR"])) return "Staples & Grains";
  if (matchesAny(raw, ["GHEE", "SOYA", "MUSTURED", "MUSTARD", "REFINED", "OIL", "COOKING MEDIUM"])) return "Oils & Ghee";
  if (matchesAny(raw, ["FIAMA", "SOAP", "BATHING BAR"])) return "Bathing Bars & Soaps";
  if (matchesAny(raw, ["RIN", "SURF EXCEL", "GHADI", "DETERGENT", "LAUNDRY", "WASHING POWDER"])) return "Laundry & Detergents";
  if (division.includes("HOUSEHOLD") || division.includes("ELECTRONICS") || division.includes("FMCG-NON FOOD")) {
    if (matchesAny(raw, ["TOY", "SOFT TOY", "KIDS"])) return "Toys & Kids Essentials";
    if (matchesAny(raw, ["CROCKERY", "CUP SET", "BOTTLE SET", "KITCHEN", "INDUCTION", "APPLIANCES"])) return "Kitchen & Appliances";
    if (matchesAny(raw, ["BED SHEET", "PARDA", "CARPET", "TOWEL", "HOME FURNISHING"])) return "Home Furnishing";
    if (matchesAny(raw, ["TOOLS", "PLASTIC GOODS", "HOME CARE", "BULB", "HOUSEHOLD"])) return "Household Essentials";
  }
  if (matchesAny(raw, ["ELECTRONICS"])) return "Electronics";
  if (matchesAny(raw, ["FMCG", "PACKING"])) return "Grocery & Staples";
  if (matchesAny(raw, ["MENS", "LADIES", "GIRLS", "KIDS"])) return "Apparel";
  return "General Merchandise";
}

function matchesAny(haystack: string, needles: string[]) {
  return needles.some((needle) => haystack.includes(needle));
}

function inferUnit(value: string) {
  const clean = value.trim();
  if (!clean) return "Unit";
  const upper = clean.toUpperCase();
  if (/\d\s*KGS?\b|\bKGS?\b|\bKILOGRAM\b/.test(upper)) return "Kg";
  if (/\d\s*ML\b|\bML\b/.test(upper)) return "Ml";
  if (/\d\s*(?:LTR|LT|L)\b|\bLTR\b|\bLITRE\b|\bLT\b/.test(upper)) return "Litre";
  if (/\d\s*(?:G|GM)\b|\bGM\b|\bGRAM\b/.test(upper)) return "Gram";
  return clean;
}

function extractSizeText(name: string) {
  const normalized = name.toUpperCase().replace(/\bLTR\b/g, "LT").replace(/\bLITRE\b/g, "LT");
  const freePack = normalized.match(/\(?\s*\d+\s*\+\s*\d+\s*\)?\s*(?:X|\*)?\s*\d+(?:\.\d+)?\s*(?:KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (freePack) return freePack[0];
  const pack = normalized.match(/\d+(?:\.\d+)?\s*(?:X|\*)\s*\d+(?:\.\d+)?\s*(?:KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  if (pack) return pack[0];
  const single = normalized.match(/\d+(?:\.\d+)?\s*(?:KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML)\b/);
  return single ? single[0] : "";
}

function normalizeProductName(name: string) {
  return name.toUpperCase()
    .replace(/\bTHUMP\s+UP\b/g, "THUMS UP")
    .replace(/\bFENTA\b/g, "FANTA")
    .replace(/\bLTS\b/g, "LT")
    .replace(/\bLTR\b/g, "LT")
    .replace(/\bLITRE\b/g, "LT")
    .replace(/\bGRAMS\b/g, "G")
    .replace(/\bGMS\b/g, "GM")
    .replace(/[^\w.+*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function makeSkuFromName(name: string) {
  return normalizeProductName(name)
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeWorkbookValue(value: unknown) {
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : String(value);
  }
  return String(value ?? "").trim();
}

function readMapped(row: ImportRow, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return fallback;
}

function requiredString(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function requiredNumber(value: unknown, label: string) {
  const numberValue = Number(value);
  if (Number.isNaN(numberValue)) {
    throw new Error(`${label} must be a number.`);
  }
  return numberValue;
}

export function isWorkbookFile(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".xlsx" || ext === ".xls";
}
