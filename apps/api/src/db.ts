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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS warehouse_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS default_gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS default_tax_mode TEXT NOT NULL DEFAULT 'Exclusive';
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;
    ALTER TABLE counterparties ADD COLUMN IF NOT EXISTS location_label TEXT;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'Exclusive';
    ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cart_id TEXT;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS taxable_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS gst_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS gst_amount DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS tax_mode TEXT NOT NULL DEFAULT 'Exclusive';
    ALTER TABLE sales_orders ADD COLUMN IF NOT EXISTS cart_id TEXT;
    ALTER TABLE receipt_checks ADD COLUMN IF NOT EXISTS container_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE receipt_checks ADD COLUMN IF NOT EXISTS net_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE receipt_checks ADD COLUMN IF NOT EXISTS weighing_proof_name TEXT;
    UPDATE receipt_checks SET net_weight_kg = actual_weight_kg - container_weight_kg WHERE net_weight_kg = 0;
    ALTER TABLE delivery_dockets ADD COLUMN IF NOT EXISTS container_weight_kg DOUBLE PRECISION NOT NULL DEFAULT 0;
    ALTER TABLE delivery_dockets ADD COLUMN IF NOT EXISTS weighing_proof_name TEXT;
    ALTER TABLE delivery_tasks ADD COLUMN IF NOT EXISTS route_json JSONB NOT NULL DEFAULT '[]'::jsonb;
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

