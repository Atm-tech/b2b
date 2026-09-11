import { useCallback, useEffect, useRef, useState } from "react";

export function useGuideNarration(text: string, stepKey: string) {
  const [status, setStatus] = useState<"playing" | "ready" | "ended" | "blocked" | "unsupported">("ready");
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => {
    generation.current += 1;
    clearTimeout(timer.current);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  const play = useCallback(() => {
    stop();
    if (!("speechSynthesis" in window)) { setStatus("unsupported"); return; }
    const run = generation.current;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    utterance.rate = 0.9;
    const voice = window.speechSynthesis.getVoices().find(v => v.lang.toLowerCase().startsWith("hi"));
    if (voice) utterance.voice = voice;
    const active = () => run === generation.current;
    utterance.onstart = () => { if (active()) { clearTimeout(timer.current); setStatus("playing"); } };
    utterance.onend = () => { if (active()) { clearTimeout(timer.current); setStatus("ended"); } };
    utterance.onerror = () => { if (active()) { clearTimeout(timer.current); setStatus("blocked"); } };
    setStatus("ready");
    // Some browsers silently reject autoplay instead of dispatching an error.
    timer.current = setTimeout(() => { if (active()) { stop(); setStatus("blocked"); } }, 4000);
    try { window.speechSynthesis.speak(utterance); } catch { stop(); setStatus("blocked"); }
  }, [stop, text]);
  useEffect(() => { play(); return stop; }, [stepKey, play, stop]);
  useEffect(() => {
    const onHide = () => { if (document.hidden) { stop(); setStatus("ended"); } };
    const onPageHide = () => stop();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", onPageHide);
    return () => { stop(); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("pagehide", onPageHide); };
  }, [stop]);
  return { status, play, pause: () => { stop(); setStatus("ended"); } };
}
