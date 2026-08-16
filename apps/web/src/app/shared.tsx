import type {
AppSnapshot,
AppUser,
CashTiming,
Counterparty,
DeliveryConsignment,
DeliveryDocket,
DeliveryTask,
GoodsWarrantOutlet,
GstRate,
PaymentMode,
PaymentRecord,
PurchaseOrder,
PurchaseReturn,
SalesOrder,
SalesStatus,
TaxMode,
UserRole
} from "@aapoorti-b2b/domain";
import { calculateTaxAmounts, inferProductWeightKg } from "@aapoorti-b2b/domain";
import axios from "axios";
import type { ChangeEvent } from "react";
import { useEffect,useRef,useState } from "react";
import { productDisplayLabel,productUnitWeightKg } from "../features/catalog/catalogUtils";

export const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
export const browserOriginFallback = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:8080";
export const API_BASE = configuredApiBase || browserOriginFallback;
export const SESSION_KEY = "aapoorti-b2b-user";
export const TOKEN_KEY = "aapoorti-b2b-token";
export const ACTIVE_VIEW_KEY = "aapoorti-b2b-active-view";
export const DELIVERY_MANAGER_WAREHOUSE_KEY = "aapoorti-b2b-dm-warehouse";
export const WORKSPACE_DRAFT_KEY = "aapoorti-b2b-workspace";
export const SIDEBAR_COLLAPSED_KEY = "aapoorti-b2b-sidebar-collapsed";
export const COMPANY_GST_NUMBER = "23AAECA1547R1ZH";
export const api = axios.create({
  baseURL: API_BASE
});

export type GstRateInput = "NA" | "0" | "5" | "12" | "18" | "40";
export type TaxModeInput = "NA" | "Exclusive" | "Inclusive";

export function workspaceStorageKey(userId: number | string, scope: string) {
  return `${WORKSPACE_DRAFT_KEY}:${userId}:${scope}`;
}

export function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

export type ViewKey =
  | "Overview"
  | "Users"
  | "Warehouses"
  | "Products"
  | "ExcelMaker"
  | "GoodsWarrants"
  | "Parties"
  | "Purchase"
  | "Purchases"
  | "PurchaseReturns"
  | "Sales"
  | "SalesOrders"
  | "SalesReturns"
  | "Payments"
  | "Receipts"
  | "Ledger"
  | "Stock"
  | "Delivery"
  | "CurrentDelivery"
  | "NewAssignment"
  | "Settings"
  | "Notes";

export const roleViews: Record<UserRole, ViewKey[]> = {
  Admin: ["Overview", "Users", "Warehouses", "Products", "Parties", "Purchase", "Sales", "Payments", "Receipts", "Ledger", "Stock", "Delivery", "Settings", "Notes"],
  "Warehouse Manager": ["Overview", "Receipts", "Stock", "Ledger", "Notes"],
  "Delivery Manager": ["Overview", "Delivery", "Ledger", "Notes"],
  Purchaser: ["Overview", "Parties", "Purchase", "Purchases", "PurchaseReturns", "Ledger", "Notes"],
  Accounts: ["Overview", "Parties", "Purchases", "SalesOrders", "Payments", "ExcelMaker", "GoodsWarrants", "Ledger", "Stock", "Notes"],
  Sales: ["Overview", "Parties", "Sales", "SalesOrders", "SalesReturns", "Ledger", "Notes"],
  "Collection Agent": ["Overview", "SalesOrders", "Payments", "Ledger", "Notes"],
  "Data Analyst": ["Overview", "Purchases", "SalesOrders", "Stock"],
  "In Delivery": ["Overview", "CurrentDelivery", "NewAssignment", "Notes"],
  "Out Delivery": ["Overview", "CurrentDelivery", "NewAssignment", "Notes"],
  Delivery: ["Overview", "CurrentDelivery", "NewAssignment", "Notes"]
};

export const simpleRoleViews: Record<UserRole, ViewKey[]> = {
  Admin: ["Overview", "Users", "Warehouses", "Products", "Purchase", "Sales", "Payments", "Receipts", "Ledger", "Stock", "Delivery", "Settings", "Notes"],
  "Warehouse Manager": ["Overview", "Receipts", "Stock"],
  "Delivery Manager": ["Overview", "Delivery"],
  Purchaser: ["Overview", "Parties", "Purchase", "Purchases", "PurchaseReturns"],
  Accounts: ["Overview", "Parties", "Purchases", "SalesOrders", "Payments", "ExcelMaker", "GoodsWarrants", "Ledger"],
  Sales: ["Overview", "Parties", "Sales", "SalesOrders", "SalesReturns"],
  "Collection Agent": ["Overview", "SalesOrders", "Payments", "Ledger"],
  "Data Analyst": ["Overview", "Purchases", "SalesOrders", "Stock"],
  "In Delivery": ["Overview", "CurrentDelivery", "NewAssignment"],
  "Out Delivery": ["Overview", "CurrentDelivery", "NewAssignment"],
  Delivery: ["Overview", "CurrentDelivery", "NewAssignment"]
};

export const labels: Record<ViewKey, string> = {
  Overview: "Home",
  Users: "Users",
  Warehouses: "Warehouses",
  Products: "Products",
  ExcelMaker: "Excel Maker",
  GoodsWarrants: "Goods Warrants",
  Parties: "Parties",
  Purchase: "Purchase",
  Purchases: "Purchases",
  PurchaseReturns: "Purchase Return",
  Sales: "Sales",
  SalesOrders: "Sales",
  SalesReturns: "Sales Return",
  Payments: "Payments",
  Receipts: "Receipts",
  Ledger: "Ledger",
  Stock: "Stock",
  Delivery: "Delivery",
  CurrentDelivery: "Current Delivery",
  NewAssignment: "New Assignment",
  Settings: "Settings",
  Notes: "Notes"
};

export const returnReasons: Array<PurchaseReturn["reason"]> = ["Rate Difference", "Damage", "Quality Issue", "Wrong Item", "Excess Quantity", "Other"];
export const goodsWarrantOutlets: GoodsWarrantOutlet[] = ["Awadhpuri", "Koh E Fiza", "New Market", "Kolar", "Indrapuri"];

export type OrderQrTarget = {
  side: "Purchase" | "Sales";
  orderId: string;
};

export type OrderStatusSummary = {
  target: OrderQrTarget;
  title: string;
  partyName: string;
  createdAt: string;
  warehouseNames: string[];
  productSummary: string;
  deliveryMode: string;
  workflowStatus: string;
  deliveryStatus: string;
  paymentStatus: string;
  currentAction: string;
  completed: boolean;
  totalAmount: number;
  note: string;
};

export type OrderStatusAccess = {
  authorized: boolean;
  reason: string;
};

export function orderQrShortLabel(target: OrderQrTarget) {
  return target.side === "Purchase" ? "PO" : "SO";
}

export function buildOrderQrToken(target: OrderQrTarget) {
  return `AAPOORTI|${target.side}|${target.orderId}`;
}

export function buildOrderStatusUrl(target: OrderQrTarget) {
  if (typeof window === "undefined") return buildOrderQrToken(target);
  const url = new URL(window.location.href);
  url.searchParams.set("qrSide", target.side);
  url.searchParams.set("qrOrder", target.orderId);
  return url.toString();
}

export function parseOrderQrValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      const side = url.searchParams.get("qrSide");
      const orderId = url.searchParams.get("qrOrder");
      if ((side === "Purchase" || side === "Sales") && orderId) {
        return { side, orderId } satisfies OrderQrTarget;
      }
    } catch {}
  }
  const tokenMatch = trimmed.match(/^AAPOORTI\|(Purchase|Sales)\|(.+)$/i);
  if (tokenMatch) {
    return { side: tokenMatch[1] === "Purchase" ? "Purchase" : "Sales", orderId: tokenMatch[2].trim() } satisfies OrderQrTarget;
  }
  const compactMatch = trimmed.match(/^(PO|SO)[:\s-]*(.+)$/i);
  if (compactMatch) {
    return { side: compactMatch[1].toUpperCase() === "PO" ? "Purchase" : "Sales", orderId: compactMatch[2].trim() } satisfies OrderQrTarget;
  }
  return null;
}

export function readOrderQrTargetFromLocation() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const side = url.searchParams.get("qrSide");
  const orderId = url.searchParams.get("qrOrder");
  if ((side === "Purchase" || side === "Sales") && orderId) {
    return { side, orderId } satisfies OrderQrTarget;
  }
  return null;
}

export function clearOrderQrTargetFromLocation() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("qrSide");
  url.searchParams.delete("qrOrder");
  window.history.replaceState({}, "", url.toString());
}

export async function copyTextToClipboard(value: string) {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  if (typeof document === "undefined") return;
  const input = document.createElement("textarea");
  input.value = value;
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  document.body.removeChild(input);
}

export function downloadDataUrlFile(fileName: string, dataUrl: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function displayLabel(view: ViewKey, user?: AppUser | null) {
  if (!user) return labels[view];
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  if (roles.includes("Warehouse Manager")) {
    if (view === "Stock") return "Dispatches";
  }
  if (roles.includes("Purchaser") && view === "Purchase") return "PO";
  if (roles.includes("Sales") && view === "Sales") return "SO";
  return labels[view];
}

export function getVisibleViews(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return Array.from(new Set(roles.flatMap((role) => roleViews[role] || [])));
}

export function shouldForceSimpleMode(user: AppUser | null) {
  if (!user) return false;
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  if (roles.includes("Admin") || roles.includes("Accounts") || roles.includes("Data Analyst")) return false;
  return roles.some((role) => role === "Purchaser" || role === "Sales" || role === "Delivery Manager" || role === "In Delivery" || role === "Out Delivery" || role === "Delivery");
}

export function preferredSimpleMode(user: AppUser) {
  if (shouldForceSimpleMode(user)) return true;
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return !roles.some((role) => role === "Admin" || role === "Accounts" || role === "Data Analyst");
}

export function getVisibleViewsForMode(user: AppUser, simpleMode: boolean) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  const source = simpleMode || shouldForceSimpleMode(user) ? simpleRoleViews : roleViews;
  return Array.from(new Set(roles.flatMap((role) => source[role] || [])));
}

export function clearSessionState(setCurrentUser: React.Dispatch<React.SetStateAction<AppUser | null>>, setSessionToken: React.Dispatch<React.SetStateAction<string>>, setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot | null>>) {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ACTIVE_VIEW_KEY);
  window.localStorage.removeItem(DELIVERY_MANAGER_WAREHOUSE_KEY);
  setCurrentUser(null);
  setSessionToken("");
  setSnapshot(null);
}

export function groupPurchaseRows(orders: PurchaseOrder[], snapshot?: AppSnapshot) {
  const grouped = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const key = order.cartId || order.id;
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => {
    const first = lines[0];
    return [
      id,
      first.supplierName,
      lines.map((line) => line.productSku).join(", "),
      lines.reduce((sum, line) => sum + line.taxableAmount, 0),
      lines.reduce((sum, line) => sum + line.gstAmount, 0),
      lines.reduce((sum, line) => sum + line.totalAmount, 0),
      snapshot ? purchaseWorkflowStatus(snapshot, id) : (lines.length > 1 ? `${first.status} (${lines.length} products)` : first.status)
    ];
  });
}

export function groupSalesRows(orders: SalesOrder[], snapshot?: AppSnapshot) {
  const grouped = new Map<string, SalesOrder[]>();
  for (const order of orders) {
    const key = order.cartId || order.id;
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => {
    const first = lines[0];
    return [
      id,
      first.shopName,
      lines.map((line) => line.productSku).join(", "),
      lines.reduce((sum, line) => sum + line.taxableAmount, 0),
      lines.reduce((sum, line) => sum + line.gstAmount, 0),
      lines.reduce((sum, line) => sum + line.totalAmount, 0),
      snapshot
        ? `${salesFulfillmentStatus(lines)} / Payment ${salesPaymentStatus(snapshot, id)}`
        : lines.length > 1
          ? `${salesStatusLabel(first.status)} (${lines.length} products)`
          : salesStatusLabel(first.status)
    ];
  });
}

export function toCsvValue(value: string | number) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function downloadCsvFile(fileName: string, headers: string[], rows: Array<Array<string | number>>) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function safeDateToken(value: string) {
  return value.replace(/[^\d-]/g, "") || indiaDateKey();
}

export function dateRangeFileToken(fromDate: string, toDate: string) {
  const normalized = normalizeDateRange(fromDate, toDate);
  return normalized.fromDate === normalized.toDate
    ? safeDateToken(normalized.fromDate)
    : `${safeDateToken(normalized.fromDate)}-to-${safeDateToken(normalized.toDate)}`;
}

export function gstBillTypeLabel(gstRate: GstRate) {
  return "GST";
}

export function gstRateExportValue(gstRate: GstRate) {
  return gstRate === "NA" ? 0 : Number(gstRate || 0);
}

export async function buildTablePdfBlob(title: string, subtitleLines: string[], headers: string[], rows: Array<Array<string | number>>) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const colWidth = contentWidth / Math.max(headers.length, 1);
  const lineHeight = 4;
  let cursorY = 14;

  const ensurePage = (nextHeight: number) => {
    if (cursorY + nextHeight <= pageHeight - margin) return;
    doc.addPage("a4", "landscape");
    cursorY = 14;
    drawHeaderRow();
  };

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, cursorY);
  cursorY += 7;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  subtitleLines.forEach((line) => {
    doc.text(line, margin, cursorY);
    cursorY += 4;
  });
  cursorY += 2;

  const drawHeaderRow = () => {
    doc.setFillColor(232, 245, 245);
    doc.rect(margin, cursorY, contentWidth, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(15, 23, 42);
    headers.forEach((header, index) => {
      const x = margin + index * colWidth + 1.5;
      const text = doc.splitTextToSize(header, colWidth - 3).slice(0, 2);
      doc.text(text, x, cursorY + 3.5);
    });
    cursorY += 8;
  };

  drawHeaderRow();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  rows.forEach((row) => {
    const cells = row.map((value) => doc.splitTextToSize(String(value ?? ""), colWidth - 3).slice(0, 3));
    const rowHeight = Math.max(...cells.map((cell) => Math.max(cell.length, 1))) * lineHeight + 2;
    ensurePage(rowHeight);
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, cursorY, contentWidth, rowHeight);
    cells.forEach((cell, index) => {
      const x = margin + index * colWidth + 1.5;
      doc.text(cell.length > 0 ? cell : [""], x, cursorY + 3.5);
    });
    cursorY += rowHeight;
  });

  return doc.output("blob");
}

export function formatCurrencyInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatShortNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(Number.isFinite(value) ? value : 0);
}

export function formatShortDate(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

export function formatDateTimeIst(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function formatDateIst(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

export function formatLongDateIst(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });
}

export function sortCounterpartiesAlphabetically(items: Counterparty[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, "en-IN", { sensitivity: "base" }));
}

export function addOneMonthForVoucherPreview(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const nextMonthLastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, nextMonthLastDay))).toISOString().slice(0, 10);
}

