// src/index.ts
// Servidor principal Express + Socket.io para el Backend GAMC
// RF-6.2: Actualización en tiempo real mediante WebSockets

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import {
  createComplaint,
  getComplaintById,
  listComplaints,
} from './controllers/ComplaintController';

dotenv.config();

const app = express();
const httpServer = createServer(app);

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
app.use(express.json({ limit: '10mb' })); // Sanitización inicial OWASP Top 10
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
