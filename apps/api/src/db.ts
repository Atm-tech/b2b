import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  CounterpartyType,
  DeliveryConsignment,
  DeliveryDocket,
  DeliveryTask,
  InventoryLot,
  LedgerEntry,
  NoteRecord,
  PaymentMethodSetting,
  PaymentMode,
  PaymentRecord,
  ProductMaster,
  ProductSlab,
  PurchaseOrder,
  ReceiptCheck,
  SalesOrder,
  StockSummary,
  UserRole,
  Warehouse
} from "@aapoorti-b2b/domain";

type CurrentUser = {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  roles: UserRole[];
};

type DbClient = Pick<PoolClient, "query">;

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(sourceDir, "../../..");
const schemaSql = readFileSync(path.join(repoRoot, "postgres/init/001-schema.sql"), "utf8");
const indexSql = readFileSync(path.join(repoRoot, "postgres/init/002-indexes.sql"), "utf8");

const postgresHost = process.env.POSTGRES_HOST || "127.0.0.1";
const postgresPort = Number(process.env.POSTGRES_PORT || 5432);
const postgresDatabase = process.env.POSTGRES_DB || "aapoorti_b2b";
const postgresUser = process.env.POSTGRES_USER || "aapoorti_app";
const postgresPassword = process.env.POSTGRES_PASSWORD || "aapoorti123";

export const databasePath =
  process.env.DATABASE_URL ||
  `postgresql://${postgresUser}:${postgresPassword}@${postgresHost}:${postgresPort}/${postgresDatabase}`;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host: process.env.DATABASE_URL ? undefined : postgresHost,
  port: process.env.DATABASE_URL ? undefined : postgresPort,
  database: process.env.DATABASE_URL ? undefined : postgresDatabase,
  user: process.env.DATABASE_URL ? undefined : postgresUser,
  password: process.env.DATABASE_URL ? undefined : postgresPassword,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000)
});

const ready = initializeDatabase();

async function initializeDatabase() {
  await pool.query(schemaSql);
  await ensureCompatibilityColumns();
  await pool.query(indexSql);
  await seedDatabase();
}

async function ensureCompatibilityColumns() {
  await pool.query(`
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS location_label TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'Exclusive';
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'Exclusive';
    UPDATE purchase_orders SET taxable_amount = quantity_ordered * rate WHERE taxable_amount = 0;
    UPDATE purchase_orders SET total_amount = taxable_amount + gst_amount WHERE taxable_amount > 0 AND gst_amount > 0;
    UPDATE sales_orders SET taxable_amount = quantity * rate WHERE taxable_amount = 0;
    UPDATE sales_orders SET total_amount = taxable_amount + gst_amount WHERE taxable_amount > 0 AND gst_amount > 0;
    CREATE TABLE IF NOT EXISTS delivery_dockets (
      id TEXT PRIMARY KEY,
      sales_order_id TEXT NOT NULL,
      shop_id TEXT NOT NULL,
      product_sku TEXT NOT NULL,
      warehouse_id TEXT NOT NULL,
      quantity DOUBLE PRECISION NOT NULL,
      weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
      consignment_id TEXT,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS delivery_consignments (
      id TEXT PRIMARY KEY,
      docket_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      warehouse_id TEXT NOT NULL,
      assigned_to TEXT NOT NULL DEFAULT '',
      total_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function withTransaction<T>(run: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function query<T extends QueryResultRow>(text: string, params: unknown[] = [], client?: DbClient) {
  return (client || pool).query<T>(text, params);
}

async function one<T extends QueryResultRow>(text: string, params: unknown[] = [], client?: DbClient) {
  const result = await query<T>(text, params, client);
  return result.rows[0];
}

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function numberValue(value: unknown) {
  return Number(value || 0);
}

function stringValue(value: unknown) {
  return String(value || "");
}

function isoValue(value: unknown) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function rolesFromRow(row: Record<string, unknown>) {
  const roles = Array.isArray(row.roles_json) ? (row.roles_json as UserRole[]) : [];
  return roles.length > 0 ? roles : [String(row.role) as UserRole];
}

function defaultPaymentMethods(): PaymentMethodSetting[] {
  return [
    { code: "Cash", label: "Cash", active: true, allowsCashTiming: true },
    { code: "Card", label: "Card", active: true, allowsCashTiming: false },
    { code: "UPI", label: "UPI", active: true, allowsCashTiming: false },
    { code: "NEFT", label: "NEFT", active: true, allowsCashTiming: false },
    { code: "RTGS", label: "RTGS", active: true, allowsCashTiming: false },
    { code: "Cheque", label: "Cheque", active: false, allowsCashTiming: false }
  ];
}

async function seedDatabase() {
  const userCount = Number((await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM users"))?.count || "0");
  if (userCount === 0) {
    const createdAt = now();
    const users = [
      ["admin", "Platform Admin", "9990000001", "Admin", ["Admin"]],
      ["w", "Warehouse Manager", "9990000002", "Warehouse Manager", ["Warehouse Manager"]],
      ["p", "Purchase Manager", "9990000003", "Purchaser", ["Purchaser"]],
      ["a", "Accounts Manager", "9990000004", "Accounts", ["Accounts"]],
      ["s", "Sales Executive", "9990000005", "Sales", ["Sales"]]
    ];
    for (const [username, fullName, mobileNumber, role, rolesJson] of users) {
      await query(
        `INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, $7)`,
        [username, fullName, mobileNumber, role, JSON.stringify(rolesJson), "1234", createdAt]
      );
    }
  }

  const warehouseCount = Number((await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM warehouses"))?.count || "0");
  if (warehouseCount === 0) {
    await query(
      `INSERT INTO warehouses (id, name, city, address, type, created_at) VALUES
       ('WH-NOI-01', 'Noida Main Warehouse', 'Noida', 'Sector 63, Noida', 'Warehouse', $1),
       ('WH-GZB-02', 'Ghaziabad Bulk Yard', 'Ghaziabad', 'Industrial Belt', 'Yard', $1)`,
      [now()]
    );
  }

  const productCount = Number((await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM products"))?.count || "0");
  if (productCount === 0) {
    await upsertProduct(
      {
        sku: "AAP-CEM-43",
        name: "OPC Cement 43 Grade",
        division: "Building Material",
        department: "Cement",
        section: "Grey Cement",
        category: "Construction",
        unit: "Bag",
        defaultWeightKg: 50,
        toleranceKg: 30,
        tolerancePercent: 1.2,
        allowedWarehouseIds: ["WH-NOI-01", "WH-GZB-02"],
        slabs: [
          { minQuantity: 50, maxQuantity: 199, purchaseRate: 348 },
          { minQuantity: 200, maxQuantity: 499, purchaseRate: 341 },
          { minQuantity: 500, purchaseRate: 336 }
        ],
        createdBy: "admin",
        createdAt: now()
      },
      { id: 1, username: "admin", fullName: "Platform Admin", role: "Admin", roles: ["Admin"] }
    );
    await upsertProduct(
      {
        sku: "AAP-TMT-12",
        name: "TMT Bar 12mm",
        division: "Steel",
        department: "Rebars",
        section: "Primary Steel",
        category: "Steel",
        unit: "Ton",
        defaultWeightKg: 1000,
        toleranceKg: 60,
        tolerancePercent: 0.8,
        allowedWarehouseIds: ["WH-NOI-01", "WH-GZB-02"],
        slabs: [
          { minQuantity: 5, maxQuantity: 19, purchaseRate: 56400 },
          { minQuantity: 20, maxQuantity: 49, purchaseRate: 55750 },
          { minQuantity: 50, purchaseRate: 55100 }
        ],
        createdBy: "admin",
        createdAt: now()
      },
      { id: 1, username: "admin", fullName: "Platform Admin", role: "Admin", roles: ["Admin"] }
    );
  }

  const settingsCount = Number((await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM settings"))?.count || "0");
  if (settingsCount === 0) {
    await query(
      "INSERT INTO settings (key, value_json) VALUES ($1, $2::jsonb), ($3, $4::jsonb)",
      ["payment_methods", JSON.stringify(defaultPaymentMethods()), "delivery_charge", JSON.stringify({ model: "Fixed", amount: 350 })]
    );
  }

  await syncConfiguredOrgData();
}

async function syncConfiguredOrgData() {
  const setupVersion = "2026-04-04-user-warehouse-reset-v3";
  const existing = await one<{ value_json: string }>("SELECT value_json::text AS value_json FROM settings WHERE key = $1", ["org_setup_version"]);
  if (existing?.value_json === JSON.stringify(setupVersion)) {
    return;
  }

  await withTransaction(async (client) => {
    await query("DELETE FROM note_records", [], client);
    await query("DELETE FROM delivery_tasks", [], client);
    await query("DELETE FROM ledger_entries", [], client);
    await query("DELETE FROM inventory_lots", [], client);
    await query("DELETE FROM receipt_checks", [], client);
    await query("DELETE FROM payments", [], client);
    await query("DELETE FROM sales_orders", [], client);
    await query("DELETE FROM purchase_orders", [], client);
    await query("DELETE FROM counterparties", [], client);
    await query("DELETE FROM sessions", [], client);
    await query("DELETE FROM warehouses", [], client);
    await query("DELETE FROM users", [], client);

    const createdAt = now();
    const users = [
      ["admin", "Admin", "", "Admin", ["Admin"]],
      ["p", "Amar Purchase", "7987046155", "Purchaser", ["Purchaser"]],
      ["amas", "Amar Sales", "7987046155", "Sales", ["Sales"]],
      ["aakash", "Aakash", "8719858248", "Accounts", ["Accounts"]],
      ["aadarsh", "Aadarsh", "", "Warehouse Manager", ["Warehouse Manager"]],
      ["delivery", "Delivery", "", "Delivery", ["Delivery"]]
    ];
    for (const [username, fullName, mobileNumber, role, rolesJson] of users) {
      await query(
        `INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, $7)`,
        [username, fullName, mobileNumber, role, JSON.stringify(rolesJson), "1234", createdAt],
        client
      );
    }

    await query(
      `INSERT INTO warehouses (id, name, city, address, type, created_at) VALUES
       ('GOVINDPURA', 'Govindpura', 'Bhopal', 'Govindpura', 'Warehouse', $1),
       ('C21', 'C21', 'Bhopal', 'C21', 'Warehouse', $1)`,
      [createdAt],
      client
    );
    await query("UPDATE products SET allowed_warehouse_ids_json = $1::jsonb", [JSON.stringify(["GOVINDPURA", "C21"])], client);
    await query(
      `INSERT INTO settings (key, value_json) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
      ["org_setup_version", JSON.stringify(setupVersion)],
      client
    );
  });
}

