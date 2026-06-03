import { useState } from 'react'
import axios from 'axios'
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
    requiresVerification: boolean
    cleanSummary: string
  }
  status: string
  createdAt: string
  metrics: {
    ollamaLatencyMs: number
    totalPipelineMs: number
    meetsLatencySLA: boolean
  }
}

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  CRITICA: { label: 'CRÍTICA', color: '#ef4444', icon: '🔴' },
  ALTA:    { label: 'ALTA',    color: '#f59e0b', icon: '🟠' },
  MEDIA:   { label: 'MEDIA',   color: '#3b82f6', icon: '🔵' },
  BAJA:    { label: 'BAJA',    color: '#10b981', icon: '🟢' },
}

// ── Componente principal ───────────────────────────────────────────────────────
export default function App() {
  const [description, setDescription] = useState('')
  const [address, setAddress]         = useState('')
  const [district, setDistrict]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ComplaintResponse | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [charCount, setCharCount]     = useState(0)

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDescription(e.target.value)
    setCharCount(e.target.value.length)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResult(null)

    try {
      const response = await axios.post('/api/v1/complaints', {
        description,
        address,
        district,
        userId: 'demo_user_cuid_placeholder', // En producción viene del JWT
      })
      setResult(response.data.data)
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.response?.data?.error || 'Error al conectar con el servidor.')
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
    setDistrict('')
    setCharCount(0)
    setError(null)
  }

  return (
    <div className="app-container">
      {/* Header institucional */}
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
        <div className="page-hero">
          <h2 className="hero-title">Sistema de Denuncias Ciudadanas</h2>
          <p className="hero-subtitle">
            Tu denuncia es clasificada automáticamente por Inteligencia Artificial local (Ollama) 
            y registrada en tiempo real para el seguimiento del equipo municipal.
          </p>
          <div className="hero-badges">
            <span className="tech-badge">🤖 Ollama IA</span>
            <span className="tech-badge">⚡ PostgreSQL</span>
            <span className="tech-badge">📡 MongoDB</span>
            <span className="tech-badge">🔌 WebSocket</span>
          </div>
        </div>

        {!result ? (
          /* ── Formulario de denuncia ── */
          <div className="form-card animate-fade-up">
            <div className="card-header">
              <h3>📋 Nueva Denuncia</h3>
              <p>Complete los datos para registrar su denuncia</p>
            </div>

            <form onSubmit={handleSubmit} className="complaint-form">
              <div className="form-group">
                <label htmlFor="description">
                  Descripción de la Denuncia
                  <span className="required">*</span>
                </label>
                <textarea
                  id="description"
                  value={description}
                  onChange={handleDescriptionChange}
                  placeholder="Describa detalladamente el problema que desea reportar. Por ejemplo: 'Hay un bache muy profundo en la calle Heroínas esquina Jordán que afecta el tráfico...'"
                  rows={5}
                  required
                  minLength={20}
                  maxLength={2000}
                  className="form-textarea"
                />
                <div className="char-counter">
                  <span className={charCount < 20 ? 'text-warning' : 'text-success'}>
                    {charCount}/2000 caracteres {charCount < 20 && `(mínimo 20)`}
                  </span>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="address">
                    Dirección del Problema
                    <span className="required">*</span>
                  </label>
                  <input
                    id="address"
                    type="text"
                    value={address}
                    onChange={e => setAddress(e.target.value)}
                    placeholder="Calle, Avenida, Barrio..."
                    required
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
                    <option value="">Seleccionar distrito...</option>
                    {[1,2,3,4,5,6,7,8,9,10,11,12,13,14].map(d => (
                      <option key={d} value={`D${d}`}>Distrito {d}</option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div className="alert alert-error" role="alert">
                  ⚠️ {error}
                </div>
              )}

              <button
                type="submit"
                id="submit-complaint-btn"
                disabled={loading || charCount < 20}
                className={`btn-submit ${loading ? 'loading' : ''}`}
              >
                {loading ? (
                  <>
                    <span className="spinner" />
                    Clasificando con IA...
                  </>
                ) : (
                  '🚀 Registrar Denuncia'
                )}
              </button>
            </form>
          </div>
        ) : (
          /* ── Resultado de clasificación IA ── */
          <div className="result-card animate-fade-up">
            <div className="result-header">
              <div className="result-success-icon">✅</div>
              <h3>Denuncia Registrada Exitosamente</h3>
              <div className="ticket-code">{result.ticketCode}</div>
            </div>

            <div className="classification-grid">
              <div className="classification-item">
                <span className="item-label">Categoría IA</span>
                <span className="item-value category">{result.classification.category.replace(/_/g, ' ')}</span>
              </div>
              <div className="classification-item">
                <span className="item-label">Subcategoría</span>
                <span className="item-value">{result.classification.subcategory.replace(/_/g, ' ')}</span>
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
                      style={{ width: `${result.classification.aiConfidence * 100}%` }}
                    />
                  </div>
                  <span>{(result.classification.aiConfidence * 100).toFixed(1)}%</span>
                </div>
              </div>
            </div>

            <div className="summary-box">
              <span className="summary-label">📝 Resumen procesado por IA</span>
              <p className="summary-text">{result.classification.cleanSummary}</p>
            </div>

            {result.classification.requiresVerification && (
              <div className="alert alert-warning">
                ⚠️ Esta denuncia requiere verificación manual por un operador municipal.
              </div>
            )}

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
                <span className="metric-label">SLA RNF-06 (&lt;2.5s)</span>
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
