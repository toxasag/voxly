"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";
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
  const { width: liveWidth, startResize } = useHorizontalResize({
    value: stored.width,
    min: MIN_SIDE_PANEL_WIDTH,
    max: MAX_SIDE_PANEL_WIDTH,
    onCommit: stored.setWidth,
    invert: side === "right",
  });

  if (!open) return null;

  const isRight = side === "right";
  const widthClass = isMaximized ? "w-full md:w-[920px]" : resizable ? undefined : width;
  const widthStyle = isMaximized
    ? { width: "min(100%, 920px)" }
    : resizable
      ? { width: `min(100%, ${liveWidth}px)` }
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
          <button
            type="button"
            aria-label="Изменить ширину панели"
            onPointerDown={startResize}
            className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-[#3b82f6]/40 md:block"
          />
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
}

export function SheetHeader({
  children,
  onClose,
  onDelete,
  isDeleting = false,
  onToggleMaximize,
  isMaximized = false,
}: SheetHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-white">
      <div className="flex-1 min-w-0">{children}</div>
      <div className="flex items-center gap-1 shrink-0 ml-3">
        {onDelete !== undefined && (
          <button type="button" onClick={onDelete} disabled={isDeleting} aria-label="Удалить запись" className="rounded-[6px] p-1.5 text-rose-500 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10z" /></svg>
          </button>
        )}
        {onToggleMaximize !== undefined && (
          <button
            type="button"
            onClick={onToggleMaximize}
            aria-label={isMaximized ? "Свернуть" : "Развернуть на весь экран"}
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {isMaximized ? (
                <>
                  <polyline points="4 14 10 14 10 20" />
                  <polyline points="20 10 14 10 14 4" />
                  <line x1="14" y1="10" x2="21" y2="3" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </>
              )}
            </svg>
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"><X className="h-4 w-4" /></button>
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
