"use client";

import { useState, useCallback, useRef, useEffect, useMemo, type KeyboardEvent } from "react";
import { Wrench, Plus, Minus, Trash2, User, BookOpen, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import type { WorkItem } from "@/lib/repairs/repairs.types";
import { useTeamMembers } from "@/lib/api/use-team";
import {
  useRepairServicesCatalog,
  useAddRepairServiceToCatalog,
  useCreateWork,
  useCreateWorksBatch,
  useDeleteWork,
  useRepairMasters,
  type CreateWorkPayload,
  type RepairMasterDTO,
  type RepairServiceCatalogItemDTO,
} from "@/lib/api/use-repairs";
import { ServiceCatalogDialog } from "./ServiceCatalogDialog";
import { cn, matchesSearchTokens } from "@/lib/utils";
import { useClickOutside } from "@/lib/hooks/use-click-outside";

interface WorkItemsTableProps {
  orderId?: string;
  items: WorkItem[];
  onChange?: (items: WorkItem[]) => void;
  onDraftStateChange?: (draftLabel: string | null) => void;
}

interface SelectedServiceDraft {
  serviceId: string;
  name: string;
  quantity: string;
  unitPrice: string;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function parsePositiveNumber(value: string): number {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed > 0 ? parsed : 0;
}

function parseNonNegativeNumber(value: string): number {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
}

export function WorkItemsTable({ orderId, items, onChange, onDraftStateChange }: WorkItemsTableProps) {
  const [newDesc, setNewDesc] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newUnitPrice, setNewUnitPrice] = useState("");
  const [newCost, setNewCost] = useState("");
  const [selectedServices, setSelectedServices] = useState<SelectedServiceDraft[]>([]);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [isCatalogDialogOpen, setIsCatalogDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const hasUnsavedWorkDraft = Boolean(
    selectedServices.length > 0 || newDesc.trim() || newUnitPrice.trim() || newCost.trim(),
  );

  useEffect(() => {
    if (!onDraftStateChange) return;
    if (selectedServices.length > 0) {
      onDraftStateChange(`выбрано услуг: ${selectedServices.length}`);
    } else if (hasUnsavedWorkDraft) {
      onDraftStateChange(newDesc.trim() || "Новая работа");
    } else {
      onDraftStateChange(null);
    }
  }, [hasUnsavedWorkDraft, selectedServices.length, newDesc, onDraftStateChange]);

  useEffect(() => {
    return () => {
      onDraftStateChange?.(null);
    };
  }, [onDraftStateChange]);

  const comboboxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: mastersData } = useRepairMasters();
  const { data: teamData } = useTeamMembers();
  const masters: RepairMasterDTO[] = useMemo(() => {
    if (mastersData && mastersData.length > 0) return mastersData;
    return (teamData?.members ?? [])
      .filter((m) => m.status === "active" && m.role !== "viewer")
      .map((m) => ({
        id: m.id,
        fullName: m.fullName,
        email: m.email,
        phone: m.phone,
        role: m.role,
      }));
  }, [mastersData, teamData]);

  const { data: servicesCatalog = [], isLoading: isCatalogLoading } = useRepairServicesCatalog();
  const addServiceMutation = useAddRepairServiceToCatalog();
  const createWorkMutation = useCreateWork();
  const createWorksBatchMutation = useCreateWorksBatch();
  const deleteWorkMutation = useDeleteWork();

  // Автовыбор первого мастера, если не выбран
  useEffect(() => {
    if (!newMaster && masters.length > 0) {
      setNewMaster(masters[0].id);
    }
  }, [masters, newMaster]);

  // Закрытие выпадающего списка при клике вне компонента или по Escape
  useClickOutside(comboboxRef, () => setCatalogOpen(false), catalogOpen);

  const totalWork = items.reduce((sum, item) => sum + item.cost, 0);

  // Фильтрация каталога по введенному описанию (многословный поиск)
  const filteredCatalog = useMemo(
    () =>
      servicesCatalog.filter((svc) =>
        matchesSearchTokens(newDesc, [svc.name, svc.description]),
      ),
    [servicesCatalog, newDesc],
  );

  const exactMatchExists = servicesCatalog.some(
    (svc) => svc.name.trim().toLowerCase() === newDesc.trim().toLowerCase(),
  );

  const selectedServiceMap = useMemo(() => {
    const map = new Map<string, SelectedServiceDraft>();
    for (const draft of selectedServices) {
      map.set(draft.serviceId, draft);
    }
    return map;
  }, [selectedServices]);

  const allFilteredSelected =
    filteredCatalog.length > 0 && filteredCatalog.every((svc) => selectedServiceMap.has(svc.id));

  const selectedTotalSum = useMemo(
    () =>
      selectedServices.reduce((sum, draft) => {
        const qty = parsePositiveNumber(draft.quantity);
        const unitPrice = parseNonNegativeNumber(draft.unitPrice);
        return sum + Math.round(qty * unitPrice * 100) / 100;
      }, 0),
    [selectedServices],
  );

  const hasInvalidSelectedDraft = useMemo(
    () =>
      selectedServices.some((draft) => {
        const q = parseFloat(draft.quantity);
        const p = draft.unitPrice.trim() === "" ? 0 : parseFloat(draft.unitPrice);
        return isNaN(q) || q <= 0 || isNaN(p) || p < 0;
      }),
    [selectedServices],
  );

  const handleToggleCatalogService = useCallback((svc: RepairServiceCatalogItemDTO) => {
    setSelectedServices((prev) => {
      const exists = prev.some((item) => item.serviceId === svc.id);
      if (exists) {
        return prev.filter((item) => item.serviceId !== svc.id);
      }
      return [
        ...prev,
        {
          serviceId: svc.id,
          name: svc.name,
          quantity: "1",
          unitPrice: String(svc.defaultPrice ?? 0),
        },
      ];
    });
  }, []);

  const handleToggleAllFiltered = useCallback(() => {
    setSelectedServices((prev) => {
      if (allFilteredSelected) {
        const filteredIds = new Set(filteredCatalog.map((svc) => svc.id));
        return prev.filter((item) => !filteredIds.has(item.serviceId));
      }
      const existingIds = new Set(prev.map((item) => item.serviceId));
      const toAppend: SelectedServiceDraft[] = [];
      for (const svc of filteredCatalog) {
        if (!existingIds.has(svc.id)) {
          toAppend.push({
            serviceId: svc.id,
            name: svc.name,
            quantity: "1",
            unitPrice: String(svc.defaultPrice ?? 0),
          });
        }
      }
      return [...prev, ...toAppend];
    });
  }, [allFilteredSelected, filteredCatalog]);

  const handleUpdateSelectedDraft = useCallback(
    (serviceId: string, patch: Partial<Pick<SelectedServiceDraft, "quantity" | "unitPrice">>) => {
      setSelectedServices((prev) =>
        prev.map((item) => (item.serviceId === serviceId ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  const handleStepSelectedQty = useCallback((serviceId: string, delta: number) => {
    setSelectedServices((prev) =>
      prev.map((item) => {
        if (item.serviceId !== serviceId) return item;
        const current = parsePositiveNumber(item.quantity) || 1;
        const next = Math.max(1, Math.round((current + delta) * 100) / 100);
        return { ...item, quantity: String(next) };
      }),
    );
  }, []);

  const handleRemoveSelectedService = useCallback((serviceId: string) => {
    setSelectedServices((prev) => prev.filter((item) => item.serviceId !== serviceId));
  }, []);

  const handleClearSelectedServices = useCallback(() => {
    setSelectedServices([]);
  }, []);

  const handleQtyChange = (val: string) => {
    setNewQty(val);
    const q = parseFloat(val);
    const u = parseFloat(newUnitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(u) && u >= 0) {
      setNewCost(String(Math.round(q * u * 100) / 100));
    }
  };

  const handleUnitPriceChange = (val: string) => {
    setNewUnitPrice(val);
    const u = parseFloat(val);
    const q = parseFloat(newQty) || 1;
    if (!isNaN(u) && u >= 0 && !isNaN(q) && q > 0) {
      setNewCost(String(Math.round(q * u * 100) / 100));
    }
  };

  const handleCostChange = (val: string) => {
    setNewCost(val);
    const c = parseFloat(val);
    const q = parseFloat(newQty) || 1;
    if (!isNaN(c) && c >= 0 && !isNaN(q) && q > 0) {
      setNewUnitPrice(String(Math.round((c / q) * 100) / 100));
    }
  };

  const handleCreateCatalogItem = async () => {
    const trimmed = newDesc.trim();
    if (!trimmed) return;
    const priceNum = parseFloat(newUnitPrice) || parseFloat(newCost);
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
    const qtyNum = parseFloat(newQty) || 1;
    const costNum = parseFloat(newCost);
    const unitPriceNum = parseFloat(newUnitPrice) || (costNum / qtyNum);

    if (!desc || !newMaster || isNaN(costNum) || costNum < 0 || qtyNum <= 0) return;

    const master = masters.find((m) => m.id === newMaster);
    const masterName = master?.fullName ?? "Не назначен";

    const normalizedDesc = desc.toLowerCase().replace(/\s+/g, " ");
    const existingItem = items.find((it) => {
      const existingQty = it.quantity != null && it.quantity > 0 ? it.quantity : 1;
      const existingUnit = it.unit_price != null ? it.unit_price : it.cost / existingQty;
      return (
        it.description.trim().toLowerCase().replace(/\s+/g, " ") === normalizedDesc &&
        Math.abs(existingUnit - unitPriceNum) < 0.01
      );
    });

    if (orderId) {
      try {
        const result = await createWorkMutation.mutateAsync({
          orderId,
          payload: {
            description: desc,
            master_id: newMaster,
            master_name: masterName,
            quantity: qtyNum,
            unit_price: unitPriceNum,
            cost: costNum,
          },
        });
        if (existingItem) {
          toast.success(`Количество «${desc}» увеличено до ${result.quantity ?? (existingItem.quantity ?? 1) + qtyNum}`);
        } else {
          toast.success(`Работа «${desc}» добавлена`);
        }
        setNewDesc("");
        setNewQty("1");
        setNewUnitPrice("");
        setNewCost("");
        setCatalogOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить работу");
      }
    } else {
      if (existingItem) {
        const nextItems = items.map((it) => {
          if (it.id !== existingItem.id) return it;
          const prevQty = it.quantity != null && it.quantity > 0 ? it.quantity : 1;
          const nextQty = Math.round((prevQty + qtyNum) * 1000) / 1000;
          const unit = it.unit_price != null ? it.unit_price : unitPriceNum;
          return {
            ...it,
            quantity: nextQty,
            unit_price: unit,
            cost: Math.round(nextQty * unit * 100) / 100,
          };
        });
        onChange?.(nextItems);
      } else {
        const newItem: WorkItem = {
          id: `wi${Date.now()}`,
          description: desc,
          master_name: master?.fullName ?? "Не назначен",
          master_id: newMaster,
          quantity: qtyNum,
          unit_price: unitPriceNum,
          cost: costNum,
        };
        onChange?.([...items, newItem]);
      }
      setNewDesc("");
      setNewQty("1");
      setNewUnitPrice("");
      setNewCost("");
      setCatalogOpen(false);
    }
  }, [newDesc, newMaster, newQty, newUnitPrice, newCost, masters, orderId, createWorkMutation, items, onChange]);

  const submitServicesBatch = useCallback(
    async (
      drafts: Array<{ name: string; quantity: number; unitPrice: number }>,
    ): Promise<boolean> => {
      if (drafts.length === 0) return false;
      if (!newMaster) {
        toast.error("Выберите мастера для добавления услуг");
        return false;
      }

      const master = masters.find((m) => m.id === newMaster);
      const masterName = master?.fullName ?? "Не назначен";

      const payloads: CreateWorkPayload[] = drafts.map((d) => {
        const qty = d.quantity > 0 ? d.quantity : 1;
        const unitPrice = d.unitPrice >= 0 ? d.unitPrice : 0;
        const cost = Math.round(qty * unitPrice * 100) / 100;
        return {
          description: d.name.trim(),
          master_id: newMaster,
          master_name: masterName,
          quantity: qty,
          unit_price: unitPrice,
          cost,
        };
      });

      if (orderId) {
        try {
          const result = await createWorksBatchMutation.mutateAsync({
            orderId,
            payload: { items: payloads },
          });
          if (result.addedCount > 0 && result.mergedCount > 0) {
            toast.success(
              `Добавлено услуг: ${result.addedCount}, обновлено количество у ${result.mergedCount}`,
            );
          } else if (result.mergedCount > 0 && result.addedCount === 0) {
            toast.success(`Обновлено количество для ${result.mergedCount} услуг`);
          } else {
            toast.success(`Добавлено услуг: ${payloads.length}`);
          }
          return true;
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Не удалось добавить выбранные услуги");
          return false;
        }
      }

      // Локальный контролируемый режим (без orderId)
      const nextItems = [...items];
      for (const payload of payloads) {
        const normalizedDesc = payload.description.trim().toLowerCase().replace(/\s+/g, " ");
        const qtyNum = payload.quantity ?? 1;
        const unitPriceNum = payload.unit_price ?? 0;
        const costNum = payload.cost ?? Math.round(qtyNum * unitPriceNum * 100) / 100;

        const existingIdx = nextItems.findIndex((it) => {
          const existingQty = it.quantity != null && it.quantity > 0 ? it.quantity : 1;
          const existingUnit = it.unit_price != null ? it.unit_price : it.cost / existingQty;
          return (
            it.description.trim().toLowerCase().replace(/\s+/g, " ") === normalizedDesc &&
            Math.abs(existingUnit - unitPriceNum) < 0.01
          );
        });

        if (existingIdx >= 0) {
          const prevItem = nextItems[existingIdx];
          const prevQty = prevItem.quantity != null && prevItem.quantity > 0 ? prevItem.quantity : 1;
          const nextQty = Math.round((prevQty + qtyNum) * 1000) / 1000;
          const unit = prevItem.unit_price != null ? prevItem.unit_price : unitPriceNum;
          nextItems[existingIdx] = {
            ...prevItem,
            quantity: nextQty,
            unit_price: unit,
            cost: Math.round(nextQty * unit * 100) / 100,
          };
        } else {
          nextItems.push({
            id: `wi${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            description: payload.description,
            master_name: masterName,
            master_id: newMaster,
            quantity: qtyNum,
            unit_price: unitPriceNum,
            cost: costNum,
          });
        }
      }
      onChange?.(nextItems);
      toast.success(`Добавлено услуг: ${payloads.length}`);
      return true;
    },
    [newMaster, masters, orderId, createWorksBatchMutation, items, onChange],
  );

  const handleAddSelectedServices = useCallback(async () => {
    if (selectedServices.length === 0 || hasInvalidSelectedDraft) return;
    const drafts = selectedServices.map((s) => ({
      name: s.name,
      quantity: parsePositiveNumber(s.quantity),
      unitPrice: parseNonNegativeNumber(s.unitPrice),
    }));
    const ok = await submitServicesBatch(drafts);
    if (ok) {
      setSelectedServices([]);
      setNewDesc("");
      setNewQty("1");
      setNewUnitPrice("");
      setNewCost("");
      setCatalogOpen(false);
    }
  }, [selectedServices, hasInvalidSelectedDraft, submitServicesBatch]);

  const handleAddServicesFromDialog = useCallback(
    async (catalogItems: RepairServiceCatalogItemDTO[]) => {
      if (catalogItems.length === 0) return;
      if (!newMaster) {
        setSelectedServices((prev) => {
          const existingIds = new Set(prev.map((s) => s.serviceId));
          const toAdd: SelectedServiceDraft[] = [];
          for (const svc of catalogItems) {
            if (!existingIds.has(svc.id)) {
              toAdd.push({
                serviceId: svc.id,
                name: svc.name,
                quantity: "1",
                unitPrice: String(svc.defaultPrice ?? 0),
              });
            }
          }
          return [...prev, ...toAdd];
        });
        toast.info("Выберите мастера и нажмите «Добавить выбранные»");
        setIsCatalogDialogOpen(false);
        return;
      }

      const ok = await submitServicesBatch(
        catalogItems.map((svc) => ({
          name: svc.name,
          quantity: 1,
          unitPrice: svc.defaultPrice ?? 0,
        })),
      );
      if (ok) {
        setIsCatalogDialogOpen(false);
      }
    },
    [newMaster, submitServicesBatch],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedServices.length > 0) {
          void handleAddSelectedServices();
        } else {
          void handleAdd();
        }
      } else if (e.key === "Escape") {
        setCatalogOpen(false);
      }
    },
    [selectedServices.length, handleAddSelectedServices, handleAdd],
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

  const isAdding = createWorkMutation.isPending || createWorksBatchMutation.isPending;
  const canAddSelected =
    !isAdding &&
    selectedServices.length > 0 &&
    newMaster.length > 0 &&
    !hasInvalidSelectedDraft;
  const canAdd =
    !isAdding &&
    newDesc.trim().length > 0 &&
    newMaster.length > 0 &&
    newCost.trim().length > 0 &&
    !isNaN(parseFloat(newCost)) &&
    parseFloat(newCost) >= 0 &&
    !isNaN(parseFloat(newQty)) &&
    parseFloat(newQty) > 0;

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
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[140px]">
                Мастер
              </th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[75px]">
                Кол-во
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                Цена/ед.
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                Стоимость
              </th>
              <th className="px-4 py-2.5 w-[44px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {items.map((item) => {
              const qty = item.quantity != null && item.quantity > 0 ? item.quantity : 1;
              const unitPrice = item.unit_price != null ? item.unit_price : (item.cost / qty);

              return (
                <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                  <td className="px-4 py-3">
                    <p className="text-[13px] text-[#111111]">{item.description}</p>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3 w-3 text-[#888888]" />
                      <span className="text-xs text-[#666666] truncate max-w-[120px]">{item.master_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] font-mono text-[#111111]">{qty}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-xs text-[#666666] font-mono">
                      {formatCost(unitPrice)}
                    </span>
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
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <p className="text-sm text-[#888888]">Работы пока не добавлены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Row with Multi-Select Combobox */}
      <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 space-y-2.5">
        {/* Selected Services Staging Panel */}
        {selectedServices.length > 0 && (
          <div className="rounded-[8px] border border-[#4a38f5]/25 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f0f0] bg-[#4a38f5]/[0.04] px-3 py-2">
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-[#111111]">
                  Выбрано услуг: {selectedServices.length}
                </span>
                <span className="text-[#cccccc]">·</span>
                <span className="font-mono font-semibold text-[#4a38f5] tabular-nums">
                  {formatCost(selectedTotalSum)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClearSelectedServices}
                  disabled={isAdding}
                  className="text-xs text-[#666666] hover:text-[#111111] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Очистить
                </button>
                <button
                  type="button"
                  onClick={() => void handleAddSelectedServices()}
                  disabled={!canAddSelected}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1 text-xs font-medium transition-colors",
                    canAddSelected
                      ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer shadow-2xs"
                      : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                  )}
                >
                  {createWorksBatchMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  Добавить выбранные ({selectedServices.length})
                </button>
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto divide-y divide-[#f0f0f0]">
              {selectedServices.map((draft) => {
                const qtyNum = parsePositiveNumber(draft.quantity);
                const priceNum = parseNonNegativeNumber(draft.unitPrice);
                const lineTotal = Math.round(qtyNum * priceNum * 100) / 100;
                return (
                  <div
                    key={draft.serviceId}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#fafafa]"
                  >
                    <span className="flex-1 min-w-0 font-medium text-[#111111] truncate">
                      {draft.name}
                    </span>
                    <input
                      type="number"
                      min={0.01}
                      step={1}
                      value={draft.quantity}
                      onChange={(e) =>
                        handleUpdateSelectedDraft(draft.serviceId, { quantity: e.target.value })
                      }
                      aria-label={`Количество: ${draft.name}`}
                      title="Количество"
                      className="w-[56px] rounded-[6px] border border-[#e5e5e5] bg-white py-1 px-1.5 text-xs text-center font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="text-[#888888]">×</span>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={draft.unitPrice}
                      onChange={(e) =>
                        handleUpdateSelectedDraft(draft.serviceId, { unitPrice: e.target.value })
                      }
                      aria-label={`Цена: ${draft.name}`}
                      title="Цена за единицу"
                      className="w-[82px] rounded-[6px] border border-[#e5e5e5] bg-white py-1 px-2 text-xs text-right font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    />
                    <span className="w-[78px] text-right font-mono font-semibold text-[#111111] tabular-nums shrink-0">
                      {formatCost(lineTotal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveSelectedService(draft.serviceId)}
                      aria-label={`Убрать услугу ${draft.name}`}
                      title="Убрать из выбранных"
                      className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
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
                placeholder={
                  selectedServices.length > 0
                    ? "Поиск и выбор ещё услуг из каталога..."
                    : "Выберите из каталога или введите работу..."
                }
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

            {/* Catalog Multi-Select Popover */}
            {catalogOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-80 flex-col overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg">
                {/* Popover Header */}
                <div className="flex items-center justify-between gap-2 border-b border-[#f0f0f0] px-2.5 py-1.5 bg-[#fafafa]">
                  <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                    Каталог типовых услуг
                  </span>
                  <div className="flex items-center gap-2.5">
                    {!isCatalogLoading && filteredCatalog.length > 0 && (
                      <button
                        type="button"
                        onClick={handleToggleAllFiltered}
                        className="text-[11px] font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                      >
                        {allFilteredSelected ? "Снять все" : "Выбрать все"}
                      </button>
                    )}
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
                </div>

                {/* Scrollable Catalog Items */}
                <div className="flex-1 overflow-y-auto p-1">
                  {isCatalogLoading && (
                    <div className="flex items-center justify-center py-4 text-xs text-[#888888]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка справочника...
                    </div>
                  )}

                  {!isCatalogLoading && filteredCatalog.length > 0 && (
                    <div className="space-y-0.5">
                      {filteredCatalog.map((svc) => {
                        const selectedDraft = selectedServiceMap.get(svc.id);
                        const isSelected = Boolean(selectedDraft);
                        return (
                          <div
                            key={svc.id}
                            role="option"
                            aria-selected={isSelected}
                            onClick={() => handleToggleCatalogService(svc)}
                            className={cn(
                              "flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors cursor-pointer select-none",
                              isSelected
                                ? "bg-[#4a38f5]/[0.06] hover:bg-[#4a38f5]/[0.10]"
                                : "hover:bg-[#fafafa]",
                            )}
                          >
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                                  isSelected
                                    ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                                    : "border-[#cccccc] bg-white",
                                )}
                              >
                                {isSelected && <Check className="h-3 w-3" />}
                              </span>
                              <div className="min-w-0 flex-1">
                                <span className="block font-medium text-[#111111] truncate">
                                  {svc.name}
                                </span>
                                {svc.description ? (
                                  <span className="block text-[11px] text-[#888888] truncate">
                                    {svc.description}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              {isSelected && selectedDraft && (
                                <div
                                  className="flex items-center rounded-[6px] border border-[#e5e5e5] bg-white"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleStepSelectedQty(svc.id, -1)}
                                    aria-label={`Уменьшить количество: ${svc.name}`}
                                    className="px-1.5 py-0.5 text-[#666666] hover:text-[#111111] hover:bg-[#f5f5f5] rounded-l-[5px] cursor-pointer"
                                  >
                                    <Minus className="h-3 w-3" />
                                  </button>
                                  <span className="min-w-[22px] text-center font-mono text-[11px] font-medium text-[#111111] tabular-nums">
                                    {selectedDraft.quantity}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleStepSelectedQty(svc.id, 1)}
                                    aria-label={`Увеличить количество: ${svc.name}`}
                                    className="px-1.5 py-0.5 text-[#666666] hover:text-[#111111] hover:bg-[#f5f5f5] rounded-r-[5px] cursor-pointer"
                                  >
                                    <Plus className="h-3 w-3" />
                                  </button>
                                </div>
                              )}
                              {svc.defaultPrice > 0 ? (
                                <span className="font-mono text-[11px] font-semibold text-[#4a38f5] tabular-nums">
                                  {formatCost(svc.defaultPrice)}
                                </span>
                              ) : (
                                <span className="font-mono text-[11px] text-[#888888] tabular-nums">
                                  0 ₽
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
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

                {/* Sticky Popover Footer for Bulk Submit */}
                {selectedServices.length > 0 && (
                  <div className="flex items-center justify-between gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-2.5 py-2">
                    <div className="flex items-center gap-2 text-xs text-[#666666] min-w-0">
                      <span className="shrink-0">
                        Выбрано:{" "}
                        <span className="font-mono font-semibold text-[#111111]">
                          {selectedServices.length}
                        </span>
                      </span>
                      <span className="text-[#cccccc]">·</span>
                      <span className="font-mono font-semibold text-[#111111] tabular-nums truncate">
                        {formatCost(selectedTotalSum)}
                      </span>
                      <button
                        type="button"
                        onClick={handleClearSelectedServices}
                        className="text-[11px] text-[#888888] hover:text-[#111111] underline cursor-pointer shrink-0"
                      >
                        Сбросить
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleAddSelectedServices()}
                      disabled={!canAddSelected}
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
                        canAddSelected
                          ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer"
                          : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                      )}
                    >
                      {createWorksBatchMutation.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Plus className="h-3 w-3" />
                      )}
                      Добавить ({selectedServices.length})
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
            className="w-[140px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] text-[#111111] appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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

          {selectedServices.length === 0 ? (
            <>
              {/* Qty input */}
              <input
                type="number"
                min={0.01}
                step={0.1}
                value={newQty}
                onChange={(e) => handleQtyChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Кол-во"
                title="Количество (нормо-часы или шт.)"
                className="w-[65px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-center text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />

              {/* Unit Price input */}
              <input
                type="number"
                min={0}
                step={1}
                value={newUnitPrice}
                onChange={(e) => handleUnitPriceChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Цена/ед."
                title="Цена за единицу"
                className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] text-right focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />

              {/* Cost input */}
              <input
                type="number"
                min={0}
                step={1}
                value={newCost}
                onChange={(e) => handleCostChange(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Итого ₽"
                title="Итоговая сумма"
                className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] font-semibold text-[#111111] placeholder:text-[#888888] text-right focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />

              {/* Add single button */}
              <button
                type="button"
                onClick={handleAdd}
                disabled={!canAdd}
                className={cn(
                  "shrink-0 rounded-[8px] p-2 transition-colors",
                  canAdd
                    ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer"
                    : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                )}
                title="Добавить работу"
              >
                {isAdding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void handleAddSelectedServices()}
              disabled={!canAddSelected}
              className={cn(
                "shrink-0 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] font-medium transition-colors",
                canAddSelected
                  ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer shadow-2xs"
                  : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
              )}
              title="Добавить все выбранные услуги"
            >
              {isAdding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              <span>Добавить ({selectedServices.length})</span>
            </button>
          )}
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
        onSelectServices={handleAddServicesFromDialog}
        isSubmittingMultiple={createWorksBatchMutation.isPending}
      />
    </div>
  );
}
