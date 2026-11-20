"use client";

import React, { useMemo } from "react";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "@/components/ui/pagination";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const WAREHOUSE_LIMITS = [25, 50, 75, 100, 150, 200, 250] as const;
export type WarehouseLimit = (typeof WAREHOUSE_LIMITS)[number];

export interface RowsPerPageSelectProps {
  value: number;
  onChange: (limit: number) => void;
  disabled?: boolean;
  className?: string;
}

export function RowsPerPageSelect({
  value,
  onChange,
  disabled = false,
  className,
}: RowsPerPageSelectProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-xs text-[#666666] whitespace-nowrap">Показывать строк:</span>
      <div className="w-[84px]">
        <Select
          value={String(value)}
          disabled={disabled}
          onValueChange={(val) => {
            const num = parseInt(val, 10);
            if (WAREHOUSE_LIMITS.includes(num as WarehouseLimit)) {
              onChange(num);
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {WAREHOUSE_LIMITS.map((limit) => (
              <SelectItem key={limit} value={String(limit)} className="font-mono text-xs">
                {limit}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export interface WarehousePaginationProps {
  total: number;
  page: number;
  pages: number;
  limit: number;
  onPageChange: (newPage: number) => void;
  onLimitChange: (newLimit: number) => void;
  disabled?: boolean;
  className?: string;
}

export function WarehousePagination({
  total,
  page,
  pages,
  limit,
  onPageChange,
  onLimitChange,
  disabled = false,
  className,
}: WarehousePaginationProps) {
  // Вычисление диапазона отображаемых номеров страниц с ellipsis при pages > 7
  const paginationRange = useMemo(() => {
    if (pages <= 7) {
      return Array.from({ length: pages }, (_, i) => i + 1);
    }

    if (page <= 4) {
      return [1, 2, 3, 4, 5, "ellipsis-right", pages] as (number | string)[];
    }

    if (page >= pages - 3) {
      return [1, "ellipsis-left", pages - 4, pages - 3, pages - 2, pages - 1, pages] as (
        | number
        | string
      )[];
    }

    return [1, "ellipsis-left", page - 1, page, page + 1, "ellipsis-right", pages] as (
      | number
      | string
    )[];
  }, [page, pages]);

  const startRow = total === 0 ? 0 : (page - 1) * limit + 1;
  const endRow = Math.min(page * limit, total);

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-[#e5e5e5] bg-white",
        className,
      )}
    >
      {/* Информация о текущем диапазоне строк */}
      <div className="flex items-center gap-4 text-xs text-[#666666] order-2 sm:order-1">
        <span>
          Показано{" "}
          <strong className="font-mono text-[#111111]">
            {startRow}–{endRow}
          </strong>{" "}
          из <strong className="font-mono text-[#111111]">{total}</strong> товаров
        </span>
        <RowsPerPageSelect
          value={limit}
          disabled={disabled}
          onChange={(newLimit) => onLimitChange(newLimit)}
        />
      </div>

      {/* Пагинатор с кнопками страниц */}
      {pages > 1 && (
        <div className="order-1 sm:order-2">
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={disabled || page <= 1}
                  onClick={() => {
                    if (page > 1 && !disabled) {
                      onPageChange(page - 1);
                    }
                  }}
                />
              </PaginationItem>

              {paginationRange.map((item, idx) => {
                if (typeof item === "string") {
                  return (
                    <PaginationItem key={`${item}-${idx}`}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  );
                }

                return (
                  <PaginationItem key={item}>
                    <PaginationLink
                      isActive={item === page}
                      disabled={disabled}
                      onClick={() => {
                        if (item !== page && !disabled) {
                          onPageChange(item);
                        }
                      }}
                      className="font-mono"
                    >
                      {item}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}

              <PaginationItem>
                <PaginationNext
                  disabled={disabled || page >= pages || pages === 0}
                  onClick={() => {
                    if (page < pages && !disabled) {
                      onPageChange(page + 1);
                    }
                  }}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
