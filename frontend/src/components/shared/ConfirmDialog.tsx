"use client";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[0.5px] p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
          <h2 className="text-sm font-semibold text-[#111111]">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {description && (
          <div className="px-4 py-3">
            <p className="text-xs text-[#666666]">{description}</p>
          </div>
        )}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[#e5e5e5]">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className={cn(
              "h-8 rounded-[8px] px-4 text-xs font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
              variant === "destructive"
                ? "bg-rose-600 hover:bg-rose-500"
                : "bg-[#4a38f5] hover:bg-[#3b2be0]"
            )}
          >
            {isPending ? "Выполняем..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
