"use client";

import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Loader2, Save, AlertTriangle } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { useBulkUpdateInvoices, type BulkUpdateInvoicesPayload } from "@/lib/api/use-invoices";
import type { Invoice } from "@/lib/finance/invoices.types";

interface BulkEditInvoicesModalProps {
  open: boolean;
  invoices: Invoice[];
  selectionMode?: "ids" | "all";
  excludedIds?: string[];
  scopeFilters?: Record<string, unknown>;
  effectiveCount?: number;
  onClose: () => void;
  onSaved?: () => void;
}

const STATUS_OPTIONS: { value: "" | "draft" | "sent" | "overdue" | "cancelled"; label: string }[] = [
  { value: "", label: "Не менять статус" },
  { value: "draft", label: "Черновик" },
  { value: "sent", label: "Отправлен" },
  { value: "overdue", label: "Просрочен" },
  { value: "cancelled", label: "Отменён" },
];

export const BulkEditInvoicesModal = memo(function BulkEditInvoicesModal({
  open,
  invoices,
  selectionMode = "ids",
  excludedIds,
  scopeFilters,
  effectiveCount,
  onClose,
  onSaved,
}: BulkEditInvoicesModalProps) {
  const bulkUpdateMutation = useBulkUpdateInvoices();
  const isAllMode = selectionMode === "all";
  const targetCount = effectiveCount ?? invoices.length;

  const [status, setStatus] = useState<"" | "draft" | "sent" | "overdue" | "cancelled">("");
  const [dueDate, setDueDate] = useState("");
  const [updateNotes, setUpdateNotes] = useState(false);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (open) {
      setStatus("");
      setDueDate("");
      setUpdateNotes(false);
      setNotes("");
    }
  }, [open]);

  const paidCount = invoices.filter((inv) => inv.status === "paid").length;
  const editableCount = isAllMode ? targetCount : invoices.length - paidCount;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (targetCount === 0) return;

    const payload: BulkUpdateInvoicesPayload = isAllMode
      ? {
          mode: "all",
          filters: scopeFilters,
          excluded_ids: excludedIds && excludedIds.length > 0 ? excludedIds : undefined,
        }
      : {
          mode: "ids",
          ids: invoices.map((inv) => inv.id),
        };
    if (status) {
      payload.status = status;
    }
    if (dueDate.trim()) {
      payload.due_date = dueDate.includes("T")
        ? new Date(dueDate).toISOString()
        : new Date(`${dueDate}T12:00:00Z`).toISOString();
    }
    if (updateNotes) {
      payload.notes = notes.trim();
    }

    if (!payload.status && !payload.due_date && payload.notes === undefined) {
      toast.error("Выберите хотя бы одно поле для изменения");
      return;
    }

    try {
      const res = await bulkUpdateMutation.mutateAsync(payload);
      if (res.skippedPaid > 0) {
        toast.success(`Обновлено счетов: ${res.updated} (пропущено оплаченных: ${res.skippedPaid})`);
      } else {
        toast.success(`Обновлено счетов: ${res.updated}`);
      }
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить счета");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]">
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            <Pencil className="h-3.5 w-3.5 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Массовое редактирование счетов
            </h2>
            <p className="text-[11px] text-[#666666]">
              Выбрано счетов: {targetCount}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isAllMode && paidCount > 0 && (
            <div className="flex items-start gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div>
                {editableCount === 0
                  ? "Все выбранные счета уже оплачены — оплаченные счета нельзя редактировать."
                  : `Среди выбранных есть оплаченные счета (${paidCount} шт.) — они будут пропущены, изменения применятся к остальным (${editableCount} шт.).`}
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-medium text-[#111111]">
              Статус счёта
            </label>
            <select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as "" | "draft" | "sent" | "overdue" | "cancelled")
              }
              disabled={editableCount === 0}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] outline-none transition-colors focus:border-[#4a38f5] disabled:bg-[#fafafa] disabled:text-[#888888]"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value || "keep"} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#111111]">
              Срок оплаты (оставьте пустым, чтобы не менять)
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={editableCount === 0}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] outline-none transition-colors focus:border-[#4a38f5] disabled:bg-[#fafafa] disabled:text-[#888888]"
            />
          </div>

          <div className="space-y-2 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3">
            <label className="flex items-center gap-2 text-xs font-medium text-[#111111] cursor-pointer">
              <input
                type="checkbox"
                checked={updateNotes}
                onChange={(e) => setUpdateNotes(e.target.checked)}
                disabled={editableCount === 0}
                className="h-3.5 w-3.5 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
              />
              <span>Обновить примечание ко всем выбранным счетам</span>
            </label>

            {updateNotes && (
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Новый текст примечания (или оставьте пустым, чтобы очистить)"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] outline-none transition-colors focus:border-[#4a38f5]"
              />
            )}
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={bulkUpdateMutation.isPending || editableCount === 0}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {bulkUpdateMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              <span>
                {isAllMode ? `Применить (${targetCount})` : `Применить (${editableCount})`}
              </span>
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
});
