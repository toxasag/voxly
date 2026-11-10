"use client";

import { useState } from "react";
import { Search, User, X, Check, Building2, Phone, Mail, Loader2 } from "lucide-react";
import { useContacts, contactFullName, type ContactDTO } from "@/lib/api/use-contacts";
import { cn } from "@/lib/utils";

interface ContactPickerModalProps {
  open: boolean;
  onClose: () => void;
  currentContactId?: string | null;
  onSelect: (contact: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    companyId?: string | null;
    companyName?: string | null;
  }) => void;
}

export function ContactPickerModal({
  open,
  onClose,
  currentContactId,
  onSelect,
}: ContactPickerModalProps) {
  const [search, setSearch] = useState("");
  const { data, isLoading } = useContacts({
    search: search.trim() || undefined,
    limit: 40,
  });

  const contacts = data?.items ?? [];

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
              <User className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">Выбор клиента</h3>
              <p className="text-[11px] text-[#666666]">Привязка существующего контакта CRM к наряд-заказу</p>
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

        {/* Search */}
        <div className="p-3 border-b border-[#f0f0f0] bg-[#fbfbfb] shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по имени, фамилии или номеру телефона..."
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
          ) : contacts.length === 0 ? (
            <div className="py-12 text-center text-xs text-[#888888]">
              {search.trim() ? "Контакты по данному запросу не найдены" : "Список контактов пуст"}
            </div>
          ) : (
            contacts.map((c) => {
              const fullName = contactFullName(c) || "Без имени";
              const isSelected = c.id === currentContactId;
              const phone = c.phone || (c.phones?.[0]?.number ?? "");

              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onSelect({
                      id: c.id,
                      name: fullName,
                      phone,
                      email: c.email,
                      companyId: c.companyId,
                      companyName: c.companyName,
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
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] text-xs font-semibold text-[#111111]">
                      {fullName[0]}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[#111111] truncate">
                          {fullName}
                        </span>
                        {isSelected && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-[#4a38f5] font-medium bg-[#4a38f5]/10 px-1.5 py-0.2 rounded">
                            <Check className="h-3 w-3" />
                            Текущий
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#666666]">
                        {phone && (
                          <span className="flex items-center gap-1 font-mono">
                            <Phone className="h-3 w-3 text-[#888888]" />
                            {phone}
                          </span>
                        )}
                        {c.companyName && (
                          <span className="flex items-center gap-1 truncate text-[#888888]">
                            <Building2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.companyName}</span>
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
