import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import { allowedGuideSlugs, guideModules, userRoles, type AppUser } from "@aapoorti-b2b/domain";
import { createGuideRouter } from "../src/guide-routes.js";
import { trainingGuides } from "../src/guide-content.js";

test("every registered role has complete narrated training and a valid activity", () => {
  assert.deepEqual(new Set(trainingGuides.map(g => g.slug)), new Set(guideModules.map(g => g.slug)));
  for (const role of userRoles) assert.ok(allowedGuideSlugs([role]).length, role);
  for (const guide of trainingGuides) for (const step of guide.steps) {
    assert.ok(step.narration.length > 40, `${guide.slug}: narration`);
    assert.ok(step.body && step.success && step.screen && step.example);
    if (step.input) assert.ok(step.input.expected);
    else assert.ok(step.choices?.[step.answer!], `${guide.slug}: valid answer`);
  }
});

test("HTTP access: public retailer, role isolation, both admins, expired login and recipient scope", async () => {
  const users = new Map<string, AppUser>();
  for (const [index, role] of userRoles.entries()) users.set(role, { id: index + 1, username: role, fullName: role, role, roles: [role], mobileNumber: "", warehouseIds: [], active: true, createdAt: "" });
  users.set("wa-admin", { ...users.get("Sales")!, username: "wa.sales" });
  users.set("delivery-collection", { ...users.get("Out Delivery")!, roles: ["Out Delivery", "Collection Agent"] });
  const queries: unknown[][] = [];
  const query = (async (_sql: string, parameters: unknown[] = []) => { queries.push(parameters); return { rows: [], rowCount: 0 }; }) as Parameters<typeof createGuideRouter>[0]["query"];
  const app = express();
  app.use("/guides", createGuideRouter({ isAdmin: u => u.roles.includes("Admin") || u.username === "wa.sales", getUserByToken: async token => users.get(token) || null, query }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address(); assert.ok(address && typeof address !== "string");
  const get = (path: string, token?: string) => fetch(`http://127.0.0.1:${address.port}/guides/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  try {
    const publicGuide = await get("retailer"); assert.equal(publicGuide.status, 200); assert.equal((await publicGuide.json()).guide.slug, "retailer");
    assert.equal((await get("retailer", "expired")).status, 200);
    assert.equal((await get("purchaser")).status, 401);
    assert.equal((await get("purchaser", "expired")).status, 401);
    for (const [token, user] of users) for (const guide of guideModules) {
      const permitted = guide.slug === "retailer" || allowedGuideSlugs(user.roles, token === "wa-admin").includes(guide.slug);
      const response = await get(guide.slug, token);
      assert.equal(response.status, permitted ? 200 : 403, `${token} -> ${guide.slug}`);
      const body = await response.json();
      assert.equal(Boolean(body.guide), permitted, "denied responses must not contain training content");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
    assert.equal((await get("sell", "Sales")).status, 200);
    assert.equal((await get("delivery%2Bcollection", "delivery-collection")).status, 200);
    assert.equal((await get("delivery%2Bcollection", "Delivery")).status, 403);
    assert.equal((await get("does-not-exist")).status, 404);
    assert.equal((await get("recipients", "Purchaser")).status, 403);
    assert.equal((await get("recipients", "Sales")).status, 200);
    assert.deepEqual(queries.at(-1), [false, users.get("Sales")!.id]);
    assert.equal((await get("recipients", "wa-admin")).status, 200);
    const catalogue = await (await get("catalog", "wa-admin")).json();
    assert.equal(catalogue.guides.length, guideModules.length);
    assert.equal(catalogue.canShare, true);
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});
