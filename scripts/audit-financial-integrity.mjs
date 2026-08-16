import "dotenv/config";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const sslEnabled = process.env.PGSSLMODE === "require" || process.env.PGSSL === "true" || Boolean(databaseUrl && /render\.com/i.test(databaseUrl));
const pool = new pg.Pool({
  connectionString: databaseUrl,
  host: databaseUrl ? undefined : process.env.POSTGRES_HOST || "127.0.0.1",
  port: databaseUrl ? undefined : Number(process.env.POSTGRES_PORT || 5432),
  database: databaseUrl ? undefined : process.env.POSTGRES_DB || "aapoorti_b2b",
  user: databaseUrl ? undefined : process.env.POSTGRES_USER || "aapoorti_app",
  password: databaseUrl ? undefined : process.env.POSTGRES_PASSWORD || "aapoorti123",
  ssl: sslEnabled ? { rejectUnauthorized: false } : undefined
});

const checks = [
  {
    name: "database financial constraints",
    severity: "error",
    sql: `WITH required(name) AS (VALUES
            ('purchase_orders_total_matches_tax'),
            ('sales_orders_total_matches_discounts'),
            ('sales_orders_discount_matches_net_rate')
          )
          SELECT COUNT(*)::int AS count
          FROM required
          LEFT JOIN pg_constraint constraint_record
            ON constraint_record.conname = required.name AND constraint_record.convalidated
          WHERE constraint_record.oid IS NULL`
  },
  {
    name: "purchase line totals",
    severity: "error",
    sql: `SELECT COUNT(*)::int AS count FROM purchase_orders
          WHERE ABS(total_amount - ROUND((taxable_amount + gst_amount)::numeric, 2)::double precision) > 0.009`
  },
  {
    name: "sales line totals",
    severity: "error",
    sql: `SELECT COUNT(*)::int AS count FROM sales_orders
          WHERE ABS(total_amount - ROUND(GREATEST(0, taxable_amount + gst_amount - cd_amount - tod_amount)::numeric, 2)::double precision) > 0.009`
  },
  {
    name: "sales discount/net-rate agreement",
    severity: "error",
    sql: `SELECT COUNT(*)::int AS count FROM sales_orders
          WHERE cd_tod_rate < 0 OR cd_tod_rate > rate OR cd_amount < 0 OR tod_amount < 0
             OR NOT (
               (cd_amount + tod_amount <= 0.01 AND (cd_tod_rate = 0 OR ABS(cd_tod_rate - rate) <= 0.0001))
               OR ABS((cd_amount + tod_amount) - ((rate - cd_tod_rate) * quantity)) <= 0.021
             )`
  },
  {
    name: "ledger goods values",
    severity: "error",
    sql: `WITH order_totals AS (
            SELECT 'Purchase'::text AS side, COALESCE(cart_id, id) AS order_id,
                   CASE WHEN BOOL_AND(status = 'Cancelled') THEN 0 ELSE SUM(total_amount) END AS goods_value
            FROM purchase_orders GROUP BY COALESCE(cart_id, id)
            UNION ALL
            SELECT 'Sales'::text AS side, COALESCE(cart_id, id) AS order_id,
                   CASE WHEN BOOL_AND(status = 'Cancelled') THEN 0 ELSE SUM(total_amount + delivery_charge) END AS goods_value
            FROM sales_orders GROUP BY COALESCE(cart_id, id)
          )
          SELECT COUNT(*)::int AS count
          FROM ledger_entries ledger
          JOIN order_totals totals ON totals.side = ledger.side AND totals.order_id = ledger.linked_order_id
          WHERE ABS(ledger.goods_value - totals.goods_value) > 0.009
             OR ABS(ledger.pending_amount - (ledger.goods_value - ledger.paid_amount)) > 0.009`
  },
  {
    name: "historical sales tax inputs",
    severity: "warning",
    sql: `SELECT COUNT(*)::int AS count FROM sales_orders
          WHERE ABS(taxable_amount - ROUND((CASE WHEN tax_mode = 'Inclusive'
              THEN (quantity * rate) / (1 + gst_rate / 100)
              ELSE quantity * rate END)::numeric, 2)::double precision) > 0.021
             OR ABS(gst_amount - ROUND((CASE WHEN tax_mode = 'Inclusive'
              THEN (quantity * rate) - ((quantity * rate) / (1 + gst_rate / 100))
              ELSE (quantity * rate) * gst_rate / 100 END)::numeric, 2)::double precision) > 0.021`
  },
  {
    name: "historical purchase tax inputs",
    severity: "warning",
    sql: `SELECT COUNT(*)::int AS count FROM purchase_orders
          WHERE ABS(taxable_amount - ROUND((CASE WHEN tax_mode = 'Inclusive'
              THEN (quantity_ordered * rate) / (1 + gst_rate / 100)
              ELSE quantity_ordered * rate END)::numeric, 2)::double precision) > 0.021
             OR ABS(gst_amount - ROUND((CASE WHEN tax_mode = 'Inclusive'
              THEN (quantity_ordered * rate) - ((quantity_ordered * rate) / (1 + gst_rate / 100))
              ELSE (quantity_ordered * rate) * gst_rate / 100 END)::numeric, 2)::double precision) > 0.021`
  }
];

let failed = false;
try {
  for (const check of checks) {
    const result = await pool.query(check.sql);
    const count = Number(result.rows[0]?.count || 0);
    const label = check.severity === "warning" ? "WARN" : count === 0 ? "PASS" : "FAIL";
    console.log(`${label} ${check.name}: ${count}`);
    if (check.severity === "error" && count > 0) failed = true;
  }
} finally {
  await pool.end();
}

if (failed) process.exitCode = 1;
