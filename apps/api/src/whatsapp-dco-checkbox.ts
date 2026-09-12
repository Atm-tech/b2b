export const dcoCheckboxFlow = {
  version: "7.1",
  screens: [{
    id: "SELECT_SO", title: "Select packed SO", terminal: true, success: true,
    data: {
      orders: { type: "array", items: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } } }, __example__: [{ id: "TEST-SO-1", title: "Test Shop 1", description: "TEST-SO-1 | 2 packs" }] },
      heading: { type: "string", __example__: "TEST: Select packed SOs for one DCO" }
    },
    layout: { type: "SingleColumnLayout", children: [
      { type: "TextBody", text: "${data.heading}" },
      { type: "Form", name: "selection", children: [
        { type: "CheckboxGroup", name: "selected_sos", label: "Packed sales orders", "data-source": "${data.orders}", required: true, "min-selected-items": 1 },
        { type: "Footer", label: "Create DCO", "on-click-action": { name: "complete", payload: { kind: "dco_checkbox", selected_sos: "${form.selected_sos}" } } }
      ] }
    ] }
  }]
};

export function validateDcoCheckboxSelection(value: unknown, allowed: string[]) {
  if (!Array.isArray(value) || !value.length || value.length > 20 || value.some((id) => typeof id !== "string" || !allowed.includes(id))) throw new Error("Invalid SO selection. Open a fresh checkbox form.");
  return [...new Set(value as string[])];
}
