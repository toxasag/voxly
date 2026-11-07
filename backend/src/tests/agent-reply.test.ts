import { describe, expect, it } from "vitest";
import {
  SAFE_DEFAULTS,
  buildSystemPrompt,
  interpolatePromptVariables,
  parseAgentReply,
} from "../modules/ai/agent-reply.js";

describe("agent-reply - parseAgentReply", () => {
  it("разбирает стандартный валидный JSON с несколькими сообщениями и флагами", () => {
    const raw = JSON.stringify({
      message1: "Добрый день! Базовое ТО выходит от 12 500 руб.",
      message2: "Подскажите, какой у вас пробег на автомобиле?",
      message3: "",
      handoff_required: false,
      session_pause: false,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.messages[0]).toBe("Добрый день! Базовое ТО выходит от 12 500 руб.");
    expect(parsed?.messages[1]).toBe("Подскажите, какой у вас пробег на автомобиле?");
    expect(parsed?.handoff_required).toBe(false);
    expect(parsed?.session_pause).toBe(false);
  });

  it("разбирает до 4 коротких сообщений (message1..message4)", () => {
    const raw = JSON.stringify({
      message1: "Здравствуйте, Наталья!",
      message2: "По аппаратам Шарм базовая модель для лица стоит от 275 000 руб.",
      message3: "Комбинированная версия для лица и тела — от 450 000 руб.",
      message4: "Давайте созвонимся на 5 минут для точного расчета комплектации? На какой номер удобно набрать?",
      handoff_required: false,
      session_pause: false,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toHaveLength(4);
    expect(parsed?.messages[0]).toBe("Здравствуйте, Наталья!");
    expect(parsed?.messages[3]).toContain("Давайте созвонимся");
  });

  it("извлекает JSON из markdown-блока ```json ... ``` с текстом вокруг", () => {
    const raw = `
Вот мой ответ клиенту:
\`\`\`json
{
  "message1": "Да, эта позиция есть в наличии на центральном складе.",
  "message2": "Оформить резерв на сегодня?",
  "handoff_required": false,
  "session_pause": false
}
\`\`\`
Надеюсь, ответ подходит.
    `;

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toEqual([
      "Да, эта позиция есть в наличии на центральном складе.",
      "Оформить резерв на сегодня?",
    ]);
    expect(parsed?.handoff_required).toBe(false);
  });

  it("корректно считывает handoff_required: true при эскалации на человека", () => {
    const raw = JSON.stringify({
      message1: "По нестандартным договорам и отсрочке платежа на 60 дней условия согласовываются индивидуально.",
      message2: "Давайте подключу к диалогу нашего руководителя отдела опта. На какой номер коллеге набрать?",
      handoff_required: true,
      session_pause: false,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.handoff_required).toBe(true);
    expect(parsed?.session_pause).toBe(false);
  });

  it("корректно считывает session_pause: true при троллинге и спаме", () => {
    const raw = JSON.stringify({
      message1: "Видимо, сейчас вопросов по нашему профилю нет. Всего доброго!",
      message2: "",
      handoff_required: false,
      session_pause: true,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.session_pause).toBe(true);
    expect(parsed?.handoff_required).toBe(false);
  });

  it("поддерживает graceful fallback на обычный текст, если модель не вернула JSON", () => {
    const raw = "Здравствуйте! Мы работаем ежедневно с 9:00 до 21:00. Чем могу помочь?";
    const parsed = parseAgentReply(raw);

    expect(parsed).not.toBeNull();
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.messages[0]).toBe(
      "Здравствуйте! Мы работаем ежедневно с 9:00 до 21:00. Чем могу помочь?",
    );
    expect(parsed?.handoff_required).toBe(false);
    expect(parsed?.session_pause).toBe(false);
  });

  it("обрезает сообщения длиннее 280 символов по границе слова", () => {
    const longText = "Слово ".repeat(60); // 360 символов > 280
    const raw = JSON.stringify({
      message1: longText,
      message2: "",
    });

    const parsed = parseAgentReply(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.messages[0]?.length).toBeLessThanOrEqual(281);
    expect(parsed?.messages[0]?.endsWith("…")).toBe(true);
  });
});

describe("agent-reply - interpolatePromptVariables", () => {
  it("подставляет переданные переменные и безопасные дефолты при их отсутствии", () => {
    const template = "Ты — {{consultant.name}}, {{consultant.role}} компании {{tenant.name}}. Профиль: {{business.niche}}.";
    const result = interpolatePromptVariables(template, {
      "tenant.name": "АвтоТехСервис",
      "consultant.name": "Дмитрий",
      // consultant.role и business.niche не переданы — должны взяться SAFE_DEFAULTS
    });

    expect(result).toBe("Ты — Дмитрий, ведущий специалист компании АвтоТехСервис. Профиль: оказание профильных услуг и консультация клиентов.");
  });

  it("содержит правильный текст для website_context и reviews_and_reputation в SAFE_DEFAULTS", () => {
    expect(SAFE_DEFAULTS["website_context"]).toBe(
      "Ориентируйся на факты и отзывы, приведённые в блоке актуальной базы знаний выше.",
    );
    expect(SAFE_DEFAULTS["reviews_and_reputation"]).toBe(
      "Ориентируйся на факты и отзывы, приведённые в блоке актуальной базы знаний выше.",
    );
  });
});

describe("agent-reply - buildSystemPrompt", () => {
  it("интерполирует переменные и контекст базы знаний прямо в плейсхолдеры промпта v2.0", () => {
    const agentPrompt = `
<director_system_prompt>
Ты — {{consultant.name}}, {{consultant.role}} компании {{tenant.name}}.
База знаний:
{{knowledge_base_context}}
Успешный опыт:
{{successful_crm_patterns}}
Формат ответа:
message1: ответ
message2: вопрос
</director_system_prompt>
    `.trim();

    const prompt = buildSystemPrompt({
      agentPrompt,
      contextChunks: [{ filename: "price.md", content: "Замена масла: 2000 руб." }],
      variables: {
        "tenant.name": "АвтоЛидер",
        "consultant.name": "Михаил",
        "consultant.role": "мастер-приёмщик",
      },
      crmPatterns: [{ customerQuery: "Есть запись на пятницу?", agentReply: "Да, свободно на 14:00 и 16:30." }],
    });

    expect(prompt).toContain("Ты — Михаил, мастер-приёмщик компании АвтоЛидер.");
    expect(prompt).toContain("[1] Из «price.md»:\nЗамена масла: 2000 руб.");
    expect(prompt).toContain("Клиент: «Есть запись на пятницу?»");
    expect(prompt).toContain("Успешный ответ: «Да, свободно на 14:00 и 16:30.»");
  });

  it("добавляет контекст документов в конец, если плейсхолдера {{knowledge_base_context}} нет", () => {
    const legacyPrompt = "Ты менеджер отдела продаж. Отвечай вежливо.";
    const prompt = buildSystemPrompt({
      agentPrompt: legacyPrompt,
      contextChunks: [{ filename: "faq.txt", content: "Доставка 3 дня." }],
    });

    expect(prompt).toContain("Ты менеджер отдела продаж. Отвечай вежливо.");
    expect(prompt).toContain("ВЫДЕРЖКИ ИЗ ДОКУМЕНТОВ КОМПАНИИ");
    expect(prompt).toContain("[1] Из «faq.txt»:\nДоставка 3 дня.");
    expect(prompt).toContain("ФОРМАТ ОТВЕТА — СТРОГО JSON");
  });
});

describe("agent-reply - 6 Crash-Test Scenarios Simulation", () => {
  it("Сценарий 1 (Автосервис): прозрачность цен + 2 баббла без эскалации", () => {
    const raw = JSON.stringify({
      message1: "Добрый день! По замене масла в АКПП на Камри под ключ с работой выходит от 12 500 до 16 000 руб.",
      message2: "Подскажите, мотор 2.5 или 3.5 стоит, и замечали уже пинки при переключении?",
      handoff_required: false,
      session_pause: false,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.messages[0]).toContain("12 500");
    expect(parsed?.handoff_required).toBe(false);
    expect(parsed?.session_pause).toBe(false);
  });

  it("Сценарий 2 (B2B Опт): передача коллеге вне базы с handoff_required: true", () => {
    const raw = JSON.stringify({
      message1: "По объёму в 400 рулонов с НДС соберём без проблем, а вот отсрочку на 60 дней согласует руководство.",
      message2: "Давайте подключу к диалогу нашего руководителя отдела логистики и опта. На какой номер коллеге набрать?",
      handoff_required: true,
      session_pause: false,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed?.messages).toHaveLength(2);
    expect(parsed?.handoff_required).toBe(true);
    expect(parsed?.session_pause).toBe(false);
  });

  it("Сценарий 3 (Юристы): защита от ловушки Тьюринга в именительном падеже", () => {
    const prompt = buildSystemPrompt({
      agentPrompt: "Наш профиль — {{business.niche}}. Живой я человек, {{consultant.name}} зовут.",
      contextChunks: [],
      variables: {
        "consultant.name": "Екатерина",
        "business.niche": "юридическое сопровождение бизнеса и защита в арбитражных спорах",
      },
    });

    expect(prompt).toContain("Наш профиль — юридическое сопровождение бизнеса и защита в арбитражных спорах.");
    expect(prompt).toContain("Живой я человек, Екатерина зовут.");
  });

  it("Сценарий 4 (Инъекции и троллинг): повторный страйк замораживает сессию (session_pause: true)", () => {
    const raw = JSON.stringify({
      message1: "Понял вас, видимо, сейчас вопросов по нашему профилю нет. Хорошего дня!",
      message2: "",
      handoff_required: false,
      session_pause: true,
    });

    const parsed = parseAgentReply(raw);
    expect(parsed?.messages).toHaveLength(1);
    expect(parsed?.session_pause).toBe(true);
    expect(parsed?.handoff_required).toBe(false);
  });

  it("Сценарий 5: гарантирует отсутствие незаполненных усов {{...}} при пустых переменных", () => {
    const promptWithVariables = "Компания: {{tenant.name}}, Роль: {{consultant.role}}, Сайт: {{website_context}}";
    const built = buildSystemPrompt({
      agentPrompt: promptWithVariables,
      contextChunks: [],
      variables: {}, // Пустые переменные
    });

    // Ни один шаблонный ус не должен остаться
    expect(built).not.toMatch(/\{\{[a-z_.]+\}\}/);
    expect(built).toContain("ведущий специалист");
    expect(built).toContain("Ориентируйся на факты и отзывы, приведённые в блоке актуальной базы знаний выше.");
  });
});
