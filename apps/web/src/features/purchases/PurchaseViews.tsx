import type {
AppSnapshot,
AppUser,
Counterparty,
PaymentMode,
PurchaseOrder
} from "@aapoorti-b2b/domain";
import { useEffect,useState } from "react";
import { LabelWithBadge,Panel,PendingBadge } from "../../components/ui";
import { CatalogOrderView,type CatalogOrderViewProps } from "../catalog/CatalogOrderView";
import { productDisplayLabel } from "../catalog/catalogUtils";

import {
API_BASE,
calculateTaxPreview,
dateKeyInRange,
downloadPurchaseInvoicePdf,
downloadReportCsv,
downloadReportPdf,
findPurchaseOrderByPublicId,
groupNewestCreatedAt,
groupOldestCreatedAt,
groupPurchaseOrders,
GstRateInput,
indiaDateKey,
indiaYesterdayDateKey,
isOpenPurchaseOrder,
normalizeDateRange,
OrderQrCard,
OrderQrTarget,
printPurchaseInvoice,
productNameBySku,
productNamesSummary,
purchaseCartDraftSignature,
purchaseCartEditState,
purchaseDeliveryStatus,
purchaseDeliveryTask,
purchaseLedgerByOrder,
purchaseNeedsInternalPickup,
purchaseOrderExportHeaders,
purchaseOrderExportRows,
purchaseOrderPublicTotal,
purchasePaymentExportHeaders,
purchasePaymentExportRows,
purchasePaymentStatus,
purchaseWarehouseStatus,
purchaseWorkflowStatus,
sharePurchaseInvoicePdf,
statusPillClass,
TaxModeInput,
userRoleList,
workspaceStorageKey
} from "../../app/shared";

export function PurchaserPurchaseWorkspace({
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
  searchRequestToken,
  initialUpdateOrderId,
  onUpdateCart,
  onExitEditor,
  onEditorDirtyChange
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
  searchRequestToken?: number;
  initialUpdateOrderId?: string;
  onExitEditor: () => void;
  onEditorDirtyChange: (dirty: boolean) => void;
  onUpdateCart: (orderId: string, body: {
    paymentMode: PaymentMode;
    cashTiming?: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      id?: string;
      productSku: string;
      warehouseId?: string;
      quantityOrdered: number;
      rate: number;
      taxableAmount: number;
      gstRate: "NA" | 0 | 5 | 12 | 18 | 40;
      gstAmount: number;
      taxMode: "NA" | "Exclusive" | "Inclusive";
    }>;
  }) => Promise<boolean | void>;
}) {
  useEffect(() => {
    if (!initialUpdateOrderId) onEditorDirtyChange(false);
  }, [initialUpdateOrderId, onEditorDirtyChange]);

  return (
    <section className="module-stack">
      {initialUpdateOrderId ? <PurchaseCartEditor
        snapshot={snapshot}
        currentUser={currentUser}
        onUpdateCart={onUpdateCart}
        initialOrderId={initialUpdateOrderId}
        onExit={onExitEditor}
        onDirtyChange={onEditorDirtyChange}
      /> : <CatalogOrderView
        snapshot={snapshot}
        mode="purchase"
        title="New Purchase"
        eyebrow="Create supplier order"
        products={products}
        parties={suppliers}
        warehouses={warehouses}
        paymentMethods={paymentMethods}
        stockSummary={stockSummary}
        purchaseOrders={purchaseOrders}
        orderForm={orderForm}
        setOrderForm={setOrderForm}
        persistKey={workspaceStorageKey(currentUser.id, "purchase-catalog")}
        searchRequestToken={searchRequestToken}
        onCreateParty={onCreateParty}
        onUploadProof={onUploadProof}
        onSubmit={onSubmit}
        rightPanel={null}
      />}
    </section>
  );
}

