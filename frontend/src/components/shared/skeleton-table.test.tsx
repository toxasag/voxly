import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SkeletonTable } from "@/components/shared/Skeleton";

// ---------------------------------------------------------------------------
// Скелетон таблицы.
//
// `AGENTS.md` требует, чтобы скелетон повторял форму страницы. До правки
// `SkeletonTable rows={5} columns={6}` рисовал шесть колонок и на телефоне, где в
// таблицу влезает две: шесть полос по 50px не похожи ни на что и обещают
// раскладку, которой после загрузки не будет.
//
// Скрытие классами, а не хуком: это структура, и при SSR хук дал бы вспышку шести
// колонок на телефоне — ровно то, от чего избавляемся.
// ---------------------------------------------------------------------------

function skeletonBars(): HTMLElement[] {
  const root = screen.getByRole("status", { name: "Загрузка данных" });
  return [...root.querySelectorAll<HTMLElement>(".animate-pulse")];
}

describe("SkeletonTable", () => {
  it("рендерит запрошенное число колонок", () => {
    render(<SkeletonTable rows={2} columns={4} />);

    // Заголовок плюс две строки: 4 + 2 × 4 = 12 полос.
    expect(skeletonBars()).toHaveLength(12);
  });

  it("скрывает лишние колонки на мобильном", () => {
    render(<SkeletonTable rows={1} columns={5} />);

    const header = skeletonBars().slice(0, 5);

    // Первые две видны всегда — столько влезает в таблицу на 360px.
    expect(header[0]?.className).not.toContain("hidden");
    expect(header[1]?.className).not.toContain("hidden");

    // Остальные появляются от `md:`.
    expect(header[2]?.className).toContain("hidden md:block");
    expect(header[4]?.className).toContain("hidden md:block");
  });

  it("не скрывает ничего, когда колонок две или меньше", () => {
    render(<SkeletonTable rows={1} columns={2} />);

    for (const bar of skeletonBars()) {
      expect(bar.className).not.toContain("hidden");
    }
  });

  it("держит первую колонку узкой, как в таблице", () => {
    render(<SkeletonTable rows={1} columns={3} />);

    // Первая колонка таблицы — идентификатор, у неё своя ширина; в заголовке
    // ограничения нет, поэтому проверяем строку.
    const rowBars = skeletonBars().slice(3);
    expect(rowBars[0]?.className).toContain("max-w-[180px]");
  });

  it("сообщает о загрузке для программ чтения с экрана", () => {
    render(<SkeletonTable rows={1} columns={2} />);

    // Без роли и подписи скелетон для скринридера — просто набор пустых блоков.
    expect(screen.getByRole("status", { name: "Загрузка данных" })).toBeDefined();
  });
});
