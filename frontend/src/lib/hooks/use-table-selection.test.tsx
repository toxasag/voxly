import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useTableSelection } from "@/lib/hooks/use-table-selection";

describe("useTableSelection", () => {
  const page1 = ["id-1", "id-2", "id-3"];
  const page2 = ["id-4", "id-5"];

  it("сохраняет выделение строк при переходе между страницами", () => {
    const { result } = renderHook(() =>
      useTableSelection({ filterKey: "all", totalCount: 5 }),
    );

    act(() => {
      result.current.toggleRow("id-1");
    });
    expect(result.current.getPageSelectedIds(page1)).toEqual(new Set(["id-1"]));
    expect(result.current.effectiveSelectedCount).toBe(1);

    // Переходим на страницу 2 и выбираем ещё одну строку
    act(() => {
      result.current.toggleRow("id-4");
    });
    expect(result.current.getPageSelectedIds(page2)).toEqual(new Set(["id-4"]));
    expect(result.current.effectiveSelectedCount).toBe(2);
    expect(result.current.buildBulkPayload({ search: "abc" })).toEqual({
      mode: "ids",
      ids: ["id-1", "id-4"],
    });
  });

  it("поддерживает «Выбрать все N» и исключения на разных страницах", () => {
    const { result } = renderHook(() =>
      useTableSelection({ filterKey: "filtered", totalCount: 50 }),
    );

    act(() => {
      result.current.togglePage(page1);
    });
    expect(result.current.isPageAllSelected(page1)).toBe(true);

    // Активируем выбор всех записей выборки
    act(() => {
      result.current.selectAllAcrossPages();
    });
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.effectiveSelectedCount).toBe(50);
    expect(result.current.getPageSelectedIds(page1)).toEqual(new Set(page1));
    expect(result.current.getPageSelectedIds(page2)).toEqual(new Set(page2));

    // Снимаем по одной строке на первой и второй страницах
    act(() => {
      result.current.toggleRow("id-2");
      result.current.toggleRow("id-5");
    });
    expect(result.current.excludedCount).toBe(2);
    expect(result.current.effectiveSelectedCount).toBe(48);
    expect(result.current.isPageAllSelected(page1)).toBe(false);
    expect(result.current.isPagePartiallySelected(page1)).toBe(true);

    expect(result.current.buildBulkPayload({ category: "АКБ" })).toEqual({
      mode: "all",
      filters: { category: "АКБ" },
      excluded_ids: ["id-2", "id-5"],
    });
  });

  it("сбрасывает выбор при изменении filterKey", () => {
    const { result, rerender } = renderHook(
      ({ filterKey, totalCount }: { filterKey: string; totalCount: number }) =>
        useTableSelection({ filterKey, totalCount }),
      { initialProps: { filterKey: "q=iphone", totalCount: 100 } },
    );

    act(() => {
      result.current.selectAllAcrossPages();
      result.current.toggleRow("id-1");
    });
    expect(result.current.isAllSelected).toBe(true);
    expect(result.current.effectiveSelectedCount).toBe(99);

    rerender({ filterKey: "q=samsung", totalCount: 20 });
    expect(result.current.isAllSelected).toBe(false);
    expect(result.current.excludedCount).toBe(0);
    expect(result.current.effectiveSelectedCount).toBe(0);
  });
});
