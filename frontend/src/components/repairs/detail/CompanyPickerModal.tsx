"use client";

import { useState } from "react";
import { Search, Building2, X, Check, Loader2, UserMinus } from "lucide-react";
import { useCompanies, type CompanyDTO } from "@/lib/api/use-companies";
import { cn } from "@/lib/utils";

interface CompanyPickerModalProps {
  open: boolean;
  onClose: () => void;
  currentCompanyId?: string | null;
  onSelect: (company: {
    id: string | null;
    name: string | null;
    inn: string | null;
  }) => void;
}

export function CompanyPickerModal({
  open,
  onClose,
  currentCompanyId,
  onSelect,
}: CompanyPickerModalProps) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useCompanies({
    search: search.trim() || undefined,
    limit: 40,
  });

  const companies = data?.items ?? [];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in-0 duration-150">
      <div
        className="relative flex flex-col w-full max-w-lg max-h-[85vh] rounded-[16px] border border-[#e5e5e5] bg-white shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-5 py-3.5 bg-white shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <Building2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">Выбор компании</h3>
              <p className="text-[11px] text-[#666666]">Привязка юридического лица или отвязка компании</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Option to clear/unlink company */}
        <div className="p-3 border-b border-[#f0f0f0] bg-[#fafafa] shrink-0">
          <button
            type="button"
            onClick={() => {
              onSelect({ id: null, name: null, inn: null });
              onClose();
            }}
            className={cn(
              "w-full flex items-center justify-between p-2.5 rounded-[8px] text-left transition-colors border cursor-pointer",
              !currentCompanyId
                ? "bg-white border-[#4a38f5]/40 shadow-2xs"
                : "bg-white border-[#e5e5e5] hover:border-[#cccccc]",
            )}
          >
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#f0f0f0] text-[#666666]">
                <UserMinus className="h-3.5 w-3.5" />
              </div>
              <div>
                <span className="text-xs font-semibold text-[#111111] block">
                  Физ. лицо (без компании)
                </span>
                <span className="text-[11px] text-[#888888]">
                  Отвязать заказ от юр. лица
                </span>
              </div>
            </div>
            {!currentCompanyId && (
              <span className="inline-flex items-center gap-1 text-[10px] text-[#4a38f5] font-medium bg-[#4a38f5]/10 px-1.5 py-0.5 rounded">
                <Check className="h-3 w-3" />
                Текущий
              </span>
            )}
          </button>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-[#f0f0f0] bg-[#fbfbfb] shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию организации или ИНН..."
              className="w-full h-8 pl-8 pr-3 rounded-[6px] border border-[#e5e5e5] bg-white text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#f5f5f5]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-[#888888]" />
            </div>
          ) : companies.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#888888]">
              {search.trim() ? "Компании по данному запросу не найдены" : "Список компаний пуст"}
            </div>
          ) : (
            companies.map((comp) => {
              const isSelected = comp.id === currentCompanyId;
              const inn = comp.requisites?.inn || "";

              return (
                <button
                  key={comp.id}
                  type="button"
                  onClick={() => {
                    onSelect({
                      id: comp.id,
                      name: comp.name,
                      inn: inn || null,
                    });
                    onClose();
                  }}
                  className={cn(
                    "w-full flex items-center justify-between p-2.5 rounded-[8px] text-left transition-colors cursor-pointer",
                    isSelected
                      ? "bg-[#4a38f5]/5 border border-[#4a38f5]/30"
                      : "hover:bg-[#fafafa] border border-transparent",
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#f0f0f0] text-xs font-semibold text-[#111111]">
                      <Building2 className="h-4 w-4 text-[#666666]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#111111] truncate">
                          {comp.name}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#4a38f5] font-medium bg-[#4a38f5]/10 px-1.5 py-0.2 rounded">
                            <Check className="h-3 w-3" />
                            Текущая
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#666666]">
                        {inn && (
                          <span className="font-mono text-[#888888]">
                            ИНН: {inn}
                          </span>
                        )}
                        {comp.phone && (
                          <span className="font-mono text-[#888888]">
                            {comp.phone}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
