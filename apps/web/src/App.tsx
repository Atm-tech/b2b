import { useEffect, useState } from "react";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  DeliveryTask,
  NoteRecord,
  PaymentMode,
  ProductSlab,
  UserRole
} from "@aapoorti-b2b/domain";
import { userRoles } from "@aapoorti-b2b/domain";

const API_BASE = "http://localhost:8080";
const SESSION_KEY = "aapoorti-b2b-user";
const TOKEN_KEY = "aapoorti-b2b-token";

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
  Admin: ["Overview", "Products", "Parties", "Purchase", "Sales", "Payments", "Receipts", "Stock", "Delivery"],
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
  const [login, setLogin] = useState({ username: "admin", password: "1234" });

  const [userForm, setUserForm] = useState({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"] as UserRole[], password: "1234" });
  const [warehouseForm, setWarehouseForm] = useState({ id: "", name: "", city: "", address: "", type: "Warehouse" as "Warehouse" | "Yard" });
  const [productForm, setProductForm] = useState({ sku: "", name: "", division: "", department: "", section: "", category: "", unit: "", defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "0", allowedWarehouseIds: [] as string[], slabsText: "50-199:348,200-499:341,500+:336" });
  const [bulkCsv, setBulkCsv] = useState("sku,name,division,department,section,category,unit,defaultWeightKg,toleranceKg,tolerancePercent,allowedWarehouseIds,slabs");
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [partyForm, setPartyForm] = useState({ type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: "", productSku: "", warehouseId: "", quantityOrdered: "0", rate: "0", deliveryMode: "Dealer Delivery" as "Dealer Delivery" | "Self Collection", paymentMode: "Cash" as PaymentMode, cashTiming: "In Hand", note: "" });
  const [purchaseEditForm, setPurchaseEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Dealer Delivery" as "Dealer Delivery" | "Self Collection", note: "", status: "Pending Payment" });
  const [salesForm, setSalesForm] = useState({ shopId: "", productSku: "", warehouseId: "", quantity: "0", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "In Hand", deliveryMode: "Delivery" as "Self Collection" | "Delivery", note: "" });
  const [salesEditForm, setSalesEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Delivery" as "Self Collection" | "Delivery", note: "", status: "Booked" });
  const [paymentForm, setPaymentForm] = useState({ side: "Purchase" as "Purchase" | "Sales", linkedOrderId: "", amount: "0", mode: "NEFT" as PaymentMode, cashTiming: "", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected", verificationNote: "" });
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState({ id: "", amount: "0", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected", verificationNote: "" });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: "", warehouseId: "", receivedQuantity: "0", actualWeightKg: "0", note: "", confirmPartial: false });
  const [receiptEditForm, setReceiptEditForm] = useState({ grcNumber: "", note: "", flagged: false });
  const [deliveryForm, setDeliveryForm] = useState({ side: "Purchase" as DeliveryTask["side"], linkedOrderIdsText: "", mode: "Dealer Delivery" as DeliveryTask["mode"], from: "", to: "", assignedTo: "", pickupAt: "", dropAt: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, status: "Planned" as DeliveryTask["status"] });
  const [deliveryEditForm, setDeliveryEditForm] = useState({ id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, status: "Planned" as DeliveryTask["status"] });
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
      const response = await fetch(`${API_BASE}/snapshot`, { headers: { authorization: `Bearer ${token}` } });
      const data = await response.json();
      if (!response.ok) {
        clearSessionState(setCurrentUser, setSessionToken, setSnapshot);
        setError(typeof data?.message === "string" ? data.message : "Session expired. Login again.");
        return;
      }
      setSnapshot(data as AppSnapshot);
    } catch {
      clearSessionState(setCurrentUser, setSessionToken, setSnapshot);
      setError("Unable to restore session.");
    }
  }

  async function doLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_BASE}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(login) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Login failed.");
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
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Action failed.");
      setSnapshot(data as AppSnapshot);
      setMessage(success);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Action failed.");
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
      const response = await fetch(`${API_BASE}${path}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Update failed.");
      setSnapshot(data as AppSnapshot);
      setMessage(success);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Update failed.");
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
      const response = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${sessionToken}`
        },
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Upload failed.");
      setMessage(successMessage);
      return data;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Upload failed.");
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
      const response = await fetch(`${API_BASE}/counterparties`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "Party creation failed.");
      const nextSnapshot = data as AppSnapshot;
      setSnapshot(nextSnapshot);
      setMessage(`${body.type} created.`);
      return nextSnapshot.counterparties.find((item) => item.type === body.type && item.name === body.name && item.mobileNumber === body.mobileNumber) || null;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Party creation failed.");
      return null;
    } finally {
      setLoading(false);
    }
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

  const visibleViews = getVisibleViewsForMode(currentUser, simpleMode);
  const safeVisibleViews: ViewKey[] = visibleViews.length > 0 ? visibleViews : ["Overview"];
  const counterparties = Array.isArray(snapshot.counterparties) ? snapshot.counterparties : [];
  const settings = snapshot.settings && Array.isArray(snapshot.settings.paymentMethods) ? snapshot.settings : { paymentMethods: [], deliveryCharge: { model: "Fixed" as const, amount: 0 } };
  const suppliers = counterparties.filter((item) => item.type === "Supplier");
  const shops = counterparties.filter((item) => item.type === "Shop");
  const paymentMethods = settings.paymentMethods.filter((item) => item.active);

  return (
    <main className="app-shell">
      <section className="hero panel">
        <div>
          <span className="eyebrow">{(currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role]).join(" / ")}</span>
          <h1>Aapoorti B2B</h1>
          <p>{simpleMode ? "Simple mode is on. Only the main steps are shown so a beginner can work without confusion." : "Advanced mode is on. All screens are visible."}</p>
        </div>
        <div className="hero-side">
          <div className="hero-stat"><span className="small-label">User</span><strong>{currentUser.username}</strong></div>
          <div className="hero-stat"><span className="small-label">Mobile</span><strong>{currentUser.mobileNumber || "Pending"}</strong></div>
          <button className="ghost-button" type="button" onClick={() => { const nextMode = !simpleMode; setSimpleMode(nextMode); setActiveView(getVisibleViewsForMode(currentUser, nextMode)[0]); }}>{simpleMode ? "Show Advanced" : "Show Simple"}</button>
          <button className="ghost-button" type="button" onClick={async () => { if (sessionToken) { try { await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${sessionToken}` } }); } catch {} } window.localStorage.removeItem(SESSION_KEY); window.localStorage.removeItem(TOKEN_KEY); setCurrentUser(null); setSessionToken(""); setSnapshot(null); }}>Logout</button>
        </div>
      </section>

      {message ? <p className="message success">{message}</p> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className="workspace-shell">
        <aside className="sidebar panel">
          <div className="sidebar-head"><span className="eyebrow">Role Menu</span><h2>{currentUser.fullName}</h2></div>
          <nav className="side-nav">
            {safeVisibleViews.map((view) => (
              <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>
                <span>{labels[view]}</span><small>{view}</small>
              </button>
            ))}
          </nav>
        </aside>
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
          {activeView === "Products" ? <TwoCol left={<Panel title="Product Master" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/products", { ...productForm, defaultWeightKg: Number(productForm.defaultWeightKg), toleranceKg: Number(productForm.toleranceKg), tolerancePercent: Number(productForm.tolerancePercent), slabs: parseSlabs(productForm.slabsText) }, "Product created."); }}><label>SKU<input value={productForm.sku} onChange={(e) => setProductForm((c) => ({ ...c, sku: e.target.value }))} /></label><label>Name<input value={productForm.name} onChange={(e) => setProductForm((c) => ({ ...c, name: e.target.value }))} /></label><label>Division<input value={productForm.division} onChange={(e) => setProductForm((c) => ({ ...c, division: e.target.value }))} /></label><label>Department<input value={productForm.department} onChange={(e) => setProductForm((c) => ({ ...c, department: e.target.value }))} /></label><label>Section<input value={productForm.section} onChange={(e) => setProductForm((c) => ({ ...c, section: e.target.value }))} /></label><label>Category<input value={productForm.category} onChange={(e) => setProductForm((c) => ({ ...c, category: e.target.value }))} /></label><label>Unit<input value={productForm.unit} onChange={(e) => setProductForm((c) => ({ ...c, unit: e.target.value }))} /></label><label>Weight<input type="number" value={productForm.defaultWeightKg} onChange={(e) => setProductForm((c) => ({ ...c, defaultWeightKg: e.target.value }))} /></label><label>Tol. Kg<input type="number" value={productForm.toleranceKg} onChange={(e) => setProductForm((c) => ({ ...c, toleranceKg: e.target.value }))} /></label><label>Tol. %<input type="number" value={productForm.tolerancePercent} onChange={(e) => setProductForm((c) => ({ ...c, tolerancePercent: e.target.value }))} /></label><label>Warehouses<select multiple value={productForm.allowedWarehouseIds} onChange={(e) => setProductForm((c) => ({ ...c, allowedWarehouseIds: Array.from(e.target.selectedOptions).map((o) => o.value) }))}>{snapshot.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label className="wide-field">Slabs<input value={productForm.slabsText} onChange={(e) => setProductForm((c) => ({ ...c, slabsText: e.target.value }))} /></label><button className="primary-button" type="submit">Create product</button></form></Panel>} right={<><Panel title="Bulk CSV Upload" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/products/bulk", { rows: parseCsvRows(bulkCsv) }, "CSV products imported."); }}><label className="wide-field">Paste CSV<textarea value={bulkCsv} onChange={(e) => setBulkCsv(e.target.value)} /></label><button className="primary-button" type="submit">Import pasted CSV</button></form><form className="form-grid top-gap" onSubmit={async (e) => { e.preventDefault(); if (!bulkCsvFile) { setError("Select a CSV file first."); return; } const data = await uploadFile("/products/bulk-upload", "csv", bulkCsvFile, "CSV file uploaded and imported."); if (data && typeof data === "object" && "products" in data) setSnapshot(data as AppSnapshot); }}><label className="wide-field">CSV file<input accept=".csv,text/csv" type="file" onChange={(e) => setBulkCsvFile(e.target.files?.[0] || null)} /></label><button className="primary-button" type="submit">Upload CSV file</button></form></Panel><Panel title="Products" eyebrow="Division > Department > Section"><DataTable headers={["SKU","Name","Division","Department","Section"]} rows={snapshot.products.map((p) => [p.sku, p.name, p.division, p.department, p.section])} /></Panel></>} /> : null}
          {activeView === "Parties" ? <TwoCol left={<Panel title={currentUser.role === "Sales" ? "Register Customer" : "Register Supplier"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><form className="form-grid" onSubmit={async (e) => { e.preventDefault(); const forcedType = currentUser.role === "Sales" ? "Shop" : "Supplier"; await createPartyRecord({ ...partyForm, type: forcedType }); }}><label>Type<input value={currentUser.role === "Sales" ? "Customer / Shop" : "Supplier / Vendor"} readOnly /></label><label>Name<input value={partyForm.name} onChange={(e) => setPartyForm((c) => ({ ...c, name: e.target.value }))} /></label><label>GST<input value={partyForm.gstNumber} onChange={(e) => setPartyForm((c) => ({ ...c, gstNumber: e.target.value }))} /></label><label>Mobile<input value={partyForm.mobileNumber} onChange={(e) => setPartyForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyForm.contactPerson} onChange={(e) => setPartyForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyForm.city} onChange={(e) => setPartyForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyForm.address} onChange={(e) => setPartyForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">{currentUser.role === "Sales" ? "Save customer" : "Save supplier"}</button></form></Panel>} right={<><Panel title={currentUser.role === "Sales" ? "Update Customer" : "Update Supplier"} eyebrow="Edit details"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/counterparties/${partyEditForm.id}`, partyEditForm, "Party updated."); }}><label>Party<select value={partyEditForm.id} onChange={(e) => { const sourceItems = currentUser.role === "Sales" ? shops : suppliers; const item = sourceItems.find((c) => c.id === e.target.value); setPartyEditForm(item ? { id: item.id, name: item.name, gstNumber: item.gstNumber, mobileNumber: item.mobileNumber, address: item.address, city: item.city, contactPerson: item.contactPerson } : { id: "", name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" }); }}>{renderOptions(currentUser.role === "Sales" ? shops : suppliers)}</select></label><label>Name<input value={partyEditForm.name} onChange={(e) => setPartyEditForm((c) => ({ ...c, name: e.target.value }))} /></label><label>GST<input value={partyEditForm.gstNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, gstNumber: e.target.value }))} /></label><label>Mobile<input value={partyEditForm.mobileNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Contact<input value={partyEditForm.contactPerson} onChange={(e) => setPartyEditForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label><label>City<input value={partyEditForm.city} onChange={(e) => setPartyEditForm((c) => ({ ...c, city: e.target.value }))} /></label><label className="wide-field">Address<input value={partyEditForm.address} onChange={(e) => setPartyEditForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Update</button></form></Panel><Panel title={currentUser.role === "Sales" ? "Customer Database" : "Supplier Database"} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"}><DataTable headers={["Name","GST","Mobile","City"]} rows={(currentUser.role === "Sales" ? shops : suppliers).map((p) => [p.name, p.gstNumber, p.mobileNumber, p.city])} /></Panel></>} /> : null}
          {activeView === "Purchase" ? <CatalogOrderView
            mode="purchase"
            title="Purchaser Checkout"
            eyebrow="Blinkit-style market purchase"
            products={snapshot.products}
            parties={suppliers}
            warehouses={snapshot.warehouses}
            paymentMethods={paymentMethods}
            stockSummary={snapshot.stockSummary}
            orderForm={purchaseForm}
            setOrderForm={setPurchaseForm}
            onCreateParty={createPartyRecord}
            onSubmit={() => post("/purchase-orders", { ...purchaseForm, quantityOrdered: Number(purchaseForm.quantityOrdered), rate: Number(purchaseForm.rate), cashTiming: purchaseForm.paymentMode === "Cash" ? purchaseForm.cashTiming : undefined }, "Purchase order created.")}
            rightPanel={<><Panel title="Update Purchase" eyebrow="Rate and status"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/purchase-orders/${purchaseEditForm.id}`, { ...purchaseEditForm, rate: Number(purchaseEditForm.rate), cashTiming: purchaseEditForm.paymentMode === "Cash" ? purchaseEditForm.cashTiming || undefined : undefined }, "Purchase updated."); }}><label>Order<select value={purchaseEditForm.id} onChange={(e) => { const item = snapshot.purchaseOrders.find((p) => p.id === e.target.value); setPurchaseEditForm(item ? { id: item.id, rate: String(item.rate), paymentMode: item.paymentMode, cashTiming: item.cashTiming || "", deliveryMode: item.deliveryMode, note: item.note, status: item.status } : { id: "", rate: "0", paymentMode: "Cash", cashTiming: "", deliveryMode: "Dealer Delivery", note: "", status: "Pending Payment" }); }}>{snapshot.purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label><label>Rate<input type="number" value={purchaseEditForm.rate} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, rate: e.target.value }))} /></label><label>Pay mode<select value={purchaseEditForm.paymentMode} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, paymentMode: e.target.value as PaymentMode }))}>{paymentMethods.map((m) => <option key={m.code}>{m.code}</option>)}</select></label><label>Delivery<select value={purchaseEditForm.deliveryMode} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, deliveryMode: e.target.value as "Dealer Delivery" | "Self Collection" }))}><option>Dealer Delivery</option><option>Self Collection</option></select></label>{purchaseEditForm.paymentMode === "Cash" ? <label>Cash timing<select value={purchaseEditForm.cashTiming} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}<label>Status<select value={purchaseEditForm.status} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, status: e.target.value }))}><option>Pending Payment</option><option>Ready for Dispatch</option><option>In Transit</option><option>Partially Received</option><option>Received</option><option>Closed</option></select></label><label className="wide-field">Note<input value={purchaseEditForm.note} onChange={(e) => setPurchaseEditForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Update purchase</button></form></Panel><Panel title="Purchase Queue" eyebrow="Pending and received"><DataTable headers={["PO","Supplier","Product","Ordered","Received","Status"]} rows={snapshot.purchaseOrders.map((p) => [p.id, p.supplierName, p.productSku, p.quantityOrdered, p.quantityReceived, p.status])} /></Panel></>}
          /> : null}
          {activeView === "Sales" ? <CatalogOrderView
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
            onSubmit={() => post("/sales-orders", { ...salesForm, quantity: Number(salesForm.quantity), rate: Number(salesForm.rate), cashTiming: salesForm.paymentMode === "Cash" ? salesForm.cashTiming : undefined }, "Sales order created.")}
            rightPanel={<><Panel title="Update Sales Order" eyebrow="Rate and status"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/sales-orders/${salesEditForm.id}`, { ...salesEditForm, rate: Number(salesEditForm.rate), cashTiming: salesEditForm.paymentMode === "Cash" ? salesEditForm.cashTiming || undefined : undefined }, "Sales order updated."); }}><label>Order<select value={salesEditForm.id} onChange={(e) => { const item = snapshot.salesOrders.find((s) => s.id === e.target.value); setSalesEditForm(item ? { id: item.id, rate: String(item.rate), paymentMode: item.paymentMode, cashTiming: item.cashTiming || "", deliveryMode: item.deliveryMode, note: item.note, status: item.status } : { id: "", rate: "0", paymentMode: "Cash", cashTiming: "", deliveryMode: "Delivery", note: "", status: "Booked" }); }}>{snapshot.salesOrders.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label><label>Rate<input type="number" value={salesEditForm.rate} onChange={(e) => setSalesEditForm((c) => ({ ...c, rate: e.target.value }))} /></label><label>Pay mode<select value={salesEditForm.paymentMode} onChange={(e) => setSalesEditForm((c) => ({ ...c, paymentMode: e.target.value as PaymentMode }))}>{paymentMethods.map((m) => <option key={m.code}>{m.code}</option>)}</select></label><label>Delivery<select value={salesEditForm.deliveryMode} onChange={(e) => setSalesEditForm((c) => ({ ...c, deliveryMode: e.target.value as "Self Collection" | "Delivery" }))}><option>Delivery</option><option>Self Collection</option></select></label>{salesEditForm.paymentMode === "Cash" ? <label>Cash timing<select value={salesEditForm.cashTiming} onChange={(e) => setSalesEditForm((c) => ({ ...c, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}<label>Status<select value={salesEditForm.status} onChange={(e) => setSalesEditForm((c) => ({ ...c, status: e.target.value }))}><option>Draft</option><option>Booked</option><option>Ready for Dispatch</option><option>Self Pickup</option><option>Delivered</option><option>Closed</option></select></label><label className="wide-field">Note<input value={salesEditForm.note} onChange={(e) => setSalesEditForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Update sales order</button></form></Panel><Panel title="Sales Orders" eyebrow="Booked from stock"><DataTable headers={["SO","Shop","Product","Qty","Delivery","Status"]} rows={snapshot.salesOrders.map((s) => [s.id, s.shopName, s.productSku, s.quantity, s.deliveryMode, s.status])} /></Panel></>}
          /> : null}
          {activeView === "Payments" ? <TwoCol left={<><Panel title="Add Payment" eyebrow="Submit proof"><form className="form-grid" onSubmit={async (e) => { e.preventDefault(); let proofName = paymentForm.proofName; if (paymentProofFile) { const uploaded = await uploadFile("/payments/upload-proof", "proof", paymentProofFile, "Payment proof uploaded."); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) proofName = String((uploaded as { fileName: string }).fileName); else return; } await post("/payments", { ...paymentForm, proofName, amount: Number(paymentForm.amount), cashTiming: paymentForm.mode === "Cash" ? paymentForm.cashTiming || undefined : undefined }, "Payment submitted."); }}><label>Side<select value={paymentForm.side} onChange={(e) => setPaymentForm((c) => ({ ...c, side: e.target.value as "Purchase" | "Sales" }))}><option>Purchase</option><option>Sales</option></select></label><label>Order<input value={paymentForm.linkedOrderId} onChange={(e) => setPaymentForm((c) => ({ ...c, linkedOrderId: e.target.value }))} /></label><label>Amount<input type="number" value={paymentForm.amount} onChange={(e) => setPaymentForm((c) => ({ ...c, amount: e.target.value }))} /></label><label>Mode<select value={paymentForm.mode} onChange={(e) => setPaymentForm((c) => ({ ...c, mode: e.target.value as PaymentMode }))}>{paymentMethods.map((m) => <option key={m.code}>{m.code}</option>)}</select></label>{paymentForm.mode === "Cash" ? <label>Cash timing<select value={paymentForm.cashTiming} onChange={(e) => setPaymentForm((c) => ({ ...c, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}<label>Ref<input value={paymentForm.referenceNumber} onChange={(e) => setPaymentForm((c) => ({ ...c, referenceNumber: e.target.value }))} /></label><label>Voucher<input value={paymentForm.voucherNumber} onChange={(e) => setPaymentForm((c) => ({ ...c, voucherNumber: e.target.value }))} /></label><label>UTR<input value={paymentForm.utrNumber} onChange={(e) => setPaymentForm((c) => ({ ...c, utrNumber: e.target.value }))} /></label><label>Proof name<input value={paymentForm.proofName} onChange={(e) => setPaymentForm((c) => ({ ...c, proofName: e.target.value }))} /></label><label>Proof file<input type="file" accept="image/*,.pdf" onChange={(e) => setPaymentProofFile(e.target.files?.[0] || null)} /></label><label>Status<select value={paymentForm.verificationStatus} onChange={(e) => setPaymentForm((c) => ({ ...c, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" }))}><option>Pending</option><option>Submitted</option><option>Verified</option><option>Rejected</option></select></label><label className="wide-field">Note<input value={paymentForm.verificationNote} onChange={(e) => setPaymentForm((c) => ({ ...c, verificationNote: e.target.value }))} /></label><button className="primary-button" type="submit">Save payment</button></form></Panel><Panel title="Quick Verify" eyebrow="Accounts / Admin">{snapshot.payments.slice(0, 6).map((pay) => <div className="list-card" key={pay.id}><div><strong>{pay.id}</strong><p>{pay.side} · {pay.linkedOrderId} · {pay.mode}</p></div><button className="primary-button" type="button" onClick={() => void post("/payments/verify", { paymentId: pay.id, verificationStatus: "Verified", verificationNote: "Verified in panel" }, "Payment verified.")}>Verify</button></div>)}</Panel></>} right={<><Panel title="Update Payment" eyebrow="Edit payment record"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/payments/${paymentEditForm.id}`, { ...paymentEditForm, amount: Number(paymentEditForm.amount) }, "Payment updated."); }}><label>Payment<select value={paymentEditForm.id} onChange={(e) => { const item = snapshot.payments.find((p) => p.id === e.target.value); setPaymentEditForm(item ? { id: item.id, amount: String(item.amount), referenceNumber: item.referenceNumber, voucherNumber: item.voucherNumber || "", utrNumber: item.utrNumber || "", proofName: item.proofName || "", verificationStatus: item.verificationStatus, verificationNote: item.verificationNote } : { id: "", amount: "0", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted", verificationNote: "" }); }}>{snapshot.payments.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label><label>Amount<input type="number" value={paymentEditForm.amount} onChange={(e) => setPaymentEditForm((c) => ({ ...c, amount: e.target.value }))} /></label><label>Ref<input value={paymentEditForm.referenceNumber} onChange={(e) => setPaymentEditForm((c) => ({ ...c, referenceNumber: e.target.value }))} /></label><label>Voucher<input value={paymentEditForm.voucherNumber} onChange={(e) => setPaymentEditForm((c) => ({ ...c, voucherNumber: e.target.value }))} /></label><label>UTR<input value={paymentEditForm.utrNumber} onChange={(e) => setPaymentEditForm((c) => ({ ...c, utrNumber: e.target.value }))} /></label><label>Proof<input value={paymentEditForm.proofName} onChange={(e) => setPaymentEditForm((c) => ({ ...c, proofName: e.target.value }))} /></label><label>Status<select value={paymentEditForm.verificationStatus} onChange={(e) => setPaymentEditForm((c) => ({ ...c, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" }))}><option>Pending</option><option>Submitted</option><option>Verified</option><option>Rejected</option></select></label><label className="wide-field">Note<input value={paymentEditForm.verificationNote} onChange={(e) => setPaymentEditForm((c) => ({ ...c, verificationNote: e.target.value }))} /></label><button className="primary-button" type="submit">Update payment</button></form></Panel><Panel title="Payments" eyebrow="Verification trail"><DataTable headers={["ID","Side","Order","Amount","Mode","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.amount, p.mode, p.verificationStatus])} /></Panel></>} /> : null}
          {activeView === "Receipts" ? <TwoCol left={<Panel title="Warehouse Receipt" eyebrow="Partial or full"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/receipt-checks", { ...receiptForm, receivedQuantity: Number(receiptForm.receivedQuantity), actualWeightKg: Number(receiptForm.actualWeightKg) }, "Receipt saved."); }}><label>Purchase order<select value={receiptForm.purchaseOrderId} onChange={(e) => setReceiptForm((c) => ({ ...c, purchaseOrderId: e.target.value }))}>{snapshot.purchaseOrders.map((p) => <option key={p.id} value={p.id}>{p.id}</option>)}</select></label><label>Warehouse<select value={receiptForm.warehouseId} onChange={(e) => setReceiptForm((c) => ({ ...c, warehouseId: e.target.value }))}>{renderWarehouseOptions(snapshot.warehouses)}</select></label><label>Qty received<input type="number" value={receiptForm.receivedQuantity} onChange={(e) => setReceiptForm((c) => ({ ...c, receivedQuantity: e.target.value }))} /></label><label>Actual weight<input type="number" value={receiptForm.actualWeightKg} onChange={(e) => setReceiptForm((c) => ({ ...c, actualWeightKg: e.target.value }))} /></label><label className="checkbox-line"><input type="checkbox" checked={receiptForm.confirmPartial} onChange={(e) => setReceiptForm((c) => ({ ...c, confirmPartial: e.target.checked }))} />Confirm partial receipt if mismatch</label><label className="wide-field">Note<input value={receiptForm.note} onChange={(e) => setReceiptForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Finalize receipt</button></form></Panel>} right={<><Panel title="Update Receipt" eyebrow="Adjust note and flag"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/receipt-checks/${receiptEditForm.grcNumber}`, { note: receiptEditForm.note, flagged: receiptEditForm.flagged }, "Receipt updated."); }}><label>Receipt<select value={receiptEditForm.grcNumber} onChange={(e) => { const item = snapshot.receiptChecks.find((r) => r.grcNumber === e.target.value); setReceiptEditForm(item ? { grcNumber: item.grcNumber, note: item.notes.join(" | "), flagged: item.flagged } : { grcNumber: "", note: "", flagged: false }); }}>{snapshot.receiptChecks.map((r) => <option key={r.grcNumber} value={r.grcNumber}>{r.grcNumber}</option>)}</select></label><label className="wide-field">Note<input value={receiptEditForm.note} onChange={(e) => setReceiptEditForm((c) => ({ ...c, note: e.target.value }))} /></label><label className="checkbox-line"><input type="checkbox" checked={receiptEditForm.flagged} onChange={(e) => setReceiptEditForm((c) => ({ ...c, flagged: e.target.checked }))} />Flag receipt for review</label><button className="primary-button" type="submit">Update receipt</button></form></Panel><Panel title="Receipt Checks" eyebrow="Flags and pending"><DataTable headers={["GRC","PO","Received","Pending","Variance","Flag"]} rows={snapshot.receiptChecks.map((r) => [r.grcNumber, r.purchaseOrderId, r.receivedQuantity, r.pendingQuantity, `${r.weightVarianceKg} kg`, r.flagged ? "Yes" : "No"])}/></Panel></>} /> : null}
          {activeView === "Ledger" ? <TwoCol left={<Panel title="Ledger" eyebrow="Accounts visibility"><DataTable headers={["ID","Side","Order","Party","Goods","Paid","Pending"]} rows={snapshot.ledgerEntries.map((l) => [l.id, l.side, l.linkedOrderId, l.partyName, l.goodsValue, l.paidAmount, l.pendingAmount])} /></Panel>} right={<Panel title="Order Financial State" eyebrow="Pending vs settled"><DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...snapshot.purchaseOrders.map((p) => ["Purchase", p.id, p.status]), ...snapshot.salesOrders.map((s) => ["Sales", s.id, s.status])]} /></Panel>} /> : null}
          {activeView === "Stock" ? <TwoCol left={<Panel title="Closing Stock" eyebrow="Warehouse and admin"><DataTable headers={["Warehouse","SKU","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productSku, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>} right={<Panel title="Inventory Lots" eyebrow="Traceability"><DataTable headers={["Lot","Order","Warehouse","SKU","Avail","Blocked"]} rows={snapshot.inventoryLots.map((i) => [i.lotId, i.sourceOrderId, i.warehouseId, i.productSku, i.quantityAvailable, i.quantityBlocked])} /></Panel>} /> : null}
          {activeView === "Delivery" ? <TwoCol left={<Panel title="Delivery Task" eyebrow="Pickup and drop"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/delivery-tasks", { ...deliveryForm, linkedOrderIds: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "" }, "Delivery task created."); }}><label>Side<select value={deliveryForm.side} onChange={(e) => setDeliveryForm((c) => ({ ...c, side: e.target.value as DeliveryTask["side"] }))}><option>Purchase</option><option>Sales</option></select></label><label className="wide-field">Orders<input value={deliveryForm.linkedOrderIdsText} onChange={(e) => setDeliveryForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} placeholder="PO-1, SO-2" /></label><label>Mode<select value={deliveryForm.mode} onChange={(e) => setDeliveryForm((c) => ({ ...c, mode: e.target.value as DeliveryTask["mode"] }))}><option>Dealer Delivery</option><option>Self Collection</option><option>Delivery</option></select></label><label>Status<select value={deliveryForm.status} onChange={(e) => setDeliveryForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label>From<input value={deliveryForm.from} onChange={(e) => setDeliveryForm((c) => ({ ...c, from: e.target.value }))} /></label><label>To<input value={deliveryForm.to} onChange={(e) => setDeliveryForm((c) => ({ ...c, to: e.target.value }))} /></label><label>Assigned<input value={deliveryForm.assignedTo} onChange={(e) => setDeliveryForm((c) => ({ ...c, assignedTo: e.target.value }))} placeholder="delivery" /></label><label>Pickup time<input value={deliveryForm.pickupAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, pickupAt: e.target.value }))} placeholder="2026-04-04 10:30" /></label><label>Drop time<input value={deliveryForm.dropAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, dropAt: e.target.value }))} placeholder="2026-04-04 13:00" /></label><label>Payment action<select value={deliveryForm.paymentAction} onChange={(e) => setDeliveryForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryForm.cashCollectionRequired} onChange={(e) => setDeliveryForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><button className="primary-button" type="submit">Create task</button></form></Panel>} right={<><Panel title="Update Delivery" eyebrow="Assignment and completion"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/delivery-tasks/${deliveryEditForm.id}`, { linkedOrderIds: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "", assignedTo: deliveryEditForm.assignedTo, pickupAt: deliveryEditForm.pickupAt, dropAt: deliveryEditForm.dropAt, paymentAction: deliveryEditForm.paymentAction, cashCollectionRequired: deliveryEditForm.cashCollectionRequired, status: deliveryEditForm.status }, "Delivery task updated."); }}><label>Task<select value={deliveryEditForm.id} onChange={(e) => { const item = snapshot.deliveryTasks.find((d) => d.id === e.target.value); setDeliveryEditForm(item ? { id: item.id, linkedOrderIdsText: item.linkedOrderIds.join(", "), assignedTo: item.assignedTo, pickupAt: item.pickupAt || "", dropAt: item.dropAt || "", paymentAction: item.paymentAction, cashCollectionRequired: item.cashCollectionRequired, status: item.status } : { id: "", linkedOrderIdsText: "", assignedTo: "", pickupAt: "", dropAt: "", paymentAction: "None", cashCollectionRequired: false, status: "Planned" }); }}>{snapshot.deliveryTasks.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}</select></label><label className="wide-field">Orders<input value={deliveryEditForm.linkedOrderIdsText} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} /></label><label>Assigned<input value={deliveryEditForm.assignedTo} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, assignedTo: e.target.value }))} /></label><label>Pickup time<input value={deliveryEditForm.pickupAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, pickupAt: e.target.value }))} /></label><label>Drop time<input value={deliveryEditForm.dropAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, dropAt: e.target.value }))} /></label><label>Payment action<select value={deliveryEditForm.paymentAction} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label>Status<select value={deliveryEditForm.status} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashCollectionRequired} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><button className="primary-button" type="submit">Update task</button></form></Panel><Panel title="Delivery Tasks" eyebrow="Transport flow"><DataTable headers={["ID","Side","Orders","Mode","Assigned","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.mode, d.assignedTo, d.status])} /></Panel></>} /> : null}
          {activeView === "Settings" ? <Panel title="Admin Settings" eyebrow="Payment methods and delivery"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/settings", snapshot.settings, "Settings updated."); }}>{snapshot.settings.paymentMethods.map((item, index) => <label key={item.code}>{item.code}<div className="settings-line"><input type="checkbox" checked={item.active} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, active: e.target.checked } : method) } }) : current)} />Active<input type="checkbox" checked={item.allowsCashTiming} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, allowsCashTiming: e.target.checked } : method) } }) : current)} />Cash timing</div></label>)}<label>Delivery model<select value={snapshot.settings.deliveryCharge.model} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, model: e.target.value as "Fixed" | "Per Km" } } }) : current)}><option>Fixed</option><option>Per Km</option></select></label><label>Delivery amount<input type="number" value={snapshot.settings.deliveryCharge.amount} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, amount: Number(e.target.value) } } }) : current)} /></label><button className="primary-button" type="submit">Save settings</button></form></Panel> : null}
          {activeView === "Notes" ? <TwoCol left={<Panel title="Add Note" eyebrow="Authorized viewers"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/notes", noteForm, "Note added."); }}><label>Entity<select value={noteForm.entityType} onChange={(e) => setNoteForm((c) => ({ ...c, entityType: e.target.value as NoteRecord["entityType"] }))}><option>Purchase Order</option><option>Receipt</option><option>Sales Order</option><option>Payment</option><option>Delivery</option><option>Inventory</option><option>Party</option></select></label><label>ID<input value={noteForm.entityId} onChange={(e) => setNoteForm((c) => ({ ...c, entityId: e.target.value }))} /></label><label>Visibility<select value={noteForm.visibility} onChange={(e) => setNoteForm((c) => ({ ...c, visibility: e.target.value as NoteRecord["visibility"] }))}><option>Restricted</option><option>Operational</option><option>Management</option></select></label><label className="wide-field">Note<textarea value={noteForm.note} onChange={(e) => setNoteForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Add note</button></form></Panel>} right={<Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel>} /> : null}
        </div>
      </section>
      <nav className="mobile-tab-bar">{safeVisibleViews.map((view) => <button key={view} type="button" className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => setActiveView(view)}>{labels[view]}</button>)}</nav>
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
  orderForm: any;
  setOrderForm: React.Dispatch<React.SetStateAction<any>>;
  onCreateParty: (body: Omit<Counterparty, "id" | "createdBy" | "createdAt">) => Promise<Counterparty | null>;
  onSubmit: () => void;
  rightPanel: React.ReactNode;
};

function CatalogOrderView(props: CatalogOrderViewProps) {
  const { mode, title, eyebrow, products, parties, warehouses, paymentMethods, stockSummary, orderForm, setOrderForm, onCreateParty, onSubmit, rightPanel } = props;
  const [search, setSearch] = useState("");
  const [activeDivision, setActiveDivision] = useState("All");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [flowStep, setFlowStep] = useState<"landing" | "existing" | "new" | "catalog">("landing");
  const [partyDraft, setPartyDraft] = useState({ name: "", gstNumber: "", mobileNumber: "", address: "", city: "", contactPerson: "" });
  const isPurchase = mode === "purchase";
  const partyType = isPurchase ? "Supplier" : "Shop";
  const partyLabel = isPurchase ? "supplier / vendor" : "customer / shop";
  const divisions = ["All", ...Array.from(new Set(products.map((item) => item.division).filter(Boolean)))];
  const filteredProducts = products.filter((product) => {
    const matchesDivision = activeDivision === "All" || product.division === activeDivision;
    const haystack = [product.name, product.division, product.department, product.section, product.brand, product.shortName, product.articleName, product.itemName, product.barcode, product.size].join(" ").toLowerCase();
    const matchesSearch = search.trim() === "" || haystack.includes(search.trim().toLowerCase());
    return matchesDivision && matchesSearch;
  });

  function setVoiceSearch() {
    const speechWindow = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor || voiceBusy) {
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setVoiceBusy(true);
    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) setSearch(transcript);
    };
    recognition.onerror = () => setVoiceBusy(false);
    recognition.onend = () => setVoiceBusy(false);
    recognition.start();
  }

  function selectProduct(product: AppSnapshot["products"][number]) {
    setOrderForm((current: any) => ({ ...current, productSku: product.sku, rate: String(getSuggestedRate(product)), warehouseId: current.warehouseId || product.allowedWarehouseIds[0] || "" }));
  }

  function getSuggestedRate(product: AppSnapshot["products"][number]) {
    return product.slabs[0]?.purchaseRate ?? product.rsp ?? 0;
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

  return (
    <TwoCol
      left={
        <Panel title={title} eyebrow={eyebrow}>
          <div className="catalog-shell">
            {flowStep !== "catalog" ? <div className="flow-card">
              {flowStep === "landing" ? <>
                <span className="eyebrow">Landing</span>
                <h3>{isPurchase ? "Start Purchase" : "Start Sale"}</h3>
                <p>Select an existing {partyLabel} or create a new one before continuing to the product page.</p>
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
                  <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isPurchase ? "Search item, barcode, brand, division" : "Search item, barcode, brand, stock item"} />
                  <button className={voiceBusy ? "ghost-button active-voice" : "ghost-button"} type="button" onClick={setVoiceSearch}>{voiceBusy ? "Listening..." : "Voice"}</button>
                </div>
              </label>
              <div className="selected-party-bar">
                <span className="small-label">{isPurchase ? "Selected supplier" : "Selected customer"}</span>
                <strong>{parties.find((item) => item.id === selectedPartyId)?.name || "Not selected"}</strong>
                <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Change</button>
              </div>
              <div className="chip-row">
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
                return (
                  <button key={product.sku} type="button" className={selected ? "product-card selected" : "product-card"} onClick={() => selectProduct(product)}>
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
                      <strong>{isPurchase ? `Base rate ${getSuggestedRate(product)}` : `Sell ref ${product.mrp ?? product.rsp ?? getSuggestedRate(product)}`}</strong>
                      <span>{product.slabs.length > 0 ? `${product.slabs.length} slab${product.slabs.length > 1 ? "s" : ""}` : "Direct item"}</span>
                    </div>
                    <div className="product-footer">
                      <span>{product.allowedWarehouseIds.join(", ")}</span>
                      <span>{isPurchase ? `RSP ${product.rsp ?? 0}` : `Stock ${availableStock}`}</span>
                    </div>
                  </button>
                );
              })}
              {filteredProducts.length === 0 ? <div className="empty-card">No products matched the search.</div> : null}
            </div>

            <div className="checkout-sheet">
              <div className="checkout-head">
                <span className="eyebrow">{isPurchase ? "Quick checkout" : "Quick booking"}</span>
                <h3>{orderForm.productSku || "Select a product card"}</h3>
              </div>
              <form className="form-grid" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
                <label>{isPurchase ? "Supplier" : "Shop"}<select value={isPurchase ? orderForm.supplierId : orderForm.shopId} onChange={(e) => setOrderForm((c: any) => isPurchase ? ({ ...c, supplierId: e.target.value }) : ({ ...c, shopId: e.target.value }))}>{renderOptions(parties)}</select></label>
                <label>Warehouse<select value={orderForm.warehouseId} onChange={(e) => setOrderForm((c: any) => ({ ...c, warehouseId: e.target.value }))}>{renderWarehouseOptions(warehouses)}</select></label>
                <label>{isPurchase ? "Qty" : "Qty"}<input type="number" value={isPurchase ? orderForm.quantityOrdered : orderForm.quantity} onChange={(e) => setOrderForm((c: any) => isPurchase ? ({ ...c, quantityOrdered: e.target.value }) : ({ ...c, quantity: e.target.value }))} /></label>
                <label>Rate<input type="number" value={orderForm.rate} onChange={(e) => setOrderForm((c: any) => ({ ...c, rate: e.target.value }))} /></label>
                <label>Delivery<select value={orderForm.deliveryMode} onChange={(e) => setOrderForm((c: any) => ({ ...c, deliveryMode: e.target.value }))}>{isPurchase ? <><option>Dealer Delivery</option><option>Self Collection</option></> : <><option>Delivery</option><option>Self Collection</option></>}</select></label>
                <label>Pay mode<select value={orderForm.paymentMode} onChange={(e) => setOrderForm((c: any) => ({ ...c, paymentMode: e.target.value as PaymentMode }))}>{paymentMethods.map((m) => <option key={m.code}>{m.code}</option>)}</select></label>
                {orderForm.paymentMode === "Cash" ? <label>Cash timing<select value={orderForm.cashTiming} onChange={(e) => setOrderForm((c: any) => ({ ...c, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}
                <label className="wide-field">Notes<input value={orderForm.note} onChange={(e) => setOrderForm((c: any) => ({ ...c, note: e.target.value }))} /></label>
                <button className="primary-button" type="submit">{isPurchase ? "Finalize purchase" : "Book sales order"}</button>
              </form>
            </div>
            </> : null}
          </div>
        </Panel>
      }
      right={rightPanel}
    />
  );
}

function Overview({ snapshot, currentUser, simpleMode, onOpen }: { snapshot: AppSnapshot; currentUser: AppUser; simpleMode: boolean; onOpen: (view: ViewKey) => void }) {
  const roles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
  const quickActions: Array<{ title: string; text: string; view: ViewKey }> = [];
  if (roles.includes("Admin")) {
    quickActions.push({ title: "Add Product", text: "Create product and price slabs.", view: "Products" });
    quickActions.push({ title: "Add Party", text: "Create supplier or shop.", view: "Parties" });
    quickActions.push({ title: "Check Stock", text: "See current warehouse stock.", view: "Stock" });
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
            <div className="list-card"><div><strong>{snapshot.metrics.pendingSalesPayments}</strong><p>Sales payments pending</p></div></div>
          </div>
        </Panel>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
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
function parseSlabs(value: string): ProductSlab[] { return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => { const [rangeText, rateText] = item.split(":").map((part) => part.trim()); const purchaseRate = Number(rateText); if (rangeText.endsWith("+")) return { minQuantity: Number(rangeText.replace("+", "")), purchaseRate }; const [minQuantity, maxQuantity] = rangeText.split("-").map(Number); return { minQuantity, maxQuantity, purchaseRate }; }); }
function parseCsvRows(csv: string) { const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean); const headers = header.split(",").map((item) => item.trim()); return lines.map((line) => { const cols = line.split(",").map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])); return { ...row, defaultWeightKg: Number(row.defaultWeightKg || 0), toleranceKg: Number(row.toleranceKg || 0), tolerancePercent: Number(row.tolerancePercent || 0), allowedWarehouseIds: String(row.allowedWarehouseIds || "").split("|").filter(Boolean), slabs: parseSlabs(String(row.slabs || "")) }; }); }

export default App;
