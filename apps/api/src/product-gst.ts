import type { GstRate } from "@aapoorti-b2b/domain";

export type ProductGstClassification = {
  rate: GstRate;
  hsn: string;
  reason: string;
  source: string;
};

const RATE_NOTIFICATION = "CBIC Notification 9/2025-Integrated Tax (Rate), effective 2025-09-22";
const EXEMPT_NOTIFICATION = "CBIC Notification 10/2025-Integrated Tax (Rate), effective 2025-09-22";
const BEVERAGE_AMENDMENT = "CBIC Notification 1/2026-Integrated Tax (Rate), effective 2026-05-01";

function result(rate: GstRate, hsn: string, reason: string, source = RATE_NOTIFICATION): ProductGstClassification {
  return { rate, hsn, reason, source };
}

function has(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

function normalize(value: string) {
  return value
    .toUpperCase()
    .replace(/\bTHUMP\s+UP\b/g, "THUMS UP")
    .replace(/\bFENTA\b/g, "FANTA")
    .replace(/\bPAPAR\b/g, "PAPER")
    .replace(/\bCUDBURY\b/g, "CADBURY")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * GST classification for the FMCG product families currently sold by Aapoorti.
 *
 * Classification deliberately uses SKU and product name, not the legacy catalog
 * category, because several imported category values are incorrect.
 */
export function classifyProductGst(product: { sku?: string; name: string; hsnCode?: string }): ProductGstClassification | undefined {
  const text = normalize(`${product.sku || ""} ${product.name} ${product.hsnCode || ""}`);

  if (has(text, ["STAYFREE", "SANITARY PAD", "SANITARY NAPKIN"])) {
    return result(0, "96190010", "Sanitary towels or sanitary napkins are exempt.", EXEMPT_NOTIFICATION);
  }

  const isStaple = has(text, [
    "ATTA", " FLOUR", "BESAN", "RICE", "KABULI CHANA", "RAJMA", "TOOR DAAL", "TOOR DAL", "POHA"
  ]);
  const isLooseOrOver25Kg = /\bLOOSE\b/.test(text) || /\b(?:30|50)\s*KG\b/.test(text);
  if (isStaple && isLooseOrOver25Kg) {
    const hsn = has(text, ["BESAN"]) ? "1106"
      : has(text, ["ATTA", " FLOUR"]) ? "1101"
        : has(text, ["RICE"]) ? "1006"
          : has(text, ["POHA"]) ? "1904"
            : "0713";
    return result(0, hsn, "Loose/non-retail staple or a pack above the 25 kg retail-pack threshold.", EXEMPT_NOTIFICATION);
  }

  if (has(text, ["APPY FIZZ"])) {
    return result(40, "2202", "Carbonated beverage with fruit juice.", `${RATE_NOTIFICATION}; ${BEVERAGE_AMENDMENT}`);
  }
  if (has(text, ["STING", "ENERGY DRINK"])) {
    return result(40, "22029991/22029999", "Caffeinated/energy beverage.", `${RATE_NOTIFICATION}; ${BEVERAGE_AMENDMENT}`);
  }
  if (has(text, ["COCA COLA", "FANTA", "MIRINDA", "LIMCA", "SPRITE", "THUMS UP"])) {
    return result(40, "220210", "Aerated beverage containing added sugar, sweetener or flavour.", RATE_NOTIFICATION);
  }

  if (has(text, ["APPLE VINEGAR"])) {
    return result(18, "2209", "Vinegar and substitutes for vinegar.");
  }
  if (has(text, ["KEORA WATER", "KEWRA WATER"])) {
    return result(18, "33030030", "Keora/kewra water.");
  }
  if (has(text, ["ALLOUT", "ALL OUT", "HIT BLACK", "HIT CIK", "HIT FIK", "HIT RED", "MOSQUITO KILLER", "COCKROACH KILLER", "INSECT KILLER"])) {
    return result(18, "3808", "Retail insecticide or insect-repellent preparation.");
  }
  if (has(text, ["DURACELL", "ALKALINE BATTER"])) {
    return result(18, "8506", "Primary cells and primary batteries.");
  }
  if (has(text, ["GILLETTE", "SUPER-MAX", "SUPER MAX", "RAZOR", " BLADE"])) {
    return result(18, "8212", "Razors and razor blades.");
  }
  if (has(text, ["DETERGENT", "GHADI POWDER", "GHADI SOAP", "GHADI CAKE", "SURF EXCEL", "VIM BAR", "WHEEL GREEN", "UJALA BLUE"]) || /\bRIN\b/.test(text)) {
    return result(18, "3402/3401", "Laundry, dishwashing or cleaning preparation.");
  }
  if (has(text, ["HANDWASH", "HAND WASH", "H/W", "SHOWER GEL"])) {
    return result(18, "3401", "Liquid skin-washing preparation; the 5% entry is limited to toilet soap bars.");
  }
  if (has(text, ["PHENYL", "PHYNIEL"])) {
    return result(18, "3808", "Disinfectant preparation.");
  }
  if (has(text, ["CONDITIONER", "HAIR COLOR", "BLACK NATURAL", "BLACK NATURALS"])) {
    return result(18, "3305", "Hair preparation other than hair oil or shampoo.");
  }
  if (has(text, ["FACE WASH", " FW ", "FACE SCRUB", "WALNUT SCRUB", "BODY LOTION", "MOISTURIZER", "DEEP MOISTURE", " LOTION", " CREAM", "BLEACH", "GULABARI", "GULABJAL", "DEO ", "GLYCERINE", "BABY ALMOND OIL"])) {
    return result(18, "3304/3307", "Skin-care, cosmetic or toilet preparation not covered by a specific 5% entry.");
  }

  if (has(text, ["LASSI", "CHACH", "BUTTERMILK"])) {
    return result(5, "0403", "Pre-packaged and labelled lassi or buttermilk.");
  }
  if (has(text, ["GHEE"])) {
    return result(5, "0405", "Ghee and other fats and oils derived from milk.");
  }
  if (has(text, ["GROUNDNUT OIL", "GROUND NUT OIL", "G.NUT", "SUNFLOWER", "MUSTARD OIL", "SOYA OIL", "RICE BRAN", "ROGAN BADAM", "ROGHAN BADAM"])) {
    return result(5, "1507-1515", "Edible vegetable or nut oil.");
  }
  if (has(text, ["HAIR OIL"])) {
    return result(5, "3305", "Hair oil is listed in Schedule I.");
  }
  if (has(text, ["SHAMPOO", "SHEMPOO", "SHMP"])) {
    return result(5, "3305", "Shampoo is listed in Schedule I.");
  }
  if (has(text, ["TOOTHPASTE", "TOOTH PASTE", "COLGATE", "DANT KANTI", "DANTKANTI", " PASTE"])) {
    return result(5, "3306", "Toothpaste is listed in Schedule I.");
  }
  if (has(text, ["TALC", "DERMI COOL", "FACE POWDER", "WHITE TONE", "Z-POWDER"])) {
    return result(5, "3304", "Talcum powder or face powder is listed in Schedule I.");
  }
  if (has(text, ["DETTOL ORIGINAL SOAP", "FIAMA CELEBRATION", "LIRIL ", "PATANJALI HALDI CHANDAN SOAP"])) {
    return result(5, "3401", "Toilet soap bar is listed in Schedule I.");
  }

  if (has(text, ["AASHIRVAAD ATTA", "HIMANSHU FLOUR"])) {
    return result(5, "1101", "Pre-packaged and labelled wheat flour not exceeding 25 kg.");
  }
  if (has(text, ["BESAN"])) {
    return result(5, "1106", "Pre-packaged and labelled pulse flour not exceeding 25 kg.");
  }
  if (has(text, ["DUBRAJ RICE"])) {
    return result(5, "1006", "Pre-packaged and labelled rice not exceeding 25 kg.");
  }
  if (has(text, ["KABULI CHANA", "RAJMA", "TOOR DAAL", "TOOR DAL"])) {
    return result(5, "0713", "Pre-packaged and labelled dried pulses not exceeding 25 kg.");
  }
  if (has(text, ["POHA"])) {
    return result(5, "1904", "Pre-packaged and labelled flattened rice not exceeding 25 kg.");
  }
  if (has(text, ["SUGAR"])) {
    return result(5, "1701", "Cane or beet sugar and chemically pure sucrose.");
  }
  if (has(text, ["RED LABEL", "TAAZA TEA", "TAJ MAHAL", "TATA TEA"])) {
    return result(5, "0902", "Tea, whether or not flavoured.");
  }
  if (has(text, ["BOURNVITA", "GLUCON-D", "GLUCON.D", "GLUCON'D"])) {
    return result(5, "1901/2106", "Malt-based or other food preparation.");
  }
  if (has(text, ["MAGGI", "NOODLES"])) {
    return result(5, "1902", "Pasta and noodles.");
  }
  if (has(text, ["BISCUIT", "COOKIE", "PARLE-G", "GOOD DAY", "GOODAY", "JIM JAM", "LITTLE HEARTS", "MARIE GOLD", "NICE TIME", "NUTRI CHOICE", "MASKA CHASKA", "KRACK JACK", "MONACO", "HIDE&SEEK", "PATANJALI AAROGYA MG"])) {
    return result(5, "1905", "Biscuits, cookies or other bakers' wares.");
  }
  if (has(text, ["CADBURY", "5STAR", "5 STAR", "KITKAT", "PERK", "PULSE TOFFEE"])) {
    return result(5, "1704/1806", "Sugar confectionery or chocolate preparation.");
  }
  if (has(text, ["KETCHUP"])) {
    return result(5, "2103", "Sauce or condiment preparation.");
  }
  if (has(text, ["PAPAD", "LIJJAT GARLIC"])) {
    return result(5, "1905", "Papad or similar prepared food.");
  }
  if (has(text, ["HEALTH PLUS WATER BOTTLE"])) {
    return result(5, "2201", "Packaged drinking water without added sugar or flavour.");
  }
  if (has(text, ["COCONUT WATER"])) {
    return result(5, "20098990", "Pre-packaged tender coconut water.");
  }
  if (has(text, ["MAAZA", "LITCHI DRINK", "PAPER BOAT"])) {
    return result(5, "22029921/22029929", "Non-carbonated fruit-pulp or fruit-juice-based drink.", `${RATE_NOTIFICATION}; ${BEVERAGE_AMENDMENT}`);
  }

  return undefined;
}
