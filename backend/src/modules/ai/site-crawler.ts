// ---------------------------------------------------------------------------
// Сканер сайта (Site Crawler & Spider) для базы знаний ИИ-агентов.
//
// Обходит все страницы указанного сайта (через sitemap.xml и внутренние ссылки),
// извлекает чистый структурированный текст без разметки и скриптов,
// и передает страницы в базу знаний для RAG-индексации.
// ---------------------------------------------------------------------------

export interface CrawledPage {
  url: string;
  path: string;
  title: string;
  text: string;
}

export interface CrawlWebsiteOptions {
  maxPages?: number;
  timeoutMs?: number;
}

const DEFAULT_MAX_PAGES = 25;
const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 GETVOXLY-Bot/1.0";

const FORBIDDEN_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "tif",
  "tiff",
  "pdf",
  "zip",
  "rar",
  "tar",
  "gz",
  "7z",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "mp3",
  "wav",
  "ogg",
  "mp4",
  "avi",
  "mov",
  "mkv",
  "css",
  "js",
  "map",
  "xml",
  "json",
  "woff",
  "woff2",
  "ttf",
  "eot",
]);

/**
 * Проверка URL на безопасность (защита от SSRF).
 */
export function validateUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Некорректный адрес сайта. Укажите URL с http:// или https://");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Поддерживаются только протоколы http:// и https://");
  }

  const host = parsed.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "0.0.0.0" ||
    host.startsWith("127.") ||
    host.startsWith("169.254.") ||
    host.startsWith("10.") ||
    host.startsWith("192.168.") ||
    host.startsWith("172.16.") ||
    host.startsWith("172.17.") ||
    host.startsWith("172.18.") ||
    host.startsWith("172.19.") ||
    host.startsWith("172.2") ||
    host.startsWith("172.3")
  ) {
    throw new Error("Сканирование локальных или служебных адресов сети запрещено");
  }

  return parsed;
}

/**
 * Очистка HTML-разметки до чистого текста/markdown.
 */
export function htmlToText(html: string): { title: string; text: string } {
  // Извлекаем заголовок
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  let title = titleMatch && titleMatch[1] ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  // Если заголовка нет, ищем <h1>
  if (!title) {
    const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    title = h1Match && h1Match[1] ? h1Match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
  }

  // Удаляем скрипты, стили, фреймы, служебные теги
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, " ")
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, " ")
    .replace(/<canvas\b[^<]*(?:(?!<\/canvas>)<[^<]*)*<\/canvas>/gi, " ")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, " ");

  // Структурные теги заменяем на переводы строк и маркеры
  cleaned = cleaned
    .replace(/<\/(div|p|section|article|header|footer|aside|table|tr)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>/gi, "\n\n# ")
    .replace(/<h2[^>]*>/gi, "\n\n## ")
    .replace(/<h3[^>]*>/gi, "\n\n### ")
    .replace(/<h4[^>]*>/gi, "\n\n#### ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<th[^>]*>/gi, " | ")
    .replace(/<td[^>]*>/gi, " | ");

  // Удаляем все остальные теги
  cleaned = cleaned.replace(/<[^>]+>/g, " ");

  // Декодируем базовые HTML-сущности
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

  // Схлопываем множественные пробелы и пустые строки
  const text = cleaned
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");

  return { title, text };
}

/**
 * Проверка расширения ссылки.
 */
function isAllowedUrl(url: URL, baseHost: string): boolean {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;

  // Тот же хост (с поддержкой www/без www)
  const host = url.hostname.toLowerCase();
  const cleanBase = baseHost.replace(/^www\./, "");
  const cleanHost = host.replace(/^www\./, "");
  if (cleanHost !== cleanBase) return false;

  // Проверка расширения в пути
  const pathname = url.pathname.toLowerCase();
  const extMatch = pathname.match(/\.([a-z0-9]{2,5})$/);
  if (extMatch && extMatch[1] && FORBIDDEN_EXTENSIONS.has(extMatch[1])) {
    return false;
  }

  // Исключаем служебные пути и мусор
  if (
    pathname.includes("/logout") ||
    pathname.includes("/cart") ||
    pathname.includes("/checkout") ||
    pathname.includes("/admin") ||
    pathname.includes("/wp-admin") ||
    pathname.includes("/api/") ||
    pathname.includes("/login") ||
    pathname.includes("/register") ||
    pathname.includes("/user/")
  ) {
    return false;
  }

  return true;
}

/**
 * Поиск ссылок в карте sitemap.xml сайта.
 */
