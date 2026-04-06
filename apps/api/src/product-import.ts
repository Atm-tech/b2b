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
  return rows.map((row) => {
    const barcode = readMapped(row, ["sku", "SKU", "BARCODE"]);
    const name = readMapped(row, ["name", "NAME", "ITEM NAME", "ARTICLE_NAME"]);
    const division = readMapped(row, ["division", "DIVISION"], "General");
    const department = readMapped(row, ["department", "DEPARTMENT"], "General");
    const section = readMapped(row, ["section", "SECTION"], "General");
    const unit = inferUnit(readMapped(row, ["unit", "UNIT", "SIZE"], "Unit"));
    const rspText = readMapped(row, ["rsp", "RSP"], "0");
    const mrpText = readMapped(row, ["mrp", "MRP"], "0");
    const slabsText = readMapped(row, ["slabs", "SLABS"]);
    const category = deriveRetailCategory(row);
    const allowedWarehouseIds = readMapped(row, ["allowedWarehouseIds", "ALLOWED_WAREHOUSE_IDS"])
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

    return {
      sku: requiredString(barcode || name, "SKU"),
      name: requiredString(name, "Product name"),
      division: requiredString(division, "Division"),
      department: requiredString(department, "Department"),
      section: requiredString(section, "Section"),
      category,
      unit: requiredString(unit, "Unit"),
      defaultWeightKg: requiredNumber(readMapped(row, ["defaultWeightKg", "DEFAULT_WEIGHT_KG"], "0"), "Default weight"),
      toleranceKg: requiredNumber(readMapped(row, ["toleranceKg", "TOLERANCE_KG"], "0"), "Tolerance kg"),
      tolerancePercent: requiredNumber(readMapped(row, ["tolerancePercent", "TOLERANCE_PERCENT"], "0"), "Tolerance percent"),
      allowedWarehouseIds: allowedWarehouseIds.length > 0 ? allowedWarehouseIds : defaultWarehouseIds,
      slabs: slabsText ? parseCsvSlabs(slabsText) : [{ minQuantity: 1, purchaseRate: requiredNumber(rspText, "RSP") }],
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
      size: readMapped(row, ["SIZE"]),
      rsp: Number(rspText || 0),
      mrp: Number(mrpText || 0)
    };
  });
}

export function deriveRetailCategory(row: ImportRow) {
  const category6 = readMapped(row, ["CATEGORY 6", "CAT-6"]).toUpperCase();
  const division = readMapped(row, ["DIVISION"]).toUpperCase();
  const section = readMapped(row, ["SECTION"]).toUpperCase();
  const department = readMapped(row, ["DEPARTMENT"]).toUpperCase();
  const raw = [
    category6,
    division,
    section,
    department,
    readMapped(row, ["ARTICLE_NAME"]),
    readMapped(row, ["ITEM NAME"]),
    readMapped(row, ["NAME"]),
    readMapped(row, ["BRAND"]),
    readMapped(row, ["REMARKS"])
  ].join(" ").toUpperCase();

  if (division.includes("HOUSEHOLD") || division.includes("ELECTRONICS") || division.includes("FMCG-NON FOOD")) {
    if (matchesAny(raw, ["TOY", "SOFT TOY", "KIDS"])) return "Toys & Kids Essentials";
    if (matchesAny(raw, ["CROCKERY", "CUP SET", "BOTTLE SET", "BOTTLE", "KITCHEN", "INDUCTION", "APPLIANCES"])) return "Kitchen & Appliances";
    if (matchesAny(raw, ["BED SHEET", "PARDA", "CARPET", "TOWEL", "HOME FURNISHING"])) return "Home Furnishing";
    if (matchesAny(raw, ["TOOLS", "PLASTIC GOODS", "HOME CARE", "BULB", "HOUSEHOLD"])) return "Household Essentials";
  }

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
  if (matchesAny(raw, ["DRINK", "BEVRAGE", "BEVERAGE", "TEA", "COFFEE", "JUICE", "COLD DRINK"])) return "Tea, Coffee & Beverages";
  if (matchesAny(raw, ["DRY FRUIT", "CASHEW", "ALMOND", "PISTA", "ELAICHEE"])) return "Dry Fruits & Nuts";
  if (matchesAny(raw, ["GHEE", "SOYA", "MUSTURED", "MUSTARD", "REFINED", "OIL", "COOKING MEDIUM"])) return "Oils & Ghee";
  if (matchesAny(raw, ["ATTA", "FLOUR", "RICE", "PULSE", "DAL", "POHA", "SUGAR", "BASMATI", "DUBRAJ", "CHINNOR"])) return "Staples & Grains";
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
  if (upper.includes("KG")) return "Kg";
  if (upper.includes("GM") || upper.includes("G ")) return "Gram";
  if (upper.includes("LTR") || upper.includes("L ")) return "Litre";
  if (upper.includes("ML")) return "Ml";
  return clean;
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

function parseCsvSlabs(value: string): ProductSlab[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rangeText, rateText] = item.split(":").map((part) => part.trim());
      const purchaseRate = requiredNumber(rateText, "Slab rate");
      if (rangeText.endsWith("+")) {
        return {
          minQuantity: requiredNumber(rangeText.replace("+", ""), "Slab min quantity"),
          purchaseRate
        };
      }
      const [minQuantity, maxQuantity] = rangeText.split("-").map((part) => requiredNumber(part, "Slab quantity"));
      return { minQuantity, maxQuantity, purchaseRate };
    });
}

export function isWorkbookFile(fileName: string) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === ".xlsx" || ext === ".xls";
}
