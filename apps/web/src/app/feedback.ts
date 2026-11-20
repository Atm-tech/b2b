import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AxiosInstance } from "axios";

export type FeedbackKind = "success" | "error" | "info";
export type Feedback = { id: number; kind: FeedbackKind; message: string; target?: HTMLElement; generic?: boolean };
type Scope = { root: HTMLElement; trigger: HTMLElement; at: number };
const eventName = "aapoorti:feedback";
let sequence = 0;
let action: Scope | undefined;
const controls = "input:not([type=hidden]),select,textarea";
const aliases: Record<string, string[]> = {
  quantity: ["qty", "quantity", "stock", "available", "shortage"],
  rate: ["rate", "price"], mrp: ["mrp"],
  cdTodRate: ["cd/tod", "net rate", "discount"],
  gstNumber: ["gstin", "gst number", "gst"],
  warehouseId: ["warehouse", "dispatch"],
  shopId: ["customer", "shop"], supplierId: ["supplier", "vendor"],
  paymentMode: ["payment method", "payment mode"], cashTiming: ["cash timing"],
  deliveryMode: ["delivery mode"], amount: ["amount"],
  mobileNumber: ["mobile", "phone"], bankAccountNumber: ["bank account"],
  ifscCode: ["ifsc"], utrNumber: ["utr"], proof: ["proof", "photo", "upload"],
  username: ["username"], password: ["password", "credentials"],
  note: ["note", "reason"], name: ["name"],
};
const normalize = (text: string) => text.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();
const contains = (text: string, phrase: string) => (` ${normalize(text)} `).includes(` ${normalize(phrase)} `);

export function feedbackScope(): Scope | undefined {
  return action?.root.isConnected && Date.now() - action.at < 2000 ? action : undefined;
}

function fieldNames(element: Element): string[] {
  const input = element as HTMLInputElement;
  const label = Array.from(input.labels || []).map((item) => {
    const copy = item.cloneNode(true) as HTMLElement;
    copy.querySelectorAll("input,select,textarea,button,small").forEach((control) => control.remove());
    return copy.textContent?.trim() || "";
  }).join(" ");
  return [input.name, input.id, input.getAttribute("aria-label") || "", input.placeholder, label, input.closest("[data-error-key]")?.getAttribute("data-error-key") || ""].filter(Boolean);
}

export function highlightFeedback(message: string, scope = feedbackScope(), fields: string[] = []): HTMLElement | undefined {
  if (!scope?.root.isConnected) return undefined;
  const candidates = Array.from(scope.root.querySelectorAll<HTMLElement>(controls)).filter((element) => element.getClientRects().length && !(element as HTMLInputElement).disabled);
  const keys = fields.map((field) => field.replace(/.*\./, ""));
  const matchingKeys = Object.entries(aliases).filter(([key, phrases]) => keys.includes(key) || phrases.some((phrase) => contains(message, phrase)));
  let matches = candidates.filter((element) => {
    const names = fieldNames(element);
    return keys.some((key) => names.some((name) => normalize(name) === normalize(key)))
      || names.some((name) => normalize(name).length > 2 && contains(message, name))
      || matchingKeys.some(([key, phrases]) => names.some((name) => normalize(name) === normalize(key) || phrases.some((phrase) => contains(name, phrase))));
  });
  // Constrain product errors to the named row, when the server supplies a SKU.
  const rows = Array.from(scope.root.querySelectorAll<HTMLElement>(".compact-order-editor-row,.cart-product-line,tr,[data-product-sku]"));
  const namedRows = rows.filter((row) => {
    const sku = row.dataset.productSku || row.querySelector("strong")?.textContent?.trim();
    return sku && sku.length > 3 && message.toLowerCase().includes(sku.toLowerCase());
  });
  if (namedRows.length) matches = matches.filter((element) => namedRows.some((row) => row.contains(element)));
  if (!matches.length) {
    // Network/permission errors cannot truthfully be assigned to a particular input.
    scope.trigger.dataset.validationError = message;
    return scope.trigger;
  }
  for (const element of matches) {
    element.dataset.validationError = message;
    if (!element.hasAttribute("data-feedback-previous-invalid")) element.dataset.feedbackPreviousInvalid = element.getAttribute("aria-invalid") ?? "";
    element.setAttribute("aria-invalid", "true");
    element.setAttribute("aria-errormessage", "feedback-errors");
  }
  matches[0].scrollIntoView({ block: "nearest", behavior: "smooth" });
  return matches[0];
}

