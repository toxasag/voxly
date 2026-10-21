"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bot,
  Briefcase,
  Building2,
  Calendar,
  Check,
  CheckCircle2,
  ChevronUp,
  CircleSlash,
  DollarSign,
  Globe,
  Handshake,
  Linkedin,
  ListChecks,
  Mail,
  MapPin,
  MessageCircle,
  Paperclip,
  Pencil,
  Phone,
  Plus,
  Radio,
  User,
  UserCircle2,
  UserRound,
} from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { useKanban, useMoveDealStage, useUpdateDeal } from "@/lib/api/use-deals";
import { useCompanies, useCompany, useUpdateCompany } from "@/lib/api/use-companies";
import { contactFullName, useContacts, useContact, useUpdateContact } from "@/lib/api/use-contacts";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { Sheet } from "@/components/ui/sheet";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import { DrawerCreateContact } from "@/components/crm/deals/DrawerCreateContact";
import { ContactModal } from "@/components/crm/contacts/ContactModal";
import { CompanyModal } from "@/components/crm/companies/CompanyModal";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import { socialHref, socialLabel } from "@/lib/crm/socials";
import type { ContactChannel, ContactSocialInput } from "@/schemas/contact.schema";
import { RecordNotesTab } from "@/components/crm/shared/RecordNotesTab";
import { RecordTimelineTab } from "@/components/crm/shared/RecordTimelineTab";
import { RecordTasksTab } from "@/components/crm/shared/RecordTasksTab";
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

const CHANNEL_OPTIONS = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "rumax", label: "Rumax" },
  { value: "phone", label: "Телефон" },
  { value: "email", label: "E-mail" },
] as const;

