import { useState, useEffect } from 'react'
import axios from 'axios'
import ChatInputVoz from './components/ChatInputVoz'
import './App.css'

// ── Tipos ─────────────────────────────────────────────────────────────────────
type Vista = 'denuncia' | 'panel' | 'guia'

interface ComplaintResult {
  ticketCode: string
  complaintId: string
  classification: {
    category: string; subcategory: string; priority: string
    aiConfidence: number; confidencePercent: string
    requiresVerification: boolean; cleanSummary: string
    keywords: string[]; isLowConfidence: boolean
  }
  denunciante: { names: string; phone: string | null }
  status: string; input_channel: string; createdAt: string
  metrics: { ollamaLatencyMs: number; totalPipelineMs: number; meetsLatencySLA: boolean }
}

interface Complaint {
  id: string; ticketCode: string; category: string; subcategory: string
  priority: string; status: string; cleanSummary: string; address: string
  district?: string; aiConfidence: number; requiresVerification: boolean; createdAt: string
}

const PRIORITY_COLOR: Record<string, string> = {
  CRITICA: '#ef4444', ALTA: '#f59e0b', MEDIA: '#3b82f6', BAJA: '#10b981',
}
const PRIORITY_ICON: Record<string, string> = {
  CRITICA: '🔴', ALTA: '🟠', MEDIA: '🔵', BAJA: '🟢',
}
const NAV: { id: Vista; icon: string; label: string }[] = [
  { id: 'denuncia', icon: '📋', label: 'Nueva Denuncia' },
  { id: 'panel',    icon: '📊', label: 'Panel de Control' },
  { id: 'guia',     icon: '🧪', label: 'Pruebas / Guía' },
]

