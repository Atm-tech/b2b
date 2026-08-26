"""Persistent zero-cost speech-to-text worker for the Aapoorti assistant."""

import json
import os
import sys
import traceback

from faster_whisper import WhisperModel


MODEL_NAME = os.environ.get("LOCAL_WHISPER_MODEL", "small")
CPU_THREADS = int(os.environ.get("LOCAL_WHISPER_THREADS", "6"))
_model = None


def model():
    global _model
    if _model is None:
        print(f"Loading local Whisper model {MODEL_NAME} (cpu/int8)...", file=sys.stderr, flush=True)
        _model = WhisperModel(MODEL_NAME, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)
        print("Local Whisper model ready.", file=sys.stderr, flush=True)
    return _model


def transcribe(request):
    prompt = str(request.get("prompt") or "")[:3000]
    language = request.get("language") or None
    segments, info = model().transcribe(
        request["audio_path"],
        language=language,
        task="transcribe",
        beam_size=5,
        best_of=5,
        condition_on_previous_text=False,
        vad_filter=True,
        vad_parameters={"min_silence_duration_ms": 650, "speech_pad_ms": 250},
        # faster-whisper combines initial_prompt and hotwords in the decoder
        # context. Supplying the same database vocabulary to both can exceed
        # Whisper's 448-position limit before decoding starts. Hotwords are
        # already capped safely by faster-whisper and are the right mechanism
        # for party/product pronunciation hints.
        initial_prompt=None,
        hotwords=prompt or None,
        word_timestamps=False,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    return {
        "text": text,
        "language": info.language,
        "language_probability": info.language_probability,
        "model": MODEL_NAME,
    }


def main():
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if request.get("action") == "warmup":
                model()
                result = {"ready": True, "model": MODEL_NAME}
            else:
                result = transcribe(request)
            print(json.dumps({"id": request.get("id"), "result": result}, ensure_ascii=False), flush=True)
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            request_id = request.get("id") if isinstance(request, dict) else None
            print(json.dumps({"id": request_id, "error": str(error)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if "--warmup" in sys.argv:
        model()
    else:
        main()
