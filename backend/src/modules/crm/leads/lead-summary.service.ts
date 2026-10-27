// ---------------------------------------------------------------------------
// Генератор сводки диалога (Lead Conversation Summary) для уведомлений.
//
// Извлекает суть переписки клиента с ботом/менеджером:
// 1. Потребность / задача клиента (что именно нужно сделать, товар/услуга).
// 2. Детали и контекст (модель оборудования, симптомы поломки, пожелания).
// 3. Бюджет и сроки (если назывались).
//
// Использует LLM-пайплайн (SmartModelRouter) со строгим Anti-Sludge промптом
// и детерминированным fallback-режимом при недоступности нейросети.
// ---------------------------------------------------------------------------

import { query } from "../../../db/client.js";
import { smartModelRouter } from "../../ai/gateway/smart-model-router.js";

export interface ChatMessageItem {
  source: string;
  sender_name?: string | null;
  content: string;
  created_at?: Date | string;
}

const SYSTEM_SUMMARY_PROMPT = `
Ты — аналитик входящих обращений клиентов в CRM.
Твоя задача: составить предельно краткую и емкую сводку диалога (2-3 предложения) для менеджера отдела продаж.

СТРОГИЕ ПРАВИЛА (Anti-Sludge):
1. Никакого канцелярита и нейрослопа! Запрещены пустые фразы ("клиент выразил заинтересованность", "в ходе содержательного диалога", "стороны обсудили").
2. Только осязаемые факты:
   - Потребность / задача: что конкретно нужно клиенту (услуга, товар, модель устройства, проблема).
   - Важные детали: симптомы поломки, цвет, размер, модификация или условия.
   - Бюджет и сроки: если клиент их называл (если нет — не придумывай).
3. Пиши естественным русским языком, сразу переходя к сути.
`.trim();

/**
 * Детерминированная сборка выжимки без LLM (Fallback).
 * Извлекает ключевые сообщения клиента и формирует понятный текст.
 */
export function buildDeterministicSummary(messages: ChatMessageItem[]): string | null {
  const customerMsgs = messages
    .filter((m) => {
      const src = (m.source || "").toLowerCase();
      return (src === "customer" || src === "client" || src === "user") && m.content?.trim();
    })
    .map((m) => m.content.trim());

  if (customerMsgs.length === 0) {
    // Если нет сообщений с явным source=customer, берем любые несистемные сообщения
    const nonSystem = messages
      .filter((m) => (m.source || "").toLowerCase() !== "system" && m.content?.trim())
      .map((m) => `${m.sender_name ? `${m.sender_name}: ` : ""}${m.content.trim()}`);
    if (nonSystem.length === 0) return null;
    return nonSystem.slice(-3).join(" · ");
  }

  const first = customerMsgs[0];
  if (!first) return null;

  const last = customerMsgs[customerMsgs.length - 1] ?? first;
  if (customerMsgs.length === 1 || first === last) {
    return first;
  }

  return `${first}\nУточнение: ${last}`;
}

/**
 * Генерация краткого резюме диалога.
 */
export async function generateLeadSummary(
  messages: ChatMessageItem[],
  options?: { tenantId?: string },
): Promise<string | null> {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Фильтруем сообщения с текстом
  const meaningfulMessages = messages.filter((m) => m.content && m.content.trim().length > 0);
  if (meaningfulMessages.length === 0) {
    return null;
  }

  // Форматируем стенограмму для модели
  const transcript = meaningfulMessages
    .map((m) => {
      const role =
        m.source === "customer" || m.source === "client"
          ? "Клиент"
          : m.source === "system"
            ? "Система"
            : "Менеджер / Бот";
      return `${role}: ${m.content.trim()}`;
    })
    .join("\n");

  // 1. Пробуем получить умную выжимку через LLM Router (быстрый легкий tier)
  try {
    const result = await Promise.race([
      smartModelRouter.execute(
        {
          model: "gemini-3.5-flash-lite",
          messages: [
            { role: "system", content: SYSTEM_SUMMARY_PROMPT },
            {
              role: "user",
              content: `Диалог с клиентом:\n${transcript}\n\nСформируй краткую суть обращения (2-3 предложения):`,
            },
          ],
          temperature: 0.2,
          maxTokens: 250,
        },
        {
          tenantId: options?.tenantId,
        },
      ),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error("LLM summary timeout")), 4000),
      ),
    ]);

    if (result && result.content) {
      const cleaned = result.content.trim().replace(/^["']|["']$/g, "");
      if (cleaned.length > 10) {
        return cleaned;
      }
    }
  } catch (err) {
    // В случае сбоя LLM или отсутствия ключей — мгновенно переходим на детерминированный fallback
  }

  // 2. Детерминированный fallback
  return buildDeterministicSummary(meaningfulMessages);
}

/**
 * Извлечение сообщений сделки из базы данных с multi-tenant изоляцией
 * и формирование краткой сути обращения.
 */
export async function getDealConversationSummary(
  tenantId: string,
  dealId: string,
): Promise<string | null> {
  try {
    const rows = await query<ChatMessageItem>(
      `SELECT source, sender_name, content, created_at
       FROM deal_messages
       WHERE tenant_id = $1 AND deal_id = $2
       ORDER BY created_at ASC`,
      [tenantId, dealId],
    );

    return await generateLeadSummary(rows, { tenantId });
  } catch (err) {
    console.warn(`[LeadSummary] Failed to load messages for deal ${dealId}:`, err);
    return null;
  }
}