export function PurchaserPurchaseSummary({ snapshot, currentUser, orders, onUpdatePo, onOpenStatus }: { snapshot: AppSnapshot; currentUser?: AppUser; orders: AppSnapshot["purchaseOrders"]; onUpdatePo?: (orderId: string) => void; onOpenStatus?: (target: OrderQrTarget) => void }) {
  const allGroups = groupPurchaseOrders(orders).sort((left, right) => groupNewestCreatedAt(right.lines) - groupNewestCreatedAt(left.lines));
  const todayDate = indiaDateKey();
  const yesterdayDate = indiaYesterdayDateKey();
  const latestAvailableDate = allGroups.length > 0 ? indiaDateKey(new Date(groupNewestCreatedAt(allGroups[0].lines))) : todayDate;
  const hasTodayOrders = allGroups.some((group) => indiaDateKey(new Date(groupNewestCreatedAt(group.lines))) === todayDate);
  const hasYesterdayOrders = allGroups.some((group) => indiaDateKey(new Date(groupNewestCreatedAt(group.lines))) === yesterdayDate);
  const completedPayments = snapshot.payments
    .filter((item) => item.side === "Purchase" && (item.verificationStatus === "Verified" || item.verificationStatus === "Resolved"))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const [openGroupId, setOpenGroupId] = useState("");
  const [viewMode, setViewMode] = useState<"orders" | "payments">("orders");
  const [openPaymentId, setOpenPaymentId] = useState("");
  const [searchText, setSearchText] = useState("");
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
  type SummaryPurchaseGroup = typeof allGroups[number];
  function purchaseGroupPendingAmount(group: SummaryPurchaseGroup) {
    const ledger = purchaseLedgerByOrder(snapshot, group.id);
    return ledger?.pendingAmount ?? purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id);
  }
  function purchaseGroupNotReceived(group: SummaryPurchaseGroup) {
    return purchaseWarehouseStatus(group.lines) !== "Received";
  }
  const groups = allGroups.filter((group) => {
    const inDateRange = dateKeyInRange(indiaDateKey(new Date(groupNewestCreatedAt(group.lines))), activeRange.fromDate, activeRange.toDate);
    return inDateRange || purchaseGroupNotReceived(group);
  });
  const pickupPendingCount = groups.filter((group) => !purchaseDeliveryTask(snapshot, group.id) && purchaseNeedsInternalPickup(group.lines) && purchaseWarehouseStatus(group.lines) !== "Received").length;
  const receivingPendingCount = groups.filter((group) => purchaseWarehouseStatus(group.lines) !== "Received").length;
  const paymentPendingCount = groups.filter((group) => ["Pending", "Partial", "Cash With Delivery"].includes(purchasePaymentStatus(snapshot, group.id))).length;
  const filteredGroups = groups.filter((group) => `${group.id} ${group.lines[0]?.supplierName || ""} ${group.lines.map((line) => line.productSku).join(" ")}`.toLowerCase().includes(searchText.trim().toLowerCase()));
  const filteredCompletedPayments = completedPayments.filter((payment) => {
    const order = findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId);
    const group = allGroups.find((item) => item.id === payment.linkedOrderId);
    return (dateKeyInRange(indiaDateKey(payment.createdAt), activeRange.fromDate, activeRange.toDate) || (group ? purchaseGroupPendingAmount(group) > 0 || purchaseGroupNotReceived(group) : false)) && `${payment.linkedOrderId} ${order?.supplierName || ""} ${payment.referenceNumber || ""} ${payment.utrNumber || ""}`.toLowerCase().includes(searchText.trim().toLowerCase());
  });
  const purchaseExportHeaders = viewMode === "orders" ? purchaseOrderExportHeaders() : purchasePaymentExportHeaders();
  const purchaseExportRowsData = viewMode === "orders" ? purchaseOrderExportRows(snapshot, filteredGroups) : purchasePaymentExportRows(snapshot, filteredCompletedPayments);
  const purchaseExportTitle = viewMode === "orders" ? "Purchase Orders Report" : "Purchase Payments Report";
  const purchaseExportPrefix = viewMode === "orders" ? "purchase-orders" : "purchase-payments";

  useEffect(() => {
    if (allGroups.length === 0) return;
    if (datePreset === "today" && !hasTodayOrders) {
      if (hasYesterdayOrders) {
        setDatePreset("yesterday");
        setSelectedFromDate(yesterdayDate);
        setSelectedToDate(yesterdayDate);
      } else {
        setDatePreset("custom");
        setSelectedFromDate(latestAvailableDate);
        setSelectedToDate(latestAvailableDate);
      }
      return;
    }
    if (datePreset === "yesterday" && !hasYesterdayOrders) {
      if (hasTodayOrders) {
        setDatePreset("today");
        setSelectedFromDate(todayDate);
        setSelectedToDate(todayDate);
      } else {
        setDatePreset("custom");
        setSelectedFromDate(latestAvailableDate);
        setSelectedToDate(latestAvailableDate);
      }
    }
  }, [allGroups, datePreset, hasTodayOrders, hasYesterdayOrders, latestAvailableDate, todayDate, yesterdayDate]);

  return (
    <section className="collapse-stack">
      <div className="summary-switch-bar">
        <button className={viewMode === "orders" ? "tab-button active" : "tab-button"} type="button" onClick={() => setViewMode("orders")}>Orders</button>
        <button className={viewMode === "payments" ? "tab-button active" : "tab-button"} type="button" onClick={() => setViewMode("payments")}><LabelWithBadge label="Payments" count={paymentPendingCount} /></button>
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
        <label className="wide-field">Search PO / supplier<input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="PO number or supplier name" /></label>
      </div>
      <div className="payment-card-actions">
        <button className="ghost-button" type="button" onClick={() => downloadReportCsv(purchaseExportPrefix, purchaseExportHeaders, purchaseExportRowsData, activeRange.fromDate, activeRange.toDate)}>Download CSV</button>
        <button className="ghost-button" type="button" onClick={() => downloadReportPdf(purchaseExportTitle, purchaseExportPrefix, purchaseExportHeaders, purchaseExportRowsData, activeRange.fromDate, activeRange.toDate, [viewMode === "orders" ? `Orders: ${filteredGroups.length}` : `Payments: ${filteredCompletedPayments.length}`])}>Download PDF</button>
      </div>
      {viewMode === "orders" ? <>
      {groups.length > 0 ? <article className="list-card purchase-summary-stats">
        <div className="payment-meta-grid">
          <div><span className="small-label">Pickup queue</span><strong className="summary-stat-value"><span>Pickup pending</span><PendingBadge count={pickupPendingCount} /></strong></div>
          <div><span className="small-label">Warehouse queue</span><strong className="summary-stat-value"><span>Receiving</span><PendingBadge count={receivingPendingCount} /></strong></div>
          <div><span className="small-label">Accounts follow-up</span><strong className="summary-stat-value"><span>Payment pending</span><PendingBadge count={paymentPendingCount} /></strong></div>
        </div>
      </article> : null}
      {filteredGroups.length === 0 ? <Panel title="Purchases" eyebrow="Your purchase orders"><div className="empty-card">No purchase orders yet.</div></Panel> : <Panel title="Purchases" eyebrow="Your purchase orders">
        <div className="stack-list purchase-summary-scroll">
          {filteredGroups.map((group) => {
            const first = group.lines[0];
            const editState = currentUser ? purchaseCartEditState(snapshot, group.id, currentUser) : { editable: false, reason: "Open PO to update." };
            const expanded = openGroupId === group.id;
            return (
              <article className="list-card purchase-summary-card" key={group.id}>
                <button className="purchase-summary-toggle" type="button" onClick={() => setOpenGroupId((current) => current === group.id ? "" : group.id)}>
                  <div className="payment-update-head">
                    <div>
                      <strong>{first?.supplierName || "Supplier"}{group.lines.length > 1 ? ` +${group.lines.length - 1}` : ""}</strong>
                      <p>{group.id}</p>
                    </div>
                    <span className="status-pill">{expanded ? "Close" : "Open"}</span>
                  </div>
                  <div className="purchase-status-chips top-gap">
                    <span className="status-pill status-pending"><LabelWithBadge label="PO" count={1} /></span>
                    <span className={`status-pill ${statusPillClass(purchaseDeliveryStatus(snapshot, group.id))}`}>{purchaseDeliveryStatus(snapshot, group.id)}</span>
                    <span className={`status-pill ${statusPillClass(`Payment ${purchasePaymentStatus(snapshot, group.id)}`)}`}>{purchasePaymentStatus(snapshot, group.id)}</span>
                  </div>
                </button>
                {expanded ? <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Supplier</span><strong>{first?.supplierName || "Supplier"}</strong></div>
                  <div><span className="small-label">Products</span><strong>{productNamesSummary(snapshot.products, group.lines.map((line) => line.productSku))}</strong></div>
                  <div><span className="small-label">Mode</span><strong>{first?.deliveryMode || "-"}</strong></div>
                  <div><span className="small-label">Delivery</span><strong>{purchaseDeliveryStatus(snapshot, group.id)}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{purchasePaymentStatus(snapshot, group.id)}</strong></div>
                  <div><span className="small-label">Total</span><strong>{group.lines.reduce((sum, line) => sum + line.totalAmount, 0).toFixed(2)}</strong></div>
                  <div><span className="small-label">Warehouse</span><strong>{purchaseWarehouseStatus(group.lines)}</strong></div>
                  <div className="payment-card-actions wide-field top-gap">
                    {editState.editable && onUpdatePo ? <button className="primary-button" type="button" onClick={() => onUpdatePo(group.id)}>Update PO</button> : <span className="small-label">{editState.reason}</span>}
                    <button className="ghost-button" type="button" onClick={() => void printPurchaseInvoice(snapshot, group)}>Print PO</button>
                    <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, group)}>WhatsApp Share</button>
                    <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, group)}>Download PDF</button>
                  </div>
                  {onOpenStatus ? <div className="wide-field">
                    <OrderQrCard target={{ side: "Purchase", orderId: group.id }} title="PO status QR" onOpenStatus={onOpenStatus} />
                  </div> : null}
                </div> : null}
              </article>
            );
          })}
        </div>
      </Panel>}
      </> : <Panel title="Settled Payments" eyebrow="Purchase proofs">
        <div className="stack-list payment-update-list">
          {filteredCompletedPayments.length === 0 ? <div className="empty-card">No settled purchase payments yet.</div> : filteredCompletedPayments.map((payment) => {
            const order = findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId);
            const invoiceGroup = groupPurchaseOrders(snapshot.purchaseOrders).find((group) => group.id === payment.linkedOrderId);
            const proofUrl = payment.proofName ? `${API_BASE}/uploads/payment-proofs/${payment.proofName}` : "";
            const expanded = openPaymentId === payment.id;
            return <article className="list-card payment-update-card" key={payment.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{payment.linkedOrderId}</strong>
                  <p>{order?.supplierName || "Supplier"} · {payment.mode}</p>
                </div>
                <span className="status-pill status-completed">{payment.amount.toFixed(2)}</span>
              </div>
              <div className="payment-card-actions top-gap">
                <button className="ghost-button" type="button" onClick={() => setOpenPaymentId((current) => current === payment.id ? "" : payment.id)}>{expanded ? "Hide details" : "Expand"}</button>
              </div>
              {expanded ? <div className="payment-meta-grid top-gap">
                <div><span className="small-label">Payment</span><strong>{payment.verificationStatus}</strong></div>
                <div><span className="small-label">Reference</span><strong>{payment.referenceNumber || "Pending"}</strong></div>
                <div><span className="small-label">UTR</span><strong>{payment.utrNumber || "-"}</strong></div>
                <div><span className="small-label">Supplier</span><strong>{order?.supplierName || "Supplier"}</strong></div>
                <div className="wide-field"><span className="small-label">Note</span><strong>{payment.verificationNote || "No note"}</strong></div>
                <div className="payment-card-actions wide-field">
                  {proofUrl ? <a className="primary-button" href={proofUrl} target="_blank" rel="noreferrer">Open payment proof</a> : null}
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => void sharePurchaseInvoicePdf(snapshot, invoiceGroup)}>WhatsApp Share</button> : null}
                  {invoiceGroup ? <button className="ghost-button" type="button" onClick={() => downloadPurchaseInvoicePdf(snapshot, invoiceGroup)}>Download PDF</button> : null}
                </div>
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
              <p>Choose purchase from and to dates, then click done.</p>
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

export function PurchaseCartEditor({
  snapshot,
  currentUser,
  onUpdateCart,
  initialOrderId,
  onExit,
  onDirtyChange
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  initialOrderId?: string;
  onExit: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onUpdateCart: (orderId: string, body: {
    paymentMode: PaymentMode;
    cashTiming?: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      id?: string;
      productSku: string;
      warehouseId?: string;
      quantityOrdered: number;
      rate: number;
      taxableAmount: number;
      gstRate: "NA" | 0 | 5 | 12 | 18 | 40;
      gstAmount: number;
      taxMode: "NA" | "Exclusive" | "Inclusive";
    }>;
  }) => Promise<boolean | void>;
}) {
  const editableGroups = groupPurchaseOrders(
    snapshot.purchaseOrders.filter((order) =>
      isOpenPurchaseOrder(order) && (
      currentUser.role === "Admin"
      || userRoleList(currentUser).includes("Admin")
      || order.purchaserId === currentUser.id
      || order.purchaserName === currentUser.fullName
      )
    )
  ).sort((left, right) => groupOldestCreatedAt(left.lines) - groupOldestCreatedAt(right.lines));
  const [selectedOrderId, setSelectedOrderId] = useState(initialOrderId || editableGroups[0]?.id || "");
  const [draft, setDraft] = useState<{
    paymentMode: PaymentMode;
    cashTiming: string;
    deliveryMode: "Dealer Delivery" | "Self Collection";
    note: string;
    status: PurchaseOrder["status"];
    lines: Array<{
      clientKey: string;
      id?: string;
      productSku: string;
      warehouseId: string;
      quantityOrdered: string;
      rate: string;
      gstRate: GstRateInput;
      gstAmount: string;
      taxableAmount: string;
      taxMode: TaxModeInput;
    }>;
  } | null>(null);
  const [initialDraftState, setInitialDraftState] = useState("");

  const selectedGroup = editableGroups.find((group) => group.id === selectedOrderId) || (!selectedOrderId ? editableGroups[0] || null : null);
  const editState = selectedGroup ? purchaseCartEditState(snapshot, selectedGroup.id, currentUser) : { editable: false, reason: "No purchase carts available." };
  const draftDirty = Boolean(draft && initialDraftState && purchaseCartDraftSignature(draft) !== initialDraftState);

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
    if (!selectedOrderId) {
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
        quantityOrdered: String(line.quantityOrdered),
        rate: String(line.rate),
        gstRate: String(line.gstRate === "NA" ? 0 : line.gstRate || 0) as GstRateInput,
        gstAmount: String(line.gstAmount),
        taxableAmount: String(line.taxableAmount),
        taxMode: line.taxMode === "NA" ? "Exclusive" : ((line.taxMode || "Exclusive") as TaxModeInput)
      }))
    };
    setSelectedOrderId((current) => current || selectedGroup.id);
    setDraft(nextDraft);
    setInitialDraftState(purchaseCartDraftSignature(nextDraft));
  }, [selectedGroup?.id]);

  useEffect(() => {
    onDirtyChange(draftDirty);
  }, [draftDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function updateDraftLine(lineKey: string, updates: Partial<{
    productSku: string;
    quantityOrdered: string;
    rate: string;
    gstRate: GstRateInput;
    taxMode: TaxModeInput;
  }>) {
    onDirtyChange(true);
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        lines: current.lines.map((line) => {
          if (line.clientKey !== lineKey) return line;
          const productSku = updates.productSku ?? line.productSku;
          const quantityOrdered = updates.quantityOrdered ?? line.quantityOrdered;
          const rate = updates.rate ?? line.rate;
          const product = snapshot.products.find((item) => item.sku === productSku);
          const requestedGstRate = updates.gstRate ?? line.gstRate ?? String(product?.defaultGstRate === "NA" ? 0 : product?.defaultGstRate || 0) as GstRateInput;
          const gstRate = requestedGstRate === "NA" ? "0" : requestedGstRate;
          const fallbackTaxMode = product?.defaultTaxMode === "NA" ? "Exclusive" : (product?.defaultTaxMode || "Exclusive");
          const requestedTaxMode = updates.taxMode ?? (line.taxMode === "NA" ? fallbackTaxMode : line.taxMode);
          const taxMode = requestedTaxMode === "NA" ? "Exclusive" : requestedTaxMode;
          const totals = calculateTaxPreview(String(Math.max(0, Number(quantityOrdered || 0)) * Math.max(0, Number(rate || 0))), gstRate, taxMode);
          return {
            ...line,
            productSku,
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

  function addDraftLine() {
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
        clientKey: `po-${Date.now()}-${Math.random()}`,
        productSku: fallbackProduct.sku,
        warehouseId: selectedGroup.lines[0]?.warehouseId || "",
        quantityOrdered: "0",
        rate: "0",
        gstRate,
        gstAmount: totals.gstAmount,
        taxableAmount: totals.taxableAmount,
        taxMode
      }]
    } : current);
  }

  async function cancelPurchaseGroup() {
    if (!selectedGroup || !draft || !editState.editable) return;
    if (!window.confirm(`Cancel purchase order ${selectedGroup.id}?`)) return;
    const success = await onUpdateCart(selectedGroup.id, {
      paymentMode: draft.paymentMode,
      cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
      deliveryMode: draft.deliveryMode,
      note: draft.note?.trim() ? `${draft.note.trim()} | Cancelled from update PO.` : "Cancelled from update PO.",
      status: "Cancelled",
      lines: draft.lines.map((line) => ({
        id: line.id,
        productSku: line.productSku,
        warehouseId: line.warehouseId,
        quantityOrdered: Number(line.quantityOrdered || 0),
        rate: Number(line.rate || 0),
        taxableAmount: Number(line.taxableAmount || 0),
        gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
        gstAmount: Number(line.gstAmount || 0),
        taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode
      }))
    });
    if (success !== false) {
      onDirtyChange(false);
      onExit();
    }
  }

  return (
    <Panel title="Update Purchase Order" eyebrow="Product amendment only">
      {editableGroups.length === 0 ? <div className="empty-card">No purchase carts available for edit.</div> : <>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!selectedGroup || !draft || !editState.editable) return;
            const success = await onUpdateCart(selectedGroup.id, {
              paymentMode: draft.paymentMode,
              cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
              deliveryMode: draft.deliveryMode,
              note: draft.note,
              status: draft.status,
              lines: draft.lines.map((line) => ({
                id: line.id,
                productSku: line.productSku,
                warehouseId: line.warehouseId,
                quantityOrdered: Number(line.quantityOrdered || 0),
                rate: Number(line.rate || 0),
                taxableAmount: Number(line.taxableAmount || 0),
                gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
                gstAmount: Number(line.gstAmount || 0),
                taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode
              }))
            });
            if (success !== false) {
              onDirtyChange(false);
              onExit();
            }
          }}
        >
          <label className="wide-field">
            Purchase cart
            <select value={selectedGroup?.id || ""} onChange={(e) => {
              const nextOrderId = e.target.value;
              if (nextOrderId === selectedOrderId) return;
              if (!confirmDiscardChanges()) return;
              setSelectedOrderId(nextOrderId);
            }}>
              {editableGroups.map((group) => <option key={group.id} value={group.id}>{`${group.id} - ${group.lines[0]?.supplierName || "Supplier"}`}</option>)}
            </select>
          </label>
          {!selectedGroup && selectedOrderId ? <p className="message error wide-field">{`Purchase cart ${selectedOrderId} is not editable anymore. Open another PO from the list.`}</p> : null}
          {selectedGroup ? <>
            <div className="message-chip-grid wide-field">
              <span className="status-pill">{selectedGroup.lines[0]?.supplierName || "Supplier"}</span>
              <span className="status-pill">{selectedGroup.lines.length} product(s)</span>
              <span className="status-pill">{purchaseWorkflowStatus(snapshot, selectedGroup.id)}</span>
            </div>
            {!editState.editable ? <p className="message error wide-field">{editState.reason}</p> : null}
            <div className="payment-card-actions wide-field">
              <button className="ghost-button" type="button" onClick={() => {
                if (!confirmDiscardChanges()) return;
                onDirtyChange(false);
                onExit();
              }}>Back</button>
              <button className="ghost-button" type="button" onClick={addDraftLine} disabled={!editState.editable || snapshot.products.length === 0}>Add product</button>
              <button className="ghost-button" type="button" onClick={() => void cancelPurchaseGroup()} disabled={!editState.editable}>Cancel PO</button>
            </div>
            <div className="wide-field compact-order-editor">
              <div className="compact-order-editor-head">
                <span>Action</span>
                <span>Product</span>
                <span>Qty</span>
                <span>Rate</span>
              </div>
              {draft?.lines.map((line, index) => {
                return (
                  <div className="compact-order-editor-row" key={line.clientKey || line.id || `${line.productSku}-${index}`}>
                    <div className="compact-order-editor-actions">
                      <button className="ghost-button compact-icon-button" type="button" onClick={addDraftLine} disabled={!editState.editable || snapshot.products.length === 0} aria-label="Add product">+</button>
                      <button className="ghost-button compact-icon-button" type="button" onClick={() => { onDirtyChange(true); setDraft((current) => current ? { ...current, lines: current.lines.filter((item) => item !== line) } : current); }} disabled={!editState.editable || draft.lines.length <= 1} aria-label="Remove product">-</button>
                    </div>
                    <div className="compact-order-editor-product">
                      {!line.id ? <select value={line.productSku} onChange={(e) => updateDraftLine(line.clientKey, { productSku: e.target.value })} disabled={!editState.editable || Boolean(line.id)}>
                        {snapshot.products.map((product) => <option key={product.sku} value={product.sku}>{productDisplayLabel(product) || product.sku}</option>)}
                      </select> : <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>}
                    </div>
                    <input type="number" step="any" min="0" value={line.quantityOrdered} onChange={(e) => updateDraftLine(line.clientKey, { quantityOrdered: e.target.value })} disabled={!editState.editable} />
                    <input type="number" step="any" min="0" value={line.rate} onChange={(e) => updateDraftLine(line.clientKey, { rate: e.target.value })} disabled={!editState.editable} />
                  </div>
                );
              })}
            </div>
            <div className="payment-card-actions wide-field">
              <button className="primary-button" type="submit" disabled={!editState.editable}>Update purchase order</button>
            </div>
          </> : null}
        </form>
      </>}
    </Panel>
  );
}
