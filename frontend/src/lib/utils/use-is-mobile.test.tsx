import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MOBILE_VIEWPORT,
  useIsMobile,
  useIsTouchDevice,
} from "@/lib/utils/use-is-mobile";

// ---------------------------------------------------------------------------
// Определение мобильного режима.
//
// Тесты написаны до реализации, потому что здесь легко сделать правильно
// выглядящую, но неверную вещь. Два подводных камня, каждый проверяется отдельно:
//
// 1. **Запрос `max-width: 767px`, а не `768px`.** Брейкпоинты в проекте
//    дефолтные (проверено: `globals.css` содержит только `@import "tailwindcss"`
//    без блока `@theme`, а `tailwind.config.ts` в Tailwind 4 без директивы
//    `@config` вообще не загружается), значит `md:` — это `min-width: 768px`. При
//    запросе `max-width: 768px` на ровно 768px истинны оба условия: `md:`-классы
//    применяются, и хук говорит «мобильный» — на планшете в портрете получилась
//    бы смесь режимов. 767px делает хук точным дополнением к `md:`.
//
//    У Twenty здесь `max-width: 768px` (`useIsMobile.ts`), и это осознанное
//    отклонение от референса: у них раскладка на styled-components с
//    собственными медиазапросами, а не на утилитах Tailwind, поэтому пересечение
//    на одном пикселе им ничего не ломает.
//
// 2. **Способ ввода отделён от ширины.** Узкое окно на десктопе всё ещё
//    поддерживает hover, а планшет в ландшафте — нет. Ветвить взаимодействие по
//    ширине — дефект, про который прямо написано в комментарии
//    `useIsTouchDevice.ts` у Twenty.
//
// SSR отдельно: `matchMedia` при серверном рендере недоступен, и хук обязан
// вернуть `false`, а не упасть.
// ---------------------------------------------------------------------------

interface FakeQuery {
  matches: boolean;
  listeners: Set<() => void>;
}

const queries = new Map<string, FakeQuery>();

/**
 * Запросы, которые хук действительно запросил.
 *
 * Отдельно от `queries`: там лежат и заранее заданные результаты, поэтому
 * проверять по ней «какой запрос сделан» нельзя — она истинна для всего, что
 * подготовил тест. На этом первая версия теста и ошиблась.
 */
const requested = new Set<string>();

/** Подменяет `matchMedia`, запоминая запросы и позволяя менять их результат. */
function installMatchMedia(initial: Record<string, boolean>): void {
  queries.clear();
  requested.clear();

  for (const [query, matches] of Object.entries(initial)) {
    queries.set(query, { matches, listeners: new Set() });
  }

  vi.stubGlobal("matchMedia", (query: string) => {
    requested.add(query);

    let entry = queries.get(query);

    if (entry === undefined) {
      entry = { matches: false, listeners: new Set() };
      queries.set(query, entry);
    }

    const current = entry;

    return {
      get matches() {
        return current.matches;
      },
      media: query,
      addEventListener: (_event: string, listener: () => void) => {
        current.listeners.add(listener);
      },
      removeEventListener: (_event: string, listener: () => void) => {
        current.listeners.delete(listener);
      },
    };
  });
}

/** Меняет результат запроса и уведомляет подписчиков, как настоящий браузер. */
function setMatches(query: string, matches: boolean): void {
  const entry = queries.get(query);
  if (entry === undefined) throw new Error(`Запрос не был запрошен хуком: ${query}`);

  entry.matches = matches;
  act(() => {
    for (const listener of entry.listeners) listener();
  });
}

const MOBILE_QUERY = "(max-width: 767px)";
const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";

beforeEach(() => {
  installMatchMedia({ [MOBILE_QUERY]: false, [TOUCH_QUERY]: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  queries.clear();
  requested.clear();
});

describe("MOBILE_VIEWPORT", () => {
  it("равен 768 — границе Tailwind `md:`", () => {
    // Константа, а не CSS-переменная: переменные не работают внутри медиазапросов,
    // это ограничение самого CSS, а не сборки.
    expect(MOBILE_VIEWPORT).toBe(768);
  });
});

describe("useIsMobile", () => {
  it("спрашивает `max-width: 767px`, а не 768px", () => {
    renderHook(() => useIsMobile());

    // Ключевая проверка файла: на 768px должна работать десктопная раскладка
    // (`md:` включился), поэтому хук обязан быть ложным ровно с этой ширины.
    expect(requested.has(MOBILE_QUERY)).toBe(true);
    expect(requested.has("(max-width: 768px)")).toBe(false);
  });

  it("возвращает true, когда запрос совпал", () => {
    installMatchMedia({ [MOBILE_QUERY]: true });

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(true);
  });

  it("реагирует на поворот экрана без перемонтирования", () => {
    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);

    setMatches(MOBILE_QUERY, true);

    // Подписка нужна именно для поворота устройства и изменения размера окна:
    // без неё режим застыл бы на значении первого рендера.
    expect(result.current).toBe(true);

    setMatches(MOBILE_QUERY, false);
    expect(result.current).toBe(false);
  });

  it("снимает подписку при размонтировании", () => {
    const { unmount } = renderHook(() => useIsMobile());

    expect(queries.get(MOBILE_QUERY)?.listeners.size).toBe(1);

    unmount();

    // Утечка слушателей на `matchMedia` незаметна в разработке и накапливается
    // при навигации между страницами.
    expect(queries.get(MOBILE_QUERY)?.listeners.size).toBe(0);
  });

  it("не падает без matchMedia и отвечает false", () => {
    // Так выглядит серверный рендер: объекта `window` нет вовсе. Хук обязан
    // вернуть десктопное значение, а не бросить исключение.
    vi.stubGlobal("matchMedia", undefined);

    const { result } = renderHook(() => useIsMobile());

    expect(result.current).toBe(false);
  });
});

describe("useIsTouchDevice", () => {
  it("спрашивает про способ ввода, а не про ширину", () => {
    renderHook(() => useIsTouchDevice());

    // Ширина окна говорит о месте под раскладку, а не о способе ввода: узкое
    // окно на десктопе всё ещё поддерживает hover.
    expect(requested.has(TOUCH_QUERY)).toBe(true);
    expect(requested.has(MOBILE_QUERY)).toBe(false);
  });

  it("не связан с useIsMobile", () => {
    installMatchMedia({ [MOBILE_QUERY]: false, [TOUCH_QUERY]: true });

    const touch = renderHook(() => useIsTouchDevice());
    const mobile = renderHook(() => useIsMobile());

    // Планшет в ландшафте: широкий экран и при этом касания. Один хук не должен
    // подменять другой — на этом строится решение, что ветвить по ширине, а что
    // по способу ввода.
    expect(touch.result.current).toBe(true);
    expect(mobile.result.current).toBe(false);
  });
});
