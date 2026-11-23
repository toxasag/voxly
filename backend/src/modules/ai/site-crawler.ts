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

import { cleanHtmlToMarkdown } from "./html-cleaner.js";

/**
 * Очистка HTML-разметки до чистого текста/markdown.
 */
export function htmlToText(html: string): { title: string; text: string } {
  return cleanHtmlToMarkdown(html, {
    stripLayoutChrome: true,
    stripCookieBanners: true,
  });
}

/**
 * Проверка допустимости URL для сканирования.
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

  // Исключаем служебные пути, мусорные страницы и юридические согласия, тратящие квоту
  if (
    pathname.includes("/logout") ||
    pathname.includes("/cart") ||
    pathname.includes("/checkout") ||
    pathname.includes("/wishlist") ||
    pathname.includes("/my-account") ||
    pathname.includes("/admin") ||
    pathname.includes("/wp-admin") ||
    pathname.includes("/api/") ||
    pathname.includes("/login") ||
    pathname.includes("/register") ||
    pathname.includes("/user/") ||
    pathname.includes("/feed") ||
    pathname.includes("/comments") ||
    pathname.includes("/xmlrpc") ||
    pathname.includes("/wp-json") ||
    pathname.includes("/tag/") ||
    pathname.includes("/author/") ||
    pathname.includes("/soglasie-na-") ||
    pathname.includes("/politika-obrabotki") ||
    pathname.includes("/publichnaya-oferta") ||
    url.searchParams.has("add-to-cart") ||
    url.searchParams.has("removed_item") ||
    url.searchParams.has("orderby") ||
    url.searchParams.has("product_tag")
  ) {
    return false;
  }

  return true;
}

/**
 * Определение приоритета полезности страницы для базы знаний AI-консультанта.
 * Первыми обходятся услуги, прайсы, аренда, контакты и гарантии.
 */
function getUrlPriority(href: string): number {
  try {
    const u = new URL(href);
    const path = u.pathname.toLowerCase();
    if (path === "/" || path === "") return 0;
    if (
      path.includes("arenda") ||
      path.includes("remont") ||
      path.includes("uslug") ||
      path.includes("price") ||
      path.includes("prajs") ||
      path.includes("cena") ||
      path.includes("ceny") ||
      path.includes("contact") ||
      path.includes("kontakty") ||
      path.includes("garanti") ||
      path.includes("servis")
    ) {
      return 1;
    }
    if (path.includes("chastye-bolyachki") || path.includes("category") || path.includes("polomk")) {
      return 2;
    }
    if (path.includes("obzor") || path.includes("filtr") || path.includes("blog")) {
      return 3;
    }
    if (path.includes("shop") || path.includes("product")) {
      return 4;
    }
    return 5;
  } catch {
    return 10;
  }
}

/**
 * Поиск ссылок в карте sitemap.xml сайта (с рекурсивной поддержкой sitemapindex).
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
    const isSitemapIndex = /<sitemapindex\b/i.test(xml);

    if (isSitemapIndex) {
      // Это индексная карта (sitemapindex) — извлекаем дочерние карты
      const sitemapMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
      const childSitemaps: string[] = [];
      for (const m of sitemapMatches) {
        const rawLoc = m[1]?.trim();
        if (!rawLoc) continue;
        if (!rawLoc.includes("author") && !rawLoc.includes("tag-sitemap")) {
          childSitemaps.push(rawLoc);
        }
      }

      // Приоритезируем страницы услуг, категорий и статей
      childSitemaps.sort((a, b) => {
        const score = (s: string) => {
          if (s.includes("page")) return 1;
          if (s.includes("category")) return 2;
          if (s.includes("service")) return 3;
          if (s.includes("post")) return 4;
          if (s.includes("product")) return 5;
          return 10;
        };
        return score(a) - score(b);
      });

      for (const childUrl of childSitemaps.slice(0, 6)) {
        try {
          const childRes = await fetch(childUrl, {
            headers: { "User-Agent": USER_AGENT, Accept: "application/xml,text/xml,*/*" },
            signal: AbortSignal.timeout(timeoutMs),
          });
          if (!childRes.ok) continue;
          const childXml = await childRes.text();
          const pageMatches = childXml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
          for (const pm of pageMatches) {
            const loc = pm[1]?.trim();
            if (!loc) continue;
            try {
              const u = new URL(loc);
              if (isAllowedUrl(u, baseUrl.hostname)) {
                u.hash = "";
                urls.push(u.href);
              }
            } catch {}
          }
        } catch {}
      }
    } else {
      const locMatches = xml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi);
      for (const match of locMatches) {
        const rawLoc = match[1]?.trim();
        if (!rawLoc) continue;
        try {
          const u = new URL(rawLoc);
          if (isAllowedUrl(u, baseUrl.hostname)) {
            u.hash = "";
            urls.push(u.href);
          }
        } catch {}
      }
    }
  } catch {
    // Если sitemap недоступен — пойдем по ссылкам в HTML
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
      // Удаляем трекинговые и корзинные метки
      resolved.searchParams.delete("utm_source");
      resolved.searchParams.delete("utm_medium");
      resolved.searchParams.delete("utm_campaign");
      resolved.searchParams.delete("utm_content");
      resolved.searchParams.delete("utm_term");
      resolved.searchParams.delete("yclid");
      resolved.searchParams.delete("gclid");
      resolved.searchParams.delete("fbclid");
      resolved.searchParams.delete("add-to-cart");
      resolved.searchParams.delete("removed_item");
      resolved.searchParams.delete("orderby");

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
      if (queue.length < maxPages * 3) {
        queue.push(link);
      }
    }
  }

  // Стартовую страницу всегда ставим первой
  startUrl.hash = "";
  if (!queue.includes(startUrl.href)) {
    queue.unshift(startUrl.href);
  }

  // Приоритезируем ключевые страницы (главная, услуги, аренда, прайсы, контакты)
  queue.sort((a, b) => getUrlPriority(a) - getUrlPriority(b));

  // 2. Обход страниц в ширину (BFS)
  while (queue.length > 0 && results.length < maxPages) {
    const currentHref = queue.shift();
    if (!currentHref) break;

    let currentUrl: URL;
    try {
      currentUrl = new URL(currentHref);
    } catch {
      continue;
    }

    // Нормализация ключа посещений по пути (без концевого слеша и query-параметров)
    const normPath = currentUrl.pathname.replace(/\/+$/, "") || "/";
    const normKey = `${currentUrl.origin}${normPath}`;
    if (visited.has(normKey)) continue;
    visited.add(normKey);

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
          try {
            const u = new URL(link);
            const lKey = `${u.origin}${u.pathname.replace(/\/+$/, "") || "/"}`;
            const alreadyInQueue = queue.some((q) => {
              try {
                const qu = new URL(q);
                return `${qu.origin}${qu.pathname.replace(/\/+$/, "") || "/"}` === lKey;
              } catch {
                return false;
              }
            });
            if (!visited.has(lKey) && !alreadyInQueue && queue.length < maxPages * 4) {
              queue.push(link);
            }
          } catch {}
        }
        queue.sort((a, b) => getUrlPriority(a) - getUrlPriority(b));
      }
    } catch {
      // Игнорируем сбой отдельной страницы, продолжаем обход остальных
      continue;
    }
  }

  return results;
}
