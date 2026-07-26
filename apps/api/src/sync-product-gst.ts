import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { classifyProductGst } from "./product-gst.js";

const apply = process.argv.includes("--apply");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required.");
const sslEnabled =
  process.env.PGSSLMODE === "require" ||
  process.env.PGSSL === "true" ||
  /render\.com/i.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
});

const client = await pool.connect();
try {
  const products = await client.query<{
    sku: string;
    name: string;
    hsn_code: string;
    default_gst_rate: number;
    default_tax_mode: string;
  }>("SELECT sku, name, hsn_code, default_gst_rate, default_tax_mode FROM products ORDER BY name");

  const classified = products.rows.map((product) => ({
    product,
    classification: classifyProductGst({
      sku: product.sku,
      name: product.name,
      hsnCode: product.hsn_code
    })
  }));
  const unresolved = classified.filter((item) => !item.classification);
  if (unresolved.length > 0) {
    console.error(`Unresolved products (${unresolved.length}):`);
    for (const item of unresolved) console.error(`- ${item.product.sku}: ${item.product.name}`);
    process.exitCode = 1;
  } else {
    const counts = new Map<number, number>();
    for (const item of classified) {
      const rate = Number(item.classification!.rate);
      counts.set(rate, (counts.get(rate) || 0) + 1);
    }
    console.log(`Classified ${classified.length} products: ${[...counts.entries()].sort(([a], [b]) => a - b).map(([rate, count]) => `${rate}%=${count}`).join(", ")}`);

    if (!apply) {
      console.log("Dry run only. Re-run with --apply to update the database.");
    } else {
      const runId = randomUUID();
      await client.query("BEGIN");
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS product_gst_rate_audit (
            id BIGSERIAL PRIMARY KEY,
            run_id UUID NOT NULL,
            sku TEXT NOT NULL,
            product_name TEXT NOT NULL,
            old_gst_rate DOUBLE PRECISION NOT NULL,
            new_gst_rate DOUBLE PRECISION NOT NULL,
            old_tax_mode TEXT NOT NULL,
            new_tax_mode TEXT NOT NULL,
            hsn_reference TEXT NOT NULL,
            reason TEXT NOT NULL,
            source TEXT NOT NULL,
            changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          )
        `);
        const updates = classified.map((item) => ({
          sku: item.product.sku,
          productName: item.product.name,
          oldGstRate: item.product.default_gst_rate,
          newGstRate: Number(item.classification!.rate),
          oldTaxMode: item.product.default_tax_mode,
          hsnReference: item.classification!.hsn,
          reason: item.classification!.reason,
          source: item.classification!.source
        }));
        const rateUpdatesJson = JSON.stringify(updates.map((item) => ({
          sku: item.sku,
          new_gst_rate: item.newGstRate
        })));
        await client.query(
          `INSERT INTO product_gst_rate_audit
             (run_id, sku, product_name, old_gst_rate, new_gst_rate, old_tax_mode, new_tax_mode, hsn_reference, reason, source)
           SELECT $1, x.sku, x.product_name, x.old_gst_rate, x.new_gst_rate, x.old_tax_mode,
                  'Exclusive', x.hsn_reference, x.reason, x.source
           FROM jsonb_to_recordset($2::jsonb) AS x(
             sku TEXT,
             product_name TEXT,
             old_gst_rate DOUBLE PRECISION,
             new_gst_rate DOUBLE PRECISION,
             old_tax_mode TEXT,
             hsn_reference TEXT,
             reason TEXT,
             source TEXT
           )`,
          [
            runId,
            JSON.stringify(updates.map((item) => ({
              sku: item.sku,
              product_name: item.productName,
              old_gst_rate: item.oldGstRate,
              new_gst_rate: item.newGstRate,
              old_tax_mode: item.oldTaxMode,
              hsn_reference: item.hsnReference,
              reason: item.reason,
              source: item.source
            })))
          ]
        );
        await client.query(
          `UPDATE products AS p
           SET default_gst_rate = x.new_gst_rate,
               default_tax_mode = 'Exclusive'
           FROM jsonb_to_recordset($1::jsonb) AS x(sku TEXT, new_gst_rate DOUBLE PRECISION)
           WHERE p.sku = x.sku`,
          [rateUpdatesJson]
        );
        await client.query("COMMIT");
        console.log(`Applied GST classifications in audit run ${runId}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  }
} finally {
  client.release();
  await pool.end();
}
