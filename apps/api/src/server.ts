import cors from "cors";
import compression from "compression";
import express from "express";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import multer from "multer";
import type { CounterpartyType, DeliveryTask, NoteRecord, PaymentMethodSetting, PaymentMode, ProductMaster, UserRole, Warehouse } from "@aapoorti-b2b/domain";
import {
  authenticate,
  clearGoodsWarrants,
  bulkCreateProducts,
  clearSalesOperationalData,
  clearPurchaseAdvancePayments,
  createSessionForUser,
  createCounterparty,
  createSalesDockets,
  createBulkGoodsWarrants,
  createDeliveryConsignment,
  createDeliveryTask,
  createVoiceTrainingExample,
  createGoodsWarrant,
  updateGoodsWarrant,
  mergeDeliveryTasks,
  createNote,
  createPayment,
  createPurchaseAdvancePayment,
  createProduct,
  createPurchaseCart,
  createPurchaseOrder,
  createReceiptCheck,
  createPurchaseReturn,
  createSalesCart,
  createSalesOrder,
  createSalesReturn,
  createUser,
  createWarehouse,
  databasePath,
  deleteProduct,
  deleteSession,
  deleteVoiceTrainingExample,
  getSnapshot,
  getVoiceTrainingAudio,
  getVoiceTrainingExamples,
  getUserBySessionToken,
  updateCounterparty,
  updateDeliveryTask,
  updatePayment,
  updateProduct,
  updatePurchaseOrder,
  updateReceiptCheck,
  updateSalesOrder,
  updateSalesOrderGroup,
  updateSettings,
  updateVoiceTrainingExample,
  verifyPayment
} from "./db.js";
import { isWorkbookFile, parseCsvRows, parseWorkbookRows } from "./product-import.js";
import { getProofObject, putProofObject, r2Enabled, type ProofCategory } from "./object-storage.js";
import { runAssistant } from "./assistant-service.js";
import { transcribeLocalAudio, warmLocalSpeechModel } from "./local-speech.js";
import {
  createWhatsAppOffer,
  getWhatsAppCatalogFeed,
  getWhatsAppDashboard,
  handleWhatsAppWebhook,
  reviewWhatsAppDraft,
  saveWhatsAppPriceRule,
  saveWhatsAppRetailer,
  sendWhatsAppInvoiceSummary,
  subscribeWhatsAppBusinessAccount,
  verifyWhatsAppSignature,
  verifyWhatsAppWebhook
} from "./whatsapp-integration.js";

const app = express();
const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 8080);
const uploadsDir = path.resolve(process.env.UPLOADS_DIR || path.resolve(process.cwd(), "uploads"));
const csvDir = path.join(uploadsDir, "csv");
const paymentDir = path.join(uploadsDir, "payment-proofs");
const deliveryDir = path.join(uploadsDir, "delivery-proofs");
const receiptDir = path.join(uploadsDir, "receipt-proofs");
const returnDir = path.join(uploadsDir, "return-proofs");
const goodsWarrantLogoPath = path.resolve("D:/AAPOORTI/ASSETS/Apoorti Logo/Aapurti Mart Logo.png");
const assistantAudioDir = path.join(uploadsDir, "assistant-audio");
const requestBodyLimit = process.env.REQUEST_BODY_LIMIT || "2mb";
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

function isLocalDevelopmentOrigin(origin: string) {
  if (isProduction) return false;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.")) return true;
    if (hostname.startsWith("10.") || hostname.startsWith("192.168.")) return true;
    const match = hostname.match(/^172\.(\d+)\./);
    return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
  } catch {
    return false;
  }
}

mkdirSync(csvDir, { recursive: true });
mkdirSync(paymentDir, { recursive: true });
mkdirSync(deliveryDir, { recursive: true });
mkdirSync(receiptDir, { recursive: true });
mkdirSync(returnDir, { recursive: true });
mkdirSync(assistantAudioDir, { recursive: true });

const csvUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, csvDir),
    filename: (_req, file, cb) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
      cb(null, `${Date.now()}-${safeName}`);
    }
  }),
  limits: {
    fileSize: Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024)
  }
});

const assistantAudioUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, assistantAudioDir),
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, "") || ".webm";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    }
  }),
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "video/webm"]);
    if (!allowed.has(file.mimetype.split(";")[0])) return cb(new Error("Unsupported assistant audio format."));
    cb(null, true);
  },
  limits: { fileSize: Number(process.env.LOCAL_WHISPER_MAX_AUDIO_BYTES || 12 * 1024 * 1024) }
});

const voiceTrainingUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (_req, file, cb) => {
    const allowed = new Set(["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "video/webm"]);
    if (!allowed.has(file.mimetype.split(";")[0])) return cb(new Error("Unsupported voice training audio format."));
    cb(null, true);
  },
  limits: { fileSize: Number(process.env.VOICE_TRAINING_MAX_AUDIO_BYTES || 4 * 1024 * 1024) }
});

const proofDirectories: Record<ProofCategory, string> = {
  "payment-proofs": paymentDir,
  "delivery-proofs": deliveryDir,
  "receipt-proofs": receiptDir,
  "return-proofs": returnDir
};

const proofFieldCategories: Record<string, ProofCategory> = {
  proof: "payment-proofs",
  deliveryProof: "delivery-proofs",
  receiptProof: "receipt-proofs",
  returnProof: "return-proofs"
};

const allowedProofMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const proofUpload = multer({
  storage: r2Enabled
    ? multer.memoryStorage()
    : multer.diskStorage({
        destination: (_req, file, cb) => cb(null, proofDirectories[proofFieldCategories[file.fieldname] || "payment-proofs"]),
        filename: (_req, file, cb) => {
          const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
          cb(null, `${Date.now()}-${safeName}`);
        }
      }),
  fileFilter: (_req, file, cb) => {
    if (!allowedProofMimeTypes.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WebP, or PDF proof files are allowed."));
      return;
    }
    cb(null, true);
  },
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
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=()");
  if (isProduction) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});
