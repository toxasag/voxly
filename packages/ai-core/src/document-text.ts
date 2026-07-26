/**
 * Extract plain text from inbound PDF / DOCX for AI chat context.
 * Soft-fail: callers should show a clear RU fallback on null.
 */

import { createRequire } from 'node:module';

/** Soft cap for LLM context (chars). */
export const DOC_TEXT_MAX_CHARS = 25_000;

/** Download/parse size cap for documents (PDF/DOCX). */
export const DOC_MEDIA_MAX_BYTES = 15 * 1024 * 1024;

export type DocumentKind = 'PDF' | 'DOCX';

export function detectDocumentKind(opts: {
  mimeType?: string | null;
  fileName?: string | null;
}): DocumentKind | null {
  const mime = (opts.mimeType || '').toLowerCase();
  const name = (opts.fileName || '').toLowerCase();
  if (
    mime === 'application/pdf' ||
    mime.includes('pdf') ||
    name.endsWith('.pdf')
  ) {
    return 'PDF';
  }
  if (
    mime.includes('wordprocessingml') ||
    mime === 'application/msword' ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  ) {
    // mammoth handles docx; .doc (legacy) usually fails soft.
    if (name.endsWith('.doc') && !name.endsWith('.docx')) {
      return null;
    }
    return 'DOCX';
  }
  return null;
}

function truncateDocText(text: string): string {
  const t = text.replace(/\u0000/g, '').trim();
  if (t.length <= DOC_TEXT_MAX_CHARS) return t;
  return `${t.slice(0, DOC_TEXT_MAX_CHARS)}\n…[текст обрезан]`;
}

export async function extractDocumentText(
  buffer: Buffer,
  kind: DocumentKind,
): Promise<string | null> {
  if (!buffer.length) return null;
  try {
    if (kind === 'PDF') {
      const require = createRequire(import.meta.url);
      const pdfParse = require('pdf-parse') as (
        b: Buffer,
      ) => Promise<{ text?: string }>;
      const parsed = await pdfParse(buffer);
      const text = truncateDocText(parsed.text || '');
      return text || null;
    }
    const mammoth = await import('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text = truncateDocText(result.value || '');
    return text || null;
  } catch (err) {
    console.warn(`[ai-core] ${kind} extract failed`, err);
    return null;
  }
}

/** Build ChatMessage / LLM text for a document. */
export function formatDocumentAiText(opts: {
  kind: DocumentKind;
  text: string | null;
  caption?: string;
  fileName?: string;
}): string {
  const fail = `[документ ${opts.kind} — не удалось прочитать текст. Опиши текстом, пожалуйста.]`;
  const body = opts.text
    ? `[документ ${opts.kind}]: ${opts.text}`
    : fail;
  if (opts.caption?.trim()) {
    return `${opts.caption.trim()}\n\n${body}`;
  }
  return body;
}
