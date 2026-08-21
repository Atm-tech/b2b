import type {
AppSnapshot,
AppUser,
Counterparty,
GoodsWarrantOutlet,
GoodsWarrantPaymentMode,
GoodsWarrantRecord,
PurchaseOrder,
PurchaseReturn,
SalesOrder,
SalesReturn
} from "@aapoorti-b2b/domain";
import axios from "axios";
import { useEffect,useState } from "react";
import { renderOptions,renderProductOptions,renderWarehouseOptions,uniqueProductFieldOptions } from "../../app/formOptions";
import { DataTable,Panel,TwoCol } from "../../components/ui";
import { downloadExcelWorkbook } from "../../utils/excel";
import { productDisplayLabel } from "../catalog/catalogUtils";

import {
addOneMonthForVoucherPreview,
api,
API_BASE,
downloadCsvFile,
downloadDailySalesReportPdf,
downloadReportCsv,
escapeHtml,
formatCurrencyInr,
formatDateIst,
formatLongDateIst,
formatShortDate,
goodsWarrantOutlets,
groupPurchaseOrders,
groupSalesOrders,
GstRateInput,
indiaDateKey,
prioritizeWarehouseIds,
productNameBySku,
purchaseDeliveryStatus,
purchaseLedgerByOrder,
purchaseWarehouseStatus,
purchaseWorkflowStatus,
readStoredJson,
returnReasons,
salesDeliveryStatus,
salesFulfillmentStatus,
salesPaymentStatus,
salesStatusLabel,
statusPillClass,
subtractOneDayFromNextMonth,
TaxModeInput,
workspaceStorageKey,
writeStoredJson
} from "../../app/shared";

export function ReturnsWorkspace({
  side,
  snapshot,
  currentUser,
  parties,
  warehouses,
  products,
  onUploadProof,
  onSubmit
}: {
  side: "Purchase" | "Sales";
  snapshot: AppSnapshot;
  currentUser: AppUser;
  parties: Counterparty[];
  warehouses: AppSnapshot["warehouses"];
  products: AppSnapshot["products"];
  onUploadProof: (file: File) => Promise<unknown>;
  onSubmit: (body: any) => Promise<boolean | void>;
}) {
  const [mode, setMode] = useState<"Adhoc" | "Planned">("Adhoc");
  const [partyId, setPartyId] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id || "");
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const [note, setNote] = useState("");
  const [uploadingKey, setUploadingKey] = useState("");
  const [lines, setLines] = useState<Array<{ clientKey: string; linkedOrderLineId?: string; productSku: string; quantity: string; rate: string; reason: PurchaseReturn["reason"]; photoName: string }>>([]);
  const normalizedPartySearch = partySearch.trim().toLowerCase();
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const filteredParties = parties.filter((party) => !normalizedPartySearch || [party.name, party.contactPerson, party.mobileNumber, party.address].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedPartySearch)));
  const purchaseOrderGroups = groupPurchaseOrders(snapshot.purchaseOrders.filter((order) => order.supplierId && (!partyId || order.supplierId === partyId)));
  const salesOrderGroups = groupSalesOrders(snapshot.salesOrders.filter((order) => order.shopId && (!partyId || order.shopId === partyId)));
  const orderGroups = side === "Purchase" ? purchaseOrderGroups : salesOrderGroups;
  const selectedGroup = mode === "Adhoc"
    ? side === "Purchase"
      ? purchaseOrderGroups.find((group) => group.id === linkedOrderId) || null
      : salesOrderGroups.find((group) => group.id === linkedOrderId) || null
    : null;
  const history = (side === "Purchase"
    ? snapshot.purchaseReturns.filter((item) => item.createdBy === currentUser.fullName)
    : snapshot.salesReturns.filter((item) => item.createdBy === currentUser.fullName)) as Array<PurchaseReturn | SalesReturn>;
  const historyRows = history.map((item) => [
    item.returnGroupId,
    side === "Purchase" ? (item as PurchaseReturn).supplierName : (item as SalesReturn).shopName,
    item.productSku,
    item.quantity,
    item.reason,
    item.mode,
    item.createdAt.slice(0, 10)
  ]);
  const historicalSkus = new Set(
    (side === "Purchase"
      ? snapshot.purchaseOrders.filter((order) => order.supplierId === partyId)
      : snapshot.salesOrders.filter((order) => order.shopId === partyId)
    ).map((order) => order.productSku)
  );
  const plannedProducts = products.filter((product) => historicalSkus.has(product.sku));
  const filteredPlannedProducts = plannedProducts.filter((product) => !normalizedProductSearch || [product.sku, product.name, product.brand, product.division, product.department, product.section].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedProductSearch)));
  const filteredSelectedGroupLines = selectedGroup
    ? selectedGroup.lines.filter((line) => !normalizedProductSearch || [line.productSku, side === "Purchase" ? (line as PurchaseOrder).supplierName : (line as SalesOrder).shopName].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalizedProductSearch)))
    : [];

  useEffect(() => {
    if (mode !== "Adhoc" || !selectedGroup) return;
    const first = selectedGroup.lines[0];
    if (!first) return;
    setPartyId(side === "Purchase" ? (first as PurchaseOrder).supplierId : (first as SalesOrder).shopId);
    setWarehouseId(first.warehouseId);
  }, [linkedOrderId, mode]);

  function addPlannedLine() {
    const product = filteredPlannedProducts[0] || plannedProducts[0];
    if (!product) return;
    setLines((current) => [...current, {
      clientKey: `ret-${Date.now()}-${Math.random()}`,
      productSku: product.sku,
      quantity: "0",
      rate: "0",
      reason: "Rate Difference",
      photoName: ""
    }]);
  }

  function lineProductOptions(line: { productSku: string }) {
    if (mode === "Adhoc") {
      return products.filter((product) => product.sku === line.productSku);
    }
    const visibleProducts = filteredPlannedProducts.length > 0 ? filteredPlannedProducts : plannedProducts;
    return visibleProducts.some((product) => product.sku === line.productSku)
      ? visibleProducts
      : [...visibleProducts, ...plannedProducts.filter((product) => product.sku === line.productSku && !visibleProducts.some((item) => item.sku === product.sku))];
  }

  function addAdhocLine(source: PurchaseOrder | SalesOrder) {
    const lineId = source.id;
    setLines((current) => current.some((item) => item.linkedOrderLineId === lineId) ? current : [...current, {
      clientKey: `ret-${Date.now()}-${Math.random()}`,
      linkedOrderLineId: lineId,
      productSku: source.productSku,
      quantity: side === "Purchase" ? String(Math.max((source as PurchaseOrder).quantityReceived || 0, 0)) : String((source as SalesOrder).quantity),
      rate: String(source.rate),
      reason: "Rate Difference",
      photoName: ""
    }]);
  }

  async function uploadLinePhoto(clientKey: string, file: File | null) {
    if (!file) return;
    setUploadingKey(clientKey);
    const uploaded = await onUploadProof(file);
    setUploadingKey("");
    if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) {
      setLines((current) => current.map((line) => line.clientKey === clientKey ? { ...line, photoName: String((uploaded as { fileName: string }).fileName) } : line));
    }
  }

  return (
    <TwoCol
      left={<Panel title={`${side} Return`} eyebrow="Adhoc or planned">
        <form className="form-grid" onSubmit={(e) => {
          e.preventDefault();
          void onSubmit({
            mode,
            linkedOrderId: mode === "Adhoc" ? linkedOrderId : undefined,
            warehouseId,
            note,
            ...(side === "Purchase" ? { supplierId: partyId } : { shopId: partyId }),
            lines: lines.map((line) => ({
              linkedOrderLineId: line.linkedOrderLineId,
              productSku: line.productSku,
              quantity: Number(line.quantity || 0),
              rate: Number(line.rate || 0),
              reason: line.reason,
              photoName: line.photoName || undefined
            }))
          }).then((ok) => {
            if (ok) {
              setLines([]);
              setNote("");
              setLinkedOrderId("");
            }
          });
        }}>
          <label>Mode<select value={mode} onChange={(e) => { setMode(e.target.value as "Adhoc" | "Planned"); setLinkedOrderId(""); setLines([]); }}><option>Adhoc</option><option>Planned</option></select></label>
          <label>Search {side === "Purchase" ? "supplier" : "customer"}<input value={partySearch} onChange={(e) => setPartySearch(e.target.value)} placeholder={`Type ${side === "Purchase" ? "supplier" : "customer"} name`} /></label>
          <label>{side === "Purchase" ? "Supplier" : "Customer"}<select value={partyId} onChange={(e) => { setPartyId(e.target.value); setLinkedOrderId(""); setLines([]); }}>{renderOptions(filteredParties)}</select></label>
          <label>Warehouse<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{renderWarehouseOptions(warehouses)}</select></label>
          {mode === "Adhoc" ? <label className="wide-field">{side === "Purchase" ? "PO" : "SO"}<select value={linkedOrderId} onChange={(e) => { setLinkedOrderId(e.target.value); setLines([]); }}><option value="">Select</option>{orderGroups.map((group) => <option key={group.id} value={group.id}>{group.id}</option>)}</select></label> : null}
          <label className="wide-field">Search product<input value={productSearch} onChange={(e) => setProductSearch(e.target.value)} placeholder="Type product, brand, or SKU" /></label>
          <label className="wide-field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Return note" /></label>
          {mode === "Planned" ? <div className="payment-card-actions wide-field"><button className="ghost-button" type="button" onClick={addPlannedLine} disabled={!partyId || filteredPlannedProducts.length === 0}>Add product</button></div> : null}
          {mode === "Adhoc" && selectedGroup ? <div className="stack-list wide-field">
            {filteredSelectedGroupLines.length === 0 ? <div className="empty-card">No matching products in this {side === "Purchase" ? "PO" : "SO"}.</div> : filteredSelectedGroupLines.map((line) => <article className="list-card" key={line.id}><div className="payment-update-head"><div><strong>{productNameBySku(products, line.productSku)}</strong><p>{side === "Purchase" ? (line as PurchaseOrder).supplierName : (line as SalesOrder).shopName}</p></div><button className="ghost-button" type="button" onClick={() => addAdhocLine(line)}>Select item</button></div></article>)}
          </div> : null}
          <div className="stack-list wide-field">
            {lines.length === 0 ? <div className="empty-card">No return items selected.</div> : lines.map((line) => <article className="list-card" key={line.clientKey}>
              <div className="cart-edit-grid">
                <label>Product<select value={line.productSku} onChange={(e) => setLines((current) => current.map((item) => item.clientKey === line.clientKey ? { ...item, productSku: e.target.value } : item))} disabled={mode === "Adhoc"}>{renderProductOptions(lineProductOptions(line))}</select></label>
                <label>Qty<input type="number" step="any" min="0" value={line.quantity} onChange={(e) => setLines((current) => current.map((item) => item.clientKey === line.clientKey ? { ...item, quantity: e.target.value } : item))} /></label>
                <label>Rate<input type="number" step="any" min="0" value={line.rate} onChange={(e) => setLines((current) => current.map((item) => item.clientKey === line.clientKey ? { ...item, rate: e.target.value } : item))} /></label>
                <label>Reason<select value={line.reason} onChange={(e) => setLines((current) => current.map((item) => item.clientKey === line.clientKey ? { ...item, reason: e.target.value as PurchaseReturn["reason"] } : item))}>{returnReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select></label>
                <label>Photo<input type="file" accept="image/*" onChange={(e) => void uploadLinePhoto(line.clientKey, e.target.files?.[0] || null)} /></label>
                <button className="ghost-button" type="button" onClick={() => setLines((current) => current.filter((item) => item.clientKey !== line.clientKey))}>Remove</button>
              </div>
              {line.photoName ? <p className="small-label">Photo: {line.photoName}</p> : null}
              {uploadingKey === line.clientKey ? <p className="small-label">Uploading photo...</p> : null}
            </article>)}
          </div>
          <div className="payment-card-actions wide-field"><button className="primary-button" type="submit" disabled={!partyId || !warehouseId || lines.length === 0}>{side} return submit</button></div>
        </form>
      </Panel>}
      right={<Panel title={`${side} Return History`} eyebrow="Submitted by you">
        <DataTable headers={["Return","Party","Product","Qty","Reason","Mode","Date"]} rows={historyRows} />
      </Panel>}
    />
  );
}

