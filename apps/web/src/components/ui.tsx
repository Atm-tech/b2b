import { useState } from "react";
import type { ReactNode } from "react";

export function PendingBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return <span className="pending-count-badge">{count > 99 ? "99+" : count}</span>;
}

export function LabelWithBadge({ label, count }: { label: string; count: number }) {
  return <span className="button-badge-label"><span>{label}</span><PendingBadge count={count} /></span>;
}

export function MetricCard({
  label,
  value,
  note,
  size = "small",
  tone = "default",
  onOpen
}: {
  label: string;
  value: string;
  note?: string;
  size?: "small" | "large";
  tone?: "default" | "good" | "danger" | "pending";
  onOpen?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <button
      type="button"
      className={`metric-card panel ${size} tone-${tone}${focused ? " focused" : ""}`}
      onClick={() => setFocused((current) => !current)}
      onDoubleClick={() => onOpen?.()}
    >
      <span className="small-label">{label}</span>
      <strong>{value}</strong>
      {note ? <p>{note}</p> : null}
      <span className="metric-card-hint">{focused ? "Double tap to open" : "Tap to zoom"}</span>
    </button>
  );
}

export function Panel({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <article className="panel"><div className="section-head"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div></div>{children}</article>;
}

export function CollapsiblePanel({ eyebrow, title, open, onToggle, children }: { eyebrow: string; title: ReactNode; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <article className={open ? "panel collapsible-panel open" : "panel collapsible-panel"}>
      <button className="collapsible-trigger" type="button" onClick={onToggle} aria-expanded={open}>
        <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
        <span className="collapsible-icon">{open ? "Close" : "Open"}</span>
      </button>
      {open ? <div className="collapsible-body">{children}</div> : null}
    </article>
  );
}

export function TwoCol({ left, right }: { left: ReactNode; right: ReactNode }) {
  return <section className="dashboard-grid">{left}{right}</section>;
}

export function DataTable({ headers, rows }: { headers: string[]; rows: Array<Array<string | number>> }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={headers.length}>No records yet.</td></tr>
            : rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}
