import type {
AppSnapshot,
AppUser,
DeliveryConsignment,
DeliveryDocket,
DeliveryTask,
NoteRecord,
PaymentMode,
PurchaseOrder,
SalesOrder,
SalesStatus
} from "@aapoorti-b2b/domain";
import type { ChangeEvent } from "react";
import { useEffect,useState } from "react";
import { renderWarehouseOptions } from "../../app/formOptions";
import { LabelWithBadge,Panel } from "../../components/ui";

import {
API_BASE,
consignmentExportHeaders,
consignmentExportRows,
countGroupedOrders,
dateKeyInRange,
deliveryConsignmentStatusLabel,
deliveryTaskStatusLabel,
distanceKmBetween,
docketExportHeaders,
docketExportRows,
downloadReportCsv,
downloadReportPdf,
downloadSalesInvoicePdf,
formatDateTimeIst,
groupNewestCreatedAt,
inboundOpsExportHeaders,
inboundOpsExportRows,
indiaDateKey,
indiaYesterdayDateKey,
isDeliveryExecutive,
isDeliveryTaskPending,
isInboundDeliveryUser,
isOutboundDeliveryUser,
isUserAssignedToDelivery,
isWarehouseScoped,
mapsDirectionsUrl,
nearestNeighborOrder,
normalizeDateRange,
orderPublicId,
outboundOpsExportHeaders,
outboundOpsExportRows,
printSalesInvoice,
productNameBySku,
purchaseOrderExportHeaders,
purchaseOrderExportRows,
purchasePaymentStatus,
readStoredJson,
salesInvoiceWhatsappText,
salesOrderPublicTotal,
salesStatusLabel,
snapshotForWarehouseScope,
statusPillClass,
userWarehouseScope,
workspaceStorageKey,
writeStoredJson
} from "../../app/shared";

export function WarehouseOperationsView({
  snapshot,
  currentUser,
  onUploadProof,
  onReceive,
  onUpdateSalesOrder,
  onCreateDeliveryTask,
  onCreateConsignment
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onReceive: (body: { purchaseOrderId: string; warehouseId: string; receivedQuantity: number; actualWeightKg: number; containerWeightKg?: number; weighingProofName?: string; note: string; confirmPartial: boolean }) => Promise<boolean | void>;
  onUpdateSalesOrder: (id: string, body: { rate: number; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; containerWeightKg?: number; weighingProofName?: string }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; mode: DeliveryTask["mode"]; transportType?: DeliveryTask["transportType"]; vehicleNumber?: string; freightAmount?: number; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onCreateConsignment: (body: { docketIds: string[]; warehouseId: string; assignedTo: string; status: string }) => Promise<boolean | void>;
}) {
  const incomingOrders = snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const outgoingOrders = snapshot.salesOrders.filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Pending Pickup" || item.status === "Out for Delivery").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const incomingOrderGroups = Array.from(incomingOrders.reduce((groups, order) => {
    const key = orderPublicId(order);
    groups.set(key, [...(groups.get(key) || []), order]);
    return groups;
  }, new Map<string, PurchaseOrder[]>()).entries()).map(([id, lines]) => ({ id, lines }));
  const openDockets = snapshot.deliveryDockets.filter((item) => item.status !== "Delivered" && !item.consignmentId);
  const deliveryUsers = snapshot.users.filter(isDeliveryExecutive);
  const [consignmentDraft, setConsignmentDraft] = useState({ docketIds: [] as string[], warehouseId: "", assignedTo: "delivery" });
  const selectedDockets = openDockets.filter((item) => consignmentDraft.docketIds.includes(item.id));
  const selectedDocketWeight = selectedDockets.reduce((sum, item) => sum + item.weightKg, 0);
  const [expandedIncomingIds, setExpandedIncomingIds] = useState<Record<string, boolean>>({});
  const [incomingDrafts, setIncomingDrafts] = useState<Record<string, { receivedQuantity: string; actualWeightKg: string; containerWeightKg: string; weighingProofName: string; cashProofName: string; note: string }>>({});
  const [outgoingDrafts, setOutgoingDrafts] = useState<Record<string, { containerWeightKg: string; weighingProofName: string; assignedTo: string }>>({});

  async function uploadWeighingProof(draftKey: string, file: File | null, side: "incoming" | "outgoing") {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    if (side === "incoming") {
      setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", note: "" }), weighingProofName: fileName } }));
      return;
    }
    setOutgoingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { containerWeightKg: "0", weighingProofName: "", assignedTo: deliveryUsers[0]?.username || "delivery" }), weighingProofName: fileName } }));
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Warehouse Summary" eyebrow="Inbound and outbound">
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{incomingOrderGroups.length}</strong><p>Orders to receive</p></div></div>
          <div className="list-card"><div><strong>{outgoingOrders.length}</strong><p>Orders to send</p></div></div>
          <div className="list-card"><div><strong>{snapshot.stockSummary.reduce((sum, item) => sum + item.availableQuantity, 0)}</strong><p>Available stock</p></div></div>
        </div>
      </Panel>
      <Panel title="Incoming Orders" eyebrow="Oldest first">
        <div className="stack-list payment-update-list">
          {incomingOrderGroups.length === 0 ? <div className="empty-card">No incoming orders pending.</div> : incomingOrderGroups.map((group) => {
            const first = group.lines[0];
            const totalPendingQty = group.lines.reduce((sum, order) => sum + Math.max(order.quantityOrdered - order.quantityReceived, 0), 0);
            const cumulativeWeight = group.lines.reduce((sum, order) => sum + Math.max(order.expectedWeightKg * (Math.max(order.quantityOrdered - order.quantityReceived, 0) / Math.max(order.quantityOrdered, 1)), 0), 0);
            const expanded = expandedIncomingIds[group.id] ?? false;
            const order = first;
            const pendingQty = totalPendingQty;
            const draft = incomingDrafts[first.id] || { receivedQuantity: String(Math.max(first.quantityOrdered - first.quantityReceived, 0)), actualWeightKg: String(first.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
            return <article className="list-card payment-update-card" key={group.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{group.id}</strong>
                  <p>{order.supplierName} · {order.productSku} · {order.warehouseId}</p>
                </div>
                <span className="status-pill status-pending">{group.lines.some((order) => order.status === "Partially Received") ? "Partially Received" : first.status}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Products</span><strong>{group.lines.length}</strong></div>
                <div><span className="small-label">Pending qty</span><strong>{totalPendingQty}</strong></div>
                <div><span className="small-label">Amount</span><strong>{group.lines.reduce((sum, order) => sum + order.totalAmount, 0).toFixed(2)}</strong></div>
                <div><span className="small-label">Cumulative weight</span><strong>{cumulativeWeight.toFixed(2)} kg</strong></div>
              </div>
              <div className="payment-card-actions top-gap">
                <button className="ghost-button" type="button" onClick={() => setExpandedIncomingIds((current) => ({ ...current, [group.id]: !expanded }))}>{expanded ? "Close lines" : "Open lines"}</button>
              </div>
              {expanded ? <div className="stack-list top-gap">{group.lines.map((line) => <div className="list-card" key={line.id}><strong>{productNameBySku(snapshot.products, line.productSku)}</strong><p>Pending {Math.max(line.quantityOrdered - line.quantityReceived, 0)} · Expected {line.expectedWeightKg} kg · Amount {line.totalAmount}</p></div>)}</div> : null}
              {!expanded ? <form className="form-grid top-gap" onSubmit={async (event) => {
                event.preventDefault();
                const receivedQuantity = Number(draft.receivedQuantity || 0);
                const partial = receivedQuantity < pendingQty;
                await onReceive({
                  purchaseOrderId: order.id,
                  warehouseId: order.warehouseId,
                  receivedQuantity,
                  actualWeightKg: Number(draft.actualWeightKg || 0),
                  containerWeightKg: Number(draft.containerWeightKg || 0),
                  weighingProofName: draft.weighingProofName || undefined,
                  note: draft.note || `Received by ${currentUser.fullName}`,
                  confirmPartial: partial
                });
              }}>
                <label>Receive quantity<input type="number" step="any" value={draft.receivedQuantity} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, receivedQuantity: e.target.value } }))} /></label>
                <label>Actual weight<input type="number" step="any" value={draft.actualWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, actualWeightKg: e.target.value } }))} /></label>
                <label>Container weight<input type="number" step="any" value={draft.containerWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
                <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(order.id, e.target.files?.[0] || null, "incoming")} /></label>
                <label className="wide-field">Proof name<input value={draft.weighingProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
                <label className="wide-field">Note<input value={draft.note} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [order.id]: { ...draft, note: e.target.value } }))} placeholder="Complete or partial receiving note" /></label>
                <div className="payment-card-actions wide-field">
                  <span className="small-label">{Number(draft.receivedQuantity || 0) < pendingQty ? `Partial receive: ${pendingQty - Number(draft.receivedQuantity || 0)} pending` : "Complete receive"}</span>
                  <button className="primary-button" type="submit">{Number(draft.receivedQuantity || 0) < pendingQty ? "Receive partial" : "Receive complete"}</button>
                </div>
              </form> : null}
            </article>;
          })}
        </div>
      </Panel>
      <Panel title="Outgoing Orders" eyebrow="Payment check before release">
        <div className="stack-list payment-update-list">
          {outgoingOrders.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : outgoingOrders.map((order) => {
            const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order))?.pendingAmount ?? order.totalAmount;
            const deliveryCollectsCash = order.paymentMode === "Cash" && order.cashTiming === "At Delivery";
            const hasVerifiedPayment = snapshot.payments.some((item) => item.side === "Sales" && item.linkedOrderId === orderPublicId(order) && item.verificationStatus === "Verified");
            const draft = outgoingDrafts[order.id] || { containerWeightKg: "0", weighingProofName: "", assignedTo: deliveryUsers[0]?.username || "delivery" };
            return <article className="list-card payment-update-card" key={order.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{order.id}</strong>
                  <p>{order.shopName} · {productNameBySku(snapshot.products, order.productSku)} · {order.deliveryMode}</p>
                </div>
                <span className={`status-pill ${hasVerifiedPayment ? "status-verified" : "status-pending"}`}>{hasVerifiedPayment ? "Payment ok" : "Check with admin"}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Qty</span><strong>{order.quantity}</strong></div>
                <div><span className="small-label">Pending payment</span><strong>{paymentPending}</strong></div>
                <div><span className="small-label">Warehouse status</span><strong>{salesStatusLabel(order.status)}</strong></div>
                <div><span className="small-label">Delivery</span><strong>{order.deliveryMode}</strong></div>
              </div>
              <div className="form-grid top-gap">
                <label>Container weight<input type="number" step="any" value={draft.containerWeightKg} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
                <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(order.id, e.target.files?.[0] || null, "outgoing")} /></label>
                <label>Proof name<input value={draft.weighingProofName} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
                <label>Delivery guy<select value={draft.assignedTo} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [order.id]: { ...draft, assignedTo: e.target.value } }))}>{deliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label>
              </div>
              <div className="payment-card-actions">
                <button className="ghost-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: order.note || "Packed by warehouse", status: "Ready for Dispatch", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>SO docket ready</button>
                <button className="ghost-button" type="button" onClick={() => void onCreateDeliveryTask({ side: "Sales", linkedOrderId: orderPublicId(order), linkedOrderIds: [orderPublicId(order)], mode: order.deliveryMode, from: order.warehouseId, to: order.shopName, assignedTo: draft.assignedTo, paymentAction: deliveryCollectsCash && paymentPending > 0 ? "Collect Payment" : "None", cashCollectionRequired: deliveryCollectsCash && paymentPending > 0, status: "Planned" })}>Tag outbound delivery</button>
                <button className="primary-button" type="button" onClick={() => void onUpdateSalesOrder(order.id, { rate: order.rate, paymentMode: order.paymentMode, cashTiming: order.cashTiming, deliveryMode: order.deliveryMode, note: `${order.note || ""} Handed over by warehouse.`.trim(), status: "Delivered", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })}>Finalize delivered</button>
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
            assignedTo: "",
            status: "Ready"
          });
          setConsignmentDraft({ docketIds: [], warehouseId: "", assignedTo: deliveryUsers[0]?.username || "d" });
        }}>
          <label>Warehouse<select value={consignmentDraft.warehouseId} onChange={(e) => setConsignmentDraft((current) => ({ ...current, warehouseId: e.target.value }))}>{renderWarehouseOptions(snapshot.warehouses)}</select></label>
          <div><span className="small-label">Assignment</span><strong>Tag delivery after consignment creation</strong></div>
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
                <span className="status-pill status-pending">{deliveryConsignmentStatusLabel(item.status)}</span>
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

