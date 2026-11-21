import { describe, it, expect } from "vitest";
import { hashToken } from "../lib/crypto.utils.js";
import { escapeHtml, escapeTelegramHtml, escapeXml } from "../lib/html.utils.js";
import { nullIfBlank } from "../lib/string.utils.js";
import { extensionToMime, guessMimeType } from "../lib/mime.utils.js";
import { toDate, toIso, toIsoOrNull } from "../lib/date.utils.js";
import { cleanHtmlToMarkdown } from "../modules/ai/html-cleaner.js";
import { htmlToText } from "../modules/ai/site-crawler.js";
import { cleanHtmlForKnowledge } from "../modules/ai/web-extractor.service.js";

describe("Shared backend/src/lib utilities", () => {
  it("hashToken computes deterministic SHA-256 hex digest", () => {
    const digest = hashToken("secret-token");
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).toBe("930bbdc51b6aed5c2a5678fd6e28dee7a05e8a4b643cfc0b4427c3efb86c0d94");
    expect(hashToken("secret-token")).toBe(digest);
    expect(hashToken("a")).not.toBe(hashToken("b"));
  });

  it("escapeHtml, escapeTelegramHtml, escapeXml preserve distinct semantics", () => {
    const raw = `<a href="x">O'Brien & Co</a>`;
    expect(escapeHtml(raw)).toBe("&lt;a href=&quot;x&quot;&gt;O&#39;Brien &amp; Co&lt;/a&gt;");
    expect(escapeTelegramHtml(raw)).toBe(`&lt;a href="x"&gt;O'Brien &amp; Co&lt;/a&gt;`);
    expect(escapeXml(raw)).toBe("&lt;a href=&quot;x&quot;&gt;O&apos;Brien &amp; Co&lt;/a&gt;");
    expect(escapeXml(null)).toBe("");
    expect(escapeXml(undefined)).toBe("");
    expect(escapeXml(42)).toBe("42");
  });

  it("nullIfBlank converts empty/nullish values to null and preserves non-empty strings", () => {
    expect(nullIfBlank("")).toBeNull();
    expect(nullIfBlank(null)).toBeNull();
    expect(nullIfBlank(undefined)).toBeNull();
    expect(nullIfBlank("hello")).toBe("hello");
  });

  it("extensionToMime and guessMimeType normalize extensions and honor explicit non-octet MIME", () => {
    expect(extensionToMime(".JPG")).toBe("image/jpeg");
    expect(extensionToMime("photo.webp")).toBe("image/webp");
    expect(extensionToMime("doc.pdf")).toBe("application/pdf");
    expect(extensionToMime("unknown.xyz")).toBe("application/octet-stream");
    expect(guessMimeType("invoice.pdf", "application/octet-stream")).toBe("application/pdf");
    expect(guessMimeType("invoice.bin", "image/png")).toBe("image/png");
  });

  it("date helpers convert pg Date/string values cleanly", () => {
    const d = new Date("2026-11-21T10:00:00.000Z");
    expect(toDate(d)).toBe(d);
    expect(toDate("2026-11-21T10:00:00.000Z").toISOString()).toBe("2026-11-21T10:00:00.000Z");
    expect(toIso(d)).toBe("2026-11-21T10:00:00.000Z");
    expect(toIso("2026-11-21T10:00:00.000Z")).toBe("2026-11-21T10:00:00.000Z");
    expect(toIsoOrNull(null)).toBeNull();
    expect(toIsoOrNull(undefined)).toBeNull();
    expect(toIsoOrNull(d)).toBe("2026-11-21T10:00:00.000Z");
  });

  it("cleanHtmlToMarkdown unifies site-crawler htmlToText and web-extractor cleanHtmlForKnowledge", () => {
    const html = `
      <html>
        <head><title>Ремонт iPhone</title><style>body{}</style></head>
        <body>
          <header>Меню навигации</header>
          <main>
            <h1>Прайс-лист</h1>
            <table><tr><th>Услуга</th><th>Цена</th></tr><tr><td>Замена экрана</td><td>5000</td></tr></table>
            <p>Мы используем файлы cookie для улучшения работы сайта.</p>
          </main>
          <script>alert(1)</script>
        </body>
      </html>
    `;

    const crawled = htmlToText(html);
    expect(crawled.title).toBe("Ремонт iPhone");
    expect(crawled.text).toContain("| Замена экрана | 5000 |");
    expect(crawled.text).not.toContain("alert(1)");

    const extracted = cleanHtmlForKnowledge(html);
    expect(extracted.title).toBe("Ремонт iPhone");
    expect(extracted.cleanText).toContain("| Замена экрана | 5000 |");
    expect(extracted.cleanText).not.toContain("Меню навигации");
    expect(extracted.cleanText).not.toContain("файлы cookie");

    const fallbackTitle = cleanHtmlForKnowledge("<body><p>Текст без заголовка</p></body>");
    expect(fallbackTitle.title).toBe("Материалы сайта");
    expect(cleanHtmlToMarkdown("<body><h1>Заголовок H1</h1></body>").title).toBe("Заголовок H1");
  });
});
