// ---------------------------------------------------------------------------
// Формат ответа агента: до трёх коротких сообщений вместо одного длинного.
//
// Живой диалог в мессенджере выглядит как несколько реплик подряд, а не как
// абзац на десять строк. Модель обязана вернуть строгий JSON
// `{ message1, message2, message3, handoff_required, session_pause }`, потому
// что разбор свободного текста по пустым строкам ломается на любом списке или
// пояснении в ответе, а текстовые теги ломают JSON.parse.
//
// Модуль без обращений к БД и сети: разбор и сборка промпта покрываются
// юнит-тестами.
// ---------------------------------------------------------------------------

/** Инструкция о формате, добавляемая к системному промпту агента. */
export const MULTI_MESSAGE_INSTRUCTION = `
ФОРМАТ ОТВЕТА — СТРОГО JSON, без markdown-разметки и пояснений вокруг:
{
  "message1": "...",
  "message2": "...",
  "message3": "",
  "handoff_required": false,
  "session_pause": false
}

Правила:
- message1 обязателен, message2 и message3 — пустая строка, если не нужны;
- каждое сообщение — одна-две коротких фразы, как в живой переписке;
- не нумеруй сообщения и не пиши «сообщение 1»;
- если данных не хватает, задай уточняющий вопрос в message2;
- handoff_required: true, если требуется передать диалог коллеге-человеку;
- session_pause: true при повторном троллинге, оскорблениях или спаме (заморозка диалога);
- отвечай на языке клиента.`.trim();

export interface AgentReply {
  /** От одного до трёх непустых сообщений в порядке отправки. */
  messages: string[];
  /** Требуется ли передача диалога человеку-специалисту */
  handoff_required: boolean;
  /** Требуется ли заморозка/пауза диалога (троллинг, спам) */
  session_pause: boolean;
}

/**
 * Словарь безопасных значений по умолчанию для интерполяции промптов.
 * Предотвращает появление `undefined`, `null` или сырых усов `{{variable}}` в промпте.
 */
export const SAFE_DEFAULTS: Record<string, string> = {
  "consultant.name": "Алексей",
  "consultant.role": "ведущий специалист",
  "business.niche": "оказание профильных услуг и консультация клиентов",
  "target.action": "согласование деталей заказа и обмен контактами",
  "handoff.specialist": "старший специалист профильного отдела",
  "channel_type": "чат на сайте",
  "current_time": "рабочее время",
  "knowledge_base_context": "Данные прайса и условий уточняются индивидуально под запрос.",
  "website_context": "Ориентируйся на факты и отзывы, приведённые в блоке актуальной базы знаний выше.",
  "reviews_and_reputation": "Ориентируйся на факты и отзывы, приведённые в блоке актуальной базы знаний выше.",
  "successful_crm_patterns": "Опирайся на базовые правила экспертных продаж и честного диалога.",
};

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
 * Возвращает `null`, только если ответ полностью непригоден.
 * Поддерживает извлечение JSON с флагами `handoff_required` и `session_pause`,
 * а также graceful fallback на обычный текст, если модель не вернула JSON.
 */
export function parseAgentReply(raw: string): AgentReply | null {
  const parsed = extractJson(raw);

  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    const messages: string[] = [];

    // Строго по ключам `message1..3`, а не по всем полям объекта: модель может
    // добавить `reasoning` или `notes`, и они не должны уйти клиенту.
    for (let index = 1; index <= MAX_MESSAGES; index += 1) {
      const message = normaliseMessage(record[`message${index}`]);
      if (message !== null) messages.push(message);
    }

    if (messages.length > 0) {
      return {
        messages,
        handoff_required: Boolean(record.handoff_required),
        session_pause: Boolean(record.session_pause),
      };
    }
  }

  // Graceful fallback: если JSON.parse не сработал, но модель вернула связный текст
  const trimmed = raw.trim();
  const cleanedText = trimmed
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Если это не пустой текст и не кусок синтаксически сломанного JSON
  if (cleanedText.length > 0 && !cleanedText.startsWith("{")) {
    const fallbackMessage = normaliseMessage(cleanedText);
    if (fallbackMessage !== null) {
      return {
        messages: [fallbackMessage],
        handoff_required: false,
        session_pause: false,
      };
    }
  }

  return null;
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
 * Подставляет переменные в шаблон промпта с безопасными дефолтами.
 */
