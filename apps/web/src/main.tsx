import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const GuidePortal = React.lazy(() => import("./features/guides/GuidePortal"));
const isGuideRoute = /^\/guide(?:\/|$)/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isGuideRoute ? <React.Suspense fallback={<p role="status">Training load ho rahi hai…</p>}><GuidePortal /></React.Suspense> : <App />}
  </React.StrictMode>
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/service-worker.js");
  });
}
