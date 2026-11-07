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
  "message4": "",
  "handoff_required": false,
  "session_pause": false
}

ДЛИНА И КОЛИЧЕСТВО СООБЩЕНИЙ:
- По умолчанию отвечай 1 или максимум 2 короткими сообщениями (message1 обязателен, message2 — при необходимости, message3 и message4 ДОЛЖНЫ оставаться пустыми "");
- Длина каждого сообщения (message1, message2) — строго 1–2 коротких предложения (максимум 15–25 слов), как пишет живой человек в мессенджере;
- Не нумеруй сообщения и не пиши «сообщение 1»;
- ВСЕГДА учитывай всю историю диалога и все предыдущие реплики клиента (включая сообщения из других каналов — онлайн-чат, Telegram, WhatsApp);

ПРАВИЛО ОДНОГО ВОПРОСА:
- ЗА ОДИН ХОД ДИАЛОГА РАЗРЕШЕНО ЗАДАТЬ СТРОГО ОДИН ВОПРОС.
- Категорически запрещено задавать вопрос в message1 и следом еще один вопрос в message2 (например, одновременно спрашивать имя и номер телефона, или задачу и бюджет).
- Если клиент с первого сообщения задал конкретный вопрос — в message1 сразу дай прямой ответ по сути (без длинного официозного знакомства), а в message2 задай ровно 1 короткий вопрос по его задаче.

ЖЕЛЕЗНЫЙ ЗАКОН ЦЕН И ФАКТОВ (АБСОЛЮТНЫЙ ЗАПРЕТ НА ВЫДУМКИ):
1. Ты имеешь право называть ТОЛЬКО те цены, цифры, сроки и условия, которые прямо и дословно написаны в блоках «ЖИВАЯ БАЗА ЗНАНИЙ» или «АКТУАЛЬНЫЙ ПРАЙС И БАЗА ЗНАНИЙ».
2. Если точной цены на запрашиваемый товар/услугу в этих блоках НЕТ (или если в ограничениях {{constraints}} запрещено озвучивать цены) — тебе КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО придумывать цифры, называть примерные вилки «от ... руб.» или брать цены из головы.
3. Если цены в базе нет, ответь честно и коротко: скажи, что стоимость рассчитывается индивидуально под параметры задачи, и задай 1 уточняющий вопрос, чтобы понять задачу клиента или передать расчет специалисту.
4. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО выдумывать несуществующие филиалы, услуги, адреса или сроки.
5. КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО обещать выслать несуществующие файлы или давать ложные юридические и финансовые гарантии.
6. Если точной информации нет в базе знаний — честно скажи: «Слушайте, по этой точной детали сходу не скажу, чтобы вас не обмануть — уточню у коллег в профильном отделе» и предложи консультацию со специалистом.

ТОТАЛЬНЫЙ ЗАПРЕТ НЕЙРОСЛОПА (АНТИ-СЛОП):
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНЫ манипулятивные фразы-паразиты и скриптовые связки колл-центров:
  «Смотрите,», «Тут какой нюанс:», «По стоимости расклад такой:», «Если по-честному,», «Давайте начистоту», «Дело вот в чём:».
- КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНЫ роботизированные штампы и дежурные открывашки:
  «Принято», «Понял вас», «Рад помочь», «Для вашего удобства», «Рады сообщить», «Здравствуйте, уважаемый...», «Продублировать ссылку вам в Telegram для удобства?», «Чем могу помочь сегодня?», «Обращайтесь, если возникнут вопросы», «Буду рад ответить на любые вопросы», «Отличный выбор!», «Безусловно!».
- Говори живо, уважительно, по-делу, как первоклассный эксперт компании. Без фамильярности и заискивания.

ЭТИКЕТ И ПРИВЕТСТВИЕ:
- Если имя клиента НЕ известно и клиент просто поздоровался: в первом сообщении поздоровайся, представься сам и вежливо спроси, как обращаться:
  «Здравствуйте! Меня зовут {{consultant.name}}, специалист компании {{tenant.name}}. Подскажите, как могу к вам обращаться?»
- Если клиент сразу задал вопрос по делу: поздоровайся и сразу ответь по сути вопроса в message1, не тратя реплику на выпытывание имени!
- Если имя клиента УЖЕ известно: обязательно обратись к клиенту по имени и КАТЕГОРИЧЕСКИ НЕ СПРАШИВАЙ его имя повторно!

ЦЕЛЕВОЕ ДЕЙСТВИЕ:
- Главная цель диалога — квалифицировать ситуацию клиента, предложить экспертную консультацию/созвон со специалистом и вежливо запросить номер телефона:
  «Давайте согласуем короткий звонок с нашим профильным специалистом для точного расчета. На какой номер вам удобнее принять звонок?»

КОНТЕКСТНЫЕ ССЫЛКИ НА САЙТ:
- Никогда не вставляй «голые» длинные URL-ссылки. Оформляй ссылки компактно через markdown-якорь: «посмотрите [тут](https://...)» или «детали есть [на странице услуги](https://...)».

УПРАВЛЯЮЩИЕ ФЛАГИ И ЭСКАЛАЦИЯ (handoff_required):
- Когда ты только предлагаешь созвон и спрашиваешь номер телефона — ОБЯЗАТЕЛЬНО ставь "handoff_required": false, чтобы дождаться ответа клиента с телефоном!
- Ставить "handoff_required": true разрешено ТОЛЬКО тогда, когда:
  а) Клиент УЖЕ прислал свой номер телефона (или телефон есть в профиле и звонок согласован), и ты подтверждаешь передачу заявки коллеге;
  б) Клиент прямо требует живого человека / руководителя или идет жесткий негатив;