app.use(cors({
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
    if (!origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin) || isLocalDevelopmentOrigin(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed by CORS."));
  },
  credentials: true
}));
app.use(compression({ threshold: 1024 }));
app.use(express.json({
  limit: requestBodyLimit,
  verify: (req, _res, buffer) => {
    (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
  }
}));
if (r2Enabled) {
  app.get("/uploads/:category/:fileName", async (req, res) => {
    const category = req.params.category as ProofCategory;
    if (!(category in proofDirectories) || !/^[a-zA-Z0-9._-]+$/.test(req.params.fileName)) {
      res.status(404).json({ message: "Proof file not found." });
      return;
    }

    const localPath = path.join(proofDirectories[category], req.params.fileName);
    if (existsSync(localPath)) {
      res.sendFile(localPath);
      return;
    }

    try {
      const object = await getProofObject(category, req.params.fileName);
      res.setHeader("Content-Type", object.contentType);
      res.setHeader("Content-Length", String(object.contentLength ?? object.body.length));
      res.setHeader("Cache-Control", "private, max-age=300");
      if (object.etag) res.setHeader("ETag", object.etag);
      res.send(object.body);
    } catch (error) {
      const statusCode = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (statusCode === 404 || (error as { name?: string })?.name === "NoSuchKey") {
        res.status(404).json({ message: "Proof file not found." });
        return;
      }
      console.error("R2 proof read failed", error);
      res.status(502).json({ message: "Proof storage is temporarily unavailable." });
    }
  });
}

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
    uptimeSeconds: Math.round(process.uptime()),
    proofStorage: r2Enabled ? "cloudflare-r2" : "local-filesystem"
  });
});

app.get("/goods-warrants/logo", (_req, res) => {
  if (!existsSync(goodsWarrantLogoPath)) {
    res.status(404).json({ message: "Goods warrant logo not found." });
    return;
  }
  res.sendFile(goodsWarrantLogoPath);
});

app.post("/auth/login", async (req, res) => {
  const user = await authenticate(requiredString(req.body?.username, "Username"), requiredString(req.body?.password, "Password"));
  if (!user) {
    res.status(401).json({ message: "Invalid credentials." });
    return;
  }
  const token = await createSessionForUser(user.id);
  res.json({ user, token, snapshot: await getSnapshot(user) });
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
    const currentUser = await getCurrentUser(req);
    res.json(await getSnapshot(currentUser));
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
    warehouseIds: Array.isArray(req.body?.warehouseIds) ? req.body.warehouseIds.map((item: unknown) => String(item)) : [],
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
      subCategory: requiredString(req.body?.subCategory, "Sub category"),
      unit: requiredString(req.body?.unit, "Unit"),
      defaultGstRate: parseOptionalGstRate(req.body?.defaultGstRate) ?? 0,
      defaultTaxMode: (optionalString(req.body?.defaultTaxMode) || (String(req.body?.defaultGstRate || "").trim().toUpperCase() === "NA" ? "NA" : "Exclusive")) as ProductMaster["defaultTaxMode"],
      defaultWeightKg: requiredNumber(req.body?.defaultWeightKg, "Default weight"),
      toleranceKg: requiredNumber(req.body?.toleranceKg, "Tolerance kg"),
      tolerancePercent: requiredNumber(req.body?.tolerancePercent, "Tolerance percent"),
      allowedWarehouseIds: requiredStringArray(req.body?.allowedWarehouseIds, "Allowed warehouses"),
      slabs: normalizeSlabs(req.body?.slabs, optionalNumber(req.body?.rsp) ?? 0),
      brand: optionalString(req.body?.brand),
      rsp: optionalNumber(req.body?.rsp),
      mrp: optionalNumber(req.body?.mrp),
      isSeasonal: Boolean(req.body?.isSeasonal),
      offerLabel: optionalString(req.body?.offerLabel),
      offerPrice: optionalNumber(req.body?.offerPrice)
    },
    currentUser
  );
}));

app.patch("/products/:sku", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin"]);
  return updateProduct(
    req.params.sku,
    {
      name: requiredString(req.body?.name, "Product name"),
      division: requiredString(req.body?.division, "Division"),
      department: requiredString(req.body?.department, "Department"),
      section: requiredString(req.body?.section, "Section"),
      category: requiredString(req.body?.category, "Category"),
      subCategory: requiredString(req.body?.subCategory, "Sub category"),
      unit: requiredString(req.body?.unit, "Unit"),
      defaultGstRate: parseOptionalGstRate(req.body?.defaultGstRate) ?? 0,
      defaultTaxMode: (optionalString(req.body?.defaultTaxMode) || (String(req.body?.defaultGstRate || "").trim().toUpperCase() === "NA" ? "NA" : "Exclusive")) as ProductMaster["defaultTaxMode"],
      defaultWeightKg: requiredNumber(req.body?.defaultWeightKg, "Default weight"),
      toleranceKg: requiredNumber(req.body?.toleranceKg, "Tolerance kg"),
      tolerancePercent: requiredNumber(req.body?.tolerancePercent, "Tolerance percent"),
      allowedWarehouseIds: requiredStringArray(req.body?.allowedWarehouseIds, "Allowed warehouses"),
      slabs: normalizeSlabs(req.body?.slabs, optionalNumber(req.body?.rsp) ?? 0),
      rsp: optionalNumber(req.body?.rsp),
      mrp: optionalNumber(req.body?.mrp),
      brand: optionalString(req.body?.brand),
      isSeasonal: Boolean(req.body?.isSeasonal),
      offerLabel: optionalString(req.body?.offerLabel),
      offerPrice: optionalNumber(req.body?.offerPrice)
    },
    currentUser
  );
}));

app.delete("/products/:sku", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
  return deleteProduct(req.params.sku);
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
      subCategory: requiredString(row?.subCategory, "Sub category"),
      unit: requiredString(row?.unit, "Unit"),
      defaultGstRate: parseOptionalGstRate(row?.defaultGstRate) ?? 0,
      defaultTaxMode: (optionalString(row?.defaultTaxMode) || (String(row?.defaultGstRate || "").trim().toUpperCase() === "NA" ? "NA" : "Exclusive")) as ProductMaster["defaultTaxMode"],
      defaultWeightKg: requiredNumber(row?.defaultWeightKg, "Default weight"),
      toleranceKg: requiredNumber(row?.toleranceKg, "Tolerance kg"),
      tolerancePercent: requiredNumber(row?.tolerancePercent, "Tolerance percent"),
      allowedWarehouseIds: requiredStringArray(row?.allowedWarehouseIds, "Allowed warehouses"),
      slabs: normalizeSlabs(row?.slabs, optionalNumber(row?.rsp) ?? 0),
      brand: optionalString(row?.brand),
      rsp: optionalNumber(row?.rsp),
      mrp: optionalNumber(row?.mrp),
      isSeasonal: typeof row?.isSeasonal === "boolean" ? row.isSeasonal : /^(1|true|yes|y)$/i.test(String(row?.isSeasonal || "")),
      offerLabel: optionalString(row?.offerLabel),
      offerPrice: optionalNumber(row?.offerPrice)
    })),
    currentUser
  );
}));

