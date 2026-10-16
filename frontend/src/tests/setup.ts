import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Размонтирование между тестами: `@testing-library/react` не делает этого сам,
// когда `globals` включены, и следующий тест находил бы поля предыдущего.
//
// `localStorage` очищается там же и по той же причине. Появилось после
// конкретного падения: таблица записей начала хранить раскладку колонок, и тест
// страницы контактов упал в общем прогоне, проходя в одиночку — сохранённая
// раскладка из чужого теста скрывала колонку, которую он искал. Чистка в
// собственном `beforeEach` каждого файла это не закрывает: порядок файлов не
// определён, и протечь может из любого.
afterEach(() => {
  cleanup();
  window.localStorage?.clear();
});

/**
 * `localStorage` в этом окружении отсутствует.
 *
 * jsdom 26 его не поднимает, а Node предупреждает «localStorage is not available
 * because --localstorage-file was not provided». Проверено: `typeof window` —
 * `object`, `window.localStorage` — `undefined`.
 *
 * Реализация в памяти, а не флаг Node с файлом: файл пришлось бы чистить между
 * тестами и он переживал бы прогон, тогда как здесь состояние умирает вместе с
 * процессом. Поведение достаточное — раскладка таблиц пишет и читает строки.
 */
if (typeof window !== "undefined" && window.localStorage === undefined) {
  const store = new Map<string, string>();

  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => store.get(key) ?? null,
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(window, "localStorage", {
    value: memoryStorage,
    configurable: true,
  });
}
