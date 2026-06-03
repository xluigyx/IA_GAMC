// src/controllers/ComplaintController.ts
// Controlador principal del Pipeline IA - GAMC
// Pipeline Atómico: Validación → Ollama → PostgreSQL (ticket) + MongoDB (log conversacional)
// Compatible con: curl de prueba (text_raw/session_token) y frontend React (description/userId)

import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { MongoClient, Db, Collection } from 'mongodb';
import { Ollama } from 'ollama';
import { z } from 'zod';

// ============================================================
// CLIENTES DE BASE DE DATOS (Singleton Pattern)
// ============================================================
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

let mongoDb: Db | null = null;
let mongoCollection: Collection | null = null;

async function getMongoCollection(): Promise<Collection> {
  if (mongoCollection) return mongoCollection;

  const client = new MongoClient(
    process.env.MONGODB_URI || 'mongodb://localhost:27017/gamc_ia_logs'
  );
  await client.connect();
  mongoDb = client.db('gamc_ia_logs');
  // Colección para auditoría IA y fine-tuning (RF-02)
  mongoCollection = mongoDb.collection('interacciones_ollama');

  // Índice TTL: logs auto-eliminados tras 90 días
  await mongoCollection.createIndex(
    { createdAt: 1 },
    { expireAfterSeconds: 7776000 }
  );

  return mongoCollection;
}

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
});

// ── Caché en memoria para clasificaciones repetidas (RNF-06: latencia) ────────
// Evita llamar a Ollama si el mismo texto ya fue clasificado recientemente
import { createHash } from 'crypto';

interface CacheEntry {
  result: OllamaClassificationResult;
  rawResponse: string;
  latencyMs: number;
  expiresAt: number;
}
const classificationCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS  = 60 * 60 * 1000; // 1 hora
const CACHE_MAX_SIZE = 200;

function getCacheKey(text: string): string {
  // Normalizar: minúsculas, sin puntuación extra — textos similares = mismo key
  const normalized = text.toLowerCase().trim().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
  return createHash('md5').update(normalized).digest('hex');
}

function getFromCache(key: string): CacheEntry | null {
  const entry = classificationCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { classificationCache.delete(key); return null; }
  return entry;
}

function setToCache(key: string, value: Omit<CacheEntry, 'expiresAt'>): void {
  if (classificationCache.size >= CACHE_MAX_SIZE) {
    // Eliminar la entrada más antigua
    classificationCache.delete(classificationCache.keys().next().value);
  }
  classificationCache.set(key, { ...value, expiresAt: Date.now() + CACHE_TTL_MS });
}


// ============================================================
// ESQUEMA DE VALIDACIÓN FLEXIBLE (Zod - OWASP Top 10 A03)
// Acepta formato curl de prueba Y formato frontend React
// ============================================================
const CreateComplaintSchema = z
  .object({
    // ── Campos del texto de la denuncia (uno de los dos es requerido) ──
    text_raw: z.string().min(10).max(2000).trim().optional(),   // formato curl/voz
    description: z.string().min(10).max(2000).trim().optional(), // formato frontend

    // ── Dirección ──
    address: z.string().min(3).max(300).trim().default('No especificada'),

    // ── Geolocalización (RF-3.1) ──
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    district: z.string().max(100).optional(),

    // ── Identificación del denunciante ──
    session_token: z.string().max(200).optional(), // curl/voz: token de sesión
    userId: z.string().optional(),                  // frontend: CUID del usuario
    names: z.string().max(200).optional(),          // nombre del ciudadano
    phone: z.string().max(20).optional(),           // teléfono de contacto

    // ── Canal de entrada ──
    input_channel: z
      .enum(['WEB', 'VOZ', 'CURL_TEST', 'APP_MOVIL'])
      .default('WEB'),
  })
  .refine(
    (data) => !!(data.text_raw || data.description),
    { message: 'Se requiere text_raw o description con el contenido de la denuncia.' }
  );

// ============================================================
// INTERFAZ DE RESPUESTA IA (Contrato Ollama → Sistema)
// ============================================================
interface OllamaClassificationResult {
  categoria: string;
  subcategoria: string;
  prioridad: 'CRITICA' | 'ALTA' | 'MEDIA' | 'BAJA';
  confianza: number;
  resumen_limpio: string;
  palabras_clave: string[];
  requiere_verificacion: boolean;
}

