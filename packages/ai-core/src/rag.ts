// RAG helpers: chunking, embeddings, cosine retrieve for agent knowledge + won-deal sales.

import { prisma } from '@voxly/db';
import { AI_MODEL_DEFAULTS } from '@voxly/shared';
import { resolveProviderCostRub, type OpenRouterUsageLike } from './openrouter-cost.js';

export const DEFAULT_WON_STAGES = ['CUSTOMER'] as const;

export type AgentLearnSettings = {
  learnFromWonDeals?: boolean;
  wonStages?: string[];
};

export function parseAgentLearnSettings(settings: unknown): {
  learnFromWonDeals: boolean;
  wonStages: string[];
} {
  const s = (settings && typeof settings === 'object' ? settings : {}) as AgentLearnSettings;
  const wonStages =
    Array.isArray(s.wonStages) && s.wonStages.length
      ? s.wonStages.map(String)
      : [...DEFAULT_WON_STAGES];
  return {
    learnFromWonDeals: s.learnFromWonDeals !== false,
    wonStages,
  };
}

export function chunkText(text: string, size = 1000, overlap = 150): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];
  if (cleaned.length <= size) return [cleaned];
  const chunks: string[] = [];
  let i = 0;
  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + size);
    chunks.push(cleaned.slice(i, end));
    if (end >= cleaned.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return -1;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return -1;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function embeddingApiConfig() {
  return {
    apiKey: process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    model: process.env.AI_EMBEDDING_MODEL || AI_MODEL_DEFAULTS.embedding,
  };
}

export async function embedTexts(texts: string[]): Promise<{
  vectors: number[][];
  model: string;
  usage?: OpenRouterUsageLike;
}> {
  const { apiKey, baseUrl, model } = embeddingApiConfig();
  if (!apiKey) throw new Error('OPENROUTER_API_KEY not set for embeddings');
  if (!texts.length) return { vectors: [], model };

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': process.env.VOXLY_PUBLIC_URL || 'https://getvoxly.ru',
      'X-Title': 'Voxly AI RAG',
    },
    body: JSON.stringify({ model, input: texts }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Embeddings HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: Array<{ embedding?: number[]; index?: number }>;
    usage?: OpenRouterUsageLike;
  };
  const sorted = [...(json.data || [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const vectors = sorted.map((d) => d.embedding || []);
  if (vectors.length !== texts.length) {
    throw new Error(`Embeddings count mismatch: got ${vectors.length}, expected ${texts.length}`);
  }
  return { vectors, model, usage: json.usage };
}

/** Embed + charge wallet (dynamic import avoids circular deps with chargeAiUsage). */
export async function embedAndCharge(
  tenantId: string,
  texts: string[],
  aiAgentId?: string | null,
): Promise<number[][]> {
  const { vectors, model, usage } = await embedTexts(texts);
  try {
    const { chargeAiUsage } = await import('./index.js');
    const tokens =
      usage?.total_tokens ||
      ((usage?.prompt_tokens || 0) + (usage?.completion_tokens || 0)) ||
      Math.max(1, texts.join('').length / 4);
    const cost = await resolveProviderCostRub({
      model,
      usage: usage || { total_tokens: Math.ceil(tokens) },
      apiKey: embeddingApiConfig().apiKey,
      baseUrl: embeddingApiConfig().baseUrl,
    });
    await chargeAiUsage({
      tenantId,
      providerCostRub: cost.providerCostRub,
      tokens: cost.tokens || Math.ceil(tokens),
      model,
      requestType: 'text',
      aiAgentId,
    });
  } catch (err) {
    console.warn('[ai-core] embedding charge failed', err);
  }
  return vectors;
}

function asFloatArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export async function retrieveAgentContext(opts: {
  aiAgentId: string;
  query: string;
  topKKnowledge?: number;
  topKSales?: number;
  tenantId?: string;
}): Promise<{ knowledge: string[]; sales: Array<{ userText: string; operatorText: string }> }> {
  const topKKnowledge = opts.topKKnowledge ?? 4;
  const topKSales = opts.topKSales ?? 3;
  const q = opts.query.trim();
  if (!q) return { knowledge: [], sales: [] };

  let queryVec: number[];
  try {
    const vectors = opts.tenantId
      ? await embedAndCharge(opts.tenantId, [q], opts.aiAgentId)
      : (await embedTexts([q])).vectors;
    queryVec = vectors[0] || [];
  } catch (err) {
    console.warn('[ai-core] query embed failed', err);
    return { knowledge: [], sales: [] };
  }
  if (!queryVec.length) return { knowledge: [], sales: [] };

  const [chunks, examples] = await Promise.all([
    prisma.aiKnowledgeChunk.findMany({
      where: { aiAgentId: opts.aiAgentId },
      select: { content: true, embedding: true },
      take: 800,
    }),
    prisma.aiSalesExample.findMany({
      where: { aiAgentId: opts.aiAgentId },
      select: { userText: true, operatorText: true, embedding: true },
      take: 800,
    }),
  ]);

  const scoredChunks = chunks
    .map((c) => ({
      content: c.content,
      score: cosineSimilarity(queryVec, asFloatArray(c.embedding)),
    }))
    .filter((c) => c.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topKKnowledge);

  const scoredSales = examples
    .map((e) => ({
      userText: e.userText,
      operatorText: e.operatorText,
      score: cosineSimilarity(queryVec, asFloatArray(e.embedding)),
    }))
    .filter((e) => e.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, topKSales);

  return {
    knowledge: scoredChunks.map((c) => c.content),
    sales: scoredSales.map((e) => ({
      userText: e.userText,
      operatorText: e.operatorText,
    })),
  };
}

export function formatRagPromptBlock(ctx: {
  knowledge: string[];
  sales: Array<{ userText: string; operatorText: string }>;
}): string {
  const parts: string[] = [];
  if (ctx.knowledge.length) {
    parts.push('## База знаний\n' + ctx.knowledge.map((k, i) => `${i + 1}. ${k}`).join('\n\n'));
  }
  if (ctx.sales.length) {
    parts.push(
      '## Примеры успешных продаж (отвечай в похожем стиле)\n' +
        ctx.sales
          .map(
            (s, i) =>
              `${i + 1}. Клиент: ${s.userText}\nПродавец: ${s.operatorText}`,
          )
          .join('\n\n'),
    );
  }
  if (!parts.length) return '';
  return (
    '\n\nИспользуй следующие материалы. Не выдумывай факты вне базы знаний.\n\n' +
    parts.join('\n\n')
  );
}