app.post("/products/bulk-upload", csvUpload.single("csv"), async (req, res) => wrap(res, async () => {
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
  const currentUser = await requireRole(req, ["Accounts", "Purchaser", "Sales"]);
  return createCounterparty(
    {
      type: requiredString(req.body?.type, "Type") as CounterpartyType,
      name: requiredString(req.body?.name, "Name"),
      gstNumber: requiredString(req.body?.gstNumber, "GST number"),
      bankName: requiredString(req.body?.bankName, "Bank name"),
      bankAccountNumber: requiredString(req.body?.bankAccountNumber, "Bank account number"),
      ifscCode: requiredString(req.body?.ifscCode, "IFSC code"),
      mobileNumber: requiredString(req.body?.mobileNumber, "Mobile number"),
      address: requiredString(req.body?.address, "Address"),
      city: requiredString(req.body?.city, "City"),
      contactPerson: requiredString(req.body?.contactPerson, "Contact person"),
      latitude: optionalNumber(req.body?.latitude),
      longitude: optionalNumber(req.body?.longitude),
      locationLabel: optionalString(req.body?.locationLabel)
    },
    currentUser
  );
}));

app.patch("/counterparties/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Accounts", "Purchaser", "Sales"]);
  return updateCounterparty(req.params.id, {
    name: requiredString(req.body?.name, "Name"),
    gstNumber: requiredString(req.body?.gstNumber, "GST number"),
    bankName: requiredString(req.body?.bankName, "Bank name"),
    bankAccountNumber: requiredString(req.body?.bankAccountNumber, "Bank account number"),
    ifscCode: requiredString(req.body?.ifscCode, "IFSC code"),
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
  const currentUser = await requireRole(req, ["Purchaser"]);
  return createPurchaseOrder(
    {
      supplierId: requiredString(req.body?.supplierId, "Supplier"),
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantityOrdered: requiredNumber(req.body?.quantityOrdered, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      mrp: requiredNumber(req.body?.mrp, "MRP"),
      taxableAmount: optionalNumber(req.body?.taxableAmount),
      gstRate: parseOptionalGstRate(req.body?.gstRate),
      gstAmount: optionalNumber(req.body?.gstAmount),
      taxMode: optionalString(req.body?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined,
      previousRate: typeof req.body?.previousRate === "number" ? req.body.previousRate : undefined,
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      note: optionalString(req.body?.note) || "",
      location: parseOptionalLocation(req.body?.location),
      operationDate: optionalString(req.body?.operationDate),
      advancePayment: parseOptionalAdvancePayment(req.body?.advancePayment)
    },
    currentUser
  );
}));

app.post("/purchase-orders/cart", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Purchaser"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    productSku: requiredString(line?.productSku, "Product"),
    quantityOrdered: requiredNumber(line?.quantityOrdered ?? line?.quantity, "Quantity"),
    rate: requiredNumber(line?.rate, "Rate"),
    mrp: requiredNumber(line?.mrp, "MRP"),
    taxableAmount: optionalNumber(line?.taxableAmount),
    gstRate: parseOptionalGstRate(line?.gstRate) as 0 | 5 | 12 | 18 | 40 | "NA" | undefined,
    gstAmount: optionalNumber(line?.gstAmount),
    taxMode: optionalString(line?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined,
    previousRate: typeof line?.previousRate === "number" ? line.previousRate : optionalNumber(line?.previousRate)
  }));
  return createPurchaseCart({
    supplierId: requiredString(req.body?.supplierId, "Supplier"),
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    note: optionalString(req.body?.note) || "",
    location: parseOptionalLocation(req.body?.location),
    operationDate: optionalString(req.body?.operationDate),
    advancePayment: parseOptionalAdvancePayment(req.body?.advancePayment),
    lines
  }, currentUser);
}));

app.patch("/purchase-orders/:id", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Purchaser", "Admin"]);
  const lines = requiredArray(req.body?.lines, "Cart lines").map((line) => {
    const rawGstRate = optionalString(line?.gstRate);
    const parsedGstRate: "NA" | 0 | 5 | 12 | 18 | 40 | undefined = rawGstRate?.toUpperCase() === "NA" ? "NA" : parseOptionalGstRate(line?.gstRate);
    return {
    id: optionalString(line?.id),
    productSku: requiredString(line?.productSku, "Product"),
    warehouseId: optionalString(line?.warehouseId),
    quantityOrdered: requiredNumber(line?.quantityOrdered ?? line?.quantity, "Quantity"),
    rate: requiredNumber(line?.rate, "Rate"),
    taxableAmount: optionalNumber(line?.taxableAmount),
    gstRate: parsedGstRate,
    gstAmount: optionalNumber(line?.gstAmount),
    taxMode: optionalString(line?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined
  };});
  return updatePurchaseOrder(req.params.id, {
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Dealer Delivery" | "Self Collection",
    note: optionalString(req.body?.note) || "",
    status: requiredString(req.body?.status, "Status") as any,
    lines
  }, currentUser);
}));

app.post("/sales-orders", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Sales"]);
  return createSalesOrder(
    {
      allowProbationarySale: Boolean(req.body?.allowProbationarySale),
      shopId: requiredString(req.body?.shopId, "Shop"),
      billingType: (optionalString(req.body?.billingType) || "").toUpperCase() === "B2B" ? "B2B" : "B2C",
      productSku: requiredString(req.body?.productSku, "Product"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      quantity: requiredNumber(req.body?.quantity, "Quantity"),
      rate: requiredNumber(req.body?.rate, "Rate"),
      cdTodRate: optionalNumber(req.body?.cdTodRate),
      cdAmount: optionalNumber(req.body?.cdAmount),
      todAmount: optionalNumber(req.body?.todAmount),
      taxableAmount: optionalNumber(req.body?.taxableAmount),
      gstRate: parseOptionalGstRate(req.body?.gstRate),
      gstAmount: optionalNumber(req.body?.gstAmount),
      taxMode: optionalString(req.body?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined,
      minimumAllowedRate: typeof req.body?.minimumAllowedRate === "number" ? req.body.minimumAllowedRate : undefined,
      priceApprovalRequested: Boolean(req.body?.priceApprovalRequested),
      availableStockAtOrder: optionalNumber(req.body?.availableStockAtOrder),
      stockApprovalRequested: Boolean(req.body?.stockApprovalRequested),
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
      note: optionalString(req.body?.note) || "",
      location: parseOptionalLocation(req.body?.location),
      operationDate: optionalString(req.body?.operationDate),
      advancePayment: parseOptionalAdvancePayment(req.body?.advancePayment)
    },
    currentUser
  );
}));

