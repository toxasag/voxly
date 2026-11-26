"use client";

import { useEffect, useRef, useState } from "react";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import {
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  FileText,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  PlusCircle,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  User,
  UserCheck,
  UserPlus,
} from "lucide-react";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import {
  useRepairClientLookup,
  useCompanyInnLookup,
  type ClientLookupDealDTO,
  type ClientLookupResultDTO,
  type ClientMessengerSourceDTO,
  type ExistingContactDTO,
} from "@/lib/api/use-repairs";
import { formatAsYouType, formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

interface RepairClientSectionProps {
  form: UseFormReturn<CreateRepairPayload>;
  initialCustomerId?: string;
}

function formatDealDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "";
  }
}

function formatCurrency(amount: number, currency: string = "RUB"): string {
  try {
    return new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency: currency || "RUB",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${amount} ₽`;
  }
}

export function RepairClientSection({ form }: RepairClientSectionProps) {
  const customerPhone = form.watch("customer_phone") ?? "";
  const customerName = form.watch("customer_name") ?? "";
  const customerEmail = form.watch("customer_email") ?? "";
  const customerId = form.watch("customer_id") ?? "";
  const dealId = form.watch("deal_id") ?? "";
  const companyName = form.watch("company_name") ?? "";
  const companyInn = form.watch("company_inn") ?? "";
  const companyOgrn = form.watch("company_ogrn") ?? "";
  const companyBik = form.watch("company_bik") ?? "";
  const companyAccountNumber = form.watch("company_account_number") ?? "";
  const companyLegalAddress = form.watch("company_legal_address") ?? "";

  // Локальные состояния инпутов для гладкого ввода
  const [phoneInput, setPhoneInput] = useState(customerPhone ? formatPhone(customerPhone) : "");
  const [debouncedPhone, setDebouncedPhone] = useState(customerPhone ? formatPhone(customerPhone) : "");
  const [debouncedName, setDebouncedName] = useState(customerName);
  const lastLocalPhoneRef = useRef<string>(customerPhone);

  // Синхронизация локального инпута телефона при внешнем изменении формы (например, подстановка из сделки или reset)
  useEffect(() => {
    if (customerPhone === lastLocalPhoneRef.current) return;
    const formatted = customerPhone ? formatPhone(customerPhone) : "";
    lastLocalPhoneRef.current = customerPhone;
    setPhoneInput(formatted);
    setDebouncedPhone(formatted);
  }, [customerPhone]);

  // Организация и реквизиты
  const isCompanyFormVal = form.watch("is_company");
  const [isCompanyChecked, setIsCompanyChecked] = useState<boolean>(
    Boolean(isCompanyFormVal || companyName || companyInn || form.watch("company_id")),
  );

  // Синхронизация состояния чекбокса с формой
  useEffect(() => {
    if (isCompanyFormVal !== undefined && isCompanyFormVal !== isCompanyChecked) {
      setIsCompanyChecked(isCompanyFormVal);
    }
  }, [isCompanyFormVal]);
  const [isRequisitesOpen, setIsRequisitesOpen] = useState<boolean>(
    Boolean(companyInn || companyOgrn || companyBik || companyAccountNumber || companyLegalAddress),
  );

  // Развернутые подробности сделок (accordion)
  const [expandedDealId, setExpandedDealId] = useState<string | null>(null);

  // Множественные контакты заказчика
  const {
    fields: additionalContactFields,
    append: appendAdditionalContact,
    remove: removeAdditionalContact,
  } = useFieldArray({
    control: form.control,
    name: "additional_contacts",
  });

  // Флаг, был ли клиент выбран или сброшен вручную
  const [isManuallyDetached, setIsManuallyDetached] = useState<boolean>(false);

  // Debounce телефона (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedPhone(phoneInput);
    }, 300);
    return () => clearTimeout(handler);
  }, [phoneInput]);

  // Debounce имени (300ms)
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedName(customerName);
    }, 300);
    return () => clearTimeout(handler);
  }, [customerName]);

  // Debounce ИНН (350ms) для реактивного автопоиска
  const [debouncedInn, setDebouncedInn] = useState(companyInn);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedInn(companyInn);
    }, 350);
    return () => clearTimeout(handler);
  }, [companyInn]);

  // Сквозной поиск реквизитов организации по ИНН (DaData / ФНС ЕГРЮЛ)
  const innLookupQuery = useCompanyInnLookup(debouncedInn);
  const isInnLoading = innLookupQuery.isLoading || innLookupQuery.isFetching;

  // Автозаполнение реквизитов при успешном нахождении в реестре
  useEffect(() => {
    if (innLookupQuery.data) {
      const info = innLookupQuery.data;
      if (info.name) {
        form.setValue("company_name", info.name, { shouldDirty: true, shouldValidate: true });
      }
      if (info.ogrn) {
        form.setValue("company_ogrn", info.ogrn, { shouldDirty: true });
      }
      if (info.legalAddress) {
        form.setValue("company_legal_address", info.legalAddress, { shouldDirty: true });
      }
      // ВАЖНО: Разделение сущностей Контакт (физическое лицо / заявитель) и Организация (юрлицо / ИП).
      // Автоматическое перезаписывание customer_name именем директора/ИП СТРОГО ЗАПРЕЩЕНО.
      // По умолчанию поля не связаны. Перенос имени доступен только по явному клику пользователя в UI.
      setIsRequisitesOpen(true);
    }
  }, [innLookupQuery.data, form]);

  // Реактивный поиск по номеру телефона или имени (при отсутствии полного номера)
  const phoneDigitsCount = debouncedPhone.replace(/\D/g, "").length;
  const lookupQuery = useRepairClientLookup({
    phone: debouncedPhone,
    query: phoneDigitsCount < 6 ? debouncedName : "",
    enabled: !isManuallyDetached && (phoneDigitsCount >= 6 || debouncedName.trim().length >= 2),
  });

  const lookupData: ClientLookupResultDTO | undefined = lookupQuery.data;
  const isLookupLoading = lookupQuery.isLoading || lookupQuery.isFetching;

  // Автозаполнение формы при обнаружении клиента
  useEffect(() => {
    if (!lookupData || !lookupData.found || isManuallyDetached) {
      return;
    }

    const client = lookupData.client;
    if (client) {
      // Заполняем ID клиента в форме
      form.setValue("customer_id", client.id, { shouldDirty: true });

      // Если ФИО еще не заполнено, подставляем из базы
      if (!customerName || customerName.trim() === "") {
        const fullName = [client.lastName, client.firstName, client.middleName].filter(Boolean).join(" ").trim();
        if (fullName) {
          form.setValue("customer_name", fullName, { shouldValidate: true, shouldDirty: true });
        }
      }

      // Если телефон еще не заполнен, подставляем из базы
      if ((!customerPhone || customerPhone.trim() === "") && client.phone) {
        const formatted = formatPhone(client.phone);
        lastLocalPhoneRef.current = formatted;
        setPhoneInput(formatted);
        setDebouncedPhone(formatted);
        form.setValue("customer_phone", formatted, { shouldValidate: true, shouldDirty: true });
      }

      // Если email еще не заполнен
      if ((!customerEmail || customerEmail.trim() === "") && client.email) {
        form.setValue("customer_email", client.email, { shouldDirty: true });
      }

      // Если у клиента есть компания или реквизиты
      if (lookupData.company) {
        setIsCompanyChecked(true);
        form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
        form.setValue("company_id", lookupData.company.id, { shouldDirty: true });
        form.setValue("company_name", lookupData.company.name, { shouldValidate: true, shouldDirty: true });
        if (lookupData.company.inn) form.setValue("company_inn", lookupData.company.inn, { shouldDirty: true });
        if (lookupData.company.ogrn) form.setValue("company_ogrn", lookupData.company.ogrn, { shouldDirty: true });
        if (lookupData.company.bik) form.setValue("company_bik", lookupData.company.bik, { shouldDirty: true });
        if (lookupData.company.accountNumber) {
          form.setValue("company_account_number", lookupData.company.accountNumber, { shouldDirty: true });
        }
        if (lookupData.company.legalAddress) {
          form.setValue("company_legal_address", lookupData.company.legalAddress, { shouldDirty: true });
        }
      } else if (client.companyName && !companyName) {
        setIsCompanyChecked(true);
        form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
        if (client.companyId) form.setValue("company_id", client.companyId, { shouldDirty: true });
        form.setValue("company_name", client.companyName, { shouldValidate: true, shouldDirty: true });
      }
    } else if (lookupData.existingContact?.contactId) {
      const ec = lookupData.existingContact;
      form.setValue("customer_id", ec.contactId || "", { shouldDirty: true });
      if (!customerName || customerName.trim() === "") {
        form.setValue("customer_name", ec.fullName, { shouldValidate: true, shouldDirty: true });
      }
      if ((!customerPhone || customerPhone.trim() === "") && ec.phone) {
        const formatted = formatPhone(ec.phone);
        lastLocalPhoneRef.current = formatted;
        setPhoneInput(formatted);
        setDebouncedPhone(formatted);
        form.setValue("customer_phone", formatted, { shouldValidate: true, shouldDirty: true });
      }
      if ((!customerEmail || customerEmail.trim() === "") && ec.email) {
        form.setValue("customer_email", ec.email, { shouldDirty: true });
      }
      if (lookupData.company) {
        setIsCompanyChecked(true);
        form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
        form.setValue("company_id", lookupData.company.id, { shouldDirty: true });
        form.setValue("company_name", lookupData.company.name, { shouldValidate: true, shouldDirty: true });
        if (lookupData.company.inn) form.setValue("company_inn", lookupData.company.inn, { shouldDirty: true });
        if (lookupData.company.ogrn) form.setValue("company_ogrn", lookupData.company.ogrn, { shouldDirty: true });
        if (lookupData.company.bik) form.setValue("company_bik", lookupData.company.bik, { shouldDirty: true });
        if (lookupData.company.accountNumber) {
          form.setValue("company_account_number", lookupData.company.accountNumber, { shouldDirty: true });
        }
        if (lookupData.company.legalAddress) {
          form.setValue("company_legal_address", lookupData.company.legalAddress, { shouldDirty: true });
        }
      } else if (ec.companyName && !companyName) {
        setIsCompanyChecked(true);
        form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
        if (ec.companyId) form.setValue("company_id", ec.companyId, { shouldDirty: true });
        form.setValue("company_name", ec.companyName, { shouldValidate: true, shouldDirty: true });
      }
    }
  }, [lookupData, isManuallyDetached]);

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    const formatted = formatAsYouType(rawVal, "RU");
    lastLocalPhoneRef.current = formatted;
    setPhoneInput(formatted);
    form.setValue("customer_phone", formatted, { shouldValidate: true, shouldDirty: true });
    if (isManuallyDetached) {
      setIsManuallyDetached(false);
    }
  };

  const handleClearCustomer = () => {
    setIsManuallyDetached(true);
    lastLocalPhoneRef.current = "";
    form.setValue("customer_id", "");
    form.setValue("deal_id", "");
    form.setValue("customer_name", "");
    form.setValue("customer_phone", "");
    form.setValue("customer_email", "");
    form.setValue("is_company", false);
    form.setValue("company_id", "");
    form.setValue("company_name", "");
    form.setValue("company_inn", "");
    form.setValue("company_ogrn", "");
    form.setValue("company_bik", "");
    form.setValue("company_account_number", "");
    form.setValue("company_legal_address", "");
    form.setValue("additional_contacts", []);
    setPhoneInput("");
    setDebouncedPhone("");
    setIsCompanyChecked(false);
    setIsRequisitesOpen(false);
    form.clearErrors("company_name");
  };

  const handleApplyExistingContact = () => {
    if (!lookupData?.existingContact) return;
    const ec = lookupData.existingContact;
    const client = lookupData.client;

    if (ec.contactId) {
      form.setValue("customer_id", ec.contactId, { shouldDirty: true });
    }
    if (ec.fullName) {
      form.setValue("customer_name", ec.fullName, { shouldValidate: true, shouldDirty: true });
    }
    if (ec.phone) {
      const formatted = formatPhone(ec.phone);
      lastLocalPhoneRef.current = formatted;
      setPhoneInput(formatted);
      setDebouncedPhone(formatted);
      form.setValue("customer_phone", formatted, { shouldValidate: true, shouldDirty: true });
    }
    const emailToSet = ec.email || client?.email;
    if (emailToSet) {
      form.setValue("customer_email", emailToSet, { shouldValidate: true, shouldDirty: true });
    }

    if (lookupData.company) {
      setIsCompanyChecked(true);
      form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
      form.setValue("company_id", lookupData.company.id, { shouldDirty: true });
      form.setValue("company_name", lookupData.company.name, { shouldValidate: true, shouldDirty: true });
      if (lookupData.company.inn) form.setValue("company_inn", lookupData.company.inn, { shouldDirty: true });
      if (lookupData.company.ogrn) form.setValue("company_ogrn", lookupData.company.ogrn, { shouldDirty: true });
      if (lookupData.company.bik) form.setValue("company_bik", lookupData.company.bik, { shouldDirty: true });
      if (lookupData.company.accountNumber) {
        form.setValue("company_account_number", lookupData.company.accountNumber, { shouldDirty: true });
      }
      if (lookupData.company.legalAddress) {
        form.setValue("company_legal_address", lookupData.company.legalAddress, { shouldDirty: true });
      }
    } else if (ec.companyName || client?.companyName) {
      const cName = ec.companyName || client?.companyName || "";
      const cId = ec.companyId || client?.companyId || null;
      setIsCompanyChecked(true);
      form.setValue("is_company", true, { shouldValidate: true, shouldDirty: true });
      if (cId) form.setValue("company_id", cId, { shouldDirty: true });
      form.setValue("company_name", cName, { shouldValidate: true, shouldDirty: true });
    }
  };

  const handleSelectDeal = (selectedId: string) => {
    form.setValue("deal_id", selectedId, { shouldDirty: true });
  };

  const handleCreateNewDealOption = () => {
    form.setValue("deal_id", "", { shouldDirty: true });
  };

  const handleToggleCompany = (checked: boolean) => {
    setIsCompanyChecked(checked);
    form.setValue("is_company", checked, { shouldValidate: true, shouldDirty: true });
    if (!checked) {
      form.setValue("company_id", "");
      form.setValue("company_name", "");
      form.setValue("company_inn", "");
      form.setValue("company_ogrn", "");
      form.setValue("company_bik", "");
      form.setValue("company_account_number", "");
      form.setValue("company_legal_address", "");
      setIsRequisitesOpen(false);
      form.clearErrors("company_name");
    } else {
      void form.trigger("company_name");
    }
  };

  const handleApplySuggestedName = (name: string) => {
    form.setValue("customer_name", name, { shouldValidate: true, shouldDirty: true });
  };

  const hasClientFound = Boolean(lookupData?.found && lookupData?.client);
  const hasMessengerProfiles = Boolean(lookupData?.sources && lookupData.sources.length > 0);
  const activeDeals: ClientLookupDealDTO[] = lookupData?.activeDeals ?? [];
  const digitsCount = phoneInput.replace(/\D/g, "").length;

  return (
    <div className="space-y-4 rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
      {/* Шапка блока */}
      <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-[4px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <User className="h-3.5 w-3.5" />
          </div>
          <span className="text-[13px] font-semibold text-[#111111]">Клиент и сделка</span>
        </div>

        {/* Индикатор статуса клиента в CRM и мессенджерах */}
        <div className="flex items-center gap-2">
          {isLookupLoading && digitsCount >= 10 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#4a38f5] font-medium">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
              Поиск по базам мессенджеров...
            </span>
          )}

          {isLookupLoading && digitsCount < 10 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-[#888888]">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
              Поиск в CRM...
            </span>
          )}

          {!isLookupLoading && hasClientFound && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 border border-emerald-200">
              <Check className="h-3 w-3" />
              Клиент в CRM
            </span>
          )}

          {!isLookupLoading && !hasClientFound && hasMessengerProfiles && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-indigo-50 px-2 py-0.5 text-xs font-medium text-[#4a38f5] border border-indigo-200">
              <Sparkles className="h-3 w-3 text-[#4a38f5]" />
              Найден в мессенджерах
            </span>
          )}

          {!isLookupLoading && !hasClientFound && !hasMessengerProfiles && digitsCount >= 10 && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 border border-amber-200">
              <UserPlus className="h-3 w-3" />
              Новый клиент
            </span>
          )}

          {(hasClientFound || hasMessengerProfiles || customerName || phoneInput) && (
            <button
              type="button"
              onClick={handleClearCustomer}
              className="inline-flex items-center gap-1 text-[11px] text-[#888888] hover:text-rose-600 transition-colors"
              title="Очистить данные клиента"
            >
              <RotateCcw className="h-3 w-3" />
              Сбросить
            </button>
          )}
        </div>
      </div>

      {/* Основные поля ввода: Телефон, ФИО, Email */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {/* Телефон */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
            Телефон *
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#888888]">
              <Phone className="h-3.5 w-3.5" />
            </div>
            <input
              type="tel"
              value={phoneInput}
              onChange={handlePhoneChange}
              placeholder="+7 (999) 000-00-00"
              className={cn(
                "h-8 w-full rounded-[8px] border bg-white pl-8 pr-7 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                form.formState.errors.customer_phone ? "border-rose-400" : "border-[#e5e5e5]",
              )}
            />
            {isLookupLoading && (
              <div className="absolute inset-y-0 right-0 pr-2.5 flex items-center pointer-events-none">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
              </div>
            )}
          </div>
          {form.formState.errors.customer_phone && (
            <p className="text-[11px] text-rose-600">{form.formState.errors.customer_phone.message}</p>
          )}
        </div>

        {/* ФИО Клиента */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
            ФИО Клиента *
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#888888]">
              <User className="h-3.5 w-3.5" />
            </div>
            <input
              type="text"
              value={customerName}
              onChange={(e) =>
                form.setValue("customer_name", e.target.value, { shouldValidate: true, shouldDirty: true })
              }
              placeholder="Иванов Иван Иванович"
              className={cn(
                "h-8 w-full rounded-[8px] border bg-white pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                form.formState.errors.customer_name ? "border-rose-400" : "border-[#e5e5e5]",
              )}
            />
          </div>
          {form.formState.errors.customer_name && (
            <p className="text-[11px] text-rose-600">{form.formState.errors.customer_name.message}</p>
          )}

          {/* Интерактивная 1-click плашка подсказки имени */}
          {lookupData?.suggestedName && (
            <div className="pt-1">
              {customerName !== lookupData.suggestedName ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#fef08a] bg-[#fefce8] px-2.5 py-1.5 text-xs text-[#854d0e]">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="shrink-0">💡</span>
                    <span className="text-xs break-words">
                      {lookupData.suggestedSource === "telegram" ? "Telegram" : lookupData.suggestedSource === "whatsapp" ? "WhatsApp" : "Мессенджер"}:
                      {" "}
                      <strong className="font-semibold text-[#111111]">{lookupData.suggestedName}</strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleApplySuggestedName(lookupData.suggestedName!)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-[#4a38f5] px-2.5 py-1 text-[11px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
                  >
                    <Check className="h-3 w-3" />
                    Использовать
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-emerald-700">
                  <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                  <span>
                    Имя из {lookupData.suggestedSource === "telegram" ? "Telegram" : lookupData.suggestedSource === "whatsapp" ? "WhatsApp" : "мессенджера"} применено ({lookupData.suggestedName})
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Интерактивная подсказка имени из ЕГРИП / ЕГРЮЛ по ИНН (по умолчанию не перезаписывает) */}
          {!lookupData?.suggestedName && innLookupQuery.data?.directorName && customerName?.trim().toLowerCase() !== innLookupQuery.data.directorName.trim().toLowerCase() && (
            <div className="pt-1">
              <div className="flex items-center justify-between gap-1.5 rounded-[6px] border border-indigo-100 bg-indigo-50/60 px-2.5 py-1 text-xs text-indigo-950">
                <span className="flex items-center gap-1.5 truncate">
                  <span className="text-xs">💡</span>
                  <span className="truncate">
                    {innLookupQuery.data.type === "INDIVIDUAL" ? "Владелец ИП по ИНН:" : "Руководитель по ИНН:"}{" "}
                    <strong className="font-semibold text-[#111111]">{innLookupQuery.data.directorName}</strong>
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (innLookupQuery.data?.directorName) {
                      form.setValue("customer_name", innLookupQuery.data.directorName, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    }
                  }}
                  className="inline-flex shrink-0 items-center gap-1 rounded-[4px] bg-[#4a38f5] px-2 py-0.5 text-[11px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
                >
                  <Check className="h-3 w-3" />
                  Использовать
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Email */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
            Email
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[#888888]">
              <Mail className="h-3.5 w-3.5" />
            </div>
            <input
              type="email"
              value={customerEmail}
              onChange={(e) =>
                form.setValue("customer_email", e.target.value, { shouldValidate: true, shouldDirty: true })
              }
              placeholder="client@example.ru"
              className={cn(
                "h-8 w-full rounded-[8px] border bg-white pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                form.formState.errors.customer_email ? "border-rose-400" : "border-[#e5e5e5]",
              )}
            />
          </div>
          {form.formState.errors.customer_email && (
            <p className="text-[11px] text-rose-600">{form.formState.errors.customer_email.message}</p>
          )}
        </div>
      </div>

      {/* Карточка дедупликации существующего клиента CRM */}
      {lookupData?.existingContact && !isManuallyDetached && (
        <div className="rounded-[8px] border border-amber-200 bg-amber-50/50 p-3 shadow-2xs transition-all">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-amber-100 text-amber-800">
                <UserCheck className="h-4 w-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-[#111111]">
                    Клиент уже есть в базе CRM
                  </span>
                  <span className="rounded-[4px] bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800 border border-emerald-200">
                    Дедупликация активна
                  </span>
                </div>
                <p className="text-xs text-[#666666] mt-0.5">
                  {lookupData.existingContact.matchedBy === "name" ? (
                    <>
                      По запросу найден клиент <strong className="text-[#111111]">{lookupData.existingContact.fullName}</strong>
                      {lookupData.existingContact.phone ? (
                        <> (тел. <span className="font-mono tabular-nums text-[#111111] font-medium">{lookupData.existingContact.phone}</span>)</>
                      ) : null}.
                    </>
                  ) : (
                    <>
                      По номеру <span className="font-mono tabular-nums text-[#111111] font-medium">{lookupData.existingContact.phone || phoneInput}</span> найден клиент{" "}
                      <strong className="text-[#111111]">{lookupData.existingContact.fullName}</strong>.
                    </>
                  )}
                </p>
                <div className="flex items-center gap-3 mt-2 text-[11px] text-[#666666]">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#4a38f5]" />
                    Заказов в сервисе: <strong className="font-mono tabular-nums text-[#111111]">{lookupData.existingContact.repairsCount}</strong>
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Открытых сделок: <strong className="font-mono tabular-nums text-[#111111]">{lookupData.existingContact.activeDealsCount}</strong>
                  </span>
                </div>
                <p className="text-[11px] text-amber-800/90 mt-1.5">
                  Заявка будет привязана к существующему клиенту без создания дубликата.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
              {customerId === lookupData.existingContact.contactId ? (
                <span className="inline-flex items-center gap-1 rounded-[6px] bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700 border border-emerald-200">
                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                  Привязан к клиенту
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleApplyExistingContact}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors"
                >
                  <Check className="h-3.5 w-3.5" />
                  Привязать
                </button>
              )}
              <button
                type="button"
                onClick={handleClearCustomer}
                className="text-[11px] text-[#888888] hover:text-rose-600 transition-colors underline underline-offset-2"
              >
                Создать нового
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Авто-ресерч и подсказка обогащения данных по мессенджерам */}
      {isLookupLoading && digitsCount >= 10 && (
        <div className="flex items-center gap-2 rounded-[6px] border border-indigo-100 bg-indigo-50/50 px-3 py-2 text-xs text-[#4a38f5]">
          <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-[#4a38f5]" />
          <span>Поиск по базам мессенджеров (Telegram, WhatsApp, MAX)...</span>
        </div>
      )}

      {!isLookupLoading && Boolean(lookupData?.suggestedName || (lookupData?.sources && lookupData.sources.length > 0)) && (
        <div className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-2.5 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-[4px] bg-[#4a38f5]/10 text-[#4a38f5]">
                <Sparkles className="h-3 w-3" />
              </div>
              <span className="text-xs text-[#111111]">
                {lookupData?.suggestedName ? (
                  <>
                    Найдено имя: <strong className="font-semibold text-[#111111]">{lookupData.suggestedName}</strong>
                  </>
                ) : (
                  "Найдены профили в мессенджерах"
                )}
              </span>
            </div>

            {lookupData?.suggestedName && customerName !== lookupData.suggestedName && (
              <button
                type="button"
                onClick={() => handleApplySuggestedName(lookupData.suggestedName!)}
                className="inline-flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
              >
                <Check className="h-3 w-3" />
                Подставить ФИО
              </button>
            )}
          </div>

          {lookupData?.sources && lookupData.sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-[#f0f0f0]">
              <span className="text-[11px] font-medium text-[#666666]">Источники:</span>
              {lookupData.sources.map((src, i) => (
                <span
                  key={`${src.channel}-${i}`}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-[4px] border px-2 py-0.5 text-[11px] font-medium",
                    src.channel === "telegram" && "bg-sky-50 text-sky-700 border-sky-200",
                    src.channel === "whatsapp" && "bg-emerald-50 text-emerald-700 border-emerald-200",
                    src.channel === "max" && "bg-indigo-50 text-[#4a38f5] border-indigo-200",
                    src.channel === "crm" && "bg-slate-50 text-slate-700 border-slate-200",
                  )}
                >
                  {src.channel === "telegram" && <Send className="h-3 w-3" />}
                  {src.channel === "whatsapp" && <MessageCircle className="h-3 w-3" />}
                  {src.channel === "max" && <Sparkles className="h-3 w-3" />}
                  {src.channel === "crm" && <UserCheck className="h-3 w-3" />}
                  <span>
                    {src.channel === "telegram" && "Telegram"}
                    {src.channel === "whatsapp" && "WhatsApp"}
                    {src.channel === "max" && "MAX"}
                    {src.channel === "crm" && "CRM"}
                    {src.username ? `: @${src.username}` : (src.name && src.name !== "Telegram" ? `: ${src.name}` : "")}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {!isLookupLoading && !hasClientFound && (!lookupData?.sources || lookupData.sources.length === 0) && digitsCount >= 10 && (
        <div className="flex items-center gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs text-[#666666]">
          <Info className="h-3.5 w-3.5 text-[#888888] shrink-0" />
          <span>Клиент не найден в Telegram / WhatsApp / MAX. Введите ФИО вручную</span>
        </div>
      )}

      {/* Множественные контакты для связи */}
      <div className="space-y-2 pt-1 border-t border-[#f0f0f0]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
            Контакты для связи ({additionalContactFields.length})
          </span>
          <button
            type="button"
            onClick={() => appendAdditionalContact({ name: "", phone: "", role: "" })}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
          >
            <UserPlus className="h-3.5 w-3.5" />
            Добавить контакт для связи
          </button>
        </div>

        {additionalContactFields.length > 0 && (
          <div className="space-y-2">
            {additionalContactFields.map((fieldItem, index) => (
              <div
                key={fieldItem.id}
                className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2"
              >
                <div className="flex-1">
                  <input
                    type="text"
                    placeholder="Имя контакта / ФИО *"
                    {...form.register(`additional_contacts.${index}.name` as const)}
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
                <div className="w-44">
                  <input
                    type="tel"
                    placeholder="+7 (999) 000-00-00 *"
                    value={form.watch(`additional_contacts.${index}.phone`) ?? ""}
                    onChange={(e) => {
                      const formatted = formatAsYouType(e.target.value, "RU");
                      form.setValue(`additional_contacts.${index}.phone`, formatted, {
                        shouldValidate: true,
                        shouldDirty: true,
                      });
                    }}
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
                <div className="w-36">
                  <input
                    type="text"
                    placeholder="Роль (прораб, мастер...)"
                    {...form.register(`additional_contacts.${index}.role` as const)}
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeAdditionalContact(index)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                  title="Удалить контакт"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Чекбокс «Организация / Юридическое лицо» */}
      <div className="space-y-2 pt-1 border-t border-[#f0f0f0]">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={isCompanyChecked}
            onChange={(e) => handleToggleCompany(e.target.checked)}
            className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
          />
          <Building2 className="h-3.5 w-3.5 text-[#666666]" />
          <span className="text-[13px] font-medium text-[#111111]">
            Организация / Юридическое лицо
          </span>
        </label>

        {isCompanyChecked && (
          <div className="space-y-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              <div className="space-y-1 md:col-span-2">
                <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
                  Название компании / контрагента <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) =>
                    form.setValue("company_name", e.target.value, { shouldValidate: true, shouldDirty: true })
                  }
                  placeholder="ООО «Вектор», ИП Иванов"
                  className={cn(
                    "h-8 w-full rounded-[8px] border bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:outline-none focus:ring-1 transition-colors",
                    form.formState.errors.company_name
                      ? "border-rose-500 focus:border-rose-500 focus:ring-rose-500/20"
                      : "border-[#e5e5e5] focus:border-[#4a38f5] focus:ring-[#4a38f5]/20",
                  )}
                />
                {form.formState.errors.company_name && (
                  <p className="text-xs text-rose-500 mt-1">
                    {form.formState.errors.company_name.message || "Укажите название компании"}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[#666666] uppercase tracking-wider">
                    ИНН (автопоиск)
                  </label>
                  {innLookupQuery.data && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-emerald-600">
                      <Check className="h-3 w-3" /> Найдено
                    </span>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    maxLength={12}
                    value={companyInn}
                    onChange={(e) =>
                      form.setValue("company_inn", e.target.value.replace(/\D/g, ""), { shouldDirty: true })
                    }
                    placeholder="10 или 12 цифр"
                    className={cn(
                      "h-8 w-full rounded-[8px] border bg-white px-2.5 text-xs font-mono tabular-nums text-[#111111] focus:outline-none transition-colors",
                      innLookupQuery.data
                        ? "border-emerald-300 focus:border-emerald-500"
                        : "border-[#e5e5e5] focus:border-[#4a38f5]",
                      isInnLoading && "pr-7",
                    )}
                  />
                  {isInnLoading && (
                    <div className="absolute right-2 top-1/2 -translate-y-1/2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Подсказка владельца ИП / руководителя с явным действием переноса в контакт */}
            {innLookupQuery.data?.directorName && (
              <div className="rounded-[6px] border border-indigo-100 bg-indigo-50/60 p-2.5 text-xs transition-colors">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm">💡</span>
                    <div className="truncate">
                      <span className="text-[#666666]">
                        {innLookupQuery.data.type === "INDIVIDUAL" ? "Владелец ИП (ЕГРИП):" : "Руководитель (ЕГРЮЛ):"}{" "}
                      </span>
                      <strong className="font-semibold text-[#111111]">
                        {innLookupQuery.data.directorName}
                      </strong>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {customerName?.trim().toLowerCase() === innLookupQuery.data.directorName.trim().toLowerCase() ? (
                      <span className="inline-flex items-center gap-1 rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        <Check className="h-3 w-3 text-emerald-600" />
                        Контакт совпадает с {innLookupQuery.data.type === "INDIVIDUAL" ? "владельцем ИП" : "руководителем"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (innLookupQuery.data?.directorName) {
                            form.setValue("customer_name", innLookupQuery.data.directorName, {
                              shouldValidate: true,
                              shouldDirty: true,
                            });
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5] px-2.5 py-1 text-[11px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
                      >
                        <UserCheck className="h-3 w-3" />
                        {innLookupQuery.data.type === "INDIVIDUAL" ? "Использовать имя ИП для контакта" : "Использовать для контакта"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Раскрывающийся блок реквизитов */}
            <div>
              <button
                type="button"
                onClick={() => setIsRequisitesOpen(!isRequisitesOpen)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors"
              >
                {isRequisitesOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {isRequisitesOpen ? "Скрыть банковские реквизиты" : "Указать реквизиты (ОГРН, БИК, Р/с, Адрес)"}
              </button>

              {isRequisitesOpen && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-2">
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] text-[#666666]">ИНН (10 или 12 цифр)</label>
                      {innLookupQuery.data && (
                        <span className="text-[10px] text-emerald-600">✓ ЕГРЮЛ</span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type="text"
                        maxLength={12}
                        value={companyInn}
                        onChange={(e) => form.setValue("company_inn", e.target.value.replace(/\D/g, ""), { shouldDirty: true })}
                        placeholder="7701234567"
                        className={cn(
                          "h-8 w-full rounded-[8px] border bg-white px-2.5 text-xs font-mono tabular-nums text-[#111111] focus:outline-none",
                          innLookupQuery.data ? "border-emerald-300 focus:border-emerald-500" : "border-[#e5e5e5] focus:border-[#4a38f5]",
                          isInnLoading && "pr-7",
                        )}
                      />
                      {isInnLoading && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-[#666666]">ОГРН (13 или 15 цифр)</label>
                    <input
                      type="text"
                      maxLength={15}
                      value={companyOgrn}
                      onChange={(e) => form.setValue("company_ogrn", e.target.value.replace(/\D/g, ""), { shouldDirty: true })}
                      placeholder="1027700132195"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-[#666666]">БИК банка (9 цифр)</label>
                    <input
                      type="text"
                      maxLength={9}
                      value={companyBik}
                      onChange={(e) => form.setValue("company_bik", e.target.value.replace(/\D/g, ""), { shouldDirty: true })}
                      placeholder="044525225"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-[#666666]">Расчетный счет (20 цифр)</label>
                    <input
                      type="text"
                      maxLength={20}
                      value={companyAccountNumber}
                      onChange={(e) => form.setValue("company_account_number", e.target.value.replace(/\D/g, ""), { shouldDirty: true })}
                      placeholder="40702810000000000000"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[11px] text-[#666666]">Юридический адрес</label>
                    <input
                      type="text"
                      value={companyLegalAddress}
                      onChange={(e) => form.setValue("company_legal_address", e.target.value, { shouldDirty: true })}
                      placeholder="123456, г. Москва, ул. Ленина, д. 10"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Блок привязки или создания сделки */}
      <div className="pt-2 border-t border-[#f0f0f0] space-y-2.5">
        <div className="flex items-center justify-between">
          <label className="text-[11px] font-semibold text-[#666666] uppercase tracking-wider flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-[#4a38f5]" />
            Сделка в CRM
          </label>
          {dealId ? (
            <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-[4px] border border-emerald-200">
              Выбрана сделка для привязки
            </span>
          ) : (
            <span className="text-[11px] text-[#666666]">
              Будет создана новая сделка под ремонт
            </span>
          )}
        </div>

        {/* Если у найденного клиента есть активные сделки в CRM */}
        {hasClientFound && activeDeals.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-[#666666]">
              У клиента найдены открытые активные сделки. Выберите существующую сделку для связки с ремонтом или оформите новую:
            </p>

            <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
              {activeDeals.map((deal) => {
                const isSelected = dealId === deal.id;
                const isExpanded = expandedDealId === deal.id;

                return (
                  <div
                    key={deal.id}
                    onClick={() => handleSelectDeal(deal.id)}
                    className={cn(
                      "group rounded-[8px] border p-2.5 cursor-pointer transition-all",
                      isSelected
                        ? "border-[#4a38f5] bg-[#4a38f5]/[0.03] shadow-2xs"
                        : "border-[#e5e5e5] bg-white hover:border-[#cccccc] hover:bg-[#fafafa]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2.5 flex-1 min-w-0">
                        {/* Radio indicator */}
                        <div
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                            isSelected
                              ? "border-[#4a38f5] bg-[#4a38f5]"
                              : "border-[#cccccc] bg-white group-hover:border-[#999999]",
                          )}
                        >
                          {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                        </div>

                        {/* Title and stage */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[13px] font-medium text-[#111111] truncate">
                              {deal.title}
                            </span>
                            <span
                              className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium"
                              style={{
                                backgroundColor: `${deal.stageColor}18`,
                                color: deal.stageColor,
                              }}
                            >
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: deal.stageColor }}
                              />
                              {deal.stageName}
                            </span>
                          </div>

                          <div className="flex items-center gap-3 mt-1 text-[11px] text-[#666666]">
                            <span className="font-mono tabular-nums font-medium text-[#111111]">
                              {formatCurrency(deal.budget, deal.currency)}
                            </span>
                            {deal.createdAt && (
                              <span className="text-[#888888]">
                                Создана: {formatDealDate(deal.createdAt)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Кнопка подробностей (Accordion) */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedDealId(isExpanded ? null : deal.id);
                        }}
                        className="text-[#888888] hover:text-[#111111] p-1 rounded transition-colors"
                        title={isExpanded ? "Свернуть" : "Подробнее"}
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    </div>

                    {/* Развернутые детали сделки */}
                    {isExpanded && (
                      <div className="mt-2.5 pt-2 border-t border-[#f0f0f0] text-xs text-[#666666] space-y-1">
                        <div>
                          <span className="text-[#888888]">Воронка:</span>{" "}
                          <span className="text-[#111111] font-medium">{deal.pipelineName}</span>
                        </div>
                        {deal.ownerName && (
                          <div>
                            <span className="text-[#888888]">Ответственный:</span>{" "}
                            <span className="text-[#111111]">{deal.ownerName}</span>
                          </div>
                        )}
                        {deal.description ? (
                          <div className="rounded-[4px] bg-[#f9f9f9] p-2 text-[#333333] mt-1 border border-[#f0f0f0]">
                            {deal.description}
                          </div>
                        ) : (
                          <div className="text-[#888888] italic">Описание отсутствует</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Опция: «Создать новую сделку под данный ремонт» */}
              <div
                onClick={handleCreateNewDealOption}
                className={cn(
                  "group rounded-[8px] border p-2.5 cursor-pointer transition-all flex items-center gap-2.5",
                  !dealId
                    ? "border-[#4a38f5] bg-[#4a38f5]/[0.03] shadow-2xs"
                    : "border-[#e5e5e5] bg-white hover:border-[#cccccc] hover:bg-[#fafafa]",
                )}
              >
                <div
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                    !dealId
                      ? "border-[#4a38f5] bg-[#4a38f5]"
                      : "border-[#cccccc] bg-white group-hover:border-[#999999]",
                  )}
                >
                  {!dealId && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
                </div>

                <div className="flex-1 min-w-0">
                  <span className="text-[13px] font-medium text-[#111111]">
                    + Создать отдельную новую сделку под данный ремонт
                  </span>
                  <p className="text-[11px] text-[#666666]">
                    В CRM будет автоматически заведена новая сделка на начальном этапе воронки
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Если клиент не найден или у него нет активных сделок */
          <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666] flex items-center gap-2.5">
            <Sparkles className="h-4 w-4 text-[#4a38f5] shrink-0" />
            <div>
              <p className="font-medium text-[#111111]">
                {hasClientFound
                  ? "У клиента нет активных сделок — новая сделка будет создана автоматически"
                  : "Новый заказ: контакт и сделка будут созданы в CRM при сохранении"}
              </p>
              <p className="text-[11px] text-[#888888]">
                Вся история и статус ремонта будут автоматически привязаны к CRM и доступны мастеру и менеджеру.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
