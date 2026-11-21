import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import ts from "typescript";

// Compile the real report and its pure dependencies, without booting the app.
const source = readFileSync(new URL("../src/app/shared.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("shared.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["buildStatusWorkbook", "drawCancelledPdfWatermark", "buildDailySalesReportPdf", "indiaDateKey", "groupSalesOrders", "orderPublicId", "salesOrderPublicTotal", "salesPaymentStatus", "dailySalesCollectorLabel", "formatMoney", "formatShortDate"]);
const functions = ast.statements.filter((node) => ts.isFunctionDeclaration(node) && names.has(node.name?.text)).map((node) => node.getText(ast)).join("\n");
const code = ts.transpileModule(functions, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace('import("jspdf")', `import(${JSON.stringify(import.meta.resolve("jspdf"))})`);
const { buildDailySalesReportPdf, buildStatusWorkbook } = await import(`data:text/javascript;base64,${Buffer.from(code.replace('import("xlsx")', `import(${JSON.stringify(import.meta.resolve("xlsx"))})`)).toString("base64")}`);

test("daily PDF distinguishes cancellations from active sales and shows original cancelled values", async () => {
  const createdAt = new Date().toISOString();
  const line = { quantity: 2, rate: 100, deliveryCharge: 0, createdAt, paymentMode: "Cash", cashTiming: "At Delivery", salesmanName: "Test salesperson", shopName: "A customer with a long shop name to check amount spacing", productSku: "Sample product" };
  const salesOrders = [
    { ...line, id: "cancel-1", cartId: "SCART-CANCELLED", totalAmount: 4050, status: "Cancelled" },
    { ...line, id: "cancel-2", cartId: "SCART-CANCELLED", totalAmount: 3175, status: "Cancelled" },
    { ...line, id: "booked-1", cartId: "SCART-ACTIVE", totalAmount: 200, status: "Booked" },
  ];
  // Cancelled legacy orders may lack a ledger row: that must not resurrect sales.
  const snapshot = { salesOrders, payments: [], ledgerEntries: [{ side: "Sales", linkedOrderId: "SCART-ACTIVE", goodsValue: 200, paidAmount: 0, pendingAmount: 200 }] };
  const blob = await buildDailySalesReportPdf(snapshot, salesOrders);
  const pdf = Buffer.from(await blob.arrayBuffer());
  const text = pdf.toString("latin1");
  assert.match(text, /Active SOs: 1 \| Cancelled: 1/);
  assert.match(text, /Cancelled \| Original order value 7,225\.00/);
  assert.match(text, /Status: Cancelled/);
  assert(text.includes(String.raw`At Delivery \(1\)`));
  assert.match(text, /Total 200\.00 \| Paid 0\.00 \| Pending 200\.00/);
  assert.doesNotMatch(text, /Total 0\.00 \| Paid 0\.00 \| Pending 0\.00/);
  assert.doesNotMatch(text, /7,425\.00/);
  if (process.env.DAILY_REPORT_PREVIEW) writeFileSync(process.env.DAILY_REPORT_PREVIEW, pdf);
});


test("status workbook puts each record in exactly one correctly named sheet", async () => {
  const XLSX = await import("xlsx");
  const headers = ["SO Number", "Order Status", "Total"];
  const rows = [["SO1", "Booked", 250], ["SO2", "Cancelled", 120], ["SO3", "Booked", 50]];
  const workbook = await buildStatusWorkbook(headers, rows);
  assert.deepEqual(workbook.SheetNames, ["Booked", "Cancelled"]);
  const restored = XLSX.read(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }), { type: "buffer" });
  assert.deepEqual(XLSX.utils.sheet_to_json(restored.Sheets.Booked, { header: 1 }), [headers, rows[0], rows[2]]);
  assert.deepEqual(XLSX.utils.sheet_to_json(restored.Sheets.Cancelled, { header: 1 }), [headers, rows[1]]);
  const empty = await buildStatusWorkbook(headers, []);
  assert.deepEqual(empty.SheetNames, ["No records"]);
  const sanitized = await buildStatusWorkbook(["Status"], [["A/B"], ["A:B"]]);
  assert.equal(new Set(sanitized.SheetNames).size, 2);
  assert(sanitized.SheetNames.every((name) => name.length <= 31));
});
