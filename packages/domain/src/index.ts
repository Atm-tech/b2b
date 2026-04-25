export const userRoles = ["Admin", "Warehouse Manager", "Delivery Manager", "Purchaser", "Accounts", "Sales", "Data Analyst", "In Delivery", "Out Delivery", "Delivery"] as const;
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
export type CashTiming = "In Hand" | "At Delivery";
export type VerificationStatus = "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";

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
  | "Closed";

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

export type SalesStatus = "Draft" | "Booked" | "Ready for Dispatch" | "Pending Pickup" | "Out for Delivery" | "Self Pickup" | "Delivered" | "Closed";

export type SalesOrder = {
  id: string;
  cartId?: string;
  shopId: string;
  shopName: string;
  productSku: string;
  salesmanId: number;
  salesmanName: string;
  warehouseId: string;
  quantity: number;
  rate: number;
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
  amount: number;
  mode: PaymentMode;
  cashTiming?: CashTiming;
  referenceNumber: string;
  voucherNumber?: string;
  utrNumber?: string;
  proofName?: string;
  verificationStatus: VerificationStatus;
  verificationNote: string;
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

export type InventoryLot = {
  lotId: string;
  sourceOrderId: string;
  sourceType: "Purchase";
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
  payments: PaymentRecord[];
  receiptChecks: ReceiptCheck[];
  inventoryLots: InventoryLot[];
  stockSummary: StockSummary[];
  ledgerEntries: LedgerEntry[];
  deliveryTasks: DeliveryTask[];
  deliveryDockets: DeliveryDocket[];
  deliveryConsignments: DeliveryConsignment[];
  notes: NoteRecord[];
};

export type AuthResponse = {
  user: AppUser;
  snapshot: AppSnapshot;
};
