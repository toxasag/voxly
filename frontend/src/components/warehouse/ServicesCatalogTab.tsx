"use client";

import { useState, useCallback, useEffect } from "react";
import {
  Search,
  Plus,
  BookOpen,
  Pencil,
  Trash2,
  Loader2,
  Clock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  useServicesPaginated,
  useDeleteService,
  type ServiceItemDTO,
} from "@/lib/api/use-services";
import {
  WarehousePagination,
  type WarehouseLimit,
} from "@/components/warehouse/WarehousePagination";
import { CreateOrEditServiceModal } from "./CreateOrEditServiceModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

import { formatRub } from "@/lib/utils/format";

type ServiceSortField = "name" | "description" | "price" | "duration_minutes";

export function ServicesCatalogTab() {
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<WarehouseLimit>(25);
  const [sortField, setSortField] = useState<ServiceSortField | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<ServiceItemDTO | null>(null);
  const [deletingService, setDeletingService] = useState<ServiceItemDTO | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      const next = searchInput.trim();
      setSearchQuery((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data, isLoading } = useServicesPaginated({
    search: searchQuery || undefined,
    page,
    limit,
    sortBy: sortField ?? undefined,
    sortDir: sortField ? sortDir : undefined,
  });
  const services = data?.items ?? [];
  const meta = data?.meta ?? { total: 0, page, limit, pages: 0 };
  const deleteMutation = useDeleteService();

  const filteredServices = services;

  const handleSort = (field: ServiceSortField) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDir("asc");
    } else if (sortDir === "asc") {
      setSortDir("desc");
    } else {
      setSortField(null);
      setSortDir("asc");
    }
    setPage(1);
  };

  const handleEdit = useCallback((service: ServiceItemDTO) => {
    setEditingService(service);
    setIsModalOpen(true);
  }, []);

  const handleCreate = useCallback(() => {
    setEditingService(null);
    setIsModalOpen(true);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deletingService) return;
    try {
      await deleteMutation.mutateAsync(deletingService.id);
      toast.success(`Услуга «${deletingService.name}» удалена`);
      setDeletingService(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить услугу");
    }
  }, [deletingService, deleteMutation]);

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white">
      {/* Control Toolbar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-4 border-b border-[#e5e5e5] bg-white">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
          <input
            type="text"
            placeholder="Поиск по названию или описанию услуги..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-full h-8 pl-9 pr-3 rounded-[8px] border border-[#e5e5e5] bg-white text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-[#666666] hidden sm:inline">
            Всего услуг:{" "}
            <span className="font-mono font-medium text-[#111111]">{meta.total}</span>
          </span>
          <button
            type="button"
            onClick={handleCreate}
            className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer flex items-center gap-1.5 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Добавить услугу
          </button>
        </div>
      </div>

      {/* Services Table */}
      <div className="flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-[#888888]">
            <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center px-4">
            <div className="h-12 w-12 rounded-full bg-[#f5f5f5] flex items-center justify-center mb-3">
              <BookOpen className="h-6 w-6 text-[#888888]" />
            </div>
            <h3 className="text-sm font-semibold text-[#111111] mb-1">
              {searchQuery ? "Ничего не найдено" : "Справочник услуг пуст"}
            </h3>
            <p className="text-xs text-[#666666] max-w-sm mb-4">
              {searchQuery
                ? "Попробуйте изменить поисковый запрос"
                : "Добавьте типовые работы и услуги с ценами и описанием для быстрого прикрепления к сделкам"}
            </p>
            {!searchQuery && (
              <button
                type="button"
                onClick={handleCreate}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Создать первую услугу
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium uppercase tracking-wider text-[#666666]">
                <th
                  onClick={() => handleSort("name")}
                  className="py-2.5 px-4 font-medium w-1/4 cursor-pointer select-none hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group"
                >
                  <span className="inline-flex items-center gap-1">
                    Название
                    {sortField === "name" ? (
                      sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5]" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5]" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100" />
                    )}
                  </span>
                </th>
                <th
                  onClick={() => handleSort("description")}
                  className="py-2.5 px-4 font-medium w-2/5 cursor-pointer select-none hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group"
                >
                  <span className="inline-flex items-center gap-1">
                    Описание
                    {sortField === "description" ? (
                      sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5]" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5]" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100" />
                    )}
                  </span>
                </th>
                <th
                  onClick={() => handleSort("price")}
                  className="py-2.5 px-4 font-medium text-right cursor-pointer select-none hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group"
                >
                  <span className="inline-flex items-center justify-end gap-1">
                    Цена
                    {sortField === "price" ? (
                      sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5]" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5]" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100" />
                    )}
                  </span>
                </th>
                <th
                  onClick={() => handleSort("duration_minutes")}
                  className="py-2.5 px-4 font-medium text-center cursor-pointer select-none hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group"
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    Длительность / Ед.
                    {sortField === "duration_minutes" ? (
                      sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5]" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5]" />
                    ) : (
                      <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100" />
                    )}
                  </span>
                </th>
                <th className="py-2.5 px-4 font-medium text-right w-24">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {filteredServices.map((service) => (
                <tr
                  key={service.id}
                  className="hover:bg-[#fafafa] transition-colors group cursor-pointer"
                  onClick={() => handleEdit(service)}
                >
                  <td className="py-3 px-4">
                    <span className="text-[13px] font-medium text-[#111111] group-hover:text-[#4a38f5] transition-colors">
                      {service.name}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    {service.description ? (
                      <p className="text-xs text-[#666666] line-clamp-2 leading-relaxed">
                        {service.description}
                      </p>
                    ) : (
                      <span className="text-xs text-[#aaaaaa] italic">Нет описания</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className="text-[13px] font-mono tabular-nums font-semibold text-[#111111]">
                      {service.price > 0 ? formatRub(service.price) : "0 ₽"}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-center">
                    <div className="inline-flex items-center gap-1.5 text-xs text-[#666666]">
                      {service.durationMinutes ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-mono">
                          <Clock className="h-3 w-3 text-[#888888]" />
                          {service.durationMinutes} мин
                        </span>
                      ) : null}
                      <span className="text-[11px] text-[#888888]">
                        / {service.unit || "усл"}
                      </span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => handleEdit(service)}
                        title="Редактировать услугу"
                        className="rounded-[6px] p-1.5 text-[#888888] hover:text-[#111111] hover:bg-black/[0.04] transition-colors cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingService(service)}
                        title="Удалить услугу"
                        className="rounded-[6px] p-1.5 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <WarehousePagination
        total={meta.total}
        page={meta.page}
        pages={meta.pages}
        limit={meta.limit}
        entityLabel="услуг"
        onPageChange={setPage}
        onLimitChange={(newLimit) => {
          setLimit(newLimit as WarehouseLimit);
          setPage(1);
        }}
        disabled={isLoading}
      />

      {/* Modal create / edit */}
      <CreateOrEditServiceModal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditingService(null);
        }}
        service={editingService}
      />

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        open={Boolean(deletingService)}
        title="Удаление услуги из справочника"
        description={`Вы действительно хотите удалить услугу «${deletingService?.name}»? Это действие нельзя будет отменить.`}
        confirmLabel="Удалить"
        cancelLabel="Отмена"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={() => void confirmDelete()}
        onClose={() => setDeletingService(null)}
      />
    </div>
  );
}