function operationalDate(value?: string) {
  const text = String(value || "").trim();
  if (!text) return now();
  const dateOnly = text.match(/^\d{4}-\d{2}-\d{2}$/) ? `${text}T12:00:00.000Z` : text;
  const date = new Date(dateOnly);
  return Number.isNaN(date.getTime()) ? now() : date.toISOString();
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
  const settingsCount = Number((await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM settings"))?.count || "0");
  if (settingsCount === 0) {
    await query(
      "INSERT INTO settings (key, value_json) VALUES ($1, $2::jsonb), ($3, $4::jsonb)",
      ["payment_methods", JSON.stringify(defaultPaymentMethods()), "delivery_charge", JSON.stringify({ model: "Fixed", amount: 350 })]
    );
  }
}

async function mapUsers(client?: DbClient): Promise<AppUser[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM users ORDER BY created_at DESC", [], client);
  return rows.rows.map((row) => ({
    id: numberValue(row.id),
    username: stringValue(row.username),
    fullName: stringValue(row.full_name),
    role: stringValue(row.role) as UserRole,
    roles: rolesFromRow(row),
    warehouseIds: Array.isArray(row.warehouse_ids_json) ? (row.warehouse_ids_json as string[]) : [],
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
    defaultGstRate: stringValue(row.default_tax_mode) === "NA" ? "NA" : numberValue(row.default_gst_rate) as ProductMaster["defaultGstRate"],
    defaultTaxMode: stringValue(row.default_tax_mode) as ProductMaster["defaultTaxMode"],
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
    cartId: row.cart_id ? stringValue(row.cart_id) : undefined,
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
    gstRate: stringValue(row.tax_mode) === "NA" ? "NA" : numberValue(row.gst_rate) as PurchaseOrder["gstRate"],
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
    cartId: row.cart_id ? stringValue(row.cart_id) : undefined,
    shopId: stringValue(row.shop_id),
    shopName: stringValue(row.shop_name),
    productSku: stringValue(row.product_sku),
    salesmanId: numberValue(row.salesman_id),
    salesmanName: stringValue(row.salesman_name),
    warehouseId: stringValue(row.warehouse_id),
    quantity: numberValue(row.quantity),
    rate: numberValue(row.rate),
    taxableAmount: numberValue(row.taxable_amount),
    gstRate: stringValue(row.tax_mode) === "NA" ? "NA" : numberValue(row.gst_rate) as SalesOrder["gstRate"],
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
    containerWeightKg: numberValue(row.container_weight_kg),
    netWeightKg: numberValue(row.net_weight_kg) || numberValue(row.actual_weight_kg) - numberValue(row.container_weight_kg),
    weighingProofName: row.weighing_proof_name ? stringValue(row.weighing_proof_name) : undefined,
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
    routeStops: Array.isArray(row.route_json) ? (row.route_json as DeliveryTask["routeStops"]) : [],
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
    containerWeightKg: numberValue(row.container_weight_kg),
    weighingProofName: row.weighing_proof_name ? stringValue(row.weighing_proof_name) : undefined,
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

async function upsertLedger(side: "Purchase" | "Sales", linkedOrderId: string, partyName: string, goodsValue: number, paidAmount: number, client?: DbClient, createdAt = now()) {
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
    [makeId("LED"), side, linkedOrderId, partyName, goodsValue, paidAmount, pendingAmount, status, createdAt],
    client
  );
}

async function recalculateLedger(side: "Purchase" | "Sales", linkedOrderId: string, client?: DbClient) {
  const payments = await one<{ paid: number }>(
    `SELECT COALESCE(SUM(amount), 0) AS paid
     FROM payments
     WHERE side = $1 AND linked_order_id = $2 AND verification_status IN ('Verified', 'Resolved')`,
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
    if (!order) {
      const cart = await one<Record<string, unknown>>(
        `SELECT po.cart_id, MIN(po.created_at) AS created_at, MAX(c.name) AS supplier_name,
                SUM(po.total_amount) AS total_amount,
                SUM(CASE WHEN po.quantity_ordered > 0 THEN po.total_amount * (po.quantity_received / po.quantity_ordered) ELSE 0 END) AS received_value
         FROM purchase_orders po
         JOIN counterparties c ON c.id = po.supplier_id
         WHERE po.cart_id = $1
         GROUP BY po.cart_id`,
        [linkedOrderId],
        client
      );
      if (!cart) return;
      const goodsValue = paidAmount > 0 ? numberValue(cart.total_amount) : numberValue(cart.received_value);
      await upsertLedger(side, linkedOrderId, stringValue(cart.supplier_name), goodsValue, paidAmount, client, isoValue(cart.created_at) || now());
      return;
    }
    const receivedRatio = numberValue(order.quantity_ordered) > 0 ? numberValue(order.quantity_received) / numberValue(order.quantity_ordered) : 0;
    const goodsValue = paidAmount > 0 ? numberValue(order.total_amount) : numberValue(order.total_amount) * receivedRatio;
    await upsertLedger(side, linkedOrderId, stringValue(order.supplier_name), goodsValue, paidAmount, client, isoValue(order.created_at) || now());
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
  if (!order) {
    const cart = await one<Record<string, unknown>>(
      `SELECT so.cart_id, MIN(so.created_at) AS created_at, MAX(c.name) AS shop_name,
              SUM(so.total_amount + so.delivery_charge) AS goods_value
       FROM sales_orders so
       JOIN counterparties c ON c.id = so.shop_id
       WHERE so.cart_id = $1
       GROUP BY so.cart_id`,
      [linkedOrderId],
      client
    );
    if (!cart) return;
    await upsertLedger(side, linkedOrderId, stringValue(cart.shop_name), numberValue(cart.goods_value), paidAmount, client, isoValue(cart.created_at) || now());
    return;
  }
  const goodsValue = numberValue(order.total_amount) + numberValue(order.delivery_charge);
  await upsertLedger(side, linkedOrderId, stringValue(order.shop_name), goodsValue, paidAmount, client, isoValue(order.created_at) || now());
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

export async function getSnapshot(currentUser?: AppUser): Promise<AppSnapshot> {
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
  let snapshotWithoutMetrics = {
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
  if (currentUser && currentUser.warehouseIds.length > 0 && (currentUser.roles.includes("Warehouse Manager") || currentUser.roles.includes("Delivery"))) {
    const scopedWarehouseIds = new Set(currentUser.warehouseIds);
    const scopedPurchaseOrderIds = new Set(snapshotWithoutMetrics.purchaseOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)).map((item) => item.id));
    const scopedSalesOrderIds = new Set(snapshotWithoutMetrics.salesOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)).map((item) => item.id));
    const scopedCartIds = new Set([
      ...snapshotWithoutMetrics.purchaseOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)).map((item) => item.cartId).filter(Boolean) as string[],
      ...snapshotWithoutMetrics.salesOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)).map((item) => item.cartId).filter(Boolean) as string[]
    ]);
    const scopedDeliveryTaskIds = new Set(snapshotWithoutMetrics.deliveryTasks.filter((task) => task.assignedTo === currentUser.username || task.assignedTo === currentUser.fullName || task.routeStops.some((stop) => scopedWarehouseIds.has(stop.warehouseId))).map((task) => task.id));
    snapshotWithoutMetrics = {
      ...snapshotWithoutMetrics,
      warehouses: snapshotWithoutMetrics.warehouses.filter((item) => scopedWarehouseIds.has(item.id)),
      products: snapshotWithoutMetrics.products.filter((item) => item.allowedWarehouseIds.some((id) => scopedWarehouseIds.has(id))),
      purchaseOrders: snapshotWithoutMetrics.purchaseOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      salesOrders: snapshotWithoutMetrics.salesOrders.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      payments: snapshotWithoutMetrics.payments.filter((item) => scopedPurchaseOrderIds.has(item.linkedOrderId) || scopedSalesOrderIds.has(item.linkedOrderId) || scopedCartIds.has(item.linkedOrderId)),
      receiptChecks: snapshotWithoutMetrics.receiptChecks.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      inventoryLots: snapshotWithoutMetrics.inventoryLots.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      stockSummary: snapshotWithoutMetrics.stockSummary.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      ledgerEntries: snapshotWithoutMetrics.ledgerEntries.filter((item) => scopedCartIds.has(item.linkedOrderId) || scopedPurchaseOrderIds.has(item.linkedOrderId) || scopedSalesOrderIds.has(item.linkedOrderId)),
      deliveryTasks: snapshotWithoutMetrics.deliveryTasks.filter((item) => scopedDeliveryTaskIds.has(item.id)),
      deliveryDockets: snapshotWithoutMetrics.deliveryDockets.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      deliveryConsignments: snapshotWithoutMetrics.deliveryConsignments.filter((item) => scopedWarehouseIds.has(item.warehouseId)),
      notes: snapshotWithoutMetrics.notes.filter((item) => scopedPurchaseOrderIds.has(item.entityId) || scopedSalesOrderIds.has(item.entityId) || scopedCartIds.has(item.entityId))
    };
  }
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
    warehouseIds: Array.isArray(row.warehouse_ids_json) ? (row.warehouse_ids_json as string[]) : [],
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
    warehouseIds: Array.isArray(row.warehouse_ids_json) ? (row.warehouse_ids_json as string[]) : [],
    mobileNumber: stringValue(row.mobile_number),
    active: Boolean(row.active),
    createdAt: isoValue(row.created_at)
  } satisfies AppUser;
}