export function notify(message: string, kind: FeedbackKind = "info", options: { scope?: Scope; fields?: string[]; generic?: boolean } = {}) {
  if (!message.trim() || typeof window === "undefined") return;
  const target = kind === "error" ? highlightFeedback(message, options.scope, options.fields) : undefined;
  window.dispatchEvent(new CustomEvent<Feedback>(eventName, { detail: { id: ++sequence, message, kind, target, generic: options.generic } }));
}

// Keep existing inline validation where useful, and also announce it above every modal.
export function useFeedbackState(kind: FeedbackKind): [string, Dispatch<SetStateAction<string>>] {
  const [state, setState] = useState({ value: "", revision: 0, scope: undefined as Scope | undefined });
  const setValue: Dispatch<SetStateAction<string>> = useCallback((value) => {
    const scope = feedbackScope();
    setState((current) => {
      const next = typeof value === "function" ? value(current.value) : value;
      if (typeof value === "function" && next === current.value) return current;
      return { value: next, revision: current.revision + 1, scope };
    });
  }, []);
  useEffect(() => { if (state.value) notify(state.value, kind, { scope: state.scope }); }, [state.revision, kind]);
  return [state.value, setValue];
}

export function listenForFeedback(listener: (feedback: Feedback) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<Feedback>).detail);
  window.addEventListener(eventName, handler);
  return () => window.removeEventListener(eventName, handler);
}

export function installValidationFeedback() {
  const remember = (event: Event) => {
    const element = event.target instanceof HTMLElement ? event.target : undefined;
    if (!element || element.closest(".feedback-toasts")) return;
    const root = element.closest<HTMLElement>("form,[role=dialog],.modal-card,.cart-sheet,.rate-popup-card,.panel,.training-login") || element.closest<HTMLElement>("main") || document.body;
    action = { root, trigger: element.closest<HTMLElement>("button") || element, at: Date.now() };
  };
  const invalid = (event: Event) => {
    const element = event.target;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) return;
    event.preventDefault();
    remember(event);
    element.dataset.validationError = element.validationMessage;
    if (!element.hasAttribute("data-feedback-previous-invalid")) element.dataset.feedbackPreviousInvalid = element.getAttribute("aria-invalid") ?? "";
    element.setAttribute("aria-invalid", "true");
    const label = fieldNames(element).at(-1) || "This field";
    notify(`${label}: ${element.validationMessage}`, "error", { scope: action });
  };
  const clear = (event: Event) => {
    if (!(event.target instanceof HTMLElement)) return;
    const element = event.target;
    delete element.dataset.validationError;
    if (element.hasAttribute("data-feedback-previous-invalid")) {
      const previous = element.dataset.feedbackPreviousInvalid;
      if (previous) element.setAttribute("aria-invalid", previous); else element.removeAttribute("aria-invalid");
      delete element.dataset.feedbackPreviousInvalid;
    } else if (element.matches(controls)) element.removeAttribute("aria-invalid");
    element.removeAttribute("aria-errormessage");
    const root = element.closest("form,[role=dialog],.panel");
    root?.querySelectorAll<HTMLElement>("button[data-validation-error]").forEach((button) => { delete button.dataset.validationError; });
  };
  document.addEventListener("click", remember, true);
  document.addEventListener("submit", remember, true);
  document.addEventListener("invalid", invalid, true);
  document.addEventListener("input", clear, true);
  document.addEventListener("change", clear, true);
  return () => {
    document.removeEventListener("click", remember, true); document.removeEventListener("submit", remember, true);
    document.removeEventListener("invalid", invalid, true); document.removeEventListener("input", clear, true); document.removeEventListener("change", clear, true);
  };
}

export function installApiFeedback(api: AxiosInstance) {
  const scopes = new WeakMap<object, Scope>();
  api.interceptors.request.use((config) => {
    const scope = feedbackScope();
    if (scope) scopes.set(config, scope);
    return config;
  });
  api.interceptors.response.use((response) => {
    const scope = scopes.get(response.config);
    if (scope && /^(post|patch|put|delete)$/i.test(response.config.method || "") && !/\/auth\//.test(response.config.url || "")) {
      const message = response.config.method === "delete" ? "Deleted successfully." : "Changes saved successfully.";
      notify(message, "success", { generic: true });
    }
    return response;
  }, (error) => {
    const scope = error.config ? scopes.get(error.config) : undefined;
    if (scope && error.code !== "ERR_CANCELED") {
      const data = error.response?.data;
      const message = String(data?.message || error.message || "Request failed. Please try again.");
      const fields = data?.fieldErrors && typeof data.fieldErrors === "object" ? Object.keys(data.fieldErrors) : [];
      notify(message, "error", { scope, fields });
    }
    return Promise.reject(error);
  });
}
