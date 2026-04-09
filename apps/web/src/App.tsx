import axios from "axios";
import { useEffect, useState } from "react";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  DeliveryTask,
  NoteRecord,
  PaymentMode,
  PurchaseOrder,
  SalesOrder,
  SalesStatus,
  UserRole
} from "@aapoorti-b2b/domain";
import { userRoles } from "@aapoorti-b2b/domain";

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const browserOriginFallback = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:8080";
const API_BASE = configuredApiBase || browserOriginFallback;
const SESSION_KEY = "aapoorti-b2b-user";
const TOKEN_KEY = "aapoorti-b2b-token";
const api = axios.create({
  baseURL: API_BASE
});

type GstRateInput = "NA" | "0" | "5" | "18";
type TaxModeInput = "NA" | "Exclusive" | "Inclusive";

type ViewKey =
  | "Overview"
  | "Users"
  | "Warehouses"
  | "Products"
  | "Parties"
  | "Purchase"
  | "Sales"
  | "Payments"
  | "Receipts"
  | "Ledger"
  | "Stock"
  | "Delivery"
  | "Settings"
  | "Notes";

const roleViews: Record<UserRole, ViewKey[]> = {
  Admin: ["Overview", "Users", "Warehouses", "Products", "Parties", "Purchase", "Sales", "Payments", "Receipts", "Ledger", "Stock", "Delivery", "Settings", "Notes"],
  "Warehouse Manager": ["Overview", "Receipts", "Stock", "Delivery", "Ledger", "Notes"],
  Purchaser: ["Overview", "Parties", "Purchase", "Payments", "Ledger", "Delivery", "Notes"],
  Accounts: ["Overview", "Payments", "Ledger", "Stock", "Notes"],
  Sales: ["Overview", "Parties", "Sales", "Payments", "Ledger", "Delivery", "Notes"],
  Delivery: ["Overview", "Delivery", "Notes"]
};

const simpleRoleViews: Record<UserRole, ViewKey[]> = {
  Admin: ["Overview", "Users", "Warehouses", "Products", "Purchase", "Sales", "Payments", "Receipts", "Ledger", "Stock", "Delivery", "Settings", "Notes"],
  "Warehouse Manager": ["Overview", "Receipts", "Stock", "Delivery"],
  Purchaser: ["Overview", "Parties", "Purchase", "Payments"],
  Accounts: ["Overview", "Payments", "Ledger"],
  Sales: ["Overview", "Parties", "Sales", "Payments"],
  Delivery: ["Overview", "Delivery"]
};

const labels: Record<ViewKey, string> = {
  Overview: "Home",
  Users: "Users",
  Warehouses: "Warehouses",
  Products: "Products",
  Parties: "Parties",
  Purchase: "Purchase",
  Sales: "Sales",
  Payments: "Payments",
  Receipts: "Receipts",
  Ledger: "Ledger",
  Stock: "Stock",
  Delivery: "Delivery",
  Settings: "Settings",
  Notes: "Notes"
};

function displayLabel(view: ViewKey, user?: AppUser | null) {
  if (!user) return labels[view];
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  if (roles.includes("Warehouse Manager")) {
    if (view === "Stock") return "Dispatches";
  }
  return labels[view];
}

function getVisibleViews(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return Array.from(new Set(roles.flatMap((role) => roleViews[role] || [])));
}

function getVisibleViewsForMode(user: AppUser, simpleMode: boolean) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  const source = simpleMode ? simpleRoleViews : roleViews;
  return Array.from(new Set(roles.flatMap((role) => source[role] || [])));
}

function clearSessionState(setCurrentUser: React.Dispatch<React.SetStateAction<AppUser | null>>, setSessionToken: React.Dispatch<React.SetStateAction<string>>, setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot | null>>) {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  setCurrentUser(null);
  setSessionToken("");
  setSnapshot(null);
}

function groupPurchaseRows(orders: PurchaseOrder[], snapshot?: AppSnapshot) {
  const grouped = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const key = order.cartId || order.id;
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => {
    const first = lines[0];
    return [
      id,
      first.supplierName,
      lines.map((line) => line.productSku).join(", "),
      lines.reduce((sum, line) => sum + line.taxableAmount, 0),
      lines.reduce((sum, line) => sum + line.gstAmount, 0),
      lines.reduce((sum, line) => sum + line.totalAmount, 0),
      snapshot ? purchaseWorkflowStatus(snapshot, id) : (lines.length > 1 ? `${first.status} (${lines.length} products)` : first.status)
    ];
  });
}

function groupSalesRows(orders: SalesOrder[]) {
  const grouped = new Map<string, SalesOrder[]>();
  for (const order of orders) {
    const key = order.cartId || order.id;
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => {
    const first = lines[0];
    return [
      id,
      first.shopName,
      lines.map((line) => line.productSku).join(", "),
      lines.reduce((sum, line) => sum + line.taxableAmount, 0),
      lines.reduce((sum, line) => sum + line.gstAmount, 0),
      lines.reduce((sum, line) => sum + line.totalAmount, 0),
      lines.length > 1 ? `${first.status} (${lines.length} products)` : first.status
    ];
  });
}

function countGroupedOrders(orders: Array<{ id: string; cartId?: string }>) {
  return new Set(orders.map((order) => order.cartId || order.id)).size;
}

function orderPublicId(order: { id: string; cartId?: string }) {
  return order.cartId || order.id;
}

function findPurchaseOrderByPublicId(orders: PurchaseOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

function findSalesOrderByPublicId(orders: SalesOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

function purchaseOrderPublicTotal(orders: PurchaseOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount, 0);
}

function salesOrderPublicTotal(orders: SalesOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount + order.deliveryCharge, 0);
}

function groupPurchaseOrders(orders: PurchaseOrder[]) {
  const grouped = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const key = orderPublicId(order);
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => ({ id, lines }));
}

function purchaseLedgerByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.ledgerEntries.find((item) => item.side === "Purchase" && item.linkedOrderId === orderId);
}

function purchasePaymentsByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.payments
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function latestPurchasePayment(snapshot: AppSnapshot, orderId: string) {
  return purchasePaymentsByOrder(snapshot, orderId)[0];
}

function purchaseCashDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId && item.paymentAction === "Deliver Payment")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

function purchaseWarehouseStatus(lines: PurchaseOrder[]) {
  if (lines.every((line) => line.status === "Received" || line.status === "Closed")) return "Received";
  if (lines.some((line) => line.status === "Partially Received")) return "Partially Received";
  return "Order Placed - Pending Delivery";
}

