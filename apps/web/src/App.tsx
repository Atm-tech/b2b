import axios from "axios";
import { useEffect, useState } from "react";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  DeliveryTask,
  NoteRecord,
  PaymentMode,
  SalesStatus,
  UserRole
} from "@aapoorti-b2b/domain";
import { userRoles } from "@aapoorti-b2b/domain";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "http://localhost:8080";
const SESSION_KEY = "aapoorti-b2b-user";
const TOKEN_KEY = "aapoorti-b2b-token";
const api = axios.create({
  baseURL: API_BASE
});

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

  const [userForm, setUserForm] = useState({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"] as UserRole[], password: "1234" });
  const [warehouseForm, setWarehouseForm] = useState({ id: "", name: "", city: "", address: "", type: "Warehouse" as "Warehouse" | "Yard" });
  const [productForm, setProductForm] = useState({ sku: "", name: "", division: "", department: "", section: "", category: "", unit: "", defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "0", allowedWarehouseIds: [] as string[] });
  const [bulkCsv, setBulkCsv] = useState("sku,name,division,department,section,category,unit,defaultWeightKg,toleranceKg,tolerancePercent,allowedWarehouseIds,rsp");
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [partyForm, setPartyForm] = useState({ type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: "", productSku: "", warehouseId: "", quantityOrdered: "0", rate: "0", previousRate: "0", taxableAmount: "0", gstRate: "0" as "0" | "5" | "18", gstAmount: "0", taxMode: "Exclusive" as "Exclusive" | "Inclusive", deliveryMode: "" as "Dealer Delivery" | "Self Collection" | "", paymentMode: "" as PaymentMode | "", cashTiming: "", note: "", location: null as null | { latitude: number; longitude: number; label?: string } });
  const [purchaseEditForm, setPurchaseEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Dealer Delivery" as "Dealer Delivery" | "Self Collection", note: "", status: "Pending Payment" });
  const [salesForm, setSalesForm] = useState({ shopId: "", productSku: "", warehouseId: "", quantity: "0", rate: "0", taxableAmount: "0", gstRate: "0" as "0" | "5" | "18", gstAmount: "0", taxMode: "Exclusive" as "Exclusive" | "Inclusive", paymentMode: "" as PaymentMode | "", cashTiming: "", deliveryMode: "" as "Self Collection" | "Delivery" | "", note: "", priceApprovalRequested: false, minimumAllowedRate: "0", location: null as null | { latitude: number; longitude: number; label?: string } });
  const [salesEditForm, setSalesEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Delivery" as "Self Collection" | "Delivery", note: "", status: "Booked" });
  const [paymentForm, setPaymentForm] = useState({ side: "Purchase" as "Purchase" | "Sales", linkedOrderId: "", amount: "0", mode: "NEFT" as PaymentMode, cashTiming: "", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected", verificationNote: "" });
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState({ id: "", amount: "0", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected", verificationNote: "" });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: "", warehouseId: "", receivedQuantity: "0", actualWeightKg: "0", note: "", confirmPartial: false });
  const [receiptEditForm, setReceiptEditForm] = useState({ grcNumber: "", note: "", flagged: false });
  const [deliveryForm, setDeliveryForm] = useState({ side: "Purchase" as DeliveryTask["side"], linkedOrderIdsText: "", mode: "Dealer Delivery" as DeliveryTask["mode"], from: "", to: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [deliveryEditForm, setDeliveryEditForm] = useState({ id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [partyEditForm, setPartyEditForm] = useState({ id: "", name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [noteForm, setNoteForm] = useState({ entityType: "Purchase Order" as NoteRecord["entityType"], entityId: "", note: "", visibility: "Operational" as NoteRecord["visibility"] });

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

  async function post(path: string, body: object, success: string) {
    if (!currentUser || !sessionToken) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post<AppSnapshot>(path, body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Action failed.") : "Action failed.");
    } finally {
      setLoading(false);
    }
  }

  async function patch(path: string, body: object, success: string) {
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
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Update failed.") : "Update failed.");
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
      setMessage(`${body.type} created.`);
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
            <span className="eyebrow">Aapoorti B2B</span>
            <h1>Procurement to sales workflow</h1>
            <p>Admin can now create users, products, warehouses, suppliers, shops, payment methods, and delivery charge rules.</p>
            <div className="credential-list">
              <p>`admin` / `1234`</p>
              <p>`p` / `1234`</p>
              <p>`amas` / `1234`</p>
              <p>`aakash` / `1234`</p>
              <p>`aadarsh` / `1234`</p>
              <p>`delivery` / `1234`</p>
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
  const counterparties = Array.isArray(snapshot.counterparties) ? snapshot.counterparties : [];
  const settings = snapshot.settings && Array.isArray(snapshot.settings.paymentMethods) ? snapshot.settings : { paymentMethods: [], deliveryCharge: { model: "Fixed" as const, amount: 0 } };
  const suppliers = counterparties.filter((item) => item.type === "Supplier");
  const shops = counterparties.filter((item) => item.type === "Shop");
  const paymentMethods = settings.paymentMethods.filter((item) => item.active);

  return (
    <main className={simpleMode ? "app-shell simple-shell" : "app-shell"}>
      <header className="app-topbar">
        <div className="app-topbar-copy">
          <span className="small-label">Aapoorti B2B</span>
          <strong>{labels[activeView]}</strong>
          <p>{simpleMode ? "Simple flow for quick work." : "Advanced workflow visible."}</p>
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
          <p>{simpleMode ? "Simple mode is on. Only the main steps are shown so a beginner can work without confusion." : "Advanced mode is on. All screens are visible."}</p>
        </div>
      </section> : null}

      {message ? <p className="message success">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className={simpleMode ? "workspace-shell simple-workspace" : "workspace-shell"}>
        {!simpleMode ? <aside className="sidebar panel">
          <div className="sidebar-head"><span className="eyebrow">Role Menu</span><h2>{currentUser.fullName}</h2></div>
          <nav className="side-nav">
            {safeVisibleViews.map((view) => (
              <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>
                <span>{labels[view]}</span><small>{view}</small>
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
          {activeView === "Users" ? <TwoCol left={<Panel title="Create User" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/users", { ...userForm, role: userForm.roles[0], roles: userForm.roles }, "User created."); }}><label>Username<input value={userForm.username} onChange={(e) => setUserForm((c) => ({ ...c, username: e.target.value }))} /></label><label>Name<input value={userForm.fullName} onChange={(e) => setUserForm((c) => ({ ...c, fullName: e.target.value }))} /></label><label>Mobile<input value={userForm.mobileNumber} onChange={(e) => setUserForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Roles<select multiple value={userForm.roles} onChange={(e) => setUserForm((c) => ({ ...c, roles: Array.from(e.target.selectedOptions).map((option) => option.value as UserRole) }))}>{userRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label>Password<input value={userForm.password} onChange={(e) => setUserForm((c) => ({ ...c, password: e.target.value }))} /></label><button className="primary-button" type="submit">Create user</button></form></Panel>} right={<Panel title="Users" eyebrow="Directory"><DataTable headers={["Username","Name","Roles","Mobile"]} rows={snapshot.users.map((u) => [u.username, u.fullName, (u.roles && u.roles.length > 0 ? u.roles : [u.role]).join(", "), u.mobileNumber])} /></Panel>} /> : null}
          {activeView === "Warehouses" ? <TwoCol left={<Panel title="Create Warehouse" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/warehouses", warehouseForm, "Warehouse created."); }}><label>Code<input value={warehouseForm.id} onChange={(e) => setWarehouseForm((c) => ({ ...c, id: e.target.value }))} /></label><label>Name<input value={warehouseForm.name} onChange={(e) => setWarehouseForm((c) => ({ ...c, name: e.target.value }))} /></label><label>City<input value={warehouseForm.city} onChange={(e) => setWarehouseForm((c) => ({ ...c, city: e.target.value }))} /></label><label>Type<select value={warehouseForm.type} onChange={(e) => setWarehouseForm((c) => ({ ...c, type: e.target.value as "Warehouse" | "Yard" }))}><option>Warehouse</option><option>Yard</option></select></label><label className="wide-field">Address<input value={warehouseForm.address} onChange={(e) => setWarehouseForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Create warehouse</button></form></Panel>} right={<Panel title="Warehouses" eyebrow="Receiving points"><DataTable headers={["Code","Name","City","Type"]} rows={snapshot.warehouses.map((w) => [w.id, w.name, w.city, w.type])} /></Panel>} /> : null}
          {activeView === "Products" ? <TwoCol left={<Panel title="Product Master" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/products", { ...productForm, defaultWeightKg: Number(productForm.defaultWeightKg), toleranceKg: Number(productForm.toleranceKg), tolerancePercent: Number(productForm.tolerancePercent) }, "Product created."); }}><label>SKU<input value={productForm.sku} onChange={(e) => setProductForm((c) => ({ ...c, sku: e.target.value }))} /></label><label>Name<input value={productForm.name} onChange={(e) => setProductForm((c) => ({ ...c, name: e.target.value }))} /></label><label>Division<input value={productForm.division} onChange={(e) => setProductForm((c) => ({ ...c, division: e.target.value }))} /></label><label>Department<input value={productForm.department} onChange={(e) => setProductForm((c) => ({ ...c, department: e.target.value }))} /></label><label>Section<input value={productForm.section} onChange={(e) => setProductForm((c) => ({ ...c, section: e.target.value }))} /></label><label>Category<input value={productForm.category} onChange={(e) => setProductForm((c) => ({ ...c, category: e.target.value }))} /></label><label>Unit<input value={productForm.unit} onChange={(e) => setProductForm((c) => ({ ...c, unit: e.target.value }))} /></label><label>Weight<input type="number" value={productForm.defaultWeightKg} onChange={(e) => setProductForm((c) => ({ ...c, defaultWeightKg: e.target.value }))} /></label><label>Tol. Kg<input type="number" value={productForm.toleranceKg} onChange={(e) => setProductForm((c) => ({ ...c, toleranceKg: e.target.value }))} /></label><label>Tol. %<input type="number" value={productForm.tolerancePercent} onChange={(e) => setProductForm((c) => ({ ...c, tolerancePercent: e.target.value }))} /></label><label>Warehouses<select multiple value={productForm.allowedWarehouseIds} onChange={(e) => setProductForm((c) => ({ ...c, allowedWarehouseIds: Array.from(e.target.selectedOptions).map((o) => o.value) }))}>{snapshot.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><button className="primary-button" type="submit">Create product</button></form></Panel>} right={<><Panel title="Bulk Product Upload" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/products/bulk", { rows: parseCsvRows(bulkCsv) }, "CSV products imported."); }}><label className="wide-field">Paste CSV<textarea value={bulkCsv} onChange={(e) => setBulkCsv(e.target.value)} /></label><button className="primary-button" type="submit">Import pasted CSV</button></form><form className="form-grid top-gap" onSubmit={async (e) => { e.preventDefault(); if (!bulkCsvFile) { setError("Select a CSV or Excel file first."); return; } const data = await uploadFile("/products/bulk-upload", "csv", bulkCsvFile, "Product file uploaded and imported."); if (data && typeof data === "object" && "products" in data) setSnapshot(data as AppSnapshot); }}><label className="wide-field">CSV or Excel file<input accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" type="file" onChange={(e) => setBulkCsvFile(e.target.files?.[0] || null)} /></label><button className="primary-button" type="submit">Upload product file</button></form></Panel><Panel title="Products" eyebrow="Division > Department > Section"><DataTable headers={["SKU","Name","Division","Department","Section","Weight"]} rows={snapshot.products.map((p) => [p.sku, p.name, p.division, p.department, p.section, p.defaultWeightKg])} /></Panel></>} /> : null}
          {activeView === "Parties" ? (
            isAdminUser ? <TwoCol left={<Panel title="Supplier Database" eyebrow="Read only"><DataTable headers={["Name","GST","Mobile","City"]} rows={suppliers.map((p) => [p.name, p.gstNumber, p.mobileNumber, p.city])} /></Panel>} right={<Panel title="Customer Database" eyebrow="Read only"><DataTable headers={["Name","GST","Mobile","City"]} rows={shops.map((p) => [p.name, p.gstNumber, p.mobileNumber, p.city])} /></Panel>} /> :
            <TwoCol left={<Panel title={currentUser.role === "Sales" ? "Register Customer" : "Register Supplier"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><form className="form-grid" onSubmit={async (e) => { e.preventDefault(); const forcedType = currentUser.role === "Sales" ? "Shop" : "Supplier"; await createPartyRecord({ ...partyForm, type: forcedType }); }}><label>Type<input value={currentUser.role === "Sales" ? "Customer / Shop" : "Supplier / Vendor"} readOnly /></label><label>Name<input value={partyForm.name} onChange={(e) => setPartyForm((c) => ({ ...c, name: e.target.value }))} /></label><label>GST<input value={partyForm.gstNumber} onChange={(e) => setPartyForm((c) => ({ ...c, gstNumber: e.target.value }))} /></label><label>Mobile<input value={partyForm.mobileNumber} onChange={(e) => setPartyForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyForm.contactPerson} onChange={(e) => setPartyForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyForm.city} onChange={(e) => setPartyForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyForm.address} onChange={(e) => setPartyForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">{currentUser.role === "Sales" ? "Save customer" : "Save supplier"}</button></form></Panel>} right={<><Panel title={currentUser.role === "Sales" ? "Update Customer" : "Update Supplier"} eyebrow="Edit details"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/counterparties/${partyEditForm.id}`, partyEditForm, "Party updated."); }}><label>Party<select value={partyEditForm.id} onChange={(e) => { const sourceItems = currentUser.role === "Sales" ? shops : suppliers; const item = sourceItems.find((c) => c.id === e.target.value); setPartyEditForm(item ? { id: item.id, name: item.name, gstNumber: item.gstNumber, mobileNumber: item.mobileNumber, address: item.address, city: item.city, contactPerson: item.contactPerson } : { id: "", name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" }); }}>{renderOptions(currentUser.role === "Sales" ? shops : suppliers)}</select></label><label>Name<input value={partyEditForm.name} onChange={(e) => setPartyEditForm((c) => ({ ...c, name: e.target.value }))} /></label><label>GST<input value={partyEditForm.gstNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, gstNumber: e.target.value }))} /></label><label>Mobile<input value={partyEditForm.mobileNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyEditForm.contactPerson} onChange={(e) => setPartyEditForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyEditForm.city} onChange={(e) => setPartyEditForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyEditForm.address} onChange={(e) => setPartyEditForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Update</button></form></Panel><Panel title={currentUser.role === "Sales" ? "Customer Database" : "Supplier Database"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><DataTable headers={["Name","GST","Mobile","City"]} rows={(currentUser.role === "Sales" ? shops : suppliers).map((p) => [p.name, p.gstNumber, p.mobileNumber, p.city])} /></Panel></>} />
          ) : null}
          {activeView === "Purchase" ? (isAdminUser ? <TwoCol left={<Panel title="Purchase Summary" eyebrow="Read only"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.purchaseOrders.length}</strong><p>Total purchase orders</p></div></div><div className="list-card"><div><strong>{snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").length}</strong><p>Open purchase orders</p></div></div><div className="list-card"><div><strong>{snapshot.metrics.pendingPurchasePayments}</strong><p>Pending purchase payments</p></div></div></div></Panel>} right={<Panel title="Purchase List" eyebrow="Status tracking"><DataTable headers={["PO","Supplier","Product","Taxable","GST","Total","Status"]} rows={snapshot.purchaseOrders.map((p) => [p.id, p.supplierName, p.productSku, p.taxableAmount, p.gstAmount, p.totalAmount, p.status])} /></Panel>} /> : <>
            <CatalogOrderView
            mode="purchase"
            title="Purchaser Checkout"
            eyebrow="Blinkit-style market purchase"
            products={snapshot.products}
            parties={suppliers}
            warehouses={snapshot.warehouses}
            paymentMethods={paymentMethods}
            stockSummary={snapshot.stockSummary}
            purchaseOrders={snapshot.purchaseOrders}
            orderForm={purchaseForm}
            setOrderForm={setPurchaseForm}
            onCreateParty={createPartyRecord}
            onSubmit={() => post("/purchase-orders", { ...purchaseForm, quantityOrdered: Number(purchaseForm.quantityOrdered), rate: Number(purchaseForm.rate), taxableAmount: Number(purchaseForm.taxableAmount || 0), gstRate: Number(purchaseForm.gstRate || 0), gstAmount: Number(purchaseForm.gstAmount || 0), previousRate: Number(purchaseForm.previousRate || 0), cashTiming: purchaseForm.paymentMode === "Cash" ? purchaseForm.cashTiming : undefined }, "Purchase order created.")}
            rightPanel={null}
          />
            <Panel title="My Purchase List" eyebrow="Status tracking">
              <DataTable headers={["PO","Supplier","Product","Taxable","GST","Total","Status"]} rows={snapshot.purchaseOrders.filter((p) => p.purchaserId === currentUser.id || p.purchaserName === currentUser.fullName).map((p) => [p.id, p.supplierName, p.productSku, p.taxableAmount, p.gstAmount, p.totalAmount, p.status])} />
            </Panel>
          </>) : null}
          {activeView === "Sales" ? (isAdminUser ? <TwoCol left={<Panel title="Sales Summary" eyebrow="Read only"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.salesOrders.length}</strong><p>Total sales orders</p></div></div><div className="list-card"><div><strong>{snapshot.salesOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed").length}</strong><p>Open sales orders</p></div></div><div className="list-card"><div><strong>{snapshot.metrics.pendingSalesPayments}</strong><p>Pending sales payments</p></div></div></div></Panel>} right={<Panel title="Sales Details" eyebrow="Read only"><DataTable headers={["SO","Shop","Product","Taxable","GST","Total","Status"]} rows={snapshot.salesOrders.map((s) => [s.id, s.shopName, s.productSku, s.taxableAmount, s.gstAmount, s.totalAmount, s.status])} /></Panel>} /> : <CatalogOrderView
            mode="sales"
            title="Salesman Order Booking"
            eyebrow="Blinkit-style outbound booking"
            products={snapshot.products}
            parties={shops}
            warehouses={snapshot.warehouses}
            paymentMethods={paymentMethods}
            stockSummary={snapshot.stockSummary}
            orderForm={salesForm}
            setOrderForm={setSalesForm}
            onCreateParty={createPartyRecord}
            onSubmit={() => post("/sales-orders", { ...salesForm, quantity: Number(salesForm.quantity), rate: Number(salesForm.rate), taxableAmount: Number(salesForm.taxableAmount || 0), gstRate: Number(salesForm.gstRate || 0), gstAmount: Number(salesForm.gstAmount || 0), minimumAllowedRate: Number(salesForm.minimumAllowedRate || 0), cashTiming: salesForm.paymentMode === "Cash" ? salesForm.cashTiming : undefined }, salesForm.priceApprovalRequested ? "Sales order sent for admin approval." : "Sales order created.")}
            rightPanel={null}
          />) : null}
          {activeView === "Payments" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Payment Summary" eyebrow="Read only"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.side === "Purchase" && item.verificationStatus !== "Verified").length}</strong><p>Purchase pending</p></div></div><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.side === "Sales" && item.verificationStatus !== "Verified").length}</strong><p>Sales pending</p></div></div><div className="list-card"><div><strong>{snapshot.payments.filter((item) => item.verificationStatus === "Rejected").length}</strong><p>Flagged</p></div></div></div></Panel>} right={<Panel title="Payment Details" eyebrow="Read only"><DataTable headers={["Payment","Side","Order","Mode","Reference","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.mode, p.referenceNumber || "-", p.verificationStatus])} /></Panel>} />
            ) : isPurchaserOnly ? (
              <PurchaserPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
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
                onVerify={(paymentId, verificationStatus, verificationNote) => post("/payments/verify", { paymentId, verificationStatus, verificationNote }, `Payment ${verificationStatus.toLowerCase()}.`)}
              />
            ) : null
          ) : null}
          {activeView === "Receipts" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Warehouse Summary" eyebrow="Read only"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").length}</strong><p>Incoming orders</p></div></div><div className="list-card"><div><strong>{snapshot.salesOrders.filter((item) => item.status === "Ready for Dispatch" || item.status === "Booked" || item.status === "Out for Delivery").length}</strong><p>Outgoing orders</p></div></div><div className="list-card"><div><strong>{snapshot.receiptChecks.filter((item) => item.flagged || item.partialReceipt).length}</strong><p>Flagged / partial</p></div></div></div></Panel>} right={<Panel title="Receipt Details" eyebrow="Read only"><DataTable headers={["GRC","PO","Warehouse","Received","Pending","Flagged"]} rows={snapshot.receiptChecks.map((item) => [item.grcNumber, item.purchaseOrderId, item.warehouseId, item.receivedQuantity, item.pendingQuantity, item.flagged ? "Yes" : "No"])} /></Panel>} />
            ) : isWarehouseOnly || currentRoles.includes("Warehouse Manager") ? (
              <WarehouseOperationsView
                snapshot={snapshot}
                currentUser={currentUser}
                onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
              />
            ) : null
          ) : null}
          {activeView === "Ledger" ? <TwoCol left={<Panel title="Ledger" eyebrow="Accounts visibility"><DataTable headers={["ID","Side","Order","Party","Goods","Paid","Pending"]} rows={snapshot.ledgerEntries.map((l) => [l.id, l.side, l.linkedOrderId, l.partyName, l.goodsValue, l.paidAmount, l.pendingAmount])} /></Panel>} right={<Panel title="Order Financial State" eyebrow="Pending vs settled"><DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...snapshot.purchaseOrders.map((p) => ["Purchase", p.id, p.status]), ...snapshot.salesOrders.map((s) => ["Sales", s.id, s.status])]} /></Panel>} /> : null}
          {activeView === "Stock" ? <TwoCol left={<Panel title="Closing Stock" eyebrow="Warehouse and admin"><DataTable headers={["Warehouse","SKU","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productSku, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>} right={<Panel title="Inventory Lots" eyebrow="Traceability"><DataTable headers={["Lot","Order","Warehouse","SKU","Avail","Blocked"]} rows={snapshot.inventoryLots.map((i) => [i.lotId, i.sourceOrderId, i.warehouseId, i.productSku, i.quantityAvailable, i.quantityBlocked])} /></Panel>} /> : null}
          {activeView === "Delivery" ? (
            isAdminUser ? (
              <TwoCol left={<Panel title="Delivery Summary" eyebrow="Read only"><div className="simple-summary payment-summary-grid"><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.side === "Purchase").length}</strong><p>Inbound tasks</p></div></div><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.side === "Sales").length}</strong><p>Outbound tasks</p></div></div><div className="list-card"><div><strong>{snapshot.deliveryTasks.filter((item) => item.status !== "Delivered").length}</strong><p>Live tasks</p></div></div></div></Panel>} right={<Panel title="Delivery Details" eyebrow="Read only"><DataTable headers={["ID","Side","Orders","Assigned","Mode","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.assignedTo, d.mode, d.status])} /></Panel>} />
            ) : isDeliveryOnly ? (
              <DeliveryJobsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/delivery-tasks/upload-proof", "deliveryProof", file, "Delivery proof uploaded.")}
                onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
              />
            ) : <TwoCol left={<Panel title="Delivery Task" eyebrow="Pickup and drop"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/delivery-tasks", { ...deliveryForm, linkedOrderIds: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "" }, "Delivery task created."); }}><label>Side<select value={deliveryForm.side} onChange={(e) => setDeliveryForm((c) => ({ ...c, side: e.target.value as DeliveryTask["side"] }))}><option>Purchase</option><option>Sales</option></select></label><label className="wide-field">Orders<input value={deliveryForm.linkedOrderIdsText} onChange={(e) => setDeliveryForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} placeholder="PO-1, SO-2" /></label><label>Mode<select value={deliveryForm.mode} onChange={(e) => setDeliveryForm((c) => ({ ...c, mode: e.target.value as DeliveryTask["mode"] }))}><option>Dealer Delivery</option><option>Self Collection</option><option>Delivery</option></select></label><label>Status<select value={deliveryForm.status} onChange={(e) => setDeliveryForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label>From<input value={deliveryForm.from} onChange={(e) => setDeliveryForm((c) => ({ ...c, from: e.target.value }))} /></label><label>To<input value={deliveryForm.to} onChange={(e) => setDeliveryForm((c) => ({ ...c, to: e.target.value }))} /></label><label>Assigned<input value={deliveryForm.assignedTo} onChange={(e) => setDeliveryForm((c) => ({ ...c, assignedTo: e.target.value }))} placeholder="delivery" /></label><label>Pickup time<input value={deliveryForm.pickupAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, pickupAt: e.target.value }))} placeholder="2026-04-04 10:30" /></label><label>Drop time<input value={deliveryForm.dropAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, dropAt: e.target.value }))} placeholder="2026-04-04 13:00" /></label><label>Route hint<input value={deliveryForm.routeHint} onChange={(e) => setDeliveryForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryForm.paymentAction} onChange={(e) => setDeliveryForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryForm.cashCollectionRequired} onChange={(e) => setDeliveryForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><button className="primary-button" type="submit">Create task</button></form></Panel>} right={<><Panel title="Update Delivery" eyebrow="Assignment and completion"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/delivery-tasks/${deliveryEditForm.id}`, { linkedOrderIds: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "", assignedTo: deliveryEditForm.assignedTo, pickupAt: deliveryEditForm.pickupAt, dropAt: deliveryEditForm.dropAt, routeHint: deliveryEditForm.routeHint, paymentAction: deliveryEditForm.paymentAction, cashCollectionRequired: deliveryEditForm.cashCollectionRequired, cashHandoverMarked: deliveryEditForm.cashHandoverMarked, weightProofName: deliveryEditForm.weightProofName, cashProofName: deliveryEditForm.cashProofName, status: deliveryEditForm.status }, "Delivery task updated."); }}><label>Task<select value={deliveryEditForm.id} onChange={(e) => { const item = snapshot.deliveryTasks.find((d) => d.id === e.target.value); setDeliveryEditForm(item ? { id: item.id, linkedOrderIdsText: item.linkedOrderIds.join(", "), assignedTo: item.assignedTo, pickupAt: item.pickupAt || "", dropAt: item.dropAt || "", routeHint: item.routeHint || "", paymentAction: item.paymentAction, cashCollectionRequired: item.cashCollectionRequired, cashHandoverMarked: item.cashHandoverMarked, weightProofName: item.weightProofName || "", cashProofName: item.cashProofName || "", status: item.status } : { id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None", cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" }); }}>{snapshot.deliveryTasks.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}</select></label><label className="wide-field">Orders<input value={deliveryEditForm.linkedOrderIdsText} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} /></label><label>Assigned<input value={deliveryEditForm.assignedTo} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, assignedTo: e.target.value }))} /></label><label>Pickup time<input value={deliveryEditForm.pickupAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, pickupAt: e.target.value }))} /></label><label>Drop time<input value={deliveryEditForm.dropAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, dropAt: e.target.value }))} /></label><label>Route hint<input value={deliveryEditForm.routeHint} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryEditForm.paymentAction} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label>Status<select value={deliveryEditForm.status} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashCollectionRequired} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashHandoverMarked} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashHandoverMarked: e.target.checked }))} />Cash handover marked</label><button className="primary-button" type="submit">Update task</button></form></Panel><Panel title="Delivery Tasks" eyebrow="Transport flow"><DataTable headers={["ID","Side","Orders","Mode","Assigned","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.mode, d.assignedTo, d.status])} /></Panel></>} />
          ) : null}
          {activeView === "Settings" ? <Panel title="Admin Settings" eyebrow="Payment methods and delivery"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/settings", snapshot.settings, "Settings updated."); }}>{snapshot.settings.paymentMethods.map((item, index) => <label key={item.code}>{item.code}<div className="settings-line"><input type="checkbox" checked={item.active} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, active: e.target.checked } : method) } }) : current)} />Active<input type="checkbox" checked={item.allowsCashTiming} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, allowsCashTiming: e.target.checked } : method) } }) : current)} />Cash timing</div></label>)}<label>Delivery model<select value={snapshot.settings.deliveryCharge.model} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, model: e.target.value as "Fixed" | "Per Km" } } }) : current)}><option>Fixed</option><option>Per Km</option></select></label><label>Delivery amount<input type="number" value={snapshot.settings.deliveryCharge.amount} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, amount: Number(e.target.value) } } }) : current)} /></label><button className="primary-button" type="submit">Save settings</button></form></Panel> : null}
          {activeView === "Notes" ? (isAdminUser ? <Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel> : <TwoCol left={<Panel title="Add Note" eyebrow="Authorized viewers"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/notes", noteForm, "Note added."); }}><label>Entity<select value={noteForm.entityType} onChange={(e) => setNoteForm((c) => ({ ...c, entityType: e.target.value as NoteRecord["entityType"] }))}><option>Purchase Order</option><option>Receipt</option><option>Sales Order</option><option>Payment</option><option>Delivery</option><option>Inventory</option><option>Party</option></select></label><label>ID<input value={noteForm.entityId} onChange={(e) => setNoteForm((c) => ({ ...c, entityId: e.target.value }))} /></label><label>Visibility<select value={noteForm.visibility} onChange={(e) => setNoteForm((c) => ({ ...c, visibility: e.target.value as NoteRecord["visibility"] }))}><option>Restricted</option><option>Operational</option><option>Management</option></select></label><label className="wide-field">Note<textarea value={noteForm.note} onChange={(e) => setNoteForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Add note</button></form></Panel>} right={<Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel>} />) : null}
        </div>
      </section>
      <nav className={simpleMode ? "mobile-tab-bar simple-tab-bar" : "mobile-tab-bar"}>{safeVisibleViews.map((view) => <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>{labels[view]}</button>)}</nav>
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
  onSubmit: () => Promise<void> | void;
  rightPanel: React.ReactNode;
};

function CatalogOrderView(props: CatalogOrderViewProps) {
  const { mode, title, eyebrow, products, parties, warehouses, paymentMethods, stockSummary, purchaseOrders = [], orderForm, setOrderForm, onCreateParty, onSubmit, rightPanel } = props;
  const [search, setSearch] = useState("");
  const [activeDivision, setActiveDivision] = useState("");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [flowStep, setFlowStep] = useState<"landing" | "existing" | "new" | "catalog">("catalog");
  const [cartOpen, setCartOpen] = useState(false);
  const [cartStep, setCartStep] = useState<"cart" | "payment" | "summary">("cart");
  const [cartToast, setCartToast] = useState("");
  const [cartErrors, setCartErrors] = useState<Record<string, boolean>>({});
  const [ratePopup, setRatePopup] = useState<{ product: AppSnapshot["products"][number]; rate: string; lastRate: number; confirmHighRate: boolean } | null>(null);
  const [partyDraft, setPartyDraft] = useState({ name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const isPurchase = mode === "purchase";
  const partyType = isPurchase ? "Supplier" : "Shop";
  const partyLabel = isPurchase ? "supplier / vendor" : "customer / shop";
  const divisions = Array.from(new Set(products.map((item) => item.division).filter(Boolean)));
  const showingCategoryLanding = activeDivision === "";
  const filteredProducts = products.filter((product) => {
    const matchesDivision = activeDivision === "" || product.division === activeDivision;
    const haystack = [product.name, product.division, product.department, product.section, product.brand, product.shortName, product.articleName, product.itemName, product.barcode, product.size].join(" ").toLowerCase();
    const matchesSearch = search.trim() === "" || haystack.includes(search.trim().toLowerCase());
    return matchesDivision && matchesSearch;
  });
  const searchSuggestions = search.trim() === ""
    ? []
    : products
        .filter((product) => [product.name, product.brand, product.shortName, product.barcode, product.division, product.department, product.section].join(" ").toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 6);

  function applySearchSuggestion(product: AppSnapshot["products"][number]) {
    setSearch(product.name);
    setActiveDivision(product.division || "");
    setSuggestionOpen(false);
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
      setRatePopup({
        product,
        rate: String(isPurchase ? (lastRate || getSuggestedRate(product) || 0) : (product.mrp ?? lastRate ?? 0)),
        lastRate,
        confirmHighRate: false
      });
  }

  function getOrderQuantity() {
    return Math.max(1, Number(isPurchase ? orderForm.quantityOrdered : orderForm.quantity || 1));
  }

  function setOrderQuantity(quantity: number) {
    const safeQuantity = String(Math.max(1, quantity));
    setOrderForm((current: any) => {
      const next = isPurchase ? ({ ...current, quantityOrdered: safeQuantity }) : ({ ...current, quantity: safeQuantity });
      return applyTaxCalculation(next, String(Math.max(1, quantity) * Number(current.rate || 0)), "Exclusive");
    });
  }

  function calculateTax(amountText: string, gstRateText: string, taxMode: "Exclusive" | "Inclusive") {
    const amount = Math.max(0, Number(amountText || 0));
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

  function applyTaxCalculation(form: any, amountText: string, taxMode: "Exclusive" | "Inclusive" = form.taxMode || "Exclusive") {
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
      const mode = field === "taxMode" ? value as "Exclusive" | "Inclusive" : next.taxMode;
      const amount = field === "totalAmount" || mode === "Inclusive" ? (field === "totalAmount" ? value : String(Number(next.taxableAmount || 0) + Number(next.gstAmount || 0))) : next.taxableAmount;
      return applyTaxCalculation(next, amount, mode);
    });
  }

  function adjustProductQuantity(product: AppSnapshot["products"][number], delta: number) {
    if (orderForm.productSku !== product.sku) {
      selectProduct(product);
      setOrderQuantity(Math.max(1, 1 + delta));
      return;
    }
    setOrderQuantity(getOrderQuantity() + delta);
  }

  function addProductToOrder(product: AppSnapshot["products"][number]) {
    selectProduct(product);
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
  }

  function confirmProductRate() {
    if (!ratePopup) return;
    const nextRate = Number(ratePopup.rate || 0);
    if (nextRate <= 0) {
      showCartToast("Enter product rate");
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
      const priced = applyTaxCalculation(current, String(getOrderQuantity() * nextRate), "Exclusive");
      return {
        ...current,
        productSku: ratePopup.product.sku,
        rate: String(nextRate),
        previousRate: String(ratePopup.lastRate || 0),
        warehouseId: current.warehouseId || ratePopup.product.allowedWarehouseIds[0] || "",
        taxableAmount: priced.taxableAmount,
        gstAmount: priced.gstAmount,
        taxMode: priced.taxMode,
        ...(isPurchase ? {} : {
          priceApprovalRequested: ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate,
          minimumAllowedRate: String(ratePopup.lastRate || 0),
          note: ratePopup.lastRate > 0 && nextRate < ratePopup.lastRate
            ? `Admin approval requested: sales rate ${nextRate} below last purchase price ${ratePopup.lastRate} for ${ratePopup.product.sku}.`
            : current.note
        })
      };
    });
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
    setRatePopup(null);
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
          location: null,
          priceApprovalRequested: false,
          minimumAllowedRate: "0"
        });
    setActiveDivision("");
    setSearch("");
    setCartOpen(false);
    setCartStep("cart");
    setCartErrors({});
    setCartToast("");
    setRatePopup(null);
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
        setOrderForm((current: any) => ({
          ...current,
          location: { latitude, longitude, label: `${latitude},${longitude}` }
        }));
        showCartToast(isPurchase ? "Supplier pickup location saved" : "Shop delivery location saved");
      },
      () => showCartToast("Could not capture current location"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function validateCartStep() {
    const minSaleRate = selectedProduct ? getLastPurchaseRate(selectedProduct) : 0;
    const nextErrors = {
      supplierId: isPurchase ? !orderForm.supplierId : !orderForm.shopId,
      warehouseId: !orderForm.warehouseId,
      quantityOrdered: getOrderQuantity() <= 0,
      rate: Number(orderForm.rate || 0) <= 0 || (!isPurchase && minSaleRate > 0 && Number(orderForm.rate || 0) < minSaleRate && !orderForm.priceApprovalRequested)
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
      showCartToast("Enter quantity");
      return false;
    }
    if (nextErrors.rate) {
      if (!isPurchase && minSaleRate > 0 && Number(orderForm.rate || 0) < minSaleRate && !orderForm.priceApprovalRequested) {
        showCartToast(`Sales rate cannot be below purchase price ${minSaleRate}`);
        return false;
      }
      showCartToast("Enter rate");
      return false;
    }
    return true;
  }

  function validatePaymentStep() {
    const nextErrors = {
      paymentMode: !orderForm.paymentMode,
      cashTiming: orderForm.paymentMode === "Cash" && !orderForm.cashTiming,
      deliveryMode: !orderForm.deliveryMode
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
    return true;
  }

  function getSelectedProduct() {
    return products.find((item) => item.sku === orderForm.productSku) || null;
  }

  function getAvailableStock(sku: string) {
    return stockSummary.filter((item) => item.productSku === sku).reduce((sum, item) => sum + item.availableQuantity, 0);
  }

  async function savePartyAndContinue() {
    const created = await onCreateParty({ ...partyDraft, type: partyType });
    if (!created) return;
    setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: created.id }) : ({ ...current, shopId: created.id }));
    setFlowStep("catalog");
  }

  const selectedPartyId = isPurchase ? orderForm.supplierId : orderForm.shopId;
  const selectedProduct = getSelectedProduct();
  const cartTaxable = Number(orderForm.taxableAmount || 0);
  const cartGstAmount = Number(orderForm.gstAmount || 0);
  const cartTotal = cartTaxable + cartGstAmount;
  const totalWeightKg = selectedProduct ? selectedProduct.defaultWeightKg * getOrderQuantity() : 0;
  const cartStepTitle = cartStep === "cart" ? "Cart" : cartStep === "payment" ? "Payment" : "Bill Summary";

  const mainPanel = (
        <Panel title={title} eyebrow={eyebrow}>
          <div className="catalog-shell">
            {flowStep !== "catalog" ? <div className="flow-card">
              {flowStep === "landing" ? <>
                <span className="eyebrow">Landing</span>
                <h3>{isPurchase ? "Choose supplier first" : "Start Sale"}</h3>
                <p>{isPurchase ? "Ask the purchaser to select an existing supplier or create a new supplier before opening categories." : `Select an existing ${partyLabel} or create a new one before continuing to the product page.`}</p>
                <div className="flow-action-row">
                  <button className="primary-button" type="button" onClick={() => setFlowStep("existing")}>Existing {isPurchase ? "Supplier" : "Customer"}</button>
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New {isPurchase ? "Supplier" : "Customer"}</button>
                </div>
              </> : null}
              {flowStep === "existing" ? <>
                <span className="eyebrow">Popup</span>
                <h3>Select existing {partyLabel}</h3>
                <div className="form-grid top-gap">
                  <label className="wide-field">{isPurchase ? "Supplier" : "Customer"}<select value={selectedPartyId} onChange={(e) => setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: e.target.value }) : ({ ...current, shopId: e.target.value }))}>{renderOptions(parties)}</select></label>
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
                  <label>Name<input value={partyDraft.name} onChange={(e) => setPartyDraft((c) => ({ ...c, name: e.target.value }))} /></label>
                  <label>GST<input value={partyDraft.gstNumber} onChange={(e) => setPartyDraft((c) => ({ ...c, gstNumber: e.target.value }))} /></label>
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
                      placeholder={isPurchase ? "Search item, barcode, brand, division" : "Search item, barcode, brand, stock item"}
                    />
                    {suggestionOpen && searchSuggestions.length > 0 ? <div className="search-suggestion-list">
                      {searchSuggestions.map((product) => <button key={product.sku} type="button" className="search-suggestion-item" onMouseDown={() => applySearchSuggestion(product)}>
                        <strong>{product.name}</strong>
                        <span>{product.division} / {product.section} / {product.brand || product.sku}</span>
                      </button>)}
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
                    <button key={division} type="button" className="category-card" onClick={() => setActiveDivision(division)}>
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
              <button className="ghost-button" type="button" onClick={() => { setActiveDivision(""); setSearch(""); }}>Back to categories</button>
              <div className="chip-row chip-row-scroll">
                <button type="button" className={activeDivision === "" ? "chip-button active" : "chip-button"} onClick={() => setActiveDivision("")}>All</button>
                {divisions.map((division) => (
                  <button key={division} type="button" className={division === activeDivision ? "chip-button active" : "chip-button"} onClick={() => setActiveDivision(division)}>
                    {division}
                  </button>
                ))}
              </div>
            </div>

            <div className="catalog-grid">
              {filteredProducts.map((product) => {
                const selected = orderForm.productSku === product.sku;
                const availableStock = getAvailableStock(product.sku);
                const cardQuantity = selected ? getOrderQuantity() : 1;
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

            {orderForm.productSku ? <button type="button" className="floating-checkout-button" onClick={() => setCartOpen(true)}>
              <strong>Checkout</strong>
              <span>{getOrderQuantity()} item · Total {cartTotal.toFixed(2)}</span>
            </button> : null}
            {ratePopup ? <div className="cart-overlay" onClick={() => setRatePopup(null)}>
              <div className="cart-sheet rate-popup-sheet" onClick={(e) => e.stopPropagation()}>
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
                  <label className={Number(ratePopup.rate || 0) <= 0 ? "field-error" : ""}>
                    Enter Rate
                    <input type="number" value={ratePopup.rate} onChange={(e) => setRatePopup((current) => current ? { ...current, rate: e.target.value, confirmHighRate: false } : current)} />
                  </label>
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
              </div>
            </div> : null}
            {cartOpen && selectedProduct ? <div className="cart-overlay" onClick={() => setCartOpen(false)}>
              <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
                {cartToast ? <div className="cart-toast">{cartToast}</div> : null}
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{cartStepTitle}</span>
                    <h3>{selectedProduct.name}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Close</button>
                </div>
                {cartStep === "cart" ? <>
                <div className="cart-line">
                  <div>
                    <strong>{selectedProduct.division || "General"}</strong>
                    <p>{selectedProduct.department} / {selectedProduct.section}</p>
                  </div>
                  <strong>{getOrderQuantity()} x {Number(orderForm.rate || 0)}</strong>
                </div>
                <div className="cart-edit-grid">
                  <label className={cartErrors.supplierId ? "field-error" : ""}>
                    {isPurchase ? "Supplier" : "Customer"}
                    <select value={isPurchase ? orderForm.supplierId : orderForm.shopId} onChange={(e) => { setCartErrors((current) => ({ ...current, supplierId: false })); setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: e.target.value }) : ({ ...current, shopId: e.target.value })); }}>
                      {renderOptions(parties)}
                    </select>
                  </label>
                  <label className={cartErrors.warehouseId ? "field-error" : ""}>
                    {isPurchase ? "Delivery To" : "Dispatch From"}
                    <select value={orderForm.warehouseId} onChange={(e) => { setCartErrors((current) => ({ ...current, warehouseId: false })); setOrderForm((current: any) => ({ ...current, warehouseId: e.target.value })); }}>
                      {renderWarehouseOptions(warehouses)}
                    </select>
                  </label>
                  <label className={cartErrors.quantityOrdered ? "field-error" : ""}>
                    Qty
                    <div className="cart-qty-row">
                      <button type="button" className="qty-button" onClick={() => { setCartErrors((current) => ({ ...current, quantityOrdered: false })); setOrderQuantity(getOrderQuantity() - 1); }}>-</button>
                      <input type="number" value={getOrderQuantity()} onChange={(e) => { setCartErrors((current) => ({ ...current, quantityOrdered: false })); setOrderQuantity(Number(e.target.value || 1)); }} />
                      <button type="button" className="qty-button" onClick={() => { setCartErrors((current) => ({ ...current, quantityOrdered: false })); setOrderQuantity(getOrderQuantity() + 1); }}>+</button>
                    </div>
                  </label>
                  <label className={cartErrors.rate ? "field-error" : ""}>
                    Rate
                    <input type="number" value={orderForm.rate} onChange={(e) => { setCartErrors((current) => ({ ...current, rate: false })); setOrderForm((current: any) => applyTaxCalculation({ ...current, rate: e.target.value }, String(getOrderQuantity() * Number(e.target.value || 0)), "Exclusive")); }} />
                  </label>
                  <label>
                    {isPurchase ? "Input GST Slab" : "Output GST Slab"}
                    <select value={orderForm.gstRate} onChange={(e) => updateTaxField("gstRate", e.target.value)}>
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="18">18%</option>
                    </select>
                  </label>
                  <label>
                    Amount Type
                    <select value={orderForm.taxMode} onChange={(e) => updateTaxField("taxMode", e.target.value)}>
                      <option>Exclusive</option>
                      <option>Inclusive</option>
                    </select>
                  </label>
                  {orderForm.taxMode === "Exclusive" ? <label>
                    Taxable Amount
                    <input type="number" value={orderForm.taxableAmount} onChange={(e) => updateTaxField("taxableAmount", e.target.value)} />
                  </label> : <>
                    <label>
                      Amount Including Tax
                      <input type="number" value={cartTotal.toFixed(2)} onChange={(e) => updateTaxField("totalAmount", e.target.value)} />
                    </label>
                    <label>
                      Taxable Amount
                      <input value={Number(orderForm.taxableAmount || 0).toFixed(2)} readOnly />
                    </label>
                  </>}
                  <label>
                    {isPurchase ? "Input GST" : "Output GST"}
                    <input value={Number(orderForm.gstAmount || 0).toFixed(2)} readOnly />
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
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Continue shopping</button>
                  <button type="button" className="primary-button" onClick={() => { if (validateCartStep()) setCartStep("payment"); }}>Proceed</button>
                </div>
                </> : cartStep === "payment" ? <>
                <div className="cart-edit-grid">
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
                  <div><span className="small-label">Product</span><strong>{selectedProduct.name}</strong></div>
                  <div><span className="small-label">Quantity</span><strong>{getOrderQuantity()}</strong></div>
                  <div><span className="small-label">Rate</span><strong>{Number(orderForm.rate || 0).toFixed(2)}</strong></div>
                  <div><span className="small-label">Total weight</span><strong>{totalWeightKg.toFixed(2)} kg</strong></div>
                  <div><span className="small-label">Taxable</span><strong>{cartTaxable.toFixed(2)}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Input GST" : "Output GST"} {orderForm.gstRate}%</span><strong>{cartGstAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Bill total</span><strong>{cartTotal.toFixed(2)}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{orderForm.paymentMode}{orderForm.paymentMode === "Cash" && orderForm.cashTiming ? ` / ${orderForm.cashTiming}` : ""}</strong></div>
                  <div><span className="small-label">Delivery mode</span><strong>{orderForm.deliveryMode}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Pickup location" : "Delivery location"}</span><strong>{orderForm.location?.label || (parties.find((item) => item.id === (isPurchase ? orderForm.supplierId : orderForm.shopId))?.locationLabel) || "Not marked"}</strong></div>
                </div>
                {orderForm.note ? <div className="cart-line"><div><span className="small-label">Note</span><strong>{orderForm.note}</strong></div></div> : null}
                <div className="cart-actions">
                  <button type="button" className="ghost-button" onClick={markCurrentLocation}>Mark current location</button>
                  <button type="button" className="ghost-button" onClick={() => setCartStep("payment")}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={async () => {
                      await onSubmit();
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

function PurchaserPaymentsView({
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
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected";
    verificationNote: string;
  }) => Promise<void>;
}) {
  const myOrderIds = new Set(
    snapshot.purchaseOrders
      .filter((item) => item.purchaserId === currentUser.id || item.purchaserName === currentUser.fullName)
      .map((item) => item.id)
  );
  const payments = snapshot.payments
    .filter((item) => item.side === "Purchase" && myOrderIds.has(item.linkedOrderId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const [uploadingId, setUploadingId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, {
    amount: string;
    referenceNumber: string;
    voucherNumber: string;
    utrNumber: string;
    proofName: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected";
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

  const pendingCount = payments.filter((item) => item.verificationStatus !== "Verified").length;
  const completedCount = payments.filter((item) => item.verificationStatus === "Verified").length;
  const flaggedCount = payments.filter((item) => item.verificationStatus === "Rejected").length;

  return (
    <section className="dashboard-grid">
      <Panel title="Payment Summary" eyebrow="Purchase payments only">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{pendingCount}</strong><p>Pending till accounts completes</p></div></div>
          <div className="list-card"><div><strong>{completedCount}</strong><p>Completed by accounts</p></div></div>
          <div className="list-card"><div><strong>{flaggedCount}</strong><p>Flagged by accounts</p></div></div>
        </div>
      </Panel>
      <Panel title="Payment List" eyebrow="Status tracking">
        <DataTable headers={["Payment","PO","Supplier","Amount","Mode","Reference","Status"]} rows={payments.map((payment) => {
          const order = snapshot.purchaseOrders.find((item) => item.id === payment.linkedOrderId);
          const displayStatus = payment.verificationStatus === "Verified" ? "Completed" : payment.verificationStatus === "Rejected" ? "Flagged" : "Pending";
          return [payment.id, payment.linkedOrderId, order?.supplierName || "Supplier pending", payment.amount, payment.mode, payment.referenceNumber || "-", displayStatus];
        })} />
      </Panel>
      <Panel title="My Payment Updates" eyebrow="Pending and flagged payments">
        <div className="stack-list payment-update-list">
          {payments.length === 0 ? <div className="empty-card">No purchase payments found yet.</div> : payments.map((payment) => {
            const draft = getDraft(payment);
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : draft.proofName ? `${API_BASE}/uploads/payment-proofs/${draft.proofName}` : "";
            const order = snapshot.purchaseOrders.find((item) => item.id === payment.linkedOrderId);
            const canUpdate = payment.verificationStatus !== "Verified";
            const displayStatus = payment.verificationStatus === "Verified"
              ? { label: "Completed", className: "status-completed" }
              : payment.verificationStatus === "Rejected"
                ? { label: "Flagged", className: "status-rejected" }
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
                  <span className={`status-pill ${displayStatus.className}`}>{displayStatus.label}</span>
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
                    verificationStatus: draft.verificationStatus === "Rejected" ? "Submitted" : draft.verificationStatus === "Verified" ? "Submitted" : draft.verificationStatus,
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
                  </select></label>
                  <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadProof(payment.id, e.target.files?.[0] || null)} /></label>
                  <label className="wide-field">Note<input value={draft.verificationNote} onChange={(e) => setDraftValue(payment.id, "verificationNote", e.target.value)} placeholder="Update for accounts or supplier" /></label>
                  <div className="payment-card-actions wide-field">
                    <button className="primary-button" type="submit">Update payment</button>
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
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected";
    verificationNote: string;
  }) => Promise<void>;
}) {
  const myOrders = snapshot.salesOrders.filter((item) => item.salesmanId === currentUser.id || item.salesmanName === currentUser.fullName);
  const myOrderIds = new Set(myOrders.map((item) => item.id));
  const underPriceOrders = myOrders.filter((item) => item.status === "Draft" || item.note.toLowerCase().includes("approval requested"));
  const undeliveredOrders = myOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed");
  const pendingCollections = snapshot.ledgerEntries.filter((item) => item.side === "Sales" && myOrderIds.has(item.linkedOrderId) && item.pendingAmount > 0);
  const payments = snapshot.payments.filter((item) => item.side === "Sales" && myOrderIds.has(item.linkedOrderId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const [drafts, setDrafts] = useState<Record<string, { amount: string; referenceNumber: string; voucherNumber: string; utrNumber: string; proofName: string; verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected"; verificationNote: string }>>({});

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
            const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === order.id);
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{order.id}</strong>
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
            const order = snapshot.salesOrders.find((item) => item.id === payment.linkedOrderId);
            const whatsappText = encodeURIComponent(`Aapoorti sales payment proof\nPayment: ${payment.id}\nOrder: ${payment.linkedOrderId}\nShop: ${order?.shopName || ""}\nAmount: ${draft.amount}\nProof: ${proofUrl || "Pending"}`);
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.id}</strong>
                  <p>{payment.linkedOrderId} · {order?.shopName || "Shop"} · {payment.mode}</p>
                </div>
                <span className={`status-pill ${payment.verificationStatus === "Verified" ? "status-verified" : payment.verificationStatus === "Rejected" ? "status-rejected" : "status-pending"}`}>{payment.verificationStatus === "Verified" ? "Completed" : payment.verificationStatus === "Rejected" ? "Flagged" : "Pending"}</span>
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
  onVerify
}: {
  snapshot: AppSnapshot;
  onVerify: (paymentId: string, verificationStatus: "Verified" | "Rejected", verificationNote: string) => Promise<void>;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const pending = snapshot.payments.filter((item) => item.verificationStatus !== "Verified");
  const completed = snapshot.payments.filter((item) => item.verificationStatus === "Verified");
  const dayCash = snapshot.payments.filter((item) => item.mode === "Cash" && item.createdAt.slice(0, 10) === today).reduce((sum, item) => sum + item.amount, 0);
  return (
    <section className="dashboard-grid">
      <Panel title="Accounts Summary" eyebrow="Pending and completed">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{pending.length}</strong><p>Pending payments</p></div></div>
          <div className="list-card"><div><strong>{completed.length}</strong><p>Completed payments</p></div></div>
          <div className="list-card"><div><strong>{dayCash}</strong><p>Cash reported today</p></div></div>
        </div>
      </Panel>
      <Panel title="Pending Verification" eyebrow="Accounts must complete payment">
        <div className="stack-list payment-update-list">
          {pending.length === 0 ? <div className="empty-card">No pending payments.</div> : pending.map((payment) => {
            const orderName = payment.side === "Purchase"
              ? snapshot.purchaseOrders.find((item) => item.id === payment.linkedOrderId)?.supplierName
              : snapshot.salesOrders.find((item) => item.id === payment.linkedOrderId)?.shopName;
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : "";
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.id}</strong>
                  <p>{payment.side} · {payment.linkedOrderId} · {orderName || "Party"}</p>
                </div>
                <span className={`status-pill ${payment.verificationStatus === "Rejected" ? "status-rejected" : "status-pending"}`}>{payment.verificationStatus}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{payment.amount}</strong></div>
                <div><span className="small-label">Mode</span><strong>{payment.mode}</strong></div>
                <div><span className="small-label">Ref</span><strong>{payment.referenceNumber || "Required"}</strong></div>
                <div><span className="small-label">Submitted</span><strong>{payment.submittedAt ? new Date(payment.submittedAt).toLocaleString("en-IN") : "Pending"}</strong></div>
              </div>
              <div className="payment-card-actions">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                <button className="primary-button" type="button" onClick={() => void onVerify(payment.id, "Verified", "Completed by accounts")}>Mark completed</button>
                <button className="ghost-button" type="button" onClick={() => void onVerify(payment.id, "Rejected", "Flagged by accounts for review")}>Flag</button>
              </div>
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
  onReceive,
  onUpdateSalesOrder,
  onCreateConsignment
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onReceive: (body: { purchaseOrderId: string; warehouseId: string; receivedQuantity: number; actualWeightKg: number; note: string; confirmPartial: boolean }) => Promise<void>;
  onUpdateSalesOrder: (id: string, body: { rate: number; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus }) => Promise<void>;
  onCreateConsignment: (body: { docketIds: string[]; warehouseId: string; assignedTo: string; status: string }) => Promise<void>;
}) {
  const incomingOrders = snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const outgoingOrders = snapshot.salesOrders.filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Out for Delivery").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const openDockets = snapshot.deliveryDockets.filter((item) => item.status !== "Delivered" && !item.consignmentId);
  const [consignmentDraft, setConsignmentDraft] = useState({ docketIds: [] as string[], warehouseId: "", assignedTo: "delivery" });
  const selectedDockets = openDockets.filter((item) => consignmentDraft.docketIds.includes(item.id));
  const selectedDocketWeight = selectedDockets.reduce((sum, item) => sum + item.weightKg, 0);
  const [incomingDrafts, setIncomingDrafts] = useState<Record<string, { receivedQuantity: string; actualWeightKg: string; note: string }>>({});

  return (
    <section className="dashboard-grid">
      <Panel title="Warehouse Summary" eyebrow="Incoming and outgoing">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{incomingOrders.length}</strong><p>Orders to receive</p></div></div>
          <div className="list-card"><div><strong>{outgoingOrders.length}</strong><p>Orders to send</p></div></div>
          <div className="list-card"><div><strong>{snapshot.stockSummary.reduce((sum, item) => sum + item.availableQuantity, 0)}</strong><p>Available stock</p></div></div>
        </div>
      </Panel>
      <Panel title="Incoming Orders" eyebrow="Sorted by date and time">
        <div className="stack-list payment-update-list">
          {incomingOrders.length === 0 ? <div className="empty-card">No incoming orders pending.</div> : incomingOrders.map((order) => {
            const pendingQty = Math.max(order.quantityOrdered - order.quantityReceived, 0);
            const draft = incomingDrafts[order.id] || { receivedQuantity: String(pendingQty || order.quantityOrdered), actualWeightKg: String(order.expectedWeightKg || 0), note: "" };
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{order.id}</strong>
                  <p>{order.supplierName} · {order.productSku} · {order.warehouseId}</p>
                </div>
                <span className="status-pill status-pending">{order.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Ordered</span><strong>{order.quantityOrdered}</strong></div>
                <div><span className="small-label">Pending</span><strong>{pendingQty}</strong></div>
                <div><span className="small-label">Amount</span><strong>{order.totalAmount}</strong></div>
                <div><span className="small-label">Expected weight</span><strong>{order.expectedWeightKg}</strong></div>
              </div>
              <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                const receivedQuantity = Number(draft.receivedQuantity || 0);
                const partial = receivedQuantity < pendingQty;
                await onReceive({
                  purchaseOrderId: order.id,
                  warehouseId: order.warehouseId,
                  receivedQuantity,
                  actualWeightKg: Number(draft.actualWeightKg || 0),
                  note: draft.note || `Received by ${currentUser.fullName}`,
                  confirmPartial: partial
                });
              }}>
                <label>Receive quantity<input type="number" value={draft.receivedQuantity} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, receivedQuantity: e.target.value } }))} /></label>
                <label>Actual weight<input type="number" value={draft.actualWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, actualWeightKg: e.target.value } }))} /></label>
                <label className="wide-field">Note<input value={draft.note} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, note: e.target.value } }))} placeholder="Complete or partial receiving note" /></label>
                <div className="payment-card-actions wide-field">
                  <span className="small-label">{Number(draft.receivedQuantity || 0) < pendingQty ? `Partial receive: ${pendingQty - Number(draft.receivedQuantity || 0)} pending` : "Complete receive"}</span>
                  <button className="primary-button" type="submit">{Number(draft.receivedQuantity || 0) < pendingQty ? "Receive partial" : "Receive complete"}</button>
                </div>
              </form>
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Outgoing Orders" eyebrow="Payment check before release">
        <div className="stack-list payment-update-list">
          {outgoingOrders.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : outgoingOrders.map((order) => {
            const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === order.id)?.pendingAmount ?? order.totalAmount;
            const hasVerifiedPayment = snapshot.payments.some((item) => item.side === "Sales" && item.linkedOrderId === order.id && item.verificationStatus === "Verified");
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
              <div className="payment-card-actions">
                <button className="ghost-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: order.note || "Packed by warehouse", status: "Ready for Dispatch" })}>Ready for dispatch</button>
                <button className="primary-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: `${order.note || ""} Handed over by warehouse.`.trim(), status: "Out for Delivery" })}>Hand over to delivery</button>
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
          setConsignmentDraft({ docketIds: [], warehouseId: "", assignedTo: "delivery" });
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
  const [drafts, setDrafts] = useState<Record<string, { routeHint: string; weightProofName: string; cashProofName: string; cashHandoverMarked: boolean; status: DeliveryTask["status"] }>>({});

  return (
    <section className="dashboard-grid">
      <Panel title="Delivery Summary" eyebrow="Pickup and drop">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.side === "Purchase").length}</strong><p>Inbound pickups</p></div></div>
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.side === "Sales").length}</strong><p>Outbound deliveries</p></div></div>
          <div className="list-card"><div><strong>{myTasks.filter((item) => item.cashCollectionRequired).length}</strong><p>Cash actions</p></div></div>
        </div>
      </Panel>
      <Panel title="My Delivery Jobs" eyebrow="Proof and timestamps">
        <div className="stack-list payment-update-list">
          {myTasks.length === 0 ? <div className="empty-card">No delivery tasks assigned.</div> : myTasks.map((task) => {
            const draft = drafts[task.id] || { routeHint: task.routeHint || "", weightProofName: task.weightProofName || "", cashProofName: task.cashProofName || "", cashHandoverMarked: task.cashHandoverMarked, status: task.status };
            const weightUrl = draft.weightProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.weightProofName}` : "";
            const cashUrl = draft.cashProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.cashProofName}` : "";
            return <article className="list-card payment-update-card" key={task.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{task.id}</strong>
                  <p>{task.side} · {task.linkedOrderIds.join(", ")} · {task.mode}</p>
                </div>
                <span className="status-pill status-pending">{draft.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">From</span><strong>{task.from}</strong></div>
                <div><span className="small-label">To</span><strong>{task.to}</strong></div>
                <div><span className="small-label">Payment action</span><strong>{task.paymentAction}</strong></div>
                <div><span className="small-label">Last action</span><strong>{task.lastActionAt ? new Date(task.lastActionAt).toLocaleString("en-IN") : "Pending"}</strong></div>
              </div>
              <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                await onUpdateTask(task.id, {
                  linkedOrderIds: task.linkedOrderIds,
                  assignedTo: task.assignedTo,
                  pickupAt: task.pickupAt,
                  dropAt: task.dropAt,
                  routeHint: draft.routeHint,
                  paymentAction: task.paymentAction,
                  status: draft.status,
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
                  <button className="primary-button" type="submit">Update task</button>
                  {weightUrl ? <a className="ghost-button" href={weightUrl} target="_blank" rel="noreferrer">Weight proof</a> : null}
                  {cashUrl ? <a className="ghost-button" href={cashUrl} target="_blank" rel="noreferrer">Cash proof</a> : null}
                </div>
              </form>
            </article>;
          })}
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
function renderOptions(items: Counterparty[]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderWarehouseOptions(items: AppSnapshot["warehouses"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderProductOptions(items: AppSnapshot["products"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.sku} value={item.sku}>{`${item.division} > ${item.department} > ${item.section} > ${item.name}`}</option>)]; }
function parseCsvRows(csv: string) { const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean); const headers = header.split(",").map((item) => item.trim()); return lines.map((line) => { const cols = line.split(",").map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])); return { ...row, defaultWeightKg: Number(row.defaultWeightKg || 0), toleranceKg: Number(row.toleranceKg || 0), tolerancePercent: Number(row.tolerancePercent || 0), allowedWarehouseIds: String(row.allowedWarehouseIds || "").split("|").filter(Boolean), rsp: Number(row.rsp || 0) }; }); }

export default App;
