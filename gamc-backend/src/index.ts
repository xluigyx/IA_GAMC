// src/index.ts
// Servidor principal Express + Socket.io para el Backend GAMC
// RF-6.2: Actualización en tiempo real mediante WebSockets

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import {
  createComplaint,
  getComplaintById,
  listComplaints,
} from './controllers/ComplaintController';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const prismaViewer = new PrismaClient();

// ── WebSockets (Socket.io) - Actualización en tiempo real (RF-6.2) ───────────
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || '*',
    methods: ['GET', 'POST'],
  },
});

// ── Middleware Global ─────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Headers de seguridad básicos (OWASP)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// ── Rutas de la API v1 ────────────────────────────────────────────────────────

// Health check del servidor
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'GAMC Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
  });
});

// CU-04: Pipeline de control e inferencia de denuncias
app.post('/api/v1/complaints', createComplaint);
app.get('/api/v1/complaints', listComplaints);
app.get('/api/v1/complaints/:id', getComplaintById);

// ── PANEL DE CONTROL VISUAL (Demo / Auditoría en caliente) ───────────────────
// Acceder en: http://localhost:3000/ver-denuncias
const PRIORITY_COLOR: Record<string, string> = {
  CRITICA: '#ef4444',
  ALTA:    '#f59e0b',
  MEDIA:   '#3b82f6',
  BAJA:    '#10b981',
};
const STATUS_COLOR: Record<string, string> = {
  RECIBIDA:    '#6366f1',
  EN_REVISION: '#f59e0b',
  ASIGNADA:    '#3b82f6',
  EN_PROCESO:  '#8b5cf6',
  RESUELTA:    '#10b981',
  RECHAZADA:   '#ef4444',
  CERRADA:     '#64748b',
};

