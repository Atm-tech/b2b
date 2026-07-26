import type {
AppSnapshot,
AppUser,
CashTiming,
Counterparty,
DeliveryTask,
PaymentMode
} from "@aapoorti-b2b/domain";
import { useEffect,useState } from "react";
import { CollapsiblePanel,DataTable,Panel,TwoCol } from "../../components/ui";
import { downloadExcelWorkbook } from "../../utils/excel";

import {
API_BASE,
collectionVisibleToUser,
displayOrderNote,
downloadPurchaseInvoicePdf,
downloadSalesInvoicePdf,
findPurchaseOrderByPublicId,
findSalesOrderByPublicId,
formatChequeAmountWords,
formatCurrencyInr,
formatDateIst,
formatDateTimeIst,
groupPurchaseOrders,
groupSalesOrders,
isInboundDeliveryUser,
latestPurchasePayment,
latestSalesPayment,
openChequePrintWindow,
orderPublicId,
productNameBySku,
purchaseCashDeliveryTask,
purchaseLedgerByOrder,
purchaseOrderPublicTotal,
purchasePaymentStatus,
purchaseWarehouseStatus,
purchaseWorkflowStatus,
readStoredJson,
safePdfFileName,
salesFulfillmentStatus,
salesOrderPublicTotal,
salesPaymentStatus,
sharePurchaseInvoicePdf,
shareSalesInvoicePdf,
statusPillClass,
workspaceStorageKey,
writeStoredJson
} from "../../app/shared";

export function PurchaserPaymentsView({
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
  const mySupplierIds = new Set(myOrders.map((item) => item.supplierId).filter(Boolean));
  const payments = snapshot.payments
    .filter((item) => item.side === "Purchase" && item.paymentKind !== "Advance" && myOrderIds.has(item.linkedOrderId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const purchaseAdvances = snapshot.payments
    .filter((item) => item.side === "Purchase" && item.paymentKind === "Advance" && item.counterpartyId && mySupplierIds.has(item.counterpartyId))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const [uploadingId, setUploadingId] = useState("");
  const [advanceSearch, setAdvanceSearch] = useState("");
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

  const filteredPurchaseAdvances = purchaseAdvances.filter((payment) => {
    const haystack = [
      payment.id,
      payment.counterpartyName,
      payment.referenceNumber,
      payment.utrNumber,
      payment.voucherNumber,
      payment.amount.toFixed(2),
      payment.mode,
      payment.verificationStatus
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(advanceSearch.trim().toLowerCase());
  });

  return (
    <section className="dashboard-grid">
      <Panel title="Supplier Advances" eyebrow="Advance paid by accounts">
        <div className="form-grid">
          <label className="wide-field">Search advance<input value={advanceSearch} onChange={(e) => setAdvanceSearch(e.target.value)} placeholder="Supplier, amount, reference, UTR" /></label>
        </div>
        <div className="stack-list payment-update-list top-gap">
          {filteredPurchaseAdvances.length === 0 ? <div className="empty-card">No supplier advances visible yet.</div> : filteredPurchaseAdvances.map((payment) => {
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : "";
            const whatsappText = encodeURIComponent(
              `Aapoorti supplier advance\nAdvance: ${payment.id}\nSupplier: ${payment.counterpartyName || "Supplier"}\nAmount: ${payment.amount}\nMode: ${payment.mode}${payment.referenceNumber ? `\nReference: ${payment.referenceNumber}` : ""}${payment.utrNumber ? `\nUTR: ${payment.utrNumber}` : ""}${proofUrl ? `\nProof: ${proofUrl}` : ""}`
            );
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.counterpartyName || "Supplier"}</strong>
                  <p>{payment.id} · {payment.mode} · {formatDateIst(payment.createdAt)}</p>
                </div>
                <span className={`status-pill ${statusPillClass(payment.verificationStatus)}`}>{payment.verificationStatus}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{payment.amount}</strong></div>
                <div><span className="small-label">Reference</span><strong>{payment.referenceNumber || "-"}</strong></div>
                <div><span className="small-label">UTR</span><strong>{payment.utrNumber || "-"}</strong></div>
                <div><span className="small-label">Proof</span><strong>{payment.proofName || "Not uploaded"}</strong></div>
                <div><span className="small-label">By</span><strong>{payment.createdBy}</strong></div>
                <div><span className="small-label">Note</span><strong>{payment.verificationNote || "Advance paid by accounts"}</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
              </div>
            </article>;
          })}
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
                <label>Amount<input type="number" step="any" value={createDraft.amount} onChange={(e) => setCreateDraftValue(group.id, "amount", e.target.value)} /></label>
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
                  <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, group)}>WhatsApp Share</button>
                  <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, group)}>Download PDF</button>
                </div>
              </form> : <div className="payment-card-actions top-gap">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, group)}>WhatsApp Share</button>
                <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, group)}>Download PDF</button>
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
            const invoiceGroup = groupPurchaseOrders(snapshot.purchaseOrders).find((group) => group.id === payment.linkedOrderId);
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
                  <div><span className="small-label">Created</span><strong>{formatDateIst(payment.createdAt)}</strong></div>
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
                  <label>Amount<input type="number" step="any" value={draft.amount} onChange={(e) => setDraftValue(payment.id, "amount", e.target.value)} /></label>
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
                    {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, invoiceGroup)}>Invoice Share</button> : null}
                    {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, invoiceGroup)}>Download PDF</button> : null}
                  </div>
                </form> : <div className="payment-card-actions top-gap">
                  {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                  {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, invoiceGroup)}>Invoice Share</button> : null}
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, invoiceGroup)}>Download PDF</button> : null}
                </div>}
              </article>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}

