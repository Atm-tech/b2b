import cors from "cors";
import express from "express";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import multer from "multer";
import type { CounterpartyType, DeliveryTask, NoteRecord, PaymentMethodSetting, PaymentMode, ProductMaster, ProductSlab, UserRole, Warehouse } from "@aapoorti-b2b/domain";
import {
  authenticate,
  bulkCreateProducts,
  createSessionForUser,
  createCounterparty,
  createDeliveryTask,
  createNote,
  createPayment,
  createProduct,
  createPurchaseOrder,
  createReceiptCheck,
  createSalesOrder,
  createUser,
  createWarehouse,
  databasePath,
  deleteSession,
  getSnapshot,
  getUserBySessionToken,
  updateCounterparty,
  updateDeliveryTask,
  updatePayment,
  updatePurchaseOrder,
  updateReceiptCheck,
  updateSalesOrder,
  updateSettings,
  verifyPayment
} from "./db.js";

const app = express();
const port = Number(process.env.PORT || 8080);
const uploadsDir = path.resolve(process.cwd(), "uploads");
const csvDir = path.join(uploadsDir, "csv");
const paymentDir = path.join(uploadsDir, "payment-proofs");
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

mkdirSync(csvDir, { recursive: true });
mkdirSync(paymentDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      cb(null, file.fieldname === "csv" ? csvDir : paymentDir);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
      cb(null, `${Date.now()}-${safeName}`);
    }
  })
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed by CORS."));
  },
  credentials: true
}));
app.use(express.json({ limit: "2mb" }));
app.use("/uploads", express.static(uploadsDir));

app.get("/", (_req, res) => {
  res.json({ name: "Aapoorti B2B Platform API", version: "0.3.0", databasePath });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api", timestamp: new Date().toISOString() });
});

app.post("/auth/login", (req, res) => {
  const user = authenticate(requiredString(req.body?.username, "Username"), requiredString(req.body?.password, "Password"));
  if (!user) {
    res.status(401).json({ message: "Invalid credentials." });
    return;
  }
  const token = createSessionForUser(user.id);
  res.json({ user, token, snapshot: getSnapshot() });
});

app.post("/auth/logout", (req, res) => wrap(res, () => {
  const token = getBearerToken(req);
  if (token) {
    deleteSession(token);
  }
  return { ok: true };
}));

app.get("/snapshot", (req, res) => {
  try {
    getCurrentUser(req);
    res.json(getSnapshot());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized.";
    res.status(401).json({ message });
  }
});

app.post("/users", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin"]);
  const roles = Array.isArray(req.body?.roles) ? req.body.roles.map((item: unknown) => String(item) as UserRole) : [];
  return createUser({
    username: requiredString(req.body?.username, "Username"),
    fullName: requiredString(req.body?.fullName, "Full name"),
    mobileNumber: requiredString(req.body?.mobileNumber, "Mobile number"),
    role: roles[0] || (requiredString(req.body?.role, "Role") as UserRole),
    roles,
    password: optionalString(req.body?.password)
  });
}));

app.post("/warehouses", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin"]);
  return createWarehouse({
    id: requiredString(req.body?.id, "Warehouse code"),
    name: requiredString(req.body?.name, "Warehouse name"),
    city: requiredString(req.body?.city, "City"),
    address: requiredString(req.body?.address, "Address"),
    type: requiredString(req.body?.type, "Type") as Warehouse["type"]
  });
}));

app.post("/products", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin"]);
  return createProduct(
    {
      sku: requiredString(req.body?.sku, "SKU"),
      name: requiredString(req.body?.name, "Product name"),
      division: requiredString(req.body?.division, "Division"),
      department: requiredString(req.body?.department, "Department"),
      section: requiredString(req.body?.section, "Section"),
      category: requiredString(req.body?.category, "Category"),
      unit: requiredString(req.body?.unit, "Unit"),
      defaultWeightKg: requiredNumber(req.body?.defaultWeightKg, "Default weight"),
      toleranceKg: requiredNumber(req.body?.toleranceKg, "Tolerance kg"),
      tolerancePercent: requiredNumber(req.body?.tolerancePercent, "Tolerance percent"),
      allowedWarehouseIds: requiredStringArray(req.body?.allowedWarehouseIds, "Allowed warehouses"),
      slabs: normalizeSlabs(req.body?.slabs)
    },
    currentUser
  );
}));