export function subtractOneDayFromNextMonth(dateKey: string) {
  const nextCycleDate = addOneMonthForVoucherPreview(dateKey);
  const date = new Date(`${nextCycleDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function printInvoiceDocument(title: string, bodyHtml: string) {
  if (typeof window === "undefined") return;
  const popup = window.open("", "_blank", "noopener,noreferrer,width=900,height=1200");
  if (!popup) return;
  popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "Segoe UI", sans-serif;
        color: #0f172a;
        background: #fff;
      }
      .invoice-shell {
        width: 100%;
        max-width: 780px;
        margin: 0 auto;
        padding: 16px;
      }
      .invoice-card {
        border: 1px solid #d7dee7;
        border-radius: 18px;
        padding: 20px;
      }
      .invoice-head,
      .invoice-meta,
      .invoice-totals {
        display: grid;
        gap: 12px;
      }
      .invoice-head {
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        padding-bottom: 16px;
        border-bottom: 1px solid #e2e8f0;
      }
      .invoice-head-main,
      .invoice-head-side,
      .invoice-kachcha-head-main,
      .invoice-kachcha-head-side {
        display: grid;
        gap: 10px;
      }
      .invoice-head-side,
      .invoice-kachcha-head-side {
        justify-items: end;
      }
      .invoice-head h1 {
        margin: 6px 0 0;
        font-size: 28px;
        line-height: 1;
      }
      .invoice-brand {
        color: #0f766e;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.16em;
        text-transform: uppercase;
      }
      .invoice-subhead {
        margin-top: 6px;
        color: #475569;
        font-size: 13px;
      }
      .invoice-badge {
        display: inline-flex;
        padding: 6px 12px;
        border-radius: 999px;
        background: #e6fffb;
        color: #0f766e;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .invoice-meta {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin: 18px 0;
      }
      .invoice-meta-wide {
        grid-template-columns: repeat(4, minmax(0, 1fr));
      }
      .invoice-meta .wide,
      .invoice-kachcha-meta .wide {
        grid-column: 1 / -1;
      }
      .invoice-meta div,
      .invoice-totals div {
        padding: 10px 12px;
        border-radius: 14px;
        background: #f8fafc;
      }
      .invoice-meta span,
      .invoice-totals span,
      .invoice-line-table th {
        display: block;
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .invoice-meta strong,
      .invoice-totals strong {
        display: block;
        margin-top: 5px;
        font-size: 15px;
      }
      .invoice-line-table {
        width: 100%;
        margin-top: 18px;
        border-collapse: collapse;
      }
      .invoice-line-table th,
      .invoice-line-table td {
        padding: 10px 8px;
        border-bottom: 1px solid #e2e8f0;
        text-align: left;
        vertical-align: top;
        font-size: 13px;
      }
      .invoice-line-table th:last-child,
      .invoice-line-table td:last-child,
      .invoice-line-table th:nth-last-child(2),
      .invoice-line-table td:nth-last-child(2),
      .invoice-line-table th:nth-last-child(3),
      .invoice-line-table td:nth-last-child(3) {
        text-align: right;
      }
      .invoice-totals {
        grid-template-columns: repeat(3, minmax(0, 1fr));
        margin-top: 18px;
      }
      .invoice-kachcha-shell {
        width: 100%;
        max-width: 740px;
        margin: 0 auto;
        padding: 16px;
      }
      .invoice-kachcha-card {
        border: 2px solid #0f172a;
        border-radius: 8px;
        padding: 18px;
      }
      .invoice-kachcha-head {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: flex-start;
        padding-bottom: 12px;
        border-bottom: 1px dashed #94a3b8;
      }
      .invoice-kachcha-title {
        margin: 4px 0 0;
        font-size: 26px;
        line-height: 1;
      }
      .invoice-qr-card {
        display: grid;
        gap: 6px;
        justify-items: center;
      }
      .invoice-qr-image {
        width: 96px;
        height: 96px;
        padding: 4px;
        border: 1px solid #cbd5e1;
        border-radius: 10px;
        background: #fff;
        object-fit: contain;
      }
      .invoice-qr-card span {
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .invoice-kachcha-meta {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        margin: 14px 0;
      }
      .invoice-kachcha-meta div {
        padding: 8px 10px;
        border: 1px dashed #cbd5e1;
        border-radius: 8px;
      }
      .invoice-kachcha-meta span {
        display: block;
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .invoice-kachcha-meta strong {
        display: block;
        margin-top: 4px;
        font-size: 14px;
      }
      .invoice-kachcha-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 12px;
      }
      .invoice-kachcha-table th,
      .invoice-kachcha-table td {
        padding: 9px 8px;
        border: 1px solid #cbd5e1;
        font-size: 13px;
        text-align: left;
      }
      .invoice-kachcha-table th:last-child,
      .invoice-kachcha-table td:last-child,
      .invoice-kachcha-table th:nth-last-child(2),
      .invoice-kachcha-table td:nth-last-child(2),
      .invoice-kachcha-table th:nth-last-child(3),
      .invoice-kachcha-table td:nth-last-child(3) {
        text-align: right;
      }
      .invoice-kachcha-total {
        margin-top: 14px;
        display: flex;
        justify-content: flex-end;
      }
      .invoice-kachcha-total div {
        min-width: 220px;
        padding: 12px 14px;
        border-radius: 10px;
        background: #f8fafc;
      }
      .invoice-kachcha-total span {
        display: block;
        color: #64748b;
        font-size: 11px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .invoice-kachcha-total strong {
        display: block;
        margin-top: 5px;
        font-size: 20px;
      }
      .invoice-note {
        margin-top: 18px;
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff7ed;
        color: #9a3412;
        font-size: 13px;
      }
      @media (max-width: 720px) {
        .invoice-head,
        .invoice-kachcha-head,
        .invoice-meta,
        .invoice-meta-wide,
        .invoice-kachcha-meta,
        .invoice-totals {
          grid-template-columns: 1fr;
        }
        .invoice-head-side,
        .invoice-kachcha-head-side {
          justify-items: start;
        }
      }
      @media print {
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        .invoice-shell { padding: 0; max-width: none; }
      }
    </style>
  </head>
  <body>
    ${bodyHtml}
  </body>
</html>`);
  popup.document.close();
  popup.focus();
  window.setTimeout(() => {
    popup.print();
  }, 250);
}

export function displayOrderNote(note?: string) {
  const text = (note || "").trim();
  if (!text) return "";
  if (/Imported from\s+/i.test(text)) {
    return "";
  }
  if (/Probationary shortage recorded:/i.test(text)) {
    return "";
  }
  const warehouseSourceMatch = text.match(/Warehouse source\s+([^|]+)/i);
  if (warehouseSourceMatch) {
    return `Fulfillment Source: ${warehouseSourceMatch[1].trim()}`;
  }
  return text;
}

export function invoiceValue(value?: string | number | null) {
  if (value === null || value === undefined) return "N/A";
  const text = String(value).trim();
  return text ? text : "N/A";
}

export function purchaseInvoiceCounterparty(snapshot: AppSnapshot, group: { lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  return snapshot.counterparties.find((item) => item.type === "Supplier" && item.id === first?.supplierId);
}

export function salesInvoiceCounterparty(snapshot: AppSnapshot, group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  return snapshot.counterparties.find((item) => item.type === "Shop" && item.id === first?.shopId);
}

export type InvoicePdfRow = {
  product: string;
  quantity: number;
  rate: number;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
};

export type InvoicePdfConfig = {
  fileName: string;
  documentTitle: string;
  partyLabel: string;
  partyName: string;
  warehouseName: string;
  contactName: string;
  mobileNumber: string;
  address: string;
  createdAt?: string;
  statusLabel: string;
  note?: string;
  qrDataUrl?: string;
  rows: InvoicePdfRow[];
  totals: Array<{ label: string; value: number }>;
  companyGstNumber?: string;
};

export function safePdfFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim() || "invoice";
}

export function downloadBlobFile(fileName: string, blob: Blob) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
}