export function WarehouseOperationsViewV2({
  snapshot,
  currentUser,
  onUploadProof,
  onUploadPaymentProof,
  onReceive,
  onUpdateTask,
  onUpdateSalesOrder,
  onCreateDockets,
  onCreateDeliveryTask,
  onMergeDeliveryTasks,
  onCreateConsignment,
  screen = "full",
  canManageDeliveryTagging = false,
  canManageWarehouseChecks = true
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  onUploadProof: (file: File) => Promise<unknown>;
  onUploadPaymentProof: (file: File) => Promise<unknown>;
  onReceive: (body: { purchaseOrderId: string; warehouseId: string; receivedQuantity: number; actualWeightKg: number; containerWeightKg?: number; weighingProofName?: string; cashProofName?: string; note: string; confirmPartial: boolean }) => Promise<boolean | void>;
  onUpdateTask: (id: string, body: {
    linkedOrderIds: string[];
    consignmentId?: string;
    assignedTo: string;
    routeStops?: DeliveryTask["routeStops"];
    pickupAt?: string;
    dropAt?: string;
    routeHint?: string;
    paymentAction: DeliveryTask["paymentAction"];
    status: DeliveryTask["status"];
    cashCollectionRequired: boolean;
    cashHandoverMarked: boolean;
    weightProofName?: string;
    cashProofName?: string;
    lastActionAt?: string;
  }) => Promise<boolean | void>;
  onUpdateSalesOrder: (id: string, body: { rate: number; paymentMode: PaymentMode; cashTiming?: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; containerWeightKg?: number; weighingProofName?: string }) => Promise<boolean | void>;
  onCreateDockets: (body: { linkedOrderIds: string[] }) => Promise<boolean | void>;
  onCreateDeliveryTask: (body: { side: DeliveryTask["side"]; linkedOrderId: string; linkedOrderIds: string[]; consignmentId?: string; mode: DeliveryTask["mode"]; transportType?: DeliveryTask["transportType"]; vehicleNumber?: string; freightAmount?: number; from: string; to: string; assignedTo: string; routeHint?: string; routeStops?: DeliveryTask["routeStops"]; paymentAction: DeliveryTask["paymentAction"]; cashCollectionRequired: boolean; status: DeliveryTask["status"] }) => Promise<boolean | void>;
  onMergeDeliveryTasks: (body: { taskIds: string[] }) => Promise<boolean | void>;
  onCreateConsignment: (body: { docketIds: string[]; warehouseId: string; assignedTo: string; status: string }) => Promise<boolean | void>;
  screen?: "full" | "in" | "out";
  canManageDeliveryTagging?: boolean;
  canManageWarehouseChecks?: boolean;
}) {
  const warehouseScope = userWarehouseScope(currentUser);
  if (canManageWarehouseChecks && isWarehouseScoped(currentUser) && warehouseScope.size > 0) {
    snapshot = snapshotForWarehouseScope(snapshot, Array.from(warehouseScope));
  }
  type PurchaseGroup = { id: string; lines: PurchaseOrder[] };
  type SalesGroup = { id: string; lines: SalesOrder[] };
  const persistKey = workspaceStorageKey(currentUser.id, `warehouse-ops-${screen}`);
  const persisted = readStoredJson(persistKey, {
    activeTab: screen === "in" ? "in" : screen === "out" ? "out" : "home" as "home" | "in" | "out",
    inboundStep: "pickup" as "pickup" | "dealer" | "receive" | "planned" | "completed",
    outboundStep: "check" as "check" | "self" | "tag" | "bundle" | "planned" | "completed",
    consignmentDraft: { docketIds: [] as string[], warehouseId: "", assignedTo: ["out"] as string[] }
  });
  const [activeTab, setActiveTab] = useState<"home" | "in" | "out">(persisted.activeTab || (screen === "in" ? "in" : screen === "out" ? "out" : "home"));
  const [expandedReceive, setExpandedReceive] = useState<Record<string, boolean>>({});
  const [expandedReceiveVendor, setExpandedReceiveVendor] = useState<Record<string, boolean>>({});
  const [expandedReceiveDocketSummary, setExpandedReceiveDocketSummary] = useState<Record<string, boolean>>({});
  const [expandedSend, setExpandedSend] = useState<Record<string, boolean>>({});
  const [expandedSendStop, setExpandedSendStop] = useState<Record<string, boolean>>({});
  const [expandedReceiveSummary, setExpandedReceiveSummary] = useState<Record<string, boolean>>({});
  const [expandedSendSummary, setExpandedSendSummary] = useState<Record<string, boolean>>({});
  const [selectedReceiveLines, setSelectedReceiveLines] = useState<Record<string, string[]>>({});
  const [receivingVendorKeys, setReceivingVendorKeys] = useState<Record<string, boolean>>({});
  const [finalizingReceiveDockets, setFinalizingReceiveDockets] = useState<Record<string, boolean>>({});
  const [processingSendKeys, setProcessingSendKeys] = useState<Record<string, boolean>>({});
  const [selectedInboundGroups, setSelectedInboundGroups] = useState<string[]>([]);
  const [selectedOutboundGroups, setSelectedOutboundGroups] = useState<string[]>([]);
  const [selectedPlannedOutboundTaskIds, setSelectedPlannedOutboundTaskIds] = useState<string[]>([]);
  const [inboundAssignedTo, setInboundAssignedTo] = useState<string[]>(["in"]);
  const [outboundAssignedTo, setOutboundAssignedTo] = useState<string[]>(["out"]);
  const [inboundTransportType, setInboundTransportType] = useState<DeliveryTask["transportType"]>("Internal");
  const [outboundTransportType, setOutboundTransportType] = useState<DeliveryTask["transportType"]>("Internal");
  const [inboundExternalVehicleNumber, setInboundExternalVehicleNumber] = useState("");
  const [outboundExternalVehicleNumber, setOutboundExternalVehicleNumber] = useState("");
  const [inboundExternalFreightAmount, setInboundExternalFreightAmount] = useState("0");
  const [outboundExternalFreightAmount, setOutboundExternalFreightAmount] = useState("0");
  const [submittingInboundTag, setSubmittingInboundTag] = useState(false);
  const [submittingOutboundTag, setSubmittingOutboundTag] = useState(false);
  const [submittingConsignment, setSubmittingConsignment] = useState(false);
  const [receiptsMode, setReceiptsMode] = useState<"receipt" | "tag">("receipt");
  const [receiptStage, setReceiptStage] = useState<"checks" | "planned">("checks");
  const [dispatchesMode, setDispatchesMode] = useState<"dispatch" | "tag">("dispatch");
  const [inboundStep, setInboundStep] = useState<"pickup" | "dealer" | "receive" | "planned" | "completed">(persisted.inboundStep || (canManageWarehouseChecks ? "dealer" : "pickup"));
  const [outboundStep, setOutboundStep] = useState<"check" | "self" | "tag" | "bundle" | "planned" | "completed">(persisted.outboundStep || (
    canManageDeliveryTagging && snapshot.deliveryDockets.some((item) => item.status === "Ready" && !item.consignmentId)
      ? "bundle"
      : canManageDeliveryTagging && snapshot.deliveryConsignments.some((item) => item.status === "Ready")
        ? "bundle"
        : snapshot.deliveryTasks.some((task) => task.side === "Sales" && task.mode === "Delivery" && task.consignmentId && task.status === "Planned")
          ? "planned"
          : "check"
  ));
  const [incomingDrafts, setIncomingDrafts] = useState<Record<string, { receivedQuantity: string; actualWeightKg: string; containerWeightKg: string; weighingProofName: string; cashProofName: string; note: string }>>({});
  const [outgoingDrafts, setOutgoingDrafts] = useState<Record<string, { containerWeightKg: string; weighingProofName: string; assignedTo: string }>>({});
  const [receiveSummaryDrafts, setReceiveSummaryDrafts] = useState<Record<string, { proofName: string }>>({});
  const [sendSummaryDrafts, setSendSummaryDrafts] = useState<Record<string, { proofName: string }>>({});
  const [consignmentDraft, setConsignmentDraft] = useState(persisted.consignmentDraft || { docketIds: [] as string[], warehouseId: "", assignedTo: ["out"] as string[] });
  const [inboundDatePreset, setInboundDatePreset] = useState<"today" | "yesterday" | "custom">("today");
  const [inboundFromDate, setInboundFromDate] = useState(indiaDateKey());
  const [inboundToDate, setInboundToDate] = useState(indiaDateKey());
  const [inboundDateOpen, setInboundDateOpen] = useState(false);
  const [inboundCustomFromDraft, setInboundCustomFromDraft] = useState(indiaDateKey());
  const [inboundCustomToDraft, setInboundCustomToDraft] = useState(indiaDateKey());
  const inboundDeliveryUsers = snapshot.users.filter(isInboundDeliveryUser);
  const outboundDeliveryUsers = snapshot.users.filter(isOutboundDeliveryUser);
  const defaultInboundDeliveryUsername = inboundDeliveryUsers[0]?.username || "in";
  const defaultOutboundDeliveryUsername = outboundDeliveryUsers[0]?.username || "out";
  const normalizeSelectedDeliveryUsers = (selectedUsers: string[], users: AppUser[], fallbackUsername: string) => {
    const validUsers = Array.from(new Set(selectedUsers.filter((username) => users.some((user) => user.username === username))));
    return validUsers.length > 0 ? validUsers : [fallbackUsername];
  };
  const sameDeliveryUsers = (left: string[], right: string[]) => left.length === right.length && left.every((item, index) => item === right[index]);
  const selectedOptions = (event: ChangeEvent<HTMLSelectElement>) => Array.from(event.target.selectedOptions).map((option) => option.value);
  const openDockets = snapshot.deliveryDockets.filter((item) => item.status === "Ready" && !item.consignmentId);
  const selectedDockets = openDockets.filter((item) => consignmentDraft.docketIds.includes(item.id));
  const selectedDocketWeight = selectedDockets.reduce((sum, item) => sum + item.weightKg, 0);
  const receiptByOrderId = new Map(snapshot.receiptChecks.map((item) => [item.purchaseOrderId, item]));
  const supplierById = new Map(snapshot.counterparties.filter((item) => item.type === "Supplier").map((item) => [item.id, item]));
  const customerById = new Map(snapshot.counterparties.filter((item) => item.type === "Shop").map((item) => [item.id, item]));
  const warehouseById = new Map(snapshot.warehouses.map((item) => [item.id, item]));
  const docketBySalesOrderId = new Map(snapshot.deliveryDockets.map((item) => [item.salesOrderId, item]));
  const consignmentById = new Map(snapshot.deliveryConsignments.map((item) => [item.id, item]));

  useEffect(() => {
    if (screen === "in") setActiveTab("in");
    else if (screen === "out") setActiveTab("out");
    else setActiveTab("home");
  }, [screen]);
  useEffect(() => {
    writeStoredJson(persistKey, {
      activeTab,
      inboundStep,
      outboundStep,
      consignmentDraft
    });
  }, [persistKey, activeTab, inboundStep, outboundStep, consignmentDraft]);
  useEffect(() => {
    if (!canManageDeliveryTagging && inboundStep === "pickup") setInboundStep(canManageWarehouseChecks ? "dealer" : "planned");
    if (!canManageWarehouseChecks && (inboundStep === "dealer" || inboundStep === "receive")) setInboundStep(canManageDeliveryTagging ? "pickup" : "planned");
    if (!canManageDeliveryTagging && (outboundStep === "tag" || outboundStep === "bundle")) setOutboundStep("check");
    if (!canManageWarehouseChecks && outboundStep === "check") {
      setOutboundStep(
        snapshot.deliveryDockets.some((item) => item.status === "Ready" && !item.consignmentId)
          ? "bundle"
          : snapshot.deliveryConsignments.some((item) => item.status === "Ready")
            ? "bundle"
            : "planned"
      );
    }
    if (!canManageWarehouseChecks && outboundStep === "self") setOutboundStep("planned");
  }, [canManageDeliveryTagging, canManageWarehouseChecks, inboundStep, outboundStep, snapshot.deliveryConsignments, snapshot.deliveryDockets]);
  useEffect(() => {
    setInboundAssignedTo((current) => {
      const normalized = normalizeSelectedDeliveryUsers(current, inboundDeliveryUsers, defaultInboundDeliveryUsername);
      return sameDeliveryUsers(current, normalized) ? current : normalized;
    });
  }, [defaultInboundDeliveryUsername, inboundDeliveryUsers, inboundAssignedTo]);
  useEffect(() => {
    setOutboundAssignedTo((current) => {
      const normalized = normalizeSelectedDeliveryUsers(current, outboundDeliveryUsers, defaultOutboundDeliveryUsername);
      return sameDeliveryUsers(current, normalized) ? current : normalized;
    });
  }, [defaultOutboundDeliveryUsername, outboundDeliveryUsers, outboundAssignedTo]);
  useEffect(() => {
    setConsignmentDraft((current) => {
      const normalized = normalizeSelectedDeliveryUsers(current.assignedTo, outboundDeliveryUsers, defaultOutboundDeliveryUsername);
      return sameDeliveryUsers(current.assignedTo, normalized) ? current : { ...current, assignedTo: normalized };
    });
  }, [consignmentDraft.assignedTo, defaultOutboundDeliveryUsername, outboundDeliveryUsers]);

  const purchaseGroups: PurchaseGroup[] = Array.from(snapshot.purchaseOrders.reduce((groups, order) => {
    const key = orderPublicId(order);
    groups.set(key, [...(groups.get(key) || []), order]);
    return groups;
  }, new Map<string, PurchaseOrder[]>()).entries()).map(([id, lines]) => ({ id, lines }));
  const salesGroups: SalesGroup[] = Array.from(snapshot.salesOrders.reduce((groups, order) => {
    const key = orderPublicId(order);
    groups.set(key, [...(groups.get(key) || []), order]);
    return groups;
  }, new Map<string, SalesOrder[]>()).entries()).map(([id, lines]) => ({ id, lines }));

  function groupDate(group: PurchaseGroup) {
    return groupNewestCreatedAt(group.lines);
  }

  function purchaseGroupCompleted(group: PurchaseGroup) {
    return group.lines.length > 0 && group.lines.every((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) <= 0 || line.status === "Closed");
  }

  function salesGroupCompleted(group: SalesGroup) {
    return group.lines.length > 0 && group.lines.every((line) => !["Booked", "Ready for Dispatch", "Pending Pickup", "Out for Delivery", "Self Pickup"].includes(line.status));
  }

  const todayDate = indiaDateKey();
  const yesterdayDate = indiaYesterdayDateKey();
  const completedPurchaseGroups = purchaseGroups.filter((group) => purchaseGroupCompleted(group));
  const activeInboundRange = inboundDatePreset === "today"
    ? { fromDate: todayDate, toDate: todayDate }
    : inboundDatePreset === "yesterday"
      ? { fromDate: yesterdayDate, toDate: yesterdayDate }
      : normalizeDateRange(inboundFromDate, inboundToDate);
  const inboundGroupMatchesDate = (group: PurchaseGroup) => dateKeyInRange(indiaDateKey(new Date(groupDate(group))), activeInboundRange.fromDate, activeInboundRange.toDate);
  const inboundTaskMatchesDate = (groups: PurchaseGroup[]) => groups.some((group) => inboundGroupMatchesDate(group));
  const salesGroupMatchesDate = (group: SalesGroup) => dateKeyInRange(indiaDateKey(new Date(groupNewestCreatedAt(group.lines))), activeInboundRange.fromDate, activeInboundRange.toDate);

  function groupTotal(group: PurchaseGroup) {
    return group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  }

  function groupPendingQty(group: PurchaseGroup) {
    return group.lines.reduce((sum, line) => sum + Math.max(line.quantityOrdered - line.quantityReceived, 0), 0);
  }

  function groupWeight(group: PurchaseGroup, pendingOnly: boolean) {
    return group.lines.reduce((sum, line) => {
      const qty = pendingOnly ? Math.max(line.quantityOrdered - line.quantityReceived, 0) : line.quantityOrdered;
      return sum + line.expectedWeightKg * (qty / Math.max(line.quantityOrdered, 1));
    }, 0);
  }

  function purchaseLedger(group: PurchaseGroup) {
    return snapshot.ledgerEntries.find((item) => item.side === "Purchase" && item.linkedOrderId === group.id);
  }

  function groupNeedsPickupTask(group: PurchaseGroup) {
    return group.lines.some((line) => line.deliveryMode === "Self Collection");
  }

  function groupVendorDeliveryCashAtDelivery(group: PurchaseGroup) {
    return group.lines.some((line) => line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery");
  }

  function paidBeforeReceiving(group: PurchaseGroup) {
    const ledger = purchaseLedger(group);
    return Boolean(ledger && ledger.pendingAmount === 0 && ledger.paidAmount > 0 && groupPendingQty(group) > 0);
  }

  function hasPartialFlag(group: PurchaseGroup, received: boolean, billDifference: number) {
    if (billDifference > 0) return true;
    if (group.lines.some((line) => receiptByOrderId.get(line.id)?.flagged)) return true;
    if (!received && group.lines.some((line) => line.status === "Partially Received")) return true;
    return false;
  }

  const pendingReceiveGroups = purchaseGroups
    .filter((group) => group.lines.some((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0))
    .sort((left, right) =>
      Number(paidBeforeReceiving(right)) - Number(paidBeforeReceiving(left))
      || Number(Boolean(inboundTaskForGroup(left.id))) - Number(Boolean(inboundTaskForGroup(right.id)))
      || groupDate(left) - groupDate(right)
    );
  const receivedGroups = purchaseGroups
    .filter((group) => purchaseGroupCompleted(group))
    .filter((group) => inboundGroupMatchesDate(group))
    .sort((left, right) => groupDate(right) - groupDate(left));
  const inboundTaskDockets = snapshot.deliveryTasks
    .filter((task) => task.side === "Purchase")
    .map((task) => ({
      task,
      groups: purchaseGroups.filter((group) => task.linkedOrderIds.includes(group.id))
    }))
    .filter((item) => item.groups.length > 0);
  const plannedInboundDockets = inboundTaskDockets
    .filter((item) => item.task.status === "Planned" && item.groups.some((group) => group.lines.some((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0)))
    .sort((left, right) => new Date(left.task.createdAt).getTime() - new Date(right.task.createdAt).getTime());
  const completedInboundDockets = inboundTaskDockets
    .filter((item) => inboundTaskMatchesDate(item.groups) && item.groups.every((group) => group.lines.every((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) <= 0 || line.status === "Closed")))
    .sort((left, right) => new Date(right.task.createdAt).getTime() - new Date(left.task.createdAt).getTime());
  const receivingInboundDockets = inboundTaskDockets
    .filter((item) => item.task.status !== "Planned" && item.task.status !== "Delivered" && item.groups.some((group) => group.lines.some((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0)))
    .sort((left, right) => {
      const leftCompleted = left.groups.every((group) => group.lines.every((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) <= 0 || line.status === "Closed"));
      const rightCompleted = right.groups.every((group) => group.lines.every((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) <= 0 || line.status === "Closed"));
      const leftReceived = left.groups.some((group) => group.lines.some((line) => line.quantityReceived > 0));
      const rightReceived = right.groups.some((group) => group.lines.some((line) => line.quantityReceived > 0));
      return Number(leftCompleted) - Number(rightCompleted)
        || Number(rightReceived) - Number(leftReceived)
        || new Date(left.task.createdAt).getTime() - new Date(right.task.createdAt).getTime();
    });
  const directReceiveGroups = pendingReceiveGroups
    .filter((group) => !groupNeedsPickupTask(group))
    .sort((left, right) => {
      const leftReceived = left.lines.some((line) => line.quantityReceived > 0);
      const rightReceived = right.lines.some((line) => line.quantityReceived > 0);
      return Number(rightReceived) - Number(leftReceived) || groupDate(left) - groupDate(right);
    });
  const outgoingOrders = snapshot.salesOrders
    .filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Pending Pickup" || item.status === "Out for Delivery" || item.status === "Self Pickup")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const completedSalesGroups = salesGroups.filter((group) => salesGroupCompleted(group));
  const outgoingGroups = salesGroups
    .filter((group) => group.lines.some((line) => line.status === "Booked" || line.status === "Ready for Dispatch" || line.status === "Pending Pickup" || line.status === "Out for Delivery" || line.status === "Self Pickup"))
    .sort((left, right) => Math.min(...left.lines.map((line) => new Date(line.createdAt).getTime())) - Math.min(...right.lines.map((line) => new Date(line.createdAt).getTime())));
  const dispatchQueueOrders = canManageWarehouseChecks ? outgoingOrders : outgoingOrders.filter((item) => item.deliveryMode === "Delivery");
  const dispatchQueueGroups = canManageWarehouseChecks ? outgoingGroups : outgoingGroups.filter((group) => group.lines[0].deliveryMode === "Delivery");
  const outboundTaskDockets = snapshot.deliveryTasks
    .filter((task) => task.side === "Sales" && task.mode === "Delivery" && task.consignmentId)
    .map((task) => ({
      task,
      consignment: consignmentById.get(task.consignmentId || "")
    }))
    .filter((item): item is { task: DeliveryTask; consignment: DeliveryConsignment } => Boolean(item.consignment));
  const outboundTaskMatchesDate = (task: DeliveryTask) => task.routeStops.some((stop) => {
    const createdAt = snapshot.salesOrders.find((order) => orderPublicId(order) === stop.orderId)?.createdAt;
    return Boolean(createdAt) && dateKeyInRange(indiaDateKey(createdAt), activeInboundRange.fromDate, activeInboundRange.toDate);
  });
  const activeOutboundDockets = outboundTaskDockets
    .filter((item) => item.task.status !== "Planned" && item.task.status !== "Delivered")
    .sort((left, right) => new Date(left.task.createdAt).getTime() - new Date(right.task.createdAt).getTime());
  const plannedOutboundDockets = outboundTaskDockets
    .filter((item) => item.task.status === "Planned")
    .sort((left, right) => new Date(left.task.createdAt).getTime() - new Date(right.task.createdAt).getTime());
  const completedOutboundDockets = outboundTaskDockets
    .filter((item) => item.task.status === "Delivered" && outboundTaskMatchesDate(item.task))
    .sort((left, right) => new Date(right.task.createdAt).getTime() - new Date(left.task.createdAt).getTime());
  const bundleReadyConsignments = snapshot.deliveryConsignments
    .filter((item) => item.status === "Ready")
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const selfCollectionOutboundGroups = dispatchQueueGroups
    .filter((group) => group.lines[0].deliveryMode === "Self Collection")
    .sort((left, right) => Math.min(...left.lines.map((line) => new Date(line.createdAt).getTime())) - Math.min(...right.lines.map((line) => new Date(line.createdAt).getTime())));
  const directOutboundGroups = dispatchQueueGroups
    .filter((group) => group.lines[0].deliveryMode !== "Self Collection" && group.lines.every((line) => !docketBySalesOrderId.has(line.id)))
    .sort((left, right) => Math.min(...left.lines.map((line) => new Date(line.createdAt).getTime())) - Math.min(...right.lines.map((line) => new Date(line.createdAt).getTime())));
  const completedDirectOutboundGroups = completedSalesGroups
    .filter((group) => salesGroupMatchesDate(group))
    .sort((left, right) => Math.max(...right.lines.map((line) => new Date(line.createdAt).getTime())) - Math.max(...left.lines.map((line) => new Date(line.createdAt).getTime())));
  const inboundPickupPendingCount = sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))).length;
  const dealerReceiptPendingCount = directReceiveGroups.length;
  const inboundReceivePendingCount = receivingInboundDockets.length;
  const inboundPlannedPendingCount = plannedInboundDockets.length;
  const inboundCompletedCount = completedInboundDockets.length + receivedGroups.length;
  const inboundTotalPendingCount = inboundPickupPendingCount + dealerReceiptPendingCount + inboundReceivePendingCount + inboundPlannedPendingCount;
  const selfCollectionPendingCount = selfCollectionOutboundGroups.length;
  const outboundCheckPendingCount = activeOutboundDockets.length + directOutboundGroups.length;
  const outboundTagPendingCount = bundleReadyConsignments.length;
  const outboundBundlePendingCount = openDockets.length + bundleReadyConsignments.length;
  const outboundPlannedPendingCount = plannedOutboundDockets.length;
  const outboundCompletedCount = completedOutboundDockets.length + completedDirectOutboundGroups.length;
  const outboundTotalPendingCount = outboundCheckPendingCount + selfCollectionPendingCount + outboundTagPendingCount + outboundBundlePendingCount + outboundPlannedPendingCount;
  const outboundExportHeaders = outboundStep === "tag"
    ? consignmentExportHeaders()
    : outboundStep === "bundle"
      ? docketExportHeaders()
      : outboundOpsExportHeaders();
  const outboundExportRowsData = outboundStep === "tag"
    ? consignmentExportRows(snapshot, bundleReadyConsignments)
    : outboundStep === "bundle"
      ? docketExportRows(snapshot, openDockets)
      : outboundStep === "self"
        ? outboundOpsExportRows(snapshot, selfCollectionOutboundGroups, [])
      : outboundStep === "planned"
        ? outboundOpsExportRows(snapshot, [], plannedOutboundDockets.map((item) => ({ task: item.task })))
        : outboundStep === "completed"
          ? outboundOpsExportRows(snapshot, completedDirectOutboundGroups, completedOutboundDockets.map((item) => ({ task: item.task })))
          : outboundOpsExportRows(snapshot, directOutboundGroups, activeOutboundDockets.map((item) => ({ task: item.task })));
  const outboundExportTitle = outboundStep === "tag"
    ? "Outbound Tag Queue Report"
    : outboundStep === "bundle"
      ? "Outbound Bundle Queue Report"
      : outboundStep === "self"
        ? "Self Collection Handover Report"
      : outboundStep === "planned"
        ? "Planned Outbound Tasks Report"
        : outboundStep === "completed"
          ? "Completed Outbound Tasks Report"
        : "Warehouse Pending Dispatch Report";
  const outboundExportPrefix = outboundStep === "tag"
    ? "outbound-tag"
    : outboundStep === "bundle"
      ? "outbound-bundle"
      : outboundStep === "self"
        ? "outbound-self"
      : outboundStep === "planned"
        ? "outbound-planned"
        : outboundStep === "completed"
          ? "outbound-completed"
        : "warehouse-outbound";

  function inboundTaskForGroup(groupId: string) {
    return snapshot.deliveryTasks.find((task) => task.side === "Purchase" && task.linkedOrderIds.includes(groupId));
  }

  const inboundPickupGroups = sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group)));
  const inboundExportHeaders = inboundStep === "pickup" ? purchaseOrderExportHeaders() : inboundOpsExportHeaders();
  const inboundExportRowsData = inboundStep === "pickup"
    ? purchaseOrderExportRows(snapshot, inboundPickupGroups)
    : inboundStep === "dealer"
      ? inboundOpsExportRows(snapshot, directReceiveGroups, [])
    : inboundStep === "receive"
      ? inboundOpsExportRows(snapshot, [], receivingInboundDockets)
    : inboundStep === "planned"
      ? inboundOpsExportRows(snapshot, [], plannedInboundDockets)
      : inboundStep === "completed"
        ? inboundOpsExportRows(snapshot, receivedGroups, completedInboundDockets)
        : inboundOpsExportRows(snapshot, [], []);
  const inboundExportTitle = inboundStep === "pickup"
    ? "Inbound Pickup Queue Report"
    : inboundStep === "dealer"
      ? "Dealer Delivery Receipt Report"
    : inboundStep === "receive"
      ? "Inbound Pickup Receipt Report"
    : inboundStep === "planned"
      ? "Planned Inbound Tasks Report"
      : inboundStep === "completed"
        ? "Completed Inbound Tasks Report"
      : "Warehouse Inbound Receive Report";
  const inboundExportPrefix = inboundStep === "pickup"
    ? "inbound-pickup"
    : inboundStep === "dealer"
      ? "inbound-dealer"
    : inboundStep === "receive"
      ? "inbound-receive"
    : inboundStep === "planned"
      ? "inbound-planned"
      : inboundStep === "completed"
        ? "inbound-completed"
      : "warehouse-inbound";

  const completedDateControls = <>
    <div className="date-filter-strip">
      <button className={inboundDatePreset === "today" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setInboundDatePreset("today"); setInboundFromDate(todayDate); setInboundToDate(todayDate); }}>Today</button>
      <button className={inboundDatePreset === "yesterday" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setInboundDatePreset("yesterday"); setInboundFromDate(yesterdayDate); setInboundToDate(yesterdayDate); }}>Yesterday</button>
      <button className={inboundDatePreset === "custom" ? "date-filter-pill active" : "date-filter-pill"} type="button" onClick={() => { setInboundCustomFromDraft(activeInboundRange.fromDate); setInboundCustomToDraft(activeInboundRange.toDate); setInboundDateOpen(true); }}>Custom Date</button>
    </div>
    <article className="list-card date-range-card">
      <div className="payment-meta-grid">
        <div><span className="small-label">From</span><strong>{activeInboundRange.fromDate}</strong></div>
        <div><span className="small-label">To</span><strong>{activeInboundRange.toDate}</strong></div>
      </div>
    </article>
  </>;

  function optimizeInboundGroups(groups: PurchaseGroup[]) {
    return nearestNeighborOrder(groups, (group) => supplierById.get(group.lines[0]?.supplierId || ""));
  }

  function supplierAddress(group: PurchaseGroup) {
    const supplier = supplierById.get(group.lines[0]?.supplierId || "");
    return supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ") || group.lines[0]?.supplierName || "";
  }

  function sortGroupsForInboundTag(groups: PurchaseGroup[]) {
    return optimizeInboundGroups([...groups].sort((left, right) => supplierAddress(left).localeCompare(supplierAddress(right), "en-IN")));
  }

  function customerAddress(order: SalesOrder) {
    const customer = customerById.get(order.shopId);
    return customer?.locationLabel || [customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ") || order.shopName || "";
  }

  function customerAddressForGroup(group: SalesGroup) {
    return customerAddress(group.lines[0]);
  }

  function sortOrdersForOutboundTag(groups: SalesGroup[]) {
    return nearestNeighborOrder([...groups].sort((left, right) => customerAddressForGroup(left).localeCompare(customerAddressForGroup(right), "en-IN")), (group) => customerById.get(group.lines[0]?.shopId || ""));
  }

  function consignmentGroups(consignment: DeliveryConsignment) {
    const salesOrderIds = new Set(
      consignment.docketIds
        .map((docketId) => snapshot.deliveryDockets.find((item) => item.id === docketId)?.salesOrderId)
        .filter(Boolean) as string[]
    );
    return outgoingGroups.filter((group) => group.lines.some((line) => salesOrderIds.has(line.id)));
  }

  function groupRouteDistanceKm<T>(items: T[], locationFor: (item: T) => { latitude?: number; longitude?: number } | undefined) {
    return items.reduce((sum, item, index) => {
      if (index === 0) return sum;
      return sum + (distanceKmBetween(locationFor(items[index - 1]), locationFor(item)) || 0);
    }, 0);
  }

  function inboundSuggestionGroups() {
    const candidates = sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group)));
    const buckets: PurchaseGroup[][] = [];
    for (const group of candidates) {
      const location = supplierById.get(group.lines[0]?.supplierId || "");
      const lastBucket = buckets[buckets.length - 1];
      const lastGroup = lastBucket?.[lastBucket.length - 1];
      const lastLocation = lastGroup ? supplierById.get(lastGroup.lines[0]?.supplierId || "") : undefined;
      const distance = distanceKmBetween(lastLocation, location);
      if (!lastBucket || lastBucket.length >= 4 || (distance !== null && distance > 8)) {
        buckets.push([group]);
      } else {
        lastBucket.push(group);
      }
    }
    return buckets;
  }

  function outboundDocketSuggestionGroups() {
    const docketGroups = openDockets.map((docket) => {
      const salesOrder = snapshot.salesOrders.find((order) => order.id === docket.salesOrderId);
      const group = salesOrder ? outgoingGroups.find((item) => item.id === orderPublicId(salesOrder)) : undefined;
      return group ? { docket, group } : undefined;
    }).filter((item): item is { docket: DeliveryDocket; group: SalesGroup } => Boolean(item));
    const ordered = nearestNeighborOrder(docketGroups, (item) => customerById.get(item.group.lines[0]?.shopId || ""));
    const buckets: Array<Array<{ docket: DeliveryDocket; group: SalesGroup }>> = [];
    for (const item of ordered) {
      const location = customerById.get(item.group.lines[0]?.shopId || "");
      const lastBucket = buckets[buckets.length - 1];
      const lastItem = lastBucket?.[lastBucket.length - 1];
      const lastLocation = lastItem ? customerById.get(lastItem.group.lines[0]?.shopId || "") : undefined;
      const distance = distanceKmBetween(lastLocation, location);
      if (!lastBucket || lastBucket.length >= 6 || (distance !== null && distance > 8)) {
        buckets.push([item]);
      } else {
        lastBucket.push(item);
      }
    }
    return buckets;
  }

  function consignmentRouteLabel(consignment: DeliveryConsignment) {
    const groups = sortOrdersForOutboundTag(consignmentGroups(consignment));
    const distance = groupRouteDistanceKm(groups, (group) => customerById.get(group.lines[0]?.shopId || ""));
    return distance > 0 ? `${distance.toFixed(1)} km between stops` : "Route sorted by address";
  }

  async function uploadWeighingProof(draftKey: string, file: File | null, side: "incoming" | "outgoing") {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    if (side === "incoming") {
      setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" }), weighingProofName: fileName } }));
    } else {
      setOutgoingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { containerWeightKg: "0", weighingProofName: "", assignedTo: defaultOutboundDeliveryUsername }), weighingProofName: fileName } }));
    }
  }

  async function uploadIncomingCashProof(draftKey: string, file: File | null) {
    if (!file) return;
    const uploaded = await onUploadPaymentProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    const fileName = String((uploaded as { fileName: string }).fileName);
    setIncomingDrafts((current) => ({ ...current, [draftKey]: { ...(current[draftKey] || { receivedQuantity: "0", actualWeightKg: "0", containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" }), cashProofName: fileName } }));
  }

  function renderReceiveGroupLines(group: PurchaseGroup, received: boolean, vendorKey?: string, onCompleted?: () => void) {
    const pendingLines = group.lines.filter((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0);
    const checkedLineIds = selectedReceiveLines[group.id] || pendingLines.map((line) => line.id);
    const isSubmitting = vendorKey ? Boolean(receivingVendorKeys[vendorKey]) : false;
    return <>
      {group.lines.map((line) => {
        const pendingQty = Math.max(line.quantityOrdered - line.quantityReceived, 0);
        const draft = incomingDrafts[line.id] || { receivedQuantity: String(pendingQty), actualWeightKg: String(line.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
        const receipt = receiptByOrderId.get(line.id);
        const netWeight = receipt ? receipt.netWeightKg : Math.max(Number(draft.actualWeightKg || 0) - Number(draft.containerWeightKg || 0), 0);
        const lineNeedsCashProof = line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery";
        return <article className="list-card" key={line.id}>
          <div className="warehouse-line-head">
            {canManageWarehouseChecks && !received && pendingQty > 0 ? <label className="big-checkbox"><input type="checkbox" checked={checkedLineIds.includes(line.id)} onChange={(e) => setSelectedReceiveLines((current) => {
              const base = current[group.id] || pendingLines.map((item) => item.id);
              return { ...current, [group.id]: e.target.checked ? [...new Set([...base, line.id])] : base.filter((item) => item !== line.id) };
            })} /><span /></label> : null}
            <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>
          </div>
          <div className="payment-meta-grid">
            <div><span className="small-label">Ordered</span><strong>{line.quantityOrdered}</strong></div>
            <div><span className="small-label">Pending</span><strong>{pendingQty}</strong></div>
            <div><span className="small-label">Expected</span><strong>{line.expectedWeightKg.toFixed(2)} kg</strong></div>
            <div><span className="small-label">Net</span><strong>{netWeight.toFixed(2)} kg</strong></div>
            <div><span className="small-label">Flag</span><strong>{receipt?.flagged ? "Yes" : "No"}</strong></div>
          </div>
          {canManageWarehouseChecks && !received && pendingQty > 0 ? <div className="form-grid top-gap">
            <label>Receive qty<input type="number" step="any" value={draft.receivedQuantity} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, receivedQuantity: e.target.value } }))} /></label>
            <label>Cumulative gross weight<input type="number" step="any" value={draft.actualWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, actualWeightKg: e.target.value } }))} /></label>
            <label>Container weight<input type="number" step="any" value={draft.containerWeightKg} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
            <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(line.id, e.target.files?.[0] || null, "incoming")} /></label>
            <label className="wide-field">Proof name<input value={draft.weighingProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
            {lineNeedsCashProof ? <>
              <label>Cash photo<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadIncomingCashProof(line.id, e.target.files?.[0] || null)} /></label>
              <label className="wide-field">Cash proof name<input value={draft.cashProofName} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, cashProofName: e.target.value } }))} /></label>
            </> : null}
            <label className="wide-field">Note<input value={draft.note} onChange={(e) => setIncomingDrafts((current) => ({ ...current, [line.id]: { ...draft, note: e.target.value } }))} /></label>
          </div> : null}
        </article>;
      })}
      {canManageWarehouseChecks && !received && pendingLines.length > 0 ? <div className="payment-card-actions">
        <span className="small-label">{checkedLineIds.length} checked product(s)</span>
        <button className="primary-button" type="button" disabled={isSubmitting || checkedLineIds.length === 0} onClick={async () => {
          if (vendorKey) {
            setReceivingVendorKeys((current) => ({ ...current, [vendorKey]: true }));
          }
          try {
          let vendorCashProofName = "";
          for (const line of pendingLines.filter((line) => checkedLineIds.includes(line.id))) {
            const pendingQty = Math.max(line.quantityOrdered - line.quantityReceived, 0);
            const draft = incomingDrafts[line.id] || { receivedQuantity: String(pendingQty), actualWeightKg: String(line.expectedWeightKg), containerWeightKg: "0", weighingProofName: "", cashProofName: "", note: "" };
            const receivedQuantity = Number(draft.receivedQuantity || 0);
            const needsCashProof = line.deliveryMode === "Dealer Delivery" && line.paymentMode === "Cash" && line.cashTiming === "At Delivery";
            if (needsCashProof && !draft.cashProofName) {
              window.alert("Upload cash proof for vendor-delivery cash orders.");
              return;
            }
            if (needsCashProof && draft.cashProofName) {
              vendorCashProofName = draft.cashProofName;
            }
            await onReceive({
              purchaseOrderId: line.id,
              warehouseId: line.warehouseId,
              receivedQuantity,
              actualWeightKg: Number(draft.actualWeightKg || 0),
              containerWeightKg: Number(draft.containerWeightKg || 0),
              weighingProofName: draft.weighingProofName || undefined,
              cashProofName: draft.cashProofName || undefined,
              note: draft.note || `Received by ${currentUser.fullName}`,
              confirmPartial: receivedQuantity < pendingQty
            });
          }
          if (vendorKey) {
            setExpandedReceiveVendor((current) => ({ ...current, [vendorKey]: false }));
          }
          onCompleted?.();
          } finally {
            if (vendorKey) {
              setReceivingVendorKeys((current) => ({ ...current, [vendorKey]: false }));
            }
          }
        }}>{isSubmitting ? "Receiving..." : "Receive checked products"}</button>
      </div> : null}
    </>;
  }

  function renderReceiveGroup(group: PurchaseGroup, received: boolean) {
    const first = group.lines[0];
    const expanded = expandedReceive[group.id] ?? false;
    const summaryExpanded = expandedReceiveSummary[group.id] ?? false;
    const summaryDraft = receiveSummaryDrafts[group.id] || { proofName: "" };
    const ledger = purchaseLedger(group);
    const inboundTask = inboundTaskForGroup(group.id);
    const needsPickupTask = groupNeedsPickupTask(group);
    const vendorDeliveryCashAtDelivery = groupVendorDeliveryCashAtDelivery(group);
    const receivedValue = group.lines.reduce((sum, line) => {
      if (line.quantityOrdered <= 0) return sum;
      return sum + (line.totalAmount * (Math.min(line.quantityReceived, line.quantityOrdered) / line.quantityOrdered));
    }, 0);
    const hasAnyReceiptProgress = group.lines.some((line) => line.quantityReceived > 0 || Boolean(receiptByOrderId.get(line.id)));
    const billDifference = hasAnyReceiptProgress ? Math.max(groupTotal(group) - receivedValue, 0) : 0;
    const pendingLines = group.lines.filter((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) > 0);
    const checkedLineIds = selectedReceiveLines[group.id] || pendingLines.map((line) => line.id);
    return <article className="list-card payment-update-card warehouse-order-card" key={group.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedReceive((current) => ({ ...current, [group.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{group.id}</strong>
          <span>{first.supplierName}</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{group.lines.length} products</span>
          <span>{groupPendingQty(group)} pending</span>
          <span>{groupWeight(group, !received).toFixed(2)} kg</span>
          <span>{formatDateTimeIst(first.createdAt)}</span>
        </div>
        <span className={`status-pill ${statusPillClass(received ? "Received" : needsPickupTask && inboundTask ? deliveryTaskStatusLabel(inboundTask) : first.status)}`}>{received ? "Received" : needsPickupTask && inboundTask ? deliveryTaskStatusLabel(inboundTask) : first.status}</span>
      </button>
      {needsPickupTask && inboundTask ? <p className="message success">Inbound task: {inboundTask.id} · {inboundTask.assignedTo} · {inboundTask.routeStops.length || 1} pickup stop(s)</p> : null}
      {!needsPickupTask ? <p className="message success">Vendor delivery. Warehouse only needs to receive and check the goods.</p> : null}
      {vendorDeliveryCashAtDelivery && !received ? <p className="message success">Cash payment will close automatically after receive when cash proof is uploaded.</p> : null}
      {paidBeforeReceiving(group) ? <p className="message success">Payment already settled. Kept on top until receiving is completed.</p> : null}
      {hasPartialFlag(group, received, billDifference) ? <p className="message error">Partial receipt / weight flag raised. Bill difference: {billDifference.toFixed(2)}</p> : null}
      {expanded ? <div className="stack-list top-gap">
        {renderReceiveGroupLines(group, received)}
        <div className="payment-card-actions">
          <button className="ghost-button" type="button" onClick={() => setExpandedReceiveSummary((current) => ({ ...current, [group.id]: !summaryExpanded }))}>{summaryExpanded ? "Hide summary" : "Show summary"}</button>
        </div>
        {summaryExpanded ? <article className="list-card warehouse-summary-card">
          <strong>Packing Summary</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Total qty</span><strong>{group.lines.reduce((sum, line) => sum + line.quantityOrdered, 0)}</strong></div>
            <div><span className="small-label">Pending qty</span><strong>{groupPendingQty(group)}</strong></div>
            <div><span className="small-label">Total weight</span><strong>{groupWeight(group, false).toFixed(2)} kg</strong></div>
            <div><span className="small-label">Pending weight</span><strong>{groupWeight(group, true).toFixed(2)} kg</strong></div>
            <div><span className="small-label">Total amount</span><strong>{groupTotal(group).toFixed(2)}</strong></div>
            <div><span className="small-label">Bill difference</span><strong>{billDifference.toFixed(2)}</strong></div>
          </div>
          <div className="form-grid top-gap">
            <label>Total stock weight photo<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setReceiveSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
            <label>Proof name<input value={summaryDraft.proofName} onChange={(e) => setReceiveSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: e.target.value } }))} /></label>
          </div>
        </article> : null}
      </div> : null}
    </article>;
  }

  function renderReceiveTaskDocket(task: DeliveryTask, received: boolean) {
    const groups = purchaseGroups.filter((group) => task.linkedOrderIds.includes(group.id));
    if (groups.length === 0) return null;
    const expanded = expandedReceive[task.id] ?? false;
    const summaryExpanded = expandedReceiveDocketSummary[task.id] ?? false;
    const totalPendingQty = groups.reduce((sum, group) => sum + groupPendingQty(group), 0);
    const totalPendingWeight = groups.reduce((sum, group) => sum + groupWeight(group, true), 0);
    const totalQty = groups.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.quantityOrdered, 0), 0);
    const totalWeight = groups.reduce((sum, group) => sum + groupWeight(group, false), 0);
    const totalAmount = groups.reduce((sum, group) => sum + groupTotal(group), 0);
    const anyReceived = groups.some((group) => group.lines.some((line) => line.quantityReceived > 0 || line.status === "Partially Received"));
    const allReceived = groups.every((group) => group.lines.every((line) => line.status === "Received" || line.status === "Closed"));
    const docketStatus = allReceived ? "Received" : anyReceived ? "Partially Received" : task.status;
    const vendorGroups = groups.sort((left, right) => {
      const leftReceived = left.lines.some((line) => line.quantityReceived > 0);
      const rightReceived = right.lines.some((line) => line.quantityReceived > 0);
      return Number(rightReceived) - Number(leftReceived) || groupDate(left) - groupDate(right);
    });
    return <article className="list-card payment-update-card warehouse-order-card" key={task.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedReceive((current) => ({ ...current, [task.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{task.id}</strong>
          <span>{groups.length} vendor(s)</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{groups.length} stops</span>
          <span>{totalPendingQty} pending</span>
          <span>{totalPendingWeight.toFixed(2)} kg</span>
          <span>{task.transportType}</span>
          {task.vehicleNumber ? <span>{task.vehicleNumber}</span> : null}
          <span>{formatDateTimeIst(task.createdAt)}</span>
        </div>
        <span className={`status-pill ${statusPillClass(docketStatus)}`}>{docketStatus}</span>
      </button>
      {task.transportType === "External" && task.freightAmount ? <p className="message success">External vehicle {task.vehicleNumber || "Pending"} · Freight {task.freightAmount.toFixed(2)}</p> : null}
      {expanded ? <div className="stack-list top-gap">
        {vendorGroups.map((group) => {
          const first = group.lines[0];
          const vendorKey = `${task.id}:${group.id}`;
          const vendorExpanded = expandedReceiveVendor[vendorKey] ?? false;
          const vendorReceived = group.lines.every((line) => line.status === "Received" || line.status === "Closed");
          const vendorPartial = !vendorReceived && group.lines.some((line) => line.quantityReceived > 0 || line.status === "Partially Received");
          return <article className="list-card" key={vendorKey}>
            <button className="warehouse-order-row" type="button" onClick={() => setExpandedReceiveVendor((current) => ({ ...current, [vendorKey]: !vendorExpanded }))}>
              <div className="warehouse-order-main">
                <strong>{first.supplierName}</strong>
                <span>{supplierAddress(group)}</span>
              </div>
              <div className="warehouse-order-meta">
                <span>{group.lines.length} products</span>
                <span>{groupPendingQty(group)} pending</span>
                <span>{groupWeight(group, true).toFixed(2)} kg</span>
              </div>
              <span className={`status-pill ${statusPillClass(vendorReceived ? "Received" : vendorPartial ? "Partially Received" : "Pending")}`}>{vendorReceived ? "Received" : vendorPartial ? "Partially Received" : "Pending"}</span>
            </button>
            {vendorExpanded ? <div className="stack-list top-gap">
              {paidBeforeReceiving(group) ? <p className="message success">Payment already settled. Kept on top until receiving is completed.</p> : null}
              {renderReceiveGroupLines(group, received, vendorKey, () => {
                const isNowComplete = group.lines.every((line) => Math.max(line.quantityOrdered - line.quantityReceived, 0) <= 0);
                if (isNowComplete) {
                  setExpandedReceiveVendor((current) => ({ ...current, [vendorKey]: false }));
                }
              })}
            </div> : null}
          </article>;
        })}
        {allReceived ? <article className="list-card warehouse-summary-card">
          <strong>Docket Summary</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Total qty</span><strong>{totalQty}</strong></div>
            <div><span className="small-label">Total weight</span><strong>{totalWeight.toFixed(2)} kg</strong></div>
            <div><span className="small-label">Total amount</span><strong>{totalAmount.toFixed(2)}</strong></div>
            <div><span className="small-label">Vendors</span><strong>{groups.length}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="ghost-button" type="button" onClick={() => setExpandedReceiveDocketSummary((current) => ({ ...current, [task.id]: !summaryExpanded }))}>{summaryExpanded ? "Hide final check" : "Open final check"}</button>
          </div>
          {summaryExpanded ? <div className="payment-card-actions top-gap">
            <button className="primary-button" type="button" disabled={Boolean(finalizingReceiveDockets[task.id])} onClick={async () => {
              setFinalizingReceiveDockets((current) => ({ ...current, [task.id]: true }));
              try {
                await onUpdateTask(task.id, {
                  linkedOrderIds: task.linkedOrderIds,
                  assignedTo: task.assignedTo,
                  routeStops: task.routeStops,
                  pickupAt: task.pickupAt,
                  dropAt: task.dropAt,
                  routeHint: task.routeHint,
                  paymentAction: task.paymentAction,
                  status: "Delivered",
                  cashCollectionRequired: task.cashCollectionRequired,
                  cashHandoverMarked: task.cashHandoverMarked,
                  weightProofName: task.weightProofName || undefined,
                  cashProofName: task.cashProofName || undefined,
                  lastActionAt: new Date().toISOString()
                });
                setExpandedReceive((current) => ({ ...current, [task.id]: false }));
              } finally {
                setFinalizingReceiveDockets((current) => ({ ...current, [task.id]: false }));
              }
            }}>{finalizingReceiveDockets[task.id] ? "Finalizing..." : "Final check and receive"}</button>
          </div> : null}
        </article> : null}
      </div> : null}
    </article>;
  }

  function receivedQuantityLabel(value: string, pendingQty: number) {
    const qty = Number(value || 0);
    return qty < pendingQty ? `Partial receive: ${pendingQty - qty} pending` : "Complete receive";
  }

  function renderOutgoingGroup(group: SalesGroup, mode: "check-out" | "tag-out") {
    const first = group.lines[0];
    const expanded = expandedSend[group.id] ?? false;
    const summaryExpanded = expandedSendSummary[group.id] ?? false;
    const summaryDraft = sendSummaryDrafts[group.id] || { proofName: "" };
    const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id);
    const draft = outgoingDrafts[group.id] || { containerWeightKg: "0", weighingProofName: "", assignedTo: defaultOutboundDeliveryUsername };
    const totalWeight = group.lines.reduce((sum, line) => sum + (snapshot.deliveryDockets.find((item) => item.salesOrderId === line.id)?.weightKg || 0), 0);
    const isProcessing = Boolean(processingSendKeys[group.id]);
    const isSelfCollection = first.deliveryMode === "Self Collection";
    const warehouseNames = Array.from(new Set(group.lines.map((line) => warehouseById.get(line.warehouseId)?.name || line.warehouseId))).join(", ");
    const totalQty = group.lines.reduce((sum, line) => sum + line.quantity, 0);
    const goodsTotal = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
    const orderTotal = group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0);
    return <article className="list-card payment-update-card warehouse-order-card" key={group.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedSend((current) => ({ ...current, [group.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{group.id}</strong>
          <span>{first.shopName}</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{group.lines.length} products</span>
          <span>{totalQty} qty</span>
          <span>{goodsTotal.toFixed(2)}</span>
          <span>{formatDateTimeIst(first.createdAt)}</span>
        </div>
        <span className={`status-pill ${statusPillClass(group.lines.some((line) => line.status === "Out for Delivery") ? salesStatusLabel("Out for Delivery") : salesStatusLabel(first.status))}`}>{group.lines.some((line) => line.status === "Out for Delivery") ? salesStatusLabel("Out for Delivery") : salesStatusLabel(first.status)}</span>
      </button>
      {expanded ? <div className="form-grid top-gap">
        <article className="list-card warehouse-summary-card wide-field">
          <strong>SO Dispatch Sheet</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Customer</span><strong>{first.shopName}</strong></div>
            <div><span className="small-label">Warehouse</span><strong>{warehouseNames}</strong></div>
            <div><span className="small-label">Delivery mode</span><strong>{first.deliveryMode}</strong></div>
            <div><span className="small-label">Payment</span><strong>{first.paymentMode}{first.cashTiming ? ` / ${first.cashTiming}` : ""}</strong></div>
            <div><span className="small-label">Total qty</span><strong>{totalQty}</strong></div>
            <div><span className="small-label">Grand total</span><strong>{orderTotal.toFixed(2)}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="ghost-button" type="button" onClick={() => void printSalesInvoice(snapshot, group)}>Print SO</button>
            <button className="ghost-button" type="button" onClick={() => downloadSalesInvoicePdf(snapshot, group)}>Download PDF</button>
            <a className="ghost-button" href={`https://wa.me/?text=${salesInvoiceWhatsappText(snapshot, group)}`} target="_blank" rel="noreferrer">WhatsApp Share</a>
          </div>
          <div className="stack-list top-gap">
            {group.lines.map((line) => <article className="list-card" key={line.id}>
              <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>
              <p>{line.quantity} qty | Rate {line.rate.toFixed(2)} | Total {(line.totalAmount + line.deliveryCharge).toFixed(2)}</p>
            </article>)}
          </div>
        </article>
        <label>Container weight<input type="number" step="any" value={draft.containerWeightKg} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [group.id]: { ...draft, containerWeightKg: e.target.value } }))} /></label>
        <label>Weighing photo<input type="file" accept="image/*" onChange={(e) => void uploadWeighingProof(group.id, e.target.files?.[0] || null, "outgoing")} /></label>
        <label>Proof name<input value={draft.weighingProofName} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [group.id]: { ...draft, weighingProofName: e.target.value } }))} /></label>
        {canManageDeliveryTagging && !isSelfCollection ? <label>Out delivery<select value={draft.assignedTo} onChange={(e) => setOutgoingDrafts((current) => ({ ...current, [group.id]: { ...draft, assignedTo: e.target.value } }))}>{outboundDeliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label> : null}
        <div className="payment-card-actions wide-field">
          {mode === "check-out" ? <>
            <button className="ghost-button" type="button" disabled={isProcessing} onClick={async () => {
              setProcessingSendKeys((current) => ({ ...current, [group.id]: true }));
              try {
                await Promise.all(group.lines.map((line) => onUpdateSalesOrder(line.id, { rate: line.rate, paymentMode: line.paymentMode, cashTiming: line.cashTiming, deliveryMode: line.deliveryMode, note: line.note || (isSelfCollection ? "Ready for customer pickup" : "Packed by warehouse"), status: isSelfCollection ? "Self Pickup" : "Ready for Dispatch", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })));
                if (!isSelfCollection) {
                  await onCreateDockets({ linkedOrderIds: [group.id] });
                  setOutboundStep("bundle");
                }
                setExpandedSend((current) => ({ ...current, [group.id]: false }));
              } finally {
                setProcessingSendKeys((current) => ({ ...current, [group.id]: false }));
              }
            }}>{isProcessing ? "Updating..." : (isSelfCollection ? "Ready for pickup" : "Create SO docket")}</button>
            {isSelfCollection ? <button className="primary-button" type="button" disabled={isProcessing} onClick={async () => {
              setProcessingSendKeys((current) => ({ ...current, [group.id]: true }));
              try {
                await Promise.all(group.lines.map((line) => onUpdateSalesOrder(line.id, { rate: line.rate, paymentMode: line.paymentMode, cashTiming: line.cashTiming, deliveryMode: line.deliveryMode, note: `${line.note || ""} ${isSelfCollection ? "Collected by customer." : "Handed over by warehouse."}`.trim(), status: "Delivered", containerWeightKg: Number(draft.containerWeightKg || 0), weighingProofName: draft.weighingProofName || undefined })));
                setExpandedSend((current) => ({ ...current, [group.id]: false }));
              } finally {
                setProcessingSendKeys((current) => ({ ...current, [group.id]: false }));
              }
            }}>{isProcessing ? "Updating..." : "Customer collected"}</button> : <p className="message success wide-field">SO dockets must be bundled into consignments before outbound delivery tagging.</p>}
          </> : !isSelfCollection ? <p className="message success wide-field">This order is already inside a bundled outbound flow.</p> : <p className="message success wide-field">Self collection order. Customer will collect directly from warehouse, so no delivery tagging is needed.</p>}
        </div>
        {paymentPending > 0 && first.paymentMode !== "Cash" ? <p className="message success wide-field">Customer payment is still pending, but outbound processing is allowed for now.</p> : null}
        <div className="payment-card-actions wide-field">
          <button className="ghost-button" type="button" onClick={() => setExpandedSendSummary((current) => ({ ...current, [group.id]: !summaryExpanded }))}>{summaryExpanded ? "Hide summary" : "Show summary"}</button>
        </div>
        {summaryExpanded ? <article className="list-card warehouse-summary-card wide-field">
          <strong>Packing Summary</strong>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Total qty</span><strong>{totalQty}</strong></div>
            <div><span className="small-label">Total weight</span><strong>{totalWeight.toFixed(2)} kg</strong></div>
            <div><span className="small-label">Goods amount</span><strong>{goodsTotal.toFixed(2)}</strong></div>
            <div><span className="small-label">Pending amount</span><strong>{paymentPending.toFixed(2)}</strong></div>
          </div>
          <div className="form-grid top-gap">
            <label>Total stock weight photo<input type="file" accept="image/*" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const uploaded = await onUploadProof(file); if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) setSendSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: String((uploaded as { fileName: string }).fileName) } })); }} /></label>
            <label>Proof name<input value={summaryDraft.proofName} onChange={(e) => setSendSummaryDrafts((current) => ({ ...current, [group.id]: { proofName: e.target.value } }))} /></label>
          </div>
          <div className="stack-list top-gap">
            {group.lines.map((line) => <article className="list-card" key={line.id}>
              <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>
              <p>{line.quantity} qty · {line.totalAmount.toFixed(2)} · {line.paymentMode}</p>
            </article>)}
          </div>
        </article> : null}
      </div> : null}
    </article>;
  }

  function renderSendTaskDocket(task: DeliveryTask, mode: "check-out" | "tag-out") {
    const consignment = task.consignmentId ? consignmentById.get(task.consignmentId) : undefined;
    const groups = outgoingGroups.filter((group) => task.linkedOrderIds.includes(group.id));
    if (groups.length === 0) return null;
    const expanded = expandedSend[task.id] ?? false;
    const totalQty = groups.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
    const totalAmount = groups.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.totalAmount, 0), 0);
    return <article className="list-card payment-update-card warehouse-order-card" key={task.id}>
      <button className="warehouse-order-row" type="button" onClick={() => setExpandedSend((current) => ({ ...current, [task.id]: !expanded }))}>
        <div className="warehouse-order-main">
          <strong>{consignment ? `${consignment.id} / ${task.id}` : task.id}</strong>
          <span>{groups.length} stop(s)</span>
        </div>
        <div className="warehouse-order-meta">
          <span>{totalQty} qty</span>
          <span>{totalAmount.toFixed(2)}</span>
          {consignment ? <span>{consignment.totalWeightKg.toFixed(2)} kg</span> : null}
          <span>{task.transportType}</span>
          {task.vehicleNumber ? <span>{task.vehicleNumber}</span> : null}
          <span>{formatDateTimeIst(task.createdAt)}</span>
        </div>
        <span className={`status-pill ${statusPillClass(deliveryTaskStatusLabel(task))}`}>{deliveryTaskStatusLabel(task)}</span>
      </button>
      {task.transportType === "External" && task.freightAmount ? <p className="message success">External vehicle {task.vehicleNumber || "Pending"} · Freight {task.freightAmount.toFixed(2)}</p> : null}
      {expanded ? <div className="stack-list top-gap">
        {groups.map((group) => {
          const stopKey = `${task.id}:${group.id}`;
          const stopExpanded = expandedSendStop[stopKey] ?? false;
          const first = group.lines[0];
          const paymentPending = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id);
          return <article className="list-card" key={stopKey}>
            <button className="warehouse-order-row" type="button" onClick={() => setExpandedSendStop((current) => ({ ...current, [stopKey]: !stopExpanded }))}>
              <div className="warehouse-order-main">
                <strong>{first.shopName}</strong>
                <span>{customerAddress(first)}</span>
              </div>
              <div className="warehouse-order-meta">
                <span>{group.lines.length} products</span>
                <span>{group.lines.reduce((sum, line) => sum + line.quantity, 0)} qty</span>
                <span>{paymentPending.toFixed(2)} pending</span>
              </div>
              <span className={`status-pill ${statusPillClass(salesStatusLabel(first.status))}`}>{salesStatusLabel(first.status)}</span>
            </button>
            {stopExpanded ? renderOutgoingGroup(group, mode) : null}
          </article>;
        })}
      </div> : null}
    </article>;
  }

  function selectedDocketWarehouseIds() {
    return Array.from(new Set(selectedDockets.map((docket) => docket.warehouseId).filter(Boolean)));
  }

  function selectOutboundDockets(dockets: DeliveryDocket[]) {
    const warehouseId = dockets[0]?.warehouseId || "";
    setConsignmentDraft((current) => ({
      ...current,
      warehouseId,
      docketIds: dockets.filter((docket) => docket.warehouseId === warehouseId).map((docket) => docket.id)
    }));
  }

  function renderOutboundBundlePanel() {
    const selectedWarehouseIds = selectedDocketWarehouseIds();
    const effectiveWarehouseId = consignmentDraft.warehouseId || selectedWarehouseIds[0] || "";
    const hasMixedWarehouses = selectedWarehouseIds.length > 1;
    const suggestedGroupsByWarehouse = outboundDocketSuggestionGroups().reduce((groups, bucket) => {
      const warehouseId = bucket[0]?.docket.warehouseId || "";
      if (!warehouseId) return groups;
      groups.set(warehouseId, [...(groups.get(warehouseId) || []), bucket]);
      return groups;
    }, new Map<string, Array<Array<{ docket: DeliveryDocket; group: SalesGroup }>>>());
    const openDocketsByWarehouse = snapshot.warehouses.map((warehouse) => ({
      warehouse,
      dockets: openDockets.filter((docket) => docket.warehouseId === warehouse.id)
    })).filter((item) => item.dockets.length > 0);

    return <Panel title="Dockets and Consignment" eyebrow="Bundle dockets before delivery tagging">
      <div className="stack-list warehouse-order-list">
        {openDocketsByWarehouse.length === 0 ? <div className="empty-card">No ready dockets from any warehouse.</div> : openDocketsByWarehouse.map(({ warehouse, dockets }) => {
          const suggestionBuckets = suggestedGroupsByWarehouse.get(warehouse.id) || [];
          return <article className="list-card payment-update-card" key={warehouse.id}>
            <div className="payment-update-head">
              <div><strong>{warehouse.name}</strong><p>{warehouse.city} - {dockets.length} ready docket(s)</p></div>
              <span className="status-pill status-pending">{warehouse.id}</span>
            </div>
            {suggestionBuckets.length > 0 ? <div className="stack-list top-gap">
              {suggestionBuckets.map((bucket, index) => {
                const groups = bucket.map((item) => item.group);
                const mapUrl = mapsDirectionsUrl(groups.map((group) => customerAddressForGroup(group)));
                return <button type="button" className="list-card warehouse-step-card" key={`${warehouse.id}-out-suggestion-${index}`} onClick={() => selectOutboundDockets(bucket.map((item) => item.docket))}>
                  <strong>{`Suggested area group ${index + 1}`}</strong>
                  <p>{bucket.length} docket(s) - {groupRouteDistanceKm(groups, (group) => customerById.get(group.lines[0]?.shopId || "")).toFixed(1)} km between stops - {groups.map((group) => group.lines[0]?.shopName || group.id).join(", ")}</p>
                  {mapUrl ? <span className="small-label">Route available in maps after selection</span> : null}
                </button>;
              })}
            </div> : null}
            <label className="wide-field top-gap">Dockets from {warehouse.name}
              <select multiple value={consignmentDraft.docketIds.filter((id) => dockets.some((docket) => docket.id === id))} disabled={submittingConsignment} onChange={(event) => selectOutboundDockets(Array.from(event.target.selectedOptions).map((option) => dockets.find((docket) => docket.id === option.value)).filter((docket): docket is DeliveryDocket => Boolean(docket)))}>
                {dockets.map((docket) => <option key={docket.id} value={docket.id}>{`${docket.id} - ${docket.shopName} - ${docket.weightKg.toFixed(2)} kg`}</option>)}
              </select>
            </label>
          </article>;
        })}
      </div>
      <form className="form-grid top-gap" onSubmit={async (event) => {
        event.preventDefault();
        if (submittingConsignment || hasMixedWarehouses || selectedDockets.length === 0) return;
        setSubmittingConsignment(true);
        try {
          await onCreateConsignment({ docketIds: consignmentDraft.docketIds, warehouseId: effectiveWarehouseId, assignedTo: defaultOutboundDeliveryUsername, status: "Ready" });
          setConsignmentDraft({ docketIds: [], warehouseId: "", assignedTo: [defaultOutboundDeliveryUsername] });
          setOutboundStep("planned");
        } finally {
          setSubmittingConsignment(false);
        }
      }}>
        <div><span className="small-label">Warehouse</span><strong>{warehouseById.get(effectiveWarehouseId)?.name || "Select dockets from one warehouse"}</strong></div>
        <div><span className="small-label">Assignment</span><strong>{defaultOutboundDeliveryUsername} will get the assignment immediately</strong></div>
        <div className="payment-card-actions wide-field">
          <span className="small-label">{selectedDockets.length} docket(s) - {selectedDocketWeight.toFixed(2)} kg total consignment weight</span>
          {hasMixedWarehouses ? <span className="small-label">Select dockets from only one warehouse.</span> : null}
          <button className="primary-button" type="submit" disabled={submittingConsignment || hasMixedWarehouses || selectedDockets.length === 0}>{submittingConsignment ? "Creating..." : "Create consignment"}</button>
        </div>
      </form>
      <div className="stack-list payment-update-list top-gap">{bundleReadyConsignments.length === 0 ? <div className="empty-card">No bundled consignments yet.</div> : bundleReadyConsignments.map((item) => <article className="list-card payment-update-card" key={item.id}><div className="payment-update-head"><div><strong>{item.id}</strong><p>{item.docketIds.join(", ")}</p></div><span className="status-pill status-pending">{deliveryConsignmentStatusLabel(item.status)}</span></div><div className="payment-meta-grid"><div><span className="small-label">Weight</span><strong>{item.totalWeightKg.toFixed(2)} kg</strong></div><div><span className="small-label">Dockets</span><strong>{item.docketIds.length}</strong></div><div><span className="small-label">Warehouse</span><strong>{warehouseById.get(item.warehouseId)?.name || item.warehouseId}</strong></div></div></article>)}</div>
      <div className="payment-card-actions top-gap">{canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("check")}>Back to check</button> : null}<button className="ghost-button" type="button" onClick={() => setOutboundStep("tag")}>Go to tag</button></div>
    </Panel>;
  }

  return (
    <section className="dashboard-grid warehouse-ops">
      {screen === "full" ? <Panel title={canManageWarehouseChecks ? "Warehouse" : "Delivery Manager"} eyebrow="Home / In / Out">
        <div className="segmented-tabs">
          <button className={activeTab === "home" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("home")}><LabelWithBadge label="Home" count={inboundTotalPendingCount + outboundTotalPendingCount} /></button>
          <button className={activeTab === "in" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("in")}><LabelWithBadge label="In" count={inboundTotalPendingCount} /></button>
          <button className={activeTab === "out" ? "tab-button active" : "tab-button"} type="button" onClick={() => setActiveTab("out")}><LabelWithBadge label="Out" count={outboundTotalPendingCount} /></button>
        </div>
        <div className="simple-summary payment-summary-grid top-gap">
          <div className="list-card"><div><strong>{canManageWarehouseChecks ? dealerReceiptPendingCount : inboundPickupPendingCount}</strong><p>{canManageWarehouseChecks ? "Dealer receipts" : "Pickup tags"}</p></div></div>
          <div className="list-card"><div><strong>{canManageWarehouseChecks ? inboundReceivePendingCount : plannedInboundDockets.length}</strong><p>{canManageWarehouseChecks ? "Pickup receipts" : "Planned routes"}</p></div></div>
          <div className="list-card"><div><strong>{canManageWarehouseChecks ? selfCollectionPendingCount : outboundTagPendingCount}</strong><p>{canManageWarehouseChecks ? "Self handovers" : "Dispatch tags"}</p></div></div>
          <div className="list-card"><div><strong>{snapshot.receiptChecks.filter((item) => item.flagged || item.partialReceipt).length}</strong><p>Partial / flagged</p></div></div>
        </div>
      </Panel> : null}
      {(screen === "full" && activeTab === "home") ? <>
        <Panel title={canManageWarehouseChecks ? "Warehouse Summary" : "Delivery Summary"} eyebrow="Home">
          <div className="stack-list warehouse-order-list">
          <button type="button" className="list-card warehouse-step-card" onClick={() => { setActiveTab("in"); setInboundStep(canManageDeliveryTagging ? "pickup" : "dealer"); }}>
            <strong><LabelWithBadge label="In" count={inboundTotalPendingCount} /></strong><p>{canManageDeliveryTagging ? "Tag supplier pickups, then monitor dealer and pickup receipts separately." : "Track pickup routing and receive inward tasks."}</p>
          </button>
          <button type="button" className="list-card warehouse-step-card" onClick={() => { setActiveTab("out"); setOutboundStep(canManageWarehouseChecks ? "check" : ((snapshot.deliveryDockets.some((item) => item.status === "Ready" && !item.consignmentId) || snapshot.deliveryConsignments.some((item) => item.status === "Ready")) ? "bundle" : "planned")); }}>
            <strong><LabelWithBadge label="Out" count={outboundTotalPendingCount} /></strong><p>{canManageWarehouseChecks ? "Check deliveries, hand over self-collection orders, and create outbound dockets." : "Bundle warehouse dockets into consignments and tag delivery."}</p>
          </button>
        </div>
        {!canManageWarehouseChecks ? <p className="message success top-gap">Customer self-collection handover stays with warehouse. Delivery manager only tracks status and delivery-side workload.</p> : null}
        </Panel>
      </> : null}
      {(screen === "full" ? activeTab === "in" : screen === "in") ? <>
        <Panel title={canManageWarehouseChecks ? "Receipts" : "Inbound Routing"} eyebrow={canManageWarehouseChecks ? "Incoming orders" : "Pickup routes"}>
          <div className="segmented-tabs">
            {canManageDeliveryTagging ? <button className={inboundStep === "pickup" ? "tab-button active" : "tab-button"} type="button" onClick={() => setInboundStep("pickup")}><LabelWithBadge label="1. Pickup" count={inboundPickupPendingCount} /></button> : null}
            {canManageWarehouseChecks ? <button className={inboundStep === "dealer" ? "tab-button active" : "tab-button"} type="button" onClick={() => setInboundStep("dealer")}><LabelWithBadge label={canManageDeliveryTagging ? "2. Dealer" : "1. Dealer"} count={dealerReceiptPendingCount} /></button> : null}
            {canManageWarehouseChecks ? <button className={inboundStep === "receive" ? "tab-button active" : "tab-button"} type="button" onClick={() => setInboundStep("receive")}><LabelWithBadge label={canManageDeliveryTagging ? "3. Receive" : "2. Receive"} count={inboundReceivePendingCount} /></button> : null}
            <button className={inboundStep === "planned" ? "tab-button active" : "tab-button"} type="button" onClick={() => setInboundStep("planned")}><LabelWithBadge label={canManageDeliveryTagging && canManageWarehouseChecks ? "4. Planned" : canManageDeliveryTagging ? "2. Planned" : "3. Planned"} count={inboundPlannedPendingCount} /></button>
            <button className={inboundStep === "completed" ? "tab-button active" : "tab-button"} type="button" onClick={() => setInboundStep("completed")}><LabelWithBadge label={canManageDeliveryTagging && canManageWarehouseChecks ? "5. Completed" : canManageDeliveryTagging ? "3. Completed" : "4. Completed"} count={inboundCompletedCount} /></button>
          </div>
        </Panel>
        {canManageDeliveryTagging && inboundStep === "pickup" ? <><Panel title="Tag In Delivery Team" eyebrow="Self collection only">
          <form className="form-grid" onSubmit={async (event) => {
            event.preventDefault();
            if (submittingInboundTag) return;
            const chosenGroups = optimizeInboundGroups(sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => selectedInboundGroups.includes(group.id) && !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))));
            if (chosenGroups.length === 0) return;
            const routeStops = chosenGroups.map((group) => {
              const first = group.lines[0];
              const supplier = supplierById.get(first.supplierId);
              const warehouse = warehouseById.get(first.warehouseId);
              return {
                orderId: group.id,
                supplierId: first.supplierId,
                supplierName: first.supplierName,
                productSummary: group.lines.map((line) => `${line.productSku} x ${line.quantityOrdered}`).join(", "),
                warehouseId: first.warehouseId,
                warehouseName: warehouse?.name || first.warehouseId,
                amountToPay: purchasePaymentStatus(snapshot, group.id) === "Completed" ? 0 : (purchaseLedger(group)?.pendingAmount || groupTotal(group)),
                paymentRequired: purchasePaymentStatus(snapshot, group.id) !== "Completed",
                paymentMode: first.paymentMode,
                cashTiming: first.cashTiming,
                paymentReference: "",
                paymentProofName: "",
                latitude: supplier?.latitude,
                longitude: supplier?.longitude,
                locationLabel: supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", "),
                reached: false,
                checked: false,
                paid: purchasePaymentStatus(snapshot, group.id) === "Completed",
                picked: false
              };
            });
            const routeLabels = routeStops.map((stop) => stop.locationLabel || stop.supplierName);
            const destination = warehouseById.get(chosenGroups[0].lines[0].warehouseId);
            setSubmittingInboundTag(true);
            try {
              await onCreateDeliveryTask({
                side: "Purchase",
                linkedOrderId: chosenGroups[0].id,
                linkedOrderIds: chosenGroups.map((group) => group.id),
                mode: "Self Collection",
                transportType: inboundTransportType,
                vehicleNumber: inboundTransportType === "External" ? inboundExternalVehicleNumber : undefined,
                freightAmount: inboundTransportType === "External" ? Number(inboundExternalFreightAmount || 0) : undefined,
                from: routeStops.map((stop) => stop.supplierName).join(", "),
                to: destination?.name || chosenGroups[0].lines[0].warehouseId,
                assignedTo: inboundTransportType === "External" ? inboundExternalVehicleNumber : inboundAssignedTo.join(", "),
                paymentAction: routeStops.some((stop) => stop.paymentRequired) ? "Deliver Payment" : "None",
                cashCollectionRequired: routeStops.some((stop) => stop.paymentRequired),
                routeHint: routeLabels.join(" -> "),
                routeStops,
                status: "Planned"
              });
              setSelectedInboundGroups([]);
              setInboundStep("planned");
            } finally {
              setSubmittingInboundTag(false);
            }
          }}>
            <div className="wide-field stack-list warehouse-order-list">
              {inboundSuggestionGroups().map((bucket, index) => {
                const mapUrl = mapsDirectionsUrl([...bucket.map((group) => supplierAddress(group)), warehouseById.get(bucket[0]?.lines[0]?.warehouseId || "")?.name || "Warehouse"]);
                return <button type="button" className="list-card warehouse-step-card" key={`in-suggestion-${index}`} disabled={submittingInboundTag} onClick={() => setSelectedInboundGroups(bucket.map((group) => group.id))}>
                  <strong>{`Suggested pickup group ${index + 1}`}</strong>
                  <p>{bucket.length} PO group(s) - {groupRouteDistanceKm(bucket, (group) => supplierById.get(group.lines[0]?.supplierId || "")).toFixed(1)} km between pickups - {bucket.map((group) => group.lines[0]?.supplierName || group.id).join(", ")}</p>
                  {mapUrl ? <span className="small-label">Suggested map route available after selection</span> : null}
                </button>;
              })}
            </div>
            <div className="wide-field stack-list warehouse-order-list">
              {sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))).length === 0 ? <div className="empty-card">No self-collection inbound orders waiting for tagging.</div> : sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group))).map((group) => <label className="list-card big-checkbox" key={group.id}>
                <input type="checkbox" disabled={submittingInboundTag} checked={selectedInboundGroups.includes(group.id)} onChange={(e) => setSelectedInboundGroups((current) => e.target.checked ? [...new Set([...current, group.id])] : current.filter((item) => item !== group.id))} />
                <span />
                <div>
                  <strong>{group.id}</strong>
                  <p>{group.lines[0].supplierName} · {supplierAddress(group)} · {group.lines.length} products · {groupPendingQty(group)} pending · {groupWeight(group, true).toFixed(2)} kg</p>
                </div>
              </label>)}
            </div>
            {selectedInboundGroups.length > 0 ? <div className="wide-field form-grid">
              <label>Transport<select value={inboundTransportType} disabled={submittingInboundTag} onChange={(e) => setInboundTransportType(e.target.value as DeliveryTask["transportType"])}><option>Internal</option><option>External</option></select></label>
              {inboundTransportType === "Internal" ? <label>In delivery team<select multiple value={inboundAssignedTo} disabled={submittingInboundTag} onChange={(e) => setInboundAssignedTo(normalizeSelectedDeliveryUsers(selectedOptions(e), inboundDeliveryUsers, defaultInboundDeliveryUsername))}>{inboundDeliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label> : <>
                <label>Vehicle number<input value={inboundExternalVehicleNumber} disabled={submittingInboundTag} onChange={(e) => setInboundExternalVehicleNumber(e.target.value)} placeholder="MP09-AB-1234" /></label>
                <label>Freight amount<input type="number" step="any" value={inboundExternalFreightAmount} disabled={submittingInboundTag} onChange={(e) => setInboundExternalFreightAmount(e.target.value)} /></label>
              </>}
            </div> : <p className="message success wide-field">Select pickup orders first, then choose internal or external transport.</p>}
            <div className="payment-card-actions wide-field">
              <span className="small-label">{selectedInboundGroups.length} self-collection pickup order(s) selected</span>
              <span className="small-label">{optimizeInboundGroups(sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => selectedInboundGroups.includes(group.id) && !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group)))).reduce((sum, group) => sum + groupWeight(group, true), 0).toFixed(2)} kg selected</span>
              {selectedInboundGroups.length > 0 ? <a className="ghost-button" href={mapsDirectionsUrl([...optimizeInboundGroups(sortGroupsForInboundTag(pendingReceiveGroups.filter((group) => selectedInboundGroups.includes(group.id) && !inboundTaskForGroup(group.id) && groupNeedsPickupTask(group)))).map((group) => supplierAddress(group)), warehouseById.get(pendingReceiveGroups.find((group) => selectedInboundGroups.includes(group.id))?.lines[0]?.warehouseId || "")?.name || "Warehouse"])} target="_blank" rel="noreferrer">Map pickup route</a> : null}
              <button className="primary-button" type="submit" disabled={submittingInboundTag}>{submittingInboundTag ? "Tagging..." : "Tag inbound pickup"}</button>
            </div>
          </form>
          {pendingReceiveGroups.every((group) => !groupNeedsPickupTask(group) || Boolean(inboundTaskForGroup(group.id))) ? <p className="message success top-gap">No self-collection inbound pickup is waiting. Dealer-delivery orders are received directly by warehouse.</p> : null}
          <div className="payment-card-actions top-gap">
            {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("dealer")}>Go to dealer receipts</button> : <button className="ghost-button" type="button" onClick={() => setInboundStep("planned")}>View planned routes</button>}
          </div>
        </Panel></> : inboundStep === "dealer" ? <>
            <Panel title="Dealer Delivery Receipts" eyebrow="Receive direct vendor drops">
              <div className="warehouse-order-list">
                {directReceiveGroups.length === 0 ? <div className="empty-card">No dealer-delivery receipts pending.</div> : directReceiveGroups.map((group) => renderReceiveGroup(group, false))}
              </div>
            </Panel>
            <div className="payment-card-actions">
              {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setInboundStep("pickup")}>Back to pickup</button> : null}
              <button className="ghost-button" type="button" onClick={() => setInboundStep("receive")}>Go to pickup receipts</button>
              <button className="ghost-button" type="button" onClick={() => setInboundStep("planned")}>View planned dockets</button>
              <button className="ghost-button" type="button" onClick={() => setInboundStep("completed")}>View completed</button>
            </div>
          </> : inboundStep === "receive" ? <>
            <Panel title="Pickup Receipts" eyebrow="Receive tagged self-collection loads">
              <div className="warehouse-order-list">
                {receivingInboundDockets.length === 0 ? <div className="empty-card">No pickup receipts pending.</div> : <>
                  {receivingInboundDockets.map((item) => renderReceiveTaskDocket(item.task, false))}
                </>}
              </div>
            </Panel>
            <div className="payment-card-actions">
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("dealer")}>Back to dealer receipts</button> : null}
              <button className="ghost-button" type="button" onClick={() => setInboundStep("planned")}>View planned dockets</button>
              <button className="ghost-button" type="button" onClick={() => setInboundStep("completed")}>View completed</button>
            </div>
          </> : inboundStep === "planned" ? <><Panel title="Planned Inbound Dockets" eyebrow="Awaiting delivery start">
            <div className="warehouse-order-list">
              {plannedInboundDockets.length === 0 ? <div className="empty-card">No planned inbound dockets.</div> : plannedInboundDockets.map((item) => renderReceiveTaskDocket(item.task, false))}
            </div>
            <div className="payment-card-actions top-gap">
              {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setInboundStep("pickup")}>Back to pickup</button> : null}
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("dealer")}>Go to dealer receipts</button> : null}
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("receive")}>Go to pickup receipts</button> : null}
              <button className="ghost-button" type="button" onClick={() => setInboundStep("completed")}>View completed</button>
            </div>
          </Panel></> : <>{completedDateControls}
            <div className="payment-card-actions">
              <button className="ghost-button" type="button" onClick={() => downloadReportCsv(inboundExportPrefix, inboundExportHeaders, inboundExportRowsData, activeInboundRange.fromDate, activeInboundRange.toDate)}>Download CSV</button>
              <button className="ghost-button" type="button" onClick={() => downloadReportPdf(inboundExportTitle, inboundExportPrefix, inboundExportHeaders, inboundExportRowsData, activeInboundRange.fromDate, activeInboundRange.toDate, [`Completed items: ${inboundCompletedCount}`, "Step: completed-inbound"])}>Download PDF</button>
            </div>
            <Panel title="In Completed" eyebrow="Warehouse checked">
              <div className="warehouse-order-list">
                {receivedGroups.length === 0 && completedInboundDockets.length === 0 ? <div className="empty-card">No completed orders yet.</div> : <>
                  {completedInboundDockets.map((item) => renderReceiveTaskDocket(item.task, true))}
                  {receivedGroups.map((group) => renderReceiveGroup(group, true))}
                </>}
              </div>
              <div className="payment-card-actions top-gap">
                {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setInboundStep("pickup")}>Back to pickup</button> : null}
                {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("dealer")}>Back to dealer receipts</button> : null}
                {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setInboundStep("receive")}>Back to pickup receipts</button> : null}
              </div>
            </Panel>
          </>}
        {inboundDateOpen ? <div className="cart-overlay" onClick={() => setInboundDateOpen(false)}>
          <div className="cart-sheet date-picker-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="cart-head">
              <div>
                <h3>Select date range</h3>
                <p>Choose inbound from and to dates, then click done.</p>
              </div>
              <button type="button" className="ghost-button" onClick={() => setInboundDateOpen(false)}>Close</button>
            </div>
            <label>
              From
              <input type="date" value={inboundCustomFromDraft} onChange={(e) => setInboundCustomFromDraft(e.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={inboundCustomToDraft} onChange={(e) => setInboundCustomToDraft(e.target.value)} />
            </label>
            <div className="payment-card-actions">
              <button type="button" className="ghost-button" onClick={() => setInboundDateOpen(false)}>Cancel</button>
              <button type="button" className="primary-button" onClick={() => {
                const normalized = normalizeDateRange(inboundCustomFromDraft || todayDate, inboundCustomToDraft || inboundCustomFromDraft || todayDate);
                setInboundFromDate(normalized.fromDate);
                setInboundToDate(normalized.toDate);
                setInboundDatePreset("custom");
                setInboundDateOpen(false);
              }}>Done</button>
            </div>
          </div>
        </div> : null}
      </> : null}
      {(screen === "full" ? activeTab === "out" : screen === "out") ? <>
        <Panel title="Dispatches" eyebrow="Outgoing orders">
          <div className="segmented-tabs">
            {canManageWarehouseChecks ? <button className={outboundStep === "check" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("check")}><LabelWithBadge label="1. Check" count={outboundCheckPendingCount} /></button> : null}
            {canManageWarehouseChecks ? <button className={outboundStep === "self" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("self")}><LabelWithBadge label="2. Self" count={selfCollectionPendingCount} /></button> : null}
            {canManageDeliveryTagging ? <button className={outboundStep === "tag" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("tag")}><LabelWithBadge label={canManageWarehouseChecks ? "3. Tag" : "1. Tag"} count={outboundTagPendingCount} /></button> : null}
            {canManageDeliveryTagging ? <button className={outboundStep === "bundle" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("bundle")}><LabelWithBadge label={canManageWarehouseChecks ? "4. Bundle" : "2. Bundle"} count={outboundBundlePendingCount} /></button> : null}
            <button className={outboundStep === "planned" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("planned")}><LabelWithBadge label={canManageDeliveryTagging ? (canManageWarehouseChecks ? "5. Planned" : "3. Planned") : "3. Planned"} count={outboundPlannedPendingCount} /></button>
            <button className={outboundStep === "completed" ? "tab-button active" : "tab-button"} type="button" onClick={() => setOutboundStep("completed")}><LabelWithBadge label={canManageDeliveryTagging ? (canManageWarehouseChecks ? "6. Completed" : "4. Completed") : "4. Completed"} count={outboundCompletedCount} /></button>
          </div>
        </Panel>
        {outboundStep === "completed" ? <>{completedDateControls}
          <div className="payment-card-actions">
            <button className="ghost-button" type="button" onClick={() => downloadReportCsv(outboundExportPrefix, outboundExportHeaders, outboundExportRowsData, activeInboundRange.fromDate, activeInboundRange.toDate)}>Download CSV</button>
            <button className="ghost-button" type="button" onClick={() => downloadReportPdf(outboundExportTitle, outboundExportPrefix, outboundExportHeaders, outboundExportRowsData, activeInboundRange.fromDate, activeInboundRange.toDate, [`Completed items: ${outboundCompletedCount}`, "Step: completed-outbound"])}>Download PDF</button>
          </div>
        </> : null}
        {outboundStep === "check" ? <Panel title="Checks On Out" eyebrow="Outbound dockets">
          {openDockets.length > 0 ? <p className="message success top-gap">{canManageWarehouseChecks ? `${openDockets.length} outbound docket(s) are ready for delivery manager bundling.` : `${openDockets.length} warehouse docket(s) are ready. Bundle them into consignments before tagging delivery.`}</p> : null}
          {bundleReadyConsignments.length > 0 ? <p className="message success top-gap">{canManageDeliveryTagging ? `${bundleReadyConsignments.length} bundled consignment(s) are waiting. Continue in Tag to assign delivery.` : `${bundleReadyConsignments.length} bundled consignment(s) are waiting for delivery manager assignment.`}</p> : null}
          {outgoingGroups.some((group) => {
            const first = group.lines[0];
            const pendingAmount = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id);
            return pendingAmount > 0 && first.paymentMode !== "Cash";
          }) ? <p className="message success top-gap">Some customer payments are still pending, but outbound processing is allowed for now.</p> : null}
          <div className="warehouse-order-list">
            {activeOutboundDockets.length === 0 && directOutboundGroups.length === 0 ? <div className="empty-card">No outgoing orders pending.</div> : <>
              {activeOutboundDockets.map((item) => renderSendTaskDocket(item.task, "check-out"))}
              {directOutboundGroups.map((group) => renderOutgoingGroup(group, "check-out"))}
            </>}
          </div>
          <div className="payment-card-actions top-gap">
            {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("self")}>Go to self collection</button> : null}
            {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("bundle")}>Go to bundle</button> : null}
            <button className="ghost-button" type="button" onClick={() => setOutboundStep("completed")}>View completed</button>
          </div>
        </Panel> : outboundStep === "self" ? <Panel title="Self Collection Handovers" eyebrow="Customer pickup from godown">
          <div className="warehouse-order-list">
            {selfCollectionOutboundGroups.length === 0 ? <div className="empty-card">No self-collection handovers pending.</div> : selfCollectionOutboundGroups.map((group) => renderOutgoingGroup(group, "check-out"))}
          </div>
          <div className="payment-card-actions top-gap">
            {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("check")}>Back to check</button> : null}
            {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("bundle")}>Go to bundle</button> : null}
            <button className="ghost-button" type="button" onClick={() => setOutboundStep("completed")}>View completed</button>
          </div>
        </Panel> : outboundStep === "tag" ? <>
          <Panel title="Tag Outbound Delivery Team" eyebrow="Assign bundled consignments">
            <form className="form-grid" onSubmit={async (event) => {
              event.preventDefault();
              if (submittingOutboundTag) return;
              const selectedConsignments = bundleReadyConsignments.filter((item) => selectedOutboundGroups.includes(item.id));
              if (selectedConsignments.length === 0) return;
              setSubmittingOutboundTag(true);
              try {
                const chosenGroups = sortOrdersForOutboundTag(
                  Array.from(
                    selectedConsignments
                      .flatMap((consignment) => consignmentGroups(consignment).filter((group) => group.lines[0].deliveryMode === "Delivery"))
                      .reduce((map, group) => map.set(group.id, group), new Map<string, SalesGroup>())
                      .values()
                  )
                );
                if (chosenGroups.length === 0) return;
                const routeStops = chosenGroups.map((group) => {
                  const first = group.lines[0];
                  const customer = customerById.get(first.shopId);
                  const pendingAmount = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id);
                  const deliveryCollectsCash = first.paymentMode === "Cash" && first.cashTiming === "At Delivery";
                  return {
                    orderId: group.id,
                    supplierId: first.shopId,
                    supplierName: first.shopName,
                    productSummary: group.lines.map((line) => `${line.productSku} x ${line.quantity}`).join(", "),
                    warehouseId: first.warehouseId,
                    warehouseName: warehouseById.get(first.warehouseId)?.name || first.warehouseId,
                    amountToPay: deliveryCollectsCash && pendingAmount > 0 ? pendingAmount : 0,
                    paymentRequired: deliveryCollectsCash && pendingAmount > 0,
                    paymentMode: first.paymentMode,
                    cashTiming: first.cashTiming,
                    latitude: customer?.latitude,
                    longitude: customer?.longitude,
                    locationLabel: customerAddress(first),
                    reached: false,
                    checked: false,
                    paid: pendingAmount <= 0,
                    picked: false
                  };
                });
                await onCreateDeliveryTask({
                  side: "Sales",
                  linkedOrderId: chosenGroups[0].id,
                  linkedOrderIds: chosenGroups.map((group) => group.id),
                  consignmentId: selectedConsignments[0].id,
                  mode: "Delivery",
                  transportType: outboundTransportType,
                  vehicleNumber: outboundTransportType === "External" ? outboundExternalVehicleNumber : undefined,
                  freightAmount: outboundTransportType === "External" ? Number(outboundExternalFreightAmount || 0) : undefined,
                  from: chosenGroups[0].lines[0].warehouseId,
                  to: routeStops.map((stop) => stop.supplierName).join(", "),
                  assignedTo: outboundTransportType === "External" ? outboundExternalVehicleNumber : outboundAssignedTo.join(", "),
                  paymentAction: routeStops.some((stop) => stop.paymentRequired) ? "Collect Payment" : "None",
                  cashCollectionRequired: routeStops.some((stop) => stop.paymentRequired && stop.paymentMode === "Cash" && stop.cashTiming === "At Delivery"),
                  routeHint: routeStops.map((stop) => stop.locationLabel || stop.supplierName).join(" -> "),
                  routeStops,
                  status: "Planned"
                });
                setSelectedOutboundGroups([]);
                setOutboundStep("planned");
              } finally {
                setSubmittingOutboundTag(false);
              }
            }}>
              <div className="wide-field stack-list warehouse-order-list">
                {bundleReadyConsignments.length === 0 ? <div className="empty-card">{openDockets.length > 0 ? `${openDockets.length} docket(s) are ready, but not bundled yet. Open Bundle first, create a consignment, then come back to Tag.` : "No bundled consignments waiting for delivery tagging."}</div> : bundleReadyConsignments.map((consignment) => {
                  const groups = sortOrdersForOutboundTag(consignmentGroups(consignment).filter((group) => group.lines[0].deliveryMode === "Delivery"));
                  const totalQty = groups.reduce((sum, group) => sum + group.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
                  const mapUrl = mapsDirectionsUrl(groups.map((group) => customerAddressForGroup(group)));
                  return <label className="list-card big-checkbox" key={consignment.id}>
                    <input type="checkbox" disabled={submittingOutboundTag} checked={selectedOutboundGroups.includes(consignment.id)} onChange={(e) => setSelectedOutboundGroups((current) => e.target.checked ? [...new Set([...current, consignment.id])] : current.filter((item) => item !== consignment.id))} />
                    <span />
                    <div>
                      <strong>{consignment.id}</strong>
                      <p>{groups.length} stop(s) - {totalQty} qty - {consignment.totalWeightKg.toFixed(2)} kg</p>
                      <p>{groups.map((group) => group.lines[0]?.shopName || group.id).join(", ")}</p>
                      <span className="small-label">{consignmentRouteLabel(consignment)}</span>
                      {mapUrl ? <a className="ghost-button" href={mapUrl} target="_blank" rel="noreferrer">Map route</a> : null}
                    </div>
                  </label>;
                })}
              </div>
              {selectedOutboundGroups.length > 0 ? <div className="wide-field form-grid">
                <label>Transport<select value={outboundTransportType} disabled={submittingOutboundTag} onChange={(e) => setOutboundTransportType(e.target.value as DeliveryTask["transportType"])}><option>Internal</option><option>External</option></select></label>
                {outboundTransportType === "Internal" ? <label>Out delivery team<select multiple value={outboundAssignedTo} disabled={submittingOutboundTag} onChange={(e) => setOutboundAssignedTo(normalizeSelectedDeliveryUsers(selectedOptions(e), outboundDeliveryUsers, defaultOutboundDeliveryUsername))}>{outboundDeliveryUsers.map((user) => <option key={user.id} value={user.username}>{user.fullName || user.username}</option>)}</select></label> : <>
                  <label>Vehicle number<input value={outboundExternalVehicleNumber} disabled={submittingOutboundTag} onChange={(e) => setOutboundExternalVehicleNumber(e.target.value)} placeholder="MP09-AB-1234" /></label>
                  <label>Freight amount<input type="number" step="any" value={outboundExternalFreightAmount} disabled={submittingOutboundTag} onChange={(e) => setOutboundExternalFreightAmount(e.target.value)} /></label>
                </>}
              </div> : <p className="message success wide-field">Select bundled consignments first, then choose internal or external transport.</p>}
              <div className="payment-card-actions wide-field">
                <span className="small-label">{selectedOutboundGroups.length} bundled consignment selected</span>
                <span className="small-label">{bundleReadyConsignments.filter((item) => selectedOutboundGroups.includes(item.id)).reduce((sum, item) => sum + item.totalWeightKg, 0).toFixed(2)} kg selected</span>
                <button className="primary-button" type="submit" disabled={submittingOutboundTag}>{submittingOutboundTag ? "Tagging..." : "Tag outbound delivery"}</button>
              </div>
            </form>
          </Panel>
          <div className="payment-card-actions">
            <button className="ghost-button" type="button" onClick={() => setOutboundStep("bundle")}>Go to bundle</button>
            <button className="ghost-button" type="button" onClick={() => setOutboundStep("planned")}>Go to planned</button>
            <button className="ghost-button" type="button" onClick={() => setOutboundStep("completed")}>View completed</button>
          </div>
        </> : outboundStep === "planned" ? <Panel title="Assigned Outbound Pickups" eyebrow="Tagged and waiting">
            <div className="warehouse-order-list">
              {plannedOutboundDockets.length === 0 ? <div className="empty-card">No outbound delivery tasks planned yet.</div> : plannedOutboundDockets.map((item) => <label className="list-card big-checkbox" key={`planned-${item.task.id}`}>
                <input type="checkbox" checked={selectedPlannedOutboundTaskIds.includes(item.task.id)} onChange={(e) => setSelectedPlannedOutboundTaskIds((current) => e.target.checked ? [...new Set([...current, item.task.id])] : current.filter((taskId) => taskId !== item.task.id))} />
                <span />
                <div className="wide-field">{renderSendTaskDocket(item.task, "tag-out")}</div>
              </label>)}
            </div>
            <div className="payment-card-actions top-gap">
              {canManageDeliveryTagging ? <button className="primary-button" type="button" disabled={selectedPlannedOutboundTaskIds.length < 2} onClick={async () => {
                await onMergeDeliveryTasks({ taskIds: selectedPlannedOutboundTaskIds });
                setSelectedPlannedOutboundTaskIds([]);
              }}>Club selected deliveries</button> : null}
              {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("tag")}>Back to tag</button> : null}
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("check")}>Go to check</button> : null}
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("self")}>Go to self collection</button> : null}
              <button className="ghost-button" type="button" onClick={() => setOutboundStep("completed")}>View completed</button>
            </div>
          </Panel> : outboundStep === "bundle" ? <>{renderOutboundBundlePanel()}<div className="payment-card-actions"><button className="ghost-button" type="button" onClick={() => setOutboundStep("completed")}>View completed</button></div></> : <Panel title="Completed Dispatches" eyebrow="Done deliveries">
            <div className="warehouse-order-list">
              {completedOutboundDockets.length === 0 && completedDirectOutboundGroups.length === 0 ? <div className="empty-card">No completed outbound deliveries yet.</div> : <>
                {completedOutboundDockets.map((item) => renderSendTaskDocket(item.task, "check-out"))}
                {completedDirectOutboundGroups.map((group) => renderOutgoingGroup(group, "check-out"))}
              </>}
            </div>
            <div className="payment-card-actions top-gap">
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("check")}>Back to check</button> : null}
              {canManageWarehouseChecks ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("self")}>Back to self collection</button> : null}
              {canManageDeliveryTagging ? <button className="ghost-button" type="button" onClick={() => setOutboundStep("planned")}>Back to planned</button> : null}
            </div>
          </Panel>}</> : null}
    </section>
  );
}