async function mapUsers(client?: DbClient): Promise<AppUser[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM users ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: numberValue(row.id),
    username: stringValue(row.username),
    fullName: stringValue(row.full_name),
    role: stringValue(row.role) as UserRole,
    roles: rolesFromRow(row),
    mobileNumber: stringValue(row.mobile_number),
    active: Boolean(row.active),
    createdAt: isoValue(row.created_at)
  }));
}

async function mapWarehouses(client?: DbClient): Promise<Warehouse[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM warehouses ORDER BY created_at ASC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    name: stringValue(row.name),
    city: stringValue(row.city),
    address: stringValue(row.address),
    type: stringValue(row.type) as Warehouse["type"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapProducts(client?: DbClient): Promise<ProductMaster[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM products ORDER BY category, name", [], client);
  return rows.rows.map((row) => ({
    sku: stringValue(row.sku),
    name: stringValue(row.name),
    division: stringValue(row.division),
    department: stringValue(row.department),
    section: stringValue(row.section_name),
    category: stringValue(row.category),
    unit: stringValue(row.unit),
    defaultWeightKg: numberValue(row.default_weight_kg),
    toleranceKg: numberValue(row.tolerance_kg),
    tolerancePercent: numberValue(row.tolerance_percent),
    allowedWarehouseIds: Array.isArray(row.allowed_warehouse_ids_json) ? (row.allowed_warehouse_ids_json as string[]) : [],
    slabs: Array.isArray(row.slabs_json) ? (row.slabs_json as ProductSlab[]) : [],
    remarks: stringValue(row.remarks),
    category6: stringValue(row.category_6),
    siteName: stringValue(row.site_name),
    barcode: stringValue(row.barcode),
    supplierName: stringValue(row.supplier_name),
    hsnCode: stringValue(row.hsn_code),
    articleName: stringValue(row.article_name),
    itemName: stringValue(row.item_name),
    brand: stringValue(row.brand),
    shortName: stringValue(row.short_name),
    size: stringValue(row.size),
    rsp: row.rsp === null ? undefined : numberValue(row.rsp),
    mrp: row.mrp === null ? undefined : numberValue(row.mrp),
    createdBy: stringValue(row.created_by),
    createdAt: isoValue(row.created_at)
  }));
}

async function mapCounterparties(client?: DbClient): Promise<Counterparty[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM counterparties ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    type: stringValue(row.type) as CounterpartyType,
    name: stringValue(row.name),
    gstNumber: stringValue(row.gst_number),
    mobileNumber: stringValue(row.mobile_number),
    address: stringValue(row.address),
    city: stringValue(row.city),
    contactPerson: stringValue(row.contact_person),
    latitude: row.latitude === null || row.latitude === undefined ? undefined : numberValue(row.latitude),
    longitude: row.longitude === null || row.longitude === undefined ? undefined : numberValue(row.longitude),
    locationLabel: row.location_label ? stringValue(row.location_label) : undefined,
    createdBy: stringValue(row.created_by),
    createdAt: isoValue(row.created_at)
  }));
}

async function mapSettings(client?: DbClient) {
  const rows = await query<{ key: string; value_json: unknown }>("SELECT key, value_json FROM settings", [], client);
  const paymentMethods = rows.rows.find((item) => item.key === "payment_methods")?.value_json as PaymentMethodSetting[] | undefined;
  const deliveryCharge = rows.rows.find((item) => item.key === "delivery_charge")?.value_json as { model: "Fixed" | "Per Km"; amount: number } | undefined;
  return {
    paymentMethods: paymentMethods || defaultPaymentMethods(),
    deliveryCharge: deliveryCharge || { model: "Fixed", amount: 350 }
  };
}

