import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import axios, { AxiosError } from "axios";

function compile(path, replacements = {}) {
  let code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  for (const name of ["react", "react-dom", "react/jsx-runtime"]) code = code.replaceAll(`from "${name}"`, `from "${import.meta.resolve(name)}"`);
  for (const [name, url] of Object.entries(replacements)) code = code.replaceAll(`from "${name}"`, `from "${url}"`);
  return `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
}

test("shared notifications validate fields, survive portals and handle API outcomes", async (t) => {
  const dom = new JSDOM('<div id="root"></div><form id="order"><label>Quantity<input name="quantity" required type="number" min="1"></label><label>Rate<input name="rate" type="number"></label><button type="button">Save</button></form>', { url: "http://localhost/" });
  for (const key of ["window", "document", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "HTMLTextAreaElement", "Node", "CustomEvent"]) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.getClientRects = () => [{ width: 100, height: 30 }];
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  const feedbackUrl = compile("../src/app/feedback.ts");
  const feedback = await import(feedbackUrl);
  const { FeedbackToasts } = await import(compile("../src/components/FeedbackToasts.tsx", { "../app/feedback": feedbackUrl }));
  const root = createRoot(document.getElementById("root"));
  await act(async () => root.render(createElement(FeedbackToasts)));
  const form = document.getElementById("order");
  const qty = form.querySelector('[name="quantity"]');
  const rate = form.querySelector('[name="rate"]');
  const button = form.querySelector("button");
  const click = () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  const clear = () => { document.querySelectorAll(".feedback-toast-close").forEach((item) => item.click()); };

  await t.test("manual errors are visible and highlight the relevant input only", async () => {
    await act(async () => { click(); feedback.notify("Enter quantity", "error"); });
    assert.equal(qty.getAttribute("aria-invalid"), "true");
    assert.equal(rate.hasAttribute("aria-invalid"), false);
    assert.match(document.querySelector('[role="alert"]').textContent, /Enter quantity/);
    await act(async () => document.querySelector(".feedback-show-field").click());
    assert.equal(document.activeElement, qty);
  });
  await t.test("editing clears the field highlight", async () => {
    await act(async () => { qty.value = "3"; qty.dispatchEvent(new dom.window.Event("input", { bubbles: true })); clear(); });
    assert.equal(qty.hasAttribute("aria-invalid"), false);
    assert.equal(qty.hasAttribute("data-validation-error"), false);
  });
  await t.test("native required validation produces a toast and field error", async () => {
    await act(async () => { qty.value = ""; assert.equal(form.checkValidity(), false); });
    assert.equal(qty.getAttribute("aria-invalid"), "true");
    assert(document.querySelector('[role="alert"]'));
    await act(async () => { qty.value = "3"; qty.dispatchEvent(new dom.window.Event("input", { bubbles: true })); clear(); });
  });
  await t.test("server errors use the original form and deduplicate repeated reports", async () => {
    const api = axios.create({ adapter: async (config) => { throw new AxiosError("Bad request", "ERR_BAD_REQUEST", config, null, { data: { message: "Quantity exceeds stock" }, status: 400, config }); } });
    feedback.installApiFeedback(api);
    await act(async () => { click(); await api.patch("/sales-orders/1", {}).catch(() => {}); feedback.notify("Quantity exceeds stock", "error"); });
    assert.equal(document.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(qty.getAttribute("aria-invalid"), "true");
    await act(async () => { qty.dispatchEvent(new dom.window.Event("input", { bubbles: true })); clear(); });
  });
  await t.test("structured field names highlight even when the message omits the field", async () => {
    await act(async () => { click(); feedback.notify("Value is outside the allowed range", "error", { fields: ["rate"] }); });
    assert.equal(rate.getAttribute("aria-invalid"), "true");
    assert.equal(qty.hasAttribute("aria-invalid"), false);
    await act(async () => { rate.dispatchEvent(new dom.window.Event("input", { bubbles: true })); clear(); });
  });
  await t.test("network errors identify the action, without blaming an unrelated input", async () => {
    await act(async () => { click(); feedback.notify("Network unavailable", "error"); });
    assert.equal(qty.hasAttribute("aria-invalid"), false);
    assert.equal(rate.hasAttribute("aria-invalid"), false);
    assert.equal(button.dataset.validationError, "Network unavailable");
    await act(async () => { qty.dispatchEvent(new dom.window.Event("input", { bubbles: true })); clear(); });
  });
  await t.test("successful mutations have a toast, replaced by the specific success text", async () => {
    const api = axios.create({ adapter: async (config) => ({ status: 200, data: {}, config, headers: {}, statusText: "OK" }) });
    feedback.installApiFeedback(api);
    await act(async () => { click(); await api.patch("/sales-orders/1", {}); feedback.notify("Sales order updated.", "success"); });
    assert.equal(document.querySelectorAll('[role="status"]').length, 1);
    assert.match(document.querySelector('[role="status"]').textContent, /Sales order updated/);
    await act(async () => clear());
  });
  await t.test("dialog errors stay in their own form; toasts render outside it", async () => {
    const modal = document.createElement("div");
    modal.className = "cart-sheet";
    modal.innerHTML = '<label>Rate<input name="rate"></label><button type="button">Continue</button>';
    document.body.append(modal);
    await act(async () => { modal.querySelector("button").click(); feedback.notify("Enter rate", "error"); });
    assert.equal(modal.querySelector("input").getAttribute("aria-invalid"), "true");
    assert.equal(rate.hasAttribute("aria-invalid"), false);
    assert.equal(document.querySelector(".feedback-toasts").parentElement, document.body);
    await act(async () => { clear(); modal.remove(); });
  });
  await t.test("SKU errors highlight only the named order line", async () => {
    form.insertAdjacentHTML("afterbegin", '<div class="compact-order-editor-row" data-product-sku="SKU-ONE"><input aria-label="Quantity"></div><div class="compact-order-editor-row" data-product-sku="SKU-TWO"><input aria-label="Quantity"></div>');
    await act(async () => { click(); feedback.notify("Quantity exceeds stock for SKU-TWO", "error"); });
    assert.equal(form.querySelector('[data-product-sku="SKU-ONE"] input').hasAttribute("aria-invalid"), false);
    assert.equal(form.querySelector('[data-product-sku="SKU-TWO"] input').getAttribute("aria-invalid"), "true");
    await act(async () => clear());
  });
  await t.test("local feedback state announces repeated errors without requiring a page change", async () => {
    let report;
    function LocalForm() {
      const [, setError] = feedback.useFeedbackState("error");
      report = setError;
      return null;
    }
    await act(async () => root.render(createElement("div", null, createElement(FeedbackToasts), createElement(LocalForm))));
    await act(async () => report("Please retry this action"));
    const first = document.querySelector('[role="alert"]');
    assert(first);
    await act(async () => document.querySelector(".feedback-toast-close").click());
    assert.equal(document.querySelector('[role="alert"]'), null);
    await act(async () => report("Please retry this action"));
    assert(document.querySelector('[role="alert"]'));
  });
  await act(async () => root.unmount());
  dom.window.close();
});
