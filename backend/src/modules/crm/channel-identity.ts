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
}

/** Что известно о собеседнике на момент создания контакта. */
export interface SenderIdentity {
  channel: string;
  chatId: string;
  senderName: string;
  senderPhone?: string;
  profile?: ChannelProfile;
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

  if (identity.channel === "webchat" && identity.chatId) {
    return [{ kind: "other", value: identity.chatId }];
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
