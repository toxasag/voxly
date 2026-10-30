"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  Bot,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronUp,
  CircleSlash,
  Compass,
  Copy,
  DollarSign,
  Globe,
  Handshake,
  History,
  Laptop,
  Linkedin,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Search,
  Share2,
  Smartphone,
  Star,
  Target,
  User,
  UserCircle2,
  UserRound,
} from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { useKanban, useMoveDealStage, useUpdateDeal } from "@/lib/api/use-deals";
import { useCompanies, useCompany, useUpdateCompany, useCompanyStats, type CompanyDTO } from "@/lib/api/use-companies";
import { contactFullName, useContacts, useContact, useUpdateContact, useCreateContact, type ContactDTO } from "@/lib/api/use-contacts";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { Sheet } from "@/components/ui/sheet";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import { DrawerCreateContact } from "@/components/crm/deals/DrawerCreateContact";
import { ContactCard } from "@/components/crm/contacts/ContactCard";
import { CompanyCard } from "@/components/crm/companies/CompanyCard";
import { ContactModal } from "@/components/crm/contacts/ContactModal";
import { CompanyModal } from "@/components/crm/companies/CompanyModal";
import { PhonesInput } from "@/components/crm/shared/PhonesInput";
import { EmailsInput } from "@/components/crm/shared/EmailsInput";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import { formatSocialDisplay, isDisplayableSocial, socialHref, socialIcon, socialLabel } from "@/lib/crm/socials";
import type { ContactChannel, ContactPhoneInput, ContactSocialInput } from "@/schemas/contact.schema";
import { extractContactEmails, prepareEmailsPayload } from "@/lib/crm/emails";
import { formatPhone, telHref } from "@/lib/utils/phone";
import { RecordNotesTab } from "@/components/crm/shared/RecordNotesTab";
import { RecordTimelineTab } from "@/components/crm/shared/RecordTimelineTab";
import { RecordTasksTab } from "@/components/crm/shared/RecordTasksTab";
import { DealContactHistoryTab } from "./DealContactHistoryTab";
import { DealAnalyticsTab } from "./DealAnalyticsTab";
import { SourceMetadataTab } from "@/components/crm/shared/SourceMetadataTab";
import { CrmChatView } from "@/components/crm/shared/CrmChatView";
import type { DealDTO, PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { cn, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Содержимое карточки сделки: вкладки «Главная», «Чат», «Задачи», «Файлы».
//
// Вынесено из `DealDrawer.tsx`, чтобы у сделки был один экран деталей, а не два.
// Раньше их было два, и второй был слабее: `DealDrawer` давал пять вкладок и
// inline-правку, а `/crm/deals/[id]` — три жёсткие колонки, из которых две
// заполнены заглушками («Эндпоинты связей … реализуются отдельными
// вертикальными срезами»), без задач, заметок и правки, и с сырыми `stageId` /
// `pipelineId` в деталях. Чат был реализован дважды (`ChatTab` здесь и
// `CenterPanel` на странице), и любая правка переписки делалась в двух местах —
// статус доставки сообщения пришлось добавлять дважды буквально.
//
// Удалить страницу было нельзя: на неё ведут уведомления
// (`NotificationDropdown`) и запасная ветка карточки канбана (`DealCard`), и
// ссылки стали бы битыми. Поэтому она осталась точкой входа по ссылке, но
// рендерит это же содержимое.
//
// Границы: здесь только вкладки. Оболочка (панель справа или полный экран) —
// дело вызывающего, потому что она и различает два способа открытия.
// ---------------------------------------------------------------------------

/** Имя и цвет этапа: сделка знает `stageId`, а показать нужно название. */
export interface DealStageInfo {
  name: string;
  colorKey?: string;
  isWon: boolean;
  isLost: boolean;
}

/** Контекст, который приходит со страницы: справочники грузит она, не вкладка. */
export interface DealTabsContext {
  usersById: Map<string, TenantUserDTO>;
  pipelines?: PipelineDTO[];
  stagesById?: Map<string, DealStageInfo>;
  onRequestCreateCompany?: () => void;
  onRequestCreateContact?: () => void;
}

/**
 * Строка поля карточки записи.
 *
 * Геометрия как у Twenty (`RecordInlineCellContainer`): колонка лейбла 90px,
 * значение слева сразу за ней. Прежний вариант прижимал значение к правому краю
 * — при разной длине значений колонка визуально ломалась, и связанные поля
 * (компания, контакт, владелец) не читались как список.
 */
function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
      <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#111111]">{children}</span>
    </div>
  );
}

