import type { ContactChannel, SocialKind } from "./contacts/contacts.types.js";

// ---------------------------------------------------------------------------
// Раскладка профиля из канала по полям контакта.
//
// Вынесено из `crm-pipeline.service.ts`: тот файл отвечает за поиск контакта,
// сделку и запись сообщения, а здесь — чистые преобразования «что пришло из
// канала» → «что записать в карточку», без БД и транзакций. После добавления
// профиля файл пайплайна перевалил за 500 строк, а эта часть тестируется
// отдельно и меняется при каждом новом канале.
//
// Что здесь исправлено по сравнению с прежним поведением:
//  - имя контакта было числовым id Telegram (`senderName` = `peerId`, который
//    разбирался как ФИО через `split(" ")`);
//  - в `socials` писался `@{chatId}` — ссылка `t.me/123456789` не открывается;
//  - `socials` заполнялись только для Telegram, поэтому у клиента из MAX
//    мессенджер в карточке не появлялся вовсе;
//  - `chatId` подставлялся в `phone`, то есть числовой id Telegram попадал в
//    колонку, по которой ищет `findContactByPhone`;
//  - слаг канала приводился типом (`as`), и в `contacts.channel` попадал `max`,
//    которого нет в перечислении фронта — метка канала теряла цвет.
// ---------------------------------------------------------------------------

/**
 * Профиль собеседника на стороне канала.
 *
 * Передаётся транспортом, а не запрашивается здесь: обращение к MTProto — дело
 * транспорта, у которого есть живой клиент. Все поля необязательны: настройки
 * приватности Telegram скрывают номер, username может быть не задан вовсе.
 * Отсутствие профиля целиком — рабочее состояние, а не ошибка.
 */
export interface ChannelProfile {
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
  isBot?: boolean;
}

/** Что известно о собеседнике на момент создания контакта. */
export interface SenderIdentity {
  channel: string;
  chatId: string;
  senderName: string;
  senderPhone?: string;
  senderUsername?: string;
  senderTelegramUsername?: string;
  profile?: ChannelProfile;
  isBot?: boolean;
  sourceMetadata?: Record<string, unknown>;
}

/**
 * Имя контакта, когда профиль недоступен.
 *
 * Не идентификатор: числовой id Telegram в поле «Имя» выглядел как испорченная
 * запись, а найти клиента по нему всё равно нельзя — для этого есть
 * `telegram_chat_id`.
 */
export const UNKNOWN_CONTACT_NAME = "Клиент";

/**
 * Слаг канала → значение `contacts.channel`.
 *
 * Наборы не совпадают, и это не опечатка: в `channel_accounts` мессенджер MAX
 * называется `max` (`CHANNEL_SLUGS`), а `contacts.channel` знает `rumax` — так
 * его назвали в `contactChannelSchema` и во фронте.
 *
 * Каналы без своего значения (`avito`, `instagram`) остаются `phone`: канал
 * переписки видно в самих сообщениях, а запись неизвестного слага снова развела
 * бы схему и данные.
 */
const CONTACT_CHANNEL_BY_SLUG: Readonly<Record<string, ContactChannel>> = {
  telegram: "telegram",
  whatsapp: "whatsapp",
  max: "rumax",
  webchat: "phone",
  phone: "phone",
  email: "email",
};

/** Слаг канала → вид соцсети в карточке. */
const SOCIAL_KIND_BY_SLUG: Readonly<Record<string, SocialKind>> = {
  telegram: "telegram",
  whatsapp: "whatsapp",
  max: "max",
  instagram: "instagram",
  webchat: "other",
};

/** Номер в E.164: схема контакта отвергает разделители и требует `+`. */
function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits === "" ? "" : `+${digits}`;
}

export function contactChannelFor(channel: string): ContactChannel {
  return CONTACT_CHANNEL_BY_SLUG[channel] ?? "phone";
}

/**
 * ФИО контакта из профиля канала.
 *
 * `senderName` больше не разбирается как ФИО безусловно: транспорт Telegram
 * передаёт в нём `peerId`, то есть числовой id, и `split(" ")[0]` давал имя вида
 * `123456789`. Он остаётся запасным вариантом только если не похож на
 * идентификатор — тогда это осмысленное имя из другого канала.
 */