export type ProductFormState = { sku: string; name: string; brand: string; division: string; department: string; section: string; category: string; subCategory: string; unit: string; rsp: string; mrp: string; isSeasonal: boolean; offerLabel: string; offerPrice: string; defaultGstRate: GstRateInput; defaultTaxMode: TaxModeInput; defaultWeightKg: string; toleranceKg: string; tolerancePercent: string; allowedWarehouseIds: string[] };

const standardSubCategoryOptions = ["Stationary", "Stationery", "OTC Item", "Dairy & Fresh", "Insecticide"];
export const nonBrandedStaplesWeightOptions = [
  { value: "1", label: "1KG" },
  { value: "5", label: "5KG" },
  { value: "10", label: "10KG" },
  { value: "25", label: "25KG" },
  { value: "30", label: "30KG" }
] as const;

export function isStaplesNonBrandedCategory(category: string, subCategory: string) {
  return category.trim().toLowerCase() === "staples" && subCategory.trim().toLowerCase() === "non branded";
}

export function AnalystPurchaseView({ snapshot, orders }: { snapshot: AppSnapshot; orders: PurchaseOrder[] }) {
  const [openId, setOpenId] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [settlementFilter, setSettlementFilter] = useState<"All" | "Unsettled" | "Settled">("All");
  const [workflowFilter, setWorkflowFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const supplierById = new Map(snapshot.counterparties.filter((item) => item.type === "Supplier").map((item) => [item.id, item]));
  const allGroups = groupPurchaseOrders(orders)
    .map((group) => {
      const first = group.lines[0];
      const supplier = supplierById.get(first?.supplierId || "");
      const ledger = purchaseLedgerByOrder(snapshot, group.id);
      const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
      const pending = ledger?.pendingAmount ?? total;
      const paid = ledger?.paidAmount ?? 0;
      const status = purchaseWorkflowStatus(snapshot, group.id);
      return {
        id: group.id,
        party: first?.supplierName || "Supplier",
        createdAt: first?.createdAt || "",
        products: group.lines.map((line) => line.productSku),
        total,
        taxable: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0),
        gst: group.lines.reduce((sum, line) => sum + line.gstAmount, 0),
        pending,
        paid,
        settlement: pending > 0 ? (paid > 0 ? "Partial" : "Unsettled") : "Settled",
        status,
        warehouse: purchaseWarehouseStatus(group.lines),
        delivery: purchaseDeliveryStatus(snapshot, group.id),
        contact: supplier?.contactPerson || "N/A",
        phone: supplier?.mobileNumber || "N/A",
        address: supplier?.deliveryAddress || supplier?.address || "N/A"
      };
    })
    .sort((left, right) => {
      const pendingDiff = Number(right.pending > 0) - Number(left.pending > 0);
      if (pendingDiff !== 0) return pendingDiff;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  const workflowOptions = Array.from(new Set(allGroups.map((group) => group.status))).sort((left, right) => left.localeCompare(right, "en-IN"));
  const filteredGroups = allGroups.filter((item) => {
    const dateKey = indiaDateKey(new Date(item.createdAt));
    const matchesParty = `${item.party} ${item.id}`.toLowerCase().includes(partySearch.trim().toLowerCase());
    const matchesSettlement = settlementFilter === "All" || (settlementFilter === "Settled" ? item.pending <= 0 : item.pending > 0);
    const matchesWorkflow = workflowFilter === "All" || item.status === workflowFilter;
    const matchesFrom = !fromDate || dateKey >= fromDate;
    const matchesTo = !toDate || dateKey <= toDate;
    return matchesParty && matchesSettlement && matchesWorkflow && matchesFrom && matchesTo;
  });
  const headers = ["PO / Cart", "Supplier", "Date", "Products", "Taxable", "GST", "Total", "Paid", "Pending", "Settlement", "Workflow", "Warehouse", "Delivery"];
  const rows = filteredGroups.map((item) => [
    item.id,
    item.party,
    formatShortDate(item.createdAt),
    item.products.join(", "),
    item.taxable,
    item.gst,
    item.total,
    item.paid,
    item.pending,
    item.settlement,
    item.status,
    item.warehouse,
    item.delivery
  ]);
  return (
    <Panel title="Purchase Report" eyebrow="Party, settlement, and date filters">
      <div className="form-grid">
        <label>Search party / PO
          <input value={partySearch} onChange={(e) => setPartySearch(e.target.value)} placeholder="Supplier name or PO id" />
        </label>
        <label>Settlement
          <select value={settlementFilter} onChange={(e) => setSettlementFilter(e.target.value as "All" | "Unsettled" | "Settled")}>
            <option value="All">All</option>
            <option value="Unsettled">Unsettled</option>
            <option value="Settled">Settled</option>
          </select>
        </label>
        <label>Workflow status
          <select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
            <option value="All">All</option>
            {workflowOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
      </div>
      <div className="payment-card-actions top-gap">
        <button className="ghost-button" type="button" onClick={() => downloadReportCsv("purchase-report", headers, rows, fromDate || "all", toDate || "all")}>Download CSV</button>
        <button className="ghost-button" type="button" onClick={() => { setPartySearch(""); setSettlementFilter("All"); setWorkflowFilter("All"); setFromDate(""); setToDate(""); }}>Reset filters</button>
      </div>
      <div className="report-accordion-list">
        {filteredGroups.length === 0 ? <div className="empty-card">No purchase orders matched the selected filters.</div> : filteredGroups.map((item) => {
          const open = openId === item.id;
          return <article className="list-card report-accordion-card" key={item.id}>
            <button className="report-accordion-toggle" type="button" onClick={() => setOpenId((current) => current === item.id ? "" : item.id)}>
              <div className="report-accordion-main">
                <span className="small-label">{item.id}</span>
                <strong>{item.party}</strong>
                <p>{formatShortDate(item.createdAt)} | {item.products.length} products</p>
              </div>
              <div className="report-accordion-vitals">
                <span><small>Total</small><strong>{formatCurrencyInr(item.total)}</strong></span>
                <span><small>Paid</small><strong>{formatCurrencyInr(item.paid)}</strong></span>
                <span><small>Pending</small><strong>{formatCurrencyInr(item.pending)}</strong></span>
              </div>
              <div className="report-accordion-side">
                <span className={`status-pill ${statusPillClass(item.status)}`}>{item.status}</span>
                <span className={`status-pill ${statusPillClass(item.pending <= 0 ? "Completed" : item.paid > 0 ? "Partial" : "Pending")}`}>{item.settlement}</span>
                <span className="status-pill">{open ? "Close" : "Open"}</span>
              </div>
            </button>
            {open ? <div className="payment-meta-grid top-gap">
              <div><span className="small-label">Products</span><strong>{item.products.join(", ")}</strong></div>
              <div><span className="small-label">Taxable</span><strong>{formatCurrencyInr(item.taxable)}</strong></div>
              <div><span className="small-label">GST</span><strong>{formatCurrencyInr(item.gst)}</strong></div>
              <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(item.paid)}</strong></div>
              <div><span className="small-label">Contact</span><strong>{item.contact}</strong></div>
              <div><span className="small-label">Mobile</span><strong>{item.phone}</strong></div>
              <div><span className="small-label">Warehouse</span><strong>{item.warehouse}</strong></div>
              <div><span className="small-label">Delivery</span><strong>{item.delivery}</strong></div>
              <div className="wide-field"><span className="small-label">Address</span><strong>{item.address}</strong></div>
            </div> : null}
          </article>;
        })}
      </div>
    </Panel>
  );
}

export function AnalystSalesView({ snapshot, orders }: { snapshot?: AppSnapshot; orders: SalesOrder[] }) {
  const [openId, setOpenId] = useState("");
  const [partySearch, setPartySearch] = useState("");
  const [settlementFilter, setSettlementFilter] = useState<"All" | "Unsettled" | "Settled">("All");
  const [workflowFilter, setWorkflowFilter] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const customerById = new Map((snapshot?.counterparties || []).filter((item) => item.type === "Shop").map((item) => [item.id, item]));
  const allGroups = groupSalesOrders(orders)
    .map((group) => {
      const first = group.lines[0];
      const customer = customerById.get(first?.shopId || "");
      const ledger = snapshot?.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
      const pending = ledger?.pendingAmount ?? total;
      const paid = ledger?.paidAmount ?? 0;
      const status = snapshot ? `${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}` : salesStatusLabel(first?.status || "Booked");
      return {
        id: group.id,
        party: first?.shopName || "Customer",
        createdAt: first?.createdAt || "",
        products: group.lines.map((line) => line.productSku),
        total,
        taxable: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0),
        gst: group.lines.reduce((sum, line) => sum + line.gstAmount, 0),
        pending,
        paid,
        settlement: pending > 0 ? (paid > 0 ? "Partial" : "Unsettled") : "Settled",
        status,
        delivery: snapshot ? salesDeliveryStatus(snapshot, group.id) : first?.deliveryMode || "N/A",
        fulfillment: salesFulfillmentStatus(group.lines),
        contact: customer?.contactPerson || "N/A",
        phone: customer?.mobileNumber || "N/A",
        address: customer?.deliveryAddress || customer?.address || "N/A"
      };
    })
    .sort((left, right) => {
      const pendingDiff = Number(right.pending > 0) - Number(left.pending > 0);
      if (pendingDiff !== 0) return pendingDiff;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    });
  const workflowOptions = Array.from(new Set(allGroups.map((group) => group.status))).sort((left, right) => left.localeCompare(right, "en-IN"));
  const filteredGroups = allGroups.filter((item) => {
    const dateKey = indiaDateKey(new Date(item.createdAt));
    const matchesParty = `${item.party} ${item.id}`.toLowerCase().includes(partySearch.trim().toLowerCase());
    const matchesSettlement = settlementFilter === "All" || (settlementFilter === "Settled" ? item.pending <= 0 : item.pending > 0);
    const matchesWorkflow = workflowFilter === "All" || item.status === workflowFilter;
    const matchesFrom = !fromDate || dateKey >= fromDate;
    const matchesTo = !toDate || dateKey <= toDate;
    return matchesParty && matchesSettlement && matchesWorkflow && matchesFrom && matchesTo;
  });
  const headers = ["SO / Cart", "Customer", "Date", "Products", "Taxable", "GST", "Total", "Paid", "Pending", "Settlement", "Workflow", "Delivery", "Fulfillment"];
  const rows = filteredGroups.map((item) => [
    item.id,
    item.party,
    formatShortDate(item.createdAt),
    item.products.join(", "),
    item.taxable,
    item.gst,
    item.total,
    item.paid,
    item.pending,
    item.settlement,
    item.status,
    item.delivery,
    item.fulfillment
  ]);
  return (
    <Panel title="Sales Report" eyebrow="Party, settlement, and date filters">
      <div className="form-grid">
        <label>Search customer / SO
          <input value={partySearch} onChange={(e) => setPartySearch(e.target.value)} placeholder="Customer name or SO id" />
        </label>
        <label>Settlement
          <select value={settlementFilter} onChange={(e) => setSettlementFilter(e.target.value as "All" | "Unsettled" | "Settled")}>
            <option value="All">All</option>
            <option value="Unsettled">Unsettled</option>
            <option value="Settled">Settled</option>
          </select>
        </label>
        <label>Workflow status
          <select value={workflowFilter} onChange={(e) => setWorkflowFilter(e.target.value)}>
            <option value="All">All</option>
            {workflowOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>From
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label>To
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
      </div>
      <div className="payment-card-actions">
        <button className="ghost-button" type="button" onClick={() => downloadReportCsv("sales-report", headers, rows, fromDate || "all", toDate || "all")}>Download CSV</button>
        <button className="ghost-button" type="button" onClick={() => { setPartySearch(""); setSettlementFilter("All"); setWorkflowFilter("All"); setFromDate(""); setToDate(""); }}>Reset filters</button>
        {snapshot ? <button className="ghost-button" type="button" onClick={() => downloadDailySalesReportPdf(snapshot, orders)}>Daily PDF</button> : null}
      </div>
      <div className="report-accordion-list">
        {filteredGroups.length === 0 ? <div className="empty-card">No sales orders matched the selected filters.</div> : filteredGroups.map((item) => {
          const open = openId === item.id;
          return <article className="list-card report-accordion-card" key={item.id}>
            <button className="report-accordion-toggle" type="button" onClick={() => setOpenId((current) => current === item.id ? "" : item.id)}>
              <div className="report-accordion-main">
                <span className="small-label">{item.id}</span>
                <strong>{item.party}</strong>
                <p>{formatShortDate(item.createdAt)} | {item.products.length} products</p>
              </div>
              <div className="report-accordion-vitals">
                <span><small>Total</small><strong>{formatCurrencyInr(item.total)}</strong></span>
                <span><small>Paid</small><strong>{formatCurrencyInr(item.paid)}</strong></span>
                <span><small>Pending</small><strong>{formatCurrencyInr(item.pending)}</strong></span>
              </div>
              <div className="report-accordion-side">
                <span className={`status-pill ${statusPillClass(item.status)}`}>{item.status}</span>
                <span className={`status-pill ${statusPillClass(item.pending <= 0 ? "Completed" : item.paid > 0 ? "Partial" : "Pending")}`}>{item.settlement}</span>
                <span className="status-pill">{open ? "Close" : "Open"}</span>
              </div>
            </button>
            {open ? <div className="payment-meta-grid top-gap">
              <div><span className="small-label">Products</span><strong>{item.products.join(", ")}</strong></div>
              <div><span className="small-label">Taxable</span><strong>{formatCurrencyInr(item.taxable)}</strong></div>
              <div><span className="small-label">GST</span><strong>{formatCurrencyInr(item.gst)}</strong></div>
              <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(item.paid)}</strong></div>
              <div><span className="small-label">Contact</span><strong>{item.contact}</strong></div>
              <div><span className="small-label">Mobile</span><strong>{item.phone}</strong></div>
              <div><span className="small-label">Fulfillment</span><strong>{item.fulfillment}</strong></div>
              <div><span className="small-label">Delivery</span><strong>{item.delivery}</strong></div>
              <div className="wide-field"><span className="small-label">Address</span><strong>{item.address}</strong></div>
            </div> : null}
          </article>;
        })}
      </div>
    </Panel>
  );
}

export function PartyVitalsList({ snapshot, parties, type }: { snapshot: AppSnapshot; parties: Counterparty[]; type: "Supplier" | "Shop" }) {
  const [openId, setOpenId] = useState("");
  const purchaseGroups = groupPurchaseOrders(snapshot.purchaseOrders);
  const salesGroups = groupSalesOrders(snapshot.salesOrders);
  const items = parties.map((party) => {
    if (type === "Supplier") {
      const related = purchaseGroups.filter((group) => group.lines[0]?.supplierId === party.id);
      return {
        id: party.id,
        name: party.name,
        count: related.length,
        total: related.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.totalAmount, 0), 0),
        pending: related.reduce((sum, group) => sum + (purchaseLedgerByOrder(snapshot, group.id)?.pendingAmount ?? 0), 0),
        phone: party.mobileNumber || "N/A",
        city: party.city || "N/A",
        gst: party.gstNumber || "N/A",
        contact: party.contactPerson || "N/A",
        address: party.address || "N/A"
      };
    }
    const related = salesGroups.filter((group) => group.lines[0]?.shopId === party.id);
    return {
      id: party.id,
      name: party.name,
      count: related.length,
      total: related.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.totalAmount, 0), 0),
      pending: related.reduce((sum, group) => sum + (snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id)?.pendingAmount ?? 0), 0),
      phone: party.mobileNumber || "N/A",
      city: party.city || "N/A",
      gst: party.gstNumber || "N/A",
      contact: party.contactPerson || "N/A",
      address: party.address || "N/A"
    };
  }).sort((left, right) => left.name.localeCompare(right.name, "en-IN", { sensitivity: "base" }));

  return (
    <div className="report-accordion-list">
      {items.length === 0 ? <div className="empty-card">No parties yet.</div> : items.map((item) => {
        const open = openId === item.id;
        return <article className="list-card report-accordion-card" key={item.id}>
          <button className="report-accordion-toggle" type="button" onClick={() => setOpenId((current) => current === item.id ? "" : item.id)}>
            <div className="report-accordion-main">
              <span className="small-label">{type === "Supplier" ? "Supplier" : "Customer"}</span>
              <strong>{item.name}</strong>
              <p>{item.city} | {item.phone}</p>
            </div>
            <div className="report-accordion-vitals">
              <span><small>Total</small><strong>{formatCurrencyInr(item.total)}</strong></span>
              <span><small>Pending</small><strong>{formatCurrencyInr(item.pending)}</strong></span>
              <span><small>Orders</small><strong>{item.count}</strong></span>
            </div>
            <div className="report-accordion-side">
              <span className={`status-pill ${item.pending > 0 ? "status-pending" : "status-verified"}`}>{item.pending > 0 ? "Unsettled" : "Settled"}</span>
              <span className="status-pill">{open ? "Close" : "Open"}</span>
            </div>
          </button>
          {open ? <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Contact</span><strong>{item.contact}</strong></div>
            <div><span className="small-label">GST</span><strong>{item.gst}</strong></div>
            <div className="wide-field"><span className="small-label">Address</span><strong>{item.address}</strong></div>
          </div> : null}
        </article>;
      })}
    </div>
  );
}

