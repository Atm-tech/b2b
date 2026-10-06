import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("db.ts", readFileSync(new URL("../src/db.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === "updateSalesOrderGroup")!;
const code = ts.transpileModule(declaration.getText(source).replace("export async", "async"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

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
