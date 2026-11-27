"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { X, Search, Plus, Trash2, BookOpen, Loader2, Pencil, Check } from "lucide-react";
import { toast } from "sonner";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useRepairServicesCatalog,
  useAddRepairServiceToCatalog,
  useDeleteRepairServiceFromCatalog,
  type RepairServiceCatalogItemDTO,
} from "@/lib/api/use-repairs";
import {
  useServices,
  useCreateService,
  useDeleteService,
  type ServiceItemDTO,
} from "@/lib/api/use-services";
import { EditServiceModal } from "@/components/services/EditServiceModal";
import { CreateOrEditServiceModal } from "@/components/warehouse/CreateOrEditServiceModal";
import { cn, matchesSearchTokens } from "@/lib/utils";

export interface ServiceCatalogDialogProps {
  open: boolean;
  onClose: () => void;
  onSelectService?: (service: RepairServiceCatalogItemDTO) => void;
  onSelectServices?: (services: RepairServiceCatalogItemDTO[]) => void | Promise<void>;
  isSubmittingMultiple?: boolean;
  /** Источник API справочника: "repairs" (СЦ) или "services" (общий /api/v1/services для сделок CRM). */
  catalogSource?: "repairs" | "services";
  subtitle?: string;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ServiceCatalogDialog(props: ServiceCatalogDialogProps) {
  if (props.catalogSource === "services") {
    return <GlobalServicesCatalogDialog {...props} />;
  }
  return <RepairsServicesCatalogDialog {...props} />;
}

function RepairsServicesCatalogDialog(props: ServiceCatalogDialogProps) {
  const { data: services = [], isLoading } = useRepairServicesCatalog();
  const addMutation = useAddRepairServiceToCatalog();
  const deleteMutation = useDeleteRepairServiceFromCatalog();

  const handleCreateService = useCallback(
    async (payload: { name: string; description?: string; default_price?: number }) => {
      await addMutation.mutateAsync(payload);
    },
    [addMutation],
  );

  const handleDeleteService = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  return (
    <ServiceCatalogDialogView
      {...props}
      services={services}
      isLoading={isLoading}
      isAdding={addMutation.isPending}
      onCreateService={handleCreateService}
      onDeleteService={handleDeleteService}
    />
  );
}

function GlobalServicesCatalogDialog(props: ServiceCatalogDialogProps) {
  const { data: rawServices = [], isLoading } = useServices(undefined, props.open);
  const addMutation = useCreateService();
  const deleteMutation = useDeleteService();

  const services: RepairServiceCatalogItemDTO[] = useMemo(
    () =>
      rawServices.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description ?? "",
        defaultPrice: s.defaultPrice ?? s.price ?? 0,
        unit: s.unit ?? "усл",
        durationMinutes: s.durationMinutes ?? null,
        createdAt: s.createdAt,
      })),
    [rawServices],
  );

  const handleCreateService = useCallback(
    async (payload: { name: string; description?: string; default_price?: number }) => {
      await addMutation.mutateAsync({
        name: payload.name,
        description: payload.description,
        default_price: payload.default_price,
        price: payload.default_price,
      });
    },
    [addMutation],
  );

  const handleDeleteService = useCallback(
    async (id: string) => {
      await deleteMutation.mutateAsync(id);
    },
    [deleteMutation],
  );

  return (
    <ServiceCatalogDialogView
      {...props}
      services={services}
      isLoading={isLoading}
      isAdding={addMutation.isPending}
      onCreateService={handleCreateService}
      onDeleteService={handleDeleteService}
    />
  );
}

interface ServiceCatalogDialogViewProps extends ServiceCatalogDialogProps {
  services: RepairServiceCatalogItemDTO[];
  isLoading: boolean;
  isAdding: boolean;
  onCreateService: (payload: { name: string; description?: string; default_price?: number }) => Promise<void>;
  onDeleteService: (id: string) => Promise<void>;
}