function purchasePaymentStatus(snapshot: AppSnapshot, orderId: string) {
  const ledger = purchaseLedgerByOrder(snapshot, orderId);
  const latest = latestPurchasePayment(snapshot, orderId);
  const cashTask = purchaseCashDeliveryTask(snapshot, orderId);
  if (latest?.verificationStatus === "Disputed") return "Disputed";
  if (latest?.verificationStatus === "Rejected") return "Flagged";
  if (cashTask && cashTask.status !== "Delivered") return "Cash With Delivery";
  if (ledger && ledger.pendingAmount <= 0 && (latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved")) return "Completed";
  if ((ledger && ledger.paidAmount > 0) || latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved") return "Partial";
  if (latest?.verificationStatus === "Submitted" || latest?.verificationStatus === "Pending") return "Pending";
  return "Pending";
}

function purchaseWorkflowStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Pending";
  return `${purchaseWarehouseStatus(lines)} / Payment ${purchasePaymentStatus(snapshot, orderId)}`;
}

function userWarehouseScope(user: AppUser) {
  return new Set((user.warehouseIds || []).filter(Boolean));
}

function isWarehouseScoped(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return userWarehouseScope(user).size > 0 && (roles.includes("Warehouse Manager") || roles.includes("Delivery"));
}

function mapsDirectionsUrl(stops: string[]) {
  const cleaned = stops.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned[0])}`;
  const [origin, ...rest] = cleaned;
  const destination = rest[rest.length - 1];
  const waypoints = rest.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function calculateTaxPreview(amountText: string, gstRateText: string, taxMode: TaxModeInput) {
  const amount = Math.max(0, Number(amountText || 0));
  if (gstRateText === "NA" || taxMode === "NA") {
    return {
      taxableAmount: amount.toFixed(2),
      gstAmount: "0.00",
      totalAmount: amount.toFixed(2)
    };
  }
  const gstRate = Number(gstRateText || 0);
  const divisor = 1 + gstRate / 100;
  const taxableAmount = taxMode === "Inclusive" && divisor > 0 ? amount / divisor : amount;
  const gstAmount = taxMode === "Inclusive" ? amount - taxableAmount : taxableAmount * (gstRate / 100);
  return {
    taxableAmount: taxableAmount.toFixed(2),
    gstAmount: gstAmount.toFixed(2),
    totalAmount: (taxableAmount + gstAmount).toFixed(2)
  };
}

function purchaseCartEditState(snapshot: AppSnapshot, orderId: string, currentUser: AppUser) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return { editable: false, reason: "Purchase cart not found." };
  const isAdmin = currentUser.role === "Admin" || currentUser.roles.includes("Admin");
  const ownsCart = lines.some((line) => line.purchaserId === currentUser.id || line.purchaserName === currentUser.fullName);
  if (!isAdmin && !ownsCart) return { editable: false, reason: "Only the purchaser or admin can edit this purchase cart." };
  const ledger = purchaseLedgerByOrder(snapshot, orderId);
  if (!isAdmin && (ledger?.paidAmount || 0) > 0) {
    return { editable: false, reason: "Payment is completed. Only admin can edit this purchase cart now." };
  }
  if (!isAdmin && lines.some((line) => line.quantityReceived > 0)) {
    return { editable: false, reason: "Receiving has started. Only admin can edit this purchase cart now." };
  }
  const pickupStarted = snapshot.deliveryTasks.some((task) =>
    task.side === "Purchase"
    && [task.linkedOrderId, ...task.linkedOrderIds].includes(orderId)
    && task.status !== "Planned"
  );
  if (!isAdmin && pickupStarted) {
    return { editable: false, reason: "Pickup has started. Only admin can edit this purchase cart now." };
  }
  return { editable: true, reason: "" };
}

function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("Overview");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [simpleMode, setSimpleMode] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [login, setLogin] = useState({ username: "admin", password: "1234" });

  const [userForm, setUserForm] = useState({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"] as UserRole[], warehouseIds: [] as string[], password: "1234" });
  const [warehouseForm, setWarehouseForm] = useState({ id: "", name: "", city: "", address: "", type: "Warehouse" as "Warehouse" | "Yard" });
  const [productForm, setProductForm] = useState({ sku: "", name: "", division: "", department: "", section: "", category: "", unit: "", defaultGstRate: "0" as GstRateInput, defaultTaxMode: "Exclusive" as TaxModeInput, defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "1", allowedWarehouseIds: [] as string[] });
  const [bulkCsv, setBulkCsv] = useState("sku,name,division,department,section,category,unit,defaultGstRate,defaultTaxMode,defaultWeightKg,toleranceKg,tolerancePercent,allowedWarehouseIds,rsp");
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [partyForm, setPartyForm] = useState({ type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [partyFormErrors, setPartyFormErrors] = useState({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: "", productSku: "", warehouseId: "", quantityOrdered: "0", rate: "0", previousRate: "0", taxableAmount: "0", gstRate: "0" as GstRateInput, gstAmount: "0", taxMode: "Exclusive" as TaxModeInput, deliveryMode: "" as "Dealer Delivery" | "Self Collection" | "", paymentMode: "" as PaymentMode | "", cashTiming: "", note: "", locationAddress: "", locationCity: "", location: null as null | { latitude: number; longitude: number; label?: string; address?: string; city?: string } });
  const [purchaseEditForm, setPurchaseEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Dealer Delivery" as "Dealer Delivery" | "Self Collection", note: "", status: "Order Placed - Pending Delivery" });
  const [salesForm, setSalesForm] = useState({ shopId: "", productSku: "", warehouseId: "", quantity: "0", rate: "0", taxableAmount: "0", gstRate: "0" as GstRateInput, gstAmount: "0", taxMode: "Exclusive" as TaxModeInput, paymentMode: "" as PaymentMode | "", cashTiming: "", deliveryMode: "" as "Self Collection" | "Delivery" | "", note: "", priceApprovalRequested: false, minimumAllowedRate: "0", stockApprovalRequested: false, availableStockAtOrder: "0", locationAddress: "", locationCity: "", location: null as null | { latitude: number; longitude: number; label?: string; address?: string; city?: string } });
  const [salesEditForm, setSalesEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Delivery" as "Self Collection" | "Delivery", note: "", status: "Booked" });
  const [paymentForm, setPaymentForm] = useState({ side: "Purchase" as "Purchase" | "Sales", linkedOrderId: "", amount: "0", mode: "NEFT" as PaymentMode, cashTiming: "", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved", verificationNote: "" });
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState({ id: "", amount: "0", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved", verificationNote: "" });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: "", warehouseId: "", receivedQuantity: "0", actualWeightKg: "0", note: "", confirmPartial: false });
  const [receiptEditForm, setReceiptEditForm] = useState({ grcNumber: "", note: "", flagged: false });
  const [deliveryForm, setDeliveryForm] = useState({ side: "Purchase" as DeliveryTask["side"], linkedOrderIdsText: "", mode: "Dealer Delivery" as DeliveryTask["mode"], from: "", to: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [deliveryEditForm, setDeliveryEditForm] = useState({ id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [partyEditForm, setPartyEditForm] = useState({ id: "", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [noteForm, setNoteForm] = useState({ entityType: "Purchase Order" as NoteRecord["entityType"], entityId: "", note: "", visibility: "Operational" as NoteRecord["visibility"] });
  const emptyPartyCreateForm = { type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" };
  const emptyPartyEditForm = { id: "", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" };

  useEffect(() => {
    const stored = window.localStorage.getItem(SESSION_KEY);
    const token = window.localStorage.getItem(TOKEN_KEY) || "";
    if (!stored || !token) return;
    const user = JSON.parse(stored) as AppUser;
    setCurrentUser(user);
    setSessionToken(token);
    setActiveView(getVisibleViewsForMode(user, true)[0] || "Overview");
    void refresh(user);
  }, []);

  useEffect(() => {
    const nextViews = currentUser ? getVisibleViewsForMode(currentUser, simpleMode) : [];
    if (nextViews.length > 0 && !nextViews.includes(activeView)) {
      setActiveView(nextViews[0]);
    }
  }, [activeView, currentUser, simpleMode]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [message]);

  async function refresh(user = currentUser) {
    const token = window.localStorage.getItem(TOKEN_KEY) || sessionToken;
    if (!user || !token) return;
    try {
      const { data } = await api.get<AppSnapshot>("/snapshot", { headers: { authorization: `Bearer ${token}` } });
      setSnapshot(data);
    } catch (submitError) {
      clearSessionState(setCurrentUser, setSessionToken, setSnapshot);
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Unable to restore session.") : "Unable to restore session.");
    }
  }

  async function doLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post<{ user: AppUser; token: string; snapshot: AppSnapshot }>("/auth/login", login);
      setCurrentUser(data.user as AppUser);
      setSessionToken(String(data.token || ""));
      setSnapshot(data.snapshot as AppSnapshot);
      const nextUser = data.user as AppUser;
      setActiveView(getVisibleViewsForMode(nextUser, simpleMode)[0] || "Overview");
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data.user));
      window.localStorage.setItem(TOKEN_KEY, String(data.token || ""));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function post(path: string, body: object, success: string, onSuccess?: () => void) {
    if (!currentUser || !sessionToken) return false;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post<AppSnapshot>(path, body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
      onSuccess?.();
      return true;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Action failed.") : "Action failed.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function patch(path: string, body: object, success: string, onSuccess?: () => void) {
    if (!currentUser || !sessionToken) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.patch<AppSnapshot>(path, body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
      onSuccess?.();
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Update failed.") : "Update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(path: string, success: string) {
    if (!currentUser || !sessionToken) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.delete<AppSnapshot>(path, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Delete failed.") : "Delete failed.");
    } finally {
      setLoading(false);
    }
  }

  async function uploadFile(path: string, fieldName: string, file: File, successMessage: string) {
    if (!currentUser || !sessionToken) return null;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const formData = new FormData();
      formData.append(fieldName, file);
      const { data } = await api.post(path, formData, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setMessage(successMessage);
      return data;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Upload failed.") : "Upload failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function createPartyRecord(body: Omit<Counterparty, "id" | "createdBy" | "createdAt">) {
    if (!currentUser || !sessionToken) return null;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post<AppSnapshot>("/counterparties", body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      const nextSnapshot = data as AppSnapshot;
      setSnapshot(nextSnapshot);
      setMessage(`${body.type === "Supplier" ? "Supplier" : "Customer"} saved.`);
      return nextSnapshot.counterparties.find((item) => item.type === body.type && item.name === body.name && item.mobileNumber === body.mobileNumber) || null;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Party creation failed.") : "Party creation failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function doLogout() {
    if (sessionToken) {
      try {
        await api.post("/auth/logout", null, { headers: { authorization: `Bearer ${sessionToken}` } });
      } catch {}
    }
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
    setCurrentUser(null);
    setSessionToken("");
    setSnapshot(null);
    setProfileOpen(false);
  }

  if (!currentUser || !snapshot) {
    return (
      <main className="login-shell">
        <section className="login-card panel">
          <div className="login-copy">
            <span className="eyebrow">B2B Supply Management</span>
            <h1>Operations Console</h1>
            <p>Manage supplier purchase, warehouse receipt, accounts settlement, sales dispatch, and delivery tracking.</p>
            <div className="credential-list">
              <p>Admin: `admin` / `1234`</p>
              <p>Purchaser: `p` / `1234`</p>
              <p>Sales: `s` / `1234`</p>
              <p>Accounts: `a` / `1234`</p>
              <p>Govindpura Warehouse: `gp` / `1234`</p>
              <p>C21 Warehouse: `c21` / `1234`</p>
              <p>Delivery: `d` / `1234`</p>
            </div>
          </div>
          <form className="form-shell" onSubmit={doLogin}>
            <label>Username<input value={login.username} onChange={(e) => setLogin((c) => ({ ...c, username: e.target.value }))} /></label>
            <label>Password<input type="password" value={login.password} onChange={(e) => setLogin((c) => ({ ...c, password: e.target.value }))} /></label>
            {error ? <p className="message error">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={loading}>{loading ? "Signing in..." : "Login"}</button>
          </form>
        </section>
      </main>
    );
  }

  const currentRoles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
  const isAdminUser = currentRoles.includes("Admin");
  const isAccountsUser = currentRoles.includes("Accounts");
  const isPurchaserOnly = currentRoles.includes("Purchaser") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Sales");
  const isSalesOnly = currentRoles.includes("Sales") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Purchaser" || role === "Warehouse Manager");
  const isWarehouseOnly = currentRoles.includes("Warehouse Manager") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Purchaser" || role === "Sales");
  const isDeliveryOnly = currentRoles.length === 1 && currentRoles[0] === "Delivery";
  const visibleViews = getVisibleViewsForMode(currentUser, simpleMode);
  const safeVisibleViews: ViewKey[] = visibleViews.length > 0 ? visibleViews : ["Overview"];
  const warehouseScope = userWarehouseScope(currentUser);
  const applyWarehouseScope = isWarehouseScoped(currentUser);
  const warehousesView = applyWarehouseScope ? snapshot.warehouses.filter((item) => warehouseScope.has(item.id)) : snapshot.warehouses;
  const purchaseOrdersView = applyWarehouseScope ? snapshot.purchaseOrders.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.purchaseOrders;
  const salesOrdersView = applyWarehouseScope ? snapshot.salesOrders.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.salesOrders;
  const stockSummaryView = applyWarehouseScope ? snapshot.stockSummary.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.stockSummary;
  const counterparties = Array.isArray(snapshot.counterparties) ? snapshot.counterparties : [];
  const settings = snapshot.settings && Array.isArray(snapshot.settings.paymentMethods) ? snapshot.settings : { paymentMethods: [], deliveryCharge: { model: "Fixed" as const, amount: 0 } };
  const purchaseSupplierIds = new Set(purchaseOrdersView.map((item) => item.supplierId));
  const salesShopIds = new Set(salesOrdersView.map((item) => item.shopId));
  const suppliers = counterparties.filter((item) => item.type === "Supplier" && (!applyWarehouseScope || purchaseSupplierIds.has(item.id)));
  const shops = counterparties.filter((item) => item.type === "Shop" && (!applyWarehouseScope || salesShopIds.has(item.id)));
  const paymentMethods = settings.paymentMethods.filter((item) => item.active);

  function isNaGst(value: string) {
    return value.trim().toUpperCase() === "N/A";
  }

  function getPartyIdentityErrors(body: { type: "Supplier" | "Shop"; name: string; gstNumber: string; bankAccountNumber: string; ifscCode: string }, sourceParties = counterparties) {
    const name = body.name.trim();
    const gstNumber = body.gstNumber.trim();
    const bankAccountNumber = body.bankAccountNumber.trim();
    const ifscCode = body.ifscCode.trim();
    const scopedParties = sourceParties.filter((item) => item.type === body.type);
    return {
      name: !name || scopedParties.some((item) => item.name.trim().toLowerCase() === name.toLowerCase()),
      gstNumber: !gstNumber || (!isNaGst(gstNumber) && scopedParties.some((item) => item.gstNumber.trim().toLowerCase() === gstNumber.toLowerCase())),
      bankAccountNumber: !bankAccountNumber || (!isNaGst(bankAccountNumber) && scopedParties.some((item) => item.bankAccountNumber.trim().toLowerCase() === bankAccountNumber.toLowerCase())),
      ifscCode: !ifscCode || (!isNaGst(ifscCode) && scopedParties.some((item) => item.ifscCode.trim().toLowerCase() === ifscCode.toLowerCase()))
    };
  }

  async function saveStandaloneParty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const forcedType = currentUser.role === "Sales" ? "Shop" : "Supplier";
    const nextErrors = getPartyIdentityErrors({ ...partyForm, type: forcedType });
    setPartyFormErrors(nextErrors);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      setError(
        nextErrors.name
          ? `${forcedType} name is required and must be unique.`
          : nextErrors.gstNumber
            ? "GST number is required and must be unique. Use N/A for non-GST parties."
            : nextErrors.bankAccountNumber
              ? "Bank account number is required and must be unique. Use N/A when not available."
              : "IFSC code is required and must be unique. Use N/A when not available."
      );
      return;
    }
    const created = await createPartyRecord({ ...partyForm, type: forcedType });
    if (created) {
      setPartyForm(emptyPartyCreateForm);
      setPartyFormErrors({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
    }
  }

  return (
    <main className={simpleMode ? "app-shell simple-shell" : "app-shell"}>
      <header className="app-topbar">
        <div className="app-topbar-copy">
          <span className="small-label">Aapoorti B2B</span>
          <strong>{displayLabel(activeView, currentUser)}</strong>
          <p>{simpleMode ? "Quick operations mode." : "Detailed operations mode."}</p>
        </div>
        <div className="hero-side hero-top-actions">
          <div className="profile-menu">
            <button className="profile-button" type="button" onClick={() => setProfileOpen((current) => !current)} aria-label="Open profile">
              <span className="profile-avatar">{(currentUser.fullName || currentUser.username).slice(0, 1).toUpperCase()}</span>
            </button>
            {profileOpen ? <div className="profile-popover">
              <div className="profile-popover-head">
                <span className="small-label">Profile</span>
                <strong>{currentUser.fullName}</strong>
                <span>{currentUser.username}</span>
              </div>
              <div className="profile-detail-list">
                <div><span className="small-label">Roles</span><strong>{(currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role]).join(" / ")}</strong></div>
                <div><span className="small-label">Mobile</span><strong>{currentUser.mobileNumber || "Pending"}</strong></div>
              </div>
              <div className="profile-action-list">
                <button className="ghost-button" type="button" onClick={() => { const nextMode = !simpleMode; setSimpleMode(nextMode); setActiveView(getVisibleViewsForMode(currentUser, nextMode)[0]); setProfileOpen(false); }}>{simpleMode ? "Show Advanced" : "Show Simple"}</button>
                <button className="ghost-button" type="button" onClick={() => void doLogout()}>Logout</button>
              </div>
            </div> : null}
          </div>
        </div>
      </header>

      {!simpleMode ? <section className="hero panel hero-compact">
        <div>
          <span className="eyebrow">{(currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role]).join(" / ")}</span>
          <h1>Aapoorti B2B</h1>
          <p>{simpleMode ? "Simple mode shows only the essential operational steps." : "Advanced mode shows full operations, controls, and audit views."}</p>
        </div>
      </section> : null}

      {message ? <div className="app-toast success">{message}</div> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className={simpleMode ? "workspace-shell simple-workspace" : "workspace-shell"}>
        {!simpleMode ? <aside className="sidebar panel">
          <div className="sidebar-head"><span className="eyebrow">Role Menu</span><h2>{currentUser.fullName}</h2></div>
          <nav className="side-nav">
            {safeVisibleViews.map((view) => (
              <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>
                <span>{displayLabel(view, currentUser)}</span><small>{view}</small>
              </button>
            ))}
          </nav>
        </aside> : null}
        <div className="content-shell">
          {!simpleMode ? <section className="metric-grid">
            <MetricCard label="Products" value={String(snapshot.metrics.productCount)} />
            <MetricCard label="Parties" value={String(snapshot.metrics.partyCount)} />
            <MetricCard label="Pending Purchase Pay" value={String(snapshot.metrics.pendingPurchasePayments)} />
            <MetricCard label="Pending Sales Pay" value={String(snapshot.metrics.pendingSalesPayments)} />
            <MetricCard label="Partial Receipts" value={String(snapshot.metrics.partialReceipts)} />
            <MetricCard label="Available Stock" value={String(snapshot.metrics.availableInventoryUnits)} />
          </section> : null}

          {activeView === "Overview" ? <Overview snapshot={snapshot} currentUser={currentUser} simpleMode={simpleMode} onOpen={setActiveView} /> : null}
          {activeView === "Users" ? <TwoCol left={<Panel title="Create User" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/users", { ...userForm, role: userForm.roles[0], roles: userForm.roles }, "User created.", () => setUserForm({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"], warehouseIds: [], password: "1234" })); }}><label>Username<input value={userForm.username} onChange={(e) => setUserForm((c) => ({ ...c, username: e.target.value }))} /></label><label>Name<input value={userForm.fullName} onChange={(e) => setUserForm((c) => ({ ...c, fullName: e.target.value }))} /></label><label>Mobile<input value={userForm.mobileNumber} onChange={(e) => setUserForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Roles<select multiple value={userForm.roles} onChange={(e) => setUserForm((c) => ({ ...c, roles: Array.from(e.target.selectedOptions).map((option) => option.value as UserRole) }))}>{userRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label>Warehouses<select multiple value={userForm.warehouseIds} onChange={(e) => setUserForm((c) => ({ ...c, warehouseIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>Password<input value={userForm.password} onChange={(e) => setUserForm((c) => ({ ...c, password: e.target.value }))} /></label><button className="primary-button" type="submit">Create user</button></form></Panel>} right={<Panel title="Users" eyebrow="Directory"><DataTable headers={["Username","Name","Roles","Warehouses","Mobile"]} rows={snapshot.users.map((u) => [u.username, u.fullName, (u.roles && u.roles.length > 0 ? u.roles : [u.role]).join(", "), (u.warehouseIds || []).join(", ") || "All", u.mobileNumber])} /></Panel>} /> : null}
          {activeView === "Warehouses" ? <TwoCol left={<Panel title="Create Warehouse" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/warehouses", warehouseForm, "Warehouse created.", () => setWarehouseForm({ id: "", name: "", city: "", address: "", type: "Warehouse" })); }}><label>Code<input value={warehouseForm.id} onChange={(e) => setWarehouseForm((c) => ({ ...c, id: e.target.value }))} /></label><label>Name<input value={warehouseForm.name} onChange={(e) => setWarehouseForm((c) => ({ ...c, name: e.target.value }))} /></label><label>City<input value={warehouseForm.city} onChange={(e) => setWarehouseForm((c) => ({ ...c, city: e.target.value }))} /></label><label>Type<select value={warehouseForm.type} onChange={(e) => setWarehouseForm((c) => ({ ...c, type: e.target.value as "Warehouse" | "Yard" }))}><option>Warehouse</option><option>Yard</option></select></label><label className="wide-field">Address<input value={warehouseForm.address} onChange={(e) => setWarehouseForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Create warehouse</button></form></Panel>} right={<Panel title="Warehouses" eyebrow="Receiving points"><DataTable headers={["Code","Name","City","Type"]} rows={snapshot.warehouses.map((w) => [w.id, w.name, w.city, w.type])} /></Panel>} /> : null}
          {activeView === "Products" ? <ProductAdminView snapshot={snapshot} productForm={productForm} setProductForm={setProductForm} bulkCsv={bulkCsv} setBulkCsv={setBulkCsv} setBulkCsvFile={setBulkCsvFile} onCreate={(body) => post("/products", body, "Product created.")} onUpdate={(sku, body) => patch(`/products/${encodeURIComponent(sku)}`, body, "Product updated.")} onDelete={(sku) => remove(`/products/${encodeURIComponent(sku)}`, "Product deleted.")} onBulkImport={(rows) => post("/products/bulk", { rows }, "CSV products imported.")} onBulkUpload={async () => { if (!bulkCsvFile) { setError("Select a CSV or Excel file first."); return; } const data = await uploadFile("/products/bulk-upload", "csv", bulkCsvFile, "Product file uploaded and imported."); if (data && typeof data === "object" && "products" in data) setSnapshot(data as AppSnapshot); }} /> : null}
          {activeView === "Parties" ? (
            isAdminUser ? <TwoCol left={<Panel title="Supplier Master" eyebrow="Admin view"><DataTable headers={["Name","GST","Account","IFSC","City"]} rows={suppliers.map((p) => [p.name, p.gstNumber, p.bankAccountNumber, p.ifscCode, p.city])} /></Panel>} right={<Panel title="Customer Master" eyebrow="Admin view"><DataTable headers={["Name","GST","Account","IFSC","City"]} rows={shops.map((p) => [p.name, p.gstNumber, p.bankAccountNumber, p.ifscCode, p.city])} /></Panel>} /> :
            <TwoCol left={<Panel title={currentUser.role === "Sales" ? "Register Customer" : "Register Supplier"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><form className="form-grid" onSubmit={saveStandaloneParty}><label>Type<input value={currentUser.role === "Sales" ? "Customer / Shop" : "Supplier / Vendor"} readOnly /></label><label className={partyFormErrors.name ? "field-error" : ""}>Name<input value={partyForm.name} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, name: false })); setPartyForm((c) => ({ ...c, name: e.target.value })); }} /></label><label className={partyFormErrors.gstNumber ? "field-error" : ""}>GST<input value={partyForm.gstNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, gstNumber: false })); setPartyForm((c) => ({ ...c, gstNumber: e.target.value })); }} placeholder="GST number or N/A" /></label><label>Bank name<input value={partyForm.bankName} onChange={(e) => setPartyForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label><label className={partyFormErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyForm.bankAccountNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyForm((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label><label className={partyFormErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyForm.ifscCode} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, ifscCode: false })); setPartyForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label><label>Mobile<input value={partyForm.mobileNumber} onChange={(e) => setPartyForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyForm.contactPerson} onChange={(e) => setPartyForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyForm.city} onChange={(e) => setPartyForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyForm.address} onChange={(e) => setPartyForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">{currentUser.role === "Sales" ? "Save customer" : "Save supplier"}</button></form></Panel>} right={<><Panel title={currentUser.role === "Sales" ? "Update Customer" : "Update Supplier"} eyebrow="Edit details"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/counterparties/${partyEditForm.id}`, partyEditForm, "Party updated.", () => setPartyEditForm(emptyPartyEditForm)); }}><label>Party<select value={partyEditForm.id} onChange={(e) => { const sourceItems = currentUser.role === "Sales" ? shops : suppliers; const item = sourceItems.find((c) => c.id === e.target.value); setPartyEditForm(item ? { id: item.id, name: item.name, gstNumber: item.gstNumber, bankName: item.bankName, bankAccountNumber: item.bankAccountNumber, ifscCode: item.ifscCode, mobileNumber: item.mobileNumber, address: item.address, city: item.city, contactPerson: item.contactPerson } : emptyPartyEditForm); }}>{renderOptions(currentUser.role === "Sales" ? shops : suppliers)}</select></label><label>Name<input value={partyEditForm.name} onChange={(e) => setPartyEditForm((c) => ({ ...c, name: e.target.value }))} /></label><label>GST<input value={partyEditForm.gstNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, gstNumber: e.target.value }))} placeholder="GST number or N/A" /></label><label>Bank name<input value={partyEditForm.bankName} onChange={(e) => setPartyEditForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label><label>Bank account<input value={partyEditForm.bankAccountNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, bankAccountNumber: e.target.value }))} placeholder="Account number or N/A" /></label><label>IFSC<input value={partyEditForm.ifscCode} onChange={(e) => setPartyEditForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() }))} placeholder="IFSC code or N/A" /></label><label>Mobile<input value={partyEditForm.mobileNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyEditForm.contactPerson} onChange={(e) => setPartyEditForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyEditForm.city} onChange={(e) => setPartyEditForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyEditForm.address} onChange={(e) => setPartyEditForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Update</button></form></Panel><Panel title={currentUser.role === "Sales" ? "Customer Database" : "Supplier Database"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><DataTable headers={["Name","GST","Account","IFSC","City"]} rows={(currentUser.role === "Sales" ? shops : suppliers).map((p) => [p.name, p.gstNumber, p.bankAccountNumber, p.ifscCode, p.city])} /></Panel></>} />
          ) : null}
          {activeView === "Purchase" ? (isAdminUser ? <TwoCol left={<Panel title="Purchase Summary" eyebrow="Admin view"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{countGroupedOrders(snapshot.purchaseOrders)}</strong><p>Total purchase orders</p></div></div><div className="list-card"><div><strong>{countGroupedOrders(snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed"))}</strong><p>Open purchase orders</p></div></div><div className="list-card"><div><strong>{snapshot.metrics.pendingPurchasePayments}</strong><p>Pending purchase payments</p></div></div></div></Panel>} right={<Panel title="Purchase Orders" eyebrow="Live status"><DataTable headers={["PO","Supplier","Products","Taxable","GST","Total","Status"]} rows={groupPurchaseRows(snapshot.purchaseOrders, snapshot)} /></Panel>} /> : <>
            <PurchaserPurchaseWorkspace
              snapshot={snapshot}
              currentUser={currentUser}
              products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
              suppliers={suppliers}
              warehouses={warehousesView}
              paymentMethods={paymentMethods}
              stockSummary={stockSummaryView}
              purchaseOrders={purchaseOrdersView}
              orderForm={purchaseForm}
              setOrderForm={setPurchaseForm}
              onCreateParty={createPartyRecord}
              onUploadProof={(file) => uploadFile("/payments/upload-proof", "proof", file, "Advance proof uploaded.")}
              onSubmit={(advancePayment, operationDate, lines) => post("/purchase-orders/cart", { ...purchaseForm, lines: lines.map((line) => ({ productSku: line.productSku, quantityOrdered: Number(line.quantity), rate: Number(line.rate), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0), gstAmount: line.gstRate === "NA" ? 0 : Number(line.gstAmount || 0), taxMode: line.gstRate === "NA" ? "NA" : line.taxMode, previousRate: Number(line.previousRate || 0) })), cashTiming: purchaseForm.paymentMode === "Cash" ? purchaseForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, "Purchase cart created.")}
              onUpdateCart={(orderId, body) => patch(`/purchase-orders/${encodeURIComponent(orderId)}`, body, "Purchase cart updated.")}
            />
          </>) : null}
          {activeView === "Sales" ? (isAdminUser ? <TwoCol left={<Panel title="Sales Summary" eyebrow="Admin view"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{countGroupedOrders(snapshot.salesOrders)}</strong><p>Total sales carts</p></div></div><div className="list-card"><div><strong>{countGroupedOrders(snapshot.salesOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed"))}</strong><p>Open sales carts</p></div></div><div className="list-card"><div><strong>{snapshot.metrics.pendingSalesPayments}</strong><p>Pending sales payments</p></div></div></div></Panel>} right={<Panel title="Sales Orders" eyebrow="Admin view"><DataTable headers={["SO / Cart","Shop","Products","Taxable","GST","Total","Status"]} rows={groupSalesRows(snapshot.salesOrders)} /></Panel>} /> : <CatalogOrderView
            mode="sales"
            title="Salesman Order Booking"
            eyebrow="Customer order booking"
            products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
            parties={shops}
            warehouses={warehousesView}
            paymentMethods={paymentMethods}
            stockSummary={stockSummaryView}
            orderForm={salesForm}
            setOrderForm={setSalesForm}
            onCreateParty={createPartyRecord}
            onUploadProof={(file) => uploadFile("/payments/upload-proof", "proof", file, "Advance proof uploaded.")}
            onSubmit={(advancePayment, operationDate, lines) => post("/sales-orders/cart", { ...salesForm, lines: lines.map((line) => ({ productSku: line.productSku, quantity: Number(line.quantity), rate: Number(line.rate), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0), gstAmount: line.gstRate === "NA" ? 0 : Number(line.gstAmount || 0), taxMode: line.gstRate === "NA" ? "NA" : line.taxMode, minimumAllowedRate: Number(line.minimumAllowedRate || 0), availableStockAtOrder: Number(line.availableStockAtOrder || 0), priceApprovalRequested: Boolean(line.priceApprovalRequested), stockApprovalRequested: Boolean(line.stockApprovalRequested), note: line.note || salesForm.note })), cashTiming: salesForm.paymentMode === "Cash" ? salesForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, salesForm.priceApprovalRequested || salesForm.stockApprovalRequested ? "Sales cart sent for admin approval." : "Sales cart created.")}
            rightPanel={null}
          />) : null}
          {activeView === "Payments" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Payment Summary" eyebrow="Admin view"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.side === "Purchase" && item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved").length}</strong><p>Purchase pending</p></div></div><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.side === "Sales" && item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved").length}</strong><p>Sales pending</p></div></div><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.verificationStatus === "Rejected" || item.verificationStatus === "Disputed").length}</strong><p>Flagged</p></div></div></div></Panel>} right={<Panel title="Payment Details" eyebrow="Admin view"><DataTable headers={["Payment","Side","Order","Mode","Reference","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.mode, p.referenceNumber || "-", p.verificationStatus])} /></Panel>} />
            ) : isPurchaserOnly ? (
              <PurchaserPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Payment submitted to accounts.")}
                onUpdatePayment={(id, body) => patch(`/payments/${id}`, body, "Payment updated.")}
              />
            ) : isSalesOnly ? (
              <SalesPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onUpdatePayment={(id, body) => patch(`/payments/${id}`, body, "Payment updated.")}
              />
            ) : (isAccountsUser || currentRoles.includes("Admin")) ? (
              <AccountsPaymentsView
                snapshot={snapshot}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Payment recorded.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Cash handover task created.")}
                onVerify={(paymentId, verificationStatus, verificationNote) => post("/payments/verify", { paymentId, verificationStatus, verificationNote }, `Payment ${verificationStatus.toLowerCase()}.`)}
              />
            ) : null
          ) : null}
          {activeView === "Receipts" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Warehouse Summary" eyebrow="Admin view"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").length}</strong><p>Incoming orders</p></div></div><div className="list-card"><div><strong>{snapshot.salesOrders.filter((item) => item.status === "Ready for Dispatch" || item.status === "Booked" || item.status === "Out for Delivery").length}</strong><p>Outgoing orders</p></div></div><div className="list-card"><div><strong>{snapshot.receiptChecks.filter((item) => item.flagged || item.partialReceipt).length}</strong><p>Flagged / partial</p></div></div></div></Panel>} right={<Panel title="Receipt Checks" eyebrow="Admin view"><DataTable headers={["GRC","PO","Warehouse","Received","Pending","Flagged"]} rows={snapshot.receiptChecks.map((item) => [item.grcNumber, item.purchaseOrderId, item.warehouseId, item.receivedQuantity, item.pendingQuantity, item.flagged ? "Yes" : "No"])} /></Panel>} />
            ) : isWarehouseOnly || currentRoles.includes("Warehouse Manager") ? (
              <WarehouseOperationsViewV2
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/receipt-checks/upload-proof", "receiptProof", file, "Weighing proof uploaded.")}
                onUploadPaymentProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Cash proof uploaded.")}
                onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Delivery task assigned.")}
                onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
                screen="in"
              />
            ) : null
          ) : null}
          {activeView === "Ledger" ? <TwoCol left={<Panel title="Ledger" eyebrow="Accounts visibility"><DataTable headers={["ID","Side","Order","Party","Goods","Paid","Pending"]} rows={snapshot.ledgerEntries.map((l) => [l.id, l.side, l.linkedOrderId, l.partyName, l.goodsValue, l.paidAmount, l.pendingAmount])} /></Panel>} right={<Panel title="Order Financial State" eyebrow="Pending vs settled"><DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...groupPurchaseRows(snapshot.purchaseOrders).map((row) => ["Purchase", row[0], row[6]]), ...groupSalesRows(snapshot.salesOrders).map((row) => ["Sales", row[0], row[6]])]} /></Panel>} /> : null}
          {activeView === "Stock" ? (
            isWarehouseOnly || currentRoles.includes("Warehouse Manager") ? (
              <WarehouseOperationsViewV2
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/receipt-checks/upload-proof", "receiptProof", file, "Weighing proof uploaded.")}
                onUploadPaymentProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Cash proof uploaded.")}
                onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Delivery task assigned.")}
                onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
                screen="out"
              />
            ) : <TwoCol left={<Panel title="Closing Stock" eyebrow="Warehouse and admin"><DataTable headers={["Warehouse","SKU","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productSku, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>} right={<Panel title="Inventory Lots" eyebrow="Traceability"><DataTable headers={["Lot","Order","Warehouse","SKU","Avail","Blocked"]} rows={snapshot.inventoryLots.map((i) => [i.lotId, i.sourceOrderId, i.warehouseId, i.productSku, i.quantityAvailable, i.quantityBlocked])} /></Panel>} />
          ) : null}
          {activeView === "Delivery" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Delivery Summary" eyebrow="Admin view"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.side === "Purchase").length}</strong><p>Inbound tasks</p></div></div><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.side === "Sales").length}</strong><p>Outbound tasks</p></div></div><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.status !== "Delivered").length}</strong><p>Live tasks</p></div></div></div></Panel>} right={<Panel title="Delivery Details" eyebrow="Admin view"><DataTable headers={["ID","Side","Orders","Assigned","Mode","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.assignedTo, d.mode, d.status])} /></Panel>} />
            ) : isDeliveryOnly ? (
              <DeliveryJobsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/delivery-tasks/upload-proof", "deliveryProof", file, "Delivery proof uploaded.")}
                onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
              />
            ) : (isWarehouseOnly || currentRoles.includes("Warehouse Manager")) ? (
              <WarehouseDeliveryBoard snapshot={snapshot} />
            ) : <TwoCol left={<Panel title="Delivery Task" eyebrow="Pickup and drop"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/delivery-tasks", { ...deliveryForm, linkedOrderIds: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "" }, "Delivery task created."); }}><label>Side<select value={deliveryForm.side} onChange={(e) => setDeliveryForm((c) => ({ ...c, side: e.target.value as DeliveryTask["side"] }))}><option>Purchase</option><option>Sales</option></select></label><label className="wide-field">Orders<input value={deliveryForm.linkedOrderIdsText} onChange={(e) => setDeliveryForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} placeholder="PO-1, SO-2" /></label><label>Mode<select value={deliveryForm.mode} onChange={(e) => setDeliveryForm((c) => ({ ...c, mode: e.target.value as DeliveryTask["mode"] }))}><option>Dealer Delivery</option><option>Self Collection</option><option>Delivery</option></select></label><label>Status<select value={deliveryForm.status} onChange={(e) => setDeliveryForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label>From<input value={deliveryForm.from} onChange={(e) => setDeliveryForm((c) => ({ ...c, from: e.target.value }))} /></label><label>To<input value={deliveryForm.to} onChange={(e) => setDeliveryForm((c) => ({ ...c, to: e.target.value }))} /></label><label>Assigned<input value={deliveryForm.assignedTo} onChange={(e) => setDeliveryForm((c) => ({ ...c, assignedTo: e.target.value }))} placeholder="delivery" /></label><label>Pickup time<input value={deliveryForm.pickupAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, pickupAt: e.target.value }))} placeholder="2026-04-04 10:30" /></label><label>Drop time<input value={deliveryForm.dropAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, dropAt: e.target.value }))} placeholder="2026-04-04 13:00" /></label><label>Route hint<input value={deliveryForm.routeHint} onChange={(e) => setDeliveryForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryForm.paymentAction} onChange={(e) => setDeliveryForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryForm.cashCollectionRequired} onChange={(e) => setDeliveryForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><button className="primary-button" type="submit">Create task</button></form></Panel>} right={<><Panel title="Update Delivery" eyebrow="Assignment and completion"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/delivery-tasks/${deliveryEditForm.id}`, { linkedOrderIds: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "", assignedTo: deliveryEditForm.assignedTo, pickupAt: deliveryEditForm.pickupAt, dropAt: deliveryEditForm.dropAt, routeHint: deliveryEditForm.routeHint, paymentAction: deliveryEditForm.paymentAction, cashCollectionRequired: deliveryEditForm.cashCollectionRequired, cashHandoverMarked: deliveryEditForm.cashHandoverMarked, weightProofName: deliveryEditForm.weightProofName, cashProofName: deliveryEditForm.cashProofName, status: deliveryEditForm.status }, "Delivery task updated."); }}><label>Task<select value={deliveryEditForm.id} onChange={(e) => { const item = snapshot.deliveryTasks.find((d) => d.id === e.target.value); setDeliveryEditForm(item ? { id: item.id, linkedOrderIdsText: item.linkedOrderIds.join(", "), assignedTo: item.assignedTo, pickupAt: item.pickupAt || "", dropAt: item.dropAt || "", routeHint: item.routeHint || "", paymentAction: item.paymentAction, cashCollectionRequired: item.cashCollectionRequired, cashHandoverMarked: item.cashHandoverMarked, weightProofName: item.weightProofName || "", cashProofName: item.cashProofName || "", status: item.status } : { id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None", cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" }); }}>{snapshot.deliveryTasks.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}</select></label><label className="wide-field">Orders<input value={deliveryEditForm.linkedOrderIdsText} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} /></label><label>Assigned<input value={deliveryEditForm.assignedTo} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, assignedTo: e.target.value }))} /></label><label>Pickup time<input value={deliveryEditForm.pickupAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, pickupAt: e.target.value }))} /></label><label>Drop time<input value={deliveryEditForm.dropAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, dropAt: e.target.value }))} /></label><label>Route hint<input value={deliveryEditForm.routeHint} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryEditForm.paymentAction} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label>Status<select value={deliveryEditForm.status} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashCollectionRequired} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashHandoverMarked} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashHandoverMarked: e.target.checked }))} />Cash handover marked</label><button className="primary-button" type="submit">Update task</button></form></Panel><Panel title="Delivery Tasks" eyebrow="Transport flow"><DataTable headers={["ID","Side","Orders","Mode","Assigned","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.mode, d.assignedTo, d.status])} /></Panel></>} />
          ) : null}
          {activeView === "Settings" ? <Panel title="Admin Settings" eyebrow="Payment methods and delivery"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/settings", snapshot.settings, "Settings updated."); }}>{snapshot.settings.paymentMethods.map((item, index) => <label key={item.code}>{item.code}<div className="settings-line"><input type="checkbox" checked={item.active} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, active: e.target.checked } : method) } }) : current)} />Active<input type="checkbox" checked={item.allowsCashTiming} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, allowsCashTiming: e.target.checked } : method) } }) : current)} />Cash timing</div></label>)}<label>Delivery model<select value={snapshot.settings.deliveryCharge.model} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, model: e.target.value as "Fixed" | "Per Km" } } }) : current)}><option>Fixed</option><option>Per Km</option></select></label><label>Delivery amount<input type="number" value={snapshot.settings.deliveryCharge.amount} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, amount: Number(e.target.value) } } }) : current)} /></label><button className="primary-button" type="submit">Save settings</button></form></Panel> : null}
          {activeView === "Notes" ? (isAdminUser ? <Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel> : <TwoCol left={<Panel title="Add Note" eyebrow="Authorized viewers"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/notes", noteForm, "Note added.", () => setNoteForm({ entityType: "Purchase Order", entityId: "", note: "", visibility: "Operational" })); }}><label>Entity<select value={noteForm.entityType} onChange={(e) => setNoteForm((c) => ({ ...c, entityType: e.target.value as NoteRecord["entityType"] }))}><option>Purchase Order</option><option>Receipt</option><option>Sales Order</option><option>Payment</option><option>Delivery</option><option>Inventory</option><option>Party</option></select></label><label>ID<input value={noteForm.entityId} onChange={(e) => setNoteForm((c) => ({ ...c, entityId: e.target.value }))} /></label><label>Visibility<select value={noteForm.visibility} onChange={(e) => setNoteForm((c) => ({ ...c, visibility: e.target.value as NoteRecord["visibility"] }))}><option>Restricted</option><option>Operational</option><option>Management</option></select></label><label className="wide-field">Note<textarea value={noteForm.note} onChange={(e) => setNoteForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Add note</button></form></Panel>} right={<Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel>} />) : null}
        </div>
      </section>
      <nav className={simpleMode ? "mobile-tab-bar simple-tab-bar" : "mobile-tab-bar"}>{safeVisibleViews.map((view) => <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>{displayLabel(view, currentUser)}</button>)}</nav>
    </main>
  );
}

type CatalogOrderViewProps = {
  mode: "purchase" | "sales";
  title: string;
  eyebrow: string;
  products: AppSnapshot["products"];
  parties: Counterparty[];
  warehouses: AppSnapshot["warehouses"];
  paymentMethods: AppSnapshot["settings"]["paymentMethods"];
  stockSummary: AppSnapshot["stockSummary"];
  purchaseOrders?: AppSnapshot["purchaseOrders"];
  orderForm: any;
  setOrderForm: React.Dispatch<React.SetStateAction<any>>;
  onCreateParty: (body: Omit<Counterparty, "id" | "createdBy" | "createdAt">) => Promise<Counterparty | null>;
  onUploadProof: (file: File) => Promise<unknown>;
  onSubmit: (advancePayment: { amount: number; mode: PaymentMode; cashTiming?: string; referenceNumber?: string; voucherNumber?: string; utrNumber?: string; proofName?: string; verificationNote?: string } | undefined, operationDate: string | undefined, lines: CartLine[]) => Promise<boolean | void> | boolean | void;
  rightPanel: React.ReactNode;
};

type CartLine = {
  productSku: string;
  quantity: string;
  rate: string;
  previousRate: string;
  taxableAmount: string;
  gstRate: GstRateInput;
  gstAmount: string;
  taxMode: TaxModeInput;
  priceApprovalRequested?: boolean;
  minimumAllowedRate?: string;
  stockApprovalRequested?: boolean;
  availableStockAtOrder?: string;
  note?: string;
};

function CatalogOrderView(props: CatalogOrderViewProps) {
  const { mode, title, eyebrow, products, parties, warehouses, paymentMethods, stockSummary, purchaseOrders = [], orderForm, setOrderForm, onCreateParty, onUploadProof, onSubmit, rightPanel } = props;
  const [search, setSearch] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [activeDivision, setActiveDivision] = useState("");
  const [activeDepartment, setActiveDepartment] = useState("");
  const [activeSection, setActiveSection] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [partySuggestionOpen, setPartySuggestionOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<"landing" | "existing" | "new" | "catalog">("catalog");
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStep, setCartStep] = useState<"cart" | "payment" | "summary">("cart");
  const [cartToast, setCartToast] = useState("");
  const [billTaxOverride, setBillTaxOverride] = useState<{ enabled: boolean; gstRate: GstRateInput; taxMode: TaxModeInput }>({ enabled: false, gstRate: "0", taxMode: "Exclusive" });
  const [cartErrors, setCartErrors] = useState<Record<string, boolean>>({});
  const [cartLines, setCartLines] = useState<CartLine[]>([]);
  const [ratePopup, setRatePopup] = useState<{
    product: AppSnapshot["products"][number];
    quantity: string;
    rate: string;
    lastRate: number;
    gstRate: GstRateInput;
    taxMode: TaxModeInput;
    confirmHighRate: boolean;
  } | null>(null);
  const [partyDraft, setPartyDraft] = useState({ name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [advancePayment, setAdvancePayment] = useState({ enabled: false, amount: "", mode: "" as PaymentMode | "", cashTiming: "In Hand", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "" });
  const [advanceUploading, setAdvanceUploading] = useState(false);
  const [checkoutDate, setCheckoutDate] = useState("");
  const [partyDraftErrors, setPartyDraftErrors] = useState({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
  const isPurchase = mode === "purchase";
  const partyType = isPurchase ? "Supplier" : "Shop";
  const partyLabel = isPurchase ? "supplier / vendor" : "customer / shop";
  const divisions = Array.from(new Set(products.map((item) => item.division).filter(Boolean)));
  const showingCategoryLanding = activeDivision === "";
  function productMatchScore(product: AppSnapshot["products"][number], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return 0;
    const fields = {
      exactName: product.name.toLowerCase(),
      startsName: product.name.toLowerCase(),
      exactSku: product.sku.toLowerCase(),
      brand: (product.brand || "").toLowerCase(),
      shortName: (product.shortName || "").toLowerCase(),
      barcode: (product.barcode || "").toLowerCase(),
      division: (product.division || "").toLowerCase(),
      department: (product.department || "").toLowerCase(),
      section: (product.section || "").toLowerCase()
    };
    if (fields.exactName === normalized) return 1000;
    if (fields.exactSku === normalized || fields.barcode === normalized) return 950;
    if (fields.startsName.startsWith(normalized)) return 900;
    if (fields.shortName.startsWith(normalized)) return 850;
    if (fields.brand.startsWith(normalized)) return 800;
    if (fields.exactName.includes(normalized)) return 700;
    if (fields.shortName.includes(normalized)) return 650;
    if (fields.brand.includes(normalized)) return 600;
    if (fields.department.includes(normalized)) return 500;
    if (fields.section.includes(normalized)) return 450;
    if (fields.division.includes(normalized)) return 400;
    return 0;
  }
  const filteredProducts = products.filter((product) => {
    const matchesDivision = activeDivision === "" || product.division === activeDivision;
    const matchesDepartment = activeDepartment === "" || product.department === activeDepartment;
    const matchesSection = activeSection === "" || product.section === activeSection;
    const haystack = [product.name, product.division, product.department, product.section, product.brand, product.shortName, product.articleName, product.itemName, product.barcode, product.size].join(" ").toLowerCase();
    const matchesSearch = search.trim() === "" || haystack.includes(search.trim().toLowerCase());
    return matchesDivision && matchesDepartment && matchesSection && matchesSearch;
  }).sort((left, right) => {
    const query = search.trim();
    const scoreDiff = productMatchScore(right, query) - productMatchScore(left, query);
    if (scoreDiff !== 0) return scoreDiff;
    return left.name.localeCompare(right.name, "en-IN");
  });
  const searchSuggestions = search.trim() === ""
    ? []
    : products
        .map((product) => ({ product, score: productMatchScore(product, search) }))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.product.name.localeCompare(right.product.name, "en-IN"))
        .map((item) => item.product)
        .slice(0, 6);
  const partySuggestions = parties
    .filter((party) => {
      const query = partySearch.trim().toLowerCase();
      const haystack = [party.name, party.gstNumber, party.mobileNumber, party.city, party.contactPerson].join(" ").toLowerCase();
      return query === "" || haystack.includes(query);
    })
    .slice(0, 8);

  function applySearchSuggestion(product: AppSnapshot["products"][number]) {
    setSearch("");
    setActiveDivision(product.division || "");
    setActiveDepartment(product.department || "");
    setActiveSection(product.section || "");
    setSuggestionOpen(false);
  }

  function selectSavedParty(party: Counterparty) {
    setPartySearch(party.name);
    setPartySuggestionOpen(false);
    setCartErrors((current) => ({ ...current, supplierId: false }));
    setOrderForm((current: any) => isPurchase ? ({
      ...current,
      supplierId: party.id,
      locationAddress: party.deliveryAddress || party.address || "",
      locationCity: party.deliveryCity || party.city || ""
    }) : ({
      ...current,
      shopId: party.id,
      locationAddress: party.deliveryAddress || party.address || "",
      locationCity: party.deliveryCity || party.city || ""
    }));
  }

  function setVoiceSearch() {
    const speechWindow = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor || voiceBusy) {
      if (!SpeechRecognitionCtor) {
        showCartToast("Voice search is not supported in this browser");
      }
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setVoiceBusy(true);
    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) {
        setSearch(transcript);
        setSuggestionOpen(true);
        const matchedProduct = products.find((product) => [product.name, product.brand, product.shortName, product.barcode].join(" ").toLowerCase().includes(transcript.toLowerCase()));
        if (matchedProduct) {
          setActiveDivision(matchedProduct.division || "");
          setActiveDepartment(matchedProduct.department || "");
          setActiveSection(matchedProduct.section || "");
        }
      }
    };
    recognition.onerror = () => {
      setVoiceBusy(false);
      showCartToast("Voice search could not capture your input");
    };
    recognition.onend = () => setVoiceBusy(false);
    recognition.start();
  }

  function getLastPurchaseRate(product: AppSnapshot["products"][number]) {
    return purchaseOrders
      .filter((item) => item.productSku === product.sku)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.rate
      || product.rsp
      || product.slabs[0]?.purchaseRate
      || 0;
  }

  function selectProduct(product: AppSnapshot["products"][number]) {
      const lastRate = getLastPurchaseRate(product);
      const existingLine = cartLines.find((line) => line.productSku === product.sku);
      setRatePopup({
        product,
        quantity: existingLine?.quantity || "1",
        rate: existingLine?.rate || String(isPurchase ? (lastRate || getSuggestedRate(product) || 0) : (product.mrp ?? lastRate ?? 0)),
        lastRate,
        gstRate: existingLine?.gstRate || (billTaxOverride.enabled ? billTaxOverride.gstRate : (product.defaultGstRate === "NA" ? "NA" : String(product.defaultGstRate || 0) as GstRateInput)),
        taxMode: existingLine?.taxMode || (billTaxOverride.enabled ? billTaxOverride.taxMode : (product.defaultTaxMode || "Exclusive")),
        confirmHighRate: false
      });
      return true;
  }

  function getOrderQuantity() {
    const value = Number(isPurchase ? orderForm.quantityOrdered : orderForm.quantity);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getOrderQuantityText() {
    return isPurchase ? String(orderForm.quantityOrdered ?? "") : String(orderForm.quantity ?? "");
  }

  function calculateLineTotals(quantity: string, rate: string, gstRate: GstRateInput, taxMode: TaxModeInput) {
    const lineAmount = Math.max(0, Number(quantity || 0)) * Math.max(0, Number(rate || 0));
    return calculateTax(String(lineAmount), gstRate, taxMode);
  }

  function updateCartLineQuantity(productSku: string, quantity: string) {
    setCartLines((current) => current.map((line) => {
      if (line.productSku !== productSku) return line;
      const totals = calculateLineTotals(quantity, line.rate, line.gstRate, line.taxMode);
      return { ...line, quantity, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
  }

  function updateCartLineTax(productSku: string, updates: Partial<Pick<CartLine, "gstRate" | "taxMode">>) {
    setCartLines((current) => current.map((line) => {
      if (line.productSku !== productSku) return line;
      const gstRate = updates.gstRate ?? line.gstRate;
      const taxMode = gstRate === "NA" ? "NA" : (updates.taxMode ?? (line.taxMode === "NA" ? "Exclusive" : line.taxMode));
      const totals = calculateLineTotals(line.quantity, line.rate, gstRate, taxMode);
      return { ...line, gstRate, taxMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
  }

  function applyBillTaxToAllLines(gstRate: GstRateInput, taxMode: TaxModeInput) {
    setCartLines((current) => current.map((line) => {
      const nextMode = gstRate === "NA" ? "NA" : taxMode;
      const totals = calculateLineTotals(line.quantity, line.rate, gstRate, nextMode);
      return { ...line, gstRate, taxMode: nextMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
    setOrderForm((current: any) => {
      const amount = cartLines.reduce((sum, line) => sum + (Number(line.quantity || 0) * Number(line.rate || 0)), 0);
      return applyTaxCalculation({ ...current, gstRate, taxMode: gstRate === "NA" ? "NA" : taxMode }, String(amount), gstRate === "NA" ? "NA" : taxMode);
    });
  }

  function getCartLineTotal(line: CartLine) {
    return Number(line.taxableAmount || 0) + Number(line.gstAmount || 0);
  }

  function setOrderQuantity(quantity: number | string) {
    const quantityText = String(quantity);
    const quantityValue = Number(quantityText || 0);
    const safeQuantityForMath = Number.isFinite(quantityValue) ? Math.max(0, quantityValue) : 0;
    setOrderForm((current: any) => {
      const next = isPurchase ? ({ ...current, quantityOrdered: quantityText }) : ({ ...current, quantity: quantityText, stockApprovalRequested: false, availableStockAtOrder: "0" });
      return applyTaxCalculation(next, String(safeQuantityForMath * Number(current.rate || 0)), "Exclusive");
    });
  }

  function calculateTax(amountText: string, gstRateText: string, taxMode: TaxModeInput) {
    const amount = Math.max(0, Number(amountText || 0));
    if (gstRateText === "NA" || taxMode === "NA") {
      return {
        taxableAmount: amount.toFixed(2),
        gstAmount: "0.00",
        totalAmount: amount.toFixed(2)
      };
    }
    const gstRate = Number(gstRateText || 0);
    const divisor = 1 + gstRate / 100;
    const taxableAmount = taxMode === "Inclusive" && divisor > 0 ? amount / divisor : amount;
    const gstAmount = taxMode === "Inclusive" ? amount - taxableAmount : taxableAmount * (gstRate / 100);
    const totalAmount = taxableAmount + gstAmount;
    return {
      taxableAmount: taxableAmount.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2)
    };
  }

  function applyTaxCalculation(form: any, amountText: string, taxMode: TaxModeInput = form.taxMode || "Exclusive") {
    const tax = calculateTax(amountText, form.gstRate || "0", taxMode);
    return {
      ...form,
      taxMode,
      taxableAmount: tax.taxableAmount,
      gstAmount: tax.gstAmount
    };
  }

  function updateTaxField(field: "taxableAmount" | "totalAmount" | "gstRate" | "taxMode", value: string) {
    setOrderForm((current: any) => {
      const next = { ...current, [field]: value };
      const mode = field === "gstRate" && value === "NA" ? "NA" : field === "taxMode" ? value as TaxModeInput : next.taxMode === "NA" && field === "gstRate" ? "Exclusive" : next.taxMode;
      next.taxMode = mode;
      const amount = field === "totalAmount" || mode === "Inclusive" ? (field === "totalAmount" ? value : String(Number(next.taxableAmount || 0) + Number(next.gstAmount || 0))) : next.taxableAmount;
      return applyTaxCalculation(next, amount, mode);
    });
  }

  function adjustProductQuantity(product: AppSnapshot["products"][number], delta: number) {
    const existingLine = cartLines.find((line) => line.productSku === product.sku);
    if (existingLine) {
      updateCartLineQuantity(product.sku, String(Math.max(1, Number(existingLine.quantity || 0) + delta)));
      return;
    }
    if (orderForm.productSku !== product.sku) {
      if (selectProduct(product)) {
        setRatePopup((current) => current ? { ...current, quantity: String(Math.max(1, 1 + delta)) } : current);
      }
      return;
    }
    setOrderQuantity(Math.max(1, getOrderQuantity() + delta));
  }

  function addProductToOrder(product: AppSnapshot["products"][number]) {
    if (!selectProduct(product)) return;
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
  }

  function confirmProductRate() {
    if (!ratePopup) return;
    const nextRate = Number(ratePopup.rate || 0);
    const nextQuantity = Number(ratePopup.quantity || 0);
    const lineTotals = calculateLineTotals(ratePopup.quantity, ratePopup.rate, ratePopup.gstRate, ratePopup.taxMode);
    if (nextRate <= 0) {
      showCartToast("Enter product rate");
      return;
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      showCartToast("Enter quantity");
      return;
    }
    if (isPurchase) {
      if (ratePopup.lastRate > 0 && nextRate > ratePopup.lastRate && !ratePopup.confirmHighRate) {
        setRatePopup((current) => current ? { ...current, confirmHighRate: true } : current);
        showCartToast("Rate is higher than last purchase rate. Tap sure and continue.");
        return;
      }
    } else if (ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate && !ratePopup.confirmHighRate) {
      setRatePopup((current) => current ? { ...current, confirmHighRate: true } : current);
      showCartToast("Cannot sell below last purchase price. Request admin approval.");
      return;
    }
    setOrderForm((current: any) => {
      const quantityText = String(ratePopup.quantity);
      const quantityFields = isPurchase ? { quantityOrdered: quantityText } : { quantity: quantityText, stockApprovalRequested: false, availableStockAtOrder: "0" };
      const lineNote = !isPurchase && ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate
        ? `Admin approval requested: sales rate ${nextRate} below last purchase price ${ratePopup.lastRate} for ${ratePopup.product.sku}.`
        : current.note;
      const cartLine: CartLine = {
        productSku: ratePopup.product.sku,
        quantity: quantityText,
        rate: String(nextRate),
        previousRate: String(ratePopup.lastRate || 0),
        taxableAmount: lineTotals.taxableAmount,
        gstRate: ratePopup.gstRate,
        gstAmount: lineTotals.gstAmount,
        taxMode: ratePopup.taxMode,
        priceApprovalRequested: !isPurchase && ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate,
        minimumAllowedRate: String(ratePopup.lastRate || 0),
        stockApprovalRequested: false,
        availableStockAtOrder: "0",
        note: lineNote
      };
      setCartLines((lines) => {
        const exists = lines.some((line) => line.productSku === cartLine.productSku);
        return exists ? lines.map((line) => line.productSku === cartLine.productSku ? cartLine : line) : [...lines, cartLine];
      });
      return {
        ...current,
        ...quantityFields,
        productSku: ratePopup.product.sku,
        rate: String(nextRate),
        previousRate: String(ratePopup.lastRate || 0),
        warehouseId: current.warehouseId || ratePopup.product.allowedWarehouseIds[0] || "",
        taxableAmount: lineTotals.taxableAmount,
        gstRate: ratePopup.gstRate,
        gstAmount: lineTotals.gstAmount,
        taxMode: ratePopup.taxMode,
        ...(isPurchase ? {} : {
          priceApprovalRequested: ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate,
          minimumAllowedRate: String(ratePopup.lastRate || 0),
          note: lineNote
        })
      };
    });
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
    setRatePopup(null);
    setCartOpen(true);
  }

  function getSuggestedRate(product: AppSnapshot["products"][number]) {
    return product.rsp ?? product.slabs[0]?.purchaseRate ?? 0;
  }

  function resetCurrentOrder() {
    setOrderForm((current: any) => isPurchase
      ? {
          ...current,
          supplierId: "",
          productSku: "",
          warehouseId: "",
          quantityOrdered: "0",
          rate: "0",
          previousRate: "0",
          taxableAmount: "0",
          gstRate: "0",
          gstAmount: "0",
          taxMode: "Exclusive",
            deliveryMode: "",
            paymentMode: "",
            cashTiming: "",
            note: "",
            locationAddress: "",
            locationCity: "",
            location: null
          }
        : {
          ...current,
          shopId: "",
          productSku: "",
          warehouseId: "",
          quantity: "0",
          rate: "0",
          taxableAmount: "0",
          gstRate: "0",
          gstAmount: "0",
          taxMode: "Exclusive",
          deliveryMode: "",
            paymentMode: "",
            cashTiming: "",
            note: "",
            locationAddress: "",
            locationCity: "",
            location: null,
            priceApprovalRequested: false,
          minimumAllowedRate: "0",
          stockApprovalRequested: false,
          availableStockAtOrder: "0"
        });
    setActiveDivision("");
    setActiveDepartment("");
    setActiveSection("");
    setSearch("");
    setPartySearch("");
    setCartOpen(false);
    setCartStep("cart");
    setCartErrors({});
    setCartLines([]);
    setCartToast("");
    setRatePopup(null);
    setPartySuggestionOpen(false);
    setAdvancePayment({ enabled: false, amount: "", mode: "", cashTiming: "In Hand", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "" });
    setAdvanceUploading(false);
    setCheckoutDate("");
    setBillTaxOverride({ enabled: false, gstRate: "0", taxMode: "Exclusive" });
  }

  function clearCartDraft() {
    resetCurrentOrder();
    showCartToast("Cart cleared");
  }

  function showCartToast(message: string) {
    setCartToast(message);
    window.setTimeout(() => {
      setCartToast((current) => current === message ? "" : current);
    }, 2200);
  }

  function markCurrentLocation() {
    if (!navigator.geolocation) {
      showCartToast("Current location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const currentAddress = String(orderForm.locationAddress || "").trim();
        const currentCity = String(orderForm.locationCity || "").trim();
        setOrderForm((current: any) => ({
          ...current,
          location: {
            latitude,
            longitude,
            address: currentAddress,
            city: currentCity,
            label: [currentAddress, currentCity].filter(Boolean).join(", ") || `${latitude},${longitude}`
          }
        }));
        showCartToast(isPurchase ? "Supplier pickup location saved" : "Shop delivery location saved");
      },
      () => showCartToast("Could not capture current location"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function validateCartStep() {
    const cartHasLines = cartLines.length > 0;
    const invalidLine = cartLines.find((line) => Number(line.quantity || 0) <= 0 || Number(line.rate || 0) <= 0);
    const nextErrors = {
      supplierId: isPurchase ? !orderForm.supplierId : !orderForm.shopId,
      warehouseId: !orderForm.warehouseId,
      quantityOrdered: !cartHasLines || Boolean(invalidLine),
      rate: Boolean(invalidLine)
    };
    setCartErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.supplierId) {
      showCartToast(isPurchase ? "Select supplier" : "Select customer");
      return false;
    }
    if (nextErrors.warehouseId) {
      showCartToast(isPurchase ? "Select delivery warehouse" : "Select dispatch warehouse");
      return false;
    }
    if (nextErrors.quantityOrdered) {
      showCartToast(cartHasLines ? "Enter quantity and rate for every cart item" : "Add product to cart");
      return false;
    }
    return true;
  }

  function validatePaymentStep() {
    const advanceAmount = Number(advancePayment.amount || 0);
    const nextErrors = {
      paymentMode: !orderForm.paymentMode,
      cashTiming: orderForm.paymentMode === "Cash" && !orderForm.cashTiming,
      deliveryMode: !orderForm.deliveryMode,
      advanceAmount: advancePayment.enabled && (advanceAmount <= 0 || advanceAmount > cartTotal),
      advanceMode: advancePayment.enabled && !advancePayment.mode,
      advanceCashProof: advancePayment.enabled && advancePayment.mode === "Cash" && !advancePayment.proofName
    };
    setCartErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.paymentMode) {
      showCartToast("Select payment method");
      return false;
    }
    if (nextErrors.cashTiming) {
      showCartToast("Select cash timing");
      return false;
    }
    if (nextErrors.deliveryMode) {
      showCartToast("Select delivery mode");
      return false;
    }
    if (nextErrors.advanceAmount) {
      showCartToast(`Enter advance amount between 1 and ${cartTotal.toFixed(2)}`);
      return false;
    }
    if (nextErrors.advanceMode) {
      showCartToast("Select advance payment mode");
      return false;
    }
    if (nextErrors.advanceCashProof) {
      showCartToast("Upload cash advance photo");
      return false;
    }
    return true;
  }

  function buildAdvancePaymentPayload() {
    if (!advancePayment.enabled) return undefined;
    const amount = Number(advancePayment.amount || 0);
    if (amount <= 0 || !advancePayment.mode) return undefined;
    return {
      amount,
      mode: advancePayment.mode,
      cashTiming: advancePayment.mode === "Cash" ? advancePayment.cashTiming : undefined,
      referenceNumber: advancePayment.referenceNumber || undefined,
      voucherNumber: advancePayment.voucherNumber || undefined,
      utrNumber: advancePayment.utrNumber || undefined,
      proofName: advancePayment.proofName || undefined,
      verificationNote: isPurchase ? "Advance given to dealer at order finalization." : "Advance taken from dealer at order finalization."
    };
  }

  async function uploadAdvanceProof(file: File | null) {
    if (!file) return;
    setAdvanceUploading(true);
    const uploaded = await onUploadProof(file);
    if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) {
      setAdvancePayment((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) }));
      setCartErrors((current) => ({ ...current, advanceCashProof: false }));
    }
    setAdvanceUploading(false);
  }

  function getSelectedProduct() {
    return products.find((item) => item.sku === orderForm.productSku) || null;
  }

  function getAvailableStock(sku: string) {
    return stockSummary.filter((item) => item.productSku === sku).reduce((sum, item) => sum + item.availableQuantity, 0);
  }

  function getWarehouseStock(sku: string, warehouseId: string) {
    return stockSummary.find((item) => item.productSku === sku && item.warehouseId === warehouseId)?.availableQuantity ?? 0;
  }

  function buildStockApprovalNote(productSku: string, requestedQuantity: number, availableQuantity: number, warehouseId: string) {
    return `Admin approval requested: sales quantity ${requestedQuantity} exceeds available stock ${availableQuantity} for ${productSku} at ${warehouseId}.`;
  }

  async function savePartyAndContinue() {
    const name = partyDraft.name.trim();
    const gstNumber = partyDraft.gstNumber.trim();
    const bankAccountNumber = partyDraft.bankAccountNumber.trim();
    const ifscCode = partyDraft.ifscCode.trim();
    const nextErrors = {
      name: !name || parties.some((item) => item.name.trim().toLowerCase() === name.toLowerCase()),
      gstNumber: !gstNumber || (gstNumber.toUpperCase() !== "N/A" && parties.some((item) => item.gstNumber.trim().toLowerCase() === gstNumber.toLowerCase())),
      bankAccountNumber: !bankAccountNumber || (bankAccountNumber.toUpperCase() !== "N/A" && parties.some((item) => item.bankAccountNumber.trim().toLowerCase() === bankAccountNumber.toLowerCase())),
      ifscCode: !ifscCode || (ifscCode.toUpperCase() !== "N/A" && parties.some((item) => item.ifscCode.trim().toLowerCase() === ifscCode.toLowerCase()))
    };
    setPartyDraftErrors(nextErrors);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      showCartToast(
        nextErrors.name
          ? `${isPurchase ? "Supplier" : "Customer"} name is required and must be unique`
          : nextErrors.gstNumber
            ? "GST number is required and must be unique. Use N/A for non-GST parties."
            : nextErrors.bankAccountNumber
              ? "Bank account number is required and must be unique. Use N/A when not available."
              : "IFSC code is required and must be unique. Use N/A when not available."
      );
      return;
    }
    const created = await onCreateParty({ ...partyDraft, type: partyType });
    if (!created) return;
    setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: created.id, locationAddress: created.deliveryAddress || created.address || "", locationCity: created.deliveryCity || created.city || "" }) : ({ ...current, shopId: created.id, locationAddress: created.deliveryAddress || created.address || "", locationCity: created.deliveryCity || created.city || "" }));
    setPartyDraft({ name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
    setPartyDraftErrors({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
    setFlowStep("catalog");
  }

  const selectedPartyId = isPurchase ? orderForm.supplierId : orderForm.shopId;
  const selectedParty = parties.find((item) => item.id === selectedPartyId);
  const liveAddressText = String(orderForm.locationAddress || selectedParty?.deliveryAddress || selectedParty?.address || "");
  const liveCityText = String(orderForm.locationCity || selectedParty?.deliveryCity || selectedParty?.city || "");
  const selectedProduct = getSelectedProduct();
  const cartProducts = cartLines.map((line) => ({ line, product: products.find((item) => item.sku === line.productSku) })).filter((item): item is { line: CartLine; product: AppSnapshot["products"][number] } => Boolean(item.product));
  const cartTaxable = cartLines.reduce((sum, line) => sum + Number(line.taxableAmount || 0), 0);
  const cartGstAmount = cartLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0);
  const cartTotal = cartTaxable + cartGstAmount;
  const totalWeightKg = cartProducts.reduce((sum, item) => sum + item.product.defaultWeightKg * Number(item.line.quantity || 0), 0);
  const cartStepTitle = cartStep === "cart" ? "Cart" : cartStep === "payment" ? "Payment" : "Bill Summary";

  const mainPanel = (
        <Panel title={title} eyebrow={eyebrow}>
          <div className="catalog-shell">
            {flowStep !== "catalog" ? <div className="flow-card">
              {flowStep === "landing" ? <>
                <span className="eyebrow">Start</span>
                <h3>{isPurchase ? "Choose supplier first" : "Start Sale"}</h3>
                <p>{isPurchase ? "Ask the purchaser to select an existing supplier or create a new supplier before opening categories." : `Select an existing ${partyLabel} or create a new one before continuing to the product page.`}</p>
                <div className="flow-action-row">
                  <button className="primary-button" type="button" onClick={() => setFlowStep("existing")}>Existing {isPurchase ? "Supplier" : "Customer"}</button>
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New {isPurchase ? "Supplier" : "Customer"}</button>
                </div>
              </> : null}
              {flowStep === "existing" ? <>
                <span className="eyebrow">Selection</span>
                <h3>Select existing {partyLabel}</h3>
                <div className="form-grid top-gap">
                  <label className="wide-field supplier-search-field">Search saved {isPurchase ? "supplier" : "customer"}<div className="search-box"><input value={partySearch} onChange={(e) => { setPartySearch(e.target.value); setPartySuggestionOpen(true); }} onFocus={() => setPartySuggestionOpen(true)} onBlur={() => window.setTimeout(() => setPartySuggestionOpen(false), 120)} placeholder={`Type saved ${isPurchase ? "supplier" : "customer"} name, GST, city, or mobile`} />{partySuggestionOpen ? <div className="search-suggestion-list">{partySuggestions.length > 0 ? partySuggestions.map((party) => <button key={party.id} type="button" className="search-suggestion-item" onMouseDown={() => selectSavedParty(party)}><strong>{party.name}</strong><span>{party.gstNumber || "GST pending"} / {party.mobileNumber || "Mobile pending"} / {party.city || "City pending"}</span></button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved {isPurchase ? "supplier" : "customer"} found</strong><span>Create one first.</span></div>}</div> : null}</div></label>
                  <label className="wide-field">{isPurchase ? "Supplier" : "Customer"}<select value={selectedPartyId} onChange={(e) => { const party = parties.find((item) => item.id === e.target.value); setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: e.target.value, locationAddress: party?.deliveryAddress || party?.address || "", locationCity: party?.deliveryCity || party?.city || "" }) : ({ ...current, shopId: e.target.value, locationAddress: party?.deliveryAddress || party?.address || "", locationCity: party?.deliveryCity || party?.city || "" })); }}>{renderOptions(parties)}</select></label>
                </div>
                <div className="flow-action-row">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Back</button>
                  <button className="primary-button" type="button" onClick={() => setFlowStep("catalog")} disabled={!selectedPartyId}>Continue to ecom page</button>
                </div>
              </> : null}
              {flowStep === "new" ? <>
                <span className="eyebrow">Registration</span>
                <h3>{isPurchase ? "Vendor registration page" : "Customer registration page"}</h3>
                <div className="form-grid top-gap">
                  <label className={partyDraftErrors.name ? "field-error" : ""}>Name<input value={partyDraft.name} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, name: false })); setPartyDraft((c) => ({ ...c, name: e.target.value })); }} /></label>
                  <label className={partyDraftErrors.gstNumber ? "field-error" : ""}>GST<input value={partyDraft.gstNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, gstNumber: false })); setPartyDraft((c) => ({ ...c, gstNumber: e.target.value })); }} placeholder="GST number or N/A" /></label>
                  <label>Bank name<input value={partyDraft.bankName} onChange={(e) => setPartyDraft((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
                  <label className={partyDraftErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyDraft.bankAccountNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyDraft((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label>
                  <label className={partyDraftErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyDraft.ifscCode} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, ifscCode: false })); setPartyDraft((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label>
                  <label>Mobile<input value={partyDraft.mobileNumber} onChange={(e) => setPartyDraft((c) => ({ ...c, mobileNumber: e.target.value }))} /></label>
                  <label>Contact<input value={partyDraft.contactPerson} onChange={(e) => setPartyDraft((c) => ({ ...c, contactPerson: e.target.value }))} /></label>
                  <label>City<input value={partyDraft.city} onChange={(e) => setPartyDraft((c) => ({ ...c, city: e.target.value }))} /></label>
                  <label className="wide-field">Address<input value={partyDraft.address} onChange={(e) => setPartyDraft((c) => ({ ...c, address: e.target.value }))} /></label>
                </div>
                <div className="flow-action-row">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Back</button>
                  <button className="primary-button" type="button" onClick={() => void savePartyAndContinue()}>Save and continue</button>
                </div>
              </> : null}
            </div> : null}

            {flowStep === "catalog" ? <>
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <span className="small-label">Search product</span>
                <div className="catalog-search-row">
                  <div className="search-box">
                    <input
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setSuggestionOpen(true); }}
                      onFocus={() => setSuggestionOpen(true)}
                      onBlur={() => window.setTimeout(() => setSuggestionOpen(false), 120)}
                      placeholder="Type saved product name, barcode, brand, or division"
                    />
                    {suggestionOpen && search.trim() ? <div className="search-suggestion-list">
                      {searchSuggestions.length > 0 ? searchSuggestions.map((product) => <button key={product.sku} type="button" className="search-suggestion-item" onMouseDown={() => applySearchSuggestion(product)}>
                        <strong>{product.name}</strong>
                        <span>{product.division} / {product.section} / {product.brand || product.sku}</span>
                      </button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved product found</strong><span>Create product first from Products.</span></div>}
                    </div> : null}
                  </div>
                  <button className={voiceBusy ? "ghost-button active-voice" : "ghost-button"} type="button" onClick={setVoiceSearch}>{voiceBusy ? "Listening..." : "Voice"}</button>
                </div>
              </label>
              {!isPurchase ? <div className="selected-party-bar">
                <span className="small-label">{isPurchase ? "Selected supplier" : "Selected customer"}</span>
                <strong>{parties.find((item) => item.id === selectedPartyId)?.name || "Not selected"}</strong>
                <button className="ghost-button" type="button" onClick={() => setCartOpen(true)}>Choose in cart</button>
              </div> : null}
            </div>

            {showingCategoryLanding ? <div className="category-section">
              <div className="category-section-head">
                <div>
                  <span className="small-label">Categories</span>
                  <h3>Choose a category</h3>
                </div>
              </div>
              <div className="category-grid">
                {divisions.map((division) => {
                  const divisionProducts = products.filter((item) => item.division === division);
                  const sample = divisionProducts[0];
                  const initials = division
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((item) => item[0]?.toUpperCase() || "")
                    .join("") || "CT";
                  return (
                    <button key={division} type="button" className="category-card" onClick={() => { setActiveDivision(division); setActiveDepartment(""); setActiveSection(""); }}>
                      <div className="category-card-thumb">{initials}</div>
                      <div className="category-card-copy">
                        <strong>{division}</strong>
                        <span>{divisionProducts.length} product{divisionProducts.length === 1 ? "" : "s"}</span>
                        <p>{sample?.department || "Browse this category"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div> : <>
            <div className="catalog-subhead">
                <button className="ghost-button" type="button" onClick={() => { setActiveDivision(""); setActiveDepartment(""); setActiveSection(""); setSearch(""); }}>Back to categories</button>
                <div className="chip-row chip-row-scroll">
                  <button type="button" className={activeDivision === "" ? "chip-button active" : "chip-button"} onClick={() => { setActiveDivision(""); setActiveDepartment(""); setActiveSection(""); }}>All</button>
                  {divisions.map((division) => (
                    <button key={division} type="button" className={division === activeDivision ? "chip-button active" : "chip-button"} onClick={() => { setActiveDivision(division); setActiveDepartment(""); setActiveSection(""); }}>
                      {division}
                    </button>
                  ))}
              </div>
            </div>

            <div className="catalog-grid">
              {filteredProducts.map((product) => {
                const selected = cartLines.some((line) => line.productSku === product.sku);
                const availableStock = getAvailableStock(product.sku);
                const cardQuantity = cartLines.find((line) => line.productSku === product.sku)?.quantity || 1;
                const initials = product.name
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((item) => item[0]?.toUpperCase() || "")
                  .join("") || "PR";
                return (
                  <div key={product.sku} className={selected ? "product-card selected" : "product-card"} onClick={() => selectProduct(product)}>
                    <div className="product-card-main">
                    <div className="product-thumb">{initials}</div>
                    <div className="product-card-top">
                      <span className="eyebrow">{product.division || "General"}</span>
                      <strong>{product.name}</strong>
                      <p>{product.department} / {product.section}</p>
                    </div>
                    <div className="product-meta">
                      <span>{product.brand || product.shortName || product.sku}</span>
                      <span>{product.size || product.unit}</span>
                    </div>
                    <div className="product-pricing">
                      <strong>{isPurchase ? `Last purchase ${getLastPurchaseRate(product)}` : `Min sell ${getLastPurchaseRate(product)}`}</strong>
                      <span>{product.defaultWeightKg ? `${product.defaultWeightKg} kg` : "Weight not set"}</span>
                    </div>
                    <div className="product-footer">
                      <span>{product.allowedWarehouseIds.join(", ")}</span>
                      <span>{isPurchase ? `MRP ${product.mrp ?? 0}` : `Stock ${availableStock} · MRP ${product.mrp ?? 0}`}</span>
                    </div>
                    </div>
                    <div className="product-action-row">
                      <button type="button" className="qty-button" onClick={(e) => { e.stopPropagation(); adjustProductQuantity(product, -1); }}>-</button>
                      <div className="qty-pill">{cardQuantity}</div>
                      <button type="button" className="qty-button" onClick={(e) => { e.stopPropagation(); adjustProductQuantity(product, 1); }}>+</button>
                      <button type="button" className="add-button" onClick={(e) => { e.stopPropagation(); addProductToOrder(product); }}>
                        {selected ? "Added" : "Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length === 0 ? <div className="empty-card">No products matched the search.</div> : null}
            </div>
            </>}

            {cartLines.length > 0 ? <button type="button" className="floating-checkout-button" onClick={() => setCartOpen(true)}>
              <strong>Checkout</strong>
              <span>{cartLines.length} product{cartLines.length === 1 ? "" : "s"} · Total {cartTotal.toFixed(2)}</span>
            </button> : null}
            {ratePopup ? <div className="cart-overlay" onClick={() => setRatePopup(null)}>
              <div className="cart-sheet rate-popup-sheet" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const taxPreview = calculateLineTotals(ratePopup.quantity, ratePopup.rate, ratePopup.gstRate, ratePopup.taxMode);
                  return <>
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">Rate Entry</span>
                    <h3>{ratePopup.product.name}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Close</button>
                </div>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Last Purchase Rate" : "Minimum Sell Rate"}</span>
                    <strong>{ratePopup.lastRate > 0 ? ratePopup.lastRate : "No history"}</strong>
                  </div>
                  <div>
                    <span className="small-label">Division</span>
                    <strong>{ratePopup.product.division || "General"}</strong>
                  </div>
                </div>
                <div className="cart-edit-grid">
                  <label className={Number(ratePopup.quantity || 0) <= 0 ? "field-error" : ""}>
                    Enter Qty
                    <input type="number" value={ratePopup.quantity} onChange={(e) => setRatePopup((current) => current ? { ...current, quantity: e.target.value } : current)} />
                  </label>
                  <label className={Number(ratePopup.rate || 0) <= 0 ? "field-error" : ""}>
                    Enter Rate
                    <input type="number" value={ratePopup.rate} onChange={(e) => setRatePopup((current) => current ? { ...current, rate: e.target.value, confirmHighRate: false } : current)} />
                  </label>
                </div>
                <div className="cart-edit-grid">
                  <label>
                    Bill Type
                    <select value={ratePopup.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => setRatePopup((current) => current ? {
                      ...current,
                      gstRate: e.target.value === "NA" ? "NA" : (current.gstRate === "NA" ? "0" : current.gstRate),
                      taxMode: e.target.value === "NA" ? "NA" : (current.taxMode === "NA" ? "Exclusive" : current.taxMode)
                    } : current)}>
                      <option value="GST">GST Bill</option>
                      <option value="NA">Non GST Bill</option>
                    </select>
                  </label>
                  <label>
                    GST Rate
                    <select value={ratePopup.gstRate} onChange={(e) => setRatePopup((current) => current ? { ...current, gstRate: e.target.value as GstRateInput, taxMode: e.target.value === "NA" ? "NA" : (current.taxMode === "NA" ? "Exclusive" : current.taxMode) } : current)}>
                      <option value="NA">NA</option>
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="18">18%</option>
                    </select>
                  </label>
                  <label>
                    Calculation
                    <select value={ratePopup.taxMode} onChange={(e) => setRatePopup((current) => current ? { ...current, taxMode: e.target.value as TaxModeInput } : current)} disabled={ratePopup.gstRate === "NA"}>
                      <option value="Exclusive">GST Extra</option>
                      <option value="Inclusive">GST Included</option>
                      <option value="NA">Final Amount</option>
                    </select>
                  </label>
                </div>
                <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Taxable</span><strong>{taxPreview.taxableAmount}</strong></div>
                  <div><span className="small-label">GST</span><strong>{taxPreview.gstAmount}</strong></div>
                  <div><span className="small-label">Final Amount</span><strong>{taxPreview.totalAmount}</strong></div>
                </div>
                {isPurchase && ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) > ratePopup.lastRate ? <div className="rate-warning-box">
                  Entered rate is higher than the last purchase rate. This will be reported to admin and added to the purchase-order notes for warehouse and accounts.
                </div> : null}
                {!isPurchase && ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) < ratePopup.lastRate ? <div className="rate-warning-box">
                  Entered sales rate is below the last purchase price. You can request admin approval. Until admin approves, this product in this order will remain pending.
                </div> : null}
                <div className="cart-actions">
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Cancel</button>
                  <button type="button" className="primary-button" onClick={confirmProductRate}>
                    {isPurchase
                      ? (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) > ratePopup.lastRate && ratePopup.confirmHighRate ? "Sure and continue" : "Continue")
                      : (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) < ratePopup.lastRate && ratePopup.confirmHighRate ? "Request admin" : "Continue")}
                  </button>
                </div>
                </>;
                })()}
              </div>
            </div> : null}
            {cartOpen && cartLines.length > 0 ? <div className="cart-overlay" onClick={() => setCartOpen(false)}>
              <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
                {cartToast ? <div className="cart-toast">{cartToast}</div> : null}
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{cartStepTitle}</span>
                    <h3>{cartLines.length} product cart</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Close</button>
                </div>
                {cartStep === "cart" ? <>
                <div className="stack-list">
                  {cartProducts.map(({ line, product }) => <article className="list-card" key={line.productSku}>
                    <div className="payment-update-head">
                      <div><strong>{product.name}</strong><p>{product.division} / {product.section}</p></div>
                      <button type="button" className="ghost-button danger-button" onClick={() => setCartLines((current) => current.filter((item) => item.productSku !== line.productSku))}>Remove</button>
                    </div>
                    <div className="payment-meta-grid">
                      <label>Qty<input type="number" value={line.quantity} onChange={(e) => updateCartLineQuantity(line.productSku, e.target.value)} /></label>
                      <div><span className="small-label">Rate</span><strong>{Number(line.rate || 0).toFixed(2)}</strong></div>
                      <label>Bill Type<select value={line.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => updateCartLineTax(line.productSku, e.target.value === "NA" ? { gstRate: "NA", taxMode: "NA" } : { gstRate: line.gstRate === "NA" ? "0" : line.gstRate, taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode })} disabled={billTaxOverride.enabled}><option value="GST">GST Bill</option><option value="NA">Non GST Bill</option></select></label>
                      <label>GST<select value={line.gstRate} onChange={(e) => updateCartLineTax(line.productSku, { gstRate: e.target.value as GstRateInput, taxMode: e.target.value === "NA" ? "NA" : (line.taxMode === "NA" ? "Exclusive" : line.taxMode) })} disabled={billTaxOverride.enabled}><option value="NA">NA</option><option value="0">0%</option><option value="5">5%</option><option value="18">18%</option></select></label>
                      <label>Calculation<select value={line.taxMode} onChange={(e) => updateCartLineTax(line.productSku, { taxMode: e.target.value as TaxModeInput })} disabled={line.gstRate === "NA" || billTaxOverride.enabled}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option><option value="NA">Final Amount</option></select></label>
                      <div><span className="small-label">Taxable</span><strong>{Number(line.taxableAmount || 0).toFixed(2)}</strong></div>
                      <div><span className="small-label">GST Amt</span><strong>{Number(line.gstAmount || 0).toFixed(2)}</strong></div>
                      <div><span className="small-label">Line total</span><strong>{getCartLineTotal(line).toFixed(2)}</strong></div>
                    </div>
                    {isPurchase && Number(line.previousRate || 0) > 0 && Number(line.rate || 0) > Number(line.previousRate || 0) ? <div className="rate-warning-box top-gap">Rate flag: purchase rate {Number(line.rate || 0).toFixed(2)} is higher than last purchase {Number(line.previousRate || 0).toFixed(2)}.</div> : null}
                    {!isPurchase && Number(line.minimumAllowedRate || line.previousRate || 0) > 0 && Number(line.rate || 0) < Number(line.minimumAllowedRate || line.previousRate || 0) ? <div className="rate-warning-box top-gap">Rate flag: sales rate {Number(line.rate || 0).toFixed(2)} is below last purchase {Number(line.minimumAllowedRate || line.previousRate || 0).toFixed(2)}.</div> : null}
                    {billTaxOverride.enabled ? <div className="message success top-gap">Whole bill tax override is active for all products in this cart.</div> : null}
                  </article>)}
                </div>
                <div className="cart-edit-grid">
                  <label className="wide-field supplier-search-field">
                    Search Saved {isPurchase ? "Supplier" : "Customer"}
                    <div className="search-box">
                      <input
                        value={partySearch}
                        onChange={(e) => { setPartySearch(e.target.value); setPartySuggestionOpen(true); }}
                        onFocus={() => setPartySuggestionOpen(true)}
                        onBlur={() => window.setTimeout(() => setPartySuggestionOpen(false), 120)}
                        placeholder={`Type saved ${isPurchase ? "supplier" : "customer"} name, GST, city, or mobile`}
                      />
                      {partySuggestionOpen ? <div className="search-suggestion-list">
                        {partySuggestions.length > 0 ? partySuggestions.map((party) => <button key={party.id} type="button" className="search-suggestion-item" onMouseDown={() => selectSavedParty(party)}>
                          <strong>{party.name}</strong>
                          <span>{party.gstNumber || "GST pending"} / {party.mobileNumber || "Mobile pending"} / {party.city || "City pending"}</span>
                        </button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved {isPurchase ? "supplier" : "customer"} found</strong><span>Create {isPurchase ? "supplier" : "customer"} first from Parties.</span></div>}
                      </div> : null}
                    </div>
                  </label>
                  <label className={cartErrors.supplierId ? "field-error" : ""}>
                    {isPurchase ? "Supplier" : "Customer"}
                    <select value={isPurchase ? orderForm.supplierId : orderForm.shopId} onChange={(e) => { setCartErrors((current) => ({ ...current, supplierId: false })); const selected = parties.find((party) => party.id === e.target.value); if (selected) setPartySearch(selected.name); setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: e.target.value }) : ({ ...current, shopId: e.target.value })); }}>
                      {renderOptions(parties)}
                    </select>
                  </label>
                  <label className={cartErrors.warehouseId ? "field-error" : ""}>
                    {isPurchase ? "Delivery To" : "Dispatch From"}
                    <select value={orderForm.warehouseId} onChange={(e) => { setCartErrors((current) => ({ ...current, warehouseId: false })); setOrderForm((current: any) => isPurchase ? ({ ...current, warehouseId: e.target.value }) : ({ ...current, warehouseId: e.target.value, stockApprovalRequested: false, availableStockAtOrder: "0" })); }}>
                      {renderWarehouseOptions(warehouses)}
                    </select>
                  </label>
                  <label className="wide-field">
                    Notes
                    <input value={orderForm.note} onChange={(e) => setOrderForm((current: any) => ({ ...current, note: e.target.value }))} placeholder={isPurchase ? "Delivery or supplier note" : "Delivery or customer note"} />
                  </label>
                </div>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Warehouse" : "Customer"}</span>
                    <strong>{isPurchase ? (warehouses.find((item) => item.id === orderForm.warehouseId)?.name || "Select destination") : (parties.find((item) => item.id === orderForm.shopId)?.name || "Select customer")}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total</span>
                    <strong>{cartTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total weight</span>
                    <strong>{totalWeightKg.toFixed(2)} kg</strong>
                  </div>
                </div>
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Continue shopping</button>
                  <button type="button" className="primary-button" onClick={() => { if (validateCartStep()) setCartStep("payment"); }}>Proceed</button>
                </div>
                </> : cartStep === "payment" ? <>
                <div className="cart-edit-grid">
                  <label className="wide-field">
                    Entry Date
                    <input type="date" value={checkoutDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCheckoutDate(e.target.value)} />
                  </label>
                  <label className={cartErrors.paymentMode ? "field-error" : ""}>
                    Payment Method
                    <select value={orderForm.paymentMode} onChange={(e) => { setCartErrors((current) => ({ ...current, paymentMode: false })); setOrderForm((current: any) => ({ ...current, paymentMode: e.target.value as PaymentMode | "" })); }}>
                      <option value="">Select</option>
                      {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
                    </select>
                  </label>
                  {orderForm.paymentMode === "Cash" ? <label className={cartErrors.cashTiming ? "field-error" : ""}>
                    Cash Timing
                    <select value={orderForm.cashTiming} onChange={(e) => { setCartErrors((current) => ({ ...current, cashTiming: false })); setOrderForm((current: any) => ({ ...current, cashTiming: e.target.value })); }}>
                      <option value="">Select</option>
                      <option>In Hand</option>
                      <option>At Delivery</option>
                    </select>
                  </label> : null}
                  <label className={cartErrors.deliveryMode ? "field-error" : ""}>
                    Delivery Mode
                    <select value={orderForm.deliveryMode} onChange={(e) => { setCartErrors((current) => ({ ...current, deliveryMode: false })); setOrderForm((current: any) => ({ ...current, deliveryMode: e.target.value })); }}>
                      <option value="">Select</option>
                      {isPurchase ? <><option>Dealer Delivery</option><option>Self Collection</option></> : <><option>Delivery</option><option>Self Collection</option></>}
                    </select>
                  </label>
                  <label className="wide-field">
                    Saved {isPurchase ? "party" : "customer"} address
                    <input value={[selectedParty?.address, selectedParty?.city].filter(Boolean).join(", ")} readOnly />
                  </label>
                  <label className="wide-field">
                    {isPurchase ? "Pickup" : "Delivery"} address for current run
                    <div className="inline-input-action">
                      <input value={liveAddressText} onChange={(e) => setOrderForm((current: any) => ({ ...current, locationAddress: e.target.value, location: current.location ? { ...current.location, address: e.target.value, label: [e.target.value, current.locationCity || ""].filter(Boolean).join(", ") || current.location.label } : current.location }))} placeholder={selectedParty?.deliveryAddress || selectedParty?.address || "Enter current address"} />
                      <button type="button" className="ghost-button" onClick={markCurrentLocation}>Mark current location</button>
                    </div>
                  </label>
                  <label>
                    {isPurchase ? "Pickup" : "Delivery"} city
                    <input value={liveCityText} onChange={(e) => setOrderForm((current: any) => ({ ...current, locationCity: e.target.value, location: current.location ? { ...current.location, city: e.target.value, label: [current.locationAddress || "", e.target.value].filter(Boolean).join(", ") || current.location.label } : current.location }))} placeholder={selectedParty?.deliveryCity || selectedParty?.city || "City"} />
                  </label>
                  <label className="checkbox-line wide-field">
                    <input type="checkbox" checked={billTaxOverride.enabled} onChange={(e) => {
                      const enabled = e.target.checked;
                      setBillTaxOverride((current) => ({ ...current, enabled }));
                      if (!enabled) return;
                      applyBillTaxToAllLines(billTaxOverride.gstRate, billTaxOverride.taxMode);
                    }} />
                    Override whole bill tax structure at final bill
                  </label>
                  {billTaxOverride.enabled ? <>
                    <label>
                      Bill Type
                      <select value={billTaxOverride.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => {
                        const nextGstRate = e.target.value === "NA" ? "NA" : (billTaxOverride.gstRate === "NA" ? "0" : billTaxOverride.gstRate);
                        const nextTaxMode = e.target.value === "NA" ? "NA" : (billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode);
                        setBillTaxOverride({ enabled: true, gstRate: nextGstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(nextGstRate, nextTaxMode);
                      }}>
                        <option value="GST">GST Bill</option>
                        <option value="NA">Non GST Bill</option>
                      </select>
                    </label>
                    <label>
                      GST Rate
                      <select value={billTaxOverride.gstRate} onChange={(e) => {
                        const nextGstRate = e.target.value as GstRateInput;
                        const nextTaxMode = nextGstRate === "NA" ? "NA" : (billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode);
                        setBillTaxOverride({ enabled: true, gstRate: nextGstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(nextGstRate, nextTaxMode);
                      }}>
                        <option value="NA">NA</option>
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="18">18%</option>
                      </select>
                    </label>
                    <label>
                      Calculation
                      <select value={billTaxOverride.taxMode} onChange={(e) => {
                        const nextTaxMode = e.target.value as TaxModeInput;
                        setBillTaxOverride({ enabled: true, gstRate: billTaxOverride.gstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(billTaxOverride.gstRate, nextTaxMode);
                      }} disabled={billTaxOverride.gstRate === "NA"}>
                        <option value="Exclusive">GST Extra</option>
                        <option value="Inclusive">GST Included</option>
                        <option value="NA">Final Amount</option>
                      </select>
                    </label>
                  </> : null}
                  <label className="checkbox-line wide-field">
                    <input type="checkbox" checked={advancePayment.enabled} onChange={(e) => {
                      setCartErrors((current) => ({ ...current, advanceAmount: false, advanceMode: false, advanceCashProof: false }));
                      setAdvancePayment((current) => ({ ...current, enabled: e.target.checked, amount: e.target.checked ? current.amount : "", mode: e.target.checked ? current.mode : "", proofName: e.target.checked ? current.proofName : "" }));
                    }} />
                    {isPurchase ? "Advance given to dealer now" : "Advance taken from dealer now"}
                  </label>
                  {advancePayment.enabled ? <>
                    <label className={cartErrors.advanceAmount ? "field-error" : ""}>
                      Advance Amount
                      <input type="number" value={advancePayment.amount} onChange={(e) => { setCartErrors((current) => ({ ...current, advanceAmount: false })); setAdvancePayment((current) => ({ ...current, amount: e.target.value })); }} />
                    </label>
                    <label className={cartErrors.advanceMode ? "field-error" : ""}>
                      Advance Mode
                      <select value={advancePayment.mode} onChange={(e) => { setCartErrors((current) => ({ ...current, advanceMode: false, advanceCashProof: false })); setAdvancePayment((current) => ({ ...current, mode: e.target.value as PaymentMode | "" })); }}>
                        <option value="">Select</option>
                        {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
                      </select>
                    </label>
                    {advancePayment.mode === "Cash" ? <label>
                      Cash Timing
                      <select value={advancePayment.cashTiming} onChange={(e) => setAdvancePayment((current) => ({ ...current, cashTiming: e.target.value }))}>
                        <option>In Hand</option>
                        <option>At Delivery</option>
                      </select>
                    </label> : null}
                    {advancePayment.mode && advancePayment.mode !== "Cash" ? <label>
                      Reference / UTR
                      <input value={advancePayment.referenceNumber} onChange={(e) => setAdvancePayment((current) => ({ ...current, referenceNumber: e.target.value, utrNumber: e.target.value }))} />
                    </label> : null}
                    {advancePayment.mode === "Cash" ? <label className={cartErrors.advanceCashProof ? "field-error wide-field" : "wide-field"}>
                      Cash photo proof
                      <input type="file" accept="image/*" onChange={(e) => void uploadAdvanceProof(e.target.files?.[0] || null)} />
                    </label> : null}
                    {advanceUploading ? <span className="small-label">Uploading cash proof...</span> : null}
                    {advancePayment.proofName ? <a className="ghost-button" href={`${API_BASE}/uploads/payment-proofs/${advancePayment.proofName}`} target="_blank" rel="noreferrer">Show advance proof</a> : null}
                  </> : null}
                </div>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Supplier" : "Customer"}</span>
                    <strong>{parties.find((item) => item.id === (isPurchase ? orderForm.supplierId : orderForm.shopId))?.name || `Select ${isPurchase ? "supplier" : "customer"}`}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total</span>
                    <strong>{cartTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total weight</span>
                    <strong>{totalWeightKg.toFixed(2)} kg</strong>
                  </div>
                </div>
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="ghost-button" onClick={() => setCartStep("cart")}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      if (!validatePaymentStep()) return;
                      setCartStep("summary");
                    }}
                  >
                    Continue
                  </button>
                </div>
                </> : <>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Supplier" : "Customer"}</span>
                    <strong>{parties.find((item) => item.id === (isPurchase ? orderForm.supplierId : orderForm.shopId))?.name || "-"}</strong>
                  </div>
                  <div>
                    <span className="small-label">{isPurchase ? "Delivery To" : "Dispatch From"}</span>
                    <strong>{warehouses.find((item) => item.id === orderForm.warehouseId)?.name || "-"}</strong>
                  </div>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Products</span><strong>{cartLines.length}</strong></div>
                  <div><span className="small-label">Quantity</span><strong>{cartLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}</strong></div>
                  <div><span className="small-label">Total weight</span><strong>{totalWeightKg.toFixed(2)} kg</strong></div>
                  <div><span className="small-label">Taxable</span><strong>{cartTaxable.toFixed(2)}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Input GST" : "Output GST"}</span><strong>{cartGstAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Bill total</span><strong>{cartTotal.toFixed(2)}</strong></div>
                  <div><span className="small-label">Entry date</span><strong>{checkoutDate || "Today"}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{orderForm.paymentMode}{orderForm.paymentMode === "Cash" && orderForm.cashTiming ? ` / ${orderForm.cashTiming}` : ""}</strong></div>
                  {billTaxOverride.enabled ? <div><span className="small-label">Bill tax override</span><strong>{billTaxOverride.gstRate === "NA" ? "Non GST / Final Amount" : `${billTaxOverride.gstRate}% / ${billTaxOverride.taxMode}`}</strong></div> : null}
                  {advancePayment.enabled ? <div><span className="small-label">{isPurchase ? "Advance given" : "Advance taken"}</span><strong>{Number(advancePayment.amount || 0).toFixed(2)} / {advancePayment.mode}{advancePayment.mode === "Cash" ? " / cash photo attached" : ""}</strong></div> : null}
                  <div><span className="small-label">Delivery mode</span><strong>{orderForm.deliveryMode}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Pickup location" : "Delivery location"}</span><strong>{orderForm.location?.label || [liveAddressText, liveCityText].filter(Boolean).join(", ") || selectedParty?.locationLabel || "Not marked"}</strong></div>
                </div>
                <div className="stack-list top-gap">
                  {cartProducts.map(({ line, product }) => <article className="list-card" key={line.productSku}>
                    <strong>{product.name}</strong>
                    <p>{line.quantity} x {Number(line.rate || 0).toFixed(2)} = {getCartLineTotal(line).toFixed(2)} · {line.gstRate === "NA" ? "Non GST / Final Amount" : `${line.gstRate}% / ${line.taxMode}`}</p>
                  </article>)}
                </div>
                {orderForm.note ? <div className="cart-line"><div><span className="small-label">Note</span><strong>{orderForm.note}</strong></div></div> : null}
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="ghost-button" onClick={() => setCartStep("payment")}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={async () => {
                      const success = await onSubmit(buildAdvancePaymentPayload(), checkoutDate || undefined, cartLines);
                      if (success === false) return;
                      resetCurrentOrder();
                    }}
                  >
                    Continue and finalize
                  </button>
                </div>
                </>}
              </div>
            </div> : null}
            </> : null}
          </div>
        </Panel>
  );

  return rightPanel ? <TwoCol left={mainPanel} right={rightPanel} /> : <section>{mainPanel}</section>;
}

function PurchaserPurchaseWorkspace({
  snapshot,
  currentUser,
  products,
  suppliers,
  warehouses,
  paymentMethods,
  stockSummary,
  purchaseOrders,
  orderForm,
  setOrderForm,
  onCreateParty,
  onUploadProof,
  onSubmit,
  onUpdateCart
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  products: AppSnapshot["products"];
  suppliers: Counterparty[];
  warehouses: AppSnapshot["warehouses"];
  paymentMethods: AppSnapshot["settings"]["paymentMethods"];
  stockSummary: AppSnapshot["stockSummary"];
  purchaseOrders: AppSnapshot["purchaseOrders"];
  orderForm: any;
  setOrderForm: React.Dispatch<React.SetStateAction<any>>;
  onCreateParty: (body: Omit<Counterparty, "id" | "createdBy" | "createdAt">) => Promise<Counterparty | null>;
  onUploadProof: (file: File) => Promise<unknown>;
  onSubmit: CatalogOrderViewProps["onSubmit"];
  onUpdateCart: (orderId: string, body: {
    paymentMode: PaymentMode;
    cashTiming?: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      id: string;
      quantityOrdered: number;
      rate: number;
      taxableAmount: number;
      gstRate: "NA" | 0 | 5 | 18;
      gstAmount: number;
      taxMode: "NA" | "Exclusive" | "Inclusive";
    }>;
  }) => Promise<boolean | void>;
}) {
  const [tab, setTab] = useState<"current" | "update" | "summary">("current");
  const myOrders = purchaseOrders.filter((order) => order.purchaserId === currentUser.id || order.purchaserName === currentUser.fullName);

  return (
    <section className="module-stack">
      {tab === "current" ? <CatalogOrderView
        mode="purchase"
        title="Current Purchase"
        eyebrow="Create supplier order"
        products={products}
        parties={suppliers}
        warehouses={warehouses}
        paymentMethods={paymentMethods}
        stockSummary={stockSummary}
        purchaseOrders={purchaseOrders}
        orderForm={orderForm}
        setOrderForm={setOrderForm}
        onCreateParty={onCreateParty}
        onUploadProof={onUploadProof}
        onSubmit={onSubmit}
        rightPanel={null}
      /> : null}
      {tab === "update" ? <PurchaseCartEditor
        snapshot={snapshot}
        currentUser={currentUser}
        onUpdateCart={onUpdateCart}
      /> : null}
      {tab === "summary" ? <Panel title="Order Summary" eyebrow="Your purchase orders">
        <DataTable headers={["PO","Supplier","Products","Taxable","GST","Total","Status"]} rows={groupPurchaseRows(myOrders, snapshot)} />
      </Panel> : null}
      <div className="purchase-module-tab-bar">
        <button className={tab === "current" ? "tab-button active" : "tab-button"} type="button" onClick={() => setTab("current")}>Current Purchase</button>
        <button className={tab === "update" ? "tab-button active" : "tab-button"} type="button" onClick={() => setTab("update")}>Update Order</button>
        <button className={tab === "summary" ? "tab-button active" : "tab-button"} type="button" onClick={() => setTab("summary")}>Order Summary</button>
      </div>
    </section>
  );
}

function PurchaseCartEditor({
  snapshot,
  currentUser,
  onUpdateCart
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUpdateCart: (orderId: string, body: {
    paymentMode: PaymentMode;
    cashTiming?: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      id: string;
      quantityOrdered: number;
      rate: number;
      taxableAmount: number;
      gstRate: "NA" | 0 | 5 | 18;
      gstAmount: number;
      taxMode: "NA" | "Exclusive" | "Inclusive";
    }>;
  }) => Promise<boolean | void>;
}) {
  const editableGroups = groupPurchaseOrders(
    snapshot.purchaseOrders.filter((order) =>
      currentUser.role === "Admin"
      || currentUser.roles.includes("Admin")
      || order.purchaserId === currentUser.id
      || order.purchaserName === currentUser.fullName
    )
  );
  const [selectedOrderId, setSelectedOrderId] = useState(editableGroups[0]?.id || "");
  const [draft, setDraft] = useState<{
    paymentMode: PaymentMode;
    cashTiming: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      id: string;
      productSku: string;
      quantityOrdered: string;
      rate: string;
      gstRate: GstRateInput;
      gstAmount: string;
      taxableAmount: string;
      taxMode: TaxModeInput;
    }>;
  } | null>(null);

  const selectedGroup = editableGroups.find((group) => group.id === selectedOrderId) || editableGroups[0] || null;
  const editState = selectedGroup ? purchaseCartEditState(snapshot, selectedGroup.id, currentUser) : { editable: false, reason: "No purchase carts available." };

  useEffect(() => {
    if (!selectedGroup) {
      setDraft(null);
      return;
    }
    const first = selectedGroup.lines[0];
    setSelectedOrderId((current) => current || selectedGroup.id);
    setDraft({
      paymentMode: first.paymentMode,
      cashTiming: first.cashTiming || "",
      deliveryMode: first.deliveryMode,
      note: first.note || "",
      status: first.status,
      lines: selectedGroup.lines.map((line) => ({
        id: line.id,
        productSku: line.productSku,
        quantityOrdered: String(line.quantityOrdered),
        rate: String(line.rate),
        gstRate: line.gstRate === "NA" ? "NA" : String(line.gstRate || 0) as GstRateInput,
        gstAmount: String(line.gstAmount),
        taxableAmount: String(line.taxableAmount),
        taxMode: line.taxMode === "NA" ? "NA" : (line.taxMode || "Exclusive")
      }))
    });
  }, [selectedGroup?.id]);

  function updateDraftLine(lineId: string, updates: Partial<{
    quantityOrdered: string;
    rate: string;
    gstRate: GstRateInput;
    taxMode: TaxModeInput;
  }>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) => {
          if (line.id !== lineId) return line;
          const quantityOrdered = updates.quantityOrdered ?? line.quantityOrdered;
          const rate = updates.rate ?? line.rate;
          const gstRate = updates.gstRate ?? line.gstRate;
          const taxMode = gstRate === "NA" ? "NA" : (updates.taxMode ?? (line.taxMode === "NA" ? "Exclusive" : line.taxMode));
          const totals = calculateTaxPreview(String(Math.max(0, Number(quantityOrdered || 0)) * Math.max(0, Number(rate || 0))), gstRate, taxMode);
          return {
            ...line,
            quantityOrdered,
            rate,
            gstRate,
            taxMode,
            taxableAmount: totals.taxableAmount,
            gstAmount: totals.gstAmount
          };
        })
      };
    });
  }

  return (
    <Panel title="Edit Purchase Cart" eyebrow="Purchaser until payment or pickup starts">
      {editableGroups.length === 0 ? <div className="empty-card">No purchase carts available for edit.</div> : <>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selectedGroup || !draft || !editState.editable) return;
            await onUpdateCart(selectedGroup.id, {
              paymentMode: draft.paymentMode,
              cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
              deliveryMode: draft.deliveryMode,
              note: draft.note,
              status: draft.status,
              lines: draft.lines.map((line) => ({
                id: line.id,
                quantityOrdered: Number(line.quantityOrdered || 0),
                rate: Number(line.rate || 0),
                taxableAmount: Number(line.taxableAmount || 0),
                gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0) as 0 | 5 | 18,
                gstAmount: Number(line.gstAmount || 0),
                taxMode: line.gstRate === "NA" ? "NA" : line.taxMode
              }))
            });
          }}
        >
          <label className="wide-field">
            Purchase cart
            <select value={selectedGroup?.id || ""} onChange={(e) => setSelectedOrderId(e.target.value)}>
              {editableGroups.map((group) => <option key={group.id} value={group.id}>{`${group.id} - ${group.lines[0]?.supplierName || "Supplier"}`}</option>)}
            </select>
          </label>
          {selectedGroup ? <>
            <div className="message-chip-grid wide-field">
              <span className="status-pill">{selectedGroup.lines[0]?.supplierName || "Supplier"}</span>
              <span className="status-pill">{selectedGroup.lines.length} product(s)</span>
              <span className="status-pill">{purchaseWorkflowStatus(snapshot, selectedGroup.id)}</span>
            </div>
            {!editState.editable ? <p className="message error wide-field">{editState.reason}</p> : null}
            <label>
              Payment Method
              <select value={draft?.paymentMode || ""} onChange={(e) => setDraft((current) => current ? { ...current, paymentMode: e.target.value as PaymentMode } : current)} disabled={!editState.editable}>
                <option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option>
              </select>
            </label>
            {draft?.paymentMode === "Cash" ? <label>
              Cash Timing
              <select value={draft.cashTiming} onChange={(e) => setDraft((current) => current ? { ...current, cashTiming: e.target.value } : current)} disabled={!editState.editable}>
                <option value="">Select</option><option>In Hand</option><option>At Delivery</option>
              </select>
            </label> : null}
            <label>
              Delivery Mode
              <select value={draft?.deliveryMode || "Dealer Delivery"} onChange={(e) => setDraft((current) => current ? { ...current, deliveryMode: e.target.value as "Dealer Delivery" | "Self Collection" } : current)} disabled={!editState.editable}>
                <option>Dealer Delivery</option><option>Self Collection</option>
              </select>
            </label>
            <label>
              Status
              <input value={draft?.status || ""} readOnly />
            </label>
            <label className="wide-field">
              Note
              <input value={draft?.note || ""} onChange={(e) => setDraft((current) => current ? { ...current, note: e.target.value } : current)} disabled={!editState.editable} />
            </label>
            <div className="stack-list wide-field">
              {draft?.lines.map((line) => {
                const total = Number(line.taxableAmount || 0) + Number(line.gstAmount || 0);
                return (
                  <article className="list-card" key={line.id}>
                    <div className="payment-update-head">
                      <div>
                        <strong>{line.productSku}</strong>
                        <p>{line.id}</p>
                      </div>
                      <span className="status-pill">{total.toFixed(2)}</span>
                    </div>
                    <div className="cart-edit-grid top-gap">
                      <label>
                        Qty
                        <input type="number" min="0" value={line.quantityOrdered} onChange={(e) => updateDraftLine(line.id, { quantityOrdered: e.target.value })} disabled={!editState.editable} />
                      </label>
                      <label>
                        Rate
                        <input type="number" min="0" value={line.rate} onChange={(e) => updateDraftLine(line.id, { rate: e.target.value })} disabled={!editState.editable} />
                      </label>
                      <label>
                        Bill Type
                        <select value={line.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => updateDraftLine(line.id, e.target.value === "NA" ? { gstRate: "NA", taxMode: "NA" } : { gstRate: line.gstRate === "NA" ? "0" : line.gstRate, taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode })} disabled={!editState.editable}>
                          <option value="GST">GST Bill</option><option value="NA">Non GST Bill</option>
                        </select>
                      </label>
                      <label>
                        GST
                        <select value={line.gstRate} onChange={(e) => updateDraftLine(line.id, { gstRate: e.target.value as GstRateInput })} disabled={!editState.editable}>
                          <option value="NA">NA</option><option value="0">0%</option><option value="5">5%</option><option value="18">18%</option>
                        </select>
                      </label>
                      <label>
                        Calculation
                        <select value={line.taxMode} onChange={(e) => updateDraftLine(line.id, { taxMode: e.target.value as TaxModeInput })} disabled={!editState.editable || line.gstRate === "NA"}>
                          <option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option><option value="NA">Final Amount</option>
                        </select>
                      </label>
                      <div><span className="small-label">Taxable</span><strong>{Number(line.taxableAmount || 0).toFixed(2)}</strong></div>
                      <div><span className="small-label">GST Amt</span><strong>{Number(line.gstAmount || 0).toFixed(2)}</strong></div>
                    </div>
                  </article>
                );
              })}
            </div>
            <div className="payment-card-actions wide-field">
              <button className="primary-button" type="submit" disabled={!editState.editable}>Update purchase cart</button>
            </div>
          </> : null}
        </form>
      </>}
    </Panel>
  );
}

function PurchaserPaymentsView({
  snapshot,
  currentUser,
  onUploadProof,
  onCreatePayment,
  onUpdatePayment
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onCreatePayment: (body: {
    side: "Purchase";
    linkedOrderId: string;
    amount: number;
    mode: PaymentMode;
    cashTiming?: string;
    referenceNumber: string;
    voucherNumber?: string;
    utrNumber?: string;
    proofName?: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
  }) => Promise<boolean | void>;
  onUpdatePayment: (id: string, body: {
    amount: number;
    referenceNumber: string;
    voucherNumber?: string;
    utrNumber?: string;
    proofName?: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
  }) => Promise<boolean | void>;
}) {
  const myOrders = snapshot.purchaseOrders.filter((item) => item.purchaserId === currentUser.id || item.purchaserName === currentUser.fullName);
  const myOrderIds = new Set(myOrders.flatMap((item) => [item.id, orderPublicId(item)]));
  const myGroups = groupPurchaseOrders(myOrders);
  const payments = snapshot.payments
    .filter((item) => item.side === "Purchase" && myOrderIds.has(item.linkedOrderId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const [uploadingId, setUploadingId] = useState("");
  const [createDrafts, setCreateDrafts] = useState<Record<string, {
    amount: string;
    mode: PaymentMode;
    cashTiming: string;
    referenceNumber: string;
    voucherNumber: string;
    utrNumber: string;
    proofName: string;
    verificationNote: string;
  }>>({});
  const [drafts, setDrafts] = useState<Record<string, {
    amount: string;
    referenceNumber: string;
    voucherNumber: string;
    utrNumber: string;
    proofName: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
  }>>({});

  function getDraft(payment: AppSnapshot["payments"][number]) {
    return drafts[payment.id] || {
      amount: String(payment.amount),
      referenceNumber: payment.referenceNumber || "",
      voucherNumber: payment.voucherNumber || "",
      utrNumber: payment.utrNumber || "",
      proofName: payment.proofName || "",
      verificationStatus: payment.verificationStatus,
      verificationNote: payment.verificationNote || ""
    };
  }

  function setDraftValue(paymentId: string, field: string, value: string) {
    setDrafts((current) => {
      const base = current[paymentId] || {
        amount: "0",
        referenceNumber: "",
        voucherNumber: "",
        utrNumber: "",
        proofName: "",
        verificationStatus: "Submitted" as const,
        verificationNote: ""
      };
      return { ...current, [paymentId]: { ...base, [field]: value } };
    });
  }

  async function uploadProof(paymentId: string, file: File | null) {
    if (!file) return;
    setUploadingId(paymentId);
    const uploaded = await onUploadProof(file);
    if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) {
      setDraftValue(paymentId, "proofName", String((uploaded as { fileName: string }).fileName));
    }
    setUploadingId("");
  }

  async function uploadCreateProof(orderId: string, file: File | null) {
    if (!file) return;
    setUploadingId(orderId);
    const uploaded = await onUploadProof(file);
    if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) {
      setCreateDrafts((current) => {
        const ledger = purchaseLedgerByOrder(snapshot, orderId);
        const base = current[orderId] || {
          amount: String(ledger?.pendingAmount || purchaseOrderPublicTotal(snapshot.purchaseOrders, orderId)),
          mode: "NEFT" as PaymentMode,
          cashTiming: "",
          referenceNumber: "",
          voucherNumber: "",
          utrNumber: "",
          proofName: "",
          verificationNote: ""
        };
        return { ...current, [orderId]: { ...base, proofName: String((uploaded as { fileName: string }).fileName) } };
      });
    }
    setUploadingId("");
  }

  function getCreateDraft(orderId: string) {
    const ledger = purchaseLedgerByOrder(snapshot, orderId);
    return createDrafts[orderId] || {
      amount: String(ledger?.pendingAmount || purchaseOrderPublicTotal(snapshot.purchaseOrders, orderId)),
      mode: "NEFT" as PaymentMode,
      cashTiming: "",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      proofName: "",
      verificationNote: ""
    };
  }

  function setCreateDraftValue(orderId: string, field: string, value: string) {
    setCreateDrafts((current) => ({ ...current, [orderId]: { ...getCreateDraft(orderId), [field]: value } }));
  }

  const pendingCount = myGroups.filter((group) => ["Pending", "Partial", "Cash With Delivery"].includes(purchasePaymentStatus(snapshot, group.id))).length;
  const completedCount = myGroups.filter((group) => purchasePaymentStatus(snapshot, group.id) === "Completed").length;
  const flaggedCount = myGroups.filter((group) => ["Flagged", "Disputed"].includes(purchasePaymentStatus(snapshot, group.id))).length;

  return (
    <section className="dashboard-grid">
      <Panel title="Payment Summary" eyebrow="Purchase accounts flow">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{pendingCount}</strong><p>Pending till accounts completes</p></div></div>
          <div className="list-card"><div><strong>{completedCount}</strong><p>Completed by accounts</p></div></div>
          <div className="list-card"><div><strong>{flaggedCount}</strong><p>Flagged by accounts</p></div></div>
        </div>
      </Panel>
      <Panel title="Purchase Payment Tracker" eyebrow="Order-wise balance and proof">
        <div className="stack-list payment-update-list">
          {myGroups.length === 0 ? <div className="empty-card">No purchase orders found yet.</div> : myGroups.map((group) => {
            const first = group.lines[0];
            const ledger = purchaseLedgerByOrder(snapshot, group.id);
            const latestPayment = latestPurchasePayment(snapshot, group.id);
            const cashTask = purchaseCashDeliveryTask(snapshot, group.id);
            const createDraft = getCreateDraft(group.id);
            const paymentStatus = purchasePaymentStatus(snapshot, group.id);
            const proofUrl = latestPayment?.proofName ? `${API_BASE}/uploads/payment-proofs/${latestPayment.proofName}` : createDraft.proofName ? `${API_BASE}/uploads/payment-proofs/${createDraft.proofName}` : "";
            return <article className="list-card payment-update-card" key={group.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{group.id}</strong>
                  <p>{first.supplierName} · {group.lines.length} product(s) · {purchaseWarehouseStatus(group.lines)}</p>
                </div>
                <span className={`status-pill ${paymentStatus === "Completed" ? "status-completed" : paymentStatus === "Flagged" || paymentStatus === "Disputed" ? "status-rejected" : "status-pending"}`}>Payment {paymentStatus}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Goods value</span><strong>{(ledger?.goodsValue || purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id)).toFixed(2)}</strong></div>
                <div><span className="small-label">Paid</span><strong>{(ledger?.paidAmount || 0).toFixed(2)}</strong></div>
                <div><span className="small-label">Pending</span><strong>{(ledger?.pendingAmount || purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id)).toFixed(2)}</strong></div>
                <div><span className="small-label">Latest proof</span><strong>{latestPayment?.mode || "Not shared"}</strong></div>
                <div><span className="small-label">Accounts note</span><strong>{latestPayment?.verificationNote || "No update yet"}</strong></div>
                <div><span className="small-label">UTR / Ref</span><strong>{latestPayment?.utrNumber || latestPayment?.referenceNumber || "Pending"}</strong></div>
                <div><span className="small-label">Cash delivery</span><strong>{cashTask ? `${cashTask.status} / ${cashTask.assignedTo}` : "Not assigned"}</strong></div>
              </div>
              {(ledger?.pendingAmount || purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id)) > 0 ? <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                await onCreatePayment({
                  side: "Purchase",
                  linkedOrderId: group.id,
                  amount: Number(createDraft.amount || 0),
                  mode: createDraft.mode,
                  cashTiming: createDraft.mode === "Cash" ? createDraft.cashTiming as "In Hand" | "At Delivery" : undefined,
                  referenceNumber: createDraft.referenceNumber,
                  voucherNumber: createDraft.voucherNumber || undefined,
                  utrNumber: createDraft.utrNumber || undefined,
                  proofName: createDraft.proofName || undefined,
                  verificationStatus: "Submitted",
                  verificationNote: createDraft.verificationNote || "Payment proof submitted by purchaser."
                });
              }}>
                <label>Amount<input type="number" value={createDraft.amount} onChange={(e) => setCreateDraftValue(group.id, "amount", e.target.value)} /></label>
                <label>Mode<select value={createDraft.mode} onChange={(e) => setCreateDraftValue(group.id, "mode", e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option>
                </select></label>
                {createDraft.mode === "Cash" ? <label>Cash timing<select value={createDraft.cashTiming} onChange={(e) => setCreateDraftValue(group.id, "cashTiming", e.target.value)}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}
                <label>Reference<input value={createDraft.referenceNumber} onChange={(e) => setCreateDraftValue(group.id, "referenceNumber", e.target.value)} /></label>
                <label>Voucher<input value={createDraft.voucherNumber} onChange={(e) => setCreateDraftValue(group.id, "voucherNumber", e.target.value)} /></label>
                <label>UTR<input value={createDraft.utrNumber} onChange={(e) => setCreateDraftValue(group.id, "utrNumber", e.target.value)} /></label>
                <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadCreateProof(group.id, e.target.files?.[0] || null)} /></label>
                <label>Proof name<input value={createDraft.proofName} onChange={(e) => setCreateDraftValue(group.id, "proofName", e.target.value)} /></label>
                <label className="wide-field">Note<input value={createDraft.verificationNote} onChange={(e) => setCreateDraftValue(group.id, "verificationNote", e.target.value)} placeholder="Message for accounts" /></label>
                <div className="payment-card-actions wide-field">
                  <button className="primary-button" type="submit">Submit payment proof</button>
                  {uploadingId === group.id ? <span className="small-label">Uploading proof...</span> : null}
                  {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                </div>
              </form> : <div className="payment-card-actions top-gap">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
              </div>}
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Payment List" eyebrow="Order-wise status">
        <DataTable headers={["Payment","PO","Supplier","Amount","Mode","Reference","Status"]} rows={payments.map((payment) => {
          const order = findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId);
          const displayStatus = payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved" ? "Completed" : payment.verificationStatus === "Rejected" ? "Flagged" : payment.verificationStatus === "Disputed" ? "Disputed" : "Pending";
          const paymentKind = payment.amount < purchaseOrderPublicTotal(snapshot.purchaseOrders, payment.linkedOrderId) ? "Partial given" : "Given";
          return [payment.id, payment.linkedOrderId, order?.supplierName || "Supplier pending", payment.amount, payment.mode, payment.referenceNumber || "-", `${paymentKind} / ${displayStatus}`];
        })} />
      </Panel>
      <Panel title="My Payment Updates" eyebrow="Pending and flagged payments">
        <div className="stack-list payment-update-list">
          {payments.length === 0 ? <div className="empty-card">No purchase payments found yet.</div> : payments.map((payment) => {
            const draft = getDraft(payment);
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : draft.proofName ? `${API_BASE}/uploads/payment-proofs/${draft.proofName}` : "";
            const order = findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId);
            const canUpdate = payment.verificationStatus !== "Verified" && payment.verificationStatus !== "Resolved";
            const displayStatus = payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved"
              ? { label: "Completed", className: "status-completed" }
              : payment.verificationStatus === "Rejected"
                ? { label: "Flagged", className: "status-rejected" }
                : payment.verificationStatus === "Disputed"
                  ? { label: "Disputed", className: "status-rejected" }
                : { label: "Pending", className: "status-pending" };
            const whatsappText = encodeURIComponent(
              `Aapoorti payment proof\nPayment: ${payment.id}\nOrder: ${payment.linkedOrderId}\nSupplier: ${order?.supplierName || ""}\nAmount: ${draft.amount}\nProof: ${proofUrl || "Pending"}`
            );
            return (
              <article className="list-card payment-update-card" key={payment.id}>
                <div className="payment-update-head">
                  <div>
                    <strong>{payment.id}</strong>
                    <p>{payment.linkedOrderId} · {order?.supplierName || "Supplier pending"} · {payment.mode}</p>
                  </div>
                <span className={`status-pill ${displayStatus.className}`}>{payment.amount < purchaseOrderPublicTotal(snapshot.purchaseOrders, payment.linkedOrderId) ? "Partial given" : "Given"} / {displayStatus.label}</span>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Amount</span><strong>{payment.amount}</strong></div>
                  <div><span className="small-label">Created</span><strong>{new Date(payment.createdAt).toLocaleDateString("en-IN")}</strong></div>
                  <div><span className="small-label">Reference</span><strong>{payment.referenceNumber || "Pending"}</strong></div>
                  <div><span className="small-label">Accounts note</span><strong>{payment.verificationNote || "No note"}</strong></div>
                </div>
                {canUpdate ? <form className="form-grid top-gap" onSubmit={async (event) => {
                  event.preventDefault();
                  await onUpdatePayment(payment.id, {
                    amount: Number(draft.amount || payment.amount),
                    referenceNumber: draft.referenceNumber,
                    voucherNumber: draft.voucherNumber || undefined,
                    utrNumber: draft.utrNumber || undefined,
                    proofName: draft.proofName || undefined,
                    verificationStatus: draft.verificationStatus === "Rejected" || draft.verificationStatus === "Verified" || draft.verificationStatus === "Resolved" ? "Submitted" : draft.verificationStatus,
                    verificationNote: draft.verificationNote
                  });
                }}>
                  <label>Amount<input type="number" value={draft.amount} onChange={(e) => setDraftValue(payment.id, "amount", e.target.value)} /></label>
                  <label>Reference<input value={draft.referenceNumber} onChange={(e) => setDraftValue(payment.id, "referenceNumber", e.target.value)} /></label>
                  <label>Voucher<input value={draft.voucherNumber} onChange={(e) => setDraftValue(payment.id, "voucherNumber", e.target.value)} /></label>
                  <label>UTR<input value={draft.utrNumber} onChange={(e) => setDraftValue(payment.id, "utrNumber", e.target.value)} /></label>
                  <label>Proof name<input value={draft.proofName} onChange={(e) => setDraftValue(payment.id, "proofName", e.target.value)} /></label>
                  <label>Status<select value={draft.verificationStatus} onChange={(e) => setDraftValue(payment.id, "verificationStatus", e.target.value)}>
                    <option>Pending</option>
                    <option>Submitted</option>
                    <option>Disputed</option>
                  </select></label>
                  <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadProof(payment.id, e.target.files?.[0] || null)} /></label>
                  <label className="wide-field">Note<input value={draft.verificationNote} onChange={(e) => setDraftValue(payment.id, "verificationNote", e.target.value)} placeholder="Update for accounts or supplier" /></label>
                  <div className="payment-card-actions wide-field">
                    <button className="primary-button" type="submit">Update payment</button>
                    <button className="ghost-button" type="button" onClick={() => void onUpdatePayment(payment.id, {
                      amount: Number(draft.amount || payment.amount),
                      referenceNumber: draft.referenceNumber,
                      voucherNumber: draft.voucherNumber || undefined,
                      utrNumber: draft.utrNumber || undefined,
                      proofName: draft.proofName || undefined,
                      verificationStatus: "Disputed",
                      verificationNote: draft.verificationNote || "Vendor says payment not received. Dispute raised by purchaser."
                    })}>Raise dispute</button>
                    {uploadingId === payment.id ? <span className="small-label">Uploading proof...</span> : null}
                    {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                    {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
                  </div>
                </form> : <div className="payment-card-actions top-gap">
                  {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                  {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
                </div>}
              </article>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}

function SalesPaymentsView({
  snapshot,
  currentUser,
  onUploadProof,
  onUpdatePayment
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onUpdatePayment: (id: string, body: {
    amount: number;
    referenceNumber: string;
    voucherNumber?: string;
    utrNumber?: string;
    proofName?: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
  }) => Promise<boolean | void>;
}) {
  const myOrders = snapshot.salesOrders.filter((item) => item.salesmanId === currentUser.id || item.salesmanName === currentUser.fullName);
  const myOrderIds = new Set(myOrders.flatMap((item) => [item.id, orderPublicId(item)]));
  const underPriceOrders = myOrders.filter((item) => item.status === "Draft" || item.note.toLowerCase().includes("approval requested"));
  const undeliveredOrders = myOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed");
  const pendingCollections = snapshot.ledgerEntries.filter((item) => item.side === "Sales" && myOrderIds.has(item.linkedOrderId) && item.pendingAmount > 0);
  const payments = snapshot.payments.filter((item) => item.side === "Sales" && myOrderIds.has(item.linkedOrderId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const [drafts, setDrafts] = useState<Record<string, { amount: string; referenceNumber: string; voucherNumber: string; utrNumber: string; proofName: string; verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved"; verificationNote: string }>>({});

  function getDraft(payment: AppSnapshot["payments"][number]) {
    return drafts[payment.id] || {
      amount: String(payment.amount),
      referenceNumber: payment.referenceNumber || "",
      voucherNumber: payment.voucherNumber || "",
      utrNumber: payment.utrNumber || "",
      proofName: payment.proofName || "",
      verificationStatus: payment.verificationStatus,
      verificationNote: payment.verificationNote || ""
    };
  }

  function setDraftValue(paymentId: string, field: string, value: string) {
    setDrafts((current) => ({ ...current, [paymentId]: { ...getDraft(payments.find((item) => item.id === paymentId)!), [field]: value } }));
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Sales Pending Summary" eyebrow="Follow-up reminders">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{undeliveredOrders.length}</strong><p>Undelivered orders</p></div></div>
          <div className="list-card"><div><strong>{underPriceOrders.length}</strong><p>Under-price approval pending</p></div></div>
          <div className="list-card"><div><strong>{pendingCollections.length}</strong><p>Payment not approved by accounts</p></div></div>
        </div>
      </Panel>
      <Panel title="Pending Orders" eyebrow="Undelivered and under-price">
        <div className="stack-list payment-update-list">
          {[...undeliveredOrders, ...underPriceOrders.filter((order) => !undeliveredOrders.some((item) => item.id === order.id))].slice(0, 12).map((order) => {
            const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order));
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{orderPublicId(order)}</strong>
                  <p>{order.shopName} · {order.productSku} · {order.deliveryMode}</p>
                </div>
                <span className={`status-pill ${order.status === "Draft" ? "status-rejected" : "status-pending"}`}>{order.status === "Draft" ? "Admin approval" : order.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{order.totalAmount}</strong></div>
                <div><span className="small-label">Payment pending</span><strong>{ledger?.pendingAmount ?? order.totalAmount}</strong></div>
                <div><span className="small-label">Accounts check</span><strong>{(ledger?.pendingAmount || 0) > 0 ? "Pending" : "Settled"}</strong></div>
                <div><span className="small-label">Note</span><strong>{order.note || "No note"}</strong></div>
              </div>
            </article>;
          })}
          {undeliveredOrders.length === 0 && underPriceOrders.length === 0 ? <div className="empty-card">No pending sales orders.</div> : null}
        </div>
      </Panel>
      <Panel title="Payment Proof Updates" eyebrow="Show to shopkeeper or share">
        <div className="stack-list payment-update-list">
          {payments.length === 0 ? <div className="empty-card">No sales payments found yet.</div> : payments.map((payment) => {
            const draft = getDraft(payment);
            const proofUrl = draft.proofName ? `${API_BASE}/uploads/payment-proofs/${draft.proofName}` : "";
            const order = findSalesOrderByPublicId(snapshot.salesOrders, payment.linkedOrderId);
            const whatsappText = encodeURIComponent(`Aapoorti sales payment proof\nPayment: ${payment.id}\nOrder: ${payment.linkedOrderId}\nShop: ${order?.shopName || ""}\nAmount: ${draft.amount}\nProof: ${proofUrl || "Pending"}`);
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.id}</strong>
                  <p>{payment.linkedOrderId} · {order?.shopName || "Shop"} · {payment.mode}</p>
                </div>
                <span className={`status-pill ${payment.verificationStatus === "Verified" ? "status-verified" : payment.verificationStatus === "Rejected" ? "status-rejected" : "status-pending"}`}>{payment.amount < salesOrderPublicTotal(snapshot.salesOrders, payment.linkedOrderId) ? "Partial taken" : "Taken"} / {payment.verificationStatus === "Verified" ? "Completed" : payment.verificationStatus === "Rejected" ? "Flagged" : "Pending"}</span>
              </div>
              <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                await onUpdatePayment(payment.id, {
                  amount: Number(draft.amount || payment.amount),
                  referenceNumber: draft.referenceNumber,
                  voucherNumber: draft.voucherNumber || undefined,
                  utrNumber: draft.utrNumber || undefined,
                  proofName: draft.proofName || undefined,
                  verificationStatus: payment.verificationStatus === "Verified" ? "Verified" : "Submitted",
                  verificationNote: draft.verificationNote
                });
              }}>
                <label>Amount<input type="number" value={draft.amount} onChange={(e) => setDraftValue(payment.id, "amount", e.target.value)} /></label>
                <label>Reference<input value={draft.referenceNumber} onChange={(e) => setDraftValue(payment.id, "referenceNumber", e.target.value)} /></label>
                <label>Voucher<input value={draft.voucherNumber} onChange={(e) => setDraftValue(payment.id, "voucherNumber", e.target.value)} /></label>
                <label>UTR<input value={draft.utrNumber} onChange={(e) => setDraftValue(payment.id, "utrNumber", e.target.value)} /></label>
                <label className="wide-field">Proof name<input value={draft.proofName} onChange={(e) => setDraftValue(payment.id, "proofName", e.target.value)} /></label>
                <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setDraftValue(payment.id, "proofName", String((uploaded as { fileName: string }).fileName)); }} /></label>
                <label className="wide-field">Note<input value={draft.verificationNote} onChange={(e) => setDraftValue(payment.id, "verificationNote", e.target.value)} placeholder="Update for accounts" /></label>
                <div className="payment-card-actions wide-field">
                  <button className="primary-button" type="submit">Submit to accounts</button>
                  {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                  {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
                </div>
              </form>
            </article>;
          })}
        </div>
      </Panel>
    </section>
  );
}

function AccountsPaymentsView({
  snapshot,
  onUploadProof,
  onCreatePayment,
  onCreateDeliveryTask,
  onVerify
}: {
  snapshot: AppSnapshot;
  onUploadProof: (file: File) => Promise<unknown>;
  onCreatePayment: (body: {
    side: "Purchase" | "Sales";
    linkedOrderId: string;
    amount: number;
    mode: PaymentMode;
    cashTiming?: string;
    referenceNumber: string;
    voucherNumber?: string;
    utrNumber?: string;
    proofName?: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
  }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; mode: DeliveryTask["mode"]; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onVerify: (paymentId: string, verificationStatus: "Verified" | "Rejected" | "Resolved", verificationNote: string) => Promise<boolean | void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
    const pending = snapshot.payments.filter((item) => item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved");
    const completed = snapshot.payments.filter((item) => item.verificationStatus === "Verified" || item.verificationStatus === "Resolved");
  const dayCash = snapshot.payments.filter((item) => item.mode === "Cash" && item.createdAt.slice(0, 10) === today).reduce((sum, item) => sum + item.amount, 0);
  const deliveryUsers = snapshot.users.filter((user) => user.role === "Delivery" || user.roles.includes("Delivery"));
    const accountOrderOptions = [
      ...groupPurchaseOrders(snapshot.purchaseOrders).map((group) => ({ id: group.id, side: "Purchase" as const, party: group.lines[0]?.supplierName || "Supplier", pendingAmount: purchaseLedgerByOrder(snapshot, group.id)?.pendingAmount ?? purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id) })),
      ...Array.from(new Set(snapshot.salesOrders.map((order) => orderPublicId(order)))).map((id) => ({ id, side: "Sales" as const, party: findSalesOrderByPublicId(snapshot.salesOrders, id)?.shopName || "Customer", pendingAmount: snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, id) }))
    ].filter((item) => item.pendingAmount > 0);
    const purchaseOrderPendingOptions = accountOrderOptions.filter((item) => item.side === "Purchase");
    const salesOrderPendingOptions = accountOrderOptions.filter((item) => item.side === "Sales");
  const [createForm, setCreateForm] = useState({
    side: (accountOrderOptions[0]?.side || "Purchase") as "Purchase" | "Sales",
    linkedOrderId: accountOrderOptions[0]?.id || "",
    amount: String(accountOrderOptions[0]?.pendingAmount || 0),
    mode: "NEFT" as PaymentMode,
    cashTiming: "",
    referenceNumber: "",
    voucherNumber: "",
    utrNumber: "",
    proofName: "",
    verificationStatus: "Verified" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved",
    verificationNote: "Payment recorded by accounts"
  });
  const [deliveryAssignments, setDeliveryAssignments] = useState<Record<string, string>>({});
  return (
    <section className="dashboard-grid">
        <Panel title="Accounts Summary" eyebrow="Pending and completed">
          <div className="simple-summary payment-summary-grid">
            <div className="list-card"><div><strong>{accountOrderOptions.length}</strong><p>Orders awaiting accounts action</p></div></div>
            <div className="list-card"><div><strong>{pending.length}</strong><p>Pending payment proofs</p></div></div>
            <div className="list-card"><div><strong>{completed.length}</strong><p>Completed payments</p></div></div>
            <div className="list-card"><div><strong>{dayCash}</strong><p>Cash reported today</p></div></div>
          </div>
        </Panel>
        <Panel title="Orders Awaiting Accounts Action" eyebrow="Order-wise pending balance">
          <DataTable
            headers={["Side","Order","Party","Pending"]}
            rows={accountOrderOptions.length === 0
              ? []
              : accountOrderOptions.map((item) => [item.side, item.id, item.party, item.pendingAmount.toFixed(2)])}
          />
        </Panel>
        <Panel title="Record Payment" eyebrow="Accounts entry">
        <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault();
          await onCreatePayment({
            side: createForm.side,
            linkedOrderId: createForm.linkedOrderId,
            amount: Number(createForm.amount || 0),
            mode: createForm.mode,
            cashTiming: createForm.mode === "Cash" ? createForm.cashTiming as "In Hand" | "At Delivery" : undefined,
            referenceNumber: createForm.referenceNumber,
            voucherNumber: createForm.voucherNumber || undefined,
            utrNumber: createForm.utrNumber || undefined,
            proofName: createForm.proofName || undefined,
            verificationStatus: createForm.verificationStatus,
            verificationNote: createForm.verificationNote
          });
        }}>
          <label>Side<select value={createForm.side} onChange={(e) => {
            const side = e.target.value as "Purchase" | "Sales";
            const next = accountOrderOptions.find((item) => item.side === side);
            setCreateForm((current) => ({ ...current, side, linkedOrderId: next?.id || "", amount: String(next?.pendingAmount || 0) }));
            }}><option>Purchase</option><option>Sales</option></select></label>
            <label>Order<select value={createForm.linkedOrderId} onChange={(e) => {
              const next = accountOrderOptions.find((item) => item.id === e.target.value && item.side === createForm.side);
              setCreateForm((current) => ({ ...current, linkedOrderId: e.target.value, amount: String(next?.pendingAmount || current.amount) }));
            }}>{(createForm.side === "Purchase" ? purchaseOrderPendingOptions : salesOrderPendingOptions).map((item) => <option key={`${item.side}-${item.id}`} value={item.id}>{`${item.id} - ${item.party} - Pending ${item.pendingAmount.toFixed(2)}`}</option>)}</select></label>
          <label>Amount<input type="number" value={createForm.amount} onChange={(e) => setCreateForm((current) => ({ ...current, amount: e.target.value }))} /></label>
          <label>Mode<select value={createForm.mode} onChange={(e) => setCreateForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
          {createForm.mode === "Cash" ? <label>Cash timing<select value={createForm.cashTiming} onChange={(e) => setCreateForm((current) => ({ ...current, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}
          <label>Reference<input value={createForm.referenceNumber} onChange={(e) => setCreateForm((current) => ({ ...current, referenceNumber: e.target.value }))} /></label>
          <label>Voucher<input value={createForm.voucherNumber} onChange={(e) => setCreateForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
          <label>UTR<input value={createForm.utrNumber} onChange={(e) => setCreateForm((current) => ({ ...current, utrNumber: e.target.value }))} /></label>
          <label>Status<select value={createForm.verificationStatus} onChange={(e) => setCreateForm((current) => ({ ...current, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved" }))}><option>Verified</option><option>Submitted</option></select></label>
          <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setCreateForm((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) })); }} /></label>
          <label>Proof name<input value={createForm.proofName} onChange={(e) => setCreateForm((current) => ({ ...current, proofName: e.target.value }))} /></label>
          <label className="wide-field">Note<input value={createForm.verificationNote} onChange={(e) => setCreateForm((current) => ({ ...current, verificationNote: e.target.value }))} /></label>
          <div className="payment-card-actions wide-field"><button className="primary-button" type="submit">Record payment</button></div>
        </form>
      </Panel>
      <Panel title="Pending Verification" eyebrow="Accounts must complete payment">
        <div className="stack-list payment-update-list">
          {pending.length === 0 ? <div className="empty-card">No pending payments.</div> : pending.map((payment) => {
            const orderName = payment.side === "Purchase"
              ? findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId)?.supplierName
              : findSalesOrderByPublicId(snapshot.salesOrders, payment.linkedOrderId)?.shopName;
            const purchaseOrder = payment.side === "Purchase" ? findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId) : undefined;
            const purchaseCashTask = payment.side === "Purchase" ? purchaseCashDeliveryTask(snapshot, payment.linkedOrderId) : undefined;
            const warehouseCashOnDelivery = payment.side === "Purchase" && payment.mode === "Cash" && payment.cashTiming === "At Delivery" && purchaseOrder?.deliveryMode === "Dealer Delivery";
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : "";
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.id}</strong>
                  <p>{payment.side} · {payment.linkedOrderId} · {orderName || "Party"}</p>
                </div>
                <span className={`status-pill ${payment.verificationStatus === "Rejected" || payment.verificationStatus === "Disputed" ? "status-rejected" : "status-pending"}`}>{payment.verificationStatus}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{payment.amount}</strong></div>
                <div><span className="small-label">Mode</span><strong>{payment.mode}</strong></div>
                <div><span className="small-label">Ref</span><strong>{payment.referenceNumber || "Required"}</strong></div>
                <div><span className="small-label">Submitted</span><strong>{payment.submittedAt ? new Date(payment.submittedAt).toLocaleString("en-IN") : "Pending"}</strong></div>
                {purchaseCashTask ? <div><span className="small-label">Cash task</span><strong>{purchaseCashTask.status} / {purchaseCashTask.assignedTo}</strong></div> : null}
                {warehouseCashOnDelivery ? <div><span className="small-label">Cash path</span><strong>Cash on delivery at warehouse</strong></div> : null}
              </div>
              <div className="payment-card-actions">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                {!warehouseCashOnDelivery ? <button className="primary-button" type="button" onClick={() => void onVerify(payment.id, "Verified", "Completed by accounts")}>Mark completed</button> : null}
                <button className="ghost-button" type="button" onClick={() => void onVerify(payment.id, "Rejected", "Flagged by accounts for review")}>Flag</button>
                {payment.verificationStatus === "Disputed" ? <button className="ghost-button" type="button" onClick={() => void onVerify(payment.id, "Resolved", "Resolved after enquiry by accounts")}>Resolve dispute</button> : null}
              </div>
              {payment.side === "Purchase" && payment.mode === "Cash" && !purchaseCashTask && purchaseOrder && purchaseOrder.deliveryMode === "Self Collection" ? <div className="form-grid top-gap">
                <label>Delivery guy<select value={deliveryAssignments[payment.id] || deliveryUsers[0]?.username || "d"} onChange={(e) => setDeliveryAssignments((current) => ({ ...current, [payment.id]: e.target.value }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
                <div className="payment-card-actions wide-field">
                  <button className="ghost-button" type="button" onClick={() => void onCreateDeliveryTask({
                    side: "Purchase",
                    linkedOrderId: payment.linkedOrderId,
                    linkedOrderIds: [payment.linkedOrderId],
                    mode: purchaseOrder.deliveryMode,
                    from: "Accounts Cash",
                    to: purchaseOrder.supplierName,
                    assignedTo: deliveryAssignments[payment.id] || deliveryUsers[0]?.username || "d",
                    paymentAction: "Deliver Payment",
                    cashCollectionRequired: true,
                    status: "Planned"
                  })}>Hand cash to delivery</button>
                </div>
              </div> : null}
              {warehouseCashOnDelivery ? <p className="message success top-gap">Vendor delivers to warehouse. Accounts should wait for warehouse cash proof and warehouse confirmation. No cash-to-delivery handoff is needed here.</p> : null}
            </article>;
          })}
        </div>
      </Panel>
    </section>
  );
}

function WarehouseOperationsView({
  snapshot,
  currentUser,
  onUploadProof,
  onReceive,
  onUpdateSalesOrder,
  onCreateDeliveryTask,
  onCreateConsignment
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onReceive: (body: { purchaseOrderId: string; warehouseId: string; receivedQuantity: number; actualWeightKg: number; containerWeightKg?: number; weighingProofName?: string; note: string; confirmPartial: boolean }) => Promise<boolean | void>;
  onUpdateSalesOrder: (id: string, body: { rate: number; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; containerWeightKg?: number; weighingProofName?: string }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; mode: DeliveryTask["mode"]; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onCreateConsignment: (body: { docketIds: string[]; warehouseId: string; assignedTo: string; status: string }) => Promise<boolean | void>;
}) {
  const incomingOrders = snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const outgoingOrders = snapshot.salesOrders.filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Out for Delivery").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const incomingOrderGroups = Array.from(incomingOrders.reduce((groups, order) => {
    const key = orderPublicId(order);
    groups.set(key, [...(groups.get(key) || []), order]);
    return groups;
  }, new Map<string, PurchaseOrder[]>()).entries()).map(([id, lines]) => ({ id, lines }));
  const openDockets = snapshot.deliveryDockets.filter((item) => item.status !== "Delivered" && !item.consignmentId);
  const deliveryUsers = snapshot.users.filter((user) => user.roles.includes("Delivery") || user.role === "Delivery");
  const [consignmentDraft, setConsignmentDraft] = useState({ docketIds: [] as string[], warehouseId: "", assignedTo: "delivery" });
  const selectedDockets = openDockets.filter((item) => consignmentDraft.docketIds.includes(item.id));
  const selectedDocketWeight = selectedDockets.reduce((sum, item) => sum + item.weightKg, 0);
  const [expandedIncomingIds, setExpandedIncomingIds] = useState<Record<string, boolean>>({});
  const [incomingDrafts, setIncomingDrafts] = useState<Record<string, { receivedQuantity: string; actualWeightKg: string; containerWeightKg: string; weighingProofName: string; cashProofName: string; note: string }>>({});
  const [outgoingDrafts, setOutgoingDrafts] = useState<Record<string, { containerWeightKg: string; weighingProofName: string; assignedTo: string }>>({});

  async function uploadWeighingProof(draftKey: string, file: File | null, side: "incoming" | "outgoing") {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    if (side === "incoming") {
      setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", note: "" }), weighingProofName: fileName } }));
      return;
    }
    setOutgoingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { containerWeightKg: "0", weighingProofName: "", assignedTo: deliveryUsers[0]?.username || "delivery" }), weighingProofName: fileName } }));
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Warehouse Summary" eyebrow="Inbound and outbound">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{incomingOrderGroups.length}</strong><p>Orders to receive</p></div></div>
          <div className="list-card"><div><strong>{outgoingOrders.length}</strong><p>Orders to send</p></div></div>
          <div className="list-card"><div><strong>{snapshot.stockSummary.reduce((sum, item) => sum + item.availableQuantity, 0)}</strong><p>Available stock</p></div></div>
        </div>
      </Panel>
      <Panel title="Incoming Orders" eyebrow="Oldest first">
        <div className="stack-list payment-update-list">
          {incomingOrderGroups.length === 0 ? <div className="empty-card">No incoming orders pending.</div> : incomingOrderGroups.map((group) => {
            const first = group.lines[0];
            const totalPendingQty = group.lines.reduce((sum, order) => sum + Math.max(order.quantityOrdered - order.quantityReceived, 0), 0);
            const cumulativeWeight = group.lines.reduce((sum, order) => sum + Math.max(order.expectedWeightKg * (Math.max(order.quantityOrdered - order.quantityReceived, 0) / Math.max(order.quantityOrdered, 1)), 0), 0);
            const expanded = expandedIncomingIds[group.id] ?? false;
            const order = first;
            const pendingQty = totalPendingQty;
            const draft = incomingDrafts[first.id] || { receivedQuantity: String(Math.max(first.quantityOrdered - first.quantityReceived, 0)), actualWeightKg: String(first.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
            return <article className="list-card payment-update-card" key={group.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{group.id}</strong>
                  <p>{order.supplierName} · {order.productSku} · {order.warehouseId}</p>
                </div>
                <span className="status-pill status-pending">{group.lines.some((order) => order.status === "Partially Received") ? "Partially Received" : first.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Products</span><strong>{group.lines.length}</strong></div>
                <div><span className="small-label">Pending qty</span><strong>{totalPendingQty}</strong></div>
                <div><span className="small-label">Amount</span><strong>{group.lines.reduce((sum, order) => sum + order.totalAmount, 0).toFixed(2)}</strong></div>
                <div><span className="small-label">Cumulative weight</span><strong>{cumulativeWeight.toFixed(2)} kg</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                <button className="ghost-button" type="button" onClick={() => setExpandedIncomingIds((current) => ({ ...current, [group.id]: !expanded }))}>{expanded ? "Close lines" : "Open lines"}</button>
              </div>
              {expanded ? <div className="stack-list top-gap">{group.lines.map((line) => <div className="list-card" key={line.id}><strong>{line.productSku}</strong><p>Pending {Math.max(line.quantityOrdered - line.quantityReceived, 0)} · Expected {line.expectedWeightKg} kg · Amount {line.totalAmount}</p></div>)}</div> : null}
              {!expanded ? <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                const receivedQuantity = Number(draft.receivedQuantity || 0);
                const partial = receivedQuantity < pendingQty;
                await onReceive({
                  purchaseOrderId: order.id,
                  warehouseId: order.warehouseId,
                  receivedQuantity,
                  actualWeightKg: Number(draft.actualWeightKg || 0),
                  containerWeightKg: Number(draft.containerWeightKg || 0),
                  weighingProofName: draft.weighingProofName || undefined,
                  note: draft.note || `Received by ${currentUser.fullName}`,
                  confirmPartial: partial
                });
              }}>
                <label>Receive quantity<input type="number" value={draft.receivedQuantity} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, receivedQuantity: e.target.value } }))} /></label>
                <label>Actual weight<input type="number" value={draft.actualWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, actualWeightKg: e.target.value } }))} /></label>
                <label>Container weight<input type="number" value={draft.containerWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
                <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(order.id, e.target.files?.[0] || null, "incoming")} /></label>
                <label className="wide-field">Proof name<input value={draft.weighingProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
                <label className="wide-field">Note<input value={draft.note} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, note: e.target.value } }))} placeholder="Complete or partial receiving note" /></label>
                <div className="payment-card-actions wide-field">
                  <span className="small-label">{Number(draft.receivedQuantity || 0) < pendingQty ? `Partial receive: ${pendingQty - Number(draft.receivedQuantity || 0)} pending` : "Complete receive"}</span>
                  <button className="primary-button" type="submit">{Number(draft.receivedQuantity || 0) < pendingQty ? "Receive partial" : "Receive complete"}</button>
                </div>
              </form> : null}
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Outgoing Orders" eyebrow="Payment check before release">
        <div className="stack-list payment-update-list">
          {outgoingOrders.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : outgoingOrders.map((order) => {
            const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order))?.pendingAmount ?? order.totalAmount;
            const hasVerifiedPayment = snapshot.payments.some((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order) && item.verificationStatus === "Verified");
            const draft = outgoingDrafts[order.id] || { containerWeightKg: "0", weighingProofName: "", assignedTo: deliveryUsers[0]?.username || "delivery" };
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{order.id}</strong>
                  <p>{order.shopName} · {order.productSku} · {order.deliveryMode}</p>
                </div>
                <span className={`status-pill ${hasVerifiedPayment ? "status-verified" : "status-pending"}`}>{hasVerifiedPayment ? "Payment ok" : "Check with admin"}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Qty</span><strong>{order.quantity}</strong></div>
                <div><span className="small-label">Pending payment</span><strong>{paymentPending}</strong></div>
                <div><span className="small-label">Warehouse status</span><strong>{order.status}</strong></div>
                <div><span className="small-label">Delivery</span><strong>{order.deliveryMode}</strong></div>
              </div>
              <div className="form-grid top-gap">
                <label>Container weight<input type="number" value={draft.containerWeightKg} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
                <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(order.id, e.target.files?.[0] || null, "outgoing")} /></label>
                <label>Proof name<input value={draft.weighingProofName} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
                <label>Delivery guy<select value={draft.assignedTo} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, assignedTo: e.target.value } }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
              </div>
              <div className="payment-card-actions">
                <button className="ghost-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: order.note || "Packed by warehouse", status: "Ready for Dispatch", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>Ready for dispatch</button>
                <button className="ghost-button" type="button" onClick={() => void onCreateDeliveryTask({ side: "Sales", linkedOrderId: orderPublicId(order), linkedOrderIds: [orderPublicId(order)], mode: order.deliveryMode, from: order.warehouseId, to: order.shopName, assignedTo: draft.assignedTo, paymentAction: paymentPending > 0 ? "Collect Payment" : "None", cashCollectionRequired: paymentPending > 0, status: "Planned" })}>Tag delivery guy</button>
                <button className="primary-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: `${order.note || ""} Handed over by warehouse.`.trim(), status: "Delivered", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>Finalize delivered</button>
              </div>
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Dockets and Consignment" eyebrow="Bundle multiple shop dockets">
        <form className="form-grid" onSubmit={async (event) => {
          event.preventDefault();
          await onCreateConsignment({
            docketIds: consignmentDraft.docketIds,
            warehouseId: consignmentDraft.warehouseId,
            assignedTo: consignmentDraft.assignedTo,
            status: "Ready"
          });
          setConsignmentDraft({ docketIds: [], warehouseId: "", assignedTo: deliveryUsers[0]?.username || "d" });
        }}>
          <label>Warehouse<select value={consignmentDraft.warehouseId} onChange={(e) => setConsignmentDraft((current) => ({ ...current, warehouseId: e.target.value }))}>{renderWarehouseOptions(snapshot.warehouses)}</select></label>
          <label>Delivery user<input value={consignmentDraft.assignedTo} onChange={(e) => setConsignmentDraft((current) => ({ ...current, assignedTo: e.target.value }))} /></label>
          <label className="wide-field">Dockets<select multiple value={consignmentDraft.docketIds} onChange={(e) => setConsignmentDraft((current) => ({ ...current, docketIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>
            {openDockets.filter((docket) => !consignmentDraft.warehouseId || docket.warehouseId === consignmentDraft.warehouseId).map((docket) => <option key={docket.id} value={docket.id}>{`${docket.id} · ${docket.shopName} · ${docket.weightKg.toFixed(2)} kg`}</option>)}
          </select></label>
          <div className="payment-card-actions wide-field">
            <span className="small-label">{selectedDockets.length} docket(s) · {selectedDocketWeight.toFixed(2)} kg total consignment weight</span>
            <button className="primary-button" type="submit">Create consignment</button>
          </div>
        </form>
        <div className="stack-list payment-update-list top-gap">
          {snapshot.deliveryConsignments.length === 0 ? <div className="empty-card">No consignments yet.</div> : snapshot.deliveryConsignments.map((item) => (
            <article className="list-card payment-update-card" key={item.id}>
              <div className="payment-update-head">
                <div><strong>{item.id}</strong><p>{item.docketIds.join(", ")}</p></div>
                <span className="status-pill status-pending">{item.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Warehouse</span><strong>{item.warehouseId}</strong></div>
                <div><span className="small-label">Assigned</span><strong>{item.assignedTo}</strong></div>
                <div><span className="small-label">Total weight</span><strong>{item.totalWeightKg.toFixed(2)} kg</strong></div>
                <div><span className="small-label">Dockets</span><strong>{item.docketIds.length}</strong></div>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function WarehouseOperationsViewV2({
  snapshot,
  currentUser,
  onUploadProof,
  onUploadPaymentProof,
  onReceive,
  onUpdateSalesOrder,
  onCreateDeliveryTask,
  onCreateConsignment,
  screen = "full"
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onUploadPaymentProof: (file: File) => Promise<unknown>;
  onReceive: (body: { purchaseOrderId: string; warehouseId: string; receivedQuantity: number; actualWeightKg: number; containerWeightKg?: number; weighingProofName?: string; cashProofName?: string; note: string; confirmPartial: boolean }) => Promise<boolean | void>;
  onUpdateSalesOrder: (id: string, body: { rate: number; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; containerWeightKg?: number; weighingProofName?: string }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; mode: DeliveryTask["mode"]; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onCreateConsignment: (body: { docketIds: string[]; warehouseId: string; assignedTo: string; status: string }) => Promise<boolean | void>;
  screen?: "full" | "in" | "out";
}) {
  type PurchaseGroup = { id: string; lines: PurchaseOrder[] };
  const [activeTab, setActiveTab] = useState<"home" | "in" | "out">(screen === "in" ? "in" : screen === "out" ? "out" : "home");
  const [expandedReceive, setExpandedReceive] = useState<Record<string, boolean>>({});
  const [expandedSend, setExpandedSend] = useState<Record<string, boolean>>({});
  const [expandedReceiveSummary, setExpandedReceiveSummary] = useState<Record<string, boolean>>({});
  const [expandedSendSummary, setExpandedSendSummary] = useState<Record<string, boolean>>({});
  const [selectedReceiveLines, setSelectedReceiveLines] = useState<Record<string, string[]>>({});
    const [selectedInboundGroups, setSelectedInboundGroups] = useState<string[]>([]);
    const [inboundAssignedTo, setInboundAssignedTo] = useState("d");
  const [receiptsMode, setReceiptsMode] = useState<"receipt" | "tag">("receipt");
  const [dispatchesMode, setDispatchesMode] = useState<"dispatch" | "tag">("dispatch");
  const [incomingDrafts, setIncomingDrafts] = useState<Record<string, { receivedQuantity: string; actualWeightKg: string; containerWeightKg: string; weighingProofName: string; cashProofName: string; note: string }>>({});
  const [outgoingDrafts, setOutgoingDrafts] = useState<Record<string, { containerWeightKg: string; weighingProofName: string; assignedTo: string }>>({});
  const [receiveSummaryDrafts, setReceiveSummaryDrafts] = useState<Record<string, { proofName: string }>>({});
  const [sendSummaryDrafts, setSendSummaryDrafts] = useState<Record<string, { proofName: string }>>({});
    const [consignmentDraft, setConsignmentDraft] = useState({ docketIds: [] as string[], warehouseId: "", assignedTo: "d" });
    const deliveryUsers = snapshot.users.filter((user) => user.role === "Delivery" || user.roles.includes("Delivery"));
    const defaultDeliveryUsername = deliveryUsers[0]?.username || "d";
  const openDockets = snapshot.deliveryDockets.filter((item) => item.status !== "Delivered" && !item.consignmentId);
    const selectedDockets = openDockets.filter((item) => consignmentDraft.docketIds.includes(item.id));
    const selectedDocketWeight = selectedDockets.reduce((sum, item) => sum + item.weightKg, 0);
  const receiptByOrderId = new Map(snapshot.receiptChecks.map((item) => [item.purchaseOrderId, item]));
  const supplierById = new Map(snapshot.counterparties.filter((item) => item.type === "Supplier").map((item) => [item.id, item]));
  const customerById = new Map(snapshot.counterparties.filter((item) => item.type === "Shop").map((item) => [item.id, item]));
  const warehouseById = new Map(snapshot.warehouses.map((item) => [item.id, item]));

    useEffect(() => {
      if (screen === "in") setActiveTab("in");
      else if (screen === "out") setActiveTab("out");
      else setActiveTab("home");
    }, [screen]);
    useEffect(() => {
      if (!deliveryUsers.some((user) => user.username === inboundAssignedTo)) {
        setInboundAssignedTo(defaultDeliveryUsername);
      }
    }, [defaultDeliveryUsername, deliveryUsers, inboundAssignedTo]);
    useEffect(() => {
      if (!deliveryUsers.some((user) => user.username === consignmentDraft.assignedTo)) {
        setConsignmentDraft((current) => ({ ...current, assignedTo: defaultDeliveryUsername }));
      }
    }, [consignmentDraft.assignedTo, defaultDeliveryUsername, deliveryUsers]);

  const purchaseGroups: PurchaseGroup[] = Array.from(snapshot.purchaseOrders.reduce((groups, order) => {
    const key = orderPublicId(order);
    groups.set(key, [...(groups.get(key) || []), order]);
    return groups;
  }, new Map<string, PurchaseOrder[]>()).entries()).map(([id, lines]) => ({ id, lines }));

  function groupDate(group: PurchaseGroup) {
    return Math.min(...group.lines.map((line) => new Date(line.createdAt).getTime()));
  }

  function groupTotal(group: PurchaseGroup) {
    return group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  }

  function groupPendingQty(group: PurchaseGroup) {
    return group.lines.reduce((sum, line) => sum + Math.max(line.quantityOrdered - line.quantityReceived, 0), 0);
  }

  function groupWeight(group: PurchaseGroup, pendingOnly: boolean) {
    return group.lines.reduce((sum, line) => {
      const qty = pendingOnly ? Math.max(line.quantityOrdered - line.quantityReceived, 0) : line.quantityOrdered;
      return sum + line.expectedWeightKg * (qty / Math.max(line.quantityOrdered, 1));
    }, 0);
  }

  function purchaseLedger(group: PurchaseGroup) {
    return snapshot.ledgerEntries.find((item) => item.side === "Purchase" && item.linkedOrderId === group.id);
  }

  function groupNeedsPickupTask(group: PurchaseGroup) {
    return group.lines.some((line) => line.deliveryMode === "Self Collection");
  }

  function groupVendorDeliveryCashAtDelivery(group: PurchaseGroup) {
    return group.lines.some((line) => line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery");
  }

  function paidBeforeReceiving(group: PurchaseGroup) {
    const ledger = purchaseLedger(group);
    return Boolean(ledger && ledger.pendingAmount === 0 && ledger.paidAmount > 0 && groupPendingQty(group) > 0);
  }

  function hasPartialFlag(group: PurchaseGroup, received: boolean, billDifference: number) {
    if (billDifference > 0) return true;
    if (group.lines.some((line) => receiptByOrderId.get(line.id)?.flagged)) return true;
    if (!received && group.lines.some((line) => line.status === "Partially Received")) return true;
    return false;
  }

  const pendingReceiveGroups = purchaseGroups
    .filter((group) => group.lines.some((line) => line.status !== "Received" && line.status !== "Closed"))
    .sort((left, right) =>
      Number(paidBeforeReceiving(right)) - Number(paidBeforeReceiving(left))
      || Number(Boolean(inboundTaskForGroup(left.id))) - Number(Boolean(inboundTaskForGroup(right.id)))
      || groupDate(left) - groupDate(right)
    );
  const receivedGroups = purchaseGroups
    .filter((group) => group.lines.length > 0 && group.lines.every((line) => line.status === "Received" || line.status === "Closed"))
    .sort((left, right) => groupDate(left) - groupDate(right));
  const outgoingOrders = snapshot.salesOrders
    .filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Out for Delivery")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  function inboundTaskForGroup(groupId: string) {
    return snapshot.deliveryTasks.find((task) => task.side === "Purchase" && task.linkedOrderIds.includes(groupId));
  }

  function optimizeInboundGroups(groups: PurchaseGroup[]) {
    const withCoords = groups.map((group) => {
      const supplier = supplierById.get(group.lines[0]?.supplierId || "");
      return { group, supplier };
    });
    if (withCoords.some((item) => item.supplier?.latitude === undefined || item.supplier?.longitude === undefined)) {
      return groups;
    }
    const remaining = [...withCoords];
    const ordered: PurchaseGroup[] = [];
    let current = remaining.shift();
    if (!current) return groups;
    ordered.push(current.group);
    while (remaining.length > 0) {
      const currentLat = current.supplier?.latitude || 0;
      const currentLng = current.supplier?.longitude || 0;
      let bestIndex = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      remaining.forEach((candidate, index) => {
        const dx = (candidate.supplier?.latitude || 0) - currentLat;
        const dy = (candidate.supplier?.longitude || 0) - currentLng;
        const distance = (dx * dx) + (dy * dy);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = index;
        }
      });
      current = remaining.splice(bestIndex, 1)[0];
      ordered.push(current.group);
    }
    return ordered;
  }

  function supplierAddress(group: PurchaseGroup) {
    const supplier = supplierById.get(group.lines[0]?.supplierId || "");
    return supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ") || group.lines[0]?.supplierName || "";
  }

  function sortGroupsForInboundTag(groups: PurchaseGroup[]) {
    return [...groups].sort((left, right) => supplierAddress(left).localeCompare(supplierAddress(right), "en-IN"));
  }

  function customerAddress(order: SalesOrder) {
    const customer = customerById.get(order.shopId);
    return customer?.locationLabel || [customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ") || order.shopName || "";
  }

  function sortOrdersForOutboundTag(orders: SalesOrder[]) {
    return [...orders].sort((left, right) => customerAddress(left).localeCompare(customerAddress(right), "en-IN"));
  }

  async function uploadWeighingProof(draftKey: string, file: File | null, side: "incoming" | "outgoing") {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    if (side === "incoming") {
      setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" }), weighingProofName: fileName } }));
    } else {
      setOutgoingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { containerWeightKg: "0", weighingProofName: "", assignedTo: defaultDeliveryUsername }), weighingProofName: fileName } }));
    }
  }

  async function uploadIncomingCashProof(draftKey: string, file: File | null) {
    if (!file) return;
    const uploaded = await onUploadPaymentProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" }), cashProofName: fileName } }));
  }

  function renderReceiveGroup(group: PurchaseGroup, received: boolean) {
    const first = group.lines[0];
    const expanded = expandedReceive[group.id] ?? false;
    const summaryExpanded = expandedReceiveSummary[group.id] ?? false;
    const summaryDraft = receiveSummaryDrafts[group.id] || { proofName: "" };
    const ledger = purchaseLedger(group);
    const inboundTask = inboundTaskForGroup(group.id);
    const needsPickupTask = groupNeedsPickupTask(group);
    const vendorDeliveryCashAtDelivery = groupVendorDeliveryCashAtDelivery(group);
    const receivedValue = group.lines.reduce((sum, line) => {
      if (line.quantityOrdered <= 0) return sum;
      return sum + (line.totalAmount * (Math.min(line.quantityReceived, line.quantityOrdered) / line.quantityOrdered));
    }, 0);
    const hasAnyReceiptProgress = group.lines.some((line) => line.quantityReceived > 0 || Boolean(receiptByOrderId.get(line.id)));
    const billDifference = hasAnyReceiptProgress ? Math.max(groupTotal(group) - receivedValue, 0) : 0;
    const pendingLines = group.lines.filter((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0);
    const checkedLineIds = selectedReceiveLines[group.id] || pendingLines.map((line) => line.id);
    return <article className="list-card payment-update-card warehouse-order-card" key={group.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedReceive((current) => ({ ...current, [group.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{group.id}</strong>
          <span>{first.supplierName}</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{group.lines.length} products</span>
          <span>{groupPendingQty(group)} pending</span>
          <span>{groupWeight(group, !received).toFixed(2)} kg</span>
          <span>{new Date(first.createdAt).toLocaleString("en-IN")}</span>
        </div>
        <span className="status-pill status-pending">{received ? "Received" : needsPickupTask && inboundTask ? inboundTask.status : first.status}</span>
      </button>
      {needsPickupTask && inboundTask ? <p className="message success">Inbound task: {inboundTask.id} · {inboundTask.assignedTo} · {inboundTask.routeStops.length || 1} pickup stop(s)</p> : null}
      {!needsPickupTask ? <p className="message success">Vendor delivery. Warehouse only needs to receive and check the goods.</p> : null}
      {vendorDeliveryCashAtDelivery && !received ? <p className="message success">Cash payment will close automatically after receive when cash proof is uploaded.</p> : null}
      {paidBeforeReceiving(group) ? <p className="message success">Payment already settled. Kept on top until receiving is completed.</p> : null}
      {hasPartialFlag(group, received, billDifference) ? <p className="message error">Partial receipt / weight flag raised. Bill difference: {billDifference.toFixed(2)}</p> : null}
      {expanded ? <div className="stack-list top-gap">
        {group.lines.map((line) => {
          const pendingQty = Math.max(line.quantityOrdered - line.quantityReceived, 0);
          const draft = incomingDrafts[line.id] || { receivedQuantity: String(pendingQty), actualWeightKg: String(line.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
          const receipt = receiptByOrderId.get(line.id);
          const netWeight = receipt ? receipt.netWeightKg : Math.max(Number(draft.actualWeightKg || 0) - Number(draft.containerWeightKg || 0), 0);
          const lineNeedsCashProof = line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery";
          return <article className="list-card" key={line.id}>
            <div className="warehouse-line-head">
              {!received && pendingQty > 0 ? <label className="big-checkbox"><input type="checkbox" checked={checkedLineIds.includes(line.id)} onChange={(e) => setSelectedReceiveLines((current) => {
                const base = current[group.id] || pendingLines.map((item) => item.id);
                return { ...current, [group.id]: e.target.checked ? [...new Set([...base, line.id])] : base.filter((item) => item !== line.id) };
              })} /><span /></label> : null}
              <strong>{line.productSku}</strong>
            </div>
            <div className="payment-meta-grid">
              <div><span className="small-label">Ordered</span><strong>{line.quantityOrdered}</strong></div>
              <div><span className="small-label">Pending</span><strong>{pendingQty}</strong></div>
              <div><span className="small-label">Expected</span><strong>{line.expectedWeightKg.toFixed(2)} kg</strong></div>
              <div><span className="small-label">Net</span><strong>{netWeight.toFixed(2)} kg</strong></div>
              <div><span className="small-label">Flag</span><strong>{receipt?.flagged ? "Yes" : "No"}</strong></div>
            </div>
            {!received && pendingQty > 0 ? <div className="form-grid top-gap">
              <label>Receive qty<input type="number" value={draft.receivedQuantity} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, receivedQuantity: e.target.value } }))} /></label>
              <label>Cumulative gross weight<input type="number" value={draft.actualWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, actualWeightKg: e.target.value } }))} /></label>
              <label>Container weight<input type="number" value={draft.containerWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
              <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(line.id, e.target.files?.[0] || null, "incoming")} /></label>
              <label className="wide-field">Proof name<input value={draft.weighingProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
              {lineNeedsCashProof ? <>
                <label>Cash photo<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadIncomingCashProof(line.id, e.target.files?.[0] || null)} /></label>
                <label className="wide-field">Cash proof name<input value={draft.cashProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, cashProofName: e.target.value } }))} /></label>
              </> : null}
              <label className="wide-field">Note<input value={draft.note} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, note: e.target.value } }))} /></label>
            </div> : null}
          </article>;
        })}
        {!received && pendingLines.length > 0 ? <div className="payment-card-actions">
          <span className="small-label">{checkedLineIds.length} checked product(s)</span>
          <button className="primary-button" type="button" onClick={async () => {
            let vendorCashProofName = "";
            for (const line of pendingLines.filter((line) => checkedLineIds.includes(line.id))) {
              const pendingQty = Math.max(line.quantityOrdered - line.quantityReceived, 0);
              const draft = incomingDrafts[line.id] || { receivedQuantity: String(pendingQty), actualWeightKg: String(line.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
              const receivedQuantity = Number(draft.receivedQuantity || 0);
              const needsCashProof = line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery";
              if (needsCashProof && !draft.cashProofName) {
                window.alert("Upload cash proof for vendor-delivery cash orders.");
                return;
              }
              if (needsCashProof && draft.cashProofName) {
                vendorCashProofName = draft.cashProofName;
              }
              await onReceive({
                purchaseOrderId: line.id,
                warehouseId: line.warehouseId,
                receivedQuantity,
                actualWeightKg: Number(draft.actualWeightKg || 0),
                containerWeightKg: Number(draft.containerWeightKg || 0),
                weighingProofName: draft.weighingProofName || undefined,
                cashProofName: draft.cashProofName || undefined,
                note: draft.note || `Received by ${currentUser.fullName}`,
                confirmPartial: receivedQuantity < pendingQty
              });
            }
            if (vendorCashProofName) {
              window.alert("Cash proof linked. Payment will be marked completed with this receipt.");
            }
          }}>Receive checked products</button>
        </div> : null}
        <div className="payment-card-actions">
          <button className="ghost-button" type="button" onClick={() => setExpandedReceiveSummary((current) => ({ ...current, [group.id]: !summaryExpanded }))}>{summaryExpanded ? "Hide summary" : "Show summary"}</button>
        </div>
        {summaryExpanded ? <article className="list-card warehouse-summary-card">
          <strong>Order Summary</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Total qty</span><strong>{group.lines.reduce((sum, line) => sum + line.quantityOrdered, 0)}</strong></div>
            <div><span className="small-label">Pending qty</span><strong>{groupPendingQty(group)}</strong></div>
            <div><span className="small-label">Total weight</span><strong>{groupWeight(group, false).toFixed(2)} kg</strong></div>
            <div><span className="small-label">Pending weight</span><strong>{groupWeight(group, true).toFixed(2)} kg</strong></div>
            <div><span className="small-label">Total amount</span><strong>{groupTotal(group).toFixed(2)}</strong></div>
            <div><span className="small-label">Bill difference</span><strong>{billDifference.toFixed(2)}</strong></div>
          </div>
          <div className="form-grid top-gap">
            <label>Total stock weight photo<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setReceiveSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
            <label>Proof name<input value={summaryDraft.proofName} onChange={(e) => setReceiveSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: e.target.value } }))} /></label>
          </div>
        </article> : null}
      </div> : null}
    </article>;
  }

  function receivedQuantityLabel(value: string, pendingQty: number) {
    const qty = Number(value || 0);
    return qty < pendingQty ? `Partial receive: ${pendingQty - qty} pending` : "Complete receive";
  }

  function renderOutgoingOrder(order: SalesOrder, mode: "check-out" | "tag-out") {
    const expanded = expandedSend[order.id] ?? false;
    const summaryExpanded = expandedSendSummary[order.id] ?? false;
    const summaryDraft = sendSummaryDrafts[order.id] || { proofName: "" };
    const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order))?.pendingAmount ?? order.totalAmount;
    const draft = outgoingDrafts[order.id] || { containerWeightKg: "0", weighingProofName: "", assignedTo: defaultDeliveryUsername };
    const needsAccountsCheck = paymentPending > 0;
    return <article className="list-card payment-update-card warehouse-order-card" key={order.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedSend((current) => ({ ...current, [order.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{orderPublicId(order)}</strong>
          <span>{order.shopName}</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{order.productSku}</span>
          <span>{order.quantity} qty</span>
          <span>{order.totalAmount.toFixed(2)}</span>
          <span>{new Date(order.createdAt).toLocaleString("en-IN")}</span>
        </div>
        <span className="status-pill status-pending">{order.status}</span>
      </button>
      {expanded ? <div className="form-grid top-gap">
        <label>Container weight<input type="number" value={draft.containerWeightKg} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
        <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(order.id, e.target.files?.[0] || null, "outgoing")} /></label>
        <label>Proof name<input value={draft.weighingProofName} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
        <label>Delivery guy<select value={draft.assignedTo} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, assignedTo: e.target.value } }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
        <div className="payment-card-actions wide-field">
          {mode === "check-out" ? <>
            <button className="ghost-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: order.note || "Packed by warehouse", status: "Ready for Dispatch", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>Ready for dispatch</button>
            <button className="primary-button" type="button" disabled={needsAccountsCheck} onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: `${order.note || ""} Handed over by warehouse.`.trim(), status: "Delivered", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>Finalize delivered</button>
          </> : <button className="primary-button" type="button" disabled={needsAccountsCheck} onClick={() => void onCreateDeliveryTask({ side: "Sales", linkedOrderId: orderPublicId(order), linkedOrderIds: [orderPublicId(order)], mode: order.deliveryMode, from: order.warehouseId, to: order.shopName, assignedTo: draft.assignedTo, paymentAction: paymentPending > 0 ? "Collect Payment" : "None", cashCollectionRequired: paymentPending > 0, status: "Planned" })}>Tag delivery guy</button>}
        </div>
        {needsAccountsCheck ? <p className="message error wide-field">Accounts check required before outbound handover because customer payment is still pending.</p> : null}
        <div className="payment-card-actions wide-field">
          <button className="ghost-button" type="button" onClick={() => setExpandedSendSummary((current) => ({ ...current, [order.id]: !summaryExpanded }))}>{summaryExpanded ? "Hide summary" : "Show summary"}</button>
        </div>
        {summaryExpanded ? <article className="list-card warehouse-summary-card wide-field">
          <strong>Order Summary</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Total qty</span><strong>{order.quantity}</strong></div>
            <div><span className="small-label">Total weight</span><strong>{(snapshot.deliveryDockets.find((item) => item.salesOrderId === order.id)?.weightKg || 0).toFixed(2)} kg</strong></div>
            <div><span className="small-label">Total amount</span><strong>{order.totalAmount.toFixed(2)}</strong></div>
            <div><span className="small-label">Pending amount</span><strong>{paymentPending.toFixed(2)}</strong></div>
          </div>
          <div className="form-grid top-gap">
            <label>Total stock weight photo<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setSendSummaryDrafts((current) => ({ ...current, [order.id]: { proofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
            <label>Proof name<input value={summaryDraft.proofName} onChange={(e) => setSendSummaryDrafts((current) => ({ ...current, [order.id]: { proofName: e.target.value } }))} /></label>
          </div>
        </article> : null}
      </div> : null}
    </article>;
  }

  return (
    <section className="dashboard-grid warehouse-ops">
      {screen === "full" ? <Panel title="Warehouse" eyebrow="Home / In / Out">
        <div className="segmented-tabs">
          <button className={activeTab === "home" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("home")}>Home</button>
          <button className={activeTab === "in" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("in")}>In</button>
          <button className={activeTab === "out" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("out")}>Out</button>
        </div>
        <div className="simple-summary payment-summary-grid top-gap">
          <div className="list-card"><div><strong>{pendingReceiveGroups.length}</strong><p>Pending to receive</p></div></div>
          <div className="list-card"><div><strong>{receivedGroups.length}</strong><p>Received</p></div></div>
          <div className="list-card"><div><strong>{outgoingOrders.length}</strong><p>Orders to send</p></div></div>
          <div className="list-card"><div><strong>{snapshot.receiptChecks.filter((item) => item.flagged || item.partialReceipt).length}</strong><p>Partial / flagged</p></div></div>
        </div>
      </Panel> : null}
      {(screen === "full" && activeTab === "home") ? <>
        <Panel title="Warehouse Summary" eyebrow="Home">
          <div className="stack-list warehouse-order-list">
            <div className="list-card"><strong>In</strong><p>Tag inbound delivery boy and check inward orders here.</p></div>
            <div className="list-card"><strong>Out</strong><p>Check dispatch and tag outbound delivery boy here.</p></div>
          </div>
        </Panel>
      </> : null}
      {(screen === "full" ? activeTab === "in" : screen === "in") ? <>
        <Panel title="Receipts" eyebrow="Incoming orders">
          <div className="segmented-tabs">
            <button className={receiptsMode === "receipt" ? "tab-button active" : "tab-button"} type="button" onClick={() => setReceiptsMode("receipt")}>Receipt</button>
            <button className={receiptsMode === "tag" ? "tab-button active" : "tab-button"} type="button" onClick={() => setReceiptsMode("tag")}>Tag</button>
          </div>
        </Panel>
        {receiptsMode === "tag" ? <Panel title="Tag In Delivery Boy" eyebrow="Self collection only">
          <form className="form-grid" onSubmit={async (event) => {
            event.preventDefault();
            const chosenGroups = optimizeInboundGroups(sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => selectedInboundGroups.includes(group.id) && !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))));
            if (chosenGroups.length === 0) return;
            const routeStops = chosenGroups.map((group) => {
              const first = group.lines[0];
              const supplier = supplierById.get(first.supplierId);
              const warehouse = warehouseById.get(first.warehouseId);
              return {
                orderId: group.id,
                supplierId: first.supplierId,
                supplierName: first.supplierName,
                productSummary: group.lines.map((line) => `${line.productSku} x ${line.quantityOrdered}`).join(", "),
                warehouseId: first.warehouseId,
                warehouseName: warehouse?.name || first.warehouseId,
                amountToPay: purchasePaymentStatus(snapshot, group.id) === "Completed" ? 0 : (purchaseLedger(group)?.pendingAmount || groupTotal(group)),
                paymentRequired: purchasePaymentStatus(snapshot, group.id) !== "Completed",
                paymentMode: first.paymentMode,
                cashTiming: first.cashTiming,
                paymentReference: "",
                paymentProofName: "",
                latitude: supplier?.latitude,
                longitude: supplier?.longitude,
                locationLabel: supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", "),
                reached: false,
                checked: false,
                paid: purchasePaymentStatus(snapshot, group.id) === "Completed",
                picked: false
              };
            });
            const routeLabels = routeStops.map((stop) => stop.locationLabel || stop.supplierName);
            const destination = warehouseById.get(chosenGroups[0].lines[0].warehouseId);
            await onCreateDeliveryTask({
              side: "Purchase",
              linkedOrderId: chosenGroups[0].id,
              linkedOrderIds: chosenGroups.map((group) => group.id),
              mode: "Self Collection",
              from: routeStops.map((stop) => stop.supplierName).join(", "),
              to: destination?.name || chosenGroups[0].lines[0].warehouseId,
              assignedTo: inboundAssignedTo,
              paymentAction: routeStops.some((stop) => stop.paymentRequired) ? "Deliver Payment" : "None",
              cashCollectionRequired: routeStops.some((stop) => stop.paymentRequired),
              routeHint: routeLabels.join(" -> "),
              routeStops,
              status: "Planned"
            });
            setSelectedInboundGroups([]);
          }}>
            <label>Delivery guy<select value={inboundAssignedTo} onChange={(e) => setInboundAssignedTo(e.target.value)}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
            <div className="wide-field stack-list warehouse-order-list">
              {sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))).length === 0 ? <div className="empty-card">No self-collection inbound orders waiting for tagging.</div> : sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))).map((group) => <label className="list-card big-checkbox" key={group.id}>
                <input type="checkbox" checked={selectedInboundGroups.includes(group.id)} onChange={(e) => setSelectedInboundGroups((current) => e.target.checked ? [...new Set([...current, group.id])] : current.filter((item) => item !== group.id))} />
                <span />
                <div>
                  <strong>{group.id}</strong>
                  <p>{group.lines[0].supplierName} · {supplierAddress(group)} · {group.lines.length} products · {groupPendingQty(group)} pending · {groupWeight(group, true).toFixed(2)} kg</p>
                </div>
              </label>)}
            </div>
            <div className="payment-card-actions wide-field">
              <span className="small-label">{selectedInboundGroups.length} self-collection pickup order(s) selected</span>
              <button className="primary-button" type="submit">Tag inbound pickup</button>
            </div>
          </form>
          {pendingReceiveGroups.every((group) => !groupNeedsPickupTask(group) || Boolean(inboundTaskForGroup(group.id))) ? <p className="message success top-gap">No self-collection inbound pickup is waiting. Dealer-delivery orders are received directly by warehouse.</p> : null}
        </Panel> : <>
          <Panel title="Checks On In" eyebrow="All incoming orders"><div className="warehouse-order-list">{pendingReceiveGroups.length === 0 ? <div className="empty-card">No incoming orders pending.</div> : pendingReceiveGroups.map((group) => renderReceiveGroup(group, false))}</div></Panel>
          <Panel title="In Completed" eyebrow="Warehouse checked"><div className="warehouse-order-list">{receivedGroups.length === 0 ? <div className="empty-card">No completed orders yet.</div> : receivedGroups.map((group) => renderReceiveGroup(group, true))}</div></Panel>
        </>}
      </> : null}
      {(screen === "full" ? activeTab === "out" : screen === "out") ? <>
        <Panel title="Dispatches" eyebrow="Outgoing orders">
          <div className="segmented-tabs">
            <button className={dispatchesMode === "dispatch" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDispatchesMode("dispatch")}>Dispatch</button>
            <button className={dispatchesMode === "tag" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDispatchesMode("tag")}>Tag</button>
          </div>
        </Panel>
        {dispatchesMode === "dispatch" ? <Panel title="Checks On Out" eyebrow="Outbound checks">
          {outgoingOrders.some((order) => (snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order))?.pendingAmount ?? order.totalAmount) > 0) ? <p className="message error top-gap">Accounts check is required before outbound handover when customer payment is still pending.</p> : null}
          <div className="warehouse-order-list">{outgoingOrders.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : outgoingOrders.map((order) => renderOutgoingOrder(order, "check-out"))}</div>
        </Panel> : <>
          <Panel title="Tag Out Delivery Boy" eyebrow="Assign outgoing orders"><div className="warehouse-order-list">{outgoingOrders.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : sortOrdersForOutboundTag(outgoingOrders).map((order) => renderOutgoingOrder(order, "tag-out"))}</div></Panel>
          <Panel title="Dockets and Consignment" eyebrow="Bundle multiple shop dockets"><form className="form-grid" onSubmit={async (event) => { event.preventDefault(); await onCreateConsignment({ docketIds: consignmentDraft.docketIds, warehouseId: consignmentDraft.warehouseId, assignedTo: consignmentDraft.assignedTo, status: "Ready" }); setConsignmentDraft({ docketIds: [], warehouseId: "", assignedTo: "delivery" }); }}><label>Warehouse<select value={consignmentDraft.warehouseId} onChange={(e) => setConsignmentDraft((current) => ({ ...current, warehouseId: e.target.value }))}>{renderWarehouseOptions(snapshot.warehouses)}</select></label><label>Delivery user<select value={consignmentDraft.assignedTo} onChange={(e) => setConsignmentDraft((current) => ({ ...current, assignedTo: e.target.value }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label><label className="wide-field">Dockets<select multiple value={consignmentDraft.docketIds} onChange={(e) => setConsignmentDraft((current) => ({ ...current, docketIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>{openDockets.filter((docket) => !consignmentDraft.warehouseId || docket.warehouseId === consignmentDraft.warehouseId).map((docket) => <option key={docket.id} value={docket.id}>{`${docket.id} - ${docket.shopName} - ${docket.weightKg.toFixed(2)} kg`}</option>)}</select></label><div className="payment-card-actions wide-field"><span className="small-label">{selectedDockets.length} docket(s) - {selectedDocketWeight.toFixed(2)} kg total consignment weight</span><button className="primary-button" type="submit">Create consignment</button></div></form></Panel>
        </>}
      </> : null}
    </section>
  );
}

function DeliveryJobsView({
  snapshot,
  currentUser,
  onUploadProof,
  onUpdateTask
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onUpdateTask: (id: string, body: {
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
  }) => Promise<void>;
}) {
  const myTasks = snapshot.deliveryTasks.filter((item) => item.assignedTo === currentUser.username || item.assignedTo === currentUser.fullName);
  const [drafts, setDrafts] = useState<Record<string, { routeHint: string; weightProofName: string; cashProofName: string; cashHandoverMarked: boolean; status: DeliveryTask["status"]; routeStops: DeliveryTask["routeStops"] }>>({});
  const [currentPosition, setCurrentPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [deliveryTab, setDeliveryTab] = useState<"current" | "new" | "other">("current");
  const supplierById = new Map(snapshot.counterparties.filter((item) => item.type === "Supplier").map((item) => [item.id, item]));
  const warehouseById = new Map(snapshot.warehouses.map((item) => [item.id, item]));

  function canMarkStop(stop: DeliveryTask["routeStops"][number]) {
    if (!currentPosition || stop.latitude === undefined || stop.longitude === undefined) return true;
    const dx = currentPosition.latitude - stop.latitude;
    const dy = currentPosition.longitude - stop.longitude;
    return Math.sqrt((dx * dx) + (dy * dy)) < 0.01;
  }

  function liveStopLabel(stop: DeliveryTask["routeStops"][number]) {
    const supplier = supplierById.get(stop.supplierId || "");
    return supplier?.name || stop.supplierName;
  }

  function liveStopLocation(stop: DeliveryTask["routeStops"][number]) {
    const supplier = supplierById.get(stop.supplierId || "");
    return supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ") || stop.locationLabel || liveStopLabel(stop);
  }

  function liveWarehouseName(stop: DeliveryTask["routeStops"][number]) {
    return warehouseById.get(stop.warehouseId)?.name || stop.warehouseName;
  }

  function taskDraft(task: DeliveryTask) {
    return drafts[task.id] || {
      routeHint: task.routeHint || "",
      weightProofName: task.weightProofName || "",
      cashProofName: task.cashProofName || "",
      cashHandoverMarked: task.cashHandoverMarked,
      status: task.status,
      routeStops: task.routeStops || []
    };
  }

  function updateStopDraft(taskId: string, task: DeliveryTask, orderId: string, updates: Partial<DeliveryTask["routeStops"][number]>) {
    setDrafts((current) => {
      const draft = current[taskId] || taskDraft(task);
      const routeStops = draft.routeStops.map((stop) => stop.orderId === orderId ? { ...stop, ...updates } : stop);
      return {
        ...current,
        [taskId]: {
          ...draft,
          routeStops,
          cashHandoverMarked: routeStops.some((stop) => stop.paid)
        }
      };
    });
  }

  async function uploadStopPaymentProof(taskId: string, task: DeliveryTask, orderId: string, file: File | null) {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    updateStopDraft(taskId, task, orderId, { paymentProofName: String((uploaded as { fileName: string }).fileName) });
  }

  function taskProgressStatus(task: DeliveryTask, draft: ReturnType<typeof taskDraft>) {
    if (draft.status === "Handed Over" || draft.status === "Delivered") return draft.status;
    if (draft.routeStops.every((stop) => stop.picked)) return "Ready For Warehouse";
    if (draft.routeStops.some((stop) => stop.reached || stop.checked || stop.paid || stop.picked)) return "In Progress";
    return "New Assignment";
  }

  function stepInstruction(stop: DeliveryTask["routeStops"][number]) {
    if (!stop.reached) return `Go to ${liveStopLabel(stop)} and reach supplier location.`;
    if (!stop.checked) return `Check ${stop.productSummary} with ${liveStopLabel(stop)}.`;
    if (stop.paymentRequired && !stop.paid) {
      if (stop.paymentMode === "Cash") return `Pay ${stop.amountToPay.toFixed(2)} in cash to ${liveStopLabel(stop)} and upload proof.`;
      return `Verify payment reference ${stop.paymentReference || "pending"} with ${liveStopLabel(stop)}.`;
    }
    if (!stop.picked) return `Pick ${stop.productSummary} from ${liveStopLabel(stop)} for ${liveWarehouseName(stop)}.`;
    return `Goods picked. Move to ${liveWarehouseName(stop)}.`;
  }

  const sortedTasks = [...myTasks].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const activeTask = sortedTasks.find((task) => {
    const draft = taskDraft(task);
    return draft.status !== "Planned" && draft.status !== "Handed Over" && draft.status !== "Delivered";
  }) || null;
  const newAssignments = sortedTasks.filter((task) => taskDraft(task).status === "Planned");
  const otherTasks = sortedTasks.filter((task) => task.id !== activeTask?.id && !newAssignments.some((item) => item.id === task.id));

  function renderTask(task: DeliveryTask, compact = false) {
    const draft = taskDraft(task);
    const weightUrl = draft.weightProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.weightProofName}` : "";
    const cashUrl = draft.cashProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.cashProofName}` : "";
    const routeMapUrl = mapsDirectionsUrl([...(draft.routeStops || []).map((stop) => liveStopLocation(stop)), task.to]);
    const nextStop = draft.routeStops.find((stop) => !stop.picked) || draft.routeStops[0];

    return <article className="list-card payment-update-card" key={task.id}>
      <div className="payment-update-head">
        <div>
          <strong>{task.id}</strong>
          <p>{task.side} | {task.linkedOrderIds.join(", ")} | {task.mode}</p>
        </div>
        <span className="status-pill status-pending">{taskProgressStatus(task, draft)}</span>
      </div>
      <div className="payment-meta-grid">
        <div><span className="small-label">From</span><strong>{task.from}</strong></div>
        <div><span className="small-label">To</span><strong>{task.to}</strong></div>
        <div><span className="small-label">Stops</span><strong>{draft.routeStops.length}</strong></div>
        <div><span className="small-label">Last action</span><strong>{task.lastActionAt ? new Date(task.lastActionAt).toLocaleString("en-IN") : "Pending"}</strong></div>
      </div>
      {nextStop ? <div className="rate-warning-box top-gap">{stepInstruction(nextStop)}</div> : null}
      {compact ? <div className="payment-card-actions top-gap">
        {routeMapUrl ? <a className="ghost-button" href={routeMapUrl} target="_blank" rel="noreferrer">Open route map</a> : null}
      </div> : <>
        {draft.routeStops.length > 0 ? <div className="stack-list top-gap">
          {draft.routeStops.map((stop, index) => <article className="list-card" key={`${task.id}-${stop.orderId}`}>
            <strong>{index + 1}. {liveStopLabel(stop)}</strong>
            <p>{stop.productSummary}</p>
            <div className="payment-meta-grid">
              <div><span className="small-label">Warehouse</span><strong>{liveWarehouseName(stop)}</strong></div>
              <div><span className="small-label">MOP</span><strong>{stop.paymentRequired ? `${stop.paymentMode || "Pending"}${stop.paymentMode === "Cash" && stop.cashTiming ? ` / ${stop.cashTiming}` : ""}` : "Not needed"}</strong></div>
              <div><span className="small-label">Pay</span><strong>{stop.paymentRequired ? stop.amountToPay.toFixed(2) : "No"}</strong></div>
              <div><span className="small-label">Ref</span><strong>{stop.paymentReference || "-"}</strong></div>
              <div><span className="small-label">Reached</span><strong>{stop.reached ? "Yes" : "No"}</strong></div>
              <div><span className="small-label">Checked</span><strong>{stop.checked ? "Yes" : "No"}</strong></div>
              <div><span className="small-label">Paid</span><strong>{stop.paymentRequired ? (stop.paid ? "Yes" : "No") : "N/A"}</strong></div>
              <div><span className="small-label">Picked</span><strong>{stop.picked ? "Yes" : "No"}</strong></div>
            </div>
            {stop.paymentRequired ? <div className="form-grid top-gap">
              <label>Reference / UTR<input value={stop.paymentReference || ""} onChange={(e) => updateStopDraft(task.id, task, stop.orderId, { paymentReference: e.target.value })} /></label>
              <label>Payment proof<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadStopPaymentProof(task.id, task, stop.orderId, e.target.files?.[0] || null)} /></label>
              <label className="wide-field">Proof name<input value={stop.paymentProofName || ""} onChange={(e) => updateStopDraft(task.id, task, stop.orderId, { paymentProofName: e.target.value })} /></label>
            </div> : null}
            <div className="payment-card-actions">
              <button className="ghost-button" type="button" disabled={!canMarkStop(stop)} onClick={() => updateStopDraft(task.id, task, stop.orderId, { reached: true })}>Reached</button>
              <button className="ghost-button" type="button" disabled={!stop.reached || !canMarkStop(stop)} onClick={() => updateStopDraft(task.id, task, stop.orderId, { checked: true })}>Checked</button>
              {stop.paymentRequired ? <button className="ghost-button" type="button" disabled={!stop.checked || !canMarkStop(stop) || (stop.paymentMode === "Cash" && !stop.paymentProofName)} onClick={() => updateStopDraft(task.id, task, stop.orderId, { paid: true })}>Paid</button> : null}
              <button className="ghost-button" type="button" disabled={!stop.checked || (stop.paymentRequired && !stop.paid) || !canMarkStop(stop)} onClick={() => updateStopDraft(task.id, task, stop.orderId, { picked: true })}>Picked</button>
              {liveStopLocation(stop) ? <a className="ghost-button" href={mapsDirectionsUrl([liveStopLocation(stop)])} target="_blank" rel="noreferrer">Map</a> : null}
            </div>
            {stop.paymentRequired && stop.paymentMode === "Cash" && !stop.paymentProofName ? <p className="message error">Cash proof is required for this vendor before marking payment done.</p> : null}
            {!canMarkStop(stop) ? <p className="message error">Wrong supplier location. Update your location and retry.</p> : null}
          </article>)}
        </div> : null}
        <form className="form-grid top-gap" onSubmit={async (event) => {
          event.preventDefault();
          await onUpdateTask(task.id, {
            linkedOrderIds: task.linkedOrderIds,
            assignedTo: task.assignedTo,
            routeStops: draft.routeStops,
            pickupAt: task.pickupAt,
            dropAt: task.dropAt,
            routeHint: draft.routeHint,
            paymentAction: task.paymentAction,
            status: draft.routeStops.every((stop) => stop.picked) ? "Handed Over" : draft.status,
            cashCollectionRequired: task.cashCollectionRequired,
            cashHandoverMarked: draft.cashHandoverMarked,
            weightProofName: draft.weightProofName || undefined,
            cashProofName: draft.cashProofName || undefined,
            lastActionAt: new Date().toISOString()
          });
        }}>
          <label className="wide-field">Route hint<input value={draft.routeHint} onChange={(e) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, routeHint: e.target.value } }))} placeholder="Best route / sequence" /></label>
          <label>Status<select value={draft.status} onChange={(e) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, status: e.target.value as DeliveryTask["status"] } }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label>
          <label className="checkbox-line"><input type="checkbox" checked={draft.cashHandoverMarked} onChange={(e) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, cashHandoverMarked: e.target.checked } }))} />Cash handover marked</label>
          <label>Weight proof<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setDrafts((current) => ({ ...current, [task.id]: { ...draft, weightProofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
          <label>Cash proof<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setDrafts((current) => ({ ...current, [task.id]: { ...draft, cashProofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit">{draft.routeStops.every((stop) => stop.picked) ? "Handed over to warehouse" : "Update task"}</button>
            {routeMapUrl ? <a className="ghost-button" href={routeMapUrl} target="_blank" rel="noreferrer">Open route map</a> : null}
            {weightUrl ? <a className="ghost-button" href={weightUrl} target="_blank" rel="noreferrer">Weight proof</a> : null}
            {cashUrl ? <a className="ghost-button" href={cashUrl} target="_blank" rel="noreferrer">Cash proof</a> : null}
          </div>
        </form>
      </>}
    </article>;
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Delivery Summary" eyebrow="Route and handover">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.side === "Purchase").length}</strong><p>Inbound pickups</p></div></div>
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.side === "Sales").length}</strong><p>Outbound deliveries</p></div></div>
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.cashCollectionRequired).length}</strong><p>Cash actions</p></div></div>
        </div>
        <div className="payment-card-actions top-gap">
          <button className="ghost-button" type="button" onClick={() => navigator.geolocation.getCurrentPosition((position) => setCurrentPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude }))}>Use my location</button>
          {currentPosition ? <span className="small-label">{currentPosition.latitude.toFixed(4)}, {currentPosition.longitude.toFixed(4)}</span> : null}
        </div>
      </Panel>
      <Panel title="My Delivery Jobs" eyebrow="Step by step">
        <div className="stack-list payment-update-list">
          {deliveryTab === "current"
            ? (activeTask ? renderTask(activeTask) : <div className="empty-card">No current active delivery. Start from New Assignment.</div>)
            : deliveryTab === "new"
              ? (newAssignments.length === 0 ? <div className="empty-card">No new assignments.</div> : newAssignments.map((task) => renderTask(task, true)))
              : (otherTasks.length === 0 ? <div className="empty-card">No other pending deliveries.</div> : otherTasks.map((task) => renderTask(task, true)))}
        </div>
      </Panel>
      <div className="delivery-module-tab-bar">
        <button className={deliveryTab === "current" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryTab("current")}>Current Delivery</button>
        <button className={deliveryTab === "new" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryTab("new")}>New Assignment</button>
        <button className={deliveryTab === "other" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryTab("other")}>Other / Pending</button>
      </div>
    </section>
  );
}