async function mapPurchaseOrders(client?: DbClient): Promise<PurchaseOrder[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT po.*, c.name AS supplier_name, u.full_name AS purchaser_name
     FROM purchase_orders po
     LEFT JOIN counterparties c ON c.id = po.supplier_id
     LEFT JOIN users u ON u.id = po.purchaser_id
     ORDER BY po.created_at DESC`,
    [],
    client
  );
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    supplierId: stringValue(row.supplier_id),
    supplierName: stringValue(row.supplier_name),
    productSku: stringValue(row.product_sku),
    purchaserId: numberValue(row.purchaser_id),
    purchaserName: stringValue(row.purchaser_name),
    warehouseId: stringValue(row.warehouse_id),
    quantityOrdered: numberValue(row.quantity_ordered),
    quantityReceived: numberValue(row.quantity_received),
    rate: numberValue(row.rate),
    taxableAmount: numberValue(row.taxable_amount),
    gstRate: numberValue(row.gst_rate) as PurchaseOrder["gstRate"],
    gstAmount: numberValue(row.gst_amount),
    taxMode: stringValue(row.tax_mode) as PurchaseOrder["taxMode"],
    totalAmount: numberValue(row.total_amount),
    expectedWeightKg: numberValue(row.expected_weight_kg),
    deliveryMode: stringValue(row.delivery_mode) as PurchaseOrder["deliveryMode"],
    paymentMode: stringValue(row.payment_mode) as PaymentMode,
    cashTiming: row.cash_timing ? (stringValue(row.cash_timing) as PurchaseOrder["cashTiming"]) : undefined,
    note: stringValue(row.note),
    status: stringValue(row.status) as PurchaseOrder["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapSalesOrders(client?: DbClient): Promise<SalesOrder[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT so.*, c.name AS shop_name, u.full_name AS salesman_name
     FROM sales_orders so
     LEFT JOIN counterparties c ON c.id = so.shop_id
     LEFT JOIN users u ON u.id = so.salesman_id
     ORDER BY so.created_at DESC`,
    [],
    client
  );
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    shopId: stringValue(row.shop_id),
    shopName: stringValue(row.shop_name),
    productSku: stringValue(row.product_sku),
    salesmanId: numberValue(row.salesman_id),
    salesmanName: stringValue(row.salesman_name),
    warehouseId: stringValue(row.warehouse_id),
    quantity: numberValue(row.quantity),
    rate: numberValue(row.rate),
    taxableAmount: numberValue(row.taxable_amount),
    gstRate: numberValue(row.gst_rate) as SalesOrder["gstRate"],
    gstAmount: numberValue(row.gst_amount),
    taxMode: stringValue(row.tax_mode) as SalesOrder["taxMode"],
    totalAmount: numberValue(row.total_amount),
    paymentMode: stringValue(row.payment_mode) as PaymentMode,
    cashTiming: row.cash_timing ? (stringValue(row.cash_timing) as SalesOrder["cashTiming"]) : undefined,
    deliveryMode: stringValue(row.delivery_mode) as SalesOrder["deliveryMode"],
    deliveryCharge: numberValue(row.delivery_charge),
    note: stringValue(row.note),
    status: stringValue(row.status) as SalesOrder["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapPayments(client?: DbClient): Promise<PaymentRecord[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM payments ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    side: stringValue(row.side) as PaymentRecord["side"],
    linkedOrderId: stringValue(row.linked_order_id),
    amount: numberValue(row.amount),
    mode: stringValue(row.mode) as PaymentMode,
    cashTiming: row.cash_timing ? (stringValue(row.cash_timing) as PaymentRecord["cashTiming"]) : undefined,
    referenceNumber: stringValue(row.reference_number),
    voucherNumber: row.voucher_number ? stringValue(row.voucher_number) : undefined,
    utrNumber: row.utr_number ? stringValue(row.utr_number) : undefined,
    proofName: row.proof_name ? stringValue(row.proof_name) : undefined,
    verificationStatus: stringValue(row.verification_status) as PaymentRecord["verificationStatus"],
    verificationNote: stringValue(row.verification_note),
    createdBy: stringValue(row.created_by),
    verifiedBy: row.verified_by ? stringValue(row.verified_by) : undefined,
    createdAt: isoValue(row.created_at),
    submittedAt: row.submitted_at ? isoValue(row.submitted_at) : undefined
  }));
}

async function mapReceiptChecks(client?: DbClient): Promise<ReceiptCheck[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT rc.*, u.full_name AS receiver_name
     FROM receipt_checks rc
     LEFT JOIN users u ON u.id = rc.receiver_id
     ORDER BY rc.created_at DESC`,
    [],
    client
  );
  return rows.rows.map((row) => ({
    grcNumber: stringValue(row.grc_number),
    purchaseOrderId: stringValue(row.purchase_order_id),
    warehouseId: stringValue(row.warehouse_id),
    receiverId: numberValue(row.receiver_id),
    receiverName: stringValue(row.receiver_name),
    orderedQuantity: numberValue(row.ordered_quantity),
    receivedQuantity: numberValue(row.received_quantity),
    pendingQuantity: numberValue(row.pending_quantity),
    actualWeightKg: numberValue(row.actual_weight_kg),
    expectedWeightKg: numberValue(row.expected_weight_kg),
    weightVarianceKg: numberValue(row.weight_variance_kg),
    partialReceipt: Boolean(row.partial_receipt),
    flagged: Boolean(row.flagged),
    notes: Array.isArray(row.notes_json) ? (row.notes_json as string[]) : [],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapInventoryLots(client?: DbClient): Promise<InventoryLot[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM inventory_lots ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    lotId: stringValue(row.lot_id),
    sourceOrderId: stringValue(row.source_order_id),
    sourceType: stringValue(row.source_type) as InventoryLot["sourceType"],
    warehouseId: stringValue(row.warehouse_id),
    productSku: stringValue(row.product_sku),
    quantityAvailable: numberValue(row.quantity_available),
    quantityReserved: numberValue(row.quantity_reserved),
    quantityBlocked: numberValue(row.quantity_blocked),
    status: stringValue(row.status) as InventoryLot["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapLedgers(client?: DbClient): Promise<LedgerEntry[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM ledger_entries ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    side: stringValue(row.side) as LedgerEntry["side"],
    linkedOrderId: stringValue(row.linked_order_id),
    partyName: stringValue(row.party_name),
    goodsValue: numberValue(row.goods_value),
    paidAmount: numberValue(row.paid_amount),
    pendingAmount: numberValue(row.pending_amount),
    status: stringValue(row.status) as LedgerEntry["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapDeliveryTasks(client?: DbClient): Promise<DeliveryTask[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM delivery_tasks ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    side: stringValue(row.side) as DeliveryTask["side"],
    linkedOrderId: stringValue(row.linked_order_id),
    linkedOrderIds: Array.isArray(row.linked_order_ids_json) ? (row.linked_order_ids_json as string[]) : [],
    mode: stringValue(row.mode) as DeliveryTask["mode"],
    from: stringValue(row.source_location),
    to: stringValue(row.destination_location),
    assignedTo: stringValue(row.assigned_to),
    pickupAt: row.pickup_at ? isoValue(row.pickup_at) : undefined,
    dropAt: row.drop_at ? isoValue(row.drop_at) : undefined,
    routeHint: row.route_hint ? stringValue(row.route_hint) : undefined,
    paymentAction: stringValue(row.payment_action) as DeliveryTask["paymentAction"],
    cashCollectionRequired: Boolean(row.cash_collection_required),
    cashHandoverMarked: Boolean(row.cash_handover_marked),
    weightProofName: row.weight_proof_name ? stringValue(row.weight_proof_name) : undefined,
    cashProofName: row.cash_proof_name ? stringValue(row.cash_proof_name) : undefined,
    lastActionAt: row.last_action_at ? isoValue(row.last_action_at) : undefined,
    status: stringValue(row.status) as DeliveryTask["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapDeliveryDockets(client?: DbClient): Promise<DeliveryDocket[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT dd.*, c.name AS shop_name
     FROM delivery_dockets dd
     LEFT JOIN counterparties c ON c.id = dd.shop_id
     ORDER BY dd.created_at DESC`,
    [],
    client
  );
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    salesOrderId: stringValue(row.sales_order_id),
    shopId: stringValue(row.shop_id),
    shopName: stringValue(row.shop_name),
    productSku: stringValue(row.product_sku),
    warehouseId: stringValue(row.warehouse_id),
    quantity: numberValue(row.quantity),
    weightKg: numberValue(row.weight_kg),
    consignmentId: row.consignment_id ? stringValue(row.consignment_id) : undefined,
    status: stringValue(row.status) as DeliveryDocket["status"],
    createdAt: isoValue(row.created_at)
  }));
}

