export const userRoles = ["Admin", "Warehouse Manager", "Delivery Manager", "Purchaser", "Accounts", "Sales", "Collection Agent", "Data Analyst", "In Delivery", "Out Delivery", "Delivery"] as const;
export type UserRole = (typeof userRoles)[number];

export type AppUser = {
  id: number;
  username: string;
  fullName: string;
  role: UserRole;
  roles: UserRole[];
  warehouseIds: string[];
  mobileNumber: string;
  active: boolean;
  createdAt: string;
};

export type Warehouse = {
  id: string;
  name: string;
  city: string;
  address: string;
  type: "Warehouse" | "Yard";
  createdAt: string;
};

export type ProductSlab = {
  minQuantity: number;
  maxQuantity?: number;
  purchaseRate: number;
};

export type ProductMaster = {
  sku: string;
  name: string;
  division: string;
  department: string;
  section: string;
  category: string;
  subCategory: string;
  unit: string;
  defaultGstRate: GstRate;
  defaultTaxMode: TaxMode;
  defaultWeightKg: number;
  toleranceKg: number;
  tolerancePercent: number;
  allowedWarehouseIds: string[];
  slabs: ProductSlab[];
  remarks?: string;
  category6?: string;
  siteName?: string;
  barcode?: string;
  supplierName?: string;
  hsnCode?: string;
  articleName?: string;
  itemName?: string;
  brand?: string;
  shortName?: string;
  size?: string;
  rsp?: number;
  mrp?: number;
  createdBy: string;
  createdAt: string;
};

