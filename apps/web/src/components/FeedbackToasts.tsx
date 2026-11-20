import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { installValidationFeedback, listenForFeedback, type Feedback } from "../app/feedback";

export function FeedbackToasts() {
  const [items, setItems] = useState<Feedback[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const stopValidation = installValidationFeedback();
    const stopFeedback = listenForFeedback((item) => {
      setItems((current) => {
        const duplicate = current.find((old) => old.kind === item.kind && old.message === item.message);
        const next = current.filter((old) => old.id !== duplicate?.id && !(old.generic && !item.generic && old.kind === item.kind));
        // Specific success messages replace the generic API acknowledgement.
        return [...next, { ...item, target: item.target || duplicate?.target }].slice(-5);
      });
      if (item.kind !== "error") {
        const timer = setTimeout(() => { setItems((current) => current.filter((old) => old.id !== item.id)); timers.delete(timer); }, 6500);
        timers.add(timer);
      }
    });
    return () => { stopValidation(); stopFeedback(); timers.forEach(clearTimeout); };
  }, []);
  return createPortal(<div className="feedback-toasts" aria-label="Notifications">
    <div id="feedback-errors" className="visually-hidden" aria-live="assertive">{items.filter((item) => item.kind === "error").map((item) => item.message).join(". ")}</div>
    {items.map((item) => <section key={item.id} className={`feedback-toast ${item.kind}`} role={item.kind === "error" ? "alert" : "status"} aria-atomic="true">
      <span className="feedback-toast-icon" aria-hidden="true">{item.kind === "success" ? "✓" : item.kind === "error" ? "!" : "i"}</span>
      <div className="feedback-toast-content"><strong>{item.kind === "error" ? "Please check" : item.kind === "success" ? "Done" : "Notice"}</strong><p>{item.message}</p>
        {item.target?.isConnected ? <button type="button" className="feedback-show-field" onClick={() => { item.target?.scrollIntoView({ block: "center", behavior: "smooth" }); item.target?.focus({ preventScroll: true }); }}>Show where</button> : null}
      </div>
      <button type="button" className="feedback-toast-close" aria-label="Dismiss notification" onClick={() => setItems((current) => current.filter((old) => old.id !== item.id))}>×</button>
    </section>)}
  </div>, document.body);
}
