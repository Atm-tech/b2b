import path from "node:path";
import XLSX from "xlsx";
import { inferProductWeightKg, type ProductMaster, type ProductSlab } from "@aapoorti-b2b/domain";
import { classifyProductGst } from "./product-gst.js";

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
    const gstClassification = classifyProductGst({
      sku: barcode,
      name,
      hsnCode: readMapped(row, ["HSN CODE"])
    });

    products.push({
      sku: requiredString(barcode || makeSkuFromName(name), "SKU"),
      name: requiredString(name, "Product name"),
      division: requiredString(taxonomy.division, "Division"),
      department: requiredString(taxonomy.department, "Department"),
      section: requiredString(taxonomy.section, "Section"),
      category: taxonomy.category,
      subCategory: taxonomy.subCategory,
      unit: requiredString(unit, "Unit"),
      defaultGstRate: gstClassification?.rate ?? 0,
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
      mrp: Number(mrpText || 0),
      isSeasonal: /^(1|true|yes|y)$/i.test(readMapped(row, ["isSeasonal", "IS_SEASONAL", "SEASONAL"])),
      offerLabel: readMapped(row, ["offerLabel", "OFFER_LABEL", "OFFER"]),
      offerPrice: Number(readMapped(row, ["offerPrice", "OFFER_PRICE"], "0")) || undefined
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
  // Classification must be based on product identity, not the previous taxonomy.
  // Including old category fields here caused unrelated labels to "leak" into a
  // product (for example toothpaste matching Sugar or hair oil matching Beverages).
  const raw = normalizeProductName([
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

  // Home care (specific rules precede generic words such as SOAP or OIL).
  if (matchesAny(raw, ["SURF EXCEL", "GHADI", "RIN", "ARIEL", "TIDE", "WHEEL", "EZEE", "VANISH", "UJALA BLUE", "DETERGENT", "WASHING POWDER", "LAUNDRY SOAP"])) {
    const isBar = matchesAny(raw, ["BAR", "SOAP"]);
    return exact("Home Care", "Laundry Care", isBar ? "Detergent Bar" : "Detergent Powder", "Laundry Care", isBar ? "Detergent Bar" : "Detergent Powder");
  }
  if (matchesAny(raw, ["VIM", "EXO", "DISHWASH", "DISH WASH", "DISH BAR", "SCRUB PAD"])) {
    const isBar = matchesAny(raw, ["BAR", "CAKE"]);
    return exact("Home Care", "Dishwashing", isBar ? "Dishwash Bar" : "Dishwash Liquid", "Dishwashing", isBar ? "Dishwash Bar" : "Dishwash Liquid");
  }
  if (matchesAny(raw, ["HARPIC", "LIZOL", "PHENYL", "PHENYAL", "COLIN", "TILES CLEAN", "FLOOR CLEAN", "TOILET CLEAN", "GLASS CLEAN"])) {
    return exact("Home Care", "Household Cleaners", "Surface & Toilet Cleaners", "Household Cleaners", matchesAny(raw, ["TOILET", "HARPIC"]) ? "Toilet Cleaner" : "Floor & Surface Cleaner");
  }
  if (matchesAny(raw, ["BROOM", "JHADU", "MOP", "WIPER", "DUST PAN", "DUSTPAN"])) {
    return exact("Home Care", "Cleaning Tools", "Brooms & Mops", "Cleaning Tools", "Brooms & Mops");
  }
  if (matchesAny(raw, ["FEVICOL", "FEVIKWIK", "FEVI KWIK", "M SEAL", "M.SEAL", "ADHESIVE", "CELLO TAPE", "PACKING TAPE"])) {
    return exact("Home Care", "Utility", "Adhesives & Tapes", "Household Utility", "Adhesives & Tapes");
  }
  if (matchesAny(raw, ["BATTERY", "CELL AA", "CELL AAA", "DURACELL", "EVEREADY", "MATCH BOX", "MATCHBOX"])) {
    return exact("Home Care", "Utility", "Batteries & Matches", "Household Utility", matchesAny(raw, ["MATCH"]) ? "Matches" : "Batteries");
  }

  // Personal care.
  if (matchesAny(raw, ["TOOTHPASTE", "TOOTH PASTE", "DANT KANTI", "DAN KANTI", "DANT MNJN", "CIBACA TOP", "CLOSE UP", "COMPLETE CARE PASTE", "COLGATE", "PEPSODENT", "SENSODYNE", "MESWAK", "TOOTH POWDER", "VICCO VAJ"])) {
    return exact("Personal Care", "Oral Care", "Toothpaste & Powder", "Oral Care", matchesAny(raw, ["POWDER"]) ? "Tooth Powder" : "Toothpaste");
  }
  if (matchesAny(raw, ["TOOTHBRUSH", "TOOTH BRUSH", "DENTAL BRUSH"])) {
    return exact("Personal Care", "Oral Care", "Toothbrushes", "Oral Care", "Toothbrush");
  }
  if (matchesAny(raw, ["SHAMPOO", "SHAMPO", "HAIR CLEANSER", "KESH KANTI MILK PRO", "CONDITIONER", "HAIR OIL", "PARACHUTE OIL", "COCONUT BOTTLE", "MASSAGE OIL", "HAIR COLOUR", "HAIR COLOR", "NATURALS SHADE", "HAIR DYE", "HENNA", "MEHNDI"])) {
    const sub = matchesAny(raw, ["SHAMPOO"]) ? "Shampoo" : matchesAny(raw, ["CONDITIONER"]) ? "Conditioner" : matchesAny(raw, ["COLOUR", "COLOR", "DYE", "HENNA", "MEHNDI"]) ? "Hair Colour" : "Hair Oil";
    return exact("Personal Care", "Hair Care", sub, "Hair Care", sub);
  }
  if (matchesAny(raw, ["FACE WASH", "FACEWASH", " FW ", "BODY LOTION", "NIVEA", "JOY SKIN", "LIP LOVECARE", "CREAM", "MOISTUR", "VASELINE", "GLYCERIN", "GLYCERINE", "GULABARI", "GULABRI", "GULABJAL", "ROSE WATER", "ALOE VERA", "ALOVERA GEL", "EVERYUTH", "SCRUB", "BLEACH", "TALC", "FACE POWDER", "PONDS POWDER", "DREAMFLOWER POWDER", "Z POWDER", "DERMI COOL", "NYCIL", "BABY POWDER"])) {
    const sub = matchesAny(raw, ["FACE WASH", "FACEWASH"]) ? "Face Wash" : matchesAny(raw, ["TALC", "POWDER"]) ? "Talcum Powder" : "Skin Creams & Lotions";
    return exact("Personal Care", "Skin Care", sub, "Skin Care", sub);
  }
  if (matchesAny(raw, ["RAZOR", "SHAVING", "BLADE", "AFTER SHAVE"])) {
    return exact("Personal Care", "Men's Grooming", "Shaving", "Men's Grooming", matchesAny(raw, ["BLADE"]) ? "Razor Blades" : "Razors & Shaving");
  }
  if (matchesAny(raw, ["SANITARY", "WHISPER", "STAYFREE", "PANTY LINER"])) {
    return exact("Personal Care", "Feminine Care", "Sanitary Protection", "Feminine Care", "Sanitary Pads");
  }
  if (matchesAny(raw, ["HANDWASH", "HAND WASH", "H W ", "DETTOL LIQUID", "SANTOOR REGULAR 750", "SHOWER GEL", "BODY WASH"])) {
    return exact("Personal Care", "Bath & Body", "Liquid Cleansers", "Bath & Body", matchesAny(raw, ["HAND"]) ? "Hand Wash" : "Body Wash");
  }

  // Food staples and cooking essentials.
  if (matchesAny(raw, ["HALDI", "TURMERIC", "MIRCH", "CHILLI", "DHANIA", "CORIANDER", "JEERA", "CUMIN", "MASALA", "MASALE", "GARAM MASALA", "BLACK PEPPER", "KALI MIRCH"])) {
    return exact("Staples & Cooking", "Spices & Masala", "Spices", "Spices & Masala", matchesAny(raw, ["MASALA"]) ? "Blended Masala" : "Ground & Whole Spices");
  }
  if (matchesAny(raw, ["TOOR DAL", "ARHAR DAL", "MOONG DAL", "KHADI MOONG", "MASOOR DAL", "URAD DAL", "CHANA DAL", "DESI CHANA", "MATER WHITE", "RAJMA", "CHICKPEA", "KABULI CHANA", "PULSE", "DAL "])) {
    return exact("Staples & Cooking", "Pulses & Dals", "Dals & Beans", "Pulses & Dals", matchesAny(raw, ["RAJMA", "CHICKPEA", "CHANA"]) ? "Beans & Chana" : "Dals");
  }
  if (matchesAny(raw, ["RICE", "BASMATI", "POHA", "SOOJI", "SUJI", "SABUDANA", "DALIA", "DALIYA"])) {
    return exact("Staples & Cooking", "Rice & Grains", "Rice & Grains", "Rice & Grains", matchesAny(raw, ["RICE", "BASMATI"]) ? "Rice" : "Other Grains");
  }
  if (matchesAny(raw, ["SALT", "NAMAK", "MEETHA SODA"])) {
    return exact("Staples & Cooking", "Sugar & Salt", "Salt", "Sugar & Salt", "Edible Salt");
  }
  if (matchesAny(raw, ["ALMOND", "BADAM", "CASHEW", "KAJU", "RAISIN", "KISHMISH", "AKHROTH", "WALNUT", "PISTA", "DRY FRUIT"])) {
    return exact("Staples & Cooking", "Dry Fruits & Nuts", "Dry Fruits & Nuts", "Dry Fruits & Nuts", "Nuts & Dry Fruits");
  }
  if (matchesAny(raw, ["SAUCE", "KETCHUP", "VINEGAR", "PICKLE", "ACHAR", "CHUTNEY", "MAYONNAISE", "KEORA WATER", "KEWRA WATER"])) {
    return exact("Staples & Cooking", "Sauces & Condiments", "Condiments", "Sauces & Condiments", matchesAny(raw, ["PICKLE", "ACHAR"]) ? "Pickles" : "Sauces & Condiments");
  }

  // Snacks, packaged food and beverages.
  if (matchesAny(raw, ["NAMKEEN", "BHUJIA", "CHIPS", "KURKURE", "MIXTURE", "SEV ", "POP CORN", "POPCORN", "GOLDEN SIZZLE", "FRIMS"])) {
    return exact("Snacks & Confectionery", "Namkeen & Snacks", "Savoury Snacks", "Namkeen & Snacks", matchesAny(raw, ["CHIPS"]) ? "Chips" : "Namkeen");
  }
  if (matchesAny(raw, ["NOODLE", "MAGGI", "PASTA", "VERMICELLI", "SEWAI", "INSTANT FOOD", "READY MIX"])) {
    return exact("Snacks & Confectionery", "Instant & Ready Foods", "Instant Foods", "Instant & Ready Foods", matchesAny(raw, ["NOODLE", "MAGGI"]) ? "Noodles" : "Ready-to-Cook");
  }
  if (matchesAny(raw, ["PAPAD", "PAPADUM", "LIJJAT GARLIC"])) {
    return exact("Snacks & Confectionery", "Indian Snacks", "Papad", "Indian Snacks", "Papad");
  }
  if (matchesAny(raw, ["COFFEE", "NESCAFE", "BRU "])) {
    return exact("Beverages", "Coffee", "Coffee", "Coffee", matchesAny(raw, ["INSTANT"]) ? "Instant Coffee" : "Coffee");
  }
  if (matchesAny(raw, ["HORLICKS", "BOURNVITA", "COMPLAN", "BOOST", "GLUCON", "HEALTH DRINK"])) {
    return exact("Beverages", "Health Drinks", "Malted Drinks", "Health Drinks", "Malted Health Drink");
  }
  if (matchesAny(raw, ["MILK POWDER", "DAIRY WHITENER", "EVERYDAY", "MILKMAID", "AMUL SPRAY"])) {
    return exact("Dairy & Breakfast", "Milk Products", "Milk Powder & Whitener", "Milk Products", "Dairy Whitener");
  }
  if (matchesAny(raw, ["CORN FLAKES", "OATS", "MUESLI", "BREAKFAST CEREAL"])) {
    return exact("Dairy & Breakfast", "Breakfast Cereals", "Cereals & Oats", "Breakfast Cereals", "Cereals & Oats");
  }

  // Stationery and office supplies.
  if (matchesAny(raw, ["STAPLER", "STAPLE PIN", "PUNCH MACHINE", "SCISSOR", "PAPER CLIP"])) {
    return exact("Stationery", "Office Supplies", "Desk Supplies", "Office Supplies", "Staplers & Desk Tools");
  }
  if (matchesAny(raw, ["PEN ", "BALL PEN", "PENCIL", "ERASER", "SHARPENER", "MARKER", "HIGHLIGHTER"])) {
    return exact("Stationery", "Writing Supplies", "Writing Instruments", "Writing Supplies", matchesAny(raw, ["PENCIL"]) ? "Pencils" : "Pens & Markers");
  }
  if (matchesAny(raw, ["NOTEBOOK", "NOTE BOOK", "DIARY", "REGISTER", "SLATE", "DRAWING BOOK", "COPY "])) {
    return exact("Stationery", "Paper Products", "Notebooks & Registers", "Paper Products", "Notebooks & Registers");
  }
  if (matchesAny(raw, ["DOMS", "APSARA", "NATARAJ", "CAMLIN", "ELKOS", "KANGARO", "CRAYON", "ART KIT", "COLOUR PENCIL", "COLOR PENCIL", "FOAM CLAY", "GIFT PAPER", "KARBON PAPER"])) {
    return exact("Stationery", "School & Art Supplies", "Art & School Supplies", "School & Art Supplies", "Stationery");
  }
  if (matchesAny(raw, [" PEN", "K S BAG", "K S BOOK", "WOODEN SUPRA"])) {
    return exact("Stationery", "Writing & Packing Supplies", "Everyday Stationery", "Stationery", "Everyday Stationery");
  }
  if (matchesAny(raw, ["AMUL TAAZA", "AMUL COOL", "KESAR MILK", "TONED MILK", "FULL CREAM MILK", "CHEESE", "CHEASE", "PANEER", "BUTTER ", "AMUL MITHAI"])) {
    const sub = matchesAny(raw, ["CHEESE"]) ? "Cheese" : matchesAny(raw, ["PANEER"]) ? "Paneer" : matchesAny(raw, ["BUTTER"]) ? "Butter" : "Milk";
    return exact("Dairy & Breakfast", "Dairy Products", sub, "Dairy Products", sub);
  }
  if (matchesAny(raw, ["ENO ", "IODEX", "ZANDU BALM", "SPECIAL BALM", "ISABGOL", "PAIN BALM", "ANTISEPTIC"])) {
    return exact("Personal Care", "Wellness", "OTC Wellness", "Wellness", "OTC Wellness");
  }
  if (matchesAny(raw, ["PERFUME", "DEO ", "DEODORANT", "BODY SPRAY"])) {
    return exact("Personal Care", "Fragrances", "Deodorants & Perfumes", "Fragrances", matchesAny(raw, ["PERFUME"]) ? "Perfume" : "Deodorant");
  }
  if (matchesAny(raw, ["VEET", "HAIR REMOVER"])) {
    return exact("Personal Care", "Women's Grooming", "Hair Removal", "Women's Grooming", "Hair Removal Cream");
  }
  if (matchesAny(raw, ["ODONIL", "ORONIL", "AIR FRESHENER", "A F SET"])) {
    return exact("Home Care", "Air Care", "Air Fresheners", "Air Care", "Air Freshener");
  }
  if (matchesAny(raw, ["FITKARI"])) {
    return exact("Home Care", "Household Utility", "Utility Products", "Household Utility", "Alum");
  }
  if (matchesAny(raw, ["BLACK CURRANT", "BEAR BERRY"])) {
    return exact("Beverages", "Juices & Fruit Drinks", "Fruit Drinks", "Juices & Fruit Drinks", "Fruit Drink");
  }
  if (matchesAny(raw, ["PARLE", "BRITANNIA", "BRITTANIA", "SUNFEAST", "MOMS MAGIC", "AAROGYA MG", "OREO", "HIDE SEEK", "MARIE GOLD", "KRACK JACK", "JIM JAM", "NUTRI CHOICE", "LITTLE HEARTS"])) {
    return exact("Snacks & Confectionery", "Biscuits & Cookies", "Biscuits & Cookies", "Biscuits & Cookies", "Biscuits & Cookies");
  }
  if (matchesAny(raw, ["CADBURY", "CUDBURY", "KITKAT", "MILKY BAR", "CHOCOLATE", "MUNCH ", "PERK ", "5 STAR", "GEMS ", " GEM "])) {
    return exact("Snacks & Confectionery", "Chocolates & Candy", "Chocolate", "Chocolates", "Chocolate");
  }
  if (matchesAny(raw, ["MAKHANA", "BHUNA CHANA", "MURMURA"])) {
    return exact("Snacks & Confectionery", "Namkeen & Snacks", "Traditional Snacks", "Namkeen & Snacks", "Traditional Snacks");
  }
  if (matchesAny(raw, ["KISHMISH", "KISMIS", "MUNAKKA", "CHIRONJI", "CHIRONGE", "KHOPRA", "DRY COCONUT", "PHALI DANA", "GOND PREMIUM"])) {
    return exact("Staples & Cooking", "Dry Fruits & Nuts", "Dry Fruits & Nuts", "Dry Fruits & Nuts", "Dry Fruits & Nuts");
  }
  if (matchesAny(raw, ["RAWA", "RAVA", "DAAL", "SOYA BARI", "SOUNF", "SAUNF", "ELAICHEE", "ELAICHI", "EMLI", "AMCHUR", "KHADA DHANIYA", "KHADA SARSON", "KHAS KHAS", "LONG ", "METHI DANA", "SOUNTH"])) {
    return matchesAny(raw, ["DAAL", "SOYA BARI"])
      ? exact("Staples & Cooking", "Pulses & Dals", "Dals & Beans", "Pulses & Dals", "Dals & Beans")
      : exact("Staples & Cooking", "Spices & Masala", "Whole Spices", "Spices & Masala", "Whole Spices");
  }
  if (matchesAny(raw, ["GROUND NUT OIL", "GROUNDNUT OIL", "OLIVE OIL", "SOYA OIL", "SUNFLOWER", "MAHAKOSH", "TILONI OIL", "KIRTI OIL", "DAMMANI", "KRITI "])) {
    return exact("Staples & Cooking", "Edible Oils", "Cooking Oil", "Edible Oils", "Edible Oil");
  }
  if (matchesAny(raw, ["VANASPATI", "DALDA"])) {
    return exact("Staples & Cooking", "Ghee & Cooking Fats", "Cooking Fats", "Ghee & Cooking Fats", "Vanaspati");
  }
  if (matchesAny(raw, ["MISHRI", "GUD ", "JAGGERY"])) {
    return exact("Staples & Cooking", "Sugar & Sweeteners", "Sugar & Jaggery", "Sugar & Sweeteners", matchesAny(raw, ["GUD", "JAGGERY"]) ? "Jaggery" : "Mishri");
  }
  if (matchesAny(raw, ["MAIDA"])) {
    return exact("Staples & Cooking", "Flour & Atta", "Refined Flour", "Flour & Atta", "Maida");
  }
  if (matchesAny(raw, ["TAJ MAHAL"])) {
    return exact("Beverages", "Tea & Infusions", "Leaf Tea", "Tea & Infusions", "Black Tea");
  }
  if (matchesAny(raw, ["POOJA SUPARI"])) {
    return exact("Snacks & Confectionery", "Mouth Fresheners", "Supari", "Mouth Fresheners", "Supari");
  }
  if (matchesAny(raw, ["KRAZY LION"])) {
    return exact("Snacks & Confectionery", "Packaged Snacks", "Kids Snacks", "Packaged Snacks", "Kids Snack");
  }
  if (matchesAny(raw, ["KINLEY", "BISLERI", "AQUAFINA"])) {
    return exact("Beverages", "Water", "Packaged Drinking Water", "Water", "Packaged Drinking Water");
  }

  if (matchesAny(raw, ["ALL OUT", "ALLOUT", "MOSQUITO", "REPELLENT", "VAPORIZER", "MAXO LIQUID", "LAXMAN REKHA", "COMFORT CAM", "HIT BLACK", "HIT RED", "COCKROACH KILLER", "FLYING INSECT"])) {
    return exact("Home Care", "Pest Control", "Insect Repellent", "Pest Control", "Liquid Vaporizer Refill");
  }
  if (matchesAny(raw, ["FIAMA", "BATH SOAP", "SOAP", "BATHING BAR", "GODREJ NO 1", "MEDIMIX REGULAR"])) {
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

  return exact("General Merchandise", "Other Products", "Unclassified", "Other Products", "Review Required");
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
