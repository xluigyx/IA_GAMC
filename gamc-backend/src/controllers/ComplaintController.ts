// src/controllers/ComplaintController.ts
// Controlador principal del Pipeline IA - GAMC
// Maneja la lógica atómica: PostgreSQL (ticket oficial) + MongoDB (log conversacional IA)

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
  
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/gamc_ia_logs');
  await client.connect();
  mongoDb = client.db('gamc_ia_logs');
  mongoCollection = mongoDb.collection('ollama_conversation_logs');
  
  // Índice TTL: los logs de IA se eliminan automáticamente después de 90 días
  await mongoCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 });
  
  return mongoCollection;
}

const ollamaClient = new Ollama({
  host: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
});

// ============================================================
// ESQUEMA DE VALIDACIÓN (Zod - OWASP Top 10 Input Validation)
// ============================================================
const CreateComplaintSchema = z.object({
  description: z
    .string()
    .min(20, 'La descripción debe tener al menos 20 caracteres.')
    .max(2000, 'La descripción no puede superar los 2000 caracteres.')
    .trim(),
  address: z
    .string()
    .min(5, 'Dirección inválida.')
    .max(300)
    .trim(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  district: z.string().max(100).optional(),
  userId: z.string().cuid('ID de usuario inválido.'),
});

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
// FUNCIÓN: CLASIFICACIÓN CON OLLAMA (Módulo de Refinamiento IA)
// ============================================================
async function classifyWithOllama(
  description: string,
  conversationId: string
): Promise<{ result: OllamaClassificationResult; rawResponse: string; latencyMs: number }> {
  const startTime = Date.now();

  const prompt = `Analiza esta denuncia ciudadana del GAMC y devuelve SOLO el JSON de clasificación:\n\n"${description}"`;

  const response = await ollamaClient.chat({
    model: process.env.OLLAMA_MODEL || 'clasificador-gamc',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    options: {
      temperature: 0.1,
    },
  });

  const rawResponse = response.message.content;
  const latencyMs = Date.now() - startTime;

  // Extracción del JSON de la respuesta (sanitización del output de IA)
  const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`El modelo IA no devolvió JSON válido. Respuesta: ${rawResponse.substring(0, 200)}`);
  }

  const result: OllamaClassificationResult = JSON.parse(jsonMatch[0]);

  // Validación básica de campos requeridos
  if (!result.categoria || !result.subcategoria || !result.prioridad) {
    throw new Error('El JSON de clasificación IA está incompleto.');
  }

  return { result, rawResponse, latencyMs };
}

// ============================================================
// FUNCIÓN: GENERADOR DE CÓDIGO DE TICKET ÚNICO
// ============================================================
async function generateTicketCode(): Promise<string> {
  const year = new Date().getFullYear();
  const count = await prisma.complaint.count();
  const sequence = String(count + 1).padStart(5, '0');
  return `GAMC-${year}-${sequence}`;
}

