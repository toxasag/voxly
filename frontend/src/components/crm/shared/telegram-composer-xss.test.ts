import { describe, expect, it } from "vitest";

import { markdownToHtml } from "@/components/crm/shared/TelegramComposer";

describe("markdownToHtml: ссылки и HTML безопасны", () => {
  it("обычная https-ссылка превращается в <a>", () => {
    const html = markdownToHtml("[сайт](https://example.com/a?b=1)");
    expect(html).toContain('<a href="https://example.com/a?b=1"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("javascript: не попадает в href", () => {
    const html = markdownToHtml("[клик](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("<a ");
    expect(html).toContain("клик");
  });

  it("кавычка в адресе не выходит из атрибута href", () => {
    const html = markdownToHtml('[x](https://a.com/"onmouseover="alert(1))');
    expect(html).not.toMatch(/href="[^"]*"[^>]*onmouseover/);
    expect(html).toContain("%22");
  });

  it("HTML-теги в тексте экранируются", () => {
    const html = markdownToHtml("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
