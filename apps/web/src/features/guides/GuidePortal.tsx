import { useEffect, useRef, useState } from "react";
import { normalizeGuideSlug, type TrainingGuide, type GuideSlug } from "@aapoorti-b2b/domain";
import { useGuideNarration } from "./useGuideNarration";
import "./guides.css";

const apiBase = ((import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() || (location.port === "5173" || location.port === "4173" ? `${location.protocol}//${location.hostname}:8080` : location.origin)).replace(/\/$/, "");
const tokenKey = "aapoorti-b2b-token";
type Catalog = { name: string; allGuides: boolean; canShare: boolean; guides: { slug: GuideSlug; title: string }[]; whatsappUrl: string };
type Recipient = { id: string | number; name: string; phone: string; guides?: GuideSlug[] };
type Payload = { guide: TrainingGuide; name: string; whatsappUrl: string };
class RequestError extends Error { constructor(public status: number, message: string) { super(message); } }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const token = localStorage.getItem(tokenKey);
  const response = await fetch(`${apiBase}${path}`, { method: body === undefined ? "GET" : "POST", headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RequestError(response.status, data.message || "Request complete nahi hui. Dobara try karein.");
  return data as T;
}
const message = (error: unknown) => error instanceof Error ? error.message : "Training load nahi hui.";

export function GuideShareEntry() {
  const [show, setShow] = useState(false);
  useEffect(() => { let active = true; void request<Catalog>("/guides/catalog").then(r => { if (active) setShow(r.canShare); }).catch(() => {}); return () => { active = false; }; }, []);
  return show ? <a className="ghost-button" href="/guide">Share training</a> : null;
}

export default function GuidePortal() {
  const path = location.pathname.replace(/\/+$/, "").split("/");
  const slug = normalizeGuideSlug(path[2] || "");
  const [payload, setPayload] = useState<Payload | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const meta = document.createElement("meta"); meta.name = "robots"; meta.content = "noindex, nofollow"; document.head.append(meta);
    const referrer = document.createElement("meta"); referrer.name = "referrer"; referrer.content = "no-referrer"; document.head.append(referrer);
    document.title = "B CONNECT · Training";
    return () => { meta.remove(); referrer.remove(); };
  }, []);
  useEffect(() => {
    let active = true; setLoading(true); setError(""); setStatus(0);
    void (slug ? request<Payload>(`/guides/${encodeURIComponent(slug)}`).then(r => { if (active) setPayload(r); }) : request<Catalog>("/guides/catalog").then(r => { if (active) setCatalog(r); }))
      .catch(e => { if (active) { setError(message(e)); setStatus(e instanceof RequestError ? e.status : 500); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [slug, revision]);
  const reload = () => setRevision(r => r + 1);
  return <main className="training-root">
    <header className="training-header"><a href="/">AAPOORTI <strong>B CONNECT</strong></a><span>{slug === "retailer" ? "Sabhi retailers ke liye" : "Staff training book"}</span></header>
    {loading ? <section className="training-gate" role="status">Training load ho rahi hai…</section> : payload ? <Book {...payload} /> : catalog ? <TrainingLibrary catalog={catalog} /> : <section className="training-gate">
      <span className="training-kicker">Registered users only</span><h1>{slug === "retailer" ? "Apni retailer training kholo" : "Apne module ki training kholo"}</h1>
      <p role="alert">{error}</p>

      {(status === 401 || status === 403) ? <><p>{slug === "retailer" ? "Retailer guide sabke liye khuli hai. Staff guide ke liye login karein." : "Wahi username aur password use karein jo B CONNECT mein mila hai."}</p><Login onLogin={reload} /></> : <button onClick={reload}>Dobara try karein</button>}
      <a href="/">B CONNECT par wapas</a>
    </section>}
    <footer className="training-footer">Practice mode · Yahan koi asli order ya payment nahi banta.</footer>
  </main>;
}

function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="training-login" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { const result = await request<{ token: string; user: unknown }>("/auth/login", { username, password }); localStorage.setItem(tokenKey, result.token); localStorage.setItem("aapoorti-b2b-user", JSON.stringify(result.user)); setPassword(""); onLogin(); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>
    <label>Username<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} /></label>
    <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)} /></label>
    <button disabled={busy}>{busy ? "Login ho raha hai…" : "Login karke training kholo"}</button>{error && <p role="alert">{error}</p>}
  </form>;
}

function Book({ guide, name, whatsappUrl }: Payload) {
  const [index, setIndex] = useState(0); const [value, setValue] = useState(""); const [feedback, setFeedback] = useState<Record<number, string>>({});
  const step = guide.steps[index]; const heading = useRef<HTMLHeadingElement>(null);
  const audio = useGuideNarration(step.narration, `${guide.slug}:${index}`);
  const navigate = (next: number) => { audio.pause(); setValue(""); setIndex(Math.max(0, Math.min(guide.steps.length - 1, next))); };
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [index]);
  const answer = (correct: boolean) => setFeedback(f => ({ ...f, [index]: correct ? step.success : "Ek baar upar ka step dobara padho ya replay suno, phir try karo." }));
  return <>
    <div className="training-context"><span>{guide.title}</span><span>{name}</span></div>
    {guide.slug === "retailer" && index === 0 && <div className="training-start-options"><span>Naye hain? Neeche registration se shuru karein.</span><button onClick={() => navigate(1)}>Pehle se registered? Ordering seekhein →</button></div>}
    <article className="training-book">
      <section className="training-art"><img src="/guide-assets/ravi-shop.png" alt="Cartoon Ravi, Aapoorti ke saath program seekhte hue" /><span className="training-sticker">Chalo, saath seekhein!</span><p>{step.speech}</p></section>
      <section className="training-page"><p className="training-kicker">Step {index + 1} / {guide.steps.length} · {step.screen}</p><h1 tabIndex={-1} ref={heading}>{step.title}</h1><p className="training-body">{step.body}</p>
        <div className="training-audio"><button onClick={audio.status === "playing" ? audio.pause : audio.play}>{audio.status === "playing" ? "■ Audio band karein" : audio.status === "blocked" ? "▶ Tap karke audio shuru karein" : "↻ Audio replay"}</button><span role="status">{audio.status === "playing" ? "Sun rahe hain…" : audio.status === "ended" ? "Audio band hai. Replay kar sakte hain." : audio.status === "unsupported" ? "Is browser mein voice nahi hai; neeche narration padhein." : audio.status === "blocked" ? "Pehli baar audio ke liye tap zaroori ho sakta hai." : "Audio taiyar hai"}</span></div>
        <div className="training-practice"><span className="training-screen">{step.screen} · Sample practice</span><p className="training-example">{step.example}</p><h2>{step.task}</h2>
          {step.input ? <form onSubmit={e => { e.preventDefault(); answer(value.trim().toLowerCase() === step.input!.expected.toLowerCase()); }}><label>{step.input.label}<input required inputMode={step.input.numeric ? "numeric" : "text"} value={value} onChange={e => setValue(e.target.value)} /></label><button>Send →</button></form> : <div className="training-choices">{step.choices?.map((choice, i) => <button key={choice} onClick={() => answer(i === step.answer)}>{choice}</button>)}</div>}
          <p className="training-feedback" role="status">{feedback[index] || "Sample par practice karein."}</p>
        </div>
        <details className="training-transcript"><summary>Hindi narration padhein</summary><p lang="hi">{step.narration}</p></details>
        {index === guide.steps.length - 1 && <a className="training-button training-return" href={whatsappUrl} onClick={audio.pause}>Return to WhatsApp →</a>}
      </section>
    </article>
    <nav className="training-nav" aria-label="Training steps"><button disabled={index === 0} onClick={() => navigate(index - 1)}>← Pichhla step</button><select aria-label="Training chapter" value={index} onChange={e => navigate(Number(e.target.value))}>{guide.steps.map((s,i) => <option key={i} value={i}>{i + 1}. {s.title}</option>)}</select>{index < guide.steps.length - 1 ? <button onClick={() => navigate(index + 1)}>Agla step →</button> : <button onClick={() => navigate(0)}>Dobara shuru karein ↻</button>}</nav>
  </>;
}

