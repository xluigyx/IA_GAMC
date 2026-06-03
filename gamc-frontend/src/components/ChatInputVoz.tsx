// src/components/ChatInputVoz.tsx
// Componente de entrada por voz usando Web Speech API (CU-03, Paso 6)
// Compatible con Chrome/Edge. Firefox requiere polyfill.

import { useState, useRef, useEffect, useCallback } from 'react'
import './ChatInputVoz.css'

// ── Tipos Web Speech API (no vienen en los tipos estándar de TS) ──────────────
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onstart: ((ev: Event) => void) | null
  onend: ((ev: Event) => void) | null
  onresult: ((ev: SpeechRecognitionEvent) => void) | null
  onerror: ((ev: SpeechRecognitionErrorEvent) => void) | null
  onspeechend: ((ev: Event) => void) | null
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance
    webkitSpeechRecognition: new () => SpeechRecognitionInstance
  }
}

// ── Props del componente ───────────────────────────────────────────────────────
interface ChatInputVozProps {
  onTranscript: (text: string) => void  // Callback cuando hay texto finalizado
  disabled?: boolean
}

// ── Tipos de estado de grabación ──────────────────────────────────────────────
type RecordingState = 'idle' | 'listening' | 'processing' | 'error'

// ── Componente principal ───────────────────────────────────────────────────────
export default function ChatInputVoz({ onTranscript, disabled = false }: ChatInputVozProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [interimText, setInterimText]       = useState('')   // Texto en tiempo real
  const [finalText, setFinalText]           = useState('')   // Texto confirmado
  const [errorMessage, setErrorMessage]     = useState('')
  const [isSupported, setIsSupported]       = useState(true)
  const [volume, setVolume]                 = useState(0)    // Nivel de audio simulado

  const recognitionRef  = useRef<SpeechRecognitionInstance | null>(null)
  const volumeTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Verificar soporte del navegador al montar ─────────────────────────────
  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setIsSupported(false)
      setErrorMessage('Tu navegador no soporta Web Speech API. Usa Chrome o Edge.')
    }
    return () => {
      if (volumeTimerRef.current) clearInterval(volumeTimerRef.current)
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    }
  }, [])

  // ── Animación de volumen (simulada para feedback visual) ──────────────────
  const startVolumeAnimation = () => {
    volumeTimerRef.current = setInterval(() => {
      setVolume(Math.random() * 100)
    }, 150)
  }

  const stopVolumeAnimation = () => {
    if (volumeTimerRef.current) {
      clearInterval(volumeTimerRef.current)
      volumeTimerRef.current = null
    }
    setVolume(0)
  }

  // ── Iniciar grabación ─────────────────────────────────────────────────────
  const startRecording = useCallback(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognition) return

    setErrorMessage('')
    setInterimText('')
    setFinalText('')

    const recognition = new SpeechRecognition()
    recognitionRef.current = recognition

    // Configuración para español boliviano
    recognition.lang = 'es-BO'
    recognition.continuous = true
    recognition.interimResults = true
    recognition.maxAlternatives = 3

    recognition.onstart = () => {
      setRecordingState('listening')
      startVolumeAnimation()
      console.log('[VOZ] Reconocimiento iniciado (es-BO)')
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = ''
      let final = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript + ' '
        } else {
          interim += transcript
        }
      }

      if (interim) setInterimText(interim)
      if (final) {
        setFinalText(prev => prev + final)
        setInterimText('')
      }

      // Auto-detención tras 3 segundos de silencio
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = setTimeout(() => {
        stopRecording()
      }, 3000)
    }

    recognition.onspeechend = () => {
      console.log('[VOZ] Fin de la voz detectado')
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[VOZ] Error:', event.error)
      stopVolumeAnimation()

      const errorMessages: Record<string, string> = {
        'no-speech':         'No se detectó voz. Intenta hablar más cerca del micrófono.',
        'audio-capture':     'No se puede acceder al micrófono. Verifica los permisos.',
        'not-allowed':       'Acceso al micrófono denegado. Habilítalo en la configuración.',
        'network':           'Error de red en el reconocimiento de voz.',
        'aborted':           'Grabación cancelada.',
        'service-not-allowed': 'Servicio de voz no disponible.',
      }

      setErrorMessage(errorMessages[event.error] || `Error: ${event.error}`)
      setRecordingState('error')
    }

    recognition.onend = () => {
      stopVolumeAnimation()
      setRecordingState('processing')

      // Inyectar texto al formulario padre
      setTimeout(() => {
        const captured = (finalText + interimText).trim()
        if (captured) {
          onTranscript(captured)
          console.log(`[VOZ] Texto inyectado al chat: "${captured}"`)
        }
        setRecordingState('idle')
        setInterimText('')
      }, 300)
    }

    recognition.start()
  }, [finalText, interimText, onTranscript])

  // ── Detener grabación ─────────────────────────────────────────────────────
  const stopRecording = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    if (recognitionRef.current) {
      recognitionRef.current.stop()
      recognitionRef.current = null
    }
  }, [])

  // ── Usar texto capturado manualmente ─────────────────────────────────────
  const handleUseText = () => {
    const text = (finalText + interimText).trim()
    if (text) {
      onTranscript(text)
      setFinalText('')
      setInterimText('')
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  if (!isSupported) {
    return (
      <div className="voz-unsupported" role="alert">
        🎤 {errorMessage}
      </div>
    )
  }

  const isListening   = recordingState === 'listening'
  const isProcessing  = recordingState === 'processing'
  const hasText       = !!(finalText || interimText)

  return (
    <div className="chat-input-voz" aria-label="Grabación de voz">
      {/* Botón principal de grabación */}
      <button
        id="btn-grabar-voz"
        type="button"
        onClick={isListening ? stopRecording : startRecording}
        disabled={disabled || isProcessing}
        className={`btn-voz ${isListening ? 'listening' : ''} ${isProcessing ? 'processing' : ''}`}
        aria-label={isListening ? 'Detener grabación' : 'Iniciar grabación de voz'}
        title={isListening ? 'Haz clic para detener' : 'Haz clic para hablar'}
      >
        {/* Ondas de audio animadas */}
        {isListening && (
          <>
            <span className="voz-wave" style={{ height: `${Math.max(20, volume * 0.4)}px` }} />
            <span className="voz-wave" style={{ height: `${Math.max(20, volume * 0.6)}px` }} />
            <span className="voz-wave" style={{ height: `${Math.max(20, volume * 0.5)}px` }} />
          </>
        )}

        {/* Ícono */}
        <span className="voz-icon">
          {isListening   ? '⏹' :
           isProcessing  ? '⏳' :
                           '🎤'}
        </span>
      </button>

      {/* Estado y transcripción en vivo */}
      <div className="voz-status-area">
        {isListening && (
          <div className="voz-live-indicator">
            <span className="voz-live-dot" />
            <span className="voz-live-label">Escuchando en español boliviano...</span>
          </div>
        )}

        {isProcessing && (
          <div className="voz-processing">
            <span className="voz-spinner" />
            <span>Procesando audio...</span>
          </div>
        )}

        {!isListening && !isProcessing && !hasText && recordingState === 'idle' && (
          <p className="voz-hint">
            Haz clic en el micrófono y habla sobre el problema que deseas reportar
          </p>
        )}

        {/* Transcripción en tiempo real */}
        {hasText && (
          <div className="voz-transcript-box">
            <span className="voz-transcript-label">Transcripción:</span>
            <p className="voz-transcript-text">
              {finalText}
              {interimText && (
                <span className="voz-interim">{interimText}</span>
              )}
            </p>
            {!isListening && (
              <button
                id="btn-usar-transcripcion"
                type="button"
                onClick={handleUseText}
                className="btn-usar-texto"
              >
                ✅ Usar este texto
              </button>
            )}
          </div>
        )}

        {/* Error */}
        {recordingState === 'error' && errorMessage && (
          <div className="voz-error" role="alert">
            ⚠️ {errorMessage}
            <button
              type="button"
              onClick={() => setRecordingState('idle')}
              className="btn-dismiss-error"
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