export function AnalystInventoryView({ snapshot }: { snapshot: AppSnapshot }) {
  const stockHeaders = ["Warehouse", "SKU", "Product", "Available", "Reserved", "Blocked"];
  const stockRows = snapshot.stockSummary.map((item) => [item.warehouseName, item.productSku, item.productName, item.availableQuantity, item.reservedQuantity, item.blockedQuantity] as Array<string | number>);
  const lotHeaders = ["Lot", "Order", "Warehouse", "SKU", "Available", "Blocked"];
  const lotRows = snapshot.inventoryLots.map((item) => [item.lotId, item.sourceOrderId, item.warehouseId, item.productSku, item.quantityAvailable, item.quantityBlocked] as Array<string | number>);
  return (
    <TwoCol
      left={<Panel title="Inventory Summary" eyebrow="Analyst view"><div className="payment-card-actions"><button className="ghost-button" type="button" onClick={() => downloadCsvFile("inventory-summary.csv", stockHeaders, stockRows)}>Download CSV</button></div><DataTable headers={stockHeaders} rows={stockRows} /></Panel>}
      right={<Panel title="Inventory Lots" eyebrow="Traceability"><div className="payment-card-actions"><button className="ghost-button" type="button" onClick={() => downloadCsvFile("inventory-lots.csv", lotHeaders, lotRows)}>Download CSV</button></div><DataTable headers={lotHeaders} rows={lotRows} /></Panel>}
    />
  );
}

