import { ACTIVE_VIEW_KEY, API_BASE, COMPANY_GST_NUMBER, DELIVERY_MANAGER_WAREHOUSE_KEY, GstRateInput, InvoicePdfConfig, InvoicePdfRow, OrderQrCard, OrderQrTarget, OrderStatusAccess, OrderStatusOverlay, OrderStatusSummary, QrScanOverlay, SESSION_KEY, SIDEBAR_COLLAPSED_KEY, TOKEN_KEY, TaxModeInput, ViewKey, WORKSPACE_DRAFT_KEY, addOneMonthForVoucherPreview, api, assignedDeliveryUsers, browserOriginFallback, buildDailySalesReportPdf, buildInvoicePdfBlob, buildOrderQrToken, buildOrderStatusPdf, buildOrderStatusSummary, buildOrderStatusUrl, buildPurchaseInvoicePdf, buildSalesInvoicePdf, buildTablePdfBlob, calculateTaxPreview, clearOrderQrTargetFromLocation, clearSessionState, collectionAssignment, collectionVisibleToUser, configuredApiBase, consignmentExportHeaders, consignmentExportRows, copyTextToClipboard, countGroupedOrders, dailySalesCollectorLabel, dateKeyInRange, dateRangeFileToken, deliveryConsignmentStatusLabel, deliveryDocketStatusLabel, deliverySideForUser, deliveryTaskExportHeaders, deliveryTaskExportRows, deliveryTaskStatusLabel, deliveryTasksForUser, displayLabel, displayOrderNote, distanceKmBetween, docketExportHeaders, docketExportRows, downloadBlobFile, downloadCsvFile, downloadDailySalesReportPdf, downloadDataUrlFile, downloadHomeDailySalesReportPdf, downloadPurchaseInvoicePdf, downloadReportCsv, downloadReportPdf, downloadSalesInvoicePdf, escapeHtml, escapeXml, findPurchaseOrderByPublicId, findSalesOrderByPublicId, formatChequeAmountWords, formatCurrencyInr, formatDateIst, formatDateTimeIst, formatLongDateIst, formatMoney, formatShortDate, formatShortNumber, formatWeightKg, getVisibleViews, getVisibleViewsForMode, goodsWarrantOutlets, groupNewestCreatedAt, groupOldestCreatedAt, groupPurchaseOrders, groupPurchaseRows, groupSalesCashTiming, groupSalesOrders, groupSalesRows, gstBillTypeLabel, gstRateExportValue, homeTaskCards, inboundOpsExportHeaders, inboundOpsExportRows, indiaDateKey, indiaYesterdayDateKey, invoiceValue, isDeliveryExecutive, isDeliveryTaskPending, isInboundDeliveryUser, isOpenPurchaseOrder, isOpenSalesOrder, isOutboundDeliveryUser, isUserAssignedToDelivery, isWarehouseScoped, labels, latestPurchasePayment, latestSalesPayment, mapsDirectionsUrl, nearestNeighborOrder, normalizeDateRange, numberToIndianWords, numberToWordsUnder1000, openChequePrintWindow, orderPublicId, orderQrShortLabel, orderStatusAccess, outboundOpsExportHeaders, outboundOpsExportRows, parseOrderQrValue, preferredSimpleMode, preferredWarehouseId, printInvoiceDocument, printPurchaseInvoice, printSalesInvoice, prioritizeWarehouseIds, productNameBySku, productNamesSummary, purchaseCartDraftSignature, purchaseCartEditState, purchaseCashDeliveryTask, purchaseDeliveryStatus, purchaseDeliveryTask, purchaseInvoiceCounterparty, purchaseInvoiceHtml, purchaseInvoiceWhatsappText, purchaseLedgerByOrder, purchaseNeedsInternalPickup, purchaseOrderExportHeaders, purchaseOrderExportRows, purchaseOrderPublicTotal, purchasePaymentExportHeaders, purchasePaymentExportRows, purchasePaymentStatus, purchasePaymentsByOrder, purchaseWarehouseStatus, purchaseWorkflowStatus, readOrderQrTargetFromLocation, readStoredJson, returnReasons, roleViews, safeDateToken, safePdfFileName, salesCollectionEligibleForAgent, salesCollectionExportHeaders, salesCollectionExportRows, salesCollectionHandledByDelivery, salesDeliveryStatus, salesDeliveryTask, salesFulfillmentStatus, salesInvoiceCounterparty, salesInvoiceHtml, salesInvoiceWeightKg, salesInvoiceWhatsappText, salesLineCdAmount, salesLineTodAmount, salesLineUnitWeightKg, salesLineWeightKg, salesOrderDraftSignature, salesOrderEditState, salesOrderExportHeaders, salesOrderExportRows, salesOrderPublicTotal, salesPaymentStatus, salesPaymentsByOrder, salesStatusLabel, scopedDailySalesOrders, shareInvoicePdfFile, sharePurchaseInvoicePdf, shareSalesInvoicePdf, shouldForceSimpleMode, simpleRoleViews, snapshotForWarehouse, snapshotForWarehouseScope, sortCounterpartiesAlphabetically, statusPillClass, subtractOneDayFromNextMonth, toCsvValue, userHasAnyRole, userRoleList, userWarehouseScope, workspaceStorageKey, writeStoredJson } from "./app/shared";
import type { CatalogOrderViewProps } from "./features/catalog/CatalogOrderView";
import { renderOptions } from "./app/formOptions";
import axios from "axios";
import { createPortal } from "react-dom";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { SidebarVectorIcon } from "./components/navigation";
import { CollapsiblePanel, DataTable, LabelWithBadge, MetricCard, Panel, PendingBadge, TwoCol } from "./components/ui";
import appLogo from "./assets/group60.svg";
import type {
  AppSnapshot,
  AppUser,
  Counterparty,
  DeliveryConsignment,
  DeliveryDocket,
  DeliveryTask,
  CashTiming,
  GoodsWarrantOutlet,
  GoodsWarrantPaymentMode,
  GoodsWarrantRecord,
  NoteRecord,
  PaymentRecord,
  PaymentMode,
  PurchaseOrder,
  PurchaseReturn,
  SalesOrder,
  SalesReturn,
  SalesStatus,
  GstRate,
  TaxMode,
  UserRole
} from "@aapoorti-b2b/domain";
import { inferProductWeightKg, productWeightSearchText, userRoles } from "@aapoorti-b2b/domain";

const CatalogOrderView = lazy(() => import("./features/catalog/CatalogOrderView").then((module) => ({ default: module.CatalogOrderView })));
const PurchaserPurchaseSummary = lazy(() => import("./features/purchases/PurchaseViews").then((module) => ({ default: module.PurchaserPurchaseSummary })));
const PurchaserPurchaseWorkspace = lazy(() => import("./features/purchases/PurchaseViews").then((module) => ({ default: module.PurchaserPurchaseWorkspace })));
const SalesOrderEditor = lazy(() => import("./features/sales/SalesOrderViews").then((module) => ({ default: module.SalesOrderEditor })));
const SalesOrderSummary = lazy(() => import("./features/sales/SalesOrderViews").then((module) => ({ default: module.SalesOrderSummary })));
const AccountsPaymentsView = lazy(() => import("./features/payments/PaymentViews").then((module) => ({ default: module.AccountsPaymentsView })));
const PurchaserPaymentsView = lazy(() => import("./features/payments/PaymentViews").then((module) => ({ default: module.PurchaserPaymentsView })));
const SalesPaymentsView = lazy(() => import("./features/payments/PaymentViews").then((module) => ({ default: module.SalesPaymentsView })));
const DeliveryJobsView = lazy(() => import("./features/operations/OperationsViews").then((module) => ({ default: module.DeliveryJobsView })));
const DeliveryManagerHome = lazy(() => import("./features/operations/OperationsViews").then((module) => ({ default: module.DeliveryManagerHome })));
const WarehouseDeliveryBoard = lazy(() => import("./features/operations/OperationsViews").then((module) => ({ default: module.WarehouseDeliveryBoard })));
const WarehouseOperationsViewV2 = lazy(() => import("./features/operations/OperationsViews").then((module) => ({ default: module.WarehouseOperationsViewV2 })));
const AccountsLedgerWorkspace = lazy(() => import("./features/accounts/AccountViews").then((module) => ({ default: module.AccountsLedgerWorkspace })));
const Overview = lazy(() => import("./features/accounts/AccountViews").then((module) => ({ default: module.Overview })));
const AnalystInventoryView = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.AnalystInventoryView })));
const AnalystPurchaseView = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.AnalystPurchaseView })));
const AnalystSalesView = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.AnalystSalesView })));
const GoodsWarrantView = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.GoodsWarrantView })));
const PartyVitalsList = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.PartyVitalsList })));
const ProductAdminView = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.ProductAdminView })));
const ReturnsWorkspace = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.ReturnsWorkspace })));
const StandaloneExcelMaker = lazy(() => import("./features/admin/AdminAndSupportViews").then((module) => ({ default: module.StandaloneExcelMaker })));

function BootLoader() {
  return (
    <main className="boot-loader-shell">
      <header className="boot-loader-header glass-surface">
        <div className="topbar-brand-block"><span className="small-label">Aapoorti B2B</span><strong>Workspace Restore</strong></div>
        <div className="topbar-logo-orb boot-topbar-logo"><img src={appLogo} alt="Aapoorti" className="topbar-logo-image" /></div>
        <div className="topbar-side-slot"><span className="boot-loader-chip">Syncing</span></div>
      </header>
      <section className="boot-loader-card">
        <div className="boot-loader-mark" aria-hidden="true"><span /><span /><span /></div>
        <div className="boot-loader-copy"><span className="eyebrow">Aapoorti B2B</span><h1>Restoring workspace</h1><p>Loading your module, live orders, parties, stock, and delivery state.</p></div>
        <div className="boot-loader-track"><span /></div>
      </section>
      <footer className="boot-loader-footer">Powered by OPAS</footer>
    </main>
  );
}

