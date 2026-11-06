import type { TagColor } from "@/components/ui/tag";

// ---------------------------------------------------------------------------
// Семантический парсер и сериализатор блоков страницы для Базы Знаний (RAG).
// Превращает сплошное Markdown-полотно страницы сайта в модульные блоки
// (Шапка, Секции, Прайс, FAQ, Контакты) и собирает обратно в чистый Markdown.
// ---------------------------------------------------------------------------

export type ContentBlockType =
  | "hero"
  | "section"
  | "pricing"
  | "faq"
  | "contacts"
  | "raw";

export interface ContentBlock {
  id: string;
  type: ContentBlockType;
  title: string;
  content: string;
  collapsed?: boolean;
}

export interface BlockTypeMeta {
  type: ContentBlockType;
  label: string;
  shortLabel: string;
  description: string;
  color: TagColor;
}

export const BLOCK_TYPE_CONFIG: Record<ContentBlockType, BlockTypeMeta> = {
  hero: {
    type: "hero",
    label: "Шапка / Главный экран",
    shortLabel: "Главный",
    description: "УТП, оффер, заголовок страницы и введение",
    color: "violet",
  },
  section: {
    type: "section",
    label: "Смысловая секция",
    shortLabel: "Секция",
    description: "Основное содержание, описание условий или процессов",
    color: "sky",
  },
  pricing: {
    type: "pricing",
    label: "Цены и тарифы",
    shortLabel: "Прайс",
    description: "Стоимость услуг, рассрочка, тарифы и акции",
    color: "emerald",
  },
  faq: {
    type: "faq",
    label: "Вопрос-ответ (FAQ)",
    shortLabel: "FAQ",
    description: "Популярные вопросы клиентов и подробные ответы",
    color: "amber",
  },
  contacts: {
    type: "contacts",
    label: "Контакты и реквизиты",
    shortLabel: "Контакты",
    description: "Телефоны, адреса, режим работы, реквизиты компании",
    color: "cyan",
  },
  raw: {
    type: "raw",
    label: "Прочее / Текст",
    shortLabel: "Текст",
    description: "Служебная информация, сноски или неформатированный текст",
    color: "slate",
  },
};

/**
 * Определение семантического типа блока по заголовку и содержанию.
 */
export function detectBlockType(
  title: string,
  content: string,
  index: number,
  isFirstHeader: boolean = false
): ContentBlockType {
  const combined = `${title}\n${content}`.toLowerCase();

  // 1. FAQ / Вопрос-ответ
  if (
    /(\bfaq\b|вопрос[ы-]?\s*и\s*ответ|часто\s*задава|частые\s*вопрос|вопрос\b|ответ\b|q&a)/i.test(
      title
    ) ||
    /(\bq:|\ba:|\bв:|\bо:|\bвопрос:|\bответ:)/i.test(content)
  ) {
    return "faq";
  }

  // 2. Цены / Тарифы / Стоимость
  if (
    /(цен[ыа]|стоимост|тариф|прайс|расценк|оплат|скидк|price|pricing|калькулятор|сколько\s*стоит)/i.test(
      title
    ) ||
    /(\bруб(\.|\b)|₽|\bстоимость\s*от\b|\bцена\s*от\b)/i.test(content.slice(0, 300))
  ) {
    return "pricing";
  }

  // 3. Контакты / Реквизиты
  if (
    /(контакт|адрес|телефон|реквизит|схема\s*проезда|режим\s*работы|как\s*добраться|связаться|обратная\s*связь|филиал)/i.test(
      title
    )
  ) {
    return "contacts";
  }

  // 4. Hero / Шапка (первый блок, H1 или общее введение)
  if (
    (index === 0 && isFirstHeader) ||
    index === 0 ||
    /(главн|о компании|о сервисе|добро\s*пожаловать|welcome|что\s*мы\s*делаем)/i.test(
      title
    )
  ) {
    return "hero";
  }

  // 5. По умолчанию — обычная секция
  return "section";
}

/**
 * Создание уникального идентификатора блока.
 */
function generateBlockId(index: number): string {
  return `block_${Date.now()}_${index}_${Math.random().toString(36).substring(2, 7)}`;
}

/**
 * Парсинг монолитного текста/Markdown в структурированный массив блоков.
 */
