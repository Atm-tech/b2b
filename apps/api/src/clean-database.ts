import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(sourceDir, "../../../.env") });

const tablesToClear = [
  "sessions",
  "settings",
  "note_records",
  "delivery_consignments",
  "delivery_dockets",
  "delivery_tasks",
  "ledger_entries",
  "inventory_lots",
  "receipt_checks",
  "payments",
  "sales_orders",
  "purchase_orders",
  "counterparties",
  "products"
];

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.PGSSLMODE === "require" || process.env.PGSSL === "true"
        ? { rejectUnauthorized: false }
        : undefined
  });

  await client.connect();

  try {
    await client.query("BEGIN");
    for (const table of tablesToClear) {
      await client.query(`DELETE FROM ${table}`);
    }
    await client.query("COMMIT");
    console.log(`Cleared tables: ${tablesToClear.join(", ")}`);
    console.log("Preserved tables: users, warehouses");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