export function contactNameFrom(identity: SenderIdentity): {
  first_name: string;
  last_name: string;
} {
  const first = identity.profile?.firstName?.trim() ?? "";
  const last = identity.profile?.lastName?.trim() ?? "";

  if (first !== "" || last !== "") {
    return { first_name: first === "" ? UNKNOWN_CONTACT_NAME : first, last_name: last };
  }

  return nameFromSender(identity.senderName) ?? { first_name: UNKNOWN_CONTACT_NAME, last_name: "" };
}

/** `null`, если строка похожа на идентификатор, а не на имя. */
function nameFromSender(senderName: string): { first_name: string; last_name: string } | null {
  const trimmed = senderName.trim();

  // Только цифры (и «@» с цифрами) — это идентификатор канала: у Telegram
  // peerId, у MAX числовой профиль. Именем такое быть не может.
  if (trimmed === "" || /^@?\d+$/.test(trimmed)) return null;

  // Системные заглушки сайта вида «Посетитель сайта (...)» или «Клиент ...» не режем по пробелу
  if (/^Посетитель\s+сайта/i.test(trimmed) || /^Клиент(?:\s+.*)?$/i.test(trimmed)) {
    return {
      first_name: trimmed,
      last_name: "",
    };
  }

  const parts = trimmed.split(/\s+/);

  return {
    first_name: parts[0] ?? UNKNOWN_CONTACT_NAME,
    last_name: parts.slice(1).join(" "),
  };
}

/**
 * Телефоны контакта.
 *
 * `chatId` в качестве номера больше не подставляется: у Telegram это числовой
 * id, и он попадал в колонку `phone`, по которой ищет `findContactByPhone` — то
 * есть в поиске по номеру появлялись записи с идентификатором вместо номера. Для
 * WhatsApp `chatId` — настоящий номер, поэтому оттуда он берётся.
 */
export function contactPhonesFrom(identity: SenderIdentity): { number: string }[] {
  const candidates = [
    identity.senderPhone,
    identity.profile?.phone,
    identity.channel === "whatsapp" ? identity.chatId : undefined,
  ];

  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const phone = normalizePhone(candidate);
    if (phone !== "") return [{ number: phone }];
  }

  return [];
}

/**
 * Мессенджер контакта.
 *
 * Значение — username, а не идентификатор чата: прежний `@{chatId}` давал ссылку
 * `t.me/123456789`, которая не открывается. Без username записывать нечего:
 * пустая секция честнее нерабочей ссылки. Для WhatsApp значение — номер, там
 * username не существует.
 */
export function contactSocialsFrom(
  identity: SenderIdentity,
): { kind: SocialKind; value: string }[] {
  const kind = SOCIAL_KIND_BY_SLUG[identity.channel];
  if (kind === undefined) return [];

  if (identity.channel === "webchat") {
    // В веб-чате идентификатор сессии (chatId) — это visitor_id / ym_uid, а не соцсеть.
    // Сохраняется в custom_fields.webchat_visitor_id и custom_fields.ym_uid, но не в socials.
    return [];
  }

  if (kind === "whatsapp") {
    const phone = normalizePhone(identity.profile?.phone ?? identity.chatId);
    return phone === "" ? [] : [{ kind, value: phone }];
  }

  if (kind === "max") {
    const username = identity.profile?.username?.trim() ?? "";
    if (username !== "") {
      return [{ kind, value: username.startsWith("@") ? username : `@${username}` }];
    }
    const phone = normalizePhone(identity.profile?.phone ?? identity.senderPhone ?? "");
    if (phone !== "") {
      return [{ kind, value: phone }];
    }
    const fromChatId = identity.chatId.trim();
    if (fromChatId.startsWith("@") && !/^@\d+$/.test(fromChatId)) {
      return [{ kind, value: fromChatId }];
    }
    return [];
  }

  const username = identity.profile?.username?.trim() ?? "";
  if (username !== "") {
    return [{ kind, value: username.startsWith("@") ? username : `@${username}` }];
  }

  // `chatId` вида `@ivanmax` — уже username, а не идентификатор: у MAX и
  // Instagram он именно такой.
  const fromChatId = identity.chatId.trim();
  if (fromChatId.startsWith("@") && !/^@\d+$/.test(fromChatId)) {
    return [{ kind, value: fromChatId }];
  }

  return [];
}

