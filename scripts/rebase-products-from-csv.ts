import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";
import { Client } from "pg";

type CsvRow = Record<string, unknown>;

type ProductRecord = {
  sku: string;
  name: string;
  baseProduct: string;
  weightVariant: string;
  division: string;
  department: string;
  sectionName: string;
  category: string;
  subCategory: string;
  unit: string;
  defaultGstRate: number;
  defaultTaxMode: string;
  defaultWeightKg: number;
  toleranceKg: number;
  tolerancePercent: number;
  allowedWarehouseIdsJson: string;
  slabsJson: string;
  remarks: string;
  category6: string;
  siteName: string;
  barcode: string;
  supplierName: string;
  hsnCode: string;
  articleName: string;
  itemName: string;
  brand: string;
  shortName: string;
  size: string;
  rsp: number | null;
  mrp: number | null;
  createdBy: string;
  createdAt: string;
};

const csvPath = process.argv[2] || "C:/Users/Windows11/Downloads/products.csv";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = path.resolve("data", `db-backup-before-product-rebase-${timestamp}.json`);
const wrongRemap = new Map<string, string>([
  ["ALL OUT ULTRA REFLLS 45 ML", "ALLOUT ULTRA REFILL 45ML"],
  ["CADBURY DAIRY MILK  6G  FMCG", "CADBURY DAIRY MILK 6GM"],
  ["COLGATE SADA TOOTH PASTE 36G (1)", "COLGATE SADA TOOTH PASTE 36GM"],
  ["LIJJAT MOONG PAPAD", "LIJJAT MOONG PAPAD 500G M"],
  ["LIJJAT URAD PAPAD", "LIJJAT URAD PAPAD 200GM"],
  ["NESTLE KITKAT  BIG 50GM  FMCG", "NESTLE KITKAT BIG 50GM"],
  ["PAPER BOAT GUAVA 140 ML", "PAPAR BOAT GUAVA 140ML"],
  ["PAPER BOAT LUSH LUCHEE 140ML", "PAPAR BOAT LUSH LYCHEE 140ML"],
  ["PAPER BOAT MANGO 140 ML", "PAPAR BOAT MANGO 140ML"],
  ["PAPER BOAT MIXED FRUIT  140 ML", "PAPAR BOAT MIXED FRUIT 140ML"],
  ["PAPER BOAT POMEGRANATE 140 ML", "PAPAR BOAT POMEGRANATE 140ML"],
  ["TATA TEA AGNI LEAF 250GM", "TATA TEA AGNI LEAF 250 GM"]
]);