// ══════════════════════════════════════════════════════════════════════════════
// VISTA 1 — FORMULARIO DE DENUNCIA (con micrófono)
// ══════════════════════════════════════════════════════════════════════════════
function VistaDenuncia() {
  const [description, setDescription] = useState('')
  const [address, setAddress]         = useState('')
  const [names, setNames]             = useState('')
  const [phone, setPhone]             = useState('')
  const [district, setDistrict]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [result, setResult]           = useState<ComplaintResult | null>(null)
  const [error, setError]             = useState<string | null>(null)
  const [channel, setChannel]         = useState<'WEB' | 'VOZ'>('WEB')

  const handleVoice = (text: string) => {
    setDescription(prev => (prev ? `${prev} ${text}` : text).trim())
    setChannel('VOZ')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setError(null); setResult(null)
    try {
      const { data } = await axios.post('/api/v1/complaints', {
        text_raw: description,
        address: address || 'No especificada',
        district: district || undefined,
        names: names || 'Ciudadano Web',
        phone: phone || undefined,
        session_token: `WEB_${Date.now()}`,
        input_channel: channel,
      })
      setResult(data.data)
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const d = err.response?.data?.details
        setError(d ? Object.values(d).flat().join(' · ') : (err.response?.data?.error || 'Error de conexión.'))
      } else setError('Error inesperado.')
    } finally { setLoading(false) }
  }

  const reset = () => {
    setResult(null); setDescription(''); setAddress(''); setNames('');
    setPhone(''); setDistrict(''); setError(null); setChannel('WEB')
  }

  if (result) return (
    <div className="card result-card animate-up">
      <div style={{textAlign:'center', marginBottom:28}}>
        <div style={{fontSize:'3rem', marginBottom:8}}>✅</div>
        <h3 style={{fontSize:'1.2rem', fontWeight:800, marginBottom:10}}>Denuncia Registrada</h3>
        <div className="ticket-badge">{result.ticketCode}</div>
        <div style={{marginTop:8, fontSize:'0.75rem', color:'#64748b'}}>
          Canal: {result.input_channel === 'VOZ' ? '🎤 Voz' : '⌨️ Web'}
        </div>
      </div>

      <div className="grid-2">
        <div className="info-box">
          <span className="info-label">Categoría IA</span>
          <span className="info-val blue">{result.classification.category.replace(/_/g,' ')}</span>
        </div>
        <div className="info-box">
          <span className="info-label">Subcategoría</span>
          <span className="info-val">{result.classification.subcategory.replace(/_/g,' ')}</span>
        </div>
        <div className="info-box">
          <span className="info-label">Prioridad</span>
          <span className="info-val" style={{color: PRIORITY_COLOR[result.classification.priority]}}>
            {PRIORITY_ICON[result.classification.priority]} {result.classification.priority}
          </span>
        </div>
        <div className="info-box">
          <span className="info-label">Confianza IA</span>
          <div className="conf-row">
            <div className="conf-bar"><div className="conf-fill" style={{width: result.classification.confidencePercent}} /></div>
            <span>{result.classification.confidencePercent}</span>
          </div>
        </div>
      </div>

      <div className="summary-box">
        <span className="summary-label">📝 Resumen IA</span>
        <p>{result.classification.cleanSummary}</p>
        {result.classification.keywords.length > 0 && (
          <div className="tags-row" style={{marginTop:8}}>
            {result.classification.keywords.map((k,i) => <span key={i} className="tag">{k}</span>)}
          </div>
        )}
      </div>

      {result.classification.isLowConfidence && (
        <div className="alert warn">⚠️ Baja confianza ({result.classification.confidencePercent}) — Requiere validación manual.</div>
      )}

      <div className="metrics-row">
        <div className="metric"><span>Ollama</span><strong>{result.metrics.ollamaLatencyMs}ms</strong></div>
        <div className="metric"><span>Total</span><strong>{result.metrics.totalPipelineMs}ms</strong></div>
        <div className="metric">
          <span>SLA &lt;2500ms</span>
          <strong style={{color: result.metrics.meetsLatencySLA ? '#10b981' : '#ef4444'}}>
            {result.metrics.meetsLatencySLA ? '✅' : '❌'}
          </strong>
        </div>
      </div>

      <button id="btn-nueva-denuncia" onClick={reset} className="btn-secondary">➕ Nueva denuncia</button>
    </div>
  )

  return (
    <div className="card animate-up">
      <div className="card-head">
        <h3>📋 Registrar Denuncia Ciudadana</h3>
        <p>Habla o escribe · la IA clasifica automáticamente</p>
      </div>
      <form onSubmit={handleSubmit} className="form">

        {/* Micrófono */}
        <label className="section-lbl">🎤 Grabación de Voz</label>
        <ChatInputVoz onTranscript={handleVoice} disabled={loading} />

        {/* Texto */}
        <div className="form-group">
          <label htmlFor="desc">
            Descripción <span className="req">*</span>
            {channel === 'VOZ' && <span className="voz-tag">🎤 por voz</span>}
          </label>
          <textarea
            id="desc" value={description} required minLength={10} maxLength={2000} rows={4}
            placeholder="El texto de la voz aparece aquí automáticamente, o escribe directamente..."
            onChange={e => { setDescription(e.target.value); setChannel('WEB') }}
            className="input"
          />
          <div style={{textAlign:'right', fontSize:'0.72rem', color: description.length < 10 ? '#f59e0b' : '#10b981'}}>
            {description.length}/2000 {description.length < 10 && '(mínimo 10)'}
          </div>
        </div>

        <div className="row-2">
          <div className="form-group">
            <label htmlFor="addr">Dirección</label>
            <input id="addr" type="text" value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="Calle, Avenida, Barrio..." className="input" />
          </div>
          <div className="form-group">
            <label htmlFor="dist">Distrito</label>
            <select id="dist" value={district} onChange={e => setDistrict(e.target.value)} className="input">
              <option value="">Seleccionar...</option>
              {Array.from({length:14},(_,i)=><option key={i} value={`D${i+1}`}>Distrito {i+1}</option>)}
            </select>
          </div>
        </div>

        <label className="section-lbl" style={{marginTop:4}}>👤 Datos del Denunciante (opcional)</label>
        <div className="row-2">
          <div className="form-group">
            <label htmlFor="names">Nombre</label>
            <input id="names" type="text" value={names}
              onChange={e => setNames(e.target.value)} placeholder="Nombre completo" className="input" />
          </div>
          <div className="form-group">
            <label htmlFor="phone">Teléfono</label>
            <input id="phone" type="tel" value={phone}
              onChange={e => setPhone(e.target.value)} placeholder="7XXXXXXX" className="input" />
          </div>
        </div>

        {error && <div className="alert err">⚠️ {error}</div>}

        <button id="btn-registrar" type="submit" disabled={loading || description.length < 10} className="btn-primary">
          {loading ? <><span className="spin"/>Clasificando con Ollama IA...</> : '🚀 Registrar Denuncia'}
        </button>
      </form>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA 2 — PANEL DE CONTROL (tabla de denuncias desde PostgreSQL)
// ══════════════════════════════════════════════════════════════════════════════
function VistaPanel() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [total, setTotal]           = useState(0)
  const [loading, setLoading]       = useState(true)
  const [error, setError]           = useState('')
  const [filter, setFilter]         = useState('')

  const load = async () => {
    setLoading(true); setError('')
    try {
      const { data } = await axios.get('/api/v1/complaints?limit=50')
      setComplaints(data.data)
      setTotal(data.pagination.total)
    } catch { setError('No se pudo conectar con el backend. ¿Está corriendo en :3000?') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const filtered = filter
    ? complaints.filter(c =>
        c.category.includes(filter.toUpperCase()) ||
        c.priority === filter.toUpperCase() ||
        c.status.includes(filter.toUpperCase()) ||
        c.ticketCode.includes(filter.toUpperCase())
      )
    : complaints

  const criticas = complaints.filter(c => c.priority === 'CRITICA').length
  const manuales = complaints.filter(c => c.requiresVerification).length

  return (
    <div className="animate-up">
      <div className="panel-header">
        <div>
          <h3 style={{fontSize:'1.2rem', fontWeight:800}}>📊 Panel de Control PostgreSQL</h3>
          <p style={{color:'#64748b', fontSize:'0.82rem', marginTop:2}}>Datos en tiempo real de la base de datos</p>
        </div>
        <button id="btn-refresh-panel" onClick={load} className="btn-outline">🔄 Actualizar</button>
      </div>

      {/* Stats */}
      <div className="stats-row">
        {[
          { n: total,    l: 'Total Denuncias', c: '#f1f5f9' },
          { n: criticas, l: 'Prioridad Crítica', c: '#ef4444' },
          { n: manuales, l: 'Revisión Manual', c: '#f59e0b' },
          { n: total-manuales, l: 'Clasificadas IA', c: '#10b981' },
        ].map((s,i) => (
          <div key={i} className="stat-card">
            <div className="stat-num" style={{color:s.c}}>{s.n}</div>
            <div className="stat-lbl">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Filtro */}
      <input
        id="panel-filter"
        type="text" value={filter}
        onChange={e => setFilter(e.target.value)}
        placeholder="Filtrar por categoría, prioridad, estado o código..."
        className="input" style={{marginBottom:16}}
      />

      {loading && <div className="loading-row"><span className="spin" />Cargando datos de PostgreSQL...</div>}
      {error && <div className="alert err">{error}</div>}

      {!loading && !error && (
        <div className="table-wrap">
          {filtered.length === 0 ? (
            <div className="empty-state">
              📭 No hay denuncias registradas aún.<br/>
              <small>Ve a "Nueva Denuncia" y registra la primera.</small>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  {['Ticket','Categoría','Resumen IA','Prioridad','Estado','Confianza','Dirección','Fecha'].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.id}>
                    <td><code className="ticket-mono">{c.ticketCode}</code></td>
                    <td>
                      <strong style={{color:'#93c5fd', fontSize:'0.8rem'}}>{c.category.replace(/_/g,' ')}</strong>
                      <br/><small style={{color:'#475569'}}>{c.subcategory.replace(/_/g,' ')}</small>
                    </td>
                    <td style={{maxWidth:180, fontSize:'0.78rem', color:'#cbd5e1'}}>
                      {c.cleanSummary.substring(0,80)}{c.cleanSummary.length>80?'…':''}
                    </td>
                    <td>
                      <span className="priority-badge" style={{
                        background: `${PRIORITY_COLOR[c.priority]}22`,
                        color: PRIORITY_COLOR[c.priority],
                        border: `1px solid ${PRIORITY_COLOR[c.priority]}55`,
                      }}>
                        {PRIORITY_ICON[c.priority]} {c.priority}
                      </span>
                    </td>
                    <td>
                      <span className="status-badge">{c.status}</span>
                    </td>
                    <td style={{textAlign:'center', fontSize:'0.78rem', color:'#64748b'}}>
                      {(c.aiConfidence*100).toFixed(1)}%
                    </td>
                    <td style={{fontSize:'0.75rem', color:'#64748b'}}>{c.address.substring(0,25)}</td>
                    <td style={{fontSize:'0.72rem', color:'#475569', whiteSpace:'nowrap'}}>
                      {new Date(c.createdAt).toLocaleString('es-BO')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// VISTA 3 — GUÍA DE PRUEBAS
// ══════════════════════════════════════════════════════════════════════════════
function VistaGuia() {
  const scenarios = [
    {
      id: 'A', title: 'Alta Confianza — Bacheo', color: '#10b981',
      body: '{"text_raw": "Buenas noches, llamo para reportar que en la avenida América y Melchor Urquidi hay un tremendo bache en medio del asfalto que va a causar un accidente.", "names": "Luis Ramirez", "phone": "77712345", "address": "Av. America y Melchor Urquidi", "session_token": "TEST_MIC_01"}',
    },
    {
      id: 'B', title: 'Jerga Local — Semáforo', color: '#3b82f6',
      body: '{"text_raw": "El semáforo del cruce de la avenida Blanco Galindo está totalmente apagado, las flotas y los autos están haciendo trancadera y es peligroso.", "names": "Anonimo", "address": "Av. Blanco Galindo", "session_token": "TEST_BO_002"}',
    },
    {
      id: 'C', title: 'Baja Confianza — No Municipal', color: '#f59e0b',
      body: '{"text_raw": "Hola, quería preguntar qué requisitos necesito para sacar mi licencia de funcionamiento de una veterinaria.", "names": "Juan Perez", "address": "Plaza Principal", "session_token": "TEST_AMBIGUA_003"}',
    },
  ]

  const [copied, setCopied] = useState('')
  const copy = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(id)
    setTimeout(() => setCopied(''), 2000)
  }

  return (
    <div className="card animate-up">
      <div className="card-head">
        <h3>🧪 Escenarios de Prueba — PowerShell</h3>
        <p>Copia el comando y pégalo en PowerShell para simular denuncias</p>
      </div>

      {scenarios.map(s => {
        const cmd = `Invoke-RestMethod -Uri "http://localhost:3000/api/v1/complaints" -Method Post -ContentType "application/json" -Body '${s.body}'`
        return (
          <div key={s.id} className="scenario-card" style={{borderColor: `${s.color}44`}}>
            <div className="scenario-header">
              <span className="scenario-badge" style={{background:`${s.color}22`, color:s.color}}>
                Escenario {s.id}
              </span>
              <strong style={{color:'#e2e8f0'}}>{s.title}</strong>
              <button
                id={`btn-copy-${s.id}`}
                onClick={() => copy(s.id, cmd)}
                className="btn-copy"
                style={{borderColor:`${s.color}44`, color:s.color}}
              >
                {copied === s.id ? '✅ Copiado' : '📋 Copiar'}
              </button>
            </div>
            <pre className="code-block">{cmd}</pre>
          </div>
        )
      })}

      <div className="scenario-card" style={{borderColor:'#6366f144', marginTop:8}}>
        <div className="scenario-header">
          <span className="scenario-badge" style={{background:'#6366f122', color:'#a5b4fc'}}>
            Panel Live
          </span>
          <strong style={{color:'#e2e8f0'}}>Ver denuncias en el navegador (HTML)</strong>
        </div>
        <a href="http://localhost:3000/ver-denuncias" target="_blank" rel="noreferrer" className="btn-outline" style={{display:'inline-block', marginTop:8, textDecoration:'none'}}>
          🔗 Abrir http://localhost:3000/ver-denuncias
        </a>
      </div>

      <div className="alert warn" style={{marginTop:16}}>
        💡 <strong>Micrófono en Chrome:</strong> Abre las herramientas de desarrollador (F12) → consola. 
        Al hacer clic en 🎤, Chrome mostrará un popup de permisos. Haz clic en <em>"Permitir"</em>.
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// APP PRINCIPAL — Navegación
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [vista, setVista] = useState<Vista>('denuncia')

  return (
    <div className="app">
      {/* Header con navegación */}
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <span className="brand-icon">🏛️</span>
            <div>
              <div className="brand-name">GAMC</div>
              <div className="brand-sub">Gobierno Autónomo Municipal de Cochabamba</div>
            </div>
          </div>

          {/* NAV BUTTONS — visibles en todas las vistas */}
          <nav className="nav-tabs">
            {NAV.map(n => (
              <button
                key={n.id}
                id={`nav-${n.id}`}
                onClick={() => setVista(n.id)}
                className={`nav-tab ${vista === n.id ? 'active' : ''}`}
              >
                <span>{n.icon}</span>
                <span className="nav-label">{n.label}</span>
              </button>
            ))}
          </nav>

          <div className="header-status">
            <span className="status-dot" />
            IA Activa
          </div>
        </div>
      </header>

      <main className="app-main">
        {vista === 'denuncia' && <VistaDenuncia />}
        {vista === 'panel'    && <VistaPanel />}
        {vista === 'guia'     && <VistaGuia />}
      </main>

      <footer className="app-footer">
        © 2026 GAMC · Ollama IA Local · PostgreSQL + MongoDB · WebSocket
      </footer>
    </div>
  )
}
