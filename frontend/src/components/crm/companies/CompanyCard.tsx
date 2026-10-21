"use client";

import { memo, useCallback, useMemo, useState } from "react";
import {
  CalendarClock, Check, FileText, Globe, Handshake, Linkedin, Loader2,
  Mail, MapPin, Phone, Plus, Tag, UserCircle2, X,
} from "lucide-react";
import type { CompanyDTO, CompanyStatsDTO } from "@/lib/api/use-companies";
import { useUpdateCompany } from "@/lib/api/use-companies";
import { contactFullName, useContacts, useCreateContact, useUpdateContact } from "@/lib/api/use-contacts";
import { ContactModal } from "@/components/crm/contacts/ContactModal";
import { formatPhone } from "@/lib/utils/phone";
import { EntityChip } from "@/components/crm/shared/EntityChip";
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
import { RecordInvoicesTab } from "@/components/crm/shared/RecordInvoicesTab";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import { RecordDealsSection } from "@/components/crm/shared/RecordDealsSection";
import { cn, timeAgo } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Карточка компании.
//
// Состав и порядок полей — из метаданных Twenty
// (`compute-standard-company-view-fields.util.ts`, представление
// `companyRecordPageFields`):
//
//   general:  domainName (0), accountOwner (1)
//   business: annualRevenue (0)
//   contact:  address (0), linkedinLink (1)
//   system:   createdAt (0), createdBy (1), updatedAt (2, скрыт)
//
// Названия групп — их `getStandardViewFieldGroupNames` (General, Business,
// Contact, System). Телефон и e-mail есть у нас и отсутствуют у Twenty (у них
// связь идёт через людей компании); они отнесены к Contact вместе с адресом.
//
// Российские реквизиты (ИНН/ОГРН/БИК/счёт) — наша специфика, для них отдельная
// группа: у Twenty аналога нет, а мешать их с адресом значило бы получить
// группу из восьми разнородных полей.
// ---------------------------------------------------------------------------

interface CompanyCardProps {
  company: CompanyDTO;
  stats?: CompanyStatsDTO;
  statsLoading: boolean;
  onClose: () => void;
  /** Не задаётся, когда карточка открыта переходом по связи с контакта. */
  onEdit?: () => void;
  onDelete?: () => void;
  isDeleting?: boolean;
  onOpenContact?: (contactId: string) => void;
  onOpenDeal?: (dealId: string) => void;
}

function fullDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(parsed);
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function formatMoney(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  }).format(amount);
}

