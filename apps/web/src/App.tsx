import axios from "axios";
import { jsPDF } from "jspdf";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { SidebarVectorIcon } from "./components/navigation";
import { CollapsiblePanel, DataTable, LabelWithBadge, MetricCard, Panel, PendingBadge, TwoCol } from "./components/ui";
import appLogo from "./assets/group60.svg";
import { downloadExcelTextWorkbook, downloadExcelWorkbook } from "./utils/excel";
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
import { userRoles } from "@aapoorti-b2b/domain";

const configuredApiBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const browserOriginFallback = typeof window !== "undefined" && window.location.hostname === "localhost"
  ? "http://localhost:8080"
  : typeof window !== "undefined"
    ? window.location.origin
    : "http://localhost:8080";
const API_BASE = configuredApiBase || browserOriginFallback;
const SESSION_KEY = "aapoorti-b2b-user";
const TOKEN_KEY = "aapoorti-b2b-token";
const ACTIVE_VIEW_KEY = "aapoorti-b2b-active-view";
const DELIVERY_MANAGER_WAREHOUSE_KEY = "aapoorti-b2b-dm-warehouse";
const WORKSPACE_DRAFT_KEY = "aapoorti-b2b-workspace";
const SIDEBAR_COLLAPSED_KEY = "aapoorti-b2b-sidebar-collapsed";
const COMPANY_GST_NUMBER = "23AAECA1547R1ZH";
const api = axios.create({
  baseURL: API_BASE
});

type GstRateInput = "NA" | "0" | "5" | "12" | "18" | "40";
type TaxModeInput = "NA" | "Exclusive" | "Inclusive";

function workspaceStorageKey(userId: number | string, scope: string) {
  return `${WORKSPACE_DRAFT_KEY}:${userId}:${scope}`;
}

function readStoredJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

type ViewKey =
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

