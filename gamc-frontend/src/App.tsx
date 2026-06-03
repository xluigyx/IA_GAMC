import { useState } from 'react'
import axios from 'axios'
import ChatInputVoz from './components/ChatInputVoz'
import './App.css'

// ── Tipos ──────────────────────────────────────────────────────────────────────
interface ComplaintResponse {
  ticketCode: string
  complaintId: string
  classification: {
    category: string
    subcategory: string
    priority: string
    aiConfidence: number
    confidencePercent: string
    requiresVerification: boolean
    cleanSummary: string
    keywords: string[]
    isLowConfidence: boolean
  }
  denunciante: { names: string; phone: string | null }
  status: string
  input_channel: string
  createdAt: string
  metrics: {
    ollamaLatencyMs: number
    totalPipelineMs: number
    meetsLatencySLA: boolean
    slaThresholdMs: number
  }
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  CRITICA: { label: 'CRÍTICA', color: '#ef4444', icon: '🔴' },
  ALTA:    { label: 'ALTA',    color: '#f59e0b', icon: '🟠' },
  MEDIA:   { label: 'MEDIA',   color: '#3b82f6', icon: '🔵' },
  BAJA:    { label: 'BAJA',    color: '#10b981', icon: '🟢' },
}

const DISTRICT_OPTIONS = Array.from({ length: 14 }, (_, i) => ({
  value: `D${i + 1}`,
  label: `Distrito ${i + 1}`,
}))