app.post("/products/bulk", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin"]);
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
  if (rows.length === 0) {
    throw new Error("At least one product row is required.");
  }
  return bulkCreateProducts(
    rows.map((row: any) => ({
      sku: requiredString(row?.sku, "SKU"),
      name: requiredString(row?.name, "Product name"),
      division: requiredString(row?.division, "Division"),
      department: requiredString(row?.department, "Department"),
      section: requiredString(row?.section, "Section"),
      category: requiredString(row?.category, "Category"),
      unit: requiredString(row?.unit, "Unit"),
      defaultWeightKg: requiredNumber(row?.defaultWeightKg, "Default weight"),
      toleranceKg: requiredNumber(row?.toleranceKg, "Tolerance kg"),
      tolerancePercent: requiredNumber(row?.tolerancePercent, "Tolerance percent"),
      allowedWarehouseIds: requiredStringArray(row?.allowedWarehouseIds, "Allowed warehouses"),
      slabs: normalizeSlabs(row?.slabs)
    })),
    currentUser
  );
}));

app.post("/products/bulk-upload", upload.single("csv"), (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin"]);
  if (!req.file) {
    throw new Error("CSV file is required.");
  }
  const csvText = readFileSync(req.file.path, "utf8");
  return bulkCreateProducts(parseCsvRows(csvText), currentUser);
}));

app.post("/counterparties", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Purchaser", "Sales"]);
  return createCounterparty(
    {
      type: requiredString(req.body?.type, "Type") as CounterpartyType,
      name: requiredString(req.body?.name, "Name"),
      gstNumber: optionalString(req.body?.gstNumber) || "",
      mobileNumber: requiredString(req.body?.mobileNumber, "Mobile number"),
      address: requiredString(req.body?.address, "Address"),
      city: requiredString(req.body?.city, "City"),
      contactPerson: requiredString(req.body?.contactPerson, "Contact person")
    },
    currentUser
  );
}));

app.patch("/counterparties/:id", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Purchaser", "Sales"]);
  return updateCounterparty(req.params.id, {
    name: requiredString(req.body?.name, "Name"),
    gstNumber: optionalString(req.body?.gstNumber) || "",
    mobileNumber: requiredString(req.body?.mobileNumber, "Mobile number"),
    address: requiredString(req.body?.address, "Address"),
    city: requiredString(req.body?.city, "City"),
    contactPerson: requiredString(req.body?.contactPerson, "Contact person")
  });
}));

app.post("/settings", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin"]);
  const paymentMethods = Array.isArray(req.body?.paymentMethods) ? req.body.paymentMethods : [];
  return updateSettings({
    paymentMethods: paymentMethods.map((item: any) => ({
      code: requiredString(item?.code, "Payment mode") as PaymentMode,
      label: requiredString(item?.label, "Label"),
      active: Boolean(item?.active),
      allowsCashTiming: Boolean(item?.allowsCashTiming)
    })) as PaymentMethodSetting[],
    deliveryCharge: {
      model: requiredString(req.body?.deliveryCharge?.model, "Delivery charge model") as "Fixed" | "Per Km",
      amount: requiredNumber(req.body?.deliveryCharge?.amount, "Delivery charge amount")
    }
  });
}));

app.post("/purchase-orders", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Purchaser"]);
  return createPurchaseOrder(
    {
      supplierId: requiredString(req.body?.supplierId, "Supplier"),
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantityOrdered: requiredNumber(req.body?.quantityOrdered, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      note: optionalString(req.body?.note) || ""
    },
    currentUser
  );
}));

