"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { X, Loader2, SquarePen, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import {
  useUpdatePurchaseRequest,
  useDeletePurchaseRequest,
  type AggregatedPurchaseRequestDTO,
  type PurchaseRequestDTO,
} from "@/lib/api/use-warehouse";
import { cn } from "@/lib/utils";

interface EditPurchaseRequestModalProps {
  open: boolean;
  onClose: () => void;
  aggregatedRow: AggregatedPurchaseRequestDTO | null;
  allRequests: PurchaseRequestDTO[];
}

const STATUS_OPTIONS: {
  value: "pending" | "ordered" | "received" | "cancelled";
  label: string;
}[] = [
  { value: "pending", label: "В ожидании" },
  { value: "ordered", label: "Заказано" },
  { value: "received", label: "Поступило" },
  { value: "cancelled", label: "Отменено" },
];

export function EditPurchaseRequestModal({
  open,
  onClose,
  aggregatedRow,
  allRequests,
}: EditPurchaseRequestModalProps) {
  const updateMutation = useUpdatePurchaseRequest();
  const deleteMutation = useDeletePurchaseRequest();

  const matchedRequests = useMemo(() => {
    if (!aggregatedRow) return [];
    const idSet = new Set(aggregatedRow.requestIds);
    return allRequests.filter((r) => idSet.has(r.id));
  }, [aggregatedRow, allRequests]);

  const [activeRequestId, setActiveRequestId] = useState<string>("");
  const [itemName, setItemName] = useState("");
  const [sku, setSku] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("шт");
  const [estimatedPrice, setEstimatedPrice] = useState("0");
  const [status, setStatus] = useState<"pending" | "ordered" | "received" | "cancelled">("pending");
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (!open || !aggregatedRow) return;
    const firstId = matchedRequests[0]?.id ?? aggregatedRow.requestIds[0] ?? "";
    setActiveRequestId(firstId);
  }, [open, aggregatedRow, matchedRequests]);

  const activeRequest = useMemo(() => {
    if (!activeRequestId) return matchedRequests[0] ?? null;
    return matchedRequests.find((r) => r.id === activeRequestId) ?? matchedRequests[0] ?? null;
  }, [activeRequestId, matchedRequests]);

  useEffect(() => {
    if (!open || !aggregatedRow) return;
    if (activeRequest) {
      setItemName(activeRequest.itemName ?? "");
      setSku(activeRequest.sku ?? "");
      setQuantity(String(activeRequest.quantity ?? 1));
      setUnit(activeRequest.unit ?? "шт");
      setEstimatedPrice(String(activeRequest.estimatedPrice ?? 0));
      setStatus(activeRequest.status ?? "pending");
      setComment(activeRequest.comment ?? "");
    } else {
      setItemName(aggregatedRow.itemName ?? "");
      setSku(aggregatedRow.sku ?? "");
      setQuantity(String(aggregatedRow.quantity ?? 1));
      setUnit(aggregatedRow.unit ?? "шт");
      setEstimatedPrice(String(aggregatedRow.estimatedPrice ?? 0));
      setStatus(aggregatedRow.status ?? "pending");
      setComment("");
    }
  }, [open, aggregatedRow, activeRequest]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open || !aggregatedRow) return null;

  const targetId = activeRequest?.id ?? aggregatedRow.requestIds[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetId) return;

    const trimmedName = itemName.trim();
    const parsedQty = parseFloat(quantity);
    const parsedPrice = estimatedPrice.trim() === "" ? 0 : parseFloat(estimatedPrice);

    if (!trimmedName) {
      toast.error("Укажите наименование позиции");
      return;
    }
    if (isNaN(parsedQty) || parsedQty <= 0) {
      toast.error("Количество должно быть больше 0");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      toast.error("Ориентировочная цена не может быть отрицательной");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        id: targetId,
        payload: {
          item_name: trimmedName,
          sku: sku.trim(),
          quantity: parsedQty,
          unit: unit.trim() || "шт",
          estimated_price: parsedPrice,
          status,
          comment: comment.trim(),
        },
      });
      toast.success(`Заявка «${trimmedName}» обновлена`);
      if (matchedRequests.length <= 1) {
        onClose();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить заявку");
    }
  };

  const handleDeleteCurrent = async () => {
    if (!targetId) return;
    const label = activeRequest?.itemName ?? aggregatedRow.itemName;
    if (!confirm(`Удалить заявку на закупку «${label}»?`)) return;

    try {
      await deleteMutation.mutateAsync(targetId);
      toast.success(`Заявка «${label}» удалена`);
      if (matchedRequests.length <= 1) {
        onClose();
      } else {
        const remaining = matchedRequests.filter((r) => r.id !== targetId);
        setActiveRequestId(remaining[0]?.id ?? "");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить заявку");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-4 border-b border-[#e5e5e5]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 border border-[#4a38f5]/20 text-[#4a38f5]">
              <SquarePen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Редактирование заявки</h2>
              <p className="text-xs text-[#666666]">
                {matchedRequests.length > 1
                  ? `В группе ${matchedRequests.length} заявки — выберите нужную`
                  : "Изменение параметров заявки на закупку"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {matchedRequests.length > 1 && (
          <div className="mt-3 flex flex-wrap gap-1.5 pb-3 border-b border-[#f0f0f0]">
            {matchedRequests.map((req, idx) => {
              const isSelected = req.id === activeRequest?.id;
              return (
                <button
                  key={req.id}
                  type="button"
                  onClick={() => setActiveRequestId(req.id)}
                  className={cn(
                    "rounded-[6px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                    isSelected
                      ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                      : "border-[#e5e5e5] bg-[#fafafa] text-[#666666] hover:text-[#111111]",
                  )}
                >
                  {req.repairTicketNumber ? `Наряд ${req.repairTicketNumber}` : `Заявка #${idx + 1}`}{" "}
                  ({req.quantity} {req.unit})
                </button>
              );
            })}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3.5">
          {activeRequest?.repairOrderId && (
            <div className="flex items-center justify-between rounded-[8px] border border-[#e0e0ff] bg-[#f8f8ff] px-3 py-2 text-xs">
              <span className="text-[#666666]">Связанный наряд-заказ:</span>
              <Link
                href={`/repairs/${activeRequest.repairOrderId}`}
                className="inline-flex items-center gap-1 font-mono font-semibold text-[#4a38f5] hover:underline"
              >
                {activeRequest.repairTicketNumber || "Открыть наряд"}
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">
              Наименование <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="Название запчасти или товара"
              className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">Артикул / SKU</label>
              <input
                type="text"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="Б/А"
                className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">Статус</label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "pending" | "ordered" | "received" | "cancelled")
                }
                className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">
                Количество <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">Ед. изм.</label>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="шт"
                className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#111111] mb-1">Ориент. цена ₽</label>
              <input
                type="number"
                step="any"
                min="0"
                value={estimatedPrice}
                onChange={(e) => setEstimatedPrice(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#111111] mb-1">Комментарий</label>
            <textarea
              rows={2}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Комментарий к заявке..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] resize-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-[#f0f0f0]">
            <button
              type="button"
              onClick={handleDeleteCurrent}
              disabled={deleteMutation.isPending || updateMutation.isPending}
              className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-rose-200 bg-rose-50 px-3 text-xs font-medium text-rose-600 hover:bg-rose-100 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {deleteMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Удалить
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-4 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={updateMutation.isPending || deleteMutation.isPending}
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-semibold text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
              >
                {updateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Сохранить
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