function WarehouseDeliveryBoard({ snapshot }: { snapshot: AppSnapshot }) {
  const [side, setSide] = useState<"Purchase" | "Sales">("Purchase");
  const tasks = snapshot.deliveryTasks
    .filter((task) => task.side === side)
    .sort((left, right) => `${left.from} ${left.to}`.localeCompare(`${right.from} ${right.to}`, "en-IN"));

  return (
    <section className="dashboard-grid">
      <Panel title="Delivery" eyebrow="Tracking">
        <div className="segmented-tabs">
          <button className={side === "Purchase" ? "tab-button active" : "tab-button"} type="button" onClick={() => setSide("Purchase")}>In</button>
          <button className={side === "Sales" ? "tab-button active" : "tab-button"} type="button" onClick={() => setSide("Sales")}>Out</button>
        </div>
        <div className="simple-summary payment-summary-grid top-gap">
          <div className="list-card"><div><strong>{tasks.length}</strong><p>{side === "Purchase" ? "Inbound tasks" : "Outbound tasks"}</p></div></div>
          <div className="list-card"><div><strong>{tasks.filter((task) => task.status !== "Delivered").length}</strong><p>Live</p></div></div>
          <div className="list-card"><div><strong>{tasks.filter((task) => task.cashCollectionRequired).length}</strong><p>Cash actions</p></div></div>
        </div>
      </Panel>
      <Panel title={side === "Purchase" ? "Inbound Tracking" : "Outbound Tracking"} eyebrow="Sorted by route">
        <div className="stack-list payment-update-list">
          {tasks.length === 0 ? <div className="empty-card">No delivery tasks found.</div> : tasks.map((task) => (
            <article className="list-card payment-update-card" key={task.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{task.id}</strong>
                  <p>{task.from} · {task.to}</p>
                </div>
                <span className="status-pill status-pending">{task.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Orders</span><strong>{task.linkedOrderIds.join(", ")}</strong></div>
                <div><span className="small-label">Assigned</span><strong>{task.assignedTo}</strong></div>
                <div><span className="small-label">Mode</span><strong>{task.mode}</strong></div>
                <div><span className="small-label">Payment</span><strong>{task.paymentAction}</strong></div>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

function Overview({ snapshot, currentUser, simpleMode, onOpen }: { snapshot: AppSnapshot; currentUser: AppUser; simpleMode: boolean; onOpen: (view: ViewKey) => void }) {
  const roles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
  const isPurchaserOnly = roles.includes("Purchaser") && !roles.some((role) => role === "Admin" || role === "Accounts" || role === "Sales");
  const today = new Date().toISOString().slice(0, 10);
  const dailyCash = snapshot.payments.filter((item) => item.mode === "Cash" && item.createdAt.slice(0, 10) === today).reduce((sum, item) => sum + item.amount, 0);
  const quickActions: Array<{ title: string; text: string; view: ViewKey }> = [];
  if (roles.includes("Admin")) {
    quickActions.push({ title: "Products", text: "Manage product master and pricing.", view: "Products" });
    quickActions.push({ title: "Users", text: "Create users and assign roles.", view: "Users" });
    quickActions.push({ title: "Check Stock", text: "See current warehouse stock.", view: "Stock" });
    quickActions.push({ title: "MIS", text: "Review purchase, sales and payment summaries.", view: "Overview" });
  }
  if (roles.includes("Purchaser")) {
    quickActions.push({ title: "New Purchase", text: "Select supplier and place order.", view: "Purchase" });
    quickActions.push({ title: "Add Supplier", text: "Register a supplier first.", view: "Parties" });
  }
  if (roles.includes("Sales")) {
    quickActions.push({ title: "New Sale", text: "Select shop and book order.", view: "Sales" });
    quickActions.push({ title: "Add Shop", text: "Register a shop first.", view: "Parties" });
  }
  if (roles.includes("Warehouse Manager")) {
    quickActions.push({ title: "Receive Goods", text: "Check and receive stock.", view: "Receipts" });
    quickActions.push({ title: "See Stock", text: "View available stock.", view: "Stock" });
  }
  if (roles.includes("Accounts")) {
    quickActions.push({ title: "Check Payments", text: "Verify payment records.", view: "Payments" });
    quickActions.push({ title: "Check Ledger", text: "See pending and settled amounts.", view: "Ledger" });
  }
  if (roles.includes("Delivery")) {
    quickActions.push({ title: "My Delivery Jobs", text: "See pickup and drop tasks.", view: "Delivery" });
  }

  if (simpleMode) {
    return (
      <section className="dashboard-grid">
        <Panel title="Start Here" eyebrow="Simple workflow">
          <div className="simple-steps">
            {quickActions.slice(0, 6).map((action) => (
              <button key={`${action.view}-${action.title}`} type="button" className="simple-action-card" onClick={() => onOpen(action.view)}>
                <strong>{action.title}</strong>
                <span>{action.text}</span>
              </button>
            ))}
          </div>
        </Panel>
        <Panel title="Today" eyebrow="Quick summary">
          <div className="simple-summary">
            <div className="list-card"><div><strong>{snapshot.metrics.partyCount}</strong><p>Parties ready</p></div></div>
            <div className="list-card"><div><strong>{snapshot.metrics.productCount}</strong><p>Products ready</p></div></div>
            <div className="list-card"><div><strong>{snapshot.metrics.pendingPurchasePayments}</strong><p>Purchase payments pending</p></div></div>
            {!isPurchaserOnly ? <div className="list-card"><div><strong>{snapshot.metrics.pendingSalesPayments}</strong><p>Sales payments pending</p></div></div> : null}
            {roles.includes("Admin") ? <div className="list-card"><div><strong>{snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").length}</strong><p>Incoming warehouse orders</p></div></div> : null}
            {roles.includes("Admin") ? <div className="list-card"><div><strong>{snapshot.salesOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed").length}</strong><p>Open sales orders</p></div></div> : null}
            {roles.includes("Admin") || roles.includes("Accounts") ? <div className="list-card"><div><strong>{dailyCash}</strong><p>Cash of the day</p></div></div> : null}
          </div>
        </Panel>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      {roles.includes("Admin") ? <Panel title="MIS Today" eyebrow="All modules">
        <DataTable headers={["Module","Open / Pending","Key signal"]} rows={[
          ["Purchase", snapshot.purchaseOrders.filter((p) => p.status !== "Received" && p.status !== "Closed").length, `${snapshot.metrics.pendingPurchasePayments} payment pending`],
          ["Sales", snapshot.salesOrders.filter((s) => s.status !== "Delivered" && s.status !== "Closed").length, `${snapshot.metrics.pendingSalesPayments} payment pending`],
          ["Warehouse", snapshot.receiptChecks.filter((r) => r.partialReceipt || r.flagged).length, `${snapshot.metrics.availableInventoryUnits} units live`],
          ["Delivery", snapshot.deliveryTasks.filter((d) => d.status !== "Delivered").length, `${snapshot.deliveryTasks.filter((d) => d.cashCollectionRequired).length} cash actions`],
          ["Accounts", snapshot.payments.filter((p) => p.verificationStatus !== "Verified").length, `${dailyCash} cash today`]
        ]} />
      </Panel> : null}
      <Panel title="Purchase Orders" eyebrow="Inbound"><DataTable headers={["PO","Supplier","Product","Ordered","Received","Status"]} rows={snapshot.purchaseOrders.map((p) => [p.id, p.supplierName, p.productSku, p.quantityOrdered, p.quantityReceived, p.status])} /></Panel>
      <Panel title="Sales Orders" eyebrow="Outbound"><DataTable headers={["SO","Shop","Product","Qty","Delivery","Status"]} rows={snapshot.salesOrders.map((s) => [s.id, s.shopName, s.productSku, s.quantity, s.deliveryMode, s.status])} /></Panel>
      <Panel title="Payment Verification" eyebrow="Accounts"><DataTable headers={["Payment","Side","Order","Mode","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.mode, p.verificationStatus])} /></Panel>
      <Panel title="Stock Snapshot" eyebrow="Warehouse"><DataTable headers={["Warehouse","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) { return <article className="metric-card panel"><span className="small-label">{label}</span><strong>{value}</strong></article>; }
function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) { return <article className="panel"><div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>{children}</article>; }
function TwoCol({ left, right }: { left: React.ReactNode; right: React.ReactNode }) { return <section className="dashboard-grid">{left}{right}</section>; }
function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) { return <div className="table-wrap"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={headers.length}>No records yet.</td></tr> : rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, i) => <td key={`${index}-${i}`}>{cell}</td>)}</tr>)}</tbody></table></div>; }
type ProductFormState = { sku: string; name: string; division: string; department: string; section: string; category: string; unit: string; defaultGstRate: GstRateInput; defaultTaxMode: TaxModeInput; defaultWeightKg: string; toleranceKg: string; tolerancePercent: string; allowedWarehouseIds: string[] };

function ProductAdminView({
  snapshot,
  productForm,
  setProductForm,
  bulkCsv,
  setBulkCsv,
  setBulkCsvFile,
  onCreate,
  onUpdate,
  onDelete,
  onBulkImport,
  onBulkUpload
}: {
  snapshot: AppSnapshot;
  productForm: ProductFormState;
  setProductForm: React.Dispatch<React.SetStateAction<ProductFormState>>;
  bulkCsv: string;
  setBulkCsv: React.Dispatch<React.SetStateAction<string>>;
  setBulkCsvFile: React.Dispatch<React.SetStateAction<File | null>>;
  onCreate: (body: object) => void;
  onUpdate: (sku: string, body: object) => void;
  onDelete: (sku: string) => void;
  onBulkImport: (rows: object[]) => void;
  onBulkUpload: () => Promise<void>;
}) {
  const emptyForm: ProductFormState = { sku: "", name: "", division: "", department: "", section: "", category: "", unit: "", defaultGstRate: "0", defaultTaxMode: "Exclusive", defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "1", allowedWarehouseIds: snapshot.warehouses.map((warehouse) => warehouse.id) };
  const [selectedSku, setSelectedSku] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const filteredProductOptions = snapshot.products.filter((product) => `${product.sku} ${product.name} ${product.division} ${product.department} ${product.section}`.toLowerCase().includes(skuSearch.trim().toLowerCase()));
  const divisionOptions = uniqueProductFieldOptions(snapshot.products, "division");
  const departmentOptions = uniqueProductFieldOptions(snapshot.products, "department");
  const sectionOptions = uniqueProductFieldOptions(snapshot.products, "section");
  const categoryOptions = uniqueProductFieldOptions(snapshot.products, "category");

  function toPayload(form: ProductFormState) {
    return {
      ...form,
      defaultGstRate: form.defaultGstRate,
      defaultTaxMode: form.defaultTaxMode,
      defaultWeightKg: Number(form.defaultWeightKg),
      toleranceKg: Number(form.toleranceKg),
      tolerancePercent: Number(form.tolerancePercent),
      allowedWarehouseIds: form.allowedWarehouseIds.length > 0 ? form.allowedWarehouseIds : snapshot.warehouses.map((warehouse) => warehouse.id)
    };
  }

  function loadProduct(sku: string) {
    setSelectedSku(sku);
    const product = snapshot.products.find((item) => item.sku === sku);
    if (!product) return;
    setProductForm({
      sku: product.sku,
      name: product.name,
      division: product.division,
      department: product.department,
      section: product.section,
      category: product.category,
      unit: product.unit,
      defaultGstRate: product.defaultGstRate === "NA" ? "NA" : String(product.defaultGstRate) as GstRateInput,
      defaultTaxMode: product.defaultTaxMode,
      defaultWeightKg: String(product.defaultWeightKg),
      toleranceKg: String(product.toleranceKg),
      tolerancePercent: String(product.tolerancePercent),
      allowedWarehouseIds: product.allowedWarehouseIds
    });
  }

  return (
    <TwoCol
      left={<Panel title="Product Master" eyebrow="Create / modify / delete">
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); selectedSku ? onUpdate(selectedSku, toPayload(productForm)) : onCreate(toPayload(productForm)); }}>
          <label>Search SKU / Product<input value={skuSearch} placeholder="Type SKU or product name" onChange={(event) => setSkuSearch(event.target.value)} /></label>
          <label>Select SKU<select value={selectedSku} onChange={(event) => loadProduct(event.target.value)}>{renderProductOptions(filteredProductOptions)}</select></label>
          <label>SKU<input value={productForm.sku} readOnly={Boolean(selectedSku)} onChange={(event) => setProductForm((current) => ({ ...current, sku: event.target.value }))} /></label>
          <label>Name<input value={productForm.name} onChange={(event) => setProductForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Division<input list="product-division-options" value={productForm.division} placeholder="Type or select saved division" onChange={(event) => setProductForm((current) => ({ ...current, division: event.target.value }))} /></label>
          <label>Department<input list="product-department-options" value={productForm.department} placeholder="Type or select saved department" onChange={(event) => setProductForm((current) => ({ ...current, department: event.target.value }))} /></label>
          <label>Section<input list="product-section-options" value={productForm.section} placeholder="Type or select saved section" onChange={(event) => setProductForm((current) => ({ ...current, section: event.target.value }))} /></label>
          <label>Category<input list="product-category-options" value={productForm.category} placeholder="Type or select saved category" onChange={(event) => setProductForm((current) => ({ ...current, category: event.target.value }))} /></label>
          <datalist id="product-division-options">{divisionOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-department-options">{departmentOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-section-options">{sectionOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-category-options">{categoryOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <label>Unit<input value={productForm.unit} onChange={(event) => setProductForm((current) => ({ ...current, unit: event.target.value }))} /></label>
          <label>Default GST<select value={productForm.defaultGstRate} onChange={(event) => setProductForm((current) => ({ ...current, defaultGstRate: event.target.value as GstRateInput, defaultTaxMode: event.target.value === "NA" ? "NA" : (current.defaultTaxMode === "NA" ? "Exclusive" : current.defaultTaxMode) }))}><option value="NA">NA</option><option value="0">0%</option><option value="5">5%</option><option value="18">18%</option></select></label>
          <label>Default Tax<select value={productForm.defaultTaxMode} onChange={(event) => setProductForm((current) => ({ ...current, defaultTaxMode: event.target.value as TaxModeInput }))} disabled={productForm.defaultGstRate === "NA"}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option><option value="NA">Final Amount</option></select></label>
          <label>Per item / bundle weight<input type="number" value={productForm.defaultWeightKg} onChange={(event) => setProductForm((current) => ({ ...current, defaultWeightKg: event.target.value }))} /></label>
          <label>Tol. Kg<input type="number" value={productForm.toleranceKg} onChange={(event) => setProductForm((current) => ({ ...current, toleranceKg: event.target.value }))} /></label>
          <label>Tol. %<input type="number" value={productForm.tolerancePercent} onChange={(event) => setProductForm((current) => ({ ...current, tolerancePercent: event.target.value }))} /></label>
          <label>Warehouses<select multiple value={productForm.allowedWarehouseIds.length > 0 ? productForm.allowedWarehouseIds : snapshot.warehouses.map((warehouse) => warehouse.id)} onChange={(event) => setProductForm((current) => ({ ...current, allowedWarehouseIds: Array.from(event.target.selectedOptions).map((option) => option.value) }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit">{selectedSku ? "Modify product" : "Create product"}</button>
            <button className="ghost-button" type="button" onClick={() => { setSelectedSku(""); setSkuSearch(""); setProductForm(emptyForm); }}>Clear form</button>
            {selectedSku ? <button className="ghost-button danger-button" type="button" onClick={() => { onDelete(selectedSku); setSelectedSku(""); setSkuSearch(""); setProductForm(emptyForm); }}>Delete product</button> : null}
          </div>
        </form>
      </Panel>}
      right={<>
        <Panel title="Bulk Product Upload" eyebrow="Admin">
          <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onBulkImport(parseCsvRows(bulkCsv)); }}>
            <label className="wide-field">Paste CSV<textarea value={bulkCsv} onChange={(event) => setBulkCsv(event.target.value)} /></label>
            <button className="primary-button" type="submit">Import pasted CSV</button>
          </form>
          <form className="form-grid top-gap" onSubmit={(event) => { event.preventDefault(); void onBulkUpload(); }}>
            <label className="wide-field">CSV or Excel file<input accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" type="file" onChange={(event) => setBulkCsvFile(event.target.files?.[0] || null)} /></label>
            <button className="primary-button" type="submit">Upload product file</button>
          </form>
        </Panel>
        <Panel title="Products" eyebrow="Division > Department > Section"><DataTable headers={["SKU","Name","Division","Department","Section","Default GST","Per item/bundle weight"]} rows={snapshot.products.map((product) => [product.sku, product.name, product.division, product.department, product.section, product.defaultGstRate === "NA" ? "NA / Final" : `${product.defaultGstRate}% / ${product.defaultTaxMode}`, product.defaultWeightKg])} /></Panel>
      </>}
    />
  );
}

function renderOptions(items: Counterparty[]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderWarehouseOptions(items: AppSnapshot["warehouses"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderProductOptions(items: AppSnapshot["products"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.sku} value={item.sku}>{`${item.sku} - ${item.name} (${item.division} > ${item.department} > ${item.section})`}</option>)]; }
function uniqueProductFieldOptions(items: AppSnapshot["products"], field: "division" | "department" | "section" | "category") { return Array.from(new Set(items.map((item) => item[field].trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)); }
function parseCsvRows(csv: string) { const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean); const headers = header.split(",").map((item) => item.trim()); return lines.map((line) => { const cols = line.split(",").map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])); return { ...row, defaultGstRate: (row.defaultGstRate || "0") as GstRateInput, defaultTaxMode: (row.defaultTaxMode || ((row.defaultGstRate || "0") === "NA" ? "NA" : "Exclusive")) as TaxModeInput, defaultWeightKg: Number(row.defaultWeightKg || 0), toleranceKg: Number(row.toleranceKg || 0), tolerancePercent: Number(row.tolerancePercent || 1), allowedWarehouseIds: String(row.allowedWarehouseIds || "").split("|").filter(Boolean), rsp: Number(row.rsp || 0) }; }); }

export default App;
