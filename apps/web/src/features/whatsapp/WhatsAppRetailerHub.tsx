import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import type { AppSnapshot, AppUser, PaymentMode } from "@aapoorti-b2b/domain";
import { api, formatDateTimeIst } from "../../app/shared";
import { DataTable, Panel, TwoCol } from "../../components/ui";

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
  payment_mode: PaymentMode;
  cash_timing?: string;
  delivery_mode: "Delivery" | "Self Collection";
  note: string;
  sales_cart_id?: string;
  created_at: string;
  lines: DraftLine[];
};
type Dashboard = {
  configuration: { connected: boolean; mode: string; phoneNumberIdPresent: boolean; catalogIdPresent: boolean; verifyTokenPresent: boolean; appSecretPresent: boolean };
  retailers: RetailerProfile[];
  priceRules: Array<Record<string, unknown>>;
  offers: Array<Record<string, unknown>>;
  drafts: WhatsAppDraft[];
  messages: Array<Record<string, unknown>>;
  catalogFeedUrl: string;
};

function errorMessage(error: unknown) {
  return axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : "WhatsApp action failed.";
}

function localDateTime(hoursAhead: number) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function pilotWarehouseId(snapshot: AppSnapshot) {
  return snapshot.warehouses.find((warehouse) => warehouse.id === "C21")?.id
    || snapshot.warehouses[0]?.id
    || "";
}

function DraftReviewCard({ draft, snapshot, busy, onReview, onInvoice }: {
  draft: WhatsAppDraft;
  snapshot: AppSnapshot;
  busy: boolean;
  onReview: (draft: WhatsAppDraft, body: Record<string, unknown>) => Promise<void>;
  onInvoice: (draft: WhatsAppDraft) => Promise<void>;
}) {
  const [warehouseId, setWarehouseId] = useState(() => draft.warehouse_id || pilotWarehouseId(snapshot));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(draft.payment_mode || "NEFT");
  const [cashTiming, setCashTiming] = useState(draft.cash_timing || "Later");
  const [deliveryMode, setDeliveryMode] = useState<"Delivery" | "Self Collection">(draft.delivery_mode || "Delivery");
  const [note, setNote] = useState(draft.note || "");
  const [lines, setLines] = useState(() => draft.lines.map((line) => ({
    id: line.id,
    quantity: String(line.approved_quantity),
    rate: String(line.rate),
    cdPercent: String(line.cd_percent),
    todPercent: String(line.tod_percent)
  })));
  const canReview = ["Needs Review", "Change Requested", "Staff Approved"].includes(draft.status);

  return <article className="panel">
    <div className="section-heading">
      <div><span className="eyebrow">{draft.source} · {formatDateTimeIst(draft.created_at)}</span><h3>{draft.retailer_name}</h3></div>
      <span className={`status-pill ${draft.status === "Completed" ? "success" : "pending"}`}>{draft.status}</span>
    </div>
    <p className="helper-text">{draft.id} · {draft.phone_e164} · Assigned to {draft.salesman_name}{draft.sales_cart_id ? ` · SO ${draft.sales_cart_id}` : ""}</p>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Requested</th><th>Approved</th><th>Rate</th><th>CD %</th><th>TOD %</th></tr></thead><tbody>
      {draft.lines.map((line, index) => <tr key={line.id}>
        <td><strong>{line.product_name}</strong><small>{line.product_sku}</small></td>
        <td>{line.requested_quantity}</td>
        <td><input type="number" min="0.01" step="any" disabled={!canReview} value={lines[index]?.quantity || ""} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></td>
        <td><input type="number" min="0.01" step="any" disabled={!canReview} value={lines[index]?.rate || ""} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, rate: event.target.value } : item))} /></td>
        <td><input type="number" min="0" max="99" step="any" disabled={!canReview} value={lines[index]?.cdPercent || ""} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, cdPercent: event.target.value } : item))} /></td>
        <td><input type="number" min="0" max="99" step="any" disabled={!canReview} value={lines[index]?.todPercent || ""} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, todPercent: event.target.value } : item))} /></td>
      </tr>)}
    </tbody></table></div>
    {canReview ? <form className="form-grid" onSubmit={(event) => {
      event.preventDefault();
      void onReview(draft, {
        warehouseId, paymentMode, cashTiming: paymentMode === "Cash" ? cashTiming : undefined,
        deliveryMode, note,
        lines: lines.map((line) => ({ id: line.id, quantity: Number(line.quantity), rate: Number(line.rate), cdPercent: Number(line.cdPercent || 0), todPercent: Number(line.todPercent || 0) }))
      });
    }}>
      <label>Warehouse<select value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Payment<select value={paymentMode} onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      {paymentMode === "Cash" ? <label>Cash timing<select value={cashTiming} onChange={(event) => setCashTiming(event.target.value)}><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
      <label>Delivery<select value={deliveryMode} onChange={(event) => setDeliveryMode(event.target.value as "Delivery" | "Self Collection")}><option>Delivery</option><option>Self Collection</option></select></label>
      <label className="wide-field">Internal note<input value={note} onChange={(event) => setNote(event.target.value)} /></label>
      <button className="primary-button" type="submit" disabled={busy}>{busy ? "Sending…" : "Approve & send retailer confirmation"}</button>
    </form> : null}
    {draft.status === "Completed" ? <button className="ghost-button" type="button" disabled={busy} onClick={() => void onInvoice(draft)}>Send invoice summary</button> : null}
  </article>;
}