export async function deleteSession(token: string) {
  await ready;
  await query("DELETE FROM sessions WHERE token = $1", [token]);
}

export async function createUser(payload: { username: string; fullName: string; mobileNumber: string; role?: UserRole; roles?: UserRole[]; password?: string; warehouseIds?: string[] }) {
  await ready;
  const roles = payload.roles && payload.roles.length > 0 ? payload.roles : [payload.role || "Purchaser"];
  const warehouseIds = payload.warehouseIds || [];
  await query(
    `INSERT INTO users (username, full_name, mobile_number, role, roles_json, warehouse_ids_json, password, active, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, TRUE, $8)`,
    [payload.username.trim(), payload.fullName.trim(), payload.mobileNumber.trim(), roles[0], JSON.stringify(roles), JSON.stringify(warehouseIds), payload.password?.trim() || "1234", now()]
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
  const allowedWarehouseIds = payload.allowedWarehouseIds.length > 0 ? payload.allowedWarehouseIds : await getDefaultWarehouseIds();
  await query(
    `INSERT INTO products (
      sku, name, division, department, section_name, category, unit, default_gst_rate, default_tax_mode, default_weight_kg, tolerance_kg, tolerance_percent,
      allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode, supplier_name, hsn_code,
      article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
      $13::jsonb, $14::jsonb, $15, $16, $17, $18, $19, $20,
      $21, $22, $23, $24, $25, $26, $27, $28, $29
    )
    ON CONFLICT (sku) DO UPDATE SET
      name = EXCLUDED.name,
      division = EXCLUDED.division,
      department = EXCLUDED.department,
      section_name = EXCLUDED.section_name,
      category = EXCLUDED.category,
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
      created_by = EXCLUDED.created_by`,
    [
      payload.sku.trim(),
      payload.name.trim(),
      payload.division.trim(),
      payload.department.trim(),
      payload.section.trim(),
      payload.category.trim(),
      payload.unit.trim(),
      payload.defaultGstRate === "NA" ? 0 : payload.defaultGstRate,
      payload.defaultTaxMode,
      payload.defaultWeightKg,
      payload.toleranceKg,
      payload.tolerancePercent,
      JSON.stringify(allowedWarehouseIds),
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

async function getDefaultWarehouseIds() {
  const warehouses = await query<{ id: string }>("SELECT id FROM warehouses ORDER BY id");
  return warehouses.rows.map((warehouse) => warehouse.id);
}

export async function createProduct(payload: Omit<ProductMaster, "createdBy" | "createdAt">, currentUser: CurrentUser) {
  await ready;
  await ensureProductNameUnique(payload.name, payload.sku);
  await upsertProduct({ ...payload, createdBy: currentUser.username, createdAt: now() }, currentUser);
  return getSnapshot();
}

export async function updateProduct(sku: string, payload: Omit<ProductMaster, "sku" | "createdBy" | "createdAt">, currentUser: CurrentUser) {
  await ready;
  const existing = await one<Record<string, unknown>>("SELECT * FROM products WHERE sku = $1", [sku]);
  if (!existing) throw new Error("Product not found.");
  await ensureProductNameUnique(payload.name, sku);
  await upsertProduct({ ...payload, sku, createdBy: currentUser.username, createdAt: isoValue(existing.created_at) || now() }, currentUser);
  return getSnapshot();
}

export async function deleteProduct(sku: string) {
  await ready;
  const inPurchase = await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM purchase_orders WHERE product_sku = $1", [sku]);
  const inSales = await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM sales_orders WHERE product_sku = $1", [sku]);
  const inInventory = await one<{ count: string }>("SELECT COUNT(*)::text AS count FROM inventory_lots WHERE product_sku = $1", [sku]);
  if (Number(inPurchase?.count || 0) > 0 || Number(inSales?.count || 0) > 0 || Number(inInventory?.count || 0) > 0) {
    throw new Error("Product is linked to orders or inventory and cannot be deleted.");
  }
  await query("DELETE FROM products WHERE sku = $1", [sku]);
  return getSnapshot();
}

export async function bulkCreateProducts(rows: Array<Omit<ProductMaster, "createdBy" | "createdAt">>, currentUser: CurrentUser) {
  await ready;
  for (const row of rows) {
    await ensureProductNameUnique(row.name, row.sku);
    await upsertProduct({ ...row, createdBy: currentUser.username, createdAt: now() }, currentUser);
  }
  return getSnapshot();
}

async function ensureProductNameUnique(name: string, sku: string) {
  const duplicate = await one<{ sku: string }>(
    `SELECT sku FROM products
     WHERE UPPER(REGEXP_REPLACE(name, '\\s+', ' ', 'g')) = UPPER(REGEXP_REPLACE($1, '\\s+', ' ', 'g'))
       AND sku <> $2
     LIMIT 1`,
    [name.trim(), sku.trim()]
  );
  if (duplicate) throw new Error(`Product name already exists under SKU ${duplicate.sku}.`);
}

export async function createCounterparty(payload: Omit<Counterparty, "id" | "createdBy" | "createdAt">, currentUser: CurrentUser) {
  await ready;
  const name = payload.name.trim();
  const gstNumber = payload.gstNumber.trim();
  validateCounterpartyIdentity(name, gstNumber);
  await ensureCounterpartyUnique(payload.type, name, gstNumber);
  await query(
    `INSERT INTO counterparties (id, type, name, gst_number, mobile_number, address, city, contact_person, latitude, longitude, location_label, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [makeId(payload.type === "Supplier" ? "SUP" : "SHP"), payload.type, name, gstNumber, payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), payload.latitude ?? null, payload.longitude ?? null, payload.locationLabel?.trim() || null, currentUser.username, now()]
  );
  return getSnapshot();
}

function validateCounterpartyIdentity(name: string, gstNumber: string) {
  if (!name) throw new Error("Name is required.");
  if (!gstNumber) throw new Error("GST number is required. Use N/A for non-GST parties.");
}

function isNaGst(gstNumber: string) {
  return gstNumber.trim().toUpperCase() === "N/A";
}

async function ensureCounterpartyUnique(type: CounterpartyType, name: string, gstNumber: string, excludeId?: string) {
  const duplicateName = await one<{ id: string }>(
    `SELECT id FROM counterparties WHERE type = $1 AND LOWER(name) = LOWER($2) AND ($3::text IS NULL OR id <> $3) LIMIT 1`,
    [type, name, excludeId || null]
  );
  if (duplicateName) throw new Error(`${type} name already exists.`);
  if (!isNaGst(gstNumber)) {
    const duplicateGst = await one<{ id: string }>(
      `SELECT id FROM counterparties WHERE type = $1 AND LOWER(gst_number) = LOWER($2) AND ($3::text IS NULL OR id <> $3) LIMIT 1`,
      [type, gstNumber, excludeId || null]
    );
    if (duplicateGst) throw new Error(`${type} GST number already exists. Only N/A can be reused.`);
  }
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
  cartId?: string;
  skipFinancials?: boolean;
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
  operationDate?: string;
  advancePayment?: AdvancePaymentPayload;
}, currentUser: CurrentUser) {
  await ready;
  const product = await one<Record<string, unknown>>("SELECT * FROM products WHERE sku = $1", [payload.productSku]);
  if (!product) throw new Error("Product not found.");
  const baseAmount = payload.quantityOrdered * payload.rate;
  const taxableAmount = payload.taxableAmount ?? baseAmount;
  const isNonGstBill = payload.gstRate === "NA" || payload.taxMode === "NA";
  const gstRate = isNonGstBill ? 0 : payload.gstRate ?? 0;
  const gstAmount = isNonGstBill ? 0 : payload.gstAmount ?? 0;
  const taxMode = isNonGstBill ? "NA" : payload.taxMode || "Exclusive";
  const totalAmount = taxableAmount + gstAmount;
  const expectedWeightKg = payload.quantityOrdered * numberValue(product.default_weight_kg);
  const id = makeId("PO");
  const createdAt = operationalDate(payload.operationDate);
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
        id, cart_id, supplier_id, product_sku, purchaser_id, warehouse_id, quantity_ordered, quantity_received, rate, taxable_amount, gst_rate, gst_amount, tax_mode, total_amount,
        expected_weight_kg, delivery_mode, payment_mode, cash_timing, note, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [id, payload.cartId || null, payload.supplierId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantityOrdered, payload.rate, taxableAmount, gstRate, gstAmount, taxMode, totalAmount, expectedWeightKg, payload.deliveryMode, payload.paymentMode, payload.cashTiming || null, combinedNote, "Order Placed - Pending Delivery", createdAt],
      client
    );
    if (rateAlertNote) {
      await query(
        `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [makeId("NOTE"), "Purchase Order", id, rateAlertNote, currentUser.fullName, "Operational", createdAt],
        client
      );
    }
    if (!payload.skipFinancials) {
      await insertAdvancePayment("Purchase", id, payload.advancePayment, currentUser, createdAt, client);
      await recalculateLedger("Purchase", id, client);
    }
  });

  return getSnapshot();
}

export async function createPurchaseCart(payload: Omit<Parameters<typeof createPurchaseOrder>[0], "productSku" | "quantityOrdered" | "rate" | "taxableAmount" | "gstRate" | "gstAmount" | "taxMode" | "previousRate" | "advancePayment"> & {
  lines: Array<Pick<Parameters<typeof createPurchaseOrder>[0], "productSku" | "quantityOrdered" | "rate" | "taxableAmount" | "gstRate" | "gstAmount" | "taxMode" | "previousRate">>;
  advancePayment?: AdvancePaymentPayload;
}, currentUser: CurrentUser) {
  await ready;
  if (payload.lines.length === 0) throw new Error("At least one cart product is required.");
  const cartId = makeId("PCART");
  const createdAt = operationalDate(payload.operationDate);
  for (const [index, line] of payload.lines.entries()) {
    await createPurchaseOrder({
      ...payload,
      ...line,
      cartId,
      advancePayment: index === 0 ? payload.advancePayment : undefined,
      skipFinancials: true
    }, currentUser);
  }
  await withTransaction(async (client) => {
    await insertAdvancePayment("Purchase", cartId, payload.advancePayment, currentUser, createdAt, client);
    await recalculateLedger("Purchase", cartId, client);
  });
  return getSnapshot();
}

export async function createSalesOrder(payload: {
  cartId?: string;
  skipFinancials?: boolean;
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
  availableStockAtOrder?: number;
  stockApprovalRequested?: boolean;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
  location?: { latitude: number; longitude: number; label?: string };
  operationDate?: string;
  advancePayment?: AdvancePaymentPayload;
}, currentUser: CurrentUser) {
  await ready;
  const settings = await mapSettings();
  const id = makeId("SO");
  const createdAt = operationalDate(payload.operationDate);
  const needsPriceApproval = Boolean(payload.priceApprovalRequested) && typeof payload.minimumAllowedRate === "number" && payload.rate < payload.minimumAllowedRate;
  const priceApprovalNote = needsPriceApproval
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
    const availableQuantity = stock?.availableQuantity ?? 0;
    const needsStockApproval = availableQuantity < payload.quantity;
    if (needsStockApproval && !payload.stockApprovalRequested) {
      throw new Error(`Not enough stock available. Available ${availableQuantity}, requested ${payload.quantity}.`);
    }
    const stockApprovalNote = needsStockApproval
      ? `Admin approval requested: sales quantity ${payload.quantity} exceeds available stock ${availableQuantity} for ${payload.productSku} at ${payload.warehouseId}. Requested by ${currentUser.fullName}.`
      : "";
    const approvalNotes = [priceApprovalNote, stockApprovalNote].filter(Boolean);
    const needsApproval = needsPriceApproval || needsStockApproval;
    const deliveryCharge = payload.deliveryMode === "Delivery" ? settings.deliveryCharge.amount : 0;
    const baseAmount = payload.quantity * payload.rate;
    const taxableAmount = payload.taxableAmount ?? baseAmount;
  const isNonGstBill = payload.gstRate === "NA" || payload.taxMode === "NA";
  const gstRate = isNonGstBill ? 0 : payload.gstRate ?? 0;
  const gstAmount = isNonGstBill ? 0 : payload.gstAmount ?? 0;
  const taxMode = isNonGstBill ? "NA" : payload.taxMode || "Exclusive";
    const totalAmount = taxableAmount + gstAmount;
    const docketWeightKg = numberValue(product?.default_weight_kg) * payload.quantity;
    await query(
      `INSERT INTO sales_orders (
        id, cart_id, shop_id, product_sku, salesman_id, warehouse_id, quantity, rate, taxable_amount, gst_rate, gst_amount, tax_mode, total_amount, payment_mode, cash_timing,
        delivery_mode, delivery_charge, note, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [id, payload.cartId || null, payload.shopId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantity, payload.rate, taxableAmount, gstRate, gstAmount, taxMode, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, deliveryCharge, [payload.note.trim(), ...approvalNotes].filter(Boolean).join(" | "), needsApproval ? "Draft" : (payload.deliveryMode === "Self Collection" ? "Self Pickup" : "Booked"), createdAt],
      client
    );
    if (needsApproval) {
      for (const approvalNote of approvalNotes) {
        await query(
          `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
           VALUES ($1, 'Sales Order', $2, $3, $4, 'Management', $5)`,
          [makeId("NOTE"), id, approvalNote, currentUser.fullName, createdAt],
          client
        );
      }
      if (!payload.skipFinancials) {
        await insertAdvancePayment("Sales", id, payload.advancePayment, currentUser, createdAt, client);
        await recalculateLedger("Sales", id, client);
      }
      return;
    }
    await query(
      `INSERT INTO delivery_dockets (id, sales_order_id, shop_id, product_sku, warehouse_id, quantity, weight_kg, consignment_id, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9)`,
      [makeId("DCK"), id, payload.shopId, payload.productSku, payload.warehouseId, payload.quantity, docketWeightKg, payload.deliveryMode === "Delivery" ? "Pending Packing" : "Ready", createdAt],
      client
    );
    if (!payload.skipFinancials) {
      await insertAdvancePayment("Sales", id, payload.advancePayment, currentUser, createdAt, client);
    }
    await reserveInventory(payload.warehouseId, payload.productSku, payload.quantity, client);
    if (!payload.skipFinancials) {
      await recalculateLedger("Sales", id, client);
    }
  });

  return getSnapshot();
}

export async function createSalesCart(payload: Omit<Parameters<typeof createSalesOrder>[0], "productSku" | "quantity" | "rate" | "taxableAmount" | "gstRate" | "gstAmount" | "taxMode" | "minimumAllowedRate" | "priceApprovalRequested" | "availableStockAtOrder" | "stockApprovalRequested" | "advancePayment"> & {
  lines: Array<Pick<Parameters<typeof createSalesOrder>[0], "productSku" | "quantity" | "rate" | "taxableAmount" | "gstRate" | "gstAmount" | "taxMode" | "minimumAllowedRate" | "priceApprovalRequested" | "availableStockAtOrder" | "stockApprovalRequested" | "note">>;
  advancePayment?: AdvancePaymentPayload;
}, currentUser: CurrentUser) {
  await ready;
  if (payload.lines.length === 0) throw new Error("At least one cart product is required.");
  const cartId = makeId("SCART");
  const createdAt = operationalDate(payload.operationDate);
  for (const [index, line] of payload.lines.entries()) {
    await createSalesOrder({
      ...payload,
      ...line,
      cartId,
      note: line.note || payload.note,
      advancePayment: index === 0 ? payload.advancePayment : undefined,
      skipFinancials: true
    }, currentUser);
  }
  await withTransaction(async (client) => {
    await insertAdvancePayment("Sales", cartId, payload.advancePayment, currentUser, createdAt, client);
    await recalculateLedger("Sales", cartId, client);
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

type AdvancePaymentPayload = {
  amount: number;
  mode: PaymentMode;
  cashTiming?: PaymentRecord["cashTiming"];
  referenceNumber?: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationNote?: string;
};

async function insertAdvancePayment(side: "Purchase" | "Sales", linkedOrderId: string, payment: AdvancePaymentPayload | undefined, currentUser: CurrentUser, createdAt: string, client: DbClient) {
  if (!payment || payment.amount <= 0) return;
  await query(
    `INSERT INTO payments (
      id, side, linked_order_id, amount, mode, cash_timing, reference_number, voucher_number, utr_number,
      proof_name, verification_status, verification_note, created_by, verified_by, created_at, submitted_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Submitted', $11, $12, NULL, $13, $13)`,
    [
      makeId("PAY"),
      side,
      linkedOrderId,
      payment.amount,
      payment.mode,
      payment.cashTiming || null,
      payment.referenceNumber?.trim() || "",
      payment.voucherNumber?.trim() || null,
      payment.utrNumber?.trim() || null,
      payment.proofName?.trim() || null,
      payment.verificationNote?.trim() || (side === "Purchase" ? "Advance given at order finalization." : "Advance taken at order finalization."),
      currentUser.fullName,
      createdAt
    ],
    client
  );
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
  verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
  verificationNote?: string;
  operationDate?: string;
}, currentUser: CurrentUser) {
  await ready;
  const createdAt = operationalDate(payload.operationDate);
  const submittedAt = payload.verificationStatus === "Submitted" || payload.verificationStatus === "Disputed" ? createdAt : null;
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
        createdAt,
        submittedAt
      ],
      client
    );
    if (payload.verificationStatus !== "Rejected") {
      await recalculateLedger(payload.side, payload.linkedOrderId, client);
    }
  });
  return getSnapshot();
}

