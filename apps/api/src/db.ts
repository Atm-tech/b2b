import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  CounterpartyType,
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

const dataDir = path.resolve(process.cwd(), "data");
mkdirSync(dataDir, { recursive: true });

export const databasePath = path.join(dataDir, "aapoorti-b2b-v2.sqlite");
const db = new Database(databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    mobile_number TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL,
    roles_json TEXT NOT NULL DEFAULT '[]',
    password TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS warehouses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS products (
    sku TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    division TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    section_name TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL,
    unit TEXT NOT NULL,
    default_weight_kg REAL NOT NULL,
    tolerance_kg REAL NOT NULL,
    tolerance_percent REAL NOT NULL,
    allowed_warehouse_ids_json TEXT NOT NULL,
    slabs_json TEXT NOT NULL,
    remarks TEXT NOT NULL DEFAULT '',
    category_6 TEXT NOT NULL DEFAULT '',
    site_name TEXT NOT NULL DEFAULT '',
    barcode TEXT NOT NULL DEFAULT '',
    supplier_name TEXT NOT NULL DEFAULT '',
    hsn_code TEXT NOT NULL DEFAULT '',
    article_name TEXT NOT NULL DEFAULT '',
    item_name TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    short_name TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    rsp REAL,
    mrp REAL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS counterparties (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    gst_number TEXT NOT NULL DEFAULT '',
    mobile_number TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    contact_person TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    supplier_id TEXT NOT NULL,
    product_sku TEXT NOT NULL,
    purchaser_id INTEGER NOT NULL,
    warehouse_id TEXT NOT NULL,
    quantity_ordered REAL NOT NULL,
    quantity_received REAL NOT NULL DEFAULT 0,
    rate REAL NOT NULL,
    total_amount REAL NOT NULL,
    expected_weight_kg REAL NOT NULL,
    delivery_mode TEXT NOT NULL,
    payment_mode TEXT NOT NULL,
    cash_timing TEXT,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sales_orders (
    id TEXT PRIMARY KEY,
    shop_id TEXT NOT NULL,
    product_sku TEXT NOT NULL,
    salesman_id INTEGER NOT NULL,
    warehouse_id TEXT NOT NULL,
    quantity REAL NOT NULL,
    rate REAL NOT NULL,
    total_amount REAL NOT NULL,
    payment_mode TEXT NOT NULL,
    cash_timing TEXT,
    delivery_mode TEXT NOT NULL,
    delivery_charge REAL NOT NULL DEFAULT 0,
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    side TEXT NOT NULL,
    linked_order_id TEXT NOT NULL,
    amount REAL NOT NULL,
    mode TEXT NOT NULL,
    cash_timing TEXT,
    reference_number TEXT NOT NULL DEFAULT '',
    voucher_number TEXT,
    utr_number TEXT,
    proof_name TEXT,
    verification_status TEXT NOT NULL,
    verification_note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    verified_by TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS receipt_checks (
    grc_number TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    receiver_id INTEGER NOT NULL,
    ordered_quantity REAL NOT NULL,
    received_quantity REAL NOT NULL,
    pending_quantity REAL NOT NULL,
    actual_weight_kg REAL NOT NULL,
    expected_weight_kg REAL NOT NULL,
    weight_variance_kg REAL NOT NULL,
    partial_receipt INTEGER NOT NULL,
    flagged INTEGER NOT NULL,
    notes_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory_lots (
    lot_id TEXT PRIMARY KEY,
    source_order_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    warehouse_id TEXT NOT NULL,
    product_sku TEXT NOT NULL,
    quantity_available REAL NOT NULL,
    quantity_reserved REAL NOT NULL,
    quantity_blocked REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ledger_entries (
    id TEXT PRIMARY KEY,
    side TEXT NOT NULL,
    linked_order_id TEXT NOT NULL,
    party_name TEXT NOT NULL,
    goods_value REAL NOT NULL,
    paid_amount REAL NOT NULL,
    pending_amount REAL NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS delivery_tasks (
    id TEXT PRIMARY KEY,
    side TEXT NOT NULL,
    linked_order_id TEXT NOT NULL,
    linked_order_ids_json TEXT NOT NULL DEFAULT '[]',
    mode TEXT NOT NULL,
    source_location TEXT NOT NULL,
    destination_location TEXT NOT NULL,
    assigned_to TEXT NOT NULL,
    pickup_at TEXT,
    drop_at TEXT,
    payment_action TEXT NOT NULL DEFAULT 'None',
    cash_collection_required INTEGER NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS note_records (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    note TEXT NOT NULL,
    created_by TEXT NOT NULL,
    visibility TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

ensureLegacyColumns();
seedDatabase();

function ensureLegacyColumns() {
  const userColumns = (db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>).map((item) => item.name);
  if (!userColumns.includes("mobile_number")) {
    db.exec("ALTER TABLE users ADD COLUMN mobile_number TEXT NOT NULL DEFAULT ''");
  }
  if (!userColumns.includes("roles_json")) {
    db.exec("ALTER TABLE users ADD COLUMN roles_json TEXT NOT NULL DEFAULT '[]'");
  }
  db.exec("UPDATE users SET roles_json = json_array(role) WHERE roles_json = '[]' OR roles_json = '' OR roles_json IS NULL");
  const productColumns = (db.prepare("PRAGMA table_info(products)").all() as Array<{ name: string }>).map((item) => item.name);
  const productAlterations = [
    ["remarks", "TEXT NOT NULL DEFAULT ''"],
    ["category_6", "TEXT NOT NULL DEFAULT ''"],
    ["site_name", "TEXT NOT NULL DEFAULT ''"],
    ["barcode", "TEXT NOT NULL DEFAULT ''"],
    ["supplier_name", "TEXT NOT NULL DEFAULT ''"],
    ["hsn_code", "TEXT NOT NULL DEFAULT ''"],
    ["article_name", "TEXT NOT NULL DEFAULT ''"],
    ["item_name", "TEXT NOT NULL DEFAULT ''"],
    ["brand", "TEXT NOT NULL DEFAULT ''"],
    ["short_name", "TEXT NOT NULL DEFAULT ''"],
    ["size", "TEXT NOT NULL DEFAULT ''"],
    ["rsp", "REAL"],
    ["mrp", "REAL"]
  ] as const;
  productAlterations.forEach(([name, sqlType]) => {
    if (!productColumns.includes(name)) {
      db.exec(`ALTER TABLE products ADD COLUMN ${name} ${sqlType}`);
    }
  });
  const deliveryColumns = (db.prepare("PRAGMA table_info(delivery_tasks)").all() as Array<{ name: string }>).map((item) => item.name);
  const deliveryAlterations = [
    ["linked_order_ids_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["pickup_at", "TEXT"],
    ["drop_at", "TEXT"],
    ["payment_action", "TEXT NOT NULL DEFAULT 'None'"]
  ] as const;
  deliveryAlterations.forEach(([name, sqlType]) => {
    if (!deliveryColumns.includes(name)) {
      db.exec(`ALTER TABLE delivery_tasks ADD COLUMN ${name} ${sqlType}`);
    }
  });
  db.exec("UPDATE delivery_tasks SET linked_order_ids_json = json_array(linked_order_id) WHERE linked_order_ids_json = '[]' OR linked_order_ids_json = '' OR linked_order_ids_json IS NULL");
}

function now() {
  return new Date().toISOString();
}

function stringify(value: unknown) {
  return JSON.stringify(value);
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function makeId(prefix: string) {
  return `${prefix}-${Math.floor(Date.now() / 1000)}-${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;
}

function seedDatabase() {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    const insertUser = db.prepare(`
      INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
      VALUES (@username, @full_name, @mobile_number, @role, @roles_json, @password, 1, @created_at)
    `);
    const createdAt = now();
    [
      { username: "admin", full_name: "Platform Admin", mobile_number: "9990000001", role: "Admin", roles_json: stringify(["Admin"]) },
      { username: "w", full_name: "Warehouse Manager", mobile_number: "9990000002", role: "Warehouse Manager", roles_json: stringify(["Warehouse Manager"]) },
      { username: "p", full_name: "Purchase Manager", mobile_number: "9990000003", role: "Purchaser", roles_json: stringify(["Purchaser"]) },
      { username: "a", full_name: "Accounts Manager", mobile_number: "9990000004", role: "Accounts", roles_json: stringify(["Accounts"]) },
      { username: "s", full_name: "Sales Executive", mobile_number: "9990000005", role: "Sales", roles_json: stringify(["Sales"]) }
    ].forEach((user) =>
      insertUser.run({
        ...user,
        password: "1234",
        created_at: createdAt
      })
    );
  }

  const warehouseCount = db.prepare("SELECT COUNT(*) AS count FROM warehouses").get() as { count: number };
  if (warehouseCount.count === 0) {
    const insert = db.prepare(`
      INSERT INTO warehouses (id, name, city, address, type, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    insert.run("WH-NOI-01", "Noida Main Warehouse", "Noida", "Sector 63, Noida", "Warehouse", now());
    insert.run("WH-GZB-02", "Ghaziabad Bulk Yard", "Ghaziabad", "Industrial Belt", "Yard", now());
  }

  const productCount = db.prepare("SELECT COUNT(*) AS count FROM products").get() as { count: number };
  if (productCount.count === 0) {
    const insert = db.prepare(`
      INSERT INTO products (
        sku, name, division, department, section_name, category, unit, default_weight_kg, tolerance_kg,
        tolerance_percent, allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode,
        supplier_name, hsn_code, article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "AAP-CEM-43",
      "OPC Cement 43 Grade",
      "Building Material",
      "Cement",
      "Grey Cement",
      "Construction",
      "Bag",
      50,
      30,
      1.2,
      stringify(["WH-NOI-01", "WH-GZB-02"]),
      stringify([{ minQuantity: 50, maxQuantity: 199, purchaseRate: 348 }, { minQuantity: 200, maxQuantity: 499, purchaseRate: 341 }, { minQuantity: 500, purchaseRate: 336 }] satisfies ProductSlab[]),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
      0,
      "admin",
      now()
    );
    insert.run(
      "AAP-TMT-12",
      "TMT Bar 12mm",
      "Steel",
      "Rebars",
      "Primary Steel",
      "Steel",
      "Ton",
      1000,
      60,
      0.8,
      stringify(["WH-NOI-01", "WH-GZB-02"]),
      stringify([{ minQuantity: 5, maxQuantity: 19, purchaseRate: 56400 }, { minQuantity: 20, maxQuantity: 49, purchaseRate: 55750 }, { minQuantity: 50, purchaseRate: 55100 }] satisfies ProductSlab[]),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      0,
      0,
      "admin",
      now()
    );
  }

  const settingsCount = db.prepare("SELECT COUNT(*) AS count FROM settings").get() as { count: number };
  if (settingsCount.count === 0) {
    const paymentMethods: PaymentMethodSetting[] = [
      { code: "Cash", label: "Cash", active: true, allowsCashTiming: true },
      { code: "Card", label: "Card", active: true, allowsCashTiming: false },
      { code: "UPI", label: "UPI", active: true, allowsCashTiming: false },
      { code: "NEFT", label: "NEFT", active: true, allowsCashTiming: false },
      { code: "RTGS", label: "RTGS", active: true, allowsCashTiming: false },
      { code: "Cheque", label: "Cheque", active: false, allowsCashTiming: false }
    ];
    db.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)").run("payment_methods", stringify(paymentMethods));
    db.prepare("INSERT INTO settings (key, value_json) VALUES (?, ?)").run("delivery_charge", stringify({ model: "Fixed", amount: 350 }));
  }

  syncConfiguredOrgData();
}

function syncConfiguredOrgData() {
  const setupVersion = "2026-04-04-user-warehouse-reset-v3";
  const existing = db.prepare("SELECT value_json FROM settings WHERE key = ?").get("org_setup_version") as { value_json?: string } | undefined;
  if (existing?.value_json === JSON.stringify(setupVersion)) {
    return;
  }

  db.exec(`
    DELETE FROM note_records;
    DELETE FROM delivery_tasks;
    DELETE FROM ledger_entries;
    DELETE FROM inventory_lots;
    DELETE FROM receipt_checks;
    DELETE FROM payments;
    DELETE FROM sales_orders;
    DELETE FROM purchase_orders;
    DELETE FROM counterparties;
    DELETE FROM sessions;
    DELETE FROM warehouses;
    DELETE FROM users;
  `);

  const createdAt = now();
  const insertUser = db.prepare(`
    INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  insertUser.run("admin", "Admin", "", "Admin", stringify(["Admin"]), "1234", createdAt);
  insertUser.run("p", "Amar Purchase", "7987046155", "Purchaser", stringify(["Purchaser"]), "1234", createdAt);
  insertUser.run("amas", "Amar Sales", "7987046155", "Sales", stringify(["Sales"]), "1234", createdAt);
  insertUser.run("aakash", "Aakash", "8719858248", "Accounts", stringify(["Accounts"]), "1234", createdAt);
  insertUser.run("aadarsh", "Aadarsh", "", "Warehouse Manager", stringify(["Warehouse Manager"]), "1234", createdAt);
  insertUser.run("delivery", "Delivery", "", "Delivery", stringify(["Delivery"]), "1234", createdAt);

  const insertWarehouse = db.prepare(`
    INSERT INTO warehouses (id, name, city, address, type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insertWarehouse.run("GOVINDPURA", "Govindpura", "Bhopal", "Govindpura", "Warehouse", createdAt);
  insertWarehouse.run("C21", "C21", "Bhopal", "C21", "Warehouse", createdAt);
  db.prepare("UPDATE products SET allowed_warehouse_ids_json = ?").run(stringify(["GOVINDPURA", "C21"]));

  db.prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)").run("org_setup_version", stringify(setupVersion));
}

function rolesFromRow(row: Record<string, unknown>) {
  const parsed = row.roles_json ? parseJson<UserRole[]>(String(row.roles_json)) : [];
  return parsed.length > 0 ? parsed : [String(row.role) as UserRole];
}

function mapUsers(): AppUser[] {
  return (db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: rolesFromRow(row)[0],
    roles: rolesFromRow(row),
    mobileNumber: String(row.mobile_number),
    active: Boolean(row.active),
    createdAt: String(row.created_at)
  }));
}

function mapWarehouses(): Warehouse[] {
  return (db.prepare("SELECT * FROM warehouses ORDER BY name").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    name: String(row.name),
    city: String(row.city),
    address: String(row.address),
    type: String(row.type) as Warehouse["type"],
    createdAt: String(row.created_at)
  }));
}

function mapProducts(): ProductMaster[] {
  return (db.prepare("SELECT * FROM products ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    sku: String(row.sku),
    name: String(row.name),
    division: String(row.division),
    department: String(row.department),
    section: String(row.section_name),
    category: String(row.category),
    unit: String(row.unit),
    defaultWeightKg: Number(row.default_weight_kg),
    toleranceKg: Number(row.tolerance_kg),
    tolerancePercent: Number(row.tolerance_percent),
    allowedWarehouseIds: parseJson<string[]>(String(row.allowed_warehouse_ids_json)),
    slabs: parseJson<ProductSlab[]>(String(row.slabs_json)),
    remarks: String(row.remarks || ""),
    category6: String(row.category_6 || ""),
    siteName: String(row.site_name || ""),
    barcode: String(row.barcode || ""),
    supplierName: String(row.supplier_name || ""),
    hsnCode: String(row.hsn_code || ""),
    articleName: String(row.article_name || ""),
    itemName: String(row.item_name || ""),
    brand: String(row.brand || ""),
    shortName: String(row.short_name || ""),
    size: String(row.size || ""),
    rsp: row.rsp === null || row.rsp === undefined ? undefined : Number(row.rsp),
    mrp: row.mrp === null || row.mrp === undefined ? undefined : Number(row.mrp),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at)
  }));
}

function mapCounterparties(): Counterparty[] {
  return (db.prepare("SELECT * FROM counterparties ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    type: String(row.type) as CounterpartyType,
    name: String(row.name),
    gstNumber: String(row.gst_number),
    mobileNumber: String(row.mobile_number),
    address: String(row.address),
    city: String(row.city),
    contactPerson: String(row.contact_person),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at)
  }));
}

function mapSettings() {
  const rows = db.prepare("SELECT * FROM settings").all() as Array<Record<string, unknown>>;
  const lookup = new Map(rows.map((row) => [String(row.key), parseJson<unknown>(String(row.value_json))]));
  return {
    paymentMethods: (lookup.get("payment_methods") as PaymentMethodSetting[]) || [],
    deliveryCharge: (lookup.get("delivery_charge") as { model: "Fixed" | "Per Km"; amount: number }) || { model: "Fixed", amount: 0 }
  };
}

function mapPurchaseOrders(): PurchaseOrder[] {
  return (
    db
      .prepare(`
        SELECT po.*, c.name AS supplier_name, u.full_name AS purchaser_name
        FROM purchase_orders po
        JOIN counterparties c ON c.id = po.supplier_id
        JOIN users u ON u.id = po.purchaser_id
        ORDER BY po.created_at DESC
      `)
      .all() as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    supplierId: String(row.supplier_id),
    supplierName: String(row.supplier_name),
    productSku: String(row.product_sku),
    purchaserId: Number(row.purchaser_id),
    purchaserName: String(row.purchaser_name),
    warehouseId: String(row.warehouse_id),
    quantityOrdered: Number(row.quantity_ordered),
    quantityReceived: Number(row.quantity_received),
    rate: Number(row.rate),
    totalAmount: Number(row.total_amount),
    expectedWeightKg: Number(row.expected_weight_kg),
    deliveryMode: String(row.delivery_mode) as PurchaseOrder["deliveryMode"],
    paymentMode: String(row.payment_mode) as PaymentMode,
    cashTiming: row.cash_timing ? String(row.cash_timing) as PurchaseOrder["cashTiming"] : undefined,
    note: String(row.note),
    status: String(row.status) as PurchaseOrder["status"],
    createdAt: String(row.created_at)
  }));
}

function mapSalesOrders(): SalesOrder[] {
  return (
    db
      .prepare(`
        SELECT so.*, c.name AS shop_name, u.full_name AS salesman_name
        FROM sales_orders so
        JOIN counterparties c ON c.id = so.shop_id
        JOIN users u ON u.id = so.salesman_id
        ORDER BY so.created_at DESC
      `)
      .all() as Array<Record<string, unknown>>
  ).map((row) => ({
    id: String(row.id),
    shopId: String(row.shop_id),
    shopName: String(row.shop_name),
    productSku: String(row.product_sku),
    salesmanId: Number(row.salesman_id),
    salesmanName: String(row.salesman_name),
    warehouseId: String(row.warehouse_id),
    quantity: Number(row.quantity),
    rate: Number(row.rate),
    totalAmount: Number(row.total_amount),
    paymentMode: String(row.payment_mode) as PaymentMode,
    cashTiming: row.cash_timing ? String(row.cash_timing) as SalesOrder["cashTiming"] : undefined,
    deliveryMode: String(row.delivery_mode) as SalesOrder["deliveryMode"],
    deliveryCharge: Number(row.delivery_charge),
    note: String(row.note),
    status: String(row.status) as SalesOrder["status"],
    createdAt: String(row.created_at)
  }));
}

function mapPayments(): PaymentRecord[] {
  return (db.prepare("SELECT * FROM payments ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    side: String(row.side) as PaymentRecord["side"],
    linkedOrderId: String(row.linked_order_id),
    amount: Number(row.amount),
    mode: String(row.mode) as PaymentMode,
    cashTiming: row.cash_timing ? String(row.cash_timing) as PaymentRecord["cashTiming"] : undefined,
    referenceNumber: String(row.reference_number),
    voucherNumber: row.voucher_number ? String(row.voucher_number) : undefined,
    utrNumber: row.utr_number ? String(row.utr_number) : undefined,
    proofName: row.proof_name ? String(row.proof_name) : undefined,
    verificationStatus: String(row.verification_status) as PaymentRecord["verificationStatus"],
    verificationNote: String(row.verification_note),
    createdBy: String(row.created_by),
    verifiedBy: row.verified_by ? String(row.verified_by) : undefined,
    createdAt: String(row.created_at)
  }));
}

function mapReceiptChecks(): ReceiptCheck[] {
  return (
    db
      .prepare(`
        SELECT rc.*, u.full_name AS receiver_name
        FROM receipt_checks rc
        JOIN users u ON u.id = rc.receiver_id
        ORDER BY rc.created_at DESC
      `)
      .all() as Array<Record<string, unknown>>
  ).map((row) => ({
    grcNumber: String(row.grc_number),
    purchaseOrderId: String(row.purchase_order_id),
    warehouseId: String(row.warehouse_id),
    receiverId: Number(row.receiver_id),
    receiverName: String(row.receiver_name),
    orderedQuantity: Number(row.ordered_quantity),
    receivedQuantity: Number(row.received_quantity),
    pendingQuantity: Number(row.pending_quantity),
    actualWeightKg: Number(row.actual_weight_kg),
    expectedWeightKg: Number(row.expected_weight_kg),
    weightVarianceKg: Number(row.weight_variance_kg),
    partialReceipt: Boolean(row.partial_receipt),
    flagged: Boolean(row.flagged),
    notes: parseJson<string[]>(String(row.notes_json)),
    createdAt: String(row.created_at)
  }));
}

function mapInventoryLots(): InventoryLot[] {
  return (db.prepare("SELECT * FROM inventory_lots ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    lotId: String(row.lot_id),
    sourceOrderId: String(row.source_order_id),
    sourceType: "Purchase",
    warehouseId: String(row.warehouse_id),
    productSku: String(row.product_sku),
    quantityAvailable: Number(row.quantity_available),
    quantityReserved: Number(row.quantity_reserved),
    quantityBlocked: Number(row.quantity_blocked),
    status: String(row.status) as InventoryLot["status"],
    createdAt: String(row.created_at)
  }));
}

function mapLedgers(): LedgerEntry[] {
  return (db.prepare("SELECT * FROM ledger_entries ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    side: String(row.side) as LedgerEntry["side"],
    linkedOrderId: String(row.linked_order_id),
    partyName: String(row.party_name),
    goodsValue: Number(row.goods_value),
    paidAmount: Number(row.paid_amount),
    pendingAmount: Number(row.pending_amount),
    status: String(row.status) as LedgerEntry["status"],
    createdAt: String(row.created_at)
  }));
}

function mapDeliveryTasks(): DeliveryTask[] {
  return (db.prepare("SELECT * FROM delivery_tasks ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    side: String(row.side) as DeliveryTask["side"],
    linkedOrderId: String(row.linked_order_id),
    linkedOrderIds: row.linked_order_ids_json ? parseJson<string[]>(String(row.linked_order_ids_json)) : [String(row.linked_order_id)],
    mode: String(row.mode) as DeliveryTask["mode"],
    from: String(row.source_location),
    to: String(row.destination_location),
    assignedTo: String(row.assigned_to),
    pickupAt: row.pickup_at ? String(row.pickup_at) : undefined,
    dropAt: row.drop_at ? String(row.drop_at) : undefined,
    paymentAction: String(row.payment_action || "None") as DeliveryTask["paymentAction"],
    cashCollectionRequired: Boolean(row.cash_collection_required),
    status: String(row.status) as DeliveryTask["status"],
    createdAt: String(row.created_at)
  }));
}

function mapNotes(): NoteRecord[] {
  return (db.prepare("SELECT * FROM note_records ORDER BY created_at DESC").all() as Array<Record<string, unknown>>).map((row) => ({
    id: String(row.id),
    entityType: String(row.entity_type) as NoteRecord["entityType"],
    entityId: String(row.entity_id),
    note: String(row.note),
    createdBy: String(row.created_by),
    visibility: String(row.visibility) as NoteRecord["visibility"],
    createdAt: String(row.created_at)
  }));
}

function buildStockSummary(warehouses: Warehouse[], products: ProductMaster[], inventoryLots: InventoryLot[]): StockSummary[] {
  const bucket = new Map<string, StockSummary>();
  inventoryLots.forEach((lot) => {
    const key = `${lot.warehouseId}:${lot.productSku}`;
    const warehouse = warehouses.find((item) => item.id === lot.warehouseId);
    const product = products.find((item) => item.sku === lot.productSku);
    if (!warehouse || !product) {
      return;
    }
    const existing = bucket.get(key) || {
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      productSku: product.sku,
      productName: product.name,
      availableQuantity: 0,
      reservedQuantity: 0,
      blockedQuantity: 0
    };
    existing.availableQuantity += lot.quantityAvailable;
    existing.reservedQuantity += lot.quantityReserved;
    existing.blockedQuantity += lot.quantityBlocked;
    bucket.set(key, existing);
  });
  return Array.from(bucket.values());
}

function recalculateLedger(side: "Purchase" | "Sales", linkedOrderId: string) {
  const payments = db
    .prepare("SELECT SUM(amount) AS paid FROM payments WHERE side = ? AND linked_order_id = ? AND verification_status = 'Verified'")
    .get(side, linkedOrderId) as { paid: number | null };
  const paidAmount = Number(payments.paid || 0);

  if (side === "Purchase") {
    const order = db
      .prepare(`
        SELECT po.*, c.name AS supplier_name
        FROM purchase_orders po
        JOIN counterparties c ON c.id = po.supplier_id
        WHERE po.id = ?
      `)
      .get(linkedOrderId) as Record<string, unknown> | undefined;
    if (!order) {
      return;
    }
    const goodsValue = Number(order.rate) * Number(order.quantity_received);
    upsertLedger(side, linkedOrderId, String(order.supplier_name), goodsValue, paidAmount);
    return;
  }

  const order = db
    .prepare(`
      SELECT so.*, c.name AS shop_name
      FROM sales_orders so
      JOIN counterparties c ON c.id = so.shop_id
      WHERE so.id = ?
    `)
    .get(linkedOrderId) as Record<string, unknown> | undefined;
  if (!order) {
    return;
  }
  const goodsValue = Number(order.total_amount) + Number(order.delivery_charge);
  upsertLedger(side, linkedOrderId, String(order.shop_name), goodsValue, paidAmount);
}

function upsertLedger(side: "Purchase" | "Sales", linkedOrderId: string, partyName: string, goodsValue: number, paidAmount: number) {
  const pendingAmount = Math.max(goodsValue - paidAmount, 0);
  const status = pendingAmount === 0 ? "Settled" : paidAmount > 0 ? "Partial" : "Pending";
  const existing = db.prepare("SELECT id FROM ledger_entries WHERE side = ? AND linked_order_id = ?").get(side, linkedOrderId) as { id: string } | undefined;
  if (existing) {
    db.prepare(`
      UPDATE ledger_entries
      SET party_name = ?, goods_value = ?, paid_amount = ?, pending_amount = ?, status = ?
      WHERE id = ?
    `).run(partyName, goodsValue, paidAmount, pendingAmount, status, existing.id);
    return;
  }
  db.prepare(`
    INSERT INTO ledger_entries (id, side, linked_order_id, party_name, goods_value, paid_amount, pending_amount, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("LED"), side, linkedOrderId, partyName, goodsValue, paidAmount, pendingAmount, status, now());
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

export function getSnapshot(): AppSnapshot {
  const users = mapUsers();
  const warehouses = mapWarehouses();
  const products = mapProducts();
  const counterparties = mapCounterparties();
  const purchaseOrders = mapPurchaseOrders();
  const salesOrders = mapSalesOrders();
  const payments = mapPayments();
  const receiptChecks = mapReceiptChecks();
  const inventoryLots = mapInventoryLots();
  const ledgerEntries = mapLedgers();
  const deliveryTasks = mapDeliveryTasks();
  const notes = mapNotes();
  const settings = mapSettings();
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
    notes
  };

  return {
    metrics: buildMetrics(snapshotWithoutMetrics),
    ...snapshotWithoutMetrics
  };
}

export function authenticate(username: string, password: string) {
  const row = db.prepare("SELECT * FROM users WHERE username = ? AND password = ? AND active = 1").get(username, password) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: rolesFromRow(row)[0],
    roles: rolesFromRow(row),
    mobileNumber: String(row.mobile_number),
    active: Boolean(row.active),
    createdAt: String(row.created_at)
  };
}

export function createSessionForUser(userId: number) {
  const token = randomUUID();
  db.prepare("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)").run(token, userId, now());
  return token;
}

export function getUserBySessionToken(token: string) {
  const row = db
    .prepare(`
      SELECT u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND u.active = 1
    `)
    .get(token) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    username: String(row.username),
    fullName: String(row.full_name),
    role: rolesFromRow(row)[0],
    roles: rolesFromRow(row),
    mobileNumber: String(row.mobile_number),
    active: Boolean(row.active),
    createdAt: String(row.created_at)
  };
}

export function deleteSession(token: string) {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function createUser(payload: { username: string; fullName: string; mobileNumber: string; role?: UserRole; roles?: UserRole[]; password?: string }) {
  const roles = payload.roles && payload.roles.length > 0 ? payload.roles : [payload.role || "Purchaser"];
  db.prepare(`
    INSERT INTO users (username, full_name, mobile_number, role, roles_json, password, active, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `).run(payload.username.trim(), payload.fullName.trim(), payload.mobileNumber.trim(), roles[0], stringify(roles), payload.password?.trim() || "1234", now());
  return getSnapshot();
}

export function createWarehouse(payload: { id: string; name: string; city: string; address: string; type: Warehouse["type"] }) {
  db.prepare("INSERT INTO warehouses (id, name, city, address, type, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(payload.id.trim(), payload.name.trim(), payload.city.trim(), payload.address.trim(), payload.type, now());
  return getSnapshot();
}

export function createProduct(payload: Omit<ProductMaster, "createdBy" | "createdAt">, currentUser: CurrentUser) {
  db.prepare(`
    INSERT INTO products (
      sku, name, division, department, section_name, category, unit, default_weight_kg, tolerance_kg, tolerance_percent,
      allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode, supplier_name, hsn_code,
      article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    stringify(payload.allowedWarehouseIds),
    stringify(payload.slabs),
    payload.remarks?.trim() || "",
    payload.category6?.trim() || "",
    payload.siteName?.trim() || "",
    payload.barcode?.trim() || "",
    "",
    payload.hsnCode?.trim() || "",
    payload.articleName?.trim() || "",
    payload.itemName?.trim() || "",
    payload.brand?.trim() || "",
    payload.shortName?.trim() || "",
    payload.size?.trim() || "",
    payload.rsp ?? null,
    payload.mrp ?? null,
    currentUser.username,
    now()
  );
  return getSnapshot();
}

export function bulkCreateProducts(rows: Array<Omit<ProductMaster, "createdBy" | "createdAt">>, currentUser: CurrentUser) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO products (
      sku, name, division, department, section_name, category, unit, default_weight_kg, tolerance_kg, tolerance_percent,
      allowed_warehouse_ids_json, slabs_json, remarks, category_6, site_name, barcode, supplier_name, hsn_code,
      article_name, item_name, brand, short_name, size, rsp, mrp, created_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  rows.forEach((payload) => {
    insert.run(
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
      stringify(payload.allowedWarehouseIds),
      stringify(payload.slabs),
      payload.remarks?.trim() || "",
      payload.category6?.trim() || "",
      payload.siteName?.trim() || "",
      payload.barcode?.trim() || "",
      "",
      payload.hsnCode?.trim() || "",
      payload.articleName?.trim() || "",
      payload.itemName?.trim() || "",
      payload.brand?.trim() || "",
      payload.shortName?.trim() || "",
      payload.size?.trim() || "",
      payload.rsp ?? null,
      payload.mrp ?? null,
      currentUser.username,
      now()
    );
  });
  return getSnapshot();
}

export function createCounterparty(payload: Omit<Counterparty, "id" | "createdBy" | "createdAt">, currentUser: CurrentUser) {
  db.prepare(`
    INSERT INTO counterparties (id, type, name, gst_number, mobile_number, address, city, contact_person, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeId(payload.type === "Supplier" ? "SUP" : "SHP"), payload.type, payload.name.trim(), payload.gstNumber.trim(), payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), currentUser.username, now());
  return getSnapshot();
}

export function updateSettings(payload: { paymentMethods: PaymentMethodSetting[]; deliveryCharge: { model: "Fixed" | "Per Km"; amount: number } }) {
  db.prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)").run("payment_methods", stringify(payload.paymentMethods));
  db.prepare("INSERT OR REPLACE INTO settings (key, value_json) VALUES (?, ?)").run("delivery_charge", stringify(payload.deliveryCharge));
  return getSnapshot();
}

export function createPurchaseOrder(payload: {
  supplierId: string;
  productSku: string;
  warehouseId: string;
  quantityOrdered: number;
  rate: number;
  deliveryMode: PurchaseOrder["deliveryMode"];
  paymentMode: PaymentMode;
  cashTiming?: PurchaseOrder["cashTiming"];
  note: string;
}, currentUser: CurrentUser) {
  const product = db.prepare("SELECT * FROM products WHERE sku = ?").get(payload.productSku) as Record<string, unknown> | undefined;
  if (!product) {
    throw new Error("Product not found.");
  }
  const totalAmount = payload.quantityOrdered * payload.rate;
  const expectedWeightKg = payload.quantityOrdered * Number(product.default_weight_kg);
  const id = makeId("PO");
  db.prepare(`
    INSERT INTO purchase_orders (
      id, supplier_id, product_sku, purchaser_id, warehouse_id, quantity_ordered, quantity_received, rate, total_amount,
      expected_weight_kg, delivery_mode, payment_mode, cash_timing, note, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, payload.supplierId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantityOrdered, payload.rate, totalAmount, expectedWeightKg, payload.deliveryMode, payload.paymentMode, payload.cashTiming || null, payload.note.trim(), "Pending Payment", now());
  recalculateLedger("Purchase", id);
  return getSnapshot();
}

export function createSalesOrder(payload: {
  shopId: string;
  productSku: string;
  warehouseId: string;
  quantity: number;
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
}, currentUser: CurrentUser) {
  const stock = buildStockSummary(mapWarehouses(), mapProducts(), mapInventoryLots()).find(
    (item) => item.warehouseId === payload.warehouseId && item.productSku === payload.productSku
  );
  if (!stock || stock.availableQuantity < payload.quantity) {
    throw new Error("Not enough stock available.");
  }
  const settings = mapSettings();
  const deliveryCharge = payload.deliveryMode === "Delivery" ? settings.deliveryCharge.amount : 0;
  const id = makeId("SO");
  db.prepare(`
    INSERT INTO sales_orders (
      id, shop_id, product_sku, salesman_id, warehouse_id, quantity, rate, total_amount, payment_mode, cash_timing,
      delivery_mode, delivery_charge, note, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, payload.shopId, payload.productSku, currentUser.id, payload.warehouseId, payload.quantity, payload.rate, payload.quantity * payload.rate, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, deliveryCharge, payload.note.trim(), payload.deliveryMode === "Self Collection" ? "Self Pickup" : "Booked", now());
  reserveInventory(payload.warehouseId, payload.productSku, payload.quantity);
  recalculateLedger("Sales", id);
  return getSnapshot();
}

function reserveInventory(warehouseId: string, productSku: string, quantity: number) {
  const lots = db.prepare(`
    SELECT * FROM inventory_lots
    WHERE warehouse_id = ? AND product_sku = ? AND quantity_available > 0
    ORDER BY created_at ASC
  `).all(warehouseId, productSku) as Array<Record<string, unknown>>;
  let remaining = quantity;
  const update = db.prepare("UPDATE inventory_lots SET quantity_available = ?, quantity_reserved = ?, status = ? WHERE lot_id = ?");
  lots.forEach((lot) => {
    if (remaining <= 0) {
      return;
    }
    const available = Number(lot.quantity_available);
    const move = Math.min(available, remaining);
    update.run(available - move, Number(lot.quantity_reserved) + move, "Reserved", String(lot.lot_id));
    remaining -= move;
  });
}

export function createPayment(payload: {
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
  db.prepare(`
    INSERT INTO payments (
      id, side, linked_order_id, amount, mode, cash_timing, reference_number, voucher_number, utr_number,
      proof_name, verification_status, verification_note, created_by, verified_by, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("PAY"), payload.side, payload.linkedOrderId, payload.amount, payload.mode, payload.cashTiming || null, payload.referenceNumber.trim(), payload.voucherNumber?.trim() || null, payload.utrNumber?.trim() || null, payload.proofName?.trim() || null, payload.verificationStatus, payload.verificationNote?.trim() || "", currentUser.fullName, payload.verificationStatus === "Verified" ? currentUser.fullName : null, now());
  if (payload.verificationStatus === "Verified") {
    recalculateLedger(payload.side, payload.linkedOrderId);
  }
  return getSnapshot();
}

export function verifyPayment(paymentId: string, status: PaymentRecord["verificationStatus"], note: string, currentUser: CurrentUser) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as Record<string, unknown> | undefined;
  if (!payment) {
    throw new Error("Payment not found.");
  }
  db.prepare("UPDATE payments SET verification_status = ?, verification_note = ?, verified_by = ? WHERE id = ?").run(status, note.trim(), currentUser.fullName, paymentId);
  if (status === "Verified") {
    recalculateLedger(String(payment.side) as "Purchase" | "Sales", String(payment.linked_order_id));
  }
  return getSnapshot();
}

export function createReceiptCheck(payload: {
  purchaseOrderId: string;
  warehouseId: string;
  receivedQuantity: number;
  actualWeightKg: number;
  note: string;
  confirmPartial: boolean;
}, currentUser: CurrentUser) {
  const order = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(payload.purchaseOrderId) as Record<string, unknown> | undefined;
  if (!order) {
    throw new Error("Purchase order not found.");
  }
  const product = db.prepare("SELECT * FROM products WHERE sku = ?").get(String(order.product_sku)) as Record<string, unknown> | undefined;
  if (!product) {
    throw new Error("Product not found.");
  }
  const orderedQuantity = Number(order.quantity_ordered);
  const totalReceivedBefore = Number(order.quantity_received);
  const totalReceivedNow = totalReceivedBefore + payload.receivedQuantity;
  const pendingQuantity = Math.max(orderedQuantity - totalReceivedNow, 0);
  const partialReceipt = pendingQuantity > 0;
  if (partialReceipt && !payload.confirmPartial) {
    throw new Error("Confirm partial receipt before saving.");
  }
  const expectedWeightKg = payload.receivedQuantity * Number(product.default_weight_kg);
  const toleranceByPercent = (expectedWeightKg * Number(product.tolerance_percent)) / 100;
  const allowedVariance = Math.max(Number(product.tolerance_kg), toleranceByPercent);
  const weightVarianceKg = payload.actualWeightKg - expectedWeightKg;
  const flagged = Math.abs(weightVarianceKg) > allowedVariance || partialReceipt;

  db.prepare(`
    INSERT INTO receipt_checks (
      grc_number, purchase_order_id, warehouse_id, receiver_id, ordered_quantity, received_quantity, pending_quantity,
      actual_weight_kg, expected_weight_kg, weight_variance_kg, partial_receipt, flagged, notes_json, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("GRC"), payload.purchaseOrderId, payload.warehouseId, currentUser.id, orderedQuantity, payload.receivedQuantity, pendingQuantity, payload.actualWeightKg, expectedWeightKg, weightVarianceKg, partialReceipt ? 1 : 0, flagged ? 1 : 0, stringify([payload.note.trim()]), now());

  db.prepare("UPDATE purchase_orders SET quantity_received = ?, status = ? WHERE id = ?").run(totalReceivedNow, partialReceipt ? "Partially Received" : "Received", payload.purchaseOrderId);
  db.prepare(`
    INSERT INTO inventory_lots (
      lot_id, source_order_id, source_type, warehouse_id, product_sku, quantity_available, quantity_reserved, quantity_blocked, status, created_at
    )
    VALUES (?, ?, 'Purchase', ?, ?, ?, 0, ?, ?, ?)
  `).run(makeId("LOT"), payload.purchaseOrderId, payload.warehouseId, String(order.product_sku), flagged ? 0 : payload.receivedQuantity, flagged ? payload.receivedQuantity : 0, flagged ? "Blocked" : "Available", now());
  recalculateLedger("Purchase", payload.purchaseOrderId);
  return getSnapshot();
}

export function createDeliveryTask(payload: {
  side: DeliveryTask["side"];
  linkedOrderId: string;
  linkedOrderIds?: string[];
  mode: DeliveryTask["mode"];
  from: string;
  to: string;
  assignedTo: string;
  pickupAt?: string;
  dropAt?: string;
  paymentAction?: DeliveryTask["paymentAction"];
  cashCollectionRequired: boolean;
  status: DeliveryTask["status"];
}) {
  db.prepare(`
    INSERT INTO delivery_tasks (
      id, side, linked_order_id, linked_order_ids_json, mode, source_location, destination_location, assigned_to,
      pickup_at, drop_at, payment_action, cash_collection_required, status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    makeId("DL"),
    payload.side,
    payload.linkedOrderId.trim(),
    stringify(payload.linkedOrderIds && payload.linkedOrderIds.length > 0 ? payload.linkedOrderIds : [payload.linkedOrderId.trim()]),
    payload.mode,
    payload.from.trim(),
    payload.to.trim(),
    payload.assignedTo.trim(),
    payload.pickupAt || null,
    payload.dropAt || null,
    payload.paymentAction || "None",
    payload.cashCollectionRequired ? 1 : 0,
    payload.status,
    now()
  );
  return getSnapshot();
}

export function createNote(payload: {
  entityType: NoteRecord["entityType"];
  entityId: string;
  note: string;
  visibility: NoteRecord["visibility"];
}, currentUser: CurrentUser) {
  db.prepare(`
    INSERT INTO note_records (id, entity_type, entity_id, note, created_by, visibility, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(makeId("NOTE"), payload.entityType, payload.entityId.trim(), payload.note.trim(), currentUser.fullName, payload.visibility, now());
  return getSnapshot();
}

export function updateCounterparty(counterpartyId: string, payload: {
  name: string;
  gstNumber: string;
  mobileNumber: string;
  address: string;
  city: string;
  contactPerson: string;
}) {
  db.prepare(`
    UPDATE counterparties
    SET name = ?, gst_number = ?, mobile_number = ?, address = ?, city = ?, contact_person = ?
    WHERE id = ?
  `).run(payload.name.trim(), payload.gstNumber.trim(), payload.mobileNumber.trim(), payload.address.trim(), payload.city.trim(), payload.contactPerson.trim(), counterpartyId);
  return getSnapshot();
}

export function updatePurchaseOrder(orderId: string, payload: {
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: PurchaseOrder["cashTiming"];
  deliveryMode: PurchaseOrder["deliveryMode"];
  note: string;
  status: PurchaseOrder["status"];
}) {
  const order = db.prepare("SELECT * FROM purchase_orders WHERE id = ?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) {
    throw new Error("Purchase order not found.");
  }
  const quantityOrdered = Number(order.quantity_ordered);
  const totalAmount = quantityOrdered * payload.rate;
  db.prepare(`
    UPDATE purchase_orders
    SET rate = ?, total_amount = ?, payment_mode = ?, cash_timing = ?, delivery_mode = ?, note = ?, status = ?
    WHERE id = ?
  `).run(payload.rate, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, payload.note.trim(), payload.status, orderId);
  recalculateLedger("Purchase", orderId);
  return getSnapshot();
}

export function updateSalesOrder(orderId: string, payload: {
  rate: number;
  paymentMode: PaymentMode;
  cashTiming?: SalesOrder["cashTiming"];
  deliveryMode: SalesOrder["deliveryMode"];
  note: string;
  status: SalesOrder["status"];
}) {
  const order = db.prepare("SELECT * FROM sales_orders WHERE id = ?").get(orderId) as Record<string, unknown> | undefined;
  if (!order) {
    throw new Error("Sales order not found.");
  }
  const settings = mapSettings();
  const quantity = Number(order.quantity);
  const totalAmount = quantity * payload.rate;
  const deliveryCharge = payload.deliveryMode === "Delivery" ? settings.deliveryCharge.amount : 0;
  db.prepare(`
    UPDATE sales_orders
    SET rate = ?, total_amount = ?, payment_mode = ?, cash_timing = ?, delivery_mode = ?, delivery_charge = ?, note = ?, status = ?
    WHERE id = ?
  `).run(payload.rate, totalAmount, payload.paymentMode, payload.cashTiming || null, payload.deliveryMode, deliveryCharge, payload.note.trim(), payload.status, orderId);
  recalculateLedger("Sales", orderId);
  return getSnapshot();
}

export function updatePayment(paymentId: string, payload: {
  amount: number;
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: PaymentRecord["verificationStatus"];
  verificationNote: string;
}, currentUser: CurrentUser) {
  const payment = db.prepare("SELECT * FROM payments WHERE id = ?").get(paymentId) as Record<string, unknown> | undefined;
  if (!payment) {
    throw new Error("Payment not found.");
  }
  db.prepare(`
    UPDATE payments
    SET amount = ?, reference_number = ?, voucher_number = ?, utr_number = ?, proof_name = ?, verification_status = ?, verification_note = ?, verified_by = ?
    WHERE id = ?
  `).run(payload.amount, payload.referenceNumber.trim(), payload.voucherNumber?.trim() || null, payload.utrNumber?.trim() || null, payload.proofName?.trim() || null, payload.verificationStatus, payload.verificationNote.trim(), payload.verificationStatus === "Verified" ? currentUser.fullName : null, paymentId);
  recalculateLedger(String(payment.side) as "Purchase" | "Sales", String(payment.linked_order_id));
  return getSnapshot();
}

export function updateReceiptCheck(grcNumber: string, payload: {
  note: string;
  flagged: boolean;
}) {
  const receipt = db.prepare("SELECT * FROM receipt_checks WHERE grc_number = ?").get(grcNumber) as Record<string, unknown> | undefined;
  if (!receipt) {
    throw new Error("Receipt check not found.");
  }
  const notes = parseJson<string[]>(String(receipt.notes_json));
  db.prepare("UPDATE receipt_checks SET flagged = ?, notes_json = ? WHERE grc_number = ?").run(payload.flagged ? 1 : 0, stringify([...notes, payload.note.trim()].filter(Boolean)), grcNumber);
  return getSnapshot();
}

export function updateDeliveryTask(taskId: string, payload: {
  linkedOrderIds?: string[];
  assignedTo: string;
  pickupAt?: string;
  dropAt?: string;
  paymentAction?: DeliveryTask["paymentAction"];
  status: DeliveryTask["status"];
  cashCollectionRequired: boolean;
}) {
  db.prepare(`
    UPDATE delivery_tasks
    SET linked_order_ids_json = ?, assigned_to = ?, pickup_at = ?, drop_at = ?, payment_action = ?, status = ?, cash_collection_required = ?
    WHERE id = ?
  `).run(
    stringify(payload.linkedOrderIds || []),
    payload.assignedTo.trim(),
    payload.pickupAt || null,
    payload.dropAt || null,
    payload.paymentAction || "None",
    payload.status,
    payload.cashCollectionRequired ? 1 : 0,
    taskId
  );
  return getSnapshot();
}
