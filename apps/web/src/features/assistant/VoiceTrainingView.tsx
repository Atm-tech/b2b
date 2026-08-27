import axios from "axios";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { api } from "../../app/shared";

type VoiceTrainingExample = {
  id: string;
  title: string;
  commandText: string;
  recognizedText: string;
  trainingModule: string;
  actionType: string;
  actionGuide: string;
  language: string;
  audioFileName?: string;
  audioMimeType?: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

type RecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const actionTypes = [
  "Add product to draft",
  "Remove product from draft",
  "Create sales order",
  "Create purchase order",
  "Update quantity or rate",
  "Select customer or supplier",
  "Confirm order",
  "Cancel order",
  "Answer analytics question",
  "Custom assistant behavior"
];

const trainingModules = ["Sales", "Purchase", "Accounts", "Delivery Manager", "Delivery Guy", "Admin"] as const;

const moduleDescriptions: Record<(typeof trainingModules)[number], string> = {
  Sales: "Customer orders, products, quantities, rates, and collections",
  Purchase: "Supplier orders, buying rates, receipts, and returns",
  Accounts: "Payments, ledgers, vouchers, balances, and reports",
  "Delivery Manager": "Assignments, routes, dockets, handovers, and exceptions",
  "Delivery Guy": "Pickup, delivery, proof, cash collection, and status updates",
  Admin: "Users, settings, master data, audits, and system controls"
};

const emptyForm = {
  title: "",
  commandText: "",
  recognizedText: "",
  trainingModule: "Sales",
  actionType: actionTypes[0],
  actionGuide: "",
  language: "hinglish"
};

function errorMessage(error: unknown) {
  return axios.isAxiosError(error)
    ? String(error.response?.data?.message || error.message)
    : error instanceof Error ? error.message : "Voice trainer action failed.";
}

export function VoiceTrainingView({ sessionToken, onMessage, onError }: {
  sessionToken: string;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [examples, setExamples] = useState<VoiceTrainingExample[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recognitionRef = useRef<RecognitionInstance | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const finalTranscriptRef = useRef("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    void loadExamples();
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      recognitionRef.current?.stop();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadExamples() {
    setLoading(true);
    try {
      const { data } = await api.get<VoiceTrainingExample[]>("/assistant/training-examples", {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setExamples(data);
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  function clearSample() {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (audioFileInputRef.current) audioFileInputRef.current.value = "";
    setAudioUrl("");
    setAudioBlob(null);
    setRecordingSeconds(0);
  }

  async function startRecording() {
    onError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("This browser cannot record a voice sample. Open the page in Chrome or Edge.");
      return;
    }
    try {
      clearSample();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"].find((item) => MediaRecorder.isTypeSupported(item));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const speechWindow = window as typeof window & {
        SpeechRecognition?: new () => RecognitionInstance;
        webkitSpeechRecognition?: new () => RecognitionInstance;
      };
      const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
      finalTranscriptRef.current = "";
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size > 0) chunksRef.current.push(event.data); };
      recorder.onerror = () => {
        onError("Voice sample recording failed. Check the microphone and try again.");
        stopRecording();
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size > 0) {
          const url = URL.createObjectURL(blob);
          setAudioBlob(blob);
          setAudioUrl(url);
        }
        const transcript = finalTranscriptRef.current.trim();
        setForm((current) => ({
          ...current,
          recognizedText: transcript || current.recognizedText,
          commandText: current.commandText.trim() ? current.commandText : transcript
        }));
      };
      if (Recognition) {
        const recognition = new Recognition();
        recognition.lang = form.language === "english" ? "en-IN" : "hi-IN";
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (event: any) => {
          let interim = "";
          for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
            const text = String(event.results[index]?.[0]?.transcript || "").trim();
            if (!text) continue;
            if (event.results[index].isFinal) finalTranscriptRef.current = `${finalTranscriptRef.current} ${text}`.trim();
            else interim = `${interim} ${text}`.trim();
          }
          setForm((current) => ({ ...current, recognizedText: `${finalTranscriptRef.current} ${interim}`.trim() }));
        };
        recognition.onerror = (event: any) => {
          if (event?.error !== "no-speech" && event?.error !== "aborted") onError(`Live transcript error: ${String(event?.error || "unknown")}. The audio sample will still be saved.`);
        };
        recognitionRef.current = recognition;
        try { recognition.start(); } catch { recognitionRef.current = null; }
      }
      recorder.start(400);
      setRecordingSeconds(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    } catch (error) {
      onError(error instanceof DOMException && error.name === "NotAllowedError"
        ? "Microphone permission is blocked. Allow it in the address bar and try again."
        : errorMessage(error));
    }
  }

  function stopRecording() {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
  }

  function chooseAudioFile(file?: File) {
    if (!file) return;
    clearSample();
    setAudioBlob(file);
    setAudioUrl(URL.createObjectURL(file));
  }

  async function saveExample(event: FormEvent) {
    event.preventDefault();
    if (!audioBlob) return onError("Record or upload one voice sample before saving.");
    if (!form.title.trim() || !form.commandText.trim() || !form.actionGuide.trim()) return onError("Title, command text, and action guide are required.");
    setSaving(true);
    onError("");
    try {
      const payload = new FormData();
      Object.entries(form).forEach(([key, value]) => payload.append(key, value));
      const extension = audioBlob.type.includes("ogg") ? "ogg" : audioBlob.type.includes("wav") ? "wav" : "webm";
      payload.append("audio", audioBlob, `voice-training-${Date.now()}.${extension}`);
      const { data } = await api.post<VoiceTrainingExample[]>("/assistant/training-examples", payload, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setExamples(data);
      setForm(emptyForm);
      clearSample();
      onMessage("Voice training example saved.");
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function updateExample(example: VoiceTrainingExample, patch: Partial<VoiceTrainingExample>) {
    onError("");
    try {
      const { data } = await api.patch<VoiceTrainingExample[]>(`/assistant/training-examples/${encodeURIComponent(example.id)}`, { ...example, ...patch }, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setExamples(data);
      onMessage(patch.active === false ? "Training example paused." : "Training example updated.");
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function deleteExample(example: VoiceTrainingExample) {
    if (!window.confirm(`Delete voice training example “${example.title}”?`)) return;
    onError("");
    try {
      const { data } = await api.delete<VoiceTrainingExample[]>(`/assistant/training-examples/${encodeURIComponent(example.id)}`, {
        headers: { authorization: `Bearer ${sessionToken}` }
      });
      setExamples(data);
      onMessage("Voice training example deleted.");
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  async function playExample(example: VoiceTrainingExample) {
    try {
      const { data } = await api.get<Blob>(`/assistant/training-examples/${encodeURIComponent(example.id)}/audio`, {
        headers: { authorization: `Bearer ${sessionToken}` },
        responseType: "blob"
      });
      const url = URL.createObjectURL(data);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (error) {
      onError(errorMessage(error));
    }
  }

  const filteredExamples = useMemo(() => {
    const query = search.trim().toLowerCase();
    return examples.filter((example) => {
      if (moduleFilter !== "All" && example.trainingModule !== moduleFilter) return false;
      return !query || [example.title, example.commandText, example.recognizedText, example.trainingModule, example.actionType, example.actionGuide].some((value) => value.toLowerCase().includes(query));
    });
  }, [examples, moduleFilter, search]);

  return <section className="voice-trainer-page">
    <header className="voice-trainer-hero">
      <div><span className="eyebrow">Admin · Assistant workshop</span><h1>Module Voice Trainer</h1><p>Build separate command libraries for Sales, Purchase, Accounts, delivery teams, and system administration.</p></div>
      <div className="voice-trainer-stats"><strong>{examples.length}</strong><span>saved examples</span><strong>{examples.filter((item) => item.active).length}</strong><span>active</span></div>
    </header>

    <div className="voice-trainer-layout">
      <form className="voice-training-form panel" onSubmit={saveExample}>
        <div className="voice-training-section-head"><div><span className="eyebrow">New example</span><h2>Teach one command</h2></div><span className="voice-training-step">1 → 2 → 3</span></div>
        <label>Target module<select value={form.trainingModule} onChange={(event) => setForm((current) => ({ ...current, trainingModule: event.target.value }))}>{trainingModules.map((module) => <option key={module}>{module}</option>)}</select><small>{moduleDescriptions[form.trainingModule as keyof typeof moduleDescriptions]}</small></label>
        <label>Example name<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Add product without quantity" /></label>
        <div className="voice-training-record-card">
          <div><strong>1. Capture a real voice sample</strong><span>Speak naturally, including pauses and pronunciation mistakes.</span></div>
          <div className="voice-training-record-actions">
            <button className={recording ? "danger-button" : "primary-button"} type="button" onClick={recording ? stopRecording : startRecording}>{recording ? `Stop · ${recordingSeconds}s` : "🎙 Record sample"}</button>
            <label className="ghost-button voice-upload-button">Upload audio<input ref={audioFileInputRef} type="file" accept="audio/*,video/webm" onChange={(event) => chooseAudioFile(event.target.files?.[0])} /></label>
            {audioBlob ? <button className="ghost-button danger-text" type="button" onClick={clearSample}>Delete sample audio</button> : null}
          </div>
          {recording ? <div className="voice-recording-live"><span />Listening and recording…</div> : null}
          {audioUrl ? <audio className="voice-training-audio" controls src={audioUrl} /> : null}
        </div>
        <label>What the browser recognized<textarea rows={2} value={form.recognizedText} onChange={(event) => setForm((current) => ({ ...current, recognizedText: event.target.value }))} placeholder="Raw transcript appears here while recording" /></label>
        <label>2. Correct command text<textarea rows={2} value={form.commandText} onChange={(event) => setForm((current) => ({ ...current, commandText: event.target.value }))} placeholder="Example: Ek Coca-Cola aur add karo" /></label>
        <div className="voice-training-two-fields">
          <label>Language<select value={form.language} onChange={(event) => setForm((current) => ({ ...current, language: event.target.value }))}><option value="hinglish">Hindi / Hinglish</option><option value="english">English</option></select></label>
          <label>Expected action<select value={form.actionType} onChange={(event) => setForm((current) => ({ ...current, actionType: event.target.value }))}>{actionTypes.map((action) => <option key={action}>{action}</option>)}</select></label>
        </div>
        <label>3. Guide: what should the assistant do?<textarea rows={5} value={form.actionGuide} onChange={(event) => setForm((current) => ({ ...current, actionGuide: event.target.value }))} placeholder="Example: Add the best matching Coca-Cola SKU to the current draft. If quantity is missing, use 1. If size is unclear, show size choices instead of dropping the product." /></label>
        <div className="voice-training-tip"><strong>Good guide</strong><span>State defaults, required questions, and what must never be guessed.</span></div>
        <button className="primary-button" type="submit" disabled={saving || recording}>{saving ? "Saving example…" : "Save training example"}</button>
      </form>

      <section className="voice-training-library panel">
        <div className="voice-training-section-head"><div><span className="eyebrow">Training library</span><h2>Saved commands</h2></div></div>
        <div className="voice-module-filters">
          {["All", ...trainingModules].map((module) => <button className={moduleFilter === module ? "voice-module-filter active" : "voice-module-filter"} type="button" key={module} onClick={() => { setModuleFilter(module); if (module !== "All") setForm((current) => ({ ...current, trainingModule: module })); }}><span>{module}</span><strong>{module === "All" ? examples.length : examples.filter((example) => example.trainingModule === module).length}</strong></button>)}
        </div>
        <input className="voice-training-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search command, action, or guide" />
        {loading ? <p className="muted">Loading training examples…</p> : null}
        {!loading && filteredExamples.length === 0 ? <div className="voice-training-empty"><strong>No training examples yet</strong><span>Record the first command using the form.</span></div> : null}
        <div className="voice-training-list">{filteredExamples.map((example) => <article className={example.active ? "voice-training-item" : "voice-training-item is-paused"} key={example.id}>
          <div className="voice-training-item-head"><div><div className="voice-training-badges"><span className="voice-training-module">{example.trainingModule}</span><span className="voice-training-action">{example.actionType}</span></div><h3>{example.title}</h3></div><label className="voice-training-toggle"><input type="checkbox" checked={example.active} onChange={(event) => void updateExample(example, { active: event.target.checked })} /><span>{example.active ? "Active" : "Paused"}</span></label></div>
          <div className="voice-training-command"><span>Command</span><strong>“{example.commandText}”</strong></div>
          {example.recognizedText && example.recognizedText !== example.commandText ? <p><span>Heard:</span> {example.recognizedText}</p> : null}
          <p className="voice-training-guide"><span>Guide:</span> {example.actionGuide}</p>
          <footer><small>{example.language === "english" ? "English" : "Hindi / Hinglish"} · by {example.createdBy} · {new Date(example.createdAt).toLocaleDateString("en-IN")}</small><div>{example.audioFileName ? <button className="ghost-button" type="button" onClick={() => void playExample(example)}>▶ Play</button> : null}<button className="ghost-button danger-text" type="button" onClick={() => void deleteExample(example)}>Delete</button></div></footer>
        </article>)}</div>
      </section>
    </div>
  </section>;
}
