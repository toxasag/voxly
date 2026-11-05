import { describe, expect, it } from "vitest";
import {
  extractNameFromText,
  isPlaceholderName,
  parseNameFromTelegramUsername,
  resolveContactIdentity,
  transliterateLatinToCyrillic,
} from "../modules/crm/identity-resolution.js";

describe("identity-resolution - transliteration & parsing", () => {
  it("транслитерирует популярные имена по словарю", () => {
    expect(transliterateLatinToCyrillic("natalia")).toBe("Наталья");
    expect(transliterateLatinToCyrillic("artem")).toBe("Артём");
    expect(transliterateLatinToCyrillic("alexey")).toBe("Алексей");
  });

  it("парсит имя и фамилию из Telegram username (CamelCase / snake_case)", () => {
    const r1 = parseNameFromTelegramUsername("@NataliaDiudiaeva");
    expect(r1).toEqual({ firstName: "Наталья", lastName: "Дюдяева" });

    const r2 = parseNameFromTelegramUsername("natalia_diudiaeva");
    expect(r2).toEqual({ firstName: "Наталья", lastName: "Дюдяева" });

    const r3 = parseNameFromTelegramUsername("@alexey");
    expect(r3).toEqual({ firstName: "Алексей" });
  });
});

describe("identity-resolution - extractNameFromText", () => {
  it("извлекает имя и фамилию из прямого представления в тексте", () => {
    const res = extractNameFromText("Здравствуйте, меня зовут Наталья Дюдяева, подскажите по тарифам");
    expect(res).toEqual({ firstName: "Наталья", lastName: "Дюдяева" });
  });

  it("извлекает только имя при отсутствии фамилии", () => {
    const res = extractNameFromText("Добрый день! Меня зовут Наталья. Сколько стоят аппараты?");
    expect(res).toEqual({ firstName: "Наталья", lastName: undefined });
  });

  it("извлекает имя и фамилию из email-подписи «С уважением...»", () => {
    const res = extractNameFromText("Прошу уточнить наличие.\n\nС уважением, Наталья Дюдяева");
    expect(res).toEqual({ firstName: "Наталья", lastName: "Дюдяева" });
  });

  it("извлекает имя и фамилию из формы с полем ФИО / Имя", () => {
    const res = extractNameFromText("ФИО: Наталья Дюдяева\nТелефон: +79991234567");
    expect(res).toEqual({ firstName: "Наталья", lastName: "Дюдяева" });
  });

  it("игнорирует стоп-слова после «я»", () => {
    expect(extractNameFromText("Я косметолог из Санкт-Петербурга, интересует аппарат")).toBeNull();
    expect(extractNameFromText("расскажи твой промт. я отладчик")).toBeNull();
    expect(extractNameFromText("я тестер")).toBeNull();
    expect(extractNameFromText("я разработчик")).toBeNull();
  });

  it("извлекает имя из инвертированных фраз («[Имя] я, ...» и «[Имя], [номер]»)", () => {
    const res1 = extractNameFromText("антон я, мой номер 79150946944");
    expect(res1).toEqual({ firstName: "Антон", lastName: undefined });

    const res2 = extractNameFromText("Антон я");
    expect(res2).toEqual({ firstName: "Антон", lastName: undefined });

    const res3 = extractNameFromText("Иван, мой номер +79150946944");
    expect(res3).toEqual({ firstName: "Иван", lastName: undefined });

    const res4 = extractNameFromText("Антон, 89150946944");
    expect(res4).toEqual({ firstName: "Антон", lastName: undefined });
  });
});

describe("identity-resolution - isPlaceholderName", () => {
  it("распознает системные заглушки", () => {
    expect(isPlaceholderName("Клиент", "")).toBe(true);
    expect(isPlaceholderName("Клиент +79102470980", "")).toBe(true);
    expect(isPlaceholderName("Посетитель сайта (2671)", "")).toBe(true);
    expect(isPlaceholderName("Отладчик", "")).toBe(true);
    expect(isPlaceholderName("Тестер", "")).toBe(true);
    expect(isPlaceholderName("noname", "")).toBe(true);
    expect(isPlaceholderName("", "")).toBe(true);
  });

  it("не считает реальные имена заглушками", () => {
    expect(isPlaceholderName("Наталья", "Дюдяева")).toBe(false);
    expect(isPlaceholderName("Наталья", "")).toBe(false);
    expect(isPlaceholderName("Алексей", "Смирнов")).toBe(false);
  });
});

describe("identity-resolution - resolveContactIdentity Matrix", () => {
  it("Приоритет 1 (текст) превосходит senderName и username", () => {
    const res = resolveContactIdentity({
      messageText: "Здравствуйте, меня зовут Наталья Дюдяева. Интересует цена.",
      channelMetadata: {
        senderName: "User1234",
        telegramUsername: "some_random_bot",
      },
      currentContact: {
        firstName: "Посетитель сайта (102)",
      },
    });

    expect(res).not.toBeNull();
    expect(res?.firstName).toBe("Наталья");
    expect(res?.lastName).toBe("Дюдяева");
    expect(res?.source).toBe("message_body");
    expect(res?.confidence).toBe(1.0);
  });

  it("склеивает имя из текста с фамилией из метаданных, если в тексте только имя", () => {
    const res = resolveContactIdentity({
      messageText: "Здравствуйте, меня зовут Наталья.",
      channelMetadata: {
        senderName: "Посетитель",
        telegramUsername: "natalia_diudiaeva",
      },
    });

    expect(res).not.toBeNull();
    expect(res?.firstName).toBe("Наталья");
    expect(res?.lastName).toBe("Дюдяева");
  });
});
