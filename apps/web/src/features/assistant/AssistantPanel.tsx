import { useMemo, useRef, useState } from "react";
import axios from "axios";
import type { AppSnapshot, AppUser, PaymentMode } from "@aapoorti-b2b/domain";
import { api, groupPurchaseOrders, groupSalesOrders } from "../../app/shared";

type Candidate = { id: string; label: string; detail: string; score: number };
type ProductCandidate = Candidate & { gstRate: number; taxMode: "Exclusive" | "Inclusive"; availableStock: number; lastPurchaseRate: number };
type AssistantLine = { query: string; quantity: number; rate: number; candidates: ProductCandidate[] };
type AssistantDraft = {
  side: "Sales" | "Purchase";
  partyLabel: string;
  partyCandidates: Candidate[];
  warehouseCandidates: Candidate[];
  paymentMode: string;
  cashTiming: string;
  deliveryMode: string;
  billingType: "B2B" | "B2C";
  note: string;
  lines: AssistantLine[];
};
type AnalyticsRow = { sku: string; product: string; quantitySold: number; salesValue: number; purchaseCost: number; sellingRate: number; marginAmount: number; marginPercent: number };
type AssistantReply = {
  kind: "answer" | "order_draft";
  message: string;
  spokenMessage?: string;
  engine: "openai" | "local";
  analytics?: { metric: string; filter: string; rows: AnalyticsRow[]; costBasis: string };
  draft?: AssistantDraft;
};
type EditableDraft = {
  partyId: string;
  warehouseId: string;
  paymentMode: PaymentMode;
  cashTiming: string;
  deliveryMode: string;
  billingType: "B2B" | "B2C";
  note: string;
  allowProbationarySale: boolean;
  lines: Array<{ productSku: string; quantity: string; rate: string }>;
};
type OrderThread = { side: "Sales" | "Purchase" | "Unknown"; commands: string[] };

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

function currency(value: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(value || 0);
}

function speak(text: string, language: "english" | "hinglish") {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.replace(/₹/g, "rupees "));
  utterance.lang = language === "hinglish" ? "hi-IN" : "en-IN";
  const voicePrefix = language === "hinglish" ? "hi" : "en-in";
  const voice = window.speechSynthesis.getVoices().find((item) => item.lang.toLowerCase().startsWith(voicePrefix));
  if (voice) utterance.voice = voice;
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
}

function orderSideFromCommand(value: string): OrderThread["side"] | null {
  const normalized = value.toLowerCase().replace(/[._-]/g, " ").replace(/\s+/g, " ");
  if (/\b(?:p\s*o|purchase order|purchasing order|buy order|supplier order|vendor order)\b/.test(normalized)
    || /(?:पी\s*ओ|परचेज़?|पर्चेज़?|खरीद)\s*(?:ऑर्डर|आर्डर|आदेश)?/.test(normalized)) return "Purchase";
  if (/\b(?:s\s*o|sales order|sale order|selling order|customer order)\b/.test(normalized)
    || /(?:एस\s*ओ|सेल्स?|बिक्री)\s*(?:ऑर्डर|आर्डर|आदेश)?/.test(normalized)) return "Sales";
  if (/\b(?:order\s*(?:bana|banao|make|create|book)|(?:make|create|book)\s+(?:an?\s+)?order)\b/.test(normalized)
    || /(?:ऑर्डर|आर्डर|आदेश).*?(?:बना|तैयार|बुक)/.test(normalized)) return "Unknown";
  return null;
}

