import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Ряды фильтров на списках CRM.
//
// Найдено браузерной проверкой на 360px, а не тестами: страницы задач и контактов
// переполнялись по-настоящему (`document.scrollWidth > innerWidth`), потому что
// ряд фильтров не переносился и не прокручивался — четыре кнопки с иконками
// требуют около 370px. Элементы за краем при этом лежали ВНЕ прокручиваемой
// области таблицы, то есть это была поехавшая вёрстка, а не ожидаемый скролл.
//
// Проверка по исходникам, как в `responsive-layout.test.ts`: дефект статический —
// у ряда либо есть способ уместиться на узком экране, либо нет. Геометрию
// считает только браузер, и та проверка не переживает правку файла.
// ---------------------------------------------------------------------------

const FILTER_ROWS = [
  {
    file: "src/app/(dashboard)/crm/tasks/page.tsx",
    anchor: "FILTERS.map",
    label: "быстрые фильтры задач",
  },
  {
    file: "src/app/(dashboard)/crm/contacts/page.tsx",
    anchor: "CHANNEL_FILTERS.map",
    label: "фильтры каналов контактов",
  },
];

/** Класс контейнера ряда: ближайший `className="..."` перед перечислением кнопок. */
function containerClassName(source: string, anchor: string): string {
  const anchorIndex = source.indexOf(anchor);
  expect(anchorIndex).toBeGreaterThan(-1);

  const before = source.slice(0, anchorIndex);
  const matches = [...before.matchAll(/className="([^"]*)"/g)];
  const last = matches[matches.length - 1];

  return last?.[1] ?? "";
}

describe("Ряды фильтров умещаются на 360px", () => {
  for (const row of FILTER_ROWS) {
    it(`${row.label}: ряд прокручивается или переносится`, () => {
      const source = readFileSync(join(process.cwd(), row.file), "utf8");
      const className = containerClassName(source, row.anchor);

      // Любой из двух способов уместиться: горизонтальная прокрутка или перенос.
      // Без них ряд выносит страницу за край экрана.
      const canFit =
        className.includes("overflow-x-auto") || className.includes("flex-wrap");

      expect(canFit, `container classes: ${className}`).toBe(true);
    });

    it(`${row.label}: кнопки не сжимаются в прокрутке`, () => {
      const source = readFileSync(join(process.cwd(), row.file), "utf8");
      const anchorIndex = source.indexOf(row.anchor);
      // Разметка кнопки идёт сразу после перечисления.
      const button = source.slice(anchorIndex, anchorIndex + 1200);

      // В прокручиваемом ряду flex по умолчанию сжимает кнопки: подписи
      // «Просрочено» и «Мои задачи» превращались бы в обрезанные столбики.
      expect(button).toContain("shrink-0");
      expect(button).toContain("whitespace-nowrap");
    });
  }
});