async function mapDeliveryConsignments(client?: DbClient): Promise<DeliveryConsignment[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM delivery_consignments ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    docketIds: Array.isArray(row.docket_ids_json) ? (row.docket_ids_json as string[]) : [],
    warehouseId: stringValue(row.warehouse_id),
    assignedTo: stringValue(row.assigned_to),
    totalWeightKg: numberValue(row.total_weight_kg),
    status: stringValue(row.status) as DeliveryConsignment["status"],
    createdBy: stringValue(row.created_by),
    createdAt: isoValue(row.created_at)
  }));
}

async function mapNotes(client?: DbClient): Promise<NoteRecord[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM note_records ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: stringValue(row.id),
    entityType: stringValue(row.entity_type) as NoteRecord["entityType"],
    entityId: stringValue(row.entity_id),
    note: stringValue(row.note),
    createdBy: stringValue(row.created_by),
    visibility: stringValue(row.visibility) as NoteRecord["visibility"],
    createdAt: isoValue(row.created_at)
  }));
}

function buildStockSummary(warehouses: Warehouse[], products: ProductMaster[], inventoryLots: InventoryLot[]): StockSummary[] {
  return warehouses.flatMap((warehouse) =>
    products
      .filter((product) => product.allowedWarehouseIds.includes(warehouse.id))
      .map((product) => {
        const matchingLots = inventoryLots.filter((lot) => lot.warehouseId === warehouse.id && lot.productSku === product.sku);
        return {
          warehouseId: warehouse.id,
          warehouseName: warehouse.name,
          productSku: product.sku,
          productName: product.name,
          availableQuantity: matchingLots.reduce((sum, lot) => sum + lot.quantityAvailable, 0),
          reservedQuantity: matchingLots.reduce((sum, lot) => sum + lot.quantityReserved, 0),
          blockedQuantity: matchingLots.reduce((sum, lot) => sum + lot.quantityBlocked, 0)
        };
      })
  );
}

async function upsertLedger(side: "Purchase" | "Sales", linkedOrderId: string, partyName: string, goodsValue: number, paidAmount: number, client?: DbClient) {
  const pendingAmount = Math.max(goodsValue - paidAmount, 0);
  const status = pendingAmount === 0 ? "Settled" : paidAmount > 0 ? "Partial" : "Pending";
  const existing = await one<{ id: string }>("SELECT id FROM ledger_entries WHERE side = $1 AND linked_order_id = $2", [side, linkedOrderId], client);
  if (existing) {
    await query(
      `UPDATE ledger_entries
       SET party_name = $1, goods_value = $2, paid_amount = $3, pending_amount = $4, status = $5
       WHERE id = $6`,
      [partyName, goodsValue, paidAmount, pendingAmount, status, existing.id],
      client
    );
    return;
  }
  await query(
    `INSERT INTO ledger_entries (id, side, linked_order_id, party_name, goods_value, paid_amount, pending_amount, status, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [makeId("LED"), side, linkedOrderId, partyName, goodsValue, paidAmount, pendingAmount, status, now()],
    client
  );
}

async function recalculateLedger(side: "Purchase" | "Sales", linkedOrderId: string, client?: DbClient) {
  const payments = await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM payments
     WHERE side = $1 AND linked_order_id = $2 AND verification_status = 'Verified'`,
    [side, linkedOrderId],
    client
  );
  const paidAmount = numberValue(payments?.paid);

  if (side === "Purchase") {
    const order = await one<Record<string, unknown>>(
      `SELECT po.*, c.name AS supplier_name
       FROM purchase_orders po
       JOIN counterparties c ON c.id = po.supplier_id
       WHERE po.id = $1`,
      [linkedOrderId],
      client
    );
    if (!order) return;
    const receivedRatio = numberValue(order.quantity_ordered) > 0 ? numberValue(order.quantity_received) / numberValue(order.quantity_ordered) : 0;
    const goodsValue = numberValue(order.total_amount) * receivedRatio;
    await upsertLedger(side, linkedOrderId, stringValue(order.supplier_name), goodsValue, paidAmount, client);
    return;
  }

  const order = await one<Record<string, unknown>>(
    `SELECT so.*, c.name AS shop_name
     FROM sales_orders so
     JOIN counterparties c ON c.id = so.shop_id
     WHERE so.id = $1`,
    [linkedOrderId],
    client
  );
  if (!order) return;
  const goodsValue = numberValue(order.total_amount) + numberValue(order.delivery_charge);
  await upsertLedger(side, linkedOrderId, stringValue(order.shop_name), goodsValue, paidAmount, client);
}

async function updateCounterpartyLocation(counterpartyId: string, location: { latitude: number; longitude: number; label?: string }, client?: DbClient) {
  await query(
    `UPDATE counterparties
     SET latitude = $1, longitude = $2, location_label = $3
     WHERE id = $4`,
    [location.latitude, location.longitude, location.label?.trim() || `${location.latitude.toFixed(6)},${location.longitude.toFixed(6)}`, counterpartyId],
    client
  );
}

function buildMetrics(snapshot: Omit<AppSnapshot, "metrics">): AppSnapshot["metrics"] {
  return {
    productCount: snapshot.products.length,
    partyCount: snapshot.counterparties.length,
    activeUsers: snapshot.users.filter((item) => item.active).length,
    pendingPurchasePayments: snapshot.ledgerEntries.filter((item) => item.side === "Purchase" && item.pendingAmount > 0).length,
    pendingSalesPayments: snapshot.ledgerEntries.filter((item) => item.side === "Sales" && item.pendingAmount > 0).length,
    partialReceipts: snapshot.receiptChecks.filter((item) => item.partialReceipt).length,
    flaggedReceipts: snapshot.receiptChecks.filter((item) => item.flagged).length,
    availableInventoryUnits: snapshot.inventoryLots.reduce((sum, item) => sum + item.quantityAvailable, 0),
    openSalesOrders: snapshot.salesOrders.filter((item) => item.status !== "Closed" && item.status !== "Delivered").length,
    liveDeliveryTasks: snapshot.deliveryTasks.filter((item) => item.status !== "Delivered").length
  };
}