function ChatTab({ dealId, dealTitle }: { dealId: string; dealTitle?: string }) {
  return (
    <div className="h-full min-h-[450px]">
      <CrmChatView entityType="deal" entityId={dealId} entityName={dealTitle} />
    </div>
  );
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * Вкладка «Главная» карточки сделки.
 *
 * Группы и порядок полей — из метаданных Twenty
 * (`compute-standard-opportunity-view-fields.util.ts`, представление
 * `opportunityRecordPageFields`):
 *
 *   deal:      amount (0), stage (1), closeDate (2)
 *   relations: company (0), pointOfContact (1), owner (2)
 *   system:    createdAt (0), createdBy (1), updatedAt (2, скрыт)
 *
 * Названия групп — их `getStandardViewFieldGroupNames` (Deal, Relations,
 * System). Воронка — наше поле (у Twenty один пайплайн на объект), отнесено к
 * Deal рядом с этапом: этап без воронки не читается.
 */
function HomeTab({
  deal,
  usersById,
  pipelines,
  stagesById,
  onRequestCreateCompany,
  onRequestCreateContact,
}: {
  deal: DealDTO;
  usersById: Map<string, TenantUserDTO>;
  pipelines?: PipelineDTO[];
  stagesById?: Map<string, DealStageInfo>;
  onRequestCreateCompany?: () => void;
  onRequestCreateContact?: () => void;
}) {
  const [dealOpen, setDealOpen] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(true);
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [contactCardOpen, setContactCardOpen] = useState(true);
  const [companyCardOpen, setCompanyCardOpen] = useState(true);
  const [ownerCardOpen, setOwnerCardOpen] = useState(true);

  // Подсекции контакта в карточке сделки (по ТЗ: ФИО, Общее, Социальные сети)
  const [contactFioOpen, setContactFioOpen] = useState(true);
  const [contactGeneralOpen, setContactGeneralOpen] = useState(true);
  const [contactSocialsOpen, setContactSocialsOpen] = useState(true);

  // Редактирование суммы
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState(String(deal.budget));

  // Редактирование даты закрытия
  const [isEditingCloseDate, setIsEditingCloseDate] = useState(false);

  // Поповеры выбора: "stage" | "company" | "contact" | "owner"
  const [activePicker, setActivePicker] = useState<"stage" | "company" | "contact" | "owner" | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<"row" | "card">("row");
  const [pickerSearch, setPickerSearch] = useState("");

  const updateDeal = useUpdateDeal();
  const moveStage = useMoveDealStage();

  const kanban = useKanban(deal.pipelineId);
  const companiesQuery = useCompanies({ limit: 100 });
  const contactsQuery = useContacts({ limit: 100 });
  const [localCreateDrawer, setLocalCreateDrawer] = useState<"company" | "contact" | null>(null);

  const owner = deal.ownerId !== null ? usersById.get(deal.ownerId) : undefined;
  const creator = usersById.get(deal.createdBy);
  const pipelineName = pipelines?.find((pipeline) => pipeline.id === deal.pipelineId)?.name;
  const stage = stagesById?.get(deal.stageId);

  const linkedContact = contactsQuery.data?.items.find((c) => c.id === deal.contactId);
  const linkedContactQuery = useContact(deal.contactId);
  const fullLinkedContact = linkedContactQuery.data ?? linkedContact;
  const updateContact = useUpdateContact();

  const linkedCompany = companiesQuery.data?.items.find((c) => c.id === deal.companyId);
  const linkedCompanyQuery = useCompany(deal.companyId);
  const fullLinkedCompany = linkedCompanyQuery.data ?? linkedCompany;
  const updateCompany = useUpdateCompany();
  const companyStats = useCompanyStats(deal.companyId);

  const [contactCardDrawerOpen, setContactCardDrawerOpen] = useState(false);
  const [companyCardDrawerOpen, setCompanyCardDrawerOpen] = useState(false);
  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);
  const [createCompanyContactOpen, setCreateCompanyContactOpen] = useState(false);

  const createContact = useCreateContact();
  const companyContactsQuery = useContacts({ companyId: deal.companyId ?? undefined, limit: 50 });

  const [editingContactField, setEditingContactField] = useState<
    "lastName" | "firstName" | "middleName" | "phones" | "emails" | "socials" | "linkedin" | null
  >(null);
  const [contactFieldDraft, setContactFieldDraft] = useState("");
  const [contactSocialsDraft, setContactSocialsDraft] = useState<ContactSocialInput[]>([]);
  const [contactPhonesDraft, setContactPhonesDraft] = useState<ContactPhoneInput[]>([]);
  const [contactEmailsDraft, setContactEmailsDraft] = useState<string[]>([]);

  const [editingCompanyField, setEditingCompanyField] = useState<"name" | "phone" | "email" | "domain" | null>(null);
  const [companyFieldDraft, setCompanyFieldDraft] = useState("");

  const contactPhone = deal.contactPhone || (fullLinkedContact?.phones?.[0]?.number ?? null);
  const contactEmail = deal.contactEmail || fullLinkedContact?.email || null;
  const contactJobTitle = deal.contactJobTitle || fullLinkedContact?.jobTitle || null;

  const contactPhonesList: ContactPhoneInput[] = useMemo(() => {
    if (fullLinkedContact?.phones && fullLinkedContact.phones.length > 0) {
      return fullLinkedContact.phones.map((p) => ({
        number: p.number,
        country_code: p.countryCode ?? "RU",
        calling_code: p.callingCode ?? "+7",
      }));
    }
    if (contactPhone) {
      return [{ number: contactPhone, country_code: "RU", calling_code: "+7" }];
    }
    return [];
  }, [fullLinkedContact?.phones, contactPhone]);

  const contactEmailsList: string[] = useMemo(() => {
    if (fullLinkedContact) {
      const list = extractContactEmails(fullLinkedContact);
      if (list.length > 0) return list;
    }
    if (contactEmail && contactEmail.trim()) {
      return [contactEmail.trim()];
    }
    return [];
  }, [fullLinkedContact, contactEmail]);

  const startContactPhonesEdit = () => {
    setContactPhonesDraft(contactPhonesList.length > 0 ? contactPhonesList : [{ number: "", country_code: "RU", calling_code: "+7" }]);
    setEditingContactField("phones");
  };

  const startContactEmailsEdit = () => {
    setContactEmailsDraft(contactEmailsList.length > 0 ? contactEmailsList : [""]);
    setEditingContactField("emails");
  };

  const companyPhone = deal.companyPhone || fullLinkedCompany?.phone || null;
  const companyEmail = deal.companyEmail || fullLinkedCompany?.email || null;
  const companyWebsite = deal.companyWebsite || fullLinkedCompany?.domainName || null;

  const resolvedContact: ContactDTO | null = fullLinkedContact ?? (deal.contactId ? {
    id: deal.contactId,
    firstName: deal.contactName?.split(" ")[1] ?? deal.contactName ?? "",
    lastName: deal.contactName?.split(" ")[0] ?? "",
    middleName: deal.contactName?.split(" ")[2] ?? "",
    phone: contactPhone ?? "",
    phones: contactPhone ? [{ number: contactPhone, countryCode: "RU", callingCode: "+7", isPrimary: true }] : [],
    email: contactEmail ?? null,
    telegramUsername: null,
    whatsapp: null,
    socials: [],
    jobTitle: contactJobTitle ?? "",
    companyName: deal.companyName ?? "",
    companyId: deal.companyId ?? null,
    channel: "phone" as ContactChannel,
    linkedinLink: "",
    customFields: {},
    notes: "",
    createdBy: null,
    createdByName: null,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    dealsCount: 1,
    tasksCount: 0,
  } : null);

  const resolvedCompany: CompanyDTO | null = fullLinkedCompany ?? (deal.companyId ? {
    id: deal.companyId,
    name: deal.companyName ?? "",
    domainName: companyWebsite ?? "",
    phone: companyPhone ?? "",
    email: companyEmail ?? "",
    requisites: { inn: "", ogrn: "", bik: "", accountNumber: "", legalAddress: "" },
    managerName: "",
    managerId: null,
    annualRevenue: null,
    linkedinLink: "",
    address: { city: "", street: "", country: "", postcode: "" },
    notes: "",
    customFields: {},
    createdBy: null,
    createdByName: null,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
    contactsCount: deal.contactId ? 1 : 0,
    dealsCount: 1,
    dealsBudgetTotal: deal.budget ?? 0,
  } : null);

  const commitContactEdit = (field: "lastName" | "firstName" | "middleName" | "phones" | "emails" | "socials" | "linkedin") => {
    if (!deal.contactId) {
      setEditingContactField(null);
      return;
    }
    const val = contactFieldDraft.trim();
    if (field === "lastName") {
      updateContact.mutate(
        { id: deal.contactId, payload: { last_name: val } },
        {
          onSuccess: () => toast.success("Фамилия контакта обновлена"),
          onError: (e) => toast.error(e.message || "Ошибка обновления контакта"),
        }
      );
    } else if (field === "firstName") {
      if (!val) {
        toast.error("Имя обязательно для заполнения");
        return;
      }
      updateContact.mutate(
        { id: deal.contactId, payload: { first_name: val } },
        {
          onSuccess: () => toast.success("Имя контакта обновлено"),
          onError: (e) => toast.error(e.message || "Ошибка обновления контакта"),
        }
      );
    } else if (field === "middleName") {
      updateContact.mutate(
        { id: deal.contactId, payload: { middle_name: val } },
        {
          onSuccess: () => toast.success("Отчество контакта обновлено"),
          onError: (e) => toast.error(e.message || "Ошибка обновления контакта"),
        }
      );
    } else if (field === "phones") {
      updateContact.mutate(
        {
          id: deal.contactId,
          payload: {
            phones: contactPhonesDraft,
          },
        },
        {
          onSuccess: () => toast.success("Телефоны контакта обновлены"),
          onError: (e) => toast.error(e.message || "Ошибка обновления телефонов"),
        }
      );
    } else if (field === "emails") {
      const payload = prepareEmailsPayload(contactEmailsDraft, fullLinkedContact?.customFields);
      updateContact.mutate(
        { id: deal.contactId, payload },
        {
          onSuccess: () => toast.success("Email контакта обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления email"),
        }
      );
    } else if (field === "socials") {
      updateContact.mutate(
        { id: deal.contactId, payload: { socials: contactSocialsDraft } },
        {
          onSuccess: () => toast.success("Социальные сети контакта обновлены"),
          onError: (e) => toast.error(e.message || "Ошибка обновления социальных сетей"),
        }
      );
    } else if (field === "linkedin") {
      updateContact.mutate(
        { id: deal.contactId, payload: { linkedin_link: val ? normalizeUrl(val) : "" } },
        {
          onSuccess: () => toast.success("LinkedIn контакта обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления LinkedIn"),
        }
      );
    }
    setEditingContactField(null);
  };

  const commitCompanyEdit = (field: "name" | "phone" | "email" | "domain") => {
    if (!deal.companyId) {
      setEditingCompanyField(null);
      return;
    }
    const val = companyFieldDraft.trim();
    if (field === "name" && val) {
      updateCompany.mutate(
        { id: deal.companyId, payload: { name: val } },
        {
          onSuccess: () => toast.success("Компания обновлена"),
          onError: (e) => toast.error(e.message || "Ошибка обновления компании"),
        }
      );
    } else if (field === "phone") {
      updateCompany.mutate(
        { id: deal.companyId, payload: { phone: val } },
        {
          onSuccess: () => toast.success("Телефон компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления телефона"),
        }
      );
    } else if (field === "email") {
      updateCompany.mutate(
        { id: deal.companyId, payload: { email: val } },
        {
          onSuccess: () => toast.success("Email компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления email"),
        }
      );
    } else if (field === "domain") {
      updateCompany.mutate(
        { id: deal.companyId, payload: { domain_name: val.replace(/^https?:\/\//, "") } },
        {
          onSuccess: () => toast.success("Домен компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления домена"),
        }
      );
    }
    setEditingCompanyField(null);
  };

  const dateOnly = (iso: string): string =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));

  const fullDate = (iso: string): string => {
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(parsed);
  };

  const stagesList = useMemo(() => {
    if (kanban.data && kanban.data.length > 0) {
      return kanban.data.map((c) => ({
        stageId: c.stageId,
        stageName: c.stageName,
        stageColor: c.stageColor,
        isWon: c.isWon,
        isLost: c.isLost,
      }));
    }
    if (stagesById) {
      return Array.from(stagesById.entries()).map(([id, info]) => ({
        stageId: id,
        stageName: info.name,
        stageColor: info.colorKey,
        isWon: info.isWon,
        isLost: info.isLost,
      }));
    }
    return [];
  }, [kanban.data, stagesById]);

  const filteredStages = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return stagesList;
    return stagesList.filter((s) => s.stageName.toLowerCase().includes(q));
  }, [stagesList, pickerSearch]);

  const filteredCompanies = useMemo(() => {
    const items = companiesQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [companiesQuery.data?.items, pickerSearch]);

  const filteredContacts = useMemo(() => {
    const items = contactsQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => contactFullName(c).toLowerCase().includes(q));
  }, [contactsQuery.data?.items, pickerSearch]);

  const filteredUsers = useMemo(() => {
    const items = Array.from(usersById.values());
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usersById, pickerSearch]);

  const commitBudget = () => {
    const num = Number(budgetVal);
    if (!isNaN(num) && num >= 0 && num !== deal.budget) {
      updateDeal.mutate(
        { id: deal.id, pipelineId: deal.pipelineId, payload: { budget: num } },
        {
          onSuccess: () => toast.success("Сумма обновлена"),
          onError: (err) => toast.error(err.message || "Ошибка обновления суммы"),
        },
      );
    }
    setIsEditingBudget(false);
  };

  const openPicker = (type: "stage" | "company" | "contact" | "owner", anchor: "row" | "card") => {
    setActivePicker(type);
    setPickerAnchor(anchor);
    setPickerSearch("");
  };

  const renderCompanyPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { company_id: "" } },
                {
                  onSuccess: () => toast.success("Компания очищена"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              deal.companyId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Компания</span>
            </div>
            {deal.companyId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredCompanies.map((comp) => {
            const isSelected = comp.id === deal.companyId;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => {
                  if (comp.id !== deal.companyId) {
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { company_id: comp.id } },
                      {
                        onSuccess: () => toast.success("Компания обновлена"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border font-bold text-[9px]",
                      paletteFor(comp.name),
                    )}
                  >
                    {chipInitials(comp.name)}
                  </span>
                  <span className="truncate">{comp.name}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#f0f0f0] pt-1 mt-1">
          <button
            type="button"
            title="Добавить новую компанию"
            onClick={() => {
              setActivePicker(null);
              if (onRequestCreateCompany) {
                onRequestCreateCompany();
              } else {
                setLocalCreateDrawer("company");
              }
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Добавить новый</span>
          </button>
        </div>
      </div>
    </>
  );

  const renderContactPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { contact_id: "" } },
                {
                  onSuccess: () => toast.success("Контакт очищен"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              deal.contactId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Контактное лицо</span>
            </div>
            {deal.contactId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredContacts.map((contact) => {
            const isSelected = contact.id === deal.contactId;
            const name = contactFullName(contact);
            return (
              <button
                key={contact.id}
                type="button"
                onClick={() => {
                  if (contact.id !== deal.contactId) {
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { contact_id: contact.id } },
                      {
                        onSuccess: () => toast.success("Контакт обновлён"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <span
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border font-bold text-[9px]",
                      paletteFor(name),
                    )}
                  >
                    {chipInitials(name)}
                  </span>
                  <span className="truncate">{name}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="border-t border-[#f0f0f0] pt-1 mt-1">
          <button
            type="button"
            title="Добавить новый контакт"
            onClick={() => {
              setActivePicker(null);
              if (onRequestCreateContact) {
                onRequestCreateContact();
              } else {
                setLocalCreateDrawer("contact");
              }
            }}
            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Добавить новый</span>
          </button>
        </div>
      </div>
    </>
  );

  const renderOwnerPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="px-2 py-1.5 border-b border-[#f0f0f0] mb-1">
          <input
            type="text"
            placeholder="Поиск"
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { owner_id: "" } },
                {
                  onSuccess: () => toast.success("Ответственный очищен"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              deal.ownerId === null && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Владелец</span>
            </div>
            {deal.ownerId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredUsers.map((user) => {
            const isSelected = user.id === deal.ownerId;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  if (user.id !== deal.ownerId) {
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { owner_id: user.id } },
                      {
                        onSuccess: () => toast.success("Ответственный обновлён"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <UserAvatar user={user} fallbackLabel="?" size="sm" />
                  <span className="truncate">{user.fullName}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  return (
    <div className="py-2 text-[#111111]">
      {deal.description !== "" && (
        <div className="px-4 pb-3">
          <p className="whitespace-pre-wrap rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2 text-[13px] text-[#333333]">
            {deal.description}
          </p>
        </div>
      )}

      {/* Accordion Group 1: Сделка */}
      <div className="mt-1">
        <button
          type="button"
          title="Свернуть / развернуть секцию «Сделка»"
          onClick={() => setDealOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Сделка</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !dealOpen && "rotate-180")} />
        </button>
        {dealOpen && (
          <div className="space-y-0.5 py-0.5">
            {/* Сумма */}
            <FieldRow icon={DollarSign} label="Сумма">
              {isEditingBudget ? (
                <div className="inline-flex items-center rounded-[6px] border border-[#3b82f6] bg-white shadow-xs overflow-hidden">
                  <div className="flex items-center gap-1 bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#666666] border-r border-[#e5e5e5] select-none">
                    <span>{deal.currency}</span>
                  </div>
                  <div className="flex items-center px-2 py-1 gap-1">
                    <span className="text-xs text-[#888888]">₽</span>
                    <input
                      type="number"
                      min="0"
                      value={budgetVal}
                      onChange={(e) => setBudgetVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitBudget();
                        } else if (e.key === "Escape") {
                          setIsEditingBudget(false);
                        }
                      }}
                      onBlur={commitBudget}
                      className="w-24 bg-transparent text-xs font-medium text-[#111111] outline-none tabular-nums"
                      autoFocus
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  title="Нажмите для редактирования суммы"
                  onClick={() => {
                    setIsEditingBudget(true);
                    setBudgetVal(String(deal.budget));
                  }}
                  className="group/btn inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left font-normal text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                >
                  <span className="tabular-nums">
                    {new Intl.NumberFormat("ru-RU", { style: "currency", currency: deal.currency, maximumFractionDigits: 0 }).format(deal.budget)}
                  </span>
                  <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                </button>
              )}
            </FieldRow>

            {/* Этап */}
            <FieldRow icon={CheckCircle2} label="Этап">
              <div className="relative inline-block">
                <button
                  type="button"
                  title="Нажмите для выбора этапа"
                  onClick={() => openPicker("stage", "row")}
                  className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                >
                  {stage === undefined ? (
                    <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
                  ) : (
                    <TagPill color={stage.isWon ? "emerald" : stage.isLost ? "rose" : stageTagColor(stage.colorKey)}>
                      {stage.name}
                    </TagPill>
                  )}
                </button>

                {activePicker === "stage" && (
                  <>
                    <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                      <div className="px-1.5 pb-1.5 border-b border-[#f0f0f0] mb-1">
                        <input
                          type="text"
                          placeholder="Поиск"
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none py-0.5"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto space-y-0.5">
                        {filteredStages.map((st) => {
                          const isSelected = st.stageId === deal.stageId;
                          return (
                            <button
                              key={st.stageId}
                              type="button"
                              title={`Выбрать этап «${st.stageName}»`}
                              onClick={() => {
                                if (st.stageId !== deal.stageId) {
                                  moveStage.mutate(
                                    { id: deal.id, stageId: st.stageId, pipelineId: deal.pipelineId },
                                    {
                                      onSuccess: () => toast.success("Этап обновлён"),
                                      onError: (err) => toast.error(err.message || "Ошибка обновления этапа"),
                                    },
                                  );
                                }
                                setActivePicker(null);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs transition-colors hover:bg-[#f5f5f5]",
                                isSelected && "bg-[#f5f5f5]",
                              )}
                            >
                              <TagPill color={st.isWon ? "emerald" : st.isLost ? "rose" : stageTagColor(st.stageColor)}>
                                {st.stageName}
                              </TagPill>
                              {isSelected && <Check className="h-3.5 w-3.5 text-[#111111]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </FieldRow>

            {/* Дата Закрытия */}
            <FieldRow icon={Calendar} label="Дата Закрытия">
              {isEditingCloseDate ? (
                <div className="inline-flex items-center gap-2">
                  <input
                    type="date"
                    defaultValue={deal.closeDate ? deal.closeDate.slice(0, 10) : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDeal.mutate(
                        { id: deal.id, pipelineId: deal.pipelineId, payload: { close_date: val || "" } },
                        {
                          onSuccess: () => toast.success("Дата закрытия обновлена"),
                          onError: (err) => toast.error(err.message || "Ошибка"),
                        },
                      );
                      setIsEditingCloseDate(false);
                    }}
                    onBlur={() => setIsEditingCloseDate(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setIsEditingCloseDate(false);
                    }}
                    className="rounded-[6px] border border-[#3b82f6] px-2 py-0.5 text-xs text-[#111111] outline-none"
                    autoFocus
                  />
                  {deal.closeDate && (
                    <button
                      type="button"
                      title="Очистить дату закрытия"
                      onClick={() => {
                        updateDeal.mutate(
                          { id: deal.id, pipelineId: deal.pipelineId, payload: { close_date: "" } },
                          {
                            onSuccess: () => toast.success("Дата закрытия очищена"),
                            onError: (err) => toast.error(err.message || "Ошибка"),
                          },
                        );
                        setIsEditingCloseDate(false);
                      }}
                      className="text-[11px] text-[#888888] hover:text-rose-600 transition-colors"
                      aria-label="Очистить дату"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  title="Нажмите для редактирования даты закрытия"
                  onClick={() => setIsEditingCloseDate(true)}
                  className="group/btn inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                >
                  {deal.closeDate !== null ? (
                    <span className="text-[#111111]">{dateOnly(deal.closeDate)}</span>
                  ) : (
                    <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
                  )}
                  <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                </button>
              )}
            </FieldRow>

            {/* Воронка */}
            {pipelineName && (
              <FieldRow icon={Handshake} label="Воронка">
                <span title={`Воронка: ${pipelineName}`} className="text-[#111111]">{pipelineName}</span>
              </FieldRow>
            )}
          </div>
        )}
      </div>

      {/* Accordion Group: Данные визита и аналитика (Twenty CRM Light Canvas) */}
      {(() => {
        const customFields = (deal.customFields ?? {}) as Record<string, unknown>;
        const deviceInfo = (customFields.device_info ?? {}) as Record<string, string | number | undefined>;
        const clickIds = (customFields.click_ids ?? {}) as Record<string, string | undefined>;
        const utmTags = (customFields.utm_tags ?? {}) as Record<string, string | undefined>;
        const pageHistory = (Array.isArray(customFields.page_history) ? customFields.page_history : []) as Array<{ step: number; time: string; url: string }>;

        const hasVisitorData = Boolean(
          customFields.webchat_visitor_id ||
          customFields.device_fingerprint ||
          customFields.ym_uid ||
          customFields.yandexuid ||
          customFields.ga_id ||
          customFields.tmr_lvid ||
          customFields.page_url ||
          Object.keys(deviceInfo).length > 0 ||
          Object.keys(utmTags).length > 0 ||
          Object.keys(clickIds).length > 0
        );

        if (!hasVisitorData) return null;

        const hasDevice = Boolean(deviceInfo.os || deviceInfo.browser || deviceInfo.deviceType);
        const hasNetwork = Boolean(deviceInfo.ip || deviceInfo.timezone);
        const hasYandex = Boolean(customFields.yandexuid || customFields.ym_uid);
        const hasGoogle = Boolean(customFields.ga_id);
        const hasTmr = Boolean(customFields.tmr_lvid);
        const hasClickIds = Object.keys(clickIds).length > 0;
        const hasUtm = Object.keys(utmTags).length > 0;
        const hasVisits = Boolean(customFields.page_url || customFields.visit_count);

        return (
          <div className="mt-2">
            <button
              type="button"
              title="Свернуть / развернуть секцию «Данные визита и аналитика»"
              onClick={() => setAnalyticsOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
            >
              <span className="flex items-center gap-1.5">
                <Globe className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>Данные визита и аналитика</span>
              </span>
              <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !analyticsOpen && "rotate-180")} />
            </button>
            {analyticsOpen && (
              <div className="space-y-0.5 py-0.5">
                {/* Устройство */}
                {hasDevice && (
                  <FieldRow icon={deviceInfo.deviceType === "mobile" ? Smartphone : Laptop} label="Устройство">
                    <span className="text-[#111111] text-xs">
                      {deviceInfo.deviceType === "mobile" ? "Мобильный" : deviceInfo.deviceType === "tablet" ? "Планшет" : "Десктоп"} • {String(deviceInfo.os || "")} {deviceInfo.browser ? `• ${String(deviceInfo.browser)}` : ""}
                      {deviceInfo.screen ? <span className="text-[#888888] ml-1">({String(deviceInfo.screen)})</span> : null}
                    </span>
                  </FieldRow>
                )}

                {/* Сеть и регион */}
                {hasNetwork && (
                  <FieldRow icon={Globe} label="IP / Регион">
                    <span className="text-[#111111] text-xs font-mono">
                      {deviceInfo.ip ? String(deviceInfo.ip) : ""}
                      {deviceInfo.timezone ? <span className="text-[#666666] font-sans ml-1">({String(deviceInfo.timezone)})</span> : null}
                    </span>
                  </FieldRow>
                )}

                {/* Яндекс ID и Яндекс.Метрика */}
                {hasYandex && (
                  <FieldRow icon={Activity} label="Яндекс">
                    <div className="flex flex-wrap items-center gap-1 text-xs">
                      {customFields.yandexuid ? (
                        <span title="Идентификатор авторизованного пользователя в экосистеме Яндекса">
                          <TagPill color="emerald">
                            {`Яндекс ID: ${String(customFields.yandexuid).slice(-8)}`}
                          </TagPill>
                        </span>
                      ) : null}
                      {customFields.ym_uid ? (
                        <span className="text-[#666666] font-mono text-[11px]" title="ID посетителя Яндекс.Метрики">
                          YM: {String(customFields.ym_uid)}
                        </span>
                      ) : null}
                    </div>
                  </FieldRow>
                )}

                {/* Google Analytics */}
                {hasGoogle && (
                  <FieldRow icon={Search} label="Google">
                    <span className="text-[#666666] font-mono text-[11px]" title="Google Analytics Client ID">
                      GA: {String(customFields.ga_id)}
                    </span>
                  </FieldRow>
                )}

                {/* Top.Mail.ru / VK */}
                {hasTmr && (
                  <FieldRow icon={Activity} label="VK / Mail">
                    <span className="text-[#666666] font-mono text-[11px]">
                      TMR: {String(customFields.tmr_lvid)}
                    </span>
                  </FieldRow>
                )}

                {/* Рекламные клики (Click IDs) */}
                {hasClickIds && (
                  <FieldRow icon={Target} label="Реклама">
                    <div className="flex flex-wrap items-center gap-1 text-[11px] font-mono text-[#4a38f5]">
                      {Object.entries(clickIds).map(([k, v]) => v ? (
                        <span key={k} className="rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.5">
                          {k}: {String(v).slice(0, 14)}…
                        </span>
                      ) : null)}
                    </div>
                  </FieldRow>
                )}

                {/* Источник (UTM) */}
                {hasUtm && (
                  <FieldRow icon={Share2} label="Источник">
                    <span className="text-[#111111] text-xs">
                      {utmTags.utm_source ? <strong className="font-medium text-[#4a38f5]">{String(utmTags.utm_source)}</strong> : null}
                      {utmTags.utm_medium ? ` / ${String(utmTags.utm_medium)}` : ""}
                      {utmTags.utm_campaign ? <span className="text-[#666666] ml-1">({String(utmTags.utm_campaign)})</span> : null}
                    </span>
                  </FieldRow>
                )}

                {/* Страница и визиты */}
                {hasVisits && (
                  <FieldRow icon={Compass} label="Визиты">
                    <span className="text-[#111111] text-xs truncate max-w-[280px]" title={String(customFields.page_url || "")}>
                      {customFields.visit_count ? <TagPill color="sky">{`Визит №${String(customFields.visit_count)}`}</TagPill> : null}
                      {customFields.page_url ? <span className="text-[#666666] ml-1">{String(customFields.page_url).replace(/^https?:\/\/[^/]+/, "") || "/"}</span> : null}
                    </span>
                  </FieldRow>
                )}

                {/* История переходов */}
                {pageHistory.length > 1 && (
                  <FieldRow icon={History} label="Переходы">
                    <div className="flex flex-col gap-0.5 text-[11px] text-[#666666] max-h-24 overflow-y-auto">
                      {pageHistory.map((p, idx) => (
                        <div key={idx} className="flex items-center gap-1 truncate">
                          <span className="font-mono text-[#888888]">{p.time}</span>
                          <span className="truncate">{p.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</span>
                        </div>
                      ))}
                    </div>
                  </FieldRow>
                )}
              </div>
            )}
          </div>
        );
      })()}

      {/* Accordion Group 2: Связи */}
      <div className="mt-2">
        <button
          type="button"
          title="Свернуть / развернуть секцию «Связи»"
          onClick={() => setRelationsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Связи</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !relationsOpen && "rotate-180")} />
        </button>
        {relationsOpen && (
          <div className="space-y-0.5 py-0.5">
            {/* Компания */}
            <FieldRow icon={Building2} label="Компания">
              <div className="relative inline-block">
                {deal.companyName !== null && deal.companyName !== "" ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      title={`Компания: ${deal.companyName}`}
                      onClick={() => {
                        if (deal.companyId) {
                          setCompanyCardDrawerOpen(true);
                        } else {
                          openPicker("company", "row");
                        }
                      }}
                      className="cursor-pointer hover:opacity-85 transition-opacity"
                    >
                      <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (deal.companyId) {
                          setCompanyCardDrawerOpen(true);
                        } else {
                          openPicker("company", "row");
                        }
                      }}
                      title="Редактировать компанию"
                      aria-label="Редактировать компанию"
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Выбрать компанию"
                    onClick={() => openPicker("company", "row")}
                    className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                  >
                    -
                  </button>
                )}
                {activePicker === "company" && pickerAnchor === "row" && renderCompanyPicker()}
              </div>
            </FieldRow>

            {/* Контактное лицо */}
            <FieldRow icon={User} label="Контактное лицо">
              <div className="relative inline-block">
                {deal.contactName !== null && deal.contactName !== "" ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      title={`Контакт: ${deal.contactName}`}
                      onClick={() => {
                        if (deal.contactId) {
                          setContactCardDrawerOpen(true);
                        } else {
                          openPicker("contact", "row");
                        }
                      }}
                      className="cursor-pointer hover:opacity-85 transition-opacity"
                    >
                      <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (deal.contactId) {
                          setContactCardDrawerOpen(true);
                        } else {
                          openPicker("contact", "row");
                        }
                      }}
                      title="Редактировать контактное лицо"
                      aria-label="Редактировать контактное лицо"
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Выбрать контактное лицо"
                    onClick={() => openPicker("contact", "row")}
                    className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                  >
                    -
                  </button>
                )}
                {activePicker === "contact" && pickerAnchor === "row" && renderContactPicker()}
              </div>
            </FieldRow>

            {/* Владелец */}
            <FieldRow icon={UserCircle2} label="Владелец">
              <div className="relative inline-block">
                {owner !== undefined || (deal.ownerName !== null && deal.ownerName !== "") ? (
                  <div className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      title={`Ответственный: ${owner?.fullName ?? deal.ownerName}`}
                      onClick={() => openPicker("owner", "row")}
                      className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center gap-1.5 text-xs text-[#111111]"
                    >
                      {owner !== undefined ? (
                        <>
                          <UserAvatar user={owner} fallbackLabel="?" size="sm" />
                          <span>{owner.fullName}</span>
                        </>
                      ) : (
                        <EntityChip name={deal.ownerName!} label={deal.ownerName!} size="sm" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => openPicker("owner", "row")}
                      title="Редактировать ответственного"
                      aria-label="Редактировать ответственного"
                      className="flex h-5 w-5 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    title="Выбрать ответственного"
                    onClick={() => openPicker("owner", "row")}
                    className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                  >
                    -
                  </button>
                )}
                {activePicker === "owner" && pickerAnchor === "row" && renderOwnerPicker()}
              </div>
            </FieldRow>
          </div>
        )}
      </div>

      {/* Accordion Group 3: Система */}
      <div className="mt-2">
        <button
          type="button"
          title="Свернуть / развернуть секцию «Система»"
          onClick={() => setSystemOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Система</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !systemOpen && "rotate-180")} />
        </button>
        {systemOpen && (
          <div className="space-y-0.5 py-0.5">
            <FieldRow icon={Calendar} label="Дата создания">
              <span title={fullDate(deal.createdAt)} className="text-[#111111]">
                {timeAgo(deal.createdAt)}
              </span>
            </FieldRow>
            <FieldRow icon={Bot} label="Создано">
              <span title={`Создано: ${creator !== undefined ? creator.fullName : "System"}`} className="inline-flex items-center gap-1.5 text-[#111111]">
                <Bot className="h-3 w-3 text-[#888888]" />
                <span>{creator !== undefined ? creator.fullName : "System"}</span>
              </span>
            </FieldRow>
          </div>
        )}
      </div>

      {/* Separate Relation Cards with Pencil Edit Icon (matches Twenty Screenshot 2) */}
      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3">
        <div className="flex items-center justify-between mb-2 px-4">
          <button
            type="button"
            title="Свернуть / развернуть блок «Контактное лицо»"
            onClick={() => setContactCardOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
          >
            <span>Контактное лицо</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !contactCardOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            title={deal.contactId ? "Редактировать контактное лицо" : "Выбрать контактное лицо"}
            aria-label="Редактировать контактное лицо"
            onClick={() => {
              if (deal.contactId) {
                setContactCardDrawerOpen(true);
              } else {
                openPicker("contact", "card");
              }
            }}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {contactCardOpen && (
          <div className="relative space-y-2">
            <div className="flex items-center gap-2 px-4">
              {deal.contactName !== null && deal.contactName !== "" ? (
                <>
                  <button
                    type="button"
                    title={`Контакт: ${deal.contactName}`}
                    onClick={() => {
                      if (deal.contactId) {
                        setContactCardDrawerOpen(true);
                      }
                    }}
                    className="cursor-pointer hover:opacity-85 transition-opacity"
                  >
                    <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
                  </button>
                  <button
                    type="button"
                    title="Сменить привязанный контакт"
                    onClick={() => openPicker("contact", "card")}
                    className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    Сменить
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  title="Выбрать контактное лицо"
                  onClick={() => openPicker("contact", "card")}
                  className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                >
                  + Привязать контакт
                </button>
              )}
            </div>
            {activePicker === "contact" && pickerAnchor === "card" && (
              <div className="px-4">{renderContactPicker()}</div>
            )}

            {deal.contactId && (
              <div className="mt-2 space-y-1">
                {/* 1. Блок: ФИО */}
                <div>
                  <button
                    type="button"
                    onClick={() => setContactFioOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>ФИО</span>
                    <ChevronUp className={cn("h-3 w-3 text-[#888888] transition-transform", !contactFioOpen && "rotate-180")} />
                  </button>
                  {contactFioOpen && (
                    <div className="space-y-0.5 py-0.5">
                      {/* Фамилия */}
                      <FieldRow icon={UserRound} label="Фамилия">
                        {editingContactField === "lastName" ? (
                          <input
                            autoFocus
                            type="text"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("lastName")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("lastName");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactFieldDraft(fullLinkedContact?.lastName ?? "");
                              setEditingContactField("lastName");
                            }}
                            title="Нажмите для редактирования фамилии"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <span className={cn("truncate", !fullLinkedContact?.lastName && "text-[#888888]")}>
                              {fullLinkedContact?.lastName || "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Имя */}
                      <FieldRow icon={UserRound} label="Имя">
                        {editingContactField === "firstName" ? (
                          <input
                            autoFocus
                            type="text"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("firstName")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("firstName");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              const fName = fullLinkedContact?.firstName ?? deal.contactName?.split(" ")[0] ?? "";
                              setContactFieldDraft(fName);
                              setEditingContactField("firstName");
                            }}
                            title="Нажмите для редактирования имени"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <span className={cn("truncate", !(fullLinkedContact?.firstName || deal.contactName) && "text-[#888888]")}>
                              {fullLinkedContact?.firstName || deal.contactName || "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Отчество */}
                      <FieldRow icon={UserRound} label="Отчество">
                        {editingContactField === "middleName" ? (
                          <input
                            autoFocus
                            type="text"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("middleName")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("middleName");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactFieldDraft(fullLinkedContact?.middleName ?? "");
                              setEditingContactField("middleName");
                            }}
                            title="Нажмите для редактирования отчества"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <span className={cn("truncate", !fullLinkedContact?.middleName && "text-[#888888]")}>
                              {fullLinkedContact?.middleName || "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>
                    </div>
                  )}
                </div>

                {/* 2. Блок: Общее */}
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setContactGeneralOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>Общее</span>
                    <ChevronUp className={cn("h-3 w-3 text-[#888888] transition-transform", !contactGeneralOpen && "rotate-180")} />
                  </button>
                  {contactGeneralOpen && (
                    <div className="space-y-0.5 py-0.5">
                      {/* Телефоны */}
                      <FieldRow icon={Phone} label="Телефоны">
                        {editingContactField === "phones" ? (
                          <div className="w-full space-y-2 py-1">
                            <PhonesInput
                              value={contactPhonesDraft}
                              onChange={setContactPhonesDraft}
                              idPrefix="deal-contact-phone"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingContactField(null)}
                                className="rounded px-2 py-0.5 text-xs text-[#666666] hover:text-[#111111]"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                onClick={() => commitContactEdit("phones")}
                                className="rounded bg-[#4a38f5] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={startContactPhonesEdit}
                            title="Нажмите для редактирования телефонов"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <div className="min-w-0 flex-1">
                              {contactPhonesList.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {contactPhonesList.map((p, idx) => (
                                    <div key={p.number || idx} className="flex items-center gap-1.5">
                                      {idx === 0 && contactPhonesList.length > 1 && (
                                        <span title="Основной номер" className="shrink-0">
                                          <Star className="h-3 w-3 fill-current text-amber-400" />
                                        </span>
                                      )}
                                      <a
                                        href={telHref(p.number)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[#4a38f5] hover:underline truncate"
                                      >
                                        {formatPhone(p.number, p.country_code)}
                                      </a>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[#888888]">—</span>
                              )}
                            </div>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Email */}
                      <FieldRow icon={Mail} label="Email">
                        {editingContactField === "emails" ? (
                          <div className="w-full space-y-2 py-1">
                            <EmailsInput
                              value={contactEmailsDraft}
                              onChange={setContactEmailsDraft}
                              idPrefix="deal-contact-email"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingContactField(null)}
                                className="rounded px-2 py-0.5 text-xs text-[#666666] hover:text-[#111111]"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                onClick={() => commitContactEdit("emails")}
                                className="rounded bg-[#4a38f5] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={startContactEmailsEdit}
                            title="Нажмите для редактирования email"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <div className="min-w-0 flex-1">
                              {contactEmailsList.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {contactEmailsList.map((email, idx) => (
                                    <div key={email} className="flex items-center gap-1.5">
                                      {idx === 0 && contactEmailsList.length > 1 && (
                                        <span title="Основной email" className="shrink-0">
                                          <Star className="h-3 w-3 fill-current text-amber-400" />
                                        </span>
                                      )}
                                      <a
                                        href={`mailto:${email}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-[#4a38f5] hover:underline truncate"
                                      >
                                        {email}
                                      </a>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <span className="text-[#888888]">—</span>
                              )}
                            </div>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>
                    </div>
                  )}
                </div>

                {/* 3. Блок: Социальные сети */}
                <div className="mt-1">
                  <button
                    type="button"
                    onClick={() => setContactSocialsOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between px-4 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <span>Социальные сети</span>
                    <ChevronUp className={cn("h-3 w-3 text-[#888888] transition-transform", !contactSocialsOpen && "rotate-180")} />
                  </button>
                  {contactSocialsOpen && (
                    <div className="space-y-0.5 py-0.5">
                      {/* Социальные сети */}
                      {editingContactField === "socials" ? (
                        <div className="px-4 py-1.5">
                          <div className="w-full space-y-2 py-1">
                            <SocialsInput
                              value={contactSocialsDraft}
                              onChange={setContactSocialsDraft}
                              idPrefix="deal-contact-social"
                            />
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                onClick={() => setEditingContactField(null)}
                                className="rounded px-2 py-0.5 text-xs text-[#666666] hover:text-[#111111] cursor-pointer"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                onClick={() => commitContactEdit("socials")}
                                className="rounded bg-[#4a38f5] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#3b2be0] cursor-pointer"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {(() => {
                            const displayableSocials = (fullLinkedContact?.socials ?? []).filter(isDisplayableSocial);
                            if (displayableSocials.length === 0) {
                              return (
                                <FieldRow icon={MessageCircle} label="Соцсети">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setContactSocialsDraft([]);
                                      setEditingContactField("socials");
                                    }}
                                    className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                                  >
                                    <span className="text-[#888888]">+ Добавить соцсеть</span>
                                    <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                                  </button>
                                </FieldRow>
                              );
                            }
                            return (
                              <>
                                {displayableSocials.map((social, idx) => {
                                  const Icon = socialIcon(social.kind);
                                  const formatted = formatSocialDisplay(social.kind, social.value);
                                  return (
                                    <FieldRow key={`${social.kind}-${idx}-${social.value}`} icon={Icon} label={socialLabel(social.kind)}>
                                      <div className="flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors w-full min-w-0">
                                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                          {formatted.href ? (
                                            <a
                                              href={formatted.href}
                                              target="_blank"
                                              rel="noreferrer noopener"
                                              onClick={(e) => e.stopPropagation()}
                                              title={formatted.tooltip}
                                              className="text-[#4a38f5] hover:underline truncate inline-block max-w-full text-xs"
                                            >
                                              {formatted.displayText}
                                            </a>
                                          ) : (
                                            <span className="truncate text-[#111111] text-xs" title={formatted.tooltip}>
                                              {formatted.displayText}
                                            </span>
                                          )}
                                          {formatted.isNumericId && (
                                            <button
                                              type="button"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                navigator.clipboard.writeText(formatted.copyValue);
                                                toast.success("ID скопирован");
                                              }}
                                              title="Скопировать ID"
                                              className="inline-flex items-center justify-center rounded p-0.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
                                            >
                                              <Copy className="h-3 w-3" />
                                            </button>
                                          )}
                                        </div>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setContactSocialsDraft(displayableSocials.map((s) => ({ kind: s.kind, value: s.value })));
                                            setEditingContactField("socials");
                                          }}
                                          title={`Нажмите для редактирования ${socialLabel(social.kind)}`}
                                          className="p-1 text-[#888888] hover:text-[#111111] transition-colors cursor-pointer shrink-0 ml-1"
                                        >
                                          <Pencil className="h-3 w-3" />
                                        </button>
                                      </div>
                                    </FieldRow>
                                  );
                                })}
                                <div className="px-4 py-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setContactSocialsDraft(displayableSocials.map((s) => ({ kind: s.kind, value: s.value })));
                                      setEditingContactField("socials");
                                    }}
                                    className="inline-flex items-center gap-1.5 text-xs text-[#888888] hover:text-[#4a38f5] transition-colors cursor-pointer"
                                  >
                                    <Plus className="h-3 w-3" />
                                    <span>Добавить соцсеть</span>
                                  </button>
                                </div>
                              </>
                            );
                          })()}
                        </>
                      )}

                      {/* LinkedIn */}
                      <FieldRow icon={Linkedin} label="LinkedIn">
                        {editingContactField === "linkedin" ? (
                          <input
                            autoFocus
                            type="url"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("linkedin")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("linkedin");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            placeholder="https://linkedin.com/in/..."
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactFieldDraft(fullLinkedContact?.linkedinLink ?? "");
                              setEditingContactField("linkedin");
                            }}
                            title="Нажмите для редактирования LinkedIn"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <div className="truncate">
                              {fullLinkedContact?.linkedinLink ? (
                                <a
                                  href={fullLinkedContact.linkedinLink}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[#4a38f5] hover:underline"
                                >
                                  {fullLinkedContact.linkedinLink.replace(/^https?:\/\//, "")}
                                </a>
                              ) : (
                                <span className="text-[#888888]">—</span>
                              )}
                            </div>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                          </button>
                        )}
                      </FieldRow>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3">
        <div className="flex items-center justify-between mb-2 px-4">
          <button
            type="button"
            title="Свернуть / развернуть блок «Компания»"
            onClick={() => setCompanyCardOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
          >
            <span>Компания</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !companyCardOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            title={deal.companyId ? "Редактировать компанию" : "Выбрать компанию"}
            aria-label="Редактировать компанию"
            onClick={() => {
              if (deal.companyId) {
                setCompanyCardDrawerOpen(true);
              } else {
                openPicker("company", "card");
              }
            }}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {companyCardOpen && (
          <div className="relative space-y-2">
            <div className="flex items-center gap-2 px-4">
              {deal.companyName !== null && deal.companyName !== "" ? (
                <>
                  <button
                    type="button"
                    title={`Компания: ${deal.companyName}`}
                    onClick={() => {
                      if (deal.companyId) {
                        setCompanyCardDrawerOpen(true);
                      }
                    }}
                    className="cursor-pointer hover:opacity-85 transition-opacity"
                  >
                    <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
                  </button>
                  <button
                    type="button"
                    title="Сменить привязанную компанию"
                    onClick={() => openPicker("company", "card")}
                    className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    Сменить
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  title="Выбрать компанию"
                  onClick={() => openPicker("company", "card")}
                  className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                >
                  + Привязать компанию
                </button>
              )}
            </div>
            {activePicker === "company" && pickerAnchor === "card" && (
              <div className="px-4">{renderCompanyPicker()}</div>
            )}

            {deal.companyId && (
              <div className="mt-2 space-y-0.5 py-0.5">
                {/* Телефон компании */}
                <FieldRow icon={Phone} label="Телефон">
                  {editingCompanyField === "phone" ? (
                    <input
                      autoFocus
                      type="text"
                      value={companyFieldDraft}
                      onChange={(e) => setCompanyFieldDraft(e.target.value)}
                      onBlur={() => commitCompanyEdit("phone")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCompanyEdit("phone");
                        if (e.key === "Escape") setEditingCompanyField(null);
                      }}
                      className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyFieldDraft(companyPhone ?? "");
                        setEditingCompanyField("phone");
                      }}
                      title="Нажмите для редактирования телефона компании"
                      className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                    >
                      <span className={cn("truncate", !companyPhone && "text-[#888888]")}>
                        {companyPhone || "—"}
                      </span>
                      <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                </FieldRow>

                {/* Email компании */}
                <FieldRow icon={Mail} label="Email">
                  {editingCompanyField === "email" ? (
                    <input
                      autoFocus
                      type="email"
                      value={companyFieldDraft}
                      onChange={(e) => setCompanyFieldDraft(e.target.value)}
                      onBlur={() => commitCompanyEdit("email")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCompanyEdit("email");
                        if (e.key === "Escape") setEditingCompanyField(null);
                      }}
                      className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyFieldDraft(companyEmail ?? "");
                        setEditingCompanyField("email");
                      }}
                      title="Нажмите для редактирования email компании"
                      className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                    >
                      <span className={cn("truncate", !companyEmail && "text-[#888888]")}>
                        {companyEmail || "—"}
                      </span>
                      <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                    </button>
                  )}
                </FieldRow>

                {/* Сайт / Домен */}
                <FieldRow icon={Globe} label="Сайт">
                  {editingCompanyField === "domain" ? (
                    <input
                      autoFocus
                      type="text"
                      value={companyFieldDraft}
                      onChange={(e) => setCompanyFieldDraft(e.target.value)}
                      onBlur={() => commitCompanyEdit("domain")}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCompanyEdit("domain");
                        if (e.key === "Escape") setEditingCompanyField(null);
                      }}
                      placeholder="example.com"
                      className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setCompanyFieldDraft(companyWebsite ?? "");
                        setEditingCompanyField("domain");
                      }}
                      title="Нажмите для редактирования сайта компании"
                      className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                    >
                      <div className="truncate">
                        {companyWebsite ? (
                          <a
                            href={normalizeUrl(companyWebsite)}
                            target="_blank"
                            rel="noreferrer noopener"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#4a38f5] hover:underline"
                          >
                            {companyWebsite.replace(/^https?:\/\//, "")}
                          </a>
                        ) : (
                          <span className="text-[#888888]">—</span>
                        )}
                      </div>
                      <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                    </button>
                  )}
                </FieldRow>

                {/* Контакты компании */}
                <div className="mt-3 border-t border-[#f0f0f0] pt-2 px-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-[#666666]">
                      Контакты компании ({companyContactsQuery.data?.items.length ?? 0})
                    </span>
                    <button
                      type="button"
                      onClick={() => setCreateCompanyContactOpen(true)}
                      className="flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] transition-colors cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Добавить</span>
                    </button>
                  </div>
                  {companyContactsQuery.isLoading ? (
                    <div className="py-2 text-center text-xs text-[#888888]">Загрузка контактов...</div>
                  ) : (companyContactsQuery.data?.items.length ?? 0) === 0 ? (
                    <div className="rounded-[6px] border border-dashed border-[#e5e5e5] p-2 text-center text-xs text-[#888888]">
                      У компании пока нет других контактов
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {companyContactsQuery.data?.items.map((c) => {
                        const isCurrentDealContact = c.id === deal.contactId;
                        const fullName = contactFullName(c);
                        return (
                          <div
                            key={c.id}
                            className={cn(
                              "flex items-center justify-between rounded-[6px] border p-1.5 text-xs transition-colors",
                              isCurrentDealContact
                                ? "border-[#4a38f5]/30 bg-[#4a38f5]/5"
                                : "border-[#e5e5e5] bg-white hover:border-[#cccccc]"
                            )}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="font-medium text-[#111111] truncate">{fullName}</span>
                                {c.jobTitle && (
                                  <span className="text-[10px] text-[#888888] truncate">({c.jobTitle})</span>
                                )}
                              </div>
                              <div className="text-[11px] text-[#888888] truncate">
                                {c.phones?.[0]?.number ? formatPhone(c.phones[0].number, c.phones[0].countryCode) : c.email || "—"}
                              </div>
                            </div>
                            <div className="shrink-0 ml-2">
                              {isCurrentDealContact ? (
                                <span className="rounded bg-[#4a38f5]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                                  Основной в сделке
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    updateDeal.mutate(
                                      {
                                        id: deal.id,
                                        pipelineId: deal.pipelineId,
                                        payload: { contact_id: c.id },
                                      },
                                      {
                                        onSuccess: () => toast.success(`Контакт «${fullName}» выбран в сделку`),
                                        onError: (e) => toast.error(e.message || "Ошибка"),
                                      }
                                    );
                                  }}
                                  className="rounded border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                                >
                                  Выбрать в сделку
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <button
            type="button"
            title="Свернуть / развернуть блок «Владелец»"
            onClick={() => setOwnerCardOpen((prev) => !prev)}
            className="flex items-center gap-1.5 text-xs font-medium text-[#111111] hover:text-[#4a38f5] transition-colors cursor-pointer"
          >
            <span>Владелец</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !ownerCardOpen && "rotate-180")} />
          </button>
          <button
            type="button"
            title="Редактировать ответственного"
            aria-label="Редактировать ответственного"
            onClick={() => openPicker("owner", "card")}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        {ownerCardOpen && (
          <div className="relative">
            <button
              type="button"
              title={owner !== undefined ? `Ответственный: ${owner.fullName}` : deal.ownerName ? `Ответственный: ${deal.ownerName}` : "Выбрать ответственного"}
              onClick={() => openPicker("owner", "card")}
              className="text-left cursor-pointer hover:opacity-85 transition-opacity"
            >
              {owner !== undefined ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                  <UserAvatar user={owner} fallbackLabel="?" size="sm" />
                  <span>{owner.fullName}</span>
                </span>
              ) : deal.ownerName !== null && deal.ownerName !== "" ? (
                <EntityChip name={deal.ownerName} label={deal.ownerName} size="sm" />
              ) : (
                <span className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none">-</span>
              )}
            </button>
            {activePicker === "owner" && pickerAnchor === "card" && renderOwnerPicker()}
          </div>
        )}
      </div>

      <Sheet
        open={localCreateDrawer === "company"}
        onClose={() => setLocalCreateDrawer(null)}
        resizable
      >
        <DrawerCreateCompany
          deal={deal}
          dealId={deal.id}
          dealTitle={deal.title}
          onBack={() => setLocalCreateDrawer(null)}
          onClose={() => setLocalCreateDrawer(null)}
          onSuccess={(id) => {
            updateDeal.mutate(
              { id: deal.id, pipelineId: deal.pipelineId, payload: { company_id: id } },
              {
                onSuccess: () => toast.success("Компания создана и привязана"),
                onError: (err) => toast.error(err.message || "Ошибка привязки компании"),
              },
            );
            setLocalCreateDrawer(null);
          }}
        />
      </Sheet>
      <Sheet
        open={localCreateDrawer === "contact"}
        onClose={() => setLocalCreateDrawer(null)}
        resizable
      >
        <DrawerCreateContact
          deal={deal}
          dealId={deal.id}
          dealTitle={deal.title}
          onBack={() => setLocalCreateDrawer(null)}
          onClose={() => setLocalCreateDrawer(null)}
          onSuccess={(id) => {
            updateDeal.mutate(
              { id: deal.id, pipelineId: deal.pipelineId, payload: { contact_id: id } },
              {
                onSuccess: () => toast.success("Контакт создан и привязан"),
                onError: (err) => toast.error(err.message || "Ошибка привязки контакта"),
              },
            );
            setLocalCreateDrawer(null);
          }}
        />
      </Sheet>

      {contactCardDrawerOpen && resolvedContact && (
        <ContactCard
          contact={resolvedContact}
          onClose={() => setContactCardDrawerOpen(false)}
          onEdit={() => setContactModalOpen(true)}
          onOpenCompany={(_companyId) => {
            setContactCardDrawerOpen(false);
            setCompanyCardDrawerOpen(true);
          }}
        />
      )}

      {companyCardDrawerOpen && resolvedCompany && (
        <CompanyCard
          company={resolvedCompany}
          stats={companyStats.data}
          statsLoading={Boolean(companyStats.isLoading)}
          onClose={() => setCompanyCardDrawerOpen(false)}
          onEdit={() => setCompanyModalOpen(true)}
          onOpenContact={(_contactId) => {
            setCompanyCardDrawerOpen(false);
            setContactCardDrawerOpen(true);
          }}
        />
      )}

      {contactModalOpen && (
        <ContactModal
          open={contactModalOpen}
          onClose={() => setContactModalOpen(false)}
          initial={fullLinkedContact ? {
            first_name: fullLinkedContact.firstName,
            last_name: fullLinkedContact.lastName,
            middle_name: fullLinkedContact.middleName,
            phones: fullLinkedContact.phones.map((p) => ({
              number: p.number,
              country_code: p.countryCode,
              calling_code: p.callingCode,
            })),
            email: fullLinkedContact.email ?? "",
            socials: fullLinkedContact.socials.map((s) => ({ kind: s.kind, value: s.value })),
            job_title: fullLinkedContact.jobTitle,
            company_name: fullLinkedContact.companyName,
            company_id: fullLinkedContact.companyId ?? "",
            channel: fullLinkedContact.channel,
            linkedin_link: fullLinkedContact.linkedinLink,
            notes: fullLinkedContact.notes,
          } : {
            first_name: deal.contactName ?? "",
            last_name: "",
            middle_name: "",
            phones: contactPhone ? [{ number: contactPhone, country_code: "RU", calling_code: "+7" }] : [],
            email: contactEmail ?? "",
            socials: [],
            job_title: contactJobTitle ?? "",
            company_name: deal.companyName ?? "",
            company_id: deal.companyId ?? "",
            channel: "phone",
            linkedin_link: "",
          }}
          onSubmit={async (payload) => {
            if (deal.contactId) {
              await updateContact.mutateAsync({ id: deal.contactId, payload });
              toast.success("Контакт обновлён");
              setContactModalOpen(false);
            }
          }}
        />
      )}

      {companyModalOpen && (
        <CompanyModal
          open={companyModalOpen}
          onClose={() => setCompanyModalOpen(false)}
          initial={{
            name: (fullLinkedCompany ?? linkedCompany)?.name ?? deal.companyName ?? "",
            phone: (fullLinkedCompany ?? linkedCompany)?.phone ?? companyPhone ?? "",
            email: (fullLinkedCompany ?? linkedCompany)?.email ?? companyEmail ?? "",
            inn: (fullLinkedCompany ?? linkedCompany)?.requisites?.inn ?? "",
            ogrn: (fullLinkedCompany ?? linkedCompany)?.requisites?.ogrn ?? "",
            bik: (fullLinkedCompany ?? linkedCompany)?.requisites?.bik ?? "",
            account_number: (fullLinkedCompany ?? linkedCompany)?.requisites?.accountNumber ?? "",
            legal_address: (fullLinkedCompany ?? linkedCompany)?.requisites?.legalAddress ?? "",
            manager_name: (fullLinkedCompany ?? linkedCompany)?.managerName ?? "",
            manager_id: (fullLinkedCompany ?? linkedCompany)?.managerId ?? "",
            notes: (fullLinkedCompany ?? linkedCompany)?.notes ?? "",
            custom_fields: {},
          }}
          onSubmit={async (payload) => {
            if (deal.companyId) {
              await updateCompany.mutateAsync({ id: deal.companyId, payload });
              toast.success("Компания обновлена");
              setCompanyModalOpen(false);
            }
          }}
        />
      )}

      {createCompanyContactOpen && (
        <ContactModal
          open={createCompanyContactOpen}
          onClose={() => setCreateCompanyContactOpen(false)}
          initial={{
            first_name: "",
            last_name: "",
            middle_name: "",
            phones: [],
            email: "",
            socials: [],
            job_title: "",
            company_name: deal.companyName ?? "",
            company_id: deal.companyId ?? "",
            channel: "phone",
            linkedin_link: "",
            notes: "",
          }}
          onSubmit={async (payload) => {
            const created = await createContact.mutateAsync({
              ...payload,
              company_id: deal.companyId ?? undefined,
              company_name: deal.companyName ?? undefined,
            });
            toast.success("Контакт создан и привязан к компании");
            setCreateCompanyContactOpen(false);
            if (!deal.contactId && created?.id) {
              updateDeal.mutate({
                id: deal.id,
                pipelineId: deal.pipelineId,
                payload: { contact_id: created.id },
              });
            }
          }}
        />
      )}
    </div>
  );
}

function FilesTab() {
  return (
    <div className="px-5 py-4">
      <EmptyState icon={Paperclip} title="Файлы и счета" description="Файлы и счета по этой сделке появятся здесь" />
    </div>
  );
}


/** Идентификаторы вкладок — ключи реестра и строк `page_layout_tabs`. */
export const DEAL_TAB_IDS = [
  "home",
  "chat",
  "timeline",
  "analytics",
  "source",
  "contact-history",
  "tasks",
  "notes",
  "files",
] as const;
export type DealTabId = (typeof DEAL_TAB_IDS)[number];

/**
 * Реестр «ключ → содержимое» для сделки. Состав и порядок приходят из БД через
 * `useTabsRenderer` / `resolvePageLayoutTabs`; здесь только компоненты.
 *
 * Право на чат дублируется: фильтр по `requiredPermission` прячет вкладку, а
 * `Guard` остаётся страховкой внутри, если фильтр обойдут.
 */
export function dealTabContents(
  deal: DealDTO,
  context: DealTabsContext,
): Record<DealTabId, ReactNode> {
  return {
    home: (
      <HomeTab
        deal={deal}
        usersById={context.usersById}
        pipelines={context.pipelines}
        stagesById={context.stagesById}
        onRequestCreateCompany={context.onRequestCreateCompany}
        onRequestCreateContact={context.onRequestCreateContact}
      />
    ),
    chat: (
      <Guard
        requiredPermission="deals:write"
        fallback={<div className="p-5 text-sm text-slate-500">Нет доступа к переписке</div>}
      >
        <ChatTab dealId={deal.id} dealTitle={deal.title} />
      </Guard>
    ),
    timeline: <RecordTimelineTab recordType="deal" recordId={deal.id} />,
    analytics: <DealAnalyticsTab deal={deal} />,
    source: <SourceMetadataTab deal={deal} />,
    "contact-history": <DealContactHistoryTab dealId={deal.id} />,
    tasks: (
      <RecordTasksTab
        targetType="deal"
        targetId={deal.id}
        dealId={deal.id}
        contactId={deal.contactId}
        companyId={deal.companyId}
      />
    ),
    notes: <RecordNotesTab targetType="deal" targetId={deal.id} />,
    files: <FilesTab />,
  };
}