function ServiceCatalogDialogView({
  open,
  onClose,
  onSelectService,
  onSelectServices,
  isSubmittingMultiple = false,
  subtitle = "Каталог типовых работ и базовых цен",
  services,
  isLoading,
  isAdding,
  onCreateService,
  onDeleteService,
}: ServiceCatalogDialogViewProps) {
  useOverlay(open, { onEscape: onClose });

  const [searchQuery, setSearchQuery] = useState("");
  const [createServiceOpen, setCreateServiceOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<ServiceItemDTO | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const isMultiSelectEnabled = Boolean(onSelectServices);

  useEffect(() => {
    if (!open) {
      setSelectedIds(new Set());
      setSearchQuery("");
    }
  }, [open]);

  const filteredServices = useMemo(() => {
    return services.filter((s) => matchesSearchTokens(searchQuery, [s.name, s.description]));
  }, [services, searchQuery]);

  const selectedServicesList = useMemo(
    () => services.filter((svc) => selectedIds.has(svc.id)),
    [services, selectedIds],
  );

  const selectedTotalPrice = useMemo(
    () => selectedServicesList.reduce((sum, svc) => sum + (svc.defaultPrice ?? 0), 0),
    [selectedServicesList],
  );

  const allFilteredSelected =
    filteredServices.length > 0 && filteredServices.every((svc) => selectedIds.has(svc.id));

  const toggleSelectService = useCallback((serviceId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(serviceId)) {
        next.delete(serviceId);
      } else {
        next.add(serviceId);
      }
      return next;
    });
  }, []);

  const handleToggleAllFiltered = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) {
        for (const svc of filteredServices) {
          next.delete(svc.id);
        }
      } else {
        for (const svc of filteredServices) {
          next.add(svc.id);
        }
      }
      return next;
    });
  }, [allFilteredSelected, filteredServices]);

  const handleConfirmMultiple = useCallback(async () => {
    if (!onSelectServices || selectedServicesList.length === 0) return;
    await onSelectServices(selectedServicesList);
    setSelectedIds(new Set());
  }, [onSelectServices, selectedServicesList]);

  void isAdding;
  void onCreateService;

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      setDeletingId(id);
      try {
        await onDeleteService(id);
        toast.success(`Услуга «${name}» удалена из справочника`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить услугу");
      } finally {
        setDeletingId(null);
      }
    },
    [onDeleteService],
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
              <p className="text-[11px] text-[#666666]">{subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCreateServiceOpen(true)}
              className="h-7 rounded-[7px] bg-[#4a38f5] px-2.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Добавить услугу</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-4 py-2.5 border-b border-[#f0f0f0] bg-[#fafafa] flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              placeholder="Поиск по наименованию услуги..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
          {isMultiSelectEnabled && filteredServices.length > 0 && (
            <button
              type="button"
              onClick={handleToggleAllFiltered}
              className="shrink-0 h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
            >
              {allFilteredSelected ? "Снять все" : "Выбрать все"}
            </button>
          )}
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
            filteredServices.map((service) => {
              const isSelected = selectedIds.has(service.id);
              return (
                <div
                  key={service.id}
                  className={cn(
                    "flex items-center justify-between px-4 py-2.5 transition-colors group",
                    isSelected ? "bg-[#4a38f5]/[0.05]" : "hover:bg-[#fafafa]",
                  )}
                >
                  <div
                    className="flex flex-1 min-w-0 items-center gap-2.5 pr-3 cursor-pointer"
                    onClick={() => {
                      if (isMultiSelectEnabled) {
                        toggleSelectService(service.id);
                      } else if (onSelectService) {
                        onSelectService(service);
                        onClose();
                      }
                    }}
                  >
                    {isMultiSelectEnabled && (
                      <span
                        role="checkbox"
                        aria-checked={isSelected}
                        aria-label={`Выбрать услугу ${service.name}`}
                        className={cn(
                          "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                          isSelected
                            ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                            : "border-[#cccccc] bg-white",
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </span>
                    )}
                    <div className="flex-1 min-w-0">
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
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {!isMultiSelectEnabled && onSelectService && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelectService(service);
                          onClose();
                        }}
                        className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#4a38f5] hover:text-white hover:border-[#4a38f5] transition-colors cursor-pointer"
                      >
                        Выбрать
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingService({
                          id: service.id,
                          name: service.name,
                          description: service.description ?? "",
                          price: service.defaultPrice ?? 0,
                          defaultPrice: service.defaultPrice ?? 0,
                          unit: service.unit ?? "усл",
                          durationMinutes: service.durationMinutes ?? null,
                          createdAt: service.createdAt,
                        });
                      }}
                      aria-label={`Редактировать услугу ${service.name}`}
                      title="Редактировать услугу"
                      className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0] hover:text-[#4a38f5] transition-colors cursor-pointer flex items-center gap-1"
                    >
                      <Pencil className="h-3 w-3 text-[#666666]" />
                      <span>Редактировать</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDelete(service.id, service.name);
                      }}
                      disabled={deletingId === service.id}
                      title="Удалить из справочника"
                      aria-label={`Удалить услугу ${service.name}`}
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
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-[#e5e5e5] px-4 py-2.5 bg-[#fafafa]">
          {isMultiSelectEnabled && selectedServicesList.length > 0 ? (
            <div className="flex items-center gap-2 text-xs text-[#666666]">
              <span>
                Выбрано:{" "}
                <span className="font-mono font-semibold text-[#111111]">
                  {selectedServicesList.length}
                </span>
              </span>
              <span className="text-[#cccccc]">·</span>
              <span className="font-mono font-semibold text-[#111111] tabular-nums">
                {formatCost(selectedTotalPrice)}
              </span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-[#888888] hover:text-[#111111] underline cursor-pointer"
              >
                Сбросить
              </button>
            </div>
          ) : (
            <span className="text-xs text-[#888888]">
              Всего в справочнике:{" "}
              <span className="font-mono font-medium text-[#111111]">{services.length}</span>
            </span>
          )}
          <div className="flex items-center gap-2">
            {isMultiSelectEnabled && selectedServicesList.length > 0 && (
              <button
                type="button"
                onClick={() => void handleConfirmMultiple()}
                disabled={isSubmittingMultiple}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {isSubmittingMultiple ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Добавить выбранные ({selectedServicesList.length})
              </button>
            )}
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

      {/* Единая каноническая модалка создания услуги из /warehouse */}
      <CreateOrEditServiceModal
        open={createServiceOpen}
        onClose={() => setCreateServiceOpen(false)}
        initialName={searchQuery.trim()}
      />

      {/* Edit Service Modal */}
      <EditServiceModal
        open={Boolean(editingService)}
        onClose={() => setEditingService(null)}
        service={editingService}
      />
    </div>
  );
}
