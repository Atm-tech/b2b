import assert from "node:assert/strict";
import test from "node:test";
import { dcoCheckboxFlow, validateDcoCheckboxSelection } from "../src/whatsapp-dco-checkbox.js";

test("DCO form uses native multiple-selection checkboxes and submits selected SO IDs", () => {
  const body = JSON.stringify(dcoCheckboxFlow);
  assert.match(body, /CheckboxGroup/);
  assert.doesNotMatch(body, /RadioButtonsGroup/);
  assert.match(body, /\$\{form.selected_sos\}/);
  assert.match(body, /Create DCO/);
});

test("checkbox submission only accepts SO IDs offered to the user", () => {
  assert.deepEqual(validateDcoCheckboxSelection(["SO1", "SO2", "SO1"], ["SO1", "SO2"]), ["SO1", "SO2"]);
  for (const value of [[], "SO1", ["OTHER"], [null], Array(21).fill("SO1")]) assert.throws(() => validateDcoCheckboxSelection(value, ["SO1"]));
});
