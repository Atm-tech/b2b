import type {
AppSnapshot,
Counterparty,
PaymentMode
} from "@aapoorti-b2b/domain";
import { useEffect,useRef,useState } from "react";
import { createPortal } from "react-dom";
import { productCategoryLabel,renderOptions,renderWarehouseOptions } from "../../app/formOptions";
import { SidebarVectorIcon } from "../../components/navigation";
import { Panel,TwoCol } from "../../components/ui";
import { buildCatalogDisplayProducts,catalogCardTitle,CatalogDisplayProduct,catalogVariantOptionLabel,normalizeStaplesWeightLabel,productDisplayLabel,productUnitWeightKg } from "./catalogUtils";

import {
API_BASE,
buildPurchaseInvoicePdf,
buildSalesInvoicePdf,
calculateTaxPreview,
downloadBlobFile,
downloadPurchaseInvoicePdf,
downloadSalesInvoicePdf,
groupPurchaseOrders,
groupSalesOrders,
GstRateInput,
preferredWarehouseId,
printPurchaseInvoice,
printSalesInvoice,
readStoredJson,
safePdfFileName,
shareInvoicePdfFile,
sharePurchaseInvoicePdf,
shareSalesInvoicePdf,
TaxModeInput,
writeStoredJson
} from "../../app/shared";

export type CatalogOrderViewProps = {
  snapshot: AppSnapshot;
  mode: "purchase" | "sales";
  title: string;
  eyebrow: string;
  persistKey?: string;
  searchRequestToken?: number;
  products: AppSnapshot["products"];
  parties: Counterparty[];
  warehouses: AppSnapshot["warehouses"];
  paymentMethods: AppSnapshot["settings"]["paymentMethods"];
  stockSummary: AppSnapshot["stockSummary"];
  purchaseOrders?: AppSnapshot["purchaseOrders"];
  orderForm: any;
  setOrderForm: React.Dispatch<React.SetStateAction<any>>;
  onCreateParty: (body: Omit<Counterparty, "id" | "createdBy" | "createdAt">) => Promise<Counterparty | null>;
  onUpdateParty?: (party: Counterparty, gstNumber: string) => Promise<Counterparty | null>;
  onUploadProof: (file: File) => Promise<unknown>;
  onSubmit: (advancePayment: { amount: number; mode: PaymentMode; cashTiming?: string; referenceNumber?: string; voucherNumber?: string; utrNumber?: string; proofName?: string; verificationNote?: string } | undefined, operationDate: string | undefined, lines: CartLine[], options?: { allowProbationarySale?: boolean }) => Promise<boolean | { orderId: string; kind: "purchase" | "sales" } | void> | boolean | { orderId: string; kind: "purchase" | "sales" } | void;
  rightPanel: React.ReactNode;
};

export type CartLine = {
  productSku: string;
  quantity: string;
  rate: string;
  cdTodRate?: string;
  cdAmount?: string;
  todAmount?: string;
  previousRate: string;
  taxableAmount: string;
  gstRate: GstRateInput;
  gstAmount: string;
  taxMode: TaxModeInput;
  priceApprovalRequested?: boolean;
  minimumAllowedRate?: string;
  stockApprovalRequested?: boolean;
  availableStockAtOrder?: string;
  note?: string;
};

