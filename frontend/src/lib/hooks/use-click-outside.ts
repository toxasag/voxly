import { useEffect, type RefObject } from "react";

type TargetRef = RefObject<HTMLElement | null> | HTMLElement | null | undefined;

/**
 * Hook to handle clicks outside the specified element(s) and Escape key presses.
 * Uses pointerdown in capture phase for instant and reliable dismissal even if bubbling is stopped.
 */
export function useClickOutside(
  target: TargetRef | TargetRef[],
  onClose: (event?: MouseEvent | TouchEvent | PointerEvent | KeyboardEvent) => void,
  enabled = true
): void {
  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: PointerEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;

      const targets = Array.isArray(target) ? target : [target];
      const isInside = targets.some((t) => {
        if (!t) return false;
        const el = "current" in t ? t.current : t;
        return el ? el.contains(targetNode) : false;
      });

      if (!isInside) {
        onClose(event);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose(event);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [target, onClose, enabled]);
}