export function AssistantPanel({ snapshot, currentUser, sessionToken, onSnapshot, onMessage, onError }: {
  snapshot: AppSnapshot;
  currentUser: AppUser;
  sessionToken: string;
  onSnapshot: (snapshot: AppSnapshot) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [reply, setReply] = useState<AssistantReply | null>(null);
  const [draft, setDraft] = useState<EditableDraft | null>(null);
  const [orderThread, setOrderThread] = useState<OrderThread | null>(null);
  const [assistantLanguage, setAssistantLanguage] = useState<"english" | "hinglish">("hinglish");
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const keepListeningRef = useRef(false);
  const transcriptRef = useRef("");
  const capturedTranscriptRef = useRef("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const discardRecordingRef = useRef(false);
  const roles = currentUser.roles?.length ? currentUser.roles : [currentUser.role];
  const canCreateSales = roles.includes("Sales");
  const canCreatePurchase = roles.includes("Purchaser");
  const activeProductCandidates = useMemo(() => reply?.draft?.lines || [], [reply]);

  function applyReply(nextReply: AssistantReply) {
    setReply(nextReply);
    if (nextReply.draft) {
      setDraft({
        partyId: nextReply.draft.partyCandidates[0]?.id || "",
        warehouseId: nextReply.draft.warehouseCandidates[0]?.id || snapshot.warehouses[0]?.id || "",
        paymentMode: nextReply.draft.paymentMode as PaymentMode,
        cashTiming: nextReply.draft.cashTiming || "In Hand",
        deliveryMode: nextReply.draft.deliveryMode,
        billingType: nextReply.draft.billingType,
        note: nextReply.draft.note,
        allowProbationarySale: false,
        lines: nextReply.draft.lines.map((line) => ({ productSku: line.candidates[0]?.id || "", quantity: String(line.quantity || 1), rate: String(line.rate || 0) }))
      });
    } else {
      setDraft(null);
    }
    speak(nextReply.spokenMessage || nextReply.message, assistantLanguage);
  }

  async function ask(value = text) {
    const request = value.trim();
    if (!request || busy) return;
    const detectedSide = orderSideFromCommand(request);
    const nextThread = orderThread
      ? { ...orderThread, side: orderThread.side === "Unknown" && detectedSide ? detectedSide : orderThread.side, commands: [...orderThread.commands, request] }
      : detectedSide ? { side: detectedSide, commands: [request] } : null;
    const interpretedRequest = nextThread ? nextThread.commands.join(", ") : request;
    if (nextThread) setOrderThread(nextThread);
    setBusy(true);
    onError("");
    try {
      const { data } = await api.post<AssistantReply>("/assistant/query", { text: interpretedRequest, responseLanguage: assistantLanguage }, { headers: { authorization: `Bearer ${sessionToken}` } });
      applyReply(data);
      const resolvedThread = nextThread || (data.draft ? { side: data.draft.side, commands: [request] } : null);
      if (resolvedThread && data.draft) setOrderThread({ ...resolvedThread, side: data.draft.side });
      setText(resolvedThread ? "" : request);
    } catch (error) {
      const message = axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : "Assistant request failed.";
      setReply({ kind: "answer", engine: "local", message });
      onError(message);
      speak(message, assistantLanguage);
    } finally {
      setBusy(false);
    }
  }

  function cancelOrderThread() {
    keepListeningRef.current = false;
    recognitionRef.current?.stop();
    discardRecordingRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    setListening(false);
    setDraft(null);
    setOrderThread(null);
    setText("");
    const message = assistantLanguage === "hinglish" ? "Order draft aur temporary thread cancel kar diya hai." : "Order draft and temporary thread cancelled.";
    setReply({ kind: "answer", engine: reply?.engine || "local", message });
    speak(assistantLanguage === "hinglish" ? "ऑर्डर ड्राफ्ट और अस्थायी बातचीत रद्द कर दी गई है।" : message, assistantLanguage);
  }

  function handleCapturedVoice(transcript: string) {
    const normalized = transcript.toLowerCase();
    if (draft && /\b(confirm|submit|yes|book order|pakka|final)\b|(?:कन्फर्म|पक्का|फाइनल|जमा|बुक)\s*(?:करो|कर दो|कीजिए)?/.test(normalized)) {
      void submitOrder();
    } else if ((draft || orderThread) && /\b(cancel|discard|clear thread|stop order|no)\b|(?:कैंसिल|रद्द|हटा|मिटा)\s*(?:करो|कर दो|कीजिए)?/.test(normalized)) {
      cancelOrderThread();
    } else {
      void ask(transcript);
    }
  }

  function finishListening() {
    if (!listening) return;
    keepListeningRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }
    recognitionRef.current?.stop();
  }

  async function listen() {
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
    if (listening) return finishListening();
    if (transcribing) return;
    window.speechSynthesis?.cancel();
    if (!navigator.mediaDevices?.getUserMedia) {
      const message = assistantLanguage === "hinglish" ? "Is browser mein microphone access available nahi hai. Chrome/Edge mein localhost kholiye ya command type kariye." : "Microphone access is unavailable in this browser. Open localhost in Chrome/Edge or type the command.";
      setReply({ kind: "answer", engine: "local", message });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (error) {
      const errorName = error instanceof DOMException ? error.name : "MicrophoneError";
      const message = errorName === "NotAllowedError"
        ? (assistantLanguage === "hinglish" ? "Microphone permission blocked hai. Address bar ke microphone icon se Allow karke dobara Start dabaiye." : "Microphone permission is blocked. Allow it from the address bar, then press Start again.")
        : (assistantLanguage === "hinglish" ? `Microphone open nahi hua (${errorName}). Windows input device aur browser permission check karein.` : `The microphone could not be opened (${errorName}). Check the Windows input device and browser permission.`);
      setReply({ kind: "answer", engine: "local", message });
      return;
    }
    // Prefer the browser's streaming recognizer when available. It returns
    // short commands quickly; local Whisper remains the offline fallback.
    if (!Recognition && typeof MediaRecorder !== "undefined") {
      const preferredMime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((item) => MediaRecorder.isTypeSupported(item));
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
      mediaRecorderRef.current = recorder;
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      discardRecordingRef.current = false;
      setText("");
      setListening(true);
      recorder.ondataavailable = (event) => { if (event.data.size > 0) audioChunksRef.current.push(event.data); };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setListening(false);
        setReply({ kind: "answer", engine: "local", message: "Local voice recording failed. Microphone permission aur Windows input device check karein." });
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaRecorderRef.current = null;
        mediaStreamRef.current = null;
        setListening(false);
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];
        if (discardRecordingRef.current) { discardRecordingRef.current = false; return; }
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 500) {
          setReply({ kind: "answer", engine: "local", message: "Recording mein audio nahi mila. Start dabakar boliye aur end mein Stop dabaiye." });
          return;
        }
        setTranscribing(true);
        setBusy(true);
        onError("");
        try {
          const form = new FormData();
          form.append("audio", blob, recorder.mimeType.includes("ogg") ? "voice.ogg" : "voice.webm");
          form.append("language", assistantLanguage);
          const { data } = await api.post<{ text: string; engine: string; model: string }>("/assistant/transcribe", form, {
            headers: { authorization: `Bearer ${sessionToken}` },
            timeout: 300_000
          });
          setText(data.text);
          setBusy(false);
          setTranscribing(false);
          handleCapturedVoice(data.text);
        } catch (error) {
          const message = axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : "Local speech transcription failed.";
          setReply({ kind: "answer", engine: "local", message });
          onError(message);
          setBusy(false);
          setTranscribing(false);
        }
      };
      recorder.start(500);
      return;
    }
    stream.getTracks().forEach((track) => track.stop());
    if (!Recognition) {
      const message = assistantLanguage === "hinglish" ? "Is browser mein local audio recording ya voice input support nahi hai. Command type kariye." : "This browser does not support local audio recording or voice input. Type the command.";
      setReply({ kind: "answer", engine: "local", message });
      return;
    }
    const recognition = new Recognition();
    recognition.lang = assistantLanguage === "hinglish" ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    // Short recognition cycles are more reliable in embedded Chromium. onend
    // restarts each cycle until the user explicitly presses Stop.
    recognition.continuous = false;
    recognition.maxAlternatives = 5;
    recognitionRef.current = recognition;
    keepListeningRef.current = true;
    transcriptRef.current = "";
    capturedTranscriptRef.current = "";
    setText("");
    setListening(true);
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const portion = String(event.results[index]?.[0]?.transcript || "").trim();
        if (!portion) continue;
        if (event.results[index].isFinal) transcriptRef.current = `${transcriptRef.current} ${portion}`.trim();
        else interim = `${interim} ${portion}`.trim();
      }
      const captured = `${transcriptRef.current} ${interim}`.trim();
      capturedTranscriptRef.current = captured;
      setText(captured);
    };
    recognition.onerror = (event: any) => {
      if (event?.error === "no-speech" && keepListeningRef.current) return;
      keepListeningRef.current = false;
      setListening(false);
      if (event?.error !== "aborted") {
        const code = String(event?.error || "unknown");
        const hinglishErrors: Record<string, string> = {
          "not-allowed": "Microphone permission blocked hai. Address bar mein mic ko Allow karein.",
          "service-not-allowed": "Is embedded browser ne speech service block ki hai. Same localhost page Chrome ya Edge mein kholiye.",
          "audio-capture": "Browser ko microphone device nahi mila. Windows input device check karein.",
          "network": "Browser speech service network se connect nahi hui. Internet/browser speech service check karein.",
          "language-not-supported": "Hindi speech language is browser mein supported nahi hai. English mode try karein.",
          "bad-grammar": "Browser ne speech vocabulary reject ki. Page refresh karke dobara try karein."
        };
        const englishErrors: Record<string, string> = {
          "not-allowed": "Microphone permission is blocked. Allow the microphone from the address bar.",
          "service-not-allowed": "This embedded browser blocked its speech service. Open the same localhost page in Chrome or Edge.",
          "audio-capture": "The browser could not find a microphone. Check the Windows input device.",
          "network": "The browser speech service could not connect. Check its network access.",
          "language-not-supported": "This browser does not support the selected speech language. Try English mode.",
          "bad-grammar": "The browser rejected the speech vocabulary. Refresh and try again."
        };
        const detail = assistantLanguage === "hinglish" ? hinglishErrors[code] : englishErrors[code];
        const message = detail || (assistantLanguage === "hinglish" ? `Voice recognition error: ${code}. Dobara Start dabakar try karein.` : `Voice recognition error: ${code}. Press Start and try again.`);
        setReply({ kind: "answer", engine: "local", message });
      }
    };
    recognition.onend = () => {
      if (keepListeningRef.current) {
        window.setTimeout(() => {
          try { recognition.start(); } catch { keepListeningRef.current = false; setListening(false); }
        }, 150);
        return;
      }
      setListening(false);
      recognitionRef.current = null;
      const transcript = capturedTranscriptRef.current.trim();
      transcriptRef.current = "";
      capturedTranscriptRef.current = "";
      if (transcript) handleCapturedVoice(transcript);
    };
    recognition.start();
  }

  function updateLine(index: number, patch: Partial<EditableDraft["lines"][number]>) {
    setDraft((current) => current ? { ...current, lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) } : current);
  }

  async function submitOrder() {
    if (!draft || !reply?.draft || busy) return;
    const sourceDraft = reply.draft;
    if (!draft.partyId) return onError(`Select a ${sourceDraft.partyLabel.toLowerCase()}.`);
    if (!draft.warehouseId) return onError("Select a warehouse.");
    if (draft.lines.some((line) => !line.productSku || Number(line.quantity) <= 0 || Number(line.rate) <= 0)) return onError("Every line needs a product, quantity greater than zero, and rate greater than zero.");
    if (sourceDraft.side === "Sales" && !canCreateSales) return onError("Your login does not have the Sales role required to create an SO.");
    if (sourceDraft.side === "Purchase" && !canCreatePurchase) return onError("Your login does not have the Purchaser role required to create a PO.");
    setBusy(true);
    onError("");
    try {
      const previousIds = new Set(sourceDraft.side === "Sales" ? groupSalesOrders(snapshot.salesOrders).map((group) => group.id) : groupPurchaseOrders(snapshot.purchaseOrders).map((group) => group.id));
      const lines = draft.lines.map((line, index) => {
        const candidate = sourceDraft.lines[index]?.candidates.find((item) => item.id === line.productSku);
        const common = {
          productSku: line.productSku,
          quantity: Number(line.quantity),
          rate: Number(line.rate),
          gstRate: candidate?.gstRate || 0,
          taxMode: candidate?.taxMode || "Exclusive"
        };
        return sourceDraft.side === "Sales"
          ? { ...common, cdTodRate: Number(line.rate), cdAmount: 0, todAmount: 0, availableStockAtOrder: snapshot.stockSummary.find((item) => item.productSku === line.productSku && item.warehouseId === draft.warehouseId)?.availableQuantity || 0 }
          : { ...common, quantityOrdered: Number(line.quantity), previousRate: candidate?.lastPurchaseRate || 0 };
      });
      const commonBody = {
        warehouseId: draft.warehouseId,
        paymentMode: draft.paymentMode,
        cashTiming: draft.paymentMode === "Cash" ? draft.cashTiming : undefined,
        deliveryMode: draft.deliveryMode,
        note: draft.note,
        lines
      };
      const endpoint = sourceDraft.side === "Sales" ? "/sales-orders/cart" : "/purchase-orders/cart";
      const body = sourceDraft.side === "Sales"
        ? { ...commonBody, shopId: draft.partyId, billingType: draft.billingType, allowProbationarySale: draft.allowProbationarySale }
        : { ...commonBody, supplierId: draft.partyId };
      const { data } = await api.post<AppSnapshot>(endpoint, body, { headers: { authorization: `Bearer ${sessionToken}` } });
      onSnapshot(data);
      const groups = sourceDraft.side === "Sales" ? groupSalesOrders(data.salesOrders) : groupPurchaseOrders(data.purchaseOrders);
      const created = groups.find((group) => !previousIds.has(group.id));
      const message = `${sourceDraft.side === "Sales" ? "Sales order" : "Purchase order"}${created ? ` ${created.id}` : ""} created successfully.`;
      setReply({ kind: "answer", engine: reply.engine, message });
      setDraft(null);
      setOrderThread(null);
      setText("");
      onMessage(message);
      speak(message, assistantLanguage);
    } catch (error) {
      const message = axios.isAxiosError(error) ? String(error.response?.data?.message || error.message) : "Order creation failed.";
      onError(message);
      setReply((current) => current ? { ...current, message } : { kind: "answer", engine: "local", message });
      speak(message, assistantLanguage);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button className={open ? "assistant-launcher is-open" : "assistant-launcher"} type="button" onClick={() => setOpen((current) => !current)} aria-label="Open voice assistant">
      <span aria-hidden="true">{listening ? "●" : "AI"}</span>
      <small>{listening ? "Recording" : transcribing ? "Local STT" : "Ask"}</small>
    </button>
    {open ? <section className="assistant-panel" aria-label="Aapoorti voice assistant">
      <header className="assistant-head">
        <div><span className="eyebrow">Aapoorti AI</span><h2>Voice order assistant</h2></div>
        <div className="assistant-head-actions"><select aria-label="Assistant language" value={assistantLanguage} onChange={(event) => setAssistantLanguage(event.target.value as "english" | "hinglish")}><option value="hinglish">Hinglish + Hindi voice</option><option value="english">English</option></select><button className="ghost-button compact-icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close assistant">×</button></div>
      </header>
      <div className="assistant-examples">
        <button type="button" onClick={() => void ask(assistantLanguage === "hinglish" ? "Sabse zyada margin wale sabun dikhao" : "Show soaps with highest margin")}>{assistantLanguage === "hinglish" ? "Sabse zyada margin" : "Highest-margin soaps"}</button>
        <button type="button" onClick={() => void ask(assistantLanguage === "hinglish" ? "Sabse zyada bikri wale product batao" : "Show products with highest sales")}>{assistantLanguage === "hinglish" ? "Sabse zyada sales" : "Highest sales"}</button>
        <button type="button" onClick={() => { setText("Create SO for customer: 10 product name at rate 50"); }}>SO example</button>
        <button type="button" onClick={() => { setText("Create PO from supplier: 20 product name at rate 40"); }}>PO example</button>
      </div>
      <form className="assistant-input-row" onSubmit={(event) => { event.preventDefault(); void ask(); }}>
        <textarea value={text} onChange={(event) => setText(event.target.value)} placeholder={assistantLanguage === "hinglish" ? "Boliye ya type kariye: Gupta Store ke liye 10 Lux rate 42 ka SO banao" : "Speak or type: Create SO for Gupta Store: 10 Lux at 42"} rows={2} />
        <button className={listening ? "assistant-mic active" : "assistant-mic"} type="button" onClick={listen} disabled={transcribing} aria-label={listening ? "Stop voice input" : "Start voice input"}>{listening ? "Stop" : "🎙"}</button>
        <button className="primary-button" type="submit" disabled={busy || !text.trim()}>{busy ? "Working…" : "Ask"}</button>
      </form>
      {listening ? <div className="assistant-listening-note"><strong>Listening…</strong><span>{assistantLanguage === "hinglish" ? "Pause le sakte hain. Pura bolne ke baad Stop dabaiye." : "Pauses are okay. Press Stop when you are finished."}</span></div> : null}
      {transcribing ? <div className="assistant-listening-note"><strong>Local Whisper…</strong><span>{assistantLanguage === "hinglish" ? "Recording isi computer par process ho rahi hai. Pehli baar model load hone mein thoda samay lagega." : "The recording is processing on this computer. First model load can take a little longer."}</span></div> : null}
      {orderThread ? <div className="assistant-thread-bar"><span><strong>{orderThread.side === "Sales" ? "SO" : orderThread.side === "Purchase" ? "PO" : "Order"} thread active</strong> · {orderThread.commands.length} voice/text turn{orderThread.commands.length === 1 ? "" : "s"}</span><button type="button" onClick={cancelOrderThread}>Clear thread</button></div> : null}
      {reply ? <div className="assistant-response">
        <div className="assistant-response-head"><strong>{reply.message}</strong><div className="assistant-response-actions"><button type="button" onClick={() => speak(reply.spokenMessage || reply.message, assistantLanguage)} aria-label="Replay assistant answer">🔊 {assistantLanguage === "hinglish" ? "Suno" : "Listen"}</button><span>{reply.engine === "openai" ? "AI interpretation" : "Offline assistant"}</span></div></div>
        {reply.analytics ? <>
          <div className="assistant-table-wrap"><table className="assistant-table"><thead><tr><th>Product</th><th>Sales</th><th>Qty</th><th>Cost</th><th>Sell</th><th>Margin</th></tr></thead><tbody>
            {reply.analytics.rows.map((row) => <tr key={row.sku}><td><strong>{row.product}</strong><small>{row.sku}</small></td><td>{currency(row.salesValue)}</td><td>{row.quantitySold}</td><td>{currency(row.purchaseCost)}</td><td>{currency(row.sellingRate)}</td><td className={row.marginAmount < 0 ? "negative-value" : "positive-value"}>{currency(row.marginAmount)}<small>{row.marginPercent.toFixed(1)}%</small></td></tr>)}
          </tbody></table></div>
          <p className="assistant-footnote">{reply.analytics.costBasis}</p>
        </> : null}
        {draft && reply.draft ? <div className="assistant-order-draft">
          <div className="assistant-draft-badge">{reply.draft.side === "Sales" ? "SO draft" : "PO draft"} · review required</div>
          <div className="assistant-grid">
            <label>{reply.draft.partyLabel}<select value={draft.partyId} onChange={(event) => setDraft((current) => current ? { ...current, partyId: event.target.value } : current)}><option value="">Select</option>{reply.draft.partyCandidates.map((item) => <option key={item.id} value={item.id}>{item.label}{item.detail ? ` · ${item.detail}` : ""}</option>)}</select></label>
            <label>Warehouse<select value={draft.warehouseId} onChange={(event) => setDraft((current) => current ? { ...current, warehouseId: event.target.value } : current)}><option value="">Select</option>{reply.draft.warehouseCandidates.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.detail}</option>)}</select></label>
            {reply.draft.side === "Sales" ? <label>Billing<select value={draft.billingType} onChange={(event) => setDraft((current) => current ? { ...current, billingType: event.target.value as "B2B" | "B2C" } : current)}><option>B2C</option><option>B2B</option></select></label> : null}
            <label>Payment<select value={draft.paymentMode} onChange={(event) => setDraft((current) => current ? { ...current, paymentMode: event.target.value as PaymentMode } : current)}>{snapshot.settings.paymentMethods.filter((item) => item.active).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            {draft.paymentMode === "Cash" ? <label>Cash timing<select value={draft.cashTiming} onChange={(event) => setDraft((current) => current ? { ...current, cashTiming: event.target.value } : current)}><option>In Hand</option><option>At Delivery</option><option>Later</option></select></label> : null}
            <label>Delivery<select value={draft.deliveryMode} onChange={(event) => setDraft((current) => current ? { ...current, deliveryMode: event.target.value } : current)}>{reply.draft.side === "Sales" ? <><option>Delivery</option><option>Self Collection</option></> : <><option>Dealer Delivery</option><option>Self Collection</option></>}</select></label>
          </div>
          <div className="assistant-lines">
            {draft.lines.map((line, index) => <article key={`${activeProductCandidates[index]?.query}-${index}`} className="assistant-line-card">
              <div><span className="small-label">Heard</span><strong>{activeProductCandidates[index]?.query || `Product ${index + 1}`}</strong></div>
              <label>Closest product<select value={line.productSku} onChange={(event) => {
                const selected = activeProductCandidates[index]?.candidates.find((item) => item.id === event.target.value);
                updateLine(index, { productSku: event.target.value, rate: Number(line.rate) > 0 ? line.rate : String(selected?.lastPurchaseRate || 0) });
              }}><option value="">Select match</option>{activeProductCandidates[index]?.candidates.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.detail}</option>)}</select></label>
              <label>Quantity<input type="number" min="0.01" step="any" value={line.quantity} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
              <label>Rate<input type="number" min="0.01" step="any" value={line.rate} onChange={(event) => updateLine(index, { rate: event.target.value })} /></label>
            </article>)}
          </div>
          {reply.draft.side === "Sales" ? <label className="checkbox-line assistant-warning-check"><input type="checkbox" checked={draft.allowProbationarySale} onChange={(event) => setDraft((current) => current ? { ...current, allowProbationarySale: event.target.checked } : current)} />Allow confirmed probationary sale if quantity exceeds warehouse stock</label> : null}
          <label>Order note<textarea rows={2} value={draft.note} onChange={(event) => setDraft((current) => current ? { ...current, note: event.target.value } : current)} /></label>
          <div className="assistant-confirm-row"><button className="ghost-button danger-button" type="button" onClick={cancelOrderThread}>Cancel draft</button><button className="primary-button" type="button" disabled={busy} onClick={() => void submitOrder()}>{busy ? "Creating…" : `Confirm & create ${reply.draft.side === "Sales" ? "SO" : "PO"}`}</button></div>
          <p className="assistant-footnote">Add more details in another voice turn, or say “confirm order” / “ऑर्डर कन्फर्म करो”. The temporary thread is cleared after confirm or cancel.</p>
        </div> : null}
      </div> : <div className="assistant-empty"><strong>{assistantLanguage === "hinglish" ? "Normal Hindi, Hinglish ya English mein poochhiye." : "Ask in normal language."}</strong><p>{assistantLanguage === "hinglish" ? "Main SO/PO draft bana sakta hoon aur margin ya sales ka jawab de sakta hoon." : "I can prepare SO/PO drafts and answer margin or sales questions."}</p></div>}
    </section> : null}
  </>;
}