// ============================================================
// FUNCIÓN: RESOLUCIÓN DE USUARIO (Anónimo / Sesión / Registrado)
// ============================================================
async function resolveUser(
  userId?: string,
  sessionToken?: string,
  names?: string,
  phone?: string
): Promise<{ id: string; role: 'CIUDADANO' | 'OPERADOR' | 'SUPERVISOR' | 'ADMIN' }> {
  // Si viene userId válido, intentar encontrarlo
  if (userId) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) return { id: user.id, role: user.role };
    } catch {
      // Continuar con usuario de sesión
    }
  }

  // Buscar o crear usuario por session_token (denuncias via voz/curl)
  const tokenEmail = sessionToken
    ? `${sessionToken}@sesion.gamc.bo`
    : `anonimo_${Date.now()}@sesion.gamc.bo`;

  let user = await prisma.user.findUnique({ where: { email: tokenEmail } });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: tokenEmail,
        password: 'SESSION_MANAGED',
        fullName: names || 'Ciudadano Anónimo',
        phone: phone || undefined,
        role: 'CIUDADANO',
      },
    });
    console.log(`[GAMC-Auth] Usuario de sesión creado: ${tokenEmail}`);
  }

  return { id: user.id, role: user.role };
}

// ============================================================
// FUNCIÓN: CLASIFICACIÓN CON OLLAMA (Módulo de Refinamiento IA)
// ============================================================
async function classifyWithOllama(
  textRaw: string
): Promise<{ result: OllamaClassificationResult; rawResponse: string; latencyMs: number; fromCache?: boolean }> {

  // ── 1. Verificar caché primero (respuesta instantánea) ────────────────────
  const cacheKey   = getCacheKey(textRaw);
  const cachedHit  = getFromCache(cacheKey);
  if (cachedHit) {
    console.log(`[CACHE HIT] Clasificación desde caché (~0ms) key:${cacheKey.substring(0,8)}`);
    return { ...cachedHit, fromCache: true };
  }

  // ── 2. Llamar a Ollama si no está en caché ────────────────────────────────
  const startTime = Date.now();

  const response = await ollamaClient.chat({
    model: process.env.OLLAMA_MODEL || 'clasificador-gamc',
    messages: [
      {
        role: 'user',
        content: `Analiza esta denuncia ciudadana del GAMC y devuelve SOLO el JSON de clasificación:\n\n"${textRaw}"`,
      },
    ],
    options: { temperature: 0.1 },
  });

  const rawResponse = response.message.content;
  const latencyMs = Date.now() - startTime;

  // Extracción robusta del JSON (sanitización del output IA)
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      `El modelo IA no devolvió JSON válido. Respuesta: ${rawResponse.substring(0, 200)}`
    );
  }

  const raw = JSON.parse(jsonMatch[0]);

  // ── Normalización tolerante de campos ────────────────────────────────────
  const result: OllamaClassificationResult = {
    categoria:             raw.categoria             || raw.category          || 'SIN_CLASIFICAR',
    subcategoria:          raw.subcategoria          || raw.subcategory       || 'REVISION_MANUAL_REQUERIDA',
    prioridad:             raw.prioridad             || raw.priority          || 'MEDIA',
    resumen_limpio:        raw.resumen_limpio        || raw.resumen           || raw.summary || textRaw.substring(0, 150),
    palabras_clave:        raw.palabras_clave        || raw.keywords          || [],
    requiere_verificacion: raw.requiere_verificacion ?? raw.requiresVerification ?? false,
    confianza: (() => {
      const raw_conf = raw.confianza ?? raw.confidence ?? raw.confidence_score ?? raw.score ?? null;
      if (raw_conf === null) return 0.85;
      const n = Number(raw_conf);
      if (isNaN(n)) return 0.85;
      return n > 1 ? n / 100 : n;
    })(),
  };

  if (!result.categoria || !result.subcategoria || !result.prioridad) {
    throw new Error('El JSON de clasificación IA está incompleto.');
  }

  // ── 3. Guardar en caché para próximas peticiones ──────────────────────────
  setToCache(cacheKey, { result, rawResponse, latencyMs });
  console.log(`[OLLAMA] Clasificación completada en ${latencyMs}ms → guardada en caché`);

  return { result, rawResponse, latencyMs, fromCache: false };
}


// ============================================================
// FUNCIÓN: GENERADOR DE CÓDIGO DE TICKET ÚNICO CORRELATIVO
// ============================================================
async function generateTicketCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.complaint.count();
  const sequence = String(count + 1).padStart(5, '0');
  return `GAMC-${year}-${sequence}`;
}

