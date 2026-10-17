import { describe, expect, it } from "vitest";
import { extractOperatorPairs } from "../modules/ai/sales-learn.service.js";

describe("SalesLearnService - extractOperatorPairs", () => {
  it("извлекает пары вопрос клиента -> ответ оператора из хронологии сообщений", () => {
    const messages = [
      { id: "1", source: "customer", content: "Здравствуйте, сколько стоит замена экрана на iPhone 13?", created_at: new Date() },
      { id: "2", source: "manager", content: "Добрый день! Оригинальный дисплей с установкой — 14 500 руб. Гарантия 6 месяцев.", created_at: new Date() },
      { id: "3", source: "customer", content: "А сколько по времени займет работа?", created_at: new Date() },
      { id: "4", source: "manager", content: "Обычно за 40-50 минут мастер при вас все сделает в сервисном центре.", created_at: new Date() },
    ];

    const pairs = extractOperatorPairs(messages);
    expect(pairs).toHaveLength(2);

    expect(pairs[0]?.userText).toBe("Здравствуйте, сколько стоит замена экрана на iPhone 13?");
    expect(pairs[0]?.operatorText).toBe("Добрый день! Оригинальный дисплей с установкой — 14 500 руб. Гарантия 6 месяцев.");
    expect(pairs[0]?.sourceMessageId).toBe("2");

    expect(pairs[1]?.userText).toBe("А сколько по времени займет работа?");
    expect(pairs[1]?.operatorText).toBe("Обычно за 40-50 минут мастер при вас все сделает в сервисном центре.");
  });

  it("игнорирует пустые сообщения и последовательные реплики без ответа оператора", () => {
    const messages = [
      { id: "1", source: "customer", content: "   ", created_at: new Date() },
      { id: "2", source: "customer", content: "Куда подъехать?", created_at: new Date() },
      { id: "3", source: "customer", content: "Какой у вас адрес?", created_at: new Date() },
      { id: "4", source: "manager", content: "Мы находимся по адресу: ул. Ленина, д. 15, офис 204.", created_at: new Date() },
    ];

    const pairs = extractOperatorPairs(messages);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.userText).toBe("Какой у вас адрес?");
    expect(pairs[0]?.operatorText).toBe("Мы находимся по адресу: ул. Ленина, д. 15, офис 204.");
  });

  it("не создает пару, если клиент написал, но оператор еще не ответил", () => {
    const messages = [
      { id: "1", source: "customer", content: "Привет!", created_at: new Date() },
    ];

    const pairs = extractOperatorPairs(messages);
    expect(pairs).toHaveLength(0);
  });
});
