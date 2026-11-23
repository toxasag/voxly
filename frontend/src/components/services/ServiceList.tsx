"use client";

import { useState, useMemo, useCallback } from "react";
import { Search, BookOpen, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useServices,
  useDeleteService,
  type ServiceItemDTO,
} from "@/lib/api/use-services";
import { ServiceItem } from "./ServiceItem";
import { EditServiceModal } from "./EditServiceModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

export interface ServiceListProps {
  onSelectService?: (service: ServiceItemDTO) => void;
  className?: string;
}

export function ServiceList({ onSelectService, className }: ServiceListProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingService, setEditingService] = useState<ServiceItemDTO | null>(null);
  const [deletingService, setDeletingService] = useState<ServiceItemDTO | null>(null);

  const { data: services = [], isLoading } = useServices(searchQuery);
  const deleteMutation = useDeleteService();

  const filteredServices = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return services;
    return services.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description && s.description.toLowerCase().includes(q)),
    );
  }, [services, searchQuery]);

  const handleEdit = useCallback((service: ServiceItemDTO) => {
    setEditingService(service);
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
    <div className={`flex flex-col flex-1 min-h-0 bg-white ${className ?? ""}`}>
      {/* Search Bar */}
      <div className="p-4 border-b border-[#e5e5e5] bg-[#fafafa]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            placeholder="Поиск по наименованию или описанию услуги..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 rounded-[8px] border border-[#e5e5e5] bg-white text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
        </div>
      </div>

      {/* Services List */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-[#888888]">
            <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
          </div>
        ) : filteredServices.length === 0 ? (
          <div className="py-16 text-center px-4">
            <BookOpen className="h-8 w-8 text-[#cccccc] mx-auto mb-2" />
            <h3 className="text-sm font-semibold text-[#111111] mb-1">
              {searchQuery ? "Ничего не найдено" : "В справочнике пока нет услуг"}
            </h3>
            <p className="text-xs text-[#666666]">
              {searchQuery
                ? "Попробуйте изменить поисковый запрос"
                : "Добавьте типовые услуги для быстрого добавления в наряды и сделки"}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#f0f0f0]">
            {filteredServices.map((service) => (
              <ServiceItem
                key={service.id}
                service={service}
                onEdit={handleEdit}
                onDelete={(s) => setDeletingService(s)}
                onSelect={onSelectService}
              />
            ))}
          </div>
        )}
      </div>

      {/* Footer stats */}
      <div className="flex items-center justify-between border-t border-[#e5e5e5] px-4 py-2.5 bg-[#fafafa] text-xs text-[#888888]">
        <span>
          Всего в справочнике:{" "}
          <span className="font-mono font-medium text-[#111111]">{services.length}</span>
        </span>
      </div>

      {/* Edit Modal */}
      <EditServiceModal
        open={Boolean(editingService)}
        onClose={() => setEditingService(null)}
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