app.post("/sales-orders/cart", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Sales"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    productSku: requiredString(line?.productSku, "Product"),
    quantity: requiredNumber(line?.quantity, "Quantity"),
    rate: requiredNumber(line?.rate, "Rate"),
    cdTodRate: optionalNumber(line?.cdTodRate),
    cdAmount: optionalNumber(line?.cdAmount),
    todAmount: optionalNumber(line?.todAmount),
    taxableAmount: optionalNumber(line?.taxableAmount),
    gstRate: parseOptionalGstRate(line?.gstRate) as 0 | 5 | 12 | 18 | 40 | "NA" | undefined,
    gstAmount: optionalNumber(line?.gstAmount),
    taxMode: optionalString(line?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined,
    minimumAllowedRate: typeof line?.minimumAllowedRate === "number" ? line.minimumAllowedRate : optionalNumber(line?.minimumAllowedRate),
    priceApprovalRequested: Boolean(line?.priceApprovalRequested),
    availableStockAtOrder: optionalNumber(line?.availableStockAtOrder),
    stockApprovalRequested: Boolean(line?.stockApprovalRequested),
    note: optionalString(line?.note) || ""
  }));
  return createSalesCart({
    allowProbationarySale: Boolean(req.body?.allowProbationarySale),
    shopId: requiredString(req.body?.shopId, "Shop"),
    billingType: (optionalString(req.body?.billingType) || "").toUpperCase() === "B2B" ? "B2B" : "B2C",
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode: requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery",
    note: optionalString(req.body?.note) || "",
    location: parseOptionalLocation(req.body?.location),
    operationDate: optionalString(req.body?.operationDate),
    advancePayment: parseOptionalAdvancePayment(req.body?.advancePayment),
    lines
  }, currentUser);
}));

app.patch("/sales-orders/:id", async (req, res) => wrap(res, async () => {
  const currentUser = await getCurrentUser(req);
  if (Array.isArray(req.body?.lines)) {
    const lines = requiredArray(req.body?.lines, "Cart lines").map((line) => {
      const rawGstRate = optionalString(line?.gstRate);
      const parsedGstRate: "NA" | 0 | 5 | 12 | 18 | 40 | undefined = rawGstRate?.toUpperCase() === "NA" ? "NA" : parseOptionalGstRate(line?.gstRate);
      return {
        id: optionalString(line?.id),
        productSku: requiredString(line?.productSku, "Product"),
        warehouseId: optionalString(line?.warehouseId),
        quantity: requiredNumber(line?.quantity, "Quantity"),
        rate: requiredNumber(line?.rate, "Rate"),
        cdTodRate: optionalNumber(line?.cdTodRate),
        cdAmount: optionalNumber(line?.cdAmount),
        todAmount: optionalNumber(line?.todAmount),
        taxableAmount: optionalNumber(line?.taxableAmount),
        gstRate: parsedGstRate,
        gstAmount: optionalNumber(line?.gstAmount),
        taxMode: optionalString(line?.taxMode) as "NA" | "Exclusive" | "Inclusive" | undefined
      };
    });
    const deliveryMode = requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery";
    const status = requiredString(req.body?.status, "Status") as any;
    const canEditSalesOrders = currentUser.roles.some((role) => role === "Sales" || role === "Accounts");
    if (!canEditSalesOrders && !currentUser.roles.includes("Admin")) {
      throw new Error("You are not allowed to perform this action.");
    }
    return updateSalesOrderGroup(req.params.id, {
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      deliveryMode,
      note: optionalString(req.body?.note) || "",
      status,
      lines
    }, currentUser);
  }
  const status = requiredString(req.body?.status, "Status") as any;
  const deliveryMode = requiredString(req.body?.deliveryMode, "Delivery mode") as "Self Collection" | "Delivery";
  const canEditSalesOrders = currentUser.roles.some((role) => role === "Sales" || role === "Accounts");
  const canRunWarehouseDispatchFlow =
    currentUser.roles.includes("Warehouse Manager") &&
    (
      status === "Ready for Dispatch" ||
      (deliveryMode === "Self Collection" && (status === "Self Pickup" || status === "Delivered"))
    );
  if (!canEditSalesOrders && !canRunWarehouseDispatchFlow) {
    throw new Error("You are not allowed to perform this action.");
  }
  return updateSalesOrder(req.params.id, {
    rate: requiredNumber(req.body?.rate, "Rate"),
    paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
    deliveryMode,
    note: optionalString(req.body?.note) || "",
    status,
    containerWeightKg: optionalNumber(req.body?.containerWeightKg),
    weighingProofName: optionalString(req.body?.weighingProofName)
  });
}));

app.post("/sales-orders/reset-operational", async (_req, res) => wrap(res, async () => {
  await requireRole(_req, ["Admin"]);
  return clearSalesOperationalData();
}));

app.post("/payments", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Accounts", "Purchaser", "Sales", "Collection Agent"]);
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
      verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved",
      verificationNote: optionalString(req.body?.verificationNote),
      operationDate: optionalString(req.body?.operationDate)
    },
    currentUser
  );
}));

app.post("/payments/purchase-advance", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Accounts"]);
  return createPurchaseAdvancePayment(
    {
      supplierId: requiredString(req.body?.supplierId, "Supplier"),
      amount: requiredNumber(req.body?.amount, "Amount"),
      mode: requiredString(req.body?.mode, "Payment mode") as PaymentMode,
      cashTiming: optionalString(req.body?.cashTiming) as "In Hand" | "At Delivery" | undefined,
      referenceNumber: requiredString(req.body?.referenceNumber, "Reference number"),
      voucherNumber: optionalString(req.body?.voucherNumber),
      utrNumber: optionalString(req.body?.utrNumber),
      proofName: optionalString(req.body?.proofName),
      verificationStatus: requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved",
      verificationNote: optionalString(req.body?.verificationNote),
      operationDate: optionalString(req.body?.operationDate)
    },
    currentUser
  );
}));

app.delete("/payments/purchase-advance", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin", "Accounts"]);
  return clearPurchaseAdvancePayments();
}));

