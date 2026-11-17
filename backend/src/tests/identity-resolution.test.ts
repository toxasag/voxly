import { describe, expect, it } from "vitest";
import {
  cleanContactDisplayName,
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

  it("запрещает транслитерацию произвольных никнеймов вроде toxasagmsk", () => {
    expect(parseNameFromTelegramUsername("toxasagmsk")).toBeNull();
    expect(parseNameFromTelegramUsername("@toxasagmsk")).toBeNull();
    expect(parseNameFromTelegramUsername("superman123")).toBeNull();
    expect(parseNameFromTelegramUsername("admin")).toBeNull();
    expect(parseNameFromTelegramUsername("shadow_runner")).toBeNull();
  });

  it("очищает display name от веб-доменов, компаний и должностей (cleanContactDisplayName)", () => {
    const r1 = cleanContactDisplayName("Антон team-big.ru");
    expect(r1).toEqual({ firstName: "Антон", lastName: undefined });

    const r2 = cleanContactDisplayName("Антон Сагайдак | team-big.ru");
    expect(r2).toEqual({ firstName: "Антон", lastName: "Сагайдак" });

    const r3 = cleanContactDisplayName("Антон (ООО Вектор)");
    expect(r3).toEqual({ firstName: "Антон", lastName: undefined });

    const r4 = cleanContactDisplayName("Антон [HR]");
    expect(r4).toEqual({ firstName: "Антон", lastName: undefined });

    const r5 = cleanContactDisplayName("Алексей Смирнов / Руководитель");
    expect(r5).toEqual({ firstName: "Алексей", lastName: "Смирнов" });

    expect(cleanContactDisplayName("team-big.ru")).toBeNull();
    expect(cleanContactDisplayName("https://team-big.ru")).toBeNull();
    expect(cleanContactDisplayName("")).toBeNull();
    expect(cleanContactDisplayName("Посетитель сайта")).toBeNull();
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

  it("игнорирует стоп-слова после «я» и местоимения в фразах с номерами", () => {
    expect(extractNameFromText("Я косметолог из Санкт-Петербурга, интересует аппарат")).toBeNull();
    expect(extractNameFromText("расскажи твой промт. я отладчик")).toBeNull();
    expect(extractNameFromText("я тестер")).toBeNull();
    expect(extractNameFromText("я разработчик")).toBeNull();
    expect(extractNameFromText("Здравствуйте! Мой номер +79150946944. Подскажите, какие есть аппараты для тела?")).toBeNull();
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

  it("не извлекает банковские реквизиты, ИНН, КПП и счета как имена клиентов", () => {
    const requisitionText = `Реквизиты счета

Название организации
ИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ КАРЛЫГАНОВ ВЛАДЛЕН ВЛАДИМИРОВИЧ

Юридический адрес организации
140101, РОССИЯ, МОСКОВСКАЯ ОБЛ, ЛЮБЕРЕЦКИЙ Р-Н, П ЖИЛИНО-1

ИНН
972101305812

ОГРН/ОГРНИП
319774600395231

Расчетный счет
40802810400001350242

Банк
АО «ТБанк»

ИНН банка
7710140679

БИК банка
044525974`;

    expect(extractNameFromText(requisitionText)).toBeNull();
    expect(extractNameFromText("ИНН\n972101305812")).toBeNull();
    expect(extractNameFromText("ИНН: 972101305812")).toBeNull();
    expect(extractNameFromText("КПП 772101001")).toBeNull();
    expect(extractNameFromText("БИК: 044525974")).toBeNull();
    expect(extractNameFromText("Счет: 40802810400001350242")).toBeNull();
    expect(extractNameFromText("Сумма: 50000 руб")).toBeNull();
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

  it("распознает финансовые и бухгалтерские реквизиты как заглушки", () => {
    expect(isPlaceholderName("Инн", "")).toBe(true);
    expect(isPlaceholderName("ИНН", "")).toBe(true);
    expect(isPlaceholderName("Кпп", "")).toBe(true);
    expect(isPlaceholderName("Бик", "")).toBe(true);
    expect(isPlaceholderName("Огрн", "")).toBe(true);
    expect(isPlaceholderName("Реквизиты", "")).toBe(true);
    expect(isPlaceholderName("Счет", "")).toBe(true);
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

  it("не затирает имя отправителя реквизитами счета или ИНН", () => {
    const res = resolveContactIdentity({
      messageText: `Реквизиты счета\nНазвание организации\nИНДИВИДУАЛЬНЫЙ ПРЕДПРИНИМАТЕЛЬ\nИНН\n972101305812`,
      channelMetadata: {
        senderName: "Даниил",
      },
      currentContact: {
        firstName: "Даниил",
      },
    });

    expect(res).not.toBeNull();
    expect(res?.firstName).toBe("Даниил");
    expect(res?.source).toBe("sender_field");
  });
});