export function CatalogOrderView(props: CatalogOrderViewProps) {
  const { snapshot, mode, title, eyebrow, persistKey, searchRequestToken = 0, products, parties, warehouses, paymentMethods, stockSummary, purchaseOrders = [], orderForm, setOrderForm, onCreateParty, onUpdateParty, onUploadProof, onSubmit, rightPanel } = props;
  const persisted = persistKey ? readStoredJson(persistKey, {
    partySearch: "",
    activeDivision: "",
    activeDepartment: "",
    activeSection: "",
    flowStep: (mode === "sales" ? "landing" : "catalog") as "landing" | "existing" | "new" | "catalog",
    cartOpen: false,
    cartStep: "cart" as "cart" | "payment" | "summary",
    billTaxOverride: { enabled: false, gstRate: "0" as GstRateInput, taxMode: "Exclusive" as TaxModeInput },
    cartErrors: {} as Record<string, boolean>,
    cartLines: [] as CartLine[],
    partyDraft: { name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" },
    advancePayment: { enabled: false, amount: "", mode: "" as PaymentMode | "", cashTiming: "In Hand", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "" },
    checkoutDate: "",
    partyDraftErrors: { name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false }
  }) : null;
  const [search, setSearch] = useState("");
  const [partySearch, setPartySearch] = useState(persisted?.partySearch || "");
  const [activeDivision, setActiveDivision] = useState(persisted?.activeDivision || "");
  const [activeDepartment, setActiveDepartment] = useState(persisted?.activeDepartment || "");
  const [activeSection, setActiveSection] = useState(persisted?.activeSection || "");
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [partySuggestionOpen, setPartySuggestionOpen] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
  const [catalogSort, setCatalogSort] = useState<"relevance" | "brand" | "price-asc" | "price-desc" | "margin-desc" | "margin-asc">("relevance");
  const [catalogScope, setCatalogScope] = useState<"all" | "seasonal" | "offers">("all");
  const [brandFilter, setBrandFilter] = useState("");
  const [flowStep, setFlowStep] = useState<"landing" | "existing" | "new" | "catalog">(persisted?.flowStep || (mode === "sales" ? "landing" : "catalog"));
  const [cartOpen, setCartOpen] = useState(Boolean(persisted?.cartOpen));
  const [cartStep, setCartStep] = useState<"cart" | "payment" | "summary">(persisted?.cartStep || "cart");
  const [cartToast, setCartToast] = useState("");
  const [billTaxOverride, setBillTaxOverride] = useState<{ enabled: boolean; gstRate: GstRateInput; taxMode: TaxModeInput }>(persisted?.billTaxOverride || { enabled: false, gstRate: "0", taxMode: "Exclusive" });
  const [cartErrors, setCartErrors] = useState<Record<string, boolean>>(persisted?.cartErrors || {});
  const [cartLines, setCartLines] = useState<CartLine[]>(persisted?.cartLines || []);
  const [catalogVariantSelection, setCatalogVariantSelection] = useState<Record<string, string>>({});
  const [submittingCart, setSubmittingCart] = useState(false);
  const [ratePopup, setRatePopup] = useState<{
    product: AppSnapshot["products"][number];
    quantity: string;
    rate: string;
    cdTodRate: string;
    lastRate: number;
    gstRate: GstRateInput;
    taxMode: TaxModeInput;
    confirmHighRate: boolean;
  } | null>(null);
  const [partyDraft, setPartyDraft] = useState(persisted?.partyDraft || { name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" });
  const [advancePayment, setAdvancePayment] = useState(persisted?.advancePayment || { enabled: false, amount: "", mode: "" as PaymentMode | "", cashTiming: "In Hand", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "" });
  const [advanceUploading, setAdvanceUploading] = useState(false);
  const [checkoutDate, setCheckoutDate] = useState(persisted?.checkoutDate || "");
  const [partyDraftErrors, setPartyDraftErrors] = useState(persisted?.partyDraftErrors || { name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
  const [b2bGstEntry, setB2bGstEntry] = useState("");
  const catalogSearchInputRef = useRef<HTMLInputElement | null>(null);
  const flowCardRef = useRef<HTMLDivElement | null>(null);
  const ratePopupSheetRef = useRef<HTMLDivElement | null>(null);
  const checkoutSheetRef = useRef<HTMLDivElement | null>(null);
  const [completedOrder, setCompletedOrder] = useState<{ orderId: string; kind: "purchase" | "sales" } | null>(null);
  const [completedOrderBillAsset, setCompletedOrderBillAsset] = useState<{ orderId: string; kind: "purchase" | "sales"; fileName: string; blob: Blob } | null>(null);
  const completedOrderDownloadRef = useRef<string>("");
  const isPurchase = mode === "purchase";
  const partyType = isPurchase ? "Supplier" : "Shop";
  const partyLabel = isPurchase ? "supplier / vendor" : "customer / shop";
  const partyDraftGstNa = partyDraft.gstNumber.trim().toUpperCase() === "N/A";
  const partyDraftBankNa = [partyDraft.bankName, partyDraft.bankAccountNumber, partyDraft.ifscCode].every((value) => value.trim().toUpperCase() === "N/A");
  const billingType = String(orderForm.billingType || "") as "" | "B2B" | "B2C";

  function hasValidGstin(value?: string) {
    return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/i.test((value || "").trim());
  }
  const divisions = Array.from(new Set(products.map((item) => productCategoryLabel(item)).filter(Boolean)));
  const brands = Array.from(new Set(products.map((item) => item.brand?.trim()).filter((item): item is string => Boolean(item)))).sort((left, right) => left.localeCompare(right, "en-IN"));
  const normalizedSearch = search.trim().toLowerCase();
  const showingCategoryLanding = activeDivision === "" && normalizedSearch === "";
  useEffect(() => {
    if (!persistKey) return;
    writeStoredJson(persistKey, {
      partySearch,
      activeDivision,
      activeDepartment,
      activeSection,
      flowStep,
      cartOpen,
      cartStep,
      billTaxOverride,
      cartErrors,
      cartLines,
      partyDraft,
      advancePayment,
      checkoutDate,
      partyDraftErrors
    });
  }, [persistKey, partySearch, activeDivision, activeDepartment, activeSection, flowStep, cartOpen, cartStep, billTaxOverride, cartErrors, cartLines, partyDraft, advancePayment, checkoutDate, partyDraftErrors]);
  useEffect(() => {
    if (!searchRequestToken) return;
    setFlowStep("catalog");
    setSuggestionOpen(false);
    setSearchSheetOpen(true);
  }, [searchRequestToken]);
  useEffect(() => {
    if (!searchSheetOpen) return;
    const timeout = window.setTimeout(() => catalogSearchInputRef.current?.focus(), 80);
    return () => window.clearTimeout(timeout);
  }, [searchSheetOpen]);
  function productMatchScore(product: AppSnapshot["products"][number], query: string) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return 0;
    const tokens = normalized.split(/\s+/).filter(Boolean);
    const fields = {
      exactName: product.name.toLowerCase(),
      startsName: product.name.toLowerCase(),
      exactSku: product.sku.toLowerCase(),
      brand: (product.brand || "").toLowerCase(),
      shortName: (product.shortName || "").toLowerCase(),
      barcode: (product.barcode || "").toLowerCase(),
      division: (product.division || "").toLowerCase(),
      department: (product.department || "").toLowerCase(),
      section: (product.section || "").toLowerCase(),
      category: (product.category || "").toLowerCase(),
      subCategory: (product.subCategory || "").toLowerCase(),
      article: (product.articleName || "").toLowerCase(),
      item: (product.itemName || "").toLowerCase(),
      size: (product.size || "").toLowerCase(),
      offer: (product.offerLabel || "").toLowerCase()
    };
    const haystack = Object.values(fields).join(" ");
    if (fields.exactName === normalized) return 1000;
    if (fields.exactSku === normalized || fields.barcode === normalized) return 950;
    if (fields.startsName.startsWith(normalized)) return 900;
    if (fields.shortName.startsWith(normalized)) return 850;
    if (fields.brand.startsWith(normalized)) return 800;
    if (fields.exactName.includes(normalized)) return 700;
    if (fields.shortName.includes(normalized)) return 650;
    if (fields.brand.includes(normalized)) return 600;
    if (fields.department.includes(normalized)) return 500;
    if (fields.subCategory.includes(normalized)) return 480;
    if (fields.category.includes(normalized)) return 470;
    if (fields.section.includes(normalized)) return 450;
    if (fields.division.includes(normalized)) return 400;
    if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) return 350 + tokens.length * 25;
    if (tokens.some((token) => haystack.includes(token))) return 180;
    return 0;
  }
  function productPurchasePrice(product: AppSnapshot["products"][number]) {
    return getLastPurchaseRate(product);
  }

  function productSalePrice(product: AppSnapshot["products"][number]) {
    const latestSale = snapshot.salesOrders
      .filter((item) => item.productSku === product.sku && item.status !== "Cancelled")
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.rate;
    return product.offerPrice && product.offerPrice > 0
      ? product.offerPrice
      : latestSale || product.mrp || product.rsp || productPurchasePrice(product);
  }

  function productMargin(product: AppSnapshot["products"][number]) {
    return productSalePrice(product) - productPurchasePrice(product);
  }

  function matchesCatalogControls(product: AppSnapshot["products"][number]) {
    const matchesBrand = brandFilter === "" || product.brand === brandFilter;
    const matchesScope = catalogScope === "all"
      || (catalogScope === "seasonal" && Boolean(product.isSeasonal))
      || (catalogScope === "offers" && Boolean(product.offerLabel || (product.offerPrice && product.offerPrice > 0)));
    return matchesBrand && matchesScope;
  }

  function sortProducts(left: AppSnapshot["products"][number], right: AppSnapshot["products"][number]) {
    if (catalogSort === "brand") return (left.brand || "Unbranded").localeCompare(right.brand || "Unbranded", "en-IN") || left.name.localeCompare(right.name, "en-IN");
    if (catalogSort === "price-asc") return productSalePrice(left) - productSalePrice(right) || left.name.localeCompare(right.name, "en-IN");
    if (catalogSort === "price-desc") return productSalePrice(right) - productSalePrice(left) || left.name.localeCompare(right.name, "en-IN");
    if (catalogSort === "margin-desc") return productMargin(right) - productMargin(left) || left.name.localeCompare(right.name, "en-IN");
    if (catalogSort === "margin-asc") return productMargin(left) - productMargin(right) || left.name.localeCompare(right.name, "en-IN");
    const scoreDiff = productMatchScore(right, search) - productMatchScore(left, search);
    return scoreDiff || left.name.localeCompare(right.name, "en-IN");
  }

  const filteredProducts = products.filter((product) => {
    const matchesDivision = activeDivision === "" || productCategoryLabel(product) === activeDivision;
    const matchesDepartment = activeDepartment === "" || product.department === activeDepartment;
    const matchesSection = activeSection === "" || product.section === activeSection;
    const matchesSearch = normalizedSearch === "" || productMatchScore(product, search) > 0;
    return matchesDivision && matchesDepartment && matchesSection && matchesSearch && matchesCatalogControls(product);
  }).sort(sortProducts);
  const catalogProducts = buildCatalogDisplayProducts(filteredProducts).sort((left, right) => sortProducts(resolveCatalogProduct(left), resolveCatalogProduct(right)));
  const searchSuggestions = search.trim() === ""
    ? []
    : buildCatalogDisplayProducts(
        products
          .filter((product) => productMatchScore(product, search) > 0 && matchesCatalogControls(product))
          .sort(sortProducts)
      ).slice(0, 6);
  const indexedSearchProducts = buildCatalogDisplayProducts(
    products
      .filter((product) => (normalizedSearch === "" || productMatchScore(product, search) > 0) && matchesCatalogControls(product))
      .sort(sortProducts)
  ).sort((left, right) => sortProducts(resolveCatalogProduct(left), resolveCatalogProduct(right)));
  const partySuggestions = parties
    .filter((party) => {
      const query = partySearch.trim().toLowerCase();
      const haystack = [party.name, party.gstNumber, party.mobileNumber, party.city, party.contactPerson].join(" ").toLowerCase();
      return query === "" || haystack.includes(query);
    })
    .slice(0, 8);

  function applySearchSuggestion(item: CatalogDisplayProduct) {
    addSearchProductToCheckout(resolveCatalogProduct(item));
    setSuggestionOpen(false);
  }

  function applyIndexedSearch(item: CatalogDisplayProduct) {
    setSearchSheetOpen(false);
    addSearchProductToCheckout(resolveCatalogProduct(item));
  }

  function addSearchProductToCheckout(product: AppSnapshot["products"][number]) {
    if (!isPurchase && !selectedPartyId) {
      setSearchSheetOpen(false);
      setFlowStep("existing");
      showCartToast("Select customer before adding this product");
      return;
    }
    const existingLine = cartLines.find((line) => line.productSku === product.sku);
    const purchasePrice = productPurchasePrice(product);
    const rate = isPurchase ? (purchasePrice || product.rsp || product.mrp || 0) : productSalePrice(product);
    if (rate <= 0) {
      setSearchSheetOpen(false);
      selectProduct(product);
      showCartToast("Set a product rate to continue");
      return;
    }
    const quantity = existingLine?.quantity || "1";
    const gstRate = existingLine?.gstRate === "NA" ? "0" : (existingLine?.gstRate || (billTaxOverride.enabled ? billTaxOverride.gstRate : String(product.defaultGstRate === "NA" ? 0 : product.defaultGstRate || 0) as GstRateInput));
    const taxMode = existingLine?.taxMode === "NA" ? "Exclusive" : (existingLine?.taxMode || (billTaxOverride.enabled ? billTaxOverride.taxMode : (product.defaultTaxMode === "NA" ? "Exclusive" : product.defaultTaxMode || "Exclusive")));
    const lineTotals = calculateLineTotals(quantity, String(rate), gstRate, taxMode);
    const resolvedWarehouseId = orderForm.warehouseId || preferredWarehouseId(product.allowedWarehouseIds);
    const availableStockAtOrder = isPurchase ? 0 : getLineAvailableStock(product.sku, resolvedWarehouseId);
    const subsidyBreakdown = isPurchase ? { cdAmount: "0.00", todAmount: "0.00" } : calculateCdTodBreakdown(quantity, String(rate), String(rate));
    const line: CartLine = {
      productSku: product.sku,
      quantity,
      rate: String(rate),
      cdTodRate: isPurchase ? "0" : String(rate),
      cdAmount: subsidyBreakdown.cdAmount,
      todAmount: subsidyBreakdown.todAmount,
      previousRate: String(purchasePrice || 0),
      taxableAmount: lineTotals.taxableAmount,
      gstRate,
      gstAmount: lineTotals.gstAmount,
      taxMode,
      priceApprovalRequested: !isPurchase && purchasePrice > 0 && rate < purchasePrice,
      minimumAllowedRate: String(purchasePrice || 0),
      stockApprovalRequested: !isPurchase && Number(quantity) > availableStockAtOrder,
      availableStockAtOrder: String(availableStockAtOrder),
      note: existingLine?.note || orderForm.note
    };
    setCartLines((current) => [...current.filter((item) => item.productSku !== product.sku), line]);
    setOrderForm((current: any) => ({
      ...current,
      productSku: product.sku,
      rate: String(rate),
      warehouseId: current.warehouseId || resolvedWarehouseId,
      ...(isPurchase ? { quantityOrdered: quantity } : { quantity, priceApprovalRequested: line.priceApprovalRequested, minimumAllowedRate: line.minimumAllowedRate, availableStockAtOrder: line.availableStockAtOrder, stockApprovalRequested: line.stockApprovalRequested }),
      taxableAmount: line.taxableAmount,
      gstRate,
      gstAmount: line.gstAmount,
      taxMode
    }));
    setCartStep("cart");
    setRatePopup(null);
    setSearchSheetOpen(false);
    setCartOpen(true);
  }

  function selectSavedParty(party: Counterparty) {
    if (!isPurchase && cartLines.length > 0 && selectedPartyId && selectedPartyId !== party.id) {
      showCartToast("This cart is locked to the selected customer. Clear cart to change customer.");
      return;
    }
    setPartySearch(party.name);
    setB2bGstEntry(hasValidGstin(party.gstNumber) ? "" : party.gstNumber.trim().toUpperCase() === "N/A" ? "" : party.gstNumber);
    setPartySuggestionOpen(false);
    setCartErrors((current) => ({ ...current, supplierId: false }));
    setOrderForm((current: any) => isPurchase ? ({
      ...current,
      supplierId: party.id,
      locationAddress: party.deliveryAddress || party.address || "",
      locationCity: party.deliveryCity || party.city || ""
    }) : ({
      ...current,
      shopId: party.id,
      locationAddress: party.deliveryAddress || party.address || "",
      locationCity: party.deliveryCity || party.city || ""
    }));
    if (!isPurchase && billingType === "B2B" && !hasValidGstin(party.gstNumber)) {
      showCartToast("Enter and save this customer's GSTIN before continuing with a B2B bill.");
    }
  }

  function chooseBillingType(nextType: "B2B" | "B2C") {
    setOrderForm((current: any) => ({ ...current, billingType: nextType, shopId: "" }));
    setPartySearch("");
    setB2bGstEntry("");
  }

  function continueWithSelectedParty() {
    if (!selectedPartyId) return;
    if (!isPurchase && billingType === "B2B" && !hasValidGstin(selectedParty?.gstNumber)) {
      showCartToast("A valid customer GSTIN is required before continuing with a B2B bill.");
      return;
    }
    setFlowStep("catalog");
  }

  async function saveSelectedCustomerGstin() {
    if (!selectedParty || !onUpdateParty) return;
    const gstNumber = b2bGstEntry.trim().toUpperCase();
    if (!hasValidGstin(gstNumber)) {
      showCartToast("Enter a valid 15-character GSTIN.");
      return;
    }
    const updated = await onUpdateParty(selectedParty, gstNumber);
    if (!updated) return;
    setB2bGstEntry("");
    showCartToast("Customer GSTIN saved. You can continue with the B2B bill.");
  }

  function setVoiceSearch() {
    const speechWindow = window as Window & { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const SpeechRecognitionCtor = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor || voiceBusy) {
      if (!SpeechRecognitionCtor) {
        showCartToast("Voice search is not supported in this browser");
      }
      return;
    }
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-IN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    setVoiceBusy(true);
    recognition.onresult = (event: any) => {
      const transcript = String(event?.results?.[0]?.[0]?.transcript || "").trim();
      if (transcript) {
        setSearch(transcript);
        setSuggestionOpen(true);
        const matchedProduct = products.find((product) => [product.name, product.brand, product.shortName, product.barcode].join(" ").toLowerCase().includes(transcript.toLowerCase()));
        if (matchedProduct) {
          setActiveDivision(productCategoryLabel(matchedProduct));
          setActiveDepartment(matchedProduct.department || "");
          setActiveSection(matchedProduct.section || "");
        }
      }
    };
    recognition.onerror = () => {
      setVoiceBusy(false);
      showCartToast("Voice search could not capture your input");
    };
    recognition.onend = () => setVoiceBusy(false);
    recognition.start();
  }

  function getLastPurchaseRate(product: AppSnapshot["products"][number]) {
    return purchaseOrders
      .filter((item) => item.productSku === product.sku)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0]?.rate
      || product.rsp
      || product.slabs[0]?.purchaseRate
      || 0;
  }

  function resolveCatalogProduct(item: CatalogDisplayProduct) {
    if (!item.familyKey) return item.product;
    const selectedSku = catalogVariantSelection[item.familyKey];
    if (selectedSku) {
      return item.variants.find((variant) => variant.sku === selectedSku) || item.variants[0];
    }
    const variantFromCart = item.variants.find((variant) => cartLines.some((line) => line.productSku === variant.sku));
    return variantFromCart || item.variants[0];
  }

  function setCatalogFamilyVariant(familyKey: string, sku: string) {
    setCatalogVariantSelection((current) => ({ ...current, [familyKey]: sku }));
  }

  function selectProduct(product: AppSnapshot["products"][number]) {
      if (!isPurchase && !selectedPartyId && cartLines.length === 0) {
        setFlowStep("existing");
        showCartToast("Select customer first");
        return false;
      }
      const lastRate = getLastPurchaseRate(product);
      const existingLine = cartLines.find((line) => line.productSku === product.sku);
      setRatePopup({
        product,
        quantity: existingLine?.quantity || "1",
        rate: existingLine?.rate || String(isPurchase ? (lastRate || getSuggestedRate(product) || 0) : ((product.offerPrice && product.offerPrice > 0 ? product.offerPrice : product.mrp) ?? lastRate ?? 0)),
        cdTodRate: existingLine?.cdTodRate || existingLine?.rate || String((product.offerPrice && product.offerPrice > 0 ? product.offerPrice : product.mrp) ?? lastRate ?? 0),
        lastRate,
        gstRate: existingLine?.gstRate === "NA" ? "0" : (existingLine?.gstRate || (billTaxOverride.enabled ? billTaxOverride.gstRate : String(product.defaultGstRate === "NA" ? 0 : product.defaultGstRate || 0) as GstRateInput)),
        taxMode: existingLine?.taxMode === "NA" ? "Exclusive" : (existingLine?.taxMode || (billTaxOverride.enabled ? billTaxOverride.taxMode : (product.defaultTaxMode === "NA" ? "Exclusive" : product.defaultTaxMode || "Exclusive"))),
        confirmHighRate: false
      });
      return true;
  }

  function getOrderQuantity() {
    const value = Number(isPurchase ? orderForm.quantityOrdered : orderForm.quantity);
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getOrderQuantityText() {
    return isPurchase ? String(orderForm.quantityOrdered ?? "") : String(orderForm.quantity ?? "");
  }

  function calculateLineTotals(quantity: string, rate: string, gstRate: GstRateInput, taxMode: TaxModeInput) {
    const lineAmount = Math.max(0, Number(quantity || 0)) * Math.max(0, Number(rate || 0));
    return calculateTax(String(lineAmount), gstRate, taxMode);
  }

  function calculateCdTodBreakdown(quantity: string, rate: string, cdTodRate: string) {
    const qty = Math.max(0, Number(quantity || 0));
    const grossRate = Math.max(0, Number(rate || 0));
    const subsidyRate = Math.max(0, Number(cdTodRate || 0));
    const differencePerUnit = Math.max(0, grossRate - subsidyRate);
    const totalDifference = differencePerUnit * qty;
    const cdAmount = totalDifference / 2;
    const todAmount = totalDifference - cdAmount;
    return {
      cdAmount: cdAmount.toFixed(2),
      todAmount: todAmount.toFixed(2)
    };
  }

  function updateCartLineQuantity(productSku: string, quantity: string) {
    setCartLines((current) => current.map((line) => {
      if (line.productSku !== productSku) return line;
      const totals = calculateLineTotals(quantity, line.rate, line.gstRate, line.taxMode);
      const subsidyBreakdown = isPurchase ? { cdAmount: "0.00", todAmount: "0.00" } : calculateCdTodBreakdown(quantity, line.rate, line.cdTodRate || line.rate);
      if (isPurchase) {
        return { ...line, quantity, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
      }
      const availableStockAtOrder = getLineAvailableStock(line.productSku, orderForm.warehouseId || "");
      return {
        ...line,
        quantity,
        cdAmount: subsidyBreakdown.cdAmount,
        todAmount: subsidyBreakdown.todAmount,
        taxableAmount: totals.taxableAmount,
        gstAmount: totals.gstAmount,
        availableStockAtOrder: String(availableStockAtOrder),
        stockApprovalRequested: Number(quantity || 0) > availableStockAtOrder
      };
    }));
  }

  function updateCartLineTax(productSku: string, updates: Partial<Pick<CartLine, "gstRate" | "taxMode">>) {
    setCartLines((current) => current.map((line) => {
      if (line.productSku !== productSku) return line;
      const gstRate = (updates.gstRate ?? line.gstRate) === "NA" ? "0" : (updates.gstRate ?? line.gstRate);
      const taxMode = (updates.taxMode ?? line.taxMode) === "NA" ? "Exclusive" : (updates.taxMode ?? line.taxMode);
      const totals = calculateLineTotals(line.quantity, line.rate, gstRate, taxMode);
      return { ...line, gstRate, taxMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
  }

  function applyBillTaxToAllLines(gstRate: GstRateInput, taxMode: TaxModeInput) {
    setCartLines((current) => current.map((line) => {
      const nextRate = gstRate === "NA" ? "0" : gstRate;
      const nextMode = taxMode === "NA" ? "Exclusive" : taxMode;
      const totals = calculateLineTotals(line.quantity, line.rate, nextRate, nextMode);
      return { ...line, gstRate: nextRate, taxMode: nextMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
    setOrderForm((current: any) => {
      const amount = cartLines.reduce((sum, line) => sum + (Number(line.quantity || 0) * Number(line.rate || 0)), 0);
      const nextRate = gstRate === "NA" ? "0" : gstRate;
      const nextMode = taxMode === "NA" ? "Exclusive" : taxMode;
      return applyTaxCalculation({ ...current, gstRate: nextRate, taxMode: nextMode }, String(amount), nextMode);
    });
  }

  function getCartLineTotal(line: CartLine) {
    return Math.max(0, Number(line.taxableAmount || 0) + Number(line.gstAmount || 0) - getCartLineCdAmount(line) - getCartLineTodAmount(line));
  }

  function setOrderQuantity(quantity: number | string) {
    const quantityText = String(quantity);
    const quantityValue = Number(quantityText || 0);
    const safeQuantityForMath = Number.isFinite(quantityValue) ? Math.max(0, quantityValue) : 0;
    setOrderForm((current: any) => {
      const next = isPurchase ? ({ ...current, quantityOrdered: quantityText }) : ({ ...current, quantity: quantityText, stockApprovalRequested: false, availableStockAtOrder: "0" });
      return applyTaxCalculation(next, String(safeQuantityForMath * Number(current.rate || 0)), "Exclusive");
    });
  }

  function calculateTax(amountText: string, gstRateText: string, taxMode: TaxModeInput) {
    return calculateTaxPreview(amountText, gstRateText, taxMode);
  }

  function applyTaxCalculation(form: any, amountText: string, taxMode: TaxModeInput = form.taxMode || "Exclusive") {
    const tax = calculateTax(amountText, form.gstRate || "0", taxMode);
    return {
      ...form,
      taxMode,
      taxableAmount: tax.taxableAmount,
      gstAmount: tax.gstAmount
    };
  }

  function updateTaxField(field: "taxableAmount" | "totalAmount" | "gstRate" | "taxMode", value: string) {
    setOrderForm((current: any) => {
      const next = { ...current, [field]: value };
      const mode = field === "taxMode" ? value as TaxModeInput : next.taxMode === "NA" ? "Exclusive" : next.taxMode;
      next.taxMode = mode;
      const amount = field === "totalAmount" || mode === "Inclusive" ? (field === "totalAmount" ? value : String(Number(next.taxableAmount || 0) + Number(next.gstAmount || 0))) : next.taxableAmount;
      return applyTaxCalculation(next, amount, mode);
    });
  }

  function adjustProductQuantity(product: AppSnapshot["products"][number], delta: number) {
    const existingLine = cartLines.find((line) => line.productSku === product.sku);
    if (existingLine) {
      updateCartLineQuantity(product.sku, String(Math.max(1, Number(existingLine.quantity || 0) + delta)));
      return;
    }
    if (orderForm.productSku !== product.sku) {
      if (selectProduct(product)) {
        setRatePopup((current) => current ? { ...current, quantity: String(Math.max(1, 1 + delta)) } : current);
      }
      return;
    }
    setOrderQuantity(Math.max(1, getOrderQuantity() + delta));
  }

  function addProductToOrder(product: AppSnapshot["products"][number]) {
    if (!selectProduct(product)) return;
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
  }

  function confirmProductRate(options?: { openCart?: boolean }) {
    if (!ratePopup) return;
    const popup = ratePopup;
    const openCartAfterSave = options?.openCart ?? true;
    const nextRate = Number(popup.rate || 0);
    const nextQuantity = Number(popup.quantity || 0);
    const lineTotals = calculateLineTotals(popup.quantity, popup.rate, popup.gstRate, popup.taxMode);
    if (nextRate <= 0) {
      scrollToFieldError(ratePopupSheetRef.current, '[data-error-key="rate"]');
      showCartToast("Enter product rate");
      return;
    }
    if (!isPurchase && Number(popup.cdTodRate || 0) > nextRate) {
      scrollToFieldError(ratePopupSheetRef.current, '[data-error-key="cdTodRate"]');
      showCartToast("CD/TOD rate cannot be higher than sale rate");
      return;
    }
    if (!isPurchase && Number(popup.cdTodRate || 0) <= 0) {
      scrollToFieldError(ratePopupSheetRef.current, '[data-error-key="cdTodRate"]');
      showCartToast("CD/TOD rate must be greater than zero");
      return;
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
      scrollToFieldError(ratePopupSheetRef.current, '[data-error-key="quantity"]');
      showCartToast("Enter quantity");
      return;
    }
    if (isPurchase) {
      if (popup.lastRate > 0 && nextRate > popup.lastRate && !popup.confirmHighRate) {
        setRatePopup((current) => current ? { ...current, confirmHighRate: true } : current);
        showCartToast("Rate is higher than last purchase rate. Tap sure and continue.");
        return;
      }
    } else if (popup.lastRate > 0 && nextRate < popup.lastRate && !popup.confirmHighRate) {
      setRatePopup((current) => current ? { ...current, confirmHighRate: true } : current);
      showCartToast("Rate is below last purchase price. Tap continue again to confirm.");
      return;
    }
    const quantityText = String(popup.quantity);
    const resolvedWarehouseId = orderForm.warehouseId || preferredWarehouseId(popup.product.allowedWarehouseIds);
    const lineNote = !isPurchase && popup.lastRate > 0 && nextRate < popup.lastRate
      ? `Rate below last purchase price: sales rate ${nextRate}, last purchase ${popup.lastRate} for ${popup.product.sku}.`
      : orderForm.note;
    const subsidyBreakdown = isPurchase ? { cdAmount: "0.00", todAmount: "0.00" } : calculateCdTodBreakdown(popup.quantity, popup.rate, popup.cdTodRate);
    const cartLine: CartLine = {
      productSku: popup.product.sku,
      quantity: quantityText,
      rate: String(nextRate),
      cdTodRate: isPurchase ? "0" : popup.cdTodRate,
      cdAmount: subsidyBreakdown.cdAmount,
      todAmount: subsidyBreakdown.todAmount,
      previousRate: String(popup.lastRate || 0),
      taxableAmount: lineTotals.taxableAmount,
      gstRate: popup.gstRate,
      gstAmount: lineTotals.gstAmount,
      taxMode: popup.taxMode,
      priceApprovalRequested: !isPurchase && popup.lastRate > 0 && nextRate < popup.lastRate,
      minimumAllowedRate: String(popup.lastRate || 0),
      stockApprovalRequested: false,
      availableStockAtOrder: "0",
      note: lineNote
    };
    if (!isPurchase) {
      const availableStockAtOrder = getLineAvailableStock(popup.product.sku, resolvedWarehouseId);
      cartLine.availableStockAtOrder = String(availableStockAtOrder);
      cartLine.stockApprovalRequested = nextQuantity > availableStockAtOrder;
    }
    setCartLines((lines) => {
      const exists = lines.some((line) => line.productSku === cartLine.productSku);
      const baseLines = lines.filter((line) => line.productSku !== cartLine.productSku);
      return exists ? [...baseLines, cartLine] : [...lines, cartLine];
    });
    setOrderForm((current: any) => ({
      ...current,
      ...(isPurchase ? { quantityOrdered: quantityText } : { quantity: quantityText, stockApprovalRequested: false, availableStockAtOrder: "0" }),
      productSku: popup.product.sku,
      rate: String(nextRate),
      previousRate: String(popup.lastRate || 0),
      warehouseId: current.warehouseId || preferredWarehouseId(popup.product.allowedWarehouseIds),
      taxableAmount: lineTotals.taxableAmount,
      gstRate: popup.gstRate,
      gstAmount: lineTotals.gstAmount,
      taxMode: popup.taxMode,
      ...(isPurchase ? {} : {
        priceApprovalRequested: popup.lastRate > 0 && nextRate < popup.lastRate,
        minimumAllowedRate: String(popup.lastRate || 0),
        note: lineNote
      })
    }));
    if ((isPurchase ? orderForm.quantityOrdered : orderForm.quantity) === "0") {
      setOrderQuantity(1);
    }
    setRatePopup(null);
    setCartOpen(openCartAfterSave);
  }

  function getSuggestedRate(product: AppSnapshot["products"][number]) {
    return product.rsp ?? product.slabs[0]?.purchaseRate ?? 0;
  }

  function getCartLineCdAmount(line: CartLine) {
    return Number(line.cdAmount || 0);
  }

  function getCartLineTodAmount(line: CartLine) {
    return Number(line.todAmount || 0);
  }

  function resetCurrentOrder() {
    setOrderForm((current: any) => isPurchase
      ? {
          ...current,
          supplierId: "",
          productSku: "",
          warehouseId: "",
          quantityOrdered: "0",
          rate: "0",
          previousRate: "0",
          taxableAmount: "0",
          gstRate: "0",
          gstAmount: "0",
          taxMode: "Exclusive",
            deliveryMode: "",
            paymentMode: "",
            cashTiming: "",
            note: "",
            locationAddress: "",
            locationCity: "",
            location: null
          }
        : {
          ...current,
          shopId: "",
          billingType: "",
          productSku: "",
          warehouseId: "",
          quantity: "0",
          rate: "0",
          taxableAmount: "0",
          gstRate: "0",
          gstAmount: "0",
          taxMode: "Exclusive",
          deliveryMode: "",
            paymentMode: "",
            cashTiming: "",
            note: "",
            locationAddress: "",
            locationCity: "",
            location: null,
            priceApprovalRequested: false,
          minimumAllowedRate: "0",
          stockApprovalRequested: false,
          availableStockAtOrder: "0"
        });
    setActiveDivision("");
    setActiveDepartment("");
    setActiveSection("");
    setSearch("");
    setPartySearch("");
    setFlowStep(isPurchase ? "catalog" : "landing");
    setCartOpen(false);
    setCartStep("cart");
    setCartErrors({});
    setCartLines([]);
    setCartToast("");
    setRatePopup(null);
    setPartySuggestionOpen(false);
    setAdvancePayment({ enabled: false, amount: "", mode: "", cashTiming: "In Hand", referenceNumber: "", voucherNumber: "", utrNumber: "", proofName: "" });
    setAdvanceUploading(false);
    setCheckoutDate("");
    setBillTaxOverride({ enabled: false, gstRate: "0", taxMode: "Exclusive" });
    setSubmittingCart(false);
  }

  function clearCartDraft() {
    resetCurrentOrder();
    showCartToast("Cart cleared");
  }

  function showCartToast(message: string) {
    setCartToast(message);
    window.setTimeout(() => {
      setCartToast((current) => current === message ? "" : current);
    }, 2200);
  }

  function scrollToFieldError(container: HTMLElement | null, selector = ".field-error") {
    if (typeof document === "undefined") return;
    window.requestAnimationFrame(() => {
      const root = container ?? document.body;
      const target = root.querySelector<HTMLElement>(selector);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      const control = target.matches("input, select, textarea, button")
        ? target
        : target.querySelector<HTMLElement>("input, select, textarea, button");
      control?.focus({ preventScroll: true });
    });
  }

  function markCurrentLocation() {
    if (!navigator.geolocation) {
      showCartToast("Current location is not available in this browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position.coords.latitude.toFixed(6));
        const longitude = Number(position.coords.longitude.toFixed(6));
        const currentAddress = String(orderForm.locationAddress || "").trim();
        const currentCity = String(orderForm.locationCity || "").trim();
        setOrderForm((current: any) => ({
          ...current,
          location: {
            latitude,
            longitude,
            address: currentAddress,
            city: currentCity,
            label: [currentAddress, currentCity].filter(Boolean).join(", ") || `${latitude},${longitude}`
          }
        }));
        showCartToast(isPurchase ? "Supplier pickup location saved" : "Shop delivery location saved");
      },
      () => showCartToast("Could not capture current location"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function validateCartStep() {
    const cartHasLines = cartLines.length > 0;
    const invalidLine = cartLines.find((line) => Number(line.quantity || 0) <= 0 || Number(line.rate || 0) <= 0);
    const nextErrors = {
      supplierId: isPurchase ? !orderForm.supplierId : !orderForm.shopId,
      billingType: !isPurchase && !billingType,
      customerGstin: !isPurchase && billingType === "B2B" && !hasValidGstin(selectedParty?.gstNumber),
      warehouseId: !orderForm.warehouseId,
      quantityOrdered: !cartHasLines || Boolean(invalidLine),
      rate: Boolean(invalidLine)
    };
    setCartErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.supplierId) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="supplierId"]');
      showCartToast(isPurchase ? "Select supplier" : "Select customer");
      return false;
    }
    if (nextErrors.billingType) {
      setFlowStep("landing");
      showCartToast("Select the B2B or B2C sales path.");
      return false;
    }
    if (nextErrors.customerGstin) {
      setFlowStep("existing");
      showCartToast("Enter and save a valid customer GSTIN before continuing with a B2B bill.");
      return false;
    }
    if (nextErrors.warehouseId) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="warehouseId"]');
      showCartToast(isPurchase ? "Select delivery warehouse" : "Select dispatch warehouse");
      return false;
    }
    if (nextErrors.quantityOrdered) {
      showCartToast(cartHasLines ? "Enter quantity and rate for every cart item" : "Add product to cart");
      return false;
    }
    return true;
  }

  function validatePaymentStep() {
    const advanceAmount = Number(advancePayment.amount || 0);
    const nextErrors = {
      paymentMode: !orderForm.paymentMode,
      cashTiming: orderForm.paymentMode === "Cash" && !orderForm.cashTiming,
      deliveryMode: !orderForm.deliveryMode,
      advanceAmount: advancePayment.enabled && (advanceAmount <= 0 || advanceAmount > cartTotal),
      advanceMode: advancePayment.enabled && !advancePayment.mode,
      advanceCashProof: advancePayment.enabled && advancePayment.mode === "Cash" && !advancePayment.proofName
    };
    setCartErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.paymentMode) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="paymentMode"]');
      showCartToast("Select payment method");
      return false;
    }
    if (nextErrors.cashTiming) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="cashTiming"]');
      showCartToast("Select cash timing");
      return false;
    }
    if (nextErrors.deliveryMode) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="deliveryMode"]');
      showCartToast("Select delivery mode");
      return false;
    }
    if (nextErrors.advanceAmount) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="advanceAmount"]');
      showCartToast(`Enter advance amount between 1 and ${cartTotal.toFixed(2)}`);
      return false;
    }
    if (nextErrors.advanceMode) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="advanceMode"]');
      showCartToast("Select advance payment mode");
      return false;
    }
    if (nextErrors.advanceCashProof) {
      scrollToFieldError(checkoutSheetRef.current, '[data-error-key="advanceCashProof"]');
      showCartToast("Upload cash advance photo");
      return false;
    }
    return true;
  }

  function buildAdvancePaymentPayload() {
    if (!advancePayment.enabled) return undefined;
    const amount = Number(advancePayment.amount || 0);
    if (amount <= 0 || !advancePayment.mode) return undefined;
    return {
      amount,
      mode: advancePayment.mode,
      cashTiming: advancePayment.mode === "Cash" ? advancePayment.cashTiming : undefined,
      referenceNumber: advancePayment.referenceNumber || undefined,
      voucherNumber: advancePayment.voucherNumber || undefined,
      utrNumber: advancePayment.utrNumber || undefined,
      proofName: advancePayment.proofName || undefined,
      verificationNote: isPurchase ? "Advance given to dealer at order finalization." : "Advance taken from dealer at order finalization."
    };
  }

  async function uploadAdvanceProof(file: File | null) {
    if (!file) return;
    setAdvanceUploading(true);
    const uploaded = await onUploadProof(file);
    if (uploaded && typeof uploaded === "object" && "fileName" in uploaded) {
      setAdvancePayment((current) => ({ ...current, proofName: String((uploaded as { fileName: string }).fileName) }));
      setCartErrors((current) => ({ ...current, advanceCashProof: false }));
    }
    setAdvanceUploading(false);
  }

  function getSelectedProduct() {
    return products.find((item) => item.sku === orderForm.productSku) || null;
  }

  function getAvailableStock(sku: string) {
    return stockSummary.filter((item) => item.productSku === sku).reduce((sum, item) => sum + item.availableQuantity, 0);
  }

  function getWarehouseStock(sku: string, warehouseId: string) {
    return stockSummary.find((item) => item.productSku === sku && item.warehouseId === warehouseId)?.availableQuantity ?? 0;
  }

  function getLineAvailableStock(sku: string, warehouseId: string) {
    return warehouseId ? getWarehouseStock(sku, warehouseId) : getAvailableStock(sku);
  }

  function getProbationaryQuantity(line: CartLine) {
    return Math.max(0, Number(line.quantity || 0) - getLineAvailableStock(line.productSku, orderForm.warehouseId || ""));
  }

  function getWarehouseName(warehouseId: string) {
    return warehouses.find((item) => item.id === warehouseId)?.name || warehouseId;
  }

  function getWarehouseLabel(warehouseId: string) {
    return getWarehouseName(warehouseId).replace(/\s+(warehouse|yard)$/i, "").trim() || warehouseId;
  }

  function updateSalesCartStockState(nextWarehouseId: string) {
    if (isPurchase) return;
    setCartLines((current) => current.map((line) => {
      const availableStockAtOrder = getLineAvailableStock(line.productSku, nextWarehouseId);
      const requestedQuantity = Number(line.quantity || 0);
      return {
        ...line,
        availableStockAtOrder: String(availableStockAtOrder),
        stockApprovalRequested: requestedQuantity > availableStockAtOrder
      };
    }));
  }

  function buildStockApprovalNote(productSku: string, requestedQuantity: number, availableQuantity: number, warehouseId: string) {
    return `Stock warning: sales quantity ${requestedQuantity} exceeds available stock ${availableQuantity} for ${productSku} at ${warehouseId}.`;
  }

  async function savePartyAndContinue() {
    const name = partyDraft.name.trim();
    const gstNumber = partyDraft.gstNumber.trim();
    const bankAccountNumber = partyDraft.bankAccountNumber.trim();
    const ifscCode = partyDraft.ifscCode.trim();
    const nextErrors = {
      name: !name || parties.some((item) => item.name.trim().toLowerCase() === name.toLowerCase()),
      gstNumber: !gstNumber || (!isPurchase && billingType === "B2B" && !hasValidGstin(gstNumber)) || (gstNumber.toUpperCase() !== "N/A" && parties.some((item) => item.gstNumber.trim().toLowerCase() === gstNumber.toLowerCase())),
      bankAccountNumber: !bankAccountNumber || (bankAccountNumber.toUpperCase() !== "N/A" && parties.some((item) => item.bankAccountNumber.trim().toLowerCase() === bankAccountNumber.toLowerCase())),
      ifscCode: !ifscCode
    };
    setPartyDraftErrors(nextErrors);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      scrollToFieldError(
        flowCardRef.current,
        nextErrors.name
          ? '[data-error-key="name"]'
          : nextErrors.gstNumber
            ? '[data-error-key="gstNumber"]'
            : nextErrors.bankAccountNumber
              ? '[data-error-key="bankAccountNumber"]'
              : '[data-error-key="ifscCode"]'
      );
      showCartToast(
        nextErrors.name
          ? `${isPurchase ? "Supplier" : "Customer"} name is required and must be unique`
          : nextErrors.gstNumber
            ? (!isPurchase && billingType === "B2B" ? "A valid, unique GSTIN is required for a B2B customer." : "GST number is required and must be unique. Use N/A for unregistered parties.")
            : nextErrors.bankAccountNumber
              ? "Bank account number is required and must be unique. Use N/A when not available."
              : "IFSC code is required. Use N/A when not available."
      );
      return;
    }
    const created = await onCreateParty({ ...partyDraft, type: partyType });
    if (!created) return;
    setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: created.id, locationAddress: created.deliveryAddress || created.address || "", locationCity: created.deliveryCity || created.city || "" }) : ({ ...current, shopId: created.id, locationAddress: created.deliveryAddress || created.address || "", locationCity: created.deliveryCity || created.city || "" }));
    setPartyDraft({ name: "", gstNumber: "", bankName: "", bankAccountNumber: "", ifscCode: "", mobileNumber: "", address: "", city: "Bhopal", contactPerson: "" });
    setPartyDraftErrors({ name: false, gstNumber: false, bankAccountNumber: false, ifscCode: false });
    setFlowStep("catalog");
  }

  const selectedPartyId = isPurchase ? orderForm.supplierId : orderForm.shopId;
  const selectedParty = parties.find((item) => item.id === selectedPartyId);
  const selectedWarehouse = warehouses.find((item) => item.id === orderForm.warehouseId) || null;
  const liveAddressText = String(orderForm.locationAddress || selectedParty?.deliveryAddress || selectedParty?.address || "");
  const liveCityText = String(orderForm.locationCity || selectedParty?.deliveryCity || selectedParty?.city || "");
  const selectedProduct = getSelectedProduct();
  const cartProducts = cartLines.map((line) => ({ line, product: products.find((item) => item.sku === line.productSku) })).filter((item): item is { line: CartLine; product: AppSnapshot["products"][number] } => Boolean(item.product));
  const cartTaxable = cartLines.reduce((sum, line) => sum + Number(line.taxableAmount || 0), 0);
  const cartGstAmount = cartLines.reduce((sum, line) => sum + Number(line.gstAmount || 0), 0);
  const cartCdAmount = cartLines.reduce((sum, line) => sum + getCartLineCdAmount(line), 0);
  const cartTodAmount = cartLines.reduce((sum, line) => sum + getCartLineTodAmount(line), 0);
  const cartTotal = Math.max(0, cartTaxable + cartGstAmount - cartCdAmount - cartTodAmount);
  const totalWeightKg = cartProducts.reduce((sum, item) => sum + productUnitWeightKg(item.product) * Number(item.line.quantity || 0), 0);
  const cartStepTitle = cartStep === "cart" ? "Cart" : cartStep === "payment" ? "Payment" : "Bill Summary";
  const completedPurchaseGroup = completedOrder?.kind === "purchase"
    ? groupPurchaseOrders(snapshot.purchaseOrders).find((group) => group.id === completedOrder.orderId)
    : null;
  const completedSalesGroup = completedOrder?.kind === "sales"
    ? groupSalesOrders(snapshot.salesOrders).find((group) => group.id === completedOrder.orderId)
    : null;
  const checkoutSteps = [
    { key: "cart", label: "Cart" },
    { key: "payment", label: "Payment" },
    { key: "summary", label: "Summary" }
  ] as const;

  useEffect(() => {
    if (!isPurchase && cartLines.length === 0 && !selectedPartyId && flowStep === "catalog") {
      setFlowStep("landing");
    }
  }, [cartLines.length, flowStep, isPurchase, selectedPartyId]);

  useEffect(() => {
    if (!completedOrder) {
      setCompletedOrderBillAsset(null);
      completedOrderDownloadRef.current = "";
      return;
    }
    const currentCompletedOrder = completedOrder;
    const key = `${currentCompletedOrder.kind}:${currentCompletedOrder.orderId}`;
    let cancelled = false;
    async function prepareCompletedBill() {
      if (currentCompletedOrder.kind === "purchase") {
        if (!completedPurchaseGroup) return;
        const blob = await buildPurchaseInvoicePdf(snapshot, completedPurchaseGroup);
        const fileName = safePdfFileName(`${completedPurchaseGroup.id}.pdf`);
        if (cancelled) return;
        setCompletedOrderBillAsset({ orderId: completedPurchaseGroup.id, kind: currentCompletedOrder.kind, fileName, blob });
        if (completedOrderDownloadRef.current !== key) {
          downloadBlobFile(fileName, blob);
          completedOrderDownloadRef.current = key;
        }
        return;
      }
      if (!completedSalesGroup) return;
      const blob = await buildSalesInvoicePdf(snapshot, completedSalesGroup);
      const fileName = safePdfFileName(`${completedSalesGroup.id}.pdf`);
      if (cancelled) return;
      setCompletedOrderBillAsset({ orderId: completedSalesGroup.id, kind: currentCompletedOrder.kind, fileName, blob });
      if (completedOrderDownloadRef.current !== key) {
        downloadBlobFile(fileName, blob);
        completedOrderDownloadRef.current = key;
      }
    }
    void prepareCompletedBill();
    return () => {
      cancelled = true;
    };
  }, [completedOrder, completedPurchaseGroup, completedSalesGroup, snapshot]);

  const mainPanel = (
        <Panel title={title} eyebrow={eyebrow}>
          <div className="catalog-shell">
            {flowStep !== "catalog" ? <div ref={flowCardRef} className="flow-card">
              {flowStep === "landing" ? <>
                <span className="eyebrow">Start</span>
                <h3>{isPurchase ? "Choose supplier first" : "Select sales path"}</h3>
                <p>{isPurchase ? "Ask the purchaser to select an existing supplier or create a new supplier before opening categories." : "Choose B2B for a GST-registered customer or B2C for a consumer sale."}</p>
                {!isPurchase ? <div className="flow-action-row">
                  <button className={billingType === "B2B" ? "primary-button" : "ghost-button"} type="button" onClick={() => chooseBillingType("B2B")}>B2B</button>
                  <button className={billingType === "B2C" ? "primary-button" : "ghost-button"} type="button" onClick={() => chooseBillingType("B2C")}>B2C</button>
                </div> : null}
                {(isPurchase || billingType) ? <div className="flow-action-row">
                  <button className="primary-button" type="button" onClick={() => setFlowStep("existing")}>Existing {isPurchase ? "Supplier" : "Customer"}</button>
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New {isPurchase ? "Supplier" : "Customer"}</button>
                </div> : null}
              </> : null}
              {flowStep === "existing" ? <>
                <span className="eyebrow">Selection</span>
                <h3>Select existing {partyLabel}</h3>
                {!isPurchase ? <p>Sales path: <strong>{billingType}</strong>{billingType === "B2B" ? " — customer GSTIN is mandatory." : ""}</p> : null}
                <div className="form-grid top-gap">
                  <label className="wide-field supplier-search-field">Search saved {isPurchase ? "supplier" : "customer"}<div className="search-box"><input value={partySearch} onChange={(e) => { setPartySearch(e.target.value); setPartySuggestionOpen(true); }} onFocus={() => setPartySuggestionOpen(true)} onBlur={() => window.setTimeout(() => setPartySuggestionOpen(false), 120)} placeholder={`Type saved ${isPurchase ? "supplier" : "customer"} name, GST, city, or mobile`} />{partySuggestionOpen ? <div className="search-suggestion-list">{partySuggestions.length > 0 ? partySuggestions.map((party) => <button key={party.id} type="button" className="search-suggestion-item" onMouseDown={() => selectSavedParty(party)}><strong>{party.name}</strong><span>{party.gstNumber || "GST pending"} / {party.mobileNumber || "Mobile pending"} / {party.city || "City pending"}</span></button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved {isPurchase ? "supplier" : "customer"} found</strong><span>Create one first.</span></div>}</div> : null}</div></label>
                  <label className="wide-field">{isPurchase ? "Supplier" : "Customer"}<select value={selectedPartyId} onChange={(e) => { const party = parties.find((item) => item.id === e.target.value); if (party) selectSavedParty(party); }}>{renderOptions(parties)}</select></label>
                  {!isPurchase && billingType === "B2B" && selectedParty && !hasValidGstin(selectedParty.gstNumber) ? <div className="wide-field message pending">
                    <strong>GSTIN required for {selectedParty.name}</strong>
                    <div className="inline-input-action top-gap">
                      <input value={b2bGstEntry} onChange={(e) => setB2bGstEntry(e.target.value.toUpperCase())} placeholder="Enter 15-character GSTIN" maxLength={15} />
                      <button type="button" className="primary-button" onClick={() => void saveSelectedCustomerGstin()}>Save GSTIN</button>
                    </div>
                  </div> : null}
                </div>
                <div className="flow-action-row">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Back</button>
                  {!isPurchase ? <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New Customer</button> : null}
                  <button className="primary-button" type="button" onClick={continueWithSelectedParty} disabled={!selectedPartyId || (!isPurchase && billingType === "B2B" && !hasValidGstin(selectedParty?.gstNumber))}>{isPurchase ? "Back to purchase order page" : "Continue to sales order"}</button>
                </div>
              </> : null}
              {flowStep === "new" ? <>
                <span className="eyebrow">Registration</span>
                <h3>{isPurchase ? "Vendor registration page" : "Customer registration page"}</h3>
                {!isPurchase ? <p>Sales path: <strong>{billingType}</strong>{billingType === "B2B" ? " — enter the customer's GSTIN below." : ""}</p> : null}
                <div className="form-grid top-gap">
                  <label data-error-key="name" className={partyDraftErrors.name ? "field-error" : ""}>Name<input value={partyDraft.name} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, name: false })); setPartyDraft((c) => ({ ...c, name: e.target.value })); }} /></label>
                  <label data-error-key="gstNumber" className={partyDraftErrors.gstNumber ? "field-error" : ""}>GST<input value={partyDraft.gstNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, gstNumber: false })); setPartyDraft((c) => ({ ...c, gstNumber: e.target.value.toUpperCase() })); }} placeholder={!isPurchase && billingType === "B2B" ? "15-character GSTIN" : "GST number or N/A"} maxLength={!isPurchase && billingType === "B2B" ? 15 : undefined} /></label>
                  {(isPurchase || billingType !== "B2B") ? <label className="checkbox-line"><input type="checkbox" checked={partyDraftGstNa} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, gstNumber: false })); setPartyDraft((c) => ({ ...c, gstNumber: e.target.checked ? "N/A" : "" })); }} />GST N/A</label> : null}
                  <label>Bank name<input value={partyDraft.bankName} onChange={(e) => setPartyDraft((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
                  <label data-error-key="bankAccountNumber" className={partyDraftErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyDraft.bankAccountNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyDraft((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label>
                  <label data-error-key="ifscCode" className={partyDraftErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyDraft.ifscCode} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, ifscCode: false })); setPartyDraft((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label>
                  <label className="checkbox-line"><input type="checkbox" checked={partyDraftBankNa} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, bankAccountNumber: false, ifscCode: false })); setPartyDraft((c) => ({ ...c, bankName: e.target.checked ? "N/A" : "", bankAccountNumber: e.target.checked ? "N/A" : "", ifscCode: e.target.checked ? "N/A" : "" })); }} />Bank details N/A</label>
                  <label>Mobile<input value={partyDraft.mobileNumber} onChange={(e) => setPartyDraft((c) => ({ ...c, mobileNumber: e.target.value }))} /></label>
                  <label>Contact<input value={partyDraft.contactPerson} onChange={(e) => setPartyDraft((c) => ({ ...c, contactPerson: e.target.value }))} /></label>
                  <label>City<input value={partyDraft.city} onChange={(e) => setPartyDraft((c) => ({ ...c, city: e.target.value }))} /></label>
                  <label className="wide-field">Address<input value={partyDraft.address} onChange={(e) => setPartyDraft((c) => ({ ...c, address: e.target.value }))} /></label>
                </div>
                <div className="flow-action-row">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Back</button>
                  <button className="primary-button" type="button" onClick={() => void savePartyAndContinue()}>Save and continue</button>
                </div>
              </> : null}
            </div> : null}

            {flowStep === "catalog" ? <>
            <div className="catalog-toolbar">
              <label className="catalog-search">
                <span className="small-label">Search product</span>
                <div className="catalog-search-row">
                  <div className="search-box">
                    <input
                      value={search}
                      onChange={(e) => { setSearch(e.target.value); setSuggestionOpen(true); }}
                      onFocus={() => setSuggestionOpen(true)}
                      onBlur={() => window.setTimeout(() => setSuggestionOpen(false), 120)}
                      placeholder="Type saved product name, barcode, brand, or division"
                    />
                    {suggestionOpen && search.trim() ? <div className="search-suggestion-list">
                      {searchSuggestions.length > 0 ? searchSuggestions.map((item) => {
                        const product = resolveCatalogProduct(item);
                        return <button key={item.key} type="button" className="search-suggestion-item" onMouseDown={() => applySearchSuggestion(item)}>
                          <strong>{item.displayName}</strong>
                          <span>{product.sku} / {productCategoryLabel(product)} / {product.department || "General"} / {product.section || "General"}</span>
                        </button>;
                      }) : <div className="search-suggestion-item empty-suggestion"><strong>No saved product found</strong><span>Create product first from Products.</span></div>}
                      </div> : null}
                  </div>
                  <button className="ghost-button catalog-search-launch" type="button" onClick={() => setSearchSheetOpen(true)} title="Open search page" aria-label="Open search page">
                    <SidebarVectorIcon view="Search" />
                  </button>
                  <button className={voiceBusy ? "ghost-button active-voice" : "ghost-button"} type="button" onClick={setVoiceSearch}>{voiceBusy ? "Listening..." : "Voice"}</button>
                </div>
              </label>
              {(!isPurchase || !selectedPartyId || cartLines.length === 0) ? <div className="selected-party-bar">
                <span className="small-label">{isPurchase ? "Selected supplier" : "Selected customer"}</span>
                <strong>{parties.find((item) => item.id === selectedPartyId)?.name || "Not selected"}</strong>
                {isPurchase ? <div className="selected-party-actions">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("existing")}>Select supplier</button>
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New supplier</button>
                </div> : cartLines.length === 0 ? <button className="ghost-button" type="button" onClick={() => setFlowStep("existing")}>{selectedPartyId ? "Change customer" : "Select customer"}</button> : <span className="small-label">Cart locked to this customer</span>}
              </div> : null}
            </div>

            {searchSheetOpen ? <div className="cart-overlay catalog-search-overlay" onClick={() => setSearchSheetOpen(false)}>
              <div className="cart-sheet catalog-search-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">Search Index</span>
                    <h3>{isPurchase ? "Find purchase products" : "Find sales products"}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setSearchSheetOpen(false)}>Close</button>
                </div>
                <label className="catalog-search catalog-search-sheet-field">
                  <span className="small-label">Best matching to loose</span>
                  <div className="catalog-search-row">
                    <div className="search-box">
                      <input
                        ref={catalogSearchInputRef}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Type saved product name, barcode, brand, or division"
                      />
                    </div>
                    <button className={voiceBusy ? "ghost-button active-voice" : "ghost-button"} type="button" onClick={setVoiceSearch}>{voiceBusy ? "Listening..." : "Voice"}</button>
                  </div>
                </label>
                <div className="catalog-search-controls">
                  <label>
                    Brand
                    <select value={brandFilter} onChange={(event) => setBrandFilter(event.target.value)}>
                      <option value="">All brands</option>
                      {brands.map((brand) => <option key={brand} value={brand}>{brand}</option>)}
                    </select>
                  </label>
                  <label>
                    Sort products
                    <select value={catalogSort} onChange={(event) => setCatalogSort(event.target.value as typeof catalogSort)}>
                      <option value="relevance">Best match</option>
                      <option value="brand">Brand A–Z</option>
                      <option value="price-asc">Price low to high</option>
                      <option value="price-desc">Price high to low</option>
                      <option value="margin-desc">Margin high to low</option>
                      <option value="margin-asc">Margin low to high</option>
                    </select>
                  </label>
                </div>
                <div className="chip-row catalog-scope-row" aria-label="Product promotion filter">
                  <button type="button" className={catalogScope === "all" ? "chip-button active" : "chip-button"} onClick={() => setCatalogScope("all")}>All items</button>
                  <button type="button" className={catalogScope === "seasonal" ? "chip-button active" : "chip-button"} onClick={() => setCatalogScope("seasonal")}>Seasonal items</button>
                  <button type="button" className={catalogScope === "offers" ? "chip-button active" : "chip-button"} onClick={() => setCatalogScope("offers")}>Offers</button>
                </div>
                <div className="catalog-search-sheet-meta">
                  <span className="small-label">{normalizedSearch ? "Ranked results" : "Indexed products"}</span>
                  <strong>{indexedSearchProducts.length} item{indexedSearchProducts.length === 1 ? "" : "s"}</strong>
                </div>
                <div className="catalog-search-sheet-results">
                  {indexedSearchProducts.length > 0 ? indexedSearchProducts.map((item) => {
                    const product = resolveCatalogProduct(item);
                    return <button key={`indexed-${item.key}`} type="button" className="search-suggestion-item catalog-search-sheet-item" onClick={() => applyIndexedSearch(item)}>
                      <span className="catalog-result-heading"><strong>{item.displayName}</strong>{product.isSeasonal ? <em>Seasonal</em> : null}{product.offerLabel || product.offerPrice ? <em>Offer</em> : null}</span>
                      <span>{product.sku} / {product.brand || "Unbranded"} / {product.subCategory || product.category || "General"}</span>
                      <span className="catalog-result-prices">Sale ₹{productSalePrice(product).toFixed(2)} · Purchase ₹{productPurchasePrice(product).toFixed(2)} · Margin ₹{productMargin(product).toFixed(2)}{product.offerLabel ? ` · ${product.offerLabel}` : ""}</span>
                    </button>;
                  }) : <div className="search-suggestion-item empty-suggestion"><strong>No matching product found</strong><span>Try a broader name, barcode, or brand.</span></div>}
                </div>
              </div>
            </div> : null}

            {completedOrder && typeof document !== "undefined" ? createPortal(<div className="cart-overlay checkout-modal-overlay bill-modal-overlay" onClick={() => setCompletedOrder(null)}>
              <div className="cart-sheet checkout-modal-sheet bill-modal-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{completedOrder.kind === "purchase" ? "Purchase Bill" : "Sales Bill"}</span>
                    <h3>{completedOrder.orderId}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCompletedOrder(null)}>Back</button>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Document</span><strong>{completedOrder.kind === "purchase" ? "PO / Tax invoice ready" : "SO / Tax invoice ready"}</strong></div>
                  <div><span className="small-label">Download</span><strong>{completedOrderBillAsset?.orderId === completedOrder.orderId ? "Saved to device" : "Preparing PDF..."}</strong></div>
                  <div><span className="small-label">Share</span><strong>WhatsApp or PDF</strong></div>
                </div>
                <div className="cart-actions top-gap">
                  {completedPurchaseGroup ? <button
                    type="button"
                    className="ghost-button"
                    onClick={() => completedOrderBillAsset?.orderId === completedPurchaseGroup.id
                      ? void shareInvoicePdfFile(completedOrderBillAsset.fileName, completedOrderBillAsset.blob, `Purchase invoice ${completedPurchaseGroup.id}`)
                      : void sharePurchaseInvoicePdf(snapshot, completedPurchaseGroup)}
                  >WhatsApp Share</button> : null}
                  {completedPurchaseGroup ? <button
                    type="button"
                    className="ghost-button"
                    onClick={() => completedOrderBillAsset?.orderId === completedPurchaseGroup.id
                      ? downloadBlobFile(completedOrderBillAsset.fileName, completedOrderBillAsset.blob)
                      : void downloadPurchaseInvoicePdf(snapshot, completedPurchaseGroup)}
                  >Download PDF</button> : null}
                  {completedPurchaseGroup ? <button type="button" className="primary-button" onClick={() => void printPurchaseInvoice(snapshot, completedPurchaseGroup)}>Open Bill</button> : null}
                  {completedSalesGroup ? <button
                    type="button"
                    className="ghost-button"
                    onClick={() => completedOrderBillAsset?.orderId === completedSalesGroup.id
                      ? void shareInvoicePdfFile(completedOrderBillAsset.fileName, completedOrderBillAsset.blob, `Sales invoice ${completedSalesGroup.id}`)
                      : void shareSalesInvoicePdf(snapshot, completedSalesGroup)}
                  >WhatsApp Share</button> : null}
                  {completedSalesGroup ? <button
                    type="button"
                    className="ghost-button"
                    onClick={() => completedOrderBillAsset?.orderId === completedSalesGroup.id
                      ? downloadBlobFile(completedOrderBillAsset.fileName, completedOrderBillAsset.blob)
                      : void downloadSalesInvoicePdf(snapshot, completedSalesGroup)}
                  >Download PDF</button> : null}
                  {completedSalesGroup ? <button type="button" className="primary-button" onClick={() => void printSalesInvoice(snapshot, completedSalesGroup)}>Open Tax Invoice</button> : null}
                </div>
              </div>
            </div>, document.body) : null}

            {showingCategoryLanding ? <div className="category-section">
              <div className="category-section-head">
                <div>
                  <span className="small-label">Categories</span>
                  <h3>Choose a category</h3>
                </div>
              </div>
              <div className="category-grid">
                {divisions.map((division) => {
                  const divisionProducts = products.filter((item) => productCategoryLabel(item) === division);
                  const sample = divisionProducts[0];
                  const initials = division
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((item) => item[0]?.toUpperCase() || "")
                    .join("") || "CT";
                  return (
                    <button key={division} type="button" className="category-card" onClick={() => { setActiveDivision(division); setActiveDepartment(""); setActiveSection(""); }}>
                      <div className="category-card-thumb">{initials}</div>
                      <div className="category-card-copy">
                        <strong>{division}</strong>
                        <span>{divisionProducts.length} product{divisionProducts.length === 1 ? "" : "s"}</span>
                        <p>{sample?.department || "Browse this category"}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div> : <>
            <div className="catalog-subhead">
                <button className="ghost-button" type="button" onClick={() => { setActiveDivision(""); setActiveDepartment(""); setActiveSection(""); setSearch(""); }}>{normalizedSearch ? "Clear search" : "Back to categories"}</button>
                <div className="chip-row chip-row-scroll">
                  <button type="button" className={activeDivision === "" ? "chip-button active" : "chip-button"} onClick={() => { setActiveDivision(""); setActiveDepartment(""); setActiveSection(""); }}>All</button>
                  {divisions.map((division) => (
                    <button key={division} type="button" className={division === activeDivision ? "chip-button active" : "chip-button"} onClick={() => { setActiveDivision(division); setActiveDepartment(""); setActiveSection(""); }}>
                      {division}
                    </button>
                  ))}
              </div>
            </div>

            <div className="catalog-grid">
              {catalogProducts.map((item) => {
                const product = resolveCatalogProduct(item);
                const selected = item.variants.some((variant) => cartLines.some((line) => line.productSku === variant.sku));
                const availableStock = item.variants.reduce((sum, variant) => sum + getAvailableStock(variant.sku), 0);
                const warehouseStock = item.variants.reduce((sum, variant) => sum + getWarehouseStock(variant.sku, orderForm.warehouseId || ""), 0);
                const stockedWarehouses = Array.from(
                  stockSummary
                    .filter((stock) => item.variants.some((variant) => variant.sku === stock.productSku) && stock.availableQuantity > 0)
                    .reduce((map, stock) => {
                      const current = map.get(stock.warehouseId);
                      map.set(stock.warehouseId, current ? { ...current, availableQuantity: current.availableQuantity + stock.availableQuantity } : { ...stock });
                      return map;
                    }, new Map<string, AppSnapshot["stockSummary"][number]>())
                    .values()
                ).sort((left, right) => right.availableQuantity - left.availableQuantity);
                const metaLabelSource = product.brand || product.shortName || product.unit;
                const normalizedName = item.displayName.trim().toLowerCase();
                const metaLabel = metaLabelSource && metaLabelSource.trim().toLowerCase() !== normalizedName
                  ? metaLabelSource
                  : product.sku;
                const cardQuantity = cartLines.find((line) => line.productSku === product.sku)?.quantity || 1;
                const initials = item.displayName
                  .split(" ")
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((item) => item[0]?.toUpperCase() || "")
                  .join("") || "PR";
                return (
                  <div key={item.key} className={selected ? "product-card selected" : "product-card"} onClick={() => selectProduct(product)}>
                    <div className="product-card-main">
                    <div className="product-thumb">{initials}</div>
                    <div className="product-card-copy">
                    <div className="product-card-top">
                      <span className="eyebrow">{product.division || "General"}</span>
                      <strong>{catalogCardTitle(item, product)}</strong>
                      {product.isSeasonal || product.offerLabel || product.offerPrice ? <span className="product-promo-badge">{product.offerLabel || (product.isSeasonal ? "Seasonal" : "Offer")}</span> : null}
                    </div>
                    <div className="product-meta compact">
                      <span>{metaLabel}</span>
                      <span>{normalizeStaplesWeightLabel(product)}</span>
                    </div>
                    <div className={item.familyKey ? "product-variant-slot" : "product-variant-slot empty"} aria-hidden={!item.familyKey}>
                      {item.familyKey ? <div className="product-meta compact">
                        <label className="wide-field">
                          <span className="small-label">Weight</span>
                          <select
                            value={product.sku}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) => { event.stopPropagation(); setCatalogFamilyVariant(item.familyKey || "", event.target.value); }}
                          >
                            {item.variants.map((variant) => <option key={variant.sku} value={variant.sku}>{catalogVariantOptionLabel(variant, item.variants)}</option>)}
                          </select>
                        </label>
                      </div> : null}
                    </div>
                    <div className="product-pricing compact">
                      <strong>{isPurchase ? `Last purchase ${getLastPurchaseRate(product)}` : `Sale ${productSalePrice(product)}`}</strong>
                      <span>{product.offerPrice ? `Offer ${product.offerPrice} · MRP ${product.mrp ?? 0}` : `MRP ${product.mrp ?? 0}`}</span>
                    </div>
                    <div className="product-footer stacked">
                      {!isPurchase && orderForm.warehouseId ? <span className="product-inline-stock">{`${getWarehouseLabel(orderForm.warehouseId)} stock ${warehouseStock}`}</span> : <span className="product-inline-stock">{`Total stock ${availableStock}`}</span>}
                      <div className="product-stock-chips">
                        {stockedWarehouses.length > 0
                          ? stockedWarehouses.map((item) => <span key={`${product.sku}-${item.warehouseId}`} className={orderForm.warehouseId === item.warehouseId ? "stock-chip active" : "stock-chip"}>{`${getWarehouseLabel(item.warehouseId)} ${item.availableQuantity}`}</span>)
                          : <span className="stock-chip empty">No stock</span>}
                      </div>
                      <span>{isPurchase ? `MRP ${product.mrp ?? 0}` : `Stock ${availableStock} · MRP ${product.mrp ?? 0}`}</span>
                    </div>
                    </div>
                    </div>
                    <div className="product-action-row">
                      <button type="button" className="qty-button" onClick={(e) => { e.stopPropagation(); adjustProductQuantity(product, -1); }}>-</button>
                      <div className="qty-pill">{cardQuantity}</div>
                      <button type="button" className="qty-button" onClick={(e) => { e.stopPropagation(); adjustProductQuantity(product, 1); }}>+</button>
                      <button type="button" className="add-button" onClick={(e) => { e.stopPropagation(); addProductToOrder(product); }}>
                        {selected ? "Added" : "Add"}
                      </button>
                    </div>
                  </div>
                );
              })}
              {filteredProducts.length === 0 ? <div className="empty-card">No products matched the search.</div> : null}
            </div>
            </>}

            {cartLines.length > 0 && !cartOpen && !ratePopup ? <button type="button" className="floating-checkout-button" onClick={() => setCartOpen(true)}>
              <strong>Checkout</strong>
              <span>{cartLines.length} product{cartLines.length === 1 ? "" : "s"} · Total {cartTotal.toFixed(2)}</span>
            </button> : null}
            {ratePopup && typeof document !== "undefined" ? createPortal(<div className="cart-overlay rate-popup-overlay" onClick={() => setRatePopup(null)}>
              <div ref={ratePopupSheetRef} className="cart-sheet rate-popup-sheet" onClick={(e) => e.stopPropagation()}>
                {(() => {
                  const taxPreview = calculateLineTotals(ratePopup.quantity, ratePopup.rate, ratePopup.gstRate, ratePopup.taxMode);
                  const subsidyPreview = isPurchase ? { cdAmount: "0.00", todAmount: "0.00" } : calculateCdTodBreakdown(ratePopup.quantity, ratePopup.rate, ratePopup.cdTodRate);
                  const finalPreviewAmount = (Math.max(0, Number(taxPreview.totalAmount || 0) - Number(subsidyPreview.cdAmount || 0) - Number(subsidyPreview.todAmount || 0))).toFixed(2);
                  return <>
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">Rate Entry</span>
                    <h3>{productDisplayLabel(ratePopup.product)}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Back</button>
                </div>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Last Purchase Rate" : "Minimum Sell Rate"}</span>
                    <strong>{ratePopup.lastRate > 0 ? ratePopup.lastRate : "No history"}</strong>
                  </div>
                  <div>
                    <span className="small-label">Division</span>
                    <strong>{ratePopup.product.division || "General"}</strong>
                  </div>
                  {!isPurchase ? <div>
                    <span className="small-label">Available Qty</span>
                    <strong>{orderForm.warehouseId ? `${getWarehouseStock(ratePopup.product.sku, orderForm.warehouseId)} at ${getWarehouseLabel(orderForm.warehouseId)}` : `${getAvailableStock(ratePopup.product.sku)} total`}</strong>
                  </div> : null}
                </div>
                <div className="cart-edit-grid">
                  <label data-error-key="quantity" className={Number(ratePopup.quantity || 0) <= 0 ? "field-error" : ""}>
                    Enter Qty
                    <input type="number" step="any" value={ratePopup.quantity} onChange={(e) => setRatePopup((current) => current ? { ...current, quantity: e.target.value } : current)} />
                  </label>
                  <label data-error-key="rate" className={Number(ratePopup.rate || 0) <= 0 ? "field-error" : ""}>
                    Enter Rate
                    <input type="number" step="any" value={ratePopup.rate} onChange={(e) => setRatePopup((current) => current ? { ...current, rate: e.target.value, confirmHighRate: false } : current)} />
                  </label>
                  {!isPurchase ? <label data-error-key="cdTodRate" className={Number(ratePopup.cdTodRate || 0) <= 0 || Number(ratePopup.cdTodRate || 0) > Number(ratePopup.rate || 0) ? "field-error" : ""}>
                    CD/TOD Rate
                    <input type="number" step="any" min="0.01" value={ratePopup.cdTodRate} onChange={(e) => setRatePopup((current) => current ? { ...current, cdTodRate: e.target.value } : current)} />
                  </label> : null}
                </div>
                <div className="cart-edit-grid">
                  <label>
                    GST Rate
                    <select value={ratePopup.gstRate === "NA" ? "0" : ratePopup.gstRate} onChange={(e) => setRatePopup((current) => current ? { ...current, gstRate: e.target.value as GstRateInput, taxMode: current.taxMode === "NA" ? "Exclusive" : current.taxMode } : current)}>
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="40">40%</option>
                    </select>
                  </label>
                  <label>
                    Calculation
                    <select value={ratePopup.taxMode === "NA" ? "Exclusive" : ratePopup.taxMode} onChange={(e) => setRatePopup((current) => current ? { ...current, taxMode: e.target.value as TaxModeInput } : current)}>
                      <option value="Exclusive">GST Extra</option>
                      <option value="Inclusive">GST Included</option>
                    </select>
                  </label>
                </div>
                <div className="payment-meta-grid top-gap">
                  <div><span className="small-label">Taxable</span><strong>{taxPreview.taxableAmount}</strong></div>
                  <div><span className="small-label">GST</span><strong>{taxPreview.gstAmount}</strong></div>
                  {!isPurchase ? <div><span className="small-label">CD</span><strong>{subsidyPreview.cdAmount}</strong></div> : null}
                  {!isPurchase ? <div><span className="small-label">TOD</span><strong>{subsidyPreview.todAmount}</strong></div> : null}
                  <div><span className="small-label">Final Amount</span><strong>{isPurchase ? taxPreview.totalAmount : finalPreviewAmount}</strong></div>
                </div>
                {isPurchase && ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) > ratePopup.lastRate ? <div className="rate-warning-box">
                  Entered rate is higher than the last purchase rate. This will be reported to admin and added to the purchase-order notes for warehouse and accounts.
                </div> : null}
                {!isPurchase && ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) < ratePopup.lastRate ? <div className="rate-warning-box">
                  Entered sales rate is below the last purchase price. You can still book it now after confirmation.
                </div> : null}
                <div className="cart-actions">
                  <button type="button" className="ghost-button" onClick={() => confirmProductRate({ openCart: false })}>Continue shopping</button>
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Cancel</button>
                  <button type="button" className="primary-button" onClick={() => confirmProductRate({ openCart: true })}>
                    {isPurchase
                      ? (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) > ratePopup.lastRate && ratePopup.confirmHighRate ? "Sure and continue" : "Continue")
                      : (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) < ratePopup.lastRate && ratePopup.confirmHighRate ? "Confirm and continue" : "Continue")}
                  </button>
                </div>
                </>;
                })()}
              </div>
            </div>, document.body) : null}
            {cartOpen && cartLines.length > 0 && typeof document !== "undefined" ? createPortal(<div className="cart-overlay checkout-modal-overlay" onClick={() => setCartOpen(false)}>
              <div ref={checkoutSheetRef} className="cart-sheet checkout-modal-sheet" onClick={(e) => e.stopPropagation()}>
                {cartToast ? <div className="cart-toast">{cartToast}</div> : null}
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{cartStepTitle}</span>
                    <h3>{cartLines.length} product cart</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Back</button>
                </div>
                <div className="checkout-progress" aria-label="Checkout progress">
                  {checkoutSteps.map((step, index) => (
                    <span key={step.key} className={cartStep === step.key ? "active" : ""}>
                      {index + 1}. {step.label}
                    </span>
                  ))}
                </div>
                {cartStep === "cart" ? <>
                <div className="stack-list">
                  {cartProducts.map(({ line, product }) => <article className="list-card cart-product-line" key={line.productSku}>
                    <div className="payment-update-head">
                      <div><strong>{productDisplayLabel(product)}</strong><p>{product.division} / {product.section}</p></div>
                      <button type="button" className="ghost-button danger-button" onClick={() => setCartLines((current) => current.filter((item) => item.productSku !== line.productSku))}>Remove</button>
                    </div>
                    <div className="payment-meta-grid">
                      <label>Qty<input type="number" step="any" value={line.quantity} onChange={(e) => updateCartLineQuantity(line.productSku, e.target.value)} /></label>
                      <div><span className="small-label">Rate</span><strong>{Number(line.rate || 0).toFixed(2)}</strong></div>
                      {!isPurchase ? <div><span className="small-label">CD/TOD Rate</span><strong>{Number(line.cdTodRate || 0).toFixed(2)}</strong></div> : null}
                      <label>GST<select value={line.gstRate === "NA" ? "0" : line.gstRate} onChange={(e) => updateCartLineTax(line.productSku, { gstRate: e.target.value as GstRateInput })} disabled={billTaxOverride.enabled}><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label>
                      <label>Calculation<select value={line.taxMode === "NA" ? "Exclusive" : line.taxMode} onChange={(e) => updateCartLineTax(line.productSku, { taxMode: e.target.value as TaxModeInput })} disabled={billTaxOverride.enabled}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option></select></label>
                      <div><span className="small-label">Taxable</span><strong>{Number(line.taxableAmount || 0).toFixed(2)}</strong></div>
                      <div><span className="small-label">GST Amt</span><strong>{Number(line.gstAmount || 0).toFixed(2)}</strong></div>
                      {!isPurchase ? <div><span className="small-label">CD</span><strong>{getCartLineCdAmount(line).toFixed(2)}</strong></div> : null}
                      {!isPurchase ? <div><span className="small-label">TOD</span><strong>{getCartLineTodAmount(line).toFixed(2)}</strong></div> : null}
                      <div><span className="small-label">Line total</span><strong>{getCartLineTotal(line).toFixed(2)}</strong></div>
                    </div>
                    {!isPurchase ? <div className="cart-line top-gap">
                      <div>
                        <span className="small-label">Available Qty</span>
                        <strong>{getLineAvailableStock(line.productSku, orderForm.warehouseId || "")}</strong>
                      </div>
                      <div>
                        <span className="small-label">Warehouse</span>
                        <strong>{orderForm.warehouseId ? getWarehouseLabel(orderForm.warehouseId) : "All"}</strong>
                      </div>
                    </div> : null}
                    {isPurchase && Number(line.previousRate || 0) > 0 && Number(line.rate || 0) > Number(line.previousRate || 0) ? <div className="rate-warning-box top-gap">Rate flag: purchase rate {Number(line.rate || 0).toFixed(2)} is higher than last purchase {Number(line.previousRate || 0).toFixed(2)}.</div> : null}
                    {!isPurchase && Number(line.minimumAllowedRate || line.previousRate || 0) > 0 && Number(line.rate || 0) < Number(line.minimumAllowedRate || line.previousRate || 0) ? <div className="rate-warning-box top-gap">Rate flag: sales rate {Number(line.rate || 0).toFixed(2)} is below last purchase {Number(line.minimumAllowedRate || line.previousRate || 0).toFixed(2)}.</div> : null}
                    {!isPurchase && getProbationaryQuantity(line) > 0 ? <div className="rate-warning-box top-gap">Stock flag: requested qty {Number(line.quantity || 0)} exceeds available qty {getLineAvailableStock(line.productSku, orderForm.warehouseId || "")}. Extra {getProbationaryQuantity(line)} will go to probationary sales after confirmation.</div> : null}
                    {billTaxOverride.enabled ? <div className="message success top-gap">Whole bill tax override is active for all products in this cart.</div> : null}
                  </article>)}
                </div>
                <div className="cart-edit-grid">
                  {isPurchase ? <>
                  <label className="wide-field supplier-search-field">
                    Search Saved Supplier
                    <div className="search-box">
                      <input
                        value={partySearch}
                        onChange={(e) => { setPartySearch(e.target.value); setPartySuggestionOpen(true); }}
                        onFocus={() => setPartySuggestionOpen(true)}
                        onBlur={() => window.setTimeout(() => setPartySuggestionOpen(false), 120)}
                        placeholder="Type saved supplier name, GST, city, or mobile"
                      />
                      {partySuggestionOpen ? <div className="search-suggestion-list">
                        {partySuggestions.length > 0 ? partySuggestions.map((party) => <button key={party.id} type="button" className="search-suggestion-item" onMouseDown={() => selectSavedParty(party)}>
                          <strong>{party.name}</strong>
                          <span>{party.gstNumber || "GST pending"} / {party.mobileNumber || "Mobile pending"} / {party.city || "City pending"}</span>
                        </button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved supplier found</strong><span>Create supplier first from Parties.</span></div>}
                      </div> : null}
                    </div>
                  </label>
                  <label data-error-key="supplierId" className={cartErrors.supplierId ? "field-error" : ""}>
                    Supplier
                    <select value={orderForm.supplierId} onChange={(e) => { setCartErrors((current) => ({ ...current, supplierId: false })); const selected = parties.find((party) => party.id === e.target.value); if (selected) setPartySearch(selected.name); setOrderForm((current: any) => ({ ...current, supplierId: e.target.value, locationAddress: selected?.deliveryAddress || selected?.address || "", locationCity: selected?.deliveryCity || selected?.city || "" })); }}>
                      {renderOptions(parties)}
                    </select>
                  </label>
                  </> : <div className="list-card">
                    <span className="small-label">Customer</span>
                    <strong>{selectedParty?.name || "Not selected"}</strong>
                    <span>{selectedParty?.gstNumber || "GST pending"} / {selectedParty?.mobileNumber || "Mobile pending"} / {selectedParty?.city || "City pending"}</span>
                  </div>}
                  <label data-error-key="warehouseId" className={cartErrors.warehouseId ? "field-error" : ""}>
                    {isPurchase ? "Delivery To" : "Dispatch From"}
                    <select value={orderForm.warehouseId} onChange={(e) => { const nextWarehouseId = e.target.value; setCartErrors((current) => ({ ...current, warehouseId: false })); setOrderForm((current: any) => isPurchase ? ({ ...current, warehouseId: nextWarehouseId }) : ({ ...current, warehouseId: nextWarehouseId, stockApprovalRequested: false, availableStockAtOrder: "0" })); if (!isPurchase) updateSalesCartStockState(nextWarehouseId); }}>
                      {renderWarehouseOptions(warehouses)}
                    </select>
                  </label>
                  <label className="wide-field">
                    Notes
                    <input value={orderForm.note} onChange={(e) => setOrderForm((current: any) => ({ ...current, note: e.target.value }))} placeholder={isPurchase ? "Delivery or supplier note" : "Delivery or customer note"} />
                  </label>
                </div>
                <div className="cart-line">
                  <div>
                    <span className="small-label">{isPurchase ? "Warehouse" : "Customer"}</span>
                    <strong>{isPurchase ? (warehouses.find((item) => item.id === orderForm.warehouseId)?.name || "Select destination") : (parties.find((item) => item.id === orderForm.shopId)?.name || "Select customer")}</strong>
                  </div>
                  {!isPurchase ? <div>
                    <span className="small-label">Dispatch stock</span>
                    <strong>{orderForm.warehouseId ? `${cartLines.reduce((sum, line) => sum + getLineAvailableStock(line.productSku, orderForm.warehouseId || ""), 0)} units visible` : "Select warehouse"}</strong>
                  </div> : null}
                  <div>
                    <span className="small-label">Total</span>
                    <strong>{cartTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total weight</span>
                    <strong>{totalWeightKg.toFixed(2)} kg</strong>
                  </div>
                </div>
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="primary-button" onClick={() => { if (validateCartStep()) setCartStep("payment"); }}>Proceed</button>
                </div>
                </> : cartStep === "payment" ? <>
                <div className="cart-edit-grid">
                  <label className="wide-field">
                    Entry Date
                    <input type="date" value={checkoutDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setCheckoutDate(e.target.value)} />
                  </label>
                  <label data-error-key="paymentMode" className={cartErrors.paymentMode ? "field-error" : ""}>
                    Payment Method
                    <select value={orderForm.paymentMode} onChange={(e) => { setCartErrors((current) => ({ ...current, paymentMode: false })); setOrderForm((current: any) => ({ ...current, paymentMode: e.target.value as PaymentMode | "" })); }}>
                      <option value="">Select</option>
                      {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
                    </select>
                  </label>
                  {orderForm.paymentMode === "Cash" ? <label data-error-key="cashTiming" className={cartErrors.cashTiming ? "field-error" : ""}>
                    Cash Timing
                    <select value={orderForm.cashTiming} onChange={(e) => { setCartErrors((current) => ({ ...current, cashTiming: false })); setOrderForm((current: any) => ({ ...current, cashTiming: e.target.value })); }}>
                      <option value="">Select</option>
                      <option>In Hand</option>
                      <option>At Delivery</option>
                      {!isPurchase ? <option>Later</option> : null}
                    </select>
                  </label> : null}
                  <label data-error-key="deliveryMode" className={cartErrors.deliveryMode ? "field-error" : ""}>
                    Delivery Mode
                    <select value={orderForm.deliveryMode} onChange={(e) => { setCartErrors((current) => ({ ...current, deliveryMode: false })); setOrderForm((current: any) => ({ ...current, deliveryMode: e.target.value })); }}>
                      <option value="">Select</option>
                      {isPurchase ? <><option>Dealer Delivery</option><option>Self Collection</option></> : <><option>Delivery</option><option>Self Collection</option></>}
                    </select>
                  </label>
                  <label className="wide-field">
                    Saved address
                    <input value={[selectedParty?.address, selectedParty?.city].filter(Boolean).join(", ")} readOnly />
                  </label>
                  <label className="wide-field">
                    Run address
                    <div className="inline-input-action">
                      <input value={liveAddressText} onChange={(e) => setOrderForm((current: any) => ({ ...current, locationAddress: e.target.value, location: current.location ? { ...current.location, address: e.target.value, label: [e.target.value, current.locationCity || ""].filter(Boolean).join(", ") || current.location.label } : current.location }))} placeholder={selectedParty?.deliveryAddress || selectedParty?.address || "Enter current address"} />
                      <button type="button" className="ghost-button" onClick={markCurrentLocation}>Mark current location</button>
                    </div>
                  </label>
                  <label>
                    City
                    <input value={liveCityText} onChange={(e) => setOrderForm((current: any) => ({ ...current, locationCity: e.target.value, location: current.location ? { ...current.location, city: e.target.value, label: [current.locationAddress || "", e.target.value].filter(Boolean).join(", ") || current.location.label } : current.location }))} placeholder={selectedParty?.deliveryCity || selectedParty?.city || "City"} />
                  </label>
                  <label className="checkbox-line wide-field">
                    <input type="checkbox" checked={billTaxOverride.enabled} onChange={(e) => {
                      const enabled = e.target.checked;
                      setBillTaxOverride((current) => ({ ...current, enabled }));
                      if (!enabled) return;
                      applyBillTaxToAllLines(billTaxOverride.gstRate, billTaxOverride.taxMode);
                    }} />
                    Override GST calculation for the whole bill
                  </label>
                  {billTaxOverride.enabled ? <>
                    <label>
                      GST Rate
                      <select value={billTaxOverride.gstRate === "NA" ? "0" : billTaxOverride.gstRate} onChange={(e) => {
                        const nextGstRate = e.target.value as GstRateInput;
                        const nextTaxMode = billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode;
                        setBillTaxOverride({ enabled: true, gstRate: nextGstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(nextGstRate, nextTaxMode);
                      }}>
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="40">40%</option>
                      </select>
                    </label>
                    <label>
                      Calculation
                      <select value={billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode} onChange={(e) => {
                        const nextTaxMode = e.target.value as TaxModeInput;
                        setBillTaxOverride({ enabled: true, gstRate: billTaxOverride.gstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(billTaxOverride.gstRate, nextTaxMode);
                      }}>
                        <option value="Exclusive">GST Extra</option>
                        <option value="Inclusive">GST Included</option>
                      </select>
                    </label>
                  </> : null}
                  <label className="checkbox-line wide-field">
                    <input type="checkbox" checked={advancePayment.enabled} onChange={(e) => {
                      setCartErrors((current) => ({ ...current, advanceAmount: false, advanceMode: false, advanceCashProof: false }));
                      setAdvancePayment((current) => ({ ...current, enabled: e.target.checked, amount: e.target.checked ? current.amount : "", mode: e.target.checked ? current.mode : "", proofName: e.target.checked ? current.proofName : "" }));
                    }} />
                    {isPurchase ? "Advance given to dealer now" : "Advance taken from dealer now"}
                  </label>
                  {advancePayment.enabled ? <>
                    <label data-error-key="advanceAmount" className={cartErrors.advanceAmount ? "field-error" : ""}>
                      Advance Amount
                      <input type="number" step="any" value={advancePayment.amount} onChange={(e) => { setCartErrors((current) => ({ ...current, advanceAmount: false })); setAdvancePayment((current) => ({ ...current, amount: e.target.value })); }} />
                    </label>
                    <label data-error-key="advanceMode" className={cartErrors.advanceMode ? "field-error" : ""}>
                      Advance Mode
                      <select value={advancePayment.mode} onChange={(e) => { setCartErrors((current) => ({ ...current, advanceMode: false, advanceCashProof: false })); setAdvancePayment((current) => ({ ...current, mode: e.target.value as PaymentMode | "" })); }}>
                        <option value="">Select</option>
                        {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
                      </select>
                    </label>
                    {advancePayment.mode === "Cash" ? <label>
                      Cash Timing
                      <select value={advancePayment.cashTiming} onChange={(e) => setAdvancePayment((current) => ({ ...current, cashTiming: e.target.value }))}>
                        <option>In Hand</option>
                        <option>At Delivery</option>
                        {!isPurchase ? <option>Later</option> : null}
                      </select>
                    </label> : null}
                    {advancePayment.mode && advancePayment.mode !== "Cash" ? <label>
                      Reference / UTR
                      <input value={advancePayment.referenceNumber} onChange={(e) => setAdvancePayment((current) => ({ ...current, referenceNumber: e.target.value, utrNumber: e.target.value }))} />
                    </label> : null}
                    {advancePayment.mode === "Cash" ? <label data-error-key="advanceCashProof" className={cartErrors.advanceCashProof ? "field-error wide-field" : "wide-field"}>
                      Cash photo proof
                      <input type="file" accept="image/*" onChange={(e) => void uploadAdvanceProof(e.target.files?.[0] || null)} />
                    </label> : null}
                    {advanceUploading ? <span className="small-label">Uploading cash proof...</span> : null}
                    {advancePayment.proofName ? <a className="ghost-button" href={`${API_BASE}/uploads/payment-proofs/${advancePayment.proofName}`} target="_blank" rel="noreferrer">Show advance proof</a> : null}
                  </> : null}
                </div>
                <div className="cart-line cart-line-summary">
                  <div>
                    <span className="small-label">{isPurchase ? "Supplier" : "Customer"}</span>
                    <strong>{parties.find((item) => item.id === (isPurchase ? orderForm.supplierId : orderForm.shopId))?.name || `Select ${isPurchase ? "supplier" : "customer"}`}</strong>
                  </div>
                  <div>
                    <span className="small-label">Warehouse</span>
                    <strong>{orderForm.warehouseId ? getWarehouseLabel(orderForm.warehouseId) : "Select"}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total</span>
                    <strong>{cartTotal.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span className="small-label">Total weight</span>
                    <strong>{totalWeightKg.toFixed(2)} kg</strong>
                  </div>
                </div>
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="ghost-button" onClick={() => setCartStep("cart")}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      if (!validatePaymentStep()) return;
                      setCartStep("summary");
                    }}
                  >
                    Continue
                  </button>
                </div>
                </> : <>
                <div className="cart-line cart-line-summary">
                  <div>
                    <span className="small-label">{isPurchase ? "Supplier" : "Customer"}</span>
                    <strong>{parties.find((item) => item.id === (isPurchase ? orderForm.supplierId : orderForm.shopId))?.name || "-"}</strong>
                  </div>
                  <div>
                    <span className="small-label">Warehouse</span>
                    <strong>{orderForm.warehouseId ? getWarehouseLabel(orderForm.warehouseId) : "-"}</strong>
                  </div>
                </div>
                <div className="payment-meta-grid cart-summary-grid">
                  <div><span className="small-label">Products</span><strong>{cartLines.length}</strong></div>
                  {!isPurchase ? <div><span className="small-label">Sales type</span><strong>{billingType || "Not selected"}</strong></div> : null}
                  <div><span className="small-label">Quantity</span><strong>{cartLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}</strong></div>
                  <div><span className="small-label">Total weight</span><strong>{totalWeightKg.toFixed(2)} kg</strong></div>
                  <div><span className="small-label">Taxable</span><strong>{cartTaxable.toFixed(2)}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Input GST" : "Output GST"}</span><strong>{cartGstAmount.toFixed(2)}</strong></div>
                  {!isPurchase ? <div><span className="small-label">CD</span><strong>{cartCdAmount.toFixed(2)}</strong></div> : null}
                  {!isPurchase ? <div><span className="small-label">TOD</span><strong>{cartTodAmount.toFixed(2)}</strong></div> : null}
                  <div><span className="small-label">Bill total</span><strong>{cartTotal.toFixed(2)}</strong></div>
                  <div><span className="small-label">Entry date</span><strong>{checkoutDate || "Today"}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{orderForm.paymentMode}{orderForm.paymentMode === "Cash" && orderForm.cashTiming ? ` / ${orderForm.cashTiming}` : ""}</strong></div>
                  {billTaxOverride.enabled ? <div><span className="small-label">Bill tax override</span><strong>{billTaxOverride.gstRate === "NA" ? "0" : billTaxOverride.gstRate}% / {billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode}</strong></div> : null}
                  {advancePayment.enabled ? <div><span className="small-label">{isPurchase ? "Advance given" : "Advance taken"}</span><strong>{Number(advancePayment.amount || 0).toFixed(2)} / {advancePayment.mode}{advancePayment.mode === "Cash" ? " / cash photo attached" : ""}</strong></div> : null}
                  <div><span className="small-label">Delivery mode</span><strong>{orderForm.deliveryMode}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Pickup location" : "Delivery location"}</span><strong>{orderForm.location?.label || [liveAddressText, liveCityText].filter(Boolean).join(", ") || selectedParty?.locationLabel || "Not marked"}</strong></div>
                </div>
                <div className="stack-list top-gap">
                  {cartProducts.map(({ line, product }) => <article className="list-card cart-summary-line" key={line.productSku}>
                    <strong>{productDisplayLabel(product)}</strong>
                    <p>{line.quantity} x {Number(line.rate || 0).toFixed(2)} = {getCartLineTotal(line).toFixed(2)} · {line.gstRate === "NA" ? 0 : line.gstRate}% / {line.taxMode === "NA" ? "Exclusive" : line.taxMode}{!isPurchase ? ` · CD ${getCartLineCdAmount(line).toFixed(2)} · TOD ${getCartLineTodAmount(line).toFixed(2)}` : ""}</p>
                  </article>)}
                </div>
                {orderForm.note ? <div className="cart-line"><div><span className="small-label">Note</span><strong>{orderForm.note}</strong></div></div> : null}
                <div className="cart-actions">
                  <button type="button" className="ghost-button danger-button" onClick={clearCartDraft}>Clear cart</button>
                  <button type="button" className="ghost-button" onClick={() => setCartStep("payment")}>Back</button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={submittingCart}
                    onClick={async () => {
                      if (submittingCart) return;
                      setSubmittingCart(true);
                      const probationaryLines = !isPurchase ? cartLines
                        .map((line) => ({ line, probationaryQuantity: getProbationaryQuantity(line) }))
                        .filter((item) => item.probationaryQuantity > 0) : [];
                      const allowProbationarySale = probationaryLines.length > 0
                        ? window.confirm(`Probationary warning:\n${probationaryLines.map((item) => `${item.line.productSku}: sold ${Number(item.line.quantity || 0)}, available ${getLineAvailableStock(item.line.productSku, orderForm.warehouseId || "")}, probationary ${item.probationaryQuantity}`).join("\n")}\n\nContinue and record the extra quantity in probationary sales for accounts review?`)
                        : false;
                      if (probationaryLines.length > 0 && !allowProbationarySale) {
                        setSubmittingCart(false);
                        return;
                      }
                      const success = await onSubmit(buildAdvancePaymentPayload(), checkoutDate || undefined, cartLines, { allowProbationarySale });
                      if (success === false) {
                        setSubmittingCart(false);
                        return;
                      }
                      if (success && typeof success === "object" && "orderId" in success) {
                        setCompletedOrder({ orderId: success.orderId, kind: success.kind });
                      }
                      resetCurrentOrder();
                    }}
                  >
                    {submittingCart ? "Booking..." : "Continue and finalize"}
                  </button>
                </div>
                </>}
              </div>
            </div>, document.body) : null}
            </> : null}
          </div>
        </Panel>
  );

  return rightPanel ? <TwoCol left={mainPanel} right={rightPanel} /> : <section>{mainPanel}</section>;
}
