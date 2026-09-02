import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { bulkCreateProducts, getSnapshot } from "../apps/api/src/db.js";
import { deriveRetailTaxonomy } from "../apps/api/src/product-import.js";

type PriceRow = { name: string; key: string; tokens: Set<string>; numbers: string[]; mrp: number; rsp: number };

const aliases: Array<[RegExp, string]> = [
  [/\bRIFILL\b|\bRIFFIL\b/g, "REFILL"], [/\bTHUMP\s+UP\b/g, "THUMS UP"], [/\bFENTA\b/g, "FANTA"],
  [/\bGULABRI\b/g, "GULABARI"], [/\bLIRILL\b/g, "LIRIL"], [/\bGMS?\b|\bGRAMS?\b/g, "G"],
  [/\bKGS?\b|\bKILOGRAMS?\b/g, "KG"], [/\bLITRES?\b|\bLTRS?\b|\bLTS?\b/g, "L"], [/\bM(?![A-Z])\b/g, "ML"]
];
const stop = new Set(["NEW", "FMCG", "PCS", "PC", "PACK", "PKT", "MRP", "FREE", "WITH", "THE"]);

function keyOf(value: unknown) {
  let result = String(value || "").toUpperCase();
  for (const [pattern, replacement] of aliases) result = result.replace(pattern, replacement);
  return result.replace(/[^A-Z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenSet(key: string) {
  return new Set(key.split(" ").filter((token) => token && !stop.has(token)));
}

function similarity(left: Set<string>, right: Set<string>) {
  const common = [...left].filter((token) => right.has(token)).length;
  return common / Math.max(left.size, right.size, 1);
}

function representative(values: number[]) {
  const valid = values.filter((value) => Number.isFinite(value) && value > 0);
  const counts = new Map<number, number>();
  for (const value of valid) counts.set(value, (counts.get(value) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || 0;
}

function buildPriceRows(rows: Record<string, unknown>[]) {
  const grouped = new Map<string, { name: string; mrp: number[]; rsp: number[] }>();
  for (const row of rows) {
    const name = String(row["ARTICLE NAME"] || "").trim();
    const key = keyOf(name);
    if (!key) continue;
    const entry = grouped.get(key) || { name, mrp: [], rsp: [] };
    entry.mrp.push(Number(row.MRP || 0));
    entry.rsp.push(Number(row.RSP || 0));
    grouped.set(key, entry);
  }
  return [...grouped.entries()].map(([key, value]): PriceRow => ({
    name: value.name, key, tokens: tokenSet(key), numbers: key.match(/\d+(?:\.\d+)?/g) || [],
    mrp: representative(value.mrp), rsp: representative(value.rsp)
  }));
}

function findPrice(product: { name: string; articleName?: string; itemName?: string; shortName?: string; sku: string }, prices: PriceRow[]) {
  const identities = [product.name, product.articleName, product.itemName, product.shortName, product.sku].filter(Boolean).map(keyOf);
  const exact = prices.find((price) => identities.includes(price.key));
  if (exact) return { row: exact, confidence: 1, method: "exact" };

  let best: { row: PriceRow; confidence: number } | undefined;
  let second = 0;
  for (const identity of identities) {
    const tokens = tokenSet(identity);
    const numbers = identity.match(/\d+(?:\.\d+)?/g) || [];
    for (const row of prices) {
      if (numbers.length && row.numbers.length && numbers.join("|") !== row.numbers.join("|")) continue;
      const score = similarity(tokens, row.tokens);
      if (!best || score > best.confidence) { second = best?.confidence || second; best = { row, confidence: score }; }
      else if (score > second) second = score;
    }
  }
  return best && best.confidence >= 0.8 && best.confidence - second >= 0.08
    ? { ...best, method: "fuzzy" }
    : undefined;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const snapshot = await getSnapshot();
  const workbookPath = process.env.PRODUCT_PRICE_WORKBOOK || "SALE 1-4-26 TO 26-7-26 - HSN GST ERP FINAL.xlsx";
  const workbook = XLSX.readFile(workbookPath);
  const sheet = workbook.Sheets["Cleaned Sales"];
  if (!sheet) throw new Error("Cleaned Sales sheet was not found in the price workbook.");
  const prices = buildPriceRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" }));
  let exact = 0;
  let fuzzy = 0;
  let priced = 0;

  const rows = snapshot.products.map((product) => {
    const taxonomy = deriveRetailTaxonomy({
      name: product.name, articleName: product.articleName || "", itemName: product.itemName || "",
      brand: product.brand || "", remarks: product.remarks || "", division: product.division,
      department: product.department, section: product.section, category: product.category,
      subCategory: product.subCategory || ""
    });
    const match = findPrice(product, prices);
    if (match?.method === "exact") exact++;
    if (match?.method === "fuzzy") fuzzy++;
    if (match?.row.mrp) priced++;
    const { createdBy: _createdBy, createdAt: _createdAt, ...writeable } = product;
    return {
      ...writeable, ...taxonomy,
      mrp: match?.row.mrp || product.mrp || 0,
      rsp: match?.row.rsp || product.rsp || 0
    };
  });

  const paths = new Set(rows.map((product) => [product.division, product.department, product.section, product.category, product.subCategory].join(" | ")));
  const changedRows = rows.filter((row, index) => {
    const current = snapshot.products[index];
    return row.division !== current.division || row.department !== current.department || row.section !== current.section
      || row.category !== current.category || row.subCategory !== current.subCategory
      || Number(row.mrp || 0) !== Number(current.mrp || 0) || Number(row.rsp || 0) !== Number(current.rsp || 0);
  });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", products: rows.length, changedProducts: changedRows.length, exactPriceMatches: exact, fuzzyPriceMatches: fuzzy, productsWithMrp: priced, taxonomyPaths: paths.size }, null, 2));
  if (process.argv.includes("--report-unclassified")) {
    console.log(JSON.stringify(rows.filter((row, index) =>
      row.division === snapshot.products[index].division
      && row.department === snapshot.products[index].department
      && row.section === snapshot.products[index].section
      && row.category === snapshot.products[index].category
      && row.subCategory === snapshot.products[index].subCategory
    ).map((row) => ({ sku: row.sku, name: row.name, taxonomy: [row.division, row.department, row.section, row.category, row.subCategory].join(" | ") })), null, 2));
  }
  if (!apply) return;

  const backupDir = path.resolve("data", "catalog-backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `products-before-normalize-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupPath, JSON.stringify(snapshot.products, null, 2));
  await bulkCreateProducts(changedRows, { id: 0, username: "catalog-normalizer", fullName: "Catalog Normalizer", role: "Admin", roles: ["Admin"] } as any);
  console.log(`Backup: ${backupPath}`);
  console.log("Catalog normalization applied successfully.");
}

main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
