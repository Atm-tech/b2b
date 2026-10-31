import { useState } from "react";

type ProductOption = { sku: string; label: string };

export function OrderProductSelect({ products, value, onChange, disabled }: {
  products: ProductOption[];
  value: string;
  onChange: (sku: string) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = products.filter((product) => {
    const text = `${product.label} ${product.sku}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const selected = products.find((product) => product.sku === value);
  return <div className="order-product-select">
    <input type="search" aria-label="Search products by name or SKU" placeholder="Search products by name or SKU" value={search} onChange={(event) => setSearch(event.target.value)} disabled={disabled} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
    <select aria-label="Product" value={value} disabled={disabled} onChange={(event) => { onChange(event.target.value); setSearch(""); }}>
      {selected && !matches.some((product) => product.sku === value) ? <option value={selected.sku}>{selected.label} (selected)</option> : null}
      {matches.map((product) => <option key={product.sku} value={product.sku}>{product.label}</option>)}
      {!matches.length ? <option disabled value="">No products found</option> : null}
    </select>
    {search.trim() ? <small role="status">{matches.length ? `${matches.length} product(s) found` : "No products found. Try another name or SKU."}</small> : null}
  </div>;
}
