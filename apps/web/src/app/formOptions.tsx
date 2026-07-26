import type { AppSnapshot,Counterparty } from "@aapoorti-b2b/domain";
import { productDisplayLabel } from "../features/catalog/catalogUtils";

export function renderOptions(items: Counterparty[]) {
  return [
    <option key="blank" value="">Select</option>,
    ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
  ];
}

export function renderWarehouseOptions(items: AppSnapshot["warehouses"]) {
  return [
    <option key="blank" value="">Select</option>,
    ...items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)
  ];
}

export function renderProductOptions(items: AppSnapshot["products"]) {
  return [
    <option key="blank" value="">Select</option>,
    ...items.map((item) => (
      <option key={item.sku} value={item.sku}>
        {`${item.sku} - ${productDisplayLabel(item)} (${item.division} > ${item.department} > ${item.section})`}
      </option>
    ))
  ];
}

export function uniqueProductFieldOptions(
  items: AppSnapshot["products"],
  field: "division" | "department" | "section" | "category" | "subCategory"
) {
  return Array.from(new Set(items.map((item) => item[field].trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right));
}

export function productCategoryLabel(product: AppSnapshot["products"][number]) {
  return product.division?.trim() || product.department?.trim() || product.section?.trim() || "All Products";
}