export function interpolatePromptVariables(
  template: string,
  variables?: Record<string, string | undefined | null>,
): string {
  return template.replace(/\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g, (_match, token: string) => {
    const val = variables?.[token];
    if (typeof val === "string" && val.trim().length > 0) {
      return val.trim();
    }
    return SAFE_DEFAULTS[token] ?? "";
  });
}

export interface BuildSystemPromptInput {
  agentPrompt: string;
  contextChunks: readonly { content: string; filename: string }[];
  variables?: Record<string, string | undefined | null>;
  crmPatterns?: readonly { customerQuery: string; agentReply: string }[];
}

/**
 * Собирает системный промпт: промпт агента (с интерполяцией) + найденный контекст
 * базы знаний + паттерны закрытых сделок CRM + формат ответа.
 */
export function buildSystemPrompt(input: BuildSystemPromptInput): string {
  // 1. Формируем контекст базы знаний
  let kbContext = "";
  if (input.contextChunks.length > 0) {
    kbContext = input.contextChunks
      .map((chunk, index) => `[${index + 1}] Из «${chunk.filename}»:\n${chunk.content}`)
      .join("\n\n");
  } else {
    kbContext =
      "В базе знаний нет материалов по этому вопросу. Не называй конкретные цены, сроки и условия — предложи уточнить у коллег.";
  }

  // 2. Формируем паттерны CRM сделок
  let crmContext = "";
  if (input.crmPatterns && input.crmPatterns.length > 0) {
    crmContext = input.crmPatterns
      .map((p, i) => `Пример ${i + 1}:\nКлиент: «${p.customerQuery}»\nУспешный ответ: «${p.agentReply}»`)
      .join("\n\n");
  }

  // 3. Собираем словарь переменных для интерполяции
  const effectiveVariables: Record<string, string> = {
    ...SAFE_DEFAULTS,
  };

  if (input.variables) {
    for (const [k, v] of Object.entries(input.variables)) {
      if (typeof v === "string" && v.trim().length > 0) {
        effectiveVariables[k] = v.trim();
      }
    }
  }

  effectiveVariables.knowledge_base_context = kbContext;
  if (crmContext) {
    effectiveVariables.successful_crm_patterns = crmContext;
  }

  // 4. Интерполируем переменные в агентском промпте
  const interpolated = interpolatePromptVariables(input.agentPrompt, effectiveVariables);

  const parts = [interpolated.trim()];

  // Если в промпте НЕ было плейсхолдера {{knowledge_base_context}}, добавляем блок в конец (обратная совместимость)
  if (!input.agentPrompt.includes("{{knowledge_base_context}}")) {
    if (input.contextChunks.length > 0) {
      parts.push(
        [
          "ВЫДЕРЖКИ ИЗ ДОКУМЕНТОВ КОМПАНИИ (используй их как главный источник фактов; документы с прайсом имеют высший приоритет над историческими диалогами):",
          kbContext,
          "Если ответа нет в выдержках, скажи, что уточнишь у коллег, и не придумывай факты, цены и сроки.",
        ].join("\n\n"),
      );
    } else {
      parts.push(kbContext);
    }
  }

  // Если в промпте НЕ было плейсхолдера {{successful_crm_patterns}} и есть паттерны — добавляем
  if (crmContext && !input.agentPrompt.includes("{{successful_crm_patterns}}")) {
    parts.push(
      [
        "ПРАКТИЧЕСКИЙ ОПЫТ УСПЕШНЫХ СДЕЛОК CRM (используй формулировки как референс):",
        crmContext,
      ].join("\n\n"),
    );
  }

  // Если в промпте нет описания формата ответа (MULTI_MESSAGE_INSTRUCTION или "message1") — добавляем
  if (!interpolated.includes("message1") || !interpolated.includes("message2")) {
    parts.push(MULTI_MESSAGE_INSTRUCTION);
  }

  return parts.join("\n\n");
}
