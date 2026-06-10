// src/controllers/VoiceController.ts
// ─────────────────────────────────────────────────────────────────────────────
// Controlador de Transcripción de Voz LOCAL (Speech-to-Text) — GAMC
// Recibe el audio grabado en el navegador y lo reenvía al microservicio Whisper
// (faster-whisper, 100% offline). Devuelve el texto para que el ciudadano lo
// revise antes de enviarlo a clasificar con Ollama (POST /api/v1/complaints).
//
//   Navegador ──audio.webm──▶ ESTE controlador ──▶ Whisper (:5001) ──▶ { text }
// ─────────────────────────────────────────────────────────────────────────────

import { Request, Response } from 'express';

// URL del microservicio Whisper local (configurable por entorno)
const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:5001';

// ============================================================
// CONTROLADOR: POST /api/v1/voice/transcribe
// Entrada:  multipart/form-data con campo "audio" (blob del navegador)
// Salida:   { success, text, metrics }
// ============================================================
export async function transcribeVoice(req: Request, res: Response): Promise<void> {
  const startTime = Date.now();

  try {
    // ── FASE 1: Validar que llegó el audio (multer lo deja en req.file) ───────
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: 'No se recibió ningún audio. Envía el campo "audio" (multipart/form-data).',
      });
      return;
    }

    console.log(
      `[GAMC-VOZ] Audio recibido: ${req.file.originalname} ` +
      `(${(req.file.size / 1024).toFixed(1)} KB, ${req.file.mimetype})`
    );

    // ── FASE 2: Reenviar el audio al microservicio Whisper local ──────────────
    // Usamos FormData/Blob nativos de Node 18+ (no requiere dependencias extra).
    const form = new FormData();
    const blob = new Blob([req.file.buffer], { type: req.file.mimetype });
    form.append('audio', blob, req.file.originalname || 'audio.webm');

    let whisperResp: globalThis.Response;
    try {
      whisperResp = await fetch(`${WHISPER_URL}/transcribe`, {
        method: 'POST',
        body: form,
      });
    } catch (connErr) {
      // El servicio Whisper no está corriendo
      console.error('[GAMC-VOZ] ❌ No se pudo conectar con el servicio Whisper:', connErr);
      res.status(503).json({
        success: false,
        error:
          'El servicio de reconocimiento de voz (Whisper) no está disponible. ' +
          'Arráncalo con: cd whisper-service && .venv/bin/python app.py',
      });
      return;
    }

    if (!whisperResp.ok) {
      const errBody = await whisperResp.text();
      console.error(`[GAMC-VOZ] ❌ Whisper respondió ${whisperResp.status}: ${errBody}`);
      res.status(502).json({
        success: false,
        error: 'El servicio Whisper no pudo transcribir el audio.',
        detail: errBody.substring(0, 300),
      });
      return;
    }

    const whisper = (await whisperResp.json()) as {
      text: string;
      language?: string;
      language_probability?: number;
      audio_duration_s?: number;
      latency_ms?: number;
    };

    const text = (whisper.text || '').trim();
    const totalMs = Date.now() - startTime;

    console.log(
      `[GAMC-VOZ] ✅ Transcripción completada en ${totalMs}ms ` +
      `(Whisper: ${whisper.latency_ms}ms) → "${text.substring(0, 80)}"`
    );

    // ── FASE 3: Responder con el texto reconocido ─────────────────────────────
    if (!text) {
      res.status(200).json({
        success: true,
        text: '',
        warning: 'No se detectó voz en el audio. Habla más cerca del micrófono e intenta de nuevo.',
        metrics: { totalMs, whisperLatencyMs: whisper.latency_ms ?? null },
      });
      return;
    }

    res.status(200).json({
      success: true,
      text,
      audio: {
        language: whisper.language ?? 'es',
        languageProbability: whisper.language_probability ?? null,
        durationSeconds: whisper.audio_duration_s ?? null,
      },
      metrics: {
        totalMs,
        whisperLatencyMs: whisper.latency_ms ?? null,
      },
    });
  } catch (error) {
    console.error('[GAMC-VOZ] ❌ Error crítico en transcripción:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno al procesar el audio.',
      ...(process.env.NODE_ENV === 'development' && { debug: (error as Error).message }),
    });
  }
}