function TrainingLibrary({ catalog }: { catalog: Catalog }) {
  const [recipients, setRecipients] = useState<{ retailers: Recipient[]; users: Recipient[] }>({ retailers: [], users: [] });
  const [kind, setKind] = useState("retailer"); const [recipientId, setRecipientId] = useState(""); const [guide, setGuide] = useState("retailer");
  const [link, setLink] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState("");
  useEffect(() => { if (!catalog.canShare) return; let active = true; void request<typeof recipients>("/guides/recipients").then(r => { if (active) setRecipients(r); }).catch(e => { if (active) setError(message(e)); }); return () => { active = false; }; }, [catalog.canShare]);
  const list = kind === "retailer" ? recipients.retailers : recipients.users;
  const recipient = list.find(r => String(r.id) === recipientId);
  const clear = () => { setLink(""); setNotice(""); setError(""); };
  const shareText = `Aapoorti B CONNECT ki training: ${link}`;
  const phone = (recipient?.phone || "").replace(/\D/g, "");
  return <section className="training-library"><span className="training-kicker">{catalog.allGuides ? "Admin · All training" : "Your registered modules"}</span><h1>Training aur share links</h1><p>Guide normal app menu mein nahi dikhti. Retailer guide public hai; staff guides mein registered role check hoga.</p>
    <div className="training-library-grid">{catalog.guides.map(g => <a key={g.slug} href={`/guide/${g.slug}`}><strong>{g.title}</strong><span>Training kholo →</span></a>)}</div>
    {catalog.canShare && <section className="training-share"><h2>Training link share karein</h2><p>{catalog.allGuides ? "Retailer ka public link share karein, ya registered staff member chunein." : "Retailer guide kisi ko bhi bhej sakte hain. Mapped retailer chunna optional hai."}</p>
      {catalog.allGuides && <label>Kisko bhejna hai<select value={kind} onChange={e => { setKind(e.target.value); setRecipientId(""); setGuide(e.target.value === "retailer" ? "retailer" : ""); clear(); }}><option value="retailer">Retailer</option><option value="staff">Staff user</option></select></label>}
      <label>Recipient<select value={recipientId} onChange={e => { setRecipientId(e.target.value); const r = list.find(r => String(r.id) === e.target.value); setGuide(kind === "retailer" ? "retailer" : r?.guides?.[0] || ""); clear(); }}><option value="">Select recipient (retailer ke liye optional)</option>{list.map(r => <option value={r.id} key={r.id}>{r.name} · {r.phone}</option>)}</select></label>
      {kind === "staff" && <label>Assigned module<select value={guide} onChange={e => { setGuide(e.target.value); clear(); }}><option value="">Select guide</option>{recipient?.guides?.map(slug => <option key={slug} value={slug}>{catalog.guides.find(g => g.slug === slug)?.title || slug}</option>)}</select></label>}
      <button disabled={(kind === "staff" && !recipient) || !guide || busy} onClick={async () => { setBusy(true); clear(); try { const path = kind === "retailer" ? "/guide/retailer" : `/guide/${guide}`; setLink(new URL(path, location.origin).href); } catch (e) { setError(message(e)); } finally { setBusy(false); } }}>{busy ? "Link ban raha hai…" : "Link banayein"}</button>
      {link && <div className="training-share-result"><label>Share link<input readOnly value={link} onFocus={e => e.target.select()} /></label><p>{kind === "retailer" ? "Public link: naya, purana, registered ya non-registered retailer, koi bhi khol sakta hai." : "Link kholne par user ko apne assigned-role login se access milega."}</p><div className="training-choices"><button onClick={async () => { try { await navigator.clipboard.writeText(link); setNotice("Link copy ho gaya."); } catch { setNotice("Upar link select karke copy karein."); } }}>Copy link</button>{!!navigator.share && <button onClick={async () => { try { await navigator.share({ title: "B CONNECT Training", text: shareText }); } catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) setNotice("Copy link se share karein."); } }}>Share…</button>}<a className="training-button" href={`https://wa.me/${phone.length === 10 ? `91${phone}` : phone}?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener noreferrer">WhatsApp mein share karein</a></div><p role="status">{notice}</p></div>}
      {error && <p role="alert">{error}</p>}
    </section>}
    <a className="training-button training-return" href={catalog.whatsappUrl}>Return to WhatsApp →</a>
  </section>;
}