async function fetchSitemapUrls(baseUrl: URL, timeoutMs: number): Promise<string[]> {
  const sitemapUrl = `${baseUrl.origin}/sitemap.xml`;
  const urls: string[] = [];

  try {
    const response = await fetch(sitemapUrl, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return [];

    const xml = await response.text();
    const locMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
    for (const match of locMatches) {
      const rawLoc = match[1]?.trim();
      if (!rawLoc) continue;
      try {
        const u = new URL(rawLoc);
        if (isAllowedUrl(u, baseUrl.hostname)) {
          // Исключаем хэши и лишние параметры
          u.hash = "";
          urls.push(u.href);
        }
      } catch {
        // Пропускаем некорректный URL
      }
    }
  } catch {
    // Если sitemap недоступен — ничего страшного, пойдем по ссылкам в HTML
  }

  return urls;
}

/**
 * Извлечение внутренних ссылок из HTML-страницы.
 */
function extractInternalLinks(html: string, currentUrl: URL): string[] {
  const links: string[] = [];
  const hrefMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"'#\s]+)["'][^>]*>/gi);

  for (const match of hrefMatches) {
    const href = match[1]?.trim();
    if (!href) continue;

    // Игнорируем псевдо-протоколы
    if (
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("tg:") ||
      href.startsWith("whatsapp:")
    ) {
      continue;
    }

    try {
      const resolved = new URL(href, currentUrl);
      resolved.hash = "";
      // Удаляем трекинговые метки utm, yclid, fbclid
      resolved.searchParams.delete("utm_source");
      resolved.searchParams.delete("utm_medium");
      resolved.searchParams.delete("utm_campaign");
      resolved.searchParams.delete("utm_content");
      resolved.searchParams.delete("utm_term");
      resolved.searchParams.delete("yclid");
      resolved.searchParams.delete("gclid");
      resolved.searchParams.delete("fbclid");

      if (isAllowedUrl(resolved, currentUrl.hostname)) {
        links.push(resolved.href);
      }
    } catch {
      // Игнорируем нераспознанный URL
    }
  }

  return links;
}

/**
 * Сканирование всех страниц сайта (Краулер/Паук).
 */
export async function crawlWebsite(
  rawUrl: string,
  options: CrawlWebsiteOptions = {},
): Promise<CrawledPage[]> {
  const startUrl = validateUrl(rawUrl);
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const queue: string[] = [];
  const visited = new Set<string>();
  const results: CrawledPage[] = [];

  // 1. Пытаемся найти ссылки через sitemap.xml
  const sitemapLinks = await fetchSitemapUrls(startUrl, timeoutMs);
  if (sitemapLinks.length > 0) {
    for (const link of sitemapLinks) {
      if (queue.length < maxPages * 2) {
        queue.push(link);
      }
    }
  }

  // Стартовую страницу всегда ставим первой
  startUrl.hash = "";
  if (!queue.includes(startUrl.href)) {
    queue.unshift(startUrl.href);
  }

  // 2. Обход страниц в ширину (BFS)
  while (queue.length > 0 && results.length < maxPages) {
    const currentHref = queue.shift();
    if (!currentHref) break;

    // Нормализация ключа посещений (без концевого слеша)
    const normKey = currentHref.replace(/\/+$/, "");
    if (visited.has(normKey)) continue;
    visited.add(normKey);

    let currentUrl: URL;
    try {
      currentUrl = new URL(currentHref);
    } catch {
      continue;
    }

    try {
      const response = await fetch(currentHref, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) continue;

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("html") && !contentType.includes("text")) {
        continue;
      }

      const html = await response.text();
      const { title, text } = htmlToText(html);

      // Если страница содержит достаточный полезный текст
      if (text.length >= 60) {
        const displayTitle =
          title ||
          `${currentUrl.hostname}${currentUrl.pathname !== "/" ? currentUrl.pathname : ""}`;

        results.push({
          url: currentHref,
          path: currentUrl.pathname,
          title: displayTitle,
          text: text.slice(0, 60_000), // разумный максимум на одну страницу
        });
      }

      // 3. Извлекаем внутренние ссылки из страницы для расширения очереди
      if (results.length < maxPages) {
        const pageLinks = extractInternalLinks(html, currentUrl);
        for (const link of pageLinks) {
          const lKey = link.replace(/\/+$/, "");
          if (!visited.has(lKey) && !queue.includes(link) && queue.length < maxPages * 3) {
            queue.push(link);
          }
        }
      }
    } catch {
      // Игнорируем сбой отдельной страницы, продолжаем обход остальных
      continue;
    }
  }

  return results;
}
