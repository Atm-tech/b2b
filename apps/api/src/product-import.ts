import path from "node:path";
import XLSX from "xlsx";
import { inferProductWeightKg, type ProductMaster, type ProductSlab } from "@aapoorti-b2b/domain";

type ImportRow = Record<string, string>;
type ProductTaxonomy = Pick<ProductMaster, "division" | "department" | "section" | "category" | "subCategory">;

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
    const taxonomy = deriveRetailTaxonomy(row);
    const sizeText = readMapped(row, ["size", "SIZE"]) || extractSizeText(name);
    const unit = inferUnit(readMapped(row, ["unit", "UNIT", "size", "SIZE"]) || name);
    const rspText = readMapped(row, ["rsp", "RSP"], "0");
    const mrpText = readMapped(row, ["mrp", "MRP"], "0");
    const allowedWarehouseIds = readMapped(row, ["allowedWarehouseIds", "ALLOWED_WAREHOUSE_IDS"])
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);
    const parsedWeightKg = parseProductWeightKg(row);

    products.push({
      sku: requiredString(barcode || makeSkuFromName(name), "SKU"),
      name: requiredString(name, "Product name"),
      division: requiredString(taxonomy.division, "Division"),
      department: requiredString(taxonomy.department, "Department"),
      section: requiredString(taxonomy.section, "Section"),
      category: taxonomy.category,
      subCategory: taxonomy.subCategory,
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

  return inferProductWeightKg(searchableText);
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
  return deriveRetailTaxonomy(row).category;
}

export function deriveRetailSubcategory(row: ImportRow) {
  return deriveRetailTaxonomy(row).subCategory;
}

export function deriveRetailTaxonomy(row: ImportRow): ProductTaxonomy {
  const category6 = readMapped(row, ["category6", "CATEGORY 6", "CAT-6"]).toUpperCase();
  const division = readMapped(row, ["division", "DIVISION"]).toUpperCase();
  const section = readMapped(row, ["section", "SECTION"]).toUpperCase();
  const department = readMapped(row, ["department", "DEPARTMENT"]).toUpperCase();
  const currentCategory = readMapped(row, ["category", "CATEGORY"]).toUpperCase();
  const currentSubCategory = readMapped(row, ["subCategory", "subcategory", "SUB_CATEGORY", "SUBCATEGORY"]).toUpperCase();
  const raw = normalizeProductName([
    category6,
    division,
    section,
    department,
    currentCategory,
    currentSubCategory,
    readMapped(row, ["articleName", "ARTICLE_NAME"]),
    readMapped(row, ["itemName", "ITEM NAME"]),
    readMapped(row, ["name", "NAME"]),
    readMapped(row, ["brand", "BRAND"]),
    readMapped(row, ["remarks", "REMARKS"])
  ].join(" "));

  const exact = (divisionText: string, departmentText: string, sectionText: string, categoryText: string, subCategoryText: string): ProductTaxonomy => ({
    division: divisionText,
    department: departmentText,
    section: sectionText,
    category: categoryText,
    subCategory: subCategoryText
  });

  if (matchesAny(raw, ["ALL OUT", "ALLOUT", "MOSQUITO", "REPELLENT", "VAPORIZER", "REFILL"])) {
    return exact("Home Care", "Pest Control", "Insect Repellent", "Pest Control", "Liquid Vaporizer Refill");
  }
  if (matchesAny(raw, ["FIAMA", "BATH SOAP", "SOAP", "BATHING BAR"])) {
    return exact("Personal Care", "Bath & Body", "Bath Soap", "Bath & Body", "Bathing Bar");
  }
  if (matchesAny(raw, ["SURF EXCEL", "GHADI", "RIN", "DETERGENT", "WASHING POWDER", "LAUNDRY"])) {
    const isBar = matchesAny(raw, ["BAR", "SOAP"]);
    return exact("Home Care", "Laundry Care", isBar ? "Detergent Bar" : "Detergent Powder", "Laundry Care", isBar ? "Detergent Bar" : "Detergent Powder");
  }
  if (matchesAny(raw, ["AASHIRWAD", "ATTA", "FLOUR"])) {
    return exact("Staples & Cooking", "Flour & Atta", "Wheat Flour", "Flour & Atta", "Packaged Atta");
  }
  if (matchesAny(raw, ["BESAN", "GRAM FLOUR", "CHANA FLOUR"])) {
    return exact("Staples & Cooking", "Flour & Atta", "Gram Flour", "Flour & Atta", "Gram Flour");
  }
  if (matchesAny(raw, ["SUGAR"])) {
    return exact("Staples & Cooking", "Sugar & Sweeteners", "Sugar", "Sugar & Sweeteners", "White Sugar");
  }
  if (matchesAny(raw, ["GHEE"])) {
    return exact("Staples & Cooking", "Ghee & Cooking Fats", "Ghee", "Ghee & Cooking Fats", "Cow Ghee");
  }
  if (matchesAny(raw, ["SOYA OIL", "SOYABEAN OIL", "REFINED OIL", "MUSTARD OIL", "SUNFLOWER OIL", "EDIBLE OIL"])) {
    return exact("Staples & Cooking", "Edible Oils", "Cooking Oil", "Edible Oils", matchesAny(raw, ["SOYA", "SOYABEAN"]) ? "Soyabean Oil" : "Refined Oil");
  }
  if (matchesAny(raw, ["TATA TEA", "RED LABEL", "TEA", "CHAI"])) {
    return exact("Beverages", "Tea & Infusions", "Leaf Tea", "Tea & Infusions", "Black Tea");
  }
  if (matchesAny(raw, ["HEALTH PLUS", "PACKAGED WATER", "DRINKING WATER", "WATER BOTTLE"])) {
    return exact("Beverages", "Water", "Packaged Drinking Water", "Water", "Packaged Drinking Water");
  }
  if (matchesAny(raw, ["STING"])) {
    return exact("Beverages", "Energy Drinks", "Energy Drinks", "Energy Drinks", "Energy Drink");
  }
  if (matchesAny(raw, ["AMUL LASSI"])) {
    return exact("Dairy & Breakfast", "Dairy Drinks", "Lassi", "Dairy Drinks", "Lassi");
  }
  if (matchesAny(raw, ["CHACH", "BUTTERMILK"])) {
    return exact("Dairy & Breakfast", "Dairy Drinks", "Buttermilk", "Dairy Drinks", "Buttermilk");
  }
  if (matchesAny(raw, ["APPY FIZZ"])) {
    return exact("Beverages", "Soft Drinks", "Sparkling Juice Drinks", "Soft Drinks", "Fruit Plus Fizz");
  }
  if (matchesAny(raw, ["COCA COLA", "THUMS UP", "THUMP UP"])) {
    return exact("Beverages", "Soft Drinks", "Carbonated Soft Drinks", "Soft Drinks", "Cola");
  }
  if (matchesAny(raw, ["SPRITE", "LIMCA"])) {
    return exact("Beverages", "Soft Drinks", "Carbonated Soft Drinks", "Soft Drinks", "Lemon-Lime");
  }
  if (matchesAny(raw, ["FANTA", "FENTA"])) {
    return exact("Beverages", "Soft Drinks", "Carbonated Soft Drinks", "Soft Drinks", "Orange");
  }
  if (matchesAny(raw, ["MAAZA", "MANGO DRINK", "PAPER BOAT MANGO", "PAPAR BOAT MANGO"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Mango Drinks", "Juices & Fruit Drinks", "Mango Drink");
  }
  if (matchesAny(raw, ["LITCHI", "LYCHEE", "LUCHEE"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Lychee Drinks", "Juices & Fruit Drinks", "Lychee Drink");
  }
  if (matchesAny(raw, ["GUAVA"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Guava Drinks", "Juices & Fruit Drinks", "Guava Drink");
  }
  if (matchesAny(raw, ["POMEGRANATE"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Pomegranate Drinks", "Juices & Fruit Drinks", "Pomegranate Drink");
  }
  if (matchesAny(raw, ["COCONUT WATER", "COCONAT WATER"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Coconut Water", "Juices & Fruit Drinks", "Coconut Water");
  }
  if (matchesAny(raw, ["PAPER BOAT", "PAPAR BOAT", "MIXED FRUIT", "FRUIT DRINK", "JUICE"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Mixed Fruit Drinks", "Juices & Fruit Drinks", "Mixed Fruit Drink");
  }
  if (matchesAny(raw, ["GOODAY", "GOOD DAY", "BISCUIT", "COOKIE", "MONACO"])) {
    const isCracker = matchesAny(raw, ["MONACO", "CRACKER"]);
    return exact("Snacks & Confectionery", "Biscuits & Cookies", isCracker ? "Crackers" : "Cookies", "Biscuits & Cookies", isCracker ? "Salted Crackers" : "Cookies");
  }
  if (matchesAny(raw, ["DAIRY MILK"])) {
    return exact("Snacks & Confectionery", "Chocolates & Candy", "Chocolate Bars", "Chocolates", "Chocolate Bar");
  }
  if (matchesAny(raw, ["PULSE TOFFEE", "TOFFEE", "CANDY"])) {
    return exact("Snacks & Confectionery", "Chocolates & Candy", "Candy & Toffee", "Confectionery", "Candy & Toffee");
  }

  return exact(
    readMapped(row, ["division", "DIVISION"], "General Merchandise"),
    readMapped(row, ["department", "DEPARTMENT"], "General"),
    readMapped(row, ["section", "SECTION"], "General"),
    readMapped(row, ["category", "CATEGORY"], "General Merchandise"),
    readMapped(row, ["subCategory", "subcategory", "SUB_CATEGORY", "SUBCATEGORY"], readMapped(row, ["section", "SECTION"], "General"))
  );
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