app.patch("/payments/:id", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Accounts", "Purchaser", "Sales", "Collection Agent"]);
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
    verificationNote: optionalString(req.body?.verificationNote) || "",
    operationDate: optionalString(req.body?.operationDate)
  }, currentUser);
}));

app.post("/payments/upload-proof", proofUpload.single("proof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Accounts", "Purchaser", "Sales", "Collection Agent"]);
  if (!req.file) {
    throw new Error("Proof file is required.");
  }
  const fileName = await storeProofFile("payment-proofs", req.file);
  return {
    fileName,
    originalName: req.file.originalname,
    fileUrl: `/uploads/payment-proofs/${fileName}`
  };
}));

app.post("/delivery-tasks/upload-proof", proofUpload.single("deliveryProof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Delivery Manager", "In Delivery", "Out Delivery", "Delivery"]);
  if (!req.file) {
    throw new Error("Delivery proof file is required.");
  }
  const fileName = await storeProofFile("delivery-proofs", req.file);
  return {
    fileName,
    originalName: req.file.originalname,
    fileUrl: `/uploads/delivery-proofs/${fileName}`
  };
}));

app.post("/receipt-checks/upload-proof", proofUpload.single("receiptProof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Warehouse Manager"]);
  if (!req.file) {
    throw new Error("Weighing proof file is required.");
  }
  const fileName = await storeProofFile("receipt-proofs", req.file);
  return {
    fileName,
    originalName: req.file.originalname,
    fileUrl: `/uploads/receipt-proofs/${fileName}`
  };
}));

app.post("/returns/upload-proof", proofUpload.single("returnProof"), async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Purchaser", "Sales"]);
  if (!req.file) {
    throw new Error("Return proof file is required.");
  }
  const fileName = await storeProofFile("return-proofs", req.file);
  return {
    fileName,
    originalName: req.file.originalname,
    fileUrl: `/uploads/return-proofs/${fileName}`
  };
}));

app.post("/payments/verify", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Accounts"]);
  return verifyPayment(
    requiredString(req.body?.paymentId, "Payment id"),
    requiredString(req.body?.verificationStatus, "Verification status") as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved",
    optionalString(req.body?.verificationNote) || "",
    currentUser
  );
}));

app.post("/goods-warrants", async (req, res) => {
  try {
    const currentUser = await requireRole(req, ["Accounts"]);
    const result = await createGoodsWarrant(
      {
        outlet: requiredString(req.body?.outlet, "Outlet") as any,
        issuedTo: optionalString(req.body?.issuedTo),
        issuerName: optionalString(req.body?.issuerName),
        amount: requiredNumber(req.body?.amount, "Amount"),
        paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as "Cash" | "Cheque",
        chequeNumber: optionalString(req.body?.chequeNumber),
        cashCollectedOn: optionalString(req.body?.cashCollectedOn),
        validThrough: requiredString(req.body?.validThrough, "Valid through"),
        note: optionalString(req.body?.note)
      },
      currentUser
    );
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
});

app.post("/goods-warrants/bulk", async (req, res) => {
  try {
    const currentUser = await requireRole(req, ["Accounts"]);
    const result = await createBulkGoodsWarrants(
      {
        outlet: requiredString(req.body?.outlet, "Outlet") as any,
        issuedTo: optionalString(req.body?.issuedTo),
        issuerName: optionalString(req.body?.issuerName),
        receivedAmount: requiredNumber(req.body?.receivedAmount, "Received amount"),
        totalAmount: requiredNumber(req.body?.totalAmount, "Total amount"),
        denominationAmount: requiredNumber(req.body?.denominationAmount, "Voucher denomination"),
        allowedPerMonth: req.body?.allowedPerMonth === undefined ? undefined : requiredNumber(req.body?.allowedPerMonth, "Allowed vouchers per month"),
        paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as "Cash" | "Cheque",
        chequeNumber: optionalString(req.body?.chequeNumber),
        cashCollectedOn: optionalString(req.body?.cashCollectedOn),
        issueStartOn: requiredString(req.body?.issueStartOn, "First issue date"),
        note: optionalString(req.body?.note)
      },
      currentUser
    );
    res.status(201).json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
});

app.put("/goods-warrants/:id", async (req, res) => {
  try {
    await requireRole(req, ["Accounts"]);
    const result = await updateGoodsWarrant({
      id: requiredString(req.params?.id, "Voucher id"),
      issuedTo: optionalString(req.body?.issuedTo),
      issuerName: optionalString(req.body?.issuerName),
      receivedAmount: requiredNumber(req.body?.receivedAmount, "Received amount"),
      amount: requiredNumber(req.body?.amount, "Voucher amount"),
      paymentMode: requiredString(req.body?.paymentMode, "Payment mode") as "Cash" | "Cheque",
      chequeNumber: optionalString(req.body?.chequeNumber),
      cashCollectedOn: optionalString(req.body?.cashCollectedOn),
      validThrough: requiredString(req.body?.validThrough, "Valid through"),
      note: optionalString(req.body?.note)
    });
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
});

app.delete("/goods-warrants", async (req, res) => {
  try {
    await requireRole(req, ["Accounts"]);
    const result = await clearGoodsWarrants();
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    res.status(400).json({ message });
  }
});

app.post("/receipt-checks", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Warehouse Manager"]);
  return createReceiptCheck(
    {
      purchaseOrderId: requiredString(req.body?.purchaseOrderId, "Purchase order"),
      warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
      receivedQuantity: requiredNumber(req.body?.receivedQuantity, "Received quantity"),
      actualWeightKg: requiredNumber(req.body?.actualWeightKg, "Actual weight"),
      containerWeightKg: optionalNumber(req.body?.containerWeightKg) ?? 0,
      weighingProofName: optionalString(req.body?.weighingProofName),
      cashProofName: optionalString(req.body?.cashProofName),
      note: requiredString(req.body?.note, "Note"),
      confirmPartial: Boolean(req.body?.confirmPartial),
      operationDate: optionalString(req.body?.operationDate)
    },
    currentUser
  );
}));

app.patch("/receipt-checks/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Warehouse Manager", "Accounts"]);
  return updateReceiptCheck(req.params.id, {
    note: optionalString(req.body?.note) || "",
    flagged: Boolean(req.body?.flagged)
  });
}));

