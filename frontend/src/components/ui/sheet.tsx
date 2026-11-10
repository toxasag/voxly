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
  const widthClass = isMaximized
    ? "w-full md:w-[92vw] max-w-[1600px]"
    : resizable
      ? "w-full max-w-[94vw]"
      : width;
  const widthStyle = isMaximized
    ? { width: "min(92vw, 1600px)" }
    : resizable
      ? { width: `min(94vw, ${liveWidth}px)` }
      : undefined;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-[0.5px]" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-y-0 flex h-full flex-col border-l border-[#e5e5e5] bg-white text-[#111111] shadow-2xl transition-[width] duration-150 ease-out",
          isRight ? "right-0" : "left-0",
          widthClass,
        )}
        style={widthStyle}
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
    <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-3.5 bg-white shrink-0">
      <div className="flex-1 min-w-0">{children}</div>
      <div className="flex items-center gap-1 shrink-0 ml-3">
        {onDelete !== undefined && (
          <button type="button" onClick={onDelete} disabled={isDeleting} aria-label="Удалить запись" title="Удалить запись" className="rounded-[6px] p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50 cursor-pointer">
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
              "rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer",
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
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть" className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"><X className="h-4 w-4" /></button>
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
  return <div className={cn("flex-1 overflow-y-auto bg-white", className)}>{children}</div>;
}
