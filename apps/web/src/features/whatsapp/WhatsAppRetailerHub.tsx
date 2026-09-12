import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import axios from "axios";
import type { AppSnapshot, AppUser, PaymentMode, UserRole } from "@aapoorti-b2b/domain";
import { API_BASE, api, formatDateTimeIst } from "../../app/shared";
import { SidebarVectorIcon } from "../../components/navigation";
import { DataTable, Panel, TwoCol } from "../../components/ui";

type WhatsAppAdminSection = "Home" | "Team" | "Orders" | "Retailers" | "Catalogue" | "Offers" | "Broadcast" | "Chat" | "Service" | "Insights";
type WhatsAppWorkspace = "operations" | "marketing";

const operationsSections: Array<{ key: WhatsAppAdminSection; label: string; view: "Overview" | "SalesOrders" | "Parties" | "Products" | "WhatsApp" }> = [
  { key: "Home", label: "Home", view: "Overview" },
  { key: "Team", label: "Team", view: "Parties" },
  { key: "Orders", label: "Orders", view: "SalesOrders" },
  { key: "Retailers", label: "Retailers", view: "Parties" },
  { key: "Catalogue", label: "Catalogue", view: "Products" },
  { key: "Chat", label: "Chats", view: "WhatsApp" },
  { key: "Service", label: "Service", view: "WhatsApp" }
];

const marketingSections: Array<{ key: WhatsAppAdminSection; label: string; view: "Overview" | "SalesOrders" | "Parties" | "Products" | "WhatsApp" }> = [
  { key: "Offers", label: "Offers", view: "WhatsApp" },
  { key: "Broadcast", label: "Broadcast", view: "WhatsApp" },
  { key: "Insights", label: "Insights", view: "Overview" }
];

const festivalBroadcast = `Namaste {retailer} 👋

Aapoorti Wholesale ki taraf se aapko aur aapke parivaar ko [Festival name] ki hardik shubhkamnayein! 🎉

[Offer ya delivery schedule yahan likhein]

Order ke liye product ka naam ya *catalogue* bhejein.`;

const featureBroadcast = `Namaste {retailer} 👋

Aapoorti Wholesale mein naya feature aa gaya hai: [Feature name]

[Simple fayda aur use karne ka tareeka yahan likhein]

Madad ke liye *help* bhejein.`;

const trainingPdfBase = API_BASE.replace(/\/$/, "");
const teamTraining = [
  ["Admin and user registration", "01_Admin_User_Registration.pdf"],
  ["Purchase", "02_Purchase_User_Guide.pdf"],
  ["Sales and retailer order", "03_Sales_User_Guide.pdf"],
  ["Warehouse WhatsApp IN / OUT / DCO", "04_Warehouse_IN_OUT_Guide.pdf"],
  ["Delivery and collection WhatsApp", "05_Delivery_Collection_Guide.pdf"],
  ["Accounts", "06_Accounts_Guide.pdf"],
  ["WhatsApp Admin and chat", "07_WhatsApp_Admin_Chat_Guide.pdf"],
  ["Marketing and insights", "08_Marketing_Insights_Guide.pdf"]
] as const;

type RetailerProfile = {
  counterpartyId: string;
  retailerName: string;
  phoneE164: string;
  salesmanId: number;
  salesmanName: string;
  defaultWarehouseId: string;
  billingType: "B2B" | "B2C";
  paymentMode: PaymentMode;
  cashTiming?: string;
  deliveryMode: "Delivery" | "Self Collection";
  optedInAt?: string;
  marketingOptIn: boolean;
  pausedAt?: string;
  tags: string[];
  allowLaterCollection: boolean;
  allowPartialCollection: boolean;
  allowChequeCollection: boolean;
  collectionTolerance: number;
  active: boolean;
};
type DraftLine = {
  id: string;
  product_sku: string;
  product_name: string;
  requested_quantity: number;
  approved_quantity: number;
  rate: number;
  cd_percent: number;
  tod_percent: number;
  stock_at_review?: number;
};
type WhatsAppDraft = {
  id: string;
  retailer_name: string;
  phone_e164: string;
  salesman_name: string;
  warehouse_id: string;
  source: string;
  status: string;
  billing_type: "B2B" | "B2C";
  payment_mode: PaymentMode;
  cash_timing?: string;
  delivery_mode: "Delivery" | "Self Collection";
  note: string;
  sales_cart_id?: string;
  created_at: string;
  lines: DraftLine[];
};
type Dashboard = {
  trainingBroadcast?: { message: string; url: string };
  permissions: { whatsappAdmin: boolean };
  configuration: { connected: boolean; mode: string; phoneNumberIdPresent: boolean; catalogIdPresent: boolean; verifyTokenPresent: boolean; appSecretPresent: boolean };
  retailers: RetailerProfile[];
  whatsappOnlyRetailers: Array<{ id: string; name: string; mobileNumber: string; city: string; contactPerson: string }>;
  priceRules: Array<Record<string, unknown>>;
  offers: Array<Record<string, unknown>>;
  drafts: WhatsAppDraft[];
  wishlists: Array<Record<string, unknown>>;
  registrations: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  serviceTickets: Array<Record<string, unknown>>;
  orderEvents: Array<Record<string, unknown>>;
  campaigns: Array<Record<string, unknown>>;
  analytics: { outbound: number; inbound: number; sent: number; delivered: number; read: number; failed: number; conversations: number; completedOrders: number };
  catalogImageStats: { selected: number; eligible: number; withImage: number };
  mockDrill?: { testRetailers: number; testProducts: number };
  catalogProducts: Array<{ sku: string; name: string; brand: string; size: string; mrp: number; sellingRate: number; minimumOrderQuantity: number; imageUrl: string }>;
  catalogFeedUrl: string;
  retailerEntryLink: string;
};
type LiveChatTicket = Record<string, unknown> & {
  id: string;
  retailer_name: string;
  phone_e164: string;
  salesman_id: number;
  salesman_name: string;
  status: string;
  unread_staff_count: number;
  last_message_preview: string;
  last_message_at: string;
};
type LiveChatMessage = {
  id: string;
  direction: "Inbound" | "Outbound";
  messageType: string;
  status: string;
  body: string;
  errorMessage: string;
  createdAt: string;
};
type LiveChatInbox = { selectedTicketId: string; unreadTotal: number; tickets: LiveChatTicket[]; messages: LiveChatMessage[] };
type ChatOrderLine = { productSku: string; quantity: number; rate: number; cdPercent: number; todPercent: number };

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : "WhatsApp action failed.";
}

function localDateTime(hoursAhead: number) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function normalizedSearch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, "");
}

async function showChatSystemNotification(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  const options = { body, icon: "/business-connect-icon-192.png", tag };
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
  } catch {
    // Fall through to the browser notification API.
  }
  new Notification(title, options);
}

function messageAuditText(item: Record<string, unknown>) {
  const payload = (item.payload_json || {}) as Record<string, unknown>;
  const request = (payload.request || {}) as Record<string, unknown>;
  const inboundText = (payload.text || {}) as Record<string, unknown>;
  const outboundText = (request.text || {}) as Record<string, unknown>;
  const interactive = (request.interactive || {}) as Record<string, unknown>;
  const interactiveBody = (interactive.body || {}) as Record<string, unknown>;
  return String(inboundText.body || outboundText.body || interactiveBody.text || "");
}

function pilotWarehouseId(snapshot: AppSnapshot) {
  return snapshot.warehouses.find((warehouse) => warehouse.id === "C21")?.id
    || snapshot.warehouses[0]?.id
    || "";
}

function DraftReviewCard({ draft, snapshot, busy, onReview, onDeny, onInvoice, onStatus }: {
  draft: WhatsAppDraft;
  snapshot: AppSnapshot;
  busy: boolean;
  onReview: (draft: WhatsAppDraft, body: Record<string, unknown>) => Promise<void>;
  onDeny: (draft: WhatsAppDraft, reason: string) => Promise<void>;
  onInvoice?: (draft: WhatsAppDraft) => Promise<void>;
  onStatus?: (draft: WhatsAppDraft, status: string, note: string) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState(() => draft.warehouse_id || pilotWarehouseId(snapshot));
  const [billingType, setBillingType] = useState<"B2B" | "B2C">(draft.billing_type === "B2B" ? "B2B" : "B2C");
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(draft.payment_mode || "NEFT");
  const [cashTiming, setCashTiming] = useState(draft.cash_timing || "Later");
  const [deliveryMode, setDeliveryMode] = useState<"Delivery" | "Self Collection">(draft.delivery_mode || "Delivery");
  const [note, setNote] = useState(draft.note || "");
  const [denialReason, setDenialReason] = useState("");
  const [lines, setLines] = useState(() => draft.lines.map((line) => ({
    id: line.id,
    quantity: String(line.approved_quantity),
    rate: String(line.rate),
    cdPercent: String(line.cd_percent),
    todPercent: String(line.tod_percent)
  })));
  const [lifecycleStatus, setLifecycleStatus] = useState("Packed");
  const [lifecycleNote, setLifecycleNote] = useState("");
  const canReview = ["Needs Review", "Change Requested", "Staff Approved"].includes(draft.status);

  return <article className="panel">
    <div className="section-heading">
      <div><span className="eyebrow">{draft.source} · {formatDateTimeIst(draft.created_at)}</span><h3>{draft.retailer_name}</h3></div>
      <span className={`status-pill ${draft.status === "Completed" ? "success" : "pending"}`}>{draft.status}</span>
    </div>
    <p className="helper-text">{draft.id} · {draft.phone_e164} · Assigned to {draft.salesman_name}{draft.sales_cart_id ? ` · SO ${draft.sales_cart_id}` : ""}</p>
    {draft.status === "Needs Review" && /Stock review:/i.test(draft.note || "") ? <p className="helper-text"><strong>Stock confirmation required:</strong> edit the quantity/rate below and send confirmation, or deny the order. The retailer is waiting for {draft.salesman_name}.</p> : null}
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Requested</th><th>Approved</th><th>Rate</th><th>CD %</th><th>TOD %</th>{canReview ? <th /> : null}</tr></thead><tbody>
      {draft.lines.filter((line) => lines.some((item) => item.id === line.id)).map((line) => {
        const currentLine = lines.find((item) => item.id === line.id)!;
        return <tr key={line.id}>
        <td><strong>{line.product_name}</strong><small>{line.product_sku}</small></td>
        <td>{line.requested_quantity}</td>
        <td><input type="number" min="0.01" step="any" disabled={!canReview} value={currentLine.quantity} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, quantity: event.target.value } : item))} /></td>
        <td><input type="number" min="0.01" step="any" disabled={!canReview} value={currentLine.rate} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, rate: event.target.value } : item))} /></td>
        <td><input type="number" min="0" max="99" step="any" disabled={!canReview} value={currentLine.cdPercent} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, cdPercent: event.target.value } : item))} /></td>
        <td><input type="number" min="0" max="99" step="any" disabled={!canReview} value={currentLine.todPercent} onChange={(event) => setLines((current) => current.map((item) => item.id === line.id ? { ...item, todPercent: event.target.value } : item))} /></td>
        {canReview ? <td><button className="wa-line-remove" type="button" disabled={busy || lines.length === 1} title={lines.length === 1 ? "Keep one product or deny the order" : "Remove product"} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}>Remove</button></td> : null}
      </tr>;
      })}
    </tbody></table></div>
    {canReview ? <form className="form-grid" onSubmit={(event) => {
      event.preventDefault();
      void onReview(draft, {
        warehouseId, billingType, paymentMode, cashTiming: paymentMode === "Cash" ? cashTiming : undefined,
        deliveryMode, note,
        lines: lines.map((line) => ({ id: line.id, quantity: Number(line.quantity), rate: Number(line.rate), cdPercent: Number(line.cdPercent || 0), todPercent: Number(line.todPercent || 0) }))
      });
    }}>
      <label>Warehouse<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Bill type<select value={billingType} onChange={(event) => setBillingType(event.target.value as "B2B" | "B2C")}><option>B2C</option><option>B2B</option></select></label>
      <label>Payment<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      {paymentMode === "Cash" ? <label>Cash timing<select value={cashTiming} onChange={(event) => setCashTiming(event.target.value)}><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
      <label>Delivery<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "Delivery" | "Self Collection")}><option>Delivery</option><option>Self Collection</option></select></label>
      <label className="wide-field">Internal note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Approve & send retailer confirmation"}</button>
      <label className="wide-field">Reason if denying<input value={denialReason} onChange={(event) => setDenialReason(event.target.value)} placeholder="Explain why this order cannot be fulfilled" /></label>
      <button className="ghost-button" type="button" disabled={busy || !denialReason.trim()} onClick={() => void onDeny(draft, denialReason)}>Deny order</button>
    </form> : null}
    {draft.status === "Completed" && onInvoice ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void onInvoice(draft)}>Send invoice summary</button> : null}
    {draft.status === "Completed" && onStatus ? <form className="wa-lifecycle-row" onSubmit={(event) => { event.preventDefault(); void onStatus(draft, lifecycleStatus, lifecycleNote); }}>
      <label>Retailer update<select value={lifecycleStatus} onChange={(event) => setLifecycleStatus(event.target.value)}><option>Order received</option><option>Approved</option><option>Packed</option><option>Dispatched</option><option>Out for delivery</option><option>Delivered</option><option>Payment received</option></select></label>
      <label>Note<input value={lifecycleNote} onChange={(event) => setLifecycleNote(event.target.value)} placeholder="Vehicle, ETA or payment reference" /></label>
      <button className="primary-button" disabled={busy}>Send update</button>
    </form> : null}
  </article>;
}

