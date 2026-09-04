import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

type SpeechResult = { text: string; language: string; language_probability: number; model: string };
type PendingRequest = { resolve: (value: SpeechResult) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout };

const workerPath = fileURLToPath(new URL("../../../scripts/local_speech_worker.py", import.meta.url));
const pending = new Map<string, PendingRequest>();
let worker: ChildProcessWithoutNullStreams | null = null;
let sequence = 0;

function failPending(message: string) {
  pending.forEach(({ reject, timeout }) => { clearTimeout(timeout); reject(new Error(message)); });
  pending.clear();
}

function ensureWorker() {
  if (worker && !worker.killed) return worker;
  worker = spawn(process.env.LOCAL_WHISPER_PYTHON || "python", [workerPath], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
    windowsHide: true
  });
  worker.stderr.on("data", (chunk) => process.stderr.write(`[local-whisper] ${String(chunk)}`));
  createInterface({ input: worker.stdout }).on("line", (line) => {
    try {
      const message = JSON.parse(line) as { id?: string; result?: SpeechResult; error?: string };
      if (!message.id) return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(message.error));
      else if (message.result) request.resolve(message.result);
      else request.reject(new Error("Local speech worker returned no result."));
    } catch (error) {
      console.error("Invalid local speech worker response", error, line);
    }
  });
  worker.on("exit", (code) => {
    worker = null;
    failPending(`Local speech worker stopped (${code ?? "unknown"}).`);
  });
  worker.on("error", (error) => {
    worker = null;
    failPending(`Could not start local speech worker: ${error.message}`);
  });
  return worker;
}

export function transcribeLocalAudio(audioPath: string, prompt: string, language = "hi") {
  const id = `speech-${Date.now()}-${sequence += 1}`;
  const child = ensureWorker();
  return new Promise<SpeechResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Local speech transcription timed out."));
    }, Number(process.env.LOCAL_WHISPER_TIMEOUT_MS || 240_000));
    pending.set(id, { resolve, reject, timeout });
    child.stdin.write(`${JSON.stringify({ id, audio_path: audioPath, prompt, language })}\n`);
  });
}

export function warmLocalSpeechModel() {
  if (process.env.LOCAL_WHISPER_ENABLED === "false") return;
  if (process.env.NODE_ENV === "production" && process.env.LOCAL_WHISPER_ENABLED !== "true") return;
  const child = ensureWorker();
  child.stdin.write(`${JSON.stringify({ id: "warmup", action: "warmup" })}\n`);
}
