# 🎤 Servicio Whisper STT — Reconocimiento de Voz LOCAL (GAMC)

Microservicio de **Speech-to-Text 100% offline** para el sistema de denuncias.
Convierte el audio hablado del ciudadano en texto usando
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) — **sin enviar nada a la nube**.

## Pipeline

```
Navegador (graba audio con MediaRecorder)
   │  POST /api/v1/voice/transcribe   (audio .webm)
   ▼
Backend Express (multer recibe el audio)
   │  reenvía a este servicio
   ▼
Whisper local  ──▶  { "text": "..." }
   ▼
El texto llena el formulario → Ollama clasifica la denuncia
```

## Instalación (solo la primera vez)

```bash
cd whisper-service
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Arrancar el servicio

```bash
cd whisper-service
.venv/bin/python app.py
```

- La **primera vez** descarga el modelo desde HuggingFace (~480 MB para `small`).
- Después funciona **100% sin internet**.
- Escucha en `http://127.0.0.1:5001`.

Verificar que está vivo:

```bash
curl http://127.0.0.1:5001/health
```

## Configuración (variables de entorno opcionales)

| Variable          | Default | Descripción                                        |
|-------------------|---------|----------------------------------------------------|
| `WHISPER_MODEL`   | `small` | `tiny`/`base`/`small`/`medium`/`large-v3`          |
| `WHISPER_DEVICE`  | `cpu`   | `cpu` o `cuda` (si tienes GPU NVIDIA configurada)  |
| `WHISPER_COMPUTE` | `int8`  | `int8` (CPU) · `float16` (GPU)                     |
| `WHISPER_LANG`    | `es`    | Idioma fijo (español)                              |
| `WHISPER_PORT`    | `5001`  | Puerto del servicio                                |

Ejemplo (modelo más preciso):

```bash
WHISPER_MODEL=medium .venv/bin/python app.py
```

> 💡 **Precisión vs velocidad:** `base` es el más rápido, `small` es buen equilibrio
> (default), `medium` es más preciso para jerga local pero más lento en CPU.

## Probar manualmente

```bash
curl -X POST http://127.0.0.1:5001/transcribe -F "audio=@grabacion.webm"
```