app.patch("/purchase-orders/:id", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Purchaser", "Accounts"]);
  return updatePurchaseOrder(req.params.id, {
    rate: requiredNumber(req.body?.rate, "Rate"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
    note: optionalString(req.body?.note) || "",
    status: requiredString(req.body?.status, "Status") as any
  });
}));

app.post("/sales-orders", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Sales"]);
  return createSalesOrder(
    {
      shopId: requiredString(req.body?.shopId, "Shop"),
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantity: requiredNumber(req.body?.quantity, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
      note: optionalString(req.body?.note) || ""
    },
    currentUser
  );
}));

app.patch("/sales-orders/:id", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Sales", "Accounts"]);
  return updateSalesOrder(req.params.id, {
    rate: requiredNumber(req.body?.rate, "Rate"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
    note: optionalString(req.body?.note) || "",
    status: requiredString(req.body?.status, "Status") as any
  });
}));

app.post("/payments", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Accounts", "Purchaser", "Sales"]);
  return createPayment(
    {
      side: requiredString(req.body?.side, "Side") as "Purchase" | "Sales",
      linkedOrderId: requiredString(req.body?.linkedOrderId, "Linked order"),
      amount: requiredNumber(req.body?.amount, "Amount"),
      mode: requiredString(req.body?.mode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      referenceNumber: optionalString(req.body?.referenceNumber) || "",
      voucherNumber: optionalString(req.body?.voucherNumber),
      utrNumber: optionalString(req.body?.utrNumber),
      proofName: optionalString(req.body?.proofName),
      verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected",
      verificationNote: optionalString(req.body?.verificationNote)
    },
    currentUser
  );
}));

app.patch("/payments/:id", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Accounts"]);
  return updatePayment(req.params.id, {
    amount: requiredNumber(req.body?.amount, "Amount"),
    referenceNumber: optionalString(req.body?.referenceNumber) || "",
    voucherNumber: optionalString(req.body?.voucherNumber),
    utrNumber: optionalString(req.body?.utrNumber),
    proofName: optionalString(req.body?.proofName),
    verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as any,
    verificationNote: optionalString(req.body?.verificationNote) || ""
  }, currentUser);
}));

app.post("/payments/upload-proof", upload.single("proof"), (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Accounts", "Purchaser", "Sales"]);
  if (!req.file) {
    throw new Error("Proof file is required.");
  }
  return {
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: `/uploads/payment-proofs/${req.file.filename}`
  };
}));

app.post("/payments/verify", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Accounts"]);
  return verifyPayment(
    requiredString(req.body?.paymentId, "Payment id"),
    requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected",
    optionalString(req.body?.verificationNote) || "",
    currentUser
  );
}));

app.post("/receipt-checks", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Warehouse Manager"]);
  return createReceiptCheck(
    {
      purchaseOrderId: requiredString(req.body?.purchaseOrderId, "Purchase order"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      receivedQuantity: requiredNumber(req.body?.receivedQuantity, "Received quantity"),
      actualWeightKg: requiredNumber(req.body?.actualWeightKg, "Actual weight"),
      note: requiredString(req.body?.note, "Note"),
      confirmPartial: Boolean(req.body?.confirmPartial)
    },
    currentUser
  );
}));

app.patch("/receipt-checks/:id", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Warehouse Manager", "Accounts"]);
  return updateReceiptCheck(req.params.id, {
    note: optionalString(req.body?.note) || "",
    flagged: Boolean(req.body?.flagged)
  });
}));

