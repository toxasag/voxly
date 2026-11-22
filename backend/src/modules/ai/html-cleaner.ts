// ---------------------------------------------------------------------------
// Общий парсер HTML → Markdown/текст для базы знаний (site-crawler + web-extractor).
//
// Устраняет дублирование пайплайна очистки HTML:
//   - извлечение заголовка (<title> / <h1>);
//   - удаление адаптивных мобильных дублей Tilda, скриптов, стилей, SVG, iframe;
//   - форматирование таблиц и <dl>/<dt>/<dd> в Markdown;
//   - декодирование HTML-сущностей и фильтрация типовых шумовых строк.
// ---------------------------------------------------------------------------

export interface CleanHtmlOptions {
  /** Удалять <nav>, <header>, <footer>, <aside> до парсинга (для web-extractor). */
  stripLayoutChrome?: boolean;
  /** Удалять типовые фразы cookie-баннеров и согласий на обработку ПДн. */
  stripCookieBanners?: boolean;
}

const NOISE_LINE_REGEX =
  /^(р\.|руб\.|рублей|от|до|подробнее|получить прайс|оставить заявку|заказать звонок|заявка|отправить|купить|\d+\s*из\s*\d+|предыдущий слайд|следующий слайд|закрыть диалоговое окно|[-–—•*])$/i;

export function cleanHtmlToMarkdown(
  html: string,
  options: CleanHtmlOptions = {},
): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = h1Match && h1Match[1] ? h1Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  }

  let cleaned = html.replace(
    /<div\b[^>]*class="[^"]*t-screenmax-(?:480|640)px[^"]*"[\s\S]*?<\/div>\s*<\/div>/gi,
    " ",
  );

  cleaned = cleaned
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ");

  if (options.stripLayoutChrome) {
    cleaned = cleaned
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, " ");
  }

  cleaned = cleaned
    .replace(/<button\b[^>]*class="[^"]*t-popup__close-wrapper[^"]*"[\s\S]*?<\/button>/gi, " ")
    .replace(/<ul\b[^>]*class="[^"]*t-slds__arrow_container[^"]*"[\s\S]*?<\/ul>/gi, " ")
    .replace(/<div\b[^>]*class="[^"]*t-slds__arrow_container[^"]*"[\s\S]*?<\/div>/gi, " ");

  cleaned = cleaned.replace(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi, (_match, row: string) => {
    const cells = [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) =>
      (c[1] ?? "").replace(/<[^>]+>/g, " ").trim(),
    );
    if (cells.length === 0) return "\n";
    return `\n| ${cells.join(" | ")} |\n`;
  });

  cleaned = cleaned
    .replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, "\n**$1:** ")
    .replace(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, " $1\n");

  const blockCloseRegex = options.stripLayoutChrome
    ? /<\/(div|p|section|article|table)>/gi
    : /<\/(div|p|section|article|header|footer|aside|table)>/gi;

  cleaned = cleaned
    .replace(blockCloseRegex, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h4[^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ");

  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  cleaned = cleaned
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&laquo;/gi, "«")
    .replace(/&raquo;/gi, "»")
    .replace(/&#([0-9]+);/g, (_, code: string) => String.fromCharCode(Number(code)));

  if (options.stripCookieBanners) {
    cleaned = cleaned
      .replace(/мы используем файлы cookie[^\n.]*[.\n]?/gi, "")
      .replace(/соглашаюсь с политикой конфиденциальности[^\n.]*[.\n]?/gi, "")
      .replace(/даю согласие на обработку персональных данных[^\n.]*[.\n]?/gi, "")
      .replace(/нажимая кнопку,? вы соглашаетесь[^\n.]*[.\n]?/gi, "");
  }

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

  return { title, text: filteredLines.join("\n") };
}
