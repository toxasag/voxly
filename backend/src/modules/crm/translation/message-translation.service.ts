import { query, queryOne, runWithTenantContext } from "../../../db/client.js";
import { GatewayChatProvider } from "../../../services/chat.service.js";
import { detectMessageLanguage } from "../../ai/language-detector.js";
import type { DealMessageRow, DealMessageMetadata } from "../deals/deals.types.js";

export function stripTechnicalMessageMetadata(content: string): string {
  if (!content) return "";
  const technicalRegex =
    /^\s*(?:\[(?:Устройство|Страница|UTM|Реклама ClickID|Яндекс ID|YM ClientID|GA ClientID|Top\.Mail\.ru|История переходов|Визит №|Черновик)[^\]]*\]\s*)+/gi;
  return content.replace(technicalRegex, "").trim();
}

export interface MessageTranslationResult {
  id: string;
  translatedText: string | null;
  sourceLang: string;
  targetLang: string;
  cached: boolean;
  skipped?: boolean;
}

export class MessageTranslationService {
  private chatProvider = new GatewayChatProvider();

  /**
   * Переводит сообщение на целевой язык (по умолчанию русский 'ru').
   * Если перевод уже сохранен в metadata — возвращает из кэша (если не передан force = true).
   */
  async translateMessage(
    tenantId: string,
    messageId: string,
    targetLang = "ru",
    force = false,
  ): Promise<MessageTranslationResult> {
    return runWithTenantContext(tenantId, async () => {
      const msg = await queryOne<DealMessageRow>(
        `SELECT * FROM deal_messages WHERE tenant_id = $1 AND id = $2`,
        [tenantId, messageId],
      );

      if (!msg) {
        throw new Error(`Message not found: ${messageId}`);
      }

      const metadata: DealMessageMetadata = (msg.metadata as DealMessageMetadata) || {};
      const existingTranslations = (metadata.translations as Record<string, string>) || {};

      if (!force && existingTranslations[targetLang]) {
        return {
          id: messageId,
          translatedText: existingTranslations[targetLang],
          sourceLang: (metadata.detected_lang as string) || "auto",
          targetLang,
          cached: true,
        };
      }

      const cleanContent = stripTechnicalMessageMetadata(msg.content || "");
      if (!cleanContent) {
        return {
          id: messageId,
          translatedText: null,
          sourceLang: "unknown",
          targetLang,
          cached: false,
          skipped: true,
        };
      }

      // Проверка на заглушки вложений и короткие символы
      const isDummy =
        cleanContent === "." ||
        cleanContent === "[документ]" ||
        cleanContent === "Вложение" ||
        cleanContent === "Фотография" ||
        cleanContent === "Видео" ||
        cleanContent === "Аудио" ||
        /^\[(?:файл|документ|фото|видео|аудио|голосовое|стикер):?\s*[^\]]*\]$/i.test(cleanContent);

      if (isDummy) {
        return {
          id: messageId,
          translatedText: null,
          sourceLang: "unknown",
          targetLang,
          cached: false,
          skipped: true,
        };
      }

      // Детектируем исходный язык сообщения
      const detection = detectMessageLanguage(cleanContent);
      const sourceLang = detection.lang;

      // Если исходный язык совпадает с целевым (русский на русский)
      if (
        (sourceLang === targetLang && targetLang === "ru") ||
        (targetLang === "ru" && detection.isCyrillic && !detection.isLatin)
      ) {
        await query(
          `UPDATE deal_messages
           SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{detected_lang}', to_jsonb($1::text), true)
           WHERE tenant_id = $2 AND id = $3`,
          ["ru", tenantId, messageId],
        );

        return {
          id: messageId,
          translatedText: null,
          sourceLang: "ru",
          targetLang,
          cached: false,
          skipped: true,
        };
      }

      // Вызываем LLM через имеющийся GatewayChatProvider
      let translatedText = "";
      try {
        const targetDesc = targetLang === "ru" ? "живой, естественный и грамотный русский язык" : targetLang;
        const completion = await this.chatProvider.complete({
          model: "gemini/gemini-3.5-flash-lite",
          messages: [
            {
              role: "system",
              content: `Ты — профессиональный синхронный переводчик клиентских сообщений для операторов CRM.
Переведи входящее сообщение клиента на ${targetDesc}.
Требования:
1. Переводи точно, естественно и дружелюбно, как в живой бизнес-переписке.
2. Сохраняй неизменными имена собственные, адреса, бренды, телефоны, email, ссылки [текст](url), суммы и валюты.
3. Верни СТРОГИЙ JSON формат: { "translation": "текст перевода", "detected_lang": "${sourceLang}" }
4. Без markdown обёрток, рассуждений и преамбул.`,
            },
            {
              role: "user",
              content: cleanContent,
            },
          ],
          temperature: 0.1,
          maxTokens: 512,
          jsonMode: true,
          tenantId,
        });

        const parsed = JSON.parse(completion.content) as {
          translation?: string;
          text?: string;
          detected_lang?: string;
        };

        translatedText = (parsed.translation || parsed.text || "").trim();
      } catch (err) {
        console.warn(`[MessageTranslationService] Error during AI translation for message ${messageId}:`, err);
        throw err;
      }

      if (!translatedText) {
        return {
          id: messageId,
          translatedText: null,
          sourceLang,
          targetLang,
          cached: false,
        };
      }

      // Сохраняем перевод в metadata
      const updatedTranslations = {
        ...existingTranslations,
        [targetLang]: translatedText,
      };

      const translationMeta = {
        ru: targetLang === "ru" ? translatedText : existingTranslations["ru"],
        source_lang: sourceLang,
        translated_at: new Date().toISOString(),
      };

      await query(
        `UPDATE deal_messages
         SET metadata = jsonb_set(
           jsonb_set(
             jsonb_set(
               COALESCE(metadata, '{}'::jsonb),
               '{translations}',
               $1::jsonb,
               true
             ),
             '{translation}',
             $2::jsonb,
             true
           ),
           '{detected_lang}',
           to_jsonb($3::text),
           true
         )
         WHERE tenant_id = $4 AND id = $5`,
        [
          JSON.stringify(updatedTranslations),
          JSON.stringify(translationMeta),
          sourceLang,
          tenantId,
          messageId,
        ],
      );

      return {
        id: messageId,
        translatedText,
        sourceLang,
        targetLang,
        cached: false,
      };
    });
  }

  /**
   * Асинхронный автоперевод входящего сообщения, если оно на иностранном языке.
   * Выполняется без блокировки вызывающего потока.
   */
  autoTranslateIfForeign(params: {
    tenantId: string;
    messageId: string;
    content: string;
  }): void {
    const cleanContent = stripTechnicalMessageMetadata(params.content || "");
    if (!cleanContent || cleanContent.length < 2) return;

    // Быстрая эвристика: если есть латиница/тайский/китайский и мало/нет кириллицы
    const hasForeign = /[a-zA-Z\u0E00-\u0E7F\u4E00-\u9FFF]/.test(cleanContent);
    const cyrillicCount = (cleanContent.match(/[\u0400-\u04FF]/g) || []).length;
    const latinCount = (cleanContent.match(/[a-zA-Z]/g) || []).length;

    // Если сообщение преимущественно иностранное
    if (hasForeign && (cyrillicCount === 0 || latinCount > cyrillicCount)) {
      // 300мс задержка гарантирует, что вызывающая БД-транзакция уже закомичена
      setTimeout(() => {
        this.translateMessage(params.tenantId, params.messageId, "ru", false).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[MessageTranslationService] Background auto-translation failed for ${params.messageId}:`, msg);
        });
      }, 300);
    }
  }

  /**
   * Пакетный перевод непереведенных иноязычных сообщений в сделке.
   */
  async batchTranslateDealMessages(tenantId: string, dealId: string): Promise<number> {
    return runWithTenantContext(tenantId, async () => {
      const messages = await query<DealMessageRow>(
        `SELECT * FROM deal_messages
         WHERE tenant_id = $1 AND deal_id = $2
           AND content ~ '[a-zA-Z\u0E00-\u0E7F\u4E00-\u9FFF]{3,}'
           AND (metadata->'translations'->>'ru' IS NULL)
         ORDER BY created_at ASC
         LIMIT 25`,
        [tenantId, dealId],
      );

      let translatedCount = 0;
      for (const msg of messages) {
        try {
          const res = await this.translateMessage(tenantId, msg.id, "ru", false);
          if (res.translatedText) translatedCount++;
        } catch {
          // Игнорируем единичные сбои при пакетном переводе
        }
      }
      return translatedCount;
    });
  }
}

export const messageTranslationService = new MessageTranslationService();