app.post("/purchase-returns", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Purchaser"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    linkedOrderLineId: optionalString(line?.linkedOrderLineId),
    productSku: requiredString(line?.productSku, "Product"),
    quantity: requiredNumber(line?.quantity, "Quantity"),
    rate: requiredNumber(line?.rate, "Rate"),
    reason: requiredString(line?.reason, "Reason") as any,
    photoName: optionalString(line?.photoName)
  }));
  return createPurchaseReturn({
    mode: requiredString(req.body?.mode, "Mode") as "Adhoc" | "Planned",
    linkedOrderId: optionalString(req.body?.linkedOrderId),
    supplierId: requiredString(req.body?.supplierId, "Supplier"),
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    note: optionalString(req.body?.note) || "",
    lines
  }, currentUser);
}));

app.post("/sales-returns", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Sales"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    linkedOrderLineId: optionalString(line?.linkedOrderLineId),
    productSku: requiredString(line?.productSku, "Product"),
    quantity: requiredNumber(line?.quantity, "Quantity"),
    rate: requiredNumber(line?.rate, "Rate"),
    reason: requiredString(line?.reason, "Reason") as any,
    photoName: optionalString(line?.photoName)
  }));
  return createSalesReturn({
    mode: requiredString(req.body?.mode, "Mode") as "Adhoc" | "Planned",
    linkedOrderId: optionalString(req.body?.linkedOrderId),
    shopId: requiredString(req.body?.shopId, "Shop"),
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    note: optionalString(req.body?.note) || "",
    lines
  }, currentUser);
}));

app.post("/delivery-tasks", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Delivery Manager", "Accounts"]);
  const linkedOrderIds = parseLinkedOrderIds(req.body?.linkedOrderIds, req.body?.linkedOrderId);
  return createDeliveryTask({
    side: requiredString(req.body?.side, "Side") as DeliveryTask["side"],
    linkedOrderId: linkedOrderIds[0],
    linkedOrderIds,
    consignmentId: optionalString(req.body?.consignmentId),
    mode: requiredString(req.body?.mode, "Mode") as DeliveryTask["mode"],
    transportType: (optionalString(req.body?.transportType) || "Internal") as DeliveryTask["transportType"],
    vehicleNumber: optionalString(req.body?.vehicleNumber),
    freightAmount: req.body?.freightAmount === undefined ? undefined : Number(req.body?.freightAmount || 0),
    from: requiredString(req.body?.from, "From"),
    to: requiredString(req.body?.to, "To"),
    assignedTo: requiredString(req.body?.assignedTo, "Assigned to"),
    routeStops: Array.isArray(req.body?.routeStops) ? req.body.routeStops : [],
    pickupAt: optionalString(req.body?.pickupAt),
    dropAt: optionalString(req.body?.dropAt),
    routeHint: optionalString(req.body?.routeHint),
    paymentAction: (optionalString(req.body?.paymentAction) || "None") as DeliveryTask["paymentAction"],
    cashCollectionRequired: Boolean(req.body?.cashCollectionRequired),
    cashHandoverMarked: Boolean(req.body?.cashHandoverMarked),
    weightProofName: optionalString(req.body?.weightProofName),
    cashProofName: optionalString(req.body?.cashProofName),
    lastActionAt: optionalString(req.body?.lastActionAt),
    status: requiredString(req.body?.status, "Status") as DeliveryTask["status"],
    operationDate: optionalString(req.body?.operationDate)
  });
}));

app.patch("/delivery-tasks/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Warehouse Manager", "Delivery Manager", "In Delivery", "Out Delivery", "Delivery"]);
  const linkedOrderIds = parseLinkedOrderIds(req.body?.linkedOrderIds, req.body?.linkedOrderId);
  return updateDeliveryTask(req.params.id, {
    linkedOrderIds,
    consignmentId: optionalString(req.body?.consignmentId),
    assignedTo: requiredString(req.body?.assignedTo, "Assigned to"),
    transportType: (optionalString(req.body?.transportType) || "Internal") as DeliveryTask["transportType"],
    vehicleNumber: optionalString(req.body?.vehicleNumber),
    freightAmount: req.body?.freightAmount === undefined ? undefined : Number(req.body?.freightAmount || 0),
    routeStops: Array.isArray(req.body?.routeStops) ? req.body.routeStops : [],
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

app.post("/delivery-tasks/merge", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Delivery Manager"]);
  return mergeDeliveryTasks(requiredStringArray(req.body?.taskIds, "Delivery tasks"));
}));

app.post("/delivery-dockets", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Warehouse Manager"]);
  return createSalesDockets({
    linkedOrderIds: requiredStringArray(req.body?.linkedOrderIds, "Sales orders"),
    operationDate: optionalString(req.body?.operationDate)
  }, currentUser);
}));

app.post("/delivery-consignments", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Delivery Manager"]);
  return createDeliveryConsignment({
    docketIds: requiredStringArray(req.body?.docketIds, "Dockets"),
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    assignedTo: optionalString(req.body?.assignedTo) || "",
    status: (optionalString(req.body?.status) || "Ready") as any,
    operationDate: optionalString(req.body?.operationDate)
  }, currentUser);
}));

app.post("/notes", async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Warehouse Manager", "Delivery Manager", "Purchaser", "Accounts", "Sales", "In Delivery", "Out Delivery", "Delivery"]);
  return createNote(
    {
      entityType: requiredString(req.body?.entityType, "Entity type") as NoteRecord["entityType"],
      entityId: requiredString(req.body?.entityId, "Entity id"),
      note: requiredString(req.body?.note, "Note"),
      visibility: requiredString(req.body?.visibility, "Visibility") as NoteRecord["visibility"],
      operationDate: optionalString(req.body?.operationDate)
    },
    currentUser
  );
}));

app.get("/assistant/training-examples", async (req, res) => {
  try {
    await requireRole(req, ["Admin"]);
    res.json(await getVoiceTrainingExamples());
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Could not load voice training examples." });
  }
});

app.get("/whatsapp/webhook", (req, res) => {
  if (!verifyWhatsAppWebhook(req.query as Record<string, unknown>)) {
    res.status(403).send("Webhook verification failed.");
    return;
  }
  res.status(200).send(String(req.query["hub.challenge"] || ""));
});

app.post("/whatsapp/webhook", (req, res) => {
  const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody || Buffer.from(JSON.stringify(req.body || {}));
  if (!verifyWhatsAppSignature(rawBody, String(req.header("x-hub-signature-256") || ""))) {
    res.status(401).json({ message: "Invalid WhatsApp webhook signature." });
    return;
  }
  res.sendStatus(200);
  void handleWhatsAppWebhook((req.body || {}) as Record<string, unknown>).catch((error) => {
    console.error("WhatsApp webhook processing failed", error);
  });
});