export function parseMarkdownToBlocks(rawText: string): ContentBlock[] {
  const text = (rawText || "").replace(/\r\n/g, "\n").trim();
  if (!text) {
    return [
      {
        id: generateBlockId(0),
        type: "section",
        title: "Основной раздел",
        content: "",
        collapsed: false,
      },
    ];
  }

  const lines = text.split("\n");
  const blocks: ContentBlock[] = [];

  // Регулярное выражение для заголовков Markdown (#, ##, ###, ####)
  const headerRegex = /^(#{1,4})\s+(.+)$/;

  let currentTitle = "";
  let currentLines: string[] = [];
  let isFirstHeader = true;
  let headerFound = false;

  const pushCurrentBlock = () => {
    const rawContent = currentLines.join("\n").trim();
    if (!currentTitle && !rawContent) return;

    let finalTitle = currentTitle.trim();
    let finalContent = rawContent;

    // Если заголовок не был задан (вводная секция до первого #)
    if (!finalTitle) {
      if (blocks.length === 0) {
        finalTitle = "Введение / Шапка";
      } else {
        // Попробуем взять первую непустую строку как заголовок
        const firstLine = currentLines.find((l) => l.trim().length > 0)?.trim() || "";
        if (firstLine && firstLine.length <= 80 && !firstLine.startsWith("-")) {
          finalTitle = firstLine;
          finalContent = currentLines.filter((l) => l.trim() !== firstLine).join("\n").trim();
        } else {
          finalTitle = `Раздел ${blocks.length + 1}`;
        }
      }
    }

    const type = detectBlockType(
      finalTitle,
      finalContent,
      blocks.length,
      isFirstHeader && blocks.length === 0
    );

    blocks.push({
      id: generateBlockId(blocks.length),
      type,
      title: finalTitle,
      content: finalContent,
      collapsed: false,
    });

    currentTitle = "";
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(headerRegex);

    if (match) {
      headerFound = true;
      // Сохраняем предыдущий блок, если он был
      if (currentTitle || currentLines.length > 0) {
        pushCurrentBlock();
        isFirstHeader = false;
      }
      currentTitle = match[2].trim();
    } else {
      currentLines.push(line);
    }
  }

  // Добавляем последний блок
  if (currentTitle || currentLines.length > 0) {
    pushCurrentBlock();
  }

  // Если в документе вообще не было # заголовков, пробуем нарезать по двойным переносам
  if (!headerFound && blocks.length <= 1) {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (paragraphs.length > 1) {
      const fallbackBlocks: ContentBlock[] = [];
      paragraphs.forEach((p, idx) => {
        const pLines = p.split("\n");
        let pTitle = "";
        let pContent = p;

        if (pLines[0].length <= 80 && !pLines[0].startsWith("-") && pLines.length > 1) {
          pTitle = pLines[0].trim();
          pContent = pLines.slice(1).join("\n").trim();
        } else {
          pTitle = idx === 0 ? "Введение" : `Раздел ${idx + 1}`;
        }

        fallbackBlocks.push({
          id: generateBlockId(idx),
          type: detectBlockType(pTitle, pContent, idx, idx === 0),
          title: pTitle,
          content: pContent,
          collapsed: false,
        });
      });
      return fallbackBlocks;
    }
  }

  // Если всё еще пусто
  if (blocks.length === 0) {
    blocks.push({
      id: generateBlockId(0),
      type: "section",
      title: "Основной раздел",
      content: text,
      collapsed: false,
    });
  }

  return blocks;
}

/**
 * Сериализация блоков обратно в чистый валидный Markdown для сохранения и RAG-векторизации.
 */
export function serializeBlocksToMarkdown(blocks: ContentBlock[]): string {
  if (!blocks || blocks.length === 0) return "";

  const sections: string[] = [];

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const title = (block.title || "").trim();
    const content = (block.content || "").trim();

    if (!title && !content) continue;

    // Определяем уровень заголовка
    const headerPrefix = block.type === "hero" && i === 0 ? "#" : "##";

    // Проверяем, не начинается ли контент уже с такого же заголовка
    const contentStartsWithHeader =
      content.startsWith("# ") ||
      content.startsWith("## ") ||
      content.startsWith("### ");

    let blockMarkdown = "";

    if (title) {
      if (contentStartsWithHeader) {
        // Если внутри уже есть заголовок, используем контент как есть
        blockMarkdown = content;
      } else if (content) {
        blockMarkdown = `${headerPrefix} ${title}\n\n${content}`;
      } else {
        blockMarkdown = `${headerPrefix} ${title}`;
      }
    } else {
      blockMarkdown = content;
    }

    sections.push(blockMarkdown.trim());
  }

  return sections.join("\n\n");
}