// ── Componente principal ───────────────────────────────────────────────────────
export default function App() {
  const [description, setDescription] = useState('')
  const [address, setAddress]         = useState('')
  const [names, setNames]             = useState('')
  const [phone, setPhone]             = useState('')
  const [district, setDistrict]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ComplaintResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [inputChannel, setInputChannel] = useState<'WEB' | 'VOZ'>('WEB')

  const charCount = description.length

  // ── Callback del componente de voz (CU-03, Paso 6) ───────────────────────
  const handleVoiceTranscript = (text: string) => {
    setDescription(prev => {
      const combined = prev ? `${prev} ${text}` : text
      return combined.trim()
    })
    setInputChannel('VOZ')
  }

  // ── Envío al backend ──────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const sessionToken = `WEB_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`

      const response = await axios.post('/api/v1/complaints', {
        text_raw: description,           // Campo principal (compatible con curl)
        description: description,         // Campo alternativo
        address: address || 'No especificada',
        district: district || undefined,
        names: names || 'Ciudadano Web',
        phone: phone || undefined,
        session_token: sessionToken,
        input_channel: inputChannel,
        latitude: undefined,
        longitude: undefined,
      })

      setResult(response.data.data)
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const detail = err.response?.data?.details
        const msg = detail
          ? Object.values(detail).flat().join(' · ')
          : err.response?.data?.error || 'Error al conectar con el servidor.'
        setError(msg)
      } else {
        setError('Error inesperado.')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleReset = () => {
    setResult(null)
    setDescription('')
    setAddress('')
    setNames('')
    setPhone('')
    setDistrict('')
    setError(null)
    setInputChannel('WEB')
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="header-content">
          <div className="header-brand">
            <div className="brand-logo">🏛️</div>
            <div className="brand-text">
              <h1>GAMC</h1>
              <span>Gobierno Autónomo Municipal de Cochabamba</span>
            </div>
          </div>
          <div className="header-badge">
            <span className="badge-dot" />
            Sistema IA Activo
          </div>
        </div>
      </header>

      <main className="app-main">
        {/* Hero */}
        <div className="page-hero">
          <h2 className="hero-title">Sistema de Denuncias Ciudadanas</h2>
          <p className="hero-subtitle">
            Escribe o usa el micrófono. Tu denuncia es clasificada en tiempo real 
            por Inteligencia Artificial local (Ollama) y registrada de forma permanente.
          </p>
          <div className="hero-badges">
            <span className="tech-badge">🤖 Ollama IA</span>
            <span className="tech-badge">⚡ PostgreSQL</span>
            <span className="tech-badge">📡 MongoDB</span>
            <span className="tech-badge">🔌 WebSocket</span>
            <span className="tech-badge">🎤 Web Speech API</span>
          </div>
        </div>

        {!result ? (
          <div className="form-card animate-fade-up">
            <div className="card-header">
              <h3>📋 Nueva Denuncia Ciudadana</h3>
              <p>Describe el problema por voz o texto · CU-03 / CU-04</p>
            </div>

            <form onSubmit={handleSubmit} className="complaint-form">

              {/* ── Sección de voz ─────────────────────────── */}
              <div className="section-label">
                <span className="section-icon">🎤</span>
                Grabación de Voz (Web Speech API · es-BO)
              </div>
              <ChatInputVoz
                onTranscript={handleVoiceTranscript}
                disabled={loading}
              />

              {/* ── Área de texto (se rellena automáticamente con la voz) ── */}
              <div className="form-group">
                <label htmlFor="description">
                  Descripción del Problema
                  <span className="required">*</span>
                  {inputChannel === 'VOZ' && (
                    <span className="voz-badge">🎤 Texto por voz</span>
                  )}
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={e => {
                    setDescription(e.target.value)
                    setInputChannel('WEB')
                  }}
                  placeholder="El texto de la grabación aparecerá aquí automáticamente, o escribe directamente..."
                  rows={4}
                  required
                  minLength={10}
                  maxLength={2000}
                  className="form-textarea"
                />
                <div className="char-counter">
                  <span className={charCount < 10 ? 'text-warning' : 'text-success'}>
                    {charCount}/2000 {charCount < 10 && '(mínimo 10 chars)'}
                  </span>
                </div>
              </div>

              {/* ── Dirección y Distrito ───────────────────── */}
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="address">Dirección del Problema</label>
                  <input
                    id="address"
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Calle, Avenida, Barrio..."
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="district">Distrito Municipal</label>
                  <select
                    id="district"
                    value={district}
                    onChange={e => setDistrict(e.target.value)}
                    className="form-select"
                  >
                    <option value="">Seleccionar...</option>
                    {DISTRICT_OPTIONS.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* ── Datos del denunciante ──────────────────── */}
              <div className="section-label">
                <span className="section-icon">👤</span>
                Datos del Denunciante (opcional)
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="names">Nombre completo</label>
                  <input
                    id="names"
                    type="text"
                    value={names}
                    onChange={e => setNames(e.target.value)}
                    placeholder="Tu nombre (opcional)"
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="phone">Teléfono de contacto</label>
                  <input
                    id="phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="7XXXXXXX (opcional)"
                    className="form-input"
                  />
                </div>
              </div>

              {/* Canal de entrada */}
              <div className="channel-indicator">
                Canal: <strong>{inputChannel === 'VOZ' ? '🎤 Voz (Web Speech API)' : '⌨️ Texto Web'}</strong>
              </div>

              {error && (
                <div className="alert alert-error" role="alert">⚠️ {error}</div>
              )}

              <button
                type="submit"
                id="submit-complaint-btn"
                disabled={loading || charCount < 10}
                className={`btn-submit ${loading ? 'loading' : ''}`}
              >
                {loading ? (
                  <><span className="spinner" />Clasificando con IA Ollama...</>
                ) : (
                  '🚀 Registrar Denuncia'
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ── Resultado ── */
          <div className="result-card animate-fade-up">
            <div className="result-header">
              <div className="result-success-icon">✅</div>
              <h3>Denuncia Registrada Exitosamente</h3>
              <div className="ticket-code">{result.ticketCode}</div>
              <div className="channel-tag">
                Canal: {result.input_channel === 'VOZ' ? '🎤 Voz' : '⌨️ Web'}
              </div>
            </div>

            {/* Clasificación IA */}
            <div className="classification-grid">
              <div className="classification-item">
                <span className="item-label">Categoría IA</span>
                <span className="item-value category">
                  {result.classification.category.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="classification-item">
                <span className="item-label">Subcategoría</span>
                <span className="item-value">
                  {result.classification.subcategory.replace(/_/g, ' ')}
                </span>
              </div>
              <div className="classification-item">
                <span className="item-label">Prioridad</span>
                <span
                  className="item-value priority"
                  style={{ color: PRIORITY_CONFIG[result.classification.priority]?.color }}
                >
                  {PRIORITY_CONFIG[result.classification.priority]?.icon}{' '}
                  {PRIORITY_CONFIG[result.classification.priority]?.label}
                </span>
              </div>
              <div className="classification-item">
                <span className="item-label">Confianza IA</span>
                <div className="confidence-bar-wrapper">
                  <div className="confidence-bar">
                    <div
                      className="confidence-fill"
                      style={{ width: result.classification.confidencePercent }}
                    />
                  </div>
                  <span>{result.classification.confidencePercent}</span>
                </div>
              </div>
            </div>

            {/* Resumen limpio */}
            <div className="summary-box">
              <span className="summary-label">📝 Resumen procesado por IA</span>
              <p className="summary-text">{result.classification.cleanSummary}</p>
              {result.classification.keywords.length > 0 && (
                <div className="keywords-row">
                  {result.classification.keywords.map((kw, i) => (
                    <span key={i} className="keyword-tag">{kw}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Alertas de calidad */}
            {result.classification.isLowConfidence && (
              <div className="alert alert-warning">
                ⚠️ Confianza baja ({result.classification.confidencePercent}) — 
                Guardado en MongoDB para fine-tuning. Requiere validación manual.
              </div>
            )}

            {/* Métricas RNF-06 */}
            <div className="metrics-row">
              <div className="metric">
                <span className="metric-label">Latencia Ollama</span>
                <span className="metric-value">{result.metrics.ollamaLatencyMs}ms</span>
              </div>
              <div className="metric">
                <span className="metric-label">Pipeline Total</span>
                <span className="metric-value">{result.metrics.totalPipelineMs}ms</span>
              </div>
              <div className="metric">
                <span className="metric-label">SLA &lt;{result.metrics.slaThresholdMs}ms</span>
                <span className={`metric-value ${result.metrics.meetsLatencySLA ? 'text-success' : 'text-danger'}`}>
                  {result.metrics.meetsLatencySLA ? '✅ Cumple' : '❌ Excede'}
                </span>
              </div>
            </div>

            <button id="new-complaint-btn" onClick={handleReset} className="btn-secondary">
              ➕ Registrar otra denuncia
            </button>
          </div>
        )}
      </main>

      <footer className="app-footer">
        <p>© 2026 Gobierno Autónomo Municipal de Cochabamba · Sistema de IA Local con Ollama</p>
      </footer>
    </div>
  )
}
