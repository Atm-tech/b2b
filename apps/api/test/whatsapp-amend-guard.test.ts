import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("db.ts", readFileSync(new URL("../src/db.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "updateSalesOrderGroup")!;
const code = ts.transpileModule(declaration.getText(source).replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const accessDeclaration = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "assertSalesOrderEditable")!;
const accessCode = ts.transpileModule(accessDeclaration.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

test("warehouse can amend another salesperson's unpacked order only within warehouse scope", async () => {
  const deps = {
    query: async (sql: string) => ({ rows: sql.includes('FROM sales_orders') ? [{id:'SO-1',cart_id:'CART-1',salesman_id:99,warehouse_id:'WH-1',status:'Booked'}] : [] }),
    stringValue: String, numberValue: Number,
    currentUserHasRole: (user:any,role:string) => user.roles.includes(role)
  };
  const access = new Function(...Object.keys(deps), `${accessCode};return assertSalesOrderEditable;`)(...Object.values(deps));
  const warehouse = {id:5,roles:['Warehouse Manager'],warehouseIds:['WH-1']};
  assert.equal((await access('CART-1',warehouse,undefined,true)).lines.length,1);
  await assert.rejects(() => access('CART-1',warehouse), /Only the salesman or admin/);
  await assert.rejects(() => access('CART-1',{...warehouse,warehouseIds:['WH-2']},undefined,true), /assigned warehouse/);
  await assert.rejects(() => access('CART-1',{...warehouse,roles:['Sales']},undefined,true), /assigned warehouse/);
});

test("transaction rejects packed, stale and missing orders before changing quantities", async () => {
  for (const scenario of ["docket", "status", "stale", "missing"]) {
    let mutations = 0;
    const deps = {
      ready: Promise.resolve(),
      assertSalesOrderEditable: async () => ({ lines: [{ id: "SO-1", quantity: 10 }] }),
      stringValue: String, numberValue: Number, mapSettings: async () => ({}),
      withTransaction: async (fn: any) => fn({}),
      query: async (sql: string) => {
        if (/^(UPDATE|DELETE|INSERT)/i.test(sql)) mutations++;
        assert.match(sql, /SELECT.*FOR UPDATE/);
        return { rows: scenario === "missing" ? [] : [{ id: "SO-1", quantity: scenario === "stale" ? 9 : 10, status: scenario === "status" ? "Ready for Dispatch" : "Booked" }] };
      },
      one: async () => scenario === "docket" ? { id: "DCK-1" } : undefined,
      assertNoPackingHold: async () => {},
      getSnapshot: async () => ({})
    };
    const update = new Function(...Object.keys(deps), `${code};return updateSalesOrderGroup;`)(...Object.values(deps));
    await assert.rejects(update("CART-1", { beforePacking: [{ id: "SO-1", quantity: 10 }], lines: [{ id: "SO-1", quantity: 8 }] }, {}), /only before Packed|SO changed/);
    assert.equal(mutations, 0, scenario);
  }
});
