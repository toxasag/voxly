"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Горизонтальный ресайз: во время движения пишем в DOM, в состояние — на
 * отпускании. Тот же приём, что у колонок RecordTable: иначе каждый кадр
 * перерисовывал бы содержимое панели / колонки канбана.
 */
export function useHorizontalResize(options: {
  value: number;
  min: number;
  max: number;
  onCommit: (next: number) => void;
  /** Для боковой панели справа дельта инвертируется. */
  invert?: boolean;
}): {
  width: number;
  startResize: (event: React.PointerEvent<HTMLElement>) => void;
} {
  const { value, min, max, onCommit, invert = false } = options;
  const [width, setWidth] = useState(value);
  const liveRef = useRef(value);

  useEffect(() => {
    setWidth(value);
    liveRef.current = value;
  }, [value]);

  const startResize = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const startX = event.clientX;
      const startWidth = liveRef.current;
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent): void => {
        const delta = invert ? startX - moveEvent.clientX : moveEvent.clientX - startX;
        const next = Math.min(max, Math.max(min, Math.round(startWidth + delta)));
        liveRef.current = next;
        setWidth(next);
      };

      const onUp = (): void => {
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        onCommit(liveRef.current);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [invert, max, min, onCommit],
  );

  return { width, startResize };
}