app.get("/whatsapp/catalog/feed.csv", async (req, res) => {
  try {
    const csv = await getWhatsAppCatalogFeed(String(req.query.token || ""));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(csv);
  } catch (error) {
    res.status(403).json({ message: error instanceof Error ? error.message : "Catalogue feed unavailable." });
  }
});

app.get("/whatsapp/dashboard", async (req, res) => {
  try {
    const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales"]);
    res.json(await getWhatsAppDashboard(currentUser));
  } catch (error) {
    res.status(403).json({ message: error instanceof Error ? error.message : "Access denied." });
  }
});

app.post("/whatsapp/setup/subscribe", async (req, res) => wrap(res, async () => {
  await requireWhatsAppPilot(req, ["Admin", "Sales"]);
  return subscribeWhatsAppBusinessAccount();
}));

app.post("/whatsapp/retailers", async (req, res) => wrap(res, async () => {
  const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales"]);
  const salesmanId = requiredNumber(req.body?.salesmanId, "Salesperson");
  if (!currentUser.roles.includes("Admin") && salesmanId !== currentUser.id) throw new Error("You can only map retailers to yourself.");
  return saveWhatsAppRetailer({
    counterpartyId: requiredString(req.body?.counterpartyId, "Retailer"),
    phone: requiredString(req.body?.phone, "WhatsApp number"),
    salesmanId,
    defaultWarehouseId: requiredString(req.body?.defaultWarehouseId, "Warehouse"),
    billingType: String(req.body?.billingType || "B2B") === "B2C" ? "B2C" : "B2B",
    paymentMode: requiredString(req.body?.paymentMode || "NEFT", "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming),
    deliveryMode: String(req.body?.deliveryMode || "Delivery") === "Self Collection" ? "Self Collection" : "Delivery",
    optedIn: Boolean(req.body?.optedIn),
    active: req.body?.active !== false
  }, currentUser);
}));

app.post("/whatsapp/price-rules", async (req, res) => wrap(res, async () => {
  const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales"]);
  return saveWhatsAppPriceRule({
    counterpartyId: requiredString(req.body?.counterpartyId, "Retailer"),
    productSku: requiredString(req.body?.productSku, "Product"),
    specialRate: requiredNumber(req.body?.specialRate, "Special rate"),
    cdPercent: optionalNumber(req.body?.cdPercent) || 0,
    todPercent: optionalNumber(req.body?.todPercent) || 0,
    minimumQuantity: optionalNumber(req.body?.minimumQuantity) || 1,
    validUntil: optionalString(req.body?.validUntil),
    active: req.body?.active !== false
  }, currentUser);
}));

app.post("/whatsapp/offers", async (req, res) => wrap(res, async () => {
  const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    productSku: requiredString(line.productSku, "Product"),
    quantity: requiredNumber(line.quantity, "Quantity"),
    rate: requiredNumber(line.rate, "Rate"),
    cdPercent: optionalNumber(line.cdPercent) || 0,
    todPercent: optionalNumber(line.todPercent) || 0,
    minimumQuantity: optionalNumber(line.minimumQuantity) || 1
  }));
  return createWhatsAppOffer({
    counterpartyIds: requiredStringArray(req.body?.counterpartyIds, "Retailers"),
    expiresAt: requiredString(req.body?.expiresAt, "Expiry"),
    lines
  }, currentUser);
}));

app.post("/whatsapp/drafts/:id/review", async (req, res) => wrap(res, async () => {
  const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales"]);
  const lines = parseCartLines(req.body?.lines).map((line) => ({
    id: requiredString(line.id, "Draft line"),
    quantity: requiredNumber(line.quantity, "Quantity"),
    rate: requiredNumber(line.rate, "Rate"),
    cdPercent: optionalNumber(line.cdPercent) || 0,
    todPercent: optionalNumber(line.todPercent) || 0
  }));
  return reviewWhatsAppDraft(req.params.id, {
    warehouseId: requiredString(req.body?.warehouseId, "Warehouse"),
    paymentMode: requiredString(req.body?.paymentMode || "NEFT", "Payment mode") as PaymentMode,
    cashTiming: optionalString(req.body?.cashTiming),
    deliveryMode: String(req.body?.deliveryMode || "Delivery") === "Self Collection" ? "Self Collection" : "Delivery",
    note: optionalString(req.body?.note),
    lines
  }, currentUser);
}));

app.post("/whatsapp/drafts/:id/invoice", async (req, res) => wrap(res, async () => {
  const currentUser = await requireWhatsAppPilot(req, ["Admin", "Sales", "Accounts"]);
  return sendWhatsAppInvoiceSummary(req.params.id, currentUser);
}));