app.post("/delivery-tasks", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Sales", "Delivery"]);
  const linkedOrderIds = parseLinkedOrderIds(req.body?.linkedOrderIds, req.body?.linkedOrderId);
  return createDeliveryTask({
    side: requiredString(req.body?.side, "Side") as DeliveryTask["side"],
    linkedOrderId: linkedOrderIds[0],
    linkedOrderIds,
    mode: requiredString(req.body?.mode, "Mode") as DeliveryTask["mode"],
    from: requiredString(req.body?.from, "From"),
    to: requiredString(req.body?.to, "To"),
    assignedTo: requiredString(req.body?.assignedTo, "Assigned to"),
    pickupAt: optionalString(req.body?.pickupAt),
    dropAt: optionalString(req.body?.dropAt),
    paymentAction: (optionalString(req.body?.paymentAction) || "None") as DeliveryTask["paymentAction"],
    cashCollectionRequired: Boolean(req.body?.cashCollectionRequired),
    status: requiredString(req.body?.status, "Status") as DeliveryTask["status"]
  });
}));

app.patch("/delivery-tasks/:id", (req, res) => wrap(res, () => {
  requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Sales", "Delivery"]);
  const linkedOrderIds = parseLinkedOrderIds(req.body?.linkedOrderIds, req.body?.linkedOrderId);
  return updateDeliveryTask(req.params.id, {
    linkedOrderIds,
    assignedTo: requiredString(req.body?.assignedTo, "Assigned to"),
    pickupAt: optionalString(req.body?.pickupAt),
    dropAt: optionalString(req.body?.dropAt),
    paymentAction: (optionalString(req.body?.paymentAction) || "None") as DeliveryTask["paymentAction"],
    status: requiredString(req.body?.status, "Status") as any,
    cashCollectionRequired: Boolean(req.body?.cashCollectionRequired)
  });
}));

app.post("/notes", (req, res) => wrap(res, () => {
  const currentUser = requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Accounts", "Sales", "Delivery"]);
  return createNote(
    {
      entityType: requiredString(req.body?.entityType, "Entity type") as NoteRecord["entityType"],
      entityId: requiredString(req.body?.entityId, "Entity id"),
      note: requiredString(req.body?.note, "Note"),
      visibility: requiredString(req.body?.visibility, "Visibility") as NoteRecord["visibility"]
    },
    currentUser
  );
}));

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});

function wrap(res: express.Response, run: () => unknown) {
  try {
    res.status(201).json(run());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
}

function requireRole(req: express.Request, allowedRoles: UserRole[]) {
  const user = getCurrentUser(req);
  if (!user || !user.roles.some((role) => allowedRoles.includes(role))) {
    throw new Error("You are not allowed to perform this action.");
  }
  return user;
}

function getCurrentUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("Session token missing.");
  }
  const user = getUserBySessionToken(token);
  if (!user) {
    throw new Error("Session expired. Login again.");
  }
  return {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    roles: user.roles
  };
}

function parseLinkedOrderIds(value: unknown, fallbackValue?: unknown) {
  if (Array.isArray(value)) {
    const ids = value.map((item) => String(item).trim()).filter(Boolean);
    if (ids.length > 0) return ids;
  }
  const text = String(value || fallbackValue || "").trim();
  if (!text) {
    throw new Error("At least one linked order is required.");
  }
  return text.split(",").map((item) => item.trim()).filter(Boolean);
}

function getBearerToken(req: express.Request) {
  const auth = String(req.header("authorization") || "");
  if (!auth.startsWith("Bearer ")) {
    return "";
  }
  return auth.slice(7).trim();
}

function requiredString(value: unknown, label: string) {
  const text = String(value || "").trim();
  if (!text) {
    throw new Error(`${label} is required.`);
  }
  return text;
}

