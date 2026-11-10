import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BUFFER_MAX_MESSAGES,
  DEBOUNCE_MAX_MS,
  DEBOUNCE_MAX_TOTAL_MS,
  DEBOUNCE_MIN_MS,
  IncomingMessageBuffer,
  bufferKey,
  type BufferedIncoming,
} from "../modules/channels/incoming-buffer.js";
import {
  TYPING_PAUSE_MAX_MS,
  TYPING_PAUSE_MIN_MS,
  buildSystemPrompt,
  nextTypingPauseMs,
  parseAgentReply,
} from "../modules/ai/agent-reply.js";

// ---------------------------------------------------------------------------
// Юнит-тесты дебаунса и формата ответа агента.
//
// Без БД и сети: время подменяется фиктивными таймерами, поэтому окно в 15–20
// секунд проверяется мгновенно и детерминированно. Ждать реальные 20 секунд в
// тесте означало бы минуты на прогон и флаки на медленной машине.
// ---------------------------------------------------------------------------

const silentLog = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe("IncomingMessageBuffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function make(): {
    buffer: IncomingMessageBuffer;
    batches: BufferedIncoming[];
  } {
    const batches: BufferedIncoming[] = [];
    const buffer = new IncomingMessageBuffer(async (batch) => {
      batches.push(batch);
    }, silentLog);

    return { buffer, batches };
  }

  const base = {
    tenantId: "11111111-1111-1111-1111-111111111111",
    channelAccountId: "22222222-2222-2222-2222-222222222222",
    chatId: "555000",
    peerId: "555000",
  };

  it("не отдаёт пачку до истечения окна", async () => {
    const { buffer, batches } = make();

    buffer.add({ ...base, text: "привет" });

    // На секунду раньше минимального окна ответа быть не должно: иначе агент
    // отвечал бы на первую реплику, не дождавшись остальных.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MIN_MS - 1000);
    expect(batches).toHaveLength(0);
    expect(buffer.pendingCount).toBe(1);
  });

  it("отдаёт пачку после окна и склеивает сообщения через перевод строки", async () => {
    const { buffer, batches } = make();

    buffer.add({ ...base, text: "привет" });
    buffer.add({ ...base, text: "не работает телефон" });
    buffer.add({ ...base, text: "после падения" });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    expect(batches).toHaveLength(1);
    expect(batches[0]?.text).toBe("привет\nне работает телефон\nпосле падения");
    expect(batches[0]?.messageCount).toBe(3);
    expect(buffer.pendingCount).toBe(0);
  });

  it("новое сообщение продлевает окно", async () => {
    const { buffer, batches } = make();

    buffer.add({ ...base, text: "первое" });

    // Почти дождались — и пришло второе.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MIN_MS - 500);
    expect(batches).toHaveLength(0);

    buffer.add({ ...base, text: "второе" });

    // Прежний таймер должен быть снят: иначе пачка ушла бы через 500 мс без
    // второго сообщения.
    await vi.advanceTimersByTimeAsync(1000);
    expect(batches).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.text).toBe("первое\nвторое");
  });

  it("отдаёт пачку по жёсткому дедлайну, даже если клиент печатает непрерывно", async () => {
    // Момент срабатывания фиксируется внутри обработчика: снимок `Date.now()`
    // после цикла показал бы время конца теста, а не время отправки пачки.
    const releasedAt: number[] = [];

    const buffer = new IncomingMessageBuffer(async () => {
      releasedAt.push(Date.now());
    }, silentLog);

    const startedAt = Date.now();
    buffer.add({ ...base, text: "0" });

    // Сообщение каждые 5 секунд на протяжении двух минут: без жёсткого дедлайна
    // окно продлевалось бы бесконечно, и ответа не было бы никогда.
    for (let elapsed = 5000; elapsed <= 120_000; elapsed += 5000) {
      buffer.add({ ...base, text: String(elapsed) });
      await vi.advanceTimersByTimeAsync(5000);
    }

    expect(releasedAt.length).toBeGreaterThanOrEqual(1);

    const first = releasedAt[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    // Первая пачка обязана уйти не позже жёсткого предела от первого сообщения.
    expect(first - startedAt).toBeLessThanOrEqual(DEBOUNCE_MAX_TOTAL_MS);
    // И не раньше минимального окна: иначе дебаунс не работал бы вовсе.
    expect(first - startedAt).toBeGreaterThanOrEqual(DEBOUNCE_MIN_MS);
  });

  it("разделяет диалоги по chat_id и по аккаунту", async () => {
    const { buffer, batches } = make();

    buffer.add({ ...base, text: "клиент A" });
    buffer.add({ ...base, chatId: "555111", peerId: "555111", text: "клиент B" });
    buffer.add({
      ...base,
      channelAccountId: "33333333-3333-3333-3333-333333333333",
      text: "тот же chat_id, другой аккаунт",
    });

    expect(buffer.pendingCount).toBe(3);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    expect(batches).toHaveLength(3);
    // Смешение диалогов означало бы, что ответ одному клиенту уходит другому.
    expect(new Set(batches.map((batch) => batch.text)).size).toBe(3);
  });

  it("ключ буфера учитывает и аккаунт, и чат", () => {
    // Один и тот же chat_id у двух аккаунтов — разные диалоги.
    expect(bufferKey({ channelAccountId: "a", chatId: "1" })).not.toBe(
      bufferKey({ channelAccountId: "b", chatId: "1" }),
    );
  });

  it("ограничивает размер пачки, не теряя уже накопленное", async () => {
    const { buffer, batches } = make();

    for (let index = 0; index < BUFFER_MAX_MESSAGES + 10; index += 1) {
      buffer.add({ ...base, text: `реплика ${index}` });
    }

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_TOTAL_MS + DEBOUNCE_MAX_MS);

    expect(batches).toHaveLength(1);
    // Лишние отбрасываются, а не удлиняют промпт бесконечно.
    expect(batches[0]?.messageCount).toBeLessThanOrEqual(BUFFER_MAX_MESSAGES);
    expect(batches[0]?.text).toContain("реплика 0");
  });

  it("сообщения во время обработки попадают в новую пачку", async () => {
    const batches: BufferedIncoming[] = [];

    // Тип объявлен явно: при выводе из `let x = null` TypeScript сужает его до
    // `never` в замыкании, и вызов ниже не проходит проверку.
    const gate: { release: (() => void) | null } = { release: null };

    const buffer = new IncomingMessageBuffer(async (batch) => {
      batches.push(batch);
      // Первая обработка «зависает»: имитируем секунды на вызов модели.
      if (batches.length === 1) {
        await new Promise<void>((resolve) => {
          gate.release = resolve;
        });
      }
    }, silentLog);

    buffer.add({ ...base, text: "первая пачка" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    expect(batches).toHaveLength(1);

    // Пока модель отвечает, клиент пишет снова.
    buffer.add({ ...base, text: "вторая пачка" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    gate.release?.();

    expect(batches).toHaveLength(2);
    // Второе сообщение не должно попасть в уже отправленную пачку.
    expect(batches[1]?.text).toBe("вторая пачка");
  });

  it("ошибка обработчика не ломает буфер", async () => {
    let calls = 0;

    const buffer = new IncomingMessageBuffer(async () => {
      calls += 1;
      throw new Error("модель недоступна");
    }, silentLog);

    buffer.add({ ...base, text: "первое" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    buffer.add({ ...base, text: "второе" });
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS + 100);

    // Отказ ответа не должен ронять слушателя: следующее сообщение обрабатывается.
    expect(calls).toBe(2);
  });

  it("clear снимает таймеры без вызова обработчика", async () => {
    const { buffer, batches } = make();

    buffer.add({ ...base, text: "не должно уйти" });
    buffer.clear();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MAX_MS * 2);

    // На остановке процесса обработчик обращался бы к закрытому пулу.
    expect(batches).toHaveLength(0);
    expect(buffer.pendingCount).toBe(0);
  });
});

describe("parseAgentReply", () => {
  it("разбирает чистый JSON с тремя сообщениями", () => {
    const reply = parseAgentReply(
      '{"message1":"Здравствуйте!","message2":"Уточните модель телефона?","message3":"Это ускорит диагностику."}',
    );

    expect(reply?.messages).toEqual([
      "Здравствуйте!",
      "Уточните модель телефона?",
      "Это ускорит диагностику.",
    ]);
  });

  it("пропускает пустые message2 и message3", () => {
    const reply = parseAgentReply('{"message1":"Готово","message2":"","message3":"   "}');

    expect(reply?.messages).toEqual(["Готово"]);
  });

  it("достаёт JSON из markdown-блока", () => {
    // Модели оборачивают ответ в ```json даже при response_format, поэтому чистый
    // JSON.parse на всём ответе падал бы.
    const reply = parseAgentReply('```json\n{"message1":"Привет","message2":""}\n```');

    expect(reply?.messages).toEqual(["Привет"]);
  });

  it("достаёт JSON из ответа с предисловием", () => {
    const reply = parseAgentReply('Конечно! Вот ответ: {"message1":"Гарантия 90 дней"}');

    expect(reply?.messages).toEqual(["Гарантия 90 дней"]);
  });

  it("игнорирует посторонние ключи", () => {
    // `reasoning` и подобное не должно уйти клиенту.
    const reply = parseAgentReply(
      '{"reasoning":"клиент спрашивает про гарантию","message1":"90 дней","notes":"—"}',
    );

    expect(reply?.messages).toEqual(["90 дней"]);
  });

  it("возвращает null на непригодном ответе", () => {
    // Вызывающий трактует null как отказ и НЕ отправляет ничего: сырой текст от
    // имени компании хуже молчания.
    for (const raw of [
      "Извините, я не понял вопрос",
      "",
      "{}",
      '{"message1":""}',
      '{"message1":123}',
      "{сломанный json",
    ]) {
      expect(parseAgentReply(raw), raw).toBeNull();
    }
  });

  it("сохраняет длинные сообщения без механической обрезки для передачи в MessageRefiner", () => {
    const long = `${"очень длинная фраза ".repeat(80)}конец`;
    const reply = parseAgentReply(JSON.stringify({ message1: long }));

    const message = reply?.messages[0];
    expect(message).toBeDefined();
    if (message === undefined) return;

    expect(message).toBe(long.trim());
  });

  it("сохраняет порядок сообщений", () => {
    const reply = parseAgentReply(
      '{"message3":"третье","message1":"первое","message2":"второе"}',
    );

    // Порядок задаётся ключами, а не порядком полей в JSON.
    expect(reply?.messages).toEqual(["первое", "второе", "третье"]);
  });
});

describe("nextTypingPauseMs", () => {
  it("укладывается в 2.5–4.5 секунды", () => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const pause = nextTypingPauseMs();
      expect(pause).toBeGreaterThanOrEqual(TYPING_PAUSE_MIN_MS);
      expect(pause).toBeLessThanOrEqual(TYPING_PAUSE_MAX_MS);
    }
  });

  it("даёт разные значения: фиксированная пауза читается как автоответчик", () => {
    const values = new Set(Array.from({ length: 30 }, () => nextTypingPauseMs()));
    expect(values.size).toBeGreaterThan(1);
  });
});

describe("buildSystemPrompt", () => {
  it("включает промпт агента, контекст и требование JSON", () => {
    const prompt = buildSystemPrompt({
      agentPrompt: "Ты помощник сервисного центра.",
      contextChunks: [
        { content: "Гарантия 90 дней.", filename: "Регламент.docx" },
        { content: "Диагностика 900 ₽.", filename: "Прайс.txt" },
      ],
    });

    expect(prompt).toContain("Ты помощник сервисного центра.");
    expect(prompt).toContain("Гарантия 90 дней.");
    expect(prompt).toContain("Регламент.docx");
    expect(prompt).toContain("message1");
    // Рамка вокруг контекста обязательна: без неё модель смешивает найденное с
    // собственными представлениями.
    expect(prompt).toContain("не придумывай факты");
  });

  it("при пустом контексте запрещает называть цены и сроки", () => {
    const prompt = buildSystemPrompt({
      agentPrompt: "Ты помощник.",
      contextChunks: [],
    });

    // Иначе агент отвечает общими словами о сроках, которых в регламенте компании
    // может не быть вовсе.
    expect(prompt).toContain("нет материалов");
    expect(prompt).toContain("Не называй конкретные цены");
    expect(prompt).toContain("message1");
  });
});