export function GoodsWarrantView({
  snapshot,
  sessionToken,
  setSnapshot,
  setLoading,
  setError,
  setMessage
}: {
  snapshot: AppSnapshot;
  sessionToken: string;
  setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot | null>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string>>;
  setMessage: React.Dispatch<React.SetStateAction<string>>;
}) {
  const today = indiaDateKey();
  const [form, setForm] = useState({
    outlet: "" as GoodsWarrantOutlet | "",
    issuedTo: "",
    issuerName: "",
    receivedAmount: "",
    totalAmount: "",
    denominationAmount: "500",
    allowedPerMonth: "1",
    paymentMode: "Cash" as GoodsWarrantPaymentMode,
    chequeNumber: "",
    cashCollectedOn: today,
    validThrough: today,
    note: ""
  });

  function resetForm() {
    setForm({
      outlet: "",
      issuedTo: "",
      issuerName: "",
      receivedAmount: "",
      totalAmount: "",
      denominationAmount: "500",
      allowedPerMonth: "1",
      paymentMode: "Cash",
      chequeNumber: "",
      cashCollectedOn: today,
      validThrough: today,
      note: ""
    });
  }

  const [editingWarrantId, setEditingWarrantId] = useState("");
  const [editDrafts, setEditDrafts] = useState<Record<string, {
    issuedTo: string;
    issuerName: string;
    receivedAmount: string;
    amount: string;
    paymentMode: GoodsWarrantPaymentMode;
    chequeNumber: string;
    cashCollectedOn: string;
    validThrough: string;
    note: string;
  }>>({});

  const receivedAmountNumber = Number(form.receivedAmount || 0);
  const totalAmountNumber = Number(form.totalAmount || 0);
  const denominationAmountNumber = Number(form.denominationAmount || 0);
  const allowedPerMonthNumber = Math.max(1, Math.floor(Number(form.allowedPerMonth || 0) || 1));
  const rawVoucherCount = denominationAmountNumber > 0 ? totalAmountNumber / denominationAmountNumber : 0;
  const voucherCount = Number.isFinite(rawVoucherCount) ? Math.round(rawVoucherCount) : 0;
  const bonusValueNumber = Math.max(totalAmountNumber - receivedAmountNumber, 0);
  const hasExactDenominationSplit =
    totalAmountNumber > 0 &&
    denominationAmountNumber > 0 &&
    voucherCount > 0 &&
    Math.abs(rawVoucherCount - voucherCount) < 0.000001;

  function writeGoodsWarrantPrintDocument(popup: Window, warrant: GoodsWarrantRecord) {
    const logoUrl = `${API_BASE}/goods-warrants/logo`;
    const paymentLine = warrant.paymentMode === "Cheque"
      ? `Cheque No: ${escapeHtml(warrant.chequeNumber || "-")}`
      : `Cash Collected On: ${escapeHtml(formatLongDateIst(warrant.cashCollectedOn))}`;
    popup.document.open();
    popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(warrant.warrantNumber)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Segoe UI", sans-serif; color: #172033; background: #fff; }
      .sheet { width: 100%; max-width: 780px; margin: 0 auto; padding: 20px; }
      .card {
        position: relative;
        overflow: hidden;
        border: 2px solid #d2b16f;
        border-radius: 24px;
        padding: 28px;
        min-height: 1060px;
        background: #fffdf8;
      }
      .watermark {
        position: absolute;
        inset: 110px 70px 110px 70px;
        width: calc(100% - 140px);
        height: calc(100% - 220px);
        object-fit: contain;
        opacity: 0.08;
        pointer-events: none;
      }
      .head, .meta-grid, .sign-row { position: relative; z-index: 1; }
      .head { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid #eadfca; padding-bottom: 18px; }
      .brand h1 { margin: 6px 0 0; font-size: 34px; letter-spacing: 0.04em; text-transform: uppercase; }
      .brand p, .code p, .body p { margin: 0; }
      .brand-tag { font-size: 12px; letter-spacing: 0.22em; text-transform: uppercase; color: #8a6634; font-weight: 700; }
      .code { text-align: right; }
      .code strong { display: block; font-size: 24px; margin-top: 6px; }
      .hero { position: relative; z-index: 1; padding: 22px 0; }
      .hero strong { display: block; font-size: 44px; color: #183153; }
      .hero span { display: block; margin-top: 10px; font-size: 16px; color: #6a7280; }
      .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; margin-top: 8px; }
      .meta-card {
        padding: 16px 18px;
        border: 1px solid #eadfca;
        border-radius: 18px;
        background: rgba(255,255,255,0.9);
      }
      .meta-card small { display: block; margin-bottom: 6px; color: #8a6634; text-transform: uppercase; letter-spacing: 0.08em; }
      .meta-card strong { font-size: 22px; }
      .body { position: relative; z-index: 1; margin-top: 24px; padding: 20px; border-radius: 20px; background: rgba(255,255,255,0.82); border: 1px solid #eadfca; }
      .body p { line-height: 1.7; font-size: 16px; }
      .sign-row { display: flex; justify-content: space-between; gap: 24px; margin-top: 80px; }
      .sign-box { width: 220px; padding-top: 18px; border-top: 1px solid #7c8798; }
      .foot { position: absolute; left: 28px; right: 28px; bottom: 28px; display: flex; justify-content: space-between; gap: 16px; color: #6a7280; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="card">
        <img class="watermark" src="${logoUrl}" alt="" />
        <div class="head">
          <div class="brand">
            <span class="brand-tag">Aapoorti Mart</span>
            <h1>Goods Warrant</h1>
            <p>Outlet tagged issue instrument</p>
          </div>
          <div class="code">
            <p>Warrant Number</p>
            <strong>${escapeHtml(warrant.warrantNumber)}</strong>
          </div>
        </div>
        <div class="hero">
          <strong>${escapeHtml(formatCurrencyInr(warrant.amount))}</strong>
          <span>Valid through ${escapeHtml(formatLongDateIst(warrant.validThrough))}</span>
        </div>
        <div class="meta-grid">
          <div class="meta-card"><small>Outlet</small><strong>${escapeHtml(warrant.outlet)}</strong></div>
          <div class="meta-card"><small>Issue Date</small><strong>${escapeHtml(formatLongDateIst(warrant.issueOn))}</strong></div>
          <div class="meta-card"><small>Payment Mode</small><strong>${escapeHtml(warrant.paymentMode)}</strong></div>
          <div class="meta-card"><small>Payment Detail</small><strong>${paymentLine}</strong></div>
          <div class="meta-card"><small>Value Received</small><strong>${escapeHtml(formatCurrencyInr(warrant.receivedAmount || warrant.amount))}</strong></div>
          <div class="meta-card"><small>Voucher Worth</small><strong>${escapeHtml(formatCurrencyInr(warrant.amount))}</strong></div>
          <div class="meta-card"><small>Bearer</small><strong>${escapeHtml(warrant.issuedTo || "Bearer")}</strong></div>
          <div class="meta-card"><small>Issuer</small><strong>${escapeHtml(warrant.issuerName || warrant.createdBy)}</strong></div>
        </div>
        <div class="body">
          <p>We undertake to deliver Aapoorti Mart goods worth <strong>${escapeHtml(formatCurrencyInr(warrant.amount))}</strong> to the bearer on or before the validity date printed on this voucher.</p>
          ${warrant.receivedAmount && Math.abs((warrant.receivedAmount || 0) - warrant.amount) > 0.009 ? `<p>Value received for this voucher: <strong>${escapeHtml(formatCurrencyInr(warrant.receivedAmount))}</strong>. Promotional uplift issued: <strong>${escapeHtml(formatCurrencyInr(Math.max(warrant.amount - warrant.receivedAmount, 0)))}</strong>.</p>` : ""}
          <p>Outlet: <strong>${escapeHtml(warrant.outlet)}</strong> | Bearer: <strong>${escapeHtml(warrant.issuedTo || "Bearer")}</strong> | Issuer: <strong>${escapeHtml(warrant.issuerName || warrant.createdBy)}</strong></p>
          <p>${escapeHtml(warrant.note || "Use this warrant before the validity date. After expiry it will not be honored.")}</p>
        </div>
        <div class="sign-row">
          <div class="sign-box">Authorized Signatory</div>
          <div class="sign-box">Outlet Receiver</div>
        </div>
        <div class="foot">
          <span>Generated from Aapoorti B2B accounts module</span>
          <span>${escapeHtml(warrant.warrantNumber)}</span>
        </div>
      </div>
    </div>
  </body>
</html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => {
      try {
        popup.focus();
        popup.print();
      } catch {}
    }, 350);
  }

  function writeGoodsWarrantSheetPrintDocument(popup: Window, warrants: GoodsWarrantRecord[], totalAmount: number, denominationAmount: number, receivedAmount: number) {
    const logoUrl = `${API_BASE}/goods-warrants/logo`;
    const pages = Array.from({ length: Math.ceil(warrants.length / 4) }, (_, pageIndex) => warrants.slice(pageIndex * 4, pageIndex * 4 + 4));
    popup.document.open();
    popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Voucher Sheet</title>
    <style>
      @page { size: A4; margin: 10mm; }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: "Segoe UI", sans-serif; color: #172033; background: #f7f1e6; }
      .page { width: 100%; min-height: 277mm; page-break-after: always; }
      .page:last-child { page-break-after: auto; }
      .page-head { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin-bottom: 10px; }
      .page-head strong { display: block; font-size: 26px; }
      .page-head p { margin: 4px 0 0; color: #68553a; }
      .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8mm; }
      .card {
        position: relative;
        min-height: 122mm;
        border: 2px solid #7f5f73;
        border-radius: 22px;
        padding: 14px 18px;
        background: linear-gradient(180deg, #f6d8ea 0%, #efc6df 100%);
        overflow: hidden;
      }
      .card::before {
        content: "";
        position: absolute;
        inset: 8px;
        border: 2px solid #8d6b7f;
        border-radius: 16px;
        pointer-events: none;
      }
      .watermark {
        position: absolute;
        inset: 22px;
        width: calc(100% - 44px);
        height: calc(100% - 44px);
        object-fit: contain;
        opacity: 0.11;
        pointer-events: none;
      }
      .card > :not(.watermark) { position: relative; z-index: 1; }
      .brand-row, .footer-row { display: flex; justify-content: space-between; gap: 12px; }
      .brand-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.22em; color: #66485b; font-weight: 800; }
      .voucher-no { font-size: 11px; color: #5f4e59; text-align: right; }
      .title { margin: 10px 0 2px; font-size: 24px; text-transform: uppercase; letter-spacing: 0.18em; }
      .sub { margin: 0; font-size: 12px; color: #5f4e59; }
      .amount { margin: 12px 0 10px; font-size: 34px; font-weight: 800; color: #1f2033; letter-spacing: 0.04em; }
      .promise {
        margin-top: 12px;
        padding: 12px 14px;
        border-radius: 14px;
        background: rgba(255,255,255,0.42);
        border: 1px solid rgba(111, 73, 95, 0.28);
        font-size: 15px;
        line-height: 1.55;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #292131;
      }
      .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 12px; }
      .meta-box { padding: 10px 12px; border-radius: 14px; background: rgba(255,255,255,0.56); border: 1px solid rgba(111, 73, 95, 0.28); }
      .meta-box small { display: block; margin-bottom: 4px; color: #66485b; text-transform: uppercase; letter-spacing: 0.08em; }
      .meta-box strong { font-size: 14px; }
      .name-band {
        margin-top: 12px;
        padding: 10px 12px;
        border-radius: 14px;
        background: rgba(255,255,255,0.44);
        border: 1px dashed rgba(111, 73, 95, 0.42);
        font-size: 13px;
        line-height: 1.5;
      }
      .footer-row { margin-top: 14px; font-size: 12px; color: #5f4e59; }
    </style>
  </head>
  <body>
    ${pages.map((page, pageIndex) => `
      <section class="page">
        <div class="page-head">
          <div>
            <strong>Aapoorti Mart Voucher Sheet</strong>
            <p>${escapeHtml(formatCurrencyInr(denominationAmount))} per voucher x ${String(warrants.length)} vouchers = ${escapeHtml(formatCurrencyInr(totalAmount))}</p>
            <p>Value received: ${escapeHtml(formatCurrencyInr(receivedAmount))}${receivedAmount < totalAmount ? ` | Promotional uplift: ${escapeHtml(formatCurrencyInr(totalAmount - receivedAmount))}` : ""}</p>
          </div>
          <div class="voucher-no">Page ${pageIndex + 1} of ${pages.length}</div>
        </div>
        <div class="grid">
          ${page.map((warrant, itemIndex) => `
            <article class="card">
              <img class="watermark" src="${logoUrl}" alt="" />
              <div class="brand-row">
                <div>
                  <div class="brand-tag">Aapoorti Mart</div>
                  <h1 class="title">Goods Voucher</h1>
                  <p class="sub">Assured supply against value received</p>
                </div>
                <div class="voucher-no">
                  <div>${escapeHtml(warrant.warrantNumber)}</div>
                  <div>${pageIndex * 4 + itemIndex + 1} / ${warrants.length}</div>
                </div>
              </div>
              <div class="amount">${escapeHtml(formatCurrencyInr(warrant.amount))}</div>
              <div class="promise">We undertake to deliver Aapoorti Mart goods worth <strong>${escapeHtml(formatCurrencyInr(warrant.amount))}</strong> to the bearer on or before <strong>${escapeHtml(formatLongDateIst(warrant.validThrough))}</strong>, against value already received and recorded for this voucher.</div>
              <div class="meta-grid">
                <div class="meta-box"><small>Outlet</small><strong>${escapeHtml(warrant.outlet)}</strong></div>
                <div class="meta-box"><small>Bearer</small><strong>${escapeHtml(warrant.issuedTo || "Bearer")}</strong></div>
                <div class="meta-box"><small>Payment Mode</small><strong>${escapeHtml(warrant.paymentMode)}</strong></div>
                <div class="meta-box"><small>Issue Date</small><strong>${escapeHtml(formatDateIst(warrant.issueOn))}</strong></div>
                <div class="meta-box"><small>Value Received</small><strong>${escapeHtml(formatCurrencyInr(warrant.receivedAmount || warrant.amount))}</strong></div>
                <div class="meta-box"><small>Voucher Worth</small><strong>${escapeHtml(formatCurrencyInr(warrant.amount))}</strong></div>
              </div>
              <div class="name-band">
                <strong>Issuer:</strong> ${escapeHtml(warrant.issuerName || warrant.createdBy || "Authorized Issuer")}<br />
                <strong>Bearer:</strong> ${escapeHtml(warrant.issuedTo || "Bearer")}<br />
                <strong>Note:</strong> ${escapeHtml(warrant.note || "Redeem only at the tagged outlet before expiry.")}
              </div>
              <div class="footer-row">
                <span>Authorized issue</span>
                <span>Valid only for tagged outlet</span>
              </div>
            </article>
          `).join("")}
        </div>
      </section>
    `).join("")}
  </body>
</html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => {
      try {
        popup.focus();
        popup.print();
      } catch {}
    }, 350);
  }

  function openGoodsWarrantPrintWindow() {
    if (typeof window === "undefined") return null;
    return window.open("", "_blank", "width=900,height=1200");
  }

  function printGoodsWarrant(warrant: GoodsWarrantRecord) {
    const popup = openGoodsWarrantPrintWindow();
    if (!popup) return false;
    writeGoodsWarrantPrintDocument(popup, warrant);
    return true;
  }

  function openEditWarrant(item: GoodsWarrantRecord) {
    setEditingWarrantId(item.id);
    setEditDrafts((current) => ({
      ...current,
      [item.id]: {
        issuedTo: item.issuedTo || "",
        issuerName: item.issuerName || "",
        receivedAmount: String(item.receivedAmount || item.amount || 0),
        amount: String(item.amount || 0),
        paymentMode: item.paymentMode,
        chequeNumber: item.chequeNumber || "",
        cashCollectedOn: item.cashCollectedOn || today,
        validThrough: item.validThrough || today,
        note: item.note || ""
      }
    }));
  }

  function setEditDraftValue(id: string, key: "issuedTo" | "issuerName" | "receivedAmount" | "amount" | "paymentMode" | "chequeNumber" | "cashCollectedOn" | "validThrough" | "note", value: string) {
    setEditDrafts((current) => ({
      ...current,
      [id]: {
        ...(current[id] || {
          issuedTo: "",
          issuerName: "",
          receivedAmount: "0",
          amount: "0",
          paymentMode: "Cash" as GoodsWarrantPaymentMode,
          chequeNumber: "",
          cashCollectedOn: today,
          validThrough: today,
          note: ""
        }),
        [key]: value
      }
    }));
  }

  async function saveWarrantEdit(id: string) {
    if (!sessionToken) return;
    const draft = editDrafts[id];
    if (!draft) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.put<{ snapshot: AppSnapshot }>(`/goods-warrants/${id}`, {
        issuedTo: draft.issuedTo.trim() || undefined,
        issuerName: draft.issuerName.trim() || undefined,
        receivedAmount: Number(draft.receivedAmount || 0),
        amount: Number(draft.amount || 0),
        paymentMode: draft.paymentMode,
        chequeNumber: draft.paymentMode === "Cheque" ? draft.chequeNumber.trim() || undefined : undefined,
        cashCollectedOn: draft.paymentMode === "Cash" ? draft.cashCollectedOn : undefined,
        validThrough: draft.validThrough,
        note: draft.note.trim() || undefined
      }, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data.snapshot);
      setEditingWarrantId("");
      setMessage("Voucher updated.");
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Voucher update failed.") : "Voucher update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function clearRegister() {
    if (!sessionToken) return;
    if (typeof window !== "undefined" && !window.confirm("Delete all previously created vouchers from the register?")) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.delete<{ snapshot: AppSnapshot }>("/goods-warrants", {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data.snapshot);
      setMessage("Old vouchers removed from the register.");
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Voucher register clear failed.") : "Voucher register clear failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitWarrant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sessionToken) return;
    if (!hasExactDenominationSplit) {
      setError("Total amount must divide exactly by voucher denomination.");
      return;
    }
    const popup = openGoodsWarrantPrintWindow();
    if (!popup) {
      setError("Popup blocked. Allow popups for this site, then try again.");
      return;
    }
    popup.document.write("<!doctype html><html><head><title>Preparing vouchers...</title></head><body style=\"font-family:Segoe UI,sans-serif;padding:24px;\">Preparing voucher sheet...</body></html>");
    popup.document.close();
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post<{ warrants: GoodsWarrantRecord[]; snapshot: AppSnapshot }>("/goods-warrants/bulk", {
        outlet: form.outlet,
        issuedTo: form.issuedTo.trim() || undefined,
        issuerName: form.issuerName.trim() || undefined,
        receivedAmount: receivedAmountNumber,
        totalAmount: totalAmountNumber,
        denominationAmount: denominationAmountNumber,
        allowedPerMonth: allowedPerMonthNumber,
        paymentMode: form.paymentMode,
        chequeNumber: form.paymentMode === "Cheque" ? form.chequeNumber.trim() || undefined : undefined,
        cashCollectedOn: form.paymentMode === "Cash" ? form.cashCollectedOn : undefined,
        issueStartOn: form.validThrough,
        note: form.note.trim() || undefined
      }, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data.snapshot);
      setMessage(`${data.warrants.length} vouchers created at ${formatCurrencyInr(denominationAmountNumber)} each.`);
      writeGoodsWarrantSheetPrintDocument(popup, data.warrants, totalAmountNumber, denominationAmountNumber, receivedAmountNumber);
      resetForm();
    } catch (submitError) {
      popup.close();
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Voucher creation failed.") : "Voucher creation failed.");
    } finally {
      setLoading(false);
    }
  }

  function downloadRegister() {
    const headers = ["Warrant No", "Outlet", "Bearer", "Issuer", "Received Amount", "Voucher Worth", "Bonus Value", "Payment Mode", "Cheque No", "Cash Collected On", "Issue Date", "Valid Through", "Created By", "Created At", "Note"];
    const rows = snapshot.goodsWarrants.map((item) => ([
      item.warrantNumber,
      item.outlet,
      item.issuedTo || "Bearer",
      item.issuerName || "",
      (item.receivedAmount || item.amount).toFixed(2),
      item.amount.toFixed(2),
      Math.max(item.amount - (item.receivedAmount || item.amount), 0).toFixed(2),
      item.paymentMode,
      item.chequeNumber || "",
      item.cashCollectedOn || "",
      item.issueOn,
      item.validThrough,
      item.createdBy,
      item.createdAt,
      item.note
    ]));
    downloadExcelWorkbook(`goods-warrants-${today}.xlsx`, headers, rows, "Goods Warrants");
  }

  const outletSelected = Boolean(form.outlet);

  return (
    <TwoCol
      left={<Panel title="Generate Voucher Sheet" eyebrow="Accounts only">
        <form className="form-grid" onSubmit={(event) => void submitWarrant(event)}>
          <label>Outlet<select value={form.outlet} onChange={(event) => setForm((current) => ({ ...current, outlet: event.target.value as GoodsWarrantOutlet | "" }))}>
            <option value="">Select outlet to continue</option>
            {goodsWarrantOutlets.map((outlet) => <option key={outlet} value={outlet}>{outlet}</option>)}
          </select></label>
          {!outletSelected ? <p className="message wide-field">Select an outlet first. Warrant generation is outlet-tagged.</p> : null}
          <label>Name of bearer<input value={form.issuedTo} disabled={!outletSelected} placeholder="Enter bearer name" onChange={(event) => setForm((current) => ({ ...current, issuedTo: event.target.value }))} /></label>
          <label>Name of issuer<input value={form.issuerName} disabled={!outletSelected} placeholder="Enter issuer name" onChange={(event) => setForm((current) => ({ ...current, issuerName: event.target.value }))} /></label>
          <label>Money received<input type="number" min="0" step="0.01" value={form.receivedAmount} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, receivedAmount: event.target.value }))} /></label>
          <label>Voucher worth to issue<input type="number" min="0" step="0.01" value={form.totalAmount} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, totalAmount: event.target.value }))} /></label>
          <label>Per voucher denomination<input type="number" min="0" step="0.01" value={form.denominationAmount} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, denominationAmount: event.target.value }))} /></label>
          <label>Allowed per month<input type="number" min="1" step="1" value={form.allowedPerMonth} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, allowedPerMonth: event.target.value }))} /></label>
          <label>Payment mode<select value={form.paymentMode} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, paymentMode: event.target.value as GoodsWarrantPaymentMode }))}><option value="Cash">Cash</option><option value="Cheque">Cheque</option></select></label>
          {form.paymentMode === "Cheque"
            ? <label>Cheque number<input value={form.chequeNumber} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, chequeNumber: event.target.value }))} /></label>
            : <label>Cash collection date<input type="date" value={form.cashCollectedOn} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, cashCollectedOn: event.target.value }))} /></label>}
          <label>First voucher issue date<input type="date" value={form.validThrough} disabled={!outletSelected} onChange={(event) => setForm((current) => ({ ...current, validThrough: event.target.value }))} /></label>
          <label className="wide-field">Print note<input value={form.note} disabled={!outletSelected} placeholder="Optional note to print on warrant" onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} /></label>
          {outletSelected && totalAmountNumber > 0 && denominationAmountNumber > 0 ? (
            <div className="message wide-field">
              {hasExactDenominationSplit
                ? `${formatCurrencyInr(receivedAmountNumber || 0)} received, ${formatCurrencyInr(totalAmountNumber)} voucher worth issued, bonus value ${formatCurrencyInr(bonusValueNumber)}. ${formatCurrencyInr(denominationAmountNumber)} per voucher = ${voucherCount} vouchers. ${allowedPerMonthNumber} voucher(s) per cycle will be issued from ${formatDateIst(form.validThrough)} to ${formatDateIst(subtractOneDayFromNextMonth(form.validThrough))}, then the next ${allowedPerMonthNumber} will start on ${formatDateIst(addOneMonthForVoucherPreview(form.validThrough))}.`
                : `Amount split is not exact. ${formatCurrencyInr(totalAmountNumber)} cannot be divided cleanly into ${formatCurrencyInr(denominationAmountNumber)} vouchers.`}
            </div>
          ) : null}
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit" disabled={!outletSelected || !hasExactDenominationSplit || receivedAmountNumber < 0}>Generate and print</button>
            <button className="ghost-button" type="button" onClick={resetForm}>Clear</button>
            <button className="ghost-button" type="button" onClick={() => void clearRegister()} disabled={snapshot.goodsWarrants.length === 0}>Remove old vouchers</button>
            <button className="ghost-button" type="button" onClick={downloadRegister} disabled={snapshot.goodsWarrants.length === 0}>Download Excel Register</button>
          </div>
          <div className="message wide-field">For old voucher bonus issue, set `Money received` to `0`, enter only the extra `Voucher worth to issue`, and mention the old batch in the note.</div>
        </form>
      </Panel>}
      right={<Panel title="Voucher Register" eyebrow={`${snapshot.goodsWarrants.length} records`}>
        {snapshot.goodsWarrants.length === 0 ? <div className="empty-card">No vouchers generated yet.</div> : <div className="report-accordion-list">
          {snapshot.goodsWarrants.map((item) => (
            <article key={item.id} className="list-card report-accordion-card">
              <div className="report-accordion-toggle goods-warrant-row">
                <div className="report-accordion-main">
                  <span className="small-label">{item.warrantNumber}</span>
                  <strong>{item.outlet}</strong>
                  <p>{item.issuedTo || "Bearer"} | {item.issuerName || item.createdBy} | {item.paymentMode}</p>
                </div>
                <div className="report-accordion-vitals">
                  <span><small>Received</small><strong>{formatCurrencyInr(item.receivedAmount || item.amount)}</strong></span>
                  <span><small>Voucher Worth</small><strong>{formatCurrencyInr(item.amount)}</strong></span>
                  <span><small>Valid Through</small><strong>{formatDateIst(item.validThrough)}</strong></span>
                  <span><small>Issue Date</small><strong>{formatDateIst(item.issueOn)}</strong></span>
                </div>
                <div className="report-accordion-side">
                  <button className="ghost-button" type="button" onClick={() => printGoodsWarrant(item)}>Print</button>
                  <button className="ghost-button" type="button" onClick={() => openEditWarrant(item)}>{editingWarrantId === item.id ? "Editing" : "Edit"}</button>
                </div>
              </div>
              {editingWarrantId === item.id ? <div className="form-grid top-gap">
                <label>Bearer<input value={editDrafts[item.id]?.issuedTo || ""} onChange={(e) => setEditDraftValue(item.id, "issuedTo", e.target.value)} /></label>
                <label>Issuer<input value={editDrafts[item.id]?.issuerName || ""} onChange={(e) => setEditDraftValue(item.id, "issuerName", e.target.value)} /></label>
                <label>Money received<input type="number" min="0" step="0.01" value={editDrafts[item.id]?.receivedAmount || ""} onChange={(e) => setEditDraftValue(item.id, "receivedAmount", e.target.value)} /></label>
                <label>Voucher worth<input type="number" min="0" step="0.01" value={editDrafts[item.id]?.amount || ""} onChange={(e) => setEditDraftValue(item.id, "amount", e.target.value)} /></label>
                <label>Payment mode<select value={editDrafts[item.id]?.paymentMode || "Cash"} onChange={(e) => setEditDraftValue(item.id, "paymentMode", e.target.value)}><option value="Cash">Cash</option><option value="Cheque">Cheque</option></select></label>
                {(editDrafts[item.id]?.paymentMode || "Cash") === "Cheque"
                  ? <label>Cheque number<input value={editDrafts[item.id]?.chequeNumber || ""} onChange={(e) => setEditDraftValue(item.id, "chequeNumber", e.target.value)} /></label>
                  : <label>Cash collection date<input type="date" value={editDrafts[item.id]?.cashCollectedOn || today} onChange={(e) => setEditDraftValue(item.id, "cashCollectedOn", e.target.value)} /></label>}
                <label>Valid through<input type="date" value={editDrafts[item.id]?.validThrough || today} onChange={(e) => setEditDraftValue(item.id, "validThrough", e.target.value)} /></label>
                <label className="wide-field">Note<input value={editDrafts[item.id]?.note || ""} onChange={(e) => setEditDraftValue(item.id, "note", e.target.value)} /></label>
                <div className="message wide-field">Bonus value: {formatCurrencyInr(Math.max(Number(editDrafts[item.id]?.amount || 0) - Number(editDrafts[item.id]?.receivedAmount || 0), 0))}</div>
                <div className="payment-card-actions wide-field">
                  <button className="primary-button" type="button" onClick={() => void saveWarrantEdit(item.id)}>Save voucher</button>
                  <button className="ghost-button" type="button" onClick={() => setEditingWarrantId("")}>Cancel</button>
                </div>
              </div> : null}
            </article>
          ))}
        </div>}
      </Panel>}
    />
  );
}