app.get('/ver-denuncias', async (_req, res) => {
  try {
    const denuncias = await prismaViewer.complaint.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { fullName: true } } },
    });

    const total     = await prismaViewer.complaint.count();
    const criticas  = await prismaViewer.complaint.count({ where: { priority: 'CRITICA' } });
    const sinClasif = await prismaViewer.complaint.count({ where: { requiresVerification: true } });

    const filas = denuncias.map(d => `
      <tr>
        <td><code style="background:#1e293b;padding:3px 8px;border-radius:6px;font-size:0.8rem;">${d.ticketCode}</code></td>
        <td style="max-width:200px;">
          <strong style="color:#93c5fd;">${d.category.replace(/_/g,' ')}</strong><br>
          <small style="color:#64748b;">${d.subcategory.replace(/_/g,' ')}</small>
        </td>
        <td style="max-width:220px;font-size:0.85rem;color:#cbd5e1;">${d.cleanSummary.substring(0,100)}${d.cleanSummary.length>100?'…':''}</td>
        <td style="text-align:center;">
          <span style="background:${PRIORITY_COLOR[d.priority] || '#64748b'}22;
                       color:${PRIORITY_COLOR[d.priority] || '#64748b'};
                       border:1px solid ${PRIORITY_COLOR[d.priority] || '#64748b'}55;
                       padding:3px 10px;border-radius:20px;font-size:0.78rem;font-weight:700;">
            ${d.priority}
          </span>
        </td>
        <td style="text-align:center;">
          <span style="background:${STATUS_COLOR[d.status] || '#64748b'}22;
                       color:${STATUS_COLOR[d.status] || '#94a3b8'};
                       border:1px solid ${STATUS_COLOR[d.status] || '#64748b'}55;
                       padding:3px 10px;border-radius:20px;font-size:0.78rem;">
            ${d.status}
          </span>
        </td>
        <td style="text-align:center;">
          <span style="background:${d.requiresVerification ? '#ef444422' : '#10b98122'};
                       color:${d.requiresVerification ? '#fca5a5' : '#6ee7b7'};
                       padding:3px 10px;border-radius:20px;font-size:0.78rem;">
            ${d.requiresVerification ? '⚠️ Manual' : '✅ IA'}
          </span>
        </td>
        <td style="font-size:0.78rem;color:#64748b;white-space:nowrap;">
          ${(d.aiConfidence * 100).toFixed(1)}%
        </td>
        <td style="font-size:0.78rem;color:#64748b;white-space:nowrap;">
          ${d.address.substring(0,30)}
        </td>
        <td style="font-size:0.78rem;color:#64748b;white-space:nowrap;">
          ${new Date(d.createdAt).toLocaleString('es-BO')}
        </td>
      </tr>
    `).join('');

    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>GAMC — Panel de Control PostgreSQL</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:'Inter',sans-serif;background:#0f172a;color:#f1f5f9;padding:24px;}
    h1{font-size:1.5rem;font-weight:800;margin-bottom:4px;}
    .subtitle{color:#64748b;font-size:0.85rem;margin-bottom:24px;}
    .stats{display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap;}
    .stat{background:#1e293b;border:1px solid rgba(255,255,255,0.07);
          border-radius:12px;padding:16px 22px;min-width:140px;}
    .stat-num{font-size:2rem;font-weight:800;line-height:1;}
    .stat-label{font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;}
    .table-wrap{overflow-x:auto;border-radius:14px;border:1px solid rgba(255,255,255,0.07);}
    table{width:100%;border-collapse:collapse;background:#1e293b;font-size:0.83rem;}
    thead tr{background:#0f172a;}
    th{padding:12px 14px;text-align:left;font-size:0.7rem;text-transform:uppercase;
       letter-spacing:.1em;color:#64748b;font-weight:700;border-bottom:1px solid rgba(255,255,255,0.07);}
    td{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,0.04);vertical-align:middle;}
    tr:hover{background:rgba(255,255,255,0.02);}
    .btn{display:inline-flex;align-items:center;gap:8px;margin-top:20px;
         padding:10px 20px;background:linear-gradient(135deg,#1a3a6c,#2563eb);
         color:#fff;border:none;border-radius:10px;font-size:0.9rem;font-weight:700;
         cursor:pointer;font-family:inherit;text-decoration:none;}
    .btn:hover{opacity:.85;}
    .empty{text-align:center;padding:40px;color:#64748b;}
    .badge-critical{color:#ef4444;} .badge-ok{color:#10b981;}
    .header-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:12px;}
    .live-dot{display:inline-block;width:8px;height:8px;border-radius:50%;
              background:#10b981;margin-right:6px;animation:pulse 1.5s infinite;}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  </style>
  <meta http-equiv="refresh" content="15">
</head>
<body>
  <div class="header-row">
    <div>
      <h1>🏛️ GAMC — Panel de Control PostgreSQL</h1>
      <p class="subtitle"><span class="live-dot"></span>Actualización automática cada 15 segundos · Mostrando últimas 50 denuncias · Total en BD: ${total}</p>
    </div>
    <a class="btn" href="/ver-denuncias">🔄 Actualizar ahora</a>
  </div>

  <div class="stats">
    <div class="stat">
      <div class="stat-num">${total}</div>
      <div class="stat-label">Total Denuncias</div>
    </div>
    <div class="stat">
      <div class="stat-num badge-critical">${criticas}</div>
      <div class="stat-label">Prioridad Crítica</div>
    </div>
    <div class="stat">
      <div class="stat-num" style="color:#f59e0b;">${sinClasif}</div>
      <div class="stat-label">Revisión Manual</div>
    </div>
    <div class="stat">
      <div class="stat-num badge-ok">${total - sinClasif}</div>
      <div class="stat-label">Clasificadas por IA</div>
    </div>
  </div>

  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Código Ticket</th>
          <th>Categoría / Subcategoría</th>
          <th>Resumen IA</th>
          <th>Prioridad</th>
          <th>Estado</th>
          <th>Clasificación</th>
          <th>Confianza</th>
          <th>Dirección</th>
          <th>Fecha Registro</th>
        </tr>
      </thead>
      <tbody>
        ${filas || `<tr><td colspan="9" class="empty">📭 No hay denuncias registradas aún.<br><small>Ejecuta el comando curl en PowerShell para registrar la primera.</small></td></tr>`}
      </tbody>
    </table>
  </div>
</body>
</html>`);
  } catch (error) {
    res.status(500).send(`
      <body style="background:#0f172a;color:#fca5a5;font-family:monospace;padding:40px;">
        <h2>❌ Error al conectar con PostgreSQL</h2>
        <pre style="margin-top:16px;color:#94a3b8;">${(error as Error).message}</pre>
        <p style="margin-top:16px;color:#64748b;">Verifica que PostgreSQL está corriendo y que gamc_db existe.<br>
        Luego ejecuta: <code>npx prisma migrate dev --name init</code></p>
      </body>
    `);
  }
});

// ── Socket.io: Sala de operadores municipales ─────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WebSocket] Conexión establecida: ${socket.id}`);

  // Un operador puede unirse a una sala por distrito
  socket.on('join:district', (district: string) => {
    socket.join(`district:${district}`);
    console.log(`[WebSocket] Operador ${socket.id} se unió al distrito: ${district}`);
  });

  // Notificar nueva denuncia a todos los operadores conectados
  socket.on('complaint:new', (complaintData: any) => {
    io.to(`district:${complaintData.district}`).emit('complaint:created', complaintData);
  });

  // Notificar cambio de estado en tiempo real
  socket.on('complaint:status-update', (updateData: any) => {
    io.emit('complaint:updated', updateData);
    console.log(`[WebSocket] Estado actualizado para ticket: ${updateData.ticketCode}`);
  });

  socket.on('disconnect', () => {
    console.log(`[WebSocket] Desconexión: ${socket.id}`);
  });
});

// ── Manejador de errores 404 ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: `Ruta no encontrada: ${req.method} ${req.path}`,
  });
});

// ── Arranque del servidor ─────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║         GAMC - Sistema de Denuncias Ciudadanas         ║');
  console.log('║              Backend v1.0.0 - Node.js + TS             ║');
  console.log('╠════════════════════════════════════════════════════════╣');
  console.log(`║  🚀 Servidor corriendo en: http://localhost:${PORT}       ║`);
  console.log(`║  🔌 WebSockets activos en: ws://localhost:${PORT}         ║`);
  console.log(`║  🤖 Modelo IA: ${process.env.OLLAMA_MODEL || 'clasificador-gamc'}                      ║`);
  console.log(`║  🌐 Entorno: ${process.env.NODE_ENV || 'development'}                          ║`);
  console.log('╚════════════════════════════════════════════════════════╝');
  console.log('');
});

export { io };