const extraDeleteSkus = ["Himanshu atta 5 kg"];
const skuReferenceTables = [
  "purchase_orders",
  "sales_orders",
  "inventory_lots",
  "purchase_returns",
  "sales_returns",
  "probationary_sales",
  "delivery_dockets"
] as const;

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const workbook = XLSX.readFile(csvPath, { raw: true, cellText: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0] || "Sheet1"];
  if (!sheet) throw new Error(`Could not read CSV sheet from ${csvPath}`);

  const rawRows = XLSX.utils.sheet_to_json<CsvRow>(sheet, { raw: true, defval: "" });
  const rows = rawRows.map(toProductRecord);
  const activeRows = rows.filter((row) => row.weightVariant.toUpperCase() !== "WRONG");
  const wrongRows = rows.filter((row) => row.weightVariant.toUpperCase() === "WRONG");
  const activeBySku = new Map(activeRows.map((row) => [row.sku, row]));

  if (!activeBySku.has("PAPAR BOAT COCONUT WATER 140ML")) {
    const source = wrongRows.find((row) => row.sku === "PAPER BOAT COCONUT WATER 140 ML");
    if (source) {
      activeBySku.set("PAPAR BOAT COCONUT WATER 140ML", {
        ...source,
        sku: "PAPAR BOAT COCONUT WATER 140ML",
        name: "PAPAR BOAT COCONUT WATER 140ML",
        baseProduct: "PAPAR BOAT COCONUT WATER",
        weightVariant: "140ML",
        unit: "Ml",
        defaultWeightKg: 0.14,
        tolerancePercent: 0,
        size: "140ML",
        articleName: "PAPAR BOAT COCONUT WATER 140ML",
        createdAt: source.createdAt || new Date().toISOString()
      });
      wrongRemap.set("PAPER BOAT COCONUT WATER 140 ML", "PAPAR BOAT COCONUT WATER 140ML");
    }
  }

  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  await client.connect();

  try {
    await backupDatabase(client, backupPath);
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE products ADD COLUMN IF NOT EXISTS base_product TEXT NOT NULL DEFAULT '';
      ALTER TABLE products ADD COLUMN IF NOT EXISTS weight_variant TEXT NOT NULL DEFAULT '';
    `);

    for (const row of activeBySku.values()) {
      await upsertProduct(client, row);
    }

    const deletedWrong: string[] = [];
    const rebasedWrong: Array<{ from: string; to: string }> = [];
    for (const wrongRow of wrongRows) {
      const targetSku = wrongRemap.get(wrongRow.sku);
      if (targetSku) {
        const target = activeBySku.get(targetSku);
        if (!target) {
          throw new Error(`Missing replacement target ${targetSku} for wrong SKU ${wrongRow.sku}`);
        }
        await rebaseSkuReferences(client, wrongRow.sku, targetSku);
        await client.query("DELETE FROM products WHERE sku = $1", [wrongRow.sku]);
        rebasedWrong.push({ from: wrongRow.sku, to: targetSku });
        continue;
      }

      const usage = await countUsage(client, wrongRow.sku);
      const used = Object.values(usage).some((count) => count > 0);
      if (used) {
        throw new Error(`Wrong SKU ${wrongRow.sku} is still referenced and has no replacement mapping.`);
      }
      await client.query("DELETE FROM products WHERE sku = $1", [wrongRow.sku]);
      deletedWrong.push(wrongRow.sku);
    }

    const deletedExtras: string[] = [];
    for (const sku of extraDeleteSkus) {
      const usage = await countUsage(client, sku);
      const used = Object.values(usage).some((count) => count > 0);
      if (used) {
        throw new Error(`Extra SKU ${sku} is still referenced and cannot be deleted safely.`);
      }
      await client.query("DELETE FROM products WHERE sku = $1", [sku]);
      deletedExtras.push(sku);
    }

    const activeSkuList = [...activeBySku.keys()];
    await client.query(
      `DELETE FROM products
       WHERE sku <> ALL($1::text[])
         AND sku <> ALL($2::text[])`,
      [activeSkuList, wrongRows.map((row) => row.sku)]
    );

    await client.query("COMMIT");
    console.log(JSON.stringify({
      backupPath,
      imported: activeSkuList.length,
      rebasedWrong,
      deletedWrong,
      deletedExtras
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

function toProductRecord(row: CsvRow): ProductRecord {
  return {
    sku: text(row.sku),
    name: text(row.name),
    baseProduct: text(row.base),
    weightVariant: text(row["WHEIGT VARIANT"] || row["WEIGHT VARIANT"]),
    division: text(row.division),
    department: text(row.department),
    sectionName: text(row.section_name),
    category: text(row.category),
    subCategory: text(row.sub_category),
    unit: text(row.unit),
    defaultGstRate: numeric(row.default_gst_rate, 0),
    defaultTaxMode: text(row.default_tax_mode) || "Exclusive",
    defaultWeightKg: numeric(row.default_weight_kg, 0),
    toleranceKg: numeric(row.tolerance_kg, 0),
    tolerancePercent: numeric(row.tolerance_percent, 0),
    allowedWarehouseIdsJson: normalizeJsonArray(row.allowed_warehouse_ids_json),
    slabsJson: normalizeJsonArray(row.slabs_json, true),
    remarks: text(row.remarks),
    category6: text(row.category_6),
    siteName: text(row.site_name),
    barcode: text(row.barcode),
    supplierName: text(row.supplier_name),
    hsnCode: text(row.hsn_code),
    articleName: text(row.article_name),
    itemName: text(row.item_name),
    brand: text(row.brand),
    shortName: text(row.short_name),
    size: text(row.size),
    rsp: nullableNumber(row.rsp),
    mrp: nullableNumber(row.mrp),
    createdBy: text(row.created_by) || "catalog-script",
    createdAt: text(row.created_at) || new Date().toISOString()
  };
}

function text(value: unknown) {
  const normalized = String(value ?? "").replace(/\u00A0/g, " ").trim();
  return /^null$/i.test(normalized) ? "" : normalized;
}

function numeric(value: unknown, fallback: number) {
  const normalized = text(value);
  if (!normalized) return fallback;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown) {
  const normalized = text(value);
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeJsonArray(value: unknown, objectArray = false) {
  const normalized = text(value);
  if (!normalized) return objectArray ? "[]" : "[]";
  JSON.parse(normalized);
  return normalized;
}

async function backupDatabase(client: Client, targetPath: string) {
  const backup: Record<string, unknown> = {};
  const tables = [
    "products",
    "purchase_orders",
    "sales_orders",
    "inventory_lots",
    "purchase_returns",
    "sales_returns",
    "probationary_sales",
    "delivery_dockets"
  ];
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM ${table} ORDER BY 1`);
    backup[table] = result.rows;
  }
  fs.writeFileSync(targetPath, JSON.stringify(backup, null, 2));
}