function optionalString(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function requiredNumber(value: unknown, label: string) {
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return num;
}

function requiredStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one item.`);
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function normalizeSlabs(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one slab is required.");
  }
  return value.map((item) => ({
    minQuantity: requiredNumber(item?.minQuantity, "Slab min quantity"),
    maxQuantity: item?.maxQuantity === undefined || item?.maxQuantity === null || item?.maxQuantity === "" ? undefined : requiredNumber(item.maxQuantity, "Slab max quantity"),
    purchaseRate: requiredNumber(item?.purchaseRate, "Slab rate")
  })) as ProductSlab[];
}

function parseCsvRows(csv: string) {
  const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
  if (!header) {
    throw new Error("CSV file is empty.");
  }
  const headers = header.split(",").map((item) => item.trim());
  const defaultWarehouseIds = getSnapshot().warehouses.map((item) => item.id);
  return lines.map((line) => {
    const cols = line.split(",").map((item) => item.trim());
    const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])) as Record<string, string>;
    const barcode = readMapped(row, ["sku", "SKU", "BARCODE"]);
    const name = readMapped(row, ["name", "NAME", "ITEM NAME", "ARTICLE_NAME"]);
    const division = readMapped(row, ["division", "DIVISION"]);
    const department = readMapped(row, ["department", "DEPARTMENT"]);
    const section = readMapped(row, ["section", "SECTION"]);
    const category = readMapped(row, ["category", "CATEGORY 6", "REMARKS"], "General");
    const unit = readMapped(row, ["unit", "UNIT", "SIZE"], "Unit");
    const rspText = readMapped(row, ["rsp", "RSP"], "0");
    const mrpText = readMapped(row, ["mrp", "MRP"], "0");
    const slabsText = readMapped(row, ["slabs", "SLABS"]);
    return {
      sku: requiredString(barcode || name, "SKU"),
      name: requiredString(name, "Product name"),
      division: requiredString(division, "Division"),
      department: requiredString(department, "Department"),
      section: requiredString(section, "Section"),
      category: requiredString(category, "Category"),
      unit: requiredString(unit, "Unit"),
      defaultWeightKg: requiredNumber(readMapped(row, ["defaultWeightKg", "DEFAULT_WEIGHT_KG"], "0"), "Default weight"),
      toleranceKg: requiredNumber(readMapped(row, ["toleranceKg", "TOLERANCE_KG"], "0"), "Tolerance kg"),
      tolerancePercent: requiredNumber(readMapped(row, ["tolerancePercent", "TOLERANCE_PERCENT"], "0"), "Tolerance percent"),
      allowedWarehouseIds: readMapped(row, ["allowedWarehouseIds", "ALLOWED_WAREHOUSE_IDS"])
        .split("|")
        .map((item) => item.trim())
        .filter(Boolean).length > 0
        ? readMapped(row, ["allowedWarehouseIds", "ALLOWED_WAREHOUSE_IDS"]).split("|").map((item) => item.trim()).filter(Boolean)
        : defaultWarehouseIds,
      slabs: slabsText ? parseCsvSlabs(slabsText) : [{ minQuantity: 1, purchaseRate: requiredNumber(rspText, "RSP") }],
      remarks: readMapped(row, ["REMARKS"]),
      category6: readMapped(row, ["CATEGORY 6", "CAT-6"]),
      siteName: readMapped(row, ["SITE NAME", "MKT"]),
      barcode,
      supplierName: "",
      hsnCode: readMapped(row, ["HSN CODE"]),
      articleName: readMapped(row, ["ARTICLE_NAME"]),
      itemName: readMapped(row, ["ITEM NAME"]),
      brand: readMapped(row, ["BRAND"]),
      shortName: readMapped(row, ["NAME"]),
      size: readMapped(row, ["SIZE"]),
      rsp: Number(rspText || 0),
      mrp: Number(mrpText || 0)
    };
  });
}

function readMapped(row: Record<string, string>, keys: string[], fallback = "") {
  for (const key of keys) {
    const value = String(row[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return fallback;
}

function parseCsvSlabs(value: string): ProductSlab[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const [rangeText, rateText] = item.split(":").map((part) => part.trim());
      const purchaseRate = requiredNumber(rateText, "Slab rate");
      if (rangeText.endsWith("+")) {
        return {
          minQuantity: requiredNumber(rangeText.replace("+", ""), "Slab min quantity"),
          purchaseRate
        };
      }
      const [minQuantity, maxQuantity] = rangeText.split("-").map((part) => requiredNumber(part, "Slab quantity"));
      return { minQuantity, maxQuantity, purchaseRate };
    });
}