// ============================================================
// CONTROLADOR PRINCIPAL: POST /api/v1/complaints (CU-04)
// Escenarios: Alta Confianza | Jerga Local | Baja Confianza
// ============================================================
export async function createComplaint(req: Request, res: Response): Promise<void> {
  const requestStartTime = Date.now();
  const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    // ── FASE 1: Validación de entrada ────────────────────────────────────────
    const validationResult = CreateComplaintSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        error: 'Datos de entrada inválidos.',
        details: validationResult.error.flatten().fieldErrors,
      });
      return;
    }

    const {
      text_raw,
      description,
      address,
      latitude,
      longitude,
      district,
      session_token,
      userId,
      names,
      phone,
      input_channel,
    } = validationResult.data;

    // El texto a clasificar puede venir de cualquiera de los dos campos
    const textToClassify = (text_raw || description)!;

    // ── FASE 2: Resolución de usuario (anónimo/sesión/registrado) ─────────────
    const resolvedUser = await resolveUser(userId, session_token, names, phone);
    console.log(`[GAMC-Auth] Usuario resuelto: ${resolvedUser.id} | Canal: ${input_channel}`);

    // ── FASE 3: Inferencia IA con Ollama ──────────────────────────────────────
    console.log(`[GAMC-IA] Iniciando clasificación | Conversación: ${conversationId}`);
    console.log(`[GAMC-IA] Texto recibido (${textToClassify.length} chars): "${textToClassify.substring(0, 80)}..."`);

    let classificationResult: OllamaClassificationResult;
    let rawOllamaResponse: string;
    let ollamaLatencyMs: number;

    try {
      const ollamaOutput = await classifyWithOllama(textToClassify);
      classificationResult = ollamaOutput.result;
      rawOllamaResponse = ollamaOutput.rawResponse;
      ollamaLatencyMs = ollamaOutput.latencyMs;

      console.log(
        `[GAMC-IA] ✅ Clasificación completada en ${ollamaLatencyMs}ms\n` +
        `  → Categoría:    ${classificationResult.categoria}\n` +
        `  → Subcategoría: ${classificationResult.subcategoria}\n` +
        `  → Prioridad:    ${classificationResult.prioridad}\n` +
        `  → Confianza:    ${(classificationResult.confianza * 100).toFixed(1)}%\n` +
        `  → Verificación: ${classificationResult.requiere_verificacion}`
      );
    } catch (iaError) {
      // Flujo alternativo: Módulo de Refinamiento activa revisión manual
      console.error('[GAMC-IA] ⚠️  Fallback a revisión manual:', iaError);
      classificationResult = {
        categoria: 'SIN_CLASIFICAR',
        subcategoria: 'REVISION_MANUAL_REQUERIDA',
        prioridad: 'MEDIA',
        confianza: 0.0,
        resumen_limpio: textToClassify.substring(0, 150),
        palabras_clave: [],
        requiere_verificacion: true,
      };
      rawOllamaResponse = `ERROR_IA: ${(iaError as Error).message}`;
      ollamaLatencyMs = Date.now() - requestStartTime;
    }

    // ── FASE 4A: PostgreSQL — Ticket oficial estructurado ─────────────────────
    // Si confianza < 0.70 → status RECIBIDA con requiresVerification=true (Flujo C)
    const ticketCode = await generateTicketCode();
    const isLowConfidence = classificationResult.confianza < 0.70;

    const complaint = await prisma.complaint.create({
      data: {
        ticketCode,
        category: classificationResult.categoria,
        subcategory: classificationResult.subcategoria,
        priority: classificationResult.prioridad as any,
        aiConfidence: classificationResult.confianza,
        requiresVerification: classificationResult.requiere_verificacion || isLowConfidence,
        rawDescription: textToClassify,
        cleanSummary: classificationResult.resumen_limpio,
        keywords: classificationResult.palabras_clave,
        address,
        latitude,
        longitude,
        district,
        status: 'RECIBIDA',
        userId: resolvedUser.id,
        history: {
          create: {
            newStatus: 'RECIBIDA',
            changedBy: resolvedUser.id,
            changedByRole: resolvedUser.role as any,
            notes: isLowConfidence
              ? `⚠️ Baja confianza IA (${(classificationResult.confianza * 100).toFixed(1)}%). Requiere validación manual.`
              : `Denuncia clasificada automáticamente. Confianza IA: ${(classificationResult.confianza * 100).toFixed(1)}%. Canal: ${input_channel}`,
          },
        },
      },
      include: {
        history: true,
      },
    });

    // ── FASE 4B: MongoDB — Log conversacional (RF-02 Fine-tuning) ─────────────
    try {
      const collection = await getMongoCollection();
      await collection.insertOne({
        // Identificadores de trazabilidad
        conversationId,
        session_token: session_token || null,
        complaintId: complaint.id,
        ticketCode: complaint.ticketCode,

        // Canal y datos del denunciante
        input_channel,
        denunciante: {
          names: names || 'Anónimo',
          phone: phone || null,
          userId: resolvedUser.id,
        },

        // String acústico original (preservado para fine-tuning RF-02)
        string_acustico_original: text_raw || null,
        text_raw: textToClassify,

        // Inferencia IA
        model: process.env.OLLAMA_MODEL || 'clasificador-gamc',
        prompt_enviado: `Analiza esta denuncia ciudadana del GAMC:\n"${textToClassify}"`,
        respuesta_raw_ollama: rawOllamaResponse,
        clasificacion_parseada: classificationResult,

        // Métricas de rendimiento (RNF-06)
        metricas: {
          ollamaLatencyMs,
          totalPipelineMs: Date.now() - requestStartTime,
          tokenEstimate: Math.ceil(textToClassify.length / 4),
          meetsLatencySLA: (Date.now() - requestStartTime) < 2500,
          isLowConfidence,
          confidenceScore: classificationResult.confianza,
        },

        // Metadata de auditoría
        metadata: {
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          latitude: latitude || null,
          longitude: longitude || null,
          address,
          district: district || 'No especificado',
        },

        createdAt: new Date(),
      });
      console.log(`[GAMC-MongoDB] ✅ Log guardado en interacciones_ollama | ID: ${conversationId}`);
    } catch (mongoError) {
      // MongoDB no es crítico — ticket ya persistido en PostgreSQL
      console.error('[GAMC-MongoDB] ⚠️  Error al guardar log (no crítico):', mongoError);
    }

    // ── FASE 5: Respuesta al cliente ──────────────────────────────────────────
    const totalLatencyMs = Date.now() - requestStartTime;
    const meetsLatencySLA = totalLatencyMs < 2500;

    console.log(
      `[GAMC] Pipeline completo en ${totalLatencyMs}ms | Ticket: ${ticketCode} | SLA: ${meetsLatencySLA ? '✅' : '❌'}`
    );

    res.status(201).json({
      success: true,
      message: 'Denuncia registrada exitosamente.',
      data: {
        ticketCode: complaint.ticketCode,
        complaintId: complaint.id,
        classification: {
          category: complaint.category,
          subcategory: complaint.subcategory,
          priority: complaint.priority,
          aiConfidence: complaint.aiConfidence,
          confidencePercent: `${(complaint.aiConfidence * 100).toFixed(1)}%`,
          requiresVerification: complaint.requiresVerification,
          cleanSummary: complaint.cleanSummary,
          keywords: complaint.keywords,
          isLowConfidence,
        },
        denunciante: {
          names: names || 'Anónimo',
          phone: phone || null,
          session_token: session_token || null,
        },
        status: complaint.status,
        input_channel,
        createdAt: complaint.createdAt,
        metrics: {
          ollamaLatencyMs,
          totalPipelineMs: totalLatencyMs,
          meetsLatencySLA,
          slaThresholdMs: 2500,
        },
      },
    });
  } catch (error) {
    console.error('[GAMC] ❌ Error crítico en pipeline:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor. Por favor, intente nuevamente.',
      ...(process.env.NODE_ENV === 'development' && {
        debug: (error as Error).message,
        stack: (error as Error).stack,
      }),
    });
  }
}

