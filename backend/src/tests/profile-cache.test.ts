import { describe, expect, it } from "vitest";

import {
  ChannelProfileCache,
  MISSING_PROFILE_TTL_MS,
  PROFILE_CACHE_MAX_ENTRIES,
  PROFILE_TTL_MS,
} from "../modules/channels/profile-cache.js";

// ---------------------------------------------------------------------------
// Кэш профилей собеседников.
//
// Юнит-тесты с поддельным временем, как у буфера входящих: это чистая механика
// TTL и вытеснения, без сети и БД.
//
// Проверяется то, что легко сломать незаметно: различие «не спрашивали» и
// «спрашивали, профиля нет» (без него закрытый настройками приватности профиль
// запрашивался бы на каждое сообщение), истечение обоих TTL и предел размера —
// кэш живёт всё время работы процесса, и его рост заметен только через недели.
// ---------------------------------------------------------------------------

/** Управляемое время: TTL сутки, ждать его в тесте нельзя. */
function clockAt(start = 1_000_000): { cache: ChannelProfileCache; advance: (ms: number) => void } {
  let now = start;
  const cache = new ChannelProfileCache(() => now);

  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("ChannelProfileCache", () => {
  it("различает «не спрашивали» и «профиля нет»", () => {
    const { cache } = clockAt();

    // Не спрашивали — нужен запрос к каналу.
    expect(cache.get("acc-1", "peer-1")).toBeUndefined();

    cache.set("acc-1", "peer-1", null);

    // Спрашивали, профиль закрыт настройками приватности — запрос не нужен.
    // Без этого различия закрытый профиль опрашивался бы на каждое сообщение.
    expect(cache.get("acc-1", "peer-1")).toBeNull();
  });

  it("возвращает сохранённый профиль", () => {
    const { cache } = clockAt();

    cache.set("acc-1", "peer-1", { firstName: "Иван", username: "ivanp" });

    expect(cache.get("acc-1", "peer-1")).toEqual({ firstName: "Иван", username: "ivanp" });
  });

  it("разделяет одного собеседника по аккаунтам", () => {
    const { cache } = clockAt();

    cache.set("acc-1", "peer-1", { firstName: "Иван" });

    // Один и тот же peer у разных аккаунтов — разные соединения и права: чужой
    // аккаунт мог видеть профиль иначе или не видеть вовсе.
    expect(cache.get("acc-2", "peer-1")).toBeUndefined();
  });

  it("забывает профиль по истечении суток", () => {
    const { cache, advance } = clockAt();

    cache.set("acc-1", "peer-1", { firstName: "Иван" });

    advance(PROFILE_TTL_MS - 1);
    expect(cache.get("acc-1", "peer-1")).toEqual({ firstName: "Иван" });

    advance(1);
    // Клиент мог сменить username или открыть номер: запись обязана однажды
    // устареть, иначе имя в CRM останется прошлогодним.
    expect(cache.get("acc-1", "peer-1")).toBeUndefined();
  });

  it("забывает отсутствие профиля быстрее, чем сам профиль", () => {
    const { cache, advance } = clockAt();

    cache.set("acc-1", "peer-1", null);

    advance(MISSING_PROFILE_TTL_MS - 1);
    expect(cache.get("acc-1", "peer-1")).toBeNull();

    advance(1);
    expect(cache.get("acc-1", "peer-1")).toBeUndefined();
  });

  it("снимает записи отключённого аккаунта, не задевая остальные", () => {
    const { cache } = clockAt();

    cache.set("acc-1", "peer-1", { firstName: "Иван" });
    cache.set("acc-1", "peer-2", { firstName: "Пётр" });
    cache.set("acc-2", "peer-1", { firstName: "Мария" });

    cache.forgetAccount("acc-1");

    expect(cache.get("acc-1", "peer-1")).toBeUndefined();
    expect(cache.get("acc-1", "peer-2")).toBeUndefined();
    expect(cache.get("acc-2", "peer-1")).toEqual({ firstName: "Мария" });
  });

  it("вытесняет самую старую запись при переполнении", () => {
    const { cache } = clockAt();

    for (let index = 0; index < PROFILE_CACHE_MAX_ENTRIES; index++) {
      cache.set("acc-1", `peer-${index}`, { firstName: `Клиент ${index}` });
    }

    expect(cache.size).toBe(PROFILE_CACHE_MAX_ENTRIES);

    cache.set("acc-1", "peer-new", { firstName: "Новый" });

    // Предел держится: без него кэш растёт по записи на каждого написавшего
    // клиента и никогда не уменьшается.
    expect(cache.size).toBe(PROFILE_CACHE_MAX_ENTRIES);
    expect(cache.get("acc-1", "peer-0")).toBeUndefined();
    expect(cache.get("acc-1", "peer-new")).toEqual({ firstName: "Новый" });
  });
});
