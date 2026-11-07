import {
  GatewayChatProvider,
  type ChatProvider,
} from "../../services/chat.service.js";

export interface StructuredSection {
  title: string;
  content: string;
}

export interface WebExtractionResult {
  title: string;
  structuredMarkdown: string;
  sectionsCount: number;
  totalChars: number;
}

/**
 * Очищает сырой HTML страницы от мусора (скрипты, стили, шапки, подвалы, cookie-баннеры, навигация).
 */
export function cleanHtmlForKnowledge(html: string): { title: string; cleanText: string } {
  // 1. Извлекаем заголовок страницы
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = h1Match && h1Match[1] ? h1Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "Материалы сайта";
  }

  // 2. Вычищаем служебные и нерелевантные теги целиком
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
    // Удаляем навигацию, футеры, формы и модалки/cookie-баннеры
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, " ");

  // 3. Структурные теги заменяем на переносы строк и маркеры Markdown
  cleaned = cleaned
    .replace(/<\/(div|p|section|article|table|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h4[^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<th[^>]*>/gi, " | ")
    .replace(/<td[^>]*>/gi, " | ");

  // 4. Удаляем оставшиеся теги
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // 5. Декодируем HTML-сущности
  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCharCode(Number(code)));

  // 6. Убираем типовой мусор cookie-согласий и плашек персональных данных
  cleaned = cleaned
    .replace(/мы используем файлы cookie[^\n.]*[.\n]?/gi, "")
    .replace(/соглашаюсь с политикой конфиденциальности[^\n.]*[.\n]?/gi, "")
    .replace(/даю согласие на обработку персональных данных[^\n.]*[.\n]?/gi, "")
    .replace(/нажимая кнопку,? вы соглашаетесь[^\n.]*[.\n]?/gi, "");

  // 7. Схлопываем лишние пробелы и пустые строки
  const lines = cleaned
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);

  return {
    title,
    cleanText: lines.join("\n"),
  };
}

export class WebExtractorService {
  constructor(private readonly chatProvider: ChatProvider = new GatewayChatProvider()) {}

  /**
   * Превращает сырую страницу или дамп сайта в структурированную базу знаний (Markdown).
   * Выделяет Услуги, Условия, Цены, Ограничения, FAQ и Контакты в семантические секции.
   */
  async extractAndStructure(input: {
    url?: string;
    htmlOrText: string;
    title?: string;
    tenantId?: string;
  }): Promise<WebExtractionResult> {
    const isHtml = input.htmlOrText.includes("<") && input.htmlOrText.includes(">");
    const cleaned = isHtml
      ? cleanHtmlForKnowledge(input.htmlOrText)
      : { title: input.title || "Материалы документа", cleanText: input.htmlOrText.trim() };

    const effectiveTitle = input.title?.trim() || cleaned.title || "Материалы сайта";
    const textSlice = cleaned.cleanText.slice(0, 45_000);

    // Если текста мало, возвращаем аккуратно оформленный markdown без обращения к модели
    if (textSlice.length < 350) {
      const fallbackMarkdown = `# ${effectiveTitle}\n\n${textSlice}`;
      return {
        title: effectiveTitle,
        structuredMarkdown: fallbackMarkdown,
        sectionsCount: 1,
        totalChars: fallbackMarkdown.length,
      };
    }

    try {
      const systemPrompt = `Ты — ведущий AI-аналитик и архитектор баз знаний платформы GETVOXLY.
Твоя задача — извлечь из сырого текста страницы структурированные факты для базы знаний AI-консультанта.

СТРОГАЯ СТРУКТУРА ВЫХОДНОГО MARKDOWN:
# ${effectiveTitle}
Краткая суть страницы, специализация и главное предложение компании.

## Услуги и условия
- Ключевые условия, критерии, пороги (например, суммы долгов, требования закона 127-ФЗ, МФЦ / суд).
- Порядок и этапы оказания услуг (по шагам).

## Цены, тарифы и госпошлины
- Точные цены, тарифы, бесплатные процедуры (например, госпошлина 0 руб. в МФЦ) или пояснение об индивидуальном расчете.

## Ограничения, риски и важные требования
- Когда услуга не подходит или есть ограничения (например, ипотека/залоговое жилье, имущество, работа с приставами).
- Требования законодательства и предупреждения.

## Частые вопросы и ответы (FAQ)
**В: [Популярный вопрос клиента]?**
О: [Четкий ответ на основе фактов со страницы].

## Контакты и география
- Телефоны, адреса, города, режим работы (только то, что реально есть на странице).

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. Вычисти весь мусор: согласие на обработку данных, cookie, пункты меню, пустые ссылки, дублирующиеся кнопки.
2. Сохраняй реальные цифры, законы (127-ФЗ), статьи, адреса и условия.
3. Категорически запрещено выдумывать факты, которых нет в тексте.
4. Ответ — СТРОГО чистый Markdown с заголовками # и ##, без преамбул («Вот результат:») и без \`\`\`markdown.`;

      const userContent = `URL страницы: ${input.url || "не указан"}\n\nТекст страницы:\n${textSlice}`;

      const completion = await this.chatProvider.complete({
        model: "gemini-3.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        maxTokens: 3000,
        tenantId: input.tenantId,
      });

      let markdown = completion.content
        .replace(/^```[a-z]*\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();

      // Страховка: если модель не добавила заголовок верхнего уровня
      if (!markdown.startsWith("# ")) {
        markdown = `# ${effectiveTitle}\n\n${markdown}`;
      }

      // Подсчет секций (## и #)
      const sectionsMatch = markdown.match(/^#{1,3}\s+.+$/gm);
      const sectionsCount = sectionsMatch ? sectionsMatch.length : 1;

      return {
        title: effectiveTitle,
        structuredMarkdown: markdown,
        sectionsCount,
        totalChars: markdown.length,
      };
    } catch {
      // Graceful fallback: если LLM недоступен, возвращаем очищенный от HTML текст с заголовками
      const fallbackMarkdown = `# ${effectiveTitle}\n\n${cleaned.cleanText}`;
      const sectionsMatch = fallbackMarkdown.match(/^#{1,3}\s+.+$/gm);
      return {
        title: effectiveTitle,
        structuredMarkdown: fallbackMarkdown,
        sectionsCount: sectionsMatch ? sectionsMatch.length : 1,
        totalChars: fallbackMarkdown.length,
      };
    }
  }
}

export const webExtractorService = new WebExtractorService();
