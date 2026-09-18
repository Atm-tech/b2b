import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import type { AppSnapshot } from "@aapoorti-b2b/domain";
import { api, formatDateTimeIst } from "../../app/shared";
import { Panel } from "../../components/ui";

type Line = { sku: string; name: string; requested: number; available: number; pending: number; purchaseQuantity: number; cancelled: number };
type ShortageCase = { id: string; draft_id: string; retailer_name: string; salesman_name: string; purchaser_name?: string; retailer_choice: string; purchase_status: string; purchase_order_id?: string; status: string; warehouse_id: string; created_at: string; next_action_at?: string; expected_at?: string; decision_note: string; balance_draft_id?: string; available_sales_cart_id?: string; balance_sales_cart_id?: string; failed_notifications: number; lines: Line[]; events: Array<{ id: number; action: string; actor: string; note: string; created_at: string }> };
type Register = { cases: ShortageCase[]; canPurchase: boolean; canManage: boolean };
const empty: Register = { cases: [], canPurchase: false, canManage: false };
function message(error: unknown) { return axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : error instanceof Error ? error.message : "The action could not be completed."; }

function ShortageCard({ item, register, snapshot, busy, onAction }: { item: ShortageCase; register: Register; snapshot: AppSnapshot; busy: boolean; onAction: (id: string, action: string, body: Record<string, unknown>) => Promise<void> }) {
  const [supplierId, setSupplierId] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState("Split");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [taxes, setTaxes] = useState<Record<string, string>>({});
  const overdue = Boolean(item.next_action_at && Date.parse(item.next_action_at) < Date.now());
  const pendingLines = item.lines.filter(line => line.purchaseQuantity > 0);
  const suppliers = snapshot.counterparties.filter(party => party.type === "Supplier");
  return <article className="panel shortage-card">
    <div className="section-heading"><div><span className="eyebrow">{item.warehouse_id}  /  {formatDateTimeIst(item.created_at)}</span><h3>{item.retailer_name}</h3></div><span className="status-pill pending">{item.status}</span></div>
    <p><strong>Sales owner:</strong> {item.salesman_name || "Assignment required"}  /  <strong>Purchaser:</strong> {item.purchaser_name || "Approval queue"}</p>
    <p className="helper-text">Original order: {item.draft_id}<br />Draft PO reference: {item.id}{item.purchase_order_id ? `  /  Approved PO: ${item.purchase_order_id}` : ""}</p>
    <p><strong>Retailer choice:</strong> {item.retailer_choice}  /  <strong>Purchase:</strong> {item.purchase_status}</p>
    <p className={overdue ? "error-text" : "helper-text"}>{item.next_action_at ? `${overdue ? "Action due: " : "Next action: "}${formatDateTimeIst(item.next_action_at)}` : "Follow-up date required"}{item.expected_at ? `  /  Expected stock: ${formatDateTimeIst(item.expected_at)}` : ""}</p>
    <div className="table-wrap"><table><thead><tr><th>Product</th><th>Requested</th><th>Available portion</th><th>Short quantity</th><th>Cancelled</th></tr></thead><tbody>{item.lines.map(line => <tr key={line.sku}><td><strong>{line.name}</strong><small>{line.sku}</small></td><td>{line.requested}</td><td>{line.available}</td><td>{line.pending}</td><td>{line.cancelled}</td></tr>)}</tbody></table></div>
    {item.available_sales_cart_id || item.balance_draft_id ? <p className="helper-text">Available SO: {item.available_sales_cart_id || "Awaiting confirmation"}  /  Balance: {item.balance_sales_cart_id || item.balance_draft_id || "Pending replenishment"}</p> : null}
    {item.decision_note ? <p>{item.decision_note}</p> : null}
    {item.failed_notifications > 0 ? <p role="alert">{item.failed_notifications} notification(s) failed. The case remains open for follow-up.</p> : null}
    {register.canPurchase && item.purchase_status === "Draft" ? <details><summary>Review draft purchase order</summary><form className="form-grid" onSubmit={event => { event.preventDefault(); void onAction(item.id, "purchase", { decision: "Approve", supplierId, expectedAt: new Date(expectedAt).toISOString(), note, lines: pendingLines.map(line => ({ productSku: line.sku, rate: Number(rates[line.sku]), gstRate: Number(taxes[line.sku] || "0") })) }); }}>
      <label>Supplier<select required value={supplierId} onChange={e => setSupplierId(e.target.value)}><option value="">Select supplier</option>{suppliers.map(party => <option key={party.id} value={party.id}>{party.name}</option>)}</select></label>
      <label>Expected stock arrival<input required type="datetime-local" value={expectedAt} onChange={e => setExpectedAt(e.target.value)} /></label>
      {pendingLines.map(line => <div className="form-grid wide-field" key={line.sku}><label>{line.name}  /  {line.pending} units  /  Purchase rate<input required type="number" min="0.01" step="0.01" value={rates[line.sku] || ""} onChange={e => setRates(current => ({ ...current, [line.sku]: e.target.value }))} /></label><label>GST rate<select value={taxes[line.sku] || "0"} onChange={e => setTaxes(current => ({ ...current, [line.sku]: e.target.value }))}>{[0,5,12,18,28,40].map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></label></div>)}
      <label className="wide-field">Purchase decision note<input value={note} onChange={e => setNote(e.target.value)} placeholder="Required when cancelling the draft PO" /></label>
      <button className="primary-button" disabled={busy}>Approve and create PO</button><button className="ghost-button" type="button" disabled={busy || !note.trim()} onClick={() => void onAction(item.id,"purchase",{decision:"Cancel",note,lines:[]})}>Cancel draft PO</button>
      <p className="helper-text wide-field">The PO uses supplier delivery and NEFT payment. Approval does not confirm stock availability; retailer confirmation follows accepted warehouse receipt.</p>
    </form></details> : null}
    {register.canManage ? <details><summary>Sales follow-up and retailer decision</summary><div className="form-grid">
      <label className="wide-field">Retailer agreement / follow-up note<input value={note} onChange={e => setNote(e.target.value)} /></label>
      {!item.balance_draft_id && item.retailer_choice !== "Cancel Balance" ? <><label>Agreed retailer choice<select value={choice} onChange={e => setChoice(e.target.value)}><option value="Split">Available now; balance later</option><option value="Wait">Wait for full quantity</option><option value="Cancel Balance">Available now; cancel balance</option></select></label><button className="primary-button" disabled={busy || !note.trim()} onClick={() => void onAction(item.id,"choice",{choice,note})}>Record retailer decision</button></> : null}
      <label>Next follow-up<input type="datetime-local" value={expectedAt} onChange={e => setExpectedAt(e.target.value)} /></label><button className="ghost-button" disabled={busy || !note.trim() || !expectedAt} onClick={() => void onAction(item.id,"followup",{date:new Date(expectedAt).toISOString(),note})}>Schedule follow-up</button>
      {item.purchase_status === "Cancelled" && item.retailer_choice !== "Cancel Balance" ? <button className="ghost-button" disabled={busy || !note.trim()} onClick={() => void onAction(item.id,"resubmit",{note})}>Request purchase approval again</button> : null}
      {item.failed_notifications > 0 ? <button className="ghost-button" disabled={busy} onClick={() => void onAction(item.id,"retry",{})}>Retry failed notifications</button> : null}
    </div></details> : null}
    <details><summary>Case history ({item.events.length})</summary><ul>{item.events.map(event => <li key={event.id}><strong>{event.action}</strong>  /  {event.actor}  /  {formatDateTimeIst(event.created_at)}{event.note ? ` - ${event.note}` : ""}</li>)}</ul></details>
  </article>;
}

export function ShortageRegister({ snapshot, sessionToken }: { snapshot: AppSnapshot; sessionToken: string }) {
  const [register, setRegister] = useState<Register>(empty);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const sequence = useRef(0);
  const busyRef = useRef(false);
  const refresh = useCallback(async () => {
    if (busyRef.current) return;
    const request = ++sequence.current;
    try { const { data } = await api.get<Register>("/whatsapp/shortages", { headers: { authorization: `Bearer ${sessionToken}` } }); if (request === sequence.current) { setRegister(data); setError(""); } }
    catch (e) { if (request === sequence.current) setError(message(e)); }
    finally { if (request === sequence.current) setLoading(false); }
  }, [sessionToken]);
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 30_000); return () => { window.clearInterval(timer); sequence.current++; }; }, [refresh]);
  async function act(id: string, action: string, body: Record<string, unknown>) {
    busyRef.current = true; setBusy(true); ++sequence.current; setError("");
    try { const { data } = await api.post<Register>(`/whatsapp/shortages/${encodeURIComponent(id)}/${action}`, body, { headers: { authorization: `Bearer ${sessionToken}` } }); setRegister(data); }
    catch (e) { setError(message(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const overdue = register.cases.filter(item => item.next_action_at && Date.parse(item.next_action_at) < Date.now()).length;
  const visible = register.cases.filter(item => `${item.retailer_name} ${item.salesman_name} ${item.status} ${item.id}`.toLowerCase().includes(filter.toLowerCase()));
  return <div className="shortage-register"><Panel title="Open shortage register" eyebrow="Sales ownership  /  Purchase approval  /  Admin oversight">
    <div className="section-heading"><p><strong>{register.cases.length} open cases</strong>  /  {overdue} due for action  /  {register.cases.filter(item => item.purchase_status === "Draft").length} draft POs awaiting approval</p><button className="ghost-button" disabled={busy} onClick={() => void refresh()}>Refresh register</button></div>
    <p className="helper-text">All unresolved cases remain here regardless of order date. Available orders, pending quantities and purchase decisions stay linked until fulfilment and payment are complete.</p>
    {error ? <p role="alert">{error}</p> : null}
    {loading ? <p role="status">Loading shortage cases...</p> : null}
    <div className="form-grid"><label className="wide-field">Find an open case<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Retailer, owner, status or reference" /></label></div>
    {!loading && !register.cases.length && !error ? <p>No open shortage cases.</p> : null}
    <div className="stacked-sections">{visible.map(item => <ShortageCard key={item.id} item={item} register={register} snapshot={snapshot} busy={busy} onAction={act} />)}</div>
  </Panel></div>;
}

