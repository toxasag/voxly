"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  Briefcase, Building2, CalendarClock, Check, ChevronUp, CircleSlash,
  Copy, GitMerge, Globe, Linkedin, Mail, MessageCircle, Pencil,
  Phone, Plus, ShieldAlert, Star, Tag, UserCircle2, UserRound, AlertTriangle,
} from "lucide-react";
import type { ContactDTO } from "@/lib/api/use-contacts";
import { contactFullName, useUpdateContact, useFindDuplicateContacts } from "@/lib/api/use-contacts";
import { useCompanies, useCompany, useUpdateCompany } from "@/lib/api/use-companies";
import { ContactMergeModal } from "@/components/crm/contacts/ContactMergeModal";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
import { Sheet } from "@/components/ui/sheet";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import {
  RecordField,
  RecordFieldGroup,
  RecordFieldLink,
  RecordRelationSection,
} from "@/components/crm/shared/RecordField";
import { RecordDetailShell } from "@/components/crm/shared/RecordDetailShell";
import { RecordNotesTab } from "@/components/crm/shared/RecordNotesTab";
import { RecordTimelineTab } from "@/components/crm/shared/RecordTimelineTab";
import { RecordTasksTab } from "@/components/crm/shared/RecordTasksTab";
import { RecordRepairsTab } from "@/components/crm/shared/RecordRepairsTab";
import { RecordDealsSection } from "@/components/crm/shared/RecordDealsSection";
import { ContactDealsHistoryTab } from "./ContactDealsHistoryTab";
import { SourceMetadataTab } from "@/components/crm/shared/SourceMetadataTab";
import { CrmChatView } from "@/components/crm/shared/CrmChatView";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import { PhonesInput } from "@/components/crm/shared/PhonesInput";
import { EmailsInput } from "@/components/crm/shared/EmailsInput";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import type { ContactPhoneInput, ContactSocialInput } from "@/schemas/contact.schema";
import { extractContactEmails, prepareEmailsPayload } from "@/lib/crm/emails";
import { formatSocialDisplay, isDisplayableSocial, socialHref, socialIcon, socialLabel } from "@/lib/crm/socials";
import { formatPhone, telHref } from "@/lib/utils/phone";
import { cn, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Карточка контакта.
//
// Состав и порядок полей взяты из метаданных Twenty —
// `compute-standard-person-view-fields.util.ts`, представление
// `personRecordPageFields`:
//
//   general: emails (0), phones (1)
//   work:    company (0), jobTitle (1)
//   social:  linkedinLink (0)
//   system:  createdAt (0), createdBy (1), updatedAt (2, скрыт), updatedBy (3, скрыт)
//
// Группы названы как у них (`getStandardViewFieldGroupNames`: General, Work,
// Social, System). Поля с `isVisible: false` у Twenty уходят в свёрнутый блок
// «Ещё» — здесь так же.
//
// Отличия от Twenty, сделанные намеренно:
//  - ФИО правится прямо в карточке отдельными полями «Фамилия», «Имя»,
//    «Отчество». У них имя правится в заголовке через RecordTitleCell, но их
//    FULL_NAME не содержит отчества, а разбор строки «Петров Иван Сергеевич»
//    обратно на три части даёт ошибки на двойных фамилиях;
//  - Telegram и WhatsApp перенесены из «Общего» в «Социальные сети» и стали
//    списком: у контакта бывает несколько мессенджеров;
//  - компания в блоке «Работа» и в секции связей открывает карточку компании —
//    у Twenty relation-чип тоже ведёт на запись.
// ---------------------------------------------------------------------------

interface ContactCardProps {
  contact: ContactDTO;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  /** Открывает карточку компании — переход по связи, как relation-чип у Twenty. */
  onOpenCompany?: (companyId: string) => void;
  onOpenDeal?: (dealId: string) => void;
}

function fullDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

/** Приводит ввод к абсолютному URL: пользователь вводит домен без схемы. */
function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function CopySocialBtn({ value, tooltip }: { value: string; tooltip?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Скопировано!" : (tooltip ?? "Скопировать")}
      className="inline-flex items-center justify-center rounded p-0.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export const ContactCard = memo(function ContactCard({
  contact, onClose, onEdit, onDelete, isDeleting = false, onOpenCompany, onOpenDeal,
}: ContactCardProps) {
  const update = useUpdateContact();
  const [editing, setEditing] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);

  const duplicatesQuery = useFindDuplicateContacts(contact.phone, contact.id);
  const duplicates = duplicatesQuery.data ?? [];
  const [targetDuplicate, setTargetDuplicate] = useState<ContactDTO | null>(null);

  /**
   * Черновики составных полей.
   *
   * Телефоны и соцсети сохраняются целиком по кнопке, а не по каждому нажатию:
   * список в процессе правки проходит через невалидные промежуточные состояния
   * (номер дописывается), и отправлять его на сервер на каждый символ значило бы
   * получать 400 в середине ввода.
   */
  const [phoneDraft, setPhoneDraft] = useState<ContactPhoneInput[]>([]);
  const [socialDraft, setSocialDraft] = useState<ContactSocialInput[]>([]);
  const [emailDraft, setEmailDraft] = useState<string[]>([]);

  const companiesQuery = useCompanies({ limit: 100 });
  const linkedCompanyQuery = useCompany(contact.companyId);
  const fullLinkedCompany = linkedCompanyQuery.data ?? companiesQuery.data?.items.find((c) => c.id === contact.companyId);
  const updateCompany = useUpdateCompany();

  const [companyCardOpen, setCompanyCardOpen] = useState(true);
  const [activePicker, setActivePicker] = useState<"company" | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<"row" | "card">("card");
  const [pickerSearch, setPickerSearch] = useState("");
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);

  const [editingCompanyField, setEditingCompanyField] = useState<"phone" | "email" | "domain" | null>(null);
  const [companyFieldDraft, setCompanyFieldDraft] = useState("");

  const companyPhone = fullLinkedCompany?.phone ?? null;
  const companyEmail = fullLinkedCompany?.email ?? null;
  const companyWebsite = fullLinkedCompany?.domainName ?? null;

  const commitCompanyEdit = (field: "phone" | "email" | "domain") => {
    if (!contact.companyId) {
      setEditingCompanyField(null);
      return;
    }
    const val = companyFieldDraft.trim();
    if (field === "phone") {
      updateCompany.mutate(
        { id: contact.companyId, payload: { phone: val } },
        {
          onSuccess: () => toast.success("Телефон компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления"),
        }
      );
    } else if (field === "email") {
      updateCompany.mutate(
        { id: contact.companyId, payload: { email: val } },
        {
          onSuccess: () => toast.success("Email компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления"),
        }
      );
    } else if (field === "domain") {
      updateCompany.mutate(
        { id: contact.companyId, payload: { domain_name: val } },
        {
          onSuccess: () => toast.success("Сайт компании обновлен"),
          onError: (e) => toast.error(e.message || "Ошибка обновления"),
        }
      );
    }
    setEditingCompanyField(null);
  };

  const filteredCompanies = useMemo(() => {
    const list = companiesQuery.data?.items ?? [];
    if (!pickerSearch.trim()) return list;
    const q = pickerSearch.toLowerCase();
    return list.filter((c) => c.name.toLowerCase().includes(q));
  }, [companiesQuery.data?.items, pickerSearch]);

  const openCompanyPicker = (anchor: "row" | "card") => {
    setActivePicker("company");
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
              commit({ company_id: "", company_name: "" });
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
              !contact.companyId && !contact.companyName && "bg-[#f5f5f5] font-medium",
            )}
          >
            <div className="flex items-center gap-2 truncate">
              <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              <span>Нет Компания</span>
            </div>
            {!contact.companyId && !contact.companyName && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
          </button>
          {filteredCompanies.map((comp) => {
            const isSelected = comp.id === contact.companyId;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => {
                  if (comp.id !== contact.companyId) {
                    commit({ company_id: comp.id, company_name: comp.name });
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
              setCreateCompanyOpen(true);
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

  const commit = useCallback(
    (payload: Parameters<typeof update.mutate>[0]["payload"]) => {
      setEditing(null);
      update.mutate(
        { id: contact.id, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [contact.id, update],
  );

  const field = (id: string) => ({
    editing: editing === id,
    onStartEdit: () => setEditing(id),
    onCancel: () => setEditing(null),
  });

  const phones = useMemo<ContactPhoneInput[]>(
    () => contact.phones.map((phone) => ({
      number: phone.number,
      country_code: phone.countryCode,
      calling_code: phone.callingCode,
    })),
    [contact.phones],
  );

  const socials = useMemo<ContactSocialInput[]>(
    () =>
      contact.socials
        .filter(isDisplayableSocial)
        .map((social) => ({ kind: social.kind, value: social.value })),
    [contact.socials],
  );

  const displayableSocials = useMemo(
    () => contact.socials.filter(isDisplayableSocial),
    [contact.socials],
  );

  const startPhoneEdit = (): void => {
    setPhoneDraft(phones);
    setEditing("phones");
  };

  const phonesDisplay = contact.phones.length === 0
    ? undefined
    : (
      <span className="flex min-w-0 flex-col gap-0.5">
        {contact.phones.map((phone) => (
          <span key={phone.number} className="flex min-w-0 items-center gap-1.5">
            {phone.isPrimary && contact.phones.length > 1 && (
              <span title="Основной номер" className="shrink-0">
                <Star className="h-3 w-3 fill-current text-amber-400" />
              </span>
            )}
            <RecordFieldLink href={telHref(phone.number)} label={formatPhone(phone.number, phone.countryCode)} />
          </span>
        ))}
      </span>
    );

  const startSocialEdit = (): void => {
    setSocialDraft(socials);
    setEditing("socials");
  };

  const contactEmails = useMemo(() => extractContactEmails(contact), [contact]);

  const startEmailEdit = (): void => {
    setEmailDraft(contactEmails.length > 0 ? contactEmails : [""]);
    setEditing("emails");
  };

  const emailsDisplay = contactEmails.length === 0
    ? undefined
    : (
      <span className="flex min-w-0 flex-col gap-0.5">
        {contactEmails.map((email, idx) => (
          <span key={email} className="flex min-w-0 items-center gap-1.5">
            {idx === 0 && contactEmails.length > 1 && (
              <span title="Основной e-mail" className="shrink-0">
                <Star className="h-3 w-3 fill-current text-amber-400" />
              </span>
            )}
            <RecordFieldLink href={`mailto:${email}`} label={email} />
          </span>
        ))}
      </span>
    );

  const homeTab = (
    <div className="py-2">
      {contact.isPersonal && (
        <div className="mx-4 mb-3 rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-2.5 text-xs text-[#854d0e] flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 shrink-0 text-[#854d0e]" />
            <span>
              <strong>Личный контакт.</strong> Переписка игнорируется CRM, новые сделки не создаются, уведомления приходят на телефон.
            </span>
          </div>
        </div>
      )}

      {duplicates.length > 0 && (
        <div className="mx-4 mb-3 rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-2.5 text-xs text-[#854d0e] flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-[#854d0e]" />
            <span>Найден дубликат по номеру телефона ({duplicates.length})</span>
          </div>
          <button
            type="button"
            onClick={() => {
              setTargetDuplicate(duplicates[0]);
              setMergeOpen(true);
            }}
            className="rounded-[6px] bg-[#854d0e] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#713f12] transition-colors cursor-pointer"
          >
            Объединить
          </button>
        </div>
      )}

      {/* 1. ФИО */}
      <RecordFieldGroup title="ФИО">
        <RecordField
          icon={UserRound}
          label="Фамилия"
          value={contact.lastName}
          {...field("lastName")}
          onCommit={(value) => commit({ last_name: value.trim() })}
        />
        <RecordField
          icon={UserRound}
          label="Имя"
          value={contact.firstName}
          validate={(value) => (value.trim() === "" ? "Имя обязательно" : null)}
          {...field("firstName")}
          onCommit={(value) => commit({ first_name: value.trim() })}
        />
        <RecordField
          icon={UserRound}
          label="Отчество"
          value={contact.middleName}
          {...field("middleName")}
          onCommit={(value) => commit({ middle_name: value.trim() })}
        />
      </RecordFieldGroup>

      {/* 2. Общее */}
      <RecordFieldGroup title="Общее">
        <RecordField
          icon={Mail}
          label="Эл. почта"
          value={contactEmails.join(", ")}
          display={emailsDisplay}
          editing={editing === "emails"}
          onStartEdit={startEmailEdit}
          onCancel={() => setEditing(null)}
          editor={
            <div className="space-y-2">
              <EmailsInput value={emailDraft} onChange={setEmailDraft} idPrefix="card-email" />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#111111]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => commit(prepareEmailsPayload(emailDraft, contact.customFields))}
                  className="rounded bg-[#4a38f5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                >
                  Сохранить
                </button>
              </div>
            </div>
          }
        />

        <RecordField
          icon={Phone}
          label="Телефоны"
          value={contact.phones.map((phone) => phone.number).join(", ")}
          display={phonesDisplay}
          editing={editing === "phones"}
          onStartEdit={startPhoneEdit}
          onCancel={() => setEditing(null)}
          editor={
            <div className="space-y-2">
              <PhonesInput value={phoneDraft} onChange={setPhoneDraft} idPrefix="card-phone" />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#111111]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={() => commit({ phones: phoneDraft })}
                  className="rounded bg-[#4a38f5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                >
                  Сохранить
                </button>
              </div>
            </div>
          }
        />
      </RecordFieldGroup>

      {/* 3. Социальные сети (порядок по ТЗ: ФИО -> Общее -> Социальные сети -> Работа -> Система) */}
      <RecordFieldGroup title="Социальные сети">
        {editing === "socials" ? (
          <div className="space-y-2 px-4 py-2">
            <SocialsInput value={socialDraft} onChange={setSocialDraft} idPrefix="card-social" />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#111111] cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={() => commit({ socials: socialDraft })}
                className="rounded bg-[#4a38f5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#3b2be0] cursor-pointer"
              >
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <>
            {displayableSocials.length === 0 ? (
              <div className="flex items-center justify-between px-4 py-1.5 min-h-[30px]">
                <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                  <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                  <span className="truncate">Соцсети</span>
                </span>
                <button
                  type="button"
                  onClick={startSocialEdit}
                  className="text-xs text-[#888888] hover:text-[#4a38f5] transition-colors cursor-pointer"
                >
                  + Добавить соцсеть
                </button>
              </div>
            ) : (
              displayableSocials.map((social, idx) => {
                const Icon = socialIcon(social.kind);
                const formatted = formatSocialDisplay(social.kind, social.value);
                return (
                  <RecordField
                    key={`${social.kind}-${idx}-${social.value}`}
                    icon={Icon}
                    label={socialLabel(social.kind)}
                    value={social.value}
                    display={
                      <div className="flex items-center gap-1.5 min-w-0" title={formatted.tooltip}>
                        {formatted.href !== null ? (
                          <RecordFieldLink href={formatted.href} label={formatted.displayText} />
                        ) : (
                          <span className="truncate text-[#111111]">{formatted.displayText}</span>
                        )}
                        {formatted.isNumericId && (
                          <CopySocialBtn value={formatted.copyValue} tooltip="Скопировать ID" />
                        )}
                      </div>
                    }
                    onStartEdit={startSocialEdit}
                  />
                );
              })
            )}

            {displayableSocials.length > 0 && (
              <div className="px-4 py-1">
                <button
                  type="button"
                  onClick={startSocialEdit}
                  className="inline-flex items-center gap-1.5 text-xs text-[#666666] hover:text-[#4a38f5] transition-colors cursor-pointer"
                >
                  <Plus className="h-3 w-3" />
                  <span>Добавить соцсеть</span>
                </button>
              </div>
            )}
          </>
        )}

        <RecordField
          icon={Linkedin}
          label="LinkedIn"
          kind="url"
          value={contact.linkedinLink}
          display={contact.linkedinLink !== ""
            ? <RecordFieldLink href={contact.linkedinLink} label={contact.linkedinLink.replace(/^https?:\/\//, "")} />
            : undefined}
          {...field("linkedin")}
          onCommit={(value) => commit({ linkedin_link: normalizeUrl(value) })}
        />
      </RecordFieldGroup>

      {/* 4. Работа */}
      <RecordFieldGroup title="Работа">
        <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
          <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
            <span className="truncate">Компания</span>
          </span>
          <div className="relative min-w-0 flex-1 text-[13px] text-[#111111]">
            {contact.companyName !== "" ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  title={`Компания: ${contact.companyName}`}
                  onClick={() => {
                    if (contact.companyId && onOpenCompany) {
                      onOpenCompany(contact.companyId);
                    } else {
                      openCompanyPicker("row");
                    }
                  }}
                  className="cursor-pointer hover:opacity-85 transition-opacity"
                >
                  <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (contact.companyId && onOpenCompany) {
                      onOpenCompany(contact.companyId);
                    } else {
                      openCompanyPicker("row");
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
                onClick={() => openCompanyPicker("row")}
                className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
              >
                -
              </button>
            )}
            {activePicker === "company" && pickerAnchor === "row" && renderCompanyPicker()}
          </div>
        </div>
        <RecordField
          icon={Briefcase}
          label="Должность"
          value={contact.jobTitle}
          {...field("jobTitle")}
          onCommit={(value) => commit({ job_title: value.trim() })}
        />
      </RecordFieldGroup>

      {/* 5. Система */}
      <RecordFieldGroup title="Система" defaultExpanded={false}>
        <RecordField
          icon={CalendarClock}
          label="Создан"
          value={contact.createdAt}
          readOnly
          display={<span title={fullDate(contact.createdAt)}>{timeAgo(contact.createdAt)}</span>}
        />
        <RecordField
          icon={UserCircle2}
          label="Создал"
          value={contact.createdByName ?? "Система"}
          readOnly
        />
      </RecordFieldGroup>

      {/* Скрытые у Twenty поля (isVisible: false) — свёрнутый блок «Ещё». */}
      <RecordFieldGroup title="Ещё" defaultExpanded={false}>
        <RecordField
          icon={CalendarClock}
          label="Изменён"
          value={contact.updatedAt}
          readOnly
          display={<span title={fullDate(contact.updatedAt)}>{timeAgo(contact.updatedAt)}</span>}
        />
        {Object.entries(contact.customFields)
          .filter(([, value]) => value !== null && value !== undefined && String(value) !== "")
          .map(([key, value]) => (
            <RecordField key={key} icon={Tag} label={key.replace(/_/g, " ")} value={String(value)} readOnly />
          ))}
      </RecordFieldGroup>

      {/* Связанные записи — у Twenty отдельные виджеты внизу вкладки Home. */}
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
            title={contact.companyId ? "Редактировать компанию" : "Выбрать компанию"}
            aria-label="Редактировать компанию"
            onClick={() => {
              if (contact.companyId && onOpenCompany) {
                onOpenCompany(contact.companyId);
              } else {
                openCompanyPicker("card");
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
              {contact.companyName !== "" ? (
                <>
                  <button
                    type="button"
                    title={`Компания: ${contact.companyName}`}
                    onClick={() => {
                      if (contact.companyId && onOpenCompany) {
                        onOpenCompany(contact.companyId);
                      }
                    }}
                    className="cursor-pointer hover:opacity-85 transition-opacity"
                  >
                    <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
                  </button>
                  <button
                    type="button"
                    title="Сменить привязанную компанию"
                    onClick={() => openCompanyPicker("card")}
                    className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    Сменить
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  title="Выбрать компанию"
                  onClick={() => openCompanyPicker("card")}
                  className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] hover:bg-[#ebebeb] hover:text-[#555555] transition-colors cursor-pointer select-none"
                >
                  + Привязать компанию
                </button>
              )}
            </div>
            {activePicker === "company" && pickerAnchor === "card" && (
              <div className="px-4">{renderCompanyPicker()}</div>
            )}

            {contact.companyId && (
              <div className="mt-2 space-y-0.5 py-0.5">
                {/* Телефон компании */}
                <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
                  <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                    <Phone className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                    <span className="truncate">Телефон</span>
                  </span>
                  <div className="min-w-0 flex-1 text-[13px] text-[#111111]">
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
                        <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Email компании */}
                <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
                  <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                    <Mail className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                    <span className="truncate">Email</span>
                  </span>
                  <div className="min-w-0 flex-1 text-[13px] text-[#111111]">
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
                        <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Сайт компании */}
                <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
                  <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                    <Globe className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                    <span className="truncate">Сайт</span>
                  </span>
                  <div className="min-w-0 flex-1 text-[13px] text-[#111111]">
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
                        <span className={cn("truncate", !companyWebsite && "text-[#888888]")}>
                          {companyWebsite || "—"}
                        </span>
                        <Pencil className="h-3 w-3 text-[#888888] opacity-0 group-hover/btn:opacity-100 transition-opacity shrink-0 ml-1" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <RecordDealsSection
        contactId={contact.id}
        targetLabel={contactFullName(contact)}
        onOpenDeal={onOpenDeal}
      />
    </div>
  );

  const tabs = useTabsRenderer({
    objectType: "contact",
    contents: {
      home: homeTab,
      chat: (
        <div className="h-full min-h-[450px]">
          <CrmChatView
            entityType="contact"
            entityId={contact.id}
            entityName={contactFullName(contact)}
          />
        </div>
      ),
      source: <SourceMetadataTab contact={contact} />,
      "deals-history": <ContactDealsHistoryTab contactId={contact.id} />,
      repairs: <RecordRepairsTab customerId={contact.id} />,
      timeline: <RecordTimelineTab recordType="contact" recordId={contact.id} />,
      tasks: <RecordTasksTab targetType="contact" targetId={contact.id} />,
      notes: <RecordNotesTab targetType="contact" targetId={contact.id} />,
    },
  });

  const avatarUrl =
    typeof contact.customFields?.avatar_url === "string"
      ? (contact.customFields.avatar_url as string)
      : undefined;

  return (
    <>
      <RecordDetailShell
        name={contactFullName(contact)}
        subtitle={contact.jobTitle}
        imageUrl={avatarUrl}
        createdAt={contact.createdAt}
        tabs={tabs}
        onClose={onClose}
        onEdit={onEdit}
        onDelete={onDelete}
        isDeleting={isDeleting}
        headerActions={
          duplicates.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setTargetDuplicate(duplicates[0]);
                setMergeOpen(true);
              }}
              title={`Объединить дубликаты (${duplicates.length})`}
              className="flex items-center gap-1.5 rounded-[6px] border border-[#fef08a] bg-[#fefce8] px-2 py-1 text-xs font-medium text-[#854d0e] hover:bg-[#fef9c3] transition-colors cursor-pointer"
            >
              <GitMerge className="h-3.5 w-3.5" />
              <span>Слияние ({duplicates.length})</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setTargetDuplicate(null);
                setMergeOpen(true);
              }}
              aria-label="Объединить контакт"
              title="Объединить с дубликатом"
              className="flex items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
            >
              <GitMerge className="h-3.5 w-3.5 text-[#666666]" />
              <span className="hidden sm:inline">Слияние</span>
            </button>
          )
        }
        ariaLabel={`Карточка контакта: ${contactFullName(contact)}`}
      />

      {mergeOpen && (
        <ContactMergeModal
          open={mergeOpen}
          onClose={() => {
            setMergeOpen(false);
            setTargetDuplicate(null);
          }}
          primaryContact={contact}
          secondaryContact={targetDuplicate}
          onMerged={(result) => {
            setMergeOpen(false);
            if (result.primaryContactId !== contact.id) {
              onClose();
            }
          }}
        />
      )}

      <Sheet
        open={createCompanyOpen}
        onClose={() => setCreateCompanyOpen(false)}
        resizable
      >
        <DrawerCreateCompany
          onBack={() => setCreateCompanyOpen(false)}
          onClose={() => setCreateCompanyOpen(false)}
          onSuccess={(id, name) => {
            commit({ company_id: id, company_name: name });
            toast.success("Компания создана и привязана");
            setCreateCompanyOpen(false);
          }}
        />
      </Sheet>
    </>
  );
});
