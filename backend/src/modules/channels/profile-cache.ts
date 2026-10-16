import type { ChannelProfile } from "../crm/crm-pipeline.service.js";

// ---------------------------------------------------------------------------
// Кэш профилей собеседников.
//
// Зачем. Профиль (имя, username, номер) нужен только при создании контакта, но
// узнать «контакт уже есть» можно лишь в `processIncoming`, за транзакцией. Без
// кэша каждое сообщение постоянного клиента означало бы запрос `GetFullUser` к
// Telegram, хотя имя не меняется месяцами: лишний сетевой вызов на путь ответа
// и лишний повод упереться во `FLOOD_WAIT`.
//
// В памяти процесса, а не в Redis — по той же причине, что и буфер входящих:
// кэш осмыслен вместе с MTProto-соединением, которое живёт в этом же процессе, и
// при перезапуске восстанавливать его незачем.
//
// TTL, а не бессрочное хранение: клиент может сменить username или открыть
// номер, и запись обязана однажды устареть. Сутки — компромисс: за это время
// объём запросов к Telegram падает практически до одного на клиента, а
// устаревшее имя живёт не дольше дня.
//
// Отрицательный результат кэшируется тоже, но короче: закрытый настройками
// приватности профиль не откроется в следующую минуту, а повторять запрос на
// каждое сообщение — то же самое, что не иметь кэша.
// ---------------------------------------------------------------------------

export const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
export const MISSING_PROFILE_TTL_MS = 10 * 60 * 1000;

/**
 * Предел числа записей.
 *
 * Кэш живёт всё время работы процесса, и без предела он растёт по одной записи
 * на каждого написавшего клиента — на активном арендаторе это утечка, заметная
 * только через недели. При переполнении вытесняется самая старая запись.
 */
export const PROFILE_CACHE_MAX_ENTRIES = 5000;

interface CacheEntry {
  profile: ChannelProfile | null;
  expiresAt: number;
}

/** Ключ: один и тот же peer у разных аккаунтов — разные соединения и права. */
function cacheKey(channelAccountId: string, peerId: string): string {
  return `${channelAccountId}:${peerId}`;
}

export class ChannelProfileCache {
  private readonly entries = new Map<string, CacheEntry>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Сколько записей держится. Для диагностики и тестов. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Профиль из кэша.
   *
   * Три состояния, и они различаются: `undefined` — не спрашивали (нужен
   * запрос), `null` — спрашивали, профиль недоступен (запрос не нужен),
   * объект — есть данные.
   */
  get(channelAccountId: string, peerId: string): ChannelProfile | null | undefined {
    const key = cacheKey(channelAccountId, peerId);
    const entry = this.entries.get(key);

    if (entry === undefined) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.profile;
  }

  set(channelAccountId: string, peerId: string, profile: ChannelProfile | null): void {
    const ttl = profile === null ? MISSING_PROFILE_TTL_MS : PROFILE_TTL_MS;

    // Переполнение: вытесняется первая запись — `Map` в JS сохраняет порядок
    // вставки, поэтому это самая старая из добавленных.
    if (this.entries.size >= PROFILE_CACHE_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done !== true) this.entries.delete(oldest.value);
    }

    this.entries.set(cacheKey(channelAccountId, peerId), {
      profile,
      expiresAt: this.now() + ttl,
    });
  }

  /** Снятие записей отключённого аккаунта: сессия сменилась, права могли тоже. */
  forgetAccount(channelAccountId: string): void {
    const prefix = `${channelAccountId}:`;

    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
