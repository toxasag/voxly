"use client";

import { type ReactNode } from "react";
import { X, Maximize2, Minimize2, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useHorizontalResize } from "@/lib/utils/use-horizontal-resize";
import {
  MAX_SIDE_PANEL_WIDTH,
  MIN_SIDE_PANEL_WIDTH,
  useSidePanelWidth,
} from "@/lib/utils/use-side-panel-width";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  side?: "left" | "right";
  width?: string;
  /** Если задано — ширина в пикселях, ресайз слева у правой панели. */
  resizable?: boolean;
  isMaximized?: boolean;
}

function parseWidthToCss(w?: string): string {
  if (!w) return "480px";
  const match = w.match(/\[([^\]]+)\]/);
  if (match) return match[1];
  return w;
}

export function Sheet({
  open,
  onClose,
  children,
  side = "right",
  width = "w-[480px]",
  resizable = false,
  isMaximized = false,
}: SheetProps) {
  useOverlay(open, { onEscape: onClose });
  const stored = useSidePanelWidth();
  const dynamicMax =
    typeof window !== "undefined"
      ? Math.min(MAX_SIDE_PANEL_WIDTH, Math.max(MIN_SIDE_PANEL_WIDTH, Math.round(window.innerWidth * 0.94)))
      : MAX_SIDE_PANEL_WIDTH;

  const { width: liveWidth, startResize } = useHorizontalResize({
    value: stored.width,
    min: MIN_SIDE_PANEL_WIDTH,
    max: dynamicMax,
    onCommit: stored.setWidth,
    invert: side === "right",
  });

  if (!open) return null;

  const isRight = side === "right";
  const desktopWidth = isMaximized
    ? "min(92vw, 1600px)"
    : resizable
      ? `min(94vw, ${liveWidth}px)`
      : parseWidthToCss(width);

  return (
    <div className="fixed inset-0 z-50">
      {/* Затемняющий бэкдроп активен только на планшетах и десктопах; на мобильных панель полноэкранная */}
      <div
        className="hidden md:block absolute inset-0 bg-black/20 backdrop-blur-[0.5px]"
        onClick={onClose}
      />
      <div
        className={cn(
          // Мобильный вид (< md): строгий полноэкранный режим без зазоров, отступов и скруглений
          "fixed inset-0 z-50 flex h-[100dvh] w-full max-w-none flex-col border-none bg-white text-[#111111] shadow-none",
          // Десктопный вид (>= md): боковая шторка с ресайзом, границей и тенями
          "md:absolute md:inset-y-0 md:h-full md:shadow-2xl md:transition-[width] md:duration-150 md:ease-out",
          isRight
            ? "md:right-0 md:left-auto md:border-l md:border-[#e5e5e5]"
            : "md:left-0 md:right-auto md:border-r md:border-[#e5e5e5]",
          isMaximized
            ? "md:w-[var(--sheet-desktop-width)] md:max-w-[1600px]"
            : "md:w-[var(--sheet-desktop-width)] md:max-w-[94vw]",
        )}
        style={{ "--sheet-desktop-width": desktopWidth } as React.CSSProperties}
      >
        {resizable && !isMaximized && (
          <div
            aria-label="Изменить ширину панели"
            title="Перетащите для изменения ширины панели"
            onPointerDown={startResize}
            className="group/resize absolute inset-y-0 -left-1.5 z-20 hidden w-3 cursor-col-resize items-center justify-center transition-colors md:flex select-none"
          >
            <div className="h-10 w-1 rounded-full bg-[#d1d5db] group-hover/resize:bg-[#4a38f5] group-active/resize:bg-[#4a38f5] transition-colors" />
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

interface SheetHeaderProps {
  children: ReactNode;
  onClose?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  onToggleMaximize?: () => void;
  isMaximized?: boolean;
  onOpenFullPage?: () => void;
}

export function SheetHeader({
  children,
  onClose,
  onDelete,
  isDeleting = false,
  onToggleMaximize,
  isMaximized = false,
  onOpenFullPage,
}: SheetHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 md:px-6 md:py-3.5 bg-white shrink-0">
      <div className="flex-1 min-w-0">{children}</div>
      <div className="flex items-center gap-1 shrink-0 ml-2 md:ml-3">
        {onDelete !== undefined && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label="Удалить запись"
            title="Удалить запись"
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10z" /></svg>
          </button>
        )}
        {onToggleMaximize !== undefined && (
          <button
            type="button"
            onClick={onToggleMaximize}
            aria-label={isMaximized ? "Свернуть в стандартную ширину" : "Развернуть во всю ширину"}
            title={isMaximized ? "Свернуть в стандартную ширину" : "Развернуть во всю ширину"}
            className={cn(
              "hidden md:inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer",
              isMaximized && "bg-[#4a38f5]/10 text-[#4a38f5] hover:bg-[#4a38f5]/20 hover:text-[#4a38f5]",
            )}
          >
            {isMaximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
        {onOpenFullPage !== undefined && (
          <button
            type="button"
            onClick={onOpenFullPage}
            aria-label="Открыть на отдельной странице"
            title="Открыть на отдельной странице"
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

interface SheetContentProps {
  children: ReactNode;
  className?: string;
}

export function SheetContent({ children, className }: SheetContentProps) {
  return <div className={cn("flex-1 overflow-y-auto bg-white min-h-0", className)}>{children}</div>;
}