const roleViews: Record<UserRole, ViewKey[]> = {
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

const simpleRoleViews: Record<UserRole, ViewKey[]> = {
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

const labels: Record<ViewKey, string> = {
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

const returnReasons: Array<PurchaseReturn["reason"]> = ["Rate Difference", "Damage", "Quality Issue", "Wrong Item", "Excess Quantity", "Other"];
const goodsWarrantOutlets: GoodsWarrantOutlet[] = ["Awadhpuri", "Koh E Fiza", "New Market", "Kolar", "Indrapuri"];

type OrderQrTarget = {
  side: "Purchase" | "Sales";
  orderId: string;
};

type OrderStatusSummary = {
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

type OrderStatusAccess = {
  authorized: boolean;
  reason: string;
};

function orderQrShortLabel(target: OrderQrTarget) {
  return target.side === "Purchase" ? "PO" : "SO";
}

function buildOrderQrToken(target: OrderQrTarget) {
  return `AAPOORTI|${target.side}|${target.orderId}`;
}

function buildOrderStatusUrl(target: OrderQrTarget) {
  if (typeof window === "undefined") return buildOrderQrToken(target);
  const url = new URL(window.location.href);
  url.searchParams.set("qrSide", target.side);
  url.searchParams.set("qrOrder", target.orderId);
  return url.toString();
}

function parseOrderQrValue(value: string) {
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

function readOrderQrTargetFromLocation() {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const side = url.searchParams.get("qrSide");
  const orderId = url.searchParams.get("qrOrder");
  if ((side === "Purchase" || side === "Sales") && orderId) {
    return { side, orderId } satisfies OrderQrTarget;
  }
  return null;
}

function clearOrderQrTargetFromLocation() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("qrSide");
  url.searchParams.delete("qrOrder");
  window.history.replaceState({}, "", url.toString());
}

async function copyTextToClipboard(value: string) {
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

function downloadDataUrlFile(fileName: string, dataUrl: string) {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function displayLabel(view: ViewKey, user?: AppUser | null) {
  if (!user) return labels[view];
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  if (roles.includes("Warehouse Manager")) {
    if (view === "Stock") return "Dispatches";
  }
  if (roles.includes("Purchaser") && view === "Purchase") return "PO";
  if (roles.includes("Sales") && view === "Sales") return "SO";
  return labels[view];
}

function getVisibleViews(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return Array.from(new Set(roles.flatMap((role) => roleViews[role] || [])));
}

function shouldForceSimpleMode(user: AppUser | null) {
  if (!user) return false;
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  if (roles.includes("Admin") || roles.includes("Accounts") || roles.includes("Data Analyst")) return false;
  return roles.some((role) => role === "Purchaser" || role === "Sales" || role === "Delivery Manager" || role === "In Delivery" || role === "Out Delivery" || role === "Delivery");
}

function preferredSimpleMode(user: AppUser) {
  if (shouldForceSimpleMode(user)) return true;
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return !roles.some((role) => role === "Admin" || role === "Accounts" || role === "Data Analyst");
}

function getVisibleViewsForMode(user: AppUser, simpleMode: boolean) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  const source = simpleMode || shouldForceSimpleMode(user) ? simpleRoleViews : roleViews;
  return Array.from(new Set(roles.flatMap((role) => source[role] || [])));
}

function clearSessionState(setCurrentUser: React.Dispatch<React.SetStateAction<AppUser | null>>, setSessionToken: React.Dispatch<React.SetStateAction<string>>, setSnapshot: React.Dispatch<React.SetStateAction<AppSnapshot | null>>) {
  window.localStorage.removeItem(SESSION_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(ACTIVE_VIEW_KEY);
  window.localStorage.removeItem(DELIVERY_MANAGER_WAREHOUSE_KEY);
  setCurrentUser(null);
  setSessionToken("");
  setSnapshot(null);
}

function groupPurchaseRows(orders: PurchaseOrder[], snapshot?: AppSnapshot) {
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

function groupSalesRows(orders: SalesOrder[], snapshot?: AppSnapshot) {
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

function toCsvValue(value: string | number) {
  const text = String(value ?? "");
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

function downloadCsvFile(fileName: string, headers: string[], rows: Array<Array<string | number>>) {
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

function safeDateToken(value: string) {
  return value.replace(/[^\d-]/g, "") || indiaDateKey();
}

function dateRangeFileToken(fromDate: string, toDate: string) {
  const normalized = normalizeDateRange(fromDate, toDate);
  return normalized.fromDate === normalized.toDate
    ? safeDateToken(normalized.fromDate)
    : `${safeDateToken(normalized.fromDate)}-to-${safeDateToken(normalized.toDate)}`;
}

function gstBillTypeLabel(gstRate: GstRate) {
  return gstRate === "NA" || Number(gstRate) === 0 ? "Non GST" : "GST";
}

function gstRateExportValue(gstRate: GstRate) {
  return gstRate === "NA" ? 0 : Number(gstRate || 0);
}

function buildTablePdfBlob(title: string, subtitleLines: string[], headers: string[], rows: Array<Array<string | number>>) {
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

function formatCurrencyInr(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number.isFinite(value) ? value : 0);
}

function formatShortNumber(value: number) {
  return new Intl.NumberFormat("en-IN", {
    notation: "compact",
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(Number.isFinite(value) ? value : 0);
}

function formatShortDate(value?: string) {
  if (!value) return "Pending";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Pending";
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

function formatDateTimeIst(value?: string) {
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

function formatDateIst(value?: string) {
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

function formatLongDateIst(value?: string) {
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

function sortCounterpartiesAlphabetically(items: Counterparty[]) {
  return [...items].sort((left, right) => left.name.localeCompare(right.name, "en-IN", { sensitivity: "base" }));
}

function addOneMonthForVoucherPreview(dateKey: string) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const nextMonthLastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + 1, Math.min(day, nextMonthLastDay))).toISOString().slice(0, 10);
}

function subtractOneDayFromNextMonth(dateKey: string) {
  const nextCycleDate = addOneMonthForVoucherPreview(dateKey);
  const date = new Date(`${nextCycleDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return dateKey;
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number.isFinite(value) ? value : 0);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function printInvoiceDocument(title: string, bodyHtml: string) {
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

function isNonGstInvoice(lines: Array<{ gstRate: GstRate; gstAmount: number; taxMode: TaxMode }>) {
  return lines.every((line) => line.gstRate === "NA" || line.taxMode === "NA" || Math.abs(line.gstAmount) < 0.01);
}

function displayOrderNote(note?: string) {
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

function invoiceValue(value?: string | number | null) {
  if (value === null || value === undefined) return "N/A";
  const text = String(value).trim();
  return text ? text : "N/A";
}

function purchaseInvoiceCounterparty(snapshot: AppSnapshot, group: { lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  return snapshot.counterparties.find((item) => item.type === "Supplier" && item.id === first?.supplierId);
}

function salesInvoiceCounterparty(snapshot: AppSnapshot, group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  return snapshot.counterparties.find((item) => item.type === "Shop" && item.id === first?.shopId);
}

type InvoicePdfRow = {
  product: string;
  quantity: number;
  rate: number;
  taxableAmount: number;
  gstAmount: number;
  totalAmount: number;
};

type InvoicePdfConfig = {
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
  nonGst: boolean;
  companyGstNumber?: string;
};

function safePdfFileName(value: string) {
  return value.replace(/[<>:"/\\|?*]+/g, "-").replace(/\s+/g, " ").trim() || "invoice";
}

function downloadBlobFile(fileName: string, blob: Blob) {
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

function numberToWordsUnder1000(value: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (value < 20) return ones[value];
  if (value < 100) return `${tens[Math.floor(value / 10)]}${value % 10 ? ` ${ones[value % 10]}` : ""}`.trim();
  return `${ones[Math.floor(value / 100)]} Hundred${value % 100 ? ` ${numberToWordsUnder1000(value % 100)}` : ""}`.trim();
}

function numberToIndianWords(value: number) {
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

function formatChequeAmountWords(value: number) {
  const whole = Math.floor(Math.max(0, value));
  const paise = Math.round((Math.max(0, value) - whole) * 100);
  const rupeesText = `${numberToIndianWords(whole)} Rupees`;
  return paise > 0 ? `${rupeesText} and ${numberToWordsUnder1000(paise)} Paise Only` : `${rupeesText} Only`;
}

function openChequePrintWindow(payload: { partyName: string; amount: number; date: string; referenceNumber: string; note: string; }) {
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

async function shareInvoicePdfFile(fileName: string, blob: Blob, title: string) {
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
    window.alert("Direct WhatsApp PDF share is not supported on this browser. PDF downloaded instead.");
  }
}

function buildInvoicePdfBlob(config: InvoicePdfConfig) {
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
    doc.setFillColor(config.nonGst ? 248 : 230, config.nonGst ? 250 : 255, config.nonGst ? 252 : 251);
    doc.roundedRect(margin, y, contentWidth, 9, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    const headers = config.nonGst
      ? [
        { label: "#", x: margin + 3, align: "left" as const },
        { label: "Product", x: margin + 14, align: "left" as const },
        { label: "Qty", x: margin + 118, align: "right" as const },
        { label: "Rate", x: margin + 144, align: "right" as const },
        { label: "Amount", x: margin + 182, align: "right" as const }
      ]
      : [
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
  if (!config.nonGst && config.companyGstNumber) {
    doc.text(`AAPOORTI B2B | GSTIN: ${config.companyGstNumber}`, margin + 4, cursorY + 6);
  } else if (!config.nonGst) {
    doc.text("AAPOORTI B2B", margin + 4, cursorY + 6);
  }
  doc.setFontSize(18);
  doc.text(config.nonGst ? "Estimate" : config.documentTitle, margin + 4, cursorY + 16);
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
  drawMetaCard(margin + metaWidth + 6, cursorY, metaWidth, config.nonGst ? "Bill Type" : "AAPOORTI GSTIN", config.nonGst ? "Estimate" : invoiceValue(config.companyGstNumber));
  cursorY += 20;
  drawMetaCard(margin, cursorY, metaWidth, "Contact", config.contactName);
  drawMetaCard(margin + metaWidth + 6, cursorY, metaWidth, "Mobile", config.mobileNumber);
  cursorY += 20;
  drawMetaCard(margin, cursorY, contentWidth, "Address", config.address);
  cursorY += 24;

  drawTableHeader(cursorY);
  cursorY += 12;

  config.rows.forEach((row, index) => {
    const productLines = doc.splitTextToSize(row.product, config.nonGst ? 90 : 76);
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
    if (config.nonGst) {
      doc.text(String(row.quantity), margin + 118, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.rate), margin + 144, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.totalAmount), margin + 182, cursorY + 5, { align: "right" });
    } else {
      doc.text(String(row.quantity), margin + 104, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.rate), margin + 126, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.taxableAmount), margin + 148, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.gstAmount), margin + 166, cursorY + 5, { align: "right" });
      doc.text(formatMoney(row.totalAmount), margin + 182, cursorY + 5, { align: "right" });
    }
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

async function buildPurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  const warehouseName = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))).join(", ");
  const nonGst = isNonGstInvoice(group.lines);
  const supplier = purchaseInvoiceCounterparty(snapshot, group);
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Purchase", orderId: group.id }), { width: 180, margin: 1 });
  return buildInvoicePdfBlob({
    fileName: safePdfFileName(`${group.id}-${nonGst ? "estimate" : "purchase-tax-invoice"}.pdf`),
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
    note: nonGst ? displayOrderNote(first?.note) : [
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
    totals: nonGst
      ? [{ label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount, 0) }]
      : [
        { label: "Taxable", value: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0) },
        { label: "GST", value: group.lines.reduce((sum, line) => sum + line.gstAmount, 0) },
        { label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount, 0) }
      ],
    nonGst,
    companyGstNumber: nonGst ? undefined : COMPANY_GST_NUMBER
  });
}

async function buildSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const first = group.lines[0];
  const warehouseName = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId))).join(", ");
  const nonGst = isNonGstInvoice(group.lines);
  const customer = salesInvoiceCounterparty(snapshot, group);
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Sales", orderId: group.id }), { width: 180, margin: 1 });
  return buildInvoicePdfBlob({
    fileName: safePdfFileName(`${group.id}-${nonGst ? "estimate" : "sales-tax-invoice"}.pdf`),
    documentTitle: "Sales Tax Invoice",
    partyLabel: "Customer",
    partyName: `${invoiceValue(first?.shopName || customer?.name)} | GST ${invoiceValue(customer?.gstNumber)}`,
    warehouseName,
    contactName: invoiceValue(customer?.contactPerson),
    mobileNumber: invoiceValue(customer?.mobileNumber),
    address: invoiceValue([customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ")),
    createdAt: first?.createdAt,
    statusLabel: `${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`,
    qrDataUrl,
    note: nonGst ? displayOrderNote(first?.note) : [
      `Salesman: ${invoiceValue(first?.salesmanName)}`,
      `Delivery Mode: ${invoiceValue(first?.deliveryMode)}`,
      `Contact: ${invoiceValue(customer?.contactPerson)}`,
      `Mobile: ${invoiceValue(customer?.mobileNumber)}`,
      `Address: ${invoiceValue(customer?.deliveryAddress || customer?.address)}`,
      `City: ${invoiceValue(customer?.deliveryCity || customer?.city)}`
    ].join(" | "),
    rows: group.lines.map((line) => ({
      product: line.productSku,
      quantity: line.quantity,
      rate: line.rate,
      taxableAmount: line.taxableAmount,
      gstAmount: line.gstAmount,
      totalAmount: line.totalAmount
    })),
    totals: nonGst
      ? [
        { label: "Items", value: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0) },
        { label: "CD", value: group.lines.reduce((sum, line) => sum + (line.cdAmount || 0), 0) },
        { label: "TOD", value: group.lines.reduce((sum, line) => sum + (line.todAmount || 0), 0) },
        { label: "Delivery", value: group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0) },
        { label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0) }
      ]
      : [
        { label: "Taxable", value: group.lines.reduce((sum, line) => sum + line.taxableAmount, 0) },
        { label: "GST", value: group.lines.reduce((sum, line) => sum + line.gstAmount, 0) },
        { label: "CD", value: group.lines.reduce((sum, line) => sum + (line.cdAmount || 0), 0) },
        { label: "TOD", value: group.lines.reduce((sum, line) => sum + (line.todAmount || 0), 0) },
        { label: "Delivery", value: group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0) },
        { label: "Grand Total", value: group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0) }
      ],
    nonGst,
    companyGstNumber: nonGst ? undefined : COMPANY_GST_NUMBER
  });
}

async function downloadPurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const blob = await buildPurchaseInvoicePdf(snapshot, group);
  downloadBlobFile(safePdfFileName(`${group.id}.pdf`), blob);
}

async function downloadSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const blob = await buildSalesInvoicePdf(snapshot, group);
  downloadBlobFile(safePdfFileName(`${group.id}.pdf`), blob);
}

async function sharePurchaseInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const blob = await buildPurchaseInvoicePdf(snapshot, group);
  await shareInvoicePdfFile(safePdfFileName(`${group.id}.pdf`), blob, `Purchase invoice ${group.id}`);
}

async function shareSalesInvoicePdf(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const blob = await buildSalesInvoicePdf(snapshot, group);
  await shareInvoicePdfFile(safePdfFileName(`${group.id}.pdf`), blob, `Sales invoice ${group.id}`);
}

async function printPurchaseInvoice(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Purchase", orderId: group.id }), { width: 180, margin: 1 });
  printInvoiceDocument(`PO ${group.id}`, purchaseInvoiceHtml(snapshot, group, qrDataUrl));
}

async function printSalesInvoice(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const qrDataUrl = await QRCode.toDataURL(buildOrderStatusUrl({ side: "Sales", orderId: group.id }), { width: 180, margin: 1 });
  printInvoiceDocument(`SO ${group.id}`, salesInvoiceHtml(snapshot, group, qrDataUrl));
}

function purchaseInvoiceHtml(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }, qrDataUrl?: string) {
  const first = group.lines[0];
  const supplier = purchaseInvoiceCounterparty(snapshot, group);
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  const nonGstBill = isNonGstInvoice(group.lines);
  const rows = group.lines.map((line, index) => nonGstBill ? `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.productSku)}</td>
      <td>${line.quantityOrdered}</td>
      <td>${formatMoney(line.rate)}</td>
      <td>${formatMoney(line.totalAmount)}</td>
    </tr>
  ` : `
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
  if (nonGstBill) {
    return `
      <main class="invoice-kachcha-shell">
        <section class="invoice-kachcha-card">
          <div class="invoice-kachcha-head">
            <div class="invoice-kachcha-head-main">
              <h1 class="invoice-kachcha-title">Purchase Estimate</h1>
              <div class="invoice-subhead">${escapeHtml(group.id)}</div>
            </div>
            <div class="invoice-kachcha-head-side">
              <div><strong>${escapeHtml(purchaseWorkflowStatus(snapshot, group.id))}</strong></div>
              ${qrDataUrl ? `<div class="invoice-qr-card"><img class="invoice-qr-image" src="${qrDataUrl}" alt="PO QR" /><span>Order QR</span></div>` : ""}
            </div>
          </div>
          <div class="invoice-kachcha-meta">
            <div><span>Supplier</span><strong>${escapeHtml(first?.supplierName || "Supplier")}</strong></div>
            <div><span>Contact</span><strong>${escapeHtml(invoiceValue(supplier?.contactPerson))}</strong></div>
            <div><span>Mobile</span><strong>${escapeHtml(invoiceValue(supplier?.mobileNumber))}</strong></div>
            <div class="wide"><span>Address</span><strong>${escapeHtml(invoiceValue([supplier?.deliveryAddress || supplier?.address, supplier?.deliveryCity || supplier?.city].filter(Boolean).join(", ")))}</strong></div>
            <div><span>Delivery Mode</span><strong>${escapeHtml(invoiceValue(first?.deliveryMode))}</strong></div>
            <div><span>Warehouse</span><strong>${escapeHtml(warehouseNames.join(", "))}</strong></div>
            <div><span>Date</span><strong>${escapeHtml(formatShortDate(first?.createdAt))}</strong></div>
            <div><span>Bill Type</span><strong>Non GST</strong></div>
          </div>
          <table class="invoice-kachcha-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="invoice-kachcha-total">
            <div><span>Grand Total</span><strong>${formatMoney(total)}</strong></div>
          </div>
          ${displayOrderNote(first?.note) ? `<div class="invoice-note">${escapeHtml(displayOrderNote(first?.note))}</div>` : ""}
        </section>
      </main>
    `;
  }
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

function salesInvoiceHtml(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }, qrDataUrl?: string) {
  const first = group.lines[0];
  const customer = salesInvoiceCounterparty(snapshot, group);
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const cd = group.lines.reduce((sum, line) => sum + (line.cdAmount || 0), 0);
  const tod = group.lines.reduce((sum, line) => sum + (line.todAmount || 0), 0);
  const delivery = group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0);
  const nonGstBill = isNonGstInvoice(group.lines);
  const rows = group.lines.map((line, index) => nonGstBill ? `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.productSku)}</td>
      <td>${line.quantity}</td>
      <td>${formatMoney(line.rate)}</td>
      <td>${formatMoney(line.cdAmount || 0)}</td>
      <td>${formatMoney(line.todAmount || 0)}</td>
      <td>${formatMoney(line.totalAmount)}</td>
    </tr>
  ` : `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(line.productSku)}</td>
      <td>${line.quantity}</td>
      <td>${formatMoney(line.rate)}</td>
      <td>${formatMoney(line.taxableAmount)}</td>
      <td>${formatMoney(line.gstAmount)}</td>
      <td>${formatMoney(line.cdAmount || 0)}</td>
      <td>${formatMoney(line.todAmount || 0)}</td>
      <td>${formatMoney(line.totalAmount)}</td>
    </tr>
  `).join("");
  if (nonGstBill) {
    return `
      <main class="invoice-kachcha-shell">
        <section class="invoice-kachcha-card">
          <div class="invoice-kachcha-head">
            <div class="invoice-kachcha-head-main">
              <h1 class="invoice-kachcha-title">Sales Estimate</h1>
              <div class="invoice-subhead">${escapeHtml(group.id)}</div>
            </div>
            <div class="invoice-kachcha-head-side">
              <div><strong>${escapeHtml(`${salesFulfillmentStatus(group.lines)} / Payment ${salesPaymentStatus(snapshot, group.id)}`)}</strong></div>
              ${qrDataUrl ? `<div class="invoice-qr-card"><img class="invoice-qr-image" src="${qrDataUrl}" alt="SO QR" /><span>Order QR</span></div>` : ""}
            </div>
          </div>
          <div class="invoice-kachcha-meta">
            <div><span>Customer</span><strong>${escapeHtml(first?.shopName || "Customer")}</strong></div>
            <div><span>Contact</span><strong>${escapeHtml(invoiceValue(customer?.contactPerson))}</strong></div>
            <div><span>Mobile</span><strong>${escapeHtml(invoiceValue(customer?.mobileNumber))}</strong></div>
            <div class="wide"><span>Address</span><strong>${escapeHtml(invoiceValue([customer?.deliveryAddress || customer?.address, customer?.deliveryCity || customer?.city].filter(Boolean).join(", ")))}</strong></div>
            <div><span>Delivery Mode</span><strong>${escapeHtml(invoiceValue(first?.deliveryMode))}</strong></div>
            <div><span>Warehouse</span><strong>${escapeHtml(warehouseNames.join(", "))}</strong></div>
            <div><span>Date</span><strong>${escapeHtml(formatShortDate(first?.createdAt))}</strong></div>
            <div><span>Bill Type</span><strong>Non GST</strong></div>
          </div>
          <table class="invoice-kachcha-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Product</th>
                <th>Qty</th>
                <th>Rate</th>
                <th>CD</th>
                <th>TOD</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="invoice-kachcha-total">
            <div><span>Items Total</span><strong>${formatMoney(taxable)}</strong></div>
            <div><span>CD</span><strong>${formatMoney(cd)}</strong></div>
            <div><span>TOD</span><strong>${formatMoney(tod)}</strong></div>
            <div><span>Delivery</span><strong>${formatMoney(delivery)}</strong></div>
            <div><span>Grand Total</span><strong>${formatMoney(total)}</strong></div>
          </div>
          ${displayOrderNote(first?.note) ? `<div class="invoice-note">${escapeHtml(displayOrderNote(first?.note))}</div>` : ""}
        </section>
      </main>
    `;
  }
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
          <div><span>Bill Type</span><strong>GST</strong></div>
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

function purchaseInvoiceWhatsappText(snapshot: AppSnapshot, group: { id: string; lines: PurchaseOrder[] }) {
  const first = group.lines[0];
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const nonGstBill = isNonGstInvoice(group.lines);
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount, 0);
  const lines = nonGstBill
    ? [
      "AAPOORTI B2B",
      "Purchase Estimate",
      `PO: ${group.id}`,
      `Supplier: ${first?.supplierName || "Supplier"}`,
      `Warehouse: ${warehouseNames.join(", ")}`,
      `Date: ${formatShortDate(first?.createdAt)}`,
      ...group.lines.map((line) => `${line.productSku} | Qty ${line.quantityOrdered} | Rate ${formatMoney(line.rate)} | Amount ${formatMoney(line.totalAmount)}`),
      `Grand Total: ${formatMoney(total)}`
    ]
    : [
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

function salesInvoiceWhatsappText(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }) {
  const first = group.lines[0];
  const warehouseNames = Array.from(new Set(group.lines.map((line) => snapshot.warehouses.find((item) => item.id === line.warehouseId)?.name || line.warehouseId)));
  const nonGstBill = isNonGstInvoice(group.lines);
  const taxable = group.lines.reduce((sum, line) => sum + line.taxableAmount, 0);
  const gst = group.lines.reduce((sum, line) => sum + line.gstAmount, 0);
  const cd = group.lines.reduce((sum, line) => sum + (line.cdAmount || 0), 0);
  const tod = group.lines.reduce((sum, line) => sum + (line.todAmount || 0), 0);
  const delivery = group.lines.reduce((sum, line) => sum + line.deliveryCharge, 0);
  const total = group.lines.reduce((sum, line) => sum + line.totalAmount + line.deliveryCharge, 0);
  const lines = nonGstBill
    ? [
      "AAPOORTI B2B",
      "Sales Estimate",
      `SO: ${group.id}`,
      `Customer: ${first?.shopName || "Customer"}`,
      `Warehouse: ${warehouseNames.join(", ")}`,
      `Date: ${formatShortDate(first?.createdAt)}`,
      ...group.lines.map((line) => `${line.productSku} | Qty ${line.quantity} | Rate ${formatMoney(line.rate)} | CD ${formatMoney(line.cdAmount || 0)} | TOD ${formatMoney(line.todAmount || 0)} | Amount ${formatMoney(line.totalAmount)}`),
      `CD Total: ${formatMoney(cd)}`,
      `TOD Total: ${formatMoney(tod)}`,
      `Delivery: ${formatMoney(delivery)}`,
      `Grand Total: ${formatMoney(total)}`
    ]
    : [
      "AAPOORTI B2B",
      "Sales Tax Invoice",
      `SO: ${group.id}`,
      `Customer: ${first?.shopName || "Customer"}`,
      `Warehouse: ${warehouseNames.join(", ")}`,
      `Date: ${formatShortDate(first?.createdAt)}`,
      ...group.lines.map((line) => `${line.productSku} | Qty ${line.quantity} | Rate ${formatMoney(line.rate)} | Taxable ${formatMoney(line.taxableAmount)} | GST ${formatMoney(line.gstAmount)} | CD ${formatMoney(line.cdAmount || 0)} | TOD ${formatMoney(line.todAmount || 0)} | Total ${formatMoney(line.totalAmount)}`),
      `Taxable Total: ${formatMoney(taxable)}`,
      `GST Total: ${formatMoney(gst)}`,
      `CD Total: ${formatMoney(cd)}`,
      `TOD Total: ${formatMoney(tod)}`,
      `Delivery: ${formatMoney(delivery)}`,
      `Grand Total: ${formatMoney(total)}`
    ];
  return encodeURIComponent(lines.join("\n"));
}

function indiaDateKey(value?: string | Date) {
  const date = value ? new Date(value) : new Date();
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function indiaYesterdayDateKey() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return indiaDateKey(now);
}

function normalizeDateRange(fromDate: string, toDate: string) {
  if (!fromDate && !toDate) {
    const today = indiaDateKey();
    return { fromDate: today, toDate: today };
  }
  if (!fromDate) return { fromDate: toDate, toDate };
  if (!toDate) return { fromDate, toDate: fromDate };
  return fromDate <= toDate ? { fromDate, toDate } : { fromDate: toDate, toDate: fromDate };
}

function dateKeyInRange(dateKey: string, fromDate: string, toDate: string) {
  const normalized = normalizeDateRange(fromDate, toDate);
  return dateKey >= normalized.fromDate && dateKey <= normalized.toDate;
}

function dailySalesCollectorLabel(payment?: PaymentRecord, fallback = "Pending") {
  if (!payment) return fallback;
  const note = `${payment.verificationNote || ""} ${payment.createdBy || ""}`.toLowerCase();
  if (note.includes("delivery")) return "Delivery";
  if (note.includes("collection agent")) return "Collection Agent";
  if (note.includes("sales")) return "Sales Guy";
  return payment.createdBy || fallback;
}

function buildDailySalesReportPdf(snapshot: AppSnapshot, orders: SalesOrder[]) {
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

function downloadDailySalesReportPdf(snapshot: AppSnapshot, orders: SalesOrder[]) {
  const blob = buildDailySalesReportPdf(snapshot, orders);
  downloadBlobFile(safePdfFileName(`daily-sales-report-${indiaDateKey()}.pdf`), blob);
}

function scopedDailySalesOrders(snapshot: AppSnapshot, currentUser: AppUser) {
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

function downloadHomeDailySalesReportPdf(snapshot: AppSnapshot, currentUser: AppUser) {
  downloadDailySalesReportPdf(snapshot, scopedDailySalesOrders(snapshot, currentUser));
}

function countGroupedOrders(orders: Array<{ id: string; cartId?: string }>) {
  return new Set(orders.map((order) => order.cartId || order.id)).size;
}

function orderPublicId(order: { id: string; cartId?: string }) {
  return order.cartId || order.id;
}

function prioritizeWarehouseIds(warehouseIds: string[]) {
  return [...warehouseIds].sort((left, right) => {
    const leftPriority = left.trim().toLowerCase() === "gp" ? 0 : 1;
    const rightPriority = right.trim().toLowerCase() === "gp" ? 0 : 1;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    return left.localeCompare(right);
  });
}

function preferredWarehouseId(warehouseIds: string[]) {
  return prioritizeWarehouseIds(warehouseIds)[0] || "";
}

function groupOldestCreatedAt<T extends { createdAt: string }>(lines: T[]) {
  return Math.min(...lines.map((line) => new Date(line.createdAt).getTime()));
}

function groupNewestCreatedAt<T extends { createdAt: string }>(lines: T[]) {
  return Math.max(...lines.map((line) => new Date(line.createdAt).getTime()));
}

function isOpenPurchaseOrder(order: PurchaseOrder) {
  return order.status !== "Received" && order.status !== "Closed" && order.status !== "Cancelled";
}

function isOpenSalesOrder(order: SalesOrder) {
  return order.status !== "Delivered" && order.status !== "Closed" && order.status !== "Cancelled";
}

function findPurchaseOrderByPublicId(orders: PurchaseOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

function findSalesOrderByPublicId(orders: SalesOrder[], orderId: string) {
  return orders.find((order) => order.id === orderId || order.cartId === orderId);
}

function productNameBySku(products: AppSnapshot["products"], sku: string) {
  const product = products.find((item) => item.sku === sku);
  return product ? productDisplayLabel(product) : sku;
}

function productNamesSummary(products: AppSnapshot["products"], skus: string[], separator = ", ") {
  return skus.map((sku) => productNameBySku(products, sku)).join(separator);
}

function purchaseOrderPublicTotal(orders: PurchaseOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount, 0);
}

function salesOrderPublicTotal(orders: SalesOrder[], orderId: string) {
  const lines = orders.filter((order) => order.id === orderId || order.cartId === orderId);
  return lines.reduce((sum, order) => sum + order.totalAmount + order.deliveryCharge, 0);
}

function salesDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks.find((task) => task.side === "Sales" && [task.linkedOrderId, ...task.linkedOrderIds].includes(orderId));
}

function salesDeliveryStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.salesOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Delivery not assigned";
  if (lines.every((line) => line.status === "Delivered" || line.status === "Closed")) return "Delivered";
  const task = salesDeliveryTask(snapshot, orderId);
  if (!task) {
    return lines.some((line) => line.deliveryMode === "Self Collection") ? "Customer pickup" : "Delivery not assigned";
  }
  return `${deliveryTaskStatusLabel(task)}${task.assignedTo ? ` to ${task.assignedTo}` : ""}`;
}

function salesPaymentStatus(snapshot: AppSnapshot, orderId: string) {
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

function salesPaymentsByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.payments
    .filter((item) => item.side === "Sales" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function collectionAssignment(snapshot: AppSnapshot, orderId: string) {
  const notes = snapshot.notes
    .filter((note) => note.entityType === "Sales Order" && note.entityId === orderId && note.note.startsWith("Collection assignment:"))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  const latest = notes[0];
  if (!latest) return "";
  return latest.note.replace(/^Collection assignment:\s*/i, "").trim();
}

function groupSalesCashTiming(group: { lines: SalesOrder[] }) {
  return group.lines[0]?.cashTiming || "";
}

function salesCollectionHandledByDelivery(group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  return first?.deliveryMode === "Delivery" && first?.paymentMode === "Cash" && first?.cashTiming === "At Delivery";
}

function salesCollectionEligibleForAgent(group: { lines: SalesOrder[] }) {
  const first = group.lines[0];
  if (!first) return false;
  if (first.paymentMode !== "Cash") return true;
  return first.cashTiming === "Later";
}

function collectionVisibleToUser(snapshot: AppSnapshot, group: { id: string; lines: SalesOrder[] }, user: AppUser) {
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

function latestSalesPayment(snapshot: AppSnapshot, orderId: string) {
  return salesPaymentsByOrder(snapshot, orderId)[0];
}

function salesFulfillmentStatus(lines: SalesOrder[]) {
  if (lines.every((line) => line.status === "Delivered" || line.status === "Closed")) return "Delivered";
  if (lines.some((line) => line.status === "Draft")) return "Draft";
  if (lines.some((line) => line.status === "Out for Delivery")) return salesStatusLabel("Out for Delivery");
  if (lines.some((line) => line.status === "Ready for Dispatch")) return salesStatusLabel("Ready for Dispatch");
  if (lines.some((line) => line.status === "Pending Pickup")) return salesStatusLabel("Pending Pickup");
  if (lines.some((line) => line.status === "Self Pickup")) return salesStatusLabel("Self Pickup");
  return salesStatusLabel(lines[0]?.status || "Booked");
}

function groupPurchaseOrders(orders: PurchaseOrder[]) {
  const grouped = new Map<string, PurchaseOrder[]>();
  for (const order of orders) {
    const key = orderPublicId(order);
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => ({ id, lines }));
}

function groupSalesOrders(orders: SalesOrder[]) {
  const grouped = new Map<string, SalesOrder[]>();
  for (const order of orders) {
    const key = orderPublicId(order);
    grouped.set(key, [...(grouped.get(key) || []), order]);
  }
  return Array.from(grouped.entries()).map(([id, lines]) => ({ id, lines }));
}

function purchaseLedgerByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.ledgerEntries.find((item) => item.side === "Purchase" && item.linkedOrderId === orderId);
}

function purchasePaymentsByOrder(snapshot: AppSnapshot, orderId: string) {
  return snapshot.payments
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function latestPurchasePayment(snapshot: AppSnapshot, orderId: string) {
  return purchasePaymentsByOrder(snapshot, orderId)[0];
}

function purchaseCashDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks
    .filter((item) => item.side === "Purchase" && item.linkedOrderId === orderId && item.paymentAction === "Deliver Payment")
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];
}

function purchaseWarehouseStatus(lines: PurchaseOrder[]) {
  if (lines.every((line) => line.status === "Received" || line.status === "Closed")) return "Received";
  if (lines.some((line) => line.status === "Partially Received")) return "Partially Received";
  return "Order Placed - Pending Delivery";
}

function purchasePaymentStatus(snapshot: AppSnapshot, orderId: string) {
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

function purchaseWorkflowStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Pending";
  return `${purchaseWarehouseStatus(lines)} / Payment ${purchasePaymentStatus(snapshot, orderId)}`;
}

function purchaseDeliveryTask(snapshot: AppSnapshot, orderId: string) {
  return snapshot.deliveryTasks.find((task) => task.side === "Purchase" && [task.linkedOrderId, ...task.linkedOrderIds].includes(orderId));
}

function purchaseNeedsInternalPickup(lines: PurchaseOrder[]) {
  return lines.some((line) => line.deliveryMode === "Self Collection");
}

function purchaseDeliveryStatus(snapshot: AppSnapshot, orderId: string) {
  const lines = snapshot.purchaseOrders.filter((order) => orderPublicId(order) === orderId);
  if (lines.length === 0) return "Delivery not assigned";
  if (lines.every((line) => line.status === "Received" || line.status === "Closed")) return "Received";
  const task = purchaseDeliveryTask(snapshot, orderId);
  if (!task) {
    return purchaseNeedsInternalPickup(lines) ? "Pickup not assigned" : "Vendor delivery";
  }
  return `${deliveryTaskStatusLabel(task)}${task.assignedTo ? ` to ${task.assignedTo}` : ""}`;
}

function statusPillClass(status: string) {
  const normalized = status.toLowerCase();
  if (normalized.includes("flagged") || normalized.includes("disputed") || normalized.includes("rejected")) return "status-rejected";
  if (normalized.includes("customer pickup") || normalized.includes("vendor delivery")) return "status-pending";
  if (normalized.includes("pending") || normalized.includes("partial") || normalized.includes("cash with delivery")) return "status-pending";
  if (normalized.includes("completed") || normalized.includes("received") || normalized.includes("delivered") || normalized.includes("verified") || normalized.includes("closed")) return "status-verified";
  return "status-pending";
}

function purchaseOrderExportHeaders() {
  return ["Date", "PO Number", "Supplier", "Product", "Purchase Price", "Sale Price", "Qty Ordered", "Qty Received", "GST Bill", "GST %", "Taxable", "GST Amount", "Total", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Warehouse Status", "Order Status", "Warehouse"];
}

function purchaseOrderExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: PurchaseOrder[] }>) {
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

function salesOrderExportHeaders() {
  return ["Date", "SO Number", "Customer", "Product", "Purchase Price", "Sale Price", "Qty", "GST Bill", "GST %", "Taxable", "GST Amount", "Delivery", "Total", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Payment Status", "Order Status", "Warehouse"];
}

function salesOrderExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: SalesOrder[] }>) {
  return groups.flatMap((group) => group.lines.map((line) => [
    indiaDateKey(line.createdAt),
    group.id,
    line.shopName,
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

function deliveryTaskExportHeaders() {
  return ["Created Date", "Task ID", "Side", "Task Status", "Assigned To", "Mode", "Transport", "Vehicle", "From", "To", "Order IDs", "Party", "Product Summary", "Warehouse", "Payment Action", "Cash Required", "Reached", "Checked", "Paid", "Picked"];
}

function deliveryTaskExportRows(tasks: DeliveryTask[]) {
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

function inboundOpsExportHeaders() {
  return ["Date", "Flow", "Record Type", "Task ID", "PO Number", "Supplier", "Product", "Qty Ordered", "Qty Received", "Qty Pending", "Rate", "GST Bill", "GST %", "Taxable", "GST Amount", "Total", "Warehouse", "Mode", "Assigned To", "Task Status", "Warehouse Status", "Payment Status"];
}

function inboundOpsExportRows(
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

function outboundOpsExportHeaders() {
  return ["Date", "Flow", "Record Type", "Task ID", "SO Number", "Customer", "Product", "Qty", "Purchase Price", "Sale Price", "GST Bill", "GST %", "Taxable", "GST Amount", "Delivery Charge", "Total", "Warehouse", "Mode", "Assigned To", "Task Status", "Payment Action", "Cash Required", "Delivery Status", "Payment Status"];
}

function outboundOpsExportRows(
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

function purchasePaymentExportHeaders() {
  return ["Date", "PO Number", "Supplier", "Amount", "Mode", "Status", "Reference", "UTR", "Note"];
}

function purchasePaymentExportRows(snapshot: AppSnapshot, payments: PaymentRecord[]) {
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

function salesCollectionExportHeaders() {
  return ["Date", "SO Number", "Customer", "Products", "Total", "Paid", "Pending", "Payment Mode", "Cash Timing", "Delivery Mode", "Delivery Status", "Payment Status", "Collection Agent"];
}

function salesCollectionExportRows(snapshot: AppSnapshot, groups: Array<{ id: string; lines: SalesOrder[]; shopName: string; pendingAmount: number; paidAmount: number; totalAmount: number; paymentMode: PaymentMode; cashTiming: string; deliveryMode: string; }>) {
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

function consignmentExportHeaders() {
  return ["Date", "Consignment ID", "Warehouse", "Assigned To", "Dockets", "Total Weight", "Status", "Stops / Orders"];
}

function consignmentExportRows(snapshot: AppSnapshot, consignments: DeliveryConsignment[]) {
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

function docketExportHeaders() {
  return ["Date", "Docket ID", "SO Number", "Customer", "Product", "Qty", "Weight", "Warehouse", "Status", "Consignment"];
}

function docketExportRows(snapshot: AppSnapshot, dockets: DeliveryDocket[]) {
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

function downloadReportCsv(filePrefix: string, headers: string[], rows: Array<Array<string | number>>, fromDate: string, toDate: string) {
  const token = dateRangeFileToken(fromDate, toDate);
  downloadCsvFile(`${filePrefix}-${token}.csv`, headers, rows);
}

function downloadReportPdf(title: string, filePrefix: string, headers: string[], rows: Array<Array<string | number>>, fromDate: string, toDate: string, extraSubtitle: string[] = []) {
  const token = dateRangeFileToken(fromDate, toDate);
  const pdf = buildTablePdfBlob(title, [`From: ${fromDate}`, `To: ${toDate}`, `Rows: ${rows.length}`, ...extraSubtitle], headers, rows);
  downloadBlobFile(safePdfFileName(`${filePrefix}-${token}.pdf`), pdf);
}

function salesStatusLabel(status: SalesStatus) {
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

function deliveryDocketStatusLabel(status: DeliveryDocket["status"]) {
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

function deliveryConsignmentStatusLabel(status: DeliveryConsignment["status"]) {
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

function deliveryTaskStatusLabel(task: DeliveryTask) {
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

function assignedDeliveryUsers(value: string) {
  return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
}

function isUserAssignedToDelivery(value: string, user: AppUser) {
  const assignees = assignedDeliveryUsers(value);
  return assignees.includes(user.username) || assignees.includes(user.fullName);
}

function deliveryTasksForUser(snapshot: AppSnapshot, user: AppUser) {
  const side = deliverySideForUser(user);
  return snapshot.deliveryTasks.filter((task) => isUserAssignedToDelivery(task.assignedTo, user) && (!side || task.side === side));
}

function userRoleList(user: AppUser) {
  return user.roles && user.roles.length > 0 ? user.roles : [user.role];
}

function userHasAnyRole(user: AppUser, roles: UserRole[]) {
  const userRoles = userRoleList(user);
  return roles.some((role) => userRoles.includes(role));
}

function isDeliveryExecutive(user: AppUser) {
  return userHasAnyRole(user, ["In Delivery", "Out Delivery", "Delivery"]);
}

function isInboundDeliveryUser(user: AppUser) {
  return userHasAnyRole(user, ["In Delivery"]);
}

function isOutboundDeliveryUser(user: AppUser) {
  return userHasAnyRole(user, ["Out Delivery"]);
}

function deliverySideForUser(user: AppUser): DeliveryTask["side"] | null {
  const roles = userRoleList(user);
  if (roles.includes("Delivery")) return null;
  if (roles.includes("In Delivery")) return "Purchase";
  if (roles.includes("Out Delivery")) return "Sales";
  return null;
}

function isDeliveryTaskPending(task: DeliveryTask) {
  if (task.side === "Sales") return task.status !== "Delivered";
  return task.status !== "Handed Over" && task.status !== "Delivered";
}

function buildOrderStatusSummary(snapshot: AppSnapshot, target: OrderQrTarget): OrderStatusSummary | null {
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

function orderStatusAccess(snapshot: AppSnapshot, user: AppUser, target: OrderQrTarget): OrderStatusAccess {
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

function buildOrderStatusPdf(summary: OrderStatusSummary) {
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

function OrderQrCard({
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
    void QRCode.toDataURL(link, { width: 168, margin: 1 }).then((value: string) => {
      if (active) setDataUrl(value);
    }).catch(() => {
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

function OrderStatusOverlay({
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
          <button className="ghost-button" type="button" onClick={() => downloadBlobFile(safePdfFileName(`${target.orderId}-status.pdf`), buildOrderStatusPdf(summary))}>Download status PDF</button>
        </div>
      </>}
    </div>
  </div>;
}

function QrScanOverlay({
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

function homeTaskCards(snapshot: AppSnapshot, user: AppUser) {
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

function userWarehouseScope(user: AppUser) {
  return new Set((user.warehouseIds || []).filter(Boolean));
}

function isWarehouseScoped(user: AppUser) {
  const roles = user.roles && user.roles.length > 0 ? user.roles : [user.role];
  return userWarehouseScope(user).size > 0 && (roles.includes("Warehouse Manager") || roles.includes("Delivery Manager") || roles.includes("In Delivery") || roles.includes("Out Delivery") || roles.includes("Delivery"));
}

function snapshotForWarehouse(snapshot: AppSnapshot, warehouseId: string): AppSnapshot {
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

function snapshotForWarehouseScope(snapshot: AppSnapshot, warehouseIds: string[]): AppSnapshot {
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

function mapsDirectionsUrl(stops: string[]) {
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

function distanceKmBetween(left?: { latitude?: number; longitude?: number }, right?: { latitude?: number; longitude?: number }) {
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

function nearestNeighborOrder<T>(items: T[], locationFor: (item: T) => { latitude?: number; longitude?: number } | undefined) {
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

function calculateTaxPreview(amountText: string, gstRateText: string, taxMode: TaxModeInput) {
  const amount = Math.max(0, Number(amountText || 0));
  if (gstRateText === "NA" || taxMode === "NA") {
    return {
      taxableAmount: amount.toFixed(2),
      gstAmount: "0.00",
      totalAmount: amount.toFixed(2)
    };
  }
  const gstRate = Number(gstRateText || 0);
  const divisor = 1 + gstRate / 100;
  const taxableAmount = taxMode === "Inclusive" && divisor > 0 ? amount / divisor : amount;
  const gstAmount = taxMode === "Inclusive" ? amount - taxableAmount : taxableAmount * (gstRate / 100);
  return {
    taxableAmount: taxableAmount.toFixed(2),
    gstAmount: gstAmount.toFixed(2),
    totalAmount: (taxableAmount + gstAmount).toFixed(2)
  };
}

function purchaseCartEditState(snapshot: AppSnapshot, orderId: string, currentUser: AppUser) {
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

function purchaseCartDraftSignature(draft: {
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

function salesOrderDraftSignature(draft: {
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
      quantity: line.quantity,
      totalAmount: line.totalAmount,
      gstRate: line.gstRate,
      gstAmount: line.gstAmount,
      taxableAmount: line.taxableAmount,
      taxMode: line.taxMode
    }))
  });
}

function salesOrderEditState(snapshot: AppSnapshot, orderId: string, currentUser: AppUser) {
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
  const [salesForm, setSalesForm] = useState({ shopId: "", productSku: "", warehouseId: "", quantity: "0", rate: "0", taxableAmount: "0", gstRate: "0" as GstRateInput, gstAmount: "0", taxMode: "Exclusive" as TaxModeInput, paymentMode: "" as PaymentMode | "", cashTiming: "", deliveryMode: "" as "Self Collection" | "Delivery" | "", note: "", priceApprovalRequested: false, minimumAllowedRate: "0", stockApprovalRequested: false, availableStockAtOrder: "0", locationAddress: "", locationCity: "", location: null as null | { latitude: number; longitude: number; label?: string; address?: string; city?: string } });
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
            ? "GST number is required and must be unique. Use N/A for non-GST parties."
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
            ? `GST number is required and must be unique. Use N/A for non-GST ${partyEditForm.type === "Shop" ? "customers" : "suppliers"}.`
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
                  const { data } = await api.post<AppSnapshot>("/purchase-orders/cart", { ...purchaseForm, lines: lines.map((line) => ({ productSku: line.productSku, quantityOrdered: Number(line.quantity), rate: Number(line.rate), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0), gstAmount: line.gstRate === "NA" ? 0 : Number(line.gstAmount || 0), taxMode: line.gstRate === "NA" ? "NA" : line.taxMode, previousRate: Number(line.previousRate || 0) })), cashTiming: purchaseForm.paymentMode === "Cash" ? purchaseForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, {
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
            onUploadProof={(file) => uploadFile("/payments/upload-proof", "proof", file, "Advance proof uploaded.")}
            onSubmit={async (advancePayment, operationDate, lines, options) => {
              if (!currentUser || !sessionToken) return false;
              setLoading(true);
              setError("");
              setMessage("");
              try {
                const previousIds = new Set(groupSalesOrders(snapshot.salesOrders).map((group) => group.id));
                const { data } = await api.post<AppSnapshot>("/sales-orders/cart", { ...salesForm, allowProbationarySale: Boolean(options?.allowProbationarySale), lines: lines.map((line) => ({ productSku: line.productSku, quantity: Number(line.quantity), rate: Number(line.rate), cdTodRate: Number(line.cdTodRate || 0), cdAmount: Number(line.cdAmount || 0), todAmount: Number(line.todAmount || 0), taxableAmount: Number(line.taxableAmount || 0), gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0), gstAmount: line.gstRate === "NA" ? 0 : Number(line.gstAmount || 0), taxMode: line.gstRate === "NA" ? "NA" : line.taxMode, minimumAllowedRate: Number(line.minimumAllowedRate || 0), availableStockAtOrder: Number(line.availableStockAtOrder || 0), priceApprovalRequested: Boolean(line.priceApprovalRequested), stockApprovalRequested: Boolean(line.stockApprovalRequested), note: line.note || salesForm.note })), cashTiming: salesForm.paymentMode === "Cash" ? salesForm.cashTiming : undefined, advancePayment, operationDate: operationDate || undefined }, {
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

type CatalogOrderViewProps = {
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
  onUploadProof: (file: File) => Promise<unknown>;
  onSubmit: (advancePayment: { amount: number; mode: PaymentMode; cashTiming?: string; referenceNumber?: string; voucherNumber?: string; utrNumber?: string; proofName?: string; verificationNote?: string } | undefined, operationDate: string | undefined, lines: CartLine[], options?: { allowProbationarySale?: boolean }) => Promise<boolean | { orderId: string; kind: "purchase" | "sales" } | void> | boolean | { orderId: string; kind: "purchase" | "sales" } | void;
  rightPanel: React.ReactNode;
};

type CartLine = {
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

type CatalogDisplayProduct = {
  key: string;
  displayName: string;
  product: AppSnapshot["products"][number];
  variants: AppSnapshot["products"];
  familyKey?: string;
};

function catalogCardTitle(item: CatalogDisplayProduct, product: AppSnapshot["products"][number]) {
  return item.familyKey ? item.displayName : productDisplayLabel(product);
}

function normalizeStaplesWeightLabel(product: AppSnapshot["products"][number]) {
  const explicitVariant = (product.weightVariant || "").trim().toUpperCase();
  if (explicitVariant && explicitVariant !== "WRONG") {
    return explicitVariant;
  }
  const weightText = [
    product.size,
    product.name,
    product.sku,
    product.shortName,
    product.articleName,
    product.itemName
  ].filter(Boolean).join(" ").trim().toUpperCase();
  const sizeMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/);
  if (sizeMatch) {
    const value = Number(sizeMatch[1]);
    const unit = sizeMatch[2];
    if (["KG", "KGS"].includes(unit)) return `${value}KG`;
    if (["G", "GM", "GRAM"].includes(unit)) return `${value}GM`;
    if (["L", "LTR", "LT"].includes(unit)) return `${value}L`;
    if (unit === "ML") return `${value}ML`;
  }
  const weight = Number(product.defaultWeightKg || 0);
  if (weight > 0) {
    if (weight >= 1) return `${weight}KG`;
    return `${Math.round(weight * 1000)}GM`;
  }
  if (weightText.includes("LOOSE")) return "LOOSE";
  return product.unit || "Weight";
}

function staplesVariantSortWeight(product: AppSnapshot["products"][number]) {
  const weightText = [
    product.size,
    product.name,
    product.sku,
    product.shortName,
    product.articleName,
    product.itemName
  ].filter(Boolean).join(" ").trim().toUpperCase();
  const sizeMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/);
  if (sizeMatch) {
    const value = Number(sizeMatch[1]);
    const unit = sizeMatch[2];
    if (["KG", "KGS", "L", "LTR", "LT"].includes(unit)) return value;
    if (["G", "GM", "GRAM"].includes(unit)) return value / 1000;
    if (unit === "ML") return value / 1000;
  }
  const weight = Number(product.defaultWeightKg || 0);
  return weight > 0 ? weight : Number.POSITIVE_INFINITY;
}

function normalizeCatalogFamilyLabel(product: AppSnapshot["products"][number]) {
  const explicitBase = (product.baseProduct || "").trim();
  if (explicitBase) return explicitBase.toUpperCase();
  const primaryLabel = (
    product.name
    || product.shortName
    || product.itemName
    || product.articleName
    || product.sku
  ).toUpperCase();
  const cleaned = primaryLabel
    .replace(/[_/]+/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:KG|KGS|KILOGRAM|G|GM|GRAM|L|LTR|LT|LITRE|ML)\b/g, " ")
    .replace(/\b(?:PKD|PACK|PCK|JAR|FMCG|J)\b/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || primaryLabel.trim();
}

function buildCatalogDisplayProducts(items: AppSnapshot["products"]) {
  const grouped = new Map<string, AppSnapshot["products"]>();
  for (const product of items) {
    const family = normalizeCatalogFamilyLabel(product);
    const current = grouped.get(family) || [];
    current.push(product);
    grouped.set(family, current);
  }

  const display: CatalogDisplayProduct[] = [];
  for (const [family, variants] of grouped.entries()) {
    const sortedVariants = [...variants].sort((left, right) => {
      const weightDiff = staplesVariantSortWeight(left) - staplesVariantSortWeight(right);
      if (weightDiff !== 0) return weightDiff;
      return left.name.localeCompare(right.name, "en-IN");
    });
    const uniqueVariants = Array.from(
      sortedVariants.reduce((map, variant) => {
        const label = normalizeStaplesWeightLabel(variant);
        const current = map.get(label);
        if (!current) {
          map.set(label, variant);
          return map;
        }
        const variantName = `${variant.name} ${variant.shortName || ""} ${variant.articleName || ""} ${variant.itemName || ""}`.toUpperCase();
        const currentName = `${current.name} ${current.shortName || ""} ${current.articleName || ""} ${current.itemName || ""}`.toUpperCase();
        const score = (value: string, product: AppSnapshot["products"][number]) =>
          (product.size ? 10 : 0)
          + (Number(product.defaultWeightKg || 0) > 0 ? 8 : 0)
          + (/\bJAR\b|\bFMCG\b|\(J\)|\b J \b/.test(` ${value} `) ? -6 : 0)
          + (/\b\d+(?:\.\d+)?\s*(?:KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/.test(value) ? 4 : 0)
          + (value.length > 0 ? Math.min(value.length, 40) / 100 : 0);
        if (score(variantName, variant) > score(currentName, current)) {
          map.set(label, variant);
        }
        return map;
      }, new Map<string, AppSnapshot["products"][number]>())
      .values()
    );
    if (uniqueVariants.length === 1) {
      const [product] = uniqueVariants;
      display.push({
        key: product.sku,
        displayName: product.name,
        product,
        variants: [product]
      });
      continue;
    }
    display.push({
      key: `family-${family}`,
      displayName: family,
      product: uniqueVariants[0],
      variants: uniqueVariants,
      familyKey: family
    });
  }

  return display.sort((left, right) => left.displayName.localeCompare(right.displayName, "en-IN"));
}

function catalogVariantOptionLabel(
  variant: AppSnapshot["products"][number],
  variants: AppSnapshot["products"]
) {
  const baseLabel = normalizeStaplesWeightLabel(variant);
  const sameWeightVariants = variants.filter((item) => normalizeStaplesWeightLabel(item) === baseLabel);
  if (sameWeightVariants.length <= 1) return baseLabel;
  const detail = variant.shortName || variant.articleName || variant.itemName || variant.name || variant.sku;
  return `${baseLabel} - ${detail}`;
}

function productDisplayLabel(product: AppSnapshot["products"][number]) {
  const family = normalizeCatalogFamilyLabel(product);
  if (!family) return product.name;
  return `${family} - ${catalogVariantOptionLabel(product, [product])}`;
}

function CatalogOrderView(props: CatalogOrderViewProps) {
  const { snapshot, mode, title, eyebrow, persistKey, searchRequestToken = 0, products, parties, warehouses, paymentMethods, stockSummary, purchaseOrders = [], orderForm, setOrderForm, onCreateParty, onUploadProof, onSubmit, rightPanel } = props;
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
  const catalogSearchInputRef = useRef<HTMLInputElement | null>(null);
  const [completedOrder, setCompletedOrder] = useState<{ orderId: string; kind: "purchase" | "sales" } | null>(null);
  const isPurchase = mode === "purchase";
  const partyType = isPurchase ? "Supplier" : "Shop";
  const partyLabel = isPurchase ? "supplier / vendor" : "customer / shop";
  const partyDraftGstNa = partyDraft.gstNumber.trim().toUpperCase() === "N/A";
  const partyDraftBankNa = [partyDraft.bankName, partyDraft.bankAccountNumber, partyDraft.ifscCode].every((value) => value.trim().toUpperCase() === "N/A");
  const divisions = Array.from(new Set(products.map((item) => productCategoryLabel(item)).filter(Boolean)));
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
      article: (product.articleName || "").toLowerCase(),
      item: (product.itemName || "").toLowerCase(),
      size: (product.size || "").toLowerCase()
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
    if (fields.section.includes(normalized)) return 450;
    if (fields.division.includes(normalized)) return 400;
    if (tokens.length > 0 && tokens.every((token) => haystack.includes(token))) return 350 + tokens.length * 25;
    if (tokens.some((token) => haystack.includes(token))) return 180;
    return 0;
  }
  const filteredProducts = products.filter((product) => {
    const matchesDivision = activeDivision === "" || productCategoryLabel(product) === activeDivision;
    const matchesDepartment = activeDepartment === "" || product.department === activeDepartment;
    const matchesSection = activeSection === "" || product.section === activeSection;
    const matchesSearch = normalizedSearch === "" || productMatchScore(product, search) > 0;
    return matchesDivision && matchesDepartment && matchesSection && matchesSearch;
  }).sort((left, right) => {
    const query = search.trim();
    const scoreDiff = productMatchScore(right, query) - productMatchScore(left, query);
    if (scoreDiff !== 0) return scoreDiff;
    return left.name.localeCompare(right.name, "en-IN");
  });
  const catalogProducts = buildCatalogDisplayProducts(filteredProducts);
  const searchSuggestions = search.trim() === ""
    ? []
    : buildCatalogDisplayProducts(
        products
          .filter((product) => productMatchScore(product, search) > 0)
          .sort((left, right) => {
            const scoreDiff = productMatchScore(right, search) - productMatchScore(left, search);
            if (scoreDiff !== 0) return scoreDiff;
            return left.name.localeCompare(right.name, "en-IN");
          })
      ).slice(0, 6);
  const indexedSearchProducts = buildCatalogDisplayProducts(
    products
      .filter((product) => normalizedSearch === "" || productMatchScore(product, search) > 0)
      .sort((left, right) => {
        if (normalizedSearch) {
          const scoreDiff = productMatchScore(right, search) - productMatchScore(left, search);
          if (scoreDiff !== 0) return scoreDiff;
        }
        return left.name.localeCompare(right.name, "en-IN");
      })
  );
  const partySuggestions = parties
    .filter((party) => {
      const query = partySearch.trim().toLowerCase();
      const haystack = [party.name, party.gstNumber, party.mobileNumber, party.city, party.contactPerson].join(" ").toLowerCase();
      return query === "" || haystack.includes(query);
    })
    .slice(0, 8);

  function applySearchSuggestion(item: CatalogDisplayProduct) {
    setSearch(item.displayName);
    setActiveDivision("");
    setActiveDepartment("");
    setActiveSection("");
    setSuggestionOpen(false);
  }

  function applyIndexedSearch(item: CatalogDisplayProduct) {
    applySearchSuggestion(item);
    setSearchSheetOpen(false);
  }

  function selectSavedParty(party: Counterparty) {
    if (!isPurchase && cartLines.length > 0 && selectedPartyId && selectedPartyId !== party.id) {
      showCartToast("This cart is locked to the selected customer. Clear cart to change customer.");
      return;
    }
    setPartySearch(party.name);
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
        rate: existingLine?.rate || String(isPurchase ? (lastRate || getSuggestedRate(product) || 0) : (product.mrp ?? lastRate ?? 0)),
        cdTodRate: existingLine?.cdTodRate || existingLine?.rate || String(product.mrp ?? lastRate ?? 0),
        lastRate,
        gstRate: existingLine?.gstRate || (billTaxOverride.enabled ? billTaxOverride.gstRate : (product.defaultGstRate === "NA" ? "NA" : String(product.defaultGstRate || 0) as GstRateInput)),
        taxMode: existingLine?.taxMode || (billTaxOverride.enabled ? billTaxOverride.taxMode : (product.defaultTaxMode || "Exclusive")),
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
      const gstRate = updates.gstRate ?? line.gstRate;
      const taxMode = gstRate === "NA" ? "NA" : (updates.taxMode ?? (line.taxMode === "NA" ? "Exclusive" : line.taxMode));
      const totals = calculateLineTotals(line.quantity, line.rate, gstRate, taxMode);
      return { ...line, gstRate, taxMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
  }

  function applyBillTaxToAllLines(gstRate: GstRateInput, taxMode: TaxModeInput) {
    setCartLines((current) => current.map((line) => {
      const nextMode = gstRate === "NA" ? "NA" : taxMode;
      const totals = calculateLineTotals(line.quantity, line.rate, gstRate, nextMode);
      return { ...line, gstRate, taxMode: nextMode, taxableAmount: totals.taxableAmount, gstAmount: totals.gstAmount };
    }));
    setOrderForm((current: any) => {
      const amount = cartLines.reduce((sum, line) => sum + (Number(line.quantity || 0) * Number(line.rate || 0)), 0);
      return applyTaxCalculation({ ...current, gstRate, taxMode: gstRate === "NA" ? "NA" : taxMode }, String(amount), gstRate === "NA" ? "NA" : taxMode);
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
    const amount = Math.max(0, Number(amountText || 0));
    if (gstRateText === "NA" || taxMode === "NA") {
      return {
        taxableAmount: amount.toFixed(2),
        gstAmount: "0.00",
        totalAmount: amount.toFixed(2)
      };
    }
    const gstRate = Number(gstRateText || 0);
    const divisor = 1 + gstRate / 100;
    const taxableAmount = taxMode === "Inclusive" && divisor > 0 ? amount / divisor : amount;
    const gstAmount = taxMode === "Inclusive" ? amount - taxableAmount : taxableAmount * (gstRate / 100);
    const totalAmount = taxableAmount + gstAmount;
    return {
      taxableAmount: taxableAmount.toFixed(2),
      gstAmount: gstAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2)
    };
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
      const mode = field === "gstRate" && value === "NA" ? "NA" : field === "taxMode" ? value as TaxModeInput : next.taxMode === "NA" && field === "gstRate" ? "Exclusive" : next.taxMode;
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

  function confirmProductRate() {
    if (!ratePopup) return;
    const popup = ratePopup;
    const nextRate = Number(popup.rate || 0);
    const nextQuantity = Number(popup.quantity || 0);
    const lineTotals = calculateLineTotals(popup.quantity, popup.rate, popup.gstRate, popup.taxMode);
    if (nextRate <= 0) {
      showCartToast("Enter product rate");
      return;
    }
    if (!isPurchase && Number(popup.cdTodRate || 0) > nextRate) {
      showCartToast("CD/TOD rate cannot be higher than sale rate");
      return;
    }
    if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
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
    setCartOpen(true);
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
      warehouseId: !orderForm.warehouseId,
      quantityOrdered: !cartHasLines || Boolean(invalidLine),
      rate: Boolean(invalidLine)
    };
    setCartErrors((current) => ({ ...current, ...nextErrors }));
    if (nextErrors.supplierId) {
      showCartToast(isPurchase ? "Select supplier" : "Select customer");
      return false;
    }
    if (nextErrors.warehouseId) {
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
      showCartToast("Select payment method");
      return false;
    }
    if (nextErrors.cashTiming) {
      showCartToast("Select cash timing");
      return false;
    }
    if (nextErrors.deliveryMode) {
      showCartToast("Select delivery mode");
      return false;
    }
    if (nextErrors.advanceAmount) {
      showCartToast(`Enter advance amount between 1 and ${cartTotal.toFixed(2)}`);
      return false;
    }
    if (nextErrors.advanceMode) {
      showCartToast("Select advance payment mode");
      return false;
    }
    if (nextErrors.advanceCashProof) {
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
      gstNumber: !gstNumber || (gstNumber.toUpperCase() !== "N/A" && parties.some((item) => item.gstNumber.trim().toLowerCase() === gstNumber.toLowerCase())),
      bankAccountNumber: !bankAccountNumber || (bankAccountNumber.toUpperCase() !== "N/A" && parties.some((item) => item.bankAccountNumber.trim().toLowerCase() === bankAccountNumber.toLowerCase())),
      ifscCode: !ifscCode
    };
    setPartyDraftErrors(nextErrors);
    if (nextErrors.name || nextErrors.gstNumber || nextErrors.bankAccountNumber || nextErrors.ifscCode) {
      showCartToast(
        nextErrors.name
          ? `${isPurchase ? "Supplier" : "Customer"} name is required and must be unique`
          : nextErrors.gstNumber
            ? "GST number is required and must be unique. Use N/A for non-GST parties."
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
  const totalWeightKg = cartProducts.reduce((sum, item) => sum + item.product.defaultWeightKg * Number(item.line.quantity || 0), 0);
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

  const mainPanel = (
        <Panel title={title} eyebrow={eyebrow}>
          <div className="catalog-shell">
            {flowStep !== "catalog" ? <div className="flow-card">
              {flowStep === "landing" ? <>
                <span className="eyebrow">Start</span>
                <h3>{isPurchase ? "Choose supplier first" : "Start Sale"}</h3>
                <p>{isPurchase ? "Ask the purchaser to select an existing supplier or create a new supplier before opening categories." : `Select an existing ${partyLabel} or create a new one before continuing to the product page.`}</p>
                <div className="flow-action-row">
                  <button className="primary-button" type="button" onClick={() => setFlowStep("existing")}>Existing {isPurchase ? "Supplier" : "Customer"}</button>
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("new")}>New {isPurchase ? "Supplier" : "Customer"}</button>
                </div>
              </> : null}
              {flowStep === "existing" ? <>
                <span className="eyebrow">Selection</span>
                <h3>Select existing {partyLabel}</h3>
                <div className="form-grid top-gap">
                  <label className="wide-field supplier-search-field">Search saved {isPurchase ? "supplier" : "customer"}<div className="search-box"><input value={partySearch} onChange={(e) => { setPartySearch(e.target.value); setPartySuggestionOpen(true); }} onFocus={() => setPartySuggestionOpen(true)} onBlur={() => window.setTimeout(() => setPartySuggestionOpen(false), 120)} placeholder={`Type saved ${isPurchase ? "supplier" : "customer"} name, GST, city, or mobile`} />{partySuggestionOpen ? <div className="search-suggestion-list">{partySuggestions.length > 0 ? partySuggestions.map((party) => <button key={party.id} type="button" className="search-suggestion-item" onMouseDown={() => selectSavedParty(party)}><strong>{party.name}</strong><span>{party.gstNumber || "GST pending"} / {party.mobileNumber || "Mobile pending"} / {party.city || "City pending"}</span></button>) : <div className="search-suggestion-item empty-suggestion"><strong>No saved {isPurchase ? "supplier" : "customer"} found</strong><span>Create one first.</span></div>}</div> : null}</div></label>
                  <label className="wide-field">{isPurchase ? "Supplier" : "Customer"}<select value={selectedPartyId} onChange={(e) => { const party = parties.find((item) => item.id === e.target.value); if (party) setPartySearch(party.name); setOrderForm((current: any) => isPurchase ? ({ ...current, supplierId: e.target.value, locationAddress: party?.deliveryAddress || party?.address || "", locationCity: party?.deliveryCity || party?.city || "" }) : ({ ...current, shopId: e.target.value, locationAddress: party?.deliveryAddress || party?.address || "", locationCity: party?.deliveryCity || party?.city || "" })); }}>{renderOptions(parties)}</select></label>
                </div>
                <div className="flow-action-row">
                  <button className="ghost-button" type="button" onClick={() => setFlowStep("landing")}>Back</button>
                  <button className="primary-button" type="button" onClick={() => setFlowStep("catalog")} disabled={!selectedPartyId}>{isPurchase ? "Back to purchase order page" : "Back to sales order page"}</button>
                </div>
              </> : null}
              {flowStep === "new" ? <>
                <span className="eyebrow">Registration</span>
                <h3>{isPurchase ? "Vendor registration page" : "Customer registration page"}</h3>
                <div className="form-grid top-gap">
                  <label className={partyDraftErrors.name ? "field-error" : ""}>Name<input value={partyDraft.name} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, name: false })); setPartyDraft((c) => ({ ...c, name: e.target.value })); }} /></label>
                  <label className={partyDraftErrors.gstNumber ? "field-error" : ""}>GST<input value={partyDraft.gstNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, gstNumber: false })); setPartyDraft((c) => ({ ...c, gstNumber: e.target.value })); }} placeholder="GST number or N/A" /></label>
                  <label className="checkbox-line"><input type="checkbox" checked={partyDraftGstNa} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, gstNumber: false })); setPartyDraft((c) => ({ ...c, gstNumber: e.target.checked ? "N/A" : "" })); }} />GST N/A</label>
                  <label>Bank name<input value={partyDraft.bankName} onChange={(e) => setPartyDraft((c) => ({ ...c, bankName: e.target.value }))} placeholder="Bank name or N/A" /></label>
                  <label className={partyDraftErrors.bankAccountNumber ? "field-error" : ""}>Bank account<input value={partyDraft.bankAccountNumber} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, bankAccountNumber: false })); setPartyDraft((c) => ({ ...c, bankAccountNumber: e.target.value })); }} placeholder="Account number or N/A" /></label>
                  <label className={partyDraftErrors.ifscCode ? "field-error" : ""}>IFSC<input value={partyDraft.ifscCode} onChange={(e) => { setPartyDraftErrors((c) => ({ ...c, ifscCode: false })); setPartyDraft((c) => ({ ...c, ifscCode: e.target.value.toUpperCase() })); }} placeholder="IFSC code or N/A" /></label>
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
                <div className="catalog-search-sheet-meta">
                  <span className="small-label">{normalizedSearch ? "Ranked results" : "Indexed products"}</span>
                  <strong>{indexedSearchProducts.length} item{indexedSearchProducts.length === 1 ? "" : "s"}</strong>
                </div>
                <div className="catalog-search-sheet-results">
                  {indexedSearchProducts.length > 0 ? indexedSearchProducts.map((item) => {
                    const product = resolveCatalogProduct(item);
                    return <button key={`indexed-${item.key}`} type="button" className="search-suggestion-item catalog-search-sheet-item" onClick={() => applyIndexedSearch(item)}>
                      <strong>{item.displayName}</strong>
                      <span>{product.sku} / {productCategoryLabel(product)} / {product.department || "General"} / {product.section || "General"}</span>
                    </button>;
                  }) : <div className="search-suggestion-item empty-suggestion"><strong>No matching product found</strong><span>Try a broader name, barcode, or brand.</span></div>}
                </div>
              </div>
            </div> : null}

            {completedOrder ? <div className="cart-overlay" onClick={() => setCompletedOrder(null)}>
              <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{completedOrder.kind === "purchase" ? "Purchase Bill" : "Sales Bill"}</span>
                    <h3>{completedOrder.orderId}</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCompletedOrder(null)}>Close</button>
                </div>
                <div className="payment-meta-grid">
                  <div><span className="small-label">Document</span><strong>{completedOrder.kind === "purchase" ? "PO / Bill ready" : "SO / Estimate ready"}</strong></div>
                  <div><span className="small-label">Share</span><strong>WhatsApp or PDF</strong></div>
                </div>
                <div className="cart-actions top-gap">
                  {completedPurchaseGroup ? <button type="button" className="ghost-button" onClick={() => void sharePurchaseInvoicePdf(snapshot, completedPurchaseGroup)}>WhatsApp Share</button> : null}
                  {completedPurchaseGroup ? <button type="button" className="ghost-button" onClick={() => downloadPurchaseInvoicePdf(snapshot, completedPurchaseGroup)}>Download PDF</button> : null}
                  {completedPurchaseGroup ? <button type="button" className="primary-button" onClick={() => void printPurchaseInvoice(snapshot, completedPurchaseGroup)}>Open Bill</button> : null}
                  {completedSalesGroup ? <button type="button" className="ghost-button" onClick={() => void shareSalesInvoicePdf(snapshot, completedSalesGroup)}>WhatsApp Share</button> : null}
                  {completedSalesGroup ? <button type="button" className="ghost-button" onClick={() => downloadSalesInvoicePdf(snapshot, completedSalesGroup)}>Download PDF</button> : null}
                  {completedSalesGroup ? <button type="button" className="primary-button" onClick={() => void printSalesInvoice(snapshot, completedSalesGroup)}>Open Estimate</button> : null}
                </div>
              </div>
            </div> : null}

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
                      <strong>{isPurchase ? `Last purchase ${getLastPurchaseRate(product)}` : `Min sell ${getLastPurchaseRate(product)}`}</strong>
                      <span>{`MRP ${product.mrp ?? 0}`}</span>
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
            {ratePopup ? <div className="cart-overlay" onClick={() => setRatePopup(null)}>
              <div className="cart-sheet rate-popup-sheet" onClick={(e) => e.stopPropagation()}>
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
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Close</button>
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
                  <label className={Number(ratePopup.quantity || 0) <= 0 ? "field-error" : ""}>
                    Enter Qty
                    <input type="number" step="any" value={ratePopup.quantity} onChange={(e) => setRatePopup((current) => current ? { ...current, quantity: e.target.value } : current)} />
                  </label>
                  <label className={Number(ratePopup.rate || 0) <= 0 ? "field-error" : ""}>
                    Enter Rate
                    <input type="number" step="any" value={ratePopup.rate} onChange={(e) => setRatePopup((current) => current ? { ...current, rate: e.target.value, confirmHighRate: false } : current)} />
                  </label>
                  {!isPurchase ? <label className={Number(ratePopup.cdTodRate || 0) > Number(ratePopup.rate || 0) ? "field-error" : ""}>
                    CD/TOD Rate
                    <input type="number" step="any" value={ratePopup.cdTodRate} onChange={(e) => setRatePopup((current) => current ? { ...current, cdTodRate: e.target.value } : current)} />
                  </label> : null}
                </div>
                <div className="cart-edit-grid">
                  <label>
                    Bill Type
                    <select value={ratePopup.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => setRatePopup((current) => current ? {
                      ...current,
                      gstRate: e.target.value === "NA" ? "NA" : (current.gstRate === "NA" ? "0" : current.gstRate),
                      taxMode: e.target.value === "NA" ? "NA" : (current.taxMode === "NA" ? "Exclusive" : current.taxMode)
                    } : current)}>
                      <option value="GST">GST Bill</option>
                      <option value="NA">Non GST Bill</option>
                    </select>
                  </label>
                  <label>
                    GST Rate
                    <select value={ratePopup.gstRate} onChange={(e) => setRatePopup((current) => current ? { ...current, gstRate: e.target.value as GstRateInput, taxMode: e.target.value === "NA" ? "NA" : (current.taxMode === "NA" ? "Exclusive" : current.taxMode) } : current)}>
                      <option value="NA">NA</option>
                      <option value="0">0%</option>
                      <option value="5">5%</option>
                      <option value="12">12%</option>
                      <option value="18">18%</option>
                      <option value="40">40%</option>
                    </select>
                  </label>
                  <label>
                    Calculation
                    <select value={ratePopup.taxMode} onChange={(e) => setRatePopup((current) => current ? { ...current, taxMode: e.target.value as TaxModeInput } : current)} disabled={ratePopup.gstRate === "NA"}>
                      <option value="Exclusive">GST Extra</option>
                      <option value="Inclusive">GST Included</option>
                      <option value="NA">Final Amount</option>
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
                  <button type="button" className="ghost-button" onClick={() => { setRatePopup(null); setCartOpen(false); }}>Continue shopping</button>
                  <button type="button" className="ghost-button" onClick={() => setRatePopup(null)}>Cancel</button>
                  <button type="button" className="primary-button" onClick={confirmProductRate}>
                    {isPurchase
                      ? (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) > ratePopup.lastRate && ratePopup.confirmHighRate ? "Sure and continue" : "Continue")
                      : (ratePopup.lastRate > 0 && Number(ratePopup.rate || 0) < ratePopup.lastRate && ratePopup.confirmHighRate ? "Confirm and continue" : "Continue")}
                  </button>
                </div>
                </>;
                })()}
              </div>
            </div> : null}
            {cartOpen && cartLines.length > 0 ? <div className="cart-overlay" onClick={() => setCartOpen(false)}>
              <div className="cart-sheet" onClick={(e) => e.stopPropagation()}>
                {cartToast ? <div className="cart-toast">{cartToast}</div> : null}
                <div className="cart-head">
                  <div>
                    <span className="eyebrow">{cartStepTitle}</span>
                    <h3>{cartLines.length} product cart</h3>
                  </div>
                  <button type="button" className="ghost-button" onClick={() => setCartOpen(false)}>Close</button>
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
                      <label>Bill Type<select value={line.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => updateCartLineTax(line.productSku, e.target.value === "NA" ? { gstRate: "NA", taxMode: "NA" } : { gstRate: line.gstRate === "NA" ? "0" : line.gstRate, taxMode: line.taxMode === "NA" ? "Exclusive" : line.taxMode })} disabled={billTaxOverride.enabled}><option value="GST">GST Bill</option><option value="NA">Non GST Bill</option></select></label>
                      <label>GST<select value={line.gstRate} onChange={(e) => updateCartLineTax(line.productSku, { gstRate: e.target.value as GstRateInput, taxMode: e.target.value === "NA" ? "NA" : (line.taxMode === "NA" ? "Exclusive" : line.taxMode) })} disabled={billTaxOverride.enabled}><option value="NA">NA</option><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label>
                      <label>Calculation<select value={line.taxMode} onChange={(e) => updateCartLineTax(line.productSku, { taxMode: e.target.value as TaxModeInput })} disabled={line.gstRate === "NA" || billTaxOverride.enabled}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option><option value="NA">Final Amount</option></select></label>
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
                  <label className={cartErrors.supplierId ? "field-error" : ""}>
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
                  <label className={cartErrors.warehouseId ? "field-error" : ""}>
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
                  <label className={cartErrors.paymentMode ? "field-error" : ""}>
                    Payment Method
                    <select value={orderForm.paymentMode} onChange={(e) => { setCartErrors((current) => ({ ...current, paymentMode: false })); setOrderForm((current: any) => ({ ...current, paymentMode: e.target.value as PaymentMode | "" })); }}>
                      <option value="">Select</option>
                      {paymentMethods.map((method) => <option key={method.code} value={method.code}>{method.code}</option>)}
                    </select>
                  </label>
                  {orderForm.paymentMode === "Cash" ? <label className={cartErrors.cashTiming ? "field-error" : ""}>
                    Cash Timing
                    <select value={orderForm.cashTiming} onChange={(e) => { setCartErrors((current) => ({ ...current, cashTiming: false })); setOrderForm((current: any) => ({ ...current, cashTiming: e.target.value })); }}>
                      <option value="">Select</option>
                      <option>In Hand</option>
                      <option>At Delivery</option>
                      {!isPurchase ? <option>Later</option> : null}
                    </select>
                  </label> : null}
                  <label className={cartErrors.deliveryMode ? "field-error" : ""}>
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
                    Override whole bill tax structure at final bill
                  </label>
                  {billTaxOverride.enabled ? <>
                    <label>
                      Bill Type
                      <select value={billTaxOverride.gstRate === "NA" ? "NA" : "GST"} onChange={(e) => {
                        const nextGstRate = e.target.value === "NA" ? "NA" : (billTaxOverride.gstRate === "NA" ? "0" : billTaxOverride.gstRate);
                        const nextTaxMode = e.target.value === "NA" ? "NA" : (billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode);
                        setBillTaxOverride({ enabled: true, gstRate: nextGstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(nextGstRate, nextTaxMode);
                      }}>
                        <option value="GST">GST Bill</option>
                        <option value="NA">Non GST Bill</option>
                      </select>
                    </label>
                    <label>
                      GST Rate
                      <select value={billTaxOverride.gstRate} onChange={(e) => {
                        const nextGstRate = e.target.value as GstRateInput;
                        const nextTaxMode = nextGstRate === "NA" ? "NA" : (billTaxOverride.taxMode === "NA" ? "Exclusive" : billTaxOverride.taxMode);
                        setBillTaxOverride({ enabled: true, gstRate: nextGstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(nextGstRate, nextTaxMode);
                      }}>
                        <option value="NA">NA</option>
                        <option value="0">0%</option>
                        <option value="5">5%</option>
                        <option value="12">12%</option>
                        <option value="18">18%</option>
                        <option value="40">40%</option>
                      </select>
                    </label>
                    <label>
                      Calculation
                      <select value={billTaxOverride.taxMode} onChange={(e) => {
                        const nextTaxMode = e.target.value as TaxModeInput;
                        setBillTaxOverride({ enabled: true, gstRate: billTaxOverride.gstRate, taxMode: nextTaxMode });
                        applyBillTaxToAllLines(billTaxOverride.gstRate, nextTaxMode);
                      }} disabled={billTaxOverride.gstRate === "NA"}>
                        <option value="Exclusive">GST Extra</option>
                        <option value="Inclusive">GST Included</option>
                        <option value="NA">Final Amount</option>
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
                    <label className={cartErrors.advanceAmount ? "field-error" : ""}>
                      Advance Amount
                      <input type="number" step="any" value={advancePayment.amount} onChange={(e) => { setCartErrors((current) => ({ ...current, advanceAmount: false })); setAdvancePayment((current) => ({ ...current, amount: e.target.value })); }} />
                    </label>
                    <label className={cartErrors.advanceMode ? "field-error" : ""}>
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
                    {advancePayment.mode === "Cash" ? <label className={cartErrors.advanceCashProof ? "field-error wide-field" : "wide-field"}>
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
                  <div><span className="small-label">Quantity</span><strong>{cartLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0)}</strong></div>
                  <div><span className="small-label">Total weight</span><strong>{totalWeightKg.toFixed(2)} kg</strong></div>
                  <div><span className="small-label">Taxable</span><strong>{cartTaxable.toFixed(2)}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Input GST" : "Output GST"}</span><strong>{cartGstAmount.toFixed(2)}</strong></div>
                  {!isPurchase ? <div><span className="small-label">CD</span><strong>{cartCdAmount.toFixed(2)}</strong></div> : null}
                  {!isPurchase ? <div><span className="small-label">TOD</span><strong>{cartTodAmount.toFixed(2)}</strong></div> : null}
                  <div><span className="small-label">Bill total</span><strong>{cartTotal.toFixed(2)}</strong></div>
                  <div><span className="small-label">Entry date</span><strong>{checkoutDate || "Today"}</strong></div>
                  <div><span className="small-label">Payment</span><strong>{orderForm.paymentMode}{orderForm.paymentMode === "Cash" && orderForm.cashTiming ? ` / ${orderForm.cashTiming}` : ""}</strong></div>
                  {billTaxOverride.enabled ? <div><span className="small-label">Bill tax override</span><strong>{billTaxOverride.gstRate === "NA" ? "Non GST / Final Amount" : `${billTaxOverride.gstRate}% / ${billTaxOverride.taxMode}`}</strong></div> : null}
                  {advancePayment.enabled ? <div><span className="small-label">{isPurchase ? "Advance given" : "Advance taken"}</span><strong>{Number(advancePayment.amount || 0).toFixed(2)} / {advancePayment.mode}{advancePayment.mode === "Cash" ? " / cash photo attached" : ""}</strong></div> : null}
                  <div><span className="small-label">Delivery mode</span><strong>{orderForm.deliveryMode}</strong></div>
                  <div><span className="small-label">{isPurchase ? "Pickup location" : "Delivery location"}</span><strong>{orderForm.location?.label || [liveAddressText, liveCityText].filter(Boolean).join(", ") || selectedParty?.locationLabel || "Not marked"}</strong></div>
                </div>
                <div className="stack-list top-gap">
                  {cartProducts.map(({ line, product }) => <article className="list-card cart-summary-line" key={line.productSku}>
                    <strong>{productDisplayLabel(product)}</strong>
                    <p>{line.quantity} x {Number(line.rate || 0).toFixed(2)} = {getCartLineTotal(line).toFixed(2)} · {line.gstRate === "NA" ? "Non GST / Final Amount" : `${line.gstRate}% / ${line.taxMode}`}{!isPurchase ? ` · CD ${getCartLineCdAmount(line).toFixed(2)} · TOD ${getCartLineTodAmount(line).toFixed(2)}` : ""}</p>
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
            </div> : null}
            </> : null}
          </div>
        </Panel>
  );

  return rightPanel ? <TwoCol left={mainPanel} right={rightPanel} /> : <section>{mainPanel}</section>;
}

function PurchaserPurchaseWorkspace({
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

function PurchaserPurchaseSummary({ snapshot, currentUser, orders, onUpdatePo, onOpenStatus }: { snapshot: AppSnapshot; currentUser?: AppUser; orders: AppSnapshot["purchaseOrders"]; onUpdatePo?: (orderId: string) => void; onOpenStatus?: (target: OrderQrTarget) => void }) {
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

function PurchaseCartEditor({
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
        gstRate: line.gstRate === "NA" ? "NA" : String(line.gstRate || 0) as GstRateInput,
        gstAmount: String(line.gstAmount),
        taxableAmount: String(line.taxableAmount),
        taxMode: line.taxMode === "NA" ? "NA" : ((line.taxMode || "Exclusive") as TaxModeInput)
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
          const gstRate = updates.gstRate ?? line.gstRate ?? (product?.defaultGstRate === "NA" ? "NA" : String(product?.defaultGstRate || 0) as GstRateInput);
          const fallbackTaxMode = product?.defaultTaxMode === "NA" ? "NA" : (product?.defaultTaxMode || "Exclusive");
          const taxMode = gstRate === "NA" ? "NA" : (updates.taxMode ?? (line.taxMode === "NA" ? fallbackTaxMode : line.taxMode));
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
    const gstRate = fallbackProduct.defaultGstRate === "NA" ? "NA" : String(fallbackProduct.defaultGstRate || 0) as GstRateInput;
    const taxMode = fallbackProduct.defaultTaxMode === "NA" ? "NA" : fallbackProduct.defaultTaxMode;
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
        gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
        gstAmount: Number(line.gstAmount || 0),
        taxMode: line.gstRate === "NA" ? "NA" : line.taxMode
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
                gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
                gstAmount: Number(line.gstAmount || 0),
                taxMode: line.gstRate === "NA" ? "NA" : line.taxMode
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

function SalesOrderSummary({ snapshot, currentUser, orders, onUpdateSo, onCreatePayment, onTagCollectionAgent, onLogCollectionNote, onOpenStatus }: { snapshot: AppSnapshot; currentUser: AppUser; orders: AppSnapshot["salesOrders"]; onUpdateSo: (orderId: string) => void; onCreatePayment: (body: { side: "Purchase" | "Sales"; linkedOrderId: string; amount: number; mode: PaymentMode; cashTiming?: string; referenceNumber: string; voucherNumber?: string; utrNumber?: string; proofName?: string; verificationStatus: "Pending" | "Submitted" | "Verified" | "Rejected" | "Disputed" | "Resolved"; verificationNote: string; operationDate?: string; }) => Promise<boolean | void>; onTagCollectionAgent: (orderId: string, assignedTo: string) => Promise<boolean | void>; onLogCollectionNote: (orderId: string, note: string) => Promise<boolean | void>; onOpenStatus?: (target: OrderQrTarget) => void; }) {
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

function SalesOrderEditor({ snapshot, currentUser, initialOrderId, onNewOrder, onDirtyChange, onUpdateSalesOrder }: {
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
  const [draft, setDraft] = useState<{ paymentMode: PaymentMode; cashTiming: string; deliveryMode: "Self Collection" | "Delivery"; note: string; status: SalesStatus; lines: Array<{ clientKey: string; id?: string; productSku: string; warehouseId: string; rate: string; quantity: string; totalAmount: number; gstRate: GstRateInput; gstAmount: string; taxableAmount: string; taxMode: TaxModeInput }> } | null>(null);
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
        quantity: String(line.quantity),
        totalAmount: line.totalAmount + line.deliveryCharge,
        gstRate: line.gstRate === "NA" ? "NA" : String(line.gstRate || 0) as GstRateInput,
        gstAmount: String(line.gstAmount),
        taxableAmount: String(line.taxableAmount),
        taxMode: line.taxMode === "NA" ? "NA" : ((line.taxMode || "Exclusive") as TaxModeInput)
      }))
    };
    setDraft(nextDraft);
    setInitialDraftState(salesOrderDraftSignature(nextDraft));
  }, [selectedGroup?.id]);

  useEffect(() => {
    onDirtyChange(draftDirty);
  }, [draftDirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);

  function updateSalesDraftLine(lineKey: string, updates: Partial<{ productSku: string; quantity: string; rate: string; gstRate: GstRateInput; taxMode: TaxModeInput }>) {
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
          const gstRate = updates.gstRate ?? line.gstRate ?? (product?.defaultGstRate === "NA" ? "NA" : String(product?.defaultGstRate || 0) as GstRateInput);
          const fallbackTaxMode = product?.defaultTaxMode === "NA" ? "NA" : (product?.defaultTaxMode || "Exclusive");
          const taxMode = gstRate === "NA" ? "NA" : (updates.taxMode ?? (line.taxMode === "NA" ? fallbackTaxMode : line.taxMode));
          const totals = calculateTaxPreview(String(Math.max(0, Number(quantity || 0)) * Math.max(0, Number(rate || 0))), gstRate, taxMode);
          return {
            ...line,
            productSku,
            quantity,
            rate,
            gstRate,
            taxMode,
            taxableAmount: totals.taxableAmount,
            gstAmount: totals.gstAmount,
            totalAmount: Number(totals.taxableAmount || 0) + Number(totals.gstAmount || 0)
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
    const gstRate = fallbackProduct.defaultGstRate === "NA" ? "NA" : String(fallbackProduct.defaultGstRate || 0) as GstRateInput;
    const taxMode = fallbackProduct.defaultTaxMode === "NA" ? "NA" : fallbackProduct.defaultTaxMode;
    const totals = calculateTaxPreview("0", gstRate, taxMode);
    setDraft((current) => current ? {
      ...current,
      lines: [...current.lines, {
        clientKey: `so-${Date.now()}-${Math.random()}`,
        productSku: fallbackProduct.sku,
        warehouseId: selectedGroup.lines[0]?.warehouseId || "",
        rate: "0",
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
        taxableAmount: Number(line.taxableAmount || 0),
        gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
        gstAmount: Number(line.gstAmount || 0),
        taxMode: line.gstRate === "NA" ? "NA" : line.taxMode
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
            taxableAmount: Number(line.taxableAmount || 0),
            gstRate: line.gstRate === "NA" ? "NA" : Number(line.gstRate || 0) as 0 | 5 | 12 | 18 | 40,
            gstAmount: Number(line.gstAmount || 0),
            taxMode: line.gstRate === "NA" ? "NA" : line.taxMode
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
            </div>
            {draft.lines.map((line, index) => <div className="compact-order-editor-row" key={line.clientKey || line.id || `${line.productSku}-${index}`}><div className="compact-order-editor-actions"><button className="ghost-button compact-icon-button" type="button" onClick={addSalesDraftLine} disabled={!editState.editable || snapshot.products.length === 0} aria-label="Add product">+</button><button className="ghost-button compact-icon-button" type="button" onClick={() => { onDirtyChange(true); setDraft((current) => current ? { ...current, lines: current.lines.filter((item) => item !== line) } : current); }} disabled={!editState.editable || draft.lines.length <= 1} aria-label="Remove product">-</button></div><div className="compact-order-editor-product">{!line.id ? <select value={line.productSku} onChange={(e) => updateSalesDraftLine(line.clientKey, { productSku: e.target.value })} disabled={!editState.editable || Boolean(line.id)}>{snapshot.products.map((product) => <option key={product.sku} value={product.sku}>{productDisplayLabel(product) || product.sku}</option>)}</select> : <strong>{productNameBySku(snapshot.products, line.productSku)}</strong>}</div><input type="number" step="any" min="0" value={line.quantity} onChange={(e) => updateSalesDraftLine(line.clientKey, { quantity: e.target.value })} disabled={!editState.editable} /><input type="number" step="any" min="0" value={line.rate} onChange={(e) => updateSalesDraftLine(line.clientKey, { rate: e.target.value })} disabled={!editState.editable} /></div>)}
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

function PurchaserPaymentsView({
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

function SalesPaymentsView({
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

function AccountsPaymentsView({
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

function WarehouseOperationsView({
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

function WarehouseOperationsViewV2({
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

function DeliveryJobsView({
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

function WarehouseDeliveryBoard({ snapshot }: { snapshot: AppSnapshot }) {
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

function DeliveryManagerHome({
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

function Overview({ snapshot, currentUser, simpleMode, onOpen, onOpenQrScanner, onDownloadSalesDsr, onUploadProof, onCreatePurchaseAdvance }: {
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

function AccountsOverviewLegacy({ snapshot, onOpen }: { snapshot: AppSnapshot; onOpen: (view: ViewKey) => void }) {
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

function AccountsLedgerView({ snapshot }: { snapshot: AppSnapshot }) {
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

function AccountsLedgerWorkspace({ snapshot }: { snapshot: AppSnapshot }) {
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

function AccountsOverview({
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

function BootLoader() {
  return (
    <main className="boot-loader-shell">
      <section className="boot-loader-card">
        <header className="boot-loader-header glass-surface">
          <div className="topbar-brand-block">
            <span className="small-label">Aapoorti B2B</span>
            <strong>Workspace Restore</strong>
          </div>
          <div className="topbar-logo-orb boot-topbar-logo">
            <img src={appLogo} alt="Aapoorti" className="topbar-logo-image" />
          </div>
          <div className="topbar-side-slot">
            <span className="boot-loader-chip">Syncing</span>
          </div>
        </header>
        <div className="boot-loader-mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div className="boot-loader-copy">
          <span className="eyebrow">Aapoorti B2B</span>
          <h1>Restoring workspace</h1>
          <p>Loading your module, live orders, parties, stock, and delivery state.</p>
        </div>
        <div className="boot-loader-track"><span /></div>
      </section>
    </main>
  );
}

function ReturnsWorkspace({
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

type ProductFormState = { sku: string; name: string; division: string; department: string; section: string; category: string; subCategory: string; unit: string; defaultGstRate: GstRateInput; defaultTaxMode: TaxModeInput; defaultWeightKg: string; toleranceKg: string; tolerancePercent: string; allowedWarehouseIds: string[] };
const nonBrandedStaplesWeightOptions = [
  { value: "1", label: "1KG" },
  { value: "5", label: "5KG" },
  { value: "10", label: "10KG" },
  { value: "25", label: "25KG" },
  { value: "30", label: "30KG" }
] as const;

function isStaplesNonBrandedCategory(category: string, subCategory: string) {
  return category.trim().toLowerCase() === "staples" && subCategory.trim().toLowerCase() === "non branded";
}

function AnalystPurchaseView({ snapshot, orders }: { snapshot: AppSnapshot; orders: PurchaseOrder[] }) {
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

function AnalystSalesView({ snapshot, orders }: { snapshot?: AppSnapshot; orders: SalesOrder[] }) {
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

function PartyVitalsList({ snapshot, parties, type }: { snapshot: AppSnapshot; parties: Counterparty[]; type: "Supplier" | "Shop" }) {
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

function AnalystInventoryView({ snapshot }: { snapshot: AppSnapshot }) {
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

function GoodsWarrantView({
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

function StandaloneExcelMaker() {
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

function ProductAdminView({
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
  const emptyForm: ProductFormState = { sku: "", name: "", division: "", department: "", section: "", category: "", subCategory: "", unit: "", defaultGstRate: "0", defaultTaxMode: "Exclusive", defaultWeightKg: "0", toleranceKg: "0", tolerancePercent: "1", allowedWarehouseIds: prioritizeWarehouseIds(snapshot.warehouses.map((warehouse) => warehouse.id)) };
  const [selectedSku, setSelectedSku] = useState("");
  const [skuSearch, setSkuSearch] = useState("");
  const filteredProductOptions = snapshot.products.filter((product) => `${product.sku} ${product.name} ${product.division} ${product.department} ${product.section}`.toLowerCase().includes(skuSearch.trim().toLowerCase()));
  const divisionOptions = uniqueProductFieldOptions(snapshot.products, "division");
  const departmentOptions = uniqueProductFieldOptions(snapshot.products, "department");
  const sectionOptions = uniqueProductFieldOptions(snapshot.products, "section");
  const categoryOptions = uniqueProductFieldOptions(snapshot.products, "category");
  const subCategoryOptions = uniqueProductFieldOptions(snapshot.products, "subCategory");
  const useStaplesWeightSelection = isStaplesNonBrandedCategory(productForm.category, productForm.subCategory);

  function toPayload(form: ProductFormState) {
    return {
      ...form,
      defaultGstRate: form.defaultGstRate,
      defaultTaxMode: form.defaultTaxMode,
      defaultWeightKg: Number(form.defaultWeightKg),
      toleranceKg: Number(form.toleranceKg),
      tolerancePercent: Number(form.tolerancePercent),
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
      division: product.division,
      department: product.department,
      section: product.section,
      category: product.category,
      subCategory: product.subCategory,
      unit: product.unit,
      defaultGstRate: product.defaultGstRate === "NA" ? "NA" : String(product.defaultGstRate) as GstRateInput,
      defaultTaxMode: product.defaultTaxMode,
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
          <label>Default GST<select value={productForm.defaultGstRate} onChange={(event) => updateProductForm((current) => ({ ...current, defaultGstRate: event.target.value as GstRateInput, defaultTaxMode: event.target.value === "NA" ? "NA" : (current.defaultTaxMode === "NA" ? "Exclusive" : current.defaultTaxMode) }))}><option value="NA">NA</option><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option><option value="40">40%</option></select></label>
          <label>Default Tax<select value={productForm.defaultTaxMode} onChange={(event) => updateProductForm((current) => ({ ...current, defaultTaxMode: event.target.value as TaxModeInput }))} disabled={productForm.defaultGstRate === "NA"}><option value="Exclusive">GST Extra</option><option value="Inclusive">GST Included</option><option value="NA">Final Amount</option></select></label>
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
        <Panel title="Products" eyebrow="Division > Department > Section"><DataTable headers={["SKU","Name","Division","Department","Section","Category","Subcategory","Default GST","Per item/bundle weight"]} rows={snapshot.products.map((product) => [product.sku, productDisplayLabel(product), product.division, product.department, product.section, product.category, product.subCategory, product.defaultGstRate === "NA" ? "NA / Final" : `${product.defaultGstRate}% / ${product.defaultTaxMode}`, product.defaultWeightKg])} /></Panel>
      </>}
    />
  );
}

function renderOptions(items: Counterparty[]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderWarehouseOptions(items: AppSnapshot["warehouses"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)]; }
function renderProductOptions(items: AppSnapshot["products"]) { return [<option key="blank" value="">Select</option>, ...items.map((item) => <option key={item.sku} value={item.sku}>{`${item.sku} - ${productDisplayLabel(item)} (${item.division} > ${item.department} > ${item.section})`}</option>)]; }
function uniqueProductFieldOptions(items: AppSnapshot["products"], field: "division" | "department" | "section" | "category" | "subCategory") { return Array.from(new Set(items.map((item) => item[field].trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right)); }
function parseCsvRows(csv: string) { const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean); const headers = header.split(",").map((item) => item.trim()); return lines.map((line) => { const cols = line.split(",").map((item) => item.trim()); const row = Object.fromEntries(headers.map((key, index) => [key, cols[index] || ""])); return { ...row, subCategory: row.subCategory || "", defaultGstRate: (row.defaultGstRate || "0") as GstRateInput, defaultTaxMode: (row.defaultTaxMode || ((row.defaultGstRate || "0") === "NA" ? "NA" : "Exclusive")) as TaxModeInput, defaultWeightKg: Number(row.defaultWeightKg || 0), toleranceKg: Number(row.toleranceKg || 0), tolerancePercent: Number(row.tolerancePercent || 1), allowedWarehouseIds: String(row.allowedWarehouseIds || "").split("|").filter(Boolean), rsp: Number(row.rsp || 0) }; }); }

function productCategoryLabel(product: AppSnapshot["products"][number]) {
  return product.division?.trim() || product.department?.trim() || product.section?.trim() || "All Products";
}

export default App;