export async function verifyPayment(paymentId: string, status: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved", note: string, currentUser: CurrentUser) {
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
    await recalculateLedger(stringValue(payment.side) as "Purchase" | "Sales", stringValue(payment.linked_order_id), client);
    return getSnapshot();
  });
}

export async function createReceiptCheck(payload: {
  purchaseOrderId: string;
  warehouseId: string;
  receivedQuantity: number;
  actualWeightKg: number;
  containerWeightKg?: number;
  weighingProofName?: string;
  cashProofName?: string;
  note: string;
  confirmPartial: boolean;
  operationDate?: string;
}, currentUser: CurrentUser) {
  await ready;
  return withTransaction(async (client) => {
    const createdAt = operationalDate(payload.operationDate);
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
    const containerWeightKg = Math.max(payload.containerWeightKg || 0, 0);
    const netWeightKg = Math.max(payload.actualWeightKg - containerWeightKg, 0);
    const expectedWeightKg = payload.receivedQuantity * numberValue(product.default_weight_kg);
    const toleranceByPercent = (expectedWeightKg * numberValue(product.tolerance_percent)) / 100;
    const allowedVariance = Math.max(numberValue(product.tolerance_kg), toleranceByPercent);
    const weightVarianceKg = netWeightKg - expectedWeightKg;
    const flagged = Math.abs(weightVarianceKg) > allowedVariance || partialReceipt;

    await query(
      `INSERT INTO receipt_checks (
        grc_number, purchase_order_id, warehouse_id, receiver_id, ordered_quantity, received_quantity, pending_quantity,
        actual_weight_kg, container_weight_kg, net_weight_kg, weighing_proof_name, expected_weight_kg, weight_variance_kg, partial_receipt, flagged, notes_json, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17)`,
      [makeId("GRC"), payload.purchaseOrderId, payload.warehouseId, currentUser.id, orderedQuantity, payload.receivedQuantity, pendingQuantity, payload.actualWeightKg, containerWeightKg, netWeightKg, payload.weighingProofName?.trim() || null, expectedWeightKg, weightVarianceKg, partialReceipt, flagged, JSON.stringify([payload.note.trim()]), createdAt],
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
      [makeId("LOT"), payload.purchaseOrderId, payload.warehouseId, stringValue(order.product_sku), flagged ? 0 : payload.receivedQuantity, flagged ? payload.receivedQuantity : 0, flagged ? "Blocked" : "Available", createdAt],
      client
    );
    const linkedOrderId = stringValue(order.cart_id) || payload.purchaseOrderId;
    if (
      stringValue(order.delivery_mode) === "Dealer Delivery" &&
      stringValue(order.payment_mode) === "Cash" &&
      stringValue(order.cash_timing) === "At Delivery" &&
      payload.cashProofName?.trim()
    ) {
      const existingPayment = await one<Record<string, unknown>>(
        `SELECT * FROM payments
         WHERE side = 'Purchase' AND linked_order_id = $1 AND mode = 'Cash'
         ORDER BY created_at DESC
         LIMIT 1`,
        [linkedOrderId],
        client
      );
      if (existingPayment) {
        await query(
          `UPDATE payments
           SET verification_status = 'Verified',
               verification_note = $1,
               proof_name = COALESCE($2, proof_name),
               reference_number = CASE WHEN TRIM(COALESCE(reference_number, '')) = '' THEN $3 ELSE reference_number END,
               verified_by = $4
           WHERE id = $5`,
          [
            `Cash paid on vendor delivery and confirmed by warehouse receiver ${currentUser.fullName}.`,
            payload.cashProofName.trim(),
            `CASH-${linkedOrderId}`,
            currentUser.fullName,
            stringValue(existingPayment.id)
          ],
          client
        );
      } else {
        await query(
          `INSERT INTO payments (
            id, side, linked_order_id, amount, mode, cash_timing, reference_number, voucher_number, utr_number,
            proof_name, verification_status, verification_note, created_by, verified_by, created_at, submitted_at
          ) VALUES ($1, 'Purchase', $2, $3, 'Cash', 'At Delivery', $4, NULL, NULL, $5, 'Verified', $6, $7, $7, $8, $8)`,
          [
            makeId("PAY"),
            linkedOrderId,
            numberValue(order.total_amount),
            `CASH-${linkedOrderId}`,
            payload.cashProofName.trim(),
            `Cash paid on vendor delivery and confirmed by warehouse receiver ${currentUser.fullName}.`,
            currentUser.fullName,
            createdAt
          ],
          client
        );
      }
    }
    await recalculateLedger("Purchase", linkedOrderId, client);
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
  routeStops?: DeliveryTask["routeStops"];
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
  operationDate?: string;
}) {
  await ready;
  const createdAt = operationalDate(payload.operationDate);
  const linkedOrderIds = payload.linkedOrderIds && payload.linkedOrderIds.length > 0 ? payload.linkedOrderIds : [payload.linkedOrderId.trim()];
  await withTransaction(async (client) => {
    await query(
      `INSERT INTO delivery_tasks (
        id, side, linked_order_id, linked_order_ids_json, mode, source_location, destination_location, assigned_to,
        pickup_at, drop_at, route_hint, route_json, payment_action, cash_collection_required, cash_handover_marked,
        weight_proof_name, cash_proof_name, last_action_at, status, created_at
      ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15, $16, $17, $18, $19, $20)`,
      [
        makeId("DL"),
        payload.side,
        payload.linkedOrderId.trim(),
        JSON.stringify(linkedOrderIds),
        payload.mode,
        payload.from.trim(),
        payload.to.trim(),
        payload.assignedTo.trim(),
        payload.pickupAt || null,
        payload.dropAt || null,
        payload.routeHint?.trim() || null,
        JSON.stringify(payload.routeStops || []),
        payload.paymentAction || "None",
        payload.cashCollectionRequired,
        payload.cashHandoverMarked || false,
        payload.weightProofName?.trim() || null,
        payload.cashProofName?.trim() || null,
        payload.lastActionAt || null,
        payload.status,
        createdAt
      ],
      client
    );
    if (payload.side === "Purchase") {
      await query(
        `UPDATE purchase_orders
         SET status = 'Pickup Assigned'
         WHERE cart_id = ANY($1::text[]) OR id = ANY($1::text[])`,
        [linkedOrderIds],
        client
      );
    }
  });
  return getSnapshot();
}

export async function createDeliveryConsignment(payload: {
  docketIds: string[];
  warehouseId: string;
  assignedTo: string;
  status?: DeliveryConsignment["status"];
  operationDate?: string;
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
  const createdAt = operationalDate(payload.operationDate);
  await withTransaction(async (client) => {
    await query(
      `INSERT INTO delivery_consignments (id, docket_ids_json, warehouse_id, assigned_to, total_weight_kg, status, created_by, created_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)`,
      [id, JSON.stringify(docketIds), payload.warehouseId, payload.assignedTo.trim(), totalWeightKg, payload.status || "Ready", currentUser.fullName, createdAt],
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
  operationDate?: string;
}, currentUser: CurrentUser) {
  await ready;
  const createdAt = operationalDate(payload.operationDate);
  await query(
    `INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [makeId("NOTE"), payload.entityType, payload.entityId.trim(), payload.note.trim(), currentUser.fullName, payload.visibility, createdAt]
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
  const existing = await one<Record<string, unknown>>("SELECT * FROM counterparties WHERE id = $1", [counterpartyId]);
  if (!existing) throw new Error("Party not found.");
  const name = payload.name.trim();
  const gstNumber = payload.gstNumber.trim();
  validateCounterpartyIdentity(name, gstNumber);
  await ensureCounterpartyUnique(stringValue(existing.type) as CounterpartyType, name, gstNumber, counterpartyId);
  await query(
    `UPDATE counterparties
     SET name = $1, gst_number = $2, mobile_number = $3, address = $4, city = $5, contact_person = $6
     WHERE id = $7`,
    [name, gstNumber, payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), counterpartyId]
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
  await recalculateLedger("Purchase", stringValue(order.cart_id) || orderId);
  return getSnapshot();
}

export async function updateSalesOrder(orderId: string, payload: {
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
  status: SalesOrder["status"];
  containerWeightKg?: number;
  weighingProofName?: string;
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
  if (payload.containerWeightKg !== undefined || payload.weighingProofName) {
    await query(
      `UPDATE delivery_dockets
       SET container_weight_kg = COALESCE($1, container_weight_kg),
           weighing_proof_name = COALESCE($2, weighing_proof_name)
       WHERE sales_order_id = $3`,
      [payload.containerWeightKg ?? null, payload.weighingProofName?.trim() || null, orderId]
    );
  }
  await recalculateLedger("Sales", stringValue(order.cart_id) || orderId);
  return getSnapshot();
}

export async function updatePayment(paymentId: string, payload: {
  amount: number;
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
  verificationNote: string;
  operationDate?: string;
}, currentUser: CurrentUser) {
  await ready;
  const payment = await one<Record<string, unknown>>("SELECT * FROM payments WHERE id = $1", [paymentId]);
  if (!payment) throw new Error("Payment not found.");
  const submittedAt = payload.operationDate ? operationalDate(payload.operationDate) : now();
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
      payload.verificationStatus === "Verified" || payload.verificationStatus === "Resolved" ? currentUser.fullName : null,
      payload.verificationStatus === "Submitted" || payload.verificationStatus === "Disputed" ? submittedAt : null,
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
  routeStops?: DeliveryTask["routeStops"];
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
  await withTransaction(async (client) => {
    const task = await one<Record<string, unknown>>("SELECT * FROM delivery_tasks WHERE id = $1", [taskId], client);
    if (!task) throw new Error("Delivery task not found.");
    await query(
      `UPDATE delivery_tasks
       SET linked_order_ids_json = $1::jsonb, assigned_to = $2, pickup_at = $3, drop_at = $4, route_hint = $5, route_json = $6::jsonb, payment_action = $7,
           status = $8, cash_collection_required = $9, cash_handover_marked = $10, weight_proof_name = $11, cash_proof_name = $12, last_action_at = $13
       WHERE id = $14`,
      [
        JSON.stringify(payload.linkedOrderIds || []),
        payload.assignedTo.trim(),
        payload.pickupAt || null,
        payload.dropAt || null,
        payload.routeHint?.trim() || null,
        JSON.stringify(payload.routeStops || []),
        payload.paymentAction || "None",
        payload.status,
        payload.cashCollectionRequired,
        payload.cashHandoverMarked || false,
        payload.weightProofName?.trim() || null,
        payload.cashProofName?.trim() || null,
        payload.lastActionAt || now(),
        taskId
      ],
      client
    );
    const side = stringValue(task.side) as DeliveryTask["side"];
    const linkedOrderId = stringValue(task.linked_order_id);
    const linkedOrderIds = payload.linkedOrderIds || (Array.isArray(task.linked_order_ids_json) ? (task.linked_order_ids_json as string[]) : [linkedOrderId]);
    if (side === "Purchase") {
      const purchaseStatus =
        payload.status === "Delivered"
          ? "Order Delivered - Warehouse Check"
          : payload.status === "Handed Over"
            ? "Order Delivered - Warehouse Check"
            : payload.status === "Picked"
              ? "In Pickup"
              : "Pickup Assigned";
      await query(
        `UPDATE purchase_orders
         SET status = $1
         WHERE cart_id = ANY($2::text[]) OR id = ANY($2::text[])`,
        [purchaseStatus, linkedOrderIds],
        client
      );
    }
    if (
      side === "Purchase" &&
      (payload.paymentAction || stringValue(task.payment_action) as DeliveryTask["paymentAction"]) === "Deliver Payment" &&
      payload.status === "Delivered" &&
      payload.cashHandoverMarked &&
      payload.cashProofName
    ) {
      const payment = await one<Record<string, unknown>>(
        `SELECT * FROM payments
         WHERE side = 'Purchase' AND linked_order_id = $1 AND mode = 'Cash'
           AND verification_status IN ('Pending', 'Submitted', 'Disputed', 'Rejected')
         ORDER BY created_at DESC
         LIMIT 1`,
        [linkedOrderId],
        client
      );
      if (payment) {
        await query(
          `UPDATE payments
           SET verification_status = 'Verified',
               verification_note = $1,
               proof_name = COALESCE($2, proof_name),
               verified_by = $3
           WHERE id = $4`,
          [
            `Cash delivered to supplier by ${payload.assignedTo.trim()} and proof uploaded.`,
            payload.cashProofName.trim(),
            payload.assignedTo.trim(),
            stringValue(payment.id)
          ],
          client
        );
        await recalculateLedger("Purchase", linkedOrderId, client);
      }
    }
  });
  return getSnapshot();
}