const CHANNEL_TAG_COLORS = {
  telegram: "sky",
  whatsapp: "emerald",
  rumax: "violet",
  phone: "amber",
  email: "cyan",
} as const;

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
  const [relationsOpen, setRelationsOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [contactCardOpen, setContactCardOpen] = useState(true);
  const [companyCardOpen, setCompanyCardOpen] = useState(true);
  const [ownerCardOpen, setOwnerCardOpen] = useState(true);

  // Подсекции контакта в карточке сделки (по ТЗ: ФИО, Общее, Социальные сети)
  const [contactFioOpen, setContactFioOpen] = useState(true);
  const [contactGeneralOpen, setContactGeneralOpen] = useState(true);
  const [contactSocialsOpen, setContactSocialsOpen] = useState(true);
  const [channelPickerOpen, setChannelPickerOpen] = useState(false);

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

  const [contactModalOpen, setContactModalOpen] = useState(false);
  const [companyModalOpen, setCompanyModalOpen] = useState(false);

  const [editingContactField, setEditingContactField] = useState<
    "lastName" | "firstName" | "middleName" | "phone" | "email" | "socials" | "linkedin" | null
  >(null);
  const [contactFieldDraft, setContactFieldDraft] = useState("");
  const [contactSocialsDraft, setContactSocialsDraft] = useState<ContactSocialInput[]>([]);

  const [editingCompanyField, setEditingCompanyField] = useState<"name" | "phone" | "email" | "domain" | null>(null);
  const [companyFieldDraft, setCompanyFieldDraft] = useState("");

  const contactPhone = deal.contactPhone || (fullLinkedContact?.phones?.[0]?.number ?? null);
  const contactEmail = deal.contactEmail || fullLinkedContact?.email || null;
  const contactJobTitle = deal.contactJobTitle || fullLinkedContact?.jobTitle || null;

  const companyPhone = deal.companyPhone || fullLinkedCompany?.phone || null;
  const companyEmail = deal.companyEmail || fullLinkedCompany?.email || null;
  const companyWebsite = deal.companyWebsite || fullLinkedCompany?.domainName || null;

  const commitContactEdit = (field: "lastName" | "firstName" | "middleName" | "phone" | "email" | "socials" | "linkedin") => {
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
    } else if (field === "phone") {
      const cleanNumber = val.replace(/[\s()\-.]/g, "");
      updateContact.mutate(
        {
          id: deal.contactId,
          payload: {
            phones: cleanNumber ? [{ number: cleanNumber, country_code: "RU", calling_code: "+7" }] : [],
          },
        },
        {
          onSuccess: () => toast.success("Телефон контакта обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления телефона"),
        }
      );
    } else if (field === "email") {
      updateContact.mutate(
        { id: deal.contactId, payload: { email: val } },
        {
          onSuccess: () => toast.success("Email контакта обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления email"),
        }
      );
    } else if (field === "socials") {
      updateContact.mutate(
        { id: deal.contactId, payload: { socials: contactSocialsDraft } },
        {
          onSuccess: () => toast.success("Мессенджеры контакта обновлены"),
          onError: (e) => toast.error(e.message || "Ошибка обновления мессенджеров"),
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

  const setContactChannel = (channel: ContactChannel) => {
    if (!deal.contactId) return;
    updateContact.mutate(
      { id: deal.contactId, payload: { channel } },
      {
        onSuccess: () => toast.success("Канал контакта обновлен"),
        onError: (e) => toast.error(e.message || "Ошибка обновления канала"),
      }
    );
    setChannelPickerOpen(false);
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
                      onClick={() => openPicker("company", "row")}
                      className="cursor-pointer hover:opacity-85 transition-opacity"
                    >
                      <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openPicker("company", "row")}
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
                      onClick={() => openPicker("contact", "row")}
                      className="cursor-pointer hover:opacity-85 transition-opacity"
                    >
                      <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
                    </button>
                    <button
                      type="button"
                      onClick={() => openPicker("contact", "row")}
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
                setContactModalOpen(true);
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
                  <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
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
                      {/* Телефон */}
                      <FieldRow icon={Phone} label="Телефон">
                        {editingContactField === "phone" ? (
                          <input
                            autoFocus
                            type="text"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("phone")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("phone");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactFieldDraft(contactPhone ?? "");
                              setEditingContactField("phone");
                            }}
                            title="Нажмите для редактирования телефона"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <span className={cn("truncate", !contactPhone && "text-[#888888]")}>
                              {contactPhone || "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Email */}
                      <FieldRow icon={Mail} label="Email">
                        {editingContactField === "email" ? (
                          <input
                            autoFocus
                            type="email"
                            value={contactFieldDraft}
                            onChange={(e) => setContactFieldDraft(e.target.value)}
                            onBlur={() => commitContactEdit("email")}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitContactEdit("email");
                              if (e.key === "Escape") setEditingContactField(null);
                            }}
                            className="h-6 w-full rounded border border-[#4a38f5] bg-white px-1.5 text-xs text-[#111111] outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactFieldDraft(contactEmail ?? "");
                              setEditingContactField("email");
                            }}
                            title="Нажмите для редактирования email"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <span className={cn("truncate", !contactEmail && "text-[#888888]")}>
                              {contactEmail || "—"}
                            </span>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0" />
                          </button>
                        )}
                      </FieldRow>

                      {/* Канал */}
                      <FieldRow icon={Radio} label="Канал">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setChannelPickerOpen((prev) => !prev)}
                            title="Выбрать канал"
                            className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                          >
                            <TagPill color={CHANNEL_TAG_COLORS[fullLinkedContact?.channel ?? "phone"]}>
                              {fullLinkedContact?.channel ?? "phone"}
                            </TagPill>
                          </button>

                          {channelPickerOpen && (
                            <>
                              <div className="fixed inset-0 z-30 cursor-default" onClick={() => setChannelPickerOpen(false)} />
                              <div className="absolute left-0 top-full z-40 mt-1 w-44 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-xl space-y-0.5">
                                {CHANNEL_OPTIONS.map((opt) => (
                                  <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setContactChannel(opt.value)}
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                                      (fullLinkedContact?.channel ?? "phone") === opt.value && "bg-[#f5f5f5] font-medium"
                                    )}
                                  >
                                    <TagPill color={CHANNEL_TAG_COLORS[opt.value]}>{opt.label}</TagPill>
                                    {(fullLinkedContact?.channel ?? "phone") === opt.value && (
                                      <Check className="h-3.5 w-3.5 text-[#111111]" />
                                    )}
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
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
                      {/* Мессенджеры */}
                      <FieldRow icon={MessageCircle} label="Мессенджеры">
                        {editingContactField === "socials" ? (
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
                                className="rounded px-2 py-0.5 text-xs text-[#666666] hover:text-[#111111]"
                              >
                                Отмена
                              </button>
                              <button
                                type="button"
                                onClick={() => commitContactEdit("socials")}
                                className="rounded bg-[#4a38f5] px-2.5 py-0.5 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                              >
                                Сохранить
                              </button>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setContactSocialsDraft(
                                (fullLinkedContact?.socials ?? []).map((s) => ({ kind: s.kind, value: s.value }))
                              );
                              setEditingContactField("socials");
                            }}
                            title="Нажмите для редактирования мессенджеров"
                            className="group/btn flex flex-1 items-center justify-between rounded px-1.5 py-0.5 -mx-1.5 text-left text-xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                          >
                            <div className="min-w-0 flex-1">
                              {fullLinkedContact?.socials && fullLinkedContact.socials.length > 0 ? (
                                <div className="flex flex-col gap-0.5">
                                  {fullLinkedContact.socials.map((social) => {
                                    const href = socialHref(social.kind, social.value);
                                    return (
                                      <div key={`${social.kind}-${social.value}`} className="flex items-center gap-1.5">
                                        <span className="text-[#888888] text-[11px]">{socialLabel(social.kind)}:</span>
                                        {href ? (
                                          <a
                                            href={href}
                                            target="_blank"
                                            rel="noreferrer noopener"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-[#4a38f5] hover:underline truncate"
                                          >
                                            {social.value}
                                          </a>
                                        ) : (
                                          <span className="truncate text-[#111111]">{social.value}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : (
                                <span className="text-[#888888]">—</span>
                              )}
                            </div>
                            <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                          </button>
                        )}
                      </FieldRow>

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
                setCompanyModalOpen(true);
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
                  <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
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
export const DEAL_TAB_IDS = ["home", "chat", "timeline", "tasks", "notes", "files"] as const;
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
