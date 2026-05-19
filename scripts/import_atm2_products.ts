import { getSnapshot, bulkCreateProducts } from "../apps/api/src/db.js";
import { parseWorkbookRows, deriveRetailTaxonomy } from "../apps/api/src/product-import.js";
import type { ProductMaster } from "@aapoorti-b2b/domain";

const workbookPath = process.argv[2] || "C:\\Users\\Windows11\\Downloads\\ATM 2 PRODUCT NAME.xlsx";

function normalizedName(value: string) {
  return value
    .toUpperCase()
    .replace(/\bTHUMP\s+UP\b/g, "THUMS UP")
    .replace(/\bFENTA\b/g, "FANTA")
    .replace(/\bREFLLS\b/g, "REFILLS")
    .replace(/[^\w.+*]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  const snapshot = await getSnapshot();
  const defaultWarehouseIds = snapshot.warehouses.map((item) => item.id);
  const workbookRows = parseWorkbookRows(workbookPath, defaultWarehouseIds);
  const existingByName = new Map(snapshot.products.map((product) => [normalizedName(product.name), product]));

  const normalizedExisting = snapshot.products.map((product) => {
    const taxonomy = deriveRetailTaxonomy({
      name: product.name,
      division: product.division,
      department: product.department,
      section: product.section,
      category: product.category,
      subCategory: product.subCategory,
      category6: product.category6 || "",
      brand: product.brand || "",
      itemName: product.itemName || "",
      articleName: product.articleName || "",
      remarks: product.remarks || ""
    });
    return {
      ...product,
      division: taxonomy.division,
      department: taxonomy.department,
      section: taxonomy.section,
      category: taxonomy.category,
      subCategory: taxonomy.subCategory,
      allowedWarehouseIds: product.allowedWarehouseIds.length > 0 ? product.allowedWarehouseIds : defaultWarehouseIds
    };
  });

  const workbookNormalized = workbookRows.map((row) => {
    const existing = existingByName.get(normalizedName(row.name));
    return {
      ...row,
      sku: existing?.sku || row.name.trim(),
      allowedWarehouseIds: row.allowedWarehouseIds.length > 0 ? row.allowedWarehouseIds : (existing?.allowedWarehouseIds?.length ? existing.allowedWarehouseIds : defaultWarehouseIds),
      slabs: existing?.slabs?.length ? existing.slabs : row.slabs
    };
  });

  const merged = new Map<string, Omit<ProductMaster, "createdBy" | "createdAt">>();
  for (const product of normalizedExisting) {
    merged.set(product.sku, {
      sku: product.sku,
      name: product.name,
      division: product.division,
      department: product.department,
      section: product.section,
      category: product.category,
      subCategory: product.subCategory,
      unit: product.unit,
      defaultGstRate: product.defaultGstRate,
      defaultTaxMode: product.defaultTaxMode,
      defaultWeightKg: product.defaultWeightKg,
      toleranceKg: product.toleranceKg,
      tolerancePercent: product.tolerancePercent,
      allowedWarehouseIds: product.allowedWarehouseIds,
      slabs: product.slabs,
      remarks: product.remarks,
      category6: product.category6,
      siteName: product.siteName,
      barcode: product.barcode,
      supplierName: product.supplierName,
      hsnCode: product.hsnCode,
      articleName: product.articleName,
      itemName: product.itemName,
      brand: product.brand,
      shortName: product.shortName,
      size: product.size,
      rsp: product.rsp,
      mrp: product.mrp
    });
  }

  for (const product of workbookNormalized) {
    merged.set(product.sku, product);
  }

  const rows = [...merged.values()];
  await bulkCreateProducts(rows, {
    id: 0,
    username: "catalog-script",
    fullName: "Catalog Script",
    role: "Admin",
    roles: ["Admin"]
  } as any);

  console.log(`Imported or normalized ${rows.length} products from catalog and workbook.`);
  console.log(`Workbook rows processed: ${workbookRows.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
