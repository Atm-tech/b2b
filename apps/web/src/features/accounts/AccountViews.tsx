import type {
AppSnapshot,
AppUser,
CashTiming,
PaymentMode
} from "@aapoorti-b2b/domain";
import { useEffect,useState } from "react";
import { renderOptions } from "../../app/formOptions";
import appLogo from "../../assets/group60.svg";
import { DataTable,Panel } from "../../components/ui";

import {
collectionAssignment,
dateRangeFileToken,
downloadCsvFile,
formatCurrencyInr,
formatShortDate,
formatShortNumber,
groupPurchaseOrders,
groupPurchaseRows,
groupSalesOrders,
groupSalesRows,
homeTaskCards,
indiaDateKey,
latestPurchasePayment,
latestSalesPayment,
normalizeDateRange,
productNameBySku,
purchaseLedgerByOrder,
purchaseOrderPublicTotal,
purchasePaymentStatus,
purchaseWorkflowStatus,
safePdfFileName,
salesOrderPublicTotal,
salesPaymentStatus,
statusPillClass,
ViewKey
} from "../../app/shared";

export function Overview({ snapshot, currentUser, simpleMode, onOpen, onOpenQrScanner, onDownloadSalesDsr, onUploadProof, onCreatePurchaseAdvance }: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  simpleMode: boolean;
  onOpen: (view: ViewKey) => void;
  onOpenQrScanner: () => void;
  onDownloadSalesDsr: () => void;
  onUploadProof: (file: File) => Promise<unknown>;
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
}) {
  const roles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
  if (roles.includes("Accounts") && !simpleMode) {
    return <AccountsOverview snapshot={snapshot} onOpen={onOpen} onCreatePurchaseAdvance={onCreatePurchaseAdvance} onUploadProof={onUploadProof} />;
  }
  const taskCards = homeTaskCards(snapshot, currentUser);
  const showDailySalesReport = roles.includes("Sales") || roles.includes("Collection Agent") || roles.includes("Out Delivery") || roles.includes("Delivery");
  const quickActions: Array<{ title: string; text: string; view: ViewKey }> = [];
  if (roles.includes("Admin")) {
    quickActions.push({ title: "Products", text: "Manage product master and pricing.", view: "Products" });
    quickActions.push({ title: "Users", text: "Create users and assign roles.", view: "Users" });
    quickActions.push({ title: "Check Stock", text: "See current warehouse stock.", view: "Stock" });
    quickActions.push({ title: "MIS", text: "Review purchase, sales and payment summaries.", view: "Overview" });
  }
  if (roles.includes("Purchaser")) {
    quickActions.push({ title: "New Purchase", text: "Select supplier and place order.", view: "Purchase" });
    quickActions.push({ title: "Purchase Return", text: "Return items to supplier.", view: "PurchaseReturns" });
    quickActions.push({ title: "Create Parties", text: "Register a supplier first.", view: "Parties" });
  }
  if (roles.includes("Sales")) {
    quickActions.push({ title: "New Sale", text: "Select shop and book order.", view: "Sales" });
    quickActions.push({ title: "Sales Return", text: "Receive items back from customer.", view: "SalesReturns" });
    quickActions.push({ title: "Create Parties", text: "Register a shop first.", view: "Parties" });
  }
  if (roles.includes("Warehouse Manager")) {
    quickActions.push({ title: "Receive Goods", text: "Check and receive stock.", view: "Receipts" });
    quickActions.push({ title: "See Stock", text: "View available stock.", view: "Stock" });
  }
  if (roles.includes("Delivery Manager")) {
    quickActions.push({ title: "Manage Delivery", text: "Bundle dockets and assign teams.", view: "Delivery" });
  }
  if (roles.includes("Accounts")) {
    quickActions.push({ title: "Check Payments", text: "Verify payment records.", view: "Payments" });
    quickActions.push({ title: "Supplier Advance", text: "Post advance payment for an existing supplier.", view: "Payments" });
    quickActions.push({ title: "Check Ledger", text: "See pending and settled amounts.", view: "Ledger" });
  }
  if (roles.includes("Collection Agent")) {
    quickActions.push({ title: "Collect Cash", text: "Search unpaid sales orders and record collections.", view: "SalesOrders" });
    quickActions.push({ title: "Sales Report", text: "See customer orders before collection.", view: "SalesOrders" });
  }
  if (roles.includes("Data Analyst")) {
    quickActions.push({ title: "Purchase Report", text: "See all purchase orders in a simple table.", view: "Purchases" });
    quickActions.push({ title: "Sales Report", text: "See all sales orders in a simple table.", view: "SalesOrders" });
    quickActions.push({ title: "Inventory Report", text: "See stock and lot balances with CSV download.", view: "Stock" });
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
            {showDailySalesReport ? <button type="button" className="simple-action-card" onClick={onDownloadSalesDsr}>
              <strong>Daily Sales PDF</strong>
              <span>Download today&apos;s scoped DSR for your role.</span>
            </button> : null}
            <button type="button" className="simple-action-card" onClick={onOpenQrScanner}>
              <strong>Scan Order QR</strong>
              <span>Open PO or SO status and jump to the pending action.</span>
            </button>
          </div>
        </Panel>
        <Panel title="Today" eyebrow="Quick summary">
          <div className="simple-summary">
            {taskCards.map((card) => <div className="list-card" key={card.label}><div><strong>{card.value}</strong><p>{card.label}</p></div></div>)}
          </div>
        </Panel>
      </section>
    );
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Task Summary" eyebrow="Home">
        <div className="simple-summary payment-summary-grid">
          {taskCards.map((card) => <div className="list-card" key={card.label}><div><strong>{card.value}</strong><p>{card.label}</p></div></div>)}
        </div>
        <div className="payment-card-actions top-gap">
          <button className="ghost-button" type="button" onClick={onOpenQrScanner}>Scan Order QR</button>
          {showDailySalesReport ? <button className="ghost-button" type="button" onClick={onDownloadSalesDsr}>Daily Sales PDF</button> : null}
        </div>
      </Panel>
      <Panel title="Purchase Orders" eyebrow="Inbound"><DataTable headers={["PO","Supplier","Product","Ordered","Received","Status"]} rows={snapshot.purchaseOrders.map((p) => [p.id, p.supplierName, p.productSku, p.quantityOrdered, p.quantityReceived, p.status])} /></Panel>
      <Panel title="Sales Orders" eyebrow="Outbound"><DataTable headers={["SO","Shop","Product","Qty","Delivery","Status"]} rows={snapshot.salesOrders.map((s) => [s.id, s.shopName, productNameBySku(snapshot.products, s.productSku), s.quantity, s.deliveryMode, s.status])} /></Panel>
      <Panel title="Payment Verification" eyebrow="Accounts"><DataTable headers={["Payment","Side","Order","Mode","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.mode, p.verificationStatus])} /></Panel>
      <Panel title="Stock Snapshot" eyebrow="Warehouse"><DataTable headers={["Warehouse","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>
    </section>
  );
}

export function AccountsOverviewLegacy({ snapshot, onOpen }: { snapshot: AppSnapshot; onOpen: (view: ViewKey) => void }) {
  const [expandedSummaryCard, setExpandedSummaryCard] = useState<"purchase" | "sales" | "pnl" | "stock" | "">("");
  const purchaseGroups = groupPurchaseOrders(snapshot.purchaseOrders);
  const salesGroups = groupSalesOrders(snapshot.salesOrders);
  const pendingPayments = snapshot.payments
    .filter((payment) => payment.verificationStatus !== "Verified" && payment.verificationStatus !== "Resolved")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const flaggedPayments = snapshot.payments
    .filter((payment) => payment.verificationStatus === "Disputed" || payment.verificationStatus === "Rejected")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const verifiedPurchaseCashOut = snapshot.payments
    .filter((payment) => payment.side === "Purchase" && (payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved"))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const verifiedSalesCashIn = snapshot.payments
    .filter((payment) => payment.side === "Sales" && (payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved"))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const purchasePending = snapshot.ledgerEntries
    .filter((entry) => entry.side === "Purchase")
    .reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const salesPending = snapshot.ledgerEntries
    .filter((entry) => entry.side === "Sales")
    .reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const inventoryAvailable = snapshot.stockSummary.reduce((sum, item) => sum + item.availableQuantity, 0);
  const inventoryBlocked = snapshot.stockSummary.reduce((sum, item) => sum + item.blockedQuantity, 0);
  const inventoryReserved = snapshot.stockSummary.reduce((sum, item) => sum + item.reservedQuantity, 0);
  const inboundUnits = snapshot.receiptChecks.reduce((sum, item) => sum + item.receivedQuantity, 0);
  const outboundUnits = snapshot.salesOrders
    .filter((order) => order.status === "Out for Delivery" || order.status === "Delivered" || order.status === "Closed")
    .reduce((sum, order) => sum + order.quantity, 0);
  const totalPurchaseValue = snapshot.purchaseOrders.reduce((sum, order) => sum + order.totalAmount, 0);
  const totalSalesValue = snapshot.salesOrders.reduce((sum, order) => sum + order.totalAmount + order.deliveryCharge, 0);
  const totalPnLValue = totalSalesValue - totalPurchaseValue;
  const latestPurchaseRateBySku = new Map<string, number>();
  [...snapshot.purchaseOrders]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .forEach((order) => {
      if (!latestPurchaseRateBySku.has(order.productSku)) latestPurchaseRateBySku.set(order.productSku, order.rate);
    });
  const stockValue = snapshot.stockSummary.reduce((sum, item) => {
    const units = item.availableQuantity + item.reservedQuantity + item.blockedQuantity;
    return sum + units * (latestPurchaseRateBySku.get(item.productSku) || 0);
  }, 0);
  const openPurchaseCount = purchaseGroups.filter((group) => purchaseWorkflowStatus(snapshot, group.id).includes("Pending") || purchaseWorkflowStatus(snapshot, group.id).includes("Partial") || purchaseWorkflowStatus(snapshot, group.id).includes("Flagged") || purchaseWorkflowStatus(snapshot, group.id).includes("Disputed")).length;
  const openSalesCollections = salesGroups.filter((group) => salesPaymentStatus(snapshot, group.id) !== "Completed").length;
  const paymentAlerts = [
    { label: "Pending proofs", count: pendingPayments.length, tone: "pending" },
    { label: "Disputes", count: flaggedPayments.length, tone: flaggedPayments.length > 0 ? "danger" : "good" },
    { label: "Supplier dues", count: snapshot.ledgerEntries.filter((entry) => entry.side === "Purchase" && entry.pendingAmount > 0).length, tone: "pending" },
    { label: "Customer collections", count: snapshot.ledgerEntries.filter((entry) => entry.side === "Sales" && entry.pendingAmount > 0).length, tone: "good" }
  ];
  const liveQueue = [
    ...purchaseGroups
      .map((group) => {
        const ledger = purchaseLedgerByOrder(snapshot, group.id);
        const latest = latestPurchasePayment(snapshot, group.id);
        return {
          type: "Pay supplier",
          party: group.lines[0]?.supplierName || "Supplier",
          orderId: group.id,
          amount: ledger?.pendingAmount || purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id),
          status: purchasePaymentStatus(snapshot, group.id),
          date: latest?.createdAt || group.lines[0]?.createdAt || "",
          view: "Payments" as ViewKey
        };
      })
      .filter((item) => item.amount > 0),
    ...salesGroups
      .map((group) => {
        const ledger = snapshot.ledgerEntries.find((entry) => entry.side === "Sales" && entry.linkedOrderId === group.id);
        const latest = latestSalesPayment(snapshot, group.id);
        return {
          type: "Collect customer",
          party: group.lines[0]?.shopName || "Customer",
          orderId: group.id,
          amount: ledger?.pendingAmount || salesOrderPublicTotal(snapshot.salesOrders, group.id),
          status: salesPaymentStatus(snapshot, group.id),
          date: latest?.createdAt || group.lines[0]?.createdAt || "",
          view: "SalesOrders" as ViewKey
        };
      })
      .filter((item) => item.amount > 0)
  ]
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 6);
  const topProducts = [...snapshot.stockSummary]
    .sort((left, right) => (right.availableQuantity + right.blockedQuantity) - (left.availableQuantity + left.blockedQuantity))
    .slice(0, 6);
  const summaryCards = [
    {
      id: "purchase" as const,
      eyebrow: "Purchase",
      title: "Total Purchase",
      value: formatCurrencyInr(totalPurchaseValue),
      tone: "danger",
      detail: [
        { label: "PO lines", value: String(snapshot.purchaseOrders.length) },
        { label: "PO groups", value: String(purchaseGroups.length) },
        { label: "Pending due", value: formatCurrencyInr(purchasePending) },
        { label: "Verified payout", value: formatCurrencyInr(verifiedPurchaseCashOut) }
      ],
      action: "Purchases" as ViewKey
    },
    {
      id: "sales" as const,
      eyebrow: "Sales",
      title: "Total Sales",
      value: formatCurrencyInr(totalSalesValue),
      tone: "good",
      detail: [
        { label: "SO lines", value: String(snapshot.salesOrders.length) },
        { label: "SO groups", value: String(salesGroups.length) },
        { label: "Pending collection", value: formatCurrencyInr(salesPending) },
        { label: "Verified receipt", value: formatCurrencyInr(verifiedSalesCashIn) }
      ],
      action: "SalesOrders" as ViewKey
    },
    {
      id: "pnl" as const,
      eyebrow: "P&L",
      title: "Spread",
      value: formatCurrencyInr(totalPnLValue),
      tone: totalPnLValue >= 0 ? "good" : "danger",
      detail: [
        { label: "Sales billed", value: formatCurrencyInr(totalSalesValue) },
        { label: "Purchase billed", value: formatCurrencyInr(totalPurchaseValue) },
        { label: "Net realized cash", value: formatCurrencyInr(verifiedSalesCashIn - verifiedPurchaseCashOut) },
        { label: "Net outstanding", value: formatCurrencyInr(salesPending - purchasePending) }
      ],
      action: "Ledger" as ViewKey
    },
    {
      id: "stock" as const,
      eyebrow: "Stock",
      title: "Stock Value",
      value: formatCurrencyInr(stockValue),
      tone: "pending",
      detail: [
        { label: "Available units", value: formatShortNumber(inventoryAvailable) },
        { label: "Reserved units", value: formatShortNumber(inventoryReserved) },
        { label: "Blocked units", value: formatShortNumber(inventoryBlocked) },
        { label: "Products live", value: String(snapshot.products.length) }
      ],
      action: "Stock" as ViewKey
    }
  ];

  return (
    <section className="dashboard-grid accounts-home-grid">
      <article className="panel accounts-hero-panel">
        <div className="accounts-hero-copy">
          <span className="eyebrow">Accounts Command</span>
          <h2>Cash, stock, and payment visibility in one pass.</h2>
          <p>Track supplier payouts, customer collections, stock movement, and payment exceptions before they spill into operations.</p>
        </div>
        <div className="accounts-hero-actions">
          <button className="primary-button" type="button" onClick={() => onOpen("Payments")}>Open payment desk</button>
          <button className="ghost-button" type="button" onClick={() => onOpen("Ledger")}>Open ledger</button>
        </div>
        <div className="accounts-notification-strip">
          {paymentAlerts.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`accounts-alert-chip tone-${item.tone}`}
              onClick={() => onOpen(item.label === "Customer collections" ? "SalesOrders" : "Payments")}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
      </article>

      <article className="panel accounts-summary-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Summary Deck</span>
            <h2>Headline accounting numbers</h2>
          </div>
        </div>
        <div className="accounts-summary-grid">
          {summaryCards.map((card) => {
            const expanded = expandedSummaryCard === card.id;
            return (
              <article
                key={card.id}
                className={`accounts-summary-card tone-${card.tone}${expanded ? " expanded" : ""}`}
                onClick={() => setExpandedSummaryCard((current) => current === card.id ? "" : card.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setExpandedSummaryCard((current) => current === card.id ? "" : card.id);
                  }
                }}
              >
                <span className="small-label">{card.eyebrow}</span>
                <strong>{card.title}</strong>
                <h3>{card.value}</h3>
                <p>{expanded ? "Tap to collapse" : "Tap to expand"}</p>
                {expanded ? <div className="accounts-summary-detail">
                  {card.detail.map((item) => (
                    <div key={item.label}>
                      <span className="small-label">{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                  <button className="ghost-button" type="button" onClick={(event) => { event.stopPropagation(); onOpen(card.action); }}>Open detail</button>
                </div> : null}
              </article>
            );
          })}
        </div>
      </article>

      <article className="panel accounts-cashflow-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Cashflow</span>
            <h2>Money position</h2>
          </div>
        </div>
        <div className="accounts-kpi-band">
          <div className="accounts-kpi-card tone-good">
            <span className="small-label">Sales cash in</span>
            <strong>{formatCurrencyInr(verifiedSalesCashIn)}</strong>
            <p>Verified receipts from customers.</p>
          </div>
          <div className="accounts-kpi-card tone-danger">
            <span className="small-label">Purchase cash out</span>
            <strong>{formatCurrencyInr(verifiedPurchaseCashOut)}</strong>
            <p>Verified supplier payments.</p>
          </div>
          <div className="accounts-kpi-card tone-pending">
            <span className="small-label">Receivables open</span>
            <strong>{formatCurrencyInr(salesPending)}</strong>
            <p>Customer money still pending.</p>
          </div>
          <div className="accounts-kpi-card tone-pending">
            <span className="small-label">Payables open</span>
            <strong>{formatCurrencyInr(purchasePending)}</strong>
            <p>Supplier dues still pending.</p>
          </div>
        </div>
        <div className="accounts-balance-bar">
          <div>
            <span className="small-label">Net realized cash</span>
            <strong>{formatCurrencyInr(verifiedSalesCashIn - verifiedPurchaseCashOut)}</strong>
          </div>
          <div>
            <span className="small-label">Net outstanding</span>
            <strong>{formatCurrencyInr(salesPending - purchasePending)}</strong>
          </div>
        </div>
      </article>

      <article className="panel accounts-flow-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Product Flow</span>
            <h2>Material movement</h2>
          </div>
        </div>
        <div className="accounts-flow-grid">
          <div className="accounts-flow-card">
            <span className="small-label">Inbound units</span>
            <strong>{formatShortNumber(inboundUnits)}</strong>
            <p>Units received through GRC and warehouse checks.</p>
          </div>
          <div className="accounts-flow-card">
            <span className="small-label">Outbound units</span>
            <strong>{formatShortNumber(outboundUnits)}</strong>
            <p>Units already handed to dispatch or delivered.</p>
          </div>
          <div className="accounts-flow-card">
            <span className="small-label">Available stock</span>
            <strong>{formatShortNumber(inventoryAvailable)}</strong>
            <p>Ready inventory across active godowns.</p>
          </div>
          <div className="accounts-flow-card">
            <span className="small-label">Blocked stock</span>
            <strong>{formatShortNumber(inventoryBlocked)}</strong>
            <p>Held back from sale or release.</p>
          </div>
        </div>
      </article>

      <Panel title="Priority Queue" eyebrow="Follow-up first">
        <div className="accounts-priority-list">
          {liveQueue.length === 0 ? <div className="empty-card">No pending accounting queue.</div> : liveQueue.map((item) => (
            <button key={`${item.type}-${item.orderId}`} type="button" className="accounts-priority-card" onClick={() => onOpen(item.view)}>
              <div className="accounts-priority-main">
                <span className="small-label">{item.type}</span>
                <strong>{item.party}</strong>
                <p>{item.orderId}</p>
              </div>
              <div className="accounts-priority-meta">
                <span className={`status-pill ${statusPillClass(item.status)}`}>{item.status}</span>
                <strong>{formatCurrencyInr(item.amount)}</strong>
                <span>{formatShortDate(item.date)}</span>
              </div>
            </button>
          ))}
        </div>
      </Panel>

      <Panel title="Payment Attention" eyebrow="Notifications">
        <div className="accounts-payment-feed">
          {pendingPayments.slice(0, 8).map((payment) => (
            <div className="accounts-payment-card" key={payment.id}>
              <div>
                <span className="small-label">{payment.side}</span>
                <strong>{payment.linkedOrderId}</strong>
                <p>{payment.mode} • {payment.referenceNumber || "No reference"}</p>
              </div>
              <div className="accounts-payment-meta">
                <span className={`status-pill ${statusPillClass(payment.verificationStatus)}`}>{payment.verificationStatus}</span>
                <strong>{formatCurrencyInr(payment.amount)}</strong>
                <span>{formatShortDate(payment.createdAt)}</span>
              </div>
            </div>
          ))}
          {pendingPayments.length === 0 ? <div className="empty-card">No pending payment notifications.</div> : null}
        </div>
      </Panel>

      <Panel title="Heavy Stock Positions" eyebrow="Product exposure">
        <div className="accounts-stock-list">
          {topProducts.length === 0 ? <div className="empty-card">No stock loaded.</div> : topProducts.map((item) => (
            <div className="accounts-stock-card" key={`${item.warehouseId}-${item.productSku}`}>
              <div>
                <span className="small-label">{item.warehouseName}</span>
                <strong>{item.productName}</strong>
                <p>{item.productSku}</p>
              </div>
              <div className="accounts-stock-meta">
                <span>Avail {formatShortNumber(item.availableQuantity)}</span>
                <span>Blocked {formatShortNumber(item.blockedQuantity)}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>

      <article className="panel accounts-bottom-band">
        <div className="accounts-mini-stat">
          <span className="small-label">Open purchase groups</span>
          <strong>{openPurchaseCount}</strong>
        </div>
        <div className="accounts-mini-stat">
          <span className="small-label">Open sales collections</span>
          <strong>{openSalesCollections}</strong>
        </div>
        <div className="accounts-mini-stat">
          <span className="small-label">Products live</span>
          <strong>{snapshot.products.length}</strong>
        </div>
        <div className="accounts-mini-stat">
          <span className="small-label">Suppliers live</span>
          <strong>{snapshot.counterparties.filter((item) => item.type === "Supplier").length}</strong>
        </div>
      </article>
    </section>
  );
}

export function AccountsLedgerView({ snapshot }: { snapshot: AppSnapshot }) {
  const [searchText, setSearchText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const openEntries = snapshot.ledgerEntries
    .filter((entry) => entry.pendingAmount > 0)
    .sort((left, right) => right.pendingAmount - left.pendingAmount || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const groupedParties = Array.from(openEntries.reduce((map, entry) => {
    const key = `${entry.side}:${entry.partyName}`;
    const current = map.get(key) || { key, side: entry.side, partyName: entry.partyName, entries: [] as typeof openEntries };
    current.entries.push(entry);
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; side: "Purchase" | "Sales"; partyName: string; entries: typeof openEntries }>())
    .values())
    .map((group) => ({
      ...group,
      totalGoods: group.entries.reduce((sum, entry) => sum + entry.goodsValue, 0),
      totalPaid: group.entries.reduce((sum, entry) => sum + entry.paidAmount, 0),
      totalPending: group.entries.reduce((sum, entry) => sum + entry.pendingAmount, 0)
    }))
    .filter((group) => `${group.partyName} ${group.side}`.toLowerCase().includes(searchText.trim().toLowerCase()))
    .sort((left, right) => right.totalPending - left.totalPending || left.partyName.localeCompare(right.partyName, "en-IN"));
  const visibleGroups = showAll ? groupedParties : groupedParties.slice(0, 8);

  function partyCsvRows(group: typeof groupedParties[number]) {
    return group.entries.map((entry) => [
      entry.side,
      entry.linkedOrderId,
      entry.partyName,
      entry.goodsValue,
      entry.paidAmount,
      entry.pendingAmount,
      formatShortDate(entry.createdAt)
    ]);
  }

  return <section className="collapse-stack">
    <Panel title="Ledger" eyebrow="Open party balances">
      <div className="form-grid">
        <label className="wide-field">Search party
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Party name or side" />
        </label>
      </div>
      <div className="payment-card-actions top-gap">
        <button className="ghost-button" type="button" onClick={() => downloadCsvFile("open-ledger-parties.csv", ["Side", "Order", "Party", "Goods", "Paid", "Pending", "Created"], visibleGroups.flatMap((group) => partyCsvRows(group)))}>Download visible CSV</button>
        {groupedParties.length > 8 ? <button className="ghost-button" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show top 8" : "Show all parties"}</button> : null}
      </div>
      <div className="stack-list payment-update-list top-gap">
        {visibleGroups.length === 0 ? <div className="empty-card">No open parties found.</div> : visibleGroups.map((group) => <article className="list-card payment-update-card" key={group.key}>
          <div className="payment-update-head">
            <div>
              <strong>{group.partyName}</strong>
              <p>{group.side === "Purchase" ? "Supplier ledger" : "Customer ledger"} · {group.entries.length} open order(s)</p>
            </div>
            <span className={`status-pill ${statusPillClass("Pending")}`}>{formatCurrencyInr(group.totalPending)}</span>
          </div>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Goods</span><strong>{formatCurrencyInr(group.totalGoods)}</strong></div>
            <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(group.totalPaid)}</strong></div>
            <div><span className="small-label">Pending</span><strong>{formatCurrencyInr(group.totalPending)}</strong></div>
            <div><span className="small-label">Orders</span><strong>{group.entries.length}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="ghost-button" type="button" onClick={() => downloadCsvFile(safePdfFileName(`${group.partyName}-${group.side}-ledger.csv`), ["Side", "Order", "Party", "Goods", "Paid", "Pending", "Created"], partyCsvRows(group))}>Download CSV</button>
          </div>
        </article>)}
      </div>
    </Panel>
      <Panel title="Order Financial State" eyebrow="Pending vs settled">
        <DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...groupPurchaseRows(snapshot.purchaseOrders).map((row) => ["Purchase", row[0], row[6]]), ...groupSalesRows(snapshot.salesOrders).map((row) => ["Sales", row[0], row[6]])]} />
      </Panel>
  </section>;
}

export function AccountsLedgerWorkspace({ snapshot }: { snapshot: AppSnapshot }) {
  const [searchText, setSearchText] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [openPartyKey, setOpenPartyKey] = useState("");
  const [activeTab, setActiveTab] = useState<"ledger" | "probationary">("ledger");
  const [probationaryRange, setProbationaryRange] = useState<"today" | "week" | "custom">("today");
  const [probationaryFromDate, setProbationaryFromDate] = useState(indiaDateKey());
  const [probationaryToDate, setProbationaryToDate] = useState(indiaDateKey());
  const [probationaryStatusFilter, setProbationaryStatusFilter] = useState<"Pending" | "Cleared" | "All">("Pending");
  const normalizedSearch = searchText.trim().toLowerCase();
  const sourceEntries = (normalizedSearch ? snapshot.ledgerEntries : snapshot.ledgerEntries.filter((entry) => entry.pendingAmount > 0))
    .sort((left, right) => right.pendingAmount - left.pendingAmount || new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const groupedParties = Array.from(sourceEntries.reduce((map, entry) => {
    const key = `${entry.side}:${entry.partyName}`;
    const current = map.get(key) || { key, side: entry.side, partyName: entry.partyName, entries: [] as typeof sourceEntries };
    current.entries.push(entry);
    map.set(key, current);
    return map;
  }, new Map<string, { key: string; side: "Purchase" | "Sales"; partyName: string; entries: typeof sourceEntries }>())
    .values())
    .map((group) => ({
      ...group,
      totalGoods: group.entries.reduce((sum, entry) => sum + entry.goodsValue, 0),
      totalPaid: group.entries.reduce((sum, entry) => sum + entry.paidAmount, 0),
      totalPending: group.entries.reduce((sum, entry) => sum + entry.pendingAmount, 0)
    }))
    .filter((group) => !normalizedSearch || `${group.partyName} ${group.side} ${group.entries.map((entry) => entry.linkedOrderId).join(" ")}`.toLowerCase().includes(normalizedSearch))
    .sort((left, right) => right.totalPending - left.totalPending || left.partyName.localeCompare(right.partyName, "en-IN"));
  const visibleGroups = showAll ? groupedParties : groupedParties.slice(0, 6);

  function partyCsvRows(group: typeof groupedParties[number]) {
    return group.entries.map((entry) => [
      entry.side,
      entry.linkedOrderId,
      entry.partyName,
      entry.goodsValue,
      entry.paidAmount,
      entry.pendingAmount,
      formatShortDate(entry.createdAt)
    ]);
  }

  const todayDate = indiaDateKey();
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const weekStartKey = indiaDateKey(weekStart);
  const probationaryRangeValues = probationaryRange === "today"
    ? normalizeDateRange(todayDate, todayDate)
    : probationaryRange === "week"
      ? normalizeDateRange(weekStartKey, todayDate)
      : normalizeDateRange(probationaryFromDate, probationaryToDate);
  const probationaryRows = snapshot.probationarySales
    .filter((item) => {
      const created = indiaDateKey(item.createdAt);
      const matchesDate = created >= probationaryRangeValues.fromDate && created <= probationaryRangeValues.toDate;
      const matchesStatus = probationaryStatusFilter === "All" || item.status === probationaryStatusFilter;
      const matchesSearch = !normalizedSearch || [
        item.salesCartId,
        item.salesOrderId,
        item.shopName,
        item.salesmanName,
        item.productSku,
        item.warehouseId
      ].filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
      return matchesDate && matchesStatus && matchesSearch;
    })
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const probationarySummary = {
    totalShortage: probationaryRows.reduce((sum, item) => sum + item.pendingProbationaryQuantity, 0),
    totalOriginal: probationaryRows.reduce((sum, item) => sum + item.originalProbationaryQuantity, 0),
    totalValue: probationaryRows.reduce((sum, item) => sum + item.totalAmount, 0),
    uniqueOrders: new Set(probationaryRows.map((item) => item.salesCartId || item.salesOrderId)).size
  };
  const probationaryCsvRows = probationaryRows.map((item) => [
    formatShortDate(item.createdAt),
    item.salesCartId || item.salesOrderId,
    item.salesOrderId,
    item.shopName,
    item.salesmanName,
    item.warehouseId,
    item.productSku,
    item.availableQuantityAtSale,
    item.soldQuantity,
    item.originalProbationaryQuantity,
    item.pendingProbationaryQuantity,
    item.rate,
    item.totalAmount,
    item.status,
    item.clearedAt ? formatShortDate(item.clearedAt) : "",
    item.note
  ]);

  useEffect(() => {
    if (visibleGroups.length === 0) {
      if (openPartyKey) setOpenPartyKey("");
      return;
    }
    if (!visibleGroups.some((group) => group.key === openPartyKey)) {
      setOpenPartyKey(visibleGroups[0].key);
    }
  }, [visibleGroups, openPartyKey]);

  return <section className="collapse-stack">
    <div className="payment-card-actions">
      <button type="button" className={activeTab === "ledger" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("ledger")}>Open ledger</button>
      <button type="button" className={activeTab === "probationary" ? "primary-button" : "ghost-button"} onClick={() => setActiveTab("probationary")}>Probationary sales</button>
    </div>
    {activeTab === "probationary" ? <Panel title="Probationary Sales" eyebrow="Extra sold quantity waiting for stock cover">
      <div className="form-grid">
        <label className="wide-field">Search
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Order, customer, salesman, SKU, or warehouse" />
        </label>
        <label>Range
          <select value={probationaryRange} onChange={(e) => setProbationaryRange(e.target.value as "today" | "week" | "custom")}>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>Status
          <select value={probationaryStatusFilter} onChange={(e) => setProbationaryStatusFilter(e.target.value as "Pending" | "Cleared" | "All")}>
            <option value="Pending">Pending</option>
            <option value="Cleared">Cleared</option>
            <option value="All">All</option>
          </select>
        </label>
        {probationaryRange === "custom" ? <label>From
          <input type="date" value={probationaryFromDate} onChange={(e) => setProbationaryFromDate(e.target.value)} />
        </label> : null}
        {probationaryRange === "custom" ? <label>To
          <input type="date" value={probationaryToDate} onChange={(e) => setProbationaryToDate(e.target.value)} />
        </label> : null}
      </div>
      <div className="payment-meta-grid top-gap">
        <div><span className="small-label">Records</span><strong>{probationaryRows.length}</strong></div>
        <div><span className="small-label">Affected orders</span><strong>{probationarySummary.uniqueOrders}</strong></div>
        <div><span className="small-label">Original qty</span><strong>{probationarySummary.totalOriginal}</strong></div>
        <div><span className="small-label">Pending qty</span><strong>{probationarySummary.totalShortage}</strong></div>
        <div><span className="small-label">Probationary value</span><strong>{formatCurrencyInr(probationarySummary.totalValue)}</strong></div>
      </div>
      <div className="payment-card-actions top-gap">
        <button className="ghost-button" type="button" onClick={() => downloadCsvFile(`probationary-sales-${dateRangeFileToken(probationaryRangeValues.fromDate, probationaryRangeValues.toDate)}.csv`, ["Date", "Sales Cart", "Sales Order", "Customer", "Salesman", "Warehouse", "SKU", "Available At Sale", "Sold Qty", "Original Probationary Qty", "Pending Probationary Qty", "Rate", "Probationary Value", "Status", "Cleared At", "Note"], probationaryCsvRows)}>Download CSV</button>
      </div>
      {probationaryRows.length === 0 ? <div className="empty-card top-gap">No probationary sales matched this filter.</div> : <DataTable headers={["Date", "Sales Cart", "Customer", "Salesman", "Warehouse", "SKU", "Avail", "Sold", "Original", "Pending", "Status", "Cleared", "Value"]} rows={probationaryRows.map((item) => [formatShortDate(item.createdAt), item.salesCartId || item.salesOrderId, item.shopName, item.salesmanName, item.warehouseId, item.productSku, item.availableQuantityAtSale, item.soldQuantity, item.originalProbationaryQuantity, item.pendingProbationaryQuantity, item.status, item.clearedAt ? formatShortDate(item.clearedAt) : "-", item.totalAmount])} />}
    </Panel> : null}
    {activeTab === "ledger" ? <>
    <Panel title="Ledger" eyebrow={normalizedSearch ? "Full party ledger" : "Open party balances"}>
      <div className="form-grid">
        <label className="wide-field">Search party
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Party name, side, or order id" />
        </label>
      </div>
      <div className="payment-card-actions top-gap">
        <button className="ghost-button" type="button" onClick={() => downloadCsvFile(normalizedSearch ? "party-ledger-search.csv" : "open-ledger-parties.csv", ["Side", "Order", "Party", "Goods", "Paid", "Pending", "Created"], visibleGroups.flatMap((group) => partyCsvRows(group)))}>Download visible CSV</button>
        {groupedParties.length > 6 ? <button className="ghost-button" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? "Show top 6" : "Show all parties"}</button> : null}
      </div>
      <div className="stack-list payment-update-list top-gap">
        {visibleGroups.length === 0 ? <div className="empty-card">{normalizedSearch ? "No party matched the search." : "No open parties found."}</div> : visibleGroups.map((group) => <article className="list-card payment-update-card" key={group.key}>
          <div className="payment-update-head">
            <div>
              <strong>{group.partyName}</strong>
              <p>{group.side === "Purchase" ? "Supplier ledger" : "Customer ledger"} | {group.entries.length} {normalizedSearch ? (group.entries.length === 1 ? "ledger entry" : "ledger entries") : (group.entries.length === 1 ? "open order" : "open orders")}</p>
            </div>
            <span className={`status-pill ${statusPillClass(group.totalPending <= 0 ? "Completed" : "Pending")}`}>{formatCurrencyInr(group.totalPending)}</span>
          </div>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Goods</span><strong>{formatCurrencyInr(group.totalGoods)}</strong></div>
            <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(group.totalPaid)}</strong></div>
            <div><span className="small-label">Pending</span><strong>{formatCurrencyInr(group.totalPending)}</strong></div>
            <div><span className="small-label">Orders</span><strong>{group.entries.length}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="ghost-button" type="button" onClick={() => setOpenPartyKey((current) => current === group.key ? "" : group.key)}>{openPartyKey === group.key ? "Hide party" : "Open party"}</button>
            <button className="ghost-button" type="button" onClick={() => downloadCsvFile(safePdfFileName(`${group.partyName}-${group.side}-ledger.csv`), ["Side", "Order", "Party", "Goods", "Paid", "Pending", "Created"], partyCsvRows(group))}>Download CSV</button>
          </div>
          {openPartyKey === group.key ? <div className="stack-list top-gap">
            {group.entries.map((entry) => <article className="list-card" key={entry.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{entry.linkedOrderId}</strong>
                  <p>{formatShortDate(entry.createdAt)} | {entry.side}</p>
                </div>
                <span className={`status-pill ${statusPillClass(entry.pendingAmount <= 0 ? "Completed" : entry.paidAmount > 0 ? "Partial" : "Pending")}`}>
                  {entry.pendingAmount <= 0 ? "Settled" : entry.paidAmount > 0 ? "Partial" : "Pending"}
                </span>
              </div>
              <div className="payment-meta-grid top-gap">
                <div><span className="small-label">Goods</span><strong>{formatCurrencyInr(entry.goodsValue)}</strong></div>
                <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(entry.paidAmount)}</strong></div>
                <div><span className="small-label">Pending</span><strong>{formatCurrencyInr(entry.pendingAmount)}</strong></div>
              </div>
            </article>)}
          </div> : null}
        </article>)}
      </div>
    </Panel>
    <Panel title="Order Financial State" eyebrow="Pending vs settled">
      <DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...groupPurchaseRows(snapshot.purchaseOrders).map((row) => ["Purchase", row[0], row[6]]), ...groupSalesRows(snapshot.salesOrders).map((row) => ["Sales", row[0], row[6]])]} />
    </Panel>
    </> : null}
  </section>;
}

export function AccountsOverview({
  snapshot,
  onOpen,
  onUploadProof,
  onCreatePurchaseAdvance
}: {
  snapshot: AppSnapshot;
  onOpen: (view: ViewKey) => void;
  onUploadProof: (file: File) => Promise<unknown>;
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
}) {
  const purchaseGroups = groupPurchaseOrders(snapshot.purchaseOrders);
  const salesGroups = groupSalesOrders(snapshot.salesOrders);
  const purchaseAdvances = snapshot.payments
    .filter((payment) => payment.side === "Purchase" && payment.paymentKind === "Advance")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const suppliers = snapshot.counterparties.filter((item) => item.type === "Supplier").sort((left, right) => left.name.localeCompare(right.name));
  const today = new Date().toISOString().slice(0, 10);
  const [advanceForm, setAdvanceForm] = useState({
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
    if (suppliers.length === 0) return;
    if (!advanceForm.supplierId || !suppliers.some((item) => item.id === advanceForm.supplierId)) {
      setAdvanceForm((current) => ({ ...current, supplierId: suppliers[0].id }));
    }
  }, [suppliers, advanceForm.supplierId]);
  const pendingPayments = snapshot.payments
    .filter((payment) => payment.verificationStatus !== "Verified" && payment.verificationStatus !== "Resolved")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const flaggedPayments = pendingPayments.filter((payment) => payment.verificationStatus === "Disputed" || payment.verificationStatus === "Rejected");
  const pendingPurchaseQueue = purchaseGroups
    .map((group) => {
      const ledger = purchaseLedgerByOrder(snapshot, group.id);
      const latest = latestPurchasePayment(snapshot, group.id);
      return {
        id: group.id,
        party: group.lines[0]?.supplierName || "Supplier",
        total: ledger?.goodsValue ?? purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id),
        paid: ledger?.paidAmount ?? 0,
        pending: ledger?.pendingAmount ?? purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id),
        mode: latest?.mode || group.lines[0]?.paymentMode || "N/A",
        date: latest?.createdAt || group.lines[0]?.createdAt || "",
        status: purchasePaymentStatus(snapshot, group.id)
      };
    })
    .filter((item) => item.pending > 0)
    .sort((left, right) => right.pending - left.pending);
  const pendingSalesQueue = salesGroups
    .map((group) => {
      const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      const latest = latestSalesPayment(snapshot, group.id);
      return {
        id: group.id,
        party: group.lines[0]?.shopName || "Customer",
        total: ledger?.goodsValue ?? salesOrderPublicTotal(snapshot.salesOrders, group.id),
        paid: ledger?.paidAmount ?? 0,
        pending: ledger?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id),
        mode: latest?.mode || group.lines[0]?.paymentMode || "N/A",
        date: latest?.createdAt || group.lines[0]?.createdAt || "",
        status: salesPaymentStatus(snapshot, group.id),
        collector: collectionAssignment(snapshot, group.id) || group.lines[0]?.salesmanName || "Sales self"
      };
    })
    .filter((item) => item.pending > 0)
    .sort((left, right) => right.pending - left.pending);
  const paymentAlerts = [
    { label: "Pending proofs", count: pendingPayments.length, tone: "pending" },
    { label: "Disputes", count: flaggedPayments.length, tone: flaggedPayments.length > 0 ? "danger" : "good" },
    { label: "Supplier dues", count: pendingPurchaseQueue.length, tone: "pending" },
    { label: "Customer collections", count: pendingSalesQueue.length, tone: "good" },
    { label: "Advance paid", count: purchaseAdvances.length, tone: purchaseAdvances.length > 0 ? "good" : "pending" }
  ];

  return (
    <section className="dashboard-grid accounts-home-grid accounts-home-simple-grid">
      <article className="panel accounts-hero-panel accounts-home-hero">
        <div className="accounts-hero-copy">
          <span className="eyebrow">Accounts Command</span>
          <h2>Pending payouts and pending collections only.</h2>
          <p>Use this screen as the working desk. Supplier dues stay on the left, customer collections stay on the right.</p>
        </div>
        <div className="accounts-hero-actions">
          <button className="primary-button" type="button" onClick={() => onOpen("Payments")}>Open payment desk</button>
          <button className="ghost-button" type="button" onClick={() => onOpen("SalesOrders")}>Open collection desk</button>
          <button className="ghost-button" type="button" onClick={() => onOpen("Payments")}>Open advance list</button>
        </div>
        <div className="accounts-notification-strip">
          {paymentAlerts.map((item) => (
            <button
              key={item.label}
              type="button"
              className={`accounts-alert-chip tone-${item.tone}`}
              onClick={() => onOpen(item.label === "Customer collections" ? "SalesOrders" : "Payments")}
            >
              <span>{item.label}</span>
              <strong>{item.count}</strong>
            </button>
          ))}
        </div>
      </article>

      <article className="panel accounts-home-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Advance Payments</span>
            <h2>Supplier advances</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onOpen("Payments")}>Open Advances</button>
        </div>
        <div className="accounts-home-list">
          {purchaseAdvances.length === 0 ? <div className="empty-card">No supplier advance payments yet.</div> : purchaseAdvances.slice(0, 6).map((item) => (
            <button key={item.id} type="button" className="accounts-home-row" onClick={() => onOpen("Payments")}>
              <div className="accounts-home-main">
                <span className="small-label">{item.id}</span>
                <strong>{item.counterpartyName || "Supplier"}</strong>
                <p>{formatShortDate(item.createdAt)} | {item.mode || "N/A"}{item.utrNumber ? ` | ${item.utrNumber}` : ""}</p>
              </div>
              <div className="accounts-home-metrics">
                <span>
                  <small>Amount</small>
                  <strong>{formatCurrencyInr(item.amount)}</strong>
                </span>
                <span>
                  <small>Proof</small>
                  <strong>{item.proofName ? "Uploaded" : "Pending"}</strong>
                </span>
                <span>
                  <small>Status</small>
                  <strong>{item.verificationStatus}</strong>
                </span>
              </div>
              <span className={`status-pill ${statusPillClass(item.verificationStatus)}`}>{item.verificationStatus}</span>
            </button>
          ))}
        </div>
      </article>

      <article className="panel accounts-home-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Create Advance</span>
            <h2>Post supplier advance</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onOpen("Payments")}>Open Payments</button>
        </div>
        <form className="form-grid top-gap" onSubmit={async (event) => {
          event.preventDefault();
          await onCreatePurchaseAdvance({
            supplierId: advanceForm.supplierId,
            amount: Number(advanceForm.amount || 0),
            mode: advanceForm.mode,
            cashTiming: advanceForm.mode === "Cash" ? advanceForm.cashTiming as CashTiming : undefined,
            referenceNumber: advanceForm.referenceNumber,
            voucherNumber: advanceForm.voucherNumber || undefined,
            utrNumber: advanceForm.utrNumber || undefined,
            proofName: advanceForm.proofName || undefined,
            verificationStatus: advanceForm.verificationStatus,
            verificationNote: advanceForm.verificationNote,
            operationDate: advanceForm.operationDate || undefined
          });
        }}>
          <label>Supplier<select value={advanceForm.supplierId} onChange={(e) => setAdvanceForm((current) => ({ ...current, supplierId: e.target.value }))}>{renderOptions(suppliers)}</select></label>
          <label>Amount<input type="number" step="any" min="0" value={advanceForm.amount} onChange={(e) => setAdvanceForm((current) => ({ ...current, amount: e.target.value }))} /></label>
          <label>Date<input type="date" value={advanceForm.operationDate} onChange={(e) => setAdvanceForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
          <label>Mode<select value={advanceForm.mode} onChange={(e) => setAdvanceForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
          {advanceForm.mode === "Cash" ? <label>Cash timing<select value={advanceForm.cashTiming} onChange={(e) => setAdvanceForm((current) => ({ ...current, cashTiming: e.target.value }))}><option>In Hand</option><option>At Delivery</option></select></label> : null}
          <label>Reference<input value={advanceForm.referenceNumber} onChange={(e) => setAdvanceForm((current) => ({ ...current, referenceNumber: e.target.value }))} /></label>
          <label>Voucher<input value={advanceForm.voucherNumber} onChange={(e) => setAdvanceForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
          <label>UTR<input value={advanceForm.utrNumber} onChange={(e) => setAdvanceForm((current) => ({ ...current, utrNumber: e.target.value }))} /></label>
          <label>Status<select value={advanceForm.verificationStatus} onChange={(e) => setAdvanceForm((current) => ({ ...current, verificationStatus: e.target.value as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved" }))}><option>Verified</option><option>Submitted</option></select></label>
          <label className="wide-field">Proof file<input type="file" accept="image/*,.pdf" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setAdvanceForm((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) })); }} /></label>
          <label>Proof name<input value={advanceForm.proofName} onChange={(e) => setAdvanceForm((current) => ({ ...current, proofName: e.target.value }))} /></label>
          <label className="wide-field">Note<input value={advanceForm.verificationNote} onChange={(e) => setAdvanceForm((current) => ({ ...current, verificationNote: e.target.value }))} /></label>
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit" disabled={!advanceForm.supplierId || Number(advanceForm.amount || 0) <= 0}>Post advance</button>
          </div>
        </form>
      </article>

      <article className="panel accounts-home-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Pending Payments</span>
            <h2>Supplier dues</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onOpen("Payments")}>Open Payments</button>
        </div>
        <div className="accounts-home-list">
          {pendingPurchaseQueue.length === 0 ? <div className="empty-card">No pending supplier payment.</div> : pendingPurchaseQueue.map((item) => (
            <button key={item.id} type="button" className="accounts-home-row" onClick={() => onOpen("Payments")}>
              <div className="accounts-home-main">
                <span className="small-label">{item.id}</span>
                <strong>{item.party}</strong>
                <p>{formatShortDate(item.date)} | {item.mode || "N/A"}</p>
              </div>
              <div className="accounts-home-metrics">
                <span>
                  <small>Total</small>
                  <strong>{formatCurrencyInr(item.total)}</strong>
                </span>
                <span>
                  <small>Paid</small>
                  <strong>{formatCurrencyInr(item.paid)}</strong>
                </span>
                <span>
                  <small>Pending</small>
                  <strong>{formatCurrencyInr(item.pending)}</strong>
                </span>
              </div>
              <span className={`status-pill ${statusPillClass(item.status)}`}>{item.status}</span>
            </button>
          ))}
        </div>
      </article>

      <article className="panel accounts-home-panel">
        <div className="section-head">
          <div>
            <span className="eyebrow">Sales Collections</span>
            <h2>Customer dues</h2>
          </div>
          <button className="ghost-button" type="button" onClick={() => onOpen("SalesOrders")}>Open Sales</button>
        </div>
        <div className="accounts-home-list">
          {pendingSalesQueue.length === 0 ? <div className="empty-card">No pending customer collection.</div> : pendingSalesQueue.map((item) => (
            <button key={item.id} type="button" className="accounts-home-row" onClick={() => onOpen("SalesOrders")}>
              <div className="accounts-home-main">
                <span className="small-label">{item.id}</span>
                <strong>{item.party}</strong>
                <p>{formatShortDate(item.date)} | {item.mode || "N/A"} | {item.collector}</p>
              </div>
              <div className="accounts-home-metrics">
                <span>
                  <small>Total</small>
                  <strong>{formatCurrencyInr(item.total)}</strong>
                </span>
                <span>
                  <small>Paid</small>
                  <strong>{formatCurrencyInr(item.paid)}</strong>
                </span>
                <span>
                  <small>Pending</small>
                  <strong>{formatCurrencyInr(item.pending)}</strong>
                </span>
              </div>
              <span className={`status-pill ${statusPillClass(item.status)}`}>{item.status}</span>
            </button>
          ))}
        </div>
      </article>
    </section>
  );
}

export function BootLoader() {
  return (
    <main className="boot-loader-shell">
      <header className="boot-loader-header glass-surface">
        <div className="topbar-brand-block">
          <span className="small-label">B CONNECT</span>
          <strong>Workspace Restore</strong>
        </div>
        <div className="topbar-logo-orb boot-topbar-logo">
          <img src={appLogo} alt="Aapoorti" className="topbar-logo-image" />
        </div>
        <div className="topbar-side-slot">
          <span className="boot-loader-chip">Syncing</span>
        </div>
      </header>
      <section className="boot-loader-card">
        <div className="boot-loader-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="boot-loader-copy">
          <span className="eyebrow">B CONNECT</span>
          <h1>Restoring workspace</h1>
          <p>Loading your module, live orders, parties, stock, and delivery state.</p>
        </div>
        <div className="boot-loader-track"><span /></div>
      </section>
      <footer className="boot-loader-footer">Powered by OPAS</footer>
    </main>
  );
}
