import type { AppSnapshot } from "@aapoorti-b2b/domain";
import { inferProductWeightKg,productWeightSearchText } from "@aapoorti-b2b/domain";

export type CatalogDisplayProduct = {
  key: string;
  displayName: string;
  product: AppSnapshot["products"][number];
  variants: AppSnapshot["products"];
  familyKey?: string;
};

export function catalogCardTitle(item: CatalogDisplayProduct, product: AppSnapshot["products"][number]) {
  return item.familyKey ? item.displayName : productDisplayLabel(product);
}

export function productUnitWeightKg(product: AppSnapshot["products"][number]) {
  const explicitWeight = Number(product.defaultWeightKg || 0);
  return explicitWeight > 0 ? explicitWeight : inferProductWeightKg(productWeightSearchText(product));
}

export function normalizeStaplesWeightLabel(product: AppSnapshot["products"][number]) {
  const explicitVariant = String((product as AppSnapshot["products"][number] & { weightVariant?: string }).weightVariant || "").trim().toUpperCase();
  if (explicitVariant && explicitVariant !== "WRONG") {
    return explicitVariant;
  }
  const weightText = [
    product.size,
    product.name,
    product.sku,
    product.shortName,
    product.articleName,
    product.itemName
  ].filter(Boolean).join(" ").trim().toUpperCase();
  const sizeMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/);
  if (sizeMatch) {
    const value = Number(sizeMatch[1]);
    const unit = sizeMatch[2];
    if (["KG", "KGS"].includes(unit)) return `${value}KG`;
    if (["G", "GM", "GRAM"].includes(unit)) return `${value}GM`;
    if (["L", "LTR", "LT"].includes(unit)) return `${value}L`;
    if (unit === "ML") return `${value}ML`;
  }
  const weight = productUnitWeightKg(product);
  if (weight > 0) {
    if (weight >= 1) return `${weight}KG`;
    return `${Math.round(weight * 1000)}GM`;
  }
  if (weightText.includes("LOOSE")) return "LOOSE";
  return product.unit || "Weight";
}

export function staplesVariantSortWeight(product: AppSnapshot["products"][number]) {
  const weightText = [
    product.size,
    product.name,
    product.sku,
    product.shortName,
    product.articleName,
    product.itemName
  ].filter(Boolean).join(" ").trim().toUpperCase();
  const sizeMatch = weightText.match(/(\d+(?:\.\d+)?)\s*(KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/);
  if (sizeMatch) {
    const value = Number(sizeMatch[1]);
    const unit = sizeMatch[2];
    if (["KG", "KGS", "L", "LTR", "LT"].includes(unit)) return value;
    if (["G", "GM", "GRAM"].includes(unit)) return value / 1000;
    if (unit === "ML") return value / 1000;
  }
  const weight = productUnitWeightKg(product);
  return weight > 0 ? weight : Number.POSITIVE_INFINITY;
}

export function normalizeCatalogFamilyLabel(product: AppSnapshot["products"][number]) {
  const explicitBase = String((product as AppSnapshot["products"][number] & { baseProduct?: string }).baseProduct || "").trim();
  if (explicitBase) return explicitBase.toUpperCase();
  const primaryLabel = (
    product.name
    || product.shortName
    || product.itemName
    || product.articleName
    || product.sku
  ).toUpperCase();
  const cleaned = primaryLabel
    .replace(/[_/]+/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b\d+(?:\.\d+)?\s*(?:KG|KGS|KILOGRAM|G|GM|GRAM|L|LTR|LT|LITRE|ML)\b/g, " ")
    .replace(/\b(?:PKD|PACK|PCK|JAR|FMCG|J)\b/g, " ")
    .replace(/\s*-\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || primaryLabel.trim();
}

export function buildCatalogDisplayProducts(items: AppSnapshot["products"]) {
  const grouped = new Map<string, AppSnapshot["products"]>();
  for (const product of items) {
    const family = normalizeCatalogFamilyLabel(product);
    const current = grouped.get(family) || [];
    current.push(product);
    grouped.set(family, current);
  }

  const display: CatalogDisplayProduct[] = [];
  for (const [family, variants] of grouped.entries()) {
    const sortedVariants = [...variants].sort((left, right) => {
      const weightDiff = staplesVariantSortWeight(left) - staplesVariantSortWeight(right);
      if (weightDiff !== 0) return weightDiff;
      return left.name.localeCompare(right.name, "en-IN");
    });
    const uniqueVariants = Array.from(
      sortedVariants.reduce((map, variant) => {
        const label = normalizeStaplesWeightLabel(variant);
        const current = map.get(label);
        if (!current) {
          map.set(label, variant);
          return map;
        }
        const variantName = `${variant.name} ${variant.shortName || ""} ${variant.articleName || ""} ${variant.itemName || ""}`.toUpperCase();
        const currentName = `${current.name} ${current.shortName || ""} ${current.articleName || ""} ${current.itemName || ""}`.toUpperCase();
        const score = (value: string, product: AppSnapshot["products"][number]) =>
          (product.size ? 10 : 0)
          + (Number(product.defaultWeightKg || 0) > 0 ? 8 : 0)
          + (/\bJAR\b|\bFMCG\b|\(J\)|\b J \b/.test(` ${value} `) ? -6 : 0)
          + (/\b\d+(?:\.\d+)?\s*(?:KG|KGS|G|GM|GRAM|L|LTR|LT|ML)\b/.test(value) ? 4 : 0)
          + (value.length > 0 ? Math.min(value.length, 40) / 100 : 0);
        if (score(variantName, variant) > score(currentName, current)) {
          map.set(label, variant);
        }
        return map;
      }, new Map<string, AppSnapshot["products"][number]>())
      .values()
    );
    if (uniqueVariants.length === 1) {
      const [product] = uniqueVariants;
      display.push({
        key: product.sku,
        displayName: product.name,
        product,
        variants: [product]
      });
      continue;
    }
    display.push({
      key: `family-${family}`,
      displayName: family,
      product: uniqueVariants[0],
      variants: uniqueVariants,
      familyKey: family
    });
  }

  return display.sort((left, right) => left.displayName.localeCompare(right.displayName, "en-IN"));
}

export function catalogVariantOptionLabel(
  variant: AppSnapshot["products"][number],
  variants: AppSnapshot["products"]
) {
  const baseLabel = normalizeStaplesWeightLabel(variant);
  const sameWeightVariants = variants.filter((item) => normalizeStaplesWeightLabel(item) === baseLabel);
  if (sameWeightVariants.length <= 1) return baseLabel;
  const detail = variant.shortName || variant.articleName || variant.itemName || variant.name || variant.sku;
  return `${baseLabel} - ${detail}`;
}

export function productDisplayLabel(product: AppSnapshot["products"][number]) {
  const family = normalizeCatalogFamilyLabel(product);
  if (!family) return product.name;
  return `${family} - ${catalogVariantOptionLabel(product, [product])}`;
}
