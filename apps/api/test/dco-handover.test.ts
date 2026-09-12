import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Exercise the actual database functions with a recording client, without
// importing db.ts's production pool, startup migrations or seeded records.
const source = ts.createSourceFile("db.ts", readFileSync(new URL("../src/db.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
function loadFunction(name: string, dependencies: Record<string, unknown>) {
  const node = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name)!;
  const code = ts.transpileModule(node.getText(source).replace(/^export /, ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(dependencies), `${code}; return ${name};`)(...Object.values(dependencies));
}

function consignmentHarness(alreadyBundled = false) {
  const writes: Array<{ sql: string; params: any[] }> = [];
  const dockets = [1, 2].map((n) => ({ id: `D${n}`, warehouse_id: "W1", sales_order_id: `S${n}`, weight_kg: n, status: alreadyBundled ? "Tagged" : "Ready", consignment_id: alreadyBundled ? "OLD" : null }));
  const query = async (sql: string, params: any[] = []) => {
    if (/^(INSERT|UPDATE)/.test(sql.trim())) { writes.push({ sql, params }); return { rows: [] }; }
    if (sql.includes("FROM delivery_dockets") && !sql.includes("JOIN")) return { rows: dockets };
    if (sql.includes("SELECT DISTINCT so.delivery_mode")) return { rows: [{ delivery_mode: "Delivery", status: "Booked" }] };
    if (sql.includes("SELECT so.*")) return { rows: [1, 2].map((n) => ({ id: `S${n}`, cart_id: `C${n}`, shop_id: `SHOP${n}`, shop_name: `Shop ${n}`, product_sku: `P${n}`, quantity: n, warehouse_id: "W1", payment_mode: "Cash", cash_timing: "At Delivery" })) };
    if (sql.includes("FROM ledger_entries")) return { rows: [1, 2].map((n) => ({ linked_order_id: `C${n}`, pending_amount: n * 100 })) };
    throw new Error(`Unexpected query: ${sql}`);
  };
  let sequence = 0;
  const create = loadFunction("createDeliveryConsignment", { ready: Promise.resolve(), query, withTransaction: (work: Function) => work({}), normalizeDeliveryAssignee: async (name: string) => name, stringValue: (value: unknown) => String(value ?? ""), numberValue: (value: unknown) => Number(value || 0), makeId: (prefix: string) => `${prefix}-${++sequence}`, operationalDate: () => "2026-09-12", getSnapshot: async () => ({}) });
  return { create, writes };
}

test("multi-SO DCO creation makes an unassigned planned task with both retailer collection stops", async () => {
  const { create, writes } = consignmentHarness();
  await create({ docketIds: ["D1", "D2"], warehouseId: "W1", assignedTo: "" }, { fullName: "Warehouse" });
  const consignment = writes.find(({ sql }) => sql.includes("INSERT INTO delivery_consignments"))!;
  assert.deepEqual(JSON.parse(consignment.params[1]), ["D1", "D2"]);
  assert.equal(consignment.params[3], "");
  assert.equal(consignment.params[5], "Ready");
  const task = writes.find(({ sql }) => sql.includes("INSERT INTO delivery_tasks"))!;
  assert.match(task.sql, /'Planned'/);
  assert.equal(task.params[6], "");
  assert.deepEqual(JSON.parse(task.params[2]), ["C1", "C2"]);
  assert.deepEqual(JSON.parse(task.params[8]).map((stop: any) => [stop.supplierName, stop.amountToPay, stop.collectionStatus]), [["Shop 1", 100, "Pending"], ["Shop 2", 200, "Pending"]]);
  assert.match(writes.find(({ sql }) => sql.includes("UPDATE sales_orders"))!.sql, /Pending Pickup/);
  assert.equal(writes.some(({ sql }) => /inventory_lots|stock_movements|INSERT INTO payments/.test(sql)), false);
});

test("existing assigned DCO creation still creates a pending pickup task", async () => {
  const { create, writes } = consignmentHarness();
  await create({ docketIds: ["D1", "D2"], warehouseId: "W1", assignedTo: "driver" }, { fullName: "Warehouse" });
  assert.equal(writes.find(({ sql }) => sql.includes("INSERT INTO delivery_tasks"))?.params[6], "driver");
  assert.ok(writes.some(({ sql }) => sql.includes("UPDATE sales_orders")));
});

test("already bundled SOs cannot be assigned to a second DCO", async () => {
  const { create, writes } = consignmentHarness(true);
  await assert.rejects(create({ docketIds: ["D1", "D2"], warehouseId: "W1", assignedTo: "" }, { fullName: "Warehouse" }), /already bundled/);
  assert.deepEqual(writes, []);
});

test("handover rejects a repeated Send or deactivated agent before changing stock or tasks", async () => {
  for (const status of ["Handed Over", "Planned"]) {
    const update = loadFunction("updateDeliveryTask", { ready: Promise.resolve(), withTransaction: (work: Function) => work({}), one: async (sql: string) => sql.includes("FROM delivery_tasks") ? { status } : null });
    await assert.rejects(update("TASK1", { assignedTo: "inactive", expectedStatus: "Planned", status: "Handed Over" }), status === "Planned" ? /active Delivery/ : /status changed/);
  }
});
