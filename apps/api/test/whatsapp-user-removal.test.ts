import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("whatsapp-integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const node = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "removeWhatsAppStaffUser")!;
const code = ts.transpileModule(node.getText(source).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const admin = { id: 1, username: "admin", roles: ["Admin"], role: "Admin" };
const staff = { id: 2, username: "warehouse", roles: ["Warehouse Manager"], role: "Warehouse Manager", mobileNumber: "919999999999" };
function fixture(target: unknown = staff) {
  const queries: string[] = [];
  const maps = Object.fromEntries(["staffProofs", "deliveryProofPending", "cashCollectionPending", "paymentProofPending", "packingPhotoPending", "packingWeightResults", "packingPhotoProofs", "packingManualWeightPending", "packingChangePending", "dcoBuildSessions", "dcoHandoverSelections", "receiptSessions", "collectionConfirmations"].map((name) => [name, new Map([[staff.mobileNumber, "pending"]])]));
  const dependencies = {
    ...maps,
    isWhatsAppAdminUser: (user: typeof admin) => user.roles.includes("Admin") || user.username === "wa.sales",
    executeDatabaseQuery: async (sql: string) => { queries.push(sql); return { rows: target ? [target] : [] }; },
    normalizeWhatsAppPhone: (phone: string) => phone,
    getSnapshot: async () => ({ users: [] })
  };
  return { remove: new Function(...Object.keys(dependencies), `${code}; return removeWhatsAppStaffUser;`)(...Object.values(dependencies)), queries, maps };
}
test("user removal rejects non-admin, self and protected accounts before mutation", async () => {
  for (const [target, id, actor] of [[staff, 2, staff], [admin, 1, admin], [{...admin,id:2}, 2, admin], [{...staff,username:"wa.sales"},2,admin]] as const) {
    const f = fixture(target);
    await assert.rejects(f.remove(id, actor));
    assert.ok(f.queries.every((sql) => sql.startsWith("SELECT")));
  }
});
test("staff removal revokes sessions and frees phone while keeping order history", async () => {
  const f = fixture();
  await f.remove(2, admin);
  assert.match(f.queries[1], /active=FALSE,mobile_number=''/);
  assert.match(f.queries[1], /DELETE FROM sessions/);
  assert.doesNotMatch(f.queries[1], /DELETE FROM (users|sales_orders|payments|ledger_entries)/);
  assert.ok(Object.values(f.maps).every((map) => map.size === 0));
});
test("missing user fails without changing data", async () => {
  const f = fixture(null);
  await assert.rejects(f.remove(99, admin), /not found/);
  assert.equal(f.queries.length, 1);
});