function App() {
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const [sessionToken, setSessionToken] = useState("");
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("Overview");
  const [bootstrapping, setBootstrapping] = useState(true);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [simpleMode, setSimpleMode] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [deliveryManagerScreen, setDeliveryManagerScreen] = useState<"home" | "in" | "out">("home");
  const [deliveryManagerWarehouseId, setDeliveryManagerWarehouseId] = useState("");
  const [login, setLogin] = useState({ username: "", password: "" });

  const [userForm, setUserForm] = useState({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"] as UserRole[], warehouseIds: [] as string[], password: "1234" });
  const [warehouseForm, setWarehouseForm] = useState({ id: "", name: "", city: "Bhopal", address: "", type: "Warehouse" as "Warehouse" | "Yard" });
  const [productForm, setProductForm] = useState({ sku: "", name: "", division: "", department: "", section: "", category: "", subCategory: "", unit: "", defaultGstRate: "0" as GstRateInput, defaultTaxMode: "Exclusive" as TaxModeInput, defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "1", allowedWarehouseIds: [] as string[] });
  const [bulkCsv, setBulkCsv] = useState("sku,name,division,department,section,category,subCategory,unit,defaultGstRate,defaultTaxMode,defaultWeightKg,toleranceKg,tolerancePercent,allowedWarehouseIds,rsp");
  const [bulkCsvFile, setBulkCsvFile] = useState<File | null>(null);
  const [partyForm, setPartyForm] = useState({ type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" });
  const [partyFormErrors, setPartyFormErrors] = useState({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
  const [purchaseForm, setPurchaseForm] = useState({ supplierId: "", productSku: "", warehouseId: "", quantityOrdered: "0", rate: "0", previousRate: "0", taxableAmount: "0", gstRate: "0" as GstRateInput, gstAmount: "0", taxMode: "Exclusive" as TaxModeInput, deliveryMode: "" as "Dealer Delivery" | "Self Collection" | "", paymentMode: "" as PaymentMode | "", cashTiming: "", note: "", locationAddress: "", locationCity: "", location: null as null | { latitude: number; longitude: number; label?: string; address?: string; city?: string } });
  const [purchaseEditForm, setPurchaseEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Dealer Delivery" as "Dealer Delivery" | "Self Collection", note: "", status: "Order Placed - Pending Delivery" });
  const [salesForm, setSalesForm] = useState({ shopId: "", billingType: "" as "" | "B2B" | "B2C", productSku: "", warehouseId: "", quantity: "0", rate: "0", taxableAmount: "0", gstRate: "0" as GstRateInput, gstAmount: "0", taxMode: "Exclusive" as TaxModeInput, paymentMode: "" as PaymentMode | "", cashTiming: "", deliveryMode: "" as "Self Collection" | "Delivery" | "", note: "", priceApprovalRequested: false, minimumAllowedRate: "0", stockApprovalRequested: false, availableStockAtOrder: "0", locationAddress: "", locationCity: "", location: null as null | { latitude: number; longitude: number; label?: string; address?: string; city?: string } });
  const [salesEditForm, setSalesEditForm] = useState({ id: "", rate: "0", paymentMode: "Cash" as PaymentMode, cashTiming: "", deliveryMode: "Delivery" as "Self Collection" | "Delivery", note: "", status: "Booked" });
  const [paymentForm, setPaymentForm] = useState({ side: "Purchase" as "Purchase" | "Sales", linkedOrderId: "", amount: "0", mode: "NEFT" as PaymentMode, cashTiming: "", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved", verificationNote: "" });
  const [paymentProofFile, setPaymentProofFile] = useState<File | null>(null);
  const [paymentEditForm, setPaymentEditForm] = useState({ id: "", amount: "0", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "", verificationStatus: "Submitted" as "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved", verificationNote: "" });
  const [receiptForm, setReceiptForm] = useState({ purchaseOrderId: "", warehouseId: "", receivedQuantity: "0", actualWeightKg: "0", note: "", confirmPartial: false });
  const [receiptEditForm, setReceiptEditForm] = useState({ grcNumber: "", note: "", flagged: false });
  const [deliveryForm, setDeliveryForm] = useState({ side: "Purchase" as DeliveryTask["side"], linkedOrderIdsText: "", mode: "Dealer Delivery" as DeliveryTask["mode"], transportType: "Internal" as DeliveryTask["transportType"], vehicleNumber: "", freightAmount: "0", from: "", to: "", assignedTo: "", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [deliveryEditForm, setDeliveryEditForm] = useState({ id: "", linkedOrderIdsText: "", assignedTo: "", transportType: "Internal" as DeliveryTask["transportType"], vehicleNumber: "", freightAmount: "0", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None" as DeliveryTask["paymentAction"], cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" as DeliveryTask["status"] });
  const [partyEditForm, setPartyEditForm] = useState({ id: "", type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" });
  const [noteForm, setNoteForm] = useState({ entityType: "Purchase Order" as NoteRecord["entityType"], entityId: "", note: "", visibility: "Operational" as NoteRecord["visibility"] });
  const [openPartyPanel, setOpenPartyPanel] = useState("register");
  const [accountsPartySearch, setAccountsPartySearch] = useState("");
  const [accountsPartyUpdateId, setAccountsPartyUpdateId] = useState("");
  const [accountsPartyPaymentId, setAccountsPartyPaymentId] = useState("");
  const [accountsPartyPaymentForm, setAccountsPartyPaymentForm] = useState({
    partyId: "",
    linkedOrderId: "",
    amount: "0",
    mode: "NEFT" as PaymentMode,
    cashTiming: "In Hand",
    referenceNumber: "",
    voucherNumber: "",
    utrNumber: "",
    verificationNote: "Supplier payment recorded by accounts",
    operationDate: indiaDateKey()
  });
  const [purchaseUpdateOrderId, setPurchaseUpdateOrderId] = useState("");
  const [purchaseEditorDirty, setPurchaseEditorDirty] = useState(false);
  const [salesUpdateOrderId, setSalesUpdateOrderId] = useState("");
  const [salesEditorDirty, setSalesEditorDirty] = useState(false);
  const [scanOverlayOpen, setScanOverlayOpen] = useState(false);
  const [orderStatusTarget, setOrderStatusTarget] = useState<OrderQrTarget | null>(null);
  const [pendingQrTarget, setPendingQrTarget] = useState<OrderQrTarget | null>(() => readOrderQrTargetFromLocation());
  const [purchaseCatalogSearchToken, setPurchaseCatalogSearchToken] = useState(0);
  const [salesCatalogSearchToken, setSalesCatalogSearchToken] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  });
  const emptyPartyCreateForm = { type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" };
  const emptyPartyEditForm = { id: "", type: "Supplier" as "Supplier" | "Shop", name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" };

  useEffect(() => {
    const stored = window.localStorage.getItem(SESSION_KEY);
    const token = window.localStorage.getItem(TOKEN_KEY) || "";
    if (!stored || !token) {
      setBootstrapping(false);
      return;
    }
    try {
      const user = JSON.parse(stored) as AppUser;
      const workspace = readStoredJson(workspaceStorageKey(user.id, "app"), {} as Record<string, unknown>);
      const preferredMode = preferredSimpleMode(user);
      const visible = getVisibleViewsForMode(user, preferredMode);
      const storedView = (workspace.activeView as ViewKey | undefined) || (window.localStorage.getItem(ACTIVE_VIEW_KEY) as ViewKey | null);
      const storedDeliveryManagerWarehouseId = window.localStorage.getItem(DELIVERY_MANAGER_WAREHOUSE_KEY) || "";
      setCurrentUser(user);
      setSessionToken(token);
      setSimpleMode(workspace.simpleMode !== undefined ? Boolean(workspace.simpleMode) : preferredMode);
      if (typeof workspace.deliveryManagerScreen === "string") setDeliveryManagerScreen(workspace.deliveryManagerScreen as "home" | "in" | "out");
      setDeliveryManagerWarehouseId((workspace.deliveryManagerWarehouseId as string | undefined) || storedDeliveryManagerWarehouseId);
      if (workspace.purchaseForm) setPurchaseForm(workspace.purchaseForm as typeof purchaseForm);
      if (workspace.salesForm) setSalesForm(workspace.salesForm as typeof salesForm);
      if (typeof workspace.purchaseUpdateOrderId === "string") setPurchaseUpdateOrderId(workspace.purchaseUpdateOrderId);
      if (typeof workspace.salesUpdateOrderId === "string") setSalesUpdateOrderId(workspace.salesUpdateOrderId);
      setActiveView(storedView && visible.includes(storedView) ? storedView : visible[0] || "Overview");
      void refresh(user).finally(() => setBootstrapping(false));
    } catch {
      clearSessionState(setCurrentUser, setSessionToken, setSnapshot);
      setBootstrapping(false);
    }
  }, []);

  useEffect(() => {
    const nextViews = currentUser ? getVisibleViewsForMode(currentUser, simpleMode) : [];
    if (nextViews.length > 0 && !nextViews.includes(activeView)) {
      setActiveView(nextViews[0]);
    }
  }, [activeView, currentUser, simpleMode]);

  useEffect(() => {
    if (currentUser) window.localStorage.setItem(ACTIVE_VIEW_KEY, activeView);
  }, [activeView, currentUser]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;
    let lastTouchEnd = 0;
    const preventGesture = (event: Event) => event.preventDefault();
    const preventCtrlZoom = (event: WheelEvent) => {
      if (event.ctrlKey) event.preventDefault();
    };
    const preventDoubleTapZoom = (event: TouchEvent) => {
      const now = Date.now();
      if (now - lastTouchEnd <= 300) {
        event.preventDefault();
      }
      lastTouchEnd = now;
    };
    document.addEventListener("gesturestart", preventGesture as EventListener, { passive: false });
    document.addEventListener("gesturechange", preventGesture as EventListener, { passive: false });
    document.addEventListener("gestureend", preventGesture as EventListener, { passive: false });
    document.addEventListener("wheel", preventCtrlZoom, { passive: false });
    document.addEventListener("touchend", preventDoubleTapZoom, { passive: false });
    return () => {
      document.removeEventListener("gesturestart", preventGesture as EventListener);
      document.removeEventListener("gesturechange", preventGesture as EventListener);
      document.removeEventListener("gestureend", preventGesture as EventListener);
      document.removeEventListener("wheel", preventCtrlZoom);
      document.removeEventListener("touchend", preventDoubleTapZoom);
    };
  }, []);

  useEffect(() => {
    if (!currentUser) return;
    const timeout = window.setTimeout(() => {
      writeStoredJson(workspaceStorageKey(currentUser.id, "app"), {
        activeView,
        simpleMode,
        deliveryManagerScreen,
        deliveryManagerWarehouseId,
        purchaseForm,
        salesForm,
        purchaseUpdateOrderId,
        salesUpdateOrderId
      });
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [currentUser, activeView, simpleMode, deliveryManagerScreen, deliveryManagerWarehouseId, purchaseForm, salesForm, purchaseUpdateOrderId, salesUpdateOrderId]);

  useEffect(() => {
    if (!currentUser) return;
    if (deliveryManagerWarehouseId) {
      window.localStorage.setItem(DELIVERY_MANAGER_WAREHOUSE_KEY, deliveryManagerWarehouseId);
    } else {
      window.localStorage.removeItem(DELIVERY_MANAGER_WAREHOUSE_KEY);
    }
  }, [currentUser, deliveryManagerWarehouseId]);

  useEffect(() => {
    if (!message) return;
    const timeout = window.setTimeout(() => setMessage(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [message]);

  function closePurchaseEditor() {
    setPurchaseEditorDirty(false);
    setPurchaseUpdateOrderId("");
  }

  function closeSalesEditor() {
    setSalesEditorDirty(false);
    setSalesUpdateOrderId("");
  }

  function confirmPurchaseEditorDiscard() {
    if (!purchaseEditorDirty) return true;
    return window.confirm("Are you sure? This will undo all the changes.");
  }

  function confirmSalesEditorDiscard() {
    if (!salesEditorDirty) return true;
    return window.confirm("Are you sure? This will undo all the changes.");
  }

  function navigateToView(nextView: ViewKey) {
    if (activeView === "Purchase" && purchaseUpdateOrderId && nextView !== "Purchase") {
      if (!confirmPurchaseEditorDiscard()) return false;
      closePurchaseEditor();
    }
    if (activeView === "Sales" && salesUpdateOrderId && nextView !== "Sales") {
      if (!confirmSalesEditorDiscard()) return false;
      closeSalesEditor();
    }
    if (nextView === "Sales" && activeView !== "Sales") setSalesUpdateOrderId("");
    setActiveView(nextView);
    return true;
  }

  useEffect(() => {
    const target = readOrderQrTargetFromLocation();
    if (target) setPendingQrTarget(target);
  }, []);

  useEffect(() => {
    if (!pendingQrTarget || !currentUser || !snapshot) return;
    const access = orderStatusAccess(snapshot, currentUser, pendingQrTarget);
    if (!access.authorized) {
      setOrderStatusTarget(pendingQrTarget);
      clearOrderQrTargetFromLocation();
      setPendingQrTarget(null);
      return;
    }
    const summary = buildOrderStatusSummary(snapshot, pendingQrTarget);
    setOrderStatusTarget(pendingQrTarget);
    if (summary) {
      const currentRoles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
      if (pendingQrTarget.side === "Purchase") {
        if (currentRoles.includes("Warehouse Manager")) {
          navigateToView("Receipts");
        } else if (currentRoles.includes("Delivery Manager")) {
          setDeliveryManagerScreen("in");
          navigateToView("Delivery");
        } else if (currentRoles.includes("Accounts")) {
          navigateToView(summary.paymentStatus === "Completed" && summary.completed ? "Purchases" : "Payments");
        } else {
          navigateToView("Purchases");
        }
      } else {
        if (currentRoles.includes("Warehouse Manager")) {
          navigateToView("Stock");
        } else if (currentRoles.includes("Delivery Manager")) {
          setDeliveryManagerScreen("out");
          navigateToView("Delivery");
        } else if (currentRoles.includes("Accounts") || currentRoles.includes("Collection Agent")) {
          navigateToView(summary.paymentStatus === "Completed" && summary.completed ? "SalesOrders" : "Payments");
        } else {
          navigateToView("SalesOrders");
        }
      }
      const warehouseId = pendingQrTarget.side === "Purchase"
        ? findPurchaseOrderByPublicId(snapshot.purchaseOrders, pendingQrTarget.orderId)?.warehouseId
        : findSalesOrderByPublicId(snapshot.salesOrders, pendingQrTarget.orderId)?.warehouseId;
      if (warehouseId && currentRoles.includes("Delivery Manager")) {
        setDeliveryManagerWarehouseId(warehouseId);
      }
    }
    clearOrderQrTargetFromLocation();
    setPendingQrTarget(null);
  }, [pendingQrTarget, currentUser, snapshot]);

  useEffect(() => {
    if (!currentUser || !snapshot) return;
    const currentRoles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
    if (!currentRoles.includes("Delivery Manager")) return;
    const warehouseScope = userWarehouseScope(currentUser);
    const applyWarehouseScope = isWarehouseScoped(currentUser);
    const warehousesView = applyWarehouseScope ? snapshot.warehouses.filter((item) => warehouseScope.has(item.id)) : snapshot.warehouses;
    const options = warehousesView.length > 0 ? warehousesView : snapshot.warehouses;
    if (options.length === 0) {
      if (deliveryManagerWarehouseId) setDeliveryManagerWarehouseId("");
      return;
    }
    if (!deliveryManagerWarehouseId || !options.some((warehouse) => warehouse.id === deliveryManagerWarehouseId)) {
      setDeliveryManagerWarehouseId(options[0].id);
    }
  }, [currentUser, snapshot, deliveryManagerWarehouseId]);

  async function refresh(user = currentUser) {
    const token = window.localStorage.getItem(TOKEN_KEY) || sessionToken;
    if (!user || !token) return;
    try {
      const { data } = await api.get<AppSnapshot>("/snapshot", { headers: { authorization: `Bearer ${token}` } });
      setSnapshot(data);
    } catch (submitError) {
      clearSessionState(setCurrentUser, setSessionToken, setSnapshot);
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Unable to restore session.") : "Unable to restore session.");
    }
  }

  async function doLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post<{ user: AppUser; token: string; snapshot: AppSnapshot }>("/auth/login", login);
      setCurrentUser(data.user as AppUser);
      setSessionToken(String(data.token || ""));
      setSnapshot(data.snapshot as AppSnapshot);
      const nextUser = data.user as AppUser;
      const nextSimpleMode = preferredSimpleMode(nextUser);
      setSimpleMode(nextSimpleMode);
      const nextView = getVisibleViewsForMode(nextUser, nextSimpleMode)[0] || "Overview";
      setActiveView(nextView);
      window.localStorage.setItem(SESSION_KEY, JSON.stringify(data.user));
      window.localStorage.setItem(TOKEN_KEY, String(data.token || ""));
      window.localStorage.setItem(ACTIVE_VIEW_KEY, nextView);
      window.localStorage.removeItem(DELIVERY_MANAGER_WAREHOUSE_KEY);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function post(path: string, body: object, success: string, onSuccess?: () => void) {
    if (!currentUser || !sessionToken) return false;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.post<AppSnapshot>(path, body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
      onSuccess?.();
      return true;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Action failed.") : "Action failed.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function patch(path: string, body: object, success: string, onSuccess?: () => void) {
    if (!currentUser || !sessionToken) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.patch<AppSnapshot>(path, body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
      onSuccess?.();
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Update failed.") : "Update failed.");
    } finally {
      setLoading(false);
    }
  }

  async function remove(path: string, success: string) {
    if (!currentUser || !sessionToken) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.delete<AppSnapshot>(path, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage(success);
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Delete failed.") : "Delete failed.");
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
      const { data } = await api.post(path, formData, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setMessage(successMessage);
      return data;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Upload failed.") : "Upload failed.");
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
      const { data } = await api.post<AppSnapshot>("/counterparties", body, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      const nextSnapshot = data as AppSnapshot;
      setSnapshot(nextSnapshot);
      setMessage(`${body.type === "Supplier" ? "Supplier" : "Customer"} saved.`);
      return nextSnapshot.counterparties.find((item) => item.type === body.type && item.name === body.name && item.mobileNumber === body.mobileNumber) || null;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Party creation failed.") : "Party creation failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function updatePartyGstin(party: Counterparty, gstNumber: string) {
    if (!currentUser || !sessionToken) return null;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const { data } = await api.patch<AppSnapshot>(`/counterparties/${party.id}`, {
        name: party.name,
        gstNumber,
        bankName: party.bankName,
        bankAccountNumber: party.bankAccountNumber,
        ifscCode: party.ifscCode,
        mobileNumber: party.mobileNumber,
        address: party.address,
        city: party.city,
        contactPerson: party.contactPerson
      }, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setSnapshot(data);
      setMessage("Customer GSTIN saved.");
      return data.counterparties.find((item) => item.id === party.id) || null;
    } catch (submitError) {
      setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "GSTIN update failed.") : "GSTIN update failed.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function doLogout() {
    if (sessionToken) {
      try {
        await api.post("/auth/logout", null, { headers: { authorization: `Bearer ${sessionToken}` } });
      } catch {}
    }
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(ACTIVE_VIEW_KEY);
    setCurrentUser(null);
    setSessionToken("");
    setSnapshot(null);
    setProfileOpen(false);
  }

  if (bootstrapping || (currentUser && !snapshot)) {
    return <BootLoader />;
  }

  if (!currentUser || !snapshot) {
    return (
      <main className="login-shell">
        <section className="login-landing">
          <header className="login-hero-bar glass-surface">
            <div className="topbar-brand-block">
              <span className="small-label">Aapoorti B2B</span>
              <strong>Internal Portal</strong>
            </div>
            <div className="topbar-logo-orb login-topbar-logo">
              <img src={appLogo} alt="Aapoorti" className="topbar-logo-image" />
            </div>
            <div className="topbar-side-slot">
              <div className="login-hero-chip">B2B Internal Use</div>
            </div>
          </header>
          <section className="login-card panel glass-panel">
            <div className="login-copy">
              <span className="eyebrow">Internal Operations</span>
              <h1>Aapoorti B2B operations workspace.</h1>
              <p>This system is for internal booking, stock, delivery, and accounts workflows only.</p>
              <div className="login-feature-strip">
                <div className="login-feature-pill">Orders</div>
                <div className="login-feature-pill">Inventory</div>
                <div className="login-feature-pill">Collections</div>
              </div>
            </div>
            <form className="form-shell glass-form-shell" onSubmit={doLogin}>
              <div className="login-form-head">
                <span className="eyebrow">Secure Sign In</span>
                <strong>Enter your operator credentials</strong>
              </div>
              <label>Username<input value={login.username} onChange={(e) => setLogin((c) => ({ ...c, username: e.target.value }))} /></label>
              <label>Password<input type="password" value={login.password} onChange={(e) => setLogin((c) => ({ ...c, password: e.target.value }))} /></label>
              {error ? <p className="message error">{error}</p> : null}
              <button className="primary-button" type="submit" disabled={loading}>{loading ? "Signing in..." : "Login"}</button>
            </form>
          </section>
          <footer className="login-footer">Powered by OPAS</footer>
        </section>
      </main>
    );
  }

  const currentRoles = currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role];
  const isAdminUser = currentRoles.includes("Admin");
  const isAccountsUser = currentRoles.includes("Accounts");
  const isCollectionAgent = currentRoles.includes("Collection Agent");
  const isDataAnalyst = currentRoles.includes("Data Analyst");
  const isPurchaserOnly = currentRoles.includes("Purchaser") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Sales");
  const isSalesOnly = currentRoles.includes("Sales") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Purchaser" || role === "Warehouse Manager");
  const isWarehouseOnly = currentRoles.includes("Warehouse Manager") && !currentRoles.some((role) => role === "Admin" || role === "Accounts" || role === "Purchaser" || role === "Sales");
  const isDeliveryManager = currentRoles.includes("Delivery Manager");
  const isDeliveryOnly = currentRoles.length === 1 && (currentRoles[0] === "In Delivery" || currentRoles[0] === "Out Delivery" || currentRoles[0] === "Delivery");
  const forceSimpleMode = shouldForceSimpleMode(currentUser);
  const effectiveSimpleMode = forceSimpleMode ? true : simpleMode;
  const visibleViews = getVisibleViewsForMode(currentUser, effectiveSimpleMode);
  const safeVisibleViews: ViewKey[] = visibleViews.length > 0 ? visibleViews : ["Overview"];
  const purchaserBottomViews: ViewKey[] = ["Overview", "Purchase", "Purchases"];
  const salesBottomViews: ViewKey[] = ["Overview", "Sales", "SalesOrders"];
  const collectionBottomViews: ViewKey[] = ["Overview", "Payments", "SalesOrders"];
  const accountsBottomViews: ViewKey[] = ["Overview", "Payments", "GoodsWarrants"];
  const bottomNavViews: ViewKey[] = currentRoles.includes("Purchaser") && !currentRoles.includes("Sales")
    ? purchaserBottomViews.filter((view) => safeVisibleViews.includes(view))
    : currentRoles.includes("Sales") && !currentRoles.includes("Purchaser")
      ? salesBottomViews.filter((view) => safeVisibleViews.includes(view))
      : currentRoles.includes("Collection Agent")
        ? collectionBottomViews.filter((view) => safeVisibleViews.includes(view))
        : currentRoles.includes("Accounts")
          ? accountsBottomViews.filter((view) => safeVisibleViews.includes(view))
          : safeVisibleViews.filter((view) => view !== "Parties").slice(0, 3);
  const warehouseScope = userWarehouseScope(currentUser);
  const applyWarehouseScope = isWarehouseScoped(currentUser);

  function openOrderStatus(target: OrderQrTarget, navigate = false) {
    if (!snapshot || !currentUser) return;
    const access = orderStatusAccess(snapshot, currentUser, target);
    if (!access.authorized) {
      setOrderStatusTarget(target);
      return;
    }
    const summary = buildOrderStatusSummary(snapshot, target);
    setOrderStatusTarget(target);
    if (!navigate || !summary) return;
    if (target.side === "Purchase") {
      if (currentRoles.includes("Warehouse Manager")) {
        navigateToView("Receipts");
      } else if (currentRoles.includes("Delivery Manager")) {
        setDeliveryManagerScreen("in");
        navigateToView("Delivery");
      } else if (currentRoles.includes("Accounts")) {
        navigateToView(summary.paymentStatus === "Completed" && summary.completed ? "Purchases" : "Payments");
      } else {
        navigateToView("Purchases");
      }
    } else {
      if (currentRoles.includes("Warehouse Manager")) {
        navigateToView("Stock");
      } else if (currentRoles.includes("Delivery Manager")) {
        setDeliveryManagerScreen("out");
        navigateToView("Delivery");
      } else if (currentRoles.includes("Accounts") || currentRoles.includes("Collection Agent")) {
        navigateToView(summary.paymentStatus === "Completed" && summary.completed ? "SalesOrders" : "Payments");
      } else {
        navigateToView("SalesOrders");
      }
    }
    const warehouseId = target.side === "Purchase"
      ? findPurchaseOrderByPublicId(snapshot.purchaseOrders, target.orderId)?.warehouseId
      : findSalesOrderByPublicId(snapshot.salesOrders, target.orderId)?.warehouseId;
    if (warehouseId && currentRoles.includes("Delivery Manager")) {
      setDeliveryManagerWarehouseId(warehouseId);
    }
  }

  function handleQrScan(target: OrderQrTarget) {
    setScanOverlayOpen(false);
    clearOrderQrTargetFromLocation();
    openOrderStatus(target, true);
  }
  const warehousesView = applyWarehouseScope ? snapshot.warehouses.filter((item) => warehouseScope.has(item.id)) : snapshot.warehouses;
  const purchaseOrdersView = applyWarehouseScope ? snapshot.purchaseOrders.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.purchaseOrders;
  const salesOrdersView = applyWarehouseScope ? snapshot.salesOrders.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.salesOrders;
  const stockSummaryView = applyWarehouseScope ? snapshot.stockSummary.filter((item) => warehouseScope.has(item.warehouseId)) : snapshot.stockSummary;
  const counterparties = sortCounterpartiesAlphabetically(Array.isArray(snapshot.counterparties) ? snapshot.counterparties : []);
  const settings = snapshot.settings && Array.isArray(snapshot.settings.paymentMethods) ? snapshot.settings : { paymentMethods: [], deliveryCharge: { model: "Fixed" as const, amount: 0 } };
  const purchaseSupplierIds = new Set(purchaseOrdersView.map((item) => item.supplierId));
  const salesShopIds = new Set(salesOrdersView.map((item) => item.shopId));
  const suppliers = counterparties.filter((item) => item.type === "Supplier" && (!applyWarehouseScope || purchaseSupplierIds.has(item.id)));
  const shops = counterparties.filter((item) => item.type === "Shop" && (!applyWarehouseScope || salesShopIds.has(item.id)));
  const paymentMethods = settings.paymentMethods.filter((item) => item.active);
  const deliveryManagerWarehouseOptions = warehousesView.length > 0 ? warehousesView : snapshot.warehouses;
  const activeDeliveryManagerWarehouseId = deliveryManagerWarehouseId || deliveryManagerWarehouseOptions[0]?.id || "";
  const deliveryManagerSnapshot = snapshotForWarehouse(snapshot, activeDeliveryManagerWarehouseId);
  const deliveryManagerWarehousePendingCounts = new Map(
    deliveryManagerWarehouseOptions.map((warehouse) => {
      const scopedSnapshot = snapshotForWarehouse(snapshot, warehouse.id);
      const pendingCount =
        countGroupedOrders(scopedSnapshot.purchaseOrders.filter(isOpenPurchaseOrder))
        + countGroupedOrders(scopedSnapshot.salesOrders.filter(isOpenSalesOrder))
        + scopedSnapshot.deliveryTasks.filter(isDeliveryTaskPending).length;
      return [warehouse.id, pendingCount];
    })
  );
  const purchaserOrderCount = countGroupedOrders(purchaseOrdersView.filter((order) => (order.purchaserId === currentUser.id || order.purchaserName === currentUser.fullName) && isOpenPurchaseOrder(order)));
  const salesOrderCount = countGroupedOrders(salesOrdersView.filter((order) => (order.salesmanId === currentUser.id || order.salesmanName === currentUser.fullName) && isOpenSalesOrder(order)));
  const deliveryManagerHomePendingCount = deliveryManagerSnapshot.deliveryTasks.filter((task) => task.status !== "Delivered").length;
  const deliveryManagerInboundPendingCount = countGroupedOrders(deliveryManagerSnapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed"));
  const deliveryManagerDispatchPendingCount = countGroupedOrders(deliveryManagerSnapshot.salesOrders.filter((item) => item.status === "Booked" || item.status === "Ready for Dispatch" || item.status === "Pending Pickup" || item.status === "Out for Delivery" || item.status === "Self Pickup"));
  const totalPurchaseValue = purchaseOrdersView.reduce((sum, order) => sum + order.totalAmount, 0);
  const totalSalesValue = salesOrdersView.reduce((sum, order) => sum + order.totalAmount + order.deliveryCharge, 0);
  const purchasePendingValue = snapshot.ledgerEntries.filter((entry) => entry.side === "Purchase").reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const salesPendingValue = snapshot.ledgerEntries.filter((entry) => entry.side === "Sales").reduce((sum, entry) => sum + entry.pendingAmount, 0);
  const verifiedPurchaseCashOut = snapshot.payments
    .filter((payment) => payment.side === "Purchase" && (payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved"))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const verifiedSalesCashIn = snapshot.payments
    .filter((payment) => payment.side === "Sales" && (payment.verificationStatus === "Verified" || payment.verificationStatus === "Resolved"))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const pnlSpreadValue = totalSalesValue - totalPurchaseValue;
  const cashflowNetValue = verifiedSalesCashIn - verifiedPurchaseCashOut;
  const latestPurchaseRateBySku = new Map<string, number>();
  [...snapshot.purchaseOrders]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .forEach((order) => {
      if (!latestPurchaseRateBySku.has(order.productSku)) latestPurchaseRateBySku.set(order.productSku, order.rate);
    });
  const stockValue = stockSummaryView.reduce((sum, item) => {
    const units = item.availableQuantity + item.reservedQuantity + item.blockedQuantity;
    return sum + units * (latestPurchaseRateBySku.get(item.productSku) || 0);
  }, 0);
  const topMetricCards = isAccountsUser
    ? [
      { label: "Total Purchase", value: formatCurrencyInr(totalPurchaseValue), note: "Booked supplier value", size: "large" as const, tone: "danger" as const, onOpen: () => navigateToView("Purchases") },
      { label: "Total Sales", value: formatCurrencyInr(totalSalesValue), note: "Billed customer value", size: "large" as const, tone: "good" as const, onOpen: () => navigateToView("SalesOrders") },
      { label: "Stock Value", value: formatCurrencyInr(stockValue), note: "Current inventory value", size: "large" as const, tone: "pending" as const, onOpen: () => navigateToView("Stock") },
      { label: "Cashflow", value: formatCurrencyInr(cashflowNetValue), note: "Verified in minus out", size: "large" as const, tone: cashflowNetValue >= 0 ? "good" as const : "danger" as const, onOpen: () => navigateToView("Payments") },
      { label: "P&L Spread", value: formatCurrencyInr(pnlSpreadValue), note: "Sales minus purchase", tone: pnlSpreadValue >= 0 ? "good" as const : "danger" as const, onOpen: () => navigateToView("Ledger") },
      { label: "Pending Purchase", value: formatCurrencyInr(purchasePendingValue), note: "Supplier dues open", tone: "pending" as const, onOpen: () => navigateToView("Payments") },
      { label: "Pending Sales", value: formatCurrencyInr(salesPendingValue), note: "Customer dues open", tone: "pending" as const, onOpen: () => navigateToView("SalesOrders") },
      { label: "Products", value: String(snapshot.metrics.productCount), note: "Live SKUs", onOpen: () => navigateToView("Stock") },
      { label: "Parties", value: String(snapshot.metrics.partyCount), note: "Suppliers and customers", onOpen: () => navigateToView("Parties") }
    ]
    : [
      { label: "Products", value: String(snapshot.metrics.productCount), note: "Live catalogue", onOpen: () => navigateToView("Products") },
      { label: "Parties", value: String(snapshot.metrics.partyCount), note: "Suppliers and customers", onOpen: () => navigateToView("Parties") },
      { label: "Pending Purchase Pay", value: String(snapshot.metrics.pendingPurchasePayments), note: "Supplier follow-up", tone: "pending" as const, onOpen: () => navigateToView("Purchases") },
      { label: "Pending Sales Pay", value: String(snapshot.metrics.pendingSalesPayments), note: "Customer collection", tone: "pending" as const, onOpen: () => navigateToView("SalesOrders") },
      { label: "Partial Receipts", value: String(snapshot.metrics.partialReceipts), note: "Warehouse exceptions", onOpen: () => navigateToView("Receipts") },
      { label: "Available Stock", value: String(snapshot.metrics.availableInventoryUnits), note: "Ready units", onOpen: () => navigateToView("Stock") }
    ];

  function isNaGst(value: string) {
    return value.trim().toUpperCase() === "N/A";
  }

  function getPartyIdentityErrors(body: { type: "Supplier" | "Shop"; name: string; gstNumber: string; bankAccountNumber: string; ifscCode: string }, sourceParties = counterparties) {
    const name = body.name.trim();
    const gstNumber = body.gstNumber.trim();
    const bankAccountNumber = body.bankAccountNumber.trim();
    const ifscCode = body.ifscCode.trim();
    const scopedParties = sourceParties.filter((item) => item.type === body.type);
    return {
      name: !name || scopedParties.some((item) => item.name.trim().toLowerCase() === name.toLowerCase()),
      gstNumber: !gstNumber || (!isNaGst(gstNumber) && scopedParties.some((item) => item.gstNumber.trim().toLowerCase() === gstNumber.toLowerCase())),
      bankAccountNumber: !bankAccountNumber || (!isNaGst(bankAccountNumber) && scopedParties.some((item) => item.bankAccountNumber.trim().toLowerCase() === bankAccountNumber.toLowerCase())),
      ifscCode: !ifscCode
    };
  }

  async function saveStandaloneParty(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentUser) return;
    const forcedType = isAccountsUser ? partyForm.type : currentUser.role === "Sales" ? "Shop" : "Supplier";
    const nextErrors = getPartyIdentityErrors({ ...partyForm, type: forcedType });
    setPartyFormErrors(nextErrors);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      setError(
        nextErrors.name
          ? `${forcedType} name is required and must be unique.`
          : nextErrors.gstNumber
            ? "GST number is required and must be unique. Use N/A for unregistered parties."
            : nextErrors.bankAccountNumber
              ? "Bank account number is required and must be unique. Use N/A when not available."
              : "IFSC code is required. Use N/A when not available."
      );
      return;
    }
    const created = await createPartyRecord({ ...partyForm, type: forcedType });
    if (created) {
      setPartyForm(emptyPartyCreateForm);
      setPartyFormErrors({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
    }
  }

  function buildPartyEditDraft(item: Counterparty) {
    return {
      id: item.id,
      type: item.type,
      name: item.name,
      gstNumber: item.gstNumber,
      bankName: item.bankName,
      bankAccountNumber: item.bankAccountNumber,
      ifscCode: item.ifscCode,
      mobileNumber: item.mobileNumber,
      address: item.address,
      city: item.city,
      contactPerson: item.contactPerson
    };
  }

  function startAccountsPartyUpdate(item: Counterparty) {
    setAccountsPartyPaymentId("");
    setAccountsPartyUpdateId(item.id);
    setPartyEditForm(buildPartyEditDraft(item));
  }

  function openSupplierUpdateFromAnywhere(supplierId: string) {
    const supplier = counterparties.find((item) => item.id === supplierId && item.type === "Supplier");
    if (!supplier) {
      setError("Supplier not found.");
      return;
    }
    setAccountsPartySearch(supplier.name);
    setOpenPartyPanel("");
    startAccountsPartyUpdate(supplier);
    navigateToView("Parties");
  }

  function startAccountsPartyPayment(item: Counterparty, orderId = "", pendingAmount = 0, paymentMode: PaymentMode = "NEFT") {
    setAccountsPartyUpdateId("");
    setAccountsPartyPaymentId(item.id);
    setAccountsPartyPaymentForm({
      partyId: item.id,
      linkedOrderId: orderId,
      amount: pendingAmount > 0 ? String(Number(pendingAmount.toFixed(2))) : "0",
      mode: paymentMode,
      cashTiming: "In Hand",
      referenceNumber: "",
      voucherNumber: "",
      utrNumber: "",
      verificationNote: `Supplier payment recorded by accounts for ${item.name}`,
      operationDate: indiaDateKey()
    });
  }

  async function saveAccountsPartyUpdate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const sourceParties = counterparties.filter((item) => item.id !== partyEditForm.id);
    const nextErrors = getPartyIdentityErrors({ ...partyEditForm, type: partyEditForm.type }, sourceParties);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      setError(
        nextErrors.name
          ? `${partyEditForm.type === "Shop" ? "Customer" : "Supplier"} name is required and must be unique.`
          : nextErrors.gstNumber
            ? `GST number is required and must be unique. Use N/A for unregistered ${partyEditForm.type === "Shop" ? "customers" : "suppliers"}.`
            : nextErrors.bankAccountNumber
              ? "Bank account number is required and must be unique. Use N/A when not available."
              : "IFSC code is required. Use N/A when not available."
      );
      return;
    }
    await patch(`/counterparties/${partyEditForm.id}`, partyEditForm, `${partyEditForm.type === "Shop" ? "Customer" : "Supplier"} updated.`, () => {
      setAccountsPartyUpdateId("");
      setPartyEditForm(emptyPartyEditForm);
    });
  }

  async function saveAccountsPartyPayment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(accountsPartyPaymentForm.amount || 0);
    if (!accountsPartyPaymentForm.partyId || !accountsPartyPaymentForm.linkedOrderId) {
      setError("Select a pending purchase order first.");
      return;
    }
    if (amount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }
    const verificationStatus = accountsPartyPaymentForm.utrNumber.trim() ? "Verified" : "Pending";
    const verificationNote = accountsPartyPaymentForm.verificationNote.trim()
      || (verificationStatus === "Verified"
        ? "Supplier payment recorded by accounts."
        : "Supplier payment recorded by accounts. Awaiting UTR / reconciliation.");
    await post("/payments", {
      side: "Purchase",
      linkedOrderId: accountsPartyPaymentForm.linkedOrderId,
      amount,
      mode: accountsPartyPaymentForm.mode,
      cashTiming: accountsPartyPaymentForm.mode === "Cash" ? accountsPartyPaymentForm.cashTiming : undefined,
      referenceNumber: accountsPartyPaymentForm.referenceNumber.trim() || accountsPartyPaymentForm.linkedOrderId,
      voucherNumber: accountsPartyPaymentForm.voucherNumber.trim() || undefined,
      utrNumber: accountsPartyPaymentForm.utrNumber.trim() || undefined,
      verificationStatus,
      verificationNote,
      operationDate: accountsPartyPaymentForm.operationDate || undefined
    }, "Supplier payment recorded.", () => {
      setAccountsPartyPaymentId("");
      setAccountsPartyPaymentForm({
        partyId: "",
        linkedOrderId: "",
        amount: "0",
        mode: "NEFT",
        cashTiming: "In Hand",
        referenceNumber: "",
        voucherNumber: "",
        utrNumber: "",
        verificationNote: "Supplier payment recorded by accounts",
        operationDate: indiaDateKey()
      });
    });
  }

  const normalizedAccountsPartySearch = accountsPartySearch.trim().toLowerCase();
  const partyItems = currentUser.role === "Sales" ? shops : suppliers;
  const partyRoleLabel = currentUser.role === "Sales" ? "Customer" : "Supplier";
  const partyFormGstNa = partyForm.gstNumber.trim().toUpperCase() === "N/A";
  const partyFormBankNa = [partyForm.bankName, partyForm.bankAccountNumber, partyForm.ifscCode].every((value) => value.trim().toUpperCase() === "N/A");
  const partyEditFormGstNa = partyEditForm.gstNumber.trim().toUpperCase() === "N/A";
  const partyEditFormBankNa = [partyEditForm.bankName, partyEditForm.bankAccountNumber, partyEditForm.ifscCode].every((value) => value.trim().toUpperCase() === "N/A");
  const accountsSupplierOrders = suppliers.flatMap((supplier) => groupPurchaseOrders(snapshot.purchaseOrders)
    .filter((group) => group.lines[0]?.supplierId === supplier.id)
    .map((group) => {
      const first = group.lines[0];
      const totalAmount = purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id);
      const ledger = purchaseLedgerByOrder(snapshot, group.id);
      return {
        supplierId: supplier.id,
        orderId: group.id,
        createdAt: first?.createdAt || "",
        paymentMode: (first?.paymentMode || "NEFT") as PaymentMode,
        totalAmount,
        paidAmount: ledger?.paidAmount ?? 0,
        pendingAmount: ledger?.pendingAmount ?? totalAmount,
        workflowStatus: purchaseWorkflowStatus(snapshot, group.id)
      };
    }))
    .filter((item) => item.pendingAmount > 0)
    .sort((left, right) => right.pendingAmount - left.pendingAmount);
  const filteredAccountsParties = counterparties.filter((item) => {
    if (!normalizedAccountsPartySearch) return true;
    const haystack = [
      item.type,
      item.name,
      item.contactPerson,
      item.mobileNumber,
      item.city,
      item.gstNumber,
      item.bankName,
      item.bankAccountNumber,
      item.ifscCode,
      item.address
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedAccountsPartySearch);
  });
  const filteredPartyItems = partyItems.filter((item) => {
    if (!normalizedAccountsPartySearch) return true;
    const haystack = [
      item.name,
      item.contactPerson,
      item.mobileNumber,
      item.city,
      item.gstNumber,
      item.bankName,
      item.bankAccountNumber,
      item.ifscCode,
      item.address
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(normalizedAccountsPartySearch);
  });
  const partiesView = isAdminUser ? (
    <section className="collapse-stack">
      <Panel title="Party Search" eyebrow="Admin view">
        <div className="form-grid">
          <label className="wide-field">Search party<input value={accountsPartySearch} onChange={(e) => setAccountsPartySearch(e.target.value)} placeholder="Type, name, GST, mobile, bank, city" /></label>
        </div>
      </Panel>
      <CollapsiblePanel title="Supplier Master" eyebrow="Admin view" open={openPartyPanel === "supplier-master"} onToggle={() => setOpenPartyPanel((current) => current === "supplier-master" ? "" : "supplier-master")}>
        <PartyVitalsList snapshot={snapshot} parties={filteredAccountsParties.filter((item) => item.type === "Supplier" && (!applyWarehouseScope || purchaseSupplierIds.has(item.id)))} type="Supplier" />
      </CollapsiblePanel>
      <CollapsiblePanel title="Customer Master" eyebrow="Admin view" open={openPartyPanel === "customer-master"} onToggle={() => setOpenPartyPanel((current) => current === "customer-master" ? "" : "customer-master")}>
        <PartyVitalsList snapshot={snapshot} parties={filteredAccountsParties.filter((item) => item.type === "Shop" && (!applyWarehouseScope || salesShopIds.has(item.id)))} type="Shop" />
      </CollapsiblePanel>
    </section>
  ) : isAccountsUser ? (
    <section className="collapse-stack">
      <Panel title="Party Search" eyebrow="Accounts">
        <div className="form-grid">
          <label className="wide-field">Search party<input value={accountsPartySearch} onChange={(e) => setAccountsPartySearch(e.target.value)} placeholder="Type, name, GST, mobile, bank, city" /></label>
        </div>
      </Panel>
      <CollapsiblePanel title="Create Party" eyebrow="Accounts" open={openPartyPanel === "register"} onToggle={() => setOpenPartyPanel((current) => current === "register" ? "" : "register")}>
        <form className="form-grid" onSubmit={saveStandaloneParty}>
          <label>Type<select value={partyForm.type} onChange={(e) => setPartyForm((c) => ({ ...c, type: e.target.value as "Supplier" | "Shop" }))}><option value="Supplier">Supplier / Vendor</option><option value="Shop">Customer / Shop</option></select></label>
          <label className={partyFormErrors.name ? "field-error" : ""}>Name<input value={partyForm.name} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, name: false })); setPartyForm((c) => ({ ...c, name: e.target.value })); }} /></label>
          <label className={partyFormErrors.gstNumber ? "field-error" : ""}>GST<input value={partyForm.gstNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, gstNumber: false })); setPartyForm((c) => ({ ...c, gstNumber: e.target.value })); }} placeholder="GST number or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyFormGstNa} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, gstNumber: false })); setPartyForm((c) => ({ ...c, gstNumber: e.target.checked ? "N/A" : "" })); }} />GST N/A</label>
          <label>Bank name<input value={partyForm.bankName} onChange={(e) => setPartyForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
          <label className={partyFormErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyForm.bankAccountNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyForm((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label>
          <label className={partyFormErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyForm.ifscCode} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, ifscCode: false })); setPartyForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyFormBankNa} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, bankAccountNumber: false, ifscCode: false })); setPartyForm((c) => ({ ...c, bankName: e.target.checked ? "N/A" : "", bankAccountNumber: e.target.checked ? "N/A" : "", ifscCode: e.target.checked ? "N/A" : "" })); }} />Bank details N/A</label>
          <label>Mobile<input value={partyForm.mobileNumber} onChange={(e) => setPartyForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label>
          <label>Contact<input value={partyForm.contactPerson} onChange={(e) => setPartyForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label>
          <label>City<input value={partyForm.city} onChange={(e) => setPartyForm((c) => ({ ...c, city: e.target.value }))} /></label>
          <label className="wide-field">Address<input value={partyForm.address} onChange={(e) => setPartyForm((c) => ({ ...c, address: e.target.value }))} /></label>
          <button className="primary-button" type="submit">{partyForm.type === "Shop" ? "Save customer" : "Save supplier"}</button>
        </form>
      </CollapsiblePanel>

      <Panel title="Party List" eyebrow="Search, update, pay">
        <div className="stack-list payment-update-list">
          {filteredAccountsParties.length === 0 ? <div className="empty-card">No parties match this search.</div> : filteredAccountsParties.map((item) => {
            const pendingOrders = item.type === "Supplier" ? accountsSupplierOrders.filter((order) => order.supplierId === item.id) : [];
            const totalPending = pendingOrders.reduce((sum, order) => sum + order.pendingAmount, 0);
            const totalPaid = pendingOrders.reduce((sum, order) => sum + order.paidAmount, 0);
            const isUpdating = accountsPartyUpdateId === item.id;
            const isPaying = accountsPartyPaymentId === item.id;
            return <article className="list-card payment-update-card" key={item.id}>
              <div className="payment-update-head">
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.id} | {item.city || "No city"}{item.mobileNumber ? ` | ${item.mobileNumber}` : ""}</p>
                </div>
                <span className={`status-pill ${item.type === "Supplier" && totalPending > 0 ? "status-pending" : "status-completed"}`}>{item.type === "Shop" ? "Customer" : totalPending > 0 ? "Payment pending" : "Settled"}</span>
              </div>
              <div className="payment-meta-grid">
                <div><span className="small-label">Type</span><strong>{item.type === "Shop" ? "Customer / Shop" : "Supplier / Vendor"}</strong></div>
                <div><span className="small-label">GST</span><strong>{item.gstNumber || "N/A"}</strong></div>
                <div><span className="small-label">Bank</span><strong>{item.bankName || "N/A"}</strong></div>
                <div><span className="small-label">Account</span><strong>{item.bankAccountNumber || "N/A"}</strong></div>
                <div><span className="small-label">IFSC</span><strong>{item.ifscCode || "N/A"}</strong></div>
                <div><span className="small-label">Contact</span><strong>{item.contactPerson || "N/A"}</strong></div>
                <div><span className="small-label">Address</span><strong>{item.address || "N/A"}</strong></div>
                {item.type === "Supplier" ? <div><span className="small-label">Pending dues</span><strong>{formatCurrencyInr(totalPending)}</strong></div> : null}
                {item.type === "Supplier" ? <div><span className="small-label">Open PO</span><strong>{String(pendingOrders.length)}</strong></div> : null}
                {item.type === "Supplier" ? <div><span className="small-label">Already paid</span><strong>{formatCurrencyInr(totalPaid)}</strong></div> : null}
              </div>
              <div className="payment-card-actions">
                <button className={isUpdating ? "primary-button" : "ghost-button"} type="button" onClick={() => isUpdating ? setAccountsPartyUpdateId("") : startAccountsPartyUpdate(item)}>{isUpdating ? "Close update" : `Update ${item.type === "Shop" ? "customer" : "supplier"}`}</button>
                {item.type === "Supplier" ? <button className={isPaying ? "primary-button" : "ghost-button"} type="button" onClick={() => isPaying ? setAccountsPartyPaymentId("") : startAccountsPartyPayment(item, pendingOrders[0]?.orderId || "", pendingOrders[0]?.pendingAmount || 0, pendingOrders[0]?.paymentMode || "NEFT")}>{isPaying ? "Close payment" : "Create payment"}</button> : null}
              </div>

              {item.type === "Supplier" && pendingOrders.length > 0 ? <div className="stack-list top-gap">
                {pendingOrders.slice(0, 4).map((order) => (
                  <div className="list-card" key={order.orderId}>
                    <div className="payment-update-head">
                      <div>
                        <strong>{order.orderId}</strong>
                        <p>{formatShortDate(order.createdAt)} | {order.workflowStatus}</p>
                      </div>
                      <button className="ghost-button" type="button" onClick={() => startAccountsPartyPayment(item, order.orderId, order.pendingAmount, order.paymentMode)}>Pay this PO</button>
                    </div>
                    <div className="payment-meta-grid">
                      <div><span className="small-label">Pending</span><strong>{formatCurrencyInr(order.pendingAmount)}</strong></div>
                      <div><span className="small-label">Paid</span><strong>{formatCurrencyInr(order.paidAmount)}</strong></div>
                      <div><span className="small-label">Total</span><strong>{formatCurrencyInr(order.totalAmount)}</strong></div>
                      <div><span className="small-label">Mode</span><strong>{order.paymentMode}</strong></div>
                    </div>
                  </div>
                ))}
              </div> : null}

              {isUpdating ? <form className="form-grid top-gap" onSubmit={saveAccountsPartyUpdate}>
                <label>Type<select value={partyEditForm.type} onChange={(e) => setPartyEditForm((current) => ({ ...current, type: e.target.value as "Supplier" | "Shop" }))}><option value="Supplier">Supplier / Vendor</option><option value="Shop">Customer / Shop</option></select></label>
                <label>Name<input value={partyEditForm.name} onChange={(e) => setPartyEditForm((current) => ({ ...current, name: e.target.value }))} /></label>
                <label>GST<input value={partyEditForm.gstNumber} onChange={(e) => setPartyEditForm((current) => ({ ...current, gstNumber: e.target.value }))} placeholder="GST number or N/A" /></label>
                <label className="checkbox-line"><input type="checkbox" checked={partyEditFormGstNa} onChange={(e) => setPartyEditForm((current) => ({ ...current, gstNumber: e.target.checked ? "N/A" : "" }))} />GST N/A</label>
                <label>Bank name<input value={partyEditForm.bankName} onChange={(e) => setPartyEditForm((current) => ({ ...current, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
                <label>Bank account<input value={partyEditForm.bankAccountNumber} onChange={(e) => setPartyEditForm((current) => ({ ...current, bankAccountNumber: e.target.value }))} placeholder="Account number or N/A" /></label>
                <label>IFSC<input value={partyEditForm.ifscCode} onChange={(e) => setPartyEditForm((current) => ({ ...current, ifscCode: e.target.value.toUpperCase() }))} placeholder="IFSC code or N/A" /></label>
                <label className="checkbox-line"><input type="checkbox" checked={partyEditFormBankNa} onChange={(e) => setPartyEditForm((current) => ({ ...current, bankName: e.target.checked ? "N/A" : "", bankAccountNumber: e.target.checked ? "N/A" : "", ifscCode: e.target.checked ? "N/A" : "" }))} />Bank details N/A</label>
                <label>Mobile<input value={partyEditForm.mobileNumber} onChange={(e) => setPartyEditForm((current) => ({ ...current, mobileNumber: e.target.value }))} /></label>
                <label>Contact<input value={partyEditForm.contactPerson} onChange={(e) => setPartyEditForm((current) => ({ ...current, contactPerson: e.target.value }))} /></label>
                <label>City<input value={partyEditForm.city} onChange={(e) => setPartyEditForm((current) => ({ ...current, city: e.target.value }))} /></label>
                <label className="wide-field">Address<input value={partyEditForm.address} onChange={(e) => setPartyEditForm((current) => ({ ...current, address: e.target.value }))} /></label>
                <div className="payment-card-actions wide-field">
                  <button className="primary-button" type="submit">{partyEditForm.type === "Shop" ? "Update customer" : "Update supplier"}</button>
                  <button className="ghost-button" type="button" onClick={() => setAccountsPartyUpdateId("")}>Cancel</button>
                </div>
              </form> : null}

              {item.type === "Supplier" && isPaying ? <form className="form-grid top-gap" onSubmit={saveAccountsPartyPayment}>
                <label>Pending PO<select value={accountsPartyPaymentForm.linkedOrderId} onChange={(e) => {
                  const selectedOrder = pendingOrders.find((order) => order.orderId === e.target.value);
                  setAccountsPartyPaymentForm((current) => ({
                    ...current,
                    linkedOrderId: e.target.value,
                    amount: selectedOrder ? String(Number(selectedOrder.pendingAmount.toFixed(2))) : current.amount,
                    mode: selectedOrder?.paymentMode || current.mode
                  }));
                }}>{[<option key="blank" value="">Select pending PO</option>, ...pendingOrders.map((order) => <option key={order.orderId} value={order.orderId}>{`${order.orderId} | ${formatCurrencyInr(order.pendingAmount)}`}</option>)]}</select></label>
                <label>Amount<input type="number" step="any" value={accountsPartyPaymentForm.amount} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, amount: e.target.value }))} /></label>
                <label>Mode<select value={accountsPartyPaymentForm.mode} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, mode: e.target.value as PaymentMode }))}><option>Cash</option><option>UPI</option><option>NEFT</option><option>RTGS</option><option>Cheque</option><option>Card</option></select></label>
                {accountsPartyPaymentForm.mode === "Cash" ? <label>Cash timing<select value={accountsPartyPaymentForm.cashTiming} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, cashTiming: e.target.value }))}><option>In Hand</option><option>Advance</option><option>On Delivery</option><option>Against Bill</option></select></label> : null}
                <label>Reference<input value={accountsPartyPaymentForm.referenceNumber} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, referenceNumber: e.target.value }))} placeholder="Ref no. or PO id" /></label>
                <label>Voucher<input value={accountsPartyPaymentForm.voucherNumber} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, voucherNumber: e.target.value }))} /></label>
                <label>UTR<input value={accountsPartyPaymentForm.utrNumber} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, utrNumber: e.target.value }))} placeholder="Leave blank if pending" /></label>
                <label>Date<input type="date" value={accountsPartyPaymentForm.operationDate} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, operationDate: e.target.value }))} /></label>
                <label className="wide-field">Note<input value={accountsPartyPaymentForm.verificationNote} onChange={(e) => setAccountsPartyPaymentForm((current) => ({ ...current, verificationNote: e.target.value }))} /></label>
                <div className="payment-card-actions wide-field">
                  <button className="primary-button" type="submit">Save payment</button>
                  <button className="ghost-button" type="button" onClick={() => setAccountsPartyPaymentId("")}>Cancel</button>
                </div>
              </form> : null}
            </article>;
          })}
        </div>
      </Panel>
    </section>
  ) : (
    <section className="collapse-stack">
      <Panel title={`Search ${partyRoleLabel}`} eyebrow="Quick filter">
        <div className="form-grid">
          <label className="wide-field">Search {partyRoleLabel.toLowerCase()}<input value={accountsPartySearch} onChange={(e) => setAccountsPartySearch(e.target.value)} placeholder={`Type ${partyRoleLabel.toLowerCase()} name, GST, mobile, bank, city`} /></label>
        </div>
      </Panel>
      <CollapsiblePanel title={`Register ${partyRoleLabel}`} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"} open={openPartyPanel === "register"} onToggle={() => setOpenPartyPanel((current) => current === "register" ? "" : "register")}>
        <form className="form-grid" onSubmit={saveStandaloneParty}>
          <label>Type<input value={currentUser.role === "Sales" ? "Customer / Shop" : "Supplier / Vendor"} readOnly /></label>
          <label className={partyFormErrors.name ? "field-error" : ""}>Name<input value={partyForm.name} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, name: false })); setPartyForm((c) => ({ ...c, name: e.target.value })); }} /></label>
          <label className={partyFormErrors.gstNumber ? "field-error" : ""}>GST<input value={partyForm.gstNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, gstNumber: false })); setPartyForm((c) => ({ ...c, gstNumber: e.target.value })); }} placeholder="GST number or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyFormGstNa} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, gstNumber: false })); setPartyForm((c) => ({ ...c, gstNumber: e.target.checked ? "N/A" : "" })); }} />GST N/A</label>
          <label>Bank name<input value={partyForm.bankName} onChange={(e) => setPartyForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
          <label className={partyFormErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyForm.bankAccountNumber} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyForm((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label>
          <label className={partyFormErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyForm.ifscCode} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, ifscCode: false })); setPartyForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyFormBankNa} onChange={(e) => { setPartyFormErrors((c) => ({ ...c, bankAccountNumber: false, ifscCode: false })); setPartyForm((c) => ({ ...c, bankName: e.target.checked ? "N/A" : "", bankAccountNumber: e.target.checked ? "N/A" : "", ifscCode: e.target.checked ? "N/A" : "" })); }} />Bank details N/A</label>
          <label>Mobile<input value={partyForm.mobileNumber} onChange={(e) => setPartyForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label>
          <label>Contact<input value={partyForm.contactPerson} onChange={(e) => setPartyForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label>
          <label>City<input value={partyForm.city} onChange={(e) => setPartyForm((c) => ({ ...c, city: e.target.value }))} /></label>
          <label className="wide-field">Address<input value={partyForm.address} onChange={(e) => setPartyForm((c) => ({ ...c, address: e.target.value }))} /></label>
          <button className="primary-button" type="submit">{currentUser.role === "Sales" ? "Save customer" : "Save supplier"}</button>
        </form>
      </CollapsiblePanel>
      <CollapsiblePanel title={`Update ${partyRoleLabel}`} eyebrow="Edit details" open={openPartyPanel === "update"} onToggle={() => setOpenPartyPanel((current) => current === "update" ? "" : "update")}>
        <form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/counterparties/${partyEditForm.id}`, partyEditForm, "Party updated.", () => setPartyEditForm(emptyPartyEditForm)); }}>
          <label>Party<select value={partyEditForm.id} onChange={(e) => { const item = filteredPartyItems.find((c) => c.id === e.target.value) || partyItems.find((c) => c.id === e.target.value); setPartyEditForm(item ? { id: item.id, type: item.type, name: item.name, gstNumber: item.gstNumber, bankName: item.bankName, bankAccountNumber: item.bankAccountNumber, ifscCode: item.ifscCode, mobileNumber: item.mobileNumber, address: item.address, city: item.city, contactPerson: item.contactPerson } : emptyPartyEditForm); }}>{renderOptions(filteredPartyItems)}</select></label>
          <label>Name<input value={partyEditForm.name} onChange={(e) => setPartyEditForm((c) => ({ ...c, name: e.target.value }))} /></label>
          <label>GST<input value={partyEditForm.gstNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, gstNumber: e.target.value }))} placeholder="GST number or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyEditFormGstNa} onChange={(e) => setPartyEditForm((c) => ({ ...c, gstNumber: e.target.checked ? "N/A" : "" }))} />GST N/A</label>
          <label>Bank name<input value={partyEditForm.bankName} onChange={(e) => setPartyEditForm((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
          <label>Bank account<input value={partyEditForm.bankAccountNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, bankAccountNumber: e.target.value }))} placeholder="Account number or N/A" /></label>
          <label>IFSC<input value={partyEditForm.ifscCode} onChange={(e) => setPartyEditForm((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() }))} placeholder="IFSC code or N/A" /></label>
          <label className="checkbox-line"><input type="checkbox" checked={partyEditFormBankNa} onChange={(e) => setPartyEditForm((c) => ({ ...c, bankName: e.target.checked ? "N/A" : "", bankAccountNumber: e.target.checked ? "N/A" : "", ifscCode: e.target.checked ? "N/A" : "" }))} />Bank details N/A</label>
          <label>Mobile<input value={partyEditForm.mobileNumber} onChange={(e) => setPartyEditForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label>
          <label>Contact<input value={partyEditForm.contactPerson} onChange={(e) => setPartyEditForm((c) => ({ ...c, contactPerson: e.target.value }))} /></label>
          <label>City<input value={partyEditForm.city} onChange={(e) => setPartyEditForm((c) => ({ ...c, city: e.target.value }))} /></label>
          <label className="wide-field">Address<input value={partyEditForm.address} onChange={(e) => setPartyEditForm((c) => ({ ...c, address: e.target.value }))} /></label>
          <button className="primary-button" type="submit">Update</button>
        </form>
      </CollapsiblePanel>
      <CollapsiblePanel title={`${partyRoleLabel} Database`} eyebrow={currentUser.role === "Sales" ? "Sales only" : "Purchase only"} open={openPartyPanel === "database"} onToggle={() => setOpenPartyPanel((current) => current === "database" ? "" : "database")}>
        <PartyVitalsList snapshot={snapshot} parties={filteredPartyItems} type={currentUser.role === "Sales" ? "Shop" : "Supplier"} />
      </CollapsiblePanel>
    </section>
  );

  return (
    <main className={effectiveSimpleMode ? "app-shell simple-shell" : "app-shell"}>
      <header className="app-topbar">
        <div className="app-topbar-copy">
          <span className="small-label">Aapoorti B2B</span>
          <strong>{displayLabel(activeView, currentUser)}</strong>
          <p>{effectiveSimpleMode ? "Quick operations mode." : "Detailed operations mode."}</p>
        </div>
        <div className="topbar-logo-orb app-topbar-logo">
          <img src={appLogo} alt="Aapoorti" className="topbar-logo-image" />
        </div>
        <div className="hero-side hero-top-actions">
          {!effectiveSimpleMode ? <button className="ghost-button sidebar-toggle" type="button" onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? "Expand Menu" : "Collapse Menu"}
          </button> : null}
          <div className="profile-menu">
            <button className="profile-button" type="button" onClick={() => setProfileOpen((current) => !current)} aria-label="Open profile">
              <span className="profile-avatar">{(currentUser.fullName || currentUser.username).slice(0, 1).toUpperCase()}</span>
            </button>
            {profileOpen ? <div className="profile-popover">
              <div className="profile-popover-head">
                <span className="small-label">Profile</span>
                <strong>{currentUser.fullName}</strong>
                <span>{currentUser.username}</span>
              </div>
              <div className="profile-detail-list">
                <div><span className="small-label">Roles</span><strong>{(currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role]).join(" / ")}</strong></div>
                <div><span className="small-label">Mobile</span><strong>{currentUser.mobileNumber || "Pending"}</strong></div>
              </div>
              <div className="profile-action-list">
                {!forceSimpleMode ? <button className="ghost-button" type="button" onClick={() => { const nextMode = !effectiveSimpleMode; const nextView = getVisibleViewsForMode(currentUser, nextMode)[0]; setSimpleMode(nextMode); if (nextView) navigateToView(nextView); setProfileOpen(false); }}>{effectiveSimpleMode ? "Show Advanced" : "Show Simple"}</button> : null}
                <button className="ghost-button" type="button" onClick={() => void doLogout()}>Logout</button>
              </div>
            </div> : null}
          </div>
        </div>
      </header>

      {!effectiveSimpleMode ? <section className="hero panel hero-compact">
        <div>
          <span className="eyebrow">{(currentUser.roles && currentUser.roles.length > 0 ? currentUser.roles : [currentUser.role]).join(" / ")}</span>
          <h1>Aapoorti B2B</h1>
          <p>{effectiveSimpleMode ? "Simple mode shows only the essential operational steps." : "Advanced mode shows full operations, controls, and audit views."}</p>
        </div>
      </section> : null}

      {message ? <div className="app-toast success">{message}</div> : null}
      {error ? <p className="message error">{error}</p> : null}

      <section className={effectiveSimpleMode ? "workspace-shell simple-workspace" : `workspace-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
        {!effectiveSimpleMode ? <aside className={`sidebar panel${sidebarCollapsed ? " is-collapsed" : ""}`}>
          <div className="sidebar-head"><span className="eyebrow">Role Menu</span><h2>{currentUser.fullName}</h2></div>
          <nav className="side-nav">
            {safeVisibleViews.map((view) => (
              <button key={view} type="button" title={displayLabel(view, currentUser)} className={view === activeView ? "tab-button active" : "tab-button"} onClick={() => navigateToView(view)}>
                <span>{sidebarCollapsed ? <SidebarVectorIcon view={view} /> : displayLabel(view, currentUser)}</span><small>{view}</small>
              </button>
            ))}
          </nav>
        </aside> : null}
        <div className="content-shell">
          <Suspense fallback={<div className="panel"><span className="eyebrow">Loading</span><p>Opening workspace…</p></div>}>
          {!effectiveSimpleMode && activeView === "Overview" ? <section className={isAccountsUser ? "metric-grid metric-collage-grid metric-collage-grid-accounts" : "metric-grid metric-collage-grid"}>
            {topMetricCards.map((card) => (
              <MetricCard
                key={card.label}
                label={card.label}
                value={card.value}
                note={card.note}
                size={card.size}
                tone={card.tone}
                onOpen={card.onOpen}
              />
            ))}
          </section> : null}

          {activeView === "Overview" ? <Overview snapshot={snapshot} currentUser={currentUser} simpleMode={effectiveSimpleMode} onOpen={navigateToView} onOpenQrScanner={() => setScanOverlayOpen(true)} onDownloadSalesDsr={() => downloadHomeDailySalesReportPdf(snapshot, currentUser)} onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")} onCreatePurchaseAdvance={(body) => post("/payments/purchase-advance", body, "Purchase advance recorded.")} /> : null}
          {activeView === "Users" ? <TwoCol left={<Panel title="Create User" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/users", { ...userForm, role: userForm.roles[0], roles: userForm.roles }, "User created.", () => setUserForm({ username: "", fullName: "", mobileNumber: "", roles: ["Purchaser"], warehouseIds: [], password: "1234" })); }}><label>Username<input value={userForm.username} onChange={(e) => setUserForm((c) => ({ ...c, username: e.target.value }))} /></label><label>Name<input value={userForm.fullName} onChange={(e) => setUserForm((c) => ({ ...c, fullName: e.target.value }))} /></label><label>Mobile<input value={userForm.mobileNumber} onChange={(e) => setUserForm((c) => ({ ...c, mobileNumber: e.target.value }))} /></label><label>Roles<select multiple value={userForm.roles} onChange={(e) => setUserForm((c) => ({ ...c, roles: Array.from(e.target.selectedOptions).map((option) => option.value as UserRole) }))}>{userRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></label><label>Warehouses<select multiple value={userForm.warehouseIds} onChange={(e) => setUserForm((c) => ({ ...c, warehouseIds: Array.from(e.target.selectedOptions).map((option) => option.value) }))}>{snapshot.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.name}</option>)}</select></label><label>Password<input value={userForm.password} onChange={(e) => setUserForm((c) => ({ ...c, password: e.target.value }))} /></label><button className="primary-button" type="submit">Create user</button></form></Panel>} right={<Panel title="Users" eyebrow="Directory"><DataTable headers={["Username","Name","Roles","Warehouses","Mobile"]} rows={snapshot.users.map((u) => [u.username, u.fullName, (u.roles && u.roles.length > 0 ? u.roles : [u.role]).join(", "), (u.warehouseIds || []).join(", ") || "All", u.mobileNumber])} /></Panel>} /> : null}
          {activeView === "Warehouses" ? <TwoCol left={<Panel title="Create Warehouse" eyebrow="Admin"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/warehouses", warehouseForm, "Warehouse created.", () => setWarehouseForm({ id: "", name: "", city: "Bhopal", address: "", type: "Warehouse" })); }}><label>Code<input value={warehouseForm.id} onChange={(e) => setWarehouseForm((c) => ({ ...c, id: e.target.value }))} /></label><label>Name<input value={warehouseForm.name} onChange={(e) => setWarehouseForm((c) => ({ ...c, name: e.target.value }))} /></label><label>City<input value={warehouseForm.city} onChange={(e) => setWarehouseForm((c) => ({ ...c, city: e.target.value }))} /></label><label>Type<select value={warehouseForm.type} onChange={(e) => setWarehouseForm((c) => ({ ...c, type: e.target.value as "Warehouse" | "Yard" }))}><option>Warehouse</option><option>Yard</option></select></label><label className="wide-field">Address<input value={warehouseForm.address} onChange={(e) => setWarehouseForm((c) => ({ ...c, address: e.target.value }))} /></label><button className="primary-button" type="submit">Create warehouse</button></form></Panel>} right={<Panel title="Warehouses" eyebrow="Receiving points"><DataTable headers={["Code","Name","City","Type"]} rows={snapshot.warehouses.map((w) => [w.id, w.name, w.city, w.type])} /></Panel>} /> : null}
          {activeView === "Products" ? <ProductAdminView snapshot={snapshot} productForm={productForm} setProductForm={setProductForm} bulkCsv={bulkCsv} setBulkCsv={setBulkCsv} setBulkCsvFile={setBulkCsvFile} onCreate={(body) => post("/products", body, "Product created.")} onUpdate={(sku, body) => patch(`/products/${encodeURIComponent(sku)}`, body, "Product updated.")} onDelete={(sku) => remove(`/products/${encodeURIComponent(sku)}`, "Product deleted.")} onBulkImport={(rows) => post("/products/bulk", { rows }, "CSV products imported.")} onBulkUpload={async () => { if (!bulkCsvFile) { setError("Select a CSV or Excel file first."); return; } const data = await uploadFile("/products/bulk-upload", "csv", bulkCsvFile, "Product file uploaded and imported."); if (data && typeof data === "object" && "products" in data) setSnapshot(data as AppSnapshot); }} /> : null}
          {activeView === "ExcelMaker" ? <StandaloneExcelMaker /> : null}
          {activeView === "GoodsWarrants" ? <GoodsWarrantView snapshot={snapshot} sessionToken={sessionToken} setSnapshot={setSnapshot} setLoading={setLoading} setError={setError} setMessage={setMessage} /> : null}
          {activeView === "Parties" ? partiesView : null}
          {activeView === "Purchase" ? (isAdminUser ? <AnalystPurchaseView snapshot={snapshot} orders={snapshot.purchaseOrders} /> : <>
            <PurchaserPurchaseWorkspace
              snapshot={snapshot}
              currentUser={currentUser}
              products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
              suppliers={suppliers}
              warehouses={warehousesView}
              paymentMethods={paymentMethods}
              stockSummary={stockSummaryView}
              purchaseOrders={purchaseOrdersView}
              orderForm={purchaseForm}
              setOrderForm={setPurchaseForm}
              searchRequestToken={purchaseCatalogSearchToken}
              onCreateParty={createPartyRecord}
              onUploadProof={(file) => uploadFile("/payments/upload-proof", "proof", file, "Advance proof uploaded.")}
              onSubmit={async (advancePayment, operationDate, lines) => {
                if (!currentUser || !sessionToken) return false;
                setLoading(true);
                setError("");
                setMessage("");
                try {
                  const previousIds = new Set(groupPurchaseOrders(snapshot.purchaseOrders).map((group) => group.id));
                  const { data } = await api.post<AppSnapshot>("/purchase-orders/cart", { ...purchaseForm, lines: lines.map((line) => ({ productSku: line.productSku, quantityOrdered: Number(line.quantity), rate: Number(line.rate), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0), gstAmount: Number(line.gstAmount || 0), taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode, previousRate: Number(line.previousRate || 0) })), cashTiming: purchaseForm.paymentMode === "Cash" ? purchaseForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, {
                    headers: { authorization: `Bearer ${sessionToken}` }
                  });
                  setSnapshot(data);
                  setMessage("Purchase cart created.");
                  const nextGroups = groupPurchaseOrders(data.purchaseOrders);
                  const created = nextGroups.find((group) => !previousIds.has(group.id)) || nextGroups.sort((left, right) => groupNewestCreatedAt(right.lines) - groupNewestCreatedAt(left.lines))[0];
                  return created ? { orderId: created.id, kind: "purchase" as const } : true;
                } catch (submitError) {
                  setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Action failed.") : "Action failed.");
                  return false;
                } finally {
                  setLoading(false);
                }
              }}
              onUpdateCart={(orderId, body) => patch(`/purchase-orders/${encodeURIComponent(orderId)}`, body, "Purchase cart updated.")}
              initialUpdateOrderId={purchaseUpdateOrderId}
              onExitEditor={closePurchaseEditor}
              onEditorDirtyChange={setPurchaseEditorDirty}
            />
          </>) : null}
          {activeView === "Purchases" ? ((isDataAnalyst || isAccountsUser) ? <AnalystPurchaseView snapshot={snapshot} orders={purchaseOrdersView} /> : <PurchaserPurchaseSummary snapshot={snapshot} currentUser={currentUser} orders={purchaseOrdersView.filter((order) => isAdminUser || order.purchaserId === currentUser.id || order.purchaserName === currentUser.fullName)} onUpdatePo={(orderId) => { setPurchaseEditorDirty(false); setPurchaseUpdateOrderId(orderId); setActiveView("Purchase"); }} onOpenStatus={(target) => openOrderStatus(target)} />) : null}
          {activeView === "PurchaseReturns" ? <ReturnsWorkspace
            side="Purchase"
            snapshot={snapshot}
            currentUser={currentUser}
            parties={suppliers}
            warehouses={warehousesView}
            products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
            onUploadProof={(file) => uploadFile("/returns/upload-proof", "returnProof", file, "Return proof uploaded.")}
            onSubmit={(body) => post("/purchase-returns", body, "Purchase return saved.")}
          /> : null}
          {activeView === "Sales" ? (isAdminUser ? <AnalystSalesView snapshot={snapshot} orders={snapshot.salesOrders} /> : (salesUpdateOrderId ? <SalesOrderEditor snapshot={snapshot} currentUser={currentUser} initialOrderId={salesUpdateOrderId} onNewOrder={closeSalesEditor} onDirtyChange={setSalesEditorDirty} onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")} /> : <CatalogOrderView
            snapshot={snapshot}
            mode="sales"
            title="Salesman Order Booking"
            eyebrow="Customer order booking"
            products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
            parties={shops}
            warehouses={warehousesView}
            paymentMethods={paymentMethods}
            stockSummary={stockSummaryView}
            purchaseOrders={purchaseOrdersView}
            orderForm={salesForm}
            setOrderForm={setSalesForm}
            persistKey={workspaceStorageKey(currentUser.id, "sales-catalog")}
            searchRequestToken={salesCatalogSearchToken}
            onCreateParty={createPartyRecord}
            onUpdateParty={updatePartyGstin}
            onUploadProof={(file) => uploadFile("/payments/upload-proof", "proof", file, "Advance proof uploaded.")}
            onSubmit={async (advancePayment, operationDate, lines, options) => {
              if (!currentUser || !sessionToken) return false;
              setLoading(true);
              setError("");
              setMessage("");
              try {
                const previousIds = new Set(groupSalesOrders(snapshot.salesOrders).map((group) => group.id));
                const { data } = await api.post<AppSnapshot>("/sales-orders/cart", { ...salesForm, allowProbationarySale: Boolean(options?.allowProbationarySale), lines: lines.map((line) => ({ productSku: line.productSku, quantity: Number(line.quantity), rate: Number(line.rate), cdTodRate: Number(line.cdTodRate || 0), cdAmount: Number(line.cdAmount || 0), todAmount: Number(line.todAmount || 0), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? 0 : Number(line.gstRate || 0), gstAmount: Number(line.gstAmount || 0), taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode, minimumAllowedRate: Number(line.minimumAllowedRate || 0), availableStockAtOrder: Number(line.availableStockAtOrder || 0), priceApprovalRequested: Boolean(line.priceApprovalRequested), stockApprovalRequested: Boolean(line.stockApprovalRequested), note: line.note || salesForm.note })), cashTiming: salesForm.paymentMode === "Cash" ? salesForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, {
                  headers: { authorization: `Bearer ${sessionToken}` }
                });
                setSnapshot(data);
                setMessage("Sales cart created.");
                const nextGroups = groupSalesOrders(data.salesOrders);
                const created = nextGroups.find((group) => !previousIds.has(group.id)) || nextGroups.sort((left, right) => groupNewestCreatedAt(right.lines) - groupNewestCreatedAt(left.lines))[0];
                return created ? { orderId: created.id, kind: "sales" as const } : true;
              } catch (submitError) {
                setError(axios.isAxiosError(submitError) ? String(submitError.response?.data?.message || submitError.message || "Action failed.") : "Action failed.");
                return false;
              } finally {
                setLoading(false);
              }
            }}
            rightPanel={null}
          />)) : null}
          {activeView === "SalesOrders" ? ((isDataAnalyst || isAccountsUser) ? <AnalystSalesView snapshot={snapshot} orders={salesOrdersView} /> : <SalesOrderSummary snapshot={snapshot} currentUser={currentUser} orders={salesOrdersView.filter((order) => isAdminUser || isCollectionAgent || order.salesmanId === currentUser.id || order.salesmanName === currentUser.fullName)} onUpdateSo={(orderId) => { setSalesEditorDirty(false); setSalesUpdateOrderId(orderId); setActiveView("Sales"); }} onCreatePayment={(body) => post("/payments", body, "Collection saved for accounts reconciliation.")} onTagCollectionAgent={(orderId, assignedTo) => post("/notes", { entityType: "Sales Order", entityId: orderId, note: `Collection assignment: ${assignedTo}`, visibility: "Operational" }, "Collection agent tagged.")} onLogCollectionNote={(orderId, note) => post("/notes", { entityType: "Sales Order", entityId: orderId, note, visibility: "Operational" }, "Collection override logged.")} onOpenStatus={(target) => openOrderStatus(target)} />) : null}
          {activeView === "SalesReturns" ? <ReturnsWorkspace
            side="Sales"
            snapshot={snapshot}
            currentUser={currentUser}
            parties={shops}
            warehouses={warehousesView}
            products={applyWarehouseScope ? snapshot.products.filter((product) => product.allowedWarehouseIds.some((id) => warehouseScope.has(id))) : snapshot.products}
            onUploadProof={(file) => uploadFile("/returns/upload-proof", "returnProof", file, "Return proof uploaded.")}
            onSubmit={(body) => post("/sales-returns", body, "Sales return saved.")}
          /> : null}
          {activeView === "Payments" ? (
            isAdminUser ? (
              <Panel title="Payment Details" eyebrow="Admin view"><DataTable headers={["Payment","Side","Order","Mode","Reference","Status"]} rows={snapshot.payments.map((p) => [p.id, p.side, p.linkedOrderId, p.mode, p.referenceNumber || "-", p.verificationStatus])} /></Panel>
            ) : isPurchaserOnly ? (
              <PurchaserPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Payment submitted to accounts.")}
                onUpdatePayment={(id, body) => patch(`/payments/${id}`, body, "Payment updated.")}
              />
            ) : isSalesOnly ? (
              <SalesPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Collection submitted to accounts.")}
                onUpdatePayment={(id, body) => patch(`/payments/${id}`, body, "Payment updated.")}
                scope="mine"
              />
            ) : isCollectionAgent ? (
              <SalesPaymentsView
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Collection submitted to accounts.")}
                onUpdatePayment={(id, body) => patch(`/payments/${id}`, body, "Payment updated.")}
                scope="all"
              />
            ) : (isAccountsUser || currentRoles.includes("Admin")) ? (
              <AccountsPaymentsView
                snapshot={snapshot}
                onUploadProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Payment proof uploaded.")}
                onCreatePayment={(body) => post("/payments", body, "Payment recorded.")}
                onCreatePurchaseAdvance={(body) => post("/payments/purchase-advance", body, "Purchase advance recorded.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Cash handover task created.")}
                onVerify={(paymentId, verificationStatus, verificationNote) => post("/payments/verify", { paymentId, verificationStatus, verificationNote }, `Payment ${verificationStatus.toLowerCase()}.`)}
                onOpenSupplierUpdate={openSupplierUpdateFromAnywhere}
              />
            ) : null
          ) : null}
          {activeView === "Receipts" ? (
            isAdminUser ? (
              <Panel title="Receipt Checks" eyebrow="Admin view"><DataTable headers={["GRC","PO","Warehouse","Received","Pending","Flagged"]} rows={snapshot.receiptChecks.map((item) => [item.grcNumber, item.purchaseOrderId, item.warehouseId, item.receivedQuantity, item.pendingQuantity, item.flagged ? "Yes" : "No"])} /></Panel>
            ) : isWarehouseOnly || currentRoles.includes("Warehouse Manager") ? (
              <WarehouseOperationsViewV2
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/receipt-checks/upload-proof", "receiptProof", file, "Weighing proof uploaded.")}
                onUploadPaymentProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Cash proof uploaded.")}
                onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Inbound docket received.")}
                onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                onCreateDockets={(body) => post("/delivery-dockets", body, "Outbound dockets created.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Delivery task assigned.")}
                onMergeDeliveryTasks={(body) => post("/delivery-tasks/merge", body, "Outbound deliveries merged.")}
                onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
                screen="in"
              />
            ) : null
          ) : null}
          {activeView === "Ledger" ? (isAccountsUser ? <AccountsLedgerWorkspace snapshot={snapshot} /> : <TwoCol left={<Panel title="Ledger" eyebrow="Accounts visibility"><DataTable headers={["ID","Side","Order","Party","Goods","Paid","Pending"]} rows={snapshot.ledgerEntries.map((l) => [l.id, l.side, l.linkedOrderId, l.partyName, l.goodsValue, l.paidAmount, l.pendingAmount])} /></Panel>} right={<Panel title="Order Financial State" eyebrow="Pending vs settled"><DataTable headers={["Purchase/Sales","ID","Status"]} rows={[...groupPurchaseRows(snapshot.purchaseOrders).map((row) => ["Purchase", row[0], row[6]]), ...groupSalesRows(snapshot.salesOrders).map((row) => ["Sales", row[0], row[6]])]} /></Panel>} />) : null}
          {activeView === "Stock" ? (
            isDataAnalyst ? <AnalystInventoryView snapshot={snapshot} /> :
            isWarehouseOnly || currentRoles.includes("Warehouse Manager") ? (
              <WarehouseOperationsViewV2
                snapshot={snapshot}
                currentUser={currentUser}
                onUploadProof={async (file) => uploadFile("/receipt-checks/upload-proof", "receiptProof", file, "Weighing proof uploaded.")}
                onUploadPaymentProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Cash proof uploaded.")}
                onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
                onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                onCreateDockets={(body) => post("/delivery-dockets", body, "Outbound dockets created.")}
                onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Delivery task assigned.")}
                onMergeDeliveryTasks={(body) => post("/delivery-tasks/merge", body, "Outbound deliveries merged.")}
                onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
                screen="out"
              />
            ) : <TwoCol left={<Panel title="Closing Stock" eyebrow="Warehouse and admin"><DataTable headers={["Warehouse","SKU","Product","Avail","Reserved","Blocked"]} rows={snapshot.stockSummary.map((s) => [s.warehouseName, s.productSku, s.productName, s.availableQuantity, s.reservedQuantity, s.blockedQuantity])} /></Panel>} right={<Panel title="Inventory Lots" eyebrow="Traceability"><DataTable headers={["Lot","Order","Warehouse","SKU","Avail","Blocked"]} rows={snapshot.inventoryLots.map((i) => [i.lotId, i.sourceOrderId, i.warehouseId, i.productSku, i.quantityAvailable, i.quantityBlocked])} /></Panel>} />
          ) : null}
          {activeView === "Delivery" || activeView === "CurrentDelivery" || activeView === "NewAssignment" ? (
            isAdminUser ? (
              <Panel title="Delivery Details" eyebrow="Admin view"><DataTable headers={["ID","Side","Orders","Assigned","Mode","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.assignedTo, d.mode, d.status])} /></Panel>
            ) : isDeliveryOnly ? (
              <DeliveryJobsView
                snapshot={snapshot}
                currentUser={currentUser}
                initialTab={activeView === "NewAssignment" ? "new" : "current"}
                showInternalTabs={false}
                onUploadProof={async (file) => uploadFile("/delivery-tasks/upload-proof", "deliveryProof", file, "Delivery proof uploaded.")}
                onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
              />
            ) : isDeliveryManager ? (
              deliveryManagerScreen === "home" ? (
                <DeliveryManagerHome
                  snapshot={deliveryManagerSnapshot}
                  warehouses={deliveryManagerWarehouseOptions}
                  warehousePendingCounts={deliveryManagerWarehousePendingCounts}
                  selectedWarehouseId={activeDeliveryManagerWarehouseId}
                  onSelectWarehouse={setDeliveryManagerWarehouseId}
                  onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
                  onFlagTask={(task, note) => post("/notes", { entityType: "Delivery", entityId: task.id, note, visibility: "Operational" }, "Delivery flag added.")}
                  onOpenReceive={() => setDeliveryManagerScreen("in")}
                  onOpenDispatch={() => setDeliveryManagerScreen("out")}
                />
              ) : (
              <>
                <Panel title="Warehouse" eyebrow="Delivery scope">
                  <div className="segmented-tabs">
                    {deliveryManagerWarehouseOptions.map((warehouse) => (
                      <button key={warehouse.id} className={activeDeliveryManagerWarehouseId === warehouse.id ? "tab-button active" : "tab-button"} type="button" onClick={() => setDeliveryManagerWarehouseId(warehouse.id)}>
                        <LabelWithBadge label={warehouse.name.replace(/\s+(warehouse|yard)$/i, "")} count={deliveryManagerWarehousePendingCounts.get(warehouse.id) || 0} />
                      </button>
                    ))}
                  </div>
                </Panel>
                <WarehouseOperationsViewV2
                  snapshot={deliveryManagerSnapshot}
                  currentUser={currentUser}
                  onUploadProof={async (file) => uploadFile("/receipt-checks/upload-proof", "receiptProof", file, "Weighing proof uploaded.")}
                  onUploadPaymentProof={async (file) => uploadFile("/payments/upload-proof", "proof", file, "Cash proof uploaded.")}
                  onReceive={(body) => post("/receipt-checks", body, "Warehouse receipt saved.")}
                  onUpdateTask={(id, body) => patch(`/delivery-tasks/${id}`, body, "Delivery task updated.")}
                  onUpdateSalesOrder={(id, body) => patch(`/sales-orders/${id}`, body, "Sales order updated.")}
                  onCreateDockets={(body) => post("/delivery-dockets", body, "Outbound dockets created.")}
                  onCreateDeliveryTask={(body) => post("/delivery-tasks", body, "Delivery task assigned.")}
                  onMergeDeliveryTasks={(body) => post("/delivery-tasks/merge", body, "Outbound deliveries merged.")}
                  onCreateConsignment={(body) => post("/delivery-consignments", body, "Consignment created.")}
                  screen={deliveryManagerScreen}
                  canManageDeliveryTagging={true}
                  canManageWarehouseChecks={false}
                />
              </>
              )
            ) : (isWarehouseOnly || currentRoles.includes("Warehouse Manager")) ? (
              <WarehouseDeliveryBoard snapshot={snapshot} />
            ) : <TwoCol left={<Panel title="Delivery Task" eyebrow="Pickup and drop"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/delivery-tasks", { ...deliveryForm, freightAmount: Number(deliveryForm.freightAmount || 0), linkedOrderIds: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "" }, "Delivery task created."); }}><label>Side<select value={deliveryForm.side} onChange={(e) => setDeliveryForm((c) => ({ ...c, side: e.target.value as DeliveryTask["side"] }))}><option>Purchase</option><option>Sales</option></select></label><label className="wide-field">Orders<input value={deliveryForm.linkedOrderIdsText} onChange={(e) => setDeliveryForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} placeholder="PO-1, SO-2" /></label><label>Mode<select value={deliveryForm.mode} onChange={(e) => setDeliveryForm((c) => ({ ...c, mode: e.target.value as DeliveryTask["mode"] }))}><option>Dealer Delivery</option><option>Self Collection</option><option>Delivery</option></select></label><label>Transport<select value={deliveryForm.transportType} onChange={(e) => setDeliveryForm((c) => ({ ...c, transportType: e.target.value as DeliveryTask["transportType"] }))}><option>Internal</option><option>External</option></select></label><label>Status<select value={deliveryForm.status} onChange={(e) => setDeliveryForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label>From<input value={deliveryForm.from} onChange={(e) => setDeliveryForm((c) => ({ ...c, from: e.target.value }))} /></label><label>To<input value={deliveryForm.to} onChange={(e) => setDeliveryForm((c) => ({ ...c, to: e.target.value }))} /></label><label>Assigned<input value={deliveryForm.assignedTo} onChange={(e) => setDeliveryForm((c) => ({ ...c, assignedTo: e.target.value }))} placeholder="delivery" /></label><label>Vehicle<input value={deliveryForm.vehicleNumber} onChange={(e) => setDeliveryForm((c) => ({ ...c, vehicleNumber: e.target.value }))} /></label><label>Freight<input type="number" step="any" value={deliveryForm.freightAmount} onChange={(e) => setDeliveryForm((c) => ({ ...c, freightAmount: e.target.value }))} /></label><label>Pickup time<input value={deliveryForm.pickupAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, pickupAt: e.target.value }))} placeholder="2026-04-04 10:30" /></label><label>Drop time<input value={deliveryForm.dropAt} onChange={(e) => setDeliveryForm((c) => ({ ...c, dropAt: e.target.value }))} placeholder="2026-04-04 13:00" /></label><label>Route hint<input value={deliveryForm.routeHint} onChange={(e) => setDeliveryForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryForm.paymentAction} onChange={(e) => setDeliveryForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryForm.cashCollectionRequired} onChange={(e) => setDeliveryForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><button className="primary-button" type="submit">Create task</button></form></Panel>} right={<><Panel title="Update Delivery" eyebrow="Assignment and completion"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void patch(`/delivery-tasks/${deliveryEditForm.id}`, { linkedOrderIds: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean), linkedOrderId: deliveryEditForm.linkedOrderIdsText.split(",").map((item) => item.trim()).filter(Boolean)[0] || "", assignedTo: deliveryEditForm.assignedTo, transportType: deliveryEditForm.transportType, vehicleNumber: deliveryEditForm.vehicleNumber, freightAmount: Number(deliveryEditForm.freightAmount || 0), pickupAt: deliveryEditForm.pickupAt, dropAt: deliveryEditForm.dropAt, routeHint: deliveryEditForm.routeHint, paymentAction: deliveryEditForm.paymentAction, cashCollectionRequired: deliveryEditForm.cashCollectionRequired, cashHandoverMarked: deliveryEditForm.cashHandoverMarked, weightProofName: deliveryEditForm.weightProofName, cashProofName: deliveryEditForm.cashProofName, status: deliveryEditForm.status }, "Delivery task updated."); }}><label>Task<select value={deliveryEditForm.id} onChange={(e) => { const item = snapshot.deliveryTasks.find((d) => d.id === e.target.value); setDeliveryEditForm(item ? { id: item.id, linkedOrderIdsText: item.linkedOrderIds.join(", "), assignedTo: item.assignedTo, transportType: item.transportType, vehicleNumber: item.vehicleNumber || "", freightAmount: String(item.freightAmount || 0), pickupAt: item.pickupAt || "", dropAt: item.dropAt || "", routeHint: item.routeHint || "", paymentAction: item.paymentAction, cashCollectionRequired: item.cashCollectionRequired, cashHandoverMarked: item.cashHandoverMarked, weightProofName: item.weightProofName || "", cashProofName: item.cashProofName || "", status: item.status } : { id: "", linkedOrderIdsText: "", assignedTo: "", transportType: "Internal", vehicleNumber: "", freightAmount: "0", pickupAt: "", dropAt: "", routeHint: "", paymentAction: "None", cashCollectionRequired: false, cashHandoverMarked: false, weightProofName: "", cashProofName: "", status: "Planned" }); }}>{snapshot.deliveryTasks.map((d) => <option key={d.id} value={d.id}>{d.id}</option>)}</select></label><label className="wide-field">Orders<input value={deliveryEditForm.linkedOrderIdsText} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, linkedOrderIdsText: e.target.value }))} /></label><label>Assigned<input value={deliveryEditForm.assignedTo} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, assignedTo: e.target.value }))} /></label><label>Transport<select value={deliveryEditForm.transportType} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, transportType: e.target.value as DeliveryTask["transportType"] }))}><option>Internal</option><option>External</option></select></label><label>Vehicle<input value={deliveryEditForm.vehicleNumber} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, vehicleNumber: e.target.value }))} /></label><label>Freight<input type="number" step="any" value={deliveryEditForm.freightAmount} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, freightAmount: e.target.value }))} /></label><label>Pickup time<input value={deliveryEditForm.pickupAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, pickupAt: e.target.value }))} /></label><label>Drop time<input value={deliveryEditForm.dropAt} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, dropAt: e.target.value }))} /></label><label>Route hint<input value={deliveryEditForm.routeHint} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, routeHint: e.target.value }))} /></label><label>Payment action<select value={deliveryEditForm.paymentAction} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, paymentAction: e.target.value as DeliveryTask["paymentAction"] }))}><option>None</option><option>Collect Payment</option><option>Deliver Payment</option></select></label><label>Status<select value={deliveryEditForm.status} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, status: e.target.value as DeliveryTask["status"] }))}><option>Planned</option><option>Picked</option><option>Handed Over</option><option>Delivered</option></select></label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashCollectionRequired} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashCollectionRequired: e.target.checked }))} />Cash collection required</label><label className="checkbox-line"><input type="checkbox" checked={deliveryEditForm.cashHandoverMarked} onChange={(e) => setDeliveryEditForm((c) => ({ ...c, cashHandoverMarked: e.target.checked }))} />Cash handover marked</label><button className="primary-button" type="submit">Update task</button></form></Panel><Panel title="Delivery Tasks" eyebrow="Transport flow"><DataTable headers={["ID","Side","Orders","Mode","Transport","Assigned","Status"]} rows={snapshot.deliveryTasks.map((d) => [d.id, d.side, d.linkedOrderIds.join(", "), d.mode, `${d.transportType}${d.vehicleNumber ? ` / ${d.vehicleNumber}` : ""}${d.freightAmount ? ` / ${d.freightAmount.toFixed(2)}` : ""}`, d.assignedTo, deliveryTaskStatusLabel(d)])} /></Panel></>} />
          ) : null}
          {activeView === "Settings" ? <Panel title="Admin Settings" eyebrow="Payment methods and delivery"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/settings", snapshot.settings, "Settings updated."); }}>{snapshot.settings.paymentMethods.map((item, index) => <label key={item.code}>{item.code}<div className="settings-line"><input type="checkbox" checked={item.active} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, active: e.target.checked } : method) } }) : current)} />Active<input type="checkbox" checked={item.allowsCashTiming} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, paymentMethods: current.settings.paymentMethods.map((method, methodIndex) => methodIndex === index ? { ...method, allowsCashTiming: e.target.checked } : method) } }) : current)} />Cash timing</div></label>)}<label>Delivery model<select value={snapshot.settings.deliveryCharge.model} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, model: e.target.value as "Fixed" | "Per Km" } } }) : current)}><option>Fixed</option><option>Per Km</option></select></label><label>Delivery amount<input type="number" step="any" value={snapshot.settings.deliveryCharge.amount} onChange={(e) => setSnapshot((current) => current ? ({ ...current, settings: { ...current.settings, deliveryCharge: { ...current.settings.deliveryCharge, amount: Number(e.target.value) } } }) : current)} /></label><button className="primary-button" type="submit">Save settings</button></form></Panel> : null}
          {activeView === "Notes" ? (isAdminUser ? <Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel> : <TwoCol left={<Panel title="Add Note" eyebrow="Authorized viewers"><form className="form-grid" onSubmit={(e) => { e.preventDefault(); void post("/notes", noteForm, "Note added.", () => setNoteForm({ entityType: "Purchase Order", entityId: "", note: "", visibility: "Operational" })); }}><label>Entity<select value={noteForm.entityType} onChange={(e) => setNoteForm((c) => ({ ...c, entityType: e.target.value as NoteRecord["entityType"] }))}><option>Purchase Order</option><option>Receipt</option><option>Sales Order</option><option>Payment</option><option>Delivery</option><option>Inventory</option><option>Party</option></select></label><label>ID<input value={noteForm.entityId} onChange={(e) => setNoteForm((c) => ({ ...c, entityId: e.target.value }))} /></label><label>Visibility<select value={noteForm.visibility} onChange={(e) => setNoteForm((c) => ({ ...c, visibility: e.target.value as NoteRecord["visibility"] }))}><option>Restricted</option><option>Operational</option><option>Management</option></select></label><label className="wide-field">Note<textarea value={noteForm.note} onChange={(e) => setNoteForm((c) => ({ ...c, note: e.target.value }))} /></label><button className="primary-button" type="submit">Add note</button></form></Panel>} right={<Panel title="Notes Feed" eyebrow="Audit trail"><DataTable headers={["Entity","ID","Note","By","Visibility"]} rows={snapshot.notes.map((n) => [n.entityType, n.entityId, n.note, n.createdBy, n.visibility])} /></Panel>} />) : null}
          </Suspense>
        </div>
      </section>
      {scanOverlayOpen ? <QrScanOverlay onClose={() => setScanOverlayOpen(false)} onScan={handleQrScan} /> : null}
      {orderStatusTarget ? <OrderStatusOverlay snapshot={snapshot} currentUser={currentUser} target={orderStatusTarget} onClose={() => setOrderStatusTarget(null)} onOpenAction={(target) => openOrderStatus(target, true)} /> : null}
      {isDeliveryManager ? <nav className={effectiveSimpleMode ? "mobile-tab-bar simple-tab-bar delivery-manager-tab-bar" : "mobile-tab-bar delivery-manager-tab-bar"}>
        <button type="button" className={activeView === "Delivery" && deliveryManagerScreen === "home" ? "tab-button active" : "tab-button"} onClick={() => { setDeliveryManagerScreen("home"); setActiveView("Delivery"); }}><LabelWithBadge label="Home" count={deliveryManagerHomePendingCount} /></button>
        <button type="button" className={activeView === "Delivery" && deliveryManagerScreen === "in" ? "tab-button active" : "tab-button"} onClick={() => { setDeliveryManagerScreen("in"); setActiveView("Delivery"); }}><LabelWithBadge label="Inbound" count={deliveryManagerInboundPendingCount} /></button>
        <button type="button" className={activeView === "Delivery" && deliveryManagerScreen === "out" ? "tab-button active" : "tab-button"} onClick={() => { setDeliveryManagerScreen("out"); setActiveView("Delivery"); }}><LabelWithBadge label="Dispatch" count={deliveryManagerDispatchPendingCount} /></button>
      </nav> : <nav className={effectiveSimpleMode ? "mobile-tab-bar simple-tab-bar" : "mobile-tab-bar"}>{bottomNavViews.map((view) => {
        const count = view === "Purchase" || view === "Purchases"
          ? purchaserOrderCount
          : view === "Sales" || view === "SalesOrders"
            ? salesOrderCount
            : 0;
        const isFloatingPoSoButton = (currentRoles.includes("Purchaser") && view === "Purchase") || (currentRoles.includes("Sales") && view === "Sales");
        return <button key={view} type="button" className={`${view === activeView ? "tab-button active" : "tab-button"}${currentRoles.includes("Purchaser") && view === "Purchase" ? " purchaser-po-tab" : ""}${currentRoles.includes("Sales") && view === "Sales" ? " purchaser-po-tab" : ""}`} onClick={() => navigateToView(view)}>{count > 0 && !isFloatingPoSoButton ? <LabelWithBadge label={displayLabel(view, currentUser)} count={count} /> : displayLabel(view, currentUser)}</button>;
      })}</nav>}
    </main>
  );
}

export default App;
