"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Loader2,
  Phone,
  Search,
  User,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import { useDeals, type DealDTO } from "@/lib/api/use-deals";
import { useContactLookup, useFindDuplicateContacts, type ContactDTO } from "@/lib/api/use-contacts";
import { formatAsYouType, parsePhoneInput, formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

interface RepairClientSectionProps {
  form: UseFormReturn<CreateRepairPayload>;
  initialCustomerId?: string;
}

export function RepairClientSection({ form, initialCustomerId }: RepairClientSectionProps) {
  const [mode, setMode] = useState<"deal" | "new">("deal");
  const [dealSearch, setDealSearch] = useState("");
  const [debouncedDealSearch, setDebouncedDealSearch] = useState("");
  const [isDealDropdownOpen, setIsDealDropdownOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealDTO | null>(null);

  const dropdownRef = useRef<HTMLDivElement>(null);

  const dealId = form.watch("deal_id");
  const customerId = form.watch("customer_id");
  const customerName = form.watch("customer_name");
  const customerPhone = form.watch("customer_phone");
  const companyName = form.watch("company_name");

  // Debounce поиска сделок (250мс)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDealSearch(dealSearch.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [dealSearch]);

  // Закрытие дропдауна при клике вне его
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDealDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Поиск активных сделок текущего тенанта
  const dealsQuery = useDeals({
    status: "active",
    search: debouncedDealSearch || undefined,
    limit: 10,
  });

  const deals = dealsQuery.data?.items ?? [];

  // Live-проверка номера телефона в базе CRM для дедупликации
  const lookupQuery = useContactLookup(customerPhone);
  const matchedContact = lookupQuery.data;

  // Автоматическая подгрузка сделки, если deal_id уже есть в форме
  useEffect(() => {
    if (dealId && !selectedDeal && deals.length > 0) {
      const found = deals.find((d) => d.id === dealId);
      if (found) setSelectedDeal(found);
    }
  }, [dealId, selectedDeal, deals]);

  // Выбор сделки из базы CRM
  const handleSelectDeal = (deal: DealDTO) => {
    setSelectedDeal(deal);
    form.setValue("deal_id", deal.id, { shouldValidate: true });
    form.setValue("customer_id", deal.contactId || "", { shouldValidate: true });

    const clientName = deal.contactName || deal.title || "Клиент";
    form.setValue("customer_name", clientName, { shouldValidate: true });

    if (deal.contactPhone) {
      form.setValue("customer_phone", deal.contactPhone, { shouldValidate: true });
    }

    if (deal.companyName) {
      form.setValue("company_name", deal.companyName, { shouldValidate: true });
    }

    setIsDealDropdownOpen(false);
    setDealSearch("");
  };

  // Сброс выбранной сделки
  const handleClearDeal = () => {
    setSelectedDeal(null);
    form.setValue("deal_id", "", { shouldValidate: true });
    form.setValue("customer_id", "");
    form.setValue("customer_name", "");
    form.setValue("customer_phone", "");
    form.setValue("company_name", "");
  };

  // Переключение режима
  const handleModeChange = (newMode: "deal" | "new") => {
    setMode(newMode);
    if (newMode === "new") {
      // При переходе в режим создания сбрасываем привязку к сделке
      form.setValue("deal_id", "");
      setSelectedDeal(null);
    }
  };

  // Форматирование телефона на лету
  const handlePhoneChange = (raw: string) => {
    const formatted = formatAsYouType(raw, "RU");
    form.setValue("customer_phone", formatted, { shouldValidate: true });
  };

  // Подстановка данных из найденного контакта-дубликата
  const handleApplyMatchedContact = (contact: ContactDTO) => {
    form.setValue("customer_id", contact.id, { shouldValidate: true });

    const fullName = [contact.lastName, contact.firstName, contact.middleName]
      .filter(Boolean)
      .join(" ") || `${contact.firstName} ${contact.lastName}`.trim();

    if (fullName) {
      form.setValue("customer_name", fullName, { shouldValidate: true });
    }

    if (contact.companyName) {
      form.setValue("company_name", contact.companyName, { shouldValidate: true });
    }
  };

  const { errors } = form.formState;

  return (
    <div className="space-y-3.5 rounded-[12px] border border-[#e5e5e5] bg-[#fafafa]/50 p-4 transition-all">
      {/* Шапка блока и сегментный переключатель */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#4a38f5] shadow-2xs">
            <User className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[#111111]">Клиент и сделка</h3>
            <p className="text-[11px] text-[#666666]">
              Связь заказа на ремонт с CRM-системой и клиентом
            </p>
          </div>
        </div>

        {/* Переключатель режимов (Twenty CRM Pill Toggle) */}
        <div className="inline-flex rounded-[8px] border border-[#e5e5e5] bg-[#f0f0f0]/60 p-0.5 text-[12px]">
          <button
            type="button"
            onClick={() => handleModeChange("deal")}
            className={cn(
              "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 font-medium transition-all cursor-pointer",
              mode === "deal"
                ? "bg-white text-[#111111] shadow-2xs"
                : "text-[#666666] hover:text-[#111111]",
            )}
          >
            <Briefcase className="h-3.5 w-3.5 text-[#4a38f5]" />
            <span>Выбрать сделку</span>
          </button>
          <button
            type="button"
            onClick={() => handleModeChange("new")}
            className={cn(
              "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 font-medium transition-all cursor-pointer",
              mode === "new"
                ? "bg-white text-[#111111] shadow-2xs"
                : "text-[#666666] hover:text-[#111111]",
            )}
          >
            <UserPlus className="h-3.5 w-3.5 text-emerald-600" />
            <span>Новый клиент / сделка</span>
          </button>
        </div>
      </div>

      {/* РЕЖИМ 1: Выбор активной сделки из CRM */}
      {mode === "deal" && (
        <div className="space-y-3 pt-1">
          {!selectedDeal ? (
            <div className="relative" ref={dropdownRef}>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#888888]" />
                <input
                  type="text"
                  placeholder="Поиск активной сделки по названию, контакту или телефону..."
                  value={dealSearch}
                  onFocus={() => setIsDealDropdownOpen(true)}
                  onChange={(e) => {
                    setDealSearch(e.target.value);
                    setIsDealDropdownOpen(true);
                  }}
                  className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                {dealSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setDealSearch("");
                      setIsDealDropdownOpen(false);
                    }}
                    className="absolute right-2.5 top-2.5 text-[#888888] hover:text-[#111111]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Дропдаун с результатами поиска сделок */}
              {isDealDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg">
                  {dealsQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-xs text-[#666666]">
                      <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                      <span>Поиск активных сделок...</span>
                    </div>
                  ) : deals.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-xs font-medium text-[#111111]">
                        {dealSearch ? "Сделки не найдены" : "Начните ввод для поиска сделки"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#888888]">
                        Или переключитесь на «Новый клиент / сделка» для быстрого создания
                      </p>
                    </div>
                  ) : (
                    deals.map((deal) => (
                      <button
                        key={deal.id}
                        type="button"
                        onClick={() => handleSelectDeal(deal)}
                        className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[#fafafa] cursor-pointer"
                      >
                        <div className="min-w-0 pr-3">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-[13px] font-medium text-[#111111]">
                              {deal.title}
                            </span>
                            {deal.contactName && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                                {deal.contactName}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
                            {deal.contactPhone && (
                              <span className="font-mono">{formatPhone(deal.contactPhone)}</span>
                            )}
                            {deal.companyName && (
                              <span className="flex items-center gap-1 truncate">
                                <Building2 className="h-3 w-3" />
                                {deal.companyName}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="font-mono text-xs font-semibold tabular-nums text-[#111111]">
                            {deal.budget > 0
                              ? `${deal.budget.toLocaleString("ru-RU")} ₽`
                              : "Без суммы"}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Карточка выбранной сделки */
            <div className="rounded-[8px] border border-[#4a38f5]/25 bg-white p-3 shadow-2xs">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-[#4a38f5]/10 px-2 py-0.5 text-[11px] font-semibold text-[#4a38f5]">
                      <Briefcase className="h-3 w-3" />
                      Сделка CRM
                    </span>
                    <span className="text-[13px] font-semibold text-[#111111]">
                      {selectedDeal.title}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px] text-[#666666]">
                    {selectedDeal.contactName && (
                      <span className="flex items-center gap-1 font-medium text-[#111111]">
                        <User className="h-3.5 w-3.5 text-[#888888]" />
                        {selectedDeal.contactName}
                      </span>
                    )}
                    {selectedDeal.contactPhone && (
                      <span className="flex items-center gap-1 font-mono text-[#666666]">
                        <Phone className="h-3.5 w-3.5 text-[#888888]" />
                        {formatPhone(selectedDeal.contactPhone)}
                      </span>
                    )}
                    {selectedDeal.companyName && (
                      <span className="flex items-center gap-1 text-[#666666]">
                        <Building2 className="h-3.5 w-3.5 text-[#888888]" />
                        {selectedDeal.companyName}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <div className="text-right">
                    <span className="font-mono text-xs font-semibold tabular-nums text-[#111111]">
                      {selectedDeal.budget > 0
                        ? `${selectedDeal.budget.toLocaleString("ru-RU")} ₽`
                        : "0 ₽"}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearDeal}
                    className="rounded-[6px] border border-[#e5e5e5] px-2 py-1 text-[11px] font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    Сменить
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Скрытые поля валидации для сделки */}
          {errors.customer_name && (
            <p className="text-[11px] text-rose-600">{errors.customer_name.message}</p>
          )}
        </div>
      )}

      {/* РЕЖИМ 2: Быстрое создание сделки и контакта (с дедупликацией) */}
      {mode === "new" && (
        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {/* ФИО клиента */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#666666]">
                ФИО клиента <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Иванов Иван Иванович"
                value={customerName || ""}
                onChange={(e) =>
                  form.setValue("customer_name", e.target.value, { shouldValidate: true })
                }
                className={cn(
                  "h-8 w-full rounded-[8px] border bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  errors.customer_name ? "border-rose-300 ring-rose-500/10" : "border-[#e5e5e5]",
                )}
              />
              {errors.customer_name && (
                <p className="text-[11px] text-rose-600">{errors.customer_name.message}</p>
              )}
            </div>

            {/* Номер телефона */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-[#666666]">
                Номер телефона <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <input
                  type="tel"
                  placeholder="+7 (999) 000-00-00"
                  value={customerPhone || ""}
                  onChange={(e) => handlePhoneChange(e.target.value)}
                  className={cn(
                    "h-8 w-full rounded-[8px] border bg-white px-3 font-mono text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    errors.customer_phone ? "border-rose-300 ring-rose-500/10" : "border-[#e5e5e5]",
                  )}
                />
                {lookupQuery.isFetching && (
                  <div className="absolute right-2.5 top-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[#888888]" />
                  </div>
                )}
              </div>
              {errors.customer_phone && (
                <p className="text-[11px] text-rose-600">{errors.customer_phone.message}</p>
              )}
            </div>
          </div>

          {/* Компания */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#666666]">
              Организация / Компания
            </label>
            <input
              type="text"
              placeholder="ООО Ромашка или Частное лицо"
              value={companyName || ""}
              onChange={(e) => form.setValue("company_name", e.target.value)}
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          {/* Блок индикации дедупликации контактов */}
          {matchedContact ? (
            <div className="flex items-center justify-between rounded-[8px] border border-emerald-200 bg-emerald-50/70 p-2.5 text-[12px] text-emerald-800 animate-in fade-in duration-150">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                <div>
                  <span className="font-semibold text-emerald-950">
                    Контакт найден в базе:
                  </span>{" "}
                  <span>
                    {[matchedContact.lastName, matchedContact.firstName].filter(Boolean).join(" ") || "Клиент"}
                    {matchedContact.companyName ? ` (${matchedContact.companyName})` : ""}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleApplyMatchedContact(matchedContact)}
                className="rounded-[6px] bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-2xs hover:bg-emerald-700 transition-colors cursor-pointer"
              >
                Подставить данные
              </button>
            </div>
          ) : (
            customerPhone &&
            customerPhone.trim().replace(/[^\d]/g, "").length >= 10 && (
              <div className="flex items-center gap-2 rounded-[8px] border border-sky-200 bg-sky-50/70 p-2 text-[11px] text-sky-800">
                <UserCheck className="h-3.5 w-3.5 text-sky-600 shrink-0" />
                <span>
                  Новый клиент: будет автоматически создан в CRM и привязан к сделке.
                </span>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