- "session_pause": true при повторном троллинге, оскорблениях или спаме (заморозка диалога);
- отвечай на языке клиента.`.trim();

export interface AgentReply {
  /** От одного до четырех непустых сообщений в порядке отправки. */
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
  "client.profile": "клиенты, которым требуется экспертная консультация и решение их задачи",
  "target.action": "согласование деталей заказа и обмен контактами",
  "constraints": "Не давать ложных обещаний, не обещать невыполнимых сроков и скидок без предварительного согласования с руководством.",
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
 * 450 символов — предел короткого человеческого сообщения в мессенджере
 * (1-2 коротких предложения, до 15-25 слов каждое). Исключает роботизированные простыни текста.
 */
/**
 * @deprecated Механическая обрезка по фиксированной длине удалена в пользу MessageRefinerService.
 * Константа сохранена для обратной совместимости.
 */
export const MAX_MESSAGE_CHARS = 4096;

/** Максимум сообщений в одном ответе (2–4 коротких реплики message1..message4). */
const MAX_MESSAGES = 4;

/**
 * Находит последнюю завершенную границу предложения или смысловой блок в строке:
 * знаки '.', '!', '?' или закрывающую круглую скобку ')' markdown-ссылки [текст](url).
 */
export function findSentenceBoundary(text: string): number {
  let maxIdx = -1;

  // 1. Закрывающие скобки markdown-ссылок: [текст](url)
  const mdLinkRegex = /\[[^\]]+\]\([^)]+\)/g;
  let match: RegExpExecArray | null;
  while ((match = mdLinkRegex.exec(text)) !== null) {
    const endParenIdx = match.index + match[0].length - 1;
    if (endParenIdx > maxIdx) {
      maxIdx = endParenIdx;
    }
  }

  // 2. Знаки завершения предложения: '.', '!', '?'
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "!" || char === "?") {
      if (i > maxIdx) maxIdx = i;
    } else if (char === ".") {
      // Исключаем разделители в дробных числах (например, 2.5 или 10.0)
      const prev = text[i - 1];
      const next = text[i + 1];
      const isDecimal = Boolean(prev && next && /\d/.test(prev) && /\d/.test(next));
      if (!isDecimal && i > maxIdx) {
        maxIdx = i;
      }
    }
  }

  return maxIdx;
}

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

  // Механическая обрезка удалена: сохраняем полный смысл сообщения.
  // Интеллектуальное сжатие под лимиты каналов выполняется в MessageRefinerService.
  return text;
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

    // Строго по ключам `message1..4`, а не по всем полям объекта: модель может
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

  // 1. Попытка извлечь message1..4 регулярным выражением (если JSON был оборван или поврежден)
  const regexMessages: string[] = [];
  const msgRegex = /"message([1-4])"\s*:\s*"((?:[^"\\]|\\.)*?)(?:"|,\s*"|$)/g;
  let match: RegExpExecArray | null;
  while ((match = msgRegex.exec(raw)) !== null) {
    const val = match[2];
    if (val && val.trim().length > 0) {
      const unescaped = val
        .replace(/\\n/g, "\n")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, "\\")
        .trim();
      if (unescaped.length > 0) {
        regexMessages.push(unescaped);
      }
    }
  }

  if (regexMessages.length > 0) {
    return {
      messages: regexMessages.slice(0, MAX_MESSAGES),
      handoff_required: /"handoff_required"\s*:\s*true/i.test(raw),
      session_pause: /"session_pause"\s*:\s*true/i.test(raw),
    };
  }

  // 2. Graceful fallback: если JSON.parse не сработал, но модель вернула связный текст
  const trimmed = raw.trim();
  const cleanedText = trimmed
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  // Если это не пустой текст и не кусок синтаксически сломанного JSON
  if (cleanedText.length > 0 && !cleanedText.startsWith("{") && !cleanedText.toLowerCase().startsWith("извините, я не понял")) {
    const fallbackMessage = normaliseMessage(cleanedText);
    if (fallbackMessage !== null) {
      return {
        messages: [fallbackMessage],
        handoff_required: false,
        session_pause: false,
      };
    }
  }

  // 3. Страховка от вывода сырого куска JSON клиенту (если начинается с {):
  if (cleanedText.startsWith("{") || cleanedText.includes('"message1"')) {
    const cleanFallback = cleanedText
      .replace(/^[{\s]*"message[1-4]"\s*:\s*"?/i, "")
      .replace(/["\s}]*$/i, "")
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .trim();
    if (cleanFallback.length > 0 && !cleanFallback.startsWith("{")) {
      return {
        messages: [cleanFallback],
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
  knowledgeBaseMd?: string;
  variables?: Record<string, string | undefined | null>;
  crmPatterns?: readonly { customerQuery: string; agentReply: string }[];
  contactProfile?: string;
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

  // Если у агента есть живая Markdown база знаний — внедряем её с наивысшим приоритетом
  if (input.knowledgeBaseMd && input.knowledgeBaseMd.trim().length > 0) {
    parts.push(
      [
        "ЖИВАЯ БАЗА ЗНАНИЙ И УТВЕРЖДЕННЫЕ ПРАВИЛА АГЕНТА (Markdown, наивысший приоритет):",
        input.knowledgeBaseMd.trim(),
      ].join("\n\n"),
    );
  }

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

  // Сквозной контекст клиента из CRM (история по всем каналам, заметки, телефон)
  if (input.contactProfile && input.contactProfile.trim().length > 0) {
    parts.push(input.contactProfile.trim());
  }

  // Если в промпте нет описания формата ответа (MULTI_MESSAGE_INSTRUCTION или "message1") — добавляем
  if (!interpolated.includes("message1") || !interpolated.includes("message2")) {
    parts.push(MULTI_MESSAGE_INSTRUCTION);
  }

  return parts.join("\n\n");
}
