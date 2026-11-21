import {
  GatewayChatProvider,
  type ChatProvider,
} from "../../services/chat.service.js";
import { cleanHtmlToMarkdown } from "./html-cleaner.js";

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
 * Сохраняет каталог оборудования, карточки товаров, таблицы характеристик и списки параметров.
 */
export function cleanHtmlForKnowledge(html: string): { title: string; cleanText: string } {
  const { title, text } = cleanHtmlToMarkdown(html, {
    stripLayoutChrome: true,
    stripCookieBanners: true,
  });

  return {
    title: title || "Материалы сайта",
    cleanText: text,
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
Страница может содержать каталог оборудования, товаров, услуг, прайс-лист, технические характеристики или регламенты.

СТРОГАЯ СТРУКТУРА ВЫХОДНОГО MARKDOWN:
# ${effectiveTitle}
Краткая суть страницы, специализация и главное предложение компании.

## Каталог оборудования, продукции и услуг
- Перечисли ВСЕ представленные модели, модификации, комплектации, приборы или услуги с их точными названиями.
- Для каждой модели подробно укажи назначение и комплект поставки (блоки управления, модули, насадки, принадлежности).

## Технические характеристики и параметры оборудования
- Перенеси ВСЕ таблицы параметров и списки характеристик для каждой модели (габариты, вес, диапазоны частот, амплитуды, напряжение, потребляемая мощность, магнитное поле, класс защиты и рабочие температуры).
- Сохраняй точные единицы измерений (Гц, Вт, В, кг, см, мТл, IP).

## Цены, тарифы и условия приобретения
- Точные цены, тарифы, условия рассрочки или пояснение о порядке запроса коммерческого предложения/расчета сметы.

## Преимущества, технологии и эффекты
- Запатентованные методики, принципы воздействия, сферы применения (лицо, тело, реабилитация) и клинические эффекты.

## Ограничения, противопоказания и риски
- Противопоказания, предупреждения о подделках/репликах, требования безопасности и регламенты.

## Частые вопросы и ответы (FAQ)
**В: [Популярный вопрос клиента]?**
О: [Четкий ответ на основе фактов со страницы].

## Контакты, дилеры и география
- Телефоны, адреса, города, дилеры, режим работы (только то, что реально есть на странице).

ЖЕЛЕЗНЫЕ ПРАВИЛА:
1. Вычисти весь мусор: согласие на cookie, пункты меню, пустые ссылки, дублирующиеся кнопки.
2. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО пропускать или сокращать модели оборудования, комплектацию и технические характеристики.
3. Сохраняй реальные цифры, диапазоны, габариты, адреса и условия.
4. Категорически запрещено выдумывать факты, которых нет в тексте.
5. Ответ — СТРОГО чистый Markdown с заголовками # и ##, без преамбул («Вот результат:») и без \`\`\`markdown.`;

      const userContent = `URL страницы: ${input.url || "не указан"}\n\nТекст страницы:\n${textSlice}`;

      const completion = await this.chatProvider.complete({
        model: "gemini-3.5-flash-lite",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        maxTokens: 8192,
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
