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
 * Сохраняет каталог оборудования, карточки товаров, таблицы характеристик и списки параметров.
 */
export function cleanHtmlForKnowledge(html: string): { title: string; cleanText: string } {
  // 1. Извлекаем заголовок страницы
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = h1Match && h1Match[1] ? h1Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "Материалы сайта";
  }

  // 2. Удаляем адаптивные дубликаты мобильных блоков (Tilda и др.), сохраняя основной контент
  let cleaned = html
    .replace(/<div\b[^>]*class="[^"]*t-screenmax-(?:480|640)px[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi, " ");

  // 3. Вычищаем служебные и нерелевантные теги целиком
  cleaned = cleaned
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ")
    // Удаляем навигацию, футеры и служебные обвязки
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ")
    // Удаляем элементы управления слайдерами и крестики закрытия попапов
    .replace(/<button\b[^>]*class="[^"]*t-popup__close-wrapper[^"]*"[\s\S]*?<\/button>/gi, " ")
    .replace(/<ul\b[^>]*class="[^"]*t-slds__arrow_container[^"]*"[\s\S]*?<\/ul>/gi, " ")
    .replace(/<div\b[^>]*class="[^"]*t-slds__arrow_container[^"]*"[\s\S]*?<\/div>/gi, " ");

  // 4. Форматируем таблицы в Markdown
  cleaned = cleaned.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_match, row) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      c[1].replace(/<[^>]+>/g, " ").trim(),
    );
    if (cells.length === 0) return "\n";
    return `\n| ${cells.join(" | ")} |\n`;
  });

  // 5. Форматируем списки определений (<dl>, <dt>, <dd>)
  cleaned = cleaned
    .replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, "\n**$1:** ")
    .replace(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, " $1\n");

  // 6. Структурные теги заменяем на переносы строк и маркеры Markdown
  cleaned = cleaned
    .replace(/<\/(div|p|section|article|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h4[^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ");

  // 7. Удаляем оставшиеся HTML-теги
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // 8. Декодируем HTML-сущности
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

  // 9. Убираем типовой мусор cookie-согласий и плашек персональных данных
  cleaned = cleaned
    .replace(/мы используем файлы cookie[^\n.]*[.\n]?/gi, "")
    .replace(/соглашаюсь с политикой конфиденциальности[^\n.]*[.\n]?/gi, "")
    .replace(/даю согласие на обработку персональных данных[^\n.]*[.\n]?/gi, "")
    .replace(/нажимая кнопку,? вы соглашаетесь[^\n.]*[.\n]?/gi, "");

  // 10. Фильтрация пустых служебных строк, кнопок и дублей
  const NOISE_LINE_REGEX =
    /^(р\.|руб\.|рублей|от|до|подробнее|получить прайс|оставить заявку|заказать звонок|заявка|отправить|купить|\d+\s*из\s*\d+|предыдущий слайд|следующий слайд|закрыть диалоговое окно|[-–—•*])$/i;

  const rawLines = cleaned.split("\n");
  const filteredLines: string[] = [];
  let lastLine = "";

  for (const rawLine of rawLines) {
    const line = rawLine.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (NOISE_LINE_REGEX.test(line)) continue;
    if (line === lastLine) continue;
    filteredLines.push(line);
    lastLine = line;
  }

  return {
    title,
    cleanText: filteredLines.join("\n"),
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
