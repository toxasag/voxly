"use client";

import { useState, useCallback, useRef, useEffect, type KeyboardEvent } from "react";
import { Wrench, Plus, Trash2, User, Search, BookOpen, Loader2, Check } from "lucide-react";
import { toast } from "sonner";
import type { WorkItem } from "@/lib/repairs/repairs.types";
import { useTeamMembers } from "@/lib/api/use-team";
import {
  useRepairServicesCatalog,
  useAddRepairServiceToCatalog,
  useCreateWork,
  useDeleteWork,
} from "@/lib/api/use-repairs";
import { ServiceCatalogDialog } from "./ServiceCatalogDialog";
import { cn } from "@/lib/utils";

interface WorkItemsTableProps {
  orderId?: string;
  items: WorkItem[];
  onChange?: (items: WorkItem[]) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function WorkItemsTable({ orderId, items, onChange }: WorkItemsTableProps) {
  const [newDesc, setNewDesc] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [newCost, setNewCost] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [isCatalogDialogOpen, setIsCatalogDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: teamData } = useTeamMembers();
  const masters = teamData?.members ?? [];

  const { data: servicesCatalog = [], isLoading: isCatalogLoading } = useRepairServicesCatalog();
  const addServiceMutation = useAddRepairServiceToCatalog();
  const createWorkMutation = useCreateWork();
  const deleteWorkMutation = useDeleteWork();

  // Автовыбор первого мастера, если не выбран
  useEffect(() => {
    if (!newMaster && masters.length > 0) {
      setNewMaster(masters[0].id);
    }
  }, [masters, newMaster]);

  // Закрытие выпадающего списка при клике вне компонента
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (comboboxRef.current && !comboboxRef.current.contains(event.target as Node)) {
        setCatalogOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const totalWork = items.reduce((sum, item) => sum + item.cost, 0);

  // Фильтрация каталога по введенному описанию
  const filteredCatalog = servicesCatalog.filter((svc) =>
    svc.name.toLowerCase().includes(newDesc.trim().toLowerCase())
  );

  const exactMatchExists = servicesCatalog.some(
    (svc) => svc.name.trim().toLowerCase() === newDesc.trim().toLowerCase()
  );

  const handleSelectCatalogItem = (name: string, defaultPrice: number) => {
    setNewDesc(name);
    if (defaultPrice > 0) {
      setNewCost(String(defaultPrice));
    }
    setCatalogOpen(false);
  };

  const handleCreateCatalogItem = async () => {
    const trimmed = newDesc.trim();
    if (!trimmed) return;
    const priceNum = parseFloat(newCost);
    const default_price = !isNaN(priceNum) && priceNum >= 0 ? priceNum : undefined;

    try {
      await addServiceMutation.mutateAsync({
        name: trimmed,
        default_price,
      });
      toast.success(`Услуга «${trimmed}» добавлена в справочник`);
      setCatalogOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить услугу в справочник");
    }
  };

  const handleAdd = useCallback(async () => {
    const desc = newDesc.trim();
    const costNum = parseFloat(newCost);
    if (!desc || !newMaster || isNaN(costNum) || costNum < 0) return;

    const master = masters.find((m) => m.id === newMaster);
    const masterName = master?.fullName ?? "Не назначен";

    if (orderId) {
      try {
        await createWorkMutation.mutateAsync({
          orderId,
          payload: {
            description: desc,
            master_id: newMaster,
            master_name: masterName,
            cost: costNum,
          },
        });
        toast.success(`Работа «${desc}» добавлена`);
        setNewDesc("");
        setNewCost("");
        setCatalogOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить работу");
      }
    } else {
      const newItem: WorkItem = {
        id: `wi${Date.now()}`,
        description: desc,
        master_name: master?.fullName ?? "Не назначен",
        master_id: newMaster,
        cost: costNum,
      };

      onChange?.([...items, newItem]);
      setNewDesc("");
      setNewCost("");
      setCatalogOpen(false);
    }
  }, [newDesc, newMaster, newCost, masters, orderId, createWorkMutation, items, onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      } else if (e.key === "Escape") {
        setCatalogOpen(false);
      }
    },
    [handleAdd],
  );

  const handleDelete = useCallback(
    async (id: string, description: string) => {
      if (orderId) {
        setDeletingId(id);
        try {
          await deleteWorkMutation.mutateAsync({
            orderId,
            workId: id,
          });
          toast.success(`Работа «${description}» удалена`);
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Не удалось удалить работу");
        } finally {
          setDeletingId(null);
        }
      } else {
        onChange?.(items.filter((item) => item.id !== id));
      }
    },
    [orderId, deleteWorkMutation, items, onChange],
  );

  const isAdding = createWorkMutation.isPending;
  const canAdd =
    !isAdding &&
    newDesc.trim().length > 0 &&
    newMaster.length > 0 &&
    newCost.trim().length > 0 &&
    !isNaN(parseFloat(newCost)) &&
    parseFloat(newCost) >= 0;

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
        <Wrench className="h-4 w-4 text-[#666666]" />
        <span className="text-sm font-semibold text-[#111111]">Выполненные работы</span>
        <div className="ml-auto flex items-center gap-2.5">
          <span className="text-xs text-[#888888]">{items.length} позиций</span>
          <button
            type="button"
            onClick={() => setIsCatalogDialogOpen(true)}
            className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
          >
            <BookOpen className="h-3.5 w-3.5 text-[#4a38f5]" />
            Справочник услуг
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                Описание
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[160px]">
                Мастер
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                Стоимость
              </th>
              <th className="px-4 py-2.5 w-[48px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {items.map((item) => (
              <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                <td className="px-4 py-3">
                  <p className="text-[13px] text-[#111111]">{item.description}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-[#888888]" />
                    <span className="text-xs text-[#666666]">{item.master_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-[13px] font-semibold text-[#111111] font-mono">
                    {formatCost(item.cost)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id, item.description)}
                    disabled={deletingId === item.id}
                    className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                    title="Удалить работу"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center">
                  <p className="text-sm text-[#888888]">Работы пока не добавлены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Row with Combobox */}
      <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
        <div className="flex items-center gap-3">
          {/* Combobox container */}
          <div ref={comboboxRef} className="relative flex-1">
            <div className="relative">
              <input
                ref={inputRef}
                type="text"
                value={newDesc}
                onChange={(e) => {
                  setNewDesc(e.target.value);
                  setCatalogOpen(true);
                }}
                onFocus={() => setCatalogOpen(true)}
                onKeyDown={handleKeyDown}
                placeholder="Выберите из каталога или введите работу..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-3 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <button
                type="button"
                onClick={() => setIsCatalogDialogOpen(true)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#4a38f5] p-0.5 transition-colors cursor-pointer"
                title="Управление справочником услуг"
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Catalog Popover */}
            {catalogOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                    Каталог типовых услуг
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCatalogOpen(false);
                      setIsCatalogDialogOpen(true);
                    }}
                    className="text-[11px] text-[#4a38f5] hover:underline font-medium cursor-pointer"
                  >
                    Управление
                  </button>
                </div>

                {isCatalogLoading && (
                  <div className="flex items-center justify-center py-4 text-xs text-[#888888]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка справочника...
                  </div>
                )}

                {!isCatalogLoading && filteredCatalog.length > 0 && (
                  <div className="space-y-0.5">
                    {filteredCatalog.map((svc) => (
                      <button
                        key={svc.id}
                        type="button"
                        onClick={() => handleSelectCatalogItem(svc.name, svc.defaultPrice)}
                        className="flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[#fafafa]"
                      >
                        <span className="font-medium text-[#111111]">{svc.name}</span>
                        {svc.defaultPrice > 0 && (
                          <span className="font-mono text-[11px] font-semibold text-[#4a38f5]">
                            {formatCost(svc.defaultPrice)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {!isCatalogLoading && filteredCatalog.length === 0 && (
                  <div className="px-2.5 py-2 text-xs text-[#888888]">
                    {servicesCatalog.length === 0
                      ? "Справочник пока пуст. Вы можете сохранить первую услугу ниже."
                      : "Услуг по запросу не найдено."}
                  </div>
                )}

                {/* Create New in Catalog Option */}
                {newDesc.trim().length > 0 && !exactMatchExists && (
                  <div className="mt-1 border-t border-[#f0f0f0] pt-1">
                    <button
                      type="button"
                      onClick={handleCreateCatalogItem}
                      disabled={addServiceMutation.isPending}
                      className="flex w-full items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-left text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                    >
                      {addServiceMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      <span>
                        Сохранить в справочник «<span className="font-semibold">{newDesc.trim()}</span>»
                        {parseFloat(newCost) > 0 && ` (${formatCost(parseFloat(newCost))})`}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Master select */}
          <select
            value={newMaster}
            onChange={(e) => setNewMaster(e.target.value)}
            className="w-[160px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            <option value="" disabled>
              Мастер...
            </option>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>

          {/* Cost input */}
          <input
            type="number"
            min={0}
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0 ₽"
            className="w-[110px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-[#111111] placeholder:text-[#888888] text-right focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none font-mono"
          />

          {/* Add button */}
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={cn(
              "shrink-0 rounded-[8px] p-2 transition-colors",
              canAdd
                ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]"
                : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
            )}
            title="Добавить работу"
          >
            {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Total */}
      {items.length > 0 && (
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 flex items-center justify-end">
          <span className="text-xs text-[#666666] mr-2">Итого по работам:</span>
          <span className="text-sm font-bold text-[#111111] font-mono">{formatCost(totalWork)}</span>
        </div>
      )}

      {/* Модальное окно управления справочником услуг */}
      <ServiceCatalogDialog
        open={isCatalogDialogOpen}
        onClose={() => setIsCatalogDialogOpen(false)}
        onSelectService={(svc) => {
          setNewDesc(svc.name);
          if (svc.defaultPrice && svc.defaultPrice > 0) {
            setNewCost(String(svc.defaultPrice));
          }
        }}
      />
    </div>
  );
}