export function inferProductWeightKg(text: string) {
  const normalized = text
    .toUpperCase()
    .replace(/×/g, "X")
    .replace(/[()]/g, " ")
    .replace(/\bLTRS\b/g, "LTR")
    .replace(/\bLITRES\b/g, "LITRE")
    .replace(/\bLTS\b/g, "LT")
    .replace(/\bGMS\b/g, "GM")
    .replace(/\bGRAMS\b/g, "GRAM");
  const units = "KG|KGS|KILOGRAM|G|GM|GRAM|LTR|LITRE|LT|L|ML";
  const convert = (value: number, unit: string) => {
    if (["KG", "KGS", "KILOGRAM"].includes(unit)) return value;
    if (["G", "GM", "GRAM"].includes(unit)) return value / 1000;
    if (["LTR", "LITRE", "LT", "L"].includes(unit)) return value;
    if (unit === "ML") return value / 1000;
    return 0;
  };
  const mixedAdditivePack = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${units})\\s*\\+\\s*(\\d+(?:\\.\\d+)?)\\s*(${units})\\b`));
  if (mixedAdditivePack) {
    return convert(Number(mixedAdditivePack[1]), mixedAdditivePack[2]) + convert(Number(mixedAdditivePack[3]), mixedAdditivePack[4]);
  }
  const additivePack = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*\\+\\s*(\\d+(?:\\.\\d+)?)\\s*(${units})\\b`));
  if (additivePack) return convert(Number(additivePack[1]) + Number(additivePack[2]), additivePack[3]);
  const freePack = normalized.match(new RegExp(`(\\d+)\\s*\\+\\s*(\\d+)\\s*(?:X|\\*)?\\s*(\\d+(?:\\.\\d+)?)\\s*(${units})\\b`));
  if (freePack) return (Number(freePack[1]) + Number(freePack[2])) * convert(Number(freePack[3]), freePack[4]);
  const packFirst = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:X|\\*)\\s*(\\d+(?:\\.\\d+)?)\\s*(${units})\\b`));
  if (packFirst) return Number(packFirst[1]) * convert(Number(packFirst[2]), packFirst[3]);
  const unitFirst = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${units})\\s*(?:X|\\*)\\s*(\\d+(?:\\.\\d+)?)`));
  if (unitFirst) return convert(Number(unitFirst[1]), unitFirst[2]) * Number(unitFirst[3]);
  const single = normalized.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${units})\\b`));
  return single ? convert(Number(single[1]), single[2]) : 0;
}

export function productWeightSearchText(product: Pick<ProductMaster, "name" | "sku" | "size" | "shortName" | "articleName" | "itemName" | "remarks">) {
  return [product.size, product.name, product.sku, product.shortName, product.articleName, product.itemName, product.remarks]
    .filter(Boolean)
    .join(" ");
}

export type CounterpartyType = "Supplier" | "Shop";

export type Counterparty = {
  id: string;
  type: CounterpartyType;
  name: string;
  gstNumber: string;
  bankName: string;
  bankAccountNumber: string;
  ifscCode: string;
  mobileNumber: string;
  address: string;
  city: string;
  deliveryAddress?: string;
  deliveryCity?: string;
  contactPerson: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  createdBy: string;
  createdAt: string;
};

export type PaymentMode = "Cash" | "Card" | "UPI" | "NEFT" | "RTGS" | "Cheque";
export type CashTiming = "In Hand" | "At Delivery" | "Later";
export type VerificationStatus = "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";

export type GoodsWarrantOutlet = "Awadhpuri" | "Koh E Fiza" | "New Market" | "Kolar" | "Indrapuri";
export type GoodsWarrantPaymentMode = "Cash" | "Cheque";

export type GoodsWarrantRecord = {
  id: string;
  warrantNumber: string;
  outlet: GoodsWarrantOutlet;
  issuedTo: string;
  issuerName: string;
  receivedAmount: number;
  amount: number;
  paymentMode: GoodsWarrantPaymentMode;
  chequeNumber?: string;
  cashCollectedOn?: string;
  issueOn: string;
  validThrough: string;
  note: string;
  createdBy: string;
  createdAt: string;
};

export type PaymentMethodSetting = {
  code: PaymentMode;
  label: string;
  active: boolean;
  allowsCashTiming: boolean;
};

export type DeliveryChargeSetting = {
  model: "Fixed" | "Per Km";
  amount: number;
};

export type PlatformSettings = {
  paymentMethods: PaymentMethodSetting[];
  deliveryCharge: DeliveryChargeSetting;
};

export type GstRate = "NA" | 0 | 5 | 12 | 18 | 40;
export type TaxMode = "NA" | "Exclusive" | "Inclusive";

export function roundCurrency(value: number) {
  if (!Number.isFinite(value)) throw new Error("Amount must be a finite number.");
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTaxAmounts(quantity: number, rate: number, gstRate: GstRate, taxMode: TaxMode) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Quantity must be greater than zero.");
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("Rate must be greater than zero.");
  const numericGstRate = gstRate === "NA" ? 0 : gstRate;
  const resolvedTaxMode = taxMode === "NA" ? "Exclusive" : taxMode;
  const grossAmount = quantity * rate;
  const divisor = 1 + numericGstRate / 100;
  const rawTaxableAmount = resolvedTaxMode === "Inclusive" ? grossAmount / divisor : grossAmount;
  const rawGstAmount = resolvedTaxMode === "Inclusive"
    ? grossAmount - rawTaxableAmount
    : rawTaxableAmount * (numericGstRate / 100);
  const taxableAmount = roundCurrency(rawTaxableAmount);
  const gstAmount = roundCurrency(rawGstAmount);
  return {
    taxableAmount,
    gstAmount,
    totalAmount: roundCurrency(taxableAmount + gstAmount),
    gstRate: numericGstRate as Exclude<GstRate, "NA">,
    taxMode: resolvedTaxMode
  };
}

export function calculateSalesAmounts(input: {
  quantity: number;
  rate: number;
  cdTodRate?: number;
  cdAmount?: number;
  todAmount?: number;
  gstRate: GstRate;
  taxMode: TaxMode;
}) {
  const tax = calculateTaxAmounts(input.quantity, input.rate, input.gstRate, input.taxMode);
  const suppliedCdAmount = input.cdAmount === undefined ? undefined : roundCurrency(input.cdAmount);
  const suppliedTodAmount = input.todAmount === undefined ? undefined : roundCurrency(input.todAmount);
  const suppliedDiscount = roundCurrency((suppliedCdAmount || 0) + (suppliedTodAmount || 0));
  let cdTodRate = input.cdTodRate;

  // Older clients used zero as "not supplied". It is safe only when no discount was submitted.
  if (cdTodRate === undefined || (cdTodRate === 0 && suppliedDiscount === 0)) cdTodRate = input.rate;
  if (!Number.isFinite(cdTodRate) || cdTodRate <= 0) throw new Error("CD/TOD rate must be greater than zero.");
  if (cdTodRate > input.rate) throw new Error("CD/TOD rate cannot be higher than sale rate.");

  const expectedDiscount = roundCurrency((input.rate - cdTodRate) * input.quantity);
  let cdAmount: number;
  let todAmount: number;
  if (suppliedCdAmount === undefined && suppliedTodAmount === undefined) {
    cdAmount = roundCurrency(expectedDiscount / 2);
    todAmount = roundCurrency(expectedDiscount - cdAmount);
  } else {
    if ((suppliedCdAmount || 0) < 0 || (suppliedTodAmount || 0) < 0) throw new Error("CD and TOD amounts cannot be negative.");
    if (Math.abs(suppliedDiscount - expectedDiscount) > 0.02) {
      throw new Error("CD/TOD amounts do not match the entered CD/TOD rate.");
    }
    cdAmount = suppliedCdAmount || 0;
    todAmount = roundCurrency(expectedDiscount - cdAmount);
    if (todAmount < 0) throw new Error("CD amount cannot exceed the total discount.");
  }

  return {
    ...tax,
    cdTodRate,
    cdAmount,
    todAmount,
    totalAmount: roundCurrency(Math.max(0, tax.totalAmount - cdAmount - todAmount))
  };
}

export type PurchaseStatus =
  | "Draft"
  | "Order Placed - Pending Delivery"
  | "Pickup Assigned"
  | "In Pickup"
  | "Order Delivered - Warehouse Check"
  | "Pending Payment"
  | "Ready for Dispatch"
  | "In Transit"
  | "Partially Received"
  | "Received"
  | "Closed"
  | "Cancelled";

export type PurchaseOrder = {
  id: string;
  cartId?: string;
  supplierId: string;
  supplierName: string;
  productSku: string;
  purchaserId: number;
  purchaserName: string;
  warehouseId: string;
  quantityOrdered: number;
  quantityReceived: number;
  rate: number;
  taxableAmount: number;
  gstRate: GstRate;
  gstAmount: number;
  taxMode: TaxMode;
  totalAmount: number;
  expectedWeightKg: number;
  deliveryMode: "Dealer Delivery" | "Self Collection";
  paymentMode: PaymentMode;
  cashTiming?: CashTiming;
  note: string;
  status: PurchaseStatus;
  createdAt: string;
};

export type SalesStatus = "Draft" | "Booked" | "Ready for Dispatch" | "Pending Pickup" | "Out for Delivery" | "Self Pickup" | "Delivered" | "Closed" | "Cancelled";
export type SalesBillingType = "B2B" | "B2C";

export type SalesOrder = {
  id: string;
  cartId?: string;
  shopId: string;
  shopName: string;
  billingType: SalesBillingType;
  productSku: string;
  salesmanId: number;
  salesmanName: string;
  warehouseId: string;
  quantity: number;
  rate: number;
  cdTodRate: number;
  cdAmount: number;
  todAmount: number;
  taxableAmount: number;
  gstRate: GstRate;
  gstAmount: number;
  taxMode: TaxMode;
  totalAmount: number;
  paymentMode: PaymentMode;
  cashTiming?: CashTiming;
  deliveryMode: "Self Collection" | "Delivery";
  deliveryCharge: number;
  note: string;
  status: SalesStatus;
  createdAt: string;
};

export type DeliveryDocket = {
  id: string;
  salesOrderId: string;
  shopId: string;
  shopName: string;
  productSku: string;
  warehouseId: string;
  quantity: number;
  weightKg: number;
  containerWeightKg: number;
  weighingProofName?: string;
  consignmentId?: string;
  status: "Pending Packing" | "Ready" | "Tagged" | "Pending Pickup" | "Out for Delivery" | "Delivered";
  createdAt: string;
};

export type DeliveryConsignment = {
  id: string;
  docketIds: string[];
  warehouseId: string;
  assignedTo: string;
  totalWeightKg: number;
  status: "Draft" | "Ready" | "Pending Pickup" | "Out for Delivery" | "Delivered";
  createdBy: string;
  createdAt: string;
};

export type PaymentRecord = {
  id: string;
  side: "Purchase" | "Sales";
  linkedOrderId: string;
  paymentKind?: "Order" | "Advance";
  counterpartyId?: string;
  counterpartyName?: string;
  amount: number;
  mode: PaymentMode;
  cashTiming?: CashTiming;
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: VerificationStatus;
  verificationNote: string;
  assignedCollector?: string;
  collectionAssignedBy?: string;
  collectionStatus: "None" | "Assigned" | "Collected" | "Reconciled";
  createdBy: string;
  verifiedBy?: string;
  createdAt: string;
  submittedAt?: string;
};

export type ReceiptCheck = {
  grcNumber: string;
  purchaseOrderId: string;
  warehouseId: string;
  receiverId: number;
  receiverName: string;
  orderedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  actualWeightKg: number;
  containerWeightKg: number;
  netWeightKg: number;
  weighingProofName?: string;
  expectedWeightKg: number;
  weightVarianceKg: number;
  partialReceipt: boolean;
  flagged: boolean;
  notes: string[];
  createdAt: string;
};

export type ReturnReason =
  | "Rate Difference"
  | "Damage"
  | "Quality Issue"
  | "Wrong Item"
  | "Excess Quantity"
  | "Other";

export type ReturnMode = "Adhoc" | "Planned";

export type PurchaseReturn = {
  id: string;
  returnGroupId: string;
  mode: ReturnMode;
  linkedOrderId?: string;
  linkedOrderLineId?: string;
  supplierId: string;
  supplierName: string;
  warehouseId: string;
  productSku: string;
  quantity: number;
  rate: number;
  reason: ReturnReason;
  note: string;
  photoName?: string;
  createdBy: string;
  createdAt: string;
};

export type SalesReturn = {
  id: string;
  returnGroupId: string;
  mode: ReturnMode;
  linkedOrderId?: string;
  linkedOrderLineId?: string;
  shopId: string;
  shopName: string;
  warehouseId: string;
  productSku: string;
  quantity: number;
  rate: number;
  reason: ReturnReason;
  note: string;
  photoName?: string;
  createdBy: string;
  createdAt: string;
};

export type ProbationarySaleRecord = {
  id: string;
  salesOrderId: string;
  salesCartId?: string;
  shopId: string;
  shopName: string;
  salesmanId: number;
  salesmanName: string;
  warehouseId: string;
  productSku: string;
  availableQuantityAtSale: number;
  soldQuantity: number;
  originalProbationaryQuantity: number;
  pendingProbationaryQuantity: number;
  rate: number;
  taxableAmount: number;
  gstRate: GstRate;
  gstAmount: number;
  taxMode: TaxMode;
  totalAmount: number;
  note: string;
  status: "Pending" | "Cleared";
  createdAt: string;
  clearedAt?: string;
};

export type InventoryLot = {
  lotId: string;
  sourceOrderId: string;
  sourceType: "Purchase" | "Sales Return";
  warehouseId: string;
  productSku: string;
  quantityAvailable: number;
  quantityReserved: number;
  quantityBlocked: number;
  status: "Available" | "Reserved" | "Blocked";
  createdAt: string;
};

export type LedgerEntry = {
  id: string;
  side: "Purchase" | "Sales";
  linkedOrderId: string;
  partyName: string;
  goodsValue: number;
  paidAmount: number;
  pendingAmount: number;
  status: "Pending" | "Partial" | "Settled";
  createdAt: string;
};

export type DeliveryRouteStop = {
  orderId: string;
  supplierId?: string;
  supplierName: string;
  productSummary: string;
  warehouseId: string;
  warehouseName: string;
  amountToPay: number;
  paymentRequired: boolean;
  paymentMode?: PaymentMode;
  cashTiming?: CashTiming;
  paymentReference?: string;
  paymentProofName?: string;
  latitude?: number;
  longitude?: number;
  locationLabel?: string;
  warehouseReached?: boolean;
  reached: boolean;
  checked: boolean;
  paid: boolean;
  picked: boolean;
};

export type DeliveryTask = {
  id: string;
  side: "Purchase" | "Sales";
  linkedOrderId: string;
  linkedOrderIds: string[];
  consignmentId?: string;
  mode: "Dealer Delivery" | "Self Collection" | "Delivery";
  transportType: "Internal" | "External";
  vehicleNumber?: string;
  freightAmount?: number;
  from: string;
  to: string;
  assignedTo: string;
  pickupAt?: string;
  dropAt?: string;
  routeHint?: string;
  routeStops: DeliveryRouteStop[];
  paymentAction: "None" | "Collect Payment" | "Deliver Payment";
  cashCollectionRequired: boolean;
  cashHandoverMarked: boolean;
  weightProofName?: string;
  cashProofName?: string;
  lastActionAt?: string;
  status: "Planned" | "Picked" | "Handed Over" | "Delivered";
  createdAt: string;
};

export type NoteRecord = {
  id: string;
  entityType: "Purchase Order" | "Receipt" | "Sales Order" | "Payment" | "Delivery" | "Inventory" | "Party";
  entityId: string;
  note: string;
  createdBy: string;
  visibility: "Restricted" | "Operational" | "Management";
  createdAt: string;
};

export type StockSummary = {
  warehouseId: string;
  warehouseName: string;
  productSku: string;
  productName: string;
  availableQuantity: number;
  reservedQuantity: number;
  blockedQuantity: number;
};

export type DashboardMetrics = {
  productCount: number;
  partyCount: number;
  activeUsers: number;
  pendingPurchasePayments: number;
  pendingSalesPayments: number;
  partialReceipts: number;
  flaggedReceipts: number;
  availableInventoryUnits: number;
  openSalesOrders: number;
  liveDeliveryTasks: number;
};

export type AppSnapshot = {
  metrics: DashboardMetrics;
  settings: PlatformSettings;
  users: AppUser[];
  warehouses: Warehouse[];
  products: ProductMaster[];
  counterparties: Counterparty[];
  purchaseOrders: PurchaseOrder[];
  salesOrders: SalesOrder[];
  purchaseReturns: PurchaseReturn[];
  salesReturns: SalesReturn[];
  probationarySales: ProbationarySaleRecord[];
  payments: PaymentRecord[];
  receiptChecks: ReceiptCheck[];
  inventoryLots: InventoryLot[];
  stockSummary: StockSummary[];
  ledgerEntries: LedgerEntry[];
  deliveryTasks: DeliveryTask[];
  deliveryDockets: DeliveryDocket[];
  deliveryConsignments: DeliveryConsignment[];
  goodsWarrants: GoodsWarrantRecord[];
  notes: NoteRecord[];
};

export type AuthResponse = {
  user: AppUser;
  snapshot: AppSnapshot;
};
