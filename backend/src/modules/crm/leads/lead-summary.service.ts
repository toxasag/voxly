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

import { query, queryOne } from "../../../db/client.js";
import { smartModelRouter } from "../../ai/gateway/smart-model-router.js";

export interface ChatMessageItem {
  source: string;
  sender_name?: string | null;
  content: string;
  created_at?: Date | string;
}

const SYSTEM_SUMMARY_PROMPT = `
Ты — аналитик входящих обращений клиентов в CRM.
Твоя задача: составить предельно краткую, емкую и полезную сводку диалога (1-3 строки) для менеджера отдела продаж.

СТРОГИЕ ПРАВИЛА (Anti-Sludge):
1. Никакого канцелярита и нейрослопа! Категорически запрещены абстрактные фразы ("клиент выразил заинтересованность", "в ходе диалога", "запросил расчёт стоимости внедрения и скидки на объём").
2. Фиксируй ключевые осязаемые сущности:
   - Локация / Город (СПб, Питер, Москва, регион).
   - Потребность / оборудование / услуга (например: аппарат на все тело, лицо, тело, полный комплект).
   - Конкретный запрос (прайс-лист, спецификация, условия поставки, видео-демо).
   - Контакты (имя, телефон, email, Telegram).
3. Формат выжимки: предельно лаконичный, фактологический, готовый для отображения в заметке на карточке сделки.
Пример: "СПб. Аппарат на все тело (лицо, тело, полный). Запросила прайс. Контакты: Наталья (+79102470980, magha@mail.ru, TG: @NataliaDiudiaeva)"
`.trim();

/**
 * Создаёт или обновляет заметку с AI-выжимкой диалога в таблице notes.
 * Это гарантирует немедленное отображение выжимки в карточке сделки (Заметка: ...) на Канбан-доске.
 */
export async function syncDealSummaryNote(
  tenantId: string,
  dealId: string,
  summary: string,
): Promise<void> {
  if (!summary || !summary.trim()) return;

  const title = "[AI Выжимка]";
  const body = summary.trim();

  try {
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM notes
       WHERE tenant_id = $1 AND deal_id = $2 AND title = $3 AND deleted_at IS NULL
       LIMIT 1`,
      [tenantId, dealId, title],
    );

    if (existing) {
      await query(
        `UPDATE notes
         SET body = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [body, existing.id, tenantId],
      );
    } else {
      const deal = await queryOne<{ created_by: string | null }>(
        `SELECT created_by FROM deals WHERE id = $1 AND tenant_id = $2`,
        [dealId, tenantId],
      );

      await query(
        `INSERT INTO notes (tenant_id, deal_id, created_by, title, body, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())`,
        [tenantId, dealId, deal?.created_by ?? null, title, body],
      );
    }
  } catch (err) {
    console.warn(`[LeadSummary] Failed to sync summary note for deal ${dealId}:`, err);
  }
}

/**
 * Детерминированная сборка выжимки без LLM (Fallback).
 * Извлекает ключевые сообщения клиента и формирует понятный текст с сущностями.
 */
export function buildDeterministicSummary(messages: ChatMessageItem[]): string | null {
  const customerMsgs = messages
    .filter((m) => {
      const src = (m.source || "").toLowerCase();
      return (src === "customer" || src === "client" || src === "user") && m.content?.trim();
    })
    .map((m) => m.content.trim());

  if (customerMsgs.length === 0) {
    const nonSystem = messages
      .filter((m) => (m.source || "").toLowerCase() !== "system" && m.content?.trim())
      .map((m) => `${m.sender_name ? `${m.sender_name}: ` : ""}${m.content.trim()}`);
    if (nonSystem.length === 0) return null;
    return nonSystem.slice(-3).join(" · ");
  }

  const fullText = customerMsgs.join(" ");

  // Извлечение локации
  let location = "";
  if (/(?:^|[^а-яёa-z0-9])(?:спб|питер|санкт-петербург)(?:[^а-яёa-z0-9]|$)/i.test(fullText)) {
    location = "СПб";
  } else if (/(?:^|[^а-яёa-z0-9])(?:москва|мск)(?:[^а-яёa-z0-9]|$)/i.test(fullText)) {
    location = "Москва";
  }

  // Извлечение ключевых запросов
  const topics: string[] = [];
  if (/лицо.*тело.*полн|все\s+три|на\s+все\s+три/i.test(fullText)) {
    topics.push("Аппарат на все тело (лицо, тело, полный)");
  } else if (/лицо/i.test(fullText) && /тело/i.test(fullText)) {
    topics.push("Аппарат для лица и тела");
  } else if (/лицо/i.test(fullText)) {
    topics.push("Аппарат для лица");
  } else if (/тело/i.test(fullText)) {
    topics.push("Аппарат для тела");
  }

  if (/прайс/i.test(fullText)) {
    topics.push("Запрос прайс-листа");
  }

  // Контакты из текста
  const contacts: string[] = [];
  const nameMatch = fullText.match(/(?:меня\s+зовут|зовут)\s+([А-ЯЁ][а-яё]+)/i);
  if (nameMatch && nameMatch[1]) contacts.push(nameMatch[1]);

  const phoneMatch = fullText.match(/(?:\+7|8)[\d\s\(\)\-]{9,}/);
  if (phoneMatch) contacts.push(phoneMatch[0].trim());

  const emailMatch = fullText.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) contacts.push(emailMatch[0].trim());

  const parts: string[] = [];
  if (location) parts.push(location);
  if (topics.length > 0) parts.push(topics.join(". "));
  if (contacts.length > 0) parts.push(`Контакты: ${contacts.join(", ")}`);

  if (parts.length > 0) {
    return parts.join(". ");
  }

  const first = customerMsgs[0];
  if (!first) return null;
  const last = customerMsgs[customerMsgs.length - 1] ?? first;
  return customerMsgs.length === 1 || first === last ? first : `${first}\nУточнение: ${last}`;
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

    const summary = await generateLeadSummary(rows, { tenantId });
    if (summary) {
      void syncDealSummaryNote(tenantId, dealId, summary).catch(() => {});
    }
    return summary;
  } catch (err) {
    console.warn(`[LeadSummary] Failed to load messages for deal ${dealId}:`, err);
    return null;
  }
}
