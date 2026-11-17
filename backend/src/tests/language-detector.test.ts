import { describe, expect, it } from "vitest";
import { detectMessageLanguage } from "../modules/ai/language-detector.js";
import { buildSystemPrompt, LANGUAGE_MIRRORING_DIRECTIVE } from "../modules/ai/agent-reply.js";

describe("Language Detector & Mirroring", () => {
  it("точно определяет английский язык в вопросах о ремонте и виллах", () => {
    const result1 = detectMessageLanguage("Hello! Do you repair swimming pools?");
    expect(result1.lang).toBe("en");
    expect(result1.isLatin).toBe(true);
    expect(result1.isCyrillic).toBe(false);
    expect(result1.directive).toContain("MUST BE WRITTEN STRICTLY IN ENGLISH");

    const result2 = detectMessageLanguage("Hi, I need a quote for full villa renovation on Phuket.");
    expect(result2.lang).toBe("en");
    expect(result2.directive).toContain("ENGLISH");
  });

  it("точно определяет русский язык для кириллических сообщений", () => {
    const result1 = detectMessageLanguage("Здравствуйте! Сколько стоит чистка бассейна?");
    expect(result1.lang).toBe("ru");
    expect(result1.isCyrillic).toBe(true);
    expect(result1.isLatin).toBe(false);
    expect(result1.directive).toContain("РУССКОМ");

    const result2 = detectMessageLanguage("алло, крышу чините?");
    expect(result2.lang).toBe("ru");
    expect(result2.isCyrillic).toBe(true);
  });

  it("распознает испанский, немецкий и французский языки", () => {
    const es = detectMessageLanguage("Hola, ¿cuánto cuesta el mantenimiento de la piscina?");
    expect(es.lang).toBe("es");
    expect(es.directive).toContain("ESPAÑOL");

    const de = detectMessageLanguage("Guten Tag, reparieren Sie Schwimmbäder und Villen?");
    expect(de.lang).toBe("de");
    expect(de.directive).toContain("DEUTSCH");

    const fr = detectMessageLanguage("Bonjour, faites-vous la rénovation de villa?");
    expect(fr.lang).toBe("fr");
    expect(fr.directive).toContain("FRANÇAIS");
  });

  it("распознает казахский язык со специфическими буквами", () => {
    const kk = detectMessageLanguage("Сәлеметсіз бе! Бассейн жөндеу бағасы қанша?");
    expect(kk.lang).toBe("kk");
    expect(kk.directive).toContain("ҚАЗАҚ ТІЛІНДЕ");
  });

  it("распознает тайский язык", () => {
    const th = detectMessageLanguage("สวัสดีครับ ซ่อมสระว่ายน้ำราคาเท่าไหร่");
    expect(th.lang).toBe("th");
    expect(th.directive).toContain("THAI");
  });

  it("учитывает контекст страницы сайта (/en) для нейтральных сообщений", () => {
    const neutralEn = detectMessageLanguage("+79150946944", {
      pageUrl: "https://vertexsiam.com/en",
    });
    expect(neutralEn.lang).toBe("en");
    expect(neutralEn.directive).toContain("ENGLISH");

    const neutralRu = detectMessageLanguage("+79150946944", {
      pageUrl: "https://vertexsiam.com/ru",
    });
    expect(neutralRu.lang).toBe("ru");
    expect(neutralRu.directive).toContain("русскоязычной");
  });

  it("гарантирует, что buildSystemPrompt всегда завершается директивой Language Mirroring высшего приоритета", () => {
    const customTenantPrompt = `
      Ты — онлайн-консультант. Продавай наши услуги.
      Формат вывода:
      {"message1": "...", "message2": ""}
    `;

    const built = buildSystemPrompt({
      agentPrompt: customTenantPrompt,
      knowledgeBaseMd: "# Прайс на русском языке\n- Ремонт: 50000 руб.",
      contactProfile: "Клиент пока не назвал имя.",
      currentPageContext: "<current_page_context>URL: https://vertexsiam.com/en</current_page_context>",
    });

    // Директива должна быть в самом конце системного промпта
    expect(built).toContain(LANGUAGE_MIRRORING_DIRECTIVE);
    expect(built).toContain("<critical_language_mirroring_policy>");
    expect(built).toContain("HIGHEST OVERRIDING PRIORITY");
    expect(built).toContain("ABSOLUTE BAN ON RUSSIAN LANGUAGE INERTIA");

    // Индекс директивы должен быть после knowledgeBaseMd и после currentPageContext
    const kbIdx = built.indexOf("Прайс на русском языке");
    const directiveIdx = built.indexOf("<critical_language_mirroring_policy>");
    expect(directiveIdx).toBeGreaterThan(kbIdx);
  });
});
