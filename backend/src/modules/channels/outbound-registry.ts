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
}

export type OutboundSender = (message: OutboundMessage) => Promise<OutboundSendResult>;

const senders = new Map<ChannelSlug, OutboundSender>();

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
  return senders.get(channel as ChannelSlug) ?? null;
}

/** Для тестов: снимает все регистрации между прогонами. */
export function clearOutboundSenders(): void {
  senders.clear();
}
