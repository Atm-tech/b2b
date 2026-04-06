import cors from "cors";
import express from "express";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import multer from "multer";
import type { CounterpartyType, DeliveryTask, NoteRecord, PaymentMethodSetting, PaymentMode, UserRole, Warehouse } from "@aapoorti-b2b/domain";
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
import { isWorkbookFile, parseCsvRows, parseWorkbookRows } from "./product-import.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8080);
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads"));
const csvDir = path.join(uploadsDir, "csv");
const paymentDir = path.join(uploadsDir, "payment-proofs");
const deliveryDir = path.join(uploadsDir, "delivery-proofs");
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "2mb";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

mkdirSync(csvDir, { recursive: true });
mkdirSync(paymentDir, { recursive: true });
mkdirSync(deliveryDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, file, cb) => {
      cb(null, file.fieldname === "csv" ? csvDir : file.fieldname === "deliveryProof" ? deliveryDir : paymentDir);
    },
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
      cb(null, `${Date.now()}-${safeName}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024)
  }
});

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(cors({
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed by CORS."));
  },
  credentials: true
}));
app.use(express.json({ limit: requestBodyLimit }));
app.use("/uploads", express.static(uploadsDir, {
  fallthrough: false,
  maxAge: isProduction ? "7d" : 0
}));

app.get("/", (_req, res) => {
  res.json({
    name: "Aapoorti B2B Platform API",
    version: "0.4.0",
    environment: process.env.NODE_ENV || "development",
    databasePath: isProduction ? undefined : databasePath
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "api",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime())
  });
});

app.post("/auth/login", async (req, res) => {
  const user = await authenticate(requiredString(req.body?.username, "Username"), requiredString(req.body?.password, "Password"));
  if (!user) {
    res.status(401).json({ message: "Invalid credentials." });
    return;
  }
  const token = await createSessionForUser(user.id);
  res.json({ user, token, snapshot: await getSnapshot() });
});

app.post("/auth/logout", async (req, res) => wrap(res, async () => {
  const token = getBearerToken(req);
  if (token) {
    await deleteSession(token);
  }
  return { ok: true };
}));

app.get("/snapshot", async (req, res) => {
  try {
    await getCurrentUser(req);
    res.json(await getSnapshot());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized.";
    res.status(401).json({ message });
  }
});

app.post("/users", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
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

app.post("/warehouses", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
  return createWarehouse({
    id: requiredString(req.body?.id, "Warehouse code"),
    name: requiredString(req.body?.name, "Warehouse name"),
    city: requiredString(req.body?.city, "City"),
    address: requiredString(req.body?.address, "Address"),
    type: requiredString(req.body?.type, "Type") as Warehouse["type"]
  });
}));

app.post("/products", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin"]);
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

app.post("/products/bulk", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin"]);
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

app.post("/products/bulk-upload", upload.single("csv"), async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin"]);
  if (!req.file) {
    throw new Error("CSV file is required.");
  }
  const defaultWarehouseIds = (await getSnapshot()).warehouses.map((item) => item.id);
  const rows = isWorkbookFile(req.file.originalname)
    ? parseWorkbookRows(req.file.path, defaultWarehouseIds)
    : parseCsvRows(readFileSync(req.file.path, "utf8"), defaultWarehouseIds);
  return bulkCreateProducts(rows, currentUser);
}));

app.post("/counterparties", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Purchaser", "Sales"]);
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

app.patch("/counterparties/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Purchaser", "Sales"]);
  return updateCounterparty(req.params.id, {
    name: requiredString(req.body?.name, "Name"),
    gstNumber: optionalString(req.body?.gstNumber) || "",
    mobileNumber: requiredString(req.body?.mobileNumber, "Mobile number"),
    address: requiredString(req.body?.address, "Address"),
    city: requiredString(req.body?.city, "City"),
    contactPerson: requiredString(req.body?.contactPerson, "Contact person")
  });
}));

app.post("/settings", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
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

app.post("/purchase-orders", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Purchaser"]);
  return createPurchaseOrder(
    {
      supplierId: requiredString(req.body?.supplierId, "Supplier"),
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantityOrdered: requiredNumber(req.body?.quantityOrdered, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      previousRate: typeof req.body?.previousRate === "number" ? req.body.previousRate : undefined,
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      note: optionalString(req.body?.note) || ""
    },
    currentUser
  );
}));

app.patch("/purchase-orders/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Purchaser", "Accounts"]);
  return updatePurchaseOrder(req.params.id, {
    rate: requiredNumber(req.body?.rate, "Rate"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
    note: optionalString(req.body?.note) || "",
    status: requiredString(req.body?.status, "Status") as any
  });
}));

app.post("/sales-orders", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Sales"]);
  return createSalesOrder(
    {
      shopId: requiredString(req.body?.shopId, "Shop"),
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantity: requiredNumber(req.body?.quantity, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      minimumAllowedRate: typeof req.body?.minimumAllowedRate === "number" ? req.body.minimumAllowedRate : undefined,
      priceApprovalRequested: Boolean(req.body?.priceApprovalRequested),
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
      note: optionalString(req.body?.note) || ""
    },
    currentUser
  );
}));

app.patch("/sales-orders/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Sales", "Accounts"]);
  return updateSalesOrder(req.params.id, {
    rate: requiredNumber(req.body?.rate, "Rate"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
    note: optionalString(req.body?.note) || "",
    status: requiredString(req.body?.status, "Status") as any
  });
}));

app.post("/payments", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Accounts", "Purchaser", "Sales"]);
  const referenceNumber = currentUser.roles.includes("Accounts")
    ? requiredString(req.body?.referenceNumber, "Reference number")
    : optionalString(req.body?.referenceNumber) || "";
  return createPayment(
    {
      side: requiredString(req.body?.side, "Side") as "Purchase" | "Sales",
      linkedOrderId: requiredString(req.body?.linkedOrderId, "Linked order"),
      amount: requiredNumber(req.body?.amount, "Amount"),
      mode: requiredString(req.body?.mode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      referenceNumber,
      voucherNumber: optionalString(req.body?.voucherNumber),
      utrNumber: optionalString(req.body?.utrNumber),
      proofName: optionalString(req.body?.proofName),
      verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected",
      verificationNote: optionalString(req.body?.verificationNote)
    },
    currentUser
  );
}));

app.patch("/payments/:id", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Accounts", "Purchaser", "Sales"]);
  const referenceNumber = currentUser.roles.includes("Accounts")
    ? requiredString(req.body?.referenceNumber, "Reference number")
    : optionalString(req.body?.referenceNumber) || "";
  return updatePayment(req.params.id, {
    amount: requiredNumber(req.body?.amount, "Amount"),
    referenceNumber,
    voucherNumber: optionalString(req.body?.voucherNumber),
    utrNumber: optionalString(req.body?.utrNumber),
    proofName: optionalString(req.body?.proofName),
    verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as any,
    verificationNote: optionalString(req.body?.verificationNote) || ""
  }, currentUser);
}));

app.post("/payments/upload-proof", upload.single("proof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Accounts", "Purchaser", "Sales"]);
  if (!req.file) {
    throw new Error("Proof file is required.");
  }
  return {
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: `/uploads/payment-proofs/${req.file.filename}`
  };
}));

app.post("/delivery-tasks/upload-proof", upload.single("deliveryProof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Warehouse Manager", "Delivery"]);
  if (!req.file) {
    throw new Error("Delivery proof file is required.");
  }
  return {
    fileName: req.file.filename,
    originalName: req.file.originalname,
    fileUrl: `/uploads/delivery-proofs/${req.file.filename}`
  };
}));

app.post("/payments/verify", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Accounts"]);
  return verifyPayment(
    requiredString(req.body?.paymentId, "Payment id"),
    requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected",
    optionalString(req.body?.verificationNote) || "",
    currentUser
  );
}));

app.post("/receipt-checks", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Warehouse Manager"]);
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

app.patch("/receipt-checks/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Warehouse Manager", "Accounts"]);
  return updateReceiptCheck(req.params.id, {
    note: optionalString(req.body?.note) || "",
    flagged: Boolean(req.body?.flagged)
  });
}));

app.post("/delivery-tasks", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Sales", "Delivery"]);
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
    routeHint: optionalString(req.body?.routeHint),
    paymentAction: (optionalString(req.body?.paymentAction) || "None") as DeliveryTask["paymentAction"],
    cashCollectionRequired: Boolean(req.body?.cashCollectionRequired),
    cashHandoverMarked: Boolean(req.body?.cashHandoverMarked),
    weightProofName: optionalString(req.body?.weightProofName),
    cashProofName: optionalString(req.body?.cashProofName),
    lastActionAt: optionalString(req.body?.lastActionAt),
    status: requiredString(req.body?.status, "Status") as DeliveryTask["status"]
  });
}));

app.patch("/delivery-tasks/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Sales", "Delivery"]);
  const linkedOrderIds = parseLinkedOrderIds(req.body?.linkedOrderIds, req.body?.linkedOrderId);
  return updateDeliveryTask(req.params.id, {
    linkedOrderIds,
    assignedTo: requiredString(req.body?.assignedTo, "Assigned to"),
    pickupAt: optionalString(req.body?.pickupAt),
    dropAt: optionalString(req.body?.dropAt),
    routeHint: optionalString(req.body?.routeHint),
    paymentAction: (optionalString(req.body?.paymentAction) || "None") as DeliveryTask["paymentAction"],
    status: requiredString(req.body?.status, "Status") as any,
    cashCollectionRequired: Boolean(req.body?.cashCollectionRequired),
    cashHandoverMarked: Boolean(req.body?.cashHandoverMarked),
    weightProofName: optionalString(req.body?.weightProofName),
    cashProofName: optionalString(req.body?.cashProofName),
    lastActionAt: optionalString(req.body?.lastActionAt)
  });
}));

app.post("/notes", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin", "Warehouse Manager", "Purchaser", "Accounts", "Sales", "Delivery"]);
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
  console.log(`API listening on port ${port} (${process.env.NODE_ENV || "development"})`);
});

async function wrap(res: express.Response, run: () => Promise<unknown>) {
  try {
    res.status(201).json(await run());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
}

async function requireRole(req: express.Request, allowedRoles: UserRole[]) {
  const user = await getCurrentUser(req);
  if (!user || !user.roles.some((role) => allowedRoles.includes(role))) {
    throw new Error("You are not allowed to perform this action.");
  }
  return user;
}

async function getCurrentUser(req: express.Request) {
  const token = getBearerToken(req);
  if (!token) {
    throw new Error("Session token missing.");
  }
  const user = await getUserBySessionToken(token);
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
  }));
}
