import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Run the real inbound router with isolated dependencies; never connect to
// production or send a real WhatsApp message from a regression test.
const source = ts.createSourceFile("whatsapp-integration.ts", readFileSync(new URL("../src/whatsapp-integration.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const node = source.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "handleInboundMessage")!;
const code = ts.transpileModule(node.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;

for (const kind of ["audio", "video", "text"]) {
  test(`registered staff ${kind} never starts retailer registration when staff handler declines`, async () => {
    const replies: string[] = [];
    const dependencies = {
      text: (value: unknown) => String(value ?? ""), normalizeWhatsAppPhone: (value: string) => value,
      recordMessage: async () => "saved", trainingLinkReply: () => null,
      executeDatabaseQuery: async () => ({ rows: [{ id: 1, username: "driver", role: "Delivery", roles: ["Delivery"] }] }),
      sendFirstStaffTraining: async () => {}, handleStaffWhatsAppMessage: async () => false,
      sendText: async (_phone: string, body: string) => { replies.push(body); },
      getRetailerByPhone: async () => { throw new Error("Staff fell through to retailer route"); }
    };
    const route = new Function(...Object.keys(dependencies), `${code}; return handleInboundMessage;`)(...Object.values(dependencies));
    await route({ from: "919999999999", id: "message", type: kind, text: { body: "LIST" } });
    assert.equal(replies.length, 1);
    assert.match(replies[0], kind === "audio" ? /LIST/ : /HELP/);
    assert.doesNotMatch(replies[0], /registration/);
  });
}

test("shared staff numbers stop at mapping help instead of retailer registration", async () => {
  let response = "";
  const dependencies = {
    text: (value: unknown) => String(value ?? ""), normalizeWhatsAppPhone: (value: string) => value,
    recordMessage: async () => "saved", trainingLinkReply: () => null,
    executeDatabaseQuery: async () => ({ rows: [{ id: 1 }, { id: 2 }] }),
    sendText: async (_phone: string, body: string) => { response = body; },
    getRetailerByPhone: async () => { throw new Error("Shared staff number fell through"); }
  };
  const route = new Function(...Object.keys(dependencies), `${code}; return handleInboundMessage;`)(...Object.values(dependencies));
  await route({ from: "919999999999", id: "message", type: "text", text: { body: "LIST" } });
  assert.match(response, /multiple staff/);
});
