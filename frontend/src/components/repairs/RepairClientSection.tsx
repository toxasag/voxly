"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import {
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Loader2,
  Mail,
  Phone,
  Plus,
  Search,
  User,
  UserCheck,
  UserPlus,
  X,
} from "lucide-react";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import {
  useDeals,
  useCreateDeal,
  usePipelines,
  useKanban,
  type DealDTO,
} from "@/lib/api/use-deals";
import {
  useContacts,
  useContact,
  useContactLookup,
  type ContactDTO,
} from "@/lib/api/use-contacts";
import {
  useCompanies,
  useCompany,
  type CompanyDTO,
} from "@/lib/api/use-companies";
import { formatAsYouType, formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

interface RepairClientSectionProps {
  form: UseFormReturn<CreateRepairPayload>;
  initialCustomerId?: string;
}

type SelectionMode = "deal" | "client" | "new";

export function RepairClientSection({ form, initialCustomerId }: RepairClientSectionProps) {
  const [mode, setMode] = useState<SelectionMode>("deal");

  // Поиск и выбор клиента
  const [clientSearch, setClientSearch] = useState("");
  const [debouncedClientSearch, setDebouncedClientSearch] = useState("");
  const [isClientDropdownOpen, setIsClientDropdownOpen] = useState(false);
  const [selectedContact, setSelectedContact] = useState<ContactDTO | null>(null);

  // Поиск и выбор сделки
  const [dealSearch, setDealSearch] = useState("");
  const [debouncedDealSearch, setDebouncedDealSearch] = useState("");
  const [isDealDropdownOpen, setIsDealDropdownOpen] = useState(false);
  const [selectedDeal, setSelectedDeal] = useState<DealDTO | null>(null);
  const [isClientDealsListOpen, setIsClientDealsListOpen] = useState(false);

  // Inline-создание новой сделки (Сценарий 2)
  const [isCreatingDealInline, setIsCreatingDealInline] = useState(false);
  const [newDealTitle, setNewDealTitle] = useState("");
  const [newDealBudget, setNewDealBudget] = useState<number>(0);
  const [newDealPipelineId, setNewDealPipelineId] = useState("");
  const [newDealStageId, setNewDealStageId] = useState("");

  // Компания и реквизиты (Сценарий 4)
  const [isCompanyEnabled, setIsCompanyEnabled] = useState(false);
  const [companySearch, setCompanySearch] = useState("");
  const [debouncedCompanySearch, setDebouncedCompanySearch] = useState("");
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<CompanyDTO | null>(null);
  const [isRequisitesOpen, setIsRequisitesOpen] = useState(false);

  const clientDropdownRef = useRef<HTMLDivElement>(null);
  const dealDropdownRef = useRef<HTMLDivElement>(null);
  const companyDropdownRef = useRef<HTMLDivElement>(null);

  const dealId = form.watch("deal_id");
  const customerId = form.watch("customer_id");
  const customerName = form.watch("customer_name");
  const customerPhone = form.watch("customer_phone");
  const customerEmail = form.watch("customer_email");
  const companyId = form.watch("company_id");
  const companyName = form.watch("company_name");
  const companyInn = form.watch("company_inn");
  const companyOgrn = form.watch("company_ogrn");
  const companyBik = form.watch("company_bik");
  const companyAccountNumber = form.watch("company_account_number");
  const companyLegalAddress = form.watch("company_legal_address");
  const estimatedCost = form.watch("estimated_cost");
  const equipmentBrand = form.watch("equipment_brand");
  const equipmentModel = form.watch("equipment_model");

  // Debounce поиска сделок (250мс)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDealSearch(dealSearch.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [dealSearch]);

  // Debounce поиска клиентов (250мс)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedClientSearch(clientSearch.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [clientSearch]);

  // Debounce поиска компаний (250мс)
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCompanySearch(companySearch.trim());
    }, 250);
    return () => clearTimeout(timer);
  }, [companySearch]);

  // Закрытие дропдаунов при клике вне
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        clientDropdownRef.current &&
        !clientDropdownRef.current.contains(event.target as Node)
      ) {
        setIsClientDropdownOpen(false);
      }
      if (
        dealDropdownRef.current &&
        !dealDropdownRef.current.contains(event.target as Node)
      ) {
        setIsDealDropdownOpen(false);
      }
      if (
        companyDropdownRef.current &&
        !companyDropdownRef.current.contains(event.target as Node)
      ) {
        setIsCompanyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Автоподгрузка начального клиента, если передан initialCustomerId
  const initialContactQuery = useContact(initialCustomerId ?? null);
  useEffect(() => {
    if (initialContactQuery.data && !selectedContact) {
      handleSelectContact(initialContactQuery.data);
    }
  }, [initialContactQuery.data, selectedContact]);

  // Запрос клиентов из CRM
  const contactsQuery = useContacts({
    search: debouncedClientSearch || undefined,
    limit: 10,
  });
  const contacts = contactsQuery.data?.items ?? [];

  // Поиск активных сделок текущего тенанта (общий режим "deal")
  const dealsQuery = useDeals({
    status: "active",
    search: debouncedDealSearch || undefined,
    limit: 10,
  });
  const allDeals = dealsQuery.data?.items ?? [];

  // Запрос активных сделок выбранного клиента (Сценарии 1 и 2)
  const activeClientId = selectedContact?.id || (customerId ? customerId : undefined);
  const clientDealsQuery = useDeals({
    contactId: activeClientId,
    status: "active",
    limit: 20,
  });
  const clientDeals = clientDealsQuery.data?.items ?? [];

  // Поиск компаний в CRM
  const companiesQuery = useCompanies({
    search: debouncedCompanySearch || undefined,
    limit: 10,
  });
  const companies = companiesQuery.data?.items ?? [];

  // Воронки для inline-создания сделки
  const pipelinesQuery = usePipelines();
  const pipelines = pipelinesQuery.data ?? [];
  const defaultPipelineId = newDealPipelineId || pipelines[0]?.id || "";

  const kanbanQuery = useKanban(defaultPipelineId || null);
  const kanbanStages = kanbanQuery.data ?? [];

  // Live-проверка номера телефона в базе CRM для дедупликации
  const lookupQuery = useContactLookup(customerPhone);
  const matchedContact = lookupQuery.data;

  // Мутация создания сделки
  const createDealMutation = useCreateDeal();

  // Автоматическая подгрузка сделки, если deal_id уже есть в форме
  useEffect(() => {
    if (dealId && !selectedDeal) {
      const foundInClient = clientDeals.find((d) => d.id === dealId);
      if (foundInClient) {
        setSelectedDeal(foundInClient);
        return;
      }
      const foundInAll = allDeals.find((d) => d.id === dealId);
      if (foundInAll) {
        setSelectedDeal(foundInAll);
      }
    }
  }, [dealId, selectedDeal, clientDeals, allDeals]);

  // Синхронизация флага организации с данными формы
  useEffect(() => {
    if (companyName || companyId || companyInn) {
      setIsCompanyEnabled(true);
    }
  }, [companyName, companyId, companyInn]);

  // -------------------------------------------------------------------------
  // ОБРАБОТЧИКИ: КЛИЕНТ
  // -------------------------------------------------------------------------

  const handleSelectContact = (contact: ContactDTO) => {
    setSelectedContact(contact);
    form.setValue("customer_id", contact.id, { shouldValidate: true });

    const fullName =
      [contact.lastName, contact.firstName, contact.middleName]
        .filter(Boolean)
        .join(" ") || `${contact.firstName} ${contact.lastName}`.trim();

    form.setValue("customer_name", fullName, { shouldValidate: true });

    if (contact.phone) {
      form.setValue("customer_phone", contact.phone, { shouldValidate: true });
    }
    if (contact.email) {
      form.setValue("customer_email", contact.email, { shouldValidate: true });
    }

    if (contact.companyName) {
      form.setValue("company_name", contact.companyName, { shouldValidate: true });
      setIsCompanyEnabled(true);
    }
    if (contact.companyId) {
      form.setValue("company_id", contact.companyId, { shouldValidate: true });
      setIsCompanyEnabled(true);
    }

    setIsClientDropdownOpen(false);
    setClientSearch("");
    setIsClientDealsListOpen(true);
  };

  const handleClearContact = () => {
    setSelectedContact(null);
    form.setValue("customer_id", "");
    form.setValue("customer_name", "");
    form.setValue("customer_phone", "");
    form.setValue("customer_email", "");
    setIsClientDealsListOpen(false);
  };

  // -------------------------------------------------------------------------
  // ОБРАБОТЧИКИ: СДЕЛКА
  // -------------------------------------------------------------------------

  const handleSelectDeal = (deal: DealDTO) => {
    setSelectedDeal(deal);
    form.setValue("deal_id", deal.id, { shouldValidate: true });

    if (deal.contactId) {
      form.setValue("customer_id", deal.contactId, { shouldValidate: true });
    }

    const clientName = deal.contactName || deal.title || "Клиент";
    form.setValue("customer_name", clientName, { shouldValidate: true });

    if (deal.contactPhone) {
      form.setValue("customer_phone", deal.contactPhone, { shouldValidate: true });
    }

    if (deal.companyName) {
      form.setValue("company_name", deal.companyName, { shouldValidate: true });
      setIsCompanyEnabled(true);
    }
    if (deal.companyId) {
      form.setValue("company_id", deal.companyId, { shouldValidate: true });
      setIsCompanyEnabled(true);
    }

    setIsDealDropdownOpen(false);
    setDealSearch("");
    setIsClientDealsListOpen(false);
  };

  const handleClearDeal = () => {
    setSelectedDeal(null);
    form.setValue("deal_id", "", { shouldValidate: true });
    if (mode === "deal") {
      form.setValue("customer_id", "");
      form.setValue("customer_name", "");
      form.setValue("customer_phone", "");
      form.setValue("company_name", "");
      form.setValue("company_id", "");
    }
  };

  // Создание сделки inline для выбранного клиента (Сценарий 2)
  const handleOpenInlineDealCreation = () => {
    const defaultTitle =
      equipmentBrand || equipmentModel
        ? `Ремонт: ${equipmentBrand} ${equipmentModel}`.trim()
        : `Ремонт оборудования (${customerName || "Клиент"})`;

    setNewDealTitle(defaultTitle);
    setNewDealBudget(estimatedCost || 0);

    const pipeId = pipelines[0]?.id || "";
    setNewDealPipelineId(pipeId);

    const stageId = kanbanStages[0]?.stageId || "";
    setNewDealStageId(stageId);

    setIsCreatingDealInline(true);
  };

  const handleCreateDealInline = async () => {
    const pipeId = newDealPipelineId || pipelines[0]?.id;
    const stageId = newDealStageId || kanbanStages[0]?.stageId;

    if (!pipeId || !stageId) {
      return;
    }

    try {
      const created = await createDealMutation.mutateAsync({
        title: newDealTitle.trim() || `Ремонт: ${customerName}`,
        budget: Number(newDealBudget) || 0,
        currency: "RUB",
        pipeline_id: pipeId,
        stage_id: stageId,
        contact_id: customerId || selectedContact?.id || undefined,
        company_id: companyId || selectedCompany?.id || undefined,
      });

      handleSelectDeal(created);
      setIsCreatingDealInline(false);
    } catch {
      // Ошибка обрабатывается react-query
    }
  };

  // -------------------------------------------------------------------------
  // ОБРАБОТЧИКИ: КОМПАНИЯ И РЕКВИЗИТЫ
  // -------------------------------------------------------------------------

  const handleSelectCompany = (comp: CompanyDTO) => {
    setSelectedCompany(comp);
    form.setValue("company_id", comp.id, { shouldValidate: true });
    form.setValue("company_name", comp.name, { shouldValidate: true });

    if (comp.requisites) {
      form.setValue("company_inn", comp.requisites.inn || "", { shouldValidate: true });
      form.setValue("company_ogrn", comp.requisites.ogrn || "", { shouldValidate: true });
      form.setValue("company_bik", comp.requisites.bik || "", { shouldValidate: true });
      form.setValue(
        "company_account_number",
        comp.requisites.accountNumber || "",
        { shouldValidate: true },
      );
      form.setValue(
        "company_legal_address",
        comp.requisites.legalAddress || "",
        { shouldValidate: true },
      );
    }

    setIsCompanyDropdownOpen(false);
    setCompanySearch("");
  };

  const handleClearCompany = () => {
    setSelectedCompany(null);
    form.setValue("company_id", "");
    form.setValue("company_name", "");
    form.setValue("company_inn", "");
    form.setValue("company_ogrn", "");
    form.setValue("company_bik", "");
    form.setValue("company_account_number", "");
    form.setValue("company_legal_address", "");
  };

  // Переключение режимов вкладки
  const handleModeChange = (newMode: SelectionMode) => {
    setMode(newMode);
    if (newMode === "new") {
      form.setValue("deal_id", "");
      setSelectedDeal(null);
      setSelectedContact(null);
    }
  };

  // Форматирование телефона на лету
  const handlePhoneChange = (raw: string) => {
    const formatted = formatAsYouType(raw, "RU");
    form.setValue("customer_phone", formatted, { shouldValidate: true });
  };

  // Подстановка данных из найденного контакта-дубликата
  const handleApplyMatchedContact = (contact: ContactDTO) => {
    handleSelectContact(contact);
  };

  const { errors } = form.formState;

  return (
    <div className="space-y-4 rounded-[12px] border border-[#e5e5e5] bg-[#fafafa]/50 p-4 transition-all">
      {/* Шапка блока и сегментный переключатель */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#4a38f5] shadow-2xs">
            <User className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[#111111]">Клиент и сделка</h3>
            <p className="text-[11px] text-[#666666]">
              Связь заказа на ремонт с клиентом, сделкой и организацией
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
            onClick={() => handleModeChange("client")}
            className={cn(
              "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 font-medium transition-all cursor-pointer",
              mode === "client"
                ? "bg-white text-[#111111] shadow-2xs"
                : "text-[#666666] hover:text-[#111111]",
            )}
          >
            <User className="h-3.5 w-3.5 text-sky-600" />
            <span>Клиент</span>
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

      {/* ------------------------------------------------------------------- */}
      {/* РЕЖИМ «КЛИЕНТ»: Сначала выбираем клиента, затем его активные сделки */}
      {/* ------------------------------------------------------------------- */}
      {mode === "client" && (
        <div className="space-y-3 pt-1">
          {!selectedContact && !customerId ? (
            <div className="relative" ref={clientDropdownRef}>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-[#888888]" />
                <input
                  type="text"
                  placeholder="Поиск клиента по имени, телефону, email или организации..."
                  value={clientSearch}
                  onFocus={() => setIsClientDropdownOpen(true)}
                  onChange={(e) => {
                    setClientSearch(e.target.value);
                    setIsClientDropdownOpen(true);
                  }}
                  className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                {clientSearch && (
                  <button
                    type="button"
                    onClick={() => {
                      setClientSearch("");
                      setIsClientDropdownOpen(false);
                    }}
                    className="absolute right-2.5 top-2.5 text-[#888888] hover:text-[#111111]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Выпадающий список клиентов */}
              {isClientDropdownOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg">
                  {contactsQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-4 text-xs text-[#666666]">
                      <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                      <span>Поиск клиентов в CRM...</span>
                    </div>
                  ) : contacts.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-xs font-medium text-[#111111]">
                        {clientSearch ? "Клиенты не найдены" : "Начните ввод имени или телефона"}
                      </p>
                      <button
                        type="button"
                        onClick={() => handleModeChange("new")}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5]/10 px-2.5 py-1 text-[11px] font-semibold text-[#4a38f5] hover:bg-[#4a38f5]/20"
                      >
                        <UserPlus className="h-3 w-3" />
                        Создать нового клиента
                      </button>
                    </div>
                  ) : (
                    contacts.map((c) => {
                      const name =
                        [c.lastName, c.firstName, c.middleName].filter(Boolean).join(" ") ||
                        c.firstName;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => handleSelectContact(c)}
                          className="flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-left transition-colors hover:bg-[#fafafa] cursor-pointer"
                        >
                          <div className="min-w-0 pr-3">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-medium text-[#111111]">
                                {name}
                              </span>
                              {c.companyName && (
                                <span className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                                  <Building2 className="h-2.5 w-2.5" />
                                  {c.companyName}
                                </span>
                              )}
                            </div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[#888888]">
                              {c.phone && <span className="font-mono">{formatPhone(c.phone)}</span>}
                              {c.email && <span>{c.email}</span>}
                            </div>
                          </div>
                          {typeof c.dealsCount === "number" && c.dealsCount > 0 && (
                            <div className="shrink-0">
                              <span className="rounded bg-sky-50 px-2 py-0.5 font-mono text-[10px] font-medium text-sky-700 border border-sky-200">
                                {c.dealsCount} сд.
                              </span>
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          ) : (
            /* Карточка выбранного клиента */
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700 border border-sky-200">
                      <User className="h-3 w-3" />
                      Клиент CRM
                    </span>
                    <span className="text-[13px] font-semibold text-[#111111]">
                      {customerName}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 pt-1 text-[12px] text-[#666666]">
                    {customerPhone && (
                      <span className="flex items-center gap-1 font-mono text-[#111111]">
                        <Phone className="h-3.5 w-3.5 text-[#888888]" />
                        {formatPhone(customerPhone)}
                      </span>
                    )}
                    {customerEmail && (
                      <span className="flex items-center gap-1 text-[#666666]">
                        <Mail className="h-3.5 w-3.5 text-[#888888]" />
                        {customerEmail}
                      </span>
                    )}
                    {companyName && (
                      <span className="flex items-center gap-1 text-[#666666]">
                        <Building2 className="h-3.5 w-3.5 text-[#888888]" />
                        {companyName}
                      </span>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleClearContact}
                  className="rounded-[6px] border border-[#e5e5e5] px-2 py-1 text-[11px] font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Сменить
                </button>
              </div>
            </div>
          )}

          {/* --------------------------------------------------------------- */}
          {/* БЛОК «ДЕЙСТВУЮЩИЕ СДЕЛКИ КЛИЕНТА» (Сценарии 1 и 2)               */}
          {/* --------------------------------------------------------------- */}
          {(selectedContact || customerId) && (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-[#4a38f5]" />
                  <span className="text-[12px] font-medium text-[#111111]">
                    Действующие сделки клиента
                  </span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.2 text-[10px] font-mono font-medium text-[#666666]">
                    {clientDealsQuery.isLoading ? "..." : clientDeals.length}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {clientDeals.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsClientDealsListOpen((prev) => !prev)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#4a38f5] hover:underline cursor-pointer"
                    >
                      <span>Выбрать действующие сделки</span>
                      {isClientDealsListOpen ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleOpenInlineDealCreation}
                    className="inline-flex items-center gap-1 rounded-[6px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-2 py-0.5 text-[11px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/15 transition-colors cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Создать сделку для клиента</span>
                  </button>
                </div>
              </div>

              {/* Выбранная сейчас сделка */}
              {selectedDeal ? (
                <div className="flex items-center justify-between rounded-[6px] border border-emerald-200 bg-emerald-50/60 p-2 text-[12px] text-emerald-950">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <div>
                      <span className="font-semibold">Привязано к сделке:</span>{" "}
                      <span>{selectedDeal.title}</span>
                      <span className="ml-2 font-mono text-[11px] font-semibold text-emerald-700">
                        {selectedDeal.budget > 0
                          ? `${selectedDeal.budget.toLocaleString("ru-RU")} ₽`
                          : "0 ₽"}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearDeal}
                    className="text-[11px] font-medium text-emerald-700 hover:text-emerald-900 underline cursor-pointer"
                  >
                    Отвязать
                  </button>
                </div>
              ) : (
                <p className="text-[11px] text-[#888888]">
                  {clientDeals.length === 0
                    ? "У клиента нет активных сделок. Вы можете создать новую в 1 клик или сделка будет создана автоматически при приёмке."
                    : "Сделка не привязана. Нажмите «Выбрать действующие сделки» для привязки к существующей."}
                </p>
              )}

              {/* Раскрывающийся список активных сделок клиента (Сценарий 1) */}
              {isClientDealsListOpen && clientDeals.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-[#f0f0f0]">
                  {clientDeals.map((deal) => {
                    const isCurrent = selectedDeal?.id === deal.id;
                    return (
                      <div
                        key={deal.id}
                        onClick={() => handleSelectDeal(deal)}
                        className={cn(
                          "flex items-center justify-between rounded-[6px] p-2 text-left transition-colors cursor-pointer border",
                          isCurrent
                            ? "border-emerald-300 bg-emerald-50/50"
                            : "border-[#e5e5e5] hover:bg-[#fafafa]",
                        )}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-[12px] font-medium text-[#111111] truncate">
                            {deal.title}
                          </p>
                          <p className="text-[10px] text-[#888888]">
                            Создана {new Date(deal.createdAt).toLocaleDateString("ru-RU")}
                          </p>
                        </div>
                        <div className="shrink-0 flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-[#111111]">
                            {deal.budget > 0
                              ? `${deal.budget.toLocaleString("ru-RU")} ₽`
                              : "Без суммы"}
                          </span>
                          <span
                            className={cn(
                              "rounded px-2 py-0.5 text-[10px] font-medium",
                              isCurrent
                                ? "bg-emerald-600 text-white"
                                : "bg-[#4a38f5]/10 text-[#4a38f5]",
                            )}
                          >
                            {isCurrent ? "Выбрана" : "Привязать"}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline-форма создания новой сделки (Сценарий 2) */}
              {isCreatingDealInline && (
                <div className="rounded-[8px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 p-3 space-y-2.5 animate-in fade-in duration-150">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-semibold text-[#111111]">
                      Новая сделка для клиента
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsCreatingDealInline(false)}
                      className="text-[#888888] hover:text-[#111111]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[11px] font-medium text-[#666666]">
                        Название сделки *
                      </label>
                      <input
                        type="text"
                        value={newDealTitle}
                        onChange={(e) => setNewDealTitle(e.target.value)}
                        placeholder="Название сделки..."
                        className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-[#666666]">Воронка</label>
                      <select
                        value={defaultPipelineId}
                        onChange={(e) => setNewDealPipelineId(e.target.value)}
                        className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      >
                        {pipelines.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-[#666666]">
                        Предварительный бюджет (₽)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={newDealBudget === 0 ? "" : newDealBudget}
                        onChange={(e) => setNewDealBudget(Number(e.target.value) || 0)}
                        placeholder="0 ₽"
                        className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setIsCreatingDealInline(false)}
                      className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-[11px] font-medium text-[#666666] hover:bg-slate-50 cursor-pointer"
                    >
                      Отмена
                    </button>
                    <button
                      type="button"
                      disabled={createDealMutation.isPending}
                      onClick={handleCreateDealInline}
                      className="flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-3 py-1 text-[11px] font-semibold text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {createDealMutation.isPending && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                      <span>Создать и привязать</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* РЕЖИМ «ВЫБРАТЬ СДЕЛКУ»: Прямой поиск активной сделки CRM           */}
      {/* ------------------------------------------------------------------- */}
      {mode === "deal" && (
        <div className="space-y-3 pt-1">
          {!selectedDeal ? (
            <div className="relative" ref={dealDropdownRef}>
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
                  ) : allDeals.length === 0 ? (
                    <div className="p-4 text-center">
                      <p className="text-xs font-medium text-[#111111]">
                        {dealSearch ? "Сделки не найдены" : "Начните ввод для поиска сделки"}
                      </p>
                      <p className="mt-1 text-[11px] text-[#888888]">
                        Или переключитесь на «Новый клиент / сделка» для быстрого создания
                      </p>
                    </div>
                  ) : (
                    allDeals.map((deal) => (
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
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* РЕЖИМ «НОВЫЙ КЛИЕНТ / СДЕЛКА»: Ввод нового контакта с дедупликацией */}
      {/* ------------------------------------------------------------------- */}
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

          {/* Email клиента */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-[#666666]">Email клиента</label>
            <input
              type="email"
              placeholder="client@company.ru"
              value={customerEmail || ""}
              onChange={(e) =>
                form.setValue("customer_email", e.target.value, { shouldValidate: true })
              }
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
                    {[matchedContact.lastName, matchedContact.firstName].filter(Boolean).join(" ") ||
                      "Клиент"}
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

      {/* ------------------------------------------------------------------- */}
      {/* СЕКЦИЯ: ОРГАНИЗАЦИЯ И РЕКВИЗИТЫ КОНТРАГЕНТА (Сценарий 4 - B2B RMA) */}
      {/* ------------------------------------------------------------------- */}
      <div className="pt-2 border-t border-[#f0f0f0] space-y-3">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={isCompanyEnabled}
              onChange={(e) => {
                setIsCompanyEnabled(e.target.checked);
                if (!e.target.checked) {
                  handleClearCompany();
                }
              }}
              className="h-4 w-4 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]/20"
            />
            <span className="text-[12px] font-medium text-[#111111] flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5 text-[#666666]" />
              Организация / Юридическое лицо
            </span>
          </label>

          {isCompanyEnabled && (
            <button
              type="button"
              onClick={() => setIsRequisitesOpen((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
            >
              <FileText className="h-3 w-3" />
              <span>{isRequisitesOpen ? "Скрыть реквизиты" : "Реквизиты (ИНН, БИК, р/с)"}</span>
              {isRequisitesOpen ? (
                <ChevronUp className="h-3 w-3" />
              ) : (
                <ChevronDown className="h-3 w-3" />
              )}
            </button>
          )}
        </div>

        {isCompanyEnabled && (
          <div className="space-y-3 rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-2xs animate-in fade-in duration-150">
            {/* Поле наименования компании с поиском в базе */}
            <div className="space-y-1 relative" ref={companyDropdownRef}>
              <label className="text-[11px] font-medium text-[#666666]">
                Наименование организации
              </label>
              <div className="relative">
                <input
                  type="text"
                  placeholder="ООО Ромашка или Частное лицо"
                  value={companyName || ""}
                  onFocus={() => {
                    if (companies.length > 0) setIsCompanyDropdownOpen(true);
                  }}
                  onChange={(e) => {
                    form.setValue("company_name", e.target.value, { shouldValidate: true });
                    setCompanySearch(e.target.value);
                    setIsCompanyDropdownOpen(true);
                  }}
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] shadow-2xs transition-colors focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                {companyId && (
                  <button
                    type="button"
                    onClick={handleClearCompany}
                    className="absolute right-2.5 top-2 text-[#888888] hover:text-[#111111]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Выпадающий список найденных компаний */}
              {isCompanyDropdownOpen && companySearch && (
                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg">
                  {companiesQuery.isLoading ? (
                    <div className="flex items-center justify-center gap-2 p-3 text-xs text-[#666666]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                      <span>Поиск компаний...</span>
                    </div>
                  ) : companies.length === 0 ? (
                    <div className="p-3 text-center text-xs text-[#888888]">
                      Компании не найдены. Будет сохранена новая организация.
                    </div>
                  ) : (
                    companies.map((comp) => (
                      <button
                        key={comp.id}
                        type="button"
                        onClick={() => handleSelectCompany(comp)}
                        className="flex w-full items-center justify-between rounded-[6px] px-2.5 py-1.5 text-left text-[12px] hover:bg-[#fafafa] transition-colors cursor-pointer"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="font-medium text-[#111111] truncate block">
                            {comp.name}
                          </span>
                          {comp.requisites?.inn && (
                            <span className="text-[10px] text-[#888888] font-mono">
                              ИНН: {comp.requisites.inn}
                            </span>
                          )}
                        </div>
                        <span className="shrink-0 text-[10px] text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded border border-sky-200">
                          Из базы
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Раскрывающиеся реквизиты контрагента */}
            {isRequisitesOpen && (
              <div className="pt-2 border-t border-[#f0f0f0] grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    ИНН (10 или 12 цифр)
                  </label>
                  <input
                    type="text"
                    maxLength={12}
                    placeholder="7701234567"
                    value={companyInn || ""}
                    onChange={(e) =>
                      form.setValue("company_inn", e.target.value.replace(/[^\d]/g, ""), {
                        shouldValidate: true,
                      })
                    }
                    className={cn(
                      "h-8 w-full rounded-[6px] border bg-white px-2.5 font-mono text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none",
                      errors.company_inn ? "border-rose-300" : "border-[#e5e5e5]",
                    )}
                  />
                  {errors.company_inn && (
                    <p className="text-[10px] text-rose-600">{errors.company_inn.message}</p>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">ОГРН / ОГРНИП</label>
                  <input
                    type="text"
                    maxLength={15}
                    placeholder="1027700132195"
                    value={companyOgrn || ""}
                    onChange={(e) =>
                      form.setValue("company_ogrn", e.target.value.replace(/[^\d]/g, ""), {
                        shouldValidate: true,
                      })
                    }
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">БИК банка</label>
                  <input
                    type="text"
                    maxLength={9}
                    placeholder="044525225"
                    value={companyBik || ""}
                    onChange={(e) =>
                      form.setValue("company_bik", e.target.value.replace(/[^\d]/g, ""), {
                        shouldValidate: true,
                      })
                    }
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">Расчетный счет</label>
                  <input
                    type="text"
                    maxLength={20}
                    placeholder="40702810938000000000"
                    value={companyAccountNumber || ""}
                    onChange={(e) =>
                      form.setValue(
                        "company_account_number",
                        e.target.value.replace(/[^\d]/g, ""),
                        { shouldValidate: true },
                      )
                    }
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>

                <div className="space-y-1 sm:col-span-2">
                  <label className="text-[11px] font-medium text-[#666666]">Юридический адрес</label>
                  <input
                    type="text"
                    placeholder="г. Москва, ул. Примерная, д. 10, оф. 20"
                    value={companyLegalAddress || ""}
                    onChange={(e) =>
                      form.setValue("company_legal_address", e.target.value, {
                        shouldValidate: true,
                      })
                    }
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Ошибки валидации блока клиента */}
      {errors.customer_name && mode === "deal" && (
        <p className="text-[11px] text-rose-600">{errors.customer_name.message}</p>
      )}
    </div>
  );
}
