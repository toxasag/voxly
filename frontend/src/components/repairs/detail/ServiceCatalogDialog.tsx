"use client";

import { useState, useMemo, useCallback } from "react";
import { X, Search, Plus, Trash2, BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useRepairServicesCatalog,
  useAddRepairServiceToCatalog,
  useDeleteRepairServiceFromCatalog,
  type RepairServiceCatalogItemDTO,
} from "@/lib/api/use-repairs";

interface ServiceCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectService?: (service: RepairServiceCatalogItemDTO) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ServiceCatalogDialog({
  open,
  onClose,
  onSelectService,
}: ServiceCatalogDialogProps) {
  useOverlay(open, { onEscape: onClose });

  const [searchQuery, setSearchQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const { data: services = [], isLoading } = useRepairServicesCatalog();
  const addMutation = useAddRepairServiceToCatalog();
  const deleteMutation = useDeleteRepairServiceFromCatalog();

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => s.name.toLowerCase().includes(q));
  }, [services, searchQuery]);

  const handleCreate = useCallback(async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.error("Укажите наименование услуги");
      return;
    }

    const priceNum = parseFloat(newPrice);
    const default_price = !isNaN(priceNum) && priceNum >= 0 ? priceNum : undefined;

    try {
      await addMutation.mutateAsync({
        name: trimmed,
        description: newDescription.trim() || undefined,
        default_price,
      });
      toast.success(`Услуга «${trimmed}» добавлена в справочник`);
      setNewName("");
      setNewDescription("");
      setNewPrice("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить услугу");
    }
  }, [newName, newDescription, newPrice, addMutation]);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      setDeletingId(id);
      try {
        await deleteMutation.mutateAsync(id);
        toast.success(`Услуга «${name}» удалена из справочника`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить услугу");
      } finally {
        setDeletingId(null);
      }
    },
    [deleteMutation],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-1.5 shadow-2xs">
              <BookOpen className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">Справочник услуг</h2>
              <p className="text-[11px] text-[#666666]">
                Каталог типовых работ и базовых цен сервисного центра
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Add Service Bar */}
        <div className="border-b border-[#e5e5e5] bg-white p-4">
          <span className="block text-[11px] font-medium uppercase tracking-wider text-[#666666] mb-2">
            Новая услуга в справочнике
          </span>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="text"
                placeholder="Наименование работы или услуги..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleCreate();
                  }
                }}
                className="flex-1 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  placeholder="Цена, ₽"
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleCreate();
                    }
                  }}
                  className="w-28 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-mono tabular-nums text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={addMutation.isPending || !newName.trim()}
                  className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shrink-0"
                >
                  {addMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Добавить
                </button>
              </div>
            </div>
            <input
              type="text"
              placeholder="Описание услуги (необязательно)..."
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
              }}
              className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-[#f0f0f0] bg-[#fafafa]">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              placeholder="Поиск по наименованию услуги..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
        </div>

        {/* List of Services */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#f0f0f0]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-[#888888]">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : filteredServices.length === 0 ? (
            <div className="py-12 text-center">
              <BookOpen className="h-7 w-7 text-[#cccccc] mx-auto mb-2" />
              <p className="text-xs text-[#666666]">
                {searchQuery ? "Ничего не найдено" : "В справочнике пока нет услуг"}
              </p>
            </div>
          ) : (
            filteredServices.map((service) => (
              <div
                key={service.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-[#fafafa] transition-colors group"
              >
                <div
                  className="flex-1 min-w-0 pr-3 cursor-pointer"
                  onClick={() => {
                    if (onSelectService) {
                      onSelectService(service);
                      onClose();
                    }
                  }}
                >
                  <p className="text-[13px] font-medium text-[#111111] truncate">
                    {service.name}
                  </p>
                  {service.description ? (
                    <p className="text-[11px] text-[#888888] line-clamp-1">
                      {service.description}
                    </p>
                  ) : null}
                  <span className="text-[11px] font-mono tabular-nums text-[#666666]">
                    {service.defaultPrice && service.defaultPrice > 0
                      ? formatCost(service.defaultPrice)
                      : "Цена не указана"}
                  </span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {onSelectService && (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectService(service);
                        onClose();
                      }}
                      className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
                    >
                      Выбрать
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handleDelete(service.id, service.name)}
                    disabled={deletingId === service.id}
                    title="Удалить из справочника"
                    className="rounded-[6px] p-1.5 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {deletingId === service.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] px-4 py-2.5 bg-[#fafafa]">
          <span className="text-xs text-[#888888]">
            Всего в справочнике:{" "}
            <span className="font-mono font-medium text-[#111111]">{services.length}</span>
          </span>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