export function WhatsAppRetailerHub({ snapshot, currentUser, sessionToken, onMessage, onError }: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  sessionToken: string;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const shops = useMemo(() => snapshot.counterparties.filter((item) => item.type === "Shop"), [snapshot.counterparties]);
  const salespeople = useMemo(() => snapshot.users.filter((item) => item.active && (item.roles || [item.role]).includes("Sales")), [snapshot.users]);
  const isAdmin = (currentUser.roles || [currentUser.role]).includes("Admin");
  const [mapping, setMapping] = useState(() => ({ counterpartyId: "", phone: "", salesmanId: String(isAdmin ? salespeople[0]?.id || "" : currentUser.id), defaultWarehouseId: pilotWarehouseId(snapshot), billingType: "B2B", paymentMode: "NEFT", cashTiming: "Later", deliveryMode: "Delivery", optedIn: false, active: true }));
  const [rule, setRule] = useState({ counterpartyId: "", productSku: "", specialRate: "", cdPercent: "0", todPercent: "0", minimumQuantity: "1", validUntil: localDateTime(24), active: true });
  const [offer, setOffer] = useState({ counterpartyIds: [] as string[], productSku: "", quantity: "1", rate: "", cdPercent: "0", todPercent: "0", minimumQuantity: "1", expiresAt: localDateTime(8) });

  const headers = { authorization: `Bearer ${sessionToken}` };
  async function refresh() {
    try {
      const { data } = await api.get<Dashboard>("/whatsapp/dashboard", { headers });
      setDashboard(data);
    } catch (error) {
      onError(errorMessage(error));
    }
  }
  useEffect(() => { void refresh(); }, [sessionToken]);

  async function submit(path: string, body: unknown, success: string) {
    setBusy(true); onError("");
    try {
      const { data } = await api.post<Dashboard | { dashboard?: Dashboard }>(path, body, { headers });
      const next = "dashboard" in data && data.dashboard ? data.dashboard : data as Dashboard;
      if (next?.configuration) setDashboard(next);
      else await refresh();
      onMessage(success);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const mappedRetailers = dashboard?.retailers || [];
  return <div className="stacked-sections">
    <section className="metric-grid">
      <Panel title={dashboard?.configuration.mode || "Loading"} eyebrow="WhatsApp connection"><p>{dashboard?.configuration.connected ? "Meta Cloud API credentials detected." : "Safe simulation mode: messages are logged but not sent."}</p></Panel>
      <Panel title={String(mappedRetailers.length)} eyebrow="Mapped retailers"><p>{mappedRetailers.filter((item) => item.optedInAt && item.active).length} active with recorded opt-in.</p></Panel>
      <Panel title={String((dashboard?.drafts || []).filter((item) => ["Needs Review", "Change Requested"].includes(item.status)).length)} eyebrow="Needs review"><p>Orders waiting for a salesperson.</p></Panel>
    </section>

    <TwoCol left={<Panel title="Map retailer" eyebrow="WhatsApp identity and owner"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/retailers", { ...mapping, salesmanId: Number(mapping.salesmanId) }, "Retailer WhatsApp mapping saved."); }}>
      <label>Retailer<select value={mapping.counterpartyId} onChange={(event) => { const shop = shops.find((item) => item.id === event.target.value); setMapping((current) => ({ ...current, counterpartyId: event.target.value, phone: shop?.mobileNumber || current.phone, billingType: shop?.gstNumber ? "B2B" : "B2C" })); }}><option value="">Select retailer</option>{shops.map((shop) => <option key={shop.id} value={shop.id}>{shop.name} · {shop.city}</option>)}</select></label>
      <label>WhatsApp number<input value={mapping.phone} onChange={(event) => setMapping((current) => ({ ...current, phone: event.target.value }))} placeholder="919876543210" /></label>
      <label>Assigned salesperson<select disabled={!isAdmin} value={mapping.salesmanId} onChange={(event) => setMapping((current) => ({ ...current, salesmanId: event.target.value }))}>{salespeople.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}</select></label>
      <label>Warehouse<select value={mapping.defaultWarehouseId} onChange={(event) => setMapping((current) => ({ ...current, defaultWarehouseId: event.target.value }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
      <label>Billing<select value={mapping.billingType} onChange={(event) => setMapping((current) => ({ ...current, billingType: event.target.value }))}><option>B2B</option><option>B2C</option></select></label>
      <label>Payment<select value={mapping.paymentMode} onChange={(event) => setMapping((current) => ({ ...current, paymentMode: event.target.value }))}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code}>{item.code}</option>)}</select></label>
      <label>Delivery<select value={mapping.deliveryMode} onChange={(event) => setMapping((current) => ({ ...current, deliveryMode: event.target.value }))}><option>Delivery</option><option>Self Collection</option></select></label>
      <label className="checkbox-line"><input type="checkbox" checked={mapping.optedIn} onChange={(event) => setMapping((current) => ({ ...current, optedIn: event.target.checked }))} />Retailer consent recorded</label>
      <button className="primary-button" disabled={busy}>Save mapping</button>
    </form></Panel>} right={<Panel title="Retailer directory" eyebrow="Mapped WhatsApp accounts"><DataTable headers={["Retailer", "WhatsApp", "Salesperson", "Warehouse", "Consent"]} rows={mappedRetailers.map((item) => [item.retailerName, item.phoneE164, item.salesmanName, item.defaultWarehouseId, item.optedInAt ? "Yes" : "No"])} /></Panel>} />

    <TwoCol left={<Panel title="Private price rule" eyebrow="Retailer-specific rate, CD and TOD"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/price-rules", { ...rule, specialRate: Number(rule.specialRate), cdPercent: Number(rule.cdPercent), todPercent: Number(rule.todPercent), minimumQuantity: Number(rule.minimumQuantity), validUntil: new Date(rule.validUntil).toISOString() }, "Private rate saved."); }}>
      <label>Retailer<select value={rule.counterpartyId} onChange={(event) => setRule((current) => ({ ...current, counterpartyId: event.target.value }))}><option value="">Select mapped retailer</option>{mappedRetailers.map((item) => <option key={item.counterpartyId} value={item.counterpartyId}>{item.retailerName}</option>)}</select></label>
      <label>Product<select value={rule.productSku} onChange={(event) => setRule((current) => ({ ...current, productSku: event.target.value }))}><option value="">Select product</option>{snapshot.products.map((product) => <option key={product.sku} value={product.sku}>{product.name} · {product.sku}</option>)}</select></label>
      <label>Special rate<input type="number" step="any" value={rule.specialRate} onChange={(event) => setRule((current) => ({ ...current, specialRate: event.target.value }))} /></label>
      <label>Minimum quantity<input type="number" step="any" value={rule.minimumQuantity} onChange={(event) => setRule((current) => ({ ...current, minimumQuantity: event.target.value }))} /></label>
      <label>CD %<input type="number" step="any" value={rule.cdPercent} onChange={(event) => setRule((current) => ({ ...current, cdPercent: event.target.value }))} /></label>
      <label>TOD %<input type="number" step="any" value={rule.todPercent} onChange={(event) => setRule((current) => ({ ...current, todPercent: event.target.value }))} /></label>
      <label>Valid until<input type="datetime-local" value={rule.validUntil} onChange={(event) => setRule((current) => ({ ...current, validUntil: event.target.value }))} /></label>
      <button className="primary-button" disabled={busy}>Save private rate</button>
    </form></Panel>} right={<Panel title="Push special offer" eyebrow="Selected retailers only"><form className="form-grid" onSubmit={(event) => { event.preventDefault(); void submit("/whatsapp/offers", { counterpartyIds: offer.counterpartyIds, expiresAt: new Date(offer.expiresAt).toISOString(), lines: [{ productSku: offer.productSku, quantity: Number(offer.quantity), rate: Number(offer.rate), cdPercent: Number(offer.cdPercent), todPercent: Number(offer.todPercent), minimumQuantity: Number(offer.minimumQuantity) }] }, "Special offer queued for WhatsApp."); }}>
      <label className="wide-field">Retailers<select multiple value={offer.counterpartyIds} onChange={(event) => setOffer((current) => ({ ...current, counterpartyIds: Array.from(event.target.selectedOptions).map((option) => option.value) }))}>{mappedRetailers.filter((item) => item.active).map((item) => <option key={item.counterpartyId} value={item.counterpartyId}>{item.retailerName}</option>)}</select></label>
      <label>Product<select value={offer.productSku} onChange={(event) => setOffer((current) => ({ ...current, productSku: event.target.value }))}><option value="">Select product</option>{snapshot.products.map((product) => <option key={product.sku} value={product.sku}>{product.name}</option>)}</select></label>
      <label>Quantity<input type="number" step="any" value={offer.quantity} onChange={(event) => setOffer((current) => ({ ...current, quantity: event.target.value }))} /></label>
      <label>Rate<input type="number" step="any" value={offer.rate} onChange={(event) => setOffer((current) => ({ ...current, rate: event.target.value }))} /></label>
      <label>CD %<input type="number" step="any" value={offer.cdPercent} onChange={(event) => setOffer((current) => ({ ...current, cdPercent: event.target.value }))} /></label>
      <label>TOD %<input type="number" step="any" value={offer.todPercent} onChange={(event) => setOffer((current) => ({ ...current, todPercent: event.target.value }))} /></label>
      <label>Minimum quantity<input type="number" step="any" value={offer.minimumQuantity} onChange={(event) => setOffer((current) => ({ ...current, minimumQuantity: event.target.value }))} /></label>
      <label>Expires<input type="datetime-local" value={offer.expiresAt} onChange={(event) => setOffer((current) => ({ ...current, expiresAt: event.target.value }))} /></label>
      <button className="primary-button" disabled={busy}>Send offer</button>
    </form></Panel>} />

    <Panel title="Catalogue feed" eyebrow="Meta Commerce Manager scheduled data source"><p className="helper-text">Use this URL as the scheduled catalogue feed. It contains product SKUs, names and base rates; private rates remain server-side.</p><div className="settings-line"><input readOnly value={dashboard?.catalogFeedUrl || "Loading…"} /><button className="ghost-button" type="button" onClick={() => void navigator.clipboard.writeText(dashboard?.catalogFeedUrl || "")}>Copy URL</button></div></Panel>

    <section className="stacked-sections"><div className="section-heading"><div><span className="eyebrow">Retailer orders</span><h2>WhatsApp review queue</h2></div><button className="ghost-button" type="button" onClick={() => void refresh()}>Refresh</button></div>
      {(dashboard?.drafts || []).length ? dashboard!.drafts.map((draft) => <DraftReviewCard key={draft.id} draft={draft} snapshot={snapshot} busy={busy} onReview={async (item, body) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/review`, body, "Final summary sent to retailer.")} onInvoice={async (item) => submit(`/whatsapp/drafts/${encodeURIComponent(item.id)}/invoice`, {}, "Invoice summary sent.")} />) : <Panel title="No WhatsApp orders yet" eyebrow="Queue clear"><p>Catalogue carts and retailer messages will appear here automatically.</p></Panel>}
    </section>

    <Panel title="Recent automation" eyebrow="Message audit trail"><DataTable headers={["Time", "Direction", "Phone", "Type", "Status", "Related"]} rows={(dashboard?.messages || []).slice(0, 50).map((item) => [formatDateTimeIst(String(item.created_at || "")), String(item.direction || ""), String(item.phone_e164 || ""), String(item.message_type || ""), String(item.status || ""), [item.related_entity_type, item.related_entity_id].filter(Boolean).join(" ")])} /></Panel>
  </div>;
}