export function DeliveryJobsView({
  snapshot,
  currentUser,
  initialTab = "current",
  showInternalTabs = true,
  onUploadProof,
  onUpdateTask
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  initialTab?: "current" | "new";
  showInternalTabs?: boolean;
  onUploadProof: (file: File) => Promise<unknown>;
  onUpdateTask: (id: string, body: {
    linkedOrderIds?: string[];
    assignedTo: string;
    routeStops?: DeliveryTask["routeStops"];
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
  const myTasks = snapshot.deliveryTasks.filter((item) => isUserAssignedToDelivery(item.assignedTo, currentUser));
  const [drafts, setDrafts] = useState<Record<string, { routeHint: string; weightProofName: string; cashProofName: string; cashHandoverMarked: boolean; status: DeliveryTask["status"]; routeStops: DeliveryTask["routeStops"] }>>({});
  const [currentPosition, setCurrentPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [deliveryTab, setDeliveryTab] = useState<"current" | "new">(initialTab);
  const [startedStops, setStartedStops] = useState<Record<string, boolean>>({});
  const supplierById = new Map(snapshot.counterparties.filter((item) => item.type === "Supplier").map((item) => [item.id, item]));
  const customerById = new Map(snapshot.counterparties.filter((item) => item.type === "Shop").map((item) => [item.id, item]));
  const warehouseById = new Map(snapshot.warehouses.map((item) => [item.id, item]));

  useEffect(() => {
    setDeliveryTab(initialTab);
  }, [initialTab]);

  function canMarkStop(stop: DeliveryTask["routeStops"][number]) {
    if (!currentPosition || stop.latitude === undefined || stop.longitude === undefined) return true;
    const dx = currentPosition.latitude - stop.latitude;
    const dy = currentPosition.longitude - stop.longitude;
    return Math.sqrt((dx * dx) + (dy * dy)) < 0.01;
  }

  function outboundWarehouseReached(task: DeliveryTask, draft: ReturnType<typeof taskDraft>) {
    return task.side !== "Sales" || draft.routeStops.length === 0 || draft.routeStops.every((stop) => stop.warehouseReached);
  }

  function liveStopLabel(stop: DeliveryTask["routeStops"][number]) {
    if (stop.orderId.startsWith("SO-") || stop.orderId.startsWith("SCART-")) {
      const customer = customerById.get(stop.supplierId || "");
      return customer?.name || stop.supplierName;
    }
    const supplier = supplierById.get(stop.supplierId || "");
    return supplier?.name || stop.supplierName;
  }

  function liveStopLocation(stop: DeliveryTask["routeStops"][number]) {
    if (stop.orderId.startsWith("SO-") || stop.orderId.startsWith("SCART-")) {
      const customer = customerById.get(stop.supplierId || "");
      return customer?.locationLabel || [customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ") || stop.locationLabel || liveStopLabel(stop);
    }
    const supplier = supplierById.get(stop.supplierId || "");
    return supplier?.locationLabel || [supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ") || stop.locationLabel || liveStopLabel(stop);
  }

  function liveWarehouseName(stop: DeliveryTask["routeStops"][number]) {
    return warehouseById.get(stop.warehouseId)?.name || stop.warehouseName;
  }

  function liveStopContact(stop: DeliveryTask["routeStops"][number]) {
    if (stop.orderId.startsWith("SO-") || stop.orderId.startsWith("SCART-")) {
      return customerById.get(stop.supplierId || "")?.mobileNumber || "Pending";
    }
    return supplierById.get(stop.supplierId || "")?.mobileNumber || "Pending";
  }

  function stopEntityLabel(stop: DeliveryTask["routeStops"][number]) {
    return stop.orderId.startsWith("SO-") || stop.orderId.startsWith("SCART-") ? "Customer" : "Supplier";
  }

  function parseProductItems(summary: string) {
    return summary.split(",").map((item) => item.trim()).filter(Boolean).map((item) => {
      const match = item.match(/^(.*)\s+x\s+([\d.]+)$/i);
      return {
        label: match ? match[1].trim() : item,
        quantity: match ? Number(match[2]) : 1
      };
    });
  }

  function totalTaskQuantity(task: DeliveryTask) {
    return task.routeStops.reduce((sum, stop) => sum + parseProductItems(stop.productSummary).reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
  }

  function approxDistanceKmFromCurrent(stop: DeliveryTask["routeStops"][number]) {
    if (!currentPosition || stop.latitude === undefined || stop.longitude === undefined) return null;
    const toRad = (value: number) => (value * Math.PI) / 180;
    const dLat = toRad(stop.latitude - currentPosition.latitude);
    const dLon = toRad(stop.longitude - currentPosition.longitude);
    const lat1 = toRad(currentPosition.latitude);
    const lat2 = toRad(stop.latitude);
    const a = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function taskDraft(task: DeliveryTask) {
    return drafts[task.id] || {
      routeHint: task.routeHint || "",
      weightProofName: task.weightProofName || "",
      cashProofName: task.cashProofName || "",
      cashHandoverMarked: task.cashHandoverMarked,
      status: task.status,
      routeStops: task.routeStops || []
    };
  }

  function updateStopDraft(taskId: string, task: DeliveryTask, orderId: string, updates: Partial<DeliveryTask["routeStops"][number]>) {
    setDrafts((current) => {
      const draft = current[taskId] || taskDraft(task);
      const routeStops = draft.routeStops.map((stop) => stop.orderId === orderId ? { ...stop, ...updates } : stop);
      return {
        ...current,
        [taskId]: {
          ...draft,
          routeStops,
          cashHandoverMarked: routeStops.some((stop) => stop.paid)
        }
      };
    });
  }

  function moveStopToFront(taskId: string, task: DeliveryTask, orderId: string) {
    setDrafts((current) => {
      const draft = current[taskId] || taskDraft(task);
      const target = draft.routeStops.find((stop) => stop.orderId === orderId);
      if (!target) return current;
      const remaining = draft.routeStops.filter((stop) => stop.orderId !== orderId);
      return {
        ...current,
        [taskId]: {
          ...draft,
          routeStops: [target, ...remaining]
        }
      };
    });
  }

  async function uploadStopPaymentProof(taskId: string, task: DeliveryTask, orderId: string, file: File | null) {
    if (!file) return;
    const uploaded = await onUploadProof(file);
    if (!uploaded || typeof uploaded !== "object" || !("fileName" in uploaded)) return;
    updateStopDraft(taskId, task, orderId, { paymentProofName: String((uploaded as { fileName: string }).fileName) });
  }

  function taskProgressStatus(task: DeliveryTask, draft: ReturnType<typeof taskDraft>) {
    if (task.side === "Sales") {
      if (draft.status === "Delivered") return "Delivered";
      if (draft.status === "Handed Over") return "Out for delivery";
      if (draft.status === "Picked") {
        if (!outboundWarehouseReached(task, draft)) return "Accepted, reach warehouse";
        return draft.routeStops.some((stop) => stop.reached || stop.checked || stop.paid || stop.picked) ? "Out for delivery" : "Reached warehouse";
      }
      return "New outbound assignment";
    }
    if (draft.status === "Handed Over" || draft.status === "Delivered") return draft.status;
    if (draft.routeStops.every((stop) => stop.picked)) return "Ready For Warehouse";
    if (draft.routeStops.some((stop) => stop.reached || stop.checked || stop.paid || stop.picked)) return "In Progress";
    return "New Assignment";
  }

  function stepInstruction(stop: DeliveryTask["routeStops"][number]) {
    if (!stop.reached) return `Go to ${liveStopLabel(stop)} and reach supplier location.`;
    if (!stop.checked) return `Check ${stop.productSummary} with ${liveStopLabel(stop)}.`;
    if (stop.paymentRequired && !stop.paid) {
      if (stop.paymentMode === "Cash") return `Pay ${stop.amountToPay.toFixed(2)} in cash to ${liveStopLabel(stop)} and upload proof.`;
      return `Verify payment reference ${stop.paymentReference || "pending"} with ${liveStopLabel(stop)}.`;
    }
    if (!stop.picked) return `Pick ${stop.productSummary} from ${liveStopLabel(stop)} for ${liveWarehouseName(stop)}.`;
    return `Goods picked. Move to ${liveWarehouseName(stop)}.`;
  }

  const sortedTasks = [...myTasks].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const currentAssignments = sortedTasks.filter((task) => {
    const draft = taskDraft(task);
    return draft.status !== "Planned" && isDeliveryTaskPending({ ...task, status: draft.status });
  });
  const newAssignments = sortedTasks.filter((task) => taskDraft(task).status === "Planned");
  function renderTask(task: DeliveryTask, compact = false) {
    const draft = taskDraft(task);
    const weightUrl = draft.weightProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.weightProofName}` : "";
    const cashUrl = draft.cashProofName ? `${API_BASE}/uploads/delivery-proofs/${draft.cashProofName}` : "";
    const routeMapUrl = mapsDirectionsUrl([...(draft.routeStops || []).map((stop) => liveStopLocation(stop)), task.to]);
    const nextStop = draft.routeStops.find((stop) => !stop.picked) || draft.routeStops[0];
    const allPicked = draft.routeStops.every((stop) => stop.picked);
    const warehouseReached = outboundWarehouseReached(task, draft);
    const completedStops = draft.routeStops.filter((stop) => stop.picked);
    const progressMapUrl = nextStop && !allPicked ? mapsDirectionsUrl([liveStopLocation(nextStop)]) : mapsDirectionsUrl([task.to]);
    const totalQty = totalTaskQuantity(task);
    const approxRouteKm = currentPosition ? draft.routeStops.reduce((sum, stop) => sum + (approxDistanceKmFromCurrent(stop) || 0), 0) : null;
    const itemChecks = nextStop ? parseProductItems(nextStop.productSummary) : [];
    const itemCheckKey = nextStop ? `${task.id}-${nextStop.orderId}` : "";
    const startKey = nextStop ? `${task.id}-${nextStop.orderId}-started` : "";
    const itemCheckState = nextStop ? drafts[itemCheckKey as keyof typeof drafts] : undefined;
    const checkedItems = Array.isArray(itemCheckState) ? itemCheckState as unknown as boolean[] : itemChecks.map(() => false);
    const currentStopStarted = startKey ? Boolean(startedStops[startKey]) : false;

    function setCheckedItems(values: boolean[]) {
      setDrafts((current) => ({ ...current, [itemCheckKey]: values as unknown as { routeHint: string; weightProofName: string; cashProofName: string; cashHandoverMarked: boolean; status: DeliveryTask["status"]; routeStops: DeliveryTask["routeStops"] } }));
    }

    return <article className="list-card payment-update-card" key={task.id}>
      <div className="payment-update-head">
        <div>
          <strong>{task.side === "Sales" && task.consignmentId ? task.consignmentId : task.id}</strong>
          <p>{task.side === "Sales" ? `${draft.routeStops.length} customer stop(s) | ${task.mode}` : `${task.side} | ${task.linkedOrderIds.join(", ")} | ${task.mode}`}</p>
        </div>
        <span className="status-pill status-pending">{taskProgressStatus(task, draft)}</span>
      </div>
      <div className="payment-meta-grid">
        <div><span className="small-label">Stops</span><strong>{draft.routeStops.length}</strong></div>
        <div><span className="small-label">Total qty</span><strong>{totalQty}</strong></div>
        <div><span className="small-label">Route km</span><strong>{approxRouteKm ? approxRouteKm.toFixed(1) : "Pending"}</strong></div>
        <div><span className="small-label">Last action</span><strong>{formatDateTimeIst(task.lastActionAt)}</strong></div>
      </div>
      {task.side === "Sales" ? <div className="stack-list top-gap">
        {draft.routeStops.map((stop) => <article className="list-card" key={`${task.id}-${stop.orderId}-summary`}>
          <strong>{liveStopLabel(stop)}</strong>
          <p>{stop.orderId} | {stop.productSummary}</p>
          <div className="payment-meta-grid">
            <div><span className="small-label">Contact</span><strong>{liveStopContact(stop)}</strong></div>
            <div><span className="small-label">Status</span><strong>{stop.picked ? "Delivered" : stop.reached ? "At customer" : "Pending"}</strong></div>
          </div>
        </article>)}
      </div> : null}
      {compact ? <div className="payment-card-actions top-gap">
        <button className="primary-button" type="button" onClick={async () => {
          await onUpdateTask(task.id, {
            linkedOrderIds: task.linkedOrderIds,
            assignedTo: task.assignedTo,
            routeStops: draft.routeStops,
            pickupAt: task.pickupAt,
            dropAt: task.dropAt,
            routeHint: draft.routeHint,
            paymentAction: task.paymentAction,
            status: "Picked",
            cashCollectionRequired: task.cashCollectionRequired,
            cashHandoverMarked: draft.cashHandoverMarked,
            weightProofName: draft.weightProofName || undefined,
            cashProofName: draft.cashProofName || undefined,
            lastActionAt: new Date().toISOString()
          });
          setDeliveryTab("current");
        }}>{task.side === "Sales" ? "Accept and go to warehouse" : "Start assignment"}</button>
      </div> : <>
        {task.side === "Sales" && draft.status === "Picked" && !warehouseReached ? <article className="list-card top-gap">
          <strong>Reach warehouse</strong>
          <p>{nextStop ? liveWarehouseName(nextStop) : task.from}</p>
          <div className="payment-meta-grid">
            <div><span className="small-label">Consignment</span><strong>{task.consignmentId || task.linkedOrderIds.join(", ")}</strong></div>
            <div><span className="small-label">Orders</span><strong>{task.linkedOrderIds.join(", ")}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            {mapsDirectionsUrl([nextStop ? liveWarehouseName(nextStop) : task.from]) ? <a className="primary-button" href={mapsDirectionsUrl([nextStop ? liveWarehouseName(nextStop) : task.from])} target="_blank" rel="noreferrer">Open map</a> : null}
            <button className="ghost-button" type="button" onClick={async () => {
              const routeStops = draft.routeStops.map((stop) => ({ ...stop, warehouseReached: true }));
              await onUpdateTask(task.id, {
                linkedOrderIds: task.linkedOrderIds,
                assignedTo: task.assignedTo,
                routeStops,
                pickupAt: task.pickupAt,
                dropAt: task.dropAt,
                routeHint: draft.routeHint,
                paymentAction: task.paymentAction,
                status: "Picked",
                cashCollectionRequired: task.cashCollectionRequired,
                cashHandoverMarked: draft.cashHandoverMarked,
                weightProofName: draft.weightProofName || undefined,
                cashProofName: draft.cashProofName || undefined,
                lastActionAt: new Date().toISOString()
              });
              setDrafts((current) => ({
                ...current,
                [task.id]: {
                  ...draft,
                  routeStops,
                  status: "Picked"
                }
              }));
            }}>Reached warehouse</button>
          </div>
        </article> : null}
        {warehouseReached && !allPicked && nextStop && !nextStop.reached ? <article className="list-card top-gap">
          <strong>{task.side === "Sales" ? "Select customer stop" : "Select vendor to visit"}</strong>
          <div className="stack-list top-gap">
            {draft.routeStops.filter((stop) => !stop.picked).map((stop, index) => <article className="list-card" key={`${task.id}-route-${stop.orderId}`}>
              <div>
                <strong>{liveStopLabel(stop)}</strong>
                <p>{liveStopLocation(stop)}</p>
                <div className="payment-meta-grid">
                  <div><span className="small-label">SO</span><strong>{stop.orderId}</strong></div>
                  <div><span className="small-label">Approx km</span><strong>{approxDistanceKmFromCurrent(stop)?.toFixed(1) || "Pending"}</strong></div>
                  <div><span className="small-label">Contact</span><strong>{liveStopContact(stop)}</strong></div>
                  <div><span className="small-label">Selected</span><strong>{index === 0 ? "Yes" : "No"}</strong></div>
                </div>
                <p>{stop.productSummary}</p>
              </div>
              {index !== 0 ? <div className="payment-card-actions top-gap"><button className="ghost-button" type="button" onClick={() => moveStopToFront(task.id, task, stop.orderId)}>{task.side === "Sales" ? "Choose this customer first" : "Choose this vendor first"}</button></div> : null}
            </article>)}
          </div>
          {!currentStopStarted ? <div className="payment-card-actions top-gap">
            <button className="primary-button" type="button" onClick={() => setStartedStops((current) => ({ ...current, [startKey]: true }))}>Start</button>
          </div> : <div className="payment-card-actions top-gap">
            {progressMapUrl ? <a className="primary-button" href={progressMapUrl} target="_blank" rel="noreferrer">Open map</a> : null}
            <button className="ghost-button" type="button" disabled={!canMarkStop(nextStop)} onClick={() => updateStopDraft(task.id, task, nextStop.orderId, { reached: true })}>Reached</button>
          </div>}
        </article> : null}
        {!allPicked && nextStop && nextStop.reached && !nextStop.checked ? <article className="list-card top-gap">
          <strong>{liveStopLabel(nextStop)}</strong>
          <p>{stopEntityLabel(nextStop)} stop {nextStop.orderId}. Select each product after checking it.</p>
          <div className="stack-list top-gap">
            {itemChecks.map((item, index) => <label className="checkbox-line" key={`${item.label}-${index}`}>
              <input type="checkbox" checked={Boolean(checkedItems[index])} onChange={(e) => {
                const nextValues = [...checkedItems];
                nextValues[index] = e.target.checked;
                setCheckedItems(nextValues);
              }} />{item.label} x {item.quantity}
            </label>)}
          </div>
          <div className="payment-card-actions top-gap">
            <button className="primary-button" type="button" disabled={itemChecks.length > 0 && checkedItems.some((value) => !value)} onClick={() => updateStopDraft(task.id, task, nextStop.orderId, { checked: true })}>Checked</button>
          </div>
        </article> : null}
        {!allPicked && nextStop && nextStop.checked && nextStop.paymentRequired && nextStop.paymentMode === "Cash" && !nextStop.paid ? <article className="list-card top-gap">
          <strong>Cash payment</strong>
          <p>{liveStopLabel(nextStop)} | {nextStop.orderId}</p>
          <div className="payment-meta-grid">
            <div><span className="small-label">Amount</span><strong>{nextStop.amountToPay.toFixed(2)}</strong></div>
            <div><span className="small-label">Ref</span><strong>{nextStop.paymentReference || "Pending"}</strong></div>
          </div>
          <div className="form-grid top-gap">
            <label>Reference / UTR<input value={nextStop.paymentReference || ""} onChange={(e) => updateStopDraft(task.id, task, nextStop.orderId, { paymentReference: e.target.value })} /></label>
            <label>Cash proof<input type="file" accept="image/*,.pdf" onChange={(e) => void uploadStopPaymentProof(task.id, task, nextStop.orderId, e.target.files?.[0] || null)} /></label>
            <label className="wide-field">Proof name<input value={nextStop.paymentProofName || ""} onChange={(e) => updateStopDraft(task.id, task, nextStop.orderId, { paymentProofName: e.target.value })} /></label>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="primary-button" type="button" disabled={!nextStop.paymentProofName} onClick={async () => {
              const routeStops = draft.routeStops.map((stop) => stop.orderId === nextStop.orderId ? { ...stop, paid: true } : stop);
              await onUpdateTask(task.id, {
                linkedOrderIds: task.linkedOrderIds,
                assignedTo: task.assignedTo,
                routeStops,
                pickupAt: task.pickupAt,
                dropAt: task.dropAt,
                routeHint: draft.routeHint,
                paymentAction: task.paymentAction,
                status: draft.status,
                cashCollectionRequired: task.cashCollectionRequired,
                cashHandoverMarked: routeStops.some((stop) => stop.paid),
                weightProofName: draft.weightProofName || undefined,
                cashProofName: draft.cashProofName || undefined,
                lastActionAt: new Date().toISOString()
              });
              setDrafts((current) => ({
                ...current,
                [task.id]: {
                  ...draft,
                  routeStops,
                  cashHandoverMarked: routeStops.some((stop) => stop.paid)
                }
              }));
            }}>Mark paid</button>
          </div>
        </article> : null}
        {!allPicked && nextStop && nextStop.checked && (!nextStop.paymentRequired || nextStop.paymentMode !== "Cash" || nextStop.paid) ? <article className="list-card top-gap">
          <strong>{task.side === "Sales" ? "Complete handover" : "Complete pickup"}</strong>
          <p>{liveStopLabel(nextStop)} | {nextStop.orderId}</p>
          <div className="payment-meta-grid">
            <div><span className="small-label">Items</span><strong>{nextStop.productSummary}</strong></div>
            <div><span className="small-label">Payment</span><strong>{nextStop.paymentRequired ? (nextStop.paymentMode === "Cash" ? "Cash paid" : nextStop.paymentReference || "Reference payment") : "No payment"}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            <button className="primary-button" type="button" onClick={() => updateStopDraft(task.id, task, nextStop.orderId, { picked: true })}>{task.side === "Sales" ? "Goods handed over" : "Next"}</button>
          </div>
        </article> : null}
        {allPicked ? <article className="list-card top-gap">
          <strong>Vehicle summary</strong>
          <p>{task.side === "Sales" ? "All delivery stops are completed. Finish the trip to mark the customer handover done." : "All vendor pickups completed."}</p>
          <div className="payment-meta-grid">
            <div><span className="small-label">Stops</span><strong>{completedStops.length}</strong></div>
            <div><span className="small-label">Total qty</span><strong>{totalQty}</strong></div>
          </div>
          <div className="payment-card-actions top-gap">
            {progressMapUrl ? <a className="primary-button" href={progressMapUrl} target="_blank" rel="noreferrer">{task.side === "Sales" ? "Open route map" : "Return to warehouse"}</a> : null}
            {task.side === "Sales" ? <button className="ghost-button" type="button" onClick={async () => {
              await onUpdateTask(task.id, {
                linkedOrderIds: task.linkedOrderIds,
                assignedTo: task.assignedTo,
                routeStops: draft.routeStops,
                pickupAt: task.pickupAt,
                dropAt: task.dropAt,
                routeHint: draft.routeHint,
                paymentAction: task.paymentAction,
                status: "Delivered",
                cashCollectionRequired: task.cashCollectionRequired,
                cashHandoverMarked: draft.cashHandoverMarked,
                weightProofName: draft.weightProofName || undefined,
                cashProofName: draft.cashProofName || undefined,
                lastActionAt: new Date().toISOString()
              });
              setDrafts((current) => ({
                ...current,
                [task.id]: {
                  ...draft,
                  status: "Delivered"
                }
              }));
              setStartedStops((current) => {
                const nextState = { ...current };
                Object.keys(nextState).filter((key) => key.startsWith(`${task.id}-`)).forEach((key) => {
                  delete nextState[key];
                });
                return nextState;
              });
            }}>Mark customer handover done</button> : draft.status !== "Handed Over" ? <button className="ghost-button" type="button" onClick={async () => {
              await onUpdateTask(task.id, {
                linkedOrderIds: task.linkedOrderIds,
                assignedTo: task.assignedTo,
                routeStops: draft.routeStops,
                pickupAt: task.pickupAt,
                dropAt: task.dropAt,
                routeHint: draft.routeHint,
                paymentAction: task.paymentAction,
                status: "Handed Over",
                cashCollectionRequired: task.cashCollectionRequired,
                cashHandoverMarked: draft.cashHandoverMarked,
                weightProofName: draft.weightProofName || undefined,
                cashProofName: draft.cashProofName || undefined,
                lastActionAt: new Date().toISOString()
              });
              setDrafts((current) => ({
                ...current,
                [task.id]: {
                  ...draft,
                  status: "Handed Over"
                }
              }));
              setStartedStops((current) => {
                const nextState = { ...current };
                Object.keys(nextState).filter((key) => key.startsWith(`${task.id}-`)).forEach((key) => {
                  delete nextState[key];
                });
                return nextState;
              });
            }}>Submit to warehouse</button> : null}
          </div>
        </article> : null}
        {completedStops.length > 0 ? <div className="stack-list top-gap">
          {completedStops.map((stop) => <article className="list-card" key={`${task.id}-${stop.orderId}-done`}>
            <strong>{liveStopLabel(stop)}</strong>
            <p>{stop.orderId} | {stop.productSummary}</p>
          </article>)}
        </div> : null}
        {routeMapUrl || weightUrl || cashUrl ? <div className="payment-card-actions wide-field top-gap">
          {routeMapUrl ? <a className="ghost-button" href={routeMapUrl} target="_blank" rel="noreferrer">Open route map</a> : null}
          {weightUrl ? <a className="ghost-button" href={weightUrl} target="_blank" rel="noreferrer">Weight proof</a> : null}
          {cashUrl ? <a className="ghost-button" href={cashUrl} target="_blank" rel="noreferrer">Cash proof</a> : null}
        </div> : null}
      </>}
    </article>;
  }

  return (
    <section className="dashboard-grid">
      <Panel title="My Delivery Jobs" eyebrow="Step by step">
        <div className="payment-card-actions">
          <button className="ghost-button" type="button" onClick={() => navigator.geolocation.getCurrentPosition((position) => setCurrentPosition({ latitude: position.coords.latitude, longitude: position.coords.longitude }))}>Use my location</button>
          {currentPosition ? <span className="small-label">{currentPosition.latitude.toFixed(4)}, {currentPosition.longitude.toFixed(4)}</span> : null}
        </div>
        <div className="stack-list payment-update-list">
          {deliveryTab === "current"
            ? (currentAssignments.length > 0 ? currentAssignments.map((task) => renderTask(task)) : <div className="empty-card">No current active delivery. Start from New Assignment.</div>)
            : (newAssignments.length === 0 ? <div className="empty-card">No new assignments.</div> : newAssignments.map((task) => renderTask(task, true)))}
        </div>
      </Panel>
      {showInternalTabs ? <div className="delivery-module-tab-bar">
        <button className={deliveryTab === "current" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryTab("current")}><LabelWithBadge label="Current Delivery" count={currentAssignments.length} /></button>
        <button className={deliveryTab === "new" ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryTab("new")}><LabelWithBadge label="New Assignment" count={newAssignments.length} /></button>
      </div> : null}
    </section>
  );
}

export function WarehouseDeliveryBoard({ snapshot }: { snapshot: AppSnapshot }) {
  const [side, setSide] = useState<"Purchase" | "Sales">("Purchase");
  const inboundCount = snapshot.deliveryTasks.filter((task) => task.side === "Purchase" && isDeliveryTaskPending(task)).length;
  const outboundCount = snapshot.deliveryTasks.filter((task) => task.side === "Sales" && isDeliveryTaskPending(task)).length;
  const tasks = snapshot.deliveryTasks
    .filter((task) => task.side === side)
    .sort((left, right) => `${left.from} ${left.to}`.localeCompare(`${right.from} ${right.to}`, "en-IN"));

  return (
    <section className="dashboard-grid">
      <Panel title="Delivery" eyebrow="Tracking">
        <div className="segmented-tabs">
          <button className={side === "Purchase" ? "tab-button active" : "tab-button"} type="button" onClick={() => setSide("Purchase")}><LabelWithBadge label="In" count={inboundCount} /></button>
          <button className={side === "Sales" ? "tab-button active" : "tab-button"} type="button" onClick={() => setSide("Sales")}><LabelWithBadge label="Out" count={outboundCount} /></button>
        </div>
      </Panel>
      <Panel title={side === "Purchase" ? "Inbound Tracking" : "Outbound Tracking"} eyebrow="Sorted by route">
        <div className="stack-list payment-update-list">
          {tasks.length === 0 ? <div className="empty-card">No delivery tasks found.</div> : tasks.map((task) => (
            <article className="list-card payment-update-card" key={task.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{task.id}</strong>
                  <p>{task.from} · {task.to}</p>
                </div>
                <span className="status-pill status-pending">{deliveryTaskStatusLabel(task)}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Orders</span><strong>{task.linkedOrderIds.join(", ")}</strong></div>
                <div><span className="small-label">Assigned</span><strong>{task.assignedTo}</strong></div>
                <div><span className="small-label">Mode</span><strong>{task.mode}</strong></div>
                <div><span className="small-label">Payment</span><strong>{task.paymentAction}</strong></div>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </section>
  );
}

export function DeliveryManagerHome({
  snapshot,
  warehouses,
  warehousePendingCounts,
  selectedWarehouseId,
  onSelectWarehouse,
  onUpdateTask,
  onFlagTask,
  onOpenReceive,
  onOpenDispatch
}: {
  snapshot: AppSnapshot;
  warehouses: AppSnapshot["warehouses"];
  warehousePendingCounts: Map<string, number>;
  selectedWarehouseId: string;
  onSelectWarehouse: (warehouseId: string) => void;
  onUpdateTask: (id: string, body: {
    linkedOrderIds: string[];
    consignmentId?: string;
    assignedTo: string;
    transportType?: DeliveryTask["transportType"];
    vehicleNumber?: string;
    freightAmount?: number;
    routeStops?: DeliveryTask["routeStops"];
    pickupAt?: string;
    dropAt?: string;
    routeHint?: string;
    paymentAction: DeliveryTask["paymentAction"];
    status: DeliveryTask["status"];
    cashCollectionRequired: boolean;
    cashHandoverMarked?: boolean;
    weightProofName?: string;
    cashProofName?: string;
    lastActionAt?: string;
  }) => Promise<boolean | void>;
  onFlagTask: (task: DeliveryTask, note: string) => Promise<boolean | void>;
  onOpenReceive: () => void;
  onOpenDispatch: () => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, { status: DeliveryTask["status"]; flagType: string; note: string }>>({});
  const notesByDelivery = new Map<string, NoteRecord[]>();
  snapshot.notes.filter((note) => note.entityType === "Delivery").forEach((note) => {
    notesByDelivery.set(note.entityId, [...(notesByDelivery.get(note.entityId) || []), note]);
  });
  const nowMs = Date.now();
  const activeTasks = snapshot.deliveryTasks.filter(isDeliveryTaskPending);
  const inboundPendingCount = countGroupedOrders(snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed"));
  const dispatchPendingCount = countGroupedOrders(snapshot.salesOrders.filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Pending Pickup" || item.status === "Out for Delivery" || item.status === "Self Pickup"));
  const flaggedTaskIds = new Set(snapshot.notes.filter((note) => note.entityType === "Delivery" && note.note.toLowerCase().includes("flag")).map((note) => note.entityId));
  const priority = (task: DeliveryTask) => {
    const ageHours = (nowMs - new Date(task.lastActionAt || task.createdAt).getTime()) / 36e5;
    if (flaggedTaskIds.has(task.id)) return 0;
    if (ageHours >= 24) return 1;
    if (task.paymentAction !== "None" && task.cashCollectionRequired && !task.cashHandoverMarked) return 2;
    if (task.status === "Planned") return 3;
    if (task.status === "Picked") return 4;
    if (task.status === "Handed Over") return 5;
    return 6;
  };
  const sortedTasks = [...snapshot.deliveryTasks].sort((left, right) =>
    priority(left) - priority(right)
    || new Date(left.lastActionAt || left.createdAt).getTime() - new Date(right.lastActionAt || right.createdAt).getTime()
  );
  const dashboardTasks = sortedTasks.slice(0, 12);

  function draftFor(task: DeliveryTask) {
    return drafts[task.id] || { status: task.status, flagType: "Delay", note: "" };
  }

  function ageLabel(task: DeliveryTask) {
    const actionAt = task.lastActionAt || task.createdAt;
    const hours = Math.max(0, Math.floor((nowMs - new Date(actionAt).getTime()) / 36e5));
    if (hours < 1) return "Just now";
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function taskStatusClass(task: DeliveryTask) {
    if (flaggedTaskIds.has(task.id)) return "status-rejected";
    if (task.status === "Delivered") return "status-verified";
    if (priority(task) <= 2) return "status-rejected";
    return "status-pending";
  }

  function taskRoute(task: DeliveryTask) {
    if (task.routeStops.length > 0) return `${task.routeStops.length} stop(s)`;
    return [task.from, task.to].filter(Boolean).join(" -> ") || "Route pending";
  }

  async function updateTaskStatus(task: DeliveryTask) {
    const draft = draftFor(task);
    await onUpdateTask(task.id, {
      linkedOrderIds: task.linkedOrderIds,
      consignmentId: task.consignmentId,
      assignedTo: task.assignedTo,
      routeStops: task.routeStops,
      pickupAt: task.pickupAt,
      dropAt: task.dropAt,
      routeHint: task.routeHint,
      paymentAction: task.paymentAction,
      status: draft.status,
      cashCollectionRequired: task.cashCollectionRequired,
      cashHandoverMarked: task.cashHandoverMarked,
      weightProofName: task.weightProofName,
      cashProofName: task.cashProofName,
      lastActionAt: new Date().toISOString()
    });
  }

  async function flagTask(task: DeliveryTask) {
    const draft = draftFor(task);
    const note = [`FLAG: ${draft.flagType}`, draft.note.trim()].filter(Boolean).join(" - ");
    if (!note) return;
    await onFlagTask(task, note);
    setDrafts((current) => ({ ...current, [task.id]: { ...draft, note: "" } }));
  }

  return (
    <section className="dashboard-grid">
      <Panel title="Delivery Home" eyebrow="Urgent first">
        <div className="segmented-tabs">
          {warehouses.map((warehouse) => (
            <button key={warehouse.id} className={selectedWarehouseId === warehouse.id ? "tab-button active" : "tab-button"} type="button" onClick={() => onSelectWarehouse(warehouse.id)}>
              <LabelWithBadge label={warehouse.name.replace(/\s+(warehouse|yard)$/i, "")} count={warehousePendingCounts.get(warehouse.id) || 0} />
            </button>
          ))}
        </div>
        <div className="simple-summary payment-summary-grid">
          <div className="list-card"><div><strong>{activeTasks.length}</strong><p>Live deliveries</p></div></div>
          <div className="list-card"><div><strong>{activeTasks.filter((task) => task.side === "Purchase").length}</strong><p>Inbound routes</p></div></div>
          <div className="list-card"><div><strong>{activeTasks.filter((task) => task.side === "Sales").length}</strong><p>Dispatch side</p></div></div>
          <div className="list-card"><div><strong>{flaggedTaskIds.size}</strong><p>Flagged notes</p></div></div>
        </div>
        <div className="payment-card-actions top-gap">
          <button className="ghost-button" type="button" onClick={onOpenReceive}><LabelWithBadge label="Open inbound routing" count={inboundPendingCount} /></button>
          <button className="ghost-button" type="button" onClick={onOpenDispatch}><LabelWithBadge label="Open dispatch" count={dispatchPendingCount} /></button>
        </div>
      </Panel>
      <Panel title="Delivery Status" eyebrow="Sorted by time and flags">
        <div className="stack-list payment-update-list">
          {dashboardTasks.length === 0 ? <div className="empty-card">No delivery activity yet.</div> : dashboardTasks.map((task) => {
            const draft = draftFor(task);
            const latestNote = notesByDelivery.get(task.id)?.[0];
            return (
              <article className="list-card payment-update-card delivery-status-card" key={task.id}>
                <div className="payment-update-head">
                  <div>
                    <strong>{task.id}</strong>
                    <p>{task.side} | {task.linkedOrderIds.join(", ")} | {taskRoute(task)}</p>
                  </div>
                  <span className={`status-pill ${taskStatusClass(task)}`}>{deliveryTaskStatusLabel(task)}</span>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Last action</span><strong>{ageLabel(task)}</strong></div>
                  <div><span className="small-label">Assigned</span><strong>{task.assignedTo || "Not assigned"}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{task.paymentAction}{task.cashCollectionRequired ? " / Cash" : ""}</strong></div>
                  <div><span className="small-label">Mode</span><strong>{task.mode}</strong></div>
                </div>
                {latestNote ? <p className="message error">Latest flag: {latestNote.note}</p> : null}
                <div className="cart-edit-grid">
                  <label>Status<select value={draft.status} onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, status: event.target.value as DeliveryTask["status"] } }))}><option value="Planned">{task.side === "Sales" ? "Assigned, accept pending" : "Pickup assigned"}</option><option value="Picked">{task.side === "Sales" ? "Accepted, reach warehouse" : "Picked from supplier"}</option><option value="Handed Over">{task.side === "Sales" ? "Picked from warehouse" : "Handed to warehouse"}</option><option value="Delivered">Delivered</option></select></label>
                  <label>Flag<select value={draft.flagType} onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, flagType: event.target.value } }))}><option>Delay</option><option>Payment issue</option><option>Route issue</option><option>Vehicle issue</option><option>Customer issue</option><option>Warehouse issue</option></select></label>
                  <label className="wide-field">Flag note<input value={draft.note} onChange={(event) => setDrafts((current) => ({ ...current, [task.id]: { ...draft, note: event.target.value } }))} placeholder="Write issue or update for this delivery" /></label>
                </div>
                <div className="payment-card-actions top-gap">
                  <button className="primary-button" type="button" onClick={() => void updateTaskStatus(task)}>Update status</button>
                  <button className="ghost-button danger-button" type="button" onClick={() => void flagTask(task)}>Flag issue</button>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>
    </section>
  );
}
