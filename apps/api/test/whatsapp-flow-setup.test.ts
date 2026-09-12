import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.createSourceFile("whatsapp-integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const node = source.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === "ensureWhatsAppFlowsWebhook")!;
const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function setup(fields: string[], active = true) {
  const posts: URLSearchParams[] = [];
  const deps = {
    process: { env: { WHATSAPP_ACCESS_TOKEN: "test", WHATSAPP_APP_SECRET: "test", WHATSAPP_VERIFY_TOKEN: "test" } },
    text: (value: unknown) => String(value || ""), graphBase: "https://example.invalid",
    console: { log: () => {} },
    fetch: async (url: string, options: { method?: string; body?: URLSearchParams }) => {
      if (options.method === "POST") { posts.push(options.body!); return { ok: true, json: async () => ({ success: true }) }; }
      return { ok: true, json: async () => url.includes("debug_token") ? { data: { app_id: "APP" } } : { data: [{ object: "whatsapp_business_account", callback_url: "https://example.invalid/existing-webhook", active, fields: fields.map((name) => ({ name })) }] } };
    }
  };
  return { run: new Function(...Object.keys(deps), `${code};return ensureWhatsAppFlowsWebhook;`)(...Object.values(deps)), posts };
}
test("Flows subscription preserves existing fields and callback", async () => {
  const { run, posts } = setup(["messages", "account_alerts", "security"]);
  await run();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].get("fields"), "messages,account_alerts,security,flows");
  assert.equal(posts[0].get("callback_url"), "https://example.invalid/existing-webhook");
});
test("configured Flows subscription is idempotent; missing active callback is not overwritten", async () => {
  const configured = setup(["messages", "flows"]); await configured.run(); assert.equal(configured.posts.length, 0);
  const inactive = setup(["messages"], false); await assert.rejects(inactive.run(), /refusing to replace/); assert.equal(inactive.posts.length, 0);
});
