"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  isPending?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  variant = "default",
  isPending = false,
}: ConfirmDialogProps) {
  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });


  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && (
          <div className="px-6 py-4">
            <p className="text-sm text-slate-400">{description}</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              "rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              variant === "destructive"
                ? "bg-rose-600 text-white hover:bg-rose-500"
                : "bg-amber-500 text-slate-950 hover:bg-amber-400"
            )}
          >
            {isPending ? "Выполняем..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
