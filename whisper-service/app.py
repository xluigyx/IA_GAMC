# whisper-service/app.py
# ─────────────────────────────────────────────────────────────────────────────
# Microservicio de Reconocimiento de Voz LOCAL para el sistema GAMC
# Speech-to-Text 100% offline con faster-whisper (sin enviar audio a la nube).
#
# Flujo:  Backend Express  ──POST /transcribe (audio)──▶  este servicio
#         este servicio    ──{ "text": "..." }────────▶  Backend  ──▶  Ollama
#
# El modelo se carga UNA sola vez al arrancar (no por petición) para baja latencia.
# La primera vez descarga el modelo desde HuggingFace (~480MB para "small");
# luego queda en caché local y funciona 100% sin internet.
# ─────────────────────────────────────────────────────────────────────────────
import os
import tempfile
import time
from flask import Flask, request, jsonify
from faster_whisper import WhisperModel

# ── Configuración (override por variables de entorno) ────────────────────────
MODEL_SIZE   = os.environ.get("WHISPER_MODEL", "small")     # tiny|base|small|medium|large-v3
DEVICE       = os.environ.get("WHISPER_DEVICE", "cpu")      # "cpu" o "cuda" (GTX 1650)
COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE", "int8")    # int8 (CPU) | float16 (GPU)
LANGUAGE     = os.environ.get("WHISPER_LANG", "es")         # español fijo
PORT         = int(os.environ.get("WHISPER_PORT", "5001"))

app = Flask(__name__)

print(f"[Whisper] Cargando modelo '{MODEL_SIZE}' en {DEVICE} ({COMPUTE_TYPE})...")
print("[Whisper] (la primera vez descarga el modelo; luego es 100% offline)")
_t0 = time.time()
model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
print(f"[Whisper] ✅ Modelo listo en {time.time() - _t0:.1f}s")


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "service": "GAMC Whisper STT",
        "model": MODEL_SIZE,
        "device": DEVICE,
        "compute_type": COMPUTE_TYPE,
        "language": LANGUAGE,
    })


@app.post("/transcribe")
def transcribe():
    """Recibe un archivo de audio (campo 'audio') y devuelve la transcripción."""
    if "audio" not in request.files:
        return jsonify({"error": "No se envió ningún archivo de audio (campo 'audio')."}), 400

    audio_file = request.files["audio"]
    if audio_file.filename == "":
        return jsonify({"error": "Archivo de audio vacío."}), 400

    # Guardar el blob en un temporal — faster-whisper (PyAV) decodifica webm/ogg/wav.
    suffix = os.path.splitext(audio_file.filename)[1] or ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            audio_file.save(tmp.name)
            tmp_path = tmp.name

        t0 = time.time()
        segments, info = model.transcribe(
            tmp_path,
            language=LANGUAGE,
            beam_size=5,
            vad_filter=True,                                   # corta silencios → más rápido y limpio
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=False,                  # evita alucinaciones en clips cortos
        )
        text = " ".join(seg.text.strip() for seg in segments).strip()
        latency_ms = int((time.time() - t0) * 1000)

        print(f"[Whisper] Transcrito en {latency_ms}ms "
              f"(dur audio: {info.duration:.1f}s, prob idioma: {info.language_probability:.2f}): "
              f"\"{text[:80]}\"")

        return jsonify({
            "text": text,
            "language": info.language,
            "language_probability": round(info.language_probability, 3),
            "audio_duration_s": round(info.duration, 2),
            "latency_ms": latency_ms,
        })
    except Exception as e:
        print(f"[Whisper] ❌ Error: {e}")
        return jsonify({"error": f"Error al transcribir: {e}"}), 500
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


if __name__ == "__main__":
    # threaded=False: una transcripción a la vez (el modelo no es thread-safe en CPU int8)
    app.run(host="127.0.0.1", port=PORT, threaded=False)
