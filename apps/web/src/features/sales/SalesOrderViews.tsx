import type {
AppSnapshot,
AppUser,
CashTiming,
PaymentMode,
SalesStatus
} from "@aapoorti-b2b/domain";
import { useEffect,useState } from "react";
import { LabelWithBadge,Panel } from "../../components/ui";
import { productDisplayLabel } from "../catalog/catalogUtils";

import {
calculateTaxPreview,
collectionAssignment,
collectionVisibleToUser,
dateKeyInRange,
downloadReportCsv,
downloadReportPdf,
downloadSalesInvoicePdf,
findSalesOrderByPublicId,
groupNewestCreatedAt,
groupOldestCreatedAt,
groupSalesOrders,
GstRateInput,
indiaDateKey,
indiaYesterdayDateKey,
isDeliveryTaskPending,
isOpenSalesOrder,
normalizeDateRange,
OrderQrCard,
OrderQrTarget,
productNameBySku,
productNamesSummary,
salesCollectionEligibleForAgent,
salesCollectionExportHeaders,
salesCollectionExportRows,
salesDeliveryStatus,
salesDeliveryTask,
salesFulfillmentStatus,
salesOrderDraftSignature,
salesOrderEditState,
salesOrderExportHeaders,
salesOrderExportRows,
salesOrderPublicTotal,
salesPaymentStatus,
shareSalesInvoicePdf,
statusPillClass,
TaxModeInput,
userRoleList
} from "../../app/shared";

