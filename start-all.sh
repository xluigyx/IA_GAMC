#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# GAMC — Arranca todo el stack local (voz + IA) en una sola terminal.
#   1. Servicio Whisper STT  (Python, :5001)  → reconocimiento de voz local
#   2. Backend Express        (Node,   :3000)  → API + Ollama
#   3. Frontend Vite          (React,  :5173)  → interfaz
#
# Uso:  ./start-all.sh        (Ctrl+C detiene todo)
# Requisitos: Ollama corriendo, PostgreSQL y MongoDB activos.
# ─────────────────────────────────────────────────────────────────────────────
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "🏛️  GAMC — arrancando stack local..."

# Limpieza al salir: mata los procesos hijos
pids=()
cleanup() {
  echo ""
  echo "🛑 Deteniendo servicios..."
  for pid in "${pids[@]}"; do kill "$pid" 2>/dev/null || true; done
  exit 0
}
trap cleanup INT TERM

# 1) Whisper STT (voz local)
if [ ! -d "$ROOT/whisper-service/.venv" ]; then
  echo "❌ Falta el venv de Whisper. Ejecuta primero:"
  echo "   cd whisper-service && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
  exit 1
fi
echo "🎤 [1/3] Whisper STT  → http://127.0.0.1:5001"
( cd "$ROOT/whisper-service" && .venv/bin/python app.py ) &
pids+=($!)

# 2) Backend
echo "🤖 [2/3] Backend      → http://localhost:3000"
( cd "$ROOT/gamc-backend" && npm run dev ) &
pids+=($!)

# 3) Frontend
echo "💻 [3/3] Frontend     → http://localhost:5173"
( cd "$ROOT/gamc-frontend" && npm run dev ) &
pids+=($!)

echo ""
echo "✅ Todo arrancando. Abre http://localhost:5173 y usa el botón 🎤"
echo "   (Ctrl+C para detener todo)"
wait