export const CompanyCard = memo(function CompanyCard({
  company, stats, statsLoading, onClose, onEdit, onDelete, isDeleting = false, onOpenContact, onOpenDeal,
}: CompanyCardProps) {
  const update = useUpdateCompany();
  // Сотрудники компании: секция показывает сами записи, а не только счётчик.
  const contacts = useContacts({ companyId: company.id, limit: 100 });
  const allContactsQuery = useContacts({ limit: 100 });
  const updateContact = useUpdateContact();
  const createContact = useCreateContact();

  const [editing, setEditing] = useState<string | null>(null);
  const [addContactPickerOpen, setAddContactPickerOpen] = useState(false);
  const [addContactSearch, setAddContactSearch] = useState("");
  const [isCreatingNewContact, setIsCreatingNewContact] = useState(false);

  const unlinkedContacts = useMemo(() => {
    const list = allContactsQuery.data?.items ?? [];
    const currentIds = new Set(contacts.data?.items.map((c) => c.id) ?? []);
    const available = list.filter((c) => !currentIds.has(c.id) && c.companyId !== company.id);
    if (!addContactSearch.trim()) return available;
    const q = addContactSearch.toLowerCase();
    return available.filter((c) => contactFullName(c).toLowerCase().includes(q) || (c.phone && c.phone.includes(q)) || (c.email && c.email.toLowerCase().includes(q)));
  }, [allContactsQuery.data?.items, contacts.data?.items, company.id, addContactSearch]);

  const commit = useCallback(
    (payload: Parameters<typeof update.mutate>[0]["payload"]) => {
      setEditing(null);
      update.mutate(
        { id: company.id, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [company.id, update],
  );

  const field = (id: string) => ({
    editing: editing === id,
    onStartEdit: () => setEditing(id),
    onCancel: () => setEditing(null),
  });

  const requisites: ReadonlyArray<[string, string]> = [
    ["ИНН", company.requisites.inn],
    ["ОГРН", company.requisites.ogrn],
    ["БИК", company.requisites.bik],
    ["Счёт", company.requisites.accountNumber],
    ["Юр. адрес", company.requisites.legalAddress],
  ];
  const filledRequisites = requisites.filter(([, value]) => value !== "");

  const homeTab = (
    <div className="py-2">
      <RecordFieldGroup title="Общее">
        <RecordField
          icon={Globe}
          label="Домен"
          kind="url"
          value={company.domainName}
          display={company.domainName !== ""
            ? <RecordFieldLink href={normalizeUrl(company.domainName)} label={company.domainName} />
            : undefined}
          {...field("domain")}
          onCommit={(value) => commit({ domain_name: value.trim().replace(/^https?:\/\//, "") })}
        />
        <RecordField
          icon={UserCircle2}
          label="Ответственный"
          value={company.managerName}
          {...field("manager")}
          onCommit={(value) => commit({ manager_name: value.trim() })}
        />
      </RecordFieldGroup>

      <RecordFieldGroup title="Связь и адрес">
        <RecordField
          icon={Phone}
          label="Телефон"
          value={company.phone}
          display={company.phone !== ""
            ? <RecordFieldLink href={`tel:${company.phone}`} label={company.phone} />
            : undefined}
          {...field("phone")}
          onCommit={(value) => commit({ phone: value.trim() })}
        />
        <RecordField
          icon={Mail}
          label="Эл. почта"
          kind="email"
          value={company.email}
          display={company.email !== ""
            ? <RecordFieldLink href={`mailto:${company.email}`} label={company.email} />
            : undefined}
          {...field("email")}
          onCommit={(value) => commit({ email: value.trim() })}
        />
        <RecordField
          icon={MapPin}
          label="Город"
          value={company.address.city}
          {...field("city")}
          onCommit={(value) => commit({ address_city: value.trim() })}
        />
        <RecordField
          icon={MapPin}
          label="Улица"
          value={company.address.street}
          {...field("street")}
          onCommit={(value) => commit({ address_street: value.trim() })}
        />
        <RecordField
          icon={Linkedin}
          label="LinkedIn"
          kind="url"
          value={company.linkedinLink}
          display={company.linkedinLink !== ""
            ? <RecordFieldLink href={company.linkedinLink} label={company.linkedinLink.replace(/^https?:\/\//, "")} />
            : undefined}
          {...field("linkedin")}
          onCommit={(value) => commit({ linkedin_link: normalizeUrl(value) })}
        />
      </RecordFieldGroup>

      <RecordFieldGroup title="Система" defaultExpanded={false}>
        <RecordField
          icon={CalendarClock}
          label="Создана"
          value={company.createdAt}
          readOnly
          display={<span title={fullDate(company.createdAt)}>{timeAgo(company.createdAt)}</span>}
        />
        <RecordField
          icon={UserCircle2}
          label="Создал"
          value={company.createdByName ?? "Система"}
          readOnly
        />
      </RecordFieldGroup>

      <RecordFieldGroup title="Ещё" defaultExpanded={false}>
        <RecordField
          icon={CalendarClock}
          label="Изменена"
          value={company.updatedAt}
          readOnly
          display={<span title={fullDate(company.updatedAt)}>{timeAgo(company.updatedAt)}</span>}
        />
        <RecordField
          icon={MapPin}
          label="Страна"
          value={company.address.country}
          {...field("country")}
          onCommit={(value) => commit({ address_country: value.trim() })}
        />
        <RecordField
          icon={MapPin}
          label="Индекс"
          value={company.address.postcode}
          {...field("postcode")}
          onCommit={(value) => commit({ address_postcode: value.trim() })}
        />
        {filledRequisites.map(([label, value]) => (
          <RecordField key={label} icon={FileText} label={label} value={value} readOnly />
        ))}
        {Object.entries(company.customFields)
          .filter(([, value]) => value !== null && value !== undefined && String(value) !== "")
          .map(([key, value]) => (
            <RecordField key={key} icon={Tag} label={key.replace(/_/g, " ")} value={String(value)} readOnly />
          ))}
      </RecordFieldGroup>

      {/* Связанные записи: у компании может быть несколько контактов.
          Показываем список людей компании с должностями, номерами и email,
          а также кнопки привязки существующего контакта и создания нового. */}
      <RecordRelationSection
        title="Контакты компании"
        count={contacts.data?.total ?? company.contactsCount}
        action={
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setAddContactPickerOpen((v) => !v);
                setAddContactSearch("");
              }}
              className="flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              <Plus className="h-3 w-3 text-[#666666]" />
              <span>Добавить контакт</span>
            </button>

            {addContactPickerOpen && (
              <>
                <div
                  className="fixed inset-0 z-30 cursor-default"
                  onClick={() => setAddContactPickerOpen(false)}
                />
                <div className="absolute right-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 border-b border-[#f0f0f0] mb-1">
                    <input
                      type="text"
                      placeholder="Поиск контакта..."
                      value={addContactSearch}
                      onChange={(e) => setAddContactSearch(e.target.value)}
                      className="w-full text-xs text-[#111111] placeholder:text-[#888888] bg-transparent outline-none py-0.5"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {unlinkedContacts.length > 0 ? (
                      unlinkedContacts.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            updateContact.mutate(
                              {
                                id: c.id,
                                payload: { company_id: company.id, company_name: company.name },
                              },
                              {
                                onSuccess: () => {
                                  toast.success(`Контакт «${contactFullName(c)}» привязан к компании`);
                                  setAddContactPickerOpen(false);
                                },
                                onError: (e) => toast.error(e.message || "Ошибка привязки"),
                              }
                            );
                          }}
                          className="flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <EntityChip name={contactFullName(c)} size="sm" />
                            <span className="truncate">{contactFullName(c)}</span>
                          </div>
                          <span className="text-[10px] text-[#4a38f5] font-medium shrink-0">Привязать</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-2 py-2 text-center text-xs text-[#888888]">
                        {addContactSearch ? "Контакты не найдены" : "Все контакты уже привязаны"}
                      </p>
                    )}
                  </div>
                  <div className="border-t border-[#f0f0f0] mt-1 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setAddContactPickerOpen(false);
                        setIsCreatingNewContact(true);
                      }}
                      className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5 shrink-0" />
                      <span>Создать новый контакт</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        }
      >
        {contacts.isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#888888]" />
        ) : (contacts.data?.items.length ?? 0) === 0 ? (
          <p className="px-1 py-1 text-xs text-[#888888]">
            У компании пока нет контактов. Нажмите «Добавить контакт», чтобы привязать существующего или создать нового сотрудника.
          </p>
        ) : (
          <div className="space-y-1.5">
            {contacts.data?.items.map((contact) => (
              <div
                key={contact.id}
                className="group flex items-center justify-between gap-2 rounded-[6px] border border-[#e5e5e5] bg-white p-2 hover:border-[#cccccc] transition-colors"
              >
                <button
                  type="button"
                  onClick={() => onOpenContact?.(contact.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
                >
                  <EntityChip name={contactFullName(contact)} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium text-[#111111] group-hover:text-[#4a38f5]">
                        {contactFullName(contact)}
                      </span>
                      {contact.jobTitle !== "" && (
                        <span className="rounded bg-[#f5f5f5] px-1.5 py-0.5 text-[10px] text-[#666666] truncate">
                          {contact.jobTitle}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-[#888888] mt-0.5">
                      {contact.phones?.[0]?.number && (
                        <span className="truncate">
                          {formatPhone(contact.phones[0].number, contact.phones[0].countryCode)}
                        </span>
                      )}
                      {contact.email && (
                        <span className="truncate">{contact.email}</span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  type="button"
                  title="Отвязать контакт от компании"
                  aria-label="Отвязать контакт от компании"
                  onClick={() => {
                    updateContact.mutate(
                      { id: contact.id, payload: { company_id: "", company_name: "" } },
                      {
                        onSuccess: () => toast.success(`Контакт «${contactFullName(contact)}» отвязан от компании`),
                        onError: (e) => toast.error(e.message || "Ошибка отвязки"),
                      }
                    );
                  }}
                  className="rounded p-1 text-[#888888] opacity-0 group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-600 transition-all cursor-pointer shrink-0"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </RecordRelationSection>

      <RecordDealsSection
        companyId={company.id}
        targetLabel={company.name}
        onOpenDeal={onOpenDeal}
      />

      {/* Сумма сделок остаётся отдельной строкой: она агрегат, а не запись. */}
      {(stats?.dealsBudgetTotal ?? company.dealsBudgetTotal) > 0 && (
        <RecordRelationSection title="Сумма сделок">
          <span className="inline-flex items-center gap-1.5 px-1 text-xs">
            <Handshake className="h-3.5 w-3.5 text-[#888888]" />
            <span className="font-medium text-[#4a38f5] tabular-nums">
              {formatMoney(stats?.dealsBudgetTotal ?? company.dealsBudgetTotal)}
            </span>
            {statsLoading && <Loader2 className="h-3 w-3 animate-spin text-[#888888]" />}
          </span>
        </RecordRelationSection>
      )}

      {company.notes !== "" && (
        <RecordRelationSection title="Описание">
          <p className="whitespace-pre-wrap px-1 text-[13px] leading-relaxed text-[#111111]">{company.notes}</p>
        </RecordRelationSection>
      )}
    </div>
  );

  const tabs = useTabsRenderer({
    objectType: "company",
    contents: {
      home: homeTab,
      timeline: <RecordTimelineTab recordType="company" recordId={company.id} />,
      invoices: <RecordInvoicesTab companyId={company.id} />,
      tasks: <RecordTasksTab targetType="company" targetId={company.id} />,
      notes: <RecordNotesTab targetType="company" targetId={company.id} />,
    },
  });

  return (
    <>
      <RecordDetailShell
        name={company.name}
        subtitle={company.domainName}
        domain={company.domainName}
        createdAt={company.createdAt}
        tabs={tabs}
        onClose={onClose}
        onEdit={onEdit}
        onDelete={onDelete}
        isDeleting={isDeleting}
        ariaLabel={`Карточка компании: ${company.name}`}
      />

      {isCreatingNewContact && (
        <ContactModal
          open={isCreatingNewContact}
          onClose={() => setIsCreatingNewContact(false)}
          initial={{
            first_name: "",
            last_name: "",
            middle_name: "",
            phones: [],
            email: "",
            socials: [],
            job_title: "",
            company_name: company.name,
            company_id: company.id,
            channel: "phone",
            linkedin_link: "",
            notes: "",
          }}
          onSubmit={async (payload) => {
            await createContact.mutateAsync({
              ...payload,
              company_id: company.id,
              company_name: company.name,
            });
            toast.success("Контакт создан и привязан к компании");
            setIsCreatingNewContact(false);
          }}
        />
      )}
    </>
  );
});
