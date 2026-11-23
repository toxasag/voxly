"use client";

import React from "react";
import { Pencil, Trash2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ServiceItemDTO } from "@/lib/api/use-services";

export interface ServiceItemProps {
  service: ServiceItemDTO;
  onEdit: (service: ServiceItemDTO) => void;
  onDelete?: (service: ServiceItemDTO) => void;
  onSelect?: (service: ServiceItemDTO) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function ServiceItem({
  service,
  onEdit,
  onDelete,
  onSelect,
}: ServiceItemProps) {
  const price =
    service.price !== undefined && service.price !== null
      ? service.price
      : service.defaultPrice ?? 0;

  return (
    <div
      data-testid={`service-item-${service.id}`}
      className="flex items-center justify-between px-4 py-3 hover:bg-[#fafafa] transition-colors border-b border-[#f0f0f0] group"
    >
      <div
        className="flex-1 min-w-0 pr-4 cursor-pointer"
        onClick={() => {
          if (onSelect) {
            onSelect(service);
          } else {
            onEdit(service);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-[#111111] truncate group-hover:text-[#4a38f5] transition-colors">
            {service.name}
          </p>
        </div>

        {service.description ? (
          <p className="text-[11px] text-[#666666] line-clamp-2 mt-0.5 leading-relaxed">
            {service.description}
          </p>
        ) : null}

        <div className="flex items-center gap-3 mt-1 text-[11px] text-[#666666]">
          <span className="font-mono tabular-nums font-semibold text-[#111111]">
            {price > 0 ? formatCost(price) : "Цена не указана"}
          </span>
          {service.durationMinutes ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[10px] font-mono text-[#666666]">
              <Clock className="h-3 w-3 text-[#888888]" />
              {service.durationMinutes} мин
            </span>
          ) : null}
          <span className="text-[#888888]">/ {service.unit || "усл"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {onSelect && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            tabIndex={0}
            onClick={() => onSelect(service)}
            aria-label={`Выбрать услугу ${service.name}`}
            className="cursor-pointer"
          >
            Выбрать
          </Button>
        )}

        <Button
          type="button"
          variant="outline"
          size="sm"
          tabIndex={0}
          onClick={() => onEdit(service)}
          aria-label="Редактировать услугу"
          title="Редактировать услугу"
          className="cursor-pointer flex items-center gap-1.5"
        >
          <Pencil className="h-3.5 w-3.5 text-[#666666]" />
          <span>Редактировать</span>
        </Button>

        {onDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            tabIndex={0}
            onClick={() => onDelete(service)}
            aria-label={`Удалить услугу ${service.name}`}
            title="Удалить услугу"
            className="text-[#888888] hover:text-rose-600 hover:bg-rose-50 cursor-pointer h-7 w-7 p-0"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}
