import { useId, useState } from "react";

type ProductOption = { sku: string; label: string };

export function OrderProductSelect({ products, value, onChange, disabled }: {
  products: ProductOption[];
  value: string;
  onChange: (sku: string) => void;
  disabled?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const terms = search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = products.filter((product) => {
    const text = `${product.label} ${product.sku}`.toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
  const selected = products.find((product) => product.sku === value);
  const suggestions = matches.slice(0, 50);
  const showSuggestions = open && !!search.trim() && !disabled;
  const choose = (sku: string) => {
    onChange(sku);
    setSearch("");
    setOpen(false);
    setActiveIndex(0);
  };
  return <div className="order-product-select">
    <div className="order-product-search">
      <input type="search" role="combobox" aria-autocomplete="list" aria-expanded={showSuggestions} aria-controls={showSuggestions ? listId : undefined} aria-activedescendant={showSuggestions && suggestions[activeIndex] ? `${listId}-${activeIndex}` : undefined} autoComplete="off" aria-label="Search products by name or SKU" placeholder="Search products by name or SKU" value={search} onChange={(event) => { setSearch(event.target.value); setActiveIndex(0); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} disabled={disabled} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); setOpen(false); }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setOpen(true);
          setActiveIndex((index) => !open ? 0 : Math.max(0, Math.min(suggestions.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
        }
        if (event.key === "Enter") { event.preventDefault(); if (showSuggestions && suggestions[activeIndex]) choose(suggestions[activeIndex].sku); }
      }} />
      {showSuggestions ? <div className="order-product-suggestions" id={listId} role="listbox" aria-label="Product suggestions">
        {suggestions.map((product, index) => <div key={product.sku} id={`${listId}-${index}`} role="option" aria-selected={index === activeIndex} className="order-product-suggestion" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(product.sku)}><strong>{product.label}</strong><small>{product.sku}</small></div>)}
        {!suggestions.length ? <div className="order-product-no-results">No products found. Try another name or SKU.</div> : null}
      </div> : null}
    </div>
    <select aria-label="Product" value={value} disabled={disabled} onChange={(event) => { onChange(event.target.value); setSearch(""); }}>
      {selected && !matches.some((product) => product.sku === value) ? <option value={selected.sku}>{selected.label} (selected)</option> : null}
      {matches.map((product) => <option key={product.sku} value={product.sku}>{product.label}</option>)}
      {!matches.length ? <option disabled value="">No products found</option> : null}
    </select>
    {search.trim() ? <small role="status">{matches.length ? `${matches.length} product(s) found` : "No products found. Try another name or SKU."}</small> : null}
  </div>;
}