export function numberToWordsUnder1000(value: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (value < 20) return ones[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ""}`.trim();
  return `${ones[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${numberToWordsUnder1000(value % 100)}` : ""}`.trim();
}

export function numberToIndianWords(value: number) {
  const integer = Math.floor(Math.max(0, value));
  if (integer === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(integer / 10000000);
  const lakh = Math.floor((integer % 10000000) / 100000);
  const thousand = Math.floor((integer % 100000) / 1000);
  const hundred = integer % 1000;
  if (crore) parts.push(`${numberToWordsUnder1000(crore)} Crore`);
  if (lakh) parts.push(`${numberToWordsUnder1000(lakh)} Lakh`);
  if (thousand) parts.push(`${numberToWordsUnder1000(thousand)} Thousand`);
  if (hundred) parts.push(numberToWordsUnder1000(hundred));
  return parts.join(" ").trim();
}

export function formatChequeAmountWords(value: number) {
  const whole = Math.floor(Math.max(0, value));
  const paise = Math.round((Math.max(0, value) - whole) * 100);
  const rupeesText = `${numberToIndianWords(whole)} Rupees`;
  return paise > 0 ? `${rupeesText} and ${numberToWordsUnder1000(paise)} Paise Only` : `${rupeesText} Only`;
}

export function salesLineCdAmount(line: SalesOrder) {
  return Number((line as SalesOrder & { cdAmount?: number }).cdAmount || 0);
}

export function salesLineTodAmount(line: SalesOrder) {
  return Number((line as SalesOrder & { todAmount?: number }).todAmount || 0);
}

export function formatWeightKg(value: number) {
  return `${Math.max(0, value).toFixed(3)} kg`;
}

export function salesLineUnitWeightKg(snapshot: AppSnapshot, line: SalesOrder) {
  const product = snapshot.products.find((item) => item.sku === line.productSku);
  return product ? productUnitWeightKg(product) : inferProductWeightKg(line.productSku);
}

export function salesLineWeightKg(snapshot: AppSnapshot, line: SalesOrder) {
  return salesLineUnitWeightKg(snapshot, line) * Number(line.quantity || 0);
}

export function salesInvoiceWeightKg(snapshot: AppSnapshot, group: { lines: SalesOrder[] }) {
  return group.lines.reduce((sum, line) => sum + salesLineWeightKg(snapshot, line), 0);
}

export function openChequePrintWindow(payload: { partyName: string; amount: number; date: string; referenceNumber: string; note: string; }) {
  if (typeof window === "undefined") return;
  const printWindow = window.open("", "_blank", "width=900,height=600");
  if (!printWindow) return;
  const amountText = payload.amount.toFixed(2);
  const words = formatChequeAmountWords(payload.amount);
  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>Cheque Print</title>
    <style>
      body { font-family: "Segoe UI", sans-serif; margin: 0; padding: 24px; color: #0f172a; }
      .sheet { width: 100%; max-width: 860px; margin: 0 auto; border: 1px solid #cbd5e1; border-radius: 18px; padding: 28px; }
      .top, .line { display: flex; justify-content: space-between; gap: 16px; align-items: center; }
      .top { margin-bottom: 20px; }
      .payee, .amount-box, .note-box { border: 1px solid #cbd5e1; border-radius: 12px; padding: 14px 16px; }
      .payee { margin-bottom: 14px; }
      .amount-box { min-width: 180px; text-align: right; font-size: 28px; font-weight: 800; }
      .label { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: #64748b; display: block; margin-bottom: 6px; }
      .value { font-size: 24px; font-weight: 800; }
      .words { min-height: 64px; border-bottom: 1px dashed #94a3b8; padding: 8px 0 12px; margin-bottom: 14px; font-size: 20px; font-weight: 700; }
      .meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
      .note-box { min-height: 88px; }
      @media print { body { padding: 0; } .sheet { border: 0; border-radius: 0; } }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="top">
        <div><span class="label">Date</span><div class="value">${escapeXml(payload.date)}</div></div>
        <div class="amount-box">${escapeXml(amountText)}</div>
      </div>
      <div class="payee">
        <span class="label">Pay</span>
        <div class="value">${escapeXml(payload.partyName)}</div>
      </div>
      <span class="label">Amount In Words</span>
      <div class="words">${escapeXml(words)}</div>
      <div class="meta">
        <div class="note-box"><span class="label">Reference</span><div>${escapeXml(payload.referenceNumber)}</div></div>
        <div class="note-box"><span class="label">Narration</span><div>${escapeXml(payload.note)}</div></div>
      </div>
    </div>
    <script>window.onload = function(){ window.print(); };</script>
  </body>
</html>`);
  printWindow.document.close();
}

export async function shareInvoicePdfFile(fileName: string, blob: Blob, title: string) {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function" && typeof File !== "undefined") {
    const file = new File([blob], fileName, { type: "application/pdf" });
    const shareData = { title, files: [file] };
    if (typeof navigator.canShare !== "function" || navigator.canShare(shareData)) {
      await navigator.share(shareData);
      return;
    }
  }
  downloadBlobFile(fileName, blob);
  if (typeof window !== "undefined") {
    window.alert("Direct WhatsApp PDF share is not supported on this browser. The PDF has been downloaded to your device; attach that file in WhatsApp.");
  }
}

export async function buildInvoicePdfBlob(config: InvoicePdfConfig) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  let cursorY = 14;
  const qrBoxSize = config.qrDataUrl ? 22 : 0;
  const qrBoxWidth = config.qrDataUrl ? 28 : 0;
  const headerTextRight = pageWidth - margin - qrBoxWidth - 4;

  const drawMetaCard = (x: number, y: number, width: number, label: string, value: string) => {
    doc.setDrawColor(215, 222, 231);
    doc.roundedRect(x, y, width, 16, 3, 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(label.toUpperCase(), x + 3, y + 5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    const lines = doc.splitTextToSize(value || "-", width - 6);
    doc.text(lines.slice(0, 2), x + 3, y + 10);
  };

  const drawTableHeader = (y: number) => {
    doc.setFillColor(230, 255, 251);
    doc.roundedRect(margin, y, contentWidth, 9, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const headers = [
        { label: "#", x: margin + 3, align: "left" as const },
        { label: "Product", x: margin + 14, align: "left" as const },
        { label: "Qty", x: margin + 104, align: "right" as const },
        { label: "Rate", x: margin + 126, align: "right" as const },
        { label: "Taxable", x: margin + 148, align: "right" as const },
        { label: "GST", x: margin + 166, align: "right" as const },
        { label: "Total", x: margin + 182, align: "right" as const }
      ];
    headers.forEach((header) => doc.text(header.label, header.x, y + 6, { align: header.align }));
  };

  doc.setFillColor(15, 118, 110);
  doc.roundedRect(margin, cursorY, contentWidth, 24, 5, 5, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  if (config.companyGstNumber) {
    doc.text(`AAPOORTI B2B | GSTIN: ${config.companyGstNumber}`, margin + 4, cursorY + 6);
  } else {
    doc.text("AAPOORTI B2B", margin + 4, cursorY + 6);
  }
  doc.setFontSize(18);
  doc.text(config.documentTitle, margin + 4, cursorY + 16);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(config.fileName.replace(/\.pdf$/i, ""), headerTextRight, cursorY + 8, { align: "right" });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const statusLines = doc.splitTextToSize(config.statusLabel || "-", 44);
  doc.text(statusLines.slice(0, 2), headerTextRight, cursorY + 14, { align: "right" });
  if (config.qrDataUrl) {
    try {
      doc.setFillColor(255, 255, 255);
      doc.roundedRect(pageWidth - margin - 24, cursorY + 2, 24, 24, 3, 3, "F");
      doc.addImage(config.qrDataUrl, "PNG", pageWidth - margin - 23, cursorY + 3, qrBoxSize, qrBoxSize);
    } catch {}
  }
  cursorY += 30;

  const metaWidth = (contentWidth - 6) / 2;
  drawMetaCard(margin, cursorY, metaWidth, config.partyLabel, config.partyName);
  drawMetaCard(margin + metaWidth + 6, cursorY, metaWidth, "Warehouse", config.warehouseName);
  cursorY += 20;
  drawMetaCard(margin, cursorY, metaWidth, "Date", formatShortDate(config.createdAt));
  drawMetaCard(margin + metaWidth + 6, cursorY, metaWidth, "AAPOORTI GSTIN", invoiceValue(config.companyGstNumber));
  cursorY += 20;
  drawMetaCard(margin, cursorY, metaWidth, "Contact", config.contactName);
  drawMetaCard(margin + metaWidth + 6, cursorY, metaWidth, "Mobile", config.mobileNumber);
  cursorY += 20;
  drawMetaCard(margin, cursorY, contentWidth, "Address", config.address);
  cursorY += 24;

  drawTableHeader(cursorY);
  cursorY += 12;

  config.rows.forEach((row, index) => {
    const productLines = doc.splitTextToSize(row.product, 76);
    const rowHeight = Math.max(8, productLines.length * 4.5 + 2);
    if (cursorY + rowHeight + 28 > pageHeight - margin) {
      doc.addPage();
      cursorY = 16;
      drawTableHeader(cursorY);
      cursorY += 12;
    }
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, cursorY + rowHeight, pageWidth - margin, cursorY + rowHeight);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(String(index + 1), margin + 3, cursorY + 5);
    doc.text(productLines, margin + 14, cursorY + 5);
    doc.text(String(row.quantity), margin + 104, cursorY + 5, { align: "right" });
    doc.text(formatMoney(row.rate), margin + 126, cursorY + 5, { align: "right" });
    doc.text(formatMoney(row.taxableAmount), margin + 148, cursorY + 5, { align: "right" });
    doc.text(formatMoney(row.gstAmount), margin + 166, cursorY + 5, { align: "right" });
    doc.text(formatMoney(row.totalAmount), margin + 182, cursorY + 5, { align: "right" });
    cursorY += rowHeight + 2;
  });

  if (cursorY + 16 + config.totals.length * 11 > pageHeight - margin) {
    doc.addPage();
    cursorY = 16;
  }

  const totalsBoxWidth = 72;
  const totalsBoxX = pageWidth - margin - totalsBoxWidth;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(totalsBoxX, cursorY + 4, totalsBoxWidth, 10 + config.totals.length * 9, 3, 3, "F");
  config.totals.forEach((item, index) => {
    const y = cursorY + 11 + index * 9;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label.toUpperCase(), totalsBoxX + 4, y);
    doc.setFont("helvetica", index === config.totals.length - 1 ? "bold" : "normal");
    doc.setFontSize(index === config.totals.length - 1 ? 12 : 10);
    doc.setTextColor(15, 23, 42);
    doc.text(formatMoney(item.value), totalsBoxX + totalsBoxWidth - 4, y, { align: "right" });
  });
  cursorY += 18 + config.totals.length * 9;

  if (config.note) {
    if (cursorY + 18 > pageHeight - margin) {
      doc.addPage();
      cursorY = 16;
    }
    doc.setFillColor(255, 247, 237);
    doc.roundedRect(margin, cursorY, contentWidth, 16, 3, 3, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(154, 52, 18);
    doc.text("NOTE", margin + 4, cursorY + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(doc.splitTextToSize(config.note, contentWidth - 8), margin + 4, cursorY + 11);
  }

  return doc.output("blob");
}

export async function buildPurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  const warehouseName = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))).join(", ");
  const supplier = purchaseInvoiceCounterparty(snapshot, group);
  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Purchase", orderId: group.id }), { width: 180, margin: 1 });
  return buildInvoicePdfBlob({
    fileName: safePdfFileName(`${group.id}-purchase-tax-invoice.pdf`),
    documentTitle: "Purchase Tax Invoice",
    partyLabel: "Supplier",
    partyName: `${invoiceValue(first?.supplierName || supplier?.name)} | GST ${invoiceValue(supplier?.gstNumber)}`,
    warehouseName,
    contactName: invoiceValue(supplier?.contactPerson),
    mobileNumber: invoiceValue(supplier?.mobileNumber),
    address: invoiceValue([supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ")),
    createdAt: first?.createdAt,
    statusLabel: purchaseWorkflowStatus(snapshot, group.id),
    qrDataUrl,
    note: [
      `Purchaser: ${invoiceValue(first?.purchaserName)}`,
      `Delivery Mode: ${invoiceValue(first?.deliveryMode)}`,
      `Contact: ${invoiceValue(supplier?.contactPerson)}`,
      `Mobile: ${invoiceValue(supplier?.mobileNumber)}`,
      `Address: ${invoiceValue(supplier?.deliveryAddress || supplier?.address)}`,
      `City: ${invoiceValue(supplier?.deliveryCity || supplier?.city)}`
    ].join(" | "),
    rows: group.lines.map((line) => ({
      product: line.productSku,
      quantity: line.quantityOrdered,
      rate: line.rate,
      taxableAmount: line.taxableAmount,
      gstAmount: line.gstAmount,
      totalAmount: line.totalAmount
    })),
    totals: [
      { label: "Taxable", value: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0) },
      { label: "GST", value: group.lines.reduce((sum, line) => sum + line.gstAmount, 0) },
      { label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount, 0) }
    ],
    companyGstNumber: COMPANY_GST_NUMBER
  });
}

export async function buildSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const first = group.lines[0];
  const warehouseName = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))).join(", ");
  const customer = salesInvoiceCounterparty(snapshot, group);
  const totalWeight = salesInvoiceWeightKg(snapshot, group);
  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Sales", orderId: group.id }), { width: 180, margin: 1 });
  return buildInvoicePdfBlob({
    fileName: safePdfFileName(`${group.id}-sales-tax-invoice.pdf`),
    documentTitle: "Sales Tax Invoice",
    partyLabel: "Customer",
    partyName: `${invoiceValue(first?.shopName || customer?.name)} | ${first?.billingType || "B2C"} | GST ${invoiceValue(customer?.gstNumber)}`,
    warehouseName,
    contactName: invoiceValue(customer?.contactPerson),
    mobileNumber: invoiceValue(customer?.mobileNumber),
    address: invoiceValue([customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ")),
    createdAt: first?.createdAt,
    statusLabel: `${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`,
    qrDataUrl,
    note: [
      `Total Weight: ${formatWeightKg(totalWeight)}`,
      `Salesman: ${invoiceValue(first?.salesmanName)}`,
      `Delivery Mode: ${invoiceValue(first?.deliveryMode)}`,
      `Contact: ${invoiceValue(customer?.contactPerson)}`,
      `Mobile: ${invoiceValue(customer?.mobileNumber)}`,
      `Address: ${invoiceValue(customer?.deliveryAddress || customer?.address)}`,
      `City: ${invoiceValue(customer?.deliveryCity || customer?.city)}`
    ].join(" | "),
    rows: group.lines.map((line) => ({
      product: `${line.productSku}\nUnit wt ${formatWeightKg(salesLineUnitWeightKg(snapshot, line))} | Line wt ${formatWeightKg(salesLineWeightKg(snapshot, line))}`,
      quantity: line.quantity,
      rate: line.rate,
      taxableAmount: line.taxableAmount,
      gstAmount: line.gstAmount,
      totalAmount: line.totalAmount
    })),
    totals: [
      { label: "Taxable", value: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0) },
      { label: "GST", value: group.lines.reduce((sum, line) => sum + line.gstAmount, 0) },
      { label: "CD", value: group.lines.reduce((sum, line) => sum + salesLineCdAmount(line), 0) },
      { label: "TOD", value: group.lines.reduce((sum, line) => sum + salesLineTodAmount(line), 0) },
      { label: "Delivery", value: group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0) },
      { label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0) }
    ],
    companyGstNumber: COMPANY_GST_NUMBER
  });
}

export async function downloadPurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const blob = await buildPurchaseInvoicePdf(snapshot, group);
  downloadBlobFile(safePdfFileName(`${group.id}.pdf`), blob);
}

export async function downloadSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const blob = await buildSalesInvoicePdf(snapshot, group);
  downloadBlobFile(safePdfFileName(`${group.id}.pdf`), blob);
}

export async function sharePurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const blob = await buildPurchaseInvoicePdf(snapshot, group);
  await shareInvoicePdfFile(safePdfFileName(`${group.id}.pdf`), blob, `Purchase invoice ${group.id}`);
}

export async function shareSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const blob = await buildSalesInvoicePdf(snapshot, group);
  await shareInvoicePdfFile(safePdfFileName(`${group.id}.pdf`), blob, `Sales invoice ${group.id}`);
}

export async function printPurchaseInvoice(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Purchase", orderId: group.id }), { width: 180, margin: 1 });
  printInvoiceDocument(`PO ${group.id}`, purchaseInvoiceHtml(snapshot, group, qrDataUrl));
}

export async function printSalesInvoice(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const { default: QRCode } = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Sales", orderId: group.id }), { width: 180, margin: 1 });
  printInvoiceDocument(`SO ${group.id}`, salesInvoiceHtml(snapshot, group, qrDataUrl));
}

export function purchaseInvoiceHtml(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }, qrDataUrl?: string) {
  const first = group.lines[0];
  const supplier = purchaseInvoiceCounterparty(snapshot, group);
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  const rows = group.lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.productSku)}</td>
      <td>${line.quantityOrdered}</td>
      <td>${formatMoney(line.rate)}</td>
      <td>${formatMoney(line.taxableAmount)}</td>
      <td>${formatMoney(line.gstAmount)}</td>
      <td>${formatMoney(line.totalAmount)}</td>
    </tr>
  `).join("");
  return `
    <main class="invoice-shell">
      <section class="invoice-card">
        <div class="invoice-head">
          <div class="invoice-head-main">
            <div class="invoice-brand">AAPOORTI B2B</div>
            <span class="invoice-badge">Purchase Tax Invoice</span>
            <h1>${escapeHtml(group.id)}</h1>
            <div class="invoice-subhead">Professional purchase bill format</div>
          </div>
          <div class="invoice-head-side">
            <div><strong>${escapeHtml(purchaseWorkflowStatus(snapshot, group.id))}</strong></div>
            ${qrDataUrl ? `<div class="invoice-qr-card"><img class="invoice-qr-image" src="${qrDataUrl}" alt="PO QR" /><span>Order QR</span></div>` : ""}
          </div>
        </div>
        <div class="invoice-meta invoice-meta-wide">
          <div><span>Supplier</span><strong>${escapeHtml(invoiceValue(first?.supplierName || supplier?.name))}</strong></div>
          <div><span>Warehouse</span><strong>${escapeHtml(warehouseNames.join(", "))}</strong></div>
          <div><span>Created</span><strong>${escapeHtml(formatShortDate(first?.createdAt))}</strong></div>
          <div><span>Delivery Mode</span><strong>${escapeHtml(invoiceValue(first?.deliveryMode))}</strong></div>
          <div><span>Bill Type</span><strong>GST</strong></div>
          <div><span>Supplier GST</span><strong>${escapeHtml(invoiceValue(supplier?.gstNumber))}</strong></div>
          <div><span>Purchaser</span><strong>${escapeHtml(invoiceValue(first?.purchaserName))}</strong></div>
          <div><span>Contact</span><strong>${escapeHtml(invoiceValue(supplier?.contactPerson))}</strong></div>
          <div><span>Mobile</span><strong>${escapeHtml(invoiceValue(supplier?.mobileNumber))}</strong></div>
          <div class="wide"><span>Address</span><strong>${escapeHtml(invoiceValue([supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ")))}</strong></div>
        </div>
        <table class="invoice-line-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Taxable</th>
              <th>GST</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="invoice-totals">
          <div><span>Taxable</span><strong>${formatMoney(taxable)}</strong></div>
          <div><span>GST</span><strong>${formatMoney(gst)}</strong></div>
          <div><span>Grand Total</span><strong>${formatMoney(total)}</strong></div>
        </div>
      </section>
    </main>
  `;
}

export function salesInvoiceHtml(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }, qrDataUrl?: string) {
  const first = group.lines[0];
  const customer = salesInvoiceCounterparty(snapshot, group);
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const cd = group.lines.reduce((sum, line) => sum + salesLineCdAmount(line), 0);
  const tod = group.lines.reduce((sum, line) => sum + salesLineTodAmount(line), 0);
  const delivery = group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0);
  const totalWeight = salesInvoiceWeightKg(snapshot, group);
  const rows = group.lines.map((line, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.productSku)}</td>
      <td>${line.quantity}</td>
      <td>${formatWeightKg(salesLineWeightKg(snapshot, line))}<br><small>${formatWeightKg(salesLineUnitWeightKg(snapshot, line))}/unit</small></td>
      <td>${formatMoney(line.rate)}</td>
      <td>${formatMoney(line.taxableAmount)}</td>
      <td>${formatMoney(line.gstAmount)}</td>
      <td>${formatMoney(salesLineCdAmount(line))}</td>
      <td>${formatMoney(salesLineTodAmount(line))}</td>
      <td>${formatMoney(line.totalAmount)}</td>
    </tr>
  `).join("");
  return `
    <main class="invoice-shell">
      <section class="invoice-card">
        <div class="invoice-head">
          <div class="invoice-head-main">
            <div class="invoice-brand">AAPOORTI B2B</div>
            <span class="invoice-badge">Sales Tax Invoice</span>
            <h1>${escapeHtml(group.id)}</h1>
            <div class="invoice-subhead">Professional sales bill format</div>
          </div>
          <div class="invoice-head-side">
            <div><strong>${escapeHtml(`${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`)}</strong></div>
            ${qrDataUrl ? `<div class="invoice-qr-card"><img class="invoice-qr-image" src="${qrDataUrl}" alt="SO QR" /><span>Order QR</span></div>` : ""}
          </div>
        </div>
        <div class="invoice-meta invoice-meta-wide">
          <div><span>Customer</span><strong>${escapeHtml(invoiceValue(first?.shopName || customer?.name))}</strong></div>
          <div><span>Warehouse</span><strong>${escapeHtml(warehouseNames.join(", "))}</strong></div>
          <div><span>Created</span><strong>${escapeHtml(formatShortDate(first?.createdAt))}</strong></div>
          <div><span>Delivery Mode</span><strong>${escapeHtml(invoiceValue(first?.deliveryMode))}</strong></div>
          <div><span>Sales Type</span><strong>${escapeHtml(first?.billingType || "B2C")}</strong></div>
          <div><span>Customer GST</span><strong>${escapeHtml(invoiceValue(customer?.gstNumber))}</strong></div>
          <div><span>Salesman</span><strong>${escapeHtml(invoiceValue(first?.salesmanName))}</strong></div>
          <div><span>Contact</span><strong>${escapeHtml(invoiceValue(customer?.contactPerson))}</strong></div>
          <div><span>Mobile</span><strong>${escapeHtml(invoiceValue(customer?.mobileNumber))}</strong></div>
          <div class="wide"><span>Address</span><strong>${escapeHtml(invoiceValue([customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ")))}</strong></div>
        </div>
        <table class="invoice-line-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Weight</th>
              <th>Rate</th>
              <th>Taxable</th>
              <th>GST</th>
              <th>CD</th>
              <th>TOD</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="invoice-totals">
          <div><span>Total Weight</span><strong>${formatWeightKg(totalWeight)}</strong></div>
          <div><span>Taxable</span><strong>${formatMoney(taxable)}</strong></div>
          <div><span>GST</span><strong>${formatMoney(gst)}</strong></div>
          <div><span>CD</span><strong>${formatMoney(cd)}</strong></div>
          <div><span>TOD</span><strong>${formatMoney(tod)}</strong></div>
          <div><span>Delivery</span><strong>${formatMoney(delivery)}</strong></div>
          <div><span>Grand Total</span><strong>${formatMoney(total)}</strong></div>
        </div>
      </section>
    </main>
  `;
}

export function purchaseInvoiceWhatsappText(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  const lines = [
      "AAPOORTI B2B",
      "Purchase Tax Invoice",
      `PO: ${group.id}`,
      `Supplier: ${first?.supplierName || "Supplier"}`,
      `Warehouse: ${warehouseNames.join(", ")}`,
      `Date: ${formatShortDate(first?.createdAt)}`,
      ...group.lines.map((line) => `${line.productSku} | Qty ${line.quantityOrdered} | Rate ${formatMoney(line.rate)} | Taxable ${formatMoney(line.taxableAmount)} | GST ${formatMoney(line.gstAmount)} | Total ${formatMoney(line.totalAmount)}`),
      `Taxable Total: ${formatMoney(taxable)}`,
      `GST Total: ${formatMoney(gst)}`,
      `Grand Total: ${formatMoney(total)}`
    ];
  return encodeURIComponent(lines.join("\n"));
}

export function salesInvoiceWhatsappText(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const first = group.lines[0];
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const cd = group.lines.reduce((sum, line) => sum + salesLineCdAmount(line), 0);
  const tod = group.lines.reduce((sum, line) => sum + salesLineTodAmount(line), 0);
  const delivery = group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0);
  const totalWeight = salesInvoiceWeightKg(snapshot, group);
  const lines = [
      "AAPOORTI B2B",
      "Sales Tax Invoice",
      `SO: ${group.id}`,
      `Sales Type: ${first?.billingType || "B2C"}`,
      `Customer: ${first?.shopName || "Customer"}`,
      `Warehouse: ${warehouseNames.join(", ")}`,
      `Date: ${formatShortDate(first?.createdAt)}`,
      ...group.lines.map((line) => `${line.productSku} | Qty ${line.quantity} | Weight ${formatWeightKg(salesLineWeightKg(snapshot, line))} (${formatWeightKg(salesLineUnitWeightKg(snapshot, line))}/unit) | Rate ${formatMoney(line.rate)} | Taxable ${formatMoney(line.taxableAmount)} | GST ${formatMoney(line.gstAmount)} | CD ${formatMoney(salesLineCdAmount(line))} | TOD ${formatMoney(salesLineTodAmount(line))} | Total ${formatMoney(line.totalAmount)}`),
      `Total Weight: ${formatWeightKg(totalWeight)}`,
      `Taxable Total: ${formatMoney(taxable)}`,
      `GST Total: ${formatMoney(gst)}`,
      `CD Total: ${formatMoney(cd)}`,
      `TOD Total: ${formatMoney(tod)}`,
      `Delivery: ${formatMoney(delivery)}`,
      `Grand Total: ${formatMoney(total)}`
    ];
  return encodeURIComponent(lines.join("\n"));
}

export function indiaDateKey(value?: string | Date) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function indiaYesterdayDateKey() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return indiaDateKey(now);
}

export function normalizeDateRange(fromDate: string, toDate: string) {
  if (!fromDate && !toDate) {
    const today = indiaDateKey();
    return { fromDate: today, toDate: today };
  }
  if (!fromDate) return { fromDate: toDate, toDate };
  if (!toDate) return { fromDate, toDate: fromDate };
  return fromDate <= toDate ? { fromDate, toDate } : { fromDate: toDate, toDate: fromDate };
}

export function dateKeyInRange(dateKey: string, fromDate: string, toDate: string) {
  const normalized = normalizeDateRange(fromDate, toDate);
  return dateKey >= normalized.fromDate && dateKey <= normalized.toDate;
}

export function dailySalesCollectorLabel(payment?: PaymentRecord, fallback = "Pending") {
  if (!payment) return fallback;
  const note = `${payment.verificationNote || ""} ${payment.createdBy || ""}`.toLowerCase();
  if (note.includes("delivery")) return "Delivery";
  if (note.includes("collection agent")) return "Collection Agent";
  if (note.includes("sales")) return "Sales Guy";
  return payment.createdBy || fallback;
}

export async function buildDailySalesReportPdf(snapshot: AppSnapshot, orders: SalesOrder[]) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 12;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;
  const todayKey = indiaDateKey();
  const visibleGroups = groupSalesOrders(orders)
    .filter((group) => {
      const createdToday = Boolean(group.lines[0] && indiaDateKey(group.lines[0].createdAt) === todayKey);
      const collectedToday = snapshot.payments.some((payment) => payment.side === "Sales" && payment.linkedOrderId === group.id && indiaDateKey(payment.createdAt) === todayKey);
      return createdToday || collectedToday;
    })
    .map((group) => {
      const first = group.lines[0];
      const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === group.id);
      const payments = snapshot.payments
        .filter((item) => item.side === "Sales" && item.linkedOrderId === group.id)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
      const latestPayment = payments[0];
      return {
        id: group.id,
        createdAt: first.createdAt,
        party: first.shopName || "Customer",
        salesman: first.salesmanName || "N/A",
        orderMode: first.paymentMode || "N/A",
        cashTiming: first.cashTiming || "",
        total: ledger?.goodsValue ?? salesOrderPublicTotal(snapshot.salesOrders, group.id),
        paid: ledger?.paidAmount ?? 0,
        pending: ledger?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, group.id),
        paymentStatus: salesPaymentStatus(snapshot, group.id),
        collector: latestPayment ? dailySalesCollectorLabel(latestPayment) : "Pending",
        collectorMode: latestPayment?.mode || first.paymentMode || "N/A",
        lines: group.lines.map((line) => `${line.productSku} x ${line.quantity}`).join(", ")
      };
    })
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
  const eligiblePayments = snapshot.payments.filter((payment) =>
    payment.side === "Sales" &&
    ["Submitted", "Verified", "Resolved"].includes(payment.verificationStatus) &&
    visibleGroups.some((group) => group.id === payment.linkedOrderId)
  );
  const modeTotals = ["Cash", "UPI", "NEFT", "Card", "Cheque"] as PaymentMode[];
  const totalsByMode = modeTotals
    .map((mode) => ({
      mode,
      value: eligiblePayments.filter((payment) => payment.mode === mode).reduce((sum, payment) => sum + payment.amount, 0)
    }))
    .filter((item) => item.value > 0);
  const timingTotals = (["At Delivery", "In Hand", "Later"] as CashTiming[])
    .map((timing) => ({
      timing,
      count: visibleGroups.filter((group) => group.orderMode === "Cash" && group.cashTiming === timing).length,
      value: visibleGroups.filter((group) => group.orderMode === "Cash" && group.cashTiming === timing).reduce((sum, group) => sum + group.total, 0)
    }))
    .filter((item) => item.count > 0 || item.value > 0);
  const totalBilled = visibleGroups.reduce((sum, item) => sum + item.total, 0);
  const totalPaid = visibleGroups.reduce((sum, item) => sum + item.paid, 0);
  const totalPending = visibleGroups.reduce((sum, item) => sum + item.pending, 0);
  let y = 16;
  const ensureSpace = (height: number) => {
    if (y + height <= pageHeight - 12) return;
    doc.addPage();
    y = 14;
  };
  doc.setFillColor(15, 118, 110);
  doc.roundedRect(margin, y, contentWidth, 24, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Daily Sales Report", margin + 4, y + 8);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(`Date: ${todayKey} | SO count: ${visibleGroups.length}`, margin + 4, y + 15);
  doc.text("Per-SO sales, collections, pending, and mode-wise totals", margin + 4, y + 20);
  y += 30;
  const summaryCards = [
    { label: "Total Sales", value: formatMoney(totalBilled) },
    { label: "Collected", value: formatMoney(totalPaid) },
    { label: "Pending", value: formatMoney(totalPending) }
  ];
  const cardWidth = (contentWidth - 8) / 3;
  summaryCards.forEach((item, index) => {
    const x = margin + index * (cardWidth + 4);
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(206, 215, 224);
    doc.roundedRect(x, y, cardWidth, 18, 3, 3, "FD");
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.text(item.label.toUpperCase(), x + 3, y + 5);
    doc.setTextColor(15, 23, 42);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text(item.value, x + 3, y + 13);
  });
  y += 24;
  if (totalsByMode.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Collected By Mode", margin, y);
    y += 6;
    totalsByMode.forEach((item) => {
      ensureSpace(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(item.mode, margin, y);
      doc.setFont("helvetica", "bold");
      doc.text(formatMoney(item.value), pageWidth - margin, y, { align: "right" });
      y += 6;
    });
    y += 3;
  }
  if (timingTotals.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Sales Timing", margin, y);
    y += 6;
    timingTotals.forEach((item) => {
      ensureSpace(7);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`${item.timing} (${item.count})`, margin, y);
      doc.setFont("helvetica", "bold");
      doc.text(formatMoney(item.value), pageWidth - margin, y, { align: "right" });
      y += 6;
    });
    y += 3;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Sales Orders", margin, y);
  y += 7;
  for (const item of visibleGroups) {
    ensureSpace(28);
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(margin, y, contentWidth, 24, 3, 3, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text(`${item.id} | ${item.party}`, margin + 3, y + 6);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`${formatShortDate(item.createdAt)} | Salesman: ${item.salesman} | Collector: ${item.collector}`, margin + 3, y + 11);
    doc.text(`Mode: ${item.collectorMode} | Order mode: ${item.orderMode}${item.cashTiming ? ` / ${item.cashTiming}` : ""} | Status: ${item.paymentStatus}`, margin + 3, y + 16);
    const lineText = doc.splitTextToSize(`Items: ${item.lines}`, contentWidth - 8);
    doc.text(lineText, margin + 3, y + 21);
    doc.setFont("helvetica", "bold");
    doc.text(`Total ${formatMoney(item.total)} | Paid ${formatMoney(item.paid)} | Pending ${formatMoney(item.pending)}`, pageWidth - margin - 3, y + 6, { align: "right" });
    y += 28;
  }
  return doc.output("blob");
}

export async function downloadDailySalesReportPdf(snapshot: AppSnapshot, orders: SalesOrder[]) {
  const blob = await buildDailySalesReportPdf(snapshot, orders);
  downloadBlobFile(safePdfFileName(`daily-sales-report-${indiaDateKey()}.pdf`), blob);
}

export function scopedDailySalesOrders(snapshot: AppSnapshot, currentUser: AppUser) {
  const roles = userRoleList(currentUser);
  const salesGroups = groupSalesOrders(snapshot.salesOrders);
  if (roles.includes("Collection Agent")) {
    const visibleGroupIds = new Set(salesGroups.filter((group) => collectionVisibleToUser(snapshot, group, currentUser)).map((group) => group.id));
    const collectedTodayIds = new Set(
      snapshot.payments
        .filter((payment) => payment.side === "Sales" && indiaDateKey(payment.createdAt) === indiaDateKey() && dailySalesCollectorLabel(payment) === "Collection Agent")
        .map((payment) => payment.linkedOrderId)
    );
    return snapshot.salesOrders.filter((order) => visibleGroupIds.has(orderPublicId(order)) || collectedTodayIds.has(orderPublicId(order)));
  }
  if (roles.includes("Out Delivery") || roles.includes("Delivery")) {
    const assignedOrderIds = new Set(
      deliveryTasksForUser(snapshot, currentUser)
        .filter((task) => task.side === "Sales")
        .flatMap((task) => task.routeStops.map((stop) => stop.orderId))
    );
    return snapshot.salesOrders.filter((order) => assignedOrderIds.has(orderPublicId(order)));
  }
  if (roles.includes("Sales")) {
    return snapshot.salesOrders.filter((order) => order.salesmanId === currentUser.id || order.salesmanName === currentUser.fullName);
  }
  return snapshot.salesOrders;
}

export async function downloadHomeDailySalesReportPdf(snapshot: AppSnapshot, currentUser: AppUser) {
  await downloadDailySalesReportPdf(snapshot, scopedDailySalesOrders(snapshot, currentUser));
}

export function countGroupedOrders(orders: Array<{ id: string; cartId?: string }>) {
  return new Set(orders.map((order) => order.cartId || order.id)).size;
}

export function orderPublicId(order: { id: string; cartId?: string }) {
  return order.cartId || order.id;
}

export function prioritizeWarehouseIds(warehouseIds: string[]) {
  return [...warehouseIds].sort((left, right) => {
    const leftPriority = left.trim().toLowerCase() === "gp" ? 0 : 1;
    const rightPriority = right.trim().toLowerCase() === "gp" ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  });
}

export function preferredWarehouseId(warehouseIds: string[]) {
  return prioritizeWarehouseIds(warehouseIds)[0] || "";
}

export function groupOldestCreatedAt<T extends { createdAt: string }>(lines: T[]) {
  return Math.min(...lines.map((line) => new Date(line.createdAt).getTime()));
}

export function groupNewestCreatedAt<T extends { createdAt: string }>(lines: T[]) {
  return Math.max(...lines.map((line) => new Date(line.createdAt).getTime()));
}

export function isOpenPurchaseOrder(order: PurchaseOrder) {
  return order.status !== "Received" && order.status !== "Closed" && order.status !== "Cancelled";
}

export function isOpenSalesOrder(order: SalesOrder) {
  return order.status !== "Delivered" && order.status !== "Closed" && order.status !== "Cancelled";
}

export function findPurchaseOrderByPublicId(orders: PurchaseOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

export function findSalesOrderByPublicId(orders: SalesOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

export function productNameBySku(products: AppSnapshot["products"], sku: string) {
  const product = products.find((item) => item.sku === sku);
  return product ? productDisplayLabel(product) : sku;
}

export function productNamesSummary(products: AppSnapshot["products"], skus: string[], separator = ", ") {
  return skus.map((sku) => productNameBySku(products, sku)).join(separator);
}

export function purchaseOrderPublicTotal(orders: PurchaseOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount, 0);
}

export function salesOrderPublicTotal(orders: SalesOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount + order.deliveryCharge, 0);
}

export function salesDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks.find((task) => task.side === "Sales" && [task.linkedOrderId, ...task.linkedOrderIds].includes(orderId));
}

export function salesDeliveryStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.salesOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Delivery not assigned";
  if (lines.every((line) => line.status === "Delivered" || line.status === "Closed")) return "Delivered";
  const task = salesDeliveryTask(snapshot, orderId);
  if (!task) {
    return lines.some((line) => line.deliveryMode === "Self Collection") ? "Customer pickup" : "Delivery not assigned";
  }
  return `${deliveryTaskStatusLabel(task)}${task.assignedTo ? ` to ${task.assignedTo}` : ""}`;
}

export function salesPaymentStatus(snapshot: AppSnapshot, orderId: string) {
  const ledger = snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === orderId);
  const latest = snapshot.payments
    .filter((item) => item.side === "Sales" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
  if (latest?.verificationStatus === "Disputed") return "Disputed";
  if (latest?.verificationStatus === "Rejected") return "Flagged";
  if (ledger && ledger.pendingAmount <= 0 && (latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved")) return "Completed";
  if (ledger && ledger.pendingAmount <= 0 && (latest?.verificationStatus === "Submitted" || latest?.verificationStatus === "Pending")) return "Paid";
  if ((ledger && ledger.paidAmount > 0) || latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved") return "Partial";
  return "Pending";
}

export function salesPaymentsByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.payments
    .filter((item) => item.side === "Sales" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function collectionAssignment(snapshot: AppSnapshot, orderId: string) {
  const notes = snapshot.notes
    .filter((note) => note.entityType === "Sales Order" && note.entityId === orderId && note.note.startsWith("Collection assignment:"))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const latest = notes[0];
  if (!latest) return "";
  return latest.note.replace(/^Collection assignment:\s*/i, "").trim();
}

export function groupSalesCashTiming(group: { lines: SalesOrder[] }) {
  return group.lines[0]?.cashTiming || "";
}

export function salesCollectionHandledByDelivery(group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  return first?.deliveryMode === "Delivery" && first?.paymentMode === "Cash" && first?.cashTiming === "At Delivery";
}

export function salesCollectionEligibleForAgent(group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  if (!first) return false;
  if (first.paymentMode !== "Cash") return true;
  return first.cashTiming === "Later";
}

export function collectionVisibleToUser(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }, user: AppUser) {
  if (!salesCollectionEligibleForAgent(group)) return false;
  const assignedCollector = collectionAssignment(snapshot, group.id);
  const userNames = [user.fullName, user.username].map((value) => value.trim().toLowerCase()).filter(Boolean);
  const ownsOrder = group.lines.some((line) => line.salesmanId === user.id || line.salesmanName === user.fullName);
  const isCollectionAgent = user.roles.includes("Collection Agent");
  if (assignedCollector) {
    return ownsOrder || (isCollectionAgent && userNames.includes(assignedCollector.trim().toLowerCase()));
  }
  if (isCollectionAgent) return false;
  return ownsOrder;
}

export function latestSalesPayment(snapshot: AppSnapshot, orderId: string) {
  return salesPaymentsByOrder(snapshot, orderId)[0];
}

export function salesFulfillmentStatus(lines: SalesOrder[]) {
  if (lines.every((line) => line.status === "Delivered" || line.status === "Closed")) return "Delivered";
  if (lines.some((line) => line.status === "Draft")) return "Draft";
  if (lines.some((line) => line.status === "Out for Delivery")) return salesStatusLabel("Out for Delivery");
  if (lines.some((line) => line.status === "Ready for Dispatch")) return salesStatusLabel("Ready for Dispatch");
  if (lines.some((line) => line.status === "Pending Pickup")) return salesStatusLabel("Pending Pickup");
  if (lines.some((line) => line.status === "Self Pickup")) return salesStatusLabel("Self Pickup");
  return salesStatusLabel(lines[0]?.status || "Booked");
}

export function groupPurchaseOrders(orders: PurchaseOrder[]) {
  const grouped = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const key = orderPublicId(order);
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => ({ id, lines }));
}

export function groupSalesOrders(orders: SalesOrder[]) {
  const grouped = new Map<string, SalesOrder[]>();
  for (const order of orders) {
    const key = orderPublicId(order);
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => ({ id, lines }));
}

export function purchaseLedgerByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.ledgerEntries.find((item) => item.side === "Purchase" && item.linkedOrderId === orderId);
}

export function purchasePaymentsByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.payments
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

export function latestPurchasePayment(snapshot: AppSnapshot, orderId: string) {
  return purchasePaymentsByOrder(snapshot, orderId)[0];
}

export function purchaseCashDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId && item.paymentAction === "Deliver Payment")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

export function purchaseWarehouseStatus(lines: PurchaseOrder[]) {
  if (lines.every((line) => line.status === "Received" || line.status === "Closed")) return "Received";
  if (lines.some((line) => line.status === "Partially Received")) return "Partially Received";
  return "Order Placed - Pending Delivery";
}

export function purchasePaymentStatus(snapshot: AppSnapshot, orderId: string) {
  const ledger = purchaseLedgerByOrder(snapshot, orderId);
  const latest = latestPurchasePayment(snapshot, orderId);
  const cashTask = purchaseCashDeliveryTask(snapshot, orderId);
  if (latest?.verificationStatus === "Disputed") return "Disputed";
  if (latest?.verificationStatus === "Rejected") return "Flagged";
  if (cashTask && cashTask.status !== "Delivered" && cashTask.status !== "Handed Over") return "Cash With Delivery";
  if (ledger && ledger.pendingAmount <= 0 && (latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved")) return "Completed";
  if ((ledger && ledger.paidAmount > 0) || latest?.verificationStatus === "Verified" || latest?.verificationStatus === "Resolved") return "Partial";
  if (latest?.verificationStatus === "Submitted" || latest?.verificationStatus === "Pending") return "Pending";
  return "Pending";
}

export function purchaseWorkflowStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Pending";
  return `${purchaseWarehouseStatus(lines)} / Payment ${purchasePaymentStatus(snapshot, orderId)}`;
}

export function purchaseDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks.find((task) => task.side === "Purchase" && [task.linkedOrderId, ...task.linkedOrderIds].includes(orderId));
}

export function purchaseNeedsInternalPickup(lines: PurchaseOrder[]) {
  return lines.some((line) => line.deliveryMode === "Self Collection");
}

export function purchaseDeliveryStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Delivery not assigned";
  if (lines.every((line) => line.status === "Received" || line.status === "Closed")) return "Received";
  const task = purchaseDeliveryTask(snapshot, orderId);
  if (!task) {
    return purchaseNeedsInternalPickup(lines) ? "Pickup not assigned" : "Vendor delivery";
  }
  return `${deliveryTaskStatusLabel(task)}${task.assignedTo ? ` to ${task.assignedTo}` : ""}`;
}

export function statusPillClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("flagged") || normalized.includes("disputed") || normalized.includes("rejected")) return "status-rejected";
  if (normalized.includes("customer pickup") || normalized.includes("vendor delivery")) return "status-pending";
  if (normalized.includes("pending") || normalized.includes("partial") || normalized.includes("cash with delivery")) return "status-pending";
  if (normalized.includes("completed") || normalized.includes("received") || normalized.includes("delivered") || normalized.includes("verified") || normalized.includes("closed")) return "status-verified";
  return "status-pending";
}

export function purchaseOrderExportHeaders() {
  return ["Date", "PO Number", "Supplier", "Product", "Purchase Price", "Sale Price", "Qty Ordered", "Qty Received", "GST Bill", "GST %", "Taxable", "GST Amount", "Total", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Warehouse Status", "Order Status", "Warehouse"];
}

export function purchaseOrderExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: PurchaseOrder[] }>) {
  return groups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(line.createdAt),
    group.id,
    line.supplierName,
    line.productSku,
    line.rate,
    "",
    line.quantityOrdered,
    line.quantityReceived,
    gstBillTypeLabel(line.gstRate),
    gstRateExportValue(line.gstRate),
    line.taxableAmount,
    line.gstAmount,
    line.totalAmount,
    line.paymentMode,
    line.cashTiming || "",
    line.deliveryMode,
    purchaseDeliveryStatus(snapshot, group.id),
    purchaseWarehouseStatus(group.lines),
    line.status,
    snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId
  ]));
}

export function salesOrderExportHeaders() {
  return ["Date", "SO Number", "Customer", "Sales Type", "Product", "Purchase Price", "Sale Price", "Qty", "GST Bill", "GST %", "Taxable", "GST Amount", "Delivery", "Total", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Payment Status", "Order Status", "Warehouse"];
}

export function salesOrderExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: SalesOrder[] }>) {
  return groups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(line.createdAt),
    group.id,
    line.shopName,
    line.billingType || "B2C",
    productNameBySku(snapshot.products, line.productSku),
    "",
    line.rate,
    line.quantity,
    gstBillTypeLabel(line.gstRate),
    gstRateExportValue(line.gstRate),
    line.taxableAmount,
    line.gstAmount,
    line.deliveryCharge,
    line.totalAmount + line.deliveryCharge,
    line.paymentMode,
    line.cashTiming || "",
    line.deliveryMode,
    salesDeliveryStatus(snapshot, group.id),
    salesPaymentStatus(snapshot, group.id),
    line.status,
    snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId
  ]));
}

export function deliveryTaskExportHeaders() {
  return ["Created Date", "Task ID", "Side", "Task Status", "Assigned To", "Mode", "Transport", "Vehicle", "From", "To", "Order IDs", "Party", "Product Summary", "Warehouse", "Payment Action", "Cash Required", "Reached", "Checked", "Paid", "Picked"];
}

export function deliveryTaskExportRows(tasks: DeliveryTask[]) {
  return tasks.flatMap((task) => {
    if (task.routeStops.length === 0) {
      return [[
        indiaDateKey(task.createdAt),
        task.id,
        task.side,
        task.status,
        task.assignedTo,
        task.mode,
        task.transportType,
        task.vehicleNumber || "",
        task.from,
        task.to,
        task.linkedOrderIds.join(" | "),
        "",
        "",
        "",
        task.paymentAction,
        task.cashCollectionRequired ? "Yes" : "No",
        "",
        "",
        "",
        ""
      ]];
    }
    return task.routeStops.map((stop) => [
      indiaDateKey(task.createdAt),
      task.id,
      task.side,
      task.status,
      task.assignedTo,
      task.mode,
      task.transportType,
      task.vehicleNumber || "",
      task.from,
      task.to,
      stop.orderId || task.linkedOrderIds.join(" | "),
      stop.supplierName || "",
      stop.productSummary || "",
      stop.warehouseName || stop.warehouseId || "",
      task.paymentAction,
      stop.paymentRequired ? "Yes" : "No",
      stop.reached ? "Yes" : "No",
      stop.checked ? "Yes" : "No",
      stop.paid ? "Yes" : "No",
      stop.picked ? "Yes" : "No"
    ]);
  });
}

export function inboundOpsExportHeaders() {
  return ["Date", "Flow", "Record Type", "Task ID", "PO Number", "Supplier", "Product", "Qty Ordered", "Qty Received", "Qty Pending", "Rate", "GST Bill", "GST %", "Taxable", "GST Amount", "Total", "Warehouse", "Mode", "Assigned To", "Task Status", "Warehouse Status", "Payment Status"];
}

export function inboundOpsExportRows(
  snapshot: AppSnapshot,
  directGroups: Array<{ id: string; lines: PurchaseOrder[] }>,
  taskItems: Array<{ task: DeliveryTask; groups: Array<{ id: string; lines: PurchaseOrder[] }> }>
) {
  const directRows = directGroups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(new Date(groupNewestCreatedAt(group.lines))),
    "Inbound",
    "Direct Receive",
    "",
    group.id,
    line.supplierName,
    line.productSku,
    line.quantityOrdered,
    line.quantityReceived,
    Math.max(line.quantityOrdered - line.quantityReceived, 0),
    line.rate,
    gstBillTypeLabel(line.gstRate),
    gstRateExportValue(line.gstRate),
    line.taxableAmount,
    line.gstAmount,
    line.totalAmount,
    snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId,
    line.deliveryMode,
    "",
    "Direct warehouse receive",
    purchaseWarehouseStatus(group.lines),
    purchasePaymentStatus(snapshot, group.id)
  ]));
  const taskRows = taskItems.flatMap((item) => item.groups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(item.task.createdAt),
    "Inbound",
    "Task",
    item.task.id,
    group.id,
    line.supplierName,
    line.productSku,
    line.quantityOrdered,
    line.quantityReceived,
    Math.max(line.quantityOrdered - line.quantityReceived, 0),
    line.rate,
    gstBillTypeLabel(line.gstRate),
    gstRateExportValue(line.gstRate),
    line.taxableAmount,
    line.gstAmount,
    line.totalAmount,
    snapshot.warehouses.find((warehouse) => warehouse.id === line.warehouseId)?.name || line.warehouseId,
    item.task.mode,
    item.task.assignedTo,
    item.task.status,
    purchaseWarehouseStatus(group.lines),
    purchasePaymentStatus(snapshot, group.id)
  ])));
  return [...taskRows, ...directRows];
}

export function outboundOpsExportHeaders() {
  return ["Date", "Flow", "Record Type", "Task ID", "SO Number", "Customer", "Product", "Qty", "Purchase Price", "Sale Price", "GST Bill", "GST %", "Taxable", "GST Amount", "Delivery Charge", "Total", "Warehouse", "Mode", "Assigned To", "Task Status", "Payment Action", "Cash Required", "Delivery Status", "Payment Status"];
}

export function outboundOpsExportRows(
  snapshot: AppSnapshot,
  directGroups: Array<{ id: string; lines: SalesOrder[] }>,
  taskItems: Array<{ task: DeliveryTask }>
) {
  const directRows = directGroups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(new Date(groupNewestCreatedAt(group.lines))),
    "Outbound",
    "Direct Dispatch",
    "",
    group.id,
    line.shopName,
    line.productSku,
    line.quantity,
    "",
    line.rate,
    gstBillTypeLabel(line.gstRate),
    gstRateExportValue(line.gstRate),
    line.taxableAmount,
    line.gstAmount,
    line.deliveryCharge,
    line.totalAmount + line.deliveryCharge,
    snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId,
    line.deliveryMode,
    "",
    "Warehouse check",
    "",
    "",
    salesDeliveryStatus(snapshot, group.id),
    salesPaymentStatus(snapshot, group.id)
  ]));
  const taskRows = taskItems.flatMap((item) => {
    if (item.task.routeStops.length === 0) {
      return [[
        indiaDateKey(item.task.createdAt),
        "Outbound",
        "Task",
        item.task.id,
        item.task.linkedOrderIds.join(" | "),
        item.task.to,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        item.task.from,
        item.task.mode,
        item.task.assignedTo,
        item.task.status,
        item.task.paymentAction,
        item.task.cashCollectionRequired ? "Yes" : "No",
        "",
        ""
      ]];
    }
    return item.task.routeStops.map((stop) => {
      const orderLines = snapshot.salesOrders.filter((order) => orderPublicId(order) === stop.orderId);
      const first = orderLines[0];
      return [
      indiaDateKey(item.task.createdAt),
      "Outbound",
      "Task Stop",
      item.task.id,
      stop.orderId,
      stop.supplierName,
      stop.productSummary || (first ? productNameBySku(snapshot.products, first.productSku) : ""),
      orderLines.reduce((sum, line) => sum + line.quantity, 0),
      "",
      first?.rate ?? "",
      first ? gstBillTypeLabel(first.gstRate) : "",
      first ? gstRateExportValue(first.gstRate) : "",
      orderLines.reduce((sum, line) => sum + line.taxableAmount, 0),
      orderLines.reduce((sum, line) => sum + line.gstAmount, 0),
      orderLines.reduce((sum, line) => sum + line.deliveryCharge, 0),
      orderLines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0),
      stop.warehouseName || stop.warehouseId || "",
      item.task.mode,
      item.task.assignedTo,
      item.task.status,
      item.task.paymentAction,
      stop.paymentRequired ? "Yes" : "No",
      salesDeliveryStatus(snapshot, stop.orderId),
      salesPaymentStatus(snapshot, stop.orderId)
    ];
    });
  });
  return [...taskRows, ...directRows];
}

export function purchasePaymentExportHeaders() {
  return ["Date", "PO Number", "Supplier", "Amount", "Mode", "Status", "Reference", "UTR", "Note"];
}

export function purchasePaymentExportRows(snapshot: AppSnapshot, payments: PaymentRecord[]) {
  return payments.map((payment) => {
    const order = findPurchaseOrderByPublicId(snapshot.purchaseOrders, payment.linkedOrderId);
    return [
      indiaDateKey(payment.createdAt),
      payment.linkedOrderId,
      order?.supplierName || "Supplier",
      payment.amount,
      payment.mode,
      payment.verificationStatus,
      payment.referenceNumber || "",
      payment.utrNumber || "",
      payment.verificationNote || ""
    ];
  });
}

export function salesCollectionExportHeaders() {
  return ["Date", "SO Number", "Customer", "Products", "Total", "Paid", "Pending", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Payment Status", "Collection Agent"];
}

export function salesCollectionExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: SalesOrder[]; shopName: string; pendingAmount: number; paidAmount: number; totalAmount: number; paymentMode: PaymentMode; cashTiming: string; deliveryMode: string; }>) {
  return groups.map((group) => [
    indiaDateKey(new Date(groupNewestCreatedAt(group.lines))),
    group.id,
    group.shopName,
    productNamesSummary(snapshot.products, group.lines.map((line) => line.productSku), " | "),
    group.totalAmount,
    group.paidAmount,
    group.pendingAmount,
    group.paymentMode,
    group.cashTiming || "",
    group.deliveryMode,
    salesDeliveryStatus(snapshot, group.id),
    salesPaymentStatus(snapshot, group.id),
    collectionAssignment(snapshot, group.id) || ""
  ]);
}

export function consignmentExportHeaders() {
  return ["Date", "Consignment ID", "Warehouse", "Assigned To", "Dockets", "Total Weight", "Status", "Stops / Orders"];
}

export function consignmentExportRows(snapshot: AppSnapshot, consignments: DeliveryConsignment[]) {
  return consignments.map((consignment) => {
    const dockets = consignment.docketIds.map((id) => snapshot.deliveryDockets.find((item) => item.id === id)).filter(Boolean) as DeliveryDocket[];
    const orderIds = dockets.map((docket) => docket.salesOrderId).join(" | ");
    return [
      indiaDateKey(consignment.createdAt),
      consignment.id,
      snapshot.warehouses.find((item) => item.id === consignment.warehouseId)?.name || consignment.warehouseId,
      consignment.assignedTo || "",
      consignment.docketIds.length,
      consignment.totalWeightKg,
      consignment.status,
      orderIds
    ];
  });
}

export function docketExportHeaders() {
  return ["Date", "Docket ID", "SO Number", "Customer", "Product", "Qty", "Weight", "Warehouse", "Status", "Consignment"];
}

export function docketExportRows(snapshot: AppSnapshot, dockets: DeliveryDocket[]) {
  return dockets.map((docket) => [
    indiaDateKey(docket.createdAt),
    docket.id,
    docket.salesOrderId,
    docket.shopName,
    docket.productSku,
    docket.quantity,
    docket.weightKg,
    snapshot.warehouses.find((item) => item.id === docket.warehouseId)?.name || docket.warehouseId,
    docket.status,
    docket.consignmentId || ""
  ]);
}

export function downloadReportCsv(filePrefix: string, headers: string[], rows: Array<Array<string | number>>, fromDate: string, toDate: string) {
  const token = dateRangeFileToken(fromDate, toDate);
  downloadCsvFile(`${filePrefix}-${token}.csv`, headers, rows);
}

export async function downloadReportPdf(title: string, filePrefix: string, headers: string[], rows: Array<Array<string | number>>, fromDate: string, toDate: string, extraSubtitle: string[] = []) {
  const token = dateRangeFileToken(fromDate, toDate);
  const pdf = await buildTablePdfBlob(title, [`From: ${fromDate}`, `To: ${toDate}`, `Rows: ${rows.length}`, ...extraSubtitle], headers, rows);
  downloadBlobFile(safePdfFileName(`${filePrefix}-${token}.pdf`), pdf);
}

export function salesStatusLabel(status: SalesStatus) {
  switch (status) {
    case "Draft":
      return "Draft";
    case "Booked":
      return "SO booked";
    case "Ready for Dispatch":
      return "SO docket ready";
    case "Pending Pickup":
      return "Assigned, warehouse pickup pending";
    case "Out for Delivery":
      return "Picked from warehouse";
    case "Self Pickup":
      return "Customer pickup";
    case "Delivered":
      return "Delivered";
    case "Closed":
      return "Closed";
    default:
      return status;
  }
}

export function deliveryDocketStatusLabel(status: DeliveryDocket["status"]) {
  switch (status) {
    case "Pending Packing":
      return "Warehouse packing";
    case "Ready":
      return "SO docket ready";
    case "Tagged":
      return "Bundled for outbound";
    case "Pending Pickup":
      return "Assigned, warehouse pickup pending";
    case "Out for Delivery":
      return "Picked from warehouse";
    case "Delivered":
      return "Delivered";
    default:
      return status;
  }
}

export function deliveryConsignmentStatusLabel(status: DeliveryConsignment["status"]) {
  switch (status) {
    case "Draft":
      return "Bundle draft";
    case "Ready":
      return "Bundled, ready to tag";
    case "Pending Pickup":
      return "Tagged, warehouse pickup pending";
    case "Out for Delivery":
      return "Picked from warehouse";
    case "Delivered":
      return "Delivered";
    default:
      return status;
  }
}

export function deliveryTaskStatusLabel(task: DeliveryTask) {
  if (task.side === "Sales") {
    switch (task.status) {
      case "Planned":
        return "Assigned, accept pending";
      case "Picked":
        return "Accepted, reach warehouse";
      case "Handed Over":
        return "Picked from warehouse";
      case "Delivered":
        return "Delivered";
      default:
        return task.status;
    }
  }
  switch (task.status) {
    case "Planned":
      return "Pickup assigned";
    case "Picked":
      return "Picked from supplier";
    case "Handed Over":
      return "Handed to warehouse";
    case "Delivered":
      return "Delivered";
    default:
      return task.status;
  }
}

export function assignedDeliveryUsers(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

export function isUserAssignedToDelivery(value: string, user: AppUser) {
  const assignees = assignedDeliveryUsers(value);
  return assignees.includes(user.username) || assignees.includes(user.fullName);
}

export function deliveryTasksForUser(snapshot: AppSnapshot, user: AppUser) {
  const side = deliverySideForUser(user);
  return snapshot.deliveryTasks.filter((task) => isUserAssignedToDelivery(task.assignedTo, user) && (!side || task.side === side));
}

export function userRoleList(user: AppUser) {
  return user.roles && user.roles.length > 0 ? user.roles : [user.role];
}

export function userHasAnyRole(user: AppUser, roles: UserRole[]) {
  const userRoles = userRoleList(user);
  return roles.some((role) => userRoles.includes(role));
}

export function isDeliveryExecutive(user: AppUser) {
  return userHasAnyRole(user, ["In Delivery", "Out Delivery", "Delivery"]);
}

export function isInboundDeliveryUser(user: AppUser) {
  return userHasAnyRole(user, ["In Delivery"]);
}

export function isOutboundDeliveryUser(user: AppUser) {
  return userHasAnyRole(user, ["Out Delivery"]);
}

export function deliverySideForUser(user: AppUser): DeliveryTask["side"] | null {
  const roles = userRoleList(user);
  if (roles.includes("Delivery")) return null;
  if (roles.includes("In Delivery")) return "Purchase";
  if (roles.includes("Out Delivery")) return "Sales";
  return null;
}

export function isDeliveryTaskPending(task: DeliveryTask) {
  if (task.side === "Sales") return task.status !== "Delivered";
  return task.status !== "Handed Over" && task.status !== "Delivered";
}

export function buildOrderStatusSummary(snapshot: AppSnapshot, target: OrderQrTarget): OrderStatusSummary | null {
  if (target.side === "Purchase") {
    const group = groupPurchaseOrders(snapshot.purchaseOrders).find((item) => item.id === target.orderId);
    if (!group) return null;
    const first = group.lines[0];
    const task = purchaseDeliveryTask(snapshot, target.orderId);
    const warehouseStatus = purchaseWarehouseStatus(group.lines);
    const paymentStatus = purchasePaymentStatus(snapshot, target.orderId);
    const workflowStatus = purchaseWorkflowStatus(snapshot, target.orderId);
    const completed = group.lines.every((line) => line.status === "Received" || line.status === "Closed");
    const currentAction = completed
      ? "Completed"
      : first?.deliveryMode === "Self Collection"
        ? !task
          ? "Pickup tagging pending"
          : isDeliveryTaskPending(task)
            ? "Pickup receipt pending"
            : "Warehouse receiving pending"
        : warehouseStatus !== "Received"
          ? "Dealer receipt pending"
          : paymentStatus !== "Completed"
            ? "Accounts follow-up pending"
            : "Completed";
    return {
      target,
      title: `${target.orderId} Purchase Status`,
      partyName: first?.supplierName || "Supplier",
      createdAt: first?.createdAt || "",
      warehouseNames: Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))),
      productSummary: group.lines.map((line) => `${line.productSku} x ${line.quantityOrdered}`).join(", "),
      deliveryMode: first?.deliveryMode || "-",
      workflowStatus,
      deliveryStatus: purchaseDeliveryStatus(snapshot, target.orderId),
      paymentStatus,
      currentAction,
      completed,
      totalAmount: group.lines.reduce((sum, line) => sum + line.totalAmount, 0),
      note: displayOrderNote(first?.note)
    };
  }
  const group = groupSalesOrders(snapshot.salesOrders).find((item) => item.id === target.orderId);
  if (!group) return null;
  const first = group.lines[0];
  const task = salesDeliveryTask(snapshot, target.orderId);
  const docketIds = new Set(snapshot.deliveryDockets.filter((item) => group.lines.some((line) => line.id === item.salesOrderId)).map((item) => item.id));
  const openConsignment = snapshot.deliveryConsignments.find((item) => item.status !== "Delivered" && item.docketIds.some((docketId) => docketIds.has(docketId)));
  const fulfillmentStatus = salesFulfillmentStatus(group.lines);
  const paymentStatus = salesPaymentStatus(snapshot, target.orderId);
  const completed = group.lines.every((line) => line.status === "Delivered" || line.status === "Closed");
  const currentAction = completed
    ? "Completed"
    : first?.deliveryMode === "Self Collection"
      ? "Self collection handover pending"
      : !task && docketIds.size === 0
        ? "Warehouse docket pending"
        : !task && docketIds.size > 0 && !openConsignment
          ? "Consignment bundling pending"
        : !task && openConsignment
            ? "Delivery tagging pending"
            : task && isDeliveryTaskPending(task)
              ? "Delivery execution pending"
              : paymentStatus !== "Completed"
                ? "Collection pending"
                : "Completed";
  return {
    target,
    title: `${target.orderId} Sales Status`,
    partyName: first?.shopName || "Customer",
    createdAt: first?.createdAt || "",
    warehouseNames: Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))),
    productSummary: group.lines.map((line) => `${line.productSku} x ${line.quantity}`).join(", "),
    deliveryMode: first?.deliveryMode || "-",
    workflowStatus: fulfillmentStatus,
    deliveryStatus: salesDeliveryStatus(snapshot, target.orderId),
    paymentStatus,
    currentAction,
    completed,
    totalAmount: group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0),
    note: displayOrderNote(first?.note)
  };
}

export function orderStatusAccess(snapshot: AppSnapshot, user: AppUser, target: OrderQrTarget): OrderStatusAccess {
  const roles = userRoleList(user);
  const warehouseScope = userWarehouseScope(user);
  const scopedByWarehouse = isWarehouseScoped(user);
  const isAdminLike = roles.includes("Admin") || roles.includes("Accounts") || roles.includes("Data Analyst");

  if (target.side === "Purchase") {
    const group = groupPurchaseOrders(snapshot.purchaseOrders).find((item) => item.id === target.orderId);
    if (!group) return { authorized: false, reason: "Unauthorized access. This PO is outside your visible scope." };
    if (isAdminLike) return { authorized: true, reason: "" };
    if (roles.includes("Purchaser")) {
      const ownsOrder = group.lines.some((line) => line.purchaserId === user.id || line.purchaserName === user.fullName);
      return ownsOrder
        ? { authorized: true, reason: "" }
        : { authorized: false, reason: "Unauthorized access. This PO is not assigned to you." };
    }
    if (roles.includes("Warehouse Manager") || roles.includes("Delivery Manager")) {
      const inWarehouse = !scopedByWarehouse || group.lines.some((line) => warehouseScope.has(line.warehouseId));
      return inWarehouse
        ? { authorized: true, reason: "" }
        : { authorized: false, reason: "Unauthorized access. This PO belongs to another warehouse." };
    }
    if (isDeliveryExecutive(user)) {
      const assignedPurchaseOrders = new Set(
        deliveryTasksForUser(snapshot, user)
          .filter((task) => task.side === "Purchase")
          .flatMap((task) => task.linkedOrderIds)
      );
      return assignedPurchaseOrders.has(target.orderId)
        ? { authorized: true, reason: "" }
        : { authorized: false, reason: "Unauthorized access. This PO is not assigned to your delivery queue." };
    }
    return { authorized: false, reason: "Unauthorized access. Your role cannot open purchase order status." };
  }

  const group = groupSalesOrders(snapshot.salesOrders).find((item) => item.id === target.orderId);
  if (!group) return { authorized: false, reason: "Unauthorized access. This SO is outside your visible scope." };
  if (isAdminLike) return { authorized: true, reason: "" };
  if (roles.includes("Sales")) {
    const ownsOrder = group.lines.some((line) => line.salesmanId === user.id || line.salesmanName === user.fullName);
    return ownsOrder
      ? { authorized: true, reason: "" }
      : { authorized: false, reason: "Unauthorized access. This SO is not assigned to you." };
  }
  if (roles.includes("Collection Agent")) {
    return collectionVisibleToUser(snapshot, group, user)
      ? { authorized: true, reason: "" }
      : { authorized: false, reason: "Unauthorized access. This SO is not assigned for your collection work." };
  }
  if (roles.includes("Warehouse Manager") || roles.includes("Delivery Manager")) {
    const inWarehouse = !scopedByWarehouse || group.lines.some((line) => warehouseScope.has(line.warehouseId));
    return inWarehouse
      ? { authorized: true, reason: "" }
      : { authorized: false, reason: "Unauthorized access. This SO belongs to another warehouse." };
  }
  if (isDeliveryExecutive(user)) {
    const assignedSalesOrders = new Set(
      deliveryTasksForUser(snapshot, user)
        .filter((task) => task.side === "Sales")
        .flatMap((task) => task.linkedOrderIds)
    );
    return assignedSalesOrders.has(target.orderId)
      ? { authorized: true, reason: "" }
      : { authorized: false, reason: "Unauthorized access. This SO is not assigned to your delivery queue." };
  }
  return { authorized: false, reason: "Unauthorized access. Your role cannot open sales order status." };
}

export async function buildOrderStatusPdf(summary: OrderStatusSummary) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let y = 18;
  doc.setFillColor(15, 118, 110);
  doc.roundedRect(margin, y, width, 24, 4, 4, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(summary.title, margin + 4, y + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Current action: ${summary.currentAction}`, margin + 4, y + 17);
  y += 34;
  doc.setTextColor(15, 23, 42);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Order Snapshot", margin, y);
  y += 7;
  const rows = [
    ["Order", `${orderQrShortLabel(summary.target)} / ${summary.target.orderId}`],
    ["Party", summary.partyName],
    ["Created", formatShortDate(summary.createdAt)],
    ["Warehouse", summary.warehouseNames.join(", ") || "-"],
    ["Mode", summary.deliveryMode],
    ["Workflow", summary.workflowStatus],
    ["Delivery", summary.deliveryStatus],
    ["Payment", summary.paymentStatus],
    ["Current action", summary.currentAction],
    ["Total", formatCurrencyInr(summary.totalAmount)]
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  rows.forEach(([label, value]) => {
    doc.setTextColor(100, 116, 139);
    doc.text(label, margin, y);
    doc.setTextColor(15, 23, 42);
    doc.text(String(value), margin + 42, y);
    y += 7;
  });
  y += 2;
  doc.setFont("helvetica", "bold");
  doc.text("Products", margin, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  const productLines = doc.splitTextToSize(summary.productSummary || "-", width);
  doc.text(productLines, margin, y);
  y += productLines.length * 5 + 3;
  if (summary.note) {
    doc.setFont("helvetica", "bold");
    doc.text("Note", margin, y);
    y += 6;
    doc.setFont("helvetica", "normal");
    const noteLines = doc.splitTextToSize(summary.note, width);
    doc.text(noteLines, margin, y);
  }
  return doc.output("blob");
}

export function OrderQrCard({
  target,
  title,
  onOpenStatus
}: {
  target: OrderQrTarget;
  title: string;
  onOpenStatus: (target: OrderQrTarget) => void;
}) {
  const [dataUrl, setDataUrl] = useState("");
  const link = buildOrderStatusUrl(target);

  useEffect(() => {
    let active = true;
    void import("qrcode")
      .then(({ default: QRCode }) => QRCode.toDataURL(link, { width: 168, margin: 1 }))
      .then((value: string) => {
        if (active) setDataUrl(value);
      })
      .catch(() => {
        if (active) setDataUrl("");
      });
    return () => {
      active = false;
    };
  }, [link]);

  return <article className="list-card top-gap order-qr-card">
    <div className="payment-update-head order-qr-head">
      <div className="order-qr-title">
        <strong>{title}</strong>
        <p>{target.orderId}</p>
      </div>
      <span className="status-pill status-pending">{orderQrShortLabel(target)}</span>
    </div>
    <div className="order-qr-body top-gap">
      <div className="order-qr-image-wrap">
        {dataUrl ? <img className="order-qr-image" src={dataUrl} alt={`${target.orderId} status QR`} /> : <span className="small-label">QR loading...</span>}
      </div>
      <div className="order-qr-link">
        <span className="small-label">Deep link</span>
        <strong>{link}</strong>
      </div>
      <div className="payment-card-actions order-qr-actions">
      <button className="ghost-button" type="button" onClick={() => void copyTextToClipboard(link)}>{`Copy ${orderQrShortLabel(target)} link`}</button>
      <button className="ghost-button" type="button" disabled={!dataUrl} onClick={() => dataUrl ? downloadDataUrlFile(safePdfFileName(`${target.orderId}-qr.png`), dataUrl) : undefined}>Download QR</button>
      <button className="primary-button" type="button" onClick={() => onOpenStatus(target)}>Open status</button>
      </div>
    </div>
  </article>;
}

export function OrderStatusOverlay({
  snapshot,
  currentUser,
  target,
  onClose,
  onOpenAction
}: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  target: OrderQrTarget;
  onClose: () => void;
  onOpenAction: (target: OrderQrTarget) => void;
}) {
  const access = orderStatusAccess(snapshot, currentUser, target);
  const summary = buildOrderStatusSummary(snapshot, target);
  return <div className="cart-overlay" onClick={onClose}>
    <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="cart-head">
        <div>
          <h3>{summary?.title || `${target.orderId} status`}</h3>
          <p>{!access.authorized ? access.reason : summary ? (summary.completed ? "Completed status page." : "Current pending action page.") : "Order is not visible in this login scope."}</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>Close</button>
      </div>
      {!access.authorized ? <div className="empty-card">{access.reason}</div> : !summary ? <div className="empty-card">This order is not available in your current role or warehouse scope.</div> : <>
        <article className="list-card">
          <div className="payment-update-head">
            <div>
              <strong>{summary.target.orderId}</strong>
              <p>{summary.partyName}</p>
            </div>
            <span className={`status-pill ${summary.completed ? "status-verified" : "status-pending"}`}>{summary.completed ? "Completed" : "Pending"}</span>
          </div>
          <div className="payment-meta-grid top-gap">
            <div><span className="small-label">Workflow</span><strong>{summary.workflowStatus}</strong></div>
            <div><span className="small-label">Delivery</span><strong>{summary.deliveryStatus}</strong></div>
            <div><span className="small-label">Payment</span><strong>{summary.paymentStatus}</strong></div>
            <div><span className="small-label">Current action</span><strong>{summary.currentAction}</strong></div>
            <div><span className="small-label">Warehouse</span><strong>{summary.warehouseNames.join(", ") || "-"}</strong></div>
            <div><span className="small-label">Mode</span><strong>{summary.deliveryMode}</strong></div>
            <div><span className="small-label">Created</span><strong>{formatShortDate(summary.createdAt)}</strong></div>
            <div><span className="small-label">Total</span><strong>{formatCurrencyInr(summary.totalAmount)}</strong></div>
            <div className="wide-field"><span className="small-label">Products</span><strong>{summary.productSummary}</strong></div>
            {summary.note ? <div className="wide-field"><span className="small-label">Note</span><strong>{summary.note}</strong></div> : null}
          </div>
        </article>
        <div className="payment-card-actions top-gap">
          <button className="primary-button" type="button" onClick={() => onOpenAction(target)}>{summary.completed ? "Open completed page" : "Open current action"}</button>
          <button className="ghost-button" type="button" onClick={() => void buildOrderStatusPdf(summary).then((blob) => downloadBlobFile(safePdfFileName(`${target.orderId}-status.pdf`), blob))}>Download status PDF</button>
        </div>
      </>}
    </div>
  </div>;
}

export function QrScanOverlay({
  onClose,
  onScan
}: {
  onClose: () => void;
  onScan: (target: OrderQrTarget) => void;
}) {
  const [manualValue, setManualValue] = useState("");
  const [error, setError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [scannerMode, setScannerMode] = useState<"camera" | "manual">("camera");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectingRef = useRef(false);
  const barcodeDetectorAvailable = typeof window !== "undefined" && "BarcodeDetector" in window;
  const cameraAvailable = typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraStarting(false);
  }

  async function openFromValue(value: string) {
    const parsed = parseOrderQrValue(value);
    if (!parsed) {
      setError("QR not recognized. Paste the Aapoorti link or scan a valid PO/SO QR.");
      return;
    }
    setError("");
    onScan(parsed);
  }

  useEffect(() => {
    if (scannerMode !== "camera" || !barcodeDetectorAvailable || !cameraAvailable) return;
    let active = true;
    async function startCamera() {
      setCameraStarting(true);
      setError("");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false
        });
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch {
        setError("Camera access failed. Allow camera permission or use manual input below.");
        setScannerMode("manual");
      } finally {
        if (active) setCameraStarting(false);
      }
    }
    void startCamera();
    return () => {
      active = false;
      stopCamera();
    };
  }, [scannerMode, barcodeDetectorAvailable, cameraAvailable]);

  useEffect(() => {
    if (scannerMode !== "camera" || !cameraReady || !barcodeDetectorAvailable || !videoRef.current) return;
    const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!Detector) return;
    const detector = new Detector({ formats: ["qr_code"] });
    const interval = window.setInterval(() => {
      if (!videoRef.current || detectingRef.current || videoRef.current.readyState < 2) return;
      detectingRef.current = true;
      void detector.detect(videoRef.current).then((matches) => {
        const value = matches[0]?.rawValue || "";
        if (value) {
          stopCamera();
          void openFromValue(value);
        }
      }).catch(() => undefined).finally(() => {
        detectingRef.current = false;
      });
    }, 500);
    return () => window.clearInterval(interval);
  }, [scannerMode, cameraReady, barcodeDetectorAvailable]);

  useEffect(() => () => {
    stopCamera();
  }, []);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!barcodeDetectorAvailable) {
      setError("Camera QR decode is not available on this browser. Open the QR link directly or paste it below.");
      return;
    }
    try {
      const Detector = (window as Window & { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (!Detector) return;
      const bitmap = await createImageBitmap(file);
      const detector = new Detector({ formats: ["qr_code"] });
      const matches = await detector.detect(bitmap);
      const value = matches[0]?.rawValue || "";
      await openFromValue(value);
    } catch {
      setError("Unable to read QR from image. Try a clearer scan or paste the link manually.");
    } finally {
      event.target.value = "";
    }
  }

  return <div className="cart-overlay" onClick={onClose}>
    <div className="cart-sheet qr-scan-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="cart-head">
        <div>
          <h3>Scan order QR</h3>
          <p>Open PO or SO status and jump to the current action page.</p>
        </div>
        <button type="button" className="ghost-button" onClick={onClose}>Close</button>
      </div>
      {barcodeDetectorAvailable && cameraAvailable ? <div className="summary-switch-bar">
        <button className={scannerMode === "camera" ? "tab-button active" : "tab-button"} type="button" onClick={() => setScannerMode("camera")}>Live camera</button>
        <button className={scannerMode === "manual" ? "tab-button active" : "tab-button"} type="button" onClick={() => { stopCamera(); setScannerMode("manual"); }}>Manual</button>
      </div> : null}
      <div className="form-grid">
        {scannerMode === "camera" && barcodeDetectorAvailable && cameraAvailable ? <div className="wide-field qr-camera-panel">
          <div className="qr-camera-frame">
            <video ref={videoRef} className="qr-camera-video" playsInline muted />
            {!cameraReady ? <div className="qr-camera-overlay">{cameraStarting ? "Starting camera..." : "Waiting for camera..."}</div> : null}
          </div>
          <p className="small-label">Point the QR inside the frame. It will open automatically after detection.</p>
        </div> : null}
        <label className="wide-field">Paste QR link or code
          <input value={manualValue} onChange={(e) => setManualValue(e.target.value)} placeholder="https://... or AAPOORTI|Sales|SO-123" />
        </label>
        <div className="payment-card-actions wide-field">
          <button className="primary-button" type="button" onClick={() => void openFromValue(manualValue)}>Open status</button>
        </div>
        <label className="wide-field">Scan from image
          <input type="file" accept="image/*" capture="environment" onChange={handleFile} />
        </label>
        {!barcodeDetectorAvailable || !cameraAvailable ? <p className="message success wide-field">Live in-app camera scanning is unavailable on this browser. Use image scan, paste the link, or open the QR in your phone camera.</p> : null}
        {error ? <p className="message error wide-field">{error}</p> : null}
      </div>
    </div>
  </div>;
}

export function homeTaskCards(snapshot: AppSnapshot, user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  const today = new Date().toISOString().slice(0, 10);
  if (roles.includes("Admin")) {
    return [
      { label: "Purchase open", value: countGroupedOrders(snapshot.purchaseOrders.filter((item) => item.status !== "Received" && item.status !== "Closed")) },
      { label: "Sales open", value: countGroupedOrders(snapshot.salesOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed")) },
      { label: "Payment flags", value: snapshot.payments.filter((item) => item.verificationStatus === "Rejected" || item.verificationStatus === "Disputed").length },
      { label: "Live delivery", value: snapshot.deliveryTasks.filter(isDeliveryTaskPending).length }
    ];
  }
  if (roles.includes("In Delivery") || roles.includes("Out Delivery") || roles.includes("Delivery")) {
    const myTasks = deliveryTasksForUser(snapshot, user);
    return [
      { label: "Current delivery", value: myTasks.filter((item) => item.status !== "Planned" && isDeliveryTaskPending(item)).length },
      { label: "New assignments", value: myTasks.filter((item) => item.status === "Planned").length },
      { label: "Completed today", value: myTasks.filter((item) => (item.status === "Handed Over" || item.status === "Delivered") && item.lastActionAt?.slice(0, 10) === today).length },
      { label: "Cash actions", value: myTasks.filter((item) => item.cashCollectionRequired).length }
    ];
  }
  if (roles.includes("Delivery Manager")) {
    const warehouseScope = userWarehouseScope(user);
    const scopedTasks = snapshot.deliveryTasks.filter((task) => warehouseScope.size === 0 || task.routeStops.some((stop) => warehouseScope.has(stop.warehouseId)));
    return [
      { label: "Inbound pickup tags", value: scopedTasks.filter((task) => task.side === "Purchase" && task.status === "Planned").length },
      { label: "Ready dockets", value: snapshot.deliveryDockets.filter((item) => item.status === "Ready" && !item.consignmentId && (warehouseScope.size === 0 || warehouseScope.has(item.warehouseId))).length },
      { label: "Ready consignments", value: snapshot.deliveryConsignments.filter((item) => item.status === "Ready" && (warehouseScope.size === 0 || warehouseScope.has(item.warehouseId))).length },
      { label: "Live delivery", value: scopedTasks.filter(isDeliveryTaskPending).length }
    ];
  }
  if (roles.includes("Warehouse Manager")) {
    const warehouseScope = userWarehouseScope(user);
    const scopedPurchaseOrders = snapshot.purchaseOrders.filter((item) => warehouseScope.size === 0 || warehouseScope.has(item.warehouseId));
    const scopedSalesOrders = snapshot.salesOrders.filter((item) => warehouseScope.size === 0 || warehouseScope.has(item.warehouseId));
    const scopedTasks = snapshot.deliveryTasks.filter((task) => task.routeStops.some((stop) => warehouseScope.size === 0 || warehouseScope.has(stop.warehouseId)));
    return [
      { label: "Dealer receipts", value: countGroupedOrders(scopedPurchaseOrders.filter((item) => item.deliveryMode === "Dealer Delivery" && item.status !== "Received" && item.status !== "Closed")) },
      { label: "Self handovers", value: countGroupedOrders(scopedSalesOrders.filter((item) => item.deliveryMode === "Self Collection" && ["Booked", "Ready for Dispatch", "Pending Pickup", "Out for Delivery", "Self Pickup"].includes(item.status))) },
      { label: "Pickup tags", value: scopedTasks.filter((task) => task.side === "Purchase" && task.status === "Planned").length },
      { label: "Dispatch flow", value: countGroupedOrders(scopedSalesOrders.filter((item) => item.deliveryMode === "Delivery" && ["Booked", "Ready for Dispatch", "Pending Pickup", "Out for Delivery"].includes(item.status))) }
    ];
  }
  if (roles.includes("Accounts")) {
    const pending = snapshot.payments.filter((item) => item.verificationStatus !== "Verified" && item.verificationStatus !== "Resolved");
    const orderQueue = [
      ...groupPurchaseOrders(snapshot.purchaseOrders).map((group) => purchaseLedgerByOrder(snapshot, group.id)?.pendingAmount ?? purchaseOrderPublicTotal(snapshot.purchaseOrders, group.id)),
      ...Array.from(new Set(snapshot.salesOrders.map((order) => orderPublicId(order)))).map((id) => snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, id))
    ].filter((amount) => amount > 0);
    return [
      { label: "Awaiting action", value: orderQueue.length },
      { label: "Pending proofs", value: pending.length },
      { label: "Disputes", value: snapshot.payments.filter((item) => item.verificationStatus === "Disputed" || item.verificationStatus === "Rejected").length },
      { label: "Cash today", value: snapshot.payments.filter((item) => item.mode === "Cash" && item.createdAt.slice(0, 10) === today).reduce((sum, item) => sum + item.amount, 0) }
    ];
  }
  if (roles.includes("Data Analyst")) {
    return [
      { label: "Purchase carts", value: countGroupedOrders(snapshot.purchaseOrders) },
      { label: "Sales carts", value: countGroupedOrders(snapshot.salesOrders) },
      { label: "Available stock", value: snapshot.stockSummary.reduce((sum, item) => sum + item.availableQuantity, 0) },
      { label: "Inventory lots", value: snapshot.inventoryLots.length }
    ];
  }
  if (roles.includes("Sales")) {
    const myOrders = snapshot.salesOrders.filter((item) => item.salesmanId === user.id || item.salesmanName === user.fullName);
    const myIds = new Set(myOrders.map((item) => orderPublicId(item)));
    return [
      { label: "Open sales", value: countGroupedOrders(myOrders.filter((item) => item.status !== "Delivered" && item.status !== "Closed")) },
      { label: "Draft sales", value: countGroupedOrders(myOrders.filter((item) => item.status === "Draft")) },
      { label: "Collection pending", value: Array.from(myIds).filter((id) => (snapshot.ledgerEntries.find((item) => item.side === "Sales" && item.linkedOrderId === id)?.pendingAmount ?? salesOrderPublicTotal(snapshot.salesOrders, id)) > 0).length },
      { label: "Ready to dispatch", value: countGroupedOrders(myOrders.filter((item) => item.status === "Ready for Dispatch")) }
    ];
  }
  if (roles.includes("Purchaser")) {
    const myOrders = snapshot.purchaseOrders.filter((item) => item.purchaserId === user.id || item.purchaserName === user.fullName);
    const myGroups = groupPurchaseOrders(myOrders);
    return [
      { label: "Open purchases", value: myGroups.filter((group) => purchaseWarehouseStatus(group.lines) !== "Received").length },
      { label: "Payment pending", value: myGroups.filter((group) => ["Pending", "Partial", "Cash With Delivery"].includes(purchasePaymentStatus(snapshot, group.id))).length },
      { label: "Disputes", value: myGroups.filter((group) => ["Flagged", "Disputed"].includes(purchasePaymentStatus(snapshot, group.id))).length },
      { label: "Warehouse pending", value: myGroups.filter((group) => purchaseWarehouseStatus(group.lines) !== "Received" && group.lines.some((line) => line.quantityReceived === 0)).length }
    ];
  }
  return [];
}

export function userWarehouseScope(user: AppUser) {
  return new Set((user.warehouseIds || []).filter(Boolean));
}

export function isWarehouseScoped(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return userWarehouseScope(user).size > 0 && (roles.includes("Warehouse Manager") || roles.includes("Delivery Manager") || roles.includes("In Delivery") || roles.includes("Out Delivery") || roles.includes("Delivery"));
}

export function snapshotForWarehouse(snapshot: AppSnapshot, warehouseId: string): AppSnapshot {
  if (!warehouseId) return snapshot;
  const purchaseOrderIds = new Set(snapshot.purchaseOrders.filter((item) => item.warehouseId === warehouseId).map((item) => orderPublicId(item)));
  const salesOrderIds = new Set(snapshot.salesOrders.filter((item) => item.warehouseId === warehouseId).map((item) => orderPublicId(item)));
  const consignmentIds = new Set(snapshot.deliveryConsignments.filter((item) => item.warehouseId === warehouseId).map((item) => item.id));
  const receiptIds = new Set(snapshot.receiptChecks.filter((item) => item.warehouseId === warehouseId).map((item) => item.grcNumber));
  const deliveryTaskIds = new Set(snapshot.deliveryTasks.filter((task) =>
    task.routeStops.some((stop) => stop.warehouseId === warehouseId) ||
    (task.consignmentId ? consignmentIds.has(task.consignmentId) : false) ||
    task.linkedOrderIds.some((id) => purchaseOrderIds.has(id) || salesOrderIds.has(id))
  ).map((task) => task.id));

  return {
    ...snapshot,
    purchaseOrders: snapshot.purchaseOrders.filter((item) => item.warehouseId === warehouseId),
    salesOrders: snapshot.salesOrders.filter((item) => item.warehouseId === warehouseId),
    receiptChecks: snapshot.receiptChecks.filter((item) => item.warehouseId === warehouseId),
    inventoryLots: snapshot.inventoryLots.filter((item) => item.warehouseId === warehouseId),
    stockSummary: snapshot.stockSummary.filter((item) => item.warehouseId === warehouseId),
    deliveryDockets: snapshot.deliveryDockets.filter((item) => item.warehouseId === warehouseId),
    deliveryConsignments: snapshot.deliveryConsignments.filter((item) => item.warehouseId === warehouseId),
    deliveryTasks: snapshot.deliveryTasks.filter((item) => deliveryTaskIds.has(item.id)),
    ledgerEntries: snapshot.ledgerEntries.filter((item) => purchaseOrderIds.has(item.linkedOrderId) || salesOrderIds.has(item.linkedOrderId)),
    payments: snapshot.payments.filter((item) => purchaseOrderIds.has(item.linkedOrderId) || salesOrderIds.has(item.linkedOrderId)),
    notes: snapshot.notes.filter((item) => purchaseOrderIds.has(item.entityId) || salesOrderIds.has(item.entityId) || deliveryTaskIds.has(item.entityId) || receiptIds.has(item.entityId))
  };
}

export function snapshotForWarehouseScope(snapshot: AppSnapshot, warehouseIds: string[]): AppSnapshot {
  const allowedWarehouseIds = new Set(warehouseIds.filter(Boolean));
  if (allowedWarehouseIds.size === 0) return snapshot;
  const purchaseOrderIds = new Set(snapshot.purchaseOrders.filter((item) => allowedWarehouseIds.has(item.warehouseId)).map((item) => orderPublicId(item)));
  const salesOrderIds = new Set(snapshot.salesOrders.filter((item) => allowedWarehouseIds.has(item.warehouseId)).map((item) => orderPublicId(item)));
  const consignmentIds = new Set(snapshot.deliveryConsignments.filter((item) => allowedWarehouseIds.has(item.warehouseId)).map((item) => item.id));
  const receiptIds = new Set(snapshot.receiptChecks.filter((item) => allowedWarehouseIds.has(item.warehouseId)).map((item) => item.grcNumber));
  const deliveryTaskIds = new Set(snapshot.deliveryTasks.filter((task) =>
    task.routeStops.some((stop) => allowedWarehouseIds.has(stop.warehouseId)) ||
    (task.consignmentId ? consignmentIds.has(task.consignmentId) : false) ||
    task.linkedOrderIds.some((id) => purchaseOrderIds.has(id) || salesOrderIds.has(id))
  ).map((task) => task.id));

  return {
    ...snapshot,
    warehouses: snapshot.warehouses.filter((item) => allowedWarehouseIds.has(item.id)),
    purchaseOrders: snapshot.purchaseOrders.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    salesOrders: snapshot.salesOrders.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    receiptChecks: snapshot.receiptChecks.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    inventoryLots: snapshot.inventoryLots.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    stockSummary: snapshot.stockSummary.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    deliveryDockets: snapshot.deliveryDockets.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    deliveryConsignments: snapshot.deliveryConsignments.filter((item) => allowedWarehouseIds.has(item.warehouseId)),
    deliveryTasks: snapshot.deliveryTasks.filter((item) => deliveryTaskIds.has(item.id)),
    ledgerEntries: snapshot.ledgerEntries.filter((item) => purchaseOrderIds.has(item.linkedOrderId) || salesOrderIds.has(item.linkedOrderId)),
    payments: snapshot.payments.filter((item) => purchaseOrderIds.has(item.linkedOrderId) || salesOrderIds.has(item.linkedOrderId)),
    notes: snapshot.notes.filter((item) => purchaseOrderIds.has(item.entityId) || salesOrderIds.has(item.entityId) || deliveryTaskIds.has(item.entityId) || receiptIds.has(item.entityId))
  };
}

export function mapsDirectionsUrl(stops: string[]) {
  const cleaned = stops.map((item) => item.trim()).filter(Boolean);
  if (cleaned.length === 0) return "";
  if (cleaned.length === 1) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(cleaned[0])}`;
  const [origin, ...rest] = cleaned;
  const destination = rest[rest.length - 1];
  const waypoints = rest.slice(0, -1);
  const params = new URLSearchParams({
    api: "1",
    origin,
    destination
  });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function distanceKmBetween(left?: { latitude?: number; longitude?: number }, right?: { latitude?: number; longitude?: number }) {
  if (left?.latitude === undefined || left.longitude === undefined || right?.latitude === undefined || right.longitude === undefined) return null;
  const toRad = (value: number) => value * Math.PI / 180;
  const earthKm = 6371;
  const dLat = toRad(right.latitude - left.latitude);
  const dLng = toRad(right.longitude - left.longitude);
  const lat1 = toRad(left.latitude);
  const lat2 = toRad(right.latitude);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestNeighborOrder<T>(items: T[], locationFor: (item: T) => { latitude?: number; longitude?: number } | undefined) {
  if (items.length < 2) return items;
  if (items.some((item) => {
    const location = locationFor(item);
    return location?.latitude === undefined || location.longitude === undefined;
  })) return items;
  const remaining = [...items];
  const ordered: T[] = [];
  let current = remaining.shift();
  if (!current) return items;
  ordered.push(current);
  while (remaining.length > 0) {
    const currentLocation = locationFor(current);
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((candidate, index) => {
      const distance = distanceKmBetween(currentLocation, locationFor(candidate)) ?? Number.POSITIVE_INFINITY;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    current = remaining.splice(bestIndex, 1)[0];
    ordered.push(current);
  }
  return ordered;
}

export function calculateTaxPreview(amountText: string, gstRateText: string, taxMode: TaxModeInput) {
  const amount = Math.max(0, Number(amountText || 0));
  if (amount <= 0) return { taxableAmount: "0.00", gstAmount: "0.00", totalAmount: "0.00" };
  const gstRate = (gstRateText === "NA" ? "NA" : Number(gstRateText || 0)) as GstRate;
  const amounts = calculateTaxAmounts(1, amount, gstRate, taxMode as TaxMode);
  return {
    taxableAmount: amounts.taxableAmount.toFixed(2),
    gstAmount: amounts.gstAmount.toFixed(2),
    totalAmount: amounts.totalAmount.toFixed(2)
  };
}

export function purchaseCartEditState(snapshot: AppSnapshot, orderId: string, currentUser: AppUser) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return { editable: false, reason: "Purchase cart not found." };
  const isAdmin = userRoleList(currentUser).includes("Admin");
  const ownsCart = lines.some((line) => line.purchaserId === currentUser.id || line.purchaserName === currentUser.fullName);
  if (!isAdmin && !ownsCart) return { editable: false, reason: "Only the purchaser or admin can edit this purchase cart." };
  if (!isAdmin && lines.some((line) => line.status === "Cancelled" || line.status === "Closed" || line.status === "Received")) {
    return { editable: false, reason: "Purchase order is closed. Only admin can edit this purchase cart now." };
  }
  if (!isAdmin && lines.some((line) => line.quantityReceived > 0)) {
    return { editable: false, reason: "Receiving has started. Only admin can edit this purchase cart now." };
  }
  const ledger = purchaseLedgerByOrder(snapshot, orderId);
  if (!isAdmin && (ledger?.paidAmount || 0) > 0) {
    return { editable: false, reason: "Payment is already recorded. Only admin can edit this purchase cart now." };
  }
  const assignedDelivery = purchaseDeliveryTask(snapshot, orderId);
  if (!isAdmin && assignedDelivery) {
    return { editable: false, reason: "Delivery is assigned. Only admin can edit this purchase cart now." };
  }
  return { editable: true, reason: "" };
}

export function purchaseCartDraftSignature(draft: {
  paymentMode: PaymentMode;
  cashTiming: string;
  deliveryMode: "Dealer Delivery" | "Self Collection";
  note: string;
  status: PurchaseOrder["status"];
  lines: Array<{
    id?: string;
    clientKey: string;
    productSku: string;
    warehouseId: string;
    quantityOrdered: string;
    rate: string;
    gstRate: GstRateInput;
    gstAmount: string;
    taxableAmount: string;
    taxMode: TaxModeInput;
  }>;
}) {
  return JSON.stringify({
    paymentMode: draft.paymentMode,
    cashTiming: draft.cashTiming,
    deliveryMode: draft.deliveryMode,
    note: draft.note,
    status: draft.status,
    lines: draft.lines.map((line) => ({
      id: line.id || "",
      productSku: line.productSku,
      warehouseId: line.warehouseId,
      quantityOrdered: line.quantityOrdered,
      rate: line.rate,
      gstRate: line.gstRate,
      gstAmount: line.gstAmount,
      taxableAmount: line.taxableAmount,
      taxMode: line.taxMode
    }))
  });
}

export function salesOrderDraftSignature(draft: {
  paymentMode: PaymentMode;
  cashTiming: string;
  deliveryMode: "Self Collection" | "Delivery";
  note: string;
  status: SalesStatus;
  lines: Array<{
    id?: string;
    clientKey: string;
    productSku: string;
    warehouseId: string;
    rate: string;
    cdTodRate: string;
    cdAmount: string;
    todAmount: string;
    quantity: string;
    totalAmount: number;
    gstRate: GstRateInput;
    gstAmount: string;
    taxableAmount: string;
    taxMode: TaxModeInput;
  }>;
}) {
  return JSON.stringify({
    paymentMode: draft.paymentMode,
    cashTiming: draft.cashTiming,
    deliveryMode: draft.deliveryMode,
    note: draft.note,
    status: draft.status,
    lines: draft.lines.map((line) => ({
      id: line.id || "",
      productSku: line.productSku,
      warehouseId: line.warehouseId,
      rate: line.rate,
      cdTodRate: line.cdTodRate,
      cdAmount: line.cdAmount,
      todAmount: line.todAmount,
      quantity: line.quantity,
      totalAmount: line.totalAmount,
      gstRate: line.gstRate,
      gstAmount: line.gstAmount,
      taxableAmount: line.taxableAmount,
      taxMode: line.taxMode
    }))
  });
}

export function salesOrderEditState(snapshot: AppSnapshot, orderId: string, currentUser: AppUser) {
  const lines = snapshot.salesOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return { editable: false, reason: "Sales order not found." };
  const isAdmin = userRoleList(currentUser).includes("Admin");
  const ownsOrder = lines.some((line) => line.salesmanId === currentUser.id || line.salesmanName === currentUser.fullName);
  if (!isAdmin && !ownsOrder) return { editable: false, reason: "Only the salesman or admin can edit this sales order." };
  if (!isAdmin && lines.some((line) => line.status === "Delivered" || line.status === "Closed")) {
    return { editable: false, reason: "Sales order is closed. Only admin can edit it now." };
  }
  const assignedDelivery = salesDeliveryTask(snapshot, orderId);
  if (!isAdmin && assignedDelivery) {
    return { editable: false, reason: "Delivery is assigned. Only admin can edit this sales order now." };
  }
  return { editable: true, reason: "" };
}
