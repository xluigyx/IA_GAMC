// src/components/ChatInputVoz.tsx
// ─────────────────────────────────────────────────────────────────────────────
// Micrófono 100% LOCAL: graba audio con MediaRecorder y lo envía al backend,
// que lo transcribe con Whisper local (faster-whisper) — SIN enviar nada a la nube.
//
//   getUserMedia → MediaRecorder (.webm) → POST /api/v1/voice/transcribe → texto
//
// Funciona en cualquier navegador moderno (Chrome, Firefox, Edge), sin internet.
// Incluye barras de volumen reales (AnalyserNode) y auto-stop por silencio.
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useRef, useEffect } from 'react'
import './ChatInputVoz.css'

interface ChatInputVozProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

type MicState = 'idle' | 'requesting' | 'recording' | 'transcribing' | 'error' | 'unsupported'

// Endpoint del backend (Vite hace proxy de /api → http://localhost:3000)
const TRANSCRIBE_URL = '/api/v1/voice/transcribe'

// Parámetros de grabación
const SILENCE_RMS       = 0.012   // umbral de silencio (0..1)
const SILENCE_MS        = 2500    // silencio sostenido antes de auto-detener
const MAX_RECORDING_MS  = 30000   // tope de seguridad: 30s

export default function ChatInputVoz({ onTranscript, disabled = false }: ChatInputVozProps) {
  const [micState, setMicState]       = useState<MicState>('idle')
  const [errorMsg, setErrorMsg]       = useState('')
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [bars, setBars]               = useState([30, 50, 40, 60, 35])
  const [elapsed, setElapsed]         = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef        = useRef<MediaStream | null>(null)
  const chunksRef        = useRef<Blob[]>([])
  const audioCtxRef      = useRef<AudioContext | null>(null)
  const analyserRef      = useRef<AnalyserNode | null>(null)
  const rafRef           = useRef<number | null>(null)
  const silenceStartRef  = useRef<number | null>(null)
  const hasSpokenRef     = useRef(false)
  const maxTimerRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const cancelledRef     = useRef(false)

  // ── Soporte + estado de permiso al montar ──────────────────────────────────
  useEffect(() => {
    const supported = !!(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined'
    if (!supported) { setMicState('unsupported'); return }

    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then(result => {
          setPermGranted(result.state === 'granted')
          result.onchange = () => setPermGranted(result.state === 'granted')
        })
        .catch(() => {}) // Firefox no soporta query de micrófono
    }

    return () => cleanup()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Liberar todos los recursos de audio ────────────────────────────────────
  const cleanup = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current)
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    rafRef.current = null; maxTimerRef.current = null; elapsedTimerRef.current = null
    try { audioCtxRef.current?.close() } catch { /* noop */ }
    audioCtxRef.current = null; analyserRef.current = null
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    silenceStartRef.current = null
    hasSpokenRef.current = false
  }

  // ── Elegir el mejor formato de audio soportado ─────────────────────────────
  const pickMimeType = (): string => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c)) return c
    }
    return '' // el navegador usará su default
  }

  // ── PASO 1: Permiso + arrancar grabación ───────────────────────────────────
  const startRecording = async () => {
    setErrorMsg(''); setElapsed(0)
    setMicState('requesting')
    cancelledRef.current = false
    console.log('[VOZ] Solicitando micrófono (getUserMedia)...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      setPermGranted(true)
      console.log('[VOZ] ✅ Permiso concedido. Iniciando grabación...')

      // Analizador de volumen (barras reales + detección de silencio)
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new AudioCtx()
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      audioCtxRef.current = ctx
      analyserRef.current = analyser

      // MediaRecorder
      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = () => handleRecordingStop(mimeType)

      recorder.start()
      setMicState('recording')

      // Cronómetro visible
      const startedAt = performance.now()
      elapsedTimerRef.current = setInterval(
        () => setElapsed(Math.floor((performance.now() - startedAt) / 1000)), 250)

      // Tope de seguridad
      maxTimerRef.current = setTimeout(() => {
        console.log('[VOZ] Tope de 30s alcanzado, deteniendo.')
        stopRecording()
      }, MAX_RECORDING_MS)

      // Bucle de análisis (barras + silencio)
      monitorAudio()
    } catch (err: unknown) {
      console.error('[VOZ] Error getUserMedia:', err)
      setPermGranted(false)
      cleanup()
      const name = (err as Error).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setErrorMsg('PERMISO_DENEGADO')
      else if (name === 'NotFoundError') setErrorMsg('NO_MICROFONO')
      else setErrorMsg(`Error: ${(err as Error).message}`)
      setMicState('error')
    }
  }

  // ── Bucle: barras de volumen reales + auto-stop por silencio ───────────────
  const monitorAudio = () => {
    const analyser = analyserRef.current
    if (!analyser) return
    const freqData = new Uint8Array(analyser.frequencyBinCount)
    const timeData = new Uint8Array(analyser.fftSize)

    const tick = () => {
      if (!analyserRef.current) return
      analyser.getByteFrequencyData(freqData)
      analyser.getByteTimeDomainData(timeData)

      // 5 barras a partir de bandas de frecuencia
      const bands = 5
      const step = Math.floor(freqData.length / bands)
      const newBars = Array.from({ length: bands }, (_, i) => {
        let sum = 0
        for (let j = 0; j < step; j++) sum += freqData[i * step + j]
        return Math.max(8, Math.min(100, (sum / step / 255) * 140))
      })
      setBars(newBars)

      // RMS para detección de silencio
      let sumSq = 0
      for (let i = 0; i < timeData.length; i++) {
        const v = (timeData[i] - 128) / 128
        sumSq += v * v
      }
      const rms = Math.sqrt(sumSq / timeData.length)

      if (rms > SILENCE_RMS) {
        hasSpokenRef.current = true
        silenceStartRef.current = null
      } else if (hasSpokenRef.current) {
        // Solo cuenta el silencio DESPUÉS de que el usuario haya hablado
        if (silenceStartRef.current === null) silenceStartRef.current = performance.now()
        else if (performance.now() - silenceStartRef.current > SILENCE_MS) {
          console.log('[VOZ] Silencio detectado → auto-stop')
          stopRecording()
          return
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  // ── Detener grabación (manual, silencio o tope) ────────────────────────────
  const stopRecording = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (maxTimerRef.current) clearTimeout(maxTimerRef.current)
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current)
    const rec = mediaRecorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()  // dispara onstop
  }

  // ── Cancelar (descartar audio sin transcribir) ─────────────────────────────
  const cancelRecording = () => {
    cancelledRef.current = true
    stopRecording()
    cleanup()
    setBars([30, 50, 40, 60, 35])
    setMicState('idle')
  }

  // ── Al parar: construir blob y mandar al backend ───────────────────────────
  const handleRecordingStop = async (mimeType: string) => {
    setBars([30, 50, 40, 60, 35])
    cleanup()

    if (cancelledRef.current) { setMicState('idle'); return }

    const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
    chunksRef.current = []

    if (blob.size < 1000) {
      setErrorMsg('No se capturó audio. Habla más cerca del micrófono e intenta de nuevo.')
      setMicState('error')
      return
    }

    setMicState('transcribing')
    console.log(`[VOZ] Enviando ${(blob.size / 1024).toFixed(1)}KB al backend (Whisper local)...`)

    try {
      const ext = mimeType.includes('ogg') ? 'ogg' : mimeType.includes('mp4') ? 'mp4' : 'webm'
      const form = new FormData()
      form.append('audio', blob, `denuncia.${ext}`)

      const resp = await fetch(TRANSCRIBE_URL, { method: 'POST', body: form })
      const data = await resp.json()

      if (!resp.ok || data.success === false) {
        throw new Error(data.error || `El servidor respondió ${resp.status}`)
      }

      const text: string = (data.text || '').trim()
      if (!text) {
        setErrorMsg(data.warning || 'No se detectó voz en el audio. Intenta de nuevo.')
        setMicState('error')
        return
      }

      console.log(`[VOZ] ✅ Transcripción recibida: "${text}"`)
      onTranscript(text)
      setMicState('idle')
    } catch (err) {
      console.error('[VOZ] Error al transcribir:', err)
      setErrorMsg((err as Error).message || 'No se pudo conectar con el servicio de transcripción.')
      setMicState('error')
    }
  }

  // ── Render: Sin soporte ────────────────────────────────────────────────────
  if (micState === 'unsupported') return (
    <div className="voz-box warn">
      <span>⚠️</span>
      <div>
        <strong>Navegador no compatible</strong><br/>
        <small>Tu navegador no soporta grabación de audio. Usa una versión reciente de Chrome, Firefox o Edge.</small>
      </div>
    </div>
  )

  const isRecording    = micState === 'recording'
  const isRequesting   = micState === 'requesting'
  const isTranscribing = micState === 'transcribing'
  const isBusy         = isRecording || isRequesting || isTranscribing

  return (
    <div className={`voz-container ${isRecording ? 'listening' : ''}`}>
      {/* Botón principal */}
      <button
        id="btn-grabar-voz"
        type="button"
        onClick={isRecording ? stopRecording : isBusy ? undefined : startRecording}
        disabled={disabled || isTranscribing || isRequesting}
        className={`btn-mic ${isRecording ? 'recording' : ''} ${isRequesting || isTranscribing ? 'requesting' : ''}`}
        title={isRecording ? 'Clic para detener' : 'Clic para hablar'}
      >
        {isRequesting || isTranscribing ? <span className="mic-spinner"/> :
         isRecording ? <span className="mic-bars">{bars.map((h,i)=><b key={i} style={{height:`${h}%`}}/>)}</span> :
         <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
           <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v7a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-1 16.93V21h2v-1.07A8.002 8.002 0 0 0 20 12h-2a6 6 0 0 1-12 0H4a8.002 8.002 0 0 0 7 7.93z"/>
         </svg>}
      </button>

      {/* Área de estado */}
      <div className="voz-status">
        {micState === 'idle' && permGranted === false && (
          <div className="voz-hint err-hint">🔒 Permiso denegado — revisa los pasos al intentar de nuevo</div>
        )}
        {micState === 'idle' && permGranted !== false && (
          <div className="voz-hint">Clic en 🎤 · habla tu denuncia · se transcribe localmente con Whisper</div>
        )}
        {isRequesting && (
          <div className="voz-hint" style={{color:'#fbbf24'}}>
            ⏳ Solicitando permiso... <strong>acepta el popup del navegador</strong>
          </div>
        )}
        {isRecording && (
          <div className="voz-live">
            <span className="live-dot"/>
            Grabando {elapsed}s — clic para detener (o se detiene solo al callar)
            <button type="button" onClick={cancelRecording} className="btn-retry" style={{padding:'2px 10px'}}>
              Cancelar
            </button>
          </div>
        )}
        {isTranscribing && (
          <div className="voz-hint" style={{color:'#93c5fd', fontStyle:'normal', fontWeight:600}}>
            🧠 Transcribiendo con Whisper local... (sin internet)
          </div>
        )}

        {/* Errores */}
        {micState === 'error' && (
          <div className="voz-error-block">
            {errorMsg === 'PERMISO_DENEGADO' ? (
              <div className="voz-fix-steps">
                <strong>🔒 Permiso de micrófono denegado — soluciones:</strong>
                <ol>
                  <li>Haz clic en el <strong>candado 🔒</strong> o ícono 🎤 en la barra de dirección</li>
                  <li>Cambia <em>"Micrófono"</em> de <em>Bloqueado</em> → <em>Permitir</em></li>
                  <li>Recarga la página (<kbd>F5</kbd>) y vuelve a intentar</li>
                </ol>
              </div>
            ) : errorMsg === 'NO_MICROFONO' ? (
              <div className="voz-fix-steps">
                <strong>🎙️ No se detectó micrófono</strong>
                <ol>
                  <li>Verifica que el micrófono esté conectado</li>
                  <li>Revisa la configuración de sonido del sistema</li>
                  <li>Revisa los permisos del navegador</li>
                </ol>
              </div>
            ) : (
              <div className="voz-err-simple">{errorMsg}</div>
            )}
            <button type="button" onClick={() => { setErrorMsg(''); setMicState('idle') }} className="btn-retry">
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
