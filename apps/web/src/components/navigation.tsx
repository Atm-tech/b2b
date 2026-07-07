type SidebarView =
  | "Overview"
  | "Parties"
  | "Purchase"
  | "Purchases"
  | "Sales"
  | "SalesOrders"
  | "Payments"
  | "ExcelMaker"
  | "GoodsWarrants"
  | "Ledger"
  | "Stock"
  | "Products"
  | string;

export function SidebarVectorIcon({ view }: { view: SidebarView }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (view) {
    case "Overview":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 11.5 12 4l9 7.5" /><path {...common} d="M5.5 10.5V20h13V10.5" /></svg></span>;
    case "Parties":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" /><path {...common} d="M3.5 19a4.5 4.5 0 0 1 9 0" /><path {...common} d="M16.5 11a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" /><path {...common} d="M14.5 19a4 4 0 0 1 6 0" /></svg></span>;
    case "Purchase":
    case "Purchases":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7h16l-1.2 10.2A2 2 0 0 1 16.8 19H7.2a2 2 0 0 1-1.98-1.8L4 7Z" /><path {...common} d="M9 10h6" /><path {...common} d="M9 13h4" /><path {...common} d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /></svg></span>;
    case "Sales":
    case "SalesOrders":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M5 6.5h14v11H5z" /><path {...common} d="M8 10h8" /><path {...common} d="M8 13.5h5" /><path {...common} d="M15.5 4.5 19 8" /></svg></span>;
    case "Payments":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="3.5" y="6" width="17" height="12" rx="2" /><path {...common} d="M3.5 10.5h17" /><path {...common} d="M8 15h2.5" /></svg></span>;
    case "ExcelMaker":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><rect {...common} x="4" y="4.5" width="16" height="15" rx="2" /><path {...common} d="M8 8.5h8" /><path {...common} d="M8 12h3" /><path {...common} d="M14 12h2" /><path {...common} d="M8 15.5h2" /><path {...common} d="M13.5 14.5l3 3" /><path {...common} d="m16.5 14.5-3 3" /></svg></span>;
    case "GoodsWarrants":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12A1.5 1.5 0 0 1 18 19.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z" /><path {...common} d="M8 8h8" /><path {...common} d="M8 12h8" /><path {...common} d="M8 16h4" /><path {...common} d="M15.5 15.5h2.5" /></svg></span>;
    case "Ledger":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M6 4.5h12A1.5 1.5 0 0 1 19.5 6v12a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V6A1.5 1.5 0 0 1 6 4.5Z" /><path {...common} d="M8 9h8" /><path {...common} d="M8 12h8" /><path {...common} d="M8 15h5" /></svg></span>;
    case "Stock":
    case "Products":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3.8 4.5 7.5 12 11.2l7.5-3.7L12 3.8Z" /><path {...common} d="M4.5 12 12 15.7 19.5 12" /><path {...common} d="M4.5 16.5 12 20.2l7.5-3.7" /></svg></span>;
    case "Search":
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="11" cy="11" r="6.5" /><path {...common} d="m16 16 4 4" /></svg></span>;
    default:
      return <span className="sidebar-vector-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="12" cy="12" r="8" /></svg></span>;
  }
}
