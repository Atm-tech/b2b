import path from "node:path";
import { bulkCreateProducts, getSnapshot } from "./db.js";
import { parseWorkbookRows } from "./product-import.js";

const workbookPath = process.argv[2];

if (!workbookPath) {
  console.error("Usage: npm run import:workbook -- <path-to-xlsx>");
  process.exit(1);
}

const resolvedPath = path.resolve(workbookPath);
const snapshotBeforeImport = await getSnapshot();
const rows = parseWorkbookRows(resolvedPath, snapshotBeforeImport.warehouses.map((item) => item.id));
const snapshot = await bulkCreateProducts(rows, {
  id: 1,
  username: "admin",
  fullName: "Administrator",
  role: "Admin",
  roles: ["Admin"]
});

console.log(`Imported ${rows.length} products from ${resolvedPath}`);
console.log(`Products in database: ${snapshot.products.length}`);