export async function getSnapshot(): Promise<AppSnapshot> {
  await ready;
  const [users, warehouses, products, counterparties, purchaseOrders, salesOrders, payments, receiptChecks, inventoryLots, ledgerEntries, deliveryTasks, deliveryDockets, deliveryConsignments, notes, settings] = await Promise.all([
    mapUsers(),
    mapWarehouses(),
    mapProducts(),
    mapCounterparties(),
    mapPurchaseOrders(),
    mapSalesOrders(),
    mapPayments(),
    mapReceiptChecks(),
    mapInventoryLots(),
    mapLedgers(),
    mapDeliveryTasks(),
    mapDeliveryDockets(),
    mapDeliveryConsignments(),
    mapNotes(),
    mapSettings()
  ]);
  const stockSummary = buildStockSummary(warehouses, products, inventoryLots);
  const snapshotWithoutMetrics = {
    settings,
    users,
    warehouses,
    products,
    counterparties,
    purchaseOrders,
    salesOrders,
    payments,
    receiptChecks,
    inventoryLots,
    stockSummary,
    ledgerEntries,
    deliveryTasks,
    deliveryDockets,
    deliveryConsignments,
    notes
  };
  return {
    metrics: buildMetrics(snapshotWithoutMetrics),
    ...snapshotWithoutMetrics
  };
}

export async function authenticate(username: string, password: string) {
  await ready;
  const row = await one<Record<string, unknown>>(
    "SELECT * FROM users WHERE username = $1 AND password = $2 AND active = TRUE",
    [username.trim(), password]
  );
  if (!row) return null;
  return {
    id: numberValue(row.id),
    username: stringValue(row.username),
    fullName: stringValue(row.full_name),
    role: stringValue(row.role) as UserRole,
    roles: rolesFromRow(row),
    mobileNumber: stringValue(row.mobile_number),
    active: Boolean(row.active),
    createdAt: isoValue(row.created_at)
  } satisfies AppUser;
}

export async function createSessionForUser(userId: number) {
  await ready;
  const token = randomUUID();
  await query("INSERT INTO sessions (token, user_id, created_at) VALUES ($1, $2, $3)", [token, userId, now()]);
  return token;
}

export async function getUserBySessionToken(token: string) {
  await ready;
  const row = await one<Record<string, unknown>>(
    `SELECT u.*
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1`,
    [token]
  );
  if (!row) return null;
  return {
    id: numberValue(row.id),
    username: stringValue(row.username),
    fullName: stringValue(row.full_name),
    role: stringValue(row.role) as UserRole,
    roles: rolesFromRow(row),
    mobileNumber: stringValue(row.mobile_number),
    active: Boolean(row.active),
    createdAt: isoValue(row.created_at)
  } satisfies AppUser;
}