/** Имя для заголовка сделки: «Заявка от {Имя} ({Канал})». */
export function displayNameFrom(identity: SenderIdentity): string {
  const { first_name, last_name } = contactNameFrom(identity);
  return last_name === "" ? first_name : `${first_name} ${last_name}`;
}

export interface PhoneValidationResult {
  isValid: boolean;
  normalized: string | null;
  issue?: "too_short" | "too_long" | "invalid_format";
  digits: string;
}

export interface PhoneAnalysis {
  hasAttempt: boolean;
  isValid: boolean;
  phone: string | null;
  issue?: "too_short" | "too_long" | "invalid_format";
  rawCandidate?: string;
  digitsCount?: number;
}

/**
 * Валидирует конкретную строку-кандидат на соответствие форматам номеров телефонов.
 * Строгие правила:
 * - РФ: строго 11 цифр при префиксах +7, 7, 8 (например, +79111111111, 89150946944).
 * - РФ мобильные: 10 цифр начиная с 9 (например, 9150946944).
 * - РФ гео-коды: 10 цифр начиная с 3, 4, 8 (например, 4951234567).
 * - Неполные номера (10 цифр с 7 или 8, например 7911111111) бракуются как `too_short`!
 * - Номера с избыточными цифрами (+7999123456789) бракуются как `too_long`!
 * - Международные (+...): 10-15 цифр по стандарту E.164, при этом +7 строго 11 цифр.
 */
export function validatePhoneCandidate(candidate: string): PhoneValidationResult {
  const trimmed = candidate.trim();
  const digits = trimmed.replace(/\D/g, "");
  const startsWithPlus = trimmed.startsWith("+");

  if (digits.length < 7) {
    return { isValid: false, normalized: null, issue: "too_short", digits };
  }

  // 1. Международный формат с явным знаком плюса (+)
  if (startsWithPlus) {
    // Для РФ и Казахстана (+7) длина номера строго 11 цифр (+7XXXXXXXXXX)
    if (digits.startsWith("7")) {
      if (digits.length === 11) {
        return { isValid: true, normalized: `+7${digits.slice(1)}`, digits };
      }
      if (digits.length < 11) {
        return { isValid: false, normalized: null, issue: "too_short", digits };
      }
      return { isValid: false, normalized: null, issue: "too_long", digits };
    }

    // Для остальных стран (E.164: от 10 до 15 цифр)
    if (digits.length >= 10 && digits.length <= 15) {
      return { isValid: true, normalized: `+${digits}`, digits };
    }
    if (digits.length < 10) {
      return { isValid: false, normalized: null, issue: "too_short", digits };
    }
    return { isValid: false, normalized: null, issue: "too_long", digits };
  }

  // 2. Российские номера без знака плюса, начинающиеся с 7 или 8
  if (digits.startsWith("7") || digits.startsWith("8")) {
    if (digits.length === 11) {
      return { isValid: true, normalized: `+7${digits.slice(1)}`, digits };
    }
    if (digits.length < 11) {
      return { isValid: false, normalized: null, issue: "too_short", digits };
    }
    return { isValid: false, normalized: null, issue: "too_long", digits };
  }

  // 3. Российские мобильные без префикса (10 цифр, начинаются строго с 9)
  if (digits.startsWith("9")) {
    if (digits.length === 10) {
      return { isValid: true, normalized: `+7${digits}`, digits };
    }
    if (digits.length < 10) {
      return { isValid: false, normalized: null, issue: "too_short", digits };
    }
    return { isValid: false, normalized: null, issue: "too_long", digits };
  }

  // 4. Российские городские без префикса (10 цифр, начинаются с 3, 4, 8)
  if (digits.length === 10 && /^[348]/.test(digits)) {
    return { isValid: true, normalized: `+7${digits}`, digits };
  }

  if (digits.length < 10) {
    return { isValid: false, normalized: null, issue: "too_short", digits };
  }

  return { isValid: false, normalized: null, issue: "too_long", digits };
}

