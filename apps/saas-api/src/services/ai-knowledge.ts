import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, Prisma } from '@voxly/db';
import { chunkText, embedAndCharge } from '@voxly/ai-core';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.txt', '.md', '.pdf']);

export function knowledgeRootDir(): string {
  return process.env.AI_KNOWLEDGE_DIR || path.join(process.cwd(), 'data', 'ai-knowledge');
}

export function assertAllowedKnowledgeFile(filename: string, sizeBytes: number): string {
  if (sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
    throw new Error('Файл должен быть от 1 байта до 10 МБ');
  }
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error('Разрешены только .txt, .md, .pdf');
  }
  return ext;
}

async function extractText(buffer: Buffer, ext: string): Promise<string> {
  if (ext === '.txt' || ext === '.md') {
    return buffer.toString('utf8');
  }
  if (ext === '.pdf') {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pdfParse = require('pdf-parse') as (b: Buffer) => Promise<{ text?: string }>;
    const parsed = await pdfParse(buffer);
    return (parsed.text || '').trim();
  }
  throw new Error('Unsupported file type');
}

export async function processKnowledgeFile(fileId: string): Promise<void> {
  const file = await prisma.aiKnowledgeFile.findUnique({ where: { id: fileId } });
  if (!file) return;

  try {
    const buf = await fs.readFile(file.storagePath);
    const ext = path.extname(file.filename).toLowerCase();
    const text = await extractText(buf, ext);
    if (!text.trim()) {
      await prisma.aiKnowledgeFile.update({
        where: { id: fileId },
        data: { status: 'failed', error: 'Пустой текст после извлечения', extractedChars: 0 },
      });
      return;
    }

    const pieces = chunkText(text);
    const vectors = await embedAndCharge(file.tenantId, pieces, file.aiAgentId);

    await prisma.$transaction(async (tx) => {
      await tx.aiKnowledgeChunk.deleteMany({ where: { fileId } });
      for (let i = 0; i < pieces.length; i += 1) {
        await tx.aiKnowledgeChunk.create({
          data: {
            tenantId: file.tenantId,
            aiAgentId: file.aiAgentId,
            fileId,
            ordinal: i,
            content: pieces[i]!,
            embedding: vectors[i] as unknown as Prisma.InputJsonValue,
            tokenEstimate: Math.ceil(pieces[i]!.length / 4),
          },
        });
      }
      await tx.aiKnowledgeFile.update({
        where: { id: fileId },
        data: {
          status: 'ready',
          error: null,
          extractedChars: text.length,
        },
      });
    });
  } catch (err) {
    await prisma.aiKnowledgeFile.update({
      where: { id: fileId },
      data: {
        status: 'failed',
        error: err instanceof Error ? err.message.slice(0, 500) : 'processing failed',
      },
    });
  }
}

export async function deleteKnowledgeFile(opts: {
  tenantId: string;
  agentId: string;
  fileId: string;
}): Promise<boolean> {
  const file = await prisma.aiKnowledgeFile.findFirst({
    where: { id: opts.fileId, tenantId: opts.tenantId, aiAgentId: opts.agentId },
  });
  if (!file) return false;
  await prisma.aiKnowledgeFile.delete({ where: { id: file.id } });
  try {
    await fs.unlink(file.storagePath);
  } catch {
    /* ignore missing */
  }
  return true;
}

export async function saveKnowledgeUpload(opts: {
  tenantId: string;
  agentId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ id: string }> {
  const ext = assertAllowedKnowledgeFile(opts.filename, opts.buffer.length);
  const dir = path.join(knowledgeRootDir(), opts.tenantId, opts.agentId);
  await fs.mkdir(dir, { recursive: true });
  const safeName = opts.filename.replace(/[^\w.\-а-яА-ЯёЁ]+/gi, '_').slice(0, 180) || `file${ext}`;
  const storagePath = path.join(dir, `${Date.now()}-${safeName}`);
  await fs.writeFile(storagePath, opts.buffer);

  const row = await prisma.aiKnowledgeFile.create({
    data: {
      tenantId: opts.tenantId,
      aiAgentId: opts.agentId,
      filename: opts.filename.slice(0, 255),
      mimeType: opts.mimeType || 'application/octet-stream',
      sizeBytes: opts.buffer.length,
      storagePath,
      status: 'processing',
    },
  });

  void processKnowledgeFile(row.id);
  return { id: row.id };
}
