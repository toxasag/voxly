// ---------------------------------------------------------------------------
// Формат ответа агента: до трёх коротких сообщений вместо одного длинного.
//
// Живой диалог в мессенджере выглядит как несколько реплик подряд, а не как
// абзац на десять строк. Модель обязана вернуть строгий JSON
// `{ message1, message2, message3 }`, потому что разбор свободного текста по
// пустым строкам ломается на любом списке или пояснении в ответе.
//
// Модуль без обращений к БД и сети: разбор и сборка промпта покрываются
// юнит-тестами.
// ---------------------------------------------------------------------------

/** Инструкция о формате, добавляемая к системному промпту агента. */
export const MULTI_MESSAGE_INSTRUCTION = `
ФОРМАТ ОТВЕТА — СТРОГО JSON, без markdown-разметки и пояснений вокруг:
{"message1": "...", "message2": "...", "message3": ""}

Правила:
- message1 обязателен, message2 и message3 — пустая строка, если не нужны;
- каждое сообщение — одна-две коротких фразы, как в живой переписке;
- не нумеруй сообщения и не пиши «сообщение 1»;
- если данных не хватает, задай уточняющий вопрос в message2;
- отвечай на языке клиента.`.trim();

export interface AgentReply {
  /** От одного до трёх непустых сообщений в порядке отправки. */
  messages: string[];
}

/**
 * Предел длины одного сообщения.
 *
 * Telegram режет сообщения длиннее 4096 символов, а склейка нескольких реплик в
 * одну обесценивает весь смысл мульти-отправки. 900 символов — практический
 * предел «реплики в переписке»; модель, вернувшая больше, обрезается с
 * сохранением границы слова.
 */
const MAX_MESSAGE_CHARS = 900;

/** Максимум сообщений в одном ответе (задание: message1..message3). */
const MAX_MESSAGES = 3;

/**
 * Достаёт JSON из ответа модели.
 *
 * Модели регулярно оборачивают JSON в ```-блок или добавляют предисловие даже при
 * `response_format: json_object`, поэтому чистый `JSON.parse` на всём ответе
 * падал бы. Берётся подстрока от первой `{` до последней `}`.
 */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normaliseMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const text = value.trim();
  if (text.length === 0) return null;

  if (text.length <= MAX_MESSAGE_CHARS) return text;

  // Обрезка по последнему пробелу: разрыв посреди слова выглядит как сбой.
  const cut = text.slice(0, MAX_MESSAGE_CHARS);
  const lastSpace = cut.lastIndexOf(" ");

  return `${(lastSpace > MAX_MESSAGE_CHARS / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Разбирает ответ модели в набор сообщений.
 *
 * Возвращает `null`, если ответ непригоден. Вызывающий трактует это как отказ и
 * НЕ отправляет ничего клиенту: отправить сырой JSON или «извините, ошибка» от
 * имени компании хуже, чем промолчать и оставить диалог оператору.
 */
export function parseAgentReply(raw: string): AgentReply | null {
  const parsed = extractJson(raw);

  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  const messages: string[] = [];

  // Строго по ключам `message1..3`, а не по всем полям объекта: модель может
  // добавить `reasoning` или `notes`, и они не должны уйти клиенту.
  for (let index = 1; index <= MAX_MESSAGES; index += 1) {
    const message = normaliseMessage(record[`message${index}`]);
    if (message !== null) messages.push(message);
  }

  if (messages.length === 0) return null;

  return { messages };
}

/**
 * Пауза между сообщениями: 2.5–4.5 секунды (задание).
 *
 * Случайная, а не фиксированная: ровно 3 секунды между каждой репликой читаются
 * как автоответчик. Экспортируется для тестов, которые проверяют диапазон, а не
 * конкретное значение.
 */
export const TYPING_PAUSE_MIN_MS = 2500;
export const TYPING_PAUSE_MAX_MS = 4500;

export function nextTypingPauseMs(): number {
  return (
    TYPING_PAUSE_MIN_MS +
    Math.floor(Math.random() * (TYPING_PAUSE_MAX_MS - TYPING_PAUSE_MIN_MS + 1))
  );
}

/**
 * Собирает системный промпт: промпт агента + найденный контекст + формат ответа.
 *
 * Контекст подаётся отдельным блоком с явным указанием, что это выдержки из
 * документов компании, и с запретом выдумывать за их пределами. Без такой рамки
 * модель смешивает найденное со собственными представлениями, и ответ выглядит
 * так же уверенно, но перестаёт соответствовать регламенту компании.
 */
export function buildSystemPrompt(input: {
  agentPrompt: string;
  contextChunks: readonly { content: string; filename: string }[];
}): string {
  const parts = [input.agentPrompt.trim()];

  if (input.contextChunks.length > 0) {
    const context = input.contextChunks
      .map((chunk, index) => `[${index + 1}] Из «${chunk.filename}»:\n${chunk.content}`)
      .join("\n\n");

    parts.push(
      [
        "ВЫДЕРЖКИ ИЗ ДОКУМЕНТОВ КОМПАНИИ (используй их как источник фактов):",
        context,
        "Если ответа нет в выдержках, скажи, что уточнишь у коллег, и не придумывай факты, цены и сроки.",
      ].join("\n\n"),
    );
  } else {
    // Явное указание при пустом поиске: иначе модель отвечает общими словами о
    // сроках и ценах, которых в регламенте компании может не быть вовсе.
    parts.push(
      "В базе знаний нет материалов по этому вопросу. Не называй конкретные цены, сроки и условия — предложи уточнить у коллег.",
    );
  }

  parts.push(MULTI_MESSAGE_INSTRUCTION);

  return parts.join("\n\n");
}