function RegistrationReviewCard({ registration, salespeople, snapshot, busy, onApprove }: {
  registration: Record<string, unknown>;
  salespeople: AppUser[];
  snapshot: AppSnapshot;
  busy: boolean;
  onApprove: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [salesmanId, setSalesmanId] = useState(String(salespeople[0]?.id || ""));
  const [warehouseId, setWarehouseId] = useState(pilotWarehouseId(snapshot));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("NEFT");
  const [deliveryMode, setDeliveryMode] = useState<"Delivery" | "Self Collection">("Delivery");
  const pending = registration.status === "Pending";
  return <article className="panel">
    <div className="section-heading"><div><span className="eyebrow">{formatDateTimeIst(String(registration.submitted_at || registration.created_at || ""))}</span><h3>{String(registration.shop_name || "New retailer")}</h3></div><span className={`status-pill ${pending ? "pending" : "success"}`}>{String(registration.status || "Pending")}</span></div>
    <p className="helper-text">{String(registration.phone_e164 || "")} · {String(registration.owner_name || "")} · GSTIN {String(registration.gstin || "NA")} · {String(registration.city || "")}</p>
    <p>{String(registration.delivery_address || "")}</p>
    {pending ? <form className="form-grid" onSubmit={(event) => { event.preventDefault(); void onApprove({ salesmanId: Number(salesmanId), defaultWarehouseId: warehouseId, paymentMode, deliveryMode }); }}>
      <label>Map salesperson<select required value={salesmanId} onChange={(event) => setSalesmanId(event.target.value)}><option value="">Select salesperson</option>{salespeople.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label>Default warehouse<select required value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Payment<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      <label>Delivery<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "Delivery" | "Self Collection")}><option>Delivery</option><option>Self Collection</option></select></label>
      <button className="primary-button" disabled={busy || !salesmanId}>Approve & map retailer</button>
    </form> : null}
  </article>;
}