export function SalesOrderSummary({ snapshot, currentUser, orders, onUpdateSo, onCreatePayment, onTagCollectionAgent, onLogCollectionNote, onOpenStatus }: { snapshot: AppSnapshot; currentUser: AppUser; orders: AppSnapshot["salesOrders"]; onUpdateSo: (orderId: string) => void; onCreatePayment: (body: { side: "Purchase" | "Sales"; linkedOrderId: string; amount: number; mode: PaymentMode; cashTiming?: string; referenceNumber: string; voucherNumber?: string; utrNumber?: string; proofName?: string; verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved"; verificationNote: string; operationDate?: string; }) => Promise<boolean | void>; onTagCollectionAgent: (orderId: string, assignedTo: string) => Promise<boolean | void>; onLogCollectionNote: (orderId: string, note: string) => Promise<boolean | void>; onOpenStatus?: (target: OrderQrTarget) => void; }) {
  const allGroups = groupSalesOrders(orders).sort((left, right) => groupNewestCreatedAt(left.lines) - groupNewestCreatedAt(right.lines));
  const todayDate = indiaDateKey();
  const yesterdayDate = indiaYesterdayDateKey();
  const [datePreset, setDatePreset] = useState<"today" | "yesterday" | "custom">("today");
  const [selectedFromDate, setSelectedFromDate] = useState(indiaDateKey());
  const [selectedToDate, setSelectedToDate] = useState(indiaDateKey());
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [customFromDraft, setCustomFromDraft] = useState(indiaDateKey());
  const [customToDraft, setCustomToDraft] = useState(indiaDateKey());
  const activeRange = datePreset === "today"
    ? { fromDate: todayDate, toDate: todayDate }
    : datePreset === "yesterday"
      ? { fromDate: yesterdayDate, toDate: yesterdayDate }
      : normalizeDateRange(selectedFromDate, selectedToDate);
  type SummarySalesGroup = typeof allGroups[number];
  function salesGroupPendingAmount(group: SummarySalesGroup) {
    const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
    return ledger?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id);
  }
  function salesGroupNotDelivered(group: SummarySalesGroup) {
    return group.lines.some((line) => ["Booked", "Ready for Dispatch", "Pending Pickup", "Out for Delivery", "Self Pickup"].includes(line.status));
  }
  const groups = allGroups.filter((group) => {
    const inDateRange = dateKeyInRange(indiaDateKey(new Date(groupNewestCreatedAt(group.lines))), activeRange.fromDate, activeRange.toDate);
    return inDateRange || salesGroupNotDelivered(group);
  });
  const dispatchPendingCount = groups.filter((group) => {
    const status = salesFulfillmentStatus(group.lines);
    return status === "SO booked" || status === "SO docket ready" || status === "Customer pickup";
  }).length;
  const deliveryPendingCount = groups.filter((group) => {
    const first = group.lines[0];
    if (!first || first.deliveryMode !== "Delivery") return false;
    const task = salesDeliveryTask(snapshot, group.id);
    return !task || isDeliveryTaskPending(task);
  }).length;
  const collectionPendingCount = groups.filter((group) => {
    if (!salesCollectionEligibleForAgent(group)) return false;
    return salesGroupPendingAmount(group) > 0;
  }).length;
  const today = new Date().toISOString().slice(0, 10);
  const roles = userRoleList(currentUser);
  const collectionGroups = groupSalesOrders(orders)
    .map((group) => {
      const first = group.lines[0];
      const totalAmount = salesOrderPublicTotal(snapshot.salesOrders, group.id);
      const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      return {
        id: group.id,
        lines: group.lines,
        shopName: first?.shopName || "Customer",
        pendingAmount: ledger?.pendingAmount ?? totalAmount,
        paidAmount: ledger?.paidAmount ?? 0,
        totalAmount,
        paymentMode: first?.paymentMode || "Cash",
        cashTiming: first?.cashTiming || "",
        deliveryMode: first?.deliveryMode || "Delivery"
      };
    })
    .filter((group) => (dateKeyInRange(indiaDateKey(new Date(groupNewestCreatedAt(group.lines))), activeRange.fromDate, activeRange.toDate) || group.pendingAmount > 0 || salesGroupNotDelivered({ id: group.id, lines: group.lines })) && group.pendingAmount > 0 && collectionVisibleToUser(snapshot, group, currentUser))
    .sort((left, right) => groupNewestCreatedAt(left.lines) - groupNewestCreatedAt(right.lines));
  const unsettledCollections = snapshot.payments
    .filter((item) => item.side === "Sales" && item.createdBy === currentUser.fullName && item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved" && item.verificationStatus !== "Rejected")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const groupedByStatus = new Map<string, ReturnType<typeof groupSalesOrders>>();
  for (const group of groups) {
    const status = `${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`;
    groupedByStatus.set(status, [...(groupedByStatus.get(status) || []), group]);
  }
  const [openGroupId, setOpenGroupId] = useState("");
  const [viewMode, setViewMode] = useState<"orders" | "collections">("orders");
  const [searchText, setSearchText] = useState("");
  const [expandedCollectionOrder, setExpandedCollectionOrder] = useState("");
  const [showSettlementSummary, setShowSettlementSummary] = useState(false);
  const [collectionDrafts, setCollectionDrafts] = useState<Record<string, { amount: string; mode: PaymentMode; cashTiming: string; operationDate: string }>>({});
  const [collectionAgentDrafts, setCollectionAgentDrafts] = useState<Record<string, string>>({});
  const collectionAgents = snapshot.users.filter((user) => user.active && user.roles.includes("Collection Agent"));
  const filteredGroups = groups.filter((group) => `${group.id} ${group.lines[0]?.shopName || ""} ${group.lines.map((line) => productNameBySku(snapshot.products, line.productSku)).join(" ")}`.toLowerCase().includes(searchText.trim().toLowerCase()));
  const filteredCollectionGroups = collectionGroups.filter((group) => `${group.id} ${group.shopName}`.toLowerCase().includes(searchText.trim().toLowerCase()));
  const salesExportHeaders = viewMode === "orders" ? salesOrderExportHeaders() : salesCollectionExportHeaders();
  const salesExportRows = viewMode === "orders"
    ? salesOrderExportRows(snapshot, filteredGroups)
    : salesCollectionExportRows(snapshot, filteredCollectionGroups);
  const salesExportTitle = viewMode === "orders" ? "Sales Orders Report" : "Sales Collection Queue Report";
  const salesExportPrefix = viewMode === "orders" ? "sales-orders" : "sales-collections";

  function getCollectionDraft(orderId: string) {
    const group = collectionGroups.find((item) => item.id === orderId);
    return collectionDrafts[orderId] || {
      amount: String(group?.pendingAmount || 0),
      mode: (group?.paymentMode || "Cash") as PaymentMode,
      cashTiming: group?.cashTiming || "",
      operationDate: today
    };
  }

  function setCollectionDraftValue(orderId: string, field: "amount" | "mode" | "cashTiming" | "operationDate", value: string) {
    setCollectionDrafts((current) => ({ ...current, [orderId]: { ...getCollectionDraft(orderId), [field]: value } }));
  }

  function getCollectionAgentDraft(orderId: string) {
    return collectionAgentDrafts[orderId] || collectionAgents[0]?.fullName || collectionAgents[0]?.username || "";
  }

  function setCollectionAgentDraft(orderId: string, value: string) {
    setCollectionAgentDrafts((current) => ({ ...current, [orderId]: value }));
  }

  const settlementWhatsappText = encodeURIComponent([
    "Aapoorti collection settlement",
    ...unsettledCollections.map((payment) => {
      const order = findSalesOrderByPublicId(snapshot.salesOrders, payment.linkedOrderId);
      return `${payment.linkedOrderId} | ${order?.shopName || "Customer"} | ${payment.mode} | ${payment.amount.toFixed(2)} | Ref ${payment.referenceNumber || "-"}${payment.utrNumber ? ` | UTR ${payment.utrNumber}` : ""}`;
    }),
    `Total cash: ${unsettledCollections.filter((payment) => payment.mode === "Cash").reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)}`,
    `Total collection: ${unsettledCollections.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)}`
  ].join("\n"));

  return (
    <section className="collapse-stack">
      <div className="summary-switch-bar">
        <button className={viewMode === "orders" ? "tab-button active" : "tab-button"} type="button" onClick={() => setViewMode("orders")}>Orders</button>
        <button className={viewMode === "collections" ? "tab-button active" : "tab-button"} type="button" onClick={() => setViewMode("collections")}><LabelWithBadge label="Collection" count={collectionGroups.length} /></button>
      </div>
      <div className="date-filter-strip">
        <button className={datePreset === "today" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setDatePreset("today"); setSelectedFromDate(todayDate); setSelectedToDate(todayDate); }}>Today</button>
        <button className={datePreset === "yesterday" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setDatePreset("yesterday"); setSelectedFromDate(yesterdayDate); setSelectedToDate(yesterdayDate); }}>Yesterday</button>
        <button className={datePreset === "custom" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setCustomFromDraft(activeRange.fromDate); setCustomToDraft(activeRange.toDate); setCustomDateOpen(true); }}>Custom Date</button>
      </div>
      <article className="list-card date-range-card">
        <div className="payment-meta-grid">
          <div><span className="small-label">From</span><strong>{activeRange.fromDate}</strong></div>
          <div><span className="small-label">To</span><strong>{activeRange.toDate}</strong></div>
        </div>
      </article>
      <div className="form-grid">
        <label className="wide-field">Search SO / customer<input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="SO number or customer name" /></label>
      </div>
      <div className="payment-card-actions">
        <button className="ghost-button" type="button" onClick={() => downloadReportCsv(salesExportPrefix, salesExportHeaders, salesExportRows, activeRange.fromDate, activeRange.toDate)}>Download CSV</button>
        <button className="ghost-button" type="button" onClick={() => downloadReportPdf(salesExportTitle, salesExportPrefix, salesExportHeaders, salesExportRows, activeRange.fromDate, activeRange.toDate, [viewMode === "orders" ? `Orders: ${filteredGroups.length}` : `Collections: ${filteredCollectionGroups.length}`])}>Download PDF</button>
      </div>
      {viewMode === "orders" ? <>
      {groups.length > 0 ? <article className="list-card">
        <div className="payment-meta-grid">
          <div><span className="small-label">Warehouse queue</span><strong><LabelWithBadge label="Dispatch pending" count={dispatchPendingCount} /></strong></div>
          <div><span className="small-label">Delivery queue</span><strong><LabelWithBadge label="Pickup pending" count={deliveryPendingCount} /></strong></div>
          <div><span className="small-label">Collection queue</span><strong><LabelWithBadge label="Collection pending" count={collectionPendingCount} /></strong></div>
        </div>
      </article> : null}
      {filteredGroups.length === 0 ? <Panel title="Sales" eyebrow="Your sales orders"><div className="empty-card">No sales orders yet.</div></Panel> : <Panel title="Sales" eyebrow="Your sales orders">
        <div className="stack-list purchase-summary-scroll">
          {filteredGroups.map((group) => {
            const first = group.lines[0];
            const editState = salesOrderEditState(snapshot, group.id, currentUser);
            const expanded = openGroupId === group.id;
            return (
              <article className="list-card purchase-summary-card" key={group.id}>
                <button className="purchase-summary-toggle" type="button" onClick={() => setOpenGroupId((current) => current === group.id ? "" : group.id)}>
                  <div className="payment-update-head">
                    <div>
                      <strong>{first?.shopName || "Customer"}{group.lines.length > 1 ? ` +${group.lines.length - 1}` : ""}</strong>
                      <p>{group.id}</p>
                    </div>
                    <span className="status-pill">{expanded ? "Close" : "Open"}</span>
                  </div>
                  <div className="purchase-status-chips top-gap">
                    <span className="status-pill status-pending"><LabelWithBadge label="SO" count={1} /></span>
                    <span className={`status-pill ${statusPillClass(salesDeliveryStatus(snapshot, group.id))}`}>{salesDeliveryStatus(snapshot, group.id)}</span>
                    <span className={`status-pill ${statusPillClass(`Payment ${salesPaymentStatus(snapshot, group.id)}`)}`}>{salesPaymentStatus(snapshot, group.id)}</span>
                  </div>
                </button>
                {expanded ? <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Customer</span><strong>{first?.shopName || "Customer"}</strong></div>
                  <div><span className="small-label">Products</span><strong>{productNamesSummary(snapshot.products, group.lines.map((line) => line.productSku))}</strong></div>
                  <div><span className="small-label">Mode</span><strong>{first?.deliveryMode || "-"}</strong></div>
                  <div><span className="small-label">Delivery</span><strong>{salesDeliveryStatus(snapshot, group.id)}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{salesPaymentStatus(snapshot, group.id)}</strong></div>
                  <div><span className="small-label">Total</span><strong>{group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0).toFixed(2)}</strong></div>
                  <div><span className="small-label">Status</span><strong>{salesFulfillmentStatus(group.lines)}</strong></div>
                  <div className="payment-card-actions wide-field top-gap">
                    {editState.editable ? <button className="primary-button" type="button" onClick={() => onUpdateSo(group.id)}>Update SO</button> : <span className="small-label">{editState.reason}</span>}
                    <button className="ghost-button" type="button" onClick={() => void shareSalesInvoicePdf(snapshot, group)}>WhatsApp Share</button>
                    <button className="ghost-button" type="button" onClick={() => downloadSalesInvoicePdf(snapshot, group)}>Download PDF</button>
                  </div>
                  {onOpenStatus ? <div className="wide-field">
                    <OrderQrCard target={{ side: "Sales", orderId: group.id }} title="SO status QR" onOpenStatus={onOpenStatus} />
                  </div> : null}
                </div> : null}
              </article>
            );
          })}
        </div>
      </Panel>}
      </> : <Panel title="Collection Work" eyebrow="Pending customer payment">
        <div className="stack-list payment-update-list">
          <div className="payment-card-actions">
            <button className="ghost-button" type="button" onClick={() => setShowSettlementSummary((current) => !current)}>{showSettlementSummary ? "Hide settle" : "Settle"}</button>
            {showSettlementSummary && unsettledCollections.length > 0 ? <a className="primary-button" href={`https://wa.me/?text=${settlementWhatsappText}`} target="_blank" rel="noreferrer">Share on WhatsApp</a> : null}
          </div>
          {showSettlementSummary ? <article className="list-card">
            <div className="payment-meta-grid">
              <div><span className="small-label">Entries</span><strong>{unsettledCollections.length}</strong></div>
              <div><span className="small-label">Cash total</span><strong>{unsettledCollections.filter((payment) => payment.mode === "Cash").reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)}</strong></div>
              <div><span className="small-label">Overall total</span><strong>{unsettledCollections.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2)}</strong></div>
            </div>
            <div className="stack-list top-gap">
              {unsettledCollections.length === 0 ? <div className="empty-card">No collection entries pending accounts reconciliation.</div> : unsettledCollections.map((payment) => {
                const order = findSalesOrderByPublicId(snapshot.salesOrders, payment.linkedOrderId);
                return <article className="list-card" key={payment.id}>
                  <div className="payment-update-head">
                    <div>
                      <strong>{payment.linkedOrderId}</strong>
                      <p>{order?.shopName || "Customer"} · {payment.mode}</p>
                    </div>
                    <span className="status-pill status-pending">{payment.amount.toFixed(2)}</span>
                  </div>
                  <div className="payment-meta-grid">
                    <div><span className="small-label">Reference</span><strong>{payment.referenceNumber || "-"}</strong></div>
                    <div><span className="small-label">UTR</span><strong>{payment.utrNumber || "-"}</strong></div>
                    <div><span className="small-label">Status</span><strong>{payment.verificationStatus}</strong></div>
                  </div>
                </article>;
              })}
            </div>
          </article> : null}
          {filteredCollectionGroups.length === 0 ? <div className="empty-card">No unsettled sales orders found.</div> : filteredCollectionGroups.map((group) => {
            const expanded = expandedCollectionOrder === group.id;
            const draft = getCollectionDraft(group.id);
            const collectedAmount = Number(draft.amount || 0);
            const assignedCollector = collectionAssignment(snapshot, group.id);
            const collectionAgentDraft = getCollectionAgentDraft(group.id);
            return <article className="list-card payment-update-card" key={group.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{group.id}</strong>
                  <p>{group.shopName} · {group.paymentMode}{group.cashTiming ? ` / ${group.cashTiming}` : ""}</p>
                </div>
                <span className="status-pill status-pending">{group.pendingAmount.toFixed(2)} pending</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Total</span><strong>{group.totalAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Paid</span><strong>{group.paidAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Pending</span><strong>{group.pendingAmount.toFixed(2)}</strong></div>
                <div><span className="small-label">Delivery</span><strong>{group.deliveryMode}</strong></div>
                <div><span className="small-label">Collection Agent</span><strong>{assignedCollector || "Not tagged"}</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                <button className="ghost-button" type="button" onClick={() => setExpandedCollectionOrder((current) => current === group.id ? "" : group.id)}>{expanded ? "Hide" : "Collect"}</button>
              </div>
              {expanded ? <div className="form-grid top-gap">
                {collectionAgents.length > 0 ? <>
                  <label>Collection agent<select value={collectionAgentDraft} onChange={(e) => setCollectionAgentDraft(group.id, e.target.value)}>
                    {collectionAgents.map((agent) => <option key={agent.id} value={agent.fullName || agent.username}>{agent.fullName || agent.username}</option>)}
                  </select></label>
                  <div className="payment-card-actions">
                    <button className="ghost-button" type="button" onClick={() => void onTagCollectionAgent(group.id, collectionAgentDraft)}>Tag agent</button>
                  </div>
                </> : null}
                <label>Amount<input type="number" step="any" min="0" max={group.pendingAmount} value={draft.amount} onChange={(e) => setCollectionDraftValue(group.id, "amount", e.target.value)} /></label>
                <label>Mode<select value={draft.mode} onChange={(e) => setCollectionDraftValue(group.id, "mode", e.target.value)}>
                  <option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option>
                </select></label>
                <label>Date<input type="date" value={draft.operationDate} onChange={(e) => setCollectionDraftValue(group.id, "operationDate", e.target.value)} /></label>
                {draft.mode === "Cash" ? <label>Cash timing<select value={draft.cashTiming} onChange={(e) => setCollectionDraftValue(group.id, "cashTiming", e.target.value)}><option value="">Select</option><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
                <div className="payment-card-actions wide-field">
                  <button className="ghost-button" type="button" onClick={() => setCollectionDraftValue(group.id, "amount", group.pendingAmount.toFixed(2))}>Set full</button>
                  <button className="primary-button" type="button" disabled={collectedAmount <= 0} onClick={() => void (async () => {
                    const collectedBySalesman = !roles.includes("Collection Agent");
                    await onCreatePayment({
                      side: "Sales",
                      linkedOrderId: group.id,
                      amount: collectedAmount,
                      mode: draft.mode,
                      cashTiming: draft.mode === "Cash" ? draft.cashTiming as CashTiming : undefined,
                      referenceNumber: draft.mode === "Cash" ? `COL-${group.id}` : "",
                      verificationStatus: "Submitted",
                      verificationNote: `${roles.includes("Collection Agent") ? "Collected by collection agent" : "Collected by sales"} from ${group.shopName}`,
                      operationDate: draft.operationDate || undefined
                    });
                    if (collectedBySalesman && assignedCollector) {
                      await onLogCollectionNote(group.id, `Collection collected by salesman ${currentUser.fullName || currentUser.username}. Earlier tagged to ${assignedCollector}.`);
                    }
                  })()}>Collected</button>
                  <button className="ghost-button" type="button" onClick={() => void shareSalesInvoicePdf(snapshot, { id: group.id, lines: group.lines })}>WhatsApp Share</button>
                  <button className="ghost-button" type="button" onClick={() => downloadSalesInvoicePdf(snapshot, { id: group.id, lines: group.lines })}>Download PDF</button>
                </div>
                {collectedAmount > 0 && collectedAmount < group.pendingAmount ? <p className="message success wide-field">This will settle partially. Remaining amount stays pending.</p> : null}
              </div> : null}
            </article>;
          })}
        </div>
      </Panel>}
      {customDateOpen ? <div className="cart-overlay" onClick={() => setCustomDateOpen(false)}>
        <div className="cart-sheet date-picker-sheet" onClick={(e) => e.stopPropagation()}>
          <div className="cart-head">
            <div>
              <h3>Select date range</h3>
              <p>Choose sales from and to dates, then click done.</p>
            </div>
            <button type="button" className="ghost-button" onClick={() => setCustomDateOpen(false)}>Close</button>
          </div>
          <label>
            From
            <input type="date" value={customFromDraft} onChange={(e) => setCustomFromDraft(e.target.value)} />
          </label>
          <label>
            To
            <input type="date" value={customToDraft} onChange={(e) => setCustomToDraft(e.target.value)} />
          </label>
          <div className="payment-card-actions">
            <button type="button" className="ghost-button" onClick={() => setCustomDateOpen(false)}>Cancel</button>
            <button type="button" className="primary-button" onClick={() => {
              const normalized = normalizeDateRange(customFromDraft || todayDate, customToDraft || customFromDraft || todayDate);
              setSelectedFromDate(normalized.fromDate);
              setSelectedToDate(normalized.toDate);
              setDatePreset("custom");
              setCustomDateOpen(false);
            }}>Done</button>
          </div>
        </div>
      </div> : null}
    </section>
  );
}

export function SalesOrderEditor({ snapshot, currentUser, initialOrderId, onNewOrder, onDirtyChange, onUpdateSalesOrder }: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  initialOrderId: string;
  onNewOrder: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onUpdateSalesOrder: (id: string, body: {
    paymentMode: PaymentMode;
    cashTiming?: string;
    deliveryMode: "Self Collection" | "Delivery";
    note: string;
    status: SalesStatus;
    lines?: Array<{
      id?: string;
      productSku: string;
      warehouseId?: string;
      quantity: number;
      rate: number;
      cdTodRate: number;
      cdAmount: number;
      todAmount: number;
      taxableAmount: number;
      gstRate: "NA" | 0 | 5 | 12 | 18 | 40;
      gstAmount: number;
      taxMode: "NA" | "Exclusive" | "Inclusive";
    }>;
    rate?: number;
  }) => Promise<boolean | void>;
}) {
  const editableGroups = groupSalesOrders(snapshot.salesOrders.filter((order) =>
    isOpenSalesOrder(order) && (
      userRoleList(currentUser).includes("Admin")
      || order.salesmanId === currentUser.id
      || order.salesmanName === currentUser.fullName
    )
  )).sort((left, right) => groupOldestCreatedAt(left.lines) - groupOldestCreatedAt(right.lines));
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId || editableGroups[0]?.id || "");
  const selectedGroup = editableGroups.find((group) => group.id === selectedOrderId) || editableGroups[0] || null;
  const editState = selectedGroup ? salesOrderEditState(snapshot, selectedGroup.id, currentUser) : { editable: false, reason: "No sales orders available." };
  const [draft, setDraft] = useState<{ paymentMode: PaymentMode; cashTiming: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; lines: Array<{ clientKey: string; id?: string; productSku: string; warehouseId: string; rate: string; cdTodRate: string; cdAmount: string; todAmount: string; quantity: string; totalAmount: number; gstRate: GstRateInput; gstAmount: string; taxableAmount: string; taxMode: TaxModeInput }> } | null>(null);
  const [initialDraftState, setInitialDraftState] = useState("");
  const draftDirty = Boolean(draft && initialDraftState && salesOrderDraftSignature(draft) !== initialDraftState);

  function confirmDiscardChanges() {
    if (!draftDirty) return true;
    return window.confirm("Are you sure? This will undo all the changes.");
  }

  useEffect(() => {
    if (initialOrderId) setSelectedOrderId(initialOrderId);
  }, [initialOrderId]);

  useEffect(() => {
    if (editableGroups.length === 0) {
      if (selectedOrderId) setSelectedOrderId("");
      return;
    }
    if (!editableGroups.some((group) => group.id === selectedOrderId)) {
      setSelectedOrderId(editableGroups[0].id);
    }
  }, [editableGroups, selectedOrderId]);

  useEffect(() => {
    if (!selectedGroup) {
      setDraft(null);
      setInitialDraftState("");
      return;
    }
    const first = selectedGroup.lines[0];
    const nextDraft: NonNullable<typeof draft> = {
      paymentMode: first.paymentMode,
      cashTiming: first.cashTiming || "",
      deliveryMode: first.deliveryMode,
      note: first.note || "",
      status: first.status,
      lines: selectedGroup.lines.map((line) => ({
        id: line.id,
        clientKey: line.id,
        productSku: line.productSku,
        warehouseId: line.warehouseId,
        rate: String(line.rate),
        cdTodRate: String(line.cdTodRate || Math.max(0, line.rate - ((line.cdAmount + line.todAmount) / Math.max(line.quantity, 1)))),
        cdAmount: String(line.cdAmount),
        todAmount: String(line.todAmount),
        quantity: String(line.quantity),
        totalAmount: line.totalAmount + line.deliveryCharge,
        gstRate: String(line.gstRate === "NA" ? 0 : line.gstRate || 0) as GstRateInput,
        gstAmount: String(line.gstAmount),
        taxableAmount: String(line.taxableAmount),
        taxMode: line.taxMode === "NA" ? "Exclusive" : ((line.taxMode || "Exclusive") as TaxModeInput)
      }))
    };
    setDraft(nextDraft);
    setInitialDraftState(salesOrderDraftSignature(nextDraft));
  }, [selectedGroup?.id]);

  useEffect(() => {
    onDirtyChange(draftDirty);
  }, [draftDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function updateSalesDraftLine(lineKey: string, updates: Partial<{ productSku: string; quantity: string; rate: string; cdTodRate: string; gstRate: GstRateInput; taxMode: TaxModeInput }>) {
    onDirtyChange(true);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) => {
          if (line.clientKey !== lineKey) return line;
          const productSku = updates.productSku ?? line.productSku;
          const product = snapshot.products.find((item) => item.sku === productSku);
          const quantity = updates.quantity ?? line.quantity;
          const rate = updates.rate ?? line.rate;
          const cdTodRate = updates.cdTodRate ?? (updates.rate !== undefined && Number(line.rate || 0) === 0 && Number(line.cdTodRate || 0) === 0 ? rate : line.cdTodRate);
          const requestedGstRate = updates.gstRate ?? line.gstRate ?? String(product?.defaultGstRate === "NA" ? 0 : product?.defaultGstRate || 0) as GstRateInput;
          const gstRate = requestedGstRate === "NA" ? "0" : requestedGstRate;
          const fallbackTaxMode = product?.defaultTaxMode === "NA" ? "Exclusive" : (product?.defaultTaxMode || "Exclusive");
          const requestedTaxMode = updates.taxMode ?? (line.taxMode === "NA" ? fallbackTaxMode : line.taxMode);
          const taxMode = requestedTaxMode === "NA" ? "Exclusive" : requestedTaxMode;
          const totals = calculateTaxPreview(String(Math.max(0, Number(quantity || 0)) * Math.max(0, Number(rate || 0))), gstRate, taxMode);
          const discountDifference = Math.max(0, Number(rate || 0) - Number(cdTodRate || 0)) * Math.max(0, Number(quantity || 0));
          const cdAmount = discountDifference / 2;
          const todAmount = discountDifference - cdAmount;
          return {
            ...line,
            productSku,
            quantity,
            rate,
            cdTodRate,
            cdAmount: cdAmount.toFixed(2),
            todAmount: todAmount.toFixed(2),
            gstRate,
            taxMode,
            taxableAmount: totals.taxableAmount,
            gstAmount: totals.gstAmount,
            totalAmount: Math.max(0, Number(totals.taxableAmount || 0) + Number(totals.gstAmount || 0) - cdAmount - todAmount)
          };
        })
      };
    });
  }

  function addSalesDraftLine() {
    if (!selectedGroup) return;
    onDirtyChange(true);
    const fallbackProduct = snapshot.products[0];
    if (!fallbackProduct) return;
    const gstRate = String(fallbackProduct.defaultGstRate === "NA" ? 0 : fallbackProduct.defaultGstRate || 0) as GstRateInput;
    const taxMode = fallbackProduct.defaultTaxMode === "NA" ? "Exclusive" : fallbackProduct.defaultTaxMode;
    const totals = calculateTaxPreview("0", gstRate, taxMode);
    setDraft((current) => current ? {
      ...current,
      lines: [...current.lines, {
        clientKey: `so-${Date.now()}-${Math.random()}`,
        productSku: fallbackProduct.sku,
        warehouseId: selectedGroup.lines[0]?.warehouseId || "",
        rate: "0",
        cdTodRate: "0",
        cdAmount: "0.00",
        todAmount: "0.00",
        quantity: "0",
        totalAmount: 0,
        gstRate,
        gstAmount: totals.gstAmount,
        taxableAmount: totals.taxableAmount,
        taxMode
      }]
    } : current);
  }

  async function cancelSalesGroup() {
    if (!selectedGroup || !draft || !editState.editable) return;
    if (!window.confirm(`Cancel sales order ${selectedGroup.id}?`)) return;
    const success = await onUpdateSalesOrder(selectedGroup.id, {
      paymentMode: draft.paymentMode,
      cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
      deliveryMode: draft.deliveryMode,
      note: draft.note?.trim() ? `${draft.note.trim()} | Cancelled from update SO.` : "Cancelled from update SO.",
      status: "Cancelled",
      lines: draft.lines.map((line) => ({
        id: line.id,
        productSku: line.productSku,
        warehouseId: line.warehouseId,
        quantity: Number(line.quantity || 0),
        rate: Number(line.rate || 0),
        cdTodRate: Number(line.cdTodRate || 0),
        cdAmount: Number(line.cdAmount || 0),
        todAmount: Number(line.todAmount || 0),
        taxableAmount: Number(line.taxableAmount || 0),
        gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
        gstAmount: Number(line.gstAmount || 0),
        taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode
      }))
    });
    if (success !== false) {
      onDirtyChange(false);
      onNewOrder();
    }
  }

  return (
    <Panel title="Update Sales Order" eyebrow="Product amendment only">
      {editableGroups.length === 0 ? <div className="empty-card">No sales orders available for edit.</div> : <form className="form-grid" onSubmit={async (event) => {
        event.preventDefault();
        if (!selectedGroup || !draft || !editState.editable) return;
        const success = await onUpdateSalesOrder(selectedGroup.id, {
          paymentMode: draft.paymentMode,
          cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
          deliveryMode: draft.deliveryMode,
          note: draft.note,
          status: draft.status,
          lines: draft.lines.map((line) => ({
            id: line.id,
            productSku: line.productSku,
            warehouseId: line.warehouseId,
            quantity: Number(line.quantity || 0),
            rate: Number(line.rate || 0),
            cdTodRate: Number(line.cdTodRate || 0),
            cdAmount: Number(line.cdAmount || 0),
            todAmount: Number(line.todAmount || 0),
            taxableAmount: Number(line.taxableAmount || 0),
            gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
            gstAmount: Number(line.gstAmount || 0),
            taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode
          }))
        });
        if (success !== false) {
          onDirtyChange(false);
          onNewOrder();
        }
      }}>
        <label className="wide-field">Sales order<select value={selectedGroup?.id || ""} onChange={(e) => {
          const nextOrderId = e.target.value;
          if (nextOrderId === selectedOrderId) return;
          if (!confirmDiscardChanges()) return;
          setSelectedOrderId(nextOrderId);
        }}>{editableGroups.map((group) => <option key={group.id} value={group.id}>{`${group.id} - ${group.lines[0]?.shopName || "Customer"}`}</option>)}</select></label>
        {selectedGroup ? <>
          <div className="message-chip-grid wide-field">
            <span className="status-pill">{selectedGroup.lines[0]?.shopName || "Customer"}</span>
            <span className="status-pill">{selectedGroup.lines.length} product(s)</span>
            <span className="status-pill">{salesFulfillmentStatus(selectedGroup.lines)} / Payment {salesPaymentStatus(snapshot, selectedGroup.id)}</span>
          </div>
          {!editState.editable ? <p className="message error wide-field">{editState.reason}</p> : null}
          <div className="payment-card-actions wide-field">
            <button className="ghost-button" type="button" onClick={() => {
              if (!confirmDiscardChanges()) return;
              onDirtyChange(false);
              onNewOrder();
            }}>Back</button>
            <button className="ghost-button" type="button" onClick={addSalesDraftLine} disabled={!editState.editable || snapshot.products.length === 0}>Add product</button>
            <button className="ghost-button" type="button" onClick={() => void cancelSalesGroup()} disabled={!editState.editable}>Cancel SO</button>
          </div>
          <div className="wide-field compact-order-editor">{draft?.lines.length ? <>
            <div className="compact-order-editor-head">
              <span>Action</span>
              <span>Product</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>Net rate</span>
            </div>
            {draft.lines.map((line, index) => <div className="compact-order-editor-row" key={line.clientKey || line.id || `${line.productSku}-${index}`}><div className="compact-order-editor-actions"><button className="ghost-button compact-icon-button" type="button" onClick={addSalesDraftLine} disabled={!editState.editable || snapshot.products.length === 0} aria-label="Add product">+</button><button className="ghost-button compact-icon-button" type="button" onClick={() => { onDirtyChange(true); setDraft((current) => current ? { ...current, lines: current.lines.filter((item) => item !== line) } : current); }} disabled={!editState.editable || draft.lines.length <= 1} aria-label="Remove product">-</button></div><div className="compact-order-editor-product">{!line.id ? <select value={line.productSku} onChange={(e) => updateSalesDraftLine(line.clientKey, { productSku: e.target.value })} disabled={!editState.editable || Boolean(line.id)}>{snapshot.products.map((product) => <option key={product.sku} value={product.sku}>{productDisplayLabel(product) || product.sku}</option>)}</select> : <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>}</div><input type="number" step="any" min="0" value={line.quantity} onChange={(e) => updateSalesDraftLine(line.clientKey, { quantity: e.target.value })} disabled={!editState.editable} /><input type="number" step="any" min="0" value={line.rate} onChange={(e) => updateSalesDraftLine(line.clientKey, { rate: e.target.value })} disabled={!editState.editable} /><input type="number" step="any" min="0" max={line.rate || undefined} value={line.cdTodRate} onChange={(e) => updateSalesDraftLine(line.clientKey, { cdTodRate: e.target.value })} disabled={!editState.editable} aria-label="Net rate after CD and TOD" /></div>)}
          </> : <div className="empty-card">No sales order lines available.</div>}</div>
          <div className="payment-card-actions wide-field"><button className="primary-button" type="submit" disabled={!editState.editable}>Update sales order</button><button className="ghost-button" type="button" onClick={() => {
            if (!confirmDiscardChanges()) return;
            onDirtyChange(false);
            onNewOrder();
          }}>New SO</button></div>
        </> : null}
      </form>}
    </Panel>
  );
}