/**
 * Проверяет, не является ли найденная числовая последовательность суммой денег,
 * статьёй закона или датой (например, «300 000 руб», «100 тыс», «127 фз»).
 */
function isCurrencyOrNonPhoneMatch(
  text: string,
  matchIndex: number,
  matchLength: number,
  digits: string,
): boolean {
  // Номера на +7, 79, 89 с валидной длиной 11 цифр никогда не валюта
  if ((digits.startsWith("79") || digits.startsWith("89")) && digits.length === 11) {
    return false;
  }

  const trailingText = text.slice(matchIndex + matchLength, matchIndex + matchLength + 15).trim().toLowerCase();
  const leadingText = text.slice(Math.max(0, matchIndex - 15), matchIndex).trim().toLowerCase();

  const currencyKeywords = /^(?:руб|р\b|тыс|тыщ|к\b|к$|т\.р|usd|eur|€|\$)/i;
  const contextKeywords = /(?:долг|кредит|задолжен|сумм|стать|127-?фз|фз|год|руб)/i;

  if (currencyKeywords.test(trailingText)) {
    return true;
  }

  if (contextKeywords.test(leadingText) && !digits.startsWith("79") && !digits.startsWith("89") && !text.startsWith("+")) {
    return true;
  }

  return false;
}

/**
 * Анализирует входящий текст на наличие валидного номера или попытки ввода номера.
 */
export function analyzePhoneInText(text?: string | null): PhoneAnalysis {
  if (!text || typeof text !== "string") {
    return { hasAttempt: false, isValid: false, phone: null };
  }
  const cleaned = text.trim();
  if (cleaned.length === 0) {
    return { hasAttempt: false, isValid: false, phone: null };
  }

  const onlyDigits = cleaned.replace(/\D/g, "");

  // 1. Если весь текст состоит преимущественно из цифр (до 20 символов) — проверяем целиком
  if (
    onlyDigits.length >= 7 &&
    onlyDigits.length <= 16 &&
    (cleaned.startsWith("+") || /^[789]/.test(onlyDigits)) &&
    !isCurrencyOrNonPhoneMatch(cleaned, 0, cleaned.length, onlyDigits)
  ) {
    const directResult = validatePhoneCandidate(cleaned);
    if (directResult.isValid) {
      return {
        hasAttempt: true,
        isValid: true,
        phone: directResult.normalized,
        rawCandidate: cleaned,
        digitsCount: directResult.digits.length,
      };
    }
    return {
      hasAttempt: true,
      isValid: false,
      phone: null,
      issue: directResult.issue,
      rawCandidate: cleaned,
      digitsCount: directResult.digits.length,
    };
  }

  // 2. Ищем кандидатов внутри текста
  const candidateRegexes = [
    // Международные (+7..., +375...)
    /(?:^|[^\d+])(\+[1-9][\d\s\-()]{6,}\d)(?!\d)/g,
    // Российские с разделителями (+7, 7, 8, 9)
    /(?:^|[^\d+])((?:\+?7|8|9)[\s(-]*\d{2,4}[\s)-]*\d{2,4}[\s-]*\d{2,4}(?:[\s-]*\d{2,4})?)(?!\d)/g,
    // Слитные 7-15 цифр, начинающиеся с 7, 8, 9 или +
    /(?:^|[^\d+])(\+?[789]\d{6,14})(?!\d)/g,
    // Запасной: любые слитные 10-15 цифр
    /(?:^|[^\d+])(\d{10,15})(?!\d)/g,
  ];

  let firstInvalidAttempt: {
    issue?: "too_short" | "too_long" | "invalid_format";
    candidate: string;
    digits: string;
  } | null = null;

  for (const regex of candidateRegexes) {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(cleaned)) !== null) {
      const candidateStr = match[1] ?? match[0];
      const matchIdx = match.index;
      const digits = candidateStr.replace(/\D/g, "");

      if (digits.length < 7) continue;

      if (isCurrencyOrNonPhoneMatch(cleaned, matchIdx, candidateStr.length, digits)) {
        continue;
      }

      const valResult = validatePhoneCandidate(candidateStr);
      if (valResult.isValid && valResult.normalized) {
        return {
          hasAttempt: true,
          isValid: true,
          phone: valResult.normalized,
          rawCandidate: candidateStr,
          digitsCount: valResult.digits.length,
        };
      }

      // Если это невалидный номер, но похож на попытку ввода (начинается с +, 7, 8 или 9)
      const looksLikePhoneAttempt =
        candidateStr.trim().startsWith("+") ||
        digits.startsWith("7") ||
        digits.startsWith("8") ||
        digits.startsWith("9");

      if (looksLikePhoneAttempt && !firstInvalidAttempt) {
        firstInvalidAttempt = {
          issue: valResult.issue,
          candidate: candidateStr,
          digits: valResult.digits,
        };
      }
    }
  }

  if (firstInvalidAttempt) {
    return {
      hasAttempt: true,
      isValid: false,
      phone: null,
      issue: firstInvalidAttempt.issue,
      rawCandidate: firstInvalidAttempt.candidate,
      digitsCount: firstInvalidAttempt.digits.length,
    };
  }

  return { hasAttempt: false, isValid: false, phone: null };
}