// ============================================================
// CONTROLADOR: GET /api/v1/complaints/:id
// ============================================================
export async function getComplaintById(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const complaint = await prisma.complaint.findUnique({
      where: { id },
      include: {
        images: true,
        history: { orderBy: { timestamp: 'desc' } },
        user: { select: { fullName: true, email: true } },
      },
    });

    if (!complaint) {
      res.status(404).json({ success: false, error: 'Denuncia no encontrada.' });
      return;
    }

    res.status(200).json({ success: true, data: complaint });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al consultar la denuncia.' });
  }
}

// ============================================================
// CONTROLADOR: GET /api/v1/complaints
// ============================================================
export async function listComplaints(req: Request, res: Response): Promise<void> {
  try {
    const { category, status, priority, page = '1', limit = '20' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          ticketCode: true,
          category: true,
          subcategory: true,
          priority: true,
          status: true,
          cleanSummary: true,
          address: true,
          district: true,
          aiConfidence: true,
          requiresVerification: true,
          createdAt: true,
        },
      }),
      prisma.complaint.count({ where }),
    ]);

    res.status(200).json({
      success: true,
      data: complaints,
      pagination: {
        page: parseInt(page as string),
        limit: take,
        total,
        pages: Math.ceil(total / take),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Error al listar denuncias.' });
  }
}
