// src/components/ChatInputVoz.tsx
// Micrófono robusto: primero pide permiso getUserMedia, luego inicia SpeechRecognition

import { useState, useRef, useEffect } from 'react'
import './ChatInputVoz.css'

interface ChatInputVozProps {
  onTranscript: (text: string) => void
  disabled?: boolean
}

type MicState = 'idle' | 'requesting' | 'listening' | 'processing' | 'error' | 'unsupported'

export default function ChatInputVoz({ onTranscript, disabled = false }: ChatInputVozProps) {
  const [micState, setMicState]       = useState<MicState>('idle')
  const [interim, setInterim]         = useState('')
  const [errorMsg, setErrorMsg]       = useState('')
  const [permGranted, setPermGranted] = useState<boolean | null>(null)
  const [bars, setBars]               = useState([30, 50, 40, 60, 35])

  const recRef       = useRef<SpeechRecognition | null>(null)
  const accumulated  = useRef('')
  const interimRef   = useRef('')   // ref para evitar stale closure en onend
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const barTimer     = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Verificar soporte y estado de permiso al montar ──────────────────────
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setMicState('unsupported'); return }

    // Chequear si ya hay permiso concedido
    if (navigator.permissions) {
      navigator.permissions.query({ name: 'microphone' as PermissionName })
        .then(result => {
          setPermGranted(result.state === 'granted')
          result.onchange = () => setPermGranted(result.state === 'granted')
        })
        .catch(() => {}) // Firefox no soporta esto
    }

    return () => {
      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      if (barTimer.current) clearInterval(barTimer.current)
    }
  }, [])

  const animateBars = (on: boolean) => {
    if (on) {
      barTimer.current = setInterval(() =>
        setBars(Array.from({ length: 5 }, () => 15 + Math.random() * 85)), 100)
    } else {
      if (barTimer.current) clearInterval(barTimer.current)
      setBars([30, 50, 40, 60, 35])
    }
  }

  // ── PASO 1: Solicitar permiso explícito, luego iniciar reconocimiento ────────
  const requestPermissionAndStart = async () => {
    setErrorMsg('')
    setMicState('requesting')
    console.log('[VOZ] Paso 1: Solicitando permiso getUserMedia...')

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      console.log('[VOZ] ✅ Permiso concedido. Liberando stream...')
      setPermGranted(true)
      // Liberar el stream — Chrome necesita un momento para liberar el hardware
      stream.getTracks().forEach(t => t.stop())

      // ⚠️ Delay crítico: esperar que Chrome libere el micrófono antes de rec.start()
      await new Promise(resolve => setTimeout(resolve, 350))
      console.log('[VOZ] Paso 2: Iniciando SpeechRecognition...')
      startSpeechRecognition()

    } catch (err: unknown) {
      console.error('[VOZ] Error getUserMedia:', err)
      setPermGranted(false)
      const name = (err as Error).name
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMsg('PERMISO_DENEGADO')
      } else if (name === 'NotFoundError') {
        setErrorMsg('NO_MICROFONO')
      } else {
        setErrorMsg(`Error: ${(err as Error).message}`)
      }
      setMicState('error')
    }
  }

  const startSpeechRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setMicState('unsupported'); return }

    accumulated.current = ''
    interimRef.current  = ''
    setInterim('')

    const rec = new SR()
    recRef.current = rec
    rec.lang = 'es-ES'          // es-BO no soportado por Chrome — usar es-ES
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    // Cambiar estado INMEDIATAMENTE (no esperar onstart)
    setMicState('listening')
    animateBars(true)

    rec.onstart = () => {
      console.log('[VOZ] ✅ rec.onstart — micrófono activo')
    }

    rec.onresult = (e: SpeechRecognitionEvent) => {
      let interimChunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) {
          accumulated.current += t + ' '
          interimRef.current = ''
        } else {
          interimChunk += t
        }
      }
      interimRef.current = interimChunk
      setInterim(interimChunk)

      if (silenceTimer.current) clearTimeout(silenceTimer.current)
      silenceTimer.current = setTimeout(stopRecording, 2500)
    }

    rec.onerror = (e: SpeechRecognitionErrorEvent) => {
      console.error('[VOZ] rec.onerror:', e.error, e.message)
      animateBars(false)
      if (e.error === 'aborted') { setMicState('idle'); return }
      const msgs: Record<string, string> = {
        'not-allowed': 'PERMISO_DENEGADO',
        'no-speech':   'No se detectó voz. Habla más cerca del micrófono.',
        'network':     'Chrome necesita internet para procesar la voz. Verifica tu conexión.',
        'audio-capture': 'NO_MICROFONO',
      }
      setErrorMsg(msgs[e.error] ?? `Error: ${e.error}`)
      setMicState('error')
    }

    rec.onend = () => {
      console.log('[VOZ] rec.onend — fin de grabación')
      animateBars(false)
      if (silenceTimer.current) clearTimeout(silenceTimer.current)

      // Usar refs en lugar de state para evitar stale closures
      const texto = (accumulated.current + interimRef.current).trim()
      if (texto) {
        console.log(`[VOZ] ✅ Enviando al formulario: "${texto}"`)
        onTranscript(texto)
      } else {
        console.log('[VOZ] ⚠️  Sin texto capturado')
      }
      accumulated.current = ''
      interimRef.current  = ''
      setInterim('')
      setMicState('idle')
    }

    try {
      rec.start()
      console.log('[VOZ] rec.start() llamado')
    } catch (err) {
      console.error('[VOZ] Error en rec.start():', err)
      setErrorMsg(`No se pudo iniciar el reconocimiento: ${(err as Error).message}`)
      setMicState('error')
      animateBars(false)
    }
  }

  const stopRecording = () => {
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
    recRef.current?.stop()
    recRef.current = null
  }

  // ── Render: Sin soporte ───────────────────────────────────────────────────
  if (micState === 'unsupported') return (
    <div className="voz-box warn">
      <span>⚠️</span>
      <div>
        <strong>Navegador no compatible</strong><br/>
        <small>Usa <strong>Google Chrome</strong> o <strong>Microsoft Edge</strong> para el reconocimiento de voz.</small>
      </div>
    </div>
  )

  const isListening  = micState === 'listening'
  const isRequesting = micState === 'requesting'
  const isProcessing = micState === 'processing'
  const isBusy       = isListening || isRequesting || isProcessing

  return (
    <div className={`voz-container ${isListening ? 'listening' : ''}`}>
      {/* Botón principal */}
      <button
        id="btn-grabar-voz"
        type="button"
        onClick={isBusy ? stopRecording : requestPermissionAndStart}
        disabled={disabled}
        className={`btn-mic ${isListening ? 'recording' : ''} ${isRequesting ? 'requesting' : ''}`}
        title={isListening ? 'Clic para detener' : 'Clic para hablar'}
      >
        {isRequesting ? <span className="mic-spinner"/> :
         isListening  ? <span className="mic-bars">{bars.map((h,i)=><b key={i} style={{height:`${h}%`}}/>)}</span> :
         <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
           <path d="M12 1a4 4 0 0 1 4 4v7a4 4 0 0 1-8 0V5a4 4 0 0 1 4-4zm0 2a2 2 0 0 0-2 2v7a2 2 0 0 0 4 0V5a2 2 0 0 0-2-2zm-1 16.93V21h2v-1.07A8.002 8.002 0 0 0 20 12h-2a6 6 0 0 1-12 0H4a8.002 8.002 0 0 0 7 7.93z"/>
         </svg>}
      </button>

      {/* Área de estado */}
      <div className="voz-status">
        {micState === 'idle' && permGranted === false && (
          <div className="voz-hint err-hint">🔒 Permiso denegado — ve abajo para solucionarlo</div>
        )}
        {micState === 'idle' && permGranted !== false && (
          <div className="voz-hint">Clic en 🎤 · habla en español · se detiene solo al silenciar</div>
        )}
        {isRequesting && (
          <div className="voz-hint" style={{color:'#fbbf24'}}>
            ⏳ Solicitando permiso de micrófono... <strong>acepta el popup del navegador</strong>
          </div>
        )}
        {isListening && (
          <div className="voz-live">
            <span className="live-dot"/>
            Grabando... {interim && <em className="interim">"{interim}"</em>}
          </div>
        )}

        {/* Errores con instrucciones específicas */}
        {micState === 'error' && (
          <div className="voz-error-block">
            {errorMsg === 'PERMISO_DENEGADO' ? (
              <div className="voz-fix-steps">
                <strong>🔒 Permiso de micrófono denegado — soluciones:</strong>
                <ol>
                  <li>Haz clic en el <strong>candado 🔒</strong> o ícono 🎤 en la barra de dirección de Chrome</li>
                  <li>Cambia <em>"Micrófono"</em> de <em>Bloqueado</em> → <em>Permitir</em></li>
                  <li>Recarga la página (<kbd>F5</kbd>) y vuelve a intentar</li>
                </ol>
                <small style={{color:'#64748b'}}>
                  URL directa: <code>chrome://settings/content/microphone</code> → agrega <code>localhost:5173</code>
                </small>
              </div>
            ) : errorMsg === 'NO_MICROFONO' ? (
              <div className="voz-fix-steps">
                <strong>🎙️ No se detectó micrófono</strong>
                <ol>
                  <li>Verifica que el micrófono esté conectado</li>
                  <li>Revisa el Administrador de dispositivos de Windows</li>
                  <li>En Chrome: Configuración → Privacidad → Micrófono</li>
                </ol>
              </div>
            ) : (
              <div className="voz-err-simple">{errorMsg}</div>
            )}
            <button type="button" onClick={() => setMicState('idle')} className="btn-retry">
              Reintentar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