export function WhatsAppRetailerHub({ snapshot, currentUser, sessionToken, onMessage, onError, onSnapshot, dedicatedWorkspace = false, workspace = "operations" }: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  sessionToken: string;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  onSnapshot: (snapshot: AppSnapshot) => void;
  dedicatedWorkspace?: boolean;
  workspace?: WhatsAppWorkspace;
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [settlementRows, setSettlementRows] = useState<Array<Record<string, unknown>>>([]);
  const [collectionAlerts, setCollectionAlerts] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const shops = useMemo(() => {
    const normalShops = snapshot.counterparties.filter((item) => item.type === "Shop");
    const isolatedShops = (dashboard?.whatsappOnlyRetailers || []).map((item) => ({
      ...item,
      type: "Shop" as const,
      gstNumber: "N/A",
      bankName: "N/A",
      bankAccountNumber: "N/A",
      ifscCode: "N/A",
      address: "WhatsApp pilot only",
      createdBy: "WhatsApp",
      createdAt: ""
    }));
    return [...normalShops, ...isolatedShops];
  }, [dashboard?.whatsappOnlyRetailers, snapshot.counterparties]);
  const salespeople = useMemo(() => snapshot.users.filter((item) => item.active && (item.roles || [item.role]).includes("Sales")), [snapshot.users]);
  const isAdmin = (currentUser.roles || [currentUser.role]).includes("Admin");
  const [mapping, setMapping] = useState(() => ({ counterpartyId: "", phone: "", salesmanId: String(isAdmin ? salespeople[0]?.id || "" : currentUser.id), defaultWarehouseId: pilotWarehouseId(snapshot), billingType: "B2C", paymentMode: "NEFT", cashTiming: "Later", deliveryMode: "Delivery", optedIn: false, active: true }));
  const [newRetailer, setNewRetailer] = useState(() => ({ name: "", phone: "", city: "", contactPerson: "", salesmanId: String(salespeople[0]?.id || ""), defaultWarehouseId: pilotWarehouseId(snapshot), paymentMode: "NEFT", optedIn: true }));
  const [rule, setRule] = useState({ counterpartyId: "", productSku: "", specialRate: "", cdPercent: "0", todPercent: "0", minimumQuantity: "1", validUntil: localDateTime(24), active: true });
  const [offer, setOffer] = useState({ counterpartyIds: [] as string[], productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0", minimumQuantity: "1", maxQuantity: "0", expiresAt: localDateTime(8) });
  const [catalogImageMappings, setCatalogImageMappings] = useState("");
  const [catalogImageReport, setCatalogImageReport] = useState("");
  const [catalogSearch, setCatalogSearch] = useState("");
  const [ruleRetailerSearch, setRuleRetailerSearch] = useState("");
  const [ruleProductSearch, setRuleProductSearch] = useState("");
  const [ruleDepartment, setRuleDepartment] = useState("");
  const [offerRetailerSearch, setOfferRetailerSearch] = useState("");
  const [offerProductSearch, setOfferProductSearch] = useState("");
  const [offerDepartment, setOfferDepartment] = useState("");
  const [broadcastSearch, setBroadcastSearch] = useState("");
  const [broadcastRetailerIds, setBroadcastRetailerIds] = useState<string[]>([]);
  const [broadcastMessage, setBroadcastMessage] = useState("");
  const [broadcastTitle, setBroadcastTitle] = useState("");
  const [broadcastTemplate, setBroadcastTemplate] = useState("");
  const [broadcastTemplateParameters, setBroadcastTemplateParameters] = useState("{retailer}");
  const [broadcastSalesman, setBroadcastSalesman] = useState("");
  const [broadcastWarehouse, setBroadcastWarehouse] = useState("");
  const [broadcastTag, setBroadcastTag] = useState("");
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [liveChat, setLiveChat] = useState<LiveChatInbox>({ selectedTicketId: "", unreadTotal: 0, tickets: [], messages: [] });
  const [chatSearch, setChatSearch] = useState("");
  const [chatReply, setChatReply] = useState("");
  const [chatOrderOpen, setChatOrderOpen] = useState(false);
  const [chatOrderSearch, setChatOrderSearch] = useState("");
  const [chatOrder, setChatOrder] = useState({ productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0", warehouseId: pilotWarehouseId(snapshot), paymentMode: "NEFT" as PaymentMode, cashTiming: "Later", deliveryMode: "Delivery" as "Delivery" | "Self Collection", note: "" });
  const [chatOrderLines, setChatOrderLines] = useState<ChatOrderLine[]>([]);
  const [activeChatDraftId, setActiveChatDraftId] = useState("");
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const liveChatSeenRef = useRef<Map<string, string> | null>(null);
  const [chatAlert, setChatAlert] = useState<{ retailer: string; preview: string } | null>(null);
  const [desktopAlertsEnabled, setDesktopAlertsEnabled] = useState(() => typeof Notification !== "undefined" && Notification.permission === "granted");
  const [wishlistProducts, setWishlistProducts] = useState<Record<string, string>>({});
  const [retailerTagDrafts, setRetailerTagDrafts] = useState<Record<string, string>>({});
  const [broadcastReport, setBroadcastReport] = useState("");
  const [staffForm, setStaffForm] = useState(() => ({ username: "", fullName: "", mobileNumber: "", role: "Sales" as UserRole, alsoCollection: false, warehouseId: pilotWarehouseId(snapshot), password: "1234" }));
  const [activeSection, setActiveSection] = useState<WhatsAppAdminSection>(workspace === "marketing" ? "Offers" : "Home");
  const isMarketingWorkspace = workspace === "marketing";
  const workspaceSections = isMarketingWorkspace ? marketingSections : operationsSections;

  useEffect(() => {
    setActiveSection(isMarketingWorkspace ? "Offers" : "Home");
  }, [isMarketingWorkspace]);

  const headers = { authorization: `Bearer ${sessionToken}` };
  async function refresh() {
    try {
      const { data } = await api.get<Dashboard>("/whatsapp/dashboard", { headers });
      setDashboard(data);
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function loadSettlements() {
    setBusy(true); onError("");
    try { const { data } = await api.get<{ rows: Array<Record<string, unknown>> }>("/whatsapp/settlements", { headers }); setSettlementRows(data.rows); }
    catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function loadCollectionAlerts() {
    setBusy(true); onError("");
    try { const { data } = await api.get<{ rows: Array<Record<string, unknown>> }>("/whatsapp/collection-alerts", { headers }); setCollectionAlerts(data.rows); }
    catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function decideCollectionAlert(taskId: string, decision: "approved" | "rejected") {
    setBusy(true); onError("");
    try { await api.post(`/whatsapp/collection-alerts/${encodeURIComponent(taskId)}/decision`, { decision }, { headers }); await loadCollectionAlerts(); onMessage(`Collection exception ${decision}.`); }
    catch (error) { onError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [sessionToken]);

  async function checkLiveChatUpdates() {
    try {
      const { data } = await api.get<LiveChatInbox>("/whatsapp/live-chat", { headers });
      const latest = new Map(data.tickets.map((ticket) => [ticket.id, String(ticket.last_message_at || "")]));
      const previous = liveChatSeenRef.current;
      if (previous) {
        const incoming = data.tickets.find((ticket) => Number(ticket.unread_staff_count || 0) > 0 && previous.get(ticket.id) !== latest.get(ticket.id));
        if (incoming) {
          const retailer = String(incoming.retailer_name || "Retailer");
          const preview = String(incoming.last_message_preview || "New WhatsApp message");
          setChatAlert({ retailer, preview });
          if (typeof Notification !== "undefined" && Notification.permission === "granted") {
            void showChatSystemNotification(`New WhatsApp message — ${retailer}`, preview, `wa-chat-${incoming.id}`);
          }
        }
      }
      liveChatSeenRef.current = latest;
      if (activeSection !== "Chat") setLiveChat((current) => ({ ...current, unreadTotal: data.unreadTotal, tickets: data.tickets }));
    } catch {
      // The regular inbox refresh surfaces connection errors while this background poll stays quiet.
    }
  }

  useEffect(() => {
    void checkLiveChatUpdates();
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void checkLiveChatUpdates(); }, 8000);
    return () => window.clearInterval(timer);
  }, [sessionToken, activeSection]);

  async function enableDesktopAlerts() {
    if (typeof Notification === "undefined") return;
    const permission = await Notification.requestPermission();
    setDesktopAlertsEnabled(permission === "granted");
    if (permission !== "granted") onError("Browser notification permission allow karein, tab desktop alert dikhega.");
  }

  useEffect(() => {
    if (!dedicatedWorkspace) return;
    const preventZoom = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && ["+", "-", "=", "0"].includes(event.key)) event.preventDefault();
    };
    const preventPinchZoom = (event: WheelEvent) => { if (event.ctrlKey) event.preventDefault(); };
    window.addEventListener("keydown", preventZoom);
    window.addEventListener("wheel", preventPinchZoom, { passive: false });
    return () => { window.removeEventListener("keydown", preventZoom); window.removeEventListener("wheel", preventPinchZoom); };
  }, [dedicatedWorkspace]);

  async function refreshLiveChat(ticketId = liveChat.selectedTicketId, markRead = false) {
    try {
      const path = ticketId ? `/whatsapp/live-chat?ticketId=${encodeURIComponent(ticketId)}` : "/whatsapp/live-chat";
      const { data } = markRead && ticketId
        ? await api.post<LiveChatInbox>(`/whatsapp/live-chat/${encodeURIComponent(ticketId)}/read`, {}, { headers })
        : await api.get<LiveChatInbox>(path, { headers });
      setLiveChat(data);
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  useEffect(() => {
    if (activeSection !== "Chat") return;
    void refreshLiveChat(liveChat.selectedTicketId, Boolean(liveChat.selectedTicketId));
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshLiveChat(liveChat.selectedTicketId, Boolean(liveChat.selectedTicketId));
    }, 4000);
    return () => window.clearInterval(timer);
  }, [activeSection, sessionToken, liveChat.selectedTicketId]);

  useEffect(() => {
    if (activeSection !== "Chat") return;
    const messages = chatMessagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [activeSection, liveChat.messages.length, liveChat.selectedTicketId]);

  async function sendChatReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ticketId = liveChat.selectedTicketId;
    const message = chatReply.trim();
    if (!ticketId || !message) return;
    setBusy(true); onError("");
    try {
      await api.post(`/whatsapp/service-tickets/${encodeURIComponent(ticketId)}/reply`, { message, close: false }, { headers });
      setChatReply("");
      await refreshLiveChat(ticketId, true);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function updateChat(body: { status?: string; salesmanId?: number }, success: string) {
    if (!liveChat.selectedTicketId) return;
    setBusy(true); onError("");
    try {
      const { data } = await api.post<LiveChatInbox>(`/whatsapp/live-chat/${encodeURIComponent(liveChat.selectedTicketId)}/update`, body, { headers });
      setLiveChat(data); onMessage(success);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createOrderFromChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!liveChat.selectedTicketId || !chatOrderLines.length) return;
    setBusy(true); onError("");
    try {
      const { data } = await api.post<{ draftId: string; confirmationSent: boolean; dashboard: Dashboard; liveChat: LiveChatInbox }>(`/whatsapp/live-chat/${encodeURIComponent(liveChat.selectedTicketId)}/order`, {
        draftId: activeChatDraftId || undefined,
        lines: chatOrderLines,
        warehouseId: chatOrder.warehouseId,
        paymentMode: chatOrder.paymentMode,
        cashTiming: chatOrder.cashTiming,
        deliveryMode: chatOrder.deliveryMode,
        note: chatOrder.note
      }, { headers });
      setDashboard(data.dashboard);
      setLiveChat(data.liveChat);
      setChatOrderOpen(true);
      setActiveChatDraftId(data.draftId);
      setChatOrderSearch("");
      setChatOrder((current) => ({ ...current, productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0" }));
      onMessage(data.confirmationSent
        ? `Order ${data.draftId} ka latest proforma WhatsApp par bhej diya. Isi order mein aur item add kar sakte hain.`
        : `Order ${data.draftId} update ho gaya. Low-stock items approval queue mein hain.`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  function addChatOrderLine() {
    if (!selectedChatOrderProduct || !chatOrder.productSku) return;
    const quantity = Number(chatOrder.quantity);
    const rate = Number(chatOrder.rate);
    const cdPercent = Number(chatOrder.cdPercent);
    const todPercent = Number(chatOrder.todPercent);
    const minimum = Math.max(1, Number(selectedChatOrderProduct.minimumOrderQuantity || 1));
    if (!(quantity >= minimum)) { onError(`Minimum quantity ${minimum} hai.`); return; }
    if (!(rate > 0)) { onError("Rate zero se zyada hona chahiye."); return; }
    if (cdPercent < 0 || todPercent < 0 || cdPercent + todPercent >= 100) { onError("CD/TOD percentage check karein."); return; }
    setChatOrderLines((current) => {
      const next = { productSku: chatOrder.productSku, quantity, rate, cdPercent, todPercent };
      const existing = current.findIndex((line) => line.productSku === next.productSku);
      return existing < 0 ? [...current, next] : current.map((line, index) => index === existing ? next : line);
    });
    setChatOrderSearch("");
    setChatOrder((current) => ({ ...current, productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0" }));
    onError("");
  }

  function startNewChatOrder() {
    setActiveChatDraftId("");
    setChatOrderLines([]);
    setChatOrderSearch("");
    setChatOrder((current) => ({ ...current, productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0", note: "" }));
    onError("");
  }

  async function submit(path: string, body: unknown, success: string, onSuccess?: () => void) {
    setBusy(true); onError("");
    try {
      const { data } = await api.post<Dashboard | { dashboard?: Dashboard }>(path, body, { headers });
      const next = "dashboard" in data && data.dashboard ? data.dashboard : data as Dashboard;
      if (next?.configuration) setDashboard(next);
      else await refresh();
      onMessage(success);
      onSuccess?.();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function clearPilotActivity() {
    setBusy(true); onError("");
    try {
      const { data } = await api.delete<Dashboard>("/whatsapp/setup/test-activity", { headers });
      setDashboard(data);
      onMessage("Test WhatsApp chats, carts, proformas, offers and wishlists cleared.");
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function prepareMockDrill() {
    setBusy(true); onError("");
    try {
      await api.post("/whatsapp/setup/test-retailers", {}, { headers });
      const { data } = await api.post<{ products: unknown[] }>("/whatsapp/setup/test-products", {}, { headers });
      await refresh();
      onMessage(`${data.products.length} test products and 10 retailer shells are ready. Map a real test WhatsApp number before testing chat.`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createWhatsAppStaff(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); onError("");
    try {
      const roles = staffForm.alsoCollection ? Array.from(new Set<UserRole>([staffForm.role, "Delivery", "Collection Agent"])) : [staffForm.role];
      const { data } = await api.post<AppSnapshot>("/whatsapp/staff-users", {
        username: staffForm.username,
        fullName: staffForm.fullName,
        mobileNumber: staffForm.mobileNumber,
        role: roles[0],
        roles,
        warehouseIds: staffForm.warehouseId ? [staffForm.warehouseId] : [],
        password: staffForm.password
      }, { headers });
      onSnapshot(data);
      setStaffForm({ username: "", fullName: "", mobileNumber: "", role: "Sales", alsoCollection: false, warehouseId: pilotWarehouseId(data), password: "1234" });
      onMessage("Operational WhatsApp user created.");
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendBroadcast(event?: FormEvent<HTMLFormElement>, training = false) {
    event?.preventDefault();
    const message = training ? dashboard?.trainingBroadcast?.message || "" : broadcastMessage;
    if (training && !message) return;
    if (training && broadcastTemplate && !broadcastTemplateParameters.includes("{guide_link}") && !broadcastTemplateParameters.includes(dashboard!.trainingBroadcast!.url)) {
      onError("Approved training template ke sahi parameter mein {guide_link} daalein."); return;
    }
    if (!window.confirm(`Send ${training ? "training link" : "this WhatsApp message"} to ${broadcastRetailerIds.length} selected retailer${broadcastRetailerIds.length === 1 ? "" : "s"}?\n\n${broadcastTemplate ? `Template: ${broadcastTemplate}\n${broadcastTemplateParameters.replaceAll("{guide_link}", dashboard?.trainingBroadcast?.url || "")}` : message}`)) return;
    setBusy(true); onError(""); setBroadcastReport("");
    try {
      const { data } = await api.post<{ sent: number; skipped: number; failed: number; dashboard: Dashboard; results: Array<{ retailer: string; status: string; error?: string }> }>("/whatsapp/broadcasts", {
        counterpartyIds: broadcastRetailerIds,
        title: training ? "WhatsApp training" : broadcastTitle,
        message,
        training,
        templateName: broadcastTemplate,
        templateParameters: broadcastTemplateParameters.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)
      }, { headers });
      setDashboard(data.dashboard);
      setBroadcastReport([`${data.sent} sent · ${data.skipped} skipped · ${data.failed} failed`, ...data.results.filter((item) => item.status !== "Sent").map((item) => `${item.retailer}: ${item.error || item.status}`)].join("\n"));
      onMessage(data.failed ? `Broadcast completed with ${data.failed} failed message${data.failed === 1 ? "" : "s"}.` : `Broadcast sent to ${data.sent} retailer${data.sent === 1 ? "" : "s"}.`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function importCatalogImages(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const entries = catalogImageMappings.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(",");
      return separator > 0 ? { sku: line.slice(0, separator).trim(), sourceUrl: line.slice(separator + 1).trim() } : null;
    }).filter((entry): entry is { sku: string; sourceUrl: string } => Boolean(entry?.sku && entry.sourceUrl));
    if (!entries.length) { onError("Add at least one SKU,image URL line."); return; }
    if (entries.length > 6) { onError("Import a maximum of 6 images per batch."); return; }
    setBusy(true); onError(""); setCatalogImageReport("");
    try {
      const { data } = await api.post<{ imported: number; failed: number; results: Array<{ sku: string; imported: boolean; error?: string }> }>("/whatsapp/catalog/images/import", { entries }, { headers });
      setCatalogImageReport([`${data.imported} imported · ${data.failed} failed`, ...data.results.filter((item) => !item.imported).map((item) => `${item.sku}: ${item.error}`)].join("\n"));
      if (data.imported) setCatalogImageMappings("");
      await refresh();
      onMessage(`${data.imported} catalogue image${data.imported === 1 ? "" : "s"} compressed and stored in R2.`);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const mappedRetailers = useMemo(() => dashboard?.retailers || [], [dashboard?.retailers]);
  const activeMappedRetailers = useMemo(() => mappedRetailers.filter((item) => item.active), [mappedRetailers]);
  const departments = useMemo(() => Array.from(new Set(snapshot.products.map((product) => product.department.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [snapshot.products]);
  const wholesaleWarehouseId = useMemo(() => snapshot.warehouses.find((warehouse) => warehouse.id === "C21" || warehouse.name.trim().toLowerCase() === "wholesale warehouse")?.id || "", [snapshot.warehouses]);
  const wholesaleAvailableProducts = useMemo(() => {
    const availableSkus = new Set(snapshot.stockSummary
      .filter((stock) => stock.warehouseId === wholesaleWarehouseId && stock.availableQuantity > 0)
      .map((stock) => stock.productSku));
    return snapshot.products.filter((product) => product.whatsappCatalogEnabled && availableSkus.has(product.sku));
  }, [snapshot.products, snapshot.stockSummary, wholesaleWarehouseId]);
  const offerDepartments = useMemo(() => Array.from(new Set(wholesaleAvailableProducts.map((product) => product.department.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [wholesaleAvailableProducts]);
  const filteredRuleRetailers = useMemo(() => {
    const query = normalizedSearch(ruleRetailerSearch);
    if (!query) return mappedRetailers;
    return mappedRetailers.filter((item) => [item.retailerName, item.phoneE164, item.salesmanName, item.defaultWarehouseId]
      .some((value) => normalizedSearch(value).includes(query)));
  }, [mappedRetailers, ruleRetailerSearch]);
  const filteredOfferRetailers = useMemo(() => {
    const query = normalizedSearch(offerRetailerSearch);
    if (!query) return activeMappedRetailers;
    return activeMappedRetailers.filter((item) => [item.retailerName, item.phoneE164, item.salesmanName, item.defaultWarehouseId]
      .some((value) => normalizedSearch(value).includes(query)));
  }, [activeMappedRetailers, offerRetailerSearch]);
  const filteredRuleProducts = useMemo(() => {
    const query = normalizedSearch(ruleProductSearch);
    return snapshot.products.filter((product) => (!ruleDepartment || product.department === ruleDepartment)
      && (!query || [product.name, product.sku, product.brand, product.division, product.department, product.section, product.category, product.subCategory]
        .filter(Boolean)
        .some((value) => normalizedSearch(String(value)).includes(query))));
  }, [ruleDepartment, ruleProductSearch, snapshot.products]);
  const filteredOfferProducts = useMemo(() => {
    const query = normalizedSearch(offerProductSearch);
    return wholesaleAvailableProducts.filter((product) => (!offerDepartment || product.department === offerDepartment)
      && (!query || [product.name, product.sku, product.brand, product.division, product.department, product.section, product.category, product.subCategory]
        .filter(Boolean)
        .some((value) => normalizedSearch(String(value)).includes(query))));
  }, [offerDepartment, offerProductSearch, wholesaleAvailableProducts]);
  const selectableOfferRetailerIds = filteredOfferRetailers.map((item) => item.counterpartyId);
  const allVisibleRetailersSelected = selectableOfferRetailerIds.length > 0
    && selectableOfferRetailerIds.every((counterpartyId) => offer.counterpartyIds.includes(counterpartyId));
  const broadcastRetailers = useMemo(() => {
    const query = normalizedSearch(broadcastSearch);
    return activeMappedRetailers.filter((item) => item.optedInAt && item.marketingOptIn
      && (!broadcastSalesman || String(item.salesmanId) === broadcastSalesman)
      && (!broadcastWarehouse || item.defaultWarehouseId === broadcastWarehouse)
      && (!broadcastTag || item.tags.includes(broadcastTag))
      && (!query || [item.retailerName, item.phoneE164, item.salesmanName, item.defaultWarehouseId, ...item.tags]
        .some((value) => normalizedSearch(value).includes(query))));
  }, [activeMappedRetailers, broadcastSalesman, broadcastSearch, broadcastTag, broadcastWarehouse]);
  const retailerTags = useMemo(() => Array.from(new Set(activeMappedRetailers.flatMap((item) => item.tags))).sort(), [activeMappedRetailers]);
  const visibleBroadcastRetailerIds = broadcastRetailers.map((item) => item.counterpartyId);
  const allVisibleBroadcastRetailersSelected = visibleBroadcastRetailerIds.length > 0
    && visibleBroadcastRetailerIds.every((counterpartyId) => broadcastRetailerIds.includes(counterpartyId));
  const whatsappAdmin = Boolean(dashboard?.permissions.whatsappAdmin);
  const activeDrafts = (dashboard?.drafts || []).filter((item) => ["Needs Review", "Change Requested", "Staff Approved", "Awaiting Retailer", "Processing"].includes(item.status));
  const completedDrafts = (dashboard?.drafts || []).filter((item) => item.status === "Completed");
  const pendingWishlists = (dashboard?.wishlists || []).filter((item) => item.status === "Pending");
  const pendingRegistrations = (dashboard?.registrations || []).filter((item) => item.status === "Pending");
  const operationalRoles: UserRole[] = ["Sales", "Purchaser", "Warehouse Manager", "Delivery Manager", "Collection Agent", "In Delivery", "Out Delivery", "Delivery"];
  const deliveryOperationalRoles: UserRole[] = ["Delivery Manager", "Collection Agent", "In Delivery", "Out Delivery", "Delivery"];
  const operationalUsers = snapshot.users.filter((user) => user.active && (user.roles || [user.role]).some((role) => operationalRoles.includes(role)));
  const mockDrillChecks = [
    ["Test products", (dashboard?.mockDrill?.testProducts || 0) >= 10],
    ["Test retailer shells", (dashboard?.mockDrill?.testRetailers || 0) >= 10],
    ["Sales user", operationalUsers.some((user) => (user.roles || [user.role]).includes("Sales"))],
    ["Warehouse user", operationalUsers.some((user) => (user.roles || [user.role]).includes("Warehouse Manager"))],
    ["Delivery + Collection user", operationalUsers.some((user) => { const roles = user.roles || [user.role]; return roles.includes("Delivery") && roles.includes("Collection Agent"); })],
    ["Mapped WhatsApp retailer", mappedRetailers.length > 0]
  ] as const;
  const mockDrillMissing = mockDrillChecks.filter(([, ready]) => !ready).map(([label]) => label);
  const openTickets = (dashboard?.serviceTickets || []).filter((item) => item.status === "Open" && item.kind !== "Live Chat");
  const openServiceTickets = openTickets;
  const filteredChats = liveChat.tickets.filter((ticket) => !chatSearch.trim()
    || [ticket.retailer_name, ticket.phone_e164, ticket.salesman_name, ticket.last_message_preview]
      .some((value) => normalizedSearch(String(value || "")).includes(normalizedSearch(chatSearch))));
  const selectedChat = liveChat.tickets.find((ticket) => String(ticket.id) === liveChat.selectedTicketId);
  const filteredChatOrderProducts = snapshot.products.filter((product) => {
    const query = normalizedSearch(chatOrderSearch);
    return product.whatsappCatalogEnabled && (!query || [product.name, product.sku, product.brand, product.size].some((value) => normalizedSearch(String(value || "")).includes(query)));
  }).slice(0, 250);
  const selectedChatOrderProduct = snapshot.products.find((product) => product.sku === chatOrder.productSku);
  const selectedChatOrderStock = snapshot.stockSummary.find((stock) => stock.warehouseId === chatOrder.warehouseId && stock.productSku === chatOrder.productSku)?.availableQuantity || 0;
  const chatOrderSubtotal = chatOrderLines.reduce((total, line) => total + line.quantity * line.rate * (1 - (line.cdPercent + line.todPercent) / 100), 0);
  const liveChatUnread = liveChat.tickets.length
    ? liveChat.unreadTotal
    : (dashboard?.serviceTickets || []).filter((item) => item.kind === "Live Chat" && item.status === "Open")
      .reduce((total, item) => total + Number(item.unread_staff_count || 0), 0);
  const availableSections = isMarketingWorkspace
    ? (whatsappAdmin ? workspaceSections : [])
    : (whatsappAdmin || dedicatedWorkspace
      ? workspaceSections
      : workspaceSections.filter((section) => section.key === "Home" || section.key === "Orders" || section.key === "Chat" || section.key === "Service"));
  const visibleCatalogProducts = useMemo(() => {
    const query = catalogSearch.trim().toLowerCase().replace(/\s+/g, "");
    const products = dashboard?.catalogProducts || [];
    if (!query) return products;
    return products.filter((product) => [product.name, product.sku, product.brand, product.size]
      .some((value) => value.toLowerCase().replace(/\s+/g, "").includes(query)));
  }, [catalogSearch, dashboard?.catalogProducts]);
  return <div className={`wa-admin-workspace${dedicatedWorkspace ? " is-dedicated" : ""}${isMarketingWorkspace ? " is-marketing" : ""}`}>
    {!desktopAlertsEnabled && typeof Notification !== "undefined" ? <button className="ghost-button wa-alert-enable" type="button" onClick={() => void enableDesktopAlerts()}>Enable chat alerts</button> : null}
    {chatAlert ? <button className="wa-chat-alert" type="button" onClick={() => { setActiveSection("Chat"); setChatAlert(null); }}><strong>New retailer message — {chatAlert.retailer}</strong><span>{chatAlert.preview}</span><em>Open chat</em></button> : null}
    <header className="wa-admin-head">
      <div><span className="eyebrow">{isMarketingWorkspace ? "Retailer marketing" : "Retailer commerce"}</span><h1>{activeSection === "Home" ? "Good to see you" : activeSection}</h1><p>{activeSection === "Home" ? "Everything requiring your attention, in one place." : isMarketingWorkspace ? "Campaigns, offers and performance insights" : "WhatsApp operational control centre"}</p></div>
      <button className="wa-sync-button" type="button" disabled={busy} onClick={() => void refresh()} aria-label="Refresh WhatsApp data"><span aria-hidden="true">↻</span> Refresh</button>
    </header>

    <nav className={`${dedicatedWorkspace ? "wa-admin-dock" : "wa-section-tabs"}${availableSections.length < 5 ? " is-compact" : ""}${availableSections.length === 6 ? " has-six" : ""}${availableSections.length > 6 ? " has-many" : ""}`} aria-label="WhatsApp administration">
      {availableSections.map((section) => {
        const badge = section.key === "Orders" ? activeDrafts.length : section.key === "Retailers" ? pendingRegistrations.length : section.key === "Offers" ? pendingWishlists.length : section.key === "Chat" ? liveChatUnread : section.key === "Service" ? openServiceTickets.length : 0;
        return <button key={section.key} type="button" className={activeSection === section.key ? "active" : ""} onClick={() => setActiveSection(section.key)} aria-current={activeSection === section.key ? "page" : undefined}>
          <span><SidebarVectorIcon view={section.view} /></span><strong>{section.label}</strong>{badge > 0 ? <em>{badge > 99 ? "99+" : badge}</em> : null}
        </button>;
      })}
    </nav>

    {activeSection === "Home" ? <>
      <section className="wa-command-grid" aria-label="WhatsApp overview">
        <button type="button" onClick={() => setActiveSection("Orders")}><span className="wa-command-icon orders"><SidebarVectorIcon view="SalesOrders" /></span><small>Orders to review</small><strong>{activeDrafts.length}</strong><em>{activeDrafts.length ? "Open queue" : "Queue clear"}</em></button>
        {whatsappAdmin || dedicatedWorkspace ? <button type="button" onClick={() => setActiveSection("Retailers")}><span className="wa-command-icon retailers"><SidebarVectorIcon view="Parties" /></span><small>New registrations</small><strong>{pendingRegistrations.length}</strong><em>{mappedRetailers.length} retailers mapped</em></button> : null}
        <button type="button" onClick={() => setActiveSection("Orders")}><span className="wa-command-icon wishlist"><SidebarVectorIcon view="WhatsApp" /></span><small>Wishlist requests</small><strong>{pendingWishlists.length}</strong><em>Products retailers need</em></button>
        {whatsappAdmin || dedicatedWorkspace ? <button type="button" onClick={() => setActiveSection("Catalogue")}><span className="wa-command-icon catalogue"><SidebarVectorIcon view="Products" /></span><small>Catalogue ready</small><strong>{dashboard?.catalogImageStats.eligible || 0}</strong><em>{dashboard?.catalogImageStats.withImage || 0} product images</em></button> : null}
        <button type="button" onClick={() => setActiveSection("Chat")}><span className="wa-command-icon service"><SidebarVectorIcon view="WhatsApp" /></span><small>Live chat</small><strong>{liveChatUnread}</strong><em>{liveChatUnread ? "Unread retailer messages" : "Inbox clear"}</em></button>
        {whatsappAdmin ? <button type="button" onClick={() => setActiveSection("Insights")}><span className="wa-command-icon insights"><SidebarVectorIcon view="Overview" /></span><small>30-day conversations</small><strong>{dashboard?.analytics.conversations || 0}</strong><em>{dashboard?.analytics.failed || 0} failed sends</em></button> : null}
      </section>
      <section className="wa-home-strip">
        <div><span className={`wa-live-dot${dashboard?.configuration.connected ? " connected" : ""}`} /><p><strong>{dashboard?.configuration.connected ? "WhatsApp connected" : "WhatsApp needs attention"}</strong><small>{dashboard?.configuration.mode || "Checking connection…"}</small></p></div>
        <div><p><strong>{mappedRetailers.filter((item) => item.optedInAt && item.active).length} opted-in retailers</strong><small>Ready to receive approved messages</small></p></div>
      </section>
    </> : null}

    {!isMarketingWorkspace && whatsappAdmin && activeSection === "Team" ? <><Panel title="Training material" eyebrow="Interactive guide + downloadable PDFs"><p className="helper-text">Har role ki script yahin milegi. Warehouse aur Delivery guides mein WhatsApp commands bhi hain.</p><div className="payment-card-actions">{teamTraining.map(([label, file]) => <a className="ghost-button" key={file} href={`${trainingPdfBase}/training-pdfs/${file}`} target="_blank" rel="noreferrer">Download {label} PDF</a>)}</div></Panel><Panel title="Delivery collection settlement" eyebrow="WhatsApp Admin reconciliation"><button className="ghost-button" type="button" disabled={busy} onClick={() => void loadSettlements()}>Load pending settlement</button>{settlementRows.length ? <DataTable headers={["Agent", "MOP", "Since last settlement", "Entries"]} rows={settlementRows.map((row) => [String(row.created_by || ""), String(row.mode || ""), `₹${Number(row.amount || 0).toFixed(2)}`, String(row.entries || 0)])} /> : <p className="helper-text">Shows only collections received after each agent’s last settlement.</p>}</Panel><Panel title="Collection approval alerts" eyebrow="Action required"><button className="ghost-button" type="button" disabled={busy} onClick={() => void loadCollectionAlerts()}>Load collection alerts</button>{collectionAlerts.length ? collectionAlerts.map((row) => <div className="payment-card-actions" key={String(row.id)}><span className="helper-text">{String(row.created_at || "").slice(0, 16).replace("T", " ")} - {String(row.note || "")}</span><button className="primary-button" type="button" disabled={busy} onClick={() => void decideCollectionAlert(String(row.entity_id), "approved")}>Approve exception</button><button className="danger-button" type="button" disabled={busy} onClick={() => void decideCollectionAlert(String(row.entity_id), "rejected")}>Reject</button></div>) : <p className="helper-text">Short or unauthorised collections appear here for WhatsApp Admin review.</p>}</Panel><TwoCol left={<Panel title="Register operational WhatsApp user" eyebrow="Sales, purchase, warehouse, delivery and collection"><form className="form-grid" onSubmit={createWhatsAppStaff}>
      <p className="helper-text wide-field">Create the B CONNECT user and record the WhatsApp number from one control point. User will receive only the modules assigned by role.</p>
      <label>Name<input required value={staffForm.fullName} onChange={(event) => setStaffForm((current) => ({ ...current, fullName: event.target.value }))} placeholder="Staff full name" /></label>
      <label>Username<input required value={staffForm.username} onChange={(event) => setStaffForm((current) => ({ ...current, username: event.target.value.toLowerCase().replace(/\s+/g, ".") }))} placeholder="e.g. warehouse.panvel" /></label>
      <label>WhatsApp number<input required value={staffForm.mobileNumber} onChange={(event) => setStaffForm((current) => ({ ...current, mobileNumber: event.target.value }))} placeholder="919876543210" /></label>
      <label>Operational role<select value={staffForm.role} onChange={(event) => { const role = event.target.value as UserRole; setStaffForm((current) => ({ ...current, role, alsoCollection: deliveryOperationalRoles.includes(role) ? current.alsoCollection : false })); }}>{operationalRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      {deliveryOperationalRoles.includes(staffForm.role) ? <label className="checkbox-line"><input type="checkbox" checked={staffForm.alsoCollection} onChange={(event) => setStaffForm((current) => ({ ...current, alsoCollection: event.target.checked }))} />Delivery + Collection same person</label> : null}
      <label>Warehouse<select value={staffForm.warehouseId} onChange={(event) => setStaffForm((current) => ({ ...current, warehouseId: event.target.value }))}><option value="">No warehouse scope</option>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Temporary password<input required value={staffForm.password} onChange={(event) => setStaffForm((current) => ({ ...current, password: event.target.value }))} /></label>
      <button className="primary-button wide-field" disabled={busy}>Create operational user</button>
    </form></Panel>} right={<Panel title="Operational WhatsApp directory" eyebrow="Mobile numbers and assignments"><DataTable headers={["Name", "Role", "WhatsApp", "Warehouse"]} rows={operationalUsers.map((user) => [user.fullName, (user.roles || [user.role]).join(", "), user.mobileNumber || "Missing", (user.warehouseIds || []).join(", ") || "All"])}/></Panel>} /></> : null}

    {whatsappAdmin && activeSection === "Retailers" ? <>
    <Panel title="Mock drill readiness" eyebrow="Warehouse to collection"><div className="message-chip-grid">{mockDrillChecks.map(([label, ready]) => <span key={label} className={ready ? "status-pill status-approved" : "status-pill status-pending"}>{ready ? "Ready" : "Needed"}: {label}</span>)}</div><p className="helper-text">{mockDrillMissing.length ? `Next setup: ${mockDrillMissing.join(" · ")}.` : "All mock-drill prerequisites are ready."}</p><p className="helper-text">Run order: prepare test data → map one real test number below → retailer sends <strong>guide</strong> → Sales confirms SO → Warehouse packs and creates DCO → Delivery completes collection.</p></Panel>
    <section className="stacked-sections"><div className="section-heading"><div><span className="eyebrow">Self-registration</span><h2>Retailers waiting for mapping</h2></div><div className="payment-card-actions"><button className="ghost-button" type="button" disabled={busy} onClick={() => void prepareMockDrill()}>Prepare mock drill</button><button className="ghost-button danger-button" type="button" disabled={busy} onClick={() => void clearPilotActivity()}>Clear test chats & orders</button><button className="ghost-button" type="button" onClick={() => void refresh()}>Refresh</button></div></div>
      {pendingRegistrations.length ? pendingRegistrations.map((registration) => <RegistrationReviewCard key={String(registration.id)} registration={registration} salespeople={salespeople} snapshot={snapshot} busy={busy} onApprove={async (body) => submit(`/whatsapp/registrations/${encodeURIComponent(String(registration.id))}/approve`, body, "Retailer approved and mapped to salesperson.")} />) : <Panel title="No pending registrations" eyebrow="Queue clear"><p>New WhatsApp retailer registrations will appear here automatically.</p></Panel>}
    </section>

    <TwoCol left={<Panel title="Map retailer" eyebrow="WhatsApp identity and owner"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/retailers", { ...mapping, salesmanId: Number(mapping.salesmanId) }, "Retailer WhatsApp mapping saved."); }}>
      <label>Retailer<select value={mapping.counterpartyId} onChange={(event) => { const shop = shops.find((item) => item.id === event.target.value); setMapping((current) => ({ ...current, counterpartyId: event.target.value, phone: shop?.mobileNumber || current.phone, billingType: "B2C" })); }}><option value="">Select retailer</option>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name} · {shop.city}</option>)}</select></label>
      <label>WhatsApp number<input value={mapping.phone} onChange={(event) => setMapping((current) => ({ ...current, phone: event.target.value }))} placeholder="919876543210" /></label>
      <label>Assigned salesperson<select value={mapping.salesmanId} onChange={(event) => setMapping((current) => ({ ...current, salesmanId: event.target.value }))}>{salespeople.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label>Warehouse<select value={mapping.defaultWarehouseId} onChange={(event) => setMapping((current) => ({ ...current, defaultWarehouseId: event.target.value }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Billing<select value={mapping.billingType} onChange={(event) => setMapping((current) => ({ ...current, billingType: event.target.value }))}><option>B2B</option><option>B2C</option></select></label>
      <label>Payment<select value={mapping.paymentMode} onChange={(event) => setMapping((current) => ({ ...current, paymentMode: event.target.value }))}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      <label>Delivery<select value={mapping.deliveryMode} onChange={(event) => setMapping((current) => ({ ...current, deliveryMode: event.target.value }))}><option>Delivery</option><option>Self Collection</option></select></label>
      <label className="checkbox-line"><input type="checkbox" checked={mapping.optedIn} onChange={(event) => setMapping((current) => ({ ...current, optedIn: event.target.checked }))} />Retailer consent recorded</label>
      <button className="primary-button" disabled={busy}>Save mapping</button>
    </form></Panel>} right={<Panel title="Add retailer" eyebrow="Create + map from WhatsApp admin"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/retailers/create", { ...newRetailer, salesmanId: Number(newRetailer.salesmanId) }, "Retailer created and WhatsApp mapped.", () => setNewRetailer((current) => ({ ...current, name: "", phone: "", city: "", contactPerson: "" }))); }}><label>Retailer name<input required value={newRetailer.name} onChange={(event) => setNewRetailer((current) => ({ ...current, name: event.target.value }))} /></label><label>WhatsApp number<input required value={newRetailer.phone} onChange={(event) => setNewRetailer((current) => ({ ...current, phone: event.target.value }))} placeholder="919876543210" /></label><label>City<input value={newRetailer.city} onChange={(event) => setNewRetailer((current) => ({ ...current, city: event.target.value }))} /></label><label>Contact<input value={newRetailer.contactPerson} onChange={(event) => setNewRetailer((current) => ({ ...current, contactPerson: event.target.value }))} /></label><label>Salesperson<select value={newRetailer.salesmanId} onChange={(event) => setNewRetailer((current) => ({ ...current, salesmanId: event.target.value }))}>{salespeople.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label><label>Warehouse<select value={newRetailer.defaultWarehouseId} onChange={(event) => setNewRetailer((current) => ({ ...current, defaultWarehouseId: event.target.value }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>Payment<select value={newRetailer.paymentMode} onChange={(event) => setNewRetailer((current) => ({ ...current, paymentMode: event.target.value }))}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label><label className="checkbox-line"><input type="checkbox" checked={newRetailer.optedIn} onChange={(event) => setNewRetailer((current) => ({ ...current, optedIn: event.target.checked }))} />Consent recorded</label><button className="primary-button" disabled={busy}>Add & map retailer</button></form></Panel>} />
    <Panel title="Audience & collection privileges" eyebrow="Marketing, tags and retailer collection controls"><div className="wa-preference-grid">{mappedRetailers.map((item) => <article key={item.counterpartyId}><div><strong>{item.retailerName}</strong><small>{item.phoneE164} · {item.salesmanName}</small></div><label>Tags<input value={retailerTagDrafts[item.counterpartyId] ?? item.tags.join(", ")} onChange={(event) => setRetailerTagDrafts((current) => ({ ...current, [item.counterpartyId]: event.target.value }))} placeholder="route-a, premium, kirana" /></label><label className="checkbox-line"><input type="checkbox" checked={item.marketingOptIn} onChange={(event) => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: event.target.checked, tags: (retailerTagDrafts[item.counterpartyId] ?? item.tags.join(",")).split(",").map((tag) => tag.trim()).filter(Boolean) }, "Retailer messaging preference updated.")} />Marketing active</label><label className="checkbox-line"><input type="checkbox" checked={item.allowLaterCollection} disabled={busy} onChange={(event) => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: item.marketingOptIn, tags: item.tags, allowLaterCollection: event.target.checked }, "Collection privilege updated.")} />Allow collect later</label><label className="checkbox-line"><input type="checkbox" checked={item.allowPartialCollection} disabled={busy} onChange={(event) => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: item.marketingOptIn, tags: item.tags, allowPartialCollection: event.target.checked }, "Collection privilege updated.")} />Allow partial collection</label><label className="checkbox-line"><input type="checkbox" checked={item.allowChequeCollection} disabled={busy} onChange={(event) => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: item.marketingOptIn, tags: item.tags, allowChequeCollection: event.target.checked }, "Collection privilege updated.")} />Allow cheque collection</label><label>Collection tolerance<input type="number" min="0" step="0.01" defaultValue={item.collectionTolerance || 0} disabled={busy} onBlur={(event) => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: item.marketingOptIn, tags: item.tags, collectionTolerance: Number(event.target.value || 0) }, "Collection tolerance updated.")} /></label><button className="ghost-button" type="button" disabled={busy} onClick={() => void submit(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}/preferences`, { marketingOptIn: item.marketingOptIn, tags: (retailerTagDrafts[item.counterpartyId] ?? item.tags.join(",")).split(",").map((tag) => tag.trim()).filter(Boolean) }, "Retailer tags saved.")}>Save tags</button><button className="ghost-button danger-button" type="button" disabled={busy} onClick={() => { if (!window.confirm(`${item.retailerName} ka WhatsApp mapping remove karein? Pending cart/proforma clean hoga aur same number self-register kar sakega.`)) return; setBusy(true); onError(""); void api.delete<Dashboard>(`/whatsapp/retailers/${encodeURIComponent(item.counterpartyId)}`, { headers }).then(({ data }) => { setDashboard(data); onMessage("Retailer mapping removed. This number can now self-register."); }).catch((error) => onError(errorMessage(error))).finally(() => setBusy(false)); }}>Remove mapping</button></article>)}</div></Panel>
    </> : null}

    {isMarketingWorkspace && whatsappAdmin && activeSection === "Offers" ? <TwoCol left={<Panel title="Private price rule" eyebrow="Retailer-specific rate, CD and TOD"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/price-rules", { ...rule, specialRate: Number(rule.specialRate), cdPercent: Number(rule.cdPercent), todPercent: Number(rule.todPercent), minimumQuantity: Number(rule.minimumQuantity), validUntil: new Date(rule.validUntil).toISOString() }, "Private rate saved."); }}>
      <label>Search retailer<input type="search" value={ruleRetailerSearch} onChange={(event) => setRuleRetailerSearch(event.target.value)} placeholder="Name, number or salesperson" /></label>
      <label>Retailer<select value={rule.counterpartyId} onChange={(event) => setRule((current) => ({ ...current, counterpartyId: event.target.value }))}><option value="">Select mapped retailer ({filteredRuleRetailers.length})</option>{rule.counterpartyId && !filteredRuleRetailers.some((item) => item.counterpartyId === rule.counterpartyId) ? <option value={rule.counterpartyId}>{mappedRetailers.find((item) => item.counterpartyId === rule.counterpartyId)?.retailerName || "Selected retailer"}</option> : null}{filteredRuleRetailers.map((item) => <option key={item.counterpartyId} value={item.counterpartyId}>{item.retailerName} · {item.phoneE164}</option>)}</select></label>
      <label>Department<select value={ruleDepartment} onChange={(event) => setRuleDepartment(event.target.value)}><option value="">All departments</option>{departments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
      <label>Search product<input type="search" value={ruleProductSearch} onChange={(event) => setRuleProductSearch(event.target.value)} placeholder="Name, SKU, brand or category" /></label>
      <label className="wide-field">Product<select value={rule.productSku} onChange={(event) => setRule((current) => ({ ...current, productSku: event.target.value }))}><option value="">Select product ({filteredRuleProducts.length})</option>{rule.productSku && !filteredRuleProducts.some((product) => product.sku === rule.productSku) ? <option value={rule.productSku}>{snapshot.products.find((product) => product.sku === rule.productSku)?.name || rule.productSku} · selected</option> : null}{filteredRuleProducts.map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku} · {product.department || "General"}</option>)}</select></label>
      <label>Special rate<input type="number" step="any" value={rule.specialRate} onChange={(event) => setRule((current) => ({ ...current, specialRate: event.target.value }))} /></label>
      <label>Minimum quantity<input type="number" step="any" value={rule.minimumQuantity} onChange={(event) => setRule((current) => ({ ...current, minimumQuantity: event.target.value }))} /></label>
      <label>CD %<input type="number" step="any" value={rule.cdPercent} onChange={(event) => setRule((current) => ({ ...current, cdPercent: event.target.value }))} /></label>
      <label>TOD %<input type="number" step="any" value={rule.todPercent} onChange={(event) => setRule((current) => ({ ...current, todPercent: event.target.value }))} /></label>
      <label>Valid until<input type="datetime-local" value={rule.validUntil} onChange={(event) => setRule((current) => ({ ...current, validUntil: event.target.value }))} /></label>
      <button className="primary-button" disabled={busy}>Save private rate</button>
    </form></Panel>} right={<Panel title="Push special offer" eyebrow="Selected retailers only"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/offers", { counterpartyIds: offer.counterpartyIds, expiresAt: new Date(offer.expiresAt).toISOString(), lines: [{ productSku: offer.productSku, quantity: Number(offer.quantity), rate: Number(offer.rate), cdPercent: Number(offer.cdPercent), todPercent: Number(offer.todPercent), minimumQuantity: Number(offer.minimumQuantity), maxQuantity: Number(offer.maxQuantity) }] }, "Special offer queued for WhatsApp."); }}>
      <label className="wide-field">Search retailers<input type="search" value={offerRetailerSearch} onChange={(event) => setOfferRetailerSearch(event.target.value)} placeholder="Name, number or salesperson" /></label>
      <label className="checkbox-line"><input type="checkbox" checked={allVisibleRetailersSelected} disabled={!selectableOfferRetailerIds.length} onChange={(event) => setOffer((current) => { const visibleIds = new Set(selectableOfferRetailerIds); return { ...current, counterpartyIds: event.target.checked ? Array.from(new Set([...current.counterpartyIds, ...selectableOfferRetailerIds])) : current.counterpartyIds.filter((id) => !visibleIds.has(id)) }; })} />Select all matching retailers ({filteredOfferRetailers.length})</label>
      <fieldset className="wa-retailer-picker wide-field"><legend>Retailers</legend><div className="wa-retailer-checklist">{filteredOfferRetailers.length ? filteredOfferRetailers.map((item) => <label key={item.counterpartyId}><input type="checkbox" checked={offer.counterpartyIds.includes(item.counterpartyId)} onChange={(event) => setOffer((current) => ({ ...current, counterpartyIds: event.target.checked ? Array.from(new Set([...current.counterpartyIds, item.counterpartyId])) : current.counterpartyIds.filter((id) => id !== item.counterpartyId) }))} /><span><strong>{item.retailerName}</strong><small>{item.phoneE164}</small></span></label>) : <p>No active retailers match this search.</p>}</div><span className="field-hint">{offer.counterpartyIds.length} retailer{offer.counterpartyIds.length === 1 ? "" : "s"} selected</span></fieldset>
      <label>Department<select value={offerDepartment} onChange={(event) => setOfferDepartment(event.target.value)}><option value="">All departments</option>{offerDepartments.map((department) => <option key={department} value={department}>{department}</option>)}</select></label>
      <label>Search product<input type="search" value={offerProductSearch} onChange={(event) => setOfferProductSearch(event.target.value)} placeholder="Name, SKU, brand or category" /></label>
      <label className="wide-field">Product<select value={offer.productSku} onChange={(event) => setOffer((current) => ({ ...current, productSku: event.target.value }))}><option value="">Select product ({filteredOfferProducts.length})</option>{offer.productSku && !filteredOfferProducts.some((product) => product.sku === offer.productSku) ? <option value={offer.productSku}>{snapshot.products.find((product) => product.sku === offer.productSku)?.name || offer.productSku} · selected</option> : null}{filteredOfferProducts.map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku} · {product.department || "General"}</option>)}</select></label>
      <p className="field-hint wide-field">Only products currently available at Wholesale Warehouse are shown for offers.</p>
      <label>Quantity<input type="number" step="any" value={offer.quantity} onChange={(event) => setOffer((current) => ({ ...current, quantity: event.target.value }))} /></label>
      <label>Rate<input type="number" step="any" value={offer.rate} onChange={(event) => setOffer((current) => ({ ...current, rate: event.target.value }))} /></label>
      <label>CD %<input type="number" step="any" value={offer.cdPercent} onChange={(event) => setOffer((current) => ({ ...current, cdPercent: event.target.value }))} /></label>
      <label>TOD %<input type="number" step="any" value={offer.todPercent} onChange={(event) => setOffer((current) => ({ ...current, todPercent: event.target.value }))} /></label>
      <label>Minimum quantity<input type="number" step="any" value={offer.minimumQuantity} onChange={(event) => setOffer((current) => ({ ...current, minimumQuantity: event.target.value }))} /></label>
      <label>Maximum quantity<input type="number" min="0" step="any" value={offer.maxQuantity} onChange={(event) => setOffer((current) => ({ ...current, maxQuantity: event.target.value }))} /><span className="field-hint">0 = unlimited</span></label>
      <label>Expires<input type="datetime-local" value={offer.expiresAt} onChange={(event) => setOffer((current) => ({ ...current, expiresAt: event.target.value }))} /></label>
      <button className="primary-button" disabled={busy}>Send offer</button>
    </form></Panel>} /> : null}

    {isMarketingWorkspace && whatsappAdmin && activeSection === "Broadcast" ? <TwoCol left={<Panel title="Broadcast announcement" eyebrow="Festival, feature and service updates"><form className="form-grid" onSubmit={sendBroadcast}>
      <p className="wa-auto-welcome-note wide-field"><strong>First welcome is automatic.</strong><span>Retailer ki first mapping ya registration approval ke baad Hinglish welcome aur ordering guide automatically bheja jayega.</span></p>
      <label className="wide-field">Campaign title<input value={broadcastTitle} onChange={(event) => setBroadcastTitle(event.target.value)} placeholder="Diwali offer, route update, new feature" /></label>
      <label className="wide-field">Approved Meta template name (outside 24-hour window)<input value={broadcastTemplate} onChange={(event) => setBroadcastTemplate(event.target.value.trim().toLowerCase())} placeholder="Leave blank for an active-chat text message" /></label>
      {broadcastTemplate ? <label className="wide-field">Template parameters, one per line<textarea rows={4} value={broadcastTemplateParameters} onChange={(event) => setBroadcastTemplateParameters(event.target.value)} /><small className="field-hint">Parameter order must match the approved template. Use {"{retailer}"} for outlet name.</small></label> : null}
      <div className="wa-broadcast-presets wide-field"><button className="ghost-button" type="button" onClick={() => setBroadcastMessage(festivalBroadcast)}>Festival message</button><button className="ghost-button" type="button" onClick={() => setBroadcastMessage(featureBroadcast)}>New feature</button><button className="ghost-button" type="button" onClick={() => setBroadcastMessage("")}>Clear</button></div>
      <label className="wide-field">Announcement<textarea rows={13} value={broadcastMessage} onChange={(event) => setBroadcastMessage(event.target.value)} maxLength={3500} placeholder="Festival, new feature, delivery update or another announcement likhein" /></label>
      <p className="field-hint wide-field">Use <strong>{"{retailer}"}</strong> where the retail outlet name should appear. {broadcastMessage.length}/3500 characters.</p>
      {dashboard?.trainingBroadcast && <div className="wide-field"><strong>WhatsApp chat training</strong><p className="helper-text">Naye aur purane retailers ke liye public audio guide.</p><pre className="import-report">{dashboard.trainingBroadcast.message}</pre><a href={dashboard.trainingBroadcast.url} target="_blank" rel="noreferrer">Preview training →</a><p className="field-hint">Approved training template use kar rahe hain to URL wale parameter mein {"{guide_link}"} daalein.</p></div>}
      <div className="wa-broadcast-actions wide-field"><button className="primary-button" disabled={busy || !broadcastRetailerIds.length || (!broadcastMessage.trim() && !broadcastTemplate)}>Review & send announcement</button><button className="ghost-button" type="button" disabled={busy || !broadcastRetailerIds.length || !dashboard?.trainingBroadcast} onClick={() => void sendBroadcast(undefined, true)}>Send training link</button></div>
      <p className="helper-text wide-field">WhatsApp allows a normal text broadcast only inside the retailer's active 24-hour chat window. Outside it, Meta requires an approved message template.</p>
      {broadcastReport ? <pre className="import-report wide-field">{broadcastReport}</pre> : null}
    </form></Panel>} right={<Panel title="Choose recipients" eyebrow="Active retailers with consent"><div className="form-grid">
      <label className="wide-field">Search retailers<input type="search" value={broadcastSearch} onChange={(event) => setBroadcastSearch(event.target.value)} placeholder="Name, number or salesperson" /></label>
      <label>Salesperson<select value={broadcastSalesman} onChange={(event) => setBroadcastSalesman(event.target.value)}><option value="">All salespeople</option>{salespeople.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label>Warehouse<select value={broadcastWarehouse} onChange={(event) => setBroadcastWarehouse(event.target.value)}><option value="">All warehouses</option>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label className="wide-field">Retailer tag<select value={broadcastTag} onChange={(event) => setBroadcastTag(event.target.value)}><option value="">All tags</option>{retailerTags.map((tag) => <option key={tag}>{tag}</option>)}</select></label>
      <label className="checkbox-line"><input type="checkbox" checked={allVisibleBroadcastRetailersSelected} disabled={!visibleBroadcastRetailerIds.length} onChange={(event) => setBroadcastRetailerIds((current) => { const visibleIds = new Set(visibleBroadcastRetailerIds); return event.target.checked ? Array.from(new Set([...current, ...visibleBroadcastRetailerIds])) : current.filter((id) => !visibleIds.has(id)); })} />Select all matching retailers ({broadcastRetailers.length})</label>
      <fieldset className="wa-retailer-picker wide-field"><legend>Retailers</legend><div className="wa-retailer-checklist is-tall">{broadcastRetailers.length ? broadcastRetailers.map((item) => <label key={item.counterpartyId}><input type="checkbox" checked={broadcastRetailerIds.includes(item.counterpartyId)} onChange={(event) => setBroadcastRetailerIds((current) => event.target.checked ? Array.from(new Set([...current, item.counterpartyId])) : current.filter((id) => id !== item.counterpartyId))} /><span><strong>{item.retailerName}</strong><small>{item.phoneE164} · {item.salesmanName}</small></span></label>) : <p>No opted-in retailers match this search.</p>}</div><span className="field-hint">{broadcastRetailerIds.length} retailer{broadcastRetailerIds.length === 1 ? "" : "s"} selected</span></fieldset>
    </div></Panel>} /> : null}

    {whatsappAdmin && activeSection === "Catalogue" ? <Panel title="Product catalogue" eyebrow="Retailer-visible range">
      <p className="helper-text">{dashboard?.catalogImageStats.selected || 0} selected · {dashboard?.catalogImageStats.eligible || 0} priced · {dashboard?.catalogImageStats.withImage || 0} with optimized images. Private retailer rates stay hidden.</p>
      <div className="wa-catalog-preview">
        <div className="wa-catalog-preview-head">
          <div><strong>Catalogue preview</strong><span>{visibleCatalogProducts.length} products</span></div>
          <input type="search" value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="Search name, SKU or brand" aria-label="Search WhatsApp catalogue" />
        </div>
        <div className="wa-catalog-grid">
          {visibleCatalogProducts.map((product) => {
            const discount = product.mrp > 0 && product.sellingRate > 0 ? Math.max(0, (product.mrp - product.sellingRate) / product.mrp * 100) : 0;
            return <article className="wa-catalog-card" key={product.sku}>
              <img src={product.imageUrl} alt="" loading="lazy" />
              <div className="wa-catalog-card-copy">
                <span>{product.brand || "Aapoorti"}{product.size ? ` · ${product.size}` : ""}</span>
                <strong>{product.name}</strong>
                <small>{product.sku}</small>
                <div className="wa-catalog-price">
                  {product.sellingRate > 0 ? <b>₹{product.sellingRate.toFixed(2)}</b> : <b>Rate pending</b>}
                  {product.mrp > 0 ? <span>MRP ₹{product.mrp.toFixed(2)}{discount > 0 ? ` · ${discount.toFixed(1)}% off` : ""}</span> : <span>MRP pending</span>}
                </div>
                <em>Minimum order {product.minimumOrderQuantity}</em>
              </div>
            </article>;
          })}
        </div>
      </div>
      <details className="wa-catalog-tools">
        <summary>Meta feed and image tools</summary>
        <div className="wa-catalog-tools-body">
          <div className="settings-line"><span className="helper-text">Activate production inbound replies once after connecting a new WhatsApp Business Account. The catalogue is already linked in WhatsApp Manager.</span><button className="ghost-button" type="button" disabled={busy} onClick={() => void submit("/whatsapp/setup/subscribe", {}, "Production WhatsApp replies are now activated.")}>Activate production replies</button></div>
          <div className="settings-line"><input readOnly value={dashboard?.catalogFeedUrl || "Loading…"} /><button className="ghost-button" type="button" onClick={() => void navigator.clipboard.writeText(dashboard?.catalogFeedUrl || "")}>Copy feed URL</button></div>
          <form className="form-grid" onSubmit={importCatalogImages}>
            <label className="wide-field">Verified product image URLs<textarea rows={5} value={catalogImageMappings} onChange={(event) => setCatalogImageMappings(event.target.value)} placeholder={"SKU,https://licensed-source.example/product.jpg\nSKU-2,https://licensed-source.example/product-2.png"} /></label>
            <p className="helper-text wide-field">Maximum 6 images per batch. Each image is compressed and stored in R2 automatically.</p>
            <button className="primary-button" disabled={busy}>Import images</button>
          </form>
          {catalogImageReport ? <p className="helper-text" style={{ whiteSpace: "pre-line" }}>{catalogImageReport}</p> : null}
        </div>
      </details>
    </Panel> : null}

    {activeSection === "Orders" ? <section className="stacked-sections">
      <Panel title="Retailer wishlist" eyebrow="Products requested but unavailable"><div className="wa-ticket-list">
        {pendingWishlists.length ? pendingWishlists.map((item) => { const wishlistId = String(item.id || ""); return <article key={wishlistId} className="wa-ticket-card"><div><strong>{String(item.retailer_name || "")}</strong><span>{String(item.requested_product || "")} · Qty {String(item.requested_quantity || "")} · {String(item.salesman_name || "")}</span><small>{formatDateTimeIst(String(item.created_at || ""))}</small></div><label>Matched product<select value={wishlistProducts[wishlistId] || ""} onChange={(event) => setWishlistProducts((current) => ({ ...current, [wishlistId]: event.target.value }))}><option value="">Select available product</option>{snapshot.products.filter((product) => product.whatsappCatalogEnabled).map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>)}</select></label><button className="primary-button" disabled={busy || !wishlistProducts[wishlistId]} onClick={() => void submit(`/whatsapp/wishlists/${encodeURIComponent(wishlistId)}/available`, { productSku: wishlistProducts[wishlistId], note: "Stock is now available" }, "Retailer ko back-in-stock alert bhej diya.")}>Alert retailer</button></article>; }) : <p className="helper-text">No pending wishlist requests.</p>}
      </div></Panel>
      <div className="section-heading"><div><span className="eyebrow">Retailer-confirmed ordering</span><h2>Active proforma invoices</h2></div><span className="wa-queue-count">{activeDrafts.length} open</span></div>
      {activeDrafts.length ? activeDrafts.map((draft) => <DraftReviewCard key={draft.id} draft={draft} snapshot={snapshot} busy={busy} onReview={async (item, body) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/review`, body, "Final summary sent to retailer.")} onDeny={async (item, reason) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/deny`, { reason }, "Order denied and retailer informed.")} onInvoice={whatsappAdmin ? async (item) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/invoice`, {}, "Invoice summary sent.") : undefined} />) : <div className="wa-empty-state"><span><SidebarVectorIcon view="SalesOrders" /></span><strong>No active proforma</strong><p>Retailer will receive a proforma invoice before any sales order is created.</p></div>}
      {completedDrafts.length ? <details className="wa-order-history"><summary>Completed orders ({completedDrafts.length})</summary><div className="stacked-sections">{completedDrafts.map((draft) => <DraftReviewCard key={draft.id} draft={draft} snapshot={snapshot} busy={busy} onReview={async () => undefined} onDeny={async () => undefined} onInvoice={whatsappAdmin ? async (item) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/invoice`, {}, "Invoice summary sent.") : undefined} onStatus={async (item, status, note) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/status`, { status, note }, "Order status retailer ko bhej diya.")} />)}</div></details> : null}
    </section> : null}

    {activeSection === "Chat" ? <section className="wa-live-chat-shell">
      <aside className="wa-chat-list">
        <div className="wa-chat-list-head"><div><span className="eyebrow">WhatsApp inbox</span><h2>Retailer chats</h2></div><span className="wa-queue-count">{liveChatUnread} unread</span></div>
        <input className="wa-chat-search" type="search" value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Search retailer or number" />
        <div className="wa-chat-thread-list">
          {filteredChats.map((ticket) => <button key={String(ticket.id)} type="button" className={String(ticket.id) === liveChat.selectedTicketId ? "active" : ""} onClick={() => { setChatReply(""); setChatOrderOpen(false); setChatOrderLines([]); setActiveChatDraftId(""); void refreshLiveChat(String(ticket.id), true); }}>
            <span className="wa-chat-avatar">{String(ticket.retailer_name || "R").trim().charAt(0).toUpperCase()}</span>
            <span className="wa-chat-thread-copy"><strong>{String(ticket.retailer_name || "Retailer")}</strong><small>{String(ticket.last_message_preview || "Live chat requested")}</small><em>{String(ticket.salesman_name || "Unassigned")}</em></span>
            <span className="wa-chat-thread-meta"><time>{ticket.last_message_at ? formatDateTimeIst(String(ticket.last_message_at)) : ""}</time>{Number(ticket.unread_staff_count || 0) > 0 ? <b>{Number(ticket.unread_staff_count) > 99 ? "99+" : Number(ticket.unread_staff_count)}</b> : null}</span>
          </button>)}
          {!filteredChats.length ? <div className="wa-chat-list-empty">No retailer chat found.</div> : null}
        </div>
      </aside>
      <article className="wa-chat-conversation">
        {selectedChat ? <>
          <header className="wa-chat-conversation-head">
            <div><span className="wa-chat-avatar">{String(selectedChat.retailer_name || "R").trim().charAt(0).toUpperCase()}</span><span><strong>{String(selectedChat.retailer_name || "Retailer")}</strong><small>{String(selectedChat.phone_e164 || "")} · {String(selectedChat.salesman_name || "")}</small></span></div>
            <div className="wa-chat-actions">
              <button className="primary-button" type="button" aria-expanded={chatOrderOpen} disabled={busy || selectedChat.status !== "Open"} onClick={() => setChatOrderOpen((open) => !open)}>{chatOrderOpen ? "Close order form" : "+ Create order"}</button>
              {whatsappAdmin ? <select aria-label="Transfer chat" value={String(selectedChat.salesman_id || "")} disabled={busy} onChange={(event) => void updateChat({ salesmanId: Number(event.target.value) }, "Chat transferred.")}>{salespeople.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select> : null}
              <button className="ghost-button" type="button" disabled={busy} onClick={() => void updateChat({ status: selectedChat.status === "Open" ? "Resolved" : "Open" }, selectedChat.status === "Open" ? "Chat closed." : "Chat reopened.")}>{selectedChat.status === "Open" ? "Close chat" : "Reopen"}</button>
            </div>
          </header>
          <div className={`wa-chat-workspace ${chatOrderOpen ? "order-open" : ""}`}>
            <div className="wa-chat-dialog">
              <div className="wa-chat-messages" ref={chatMessagesRef} aria-live="polite">
                {liveChat.messages.map((message) => <div key={message.id} className={`wa-chat-bubble ${message.direction === "Outbound" ? "outbound" : "inbound"}`}><p>{message.body}</p><span>{formatDateTimeIst(message.createdAt)} · {message.direction === "Outbound" ? message.status : "WhatsApp"}</span>{message.errorMessage ? <em>{message.errorMessage}</em> : null}</div>)}
                {!liveChat.messages.length ? <div className="wa-chat-list-empty">Conversation is ready. Send the first reply below.</div> : null}
              </div>
              {selectedChat.status === "Open" ? <form className="wa-chat-composer" onSubmit={sendChatReply}><textarea rows={2} value={chatReply} onChange={(event) => setChatReply(event.target.value)} placeholder="Type a reply — retailer receives it on WhatsApp" /><button className="primary-button" disabled={busy || !chatReply.trim()}>{busy ? "Sending…" : "Send"}</button></form> : <div className="wa-chat-closed">This chat is closed. Reopen it to reply.</div>}
            </div>
            {chatOrderOpen ? <form className="wa-chat-order-form" onSubmit={createOrderFromChat}>
              <div className="wa-chat-order-title"><div><span className="eyebrow">{activeChatDraftId ? "Continue current order" : "Create from conversation"}</span><strong>{activeChatDraftId ? activeChatDraftId : `New order for ${String(selectedChat.retailer_name || "Retailer")}`}</strong></div><div><span>Stock {selectedChatOrderStock}</span>{activeChatDraftId ? <button className="ghost-button" type="button" disabled={busy} onClick={startNewChatOrder}>Start new</button> : null}</div></div>
              <label className="wide-field">Search product<input type="search" value={chatOrderSearch} onChange={(event) => setChatOrderSearch(event.target.value)} placeholder="Name, SKU or brand" /></label>
              <label className="wide-field">Product<select value={chatOrder.productSku} onChange={(event) => { const productSku = event.target.value; const product = snapshot.products.find((item) => item.sku === productSku); const minimum = Math.max(1, Number(product?.minimumOrderQuantity || 1)); const rate = Number(product?.offerPrice || product?.rsp || product?.mrp || 0); setChatOrder((current) => ({ ...current, productSku, quantity: String(minimum), rate: rate > 0 ? String(rate) : "" })); }}><option value="">Select product</option>{filteredChatOrderProducts.map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>)}</select></label>
              <label>Quantity<input type="number" min={Math.max(1, Number(selectedChatOrderProduct?.minimumOrderQuantity || 1))} step="any" value={chatOrder.quantity} onChange={(event) => setChatOrder((current) => ({ ...current, quantity: event.target.value }))} /></label>
              <label>Rate<input type="number" min="0.01" step="0.01" value={chatOrder.rate} onChange={(event) => setChatOrder((current) => ({ ...current, rate: event.target.value }))} /></label>
              <label>CD %<input type="number" min="0" max="99" step="0.01" value={chatOrder.cdPercent} onChange={(event) => setChatOrder((current) => ({ ...current, cdPercent: event.target.value }))} /></label>
              <label>TOD %<input type="number" min="0" max="99" step="0.01" value={chatOrder.todPercent} onChange={(event) => setChatOrder((current) => ({ ...current, todPercent: event.target.value }))} /></label>
              <div className={`wa-chat-stock-note wide-field ${selectedChatOrderProduct && Number(chatOrder.quantity) > selectedChatOrderStock ? "warning" : ""}`}>
                {selectedChatOrderProduct ? <>MOQ {Math.max(1, Number(selectedChatOrderProduct.minimumOrderQuantity || 1))} · Available at {chatOrder.warehouseId}: {selectedChatOrderStock}{Number(chatOrder.quantity) > selectedChatOrderStock ? " · Low stock: order will go for approval" : ""}</> : "Select a product, enter quantity/rate, then add it to the order."}
              </div>
              <button className="secondary-button wide-field" type="button" disabled={busy || !chatOrder.productSku || !chatOrder.rate} onClick={addChatOrderLine}>{chatOrderLines.some((line) => line.productSku === chatOrder.productSku) ? "Update item" : "+ Add item"}</button>
              {chatOrderLines.length ? <div className="wa-chat-order-cart wide-field">
                <div className="wa-chat-order-cart-head"><strong>Order items</strong><span>{chatOrderLines.length} item{chatOrderLines.length === 1 ? "" : "s"}</span></div>
                {chatOrderLines.map((line) => {
                  const product = snapshot.products.find((item) => item.sku === line.productSku);
                  const stock = snapshot.stockSummary.find((item) => item.warehouseId === chatOrder.warehouseId && item.productSku === line.productSku)?.availableQuantity || 0;
                  return <div className="wa-chat-order-cart-line" key={line.productSku}>
                    <div><strong>{product?.name || line.productSku}</strong><small>{line.quantity} × ₹{line.rate.toFixed(2)} · CD {line.cdPercent}% · TOD {line.todPercent}%{line.quantity > stock ? ` · Stock ${stock}` : ""}</small></div>
                    <button type="button" aria-label={`Remove ${product?.name || line.productSku}`} onClick={() => setChatOrderLines((current) => current.filter((item) => item.productSku !== line.productSku))}>Remove</button>
                  </div>;
                })}
                <div className="wa-chat-order-total"><span>Subtotal before GST</span><strong>₹{chatOrderSubtotal.toFixed(2)}</strong></div>
              </div> : null}
              <label>Warehouse<select required value={chatOrder.warehouseId} onChange={(event) => setChatOrder((current) => ({ ...current, warehouseId: event.target.value }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
              <label>Payment<select value={chatOrder.paymentMode} onChange={(event) => setChatOrder((current) => ({ ...current, paymentMode: event.target.value as PaymentMode }))}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
              {chatOrder.paymentMode === "Cash" ? <label>Cash timing<select value={chatOrder.cashTiming} onChange={(event) => setChatOrder((current) => ({ ...current, cashTiming: event.target.value }))}><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
              <label>Delivery<select value={chatOrder.deliveryMode} onChange={(event) => setChatOrder((current) => ({ ...current, deliveryMode: event.target.value as "Delivery" | "Self Collection" }))}><option>Delivery</option><option>Self Collection</option></select></label>
              <label className="wide-field">Note<input value={chatOrder.note} onChange={(event) => setChatOrder((current) => ({ ...current, note: event.target.value }))} placeholder="Optional rate/stock note" /></label>
              <p className="field-hint wide-field">Available items will be sent for retailer confirmation. Low-stock items will remain in the salesperson approval queue.</p>
              <button className="primary-button wide-field" disabled={busy || !chatOrderLines.length}>{busy ? "Saving…" : chatOrderLines.some((line) => line.quantity > (snapshot.stockSummary.find((stock) => stock.warehouseId === chatOrder.warehouseId && stock.productSku === line.productSku)?.availableQuantity || 0)) ? (activeChatDraftId ? "Update order for stock review" : "Create order for stock review") : (activeChatDraftId ? "Update & resend proforma" : "Send complete order for confirmation")}</button>
            </form> : null}
          </div>
        </> : <div className="wa-chat-placeholder"><span><SidebarVectorIcon view="WhatsApp" /></span><strong>Select a retailer chat</strong><p>Messages from WhatsApp will appear here automatically.</p></div>}
      </article>
    </section> : null}

    {activeSection === "Service" ? <section className="stacked-sections">
      <div className="section-heading"><div><span className="eyebrow">Retailer support</span><h2>Returns, damage and voice orders</h2></div><span className="wa-queue-count">{openServiceTickets.length} open</span></div>
      {openTickets.length ? <div className="wa-ticket-list">{openTickets.map((ticket) => { const ticketId = String(ticket.id || ""); return <article className="panel wa-service-ticket" key={ticketId}><div className="section-heading"><div><span className="eyebrow">{String(ticket.kind || "Support")} · {formatDateTimeIst(String(ticket.updated_at || ticket.created_at || ""))}</span><h3>{String(ticket.retailer_name || "Retailer")}</h3></div><span className="status-pill pending">{String(ticket.priority || "Normal")}</span></div><p className="helper-text">{ticketId} · {String(ticket.phone_e164 || "")} · {String(ticket.salesman_name || "")}{ticket.linked_order_id ? ` · ${String(ticket.linked_order_id)}` : ""}</p><pre className="wa-ticket-thread">{String(ticket.details || "No details yet")}</pre>{ticket.media_id ? <p className="field-hint">WhatsApp proof attached ({String(ticket.media_type || "media")})</p> : null}<form className="wa-ticket-reply" onSubmit={(event) => { event.preventDefault(); void submit(`/whatsapp/service-tickets/${encodeURIComponent(ticketId)}/reply`, { message: ticketReplies[ticketId], close: false }, "Reply sent to retailer."); }}><input value={ticketReplies[ticketId] || ""} onChange={(event) => setTicketReplies((current) => ({ ...current, [ticketId]: event.target.value }))} placeholder="Reply from the app; retailer receives it on WhatsApp" /><button className="primary-button" disabled={busy || !ticketReplies[ticketId]?.trim()}>Send reply</button><button className="ghost-button" type="button" disabled={busy || !ticketReplies[ticketId]?.trim()} onClick={() => void submit(`/whatsapp/service-tickets/${encodeURIComponent(ticketId)}/reply`, { message: ticketReplies[ticketId], close: true }, "Reply sent and ticket resolved.")}>Send & resolve</button></form></article>; })}</div> : <div className="wa-empty-state"><span><SidebarVectorIcon view="WhatsApp" /></span><strong>Support inbox is clear</strong><p>Live chat, return, damage and voice-order requests will appear here.</p></div>}
    </section> : null}

    {isMarketingWorkspace && whatsappAdmin && activeSection === "Insights" ? <section className="stacked-sections">
      <div className="wa-insight-grid">{[
        ["Conversations", dashboard?.analytics.conversations || 0], ["Inbound", dashboard?.analytics.inbound || 0], ["Outbound", dashboard?.analytics.outbound || 0], ["Delivered", dashboard?.analytics.delivered || 0], ["Read", dashboard?.analytics.read || 0], ["Failed", dashboard?.analytics.failed || 0], ["Completed orders", dashboard?.analytics.completedOrders || 0]
      ].map(([label, value]) => <article key={String(label)}><span>{label}</span><strong>{value}</strong><small>Last 30 days</small></article>)}</div>
      <TwoCol left={<Panel title="Retailer entry point" eyebrow="QR and Click-to-WhatsApp"><p className="helper-text">Use this link behind shop QR codes, visiting cards and retailer onboarding campaigns.</p><div className="settings-line"><input readOnly value={dashboard?.retailerEntryLink || ""} /><button className="ghost-button" type="button" onClick={() => void navigator.clipboard.writeText(dashboard?.retailerEntryLink || "")}>Copy link</button></div>{dashboard?.retailerEntryLink ? <a className="primary-button wa-link-button" href={dashboard.retailerEntryLink} target="_blank" rel="noreferrer">Test in WhatsApp</a> : null}</Panel>} right={<Panel title="Broadcast history" eyebrow="Campaign performance"><DataTable headers={["Time", "Campaign", "Type", "Audience", "Sent", "Failed"]} rows={(dashboard?.campaigns || []).map((item) => [formatDateTimeIst(String(item.created_at || "")), String(item.title || "Broadcast"), String(item.message_type || "text"), String(item.audience_count || 0), String(item.sent_count || 0), String(item.failed_count || 0)])} /></Panel>} />
      <Panel title="Order update audit" eyebrow="Retailer notifications"><DataTable headers={["Time", "Order", "Status", "Note", "By"]} rows={(dashboard?.orderEvents || []).map((item) => [formatDateTimeIst(String(item.created_at || "")), String(item.sales_cart_id || item.draft_id || ""), String(item.status_label || ""), String(item.note || ""), String(item.created_by || "")])} /></Panel>
    </section> : null}

    {whatsappAdmin && activeSection === "Home" ? <Panel title="Recent activity" eyebrow="Latest retailer conversations"><DataTable headers={["Time", "Direction", "Phone", "Status", "Message"]} rows={(dashboard?.messages || []).slice(0, 8).map((item) => [formatDateTimeIst(String(item.created_at || "")), String(item.direction || ""), String(item.phone_e164 || ""), String(item.status || ""), messageAuditText(item)])} /></Panel> : null}
  </div>;
}