/**
 * Извлекает валидный номер телефона из произвольного текста (в формате E.164: +7XXXXXXXXXX или +XXXXXXXXXXX).
 * Возвращает `null`, если номер некорректен, неполон или содержит опечатки.
 */
export function extractPhoneNumber(text?: string | null): string | null {
  const analysis = analyzePhoneInText(text);
  return analysis.isValid ? analysis.phone : null;
}

/**
 * Извлекает валидный email из произвольного текста.
 */
export function extractEmailAddress(text?: string | null): string | null {
  if (!text || typeof text !== "string") return null;
  const match = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

/**
 * Проверяет, является ли отправитель сообщения ботом (Telegram bot, MAX bot и т.д.).
 * Защищает CRM от автоматического создания контактов и сделок для ботов.
 */
export function isBotSender(input: {
  channel?: string;
  chatId?: string;
  senderName?: string;
  senderPhone?: string;
  senderUsername?: string;
  senderTelegramUsername?: string;
  profile?: ChannelProfile | null;
  isBot?: boolean | null;
  sourceMetadata?: Record<string, unknown> | null;
}): boolean {
  // 1. Нативный или явно переданный признак бота
  if (input.isBot === true) return true;
  if (input.profile?.isBot === true) return true;

  // 2. Метаданные источника (sourceMetadata / raw webhook payload)
  if (input.sourceMetadata && typeof input.sourceMetadata === "object") {
    if (input.sourceMetadata.is_bot === true || input.sourceMetadata.isBot === true) return true;
    if (input.sourceMetadata.type === "bot" || input.sourceMetadata.sender_type === "bot") return true;
  }

  // 3. Анализ username отправителя
  const usernameCandidates = [
    input.profile?.username,
    input.senderTelegramUsername,
    input.senderUsername,
    input.chatId?.startsWith("@") ? input.chatId : undefined,
  ];

  for (const rawUsername of usernameCandidates) {
    if (!rawUsername || typeof rawUsername !== "string") continue;
    const clean = rawUsername.trim().replace(/^@/, "");
    // По спецификации Telegram юзернеймы ботов обязаны заканчиваться на 'bot' (например, 'kupmsk_bot', 'myBot')
    if (clean.length >= 3 && /(?:_bot|bot)$/i.test(clean)) {
      return true;
    }
  }

  // 4. Анализ senderName: если в качестве имени передан юзернейм бота вида @kupmsk_bot или my_bot
  if (input.senderName && typeof input.senderName === "string") {
    const trimmedSender = input.senderName.trim().replace(/^@/, "");
    if (/^[a-zA-Z0-9_]{3,}(?:_bot|bot)$/i.test(trimmedSender)) {
      return true;
    }
  }

  return false;
}

