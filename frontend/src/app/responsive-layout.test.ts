/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { globSync } from "tinyglobby";

// ---------------------------------------------------------------------------
// Раскладка страниц вне CRM не должна ломаться на телефоне.
//
// Тест появился после включения `viewport` (`M7.10.1`): до него мобильный браузер
// отдавал вымышленную ширину 980px и масштабировал готовую страницу, поэтому
// безусловный `grid-cols-3` там не был виден. Теперь он виден по-настоящему — три
// KPI-карточки с суммами в рублях делили 360px по ~110px на карточку.
//
// Проверка идёт по исходникам, а не рендером, сознательно: рендер каждой страницы
// потребовал бы моков всех её запросов, а дефект здесь чисто статический —
// адаптивный префикс в классе либо есть, либо нет. Браузерная проверка сделана
// отдельно и однократно (360 / 639 / 640 / 768px), но она не переживает правку
// файла, а этот тест переживает.
//
// CRM исключён намеренно: его раскладкой занимаются отдельные этапы плана, там
// сетки живут внутри компонентов таблицы и канбана.
// ---------------------------------------------------------------------------

const APP_DIR = join(process.cwd(), "src/app");

/** Многоколоночная сетка без единого адаптивного префикса. */
const UNCONDITIONAL_GRID = /className="[^"]*\bgrid-cols-[2-9]\b[^"]*"/g;
const RESPONSIVE_PREFIX = /\b(sm|md|lg|xl|2xl|max-sm|max-md|max-lg):/;

/**
 * Фиксированная ширина от 300px: на 360px экране такая колонка занимает всё.
 *
 * Исключение — элемент внутри контейнера с горизонтальной прокруткой: там
 * `min-w-` задаёт минимальную ширину прокручиваемого содержимого, и это ровно то
 * поведение, которое нужно широкой таблице (`superadmin/page.tsx`). Проверяется
 * наличие `overflow-x-auto` у родителя в тех же строках исходника.
 */
const WIDE_FIXED = /className="[^"]*\b(?:min-)?w-\[(3[0-9]{2}|[4-9][0-9]{2}|[0-9]{4,})px\][^"]*"/g;

function sourceFiles(): string[] {
  return globSync("**/*.tsx", { cwd: APP_DIR, absolute: true })
    // CRM ведут отдельные этапы плана.
    .filter((file) => !file.includes("/crm/"));
}

interface Offence {
  file: string;
  snippet: string;
}

function findOffences(pattern: RegExp): Offence[] {
  const offences: Offence[] = [];

  for (const file of sourceFiles()) {
    const source = readFileSync(file, "utf8");

    for (const match of source.matchAll(pattern)) {
      const className = match[0];
      if (RESPONSIVE_PREFIX.test(className)) continue;

      // Внутри прокручиваемого контейнера фиксированная ширина уместна: она
      // задаёт ширину содержимого, которое пользователь листает, а не ломает
      // раскладку. Смотрим ближайшие 200 символов до совпадения — там находится
      // открывающий тег родителя.
      const contextStart = Math.max(0, (match.index ?? 0) - 200);
      const context = source.slice(contextStart, match.index ?? 0);
      if (context.includes("overflow-x-auto")) continue;

      offences.push({
        file: file.slice(APP_DIR.length + 1),
        snippet: className.slice(0, 120),
      });
    }
  }

  return offences;
}

describe("Адаптивность страниц вне CRM", () => {
  it("не содержит многоколоночных сеток без адаптивного префикса", () => {
    // Было в трёх местах: `finance/page.tsx`, `repairs/page.tsx`,
    // `settings/referral/page.tsx` — везде три KPI-карточки с крупными суммами.
    expect(findOffences(UNCONDITIONAL_GRID)).toEqual([]);
  });

  it("не содержит широких фиксированных колонок без адаптивного префикса", () => {
    // Было в `repairs/[id]/page.tsx`: `w-[320px] min-w-[320px]` не давал колонке
    // сжаться, и контент рядом получал отрицательное место.
    expect(findOffences(WIDE_FIXED)).toEqual([]);
  });

  it("правило действительно ловит нарушение", () => {
    // Проверка самой проверки: без неё тест мог бы проходить из-за неверного
    // регулярного выражения и молча ничего не проверять.
    const sample = '<div className="grid grid-cols-3 gap-4">';
    const guarded = '<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">';

    expect(UNCONDITIONAL_GRID.test(sample)).toBe(true);
    UNCONDITIONAL_GRID.lastIndex = 0;

    const guardedMatch = guarded.match(/className="[^"]*\bgrid-cols-[2-9]\b[^"]*"/);
    expect(guardedMatch).not.toBeNull();
    expect(RESPONSIVE_PREFIX.test(guardedMatch?.[0] ?? "")).toBe(true);
  });
});