export function StandaloneExcelMaker() {
  const today = new Date().toISOString().slice(0, 10);
  const paymentSheetHeaders = ["PYMT_PROD_TYPE_CODE", "PYMT_MODE", "DEBIT_ACC_NO", "BNF_NAME", "BENE_ACC_NO", "BENE_IFSC", "AMOUNT", "DEBIT_NARR", "CREDIT_NARR", "MOBILE_NUM", "EMAIL_ID", "REMARK", "PYMT_DATE", "REF_NO", "ADDL_INFO1", "ADDL_INFO2", "ADDL_INFO3", "ADDL_INFO4", "ADDL_INFO5"];
  const configKey = workspaceStorageKey("excel-maker", "config");
  const rowsKey = workspaceStorageKey("excel-maker", "rows");
  const [config, setConfig] = useState(() => {
    const stored = readStoredJson(configKey, {
      productCode: "PAB_VENDOR",
      paymentMode: "NEFT",
      debitAccountNumber: "118805000220",
      mobileNumber: "9111080628",
      emailId: "",
      paymentDate: today,
      referenceNumber: "",
      remark: ""
    });
    return {
      productCode: String(stored?.productCode || "").trim() || "PAB_VENDOR",
      paymentMode: String(stored?.paymentMode || "").trim() || "NEFT",
      debitAccountNumber: String(stored?.debitAccountNumber || "").trim() || "118805000220",
      mobileNumber: String(stored?.mobileNumber || "").trim() || "9111080628",
      emailId: String(stored?.emailId || "").trim(),
      paymentDate: String(stored?.paymentDate || "").trim() || today,
      referenceNumber: String(stored?.referenceNumber || "").trim(),
      remark: String(stored?.remark || "").trim()
    };
  });
  const [partyForm, setPartyForm] = useState(() => {
    const storedRows = readStoredJson<Array<{ partyName: string; accountNumber: string; ifsc: string; amount: string }>>(rowsKey, []);
    return storedRows.length > 0 ? storedRows : [{ partyName: "", accountNumber: "", ifsc: "", amount: "" }];
  });
  const [makerError, setMakerError] = useState("");

  useEffect(() => {
    writeStoredJson(configKey, config);
  }, [config, configKey]);

  useEffect(() => {
    writeStoredJson(rowsKey, partyForm);
  }, [partyForm, rowsKey]);

  function formatPaymentDate(value: string) {
    const parts = value.split("-");
    if (parts.length !== 3) return value;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
  }

  function sanitizeFilePart(value: string) {
    return value
      .trim()
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "party";
  }

  function updatePartyRow(index: number, field: "partyName" | "accountNumber" | "ifsc" | "amount", value: string) {
    setPartyForm((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  function addPartyRow() {
    setPartyForm((current) => [...current, { partyName: "", accountNumber: "", ifsc: "", amount: "" }]);
  }

  function removePartyRow(index: number) {
    setPartyForm((current) => current.length === 1 ? [{ partyName: "", accountNumber: "", ifsc: "", amount: "" }] : current.filter((_, rowIndex) => rowIndex !== index));
  }

  function clearAllRows() {
    setPartyForm([{ partyName: "", accountNumber: "", ifsc: "", amount: "" }]);
    setMakerError("");
  }

  function buildWorkbookRows() {
    const trimmedProductCode = config.productCode.trim();
    const trimmedDebitAccount = config.debitAccountNumber.trim();
    if (!trimmedProductCode || !trimmedDebitAccount) {
      return { error: "Enter product code and debit account number first." };
    }
    const validRows = partyForm
      .map((row) => ({
        partyName: row.partyName.trim(),
        accountNumber: row.accountNumber.trim(),
        ifsc: row.ifsc.trim().toUpperCase(),
        amount: Number(row.amount)
      }))
      .filter((row) => row.partyName || row.accountNumber || row.ifsc || row.amount);
    if (validRows.length === 0) {
      return { error: "Add at least one party row." };
    }
    const invalidRow = validRows.find((row) => !row.partyName || !row.accountNumber || !row.ifsc || !(row.amount > 0));
    if (invalidRow) {
      return { error: "Each row needs party name, account number, IFSC, and amount greater than zero." };
    }
    const paymentDate = formatPaymentDate(config.paymentDate || today);
    const narrationBase = config.remark.trim() || "Party payment";
    const workbookRows = validRows.map((row, index) => {
      const rowReference = config.referenceNumber.trim() || `PMT-${paymentDate}-${index + 1}`;
      return [
        trimmedProductCode,
        config.paymentMode.trim() || "NEFT",
        trimmedDebitAccount,
        row.partyName,
        row.accountNumber,
        row.ifsc,
        row.amount.toFixed(2),
        narrationBase,
        narrationBase,
        config.mobileNumber.trim(),
        config.emailId.trim(),
        config.remark.trim(),
        paymentDate,
        rowReference,
        "",
        "",
        "",
        "",
        ""
      ];
    });
    return { workbookRows };
  }

  function downloadWorkbook() {
    const result = buildWorkbookRows();
    if ("error" in result) {
      setMakerError(result.error || "Unable to build workbook rows.");
      return;
    }
    setMakerError("");
    const firstFilledRow = partyForm.find((row) => row.partyName.trim() && Number(row.amount) > 0);
    const filePartyName = sanitizeFilePart(firstFilledRow?.partyName || "party");
    const fileAmount = Number(firstFilledRow?.amount || 0).toFixed(2);
    const fileDate = sanitizeFilePart(config.paymentDate || today);
    downloadExcelWorkbook(`${filePartyName}-${fileAmount}-${fileDate}.xlsx`, paymentSheetHeaders, result.workbookRows, "Sheet1");
  }

  const previewRows = buildWorkbookRows();
  const previewWorkbookRows = "workbookRows" in previewRows ? (previewRows.workbookRows || []) : [];

  return (
    <TwoCol
      left={<Panel title="Party Excel Maker" eyebrow="Standalone utility">
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); downloadWorkbook(); }}>
          <label>Product code<input value={config.productCode} onChange={(event) => setConfig((current) => ({ ...current, productCode: event.target.value }))} /></label>
          <label>Payment mode<input value={config.paymentMode} onChange={(event) => setConfig((current) => ({ ...current, paymentMode: event.target.value }))} /></label>
          <label>Debit account number<input value={config.debitAccountNumber} onChange={(event) => setConfig((current) => ({ ...current, debitAccountNumber: event.target.value }))} /></label>
          <label>Mobile number<input value={config.mobileNumber} onChange={(event) => setConfig((current) => ({ ...current, mobileNumber: event.target.value }))} /></label>
          <label>Email ID<input value={config.emailId} onChange={(event) => setConfig((current) => ({ ...current, emailId: event.target.value }))} /></label>
          <label>Payment date<input type="date" value={config.paymentDate} onChange={(event) => setConfig((current) => ({ ...current, paymentDate: event.target.value }))} /></label>
          <label>Reference no<input value={config.referenceNumber} placeholder="Optional fixed reference" onChange={(event) => setConfig((current) => ({ ...current, referenceNumber: event.target.value }))} /></label>
          <label className="wide-field">Remark<input value={config.remark} placeholder="Optional narration / remark" onChange={(event) => setConfig((current) => ({ ...current, remark: event.target.value }))} /></label>
          {makerError ? <p className="message error wide-field">{makerError}</p> : null}
          <div className="payment-card-actions wide-field">
            <button className="primary-button" type="submit">Download Excel</button>
            <button className="ghost-button" type="button" onClick={addPartyRow}>Add party row</button>
            <button className="ghost-button" type="button" onClick={clearAllRows}>Clear rows</button>
          </div>
        </form>
      </Panel>}
      right={<Panel title="Party Details" eyebrow="Name / account / IFSC / amount">
        <div className="form-grid">
          {partyForm.map((row, index) => (
            <div className="panel" key={`party-row-${index}`}>
              <div className="payment-card-actions">
                <strong>Party {index + 1}</strong>
                <button className="ghost-button" type="button" onClick={() => removePartyRow(index)}>Remove</button>
              </div>
              <div className="form-grid top-gap">
                <label>Party name<input value={row.partyName} onChange={(event) => updatePartyRow(index, "partyName", event.target.value)} /></label>
                <label>Account number<input value={row.accountNumber} onChange={(event) => updatePartyRow(index, "accountNumber", event.target.value)} /></label>
                <label>IFSC<input value={row.ifsc} onChange={(event) => updatePartyRow(index, "ifsc", event.target.value.toUpperCase())} /></label>
                <label>Amount<input type="number" min="0" step="0.01" value={row.amount} onChange={(event) => updatePartyRow(index, "amount", event.target.value)} /></label>
              </div>
            </div>
          ))}
        </div>
        {previewWorkbookRows.length > 0 ? <div className="table-wrap top-gap">
          <table>
            <thead>
              <tr>{paymentSheetHeaders.map((header) => <th key={header}>{header}</th>)}</tr>
            </thead>
            <tbody>
              {previewWorkbookRows.map((row, index) => <tr key={`preview-row-${index}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        </div> : <p className="small-label top-gap">Preview will appear after valid party details are entered.</p>}
      </Panel>}
    />
  );
}

export function ProductAdminView({
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
  const emptyForm: ProductFormState = { sku: "", name: "", brand: "", division: "", department: "", section: "", category: "", subCategory: "", unit: "", rsp: "0", mrp: "0", isSeasonal: false, offerLabel: "", offerPrice: "", defaultGstRate: "0", defaultTaxMode: "Exclusive", defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "1", allowedWarehouseIds: prioritizeWarehouseIds(snapshot.warehouses.map((warehouse) => warehouse.id)) };
  const [selectedSku, setSelectedSku] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const filteredProductOptions = snapshot.products.filter((product) => `${product.sku} ${product.name} ${product.division} ${product.department} ${product.section}`.toLowerCase().includes(skuSearch.trim().toLowerCase()));
  const divisionOptions = uniqueProductFieldOptions(snapshot.products, "division");
  const departmentOptions = uniqueProductFieldOptions(snapshot.products, "department");
  const sectionOptions = uniqueProductFieldOptions(snapshot.products, "section");
  const categoryOptions = uniqueProductFieldOptions(snapshot.products, "category");
  const subCategoryOptions = Array.from(new Set([...standardSubCategoryOptions, ...uniqueProductFieldOptions(snapshot.products, "subCategory")])).sort((left, right) => left.localeCompare(right, "en-IN"));
  const useStaplesWeightSelection = isStaplesNonBrandedCategory(productForm.category, productForm.subCategory);

  function toPayload(form: ProductFormState) {
    return {
      ...form,
      defaultGstRate: form.defaultGstRate,
      defaultTaxMode: form.defaultTaxMode,
      defaultWeightKg: Number(form.defaultWeightKg),
      toleranceKg: Number(form.toleranceKg),
      tolerancePercent: Number(form.tolerancePercent),
      rsp: Number(form.rsp || 0),
      mrp: Number(form.mrp || 0),
      offerPrice: form.offerPrice.trim() ? Number(form.offerPrice) : undefined,
      allowedWarehouseIds: prioritizeWarehouseIds(form.allowedWarehouseIds.length > 0 ? form.allowedWarehouseIds : snapshot.warehouses.map((warehouse) => warehouse.id))
    };
  }

  function normalizeStaplesWeightSelection(nextForm: ProductFormState) {
    if (!isStaplesNonBrandedCategory(nextForm.category, nextForm.subCategory)) {
      return nextForm;
    }
    if (nonBrandedStaplesWeightOptions.some((option) => option.value === nextForm.defaultWeightKg)) {
      return nextForm;
    }
    return { ...nextForm, defaultWeightKg: "1" };
  }

  function updateProductForm(mutator: (current: ProductFormState) => ProductFormState) {
    setProductForm((current) => normalizeStaplesWeightSelection(mutator(current)));
  }

  function loadProduct(sku: string) {
    setSelectedSku(sku);
    const product = snapshot.products.find((item) => item.sku === sku);
    if (!product) return;
    setProductForm(normalizeStaplesWeightSelection({
      sku: product.sku,
      name: product.name,
      brand: product.brand || "",
      division: product.division,
      department: product.department,
      section: product.section,
      category: product.category,
      subCategory: product.subCategory,
      unit: product.unit,
      rsp: String(product.rsp || 0),
      mrp: String(product.mrp || 0),
      isSeasonal: Boolean(product.isSeasonal),
      offerLabel: product.offerLabel || "",
      offerPrice: product.offerPrice == null ? "" : String(product.offerPrice),
      defaultGstRate: String(product.defaultGstRate === "NA" ? 0 : product.defaultGstRate) as GstRateInput,
      defaultTaxMode: product.defaultTaxMode === "NA" ? "Exclusive" : product.defaultTaxMode,
      defaultWeightKg: String(product.defaultWeightKg),
      toleranceKg: String(product.toleranceKg),
      tolerancePercent: String(product.tolerancePercent),
      allowedWarehouseIds: product.allowedWarehouseIds
    }));
  }

  return (
    <TwoCol
      left={<Panel title="Product Master" eyebrow="Create / modify / delete">
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); selectedSku ? onUpdate(selectedSku, toPayload(productForm)) : onCreate(toPayload(productForm)); }}>
          <label>Search SKU / Product<input value={skuSearch} placeholder="Type SKU or product name" onChange={(event) => setSkuSearch(event.target.value)} /></label>
          <label>Select SKU<select value={selectedSku} onChange={(event) => loadProduct(event.target.value)}>{renderProductOptions(filteredProductOptions)}</select></label>
          <label>SKU<input value={productForm.sku} readOnly={Boolean(selectedSku)} onChange={(event) => updateProductForm((current) => ({ ...current, sku: event.target.value }))} /></label>
          <label>Name<input value={productForm.name} onChange={(event) => updateProductForm((current) => ({ ...current, name: event.target.value }))} /></label>
          <label>Brand<input value={productForm.brand} onChange={(event) => updateProductForm((current) => ({ ...current, brand: event.target.value }))} /></label>
          <label>Division<input list="product-division-options" value={productForm.division} placeholder="Type or select saved division" onChange={(event) => updateProductForm((current) => ({ ...current, division: event.target.value }))} /></label>
          <label>Department<input list="product-department-options" value={productForm.department} placeholder="Type or select saved department" onChange={(event) => updateProductForm((current) => ({ ...current, department: event.target.value }))} /></label>
          <label>Section<input list="product-section-options" value={productForm.section} placeholder="Type or select saved section" onChange={(event) => updateProductForm((current) => ({ ...current, section: event.target.value }))} /></label>
          <label>Category<input list="product-category-options" value={productForm.category} placeholder="Type or select saved category" onChange={(event) => updateProductForm((current) => ({ ...current, category: event.target.value }))} /></label>
          <label>Subcategory<input list="product-subcategory-options" value={productForm.subCategory} placeholder="Type or select saved subcategory" onChange={(event) => updateProductForm((current) => ({ ...current, subCategory: event.target.value }))} /></label>
          <datalist id="product-division-options">{divisionOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-department-options">{departmentOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-section-options">{sectionOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-category-options">{categoryOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <datalist id="product-subcategory-options">{subCategoryOptions.map((value) => <option key={value} value={value} />)}</datalist>
          <label>Unit<input value={productForm.unit} onChange={(event) => updateProductForm((current) => ({ ...current, unit: event.target.value }))} /></label>
          <label>Purchase price<input type="number" min="0" step="any" value={productForm.rsp} onChange={(event) => updateProductForm((current) => ({ ...current, rsp: event.target.value }))} /></label>
          <label>Sale price / MRP<input type="number" min="0" step="any" value={productForm.mrp} onChange={(event) => updateProductForm((current) => ({ ...current, mrp: event.target.value }))} /></label>
          <label className="checkbox-line"><input type="checkbox" checked={productForm.isSeasonal} onChange={(event) => updateProductForm((current) => ({ ...current, isSeasonal: event.target.checked }))} />Seasonal item</label>
          <label>Offer name<input value={productForm.offerLabel} placeholder="Summer offer, 10% off..." onChange={(event) => updateProductForm((current) => ({ ...current, offerLabel: event.target.value }))} /></label>
          <label>Offer price<input type="number" min="0" step="any" value={productForm.offerPrice} onChange={(event) => updateProductForm((current) => ({ ...current, offerPrice: event.target.value }))} /></label>
          <label>Default GST<select value={productForm.defaultGstRate === "NA" ? "0" : productForm.defaultGstRate} onChange={(event) => updateProductForm((current) => ({ ...current, defaultGstRate: event.target.value as GstRateInput, defaultTaxMode: current.defaultTaxMode === "NA" ? "Exclusive" : current.defaultTaxMode }))}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label>
          <label>Default Tax<select value={productForm.defaultTaxMode === "NA" ? "Exclusive" : productForm.defaultTaxMode} onChange={(event) => updateProductForm((current) => ({ ...current, defaultTaxMode: event.target.value as TaxModeInput }))}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option></select></label>
          <label>
            Per item / bundle weight
            {useStaplesWeightSelection ? (
              <select value={productForm.defaultWeightKg} onChange={(event) => updateProductForm((current) => ({ ...current, defaultWeightKg: event.target.value }))}>
                {nonBrandedStaplesWeightOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            ) : (
              <input type="number" step="any" value={productForm.defaultWeightKg} onChange={(event) => updateProductForm((current) => ({ ...current, defaultWeightKg: event.target.value }))} />
            )}
          </label>
          <label>Tol. Kg<input type="number" step="any" value={productForm.toleranceKg} onChange={(event) => updateProductForm((current) => ({ ...current, toleranceKg: event.target.value }))} /></label>
          <label>Tol. %<input type="number" step="any" value={productForm.tolerancePercent} onChange={(event) => updateProductForm((current) => ({ ...current, tolerancePercent: event.target.value }))} /></label>
          <label>Warehouses<select multiple value={productForm.allowedWarehouseIds.length > 0 ? productForm.allowedWarehouseIds : prioritizeWarehouseIds(snapshot.warehouses.map((warehouse) => warehouse.id))} onChange={(event) => updateProductForm((current) => ({ ...current, allowedWarehouseIds: prioritizeWarehouseIds(Array.from(event.target.selectedOptions).map((option) => option.value)) }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label>
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
        <Panel title="Products" eyebrow="Division > Department > Section"><DataTable headers={["SKU","Name","Brand","Category","Subcategory","Purchase","Sale","Seasonal / offer","Default GST"]} rows={snapshot.products.map((product) => [product.sku, productDisplayLabel(product), product.brand || "-", product.category, product.subCategory, product.rsp || 0, product.mrp || 0, [product.isSeasonal ? "Seasonal" : "", product.offerLabel || "", product.offerPrice != null ? `@ ${product.offerPrice}` : ""].filter(Boolean).join(" · ") || "-", `${product.defaultGstRate === "NA" ? 0 : product.defaultGstRate}% / ${product.defaultTaxMode === "NA" ? "Exclusive" : product.defaultTaxMode}`])} /></Panel>
      </>}
    />
  );
}

export function parseCsvRows(csv: string) { const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean); const headers = header.split(",").map((item) => item.trim()); return lines.map((line) => { const cols = line.split(",").map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])); return { ...row, subCategory: row.subCategory || "", defaultGstRate: (row.defaultGstRate || "0") as GstRateInput, defaultTaxMode: (row.defaultTaxMode || ((row.defaultGstRate || "0") === "NA" ? "NA" : "Exclusive")) as TaxModeInput, defaultWeightKg: Number(row.defaultWeightKg || 0), toleranceKg: Number(row.toleranceKg || 0), tolerancePercent: Number(row.tolerancePercent || 1), allowedWarehouseIds: String(row.allowedWarehouseIds || "").split("|").filter(Boolean), rsp: Number(row.rsp || 0), mrp: Number(row.mrp || 0), isSeasonal: /^(1|true|yes|y)$/i.test(String(row.isSeasonal || "")), offerPrice: row.offerPrice ? Number(row.offerPrice) : undefined }; }); }