export async function deleteSession(token: string) {
  await ready;
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function createUser(payload: { username: string; fullName: string; mobileNumber: string; role?: UserRole; roles?: UserRole[]; password?: string }) {
  await ready;
  const roles = payload.roles && payload.roles.length > 0 ? payload.roles : [payload.role || "Purchaser"];
  await query(
    `INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, TRUE, $7)`,
    [payload.username.trim(), payload.fullName.trim(), payload.mobileNumber.trim(), roles[0], JSON.stringify(roles), payload.password?.trim() || "1234", now()]
  );
  return getSnapshot();
}

export async function createWarehouse(payload: { id: string; name: string; city: string; address: string; type: Warehouse["type"] }) {
  await ready;
  await query(
    `INSERT INTO warehouses (id, name, city, address, type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address, type = EXCLUDED.type`,
    [payload.id.trim(), payload.name.trim(), payload.city.trim(), payload.address.trim(), payload.type, now()]
  );
  return getSnapshot();
}

async function upsertProduct(payload: Omit<ProductMaster, "createdBy" | "createdAt"> & { createdBy: string; createdAt: string }, currentUser: CurrentUser) {
  await query(
    `INSERT INTO products (
      sku, name, division, department, section_name, category, unit, default_weight_kg, tolerance_kg, tolerance_percent,
      allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode, supplier_name, hsn_code,
      article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
      $11::jsonb, $12::jsonb, $13, $14, $15, $16, $17, $18,
      $19, $20, $21, $22, $23, $24, $25, $26, $27
    )
    ON CONFLICT (sku) DO UPDATE SET
      name = EXCLUDED.name,
      division = EXCLUDED.division,
      department = EXCLUDED.department,
      section_name = EXCLUDED.section_name,
      category = EXCLUDED.category,
      unit = EXCLUDED.unit,
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
      created_by = EXCLUDED.created_by`,
    [
      payload.sku.trim(),
      payload.name.trim(),
      payload.division.trim(),
      payload.department.trim(),
      payload.section.trim(),
      payload.category.trim(),
      payload.unit.trim(),
      payload.defaultWeightKg,
      payload.toleranceKg,
      payload.tolerancePercent,
      JSON.stringify(payload.allowedWarehouseIds),
      JSON.stringify(payload.slabs),
      payload.remarks?.trim() || "",
      payload.category6?.trim() || "",
      payload.siteName?.trim() || "",
      payload.barcode?.trim() || "",
      payload.supplierName?.trim() || "",
      payload.hsnCode?.trim() || "",
      payload.articleName?.trim() || "",
      payload.itemName?.trim() || "",
      payload.brand?.trim() || "",
      payload.shortName?.trim() || "",
      payload.size?.trim() || "",
      payload.rsp ?? null,
      payload.mrp ?? null,
      currentUser.username,
      payload.createdAt || now()
    ]
  );
}

export async function createProduct(payload: Omit<ProductMaster, "createdBy" | "createdAt">, currentUser: CurrentUser) {
  await ready;
  await upsertProduct({ ...payload, createdBy: currentUser.username, createdAt: now() }, currentUser);
  return getSnapshot();
}

export async function bulkCreateProducts(rows: Array<Omit<ProductMaster, "createdBy" | "createdAt">>, currentUser: CurrentUser) {
  await ready;
  for (const row of rows) {
    await upsertProduct({ ...row, createdBy: currentUser.username, createdAt: now() }, currentUser);
  }
  return getSnapshot();
}

export async function createCounterparty(payload: Omit<Counterparty, "id" | "createdBy" | "createdAt">, currentUser: CurrentUser) {
  await ready;
  await query(
    `INSERT INTO counterparties (id, type, name, gst_number, mobile_number, address, city, contact_person, latitude, longitude, location_label, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [makeId(payload.type === "Supplier" ? "SUP" : "SHP"), payload.type, payload.name.trim(), payload.gstNumber.trim(), payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), payload.latitude ?? null, payload.longitude ?? null, payload.locationLabel?.trim() || null, currentUser.username, now()]
  );
  return getSnapshot();
}

export async function updateSettings(payload: { paymentMethods: PaymentMethodSetting[]; deliveryCharge: { model: "Fixed" | "Per Km"; amount: number } }) {
  await ready;
  await query(
    `INSERT INTO settings (key, value_json) VALUES ($1, $2::jsonb), ($3, $4::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json`,
    ["payment_methods", JSON.stringify(payload.paymentMethods), "delivery_charge", JSON.stringify(payload.deliveryCharge)]
  );
  return getSnapshot();
}

export async function createPurchaseOrder(payload: {
  supplierId: string;
  productSku: string;
  warehouseId: string;
  quantityOrdered: number;
  rate: number;
  taxableAmount?: number;
  gstRate?: PurchaseOrder["gstRate"];
  gstAmount?: number;
  taxMode?: PurchaseOrder["taxMode"];
  previousRate?: number;
  deliveryMode: PurchaseOrder["deliveryMode"];
  paymentMode: PaymentMode;
  cashTiming?: PurchaseOrder["cashTiming"];
  note: string;
  location?: { latitude: number; longitude: number; label?: string };
}, currentUser: CurrentUser) {
  await ready;
  const product = await one<Record<string, unknown>>("SELECT * FROM products WHERE sku = $1", [payload.productSku]);
  if (!product) throw new Error("Product not found.");
  const baseAmount = payload.quantityOrdered * payload.rate;
  const taxableAmount = payload.taxableAmount ?? baseAmount;
  const gstRate = payload.gstRate ?? 0;
  const gstAmount = payload.gstAmount ?? 0;
  const taxMode = payload.taxMode || "Exclusive";
  const totalAmount = taxableAmount + gstAmount;
  const expectedWeightKg = payload.quantityOrdered * numberValue(product.default_weight_kg);
  const id = makeId("PO");
  const rateAlertNote =
    typeof payload.previousRate === "number" && payload.previousRate > 0 && payload.rate > payload.previousRate
      ? `Rate alert: entered purchase rate ${payload.rate} is higher than last purchase rate ${payload.previousRate} for ${payload.productSku}. Confirmed by ${currentUser.fullName}.`
      : "";
  const combinedNote = [payload.note.trim(), rateAlertNote].filter(Boolean).join(" | ");

  await withTransaction(async (client) => {
    if (payload.location) {
      await updateCounterpartyLocation(payload.supplierId, payload.location, client);
    }
    await query(
      `INSERT INTO purchase_orders (
        id, supplier_id, product_sku, purchaser_id, warehouse_id, quantity_ordered, quantity_received, rate, taxable_amount, gst_rate, gst_amount, tax_mode, total_amount,
        expected_weight_kg, delivery_mode, payment_mode, cash_timing, note, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [id, payload.supplierId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantityOrdered, payload.rate, taxableAmount, gstRate, gstAmount, taxMode, totalAmount, expectedWeightKg, payload.deliveryMode, payload.paymentMode, payload.cashTiming || null, combinedNote, "Pending Payment", now()],
      client
    );
    if (rateAlertNote) {
      await query(
        `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [makeId("NOTE"), "Purchase Order", id, rateAlertNote, currentUser.fullName, "Operational", now()],
        client
      );
    }
    await recalculateLedger("Purchase", id, client);
  });

  return getSnapshot();
}

export async function createSalesOrder(payload: {
  shopId: string;
  productSku: string;
  warehouseId: string;
  quantity: number;
  rate: number;
  taxableAmount?: number;
  gstRate?: SalesOrder["gstRate"];
  gstAmount?: number;
  taxMode?: SalesOrder["taxMode"];
  minimumAllowedRate?: number;
  priceApprovalRequested?: boolean;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
  location?: { latitude: number; longitude: number; label?: string };
}, currentUser: CurrentUser) {
  await ready;
  const settings = await mapSettings();
  const id = makeId("SO");
  const needsPriceApproval = Boolean(payload.priceApprovalRequested) && typeof payload.minimumAllowedRate === "number" && payload.rate < payload.minimumAllowedRate;
  const approvalNote = needsPriceApproval
    ? `Admin approval requested: sales rate ${payload.rate} is below last purchase price ${payload.minimumAllowedRate} for ${payload.productSku}. Requested by ${currentUser.fullName}.`
    : "";

  await withTransaction(async (client) => {
    if (payload.location) {
      await updateCounterpartyLocation(payload.shopId, payload.location, client);
    }
    const product = await one<Record<string, unknown>>("SELECT * FROM products WHERE sku = $1", [payload.productSku], client);
    const stock = buildStockSummary(await mapWarehouses(client), await mapProducts(client), await mapInventoryLots(client)).find(
      (item) => item.warehouseId === payload.warehouseId && item.productSku === payload.productSku
    );
    if (!stock || stock.availableQuantity < payload.quantity) {
      throw new Error("Not enough stock available.");
    }
    const deliveryCharge = payload.deliveryMode === "Delivery" ? settings.deliveryCharge.amount : 0;
    const baseAmount = payload.quantity * payload.rate;
    const taxableAmount = payload.taxableAmount ?? baseAmount;
    const gstRate = payload.gstRate ?? 0;
    const gstAmount = payload.gstAmount ?? 0;
    const taxMode = payload.taxMode || "Exclusive";
    const totalAmount = taxableAmount + gstAmount;
    const docketWeightKg = numberValue(product?.default_weight_kg) * payload.quantity;
    await query(
      `INSERT INTO sales_orders (
        id, shop_id, product_sku, salesman_id, warehouse_id, quantity, rate, taxable_amount, gst_rate, gst_amount, tax_mode, total_amount, payment_mode, cash_timing,
        delivery_mode, delivery_charge, note, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [id, payload.shopId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantity, payload.rate, taxableAmount, gstRate, gstAmount, taxMode, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, deliveryCharge, [payload.note.trim(), approvalNote].filter(Boolean).join(" | "), needsPriceApproval ? "Draft" : (payload.deliveryMode === "Self Collection" ? "Self Pickup" : "Booked"), now()],
      client
    );
    if (needsPriceApproval) {
      await query(
        `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
         VALUES ($1, 'Sales Order', $2, $3, $4, 'Management', $5)`,
        [makeId("NOTE"), id, approvalNote, currentUser.fullName, now()],
        client
      );
      return;
    }
    await query(
      `INSERT INTO delivery_dockets (id, sales_order_id, shop_id, product_sku, warehouse_id, quantity, weight_kg, consignment_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
      [makeId("DCK"), id, payload.shopId, payload.productSku, payload.warehouseId, payload.quantity, docketWeightKg, payload.deliveryMode === "Delivery" ? "Pending Packing" : "Ready", now()],
      client
    );
    await reserveInventory(payload.warehouseId, payload.productSku, payload.quantity, client);
    await recalculateLedger("Sales", id, client);
  });

  return getSnapshot();
}

async function reserveInventory(warehouseId: string, productSku: string, quantity: number, client: DbClient) {
  const lots = await query<Record<string, unknown>>(
    `SELECT * FROM inventory_lots
     WHERE warehouse_id = $1 AND product_sku = $2 AND quantity_available > 0
     ORDER BY created_at ASC`,
    [warehouseId, productSku],
    client
  );
  let remaining = quantity;
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const available = numberValue(lot.quantity_available);
    const move = Math.min(available, remaining);
    await query(
      `UPDATE inventory_lots
       SET quantity_available = $1, quantity_reserved = $2, status = $3
       WHERE lot_id = $4`,
      [available - move, numberValue(lot.quantity_reserved) + move, "Reserved", stringValue(lot.lot_id)],
      client
    );
    remaining -= move;
  }
}

export async function createPayment(payload: {
  side: "Purchase" | "Sales";
  linkedOrderId: string;
  amount: number;
  mode: PaymentMode;
  cashTiming?: PaymentRecord["cashTiming"];
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: PaymentRecord["verificationStatus"];
  verificationNote?: string;
}, currentUser: CurrentUser) {
  await ready;
  const submittedAt = payload.verificationStatus === "Submitted" ? now() : null;
  await withTransaction(async (client) => {
    await query(
      `INSERT INTO payments (
        id, side, linked_order_id, amount, mode, cash_timing, reference_number, voucher_number, utr_number,
        proof_name, verification_status, verification_note, created_by, verified_by, created_at, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
      [
        makeId("PAY"),
        payload.side,
        payload.linkedOrderId,
        payload.amount,
        payload.mode,
        payload.cashTiming || null,
        payload.referenceNumber.trim(),
        payload.voucherNumber?.trim() || null,
        payload.utrNumber?.trim() || null,
        payload.proofName?.trim() || null,
        payload.verificationStatus,
        payload.verificationNote?.trim() || "",
        currentUser.fullName,
        payload.verificationStatus === "Verified" ? currentUser.fullName : null,
        now(),
        submittedAt
      ],
      client
    );
    if (payload.verificationStatus === "Verified") {
      await recalculateLedger(payload.side, payload.linkedOrderId, client);
    }
  });
  return getSnapshot();
}

export async function verifyPayment(paymentId: string, status: PaymentRecord["verificationStatus"], note: string, currentUser: CurrentUser) {
  await ready;
  return withTransaction(async (client) => {
    const payment = await one<Record<string, unknown>>("SELECT * FROM payments WHERE id = $1", [paymentId], client);
    if (!payment) throw new Error("Payment not found.");
    if (status === "Verified" && currentUser.roles.includes("Accounts") && !stringValue(payment.reference_number).trim()) {
      throw new Error("Reference number is required before accounts can complete a payment.");
    }
    await query(
      "UPDATE payments SET verification_status = $1, verification_note = $2, verified_by = $3 WHERE id = $4",
      [status, note.trim(), currentUser.fullName, paymentId],
      client
    );
    if (status === "Verified") {
      await recalculateLedger(stringValue(payment.side) as "Purchase" | "Sales", stringValue(payment.linked_order_id), client);
    }
    return getSnapshot();
  });
}

export async function createReceiptCheck(payload: {
  purchaseOrderId: string;
  warehouseId: string;
  receivedQuantity: number;
  actualWeightKg: number;
  note: string;
  confirmPartial: boolean;
}, currentUser: CurrentUser) {
  await ready;
  return withTransaction(async (client) => {
    const order = await one<Record<string, unknown>>("SELECT * FROM purchase_orders WHERE id = $1", [payload.purchaseOrderId], client);
    if (!order) throw new Error("Purchase order not found.");
    const product = await one<Record<string, unknown>>("SELECT * FROM products WHERE sku = $1", [stringValue(order.product_sku)], client);
    if (!product) throw new Error("Product not found.");

    const orderedQuantity = numberValue(order.quantity_ordered);
    const totalReceivedBefore = numberValue(order.quantity_received);
    const totalReceivedNow = totalReceivedBefore + payload.receivedQuantity;
    const pendingQuantity = Math.max(orderedQuantity - totalReceivedNow, 0);
    const partialReceipt = pendingQuantity > 0;
    if (partialReceipt && !payload.confirmPartial) {
      throw new Error("Confirm partial receipt before saving.");
    }
    const expectedWeightKg = payload.receivedQuantity * numberValue(product.default_weight_kg);
    const toleranceByPercent = (expectedWeightKg * numberValue(product.tolerance_percent)) / 100;
    const allowedVariance = Math.max(numberValue(product.tolerance_kg), toleranceByPercent);
    const weightVarianceKg = payload.actualWeightKg - expectedWeightKg;
    const flagged = Math.abs(weightVarianceKg) > allowedVariance || partialReceipt;

    await query(
      `INSERT INTO receipt_checks (
        grc_number, purchase_order_id, warehouse_id, receiver_id, ordered_quantity, received_quantity, pending_quantity,
        actual_weight_kg, expected_weight_kg, weight_variance_kg, partial_receipt, flagged, notes_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)`,
      [makeId("GRC"), payload.purchaseOrderId, payload.warehouseId, currentUser.id, orderedQuantity, payload.receivedQuantity, pendingQuantity, payload.actualWeightKg, expectedWeightKg, weightVarianceKg, partialReceipt, flagged, JSON.stringify([payload.note.trim()]), now()],
      client
    );

    await query(
      "UPDATE purchase_orders SET quantity_received = $1, status = $2 WHERE id = $3",
      [totalReceivedNow, partialReceipt ? "Partially Received" : "Received", payload.purchaseOrderId],
      client
    );
    await query(
      `INSERT INTO inventory_lots (
        lot_id, source_order_id, source_type, warehouse_id, product_sku, quantity_available, quantity_reserved, quantity_blocked, status, created_at
      ) VALUES ($1, $2, 'Purchase', $3, $4, $5, 0, $6, $7, $8)`,
      [makeId("LOT"), payload.purchaseOrderId, payload.warehouseId, stringValue(order.product_sku), flagged ? 0 : payload.receivedQuantity, flagged ? payload.receivedQuantity : 0, flagged ? "Blocked" : "Available", now()],
      client
    );
    await recalculateLedger("Purchase", payload.purchaseOrderId, client);
    return getSnapshot();
  });
}

export async function createDeliveryTask(payload: {
  side: DeliveryTask["side"];
  linkedOrderId: string;
  linkedOrderIds?: string[];
  mode: DeliveryTask["mode"];
  from: string;
  to: string;
  assignedTo: string;
  pickupAt?: string;
  dropAt?: string;
  routeHint?: string;
  paymentAction?: DeliveryTask["paymentAction"];
  cashCollectionRequired: boolean;
  cashHandoverMarked?: boolean;
  weightProofName?: string;
  cashProofName?: string;
  lastActionAt?: string;
  status: DeliveryTask["status"];
}) {
  await ready;
  await query(
    `INSERT INTO delivery_tasks (
      id, side, linked_order_id, linked_order_ids_json, mode, source_location, destination_location, assigned_to,
      pickup_at, drop_at, route_hint, payment_action, cash_collection_required, cash_handover_marked,
      weight_proof_name, cash_proof_name, last_action_at, status, created_at
    ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
    [
      makeId("DL"),
      payload.side,
      payload.linkedOrderId.trim(),
      JSON.stringify(payload.linkedOrderIds && payload.linkedOrderIds.length > 0 ? payload.linkedOrderIds : [payload.linkedOrderId.trim()]),
      payload.mode,
      payload.from.trim(),
      payload.to.trim(),
      payload.assignedTo.trim(),
      payload.pickupAt || null,
      payload.dropAt || null,
      payload.routeHint?.trim() || null,
      payload.paymentAction || "None",
      payload.cashCollectionRequired,
      payload.cashHandoverMarked || false,
      payload.weightProofName?.trim() || null,
      payload.cashProofName?.trim() || null,
      payload.lastActionAt || null,
      payload.status,
      now()
    ]
  );
  return getSnapshot();
}

export async function createDeliveryConsignment(payload: {
  docketIds: string[];
  warehouseId: string;
  assignedTo: string;
  status?: DeliveryConsignment["status"];
}, currentUser: CurrentUser) {
  await ready;
  const docketIds = payload.docketIds.map((item) => item.trim()).filter(Boolean);
  if (docketIds.length === 0) throw new Error("Select at least one docket.");
  const dockets = await query<Record<string, unknown>>(
    "SELECT * FROM delivery_dockets WHERE id = ANY($1::text[])",
    [docketIds]
  );
  if (dockets.rows.length !== docketIds.length) throw new Error("One or more dockets were not found.");
  const mismatchedWarehouse = dockets.rows.some((row) => stringValue(row.warehouse_id) !== payload.warehouseId);
  if (mismatchedWarehouse) throw new Error("All dockets must belong to the selected warehouse.");
  const totalWeightKg = dockets.rows.reduce((sum, row) => sum + numberValue(row.weight_kg), 0);
  const id = makeId("CON");
  await withTransaction(async (client) => {
    await query(
      `INSERT INTO delivery_consignments (id, docket_ids_json, warehouse_id, assigned_to, total_weight_kg, status, created_by, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)`,
      [id, JSON.stringify(docketIds), payload.warehouseId, payload.assignedTo.trim(), totalWeightKg, payload.status || "Ready", currentUser.fullName, now()],
      client
    );
    await query(
      `UPDATE delivery_dockets
       SET consignment_id = $1, status = 'Tagged'
       WHERE id = ANY($2::text[])`,
      [id, docketIds],
      client
    );
  });
  return getSnapshot();
}

export async function createNote(payload: {
  entityType: NoteRecord["entityType"];
  entityId: string;
  note: string;
  visibility: NoteRecord["visibility"];
}, currentUser: CurrentUser) {
  await ready;
  await query(
    `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [makeId("NOTE"), payload.entityType, payload.entityId.trim(), payload.note.trim(), currentUser.fullName, payload.visibility, now()]
  );
  return getSnapshot();
}

export async function updateCounterparty(counterpartyId: string, payload: {
  name: string;
  gstNumber: string;
  mobileNumber: string;
  address: string;
  city: string;
  contactPerson: string;
}) {
  await ready;
  await query(
    `UPDATE counterparties
     SET name = $1, gst_number = $2, mobile_number = $3, address = $4, city = $5, contact_person = $6
     WHERE id = $7`,
    [payload.name.trim(), payload.gstNumber.trim(), payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), counterpartyId]
  );
  return getSnapshot();
}

export async function updatePurchaseOrder(orderId: string, payload: {
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: PurchaseOrder["cashTiming"];
  deliveryMode: PurchaseOrder["deliveryMode"];
  note: string;
  status: PurchaseOrder["status"];
}) {
  await ready;
  const order = await one<Record<string, unknown>>("SELECT * FROM purchase_orders WHERE id = $1", [orderId]);
  if (!order) throw new Error("Purchase order not found.");
  const quantityOrdered = numberValue(order.quantity_ordered);
  const totalAmount = quantityOrdered * payload.rate;
  await query(
    `UPDATE purchase_orders
     SET rate = $1, total_amount = $2, payment_mode = $3, cash_timing = $4, delivery_mode = $5, note = $6, status = $7
     WHERE id = $8`,
    [payload.rate, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, payload.note.trim(), payload.status, orderId]
  );
  await recalculateLedger("Purchase", orderId);
  return getSnapshot();
}

export async function updateSalesOrder(orderId: string, payload: {
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
  status: SalesOrder["status"];
}) {
  await ready;
  const order = await one<Record<string, unknown>>("SELECT * FROM sales_orders WHERE id = $1", [orderId]);
  if (!order) throw new Error("Sales order not found.");
  const settings = await mapSettings();
  const quantity = numberValue(order.quantity);
  const totalAmount = quantity * payload.rate;
  const deliveryCharge = payload.deliveryMode === "Delivery" ? settings.deliveryCharge.amount : 0;
  await query(
    `UPDATE sales_orders
     SET rate = $1, total_amount = $2, payment_mode = $3, cash_timing = $4, delivery_mode = $5, delivery_charge = $6, note = $7, status = $8
     WHERE id = $9`,
    [payload.rate, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, deliveryCharge, payload.note.trim(), payload.status, orderId]
  );
  await recalculateLedger("Sales", orderId);
  return getSnapshot();
}

export async function updatePayment(paymentId: string, payload: {
  amount: number;
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: PaymentRecord["verificationStatus"];
  verificationNote: string;
}, currentUser: CurrentUser) {
  await ready;
  const payment = await one<Record<string, unknown>>("SELECT * FROM payments WHERE id = $1", [paymentId]);
  if (!payment) throw new Error("Payment not found.");
  await query(
    `UPDATE payments
     SET amount = $1, reference_number = $2, voucher_number = $3, utr_number = $4, proof_name = $5, verification_status = $6,
         verification_note = $7, verified_by = $8, submitted_at = $9
     WHERE id = $10`,
    [
      payload.amount,
      payload.referenceNumber.trim(),
      payload.voucherNumber?.trim() || null,
      payload.utrNumber?.trim() || null,
      payload.proofName?.trim() || null,
      payload.verificationStatus,
      payload.verificationNote.trim(),
      payload.verificationStatus === "Verified" ? currentUser.fullName : null,
      payload.verificationStatus === "Submitted" ? now() : null,
      paymentId
    ]
  );
  await recalculateLedger(stringValue(payment.side) as "Purchase" | "Sales", stringValue(payment.linked_order_id));
  return getSnapshot();
}

export async function updateReceiptCheck(grcNumber: string, payload: {
  note: string;
  flagged: boolean;
}) {
  await ready;
  const receipt = await one<Record<string, unknown>>("SELECT * FROM receipt_checks WHERE grc_number = $1", [grcNumber]);
  if (!receipt) throw new Error("Receipt check not found.");
  const notes = Array.isArray(receipt.notes_json) ? (receipt.notes_json as string[]) : [];
  await query(
    "UPDATE receipt_checks SET flagged = $1, notes_json = $2::jsonb WHERE grc_number = $3",
    [payload.flagged, JSON.stringify([...notes, payload.note.trim()].filter(Boolean)), grcNumber]
  );
  return getSnapshot();
}

export async function updateDeliveryTask(taskId: string, payload: {
  linkedOrderIds?: string[];
  assignedTo: string;
  pickupAt?: string;
  dropAt?: string;
  routeHint?: string;
  paymentAction?: DeliveryTask["paymentAction"];
  status: DeliveryTask["status"];
  cashCollectionRequired: boolean;
  cashHandoverMarked?: boolean;
  weightProofName?: string;
  cashProofName?: string;
  lastActionAt?: string;
}) {
  await ready;
  await query(
    `UPDATE delivery_tasks
     SET linked_order_ids_json = $1::jsonb, assigned_to = $2, pickup_at = $3, drop_at = $4, route_hint = $5, payment_action = $6,
         status = $7, cash_collection_required = $8, cash_handover_marked = $9, weight_proof_name = $10, cash_proof_name = $11, last_action_at = $12
     WHERE id = $13`,
    [
      JSON.stringify(payload.linkedOrderIds || []),
      payload.assignedTo.trim(),
      payload.pickupAt || null,
      payload.dropAt || null,
      payload.routeHint?.trim() || null,
      payload.paymentAction || "None",
      payload.status,
      payload.cashCollectionRequired,
      payload.cashHandoverMarked || false,
      payload.weightProofName?.trim() || null,
      payload.cashProofName?.trim() || null,
      payload.lastActionAt || now(),
      taskId
    ]
  );
  return getSnapshot();
}
