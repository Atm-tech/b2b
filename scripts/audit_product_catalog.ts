import { getSnapshot } from "../apps/api/src/db.js";
import * as XLSX from "xlsx";

function normalizedName(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/\bRIFILL\b|\bRIFFIL\b/g, "REFILL")
    .replace(/\bTHUMP\s+UP\b/g, "THUMS UP")
    .replace(/\bFENTA\b/g, "FANTA")
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
const snapshot = await getSnapshot();
const products = snapshot.products;
const summaryOnly = process.argv.includes("--summary-only");
const productsWithSales = new Set(snapshot.salesOrders.filter((order) => order.status !== "Cancelled" && order.rate > 0).map((order) => order.productSku));
const productsWithCdTod = new Set(snapshot.salesOrders.filter((order) => order.status !== "Cancelled" && order.cdTodRate > 0).map((order) => order.productSku));
const priceWorkbookPath = process.env.PRODUCT_PRICE_WORKBOOK || "SALE 1-4-26 TO 26-7-26 - HSN GST ERP FINAL.xlsx";
const priceWorkbook = XLSX.readFile(priceWorkbookPath);
const priceRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(priceWorkbook.Sheets["Cleaned Sales"], { defval: "" });
const priceNames = new Set(priceRows.map((row) => normalizedName(row["ARTICLE NAME"])));
const productsMatchedToPriceSource = products.filter((product) => [product.name, product.articleName, product.itemName, product.sku].some((value) => priceNames.has(normalizedName(value))));
const matchedSku = new Set(productsMatchedToPriceSource.map((product) => product.sku));
const taxonomy = [...new Set(products.map((product) => [
  product.division,
  product.department,
  product.section,
  product.category,
  product.subCategory
].join(" | ")))].sort();

console.log(JSON.stringify({
  summary: {
    products: products.length,
    missingMrp: products.filter((product) => !product.mrp || product.mrp <= 0).length,
    missingRsp: products.filter((product) => !product.rsp || product.rsp <= 0).length,
    blankCategory: products.filter((product) => !product.category?.trim()).length,
    blankSubCategory: products.filter((product) => !product.subCategory?.trim()).length,
    genericTaxonomy: products.filter((product) => [product.division, product.department, product.section, product.category, product.subCategory].some((value) => /general|misc/i.test(value || ""))).length,
    taxonomyPaths: taxonomy.length,
    salesLines: snapshot.salesOrders.length,
    productsWithSalesHistory: productsWithSales.size,
    productsWithCdTodHistory: productsWithCdTod.size,
    priceSourceRows: priceRows.length,
    productsMatchedToPriceSource: productsMatchedToPriceSource.length
  },
  unmatchedProducts: process.argv.includes("--unmatched") ? products.filter((product) => !matchedSku.has(product.sku)).map((product) => ({ sku: product.sku, name: product.name, articleName: product.articleName, itemName: product.itemName })) : undefined,
  reviewRequired: process.argv.includes("--review-required") ? products.filter((product) => /general|review required|unclassified/i.test([product.division, product.department, product.section, product.category, product.subCategory].join(" "))).map((product) => ({ sku: product.sku, name: product.name })) : undefined,
  taxonomy: summaryOnly ? undefined : taxonomy,
  products: summaryOnly ? undefined : products.map((product) => ({
    sku: product.sku,
    name: product.name,
    brand: product.brand || "",
    division: product.division,
    department: product.department,
    section: product.section,
    category: product.category,
    subCategory: product.subCategory,
    rsp: product.rsp || 0,
    mrp: product.mrp || 0,
    lastPurchaseRate: product.slabs[0]?.purchaseRate || 0
  }))
}, null, 2));

}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
