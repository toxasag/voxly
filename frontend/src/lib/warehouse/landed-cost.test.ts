import { describe, expect, it } from "vitest";
import { previewLandedCostAllocation } from "./landed-cost";

describe("previewLandedCostAllocation", () => {
  it("by_value распределяет пропорционально стоимости и относит остаток копеек на последнюю строку", () => {
    const { allocations, manualUnallocated } = previewLandedCostAllocation(
      [
        { id: "1", quantity: 1, baseUnitPrice: 100 },
        { id: "2", quantity: 1, baseUnitPrice: 100 },
        { id: "3", quantity: 1, baseUnitPrice: 100 },
      ],
      100,
      "by_value",
    );

    expect(manualUnallocated).toBe(0);
    expect(allocations.get("1")?.allocatedExtraCost).toBe(33.33);
    expect(allocations.get("2")?.allocatedExtraCost).toBe(33.33);
    expect(allocations.get("3")?.allocatedExtraCost).toBe(33.34);
    expect(allocations.get("3")?.effectiveUnitPrice).toBe(133.34);
  });

  it("by_quantity распределяет пропорционально количеству", () => {
    const { allocations } = previewLandedCostAllocation(
      [
        { id: "a", quantity: 4, baseUnitPrice: 47 },
        { id: "b", quantity: 0, baseUnitPrice: 999 },
      ],
      200,
      "by_quantity",
    );

    expect(allocations.has("b")).toBe(false);
    expect(allocations.get("a")?.allocatedExtraCost).toBe(200);
    expect(allocations.get("a")?.unitLandedCost).toBe(50);
    expect(allocations.get("a")?.effectiveUnitPrice).toBe(97);
  });

  it("manual корректно считает нераспределённый остаток manualUnallocated", () => {
    const res = previewLandedCostAllocation(
      [
        { id: "x", quantity: 2, baseUnitPrice: 100, manualExtraCost: 120 },
        { id: "y", quantity: 1, baseUnitPrice: 50, manualExtraCost: 30 },
      ],
      200,
      "manual",
    );

    expect(res.manualUnallocated).toBe(50);
    expect(res.allocations.get("x")?.effectiveUnitPrice).toBe(160);
    expect(res.allocations.get("y")?.effectiveUnitPrice).toBe(80);
  });

  it("при нулевых доп. расходах сохраняет базовую цену", () => {
    const { allocations, manualUnallocated } = previewLandedCostAllocation(
      [{ id: "a", quantity: 5, baseUnitPrice: 47 }],
      0,
      "by_value",
    );

    expect(manualUnallocated).toBe(0);
    expect(allocations.get("a")?.effectiveUnitPrice).toBe(47);
    expect(allocations.get("a")?.unitLandedCost).toBe(0);
  });
});
