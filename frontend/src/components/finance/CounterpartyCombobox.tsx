"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { User, Building2, Search, X, Check, Plus, Loader2 } from "lucide-react";
import { useCounterparties, type CounterpartyContact, type CounterpartyCompany } from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

interface CounterpartyComboboxProps {
  value: string;
  inn?: string;
  onChange: (name: string, inn?: string) => void;
  placeholder?: string;
  className?: string;
}

export function CounterpartyCombobox({
  value,
  inn,
  onChange,
  placeholder = "Выберите или введите контрагента...",
  className,
}: CounterpartyComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useCounterparties(search);
  const contacts = data?.contacts ?? [];
  const companies = data?.companies ?? [];

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelectContact = (c: CounterpartyContact) => {
    onChange(c.name, "");
    setIsOpen(false);
    setSearch("");
  };

  const handleSelectCompany = (co: CounterpartyCompany) => {
    onChange(co.name, co.inn || "");
    setIsOpen(false);
    setSearch("");
  };

  const handleSelectCustom = (customName: string) => {
    onChange(customName.trim(), "");
    setIsOpen(false);
    setSearch("");
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("", "");
    setSearch("");
  };

  const hasResults = contacts.length > 0 || companies.length > 0;
  const trimmedSearch = search.trim();
  const showCustomOption = trimmedSearch.length > 0 &&
    !contacts.some((c) => c.name.toLowerCase() === trimmedSearch.toLowerCase()) &&
    !companies.some((co) => co.name.toLowerCase() === trimmedSearch.toLowerCase());

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      {/* Control Display / Trigger */}
      <div
        onClick={() => {
          setIsOpen(true);
          setTimeout(() => inputRef.current?.focus(), 50);
        }}
        className={cn(
          "flex min-h-[34px] w-full items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] transition-all cursor-pointer",
          isOpen ? "border-[#4a38f5] ring-1 ring-[#4a38f5]/20" : "hover:border-[#cccccc]",
        )}
      >
        <div className="flex flex-1 items-center gap-2 truncate">
          {value ? (
            <div className="flex items-center gap-1.5 truncate">
              {inn ? (
                <Building2 className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
              ) : (
                <User className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
              )}
              <span className="font-medium text-[#111111] truncate">{value}</span>
              {inn && <span className="font-mono text-[11px] text-[#888888]">({inn})</span>}
            </div>
          ) : (
            <span className="text-[#888888] truncate">{placeholder}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="rounded p-0.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors"
              title="Очистить"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          <Search className="h-3.5 w-3.5 text-[#888888]" />
        </div>
      </div>

      {/* Dropdown Popover */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg animate-in fade-in zoom-in-95 duration-100 overflow-hidden">
          {/* Search Input */}
          <div className="flex items-center border-b border-[#e5e5e5] px-2.5 py-1.5 bg-[#fafafa]">
            <Search className="h-3.5 w-3.5 text-[#888888] mr-2 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по ФИО, телефону, названию или ИНН..."
              className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] focus:outline-none"
            />
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[#888888] shrink-0" />}
          </div>

          {/* Results List */}
          <div className="max-h-60 overflow-y-auto p-1.5 space-y-2 text-xs">
            {/* Custom string option */}
            {showCustomOption && (
              <button
                type="button"
                onClick={() => handleSelectCustom(trimmedSearch)}
                className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left text-xs text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Использовать: <strong>«{trimmedSearch}»</strong>
                </span>
              </button>
            )}

            {/* Contacts Group */}
            {contacts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                  <User className="h-3 w-3" />
                  <span>Контакты ({contacts.length})</span>
                </div>
                <div className="space-y-0.5">
                  {contacts.map((c) => {
                    const isSelected = value === c.name;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => handleSelectContact(c)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                            : "text-[#111111] hover:bg-[#f5f5f5]",
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <User className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                          <span className="truncate">{c.name}</span>
                          {c.phone && <span className="font-mono text-[11px] text-[#888888] truncate">{c.phone}</span>}
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Companies Group */}
            {companies.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                  <Building2 className="h-3 w-3" />
                  <span>Компании ({companies.length})</span>
                </div>
                <div className="space-y-0.5">
                  {companies.map((co) => {
                    const isSelected = value === co.name;
                    return (
                      <button
                        key={co.id}
                        type="button"
                        onClick={() => handleSelectCompany(co)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-left transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                            : "text-[#111111] hover:bg-[#f5f5f5]",
                        )}
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Building2 className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                          <span className="truncate">{co.name}</span>
                          {co.inn && (
                            <span className="font-mono text-[11px] text-[#888888] truncate">ИНН: {co.inn}</span>
                          )}
                        </div>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {!hasResults && !showCustomOption && !isLoading && (
              <div className="p-4 text-center text-xs text-[#888888]">
                Ничего не найдено. Введите имя для добавления.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
