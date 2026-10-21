"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  Briefcase, Building2, CalendarClock, GitMerge, Linkedin, Mail, MessageCircle,
  Phone, Radio, Star, Tag, UserCircle2, UserRound, AlertTriangle,
} from "lucide-react";
import type { ContactDTO } from "@/lib/api/use-contacts";
import { contactFullName, useUpdateContact, useFindDuplicateContacts } from "@/lib/api/use-contacts";
import { ContactMergeModal } from "@/components/crm/contacts/ContactMergeModal";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
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
import { CrmChatView } from "@/components/crm/shared/CrmChatView";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import { PhonesInput } from "@/components/crm/shared/PhonesInput";
import { SocialsInput } from "@/components/crm/shared/SocialsInput";
import type { ContactPhoneInput, ContactSocialInput } from "@/schemas/contact.schema";
import { socialHref, socialLabel } from "@/lib/crm/socials";
import { formatPhone, telHref } from "@/lib/utils/phone";
import { timeAgo } from "@/lib/utils";
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

const CHANNEL_TAG_COLORS = {
  telegram: "sky", whatsapp: "emerald", rumax: "violet", phone: "amber", email: "cyan",
} as const;

const CHANNEL_OPTIONS = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "rumax", label: "Rumax" },
  { value: "phone", label: "Телефон" },
  { value: "email", label: "E-mail" },
] as const;

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
    () => contact.socials.map((social) => ({ kind: social.kind, value: social.value })),
    [contact.socials],
  );

  const startPhoneEdit = (): void => {
    setPhoneDraft(phones);
    setEditing("phones");
  };

  const startSocialEdit = (): void => {
    setSocialDraft(socials);
    setEditing("socials");
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

  const socialsDisplay = contact.socials.length === 0
    ? undefined
    : (
      <span className="flex min-w-0 flex-col gap-0.5">
        {contact.socials.map((social) => {
          const href = socialHref(social.kind, social.value);

          return (
            <span key={`${social.kind}-${social.value}`} className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 text-xs text-[#888888]">{socialLabel(social.kind)}</span>
              {href !== null
                ? <RecordFieldLink href={href} label={social.value} />
                : <span className="truncate text-[#111111]">{social.value}</span>}
            </span>
          );
        })}
      </span>
    );

  const homeTab = (
    <div className="py-2">
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
          kind="email"
          value={contact.email ?? ""}
          display={contact.email !== null && contact.email !== ""
            ? <RecordFieldLink href={`mailto:${contact.email}`} label={contact.email} />
            : undefined}
          {...field("email")}
          onCommit={(value) => commit({ email: value.trim() })}
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

        <RecordField
          icon={Radio}
          label="Канал"
          kind="select"
          options={CHANNEL_OPTIONS}
          value={contact.channel}
          display={<TagPill color={CHANNEL_TAG_COLORS[contact.channel]}>{contact.channel}</TagPill>}
          {...field("channel")}
          onCommit={(value) => {
            const next = CHANNEL_OPTIONS.find((option) => option.value === value);
            if (next === undefined) { setEditing(null); return; }
            commit({ channel: next.value });
          }}
        />
      </RecordFieldGroup>

      {/* 3. Социальные сети (порядок по ТЗ: ФИО -> Общее -> Социальные сети -> Работа -> Система) */}
      <RecordFieldGroup title="Социальные сети">
        <RecordField
          icon={MessageCircle}
          label="Мессенджеры"
          value={contact.socials.map((social) => social.value).join(", ")}
          display={socialsDisplay}
          editing={editing === "socials"}
          onStartEdit={startSocialEdit}
          onCancel={() => setEditing(null)}
          editor={
            <div className="space-y-2">
              <SocialsInput value={socialDraft} onChange={setSocialDraft} idPrefix="card-social" />
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
                  onClick={() => commit({ socials: socialDraft })}
                  className="rounded bg-[#4a38f5] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#3b2be0]"
                >
                  Сохранить
                </button>
              </div>
            </div>
          }
        />
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
        <RecordField
          icon={Building2}
          label="Компания"
          value={contact.companyName}
          display={contact.companyName !== ""
            ? (
              <span className="inline-flex min-w-0 items-center">
                {contact.companyId !== null && onOpenCompany !== undefined ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenCompany(contact.companyId as string);
                    }}
                    className="inline-flex min-w-0 items-center rounded hover:underline cursor-pointer"
                  >
                    <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
                  </button>
                ) : (
                  <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
                )}
              </span>
            )
            : undefined}
          {...field("company")}
          onCommit={(value) => {
            commit({ company_name: value.trim(), company_id: "" });
          }}
        />
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
      <RecordRelationSection title="Компания">
        {contact.companyName !== "" ? (
          contact.companyId !== null && onOpenCompany !== undefined ? (
            <button
              type="button"
              onClick={() => onOpenCompany(contact.companyId as string)}
              className="flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left transition-colors hover:bg-black/[0.04]"
            >
              <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
            </button>
          ) : (
            <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
          )
        ) : (
          <p className="px-1 text-xs text-[#888888]">Компания не указана</p>
        )}
      </RecordRelationSection>

      <RecordDealsSection
        contactId={contact.id}
        targetLabel={contactFullName(contact)}
        onOpenDeal={onOpenDeal}
      />

      {contact.notes !== "" && (
        <RecordRelationSection title="Описание">
          <p className="whitespace-pre-wrap px-1 text-[13px] leading-relaxed text-[#111111]">{contact.notes}</p>
        </RecordRelationSection>
      )}
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
    </>
  );
});