async function upsertProduct(client: Client, row: ProductRecord) {
  await client.query(
    `INSERT INTO products (
      sku, name, base_product, weight_variant, division, department, section_name, category, sub_category, unit,
      default_gst_rate, default_tax_mode, default_weight_kg, tolerance_kg, tolerance_percent,
      allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode, supplier_name,
      hsn_code, article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16::jsonb, $17::jsonb, $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27, $28, $29, $30, $31, $32
    )
    ON CONFLICT (sku) DO UPDATE SET
      name = EXCLUDED.name,
      base_product = EXCLUDED.base_product,
      weight_variant = EXCLUDED.weight_variant,
      division = EXCLUDED.division,
      department = EXCLUDED.department,
      section_name = EXCLUDED.section_name,
      category = EXCLUDED.category,
      sub_category = EXCLUDED.sub_category,
      unit = EXCLUDED.unit,
      default_gst_rate = EXCLUDED.default_gst_rate,
      default_tax_mode = EXCLUDED.default_tax_mode,
      default_weight_kg = EXCLUDED.default_weight_kg,
      tolerance_kg = EXCLUDED.tolerance_kg,
      tolerance_percent = EXCLUDED.tolerance_percent,
      allowed_warehouse_ids_json = EXCLUDED.allowed_warehouse_ids_json,
      slabs_json = EXCLUDED.slabs_json,
      remarks = EXCLUDED.remarks,
      category_6 = EXCLUDED.category_6,
      site_name = EXCLUDED.site_name,
      barcode = EXCLUDED.barcode,
      supplier_name = EXCLUDED.supplier_name,
      hsn_code = EXCLUDED.hsn_code,
      article_name = EXCLUDED.article_name,
      item_name = EXCLUDED.item_name,
      brand = EXCLUDED.brand,
      short_name = EXCLUDED.short_name,
      size = EXCLUDED.size,
      rsp = EXCLUDED.rsp,
      mrp = EXCLUDED.mrp,
      created_by = EXCLUDED.created_by,
      created_at = EXCLUDED.created_at`,
    [
      row.sku,
      row.name,
      row.baseProduct,
      row.weightVariant,
      row.division,
      row.department,
      row.sectionName,
      row.category,
      row.subCategory,
      row.unit,
      row.defaultGstRate,
      row.defaultTaxMode,
      row.defaultWeightKg,
      row.toleranceKg,
      row.tolerancePercent,
      row.allowedWarehouseIdsJson,
      row.slabsJson,
      row.remarks,
      row.category6,
      row.siteName,
      row.barcode,
      row.supplierName,
      row.hsnCode,
      row.articleName,
      row.itemName,
      row.brand,
      row.shortName,
      row.size,
      row.rsp,
      row.mrp,
      row.createdBy,
      row.createdAt
    ]
  );
}

async function rebaseSkuReferences(client: Client, fromSku: string, toSku: string) {
  for (const table of skuReferenceTables) {
    await client.query(`UPDATE ${table} SET product_sku = $1 WHERE product_sku = $2`, [toSku, fromSku]);
  }
}

async function countUsage(client: Client, sku: string) {
  const usage: Record<string, number> = {};
  for (const table of skuReferenceTables) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE product_sku = $1`, [sku]);
    usage[table] = result.rows[0]?.count ?? 0;
  }
  return usage;
}