app.get("/assistant/training-examples/:id/audio", async (req, res) => {
  try {
    await requireRole(req, ["Admin"]);
    const audio = await getVoiceTrainingAudio(req.params.id);
    if (!audio?.audio_data) {
      res.status(404).json({ message: "Voice sample not found." });
      return;
    }
    res.setHeader("Content-Type", audio.audio_mime_type || "audio/webm");
    res.setHeader("Content-Length", String(audio.audio_data.length));
    res.setHeader("Content-Disposition", `inline; filename="${String(audio.audio_file_name || "voice-sample.webm").replace(/[^a-zA-Z0-9._-]/g, "-")}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(audio.audio_data);
  } catch (error) {
    res.status(400).json({ message: error instanceof Error ? error.message : "Could not load voice sample." });
  }
});

app.post("/assistant/training-examples", voiceTrainingUpload.single("audio"), async (req, res) => wrap(res, async () => {
  const currentUser = await requireRole(req, ["Admin"]);
  return createVoiceTrainingExample({
    title: requiredString(req.body?.title, "Training title"),
    commandText: requiredString(req.body?.commandText, "Command text"),
    recognizedText: optionalString(req.body?.recognizedText) || "",
    trainingModule: requiredVoiceTrainingModule(req.body?.trainingModule),
    actionType: requiredString(req.body?.actionType, "Action type"),
    actionGuide: requiredString(req.body?.actionGuide, "Action guide"),
    language: optionalString(req.body?.language) || "hinglish",
    audioFileName: req.file?.originalname,
    audioMimeType: req.file?.mimetype,
    audioData: req.file?.buffer
  }, currentUser);
}));

app.patch("/assistant/training-examples/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
  return updateVoiceTrainingExample(req.params.id, {
    title: requiredString(req.body?.title, "Training title"),
    commandText: requiredString(req.body?.commandText, "Command text"),
    recognizedText: optionalString(req.body?.recognizedText) || "",
    trainingModule: requiredVoiceTrainingModule(req.body?.trainingModule),
    actionType: requiredString(req.body?.actionType, "Action type"),
    actionGuide: requiredString(req.body?.actionGuide, "Action guide"),
    language: optionalString(req.body?.language) || "hinglish",
    active: req.body?.active !== false
  });
}));

app.delete("/assistant/training-examples/:id", async (req, res) => wrap(res, async () => {
  await requireRole(req, ["Admin"]);
  await deleteVoiceTrainingExample(req.params.id);
  return getVoiceTrainingExamples();
}));

app.post("/assistant/transcribe", assistantAudioUpload.single("audio"), async (req, res) => wrap(res, async () => {
  if (process.env.LOCAL_WHISPER_ENABLED === "false" || (isProduction && process.env.LOCAL_WHISPER_ENABLED !== "true")) {
    throw new Error("Local speech transcription is disabled.");
  }
  const currentUser = await getCurrentUser(req);
  if (!req.file?.path) throw new Error("Voice recording is required.");
  try {
    const snapshot = await getSnapshot(currentUser);
    const vocabulary = Array.from(new Set([
      ...snapshot.counterparties.map((item) => item.name),
      ...snapshot.products.flatMap((item) => [item.name, item.sku, item.brand || "", item.shortName || ""])
    ].filter(Boolean)));
    const promptPrefix = "Aapoorti sales and purchase order in Hindi and English. Preserve quantities, rates, party names and product brand names. Vocabulary: ";
    let prompt = promptPrefix;
    for (const item of vocabulary) {
      if (prompt.length + item.length + 2 > 2_900) break;
      prompt += `${item}, `;
    }
    const requestedLanguage = optionalString(req.body?.language);
    const result = await transcribeLocalAudio(req.file.path, prompt, requestedLanguage === "english" ? "en" : "hi");
    if (!result.text) throw new Error("Local speech engine did not detect speech in the recording.");
    return { ...result, engine: "local-whisper" };
  } finally {
    await rm(req.file.path, { force: true });
  }
}));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? `Proof file is too large. Maximum size is ${Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024)} bytes.`
      : error.message;
    res.status(400).json({ message });
    return;
  }
  if (error instanceof Error && error.message.includes("proof files are allowed")) {
    res.status(400).json({ message: error.message });
    return;
  }
  if (error instanceof Error && (error.message.includes("assistant audio format") || error.message.includes("voice training audio format"))) {
    res.status(400).json({ message: error.message });
    return;
  }
  console.error("Unhandled API error", error);
  res.status(500).json({ message: "Unexpected server error." });
});

app.post("/assistant/query", async (req, res) => wrap(res, async () => {
  const currentUser = await getCurrentUser(req);
  const text = requiredString(req.body?.text, "Assistant request");
  if (text.length > 2_000) throw new Error("Assistant request is too long.");
  const responseLanguage = optionalString(req.body?.responseLanguage) === "english" ? "english" : "hinglish";
  return runAssistant(text, await getSnapshot(currentUser), currentUser, responseLanguage);
}));

app.listen(port, () => {
  console.log(`API listening on port ${port} (${process.env.NODE_ENV || "development"}); proof storage: ${r2Enabled ? "Cloudflare R2" : "local filesystem"}`);
  warmLocalSpeechModel();
});

async function storeProofFile(category: ProofCategory, file: Express.Multer.File) {
  if (r2Enabled) return putProofObject(category, file);
  if (!file.filename) throw new Error("Local proof upload did not produce a file name.");
  return file.filename;
}

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

async function requireWhatsAppPilot(req: express.Request, allowedRoles: UserRole[]) {
  const user = await requireRole(req, allowedRoles);
  const pilotUsernames = new Set(
    String(process.env.WHATSAPP_PILOT_USERNAMES || "wa.sales")
      .split(",")
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean)
  );
  if (!pilotUsernames.has("*") && !pilotUsernames.has(user.username.trim().toLowerCase())) {
    throw new Error("WhatsApp Business is coming soon for this account.");
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
  return user;
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

function parseCartLines(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one cart product is required.");
  }
  return value as Array<Record<string, any>>;
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

const voiceTrainingModules = new Set(["Sales", "Purchase", "Accounts", "Delivery Manager", "Delivery Guy", "Admin"]);

function requiredVoiceTrainingModule(value: unknown) {
  const module = requiredString(value, "Training module");
  if (!voiceTrainingModules.has(module)) throw new Error("Select a valid voice training module.");
  return module;
}

function requiredNumber(value: unknown, label: string) {
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return num;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const num = Number(value);
  if (Number.isNaN(num) || num < 0) {
    return undefined;
  }
  return num;
}

function parseOptionalGstRate(value: unknown) {
  if (String(value || "").trim().toUpperCase() === "NA") return "NA";
  return optionalNumber(value) as 0 | 5 | 12 | 18 | 40 | undefined;
}

function parseOptionalLocation(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const latitude = Number(record.latitude);
  const longitude = Number(record.longitude);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return undefined;
  return {
    latitude,
    longitude,
    label: optionalString(record.label)
  };
}

function parseOptionalAdvancePayment(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const amount = optionalNumber(record.amount);
  if (!amount || amount <= 0) return undefined;
  return {
    amount,
    mode: requiredString(record.mode, "Advance payment mode") as PaymentMode,
    cashTiming: optionalString(record.cashTiming) as "In Hand" | "At Delivery" | undefined,
    referenceNumber: optionalString(record.referenceNumber),
    voucherNumber: optionalString(record.voucherNumber),
    utrNumber: optionalString(record.utrNumber),
    proofName: optionalString(record.proofName),
    verificationNote: optionalString(record.verificationNote)
  };
}

function requiredStringArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one item.`);
  }
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function requiredArray(value: unknown, label: string) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must contain at least one item.`);
  }
  return value;
}

function normalizeSlabs(value: unknown, fallbackRate = 0) {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ minQuantity: 1, purchaseRate: fallbackRate }];
  }
  return value.map((item) => ({
    minQuantity: requiredNumber(item?.minQuantity, "Slab min quantity"),
    maxQuantity: item?.maxQuantity === undefined || item?.maxQuantity === null || item?.maxQuantity === "" ? undefined : requiredNumber(item.maxQuantity, "Slab max quantity"),
    purchaseRate: requiredNumber(item?.purchaseRate, "Slab rate")
  }));
}