export function SalesPaymentsView({
  snapshot,
  currentUser,
  onUploadProof,
  onCreatePayment,
  onUpdatePayment,
  scope
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
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
    operationDate?: string;
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
  scope: "mine" | "all";
}) {
  const today = new Date().toISOString().slice(0, 10);
  const allVisibleOrders = scope === "all"
    ? snapshot.salesOrders
    : snapshot.salesOrders.filter((item) => item.salesmanId === currentUser.id || item.salesmanName === currentUser.fullName);
  const visibleOrders = groupSalesOrders(allVisibleOrders)
    .filter((group) => collectionVisibleToUser(snapshot, group, currentUser) || group.lines.some((line) => line.salesmanId === currentUser.id || line.salesmanName === currentUser.fullName))
    .flatMap((group) => group.lines);
  const visibleOrderIds = new Set(visibleOrders.flatMap((item) => [item.id, orderPublicId(item)]));
  const underPriceOrders = visibleOrders.filter((item) => item.status === "Draft" || item.note.toLowerCase().includes("rate below last purchase price"));
  const undeliveredOrders = visibleOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed");
  const pendingCollections = snapshot.ledgerEntries.filter((item) => item.side === "Sales" && visibleOrderIds.has(item.linkedOrderId) && item.pendingAmount > 0);
  const payments = snapshot.payments.filter((item) => item.side === "Sales" && visibleOrderIds.has(item.linkedOrderId)).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const collectionGroups = groupSalesOrders(visibleOrders)
    .map((group) => {
      const first = group.lines[0];
      const totalAmount = salesOrderPublicTotal(snapshot.salesOrders, group.id);
      const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      return {
        id: group.id,
        lines: group.lines,
        shopName: first?.shopName || "Customer",
        searchText: `${group.id} ${first?.shopName || ""} ${group.lines.map((line) => productNameBySku(snapshot.products, line.productSku)).join(" ")}`.toLowerCase(),
        totalAmount,
        paidAmount: ledger?.paidAmount ?? 0,
        pendingAmount: ledger?.pendingAmount ?? totalAmount,
        paymentMode: first?.paymentMode || "Cash",
        cashTiming: first?.cashTiming || "",
        deliveryMode: first?.deliveryMode || "Delivery",
        latestPayment: latestSalesPayment(snapshot, group.id)
      };
    })
    .filter((group) => group.pendingAmount > 0 && collectionVisibleToUser(snapshot, group, currentUser));
  const [drafts, setDrafts] = useState<Record<string, { amount: string; referenceNumber: string; voucherNumber: string; utrNumber: string; proofName: string; verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved"; verificationNote: string }>>({});
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, { amount: string; mode: PaymentMode; cashTiming: string; referenceNumber: string; voucherNumber: string; utrNumber: string; proofName: string; verificationNote: string; operationDate: string }>>({});
  const [searchText, setSearchText] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState("");

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

  function getCollectionDraft(orderId: string) {
    const order = collectionGroups.find((item) => item.id === orderId);
    return collectionDrafts[orderId] || {
      amount: String(order?.pendingAmount || 0),
      mode: (order?.paymentMode || "Cash") as PaymentMode,
      cashTiming: order?.cashTiming || "",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      proofName: "",
      verificationNote: scope === "all" ? "Collection recorded by collection agent" : "Collection recorded by sales",
      operationDate: today
    };
  }

  function setCollectionDraftValue(orderId: string, field: string, value: string) {
    setCollectionDrafts((current) => ({ ...current, [orderId]: { ...getCollectionDraft(orderId), [field]: value } }));
  }

  const filteredGroups = collectionGroups.filter((group) => group.searchText.includes(searchText.trim().toLowerCase()));

  return (
    <section className="dashboard-grid">
      <Panel title={scope === "all" ? "Customer Collections" : "My Customer Collections"} eyebrow="Search and settle unpaid SOs">
        <div className="form-grid">
          <label className="wide-field">Search SO / customer<input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="SO number or customer name" /></label>
        </div>
        <div className="stack-list payment-update-list top-gap">
          {filteredGroups.length === 0 ? <div className="empty-card">No unsettled sales orders found.</div> : filteredGroups.map((group) => {
            const draft = getCollectionDraft(group.id);
            const proofUrl = draft.proofName ? `${API_BASE}/uploads/payment-proofs/${draft.proofName}` : group.latestPayment?.proofName ? `${API_BASE}/uploads/payment-proofs/${group.latestPayment.proofName}` : "";
            const expanded = expandedOrderId === group.id;
            return <article className="list-card payment-update-card" key={group.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{group.id}</strong>
                  <p>{group.shopName} · {group.lines.length} line(s) · {group.deliveryMode}</p>
                </div>
                <span className="status-pill status-pending">{group.pendingAmount.toFixed(2)} pending</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Total</span><strong>{group.totalAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Paid</span><strong>{group.paidAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Pending</span><strong>{group.pendingAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Order payment</span><strong>{group.paymentMode}{group.cashTiming ? ` / ${group.cashTiming}` : ""}</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                <button className="ghost-button" type="button" onClick={() => setExpandedOrderId((current) => current === group.id ? "" : group.id)}>{expanded ? "Hide collection" : "Collect / update"}</button>
              </div>
              {expanded ? <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                await onCreatePayment({
                  side: "Sales",
                  linkedOrderId: group.id,
                  amount: Number(draft.amount || 0),
                  mode: draft.mode,
                  cashTiming: draft.mode === "Cash" ? draft.cashTiming as CashTiming : undefined,
                  referenceNumber: draft.referenceNumber,
                  voucherNumber: draft.voucherNumber || undefined,
                  utrNumber: draft.utrNumber || undefined,
                  proofName: draft.proofName || undefined,
                  verificationStatus: "Submitted",
                  verificationNote: draft.verificationNote,
                  operationDate: draft.operationDate || undefined
                });
              }}>
                <label>Amount<input type="number" step="any" min="0" max={group.pendingAmount} value={draft.amount} onChange={(e) => setCollectionDraftValue(group.id, "amount", e.target.value)} /></label>
                <label>Mode<select value={draft.mode} onChange={(e) => setCollectionDraftValue(group.id, "mode", e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option>
                </select></label>
                <label>Date<input type="date" value={draft.operationDate} onChange={(e) => setCollectionDraftValue(group.id, "operationDate", e.target.value)} /></label>
                {draft.mode === "Cash" ? <label>Cash timing<select value={draft.cashTiming} onChange={(e) => setCollectionDraftValue(group.id, "cashTiming", e.target.value)}><option value="">Select</option><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
                <label>Reference<input value={draft.referenceNumber} onChange={(e) => setCollectionDraftValue(group.id, "referenceNumber", e.target.value)} placeholder={draft.mode === "Cash" ? "Receipt / slip no." : "Reference no."} /></label>
                <label>Voucher<input value={draft.voucherNumber} onChange={(e) => setCollectionDraftValue(group.id, "voucherNumber", e.target.value)} /></label>
                <label>UTR<input value={draft.utrNumber} onChange={(e) => setCollectionDraftValue(group.id, "utrNumber", e.target.value)} placeholder="For bank receipt / transfer" /></label>
                <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setCollectionDraftValue(group.id, "proofName", String((uploaded as { fileName: string }).fileName)); }} /></label>
                <label>Proof name<input value={draft.proofName} onChange={(e) => setCollectionDraftValue(group.id, "proofName", e.target.value)} /></label>
                <label className="wide-field">Note<input value={draft.verificationNote} onChange={(e) => setCollectionDraftValue(group.id, "verificationNote", e.target.value)} placeholder="Cash collected or bank-received note" /></label>
                <div className="payment-card-actions wide-field">
                  <button className="ghost-button" type="button" onClick={() => setCollectionDraftValue(group.id, "amount", group.pendingAmount.toFixed(2))}>Set full</button>
                  <button className="primary-button" type="submit">Submit collection</button>
                  {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                </div>
                {Number(draft.amount || 0) > 0 && Number(draft.amount || 0) < group.pendingAmount ? <p className="message success wide-field">This will settle the order partially. Remaining amount stays pending.</p> : null}
              </form> : null}
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Pending Orders" eyebrow="Undelivered and flagged">
        <div className="stack-list payment-update-list">
          {[...undeliveredOrders, ...underPriceOrders.filter((order) => !undeliveredOrders.some((item) => item.id === order.id))].slice(0, 12).map((order) => {
            const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order));
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{orderPublicId(order)}</strong>
                  <p>{order.shopName} · {productNameBySku(snapshot.products, order.productSku)} · {order.deliveryMode}</p>
                </div>
                <span className={`status-pill ${order.status === "Draft" ? "status-rejected" : "status-pending"}`}>{order.status === "Draft" ? "Draft" : order.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{order.totalAmount}</strong></div>
                <div><span className="small-label">Payment pending</span><strong>{ledger?.pendingAmount ?? order.totalAmount}</strong></div>
                <div><span className="small-label">Payment status</span><strong>{(ledger?.pendingAmount || 0) > 0 ? "Pending" : "Settled"}</strong></div>
                <div><span className="small-label">Note</span><strong>{displayOrderNote(order.note) || "No note"}</strong></div>
              </div>
            </article>;
          })}
          {undeliveredOrders.length === 0 && underPriceOrders.length === 0 ? <div className="empty-card">No pending sales orders.</div> : null}
        </div>
      </Panel>
      <Panel title="Payment Proof Updates" eyebrow="Show to customer or share">
        <div className="stack-list payment-update-list">
          {payments.length === 0 ? <div className="empty-card">No sales payments found yet.</div> : payments.map((payment) => {
            const draft = getDraft(payment);
            const proofUrl = draft.proofName ? `${API_BASE}/uploads/payment-proofs/${draft.proofName}` : "";
            const order = findSalesOrderByPublicId(snapshot.salesOrders, payment.linkedOrderId);
            const invoiceGroup = groupSalesOrders(snapshot.salesOrders).find((group) => group.id === payment.linkedOrderId);
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
                <label>Amount<input type="number" step="any" value={draft.amount} onChange={(e) => setDraftValue(payment.id, "amount", e.target.value)} /></label>
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
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => void shareSalesInvoicePdf(snapshot, invoiceGroup)}>Invoice Share</button> : null}
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => downloadSalesInvoicePdf(snapshot, invoiceGroup)}>Download PDF</button> : null}
                </div>
              </form>
            </article>;
          })}
        </div>
      </Panel>
    </section>
  );
}

export function AccountsPaymentsView({
  snapshot,
  onUploadProof,
  onCreatePayment,
  onCreatePurchaseAdvance,
  onCreateDeliveryTask,
  onVerify,
  onOpenSupplierUpdate
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
    operationDate?: string;
  }) => Promise<boolean | void>;
  onCreatePurchaseAdvance: (body: {
    supplierId: string;
    amount: number;
    mode: PaymentMode;
    cashTiming?: string;
    referenceNumber: string;
    voucherNumber?: string;
    utrNumber?: string;
    proofName?: string;
    verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved";
    verificationNote: string;
    operationDate?: string;
  }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; mode: DeliveryTask["mode"]; transportType?: DeliveryTask["transportType"]; vehicleNumber?: string; freightAmount?: number; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onVerify: (paymentId: string, verificationStatus: "Verified" | "Rejected" | "Resolved", verificationNote: string) => Promise<boolean | void>;
  onOpenSupplierUpdate: (supplierId: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const suppliers = snapshot.counterparties.filter((item) => item.type === "Supplier").sort((left, right) => left.name.localeCompare(right.name));
  const purchaseAdvancePayments = snapshot.payments
    .filter((item) => item.side === "Purchase" && item.paymentKind === "Advance")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const pending = snapshot.payments.filter((item) => item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved");
  const completed = snapshot.payments.filter((item) => item.verificationStatus === "Verified" || item.verificationStatus === "Resolved");
  const dayCash = snapshot.payments.filter((item) => item.mode === "Cash" && item.createdAt.slice(0, 10) === today).reduce((sum, item) => sum + item.amount, 0);
  const deliveryUsers = snapshot.users.filter(isInboundDeliveryUser);
  const purchaseOrderRows = groupPurchaseOrders(snapshot.purchaseOrders)
    .map((group) => {
      const first = group.lines[0];
      const totalAmount = purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id);
      const ledger = purchaseLedgerByOrder(snapshot, group.id);
      return {
        id: group.id,
        side: "Purchase" as const,
        party: group.lines[0]?.supplierName || "Supplier",
        pendingAmount: ledger?.pendingAmount ?? totalAmount,
        paidAmount: ledger?.paidAmount ?? 0,
        totalAmount,
        workflowStatus: purchaseWorkflowStatus(snapshot, group.id),
        paymentMode: first?.paymentMode || "Cash",
        cashTiming: first?.cashTiming || "",
        latestPayment: latestPurchasePayment(snapshot, group.id)
      };
    })
    .sort((left, right) => Number(right.pendingAmount > 0) - Number(left.pendingAmount > 0) || right.id.localeCompare(left.id));
  const salesOrderRows = groupSalesOrders(snapshot.salesOrders)
    .map((group) => {
      const totalAmount = salesOrderPublicTotal(snapshot.salesOrders, group.id);
      const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      return {
        id: group.id,
        side: "Sales" as const,
        party: group.lines[0]?.shopName || "Customer",
        pendingAmount: ledger?.pendingAmount ?? totalAmount,
        paidAmount: ledger?.paidAmount ?? 0,
        totalAmount,
        workflowStatus: `${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`,
        paymentMode: group.lines[0]?.paymentMode || "Cash",
        cashTiming: group.lines[0]?.cashTiming || "",
        latestPayment: latestSalesPayment(snapshot, group.id)
      };
    })
    .sort((left, right) => Number(right.pendingAmount > 0) - Number(left.pendingAmount > 0) || right.id.localeCompare(left.id));
  const accountOrderOptions = [...purchaseOrderRows, ...salesOrderRows].filter((item) => item.pendingAmount > 0);
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
    verificationNote: "Payment recorded by accounts",
    operationDate: today
  });
  const paymentSheetHeaders = ["PYMT_PROD_TYPE_CODE", "PYMT_MODE", "DEBIT_ACC_NO", "BNF_NAME", "BENE_ACC_NO", "BENE_IFSC", "AMOUNT", "DEBIT_NARR", "CREDIT_NARR", "MOBILE_NUM", "EMAIL_ID", "REMARK", "PYMT_DATE", "REF_NO", "ADDL_INFO1", "ADDL_INFO2", "ADDL_INFO3", "ADDL_INFO4", "ADDL_INFO5"];
  const defaultPaymentExportConfig = {
    productCode: "PAB_VENDOR",
    debitAccountNumber: "118805000220",
    mobileNumber: "9111080628",
    emailId: ""
  };
  const accountsPaymentConfigKey = workspaceStorageKey("accounts", "payment-config");
  const [makePaymentMode, setMakePaymentMode] = useState<"Cheque" | "Excel">("Excel");
  const [paymentExportConfig, setPaymentExportConfig] = useState(() => {
    const stored = readStoredJson(accountsPaymentConfigKey, defaultPaymentExportConfig);
    return {
      productCode: String(stored?.productCode || "").trim() || defaultPaymentExportConfig.productCode,
      debitAccountNumber: String(stored?.debitAccountNumber || "").trim() || defaultPaymentExportConfig.debitAccountNumber,
      mobileNumber: String(stored?.mobileNumber || "").trim() || defaultPaymentExportConfig.mobileNumber,
      emailId: String(stored?.emailId || "").trim()
    };
  });
  const [paymentMakerError, setPaymentMakerError] = useState("");
  const [paymentMakerSupplierFix, setPaymentMakerSupplierFix] = useState<null | { supplierId: string; supplierName: string; message: string }>(null);
  const [paymentMakerBusy, setPaymentMakerBusy] = useState(false);
  const [accountsEntryMode, setAccountsEntryMode] = useState<"quick" | "full">("quick");
  const [advanceDeskMode, setAdvanceDeskMode] = useState<"advance" | "against-po">("advance");
  const [openAccountsSections, setOpenAccountsSections] = useState<Record<string, boolean>>({
    queue: true,
    posting: true,
    advances: false,
    products: false,
    orders: false,
    record: false,
    pending: true
  });
  const [paymentPreview, setPaymentPreview] = useState<null | {
    outputMode: "Cheque" | "Excel";
    dbMode: PaymentMode;
    sheetMode: string;
    fileName: string;
    partyName: string;
    amount: number;
    operationDate: string;
    paymentDate: string;
    referenceNumber: string;
    remark: string;
    narration: string;
    row: string[];
  }>(null);

  function formatExcelPaymentDate(value: string) {
    const parts = value.split("-");
    if (parts.length !== 3) return value;
    const [year, month, day] = parts;
    return `${day}-${month}-${year}`;
  }

  function sanitizeAlphaNumeric(value: string) {
    return value.replace(/[^a-z0-9]/gi, "").toUpperCase();
  }

function sanitizePartyToken(value: string) {
  return value
    .replace(/[^a-z0-9]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function hasUsableBankField(value?: string) {
  const normalized = (value || "").trim().toUpperCase();
  return normalized !== "" && normalized !== "N/A";
}

function supplierBankDetailsMissing(counterparty?: Counterparty) {
  if (!counterparty || counterparty.type !== "Supplier") return true;
  return !hasUsableBankField(counterparty.bankName)
    || !hasUsableBankField(counterparty.bankAccountNumber)
    || !hasUsableBankField(counterparty.ifscCode);
}

function sanitizeExcelPayeeName(value: string) {
  return sanitizeAlphaNumeric(value.trim());
}

  function lastOrderDigits(value: string) {
    const digits = value.replace(/\D/g, "");
    if (digits.length >= 4) return digits.slice(-4);
    const compact = sanitizeAlphaNumeric(value);
    return compact.slice(-4) || "PO";
  }

  const [deliveryAssignments, setDeliveryAssignments] = useState<Record<string, string>>({});
  const [expandedAccountsOrder, setExpandedAccountsOrder] = useState("");
  const [advanceSearch, setAdvanceSearch] = useState("");
  const [advanceMakerError, setAdvanceMakerError] = useState("");
  const [advanceMakerSupplierFix, setAdvanceMakerSupplierFix] = useState<null | { supplierId: string; supplierName: string; message: string }>(null);
  const [productDeskSearch, setProductDeskSearch] = useState("");
  const [quickPurchaseForm, setQuickPurchaseForm] = useState({
    linkedOrderId: purchaseOrderPendingOptions[0]?.id || "",
    mode: "NEFT" as PaymentMode,
    utrNumber: "",
    referenceNumber: "",
    operationDate: today
  });
  const [quickSalesForm, setQuickSalesForm] = useState({
    linkedOrderId: salesOrderPendingOptions[0]?.id || "",
    mode: "Cash" as PaymentMode,
    amount: String(salesOrderPendingOptions[0]?.pendingAmount || 0),
    referenceNumber: "",
    operationDate: today
  });
  const [advanceCreateForm, setAdvanceCreateForm] = useState({
    supplierId: suppliers[0]?.id || "",
    amount: "",
    mode: "NEFT" as PaymentMode,
    cashTiming: "In Hand",
    referenceNumber: "",
    voucherNumber: "",
    utrNumber: "",
    proofName: "",
    verificationStatus: "Verified" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved",
    verificationNote: "Advance paid by accounts for purchase",
    operationDate: today
  });

  useEffect(() => {
    writeStoredJson(accountsPaymentConfigKey, paymentExportConfig);
  }, [accountsPaymentConfigKey, paymentExportConfig]);

  useEffect(() => {
    if (suppliers.length === 0) return;
    if (!advanceCreateForm.supplierId || !suppliers.some((item) => item.id === advanceCreateForm.supplierId)) {
      setAdvanceCreateForm((current) => ({ ...current, supplierId: suppliers[0].id }));
    }
  }, [suppliers, advanceCreateForm.supplierId]);

  const filteredAdvancePayments = purchaseAdvancePayments.filter((payment) => {
    const haystack = [
      payment.id,
      payment.counterpartyName,
      payment.referenceNumber,
      payment.utrNumber,
      payment.voucherNumber,
      payment.amount.toFixed(2),
      payment.mode,
      payment.verificationStatus
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(advanceSearch.trim().toLowerCase());
  });

  const productAccountingRows = snapshot.products
    .map((product) => {
      const purchaseLines = snapshot.purchaseOrders.filter((item) => item.productSku === product.sku);
      const salesLines = snapshot.salesOrders.filter((item) => item.productSku === product.sku);
      const stockLines = snapshot.stockSummary.filter((item) => item.productSku === product.sku);
      const purchasedQty = purchaseLines.reduce((sum, item) => sum + item.quantityOrdered, 0);
      const purchasedValue = purchaseLines.reduce((sum, item) => sum + item.totalAmount, 0);
      const soldQty = salesLines.reduce((sum, item) => sum + item.quantity, 0);
      const soldValue = salesLines.reduce((sum, item) => sum + item.totalAmount + item.deliveryCharge, 0);
      const availableStock = stockLines.reduce((sum, item) => sum + item.availableQuantity, 0);
      const reservedStock = stockLines.reduce((sum, item) => sum + item.reservedQuantity, 0);
      const blockedStock = stockLines.reduce((sum, item) => sum + item.blockedQuantity, 0);
      const totalStock = availableStock + reservedStock + blockedStock;
      const sellThrough = purchasedQty > 0 ? (soldQty / purchasedQty) * 100 : 0;
      return {
        sku: product.sku,
        name: product.name,
        division: product.division,
        purchasedQty,
        purchasedValue,
        soldQty,
        soldValue,
        sellThrough,
        availableStock,
        reservedStock,
        blockedStock,
        totalStock
      };
    })
    .sort((left, right) => right.totalStock - left.totalStock || left.sku.localeCompare(right.sku));
  const filteredProductAccountingRows = productAccountingRows.filter((item) => {
    const query = productDeskSearch.trim().toLowerCase();
    if (!query) return true;
    return [
      item.sku,
      item.name,
      item.division,
      item.purchasedQty,
      item.purchasedValue,
      item.soldQty,
      item.soldValue,
      item.sellThrough,
      item.totalStock
    ].join(" ").toLowerCase().includes(query);
  });

  function toggleAccountsSection(section: string) {
    setOpenAccountsSections((current) => ({
      ...current,
      [section]: !current[section]
    }));
  }

  function setSupplierUpdateWarning(
    scope: "advance" | "payment",
    supplier: Counterparty | undefined,
    fallbackMessage = "Update supplier first."
  ) {
    const next = supplier
      ? { supplierId: supplier.id, supplierName: supplier.name, message: fallbackMessage }
      : null;
    if (scope === "advance") {
      setAdvanceMakerSupplierFix(next);
    } else {
      setPaymentMakerSupplierFix(next);
    }
  }

  function renderSupplierUpdateWarning(
    warning: null | { supplierId: string; supplierName: string; message: string }
  ) {
    if (!warning) return null;
    return (
      <div className="message error wide-field">
        <strong>{warning.message}</strong>
        <div className="payment-card-actions top-gap">
          <button className="primary-button" type="button" onClick={() => onOpenSupplierUpdate(warning.supplierId)}>
            Update supplier now
          </button>
        </div>
      </div>
    );
  }

  async function submitAdvanceCreateForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreatePurchaseAdvance({
      supplierId: advanceCreateForm.supplierId,
      amount: Number(advanceCreateForm.amount || 0),
      mode: advanceCreateForm.mode,
      cashTiming: advanceCreateForm.mode === "Cash" ? advanceCreateForm.cashTiming : undefined,
      referenceNumber: advanceCreateForm.referenceNumber,
      voucherNumber: advanceCreateForm.voucherNumber || undefined,
      utrNumber: advanceCreateForm.utrNumber || undefined,
      proofName: advanceCreateForm.proofName || undefined,
      verificationStatus: advanceCreateForm.verificationStatus,
      verificationNote: advanceCreateForm.verificationNote,
      operationDate: advanceCreateForm.operationDate || undefined
    });
    setAdvanceCreateForm((current) => ({
      ...current,
      supplierId: suppliers[0]?.id || "",
      amount: "",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      proofName: "",
      operationDate: current.operationDate || today
    }));
  }

  async function submitAccountsPaymentForm(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await onCreatePayment({
      side: createForm.side,
      linkedOrderId: createForm.linkedOrderId,
      amount: Number(createForm.amount || 0),
      mode: createForm.mode,
      cashTiming: createForm.mode === "Cash" ? createForm.cashTiming as CashTiming : undefined,
      referenceNumber: createForm.referenceNumber,
      voucherNumber: createForm.voucherNumber || undefined,
      utrNumber: createForm.utrNumber || undefined,
      proofName: createForm.proofName || undefined,
      verificationStatus: createForm.verificationStatus,
      verificationNote: createForm.verificationNote,
      operationDate: createForm.operationDate || undefined
    });
  }

  function generateAdvanceExcel() {
    const supplier = suppliers.find((item) => item.id === advanceCreateForm.supplierId);
    const amount = Number(advanceCreateForm.amount || 0);
    if (!supplier) {
      setAdvanceMakerError("Select a supplier first.");
      setAdvanceMakerSupplierFix(null);
      return;
    }
    if (!(amount > 0)) {
      setAdvanceMakerError("Enter a valid advance amount first.");
      setAdvanceMakerSupplierFix(null);
      return;
    }
    if (!paymentExportConfig.productCode.trim() || !paymentExportConfig.debitAccountNumber.trim()) {
      setAdvanceMakerError("Enter the product code and debit account for Excel export first.");
      setAdvanceMakerSupplierFix(null);
      return;
    }
    if (supplierBankDetailsMissing(supplier)) {
      setAdvanceMakerError("Update supplier first.");
      setSupplierUpdateWarning("advance", supplier, "Update supplier first.");
      return;
    }
    const ifsc = supplier.ifscCode.trim().toUpperCase();
    const sheetMode = ifsc.startsWith("ICIC")
      ? "FT"
      : amount >= 200000
        ? "RTGS"
        : "NEFT";
    const operationDate = advanceCreateForm.operationDate || today;
    const paymentDate = formatExcelPaymentDate(operationDate);
    const referenceNumber = sanitizeAlphaNumeric(advanceCreateForm.referenceNumber.trim()) || sanitizeAlphaNumeric(`ADV${supplier.id}`);
    const narration = advanceCreateForm.verificationNote.trim() || `Advance paid to ${supplier.name}`;
    const remark = sanitizeAlphaNumeric(advanceCreateForm.voucherNumber.trim()) || sanitizeAlphaNumeric(`ADV${supplier.name}`);
    const fileName = safePdfFileName(`ADV_${sanitizePartyToken(supplier.name)}_${paymentDate}_${amount.toFixed(2)}.xlsx`);
    const payeeName = sanitizeExcelPayeeName(supplier.name) || sanitizeAlphaNumeric(supplier.id);
    const row = [
      paymentExportConfig.productCode.trim(),
      sheetMode,
      paymentExportConfig.debitAccountNumber.trim(),
      payeeName,
      supplier.bankAccountNumber.trim(),
      ifsc,
      amount.toFixed(2),
      narration,
      narration,
      paymentExportConfig.mobileNumber.trim(),
      paymentExportConfig.emailId.trim(),
      remark,
      paymentDate,
      referenceNumber,
      payeeName,
      payeeName,
      payeeName,
      payeeName,
      payeeName
    ];
    downloadExcelWorkbook(fileName, paymentSheetHeaders, [row], "Sheet1");
    setAdvanceMakerError("");
    setAdvanceMakerSupplierFix(null);
    setAdvanceCreateForm((current) => ({
      ...current,
      amount: "",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      proofName: "",
      operationDate: current.operationDate || today
    }));
  }

  function loadOrderIntoForm(side: "Purchase" | "Sales", linkedOrderId: string) {
    const order = accountOrderOptions.find((item) => item.side === side && item.id === linkedOrderId);
    setCreateForm((current) => ({
      ...current,
      side,
      linkedOrderId,
      amount: String(order?.pendingAmount || current.amount),
      mode: order?.paymentMode || current.mode,
      cashTiming: order?.cashTiming || "",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      proofName: "",
      verificationStatus: "Verified",
      verificationNote: side === "Purchase" ? "Purchase payment recorded by accounts" : "Customer payment recorded by accounts",
      operationDate: current.operationDate || today
    }));
  }

  async function submitQuickPurchasePayment() {
    const order = purchaseOrderPendingOptions.find((item) => item.id === quickPurchaseForm.linkedOrderId);
    if (!order) return;
    const referenceNumber = quickPurchaseForm.referenceNumber.trim() || quickPurchaseForm.utrNumber.trim();
    if (!referenceNumber) return;
    await onCreatePayment({
      side: "Purchase",
      linkedOrderId: order.id,
      amount: order.pendingAmount,
      mode: quickPurchaseForm.mode,
      referenceNumber,
      utrNumber: quickPurchaseForm.utrNumber.trim() || undefined,
      verificationStatus: "Verified",
      verificationNote: "Outgoing supplier payment completed by accounts",
      operationDate: quickPurchaseForm.operationDate || undefined
    });
    setQuickPurchaseForm((current) => ({
      ...current,
      linkedOrderId: purchaseOrderPendingOptions[0]?.id || "",
      utrNumber: "",
      referenceNumber: "",
      operationDate: current.operationDate || today
    }));
  }

  async function submitQuickSalesPayment() {
    const order = salesOrderPendingOptions.find((item) => item.id === quickSalesForm.linkedOrderId);
    if (!order) return;
    const amount = Number(quickSalesForm.amount || 0);
    if (!(amount > 0)) return;
    const referenceNumber = quickSalesForm.mode === "Cash"
      ? `CASH-${order.id}`
      : quickSalesForm.referenceNumber.trim();
    if (!referenceNumber) return;
    await onCreatePayment({
      side: "Sales",
      linkedOrderId: order.id,
      amount,
      mode: quickSalesForm.mode,
      cashTiming: quickSalesForm.mode === "Cash" ? "Later" : undefined,
      referenceNumber,
      verificationStatus: "Verified",
      verificationNote: quickSalesForm.mode === "Cash" ? "Incoming cash recorded by accounts" : "Incoming bank payment recorded by accounts",
      operationDate: quickSalesForm.operationDate || undefined
    });
    const next = salesOrderPendingOptions.find((item) => item.id !== order.id) || salesOrderPendingOptions[0];
    setQuickSalesForm((current) => ({
      ...current,
      linkedOrderId: next?.id || "",
      amount: String(next?.pendingAmount || 0),
      referenceNumber: "",
      operationDate: current.operationDate || today
    }));
  }

  function buildAccountsPaymentPreview() {
    const amount = Number(createForm.amount || 0);
    if (createForm.side !== "Purchase") {
      setPaymentMakerSupplierFix(null);
      return { error: "Make payment is only available for purchase payouts." };
    }
    if (amount <= 0) {
      setPaymentMakerSupplierFix(null);
      return { error: "Enter a valid payment amount first." };
    }
    const order = accountOrderOptions.find((item) => item.side === "Purchase" && item.id === createForm.linkedOrderId);
    const purchaseOrder = findPurchaseOrderByPublicId(snapshot.purchaseOrders, createForm.linkedOrderId);
    const counterparty = snapshot.counterparties.find((item) => item.id === purchaseOrder?.supplierId);
    if (!order || !purchaseOrder || !counterparty) {
      setPaymentMakerSupplierFix(null);
      return { error: "Purchase order or supplier details are missing." };
    }
    if (makePaymentMode === "Excel" && (!paymentExportConfig.productCode.trim() || !paymentExportConfig.debitAccountNumber.trim())) {
      setPaymentMakerSupplierFix(null);
      return { error: "Enter the fixed product code and debit account number for Excel export." };
    }
    if (supplierBankDetailsMissing(counterparty)) {
      setSupplierUpdateWarning("payment", counterparty, "Update supplier first.");
      return { error: "Update supplier first." };
    }
    setPaymentMakerSupplierFix(null);
    const ifsc = counterparty.ifscCode.trim().toUpperCase();
    const sheetMode = makePaymentMode === "Cheque"
      ? "CHEQUE"
      : ifsc.startsWith("ICIC")
        ? "FT"
        : amount >= 200000
          ? "RTGS"
          : "NEFT";
    const dbMode: PaymentMode = makePaymentMode === "Cheque" ? "Cheque" : amount >= 200000 ? "RTGS" : "NEFT";
    const operationDate = createForm.operationDate || today;
    const paymentDate = formatExcelPaymentDate(operationDate);
    const poLast4 = lastOrderDigits(createForm.linkedOrderId);
    const referenceNumber = sanitizeAlphaNumeric(createForm.referenceNumber.trim()) || `PO${poLast4}`;
    const narration = createForm.verificationNote.trim() || `Against ${createForm.linkedOrderId}`;
    const remark = sanitizeAlphaNumeric(createForm.voucherNumber.trim()) || `PO${poLast4}`;
    const payeeName = sanitizeExcelPayeeName(counterparty.name) || sanitizeAlphaNumeric(counterparty.id);
    return {
      outputMode: makePaymentMode,
      dbMode,
      sheetMode,
      fileName: safePdfFileName(`PO_${poLast4}_${sanitizePartyToken(counterparty.name)}_${paymentDate}_${amount.toFixed(2)}.xlsx`),
      partyName: counterparty.name,
      amount,
      operationDate,
      paymentDate,
      referenceNumber,
      remark,
      narration,
      row: [
        paymentExportConfig.productCode.trim(),
        sheetMode,
        paymentExportConfig.debitAccountNumber.trim(),
        payeeName,
        counterparty.bankAccountNumber.trim(),
        ifsc,
        amount.toFixed(2),
        narration,
        narration,
        paymentExportConfig.mobileNumber.trim(),
        paymentExportConfig.emailId.trim(),
        remark,
        paymentDate,
        referenceNumber,
        payeeName,
        payeeName,
        payeeName,
        payeeName,
        payeeName
      ]
    };
  }

  function openAccountsPaymentPreview() {
    const next = buildAccountsPaymentPreview();
    if ("error" in next) {
      setPaymentMakerError(next.error || "Unable to prepare payment preview.");
      setPaymentPreview(null);
      return;
    }
    setPaymentMakerError("");
    setPaymentMakerSupplierFix(null);
    setPaymentPreview(next);
  }

  async function finalizeAccountsPayment() {
    if (!paymentPreview) return;
    setPaymentMakerBusy(true);
    const verificationNote = paymentPreview.outputMode === "Excel"
      ? `Bank instruction file generated by accounts in ${paymentPreview.sheetMode}. Awaiting UTR reconciliation.`
      : "Cheque print generated by accounts. Awaiting clearance / reconciliation.";
    const success = await onCreatePayment({
      side: "Purchase",
      linkedOrderId: createForm.linkedOrderId,
      amount: paymentPreview.amount,
      mode: paymentPreview.dbMode,
      referenceNumber: paymentPreview.referenceNumber,
      voucherNumber: paymentPreview.remark || undefined,
      utrNumber: paymentPreview.outputMode === "Excel" ? "Pending" : undefined,
      verificationStatus: "Pending",
      verificationNote,
      operationDate: paymentPreview.operationDate || undefined
    });
    setPaymentMakerBusy(false);
    if (success === false) return;
    if (paymentPreview.outputMode === "Excel") {
      downloadExcelWorkbook(paymentPreview.fileName, paymentSheetHeaders, [paymentPreview.row], "Sheet1");
    } else {
      openChequePrintWindow({
        partyName: paymentPreview.partyName,
        amount: paymentPreview.amount,
        date: paymentPreview.paymentDate,
        referenceNumber: paymentPreview.referenceNumber,
        note: paymentPreview.narration
      });
    }
    setPaymentPreview(null);
    setPaymentMakerError("");
    setPaymentMakerSupplierFix(null);
  }

  function renderAccountsPaymentPreview() {
    if (!paymentPreview) return null;
    return <div className="stack-list top-gap">
      <article className="list-card">
        <div className="payment-update-head">
          <div>
            <strong>{paymentPreview.outputMode === "Excel" ? "Excel payout preview" : "Cheque print preview"}</strong>
            <p>{createForm.linkedOrderId} · {paymentPreview.partyName}</p>
          </div>
          <span className="status-pill">{paymentPreview.outputMode === "Excel" ? paymentPreview.sheetMode : "Cheque"}</span>
        </div>
        <div className="payment-meta-grid top-gap">
          <div><span className="small-label">Amount</span><strong>{paymentPreview.amount.toFixed(2)}</strong></div>
          <div><span className="small-label">Payment date</span><strong>{paymentPreview.paymentDate}</strong></div>
          <div><span className="small-label">Reference</span><strong>{paymentPreview.referenceNumber}</strong></div>
          <div><span className="small-label">Recorded mode</span><strong>{paymentPreview.dbMode}</strong></div>
          <div className="wide-field"><span className="small-label">Narration</span><strong>{paymentPreview.narration}</strong></div>
        </div>
        {paymentPreview.outputMode === "Excel" ? <div className="table-wrap top-gap">
          <table>
            <thead><tr>{paymentSheetHeaders.map((header) => <th key={header}>{header}</th>)}</tr></thead>
            <tbody><tr>{paymentPreview.row.map((value, index) => <td key={`${paymentSheetHeaders[index]}-${index}`}>{value}</td>)}</tr></tbody>
          </table>
        </div> : <div className="payment-meta-grid top-gap">
          <div className="wide-field"><span className="small-label">Amount in words</span><strong>{formatChequeAmountWords(paymentPreview.amount)}</strong></div>
        </div>}
        <div className="payment-card-actions top-gap">
          <button className="ghost-button" type="button" onClick={() => setPaymentPreview(null)} disabled={paymentMakerBusy}>Cancel</button>
          <button className="primary-button" type="button" onClick={() => void finalizeAccountsPayment()} disabled={paymentMakerBusy}>{paymentMakerBusy ? "Finalizing..." : paymentPreview.outputMode === "Excel" ? "Download Excel and record" : "Finalize and print cheque"}</button>
        </div>
      </article>
    </div>;
  }

  return (
    <section className="collapse-stack">
      <CollapsiblePanel title="Accounts Queue" eyebrow="Pending vs completed" open={openAccountsSections.queue} onToggle={() => toggleAccountsSection("queue")}>
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{purchaseOrderRows.filter((item) => item.pendingAmount > 0).length}</strong><p>Purchase pending</p></div></div>
          <div className="list-card"><div><strong>{salesOrderRows.filter((item) => item.pendingAmount > 0).length}</strong><p>Sales pending</p></div></div>
          <div className="list-card"><div><strong>{pending.length}</strong><p>Payment proofs pending</p></div></div>
          <div className="list-card"><div><strong>{completed.length}</strong><p>Payments completed</p></div></div>
          <div className="list-card"><div><strong>{dayCash.toFixed(2)}</strong><p>Cash entered today</p></div></div>
          <div className="list-card"><div><strong>{purchaseAdvancePayments.length}</strong><p>Purchase advances</p></div></div>
        </div>
      </CollapsiblePanel>
      <CollapsiblePanel title="Temporary Posting" eyebrow="Outgoing purchase and incoming sales" open={openAccountsSections.posting} onToggle={() => toggleAccountsSection("posting")}>
        <div className="summary-switch-bar">
          <button className={accountsEntryMode === "quick" ? "tab-button active" : "tab-button"} type="button" onClick={() => setAccountsEntryMode("quick")}>Quick Post</button>
          <button className={accountsEntryMode === "full" ? "tab-button active" : "tab-button"} type="button" onClick={() => setAccountsEntryMode("full")}>Full Form</button>
        </div>
        {accountsEntryMode === "quick" ? <TwoCol
          left={<Panel title="Outgoing Purchase" eyebrow="Select PO, enter UTR, complete">
            <form className="form-grid" onSubmit={async (event) => {
              event.preventDefault();
              await submitQuickPurchasePayment();
            }}>
              <label>PO<select value={quickPurchaseForm.linkedOrderId} onChange={(e) => setQuickPurchaseForm((current) => ({ ...current, linkedOrderId: e.target.value }))}>{purchaseOrderPendingOptions.map((item) => <option key={item.id} value={item.id}>{`${item.id} - ${item.party} - Pending ${item.pendingAmount.toFixed(2)}`}</option>)}</select></label>
              <label>Mode<select value={quickPurchaseForm.mode} onChange={(e) => setQuickPurchaseForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>NEFT</option><option>RTGS</option><option>UPI</option><option>Cheque</option><option>Card</option><option>Cash</option></select></label>
              <label>Date<input type="date" value={quickPurchaseForm.operationDate} onChange={(e) => setQuickPurchaseForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
              <label>UTR<input value={quickPurchaseForm.utrNumber} onChange={(e) => setQuickPurchaseForm((current) => ({ ...current, utrNumber: e.target.value }))} placeholder="Required for bank transfer" /></label>
              <label>Reference<input value={quickPurchaseForm.referenceNumber} onChange={(e) => setQuickPurchaseForm((current) => ({ ...current, referenceNumber: e.target.value }))} placeholder="Optional if same as UTR" /></label>
              <div className="payment-card-actions wide-field">
                <button className="primary-button" type="submit" disabled={!quickPurchaseForm.linkedOrderId || !(quickPurchaseForm.referenceNumber.trim() || quickPurchaseForm.utrNumber.trim())}>Mark PO complete</button>
              </div>
            </form>
          </Panel>}
          right={<Panel title="Incoming Sales" eyebrow="Select SO, enter amount or ref, complete">
            <form className="form-grid" onSubmit={async (event) => {
              event.preventDefault();
              await submitQuickSalesPayment();
            }}>
              <label>SO<select value={quickSalesForm.linkedOrderId} onChange={(e) => {
                const next = salesOrderPendingOptions.find((item) => item.id === e.target.value);
                setQuickSalesForm((current) => ({ ...current, linkedOrderId: e.target.value, amount: String(next?.pendingAmount || current.amount) }));
              }}>{salesOrderPendingOptions.map((item) => <option key={item.id} value={item.id}>{`${item.id} - ${item.party} - Pending ${item.pendingAmount.toFixed(2)}`}</option>)}</select></label>
              <label>Mode<select value={quickSalesForm.mode} onChange={(e) => setQuickSalesForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
              <label>Date<input type="date" value={quickSalesForm.operationDate} onChange={(e) => setQuickSalesForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
              <label>Amount<input type="number" step="any" value={quickSalesForm.amount} onChange={(e) => setQuickSalesForm((current) => ({ ...current, amount: e.target.value }))} /></label>
              <label>{quickSalesForm.mode === "Cash" ? "Ref" : "Ref Number"}<input value={quickSalesForm.referenceNumber} onChange={(e) => setQuickSalesForm((current) => ({ ...current, referenceNumber: e.target.value }))} placeholder={quickSalesForm.mode === "Cash" ? "Optional for cash" : "Required for UPI/bank"} /></label>
              <div className="payment-card-actions wide-field">
                <button className="primary-button" type="submit" disabled={!quickSalesForm.linkedOrderId || !(Number(quickSalesForm.amount || 0) > 0) || (quickSalesForm.mode !== "Cash" && !quickSalesForm.referenceNumber.trim())}>Mark SO complete</button>
              </div>
            </form>
          </Panel>}
        /> : <div className="empty-card">Use the full form below for proof upload, cheque/export flow, or custom verification states.</div>}
      </CollapsiblePanel>
      <CollapsiblePanel title="Advance Payments" eyebrow="Create and review supplier advances" open={openAccountsSections.advances} onToggle={() => toggleAccountsSection("advances")}>
        <Panel title="Advance Desk" eyebrow="Accounts posting">
          <div className="summary-switch-bar">
            <button className={advanceDeskMode === "advance" ? "tab-button active" : "tab-button"} type="button" onClick={() => { setAdvanceDeskMode("advance"); setPaymentPreview(null); setPaymentMakerError(""); }}>Advance</button>
            <button className={advanceDeskMode === "against-po" ? "tab-button active" : "tab-button"} type="button" onClick={() => {
              const nextPurchase = purchaseOrderPendingOptions.find((item) => item.id === createForm.linkedOrderId) || purchaseOrderPendingOptions[0];
              setAdvanceDeskMode("against-po");
              setPaymentPreview(null);
              setPaymentMakerError("");
              setCreateForm((current) => ({
                ...current,
                side: "Purchase",
                linkedOrderId: nextPurchase?.id || "",
                amount: String(nextPurchase?.pendingAmount || current.amount),
                verificationNote: current.verificationNote.trim() || "Payment recorded by accounts"
              }));
            }}>Against PO</button>
          </div>
          {advanceDeskMode === "advance" ? <form className="form-grid top-gap" onSubmit={submitAdvanceCreateForm}>
            <label>Supplier<select value={advanceCreateForm.supplierId} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, supplierId: e.target.value }))}>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Amount<input type="number" step="any" value={advanceCreateForm.amount} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, amount: e.target.value }))} /></label>
            <label>Mode<select value={advanceCreateForm.mode} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
            {advanceCreateForm.mode === "Cash" ? <label>Cash timing<select value={advanceCreateForm.cashTiming} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, cashTiming: e.target.value }))}><option>In Hand</option><option>At Delivery</option></select></label> : null}
            <label>Reference<input value={advanceCreateForm.referenceNumber} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, referenceNumber: e.target.value }))} /></label>
            <label>Voucher<input value={advanceCreateForm.voucherNumber} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
            <label>UTR<input value={advanceCreateForm.utrNumber} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, utrNumber: e.target.value }))} /></label>
            <label>Date<input type="date" value={advanceCreateForm.operationDate} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
            <label>Status<select value={advanceCreateForm.verificationStatus} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved" }))}><option>Verified</option><option>Submitted</option><option>Pending</option></select></label>
            <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setAdvanceCreateForm((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) })); }} /></label>
            <label>Proof name<input value={advanceCreateForm.proofName} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, proofName: e.target.value }))} /></label>
            <label className="wide-field">Note<input value={advanceCreateForm.verificationNote} onChange={(e) => setAdvanceCreateForm((current) => ({ ...current, verificationNote: e.target.value }))} /></label>
            {advanceMakerError ? <p className="message error wide-field">{advanceMakerError}</p> : null}
            {renderSupplierUpdateWarning(advanceMakerSupplierFix)}
            <div className="payment-card-actions wide-field">
              <button className="primary-button" type="submit" disabled={!advanceCreateForm.supplierId || !(Number(advanceCreateForm.amount || 0) > 0) || !advanceCreateForm.referenceNumber.trim()}>Create advance</button>
              {advanceCreateForm.mode !== "Cash" ? <button className="ghost-button" type="button" onClick={generateAdvanceExcel} disabled={!advanceCreateForm.supplierId || !(Number(advanceCreateForm.amount || 0) > 0)}>Generate Excel</button> : null}
            </div>
          </form> : purchaseOrderPendingOptions.length === 0 ? <div className="empty-card top-gap">No purchase orders are pending for against-PO payment.</div> : <form className="form-grid top-gap" onSubmit={submitAccountsPaymentForm}>
            <label>PO<select value={createForm.linkedOrderId} onChange={(e) => {
              const next = purchaseOrderPendingOptions.find((item) => item.id === e.target.value);
              setCreateForm((current) => ({
                ...current,
                side: "Purchase",
                linkedOrderId: e.target.value,
                amount: String(next?.pendingAmount || current.amount)
              }));
            }}>{purchaseOrderPendingOptions.map((item) => <option key={item.id} value={item.id}>{`${item.id} - ${item.party} - Pending ${item.pendingAmount.toFixed(2)}`}</option>)}</select></label>
            <label>Amount<input type="number" step="any" value={createForm.amount} onChange={(e) => setCreateForm((current) => ({ ...current, amount: e.target.value }))} /></label>
            <label>Payment date<input type="date" value={createForm.operationDate} onChange={(e) => setCreateForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
            <label>Mode<select value={createForm.mode} onChange={(e) => setCreateForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
            {createForm.mode === "Cash" ? <label>Cash timing<select value={createForm.cashTiming} onChange={(e) => setCreateForm((current) => ({ ...current, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option></select></label> : null}
            <label>Reference<input value={createForm.referenceNumber} onChange={(e) => setCreateForm((current) => ({ ...current, referenceNumber: e.target.value }))} /></label>
            <label>Voucher<input value={createForm.voucherNumber} onChange={(e) => setCreateForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
            <label>UTR<input value={createForm.utrNumber} onChange={(e) => setCreateForm((current) => ({ ...current, utrNumber: e.target.value }))} /></label>
            <label>Status<select value={createForm.verificationStatus} onChange={(e) => setCreateForm((current) => ({ ...current, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved" }))}><option>Verified</option><option>Submitted</option><option>Pending</option></select></label>
            <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setCreateForm((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) })); }} /></label>
            <label>Proof name<input value={createForm.proofName} onChange={(e) => setCreateForm((current) => ({ ...current, proofName: e.target.value }))} /></label>
            <label className="wide-field">Note<input value={createForm.verificationNote} onChange={(e) => setCreateForm((current) => ({ ...current, verificationNote: e.target.value }))} placeholder="Against PO narration" /></label>
            <label className="wide-field">
              {makePaymentMode === "Excel" ? "Generate Excel" : "Make cheque"}
              <div className="payment-card-actions top-gap">
                <label className="checkbox-line"><input type="radio" name="advance-against-po-make-payment" checked={makePaymentMode === "Cheque"} onChange={() => setMakePaymentMode("Cheque")} />Cheque</label>
                <label className="checkbox-line"><input type="radio" name="advance-against-po-make-payment" checked={makePaymentMode === "Excel"} onChange={() => setMakePaymentMode("Excel")} />Excel</label>
              </div>
            </label>
            {makePaymentMode === "Excel" ? <>
              <label>Product code<input value={paymentExportConfig.productCode} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, productCode: e.target.value }))} placeholder="Same for all bank files" /></label>
              <label>Debit account<input value={paymentExportConfig.debitAccountNumber} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, debitAccountNumber: e.target.value }))} placeholder="Same for all bank files" /></label>
              <label>Mobile<input value={paymentExportConfig.mobileNumber} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, mobileNumber: e.target.value }))} placeholder="Optional export value" /></label>
              <label>Email<input value={paymentExportConfig.emailId} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, emailId: e.target.value }))} placeholder="Optional export value" /></label>
            </> : null}
            {paymentMakerError ? <p className="message error wide-field">{paymentMakerError}</p> : null}
            {renderSupplierUpdateWarning(paymentMakerSupplierFix)}
            <div className="payment-card-actions wide-field">
              <button className="primary-button" type="submit" disabled={!createForm.linkedOrderId || !(Number(createForm.amount || 0) > 0)}>Record against PO</button>
              <button className="ghost-button" type="button" onClick={openAccountsPaymentPreview} disabled={!createForm.linkedOrderId || !(Number(createForm.amount || 0) > 0)}>{makePaymentMode === "Excel" ? "Generate Excel" : "Make cheque"}</button>
            </div>
          </form>}
          {advanceDeskMode === "against-po" ? renderAccountsPaymentPreview() : null}
        </Panel>
        <Panel title="Advance List" eyebrow="Search by party, amount, ref, UTR">
        <div className="form-grid">
          <label className="wide-field">Search advance<input value={advanceSearch} onChange={(e) => setAdvanceSearch(e.target.value)} placeholder="Supplier, amount, reference, UTR" /></label>
        </div>
        <div className="stack-list payment-update-list top-gap">
          {filteredAdvancePayments.length === 0 ? <div className="empty-card">No supplier advance payments found.</div> : filteredAdvancePayments.map((payment) => {
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : "";
            const whatsappText = encodeURIComponent(
              `Aapoorti supplier advance proof\nAdvance: ${payment.id}\nSupplier: ${payment.counterpartyName || "Supplier"}\nAmount: ${payment.amount.toFixed(2)}\nMode: ${payment.mode}${payment.utrNumber ? `\nUTR: ${payment.utrNumber}` : ""}${payment.referenceNumber ? `\nReference: ${payment.referenceNumber}` : ""}${proofUrl ? `\nProof: ${proofUrl}` : ""}`
            );
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.counterpartyName || "Supplier"}</strong>
                  <p>{payment.id} · {payment.mode}</p>
                </div>
                <span className={`status-pill ${statusPillClass(payment.verificationStatus)}`}>{payment.verificationStatus}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Amount</span><strong>{formatCurrencyInr(payment.amount)}</strong></div>
                <div><span className="small-label">Reference</span><strong>{payment.referenceNumber || "-"}</strong></div>
                <div><span className="small-label">UTR</span><strong>{payment.utrNumber || "-"}</strong></div>
                <div><span className="small-label">Proof</span><strong>{payment.proofName || "Not uploaded"}</strong></div>
                <div><span className="small-label">By</span><strong>{payment.createdBy}</strong></div>
                <div><span className="small-label">Date</span><strong>{formatDateTimeIst(payment.createdAt)}</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                {proofUrl ? <a className="ghost-button" href={proofUrl} target="_blank" rel="noreferrer">Show proof</a> : null}
                {proofUrl ? <a className="ghost-button" href={`https://wa.me/?text=${whatsappText}`} target="_blank" rel="noreferrer">Share via WhatsApp</a> : null}
              </div>
            </article>;
          })}
        </div>
        </Panel>
      </CollapsiblePanel>
      <CollapsiblePanel title="Products" eyebrow="SKU wise purchase, sales, and stock" open={openAccountsSections.products} onToggle={() => toggleAccountsSection("products")}>
        <div className="form-grid">
          <label className="wide-field">Search product<input value={productDeskSearch} onChange={(event) => setProductDeskSearch(event.target.value)} placeholder="Search by SKU, name, division, qty, or value" /></label>
        </div>
        <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Division</th>
                <th>Purchased Qty</th>
                <th>Purchase Value</th>
                <th>Sold Qty</th>
                <th>Sell Through</th>
                <th>Sales Value</th>
                <th>Available</th>
                <th>Reserved</th>
                <th>Blocked</th>
                <th>Total Stock</th>
              </tr>
            </thead>
            <tbody>
              {filteredProductAccountingRows.length === 0 ? <tr><td colSpan={12}>No products matched this search.</td></tr> : filteredProductAccountingRows.map((item) => <tr key={item.sku}>
                <td>{item.sku}</td>
                <td>{item.name}</td>
                <td>{item.division || "-"}</td>
                <td>{item.purchasedQty}</td>
                <td>{formatCurrencyInr(item.purchasedValue)}</td>
                <td>{item.soldQty}</td>
                <td>{item.sellThrough.toFixed(1)}%</td>
                <td>{formatCurrencyInr(item.soldValue)}</td>
                <td>{item.availableStock}</td>
                <td>{item.reservedStock}</td>
                <td>{item.blockedStock}</td>
                <td>{item.totalStock}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </CollapsiblePanel>
      <CollapsiblePanel title="Order Visibility" eyebrow="Purchase and sales status" open={openAccountsSections.orders} onToggle={() => toggleAccountsSection("orders")}>
        <TwoCol
          left={<Panel title="Purchase Orders" eyebrow="Accounts visibility">
          <div className="stack-list payment-update-list">
            {purchaseOrderRows.length === 0 ? <div className="empty-card">No purchase orders yet.</div> : purchaseOrderRows.map((item) => (
              <article className="list-card payment-update-card" key={`purchase-${item.id}`}>
                <div className="payment-update-head">
                  <div>
                    <strong>{item.id}</strong>
                    <p>{item.party}</p>
                  </div>
                  <span className={`status-pill ${item.pendingAmount > 0 ? "status-pending" : "status-completed"}`}>{item.pendingAmount > 0 ? "Payment Pending" : "Payment Completed"}</span>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Total</span><strong>{item.totalAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Paid</span><strong>{item.paidAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Pending</span><strong>{item.pendingAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Order payment</span><strong>{item.paymentMode}{item.cashTiming ? ` / ${item.cashTiming}` : ""}</strong></div>
                  <div className="wide-field"><span className="small-label">Status</span><strong>{item.workflowStatus}</strong></div>
                </div>
                <div className="payment-card-actions top-gap">
                  <button className="ghost-button" type="button" onClick={() => setExpandedAccountsOrder((current) => current === `purchase-${item.id}` ? "" : `purchase-${item.id}`)}>{expandedAccountsOrder === `purchase-${item.id}` ? "Hide details" : "Expand"}</button>
                </div>
                {expandedAccountsOrder === `purchase-${item.id}` ? <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Latest ref</span><strong>{item.latestPayment?.referenceNumber || item.latestPayment?.utrNumber || "Pending"}</strong></div>
                  <div><span className="small-label">Latest proof</span><strong>{item.latestPayment?.proofName || "Not uploaded"}</strong></div>
                  <div className="wide-field"><span className="small-label">Accounts action</span><strong>{item.paymentMode === "Cash" ? "Check cash receipt / handover" : "Check bank credit and reference before completing"}</strong></div>
                </div> : null}
                {item.pendingAmount > 0 ? <div className="payment-card-actions top-gap">
                  <button className="primary-button" type="button" onClick={() => loadOrderIntoForm("Purchase", item.id)}>Tag payment</button>
                </div> : null}
              </article>
            ))}
          </div>
          </Panel>}
          right={<Panel title="Sales Orders" eyebrow="Accounts visibility">
          <div className="stack-list payment-update-list">
            {salesOrderRows.length === 0 ? <div className="empty-card">No sales orders yet.</div> : salesOrderRows.map((item) => (
              <article className="list-card payment-update-card" key={`sales-${item.id}`}>
                <div className="payment-update-head">
                  <div>
                    <strong>{item.id}</strong>
                    <p>{item.party}</p>
                  </div>
                  <span className={`status-pill ${item.pendingAmount > 0 ? "status-pending" : "status-completed"}`}>{item.pendingAmount > 0 ? "Payment Pending" : "Payment Completed"}</span>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Total</span><strong>{item.totalAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Paid</span><strong>{item.paidAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Pending</span><strong>{item.pendingAmount.toFixed(2)}</strong></div>
                  <div><span className="small-label">Order payment</span><strong>{item.paymentMode}{item.cashTiming ? ` / ${item.cashTiming}` : ""}</strong></div>
                  <div className="wide-field"><span className="small-label">Status</span><strong>{item.workflowStatus}</strong></div>
                </div>
                <div className="payment-card-actions top-gap">
                  <button className="ghost-button" type="button" onClick={() => setExpandedAccountsOrder((current) => current === `sales-${item.id}` ? "" : `sales-${item.id}`)}>{expandedAccountsOrder === `sales-${item.id}` ? "Hide details" : "Expand"}</button>
                </div>
                {expandedAccountsOrder === `sales-${item.id}` ? <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Latest ref</span><strong>{item.latestPayment?.referenceNumber || item.latestPayment?.utrNumber || "Pending"}</strong></div>
                  <div><span className="small-label">Latest proof</span><strong>{item.latestPayment?.proofName || "Not uploaded"}</strong></div>
                  <div className="wide-field"><span className="small-label">Accounts action</span><strong>{item.paymentMode === "Cash" ? "Mark cash received when collection is handed over" : "Enter UTR / bank reference when money hits the bank"}</strong></div>
                </div> : null}
                {item.pendingAmount > 0 ? <div className="payment-card-actions top-gap">
                  <button className="primary-button" type="button" onClick={() => loadOrderIntoForm("Sales", item.id)}>Tag payment</button>
                </div> : null}
              </article>
            ))}
          </div>
          </Panel>}
        />
      </CollapsiblePanel>
      <CollapsiblePanel title="Record Payment" eyebrow="Accounts entry" open={openAccountsSections.record} onToggle={() => toggleAccountsSection("record")}>
        <form className="form-grid" onSubmit={submitAccountsPaymentForm}>
          <label>Side<select value={createForm.side} onChange={(e) => {
            const side = e.target.value as "Purchase" | "Sales";
            const next = accountOrderOptions.find((item) => item.side === side);
            setCreateForm((current) => ({ ...current, side, linkedOrderId: next?.id || "", amount: String(next?.pendingAmount || 0) }));
            }}><option>Purchase</option><option>Sales</option></select></label>
            <label>Order<select value={createForm.linkedOrderId} onChange={(e) => {
              const next = accountOrderOptions.find((item) => item.id === e.target.value && item.side === createForm.side);
              setCreateForm((current) => ({ ...current, linkedOrderId: e.target.value, amount: String(next?.pendingAmount || current.amount) }));
            }}>{(createForm.side === "Purchase" ? purchaseOrderPendingOptions : salesOrderPendingOptions).map((item) => <option key={`${item.side}-${item.id}`} value={item.id}>{`${item.id} - ${item.party} - Pending ${item.pendingAmount.toFixed(2)}`}</option>)}</select></label>
          <label>Amount<input type="number" step="any" value={createForm.amount} onChange={(e) => setCreateForm((current) => ({ ...current, amount: e.target.value }))} /></label>
          <label>Payment date<input type="date" value={createForm.operationDate} onChange={(e) => setCreateForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
          <label>Mode<select value={createForm.mode} onChange={(e) => setCreateForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
          {createForm.mode === "Cash" ? <label>Cash timing<select value={createForm.cashTiming} onChange={(e) => setCreateForm((current) => ({ ...current, cashTiming: e.target.value }))}><option value="">Select</option><option>In Hand</option><option>At Delivery</option>{createForm.side === "Sales" ? <option>Later</option> : null}</select></label> : null}
          <label>Reference<input value={createForm.referenceNumber} onChange={(e) => setCreateForm((current) => ({ ...current, referenceNumber: e.target.value }))} /></label>
          <label>Voucher<input value={createForm.voucherNumber} onChange={(e) => setCreateForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
          <label>UTR<input value={createForm.utrNumber} onChange={(e) => setCreateForm((current) => ({ ...current, utrNumber: e.target.value }))} /></label>
          <label>Status<select value={createForm.verificationStatus} onChange={(e) => setCreateForm((current) => ({ ...current, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved" }))}><option>Verified</option><option>Submitted</option></select></label>
          <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setCreateForm((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) })); }} /></label>
          <label>Proof name<input value={createForm.proofName} onChange={(e) => setCreateForm((current) => ({ ...current, proofName: e.target.value }))} /></label>
          <label className="wide-field">Note<input value={createForm.verificationNote} onChange={(e) => setCreateForm((current) => ({ ...current, verificationNote: e.target.value }))} /></label>
          <label className="wide-field">
            {makePaymentMode === "Excel" ? "Generate Excel" : "Make payment"}
            <div className="payment-card-actions top-gap">
              <label className="checkbox-line"><input type="radio" name="accounts-make-payment" checked={makePaymentMode === "Cheque"} onChange={() => setMakePaymentMode("Cheque")} />Cheque</label>
              <label className="checkbox-line"><input type="radio" name="accounts-make-payment" checked={makePaymentMode === "Excel"} onChange={() => setMakePaymentMode("Excel")} />Excel</label>
            </div>
          </label>
          {makePaymentMode === "Excel" ? <>
            <label>Product code<input value={paymentExportConfig.productCode} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, productCode: e.target.value }))} placeholder="Same for all bank files" /></label>
            <label>Debit account<input value={paymentExportConfig.debitAccountNumber} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, debitAccountNumber: e.target.value }))} placeholder="Same for all bank files" /></label>
            <label>Mobile<input value={paymentExportConfig.mobileNumber} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, mobileNumber: e.target.value }))} placeholder="Optional export value" /></label>
            <label>Email<input value={paymentExportConfig.emailId} onChange={(e) => setPaymentExportConfig((current) => ({ ...current, emailId: e.target.value }))} placeholder="Optional export value" /></label>
          </> : null}
          {paymentMakerError ? <p className="message error wide-field">{paymentMakerError}</p> : null}
          {renderSupplierUpdateWarning(paymentMakerSupplierFix)}
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit">Record payment</button>
            <button className="ghost-button" type="button" onClick={openAccountsPaymentPreview}>{makePaymentMode === "Excel" ? "Generate Excel" : "Make payment"}</button>
          </div>
        </form>
        {renderAccountsPaymentPreview()}
      </CollapsiblePanel>
      <CollapsiblePanel title="Pending Verification" eyebrow="Accounts must complete payment" open={openAccountsSections.pending} onToggle={() => toggleAccountsSection("pending")}>
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
                <div><span className="small-label">Submitted</span><strong>{formatDateTimeIst(payment.submittedAt)}</strong></div>
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
                <label>In delivery<select value={deliveryAssignments[payment.id] || deliveryUsers[0]?.username || "in"} onChange={(e) => setDeliveryAssignments((current) => ({ ...current, [payment.id]: e.target.value }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
                <div className="payment-card-actions wide-field">
                  <button className="ghost-button" type="button" onClick={() => void onCreateDeliveryTask({
                    side: "Purchase",
                    linkedOrderId: payment.linkedOrderId,
                    linkedOrderIds: [payment.linkedOrderId],
                    mode: purchaseOrder.deliveryMode,
                    from: "Accounts Cash",
                    to: purchaseOrder.supplierName,
                    assignedTo: deliveryAssignments[payment.id] || deliveryUsers[0]?.username || "in",
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
      </CollapsiblePanel>
    </section>
  );
}
