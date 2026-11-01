import type { ChannelSlug } from "../../types/index.js";

// ---------------------------------------------------------------------------
// Реестр исходящих транспортов.
//
// Зачем он вообще нужен. Транспорт Telegram живёт в `server.ts`: он держит
// постоянные MTProto-сокеты по всем подключённым аккаунтам, и поднимать его в
// `buildApp` нельзя — тесты открывали бы сетевые соединения на каждый прогон
// (объяснено там же, в комментарии к `TelegramTransportService`). Маршруту
// `POST /crm/deals/:id/messages` при этом нужно отправить сообщение через тот
// самый живой клиент, а не через новое соединение: авторизация лежит в сессии
// подключённого аккаунта.
//
// Отсюда реестр: транспорт регистрирует себя при старте процесса, маршрут
// спрашивает отправителя по каналу. Прямой импорт транспорта в маршрут дал бы
// обратную зависимость (channels → server) и поднимал бы сокеты в тестах.
//
// Реестр процессный, а не по арендаторам: сам транспорт выбирает соединение по
// `channelAccountId`, а изоляция арендатора остаётся на нём и на RLS.
//
// Отсутствие отправителя — не ошибка кода, а рабочее состояние: канал не
// подключён, транспорт выключен (нет `TELEGRAM_API_ID`) или процесс без
// слушателя. Поэтому `resolveOutboundSender` возвращает `null`, а вызывающий
// решает, что показать пользователю.
// ---------------------------------------------------------------------------

/** Результат попытки отправки: причина отказа нужна пользователю в таймлайне. */
export type OutboundSendResult =
  | { ok: true }
  | { ok: false; reason: string };

export interface OutboundMessage {
  tenantId: string;
  channelAccountId: string;
  /** Адрес получателя в терминах канала: peer id Telegram, номер WhatsApp. */
  recipient: string;
  text: string;
  username?: string;
  phone?: string;
  attachment?: string;
  attachmentType?: string;
}

export type OutboundSender = (message: OutboundMessage) => Promise<OutboundSendResult>;

export interface StoryPublishPayload {
  tenantId: string;
  channelAccountId: string | null;
  mediaUrl: string;
  mediaType: "photo" | "video";
  caption?: string;
  linkUrl?: string | null;
  linkText?: string | null;
}

export type StoryPublishResult =
  | { ok: true; externalId?: string }
  | { ok: false; reason: string };

export type StoryPublisher = (payload: StoryPublishPayload) => Promise<StoryPublishResult>;

export interface TelegramPhoneResolveResult {
  exists: boolean;
  userId?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  error?: string;
}

export type TelegramPhoneResolver = (
  tenantId: string,
  phoneDigits: string,
) => Promise<TelegramPhoneResolveResult>;

export interface TelegramHistorySyncParams {
  tenantId: string;
  dealId: string;
  channelAccountId: string;
  peerId: string;
  username?: string;
  phone?: string;
  limit?: number;
}

export type TelegramHistorySyncer = (params: TelegramHistorySyncParams) => Promise<number>;

const senders = new Map<ChannelSlug, OutboundSender>();
const storyPublishers = new Map<ChannelSlug, StoryPublisher>();
let telegramPhoneResolver: TelegramPhoneResolver | null = null;
let telegramHistorySyncer: TelegramHistorySyncer | null = null;

/** Транспорт Telegram регистрирует синхронизатор истории сообщений */
export function registerTelegramHistorySyncer(syncer: TelegramHistorySyncer): () => void {
  telegramHistorySyncer = syncer;
  return () => {
    if (telegramHistorySyncer === syncer) telegramHistorySyncer = null;
  };
}

/** Вызов синхронизатора истории диалога Telegram */
export function resolveTelegramHistorySyncer(): TelegramHistorySyncer | null {
  return telegramHistorySyncer;
}

/** Транспорт Telegram регистрирует резолвер поиска по номеру телефона */

/** Транспорт Telegram регистрирует резолвер поиска по номеру телефона */
export function registerTelegramPhoneResolver(resolver: TelegramPhoneResolver): () => void {
  telegramPhoneResolver = resolver;
  return () => {
    if (telegramPhoneResolver === resolver) telegramPhoneResolver = null;
  };
}

/** Вызов резолвера Telegram по номеру телефона */
export async function resolveTelegramPhone(
  tenantId: string,
  phoneDigits: string,
): Promise<TelegramPhoneResolveResult | null> {
  if (!telegramPhoneResolver) return null;
  return telegramPhoneResolver(tenantId, phoneDigits);
}

/** Транспорт объявляет себя отправителем канала при старте процесса. */
export function registerOutboundSender(channel: ChannelSlug, sender: OutboundSender): () => void {
  senders.set(channel, sender);
  return () => {
    // Снимается только собственная регистрация: при перезапуске транспорта
    // новый экземпляр уже мог занять место, и его удалять нельзя.
    if (senders.get(channel) === sender) senders.delete(channel);
  };
}

/** `null` — канал не умеет отправлять в этом процессе; это не ошибка. */
export function resolveOutboundSender(channel: string): OutboundSender | null {
  if (channel === "webchat") {
    // Веб-чат на сайте клиента: сообщение менеджера сохранено в deal_messages,
    // а посетитель сайта забирает его через /history при активной сессии.
    return async () => ({ ok: true });
  }
  return senders.get(channel as ChannelSlug) ?? null;
}

/** Транспорт объявляет себя публикатором сторис канала. */
export function registerStoryPublisher(channel: ChannelSlug, publisher: StoryPublisher): () => void {
  storyPublishers.set(channel, publisher);
  return () => {
    if (storyPublishers.get(channel) === publisher) storyPublishers.delete(channel);
  };
}

/** `null` — канал не умеет публиковать сторис в этом процессе. */
export function resolveStoryPublisher(channel: string): StoryPublisher | null {
  return storyPublishers.get(channel as ChannelSlug) ?? null;
}

/** Для тестов: снимает все регистрации между прогонами. */
export function clearOutboundSenders(): void {
  senders.clear();
  storyPublishers.clear();
  telegramPhoneResolver = null;
  telegramHistorySyncer = null;
}