// ============================================================
// CONTROLADOR PRINCIPAL: POST /api/v1/complaints (CU-04)
// Pipeline Atómico: Validación → IA → PostgreSQL + MongoDB
// ============================================================
export async function createComplaint(req: Request, res: Response): Promise<void> {
  const requestStartTime = Date.now();
  const conversationId = `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  try {
    // ── FASE 1: Validación de entrada (OWASP Top 10 - A03 Injection) ──────────
    const validationResult = CreateComplaintSchema.safeParse(req.body);
    if (!validationResult.success) {
      res.status(400).json({
        success: false,
        error: 'Datos de entrada inválidos.',
        details: validationResult.error.flatten().fieldErrors,
      });
      return;
    }

    const { description, address, latitude, longitude, district, userId } = validationResult.data;

    // ── FASE 2: Verificar que el usuario existe en PostgreSQL ────────────────
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      res.status(404).json({ success: false, error: 'Usuario no encontrado.' });
      return;
    }

    // ── FASE 3: Inferencia IA con Ollama (Módulo de Refinamiento) ────────────
    console.log(`[GAMC-IA] Iniciando clasificación Ollama para conversación: ${conversationId}`);
    
    let classificationResult: OllamaClassificationResult;
    let rawOllamaResponse: string;
    let ollamaLatencyMs: number;

    try {
      const ollamaOutput = await classifyWithOllama(description, conversationId);
      classificationResult = ollamaOutput.result;
      rawOllamaResponse = ollamaOutput.rawResponse;
      ollamaLatencyMs = ollamaOutput.latencyMs;
      
      console.log(
        `[GAMC-IA] Clasificación completada en ${ollamaLatencyMs}ms | ` +
        `Categoría: ${classificationResult.categoria} | ` +
        `Confianza: ${(classificationResult.confianza * 100).toFixed(1)}%`
      );
    } catch (iaError) {
      console.error('[GAMC-IA] Error en clasificación Ollama:', iaError);
      // Fallback: clasificación manual si la IA falla (Alta disponibilidad)
      classificationResult = {
        categoria: 'SIN_CLASIFICAR',
        subcategoria: 'REVISION_MANUAL_REQUERIDA',
        prioridad: 'MEDIA',
        confianza: 0.0,
        resumen_limpio: description.substring(0, 150),
        palabras_clave: [],
        requiere_verificacion: true,
      };
      rawOllamaResponse = `ERROR: ${(iaError as Error).message}`;
      ollamaLatencyMs = Date.now() - requestStartTime;
    }

    // ── FASE 4A: Guardar ticket oficial en PostgreSQL (Dato estructurado) ────
    const ticketCode = await generateTicketCode();
    
    const complaint = await prisma.complaint.create({
      data: {
        ticketCode,
        category: classificationResult.categoria,
        subcategory: classificationResult.subcategoria,
        priority: classificationResult.prioridad as any,
        aiConfidence: classificationResult.confianza,
        requiresVerification: classificationResult.requiere_verificacion,
        rawDescription: description,
        cleanSummary: classificationResult.resumen_limpio,
        keywords: classificationResult.palabras_clave,
        address,
        latitude,
        longitude,
        district,
        status: 'RECIBIDA',
        userId,
        history: {
          create: {
            newStatus: 'RECIBIDA',
            changedBy: userId,
            changedByRole: user.role,
            notes: `Denuncia creada automáticamente. Confianza IA: ${(classificationResult.confianza * 100).toFixed(1)}%`,
          },
        },
      },
      include: {
        user: { select: { fullName: true, email: true } },
        history: true,
      },
    });

    // ── FASE 4B: Log conversacional en MongoDB (Dato no estructurado) ─────────
    try {
      const collection = await getMongoCollection();
      await collection.insertOne({
        conversationId,
        complaintId: complaint.id,
        ticketCode: complaint.ticketCode,
        model: process.env.OLLAMA_MODEL || 'clasificador-gamc',
        input: {
          userDescription: description,
          promptSent: `Analiza esta denuncia ciudadana del GAMC:\n"${description}"`,
        },
        output: {
          rawResponse: rawOllamaResponse,
          parsedClassification: classificationResult,
        },
        metrics: {
          ollamaLatencyMs,
          totalPipelineMs: Date.now() - requestStartTime,
          tokenEstimate: Math.ceil(description.length / 4),
        },
        metadata: {
          userId,
          userDistrict: district || 'No especificado',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
        createdAt: new Date(),
      });
      console.log(`[GAMC-MongoDB] Log conversacional guardado: ${conversationId}`);
    } catch (mongoError) {
      // MongoDB no es crítico — el ticket ya fue guardado en PostgreSQL
      console.error('[GAMC-MongoDB] Error al guardar log (no crítico):', mongoError);
    }

    // ── FASE 5: Respuesta exitosa al frontend ─────────────────────────────────
    const totalLatencyMs = Date.now() - requestStartTime;
    console.log(`[GAMC] Pipeline completo en ${totalLatencyMs}ms | Ticket: ${ticketCode}`);

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
          requiresVerification: complaint.requiresVerification,
          cleanSummary: complaint.cleanSummary,
        },
        status: complaint.status,
        createdAt: complaint.createdAt,
        metrics: {
          ollamaLatencyMs,
          totalPipelineMs: totalLatencyMs,
          // RNF-06: Verificar que cumple con < 2500ms
          meetsLatencySLA: totalLatencyMs < 2500,
        },
      },
    });

  } catch (error) {
    console.error('[GAMC] Error crítico en pipeline de denuncia:', error);
    res.status(500).json({
      success: false,
      error: 'Error interno del servidor. Por favor, intente nuevamente.',
      ...(process.env.NODE_ENV === 'development' && {
        debug: (error as Error).message,
      }),
    });
  }
}

// ============================================================
// CONTROLADOR: GET /api/v1/complaints/:id
// Consultar estado de una denuncia específica
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
// Listar denuncias con filtros (para operadores)
// ============================================================
export async function listComplaints(req: Request, res: Response): Promise<void> {
  try {
    const { category, status, priority, page = '1', limit = '20' } = req.query;

    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = parseInt(limit as string);

    const where: any = {};
    if (category) where.category = category;
    if (status) where.status = status;
    if (priority) where.priority = priority;

    const [complaints, total] = await Promise.all([
      prisma.complaint.findMany({
        where,
        skip,
        take,
        orderBy: [
          { priority: 'asc' }, // CRITICA primero
          { createdAt: 'desc' },
        ],
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
