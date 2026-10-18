import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useHorizontalResize } from "@/lib/utils/use-horizontal-resize";

describe("useHorizontalResize", () => {
  it("держит стартовую ширину до движения", () => {
    const onCommit = vi.fn();
    const { result } = renderHook(() =>
      useHorizontalResize({ value: 280, min: 200, max: 480, onCommit }),
    );

    expect(result.current.width).toBe(280);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("подхватывает внешнее значение", () => {
    const onCommit = vi.fn();
    const { result, rerender } = renderHook(
      ({ value }: { value: number }) =>
        useHorizontalResize({ value, min: 200, max: 480, onCommit }),
      { initialProps: { value: 280 } },
    );

    rerender({ value: 320 });
    expect(result.current.width).toBe(320);
  });
});
