"use client";

import { type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import { useHorizontalResize } from "@/lib/utils/use-horizontal-resize";
import {
  DEFAULT_SIDE_PANEL_WIDTH,
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
}

export function Sheet({
  open,
  onClose,
  children,
  side = "right",
  width = "w-[480px]",
  resizable = false,
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
  const widthClass = resizable ? undefined : width;
  const widthStyle = resizable
    ? { width: `min(100%, ${liveWidth}px)` }
    : undefined;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "absolute inset-y-0 flex h-full flex-col border-l border-slate-800 bg-slate-900 shadow-2xl",
          isRight ? "right-0" : "left-0",
          widthClass,
        )}
        style={widthStyle}
      >
        {resizable && (
          <button
            type="button"
            aria-label="Изменить ширину панели"
            onPointerDown={startResize}
            className="absolute inset-y-0 left-0 z-10 hidden w-1.5 cursor-col-resize hover:bg-amber-500/40 md:block"
          />
        )}
        {children}
      </div>
    </div>
  );
}

interface SheetHeaderProps { children: ReactNode; onClose?: () => void; onDelete?: () => void; isDeleting?: boolean; }

export function SheetHeader({ children, onClose, onDelete, isDeleting = false }: SheetHeaderProps) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
      <div className="flex-1">{children}</div>
      <div className="flex items-center gap-1">
        {onDelete !== undefined && (
          <button type="button" onClick={onDelete} disabled={isDeleting} aria-label="Удалить запись" className="rounded-md p-1.5 text-rose-400 hover:bg-slate-800 hover:text-rose-300 disabled:opacity-50">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2m-1 0v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6h10z" /></svg>
          </button>
        )}
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Закрыть" className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"><X className="h-4 w-4" /></button>
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
  return <div className={cn("flex-1 overflow-y-auto", className)}>{children}</div>;
}
