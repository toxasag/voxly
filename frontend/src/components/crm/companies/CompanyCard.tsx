"use client";

import { memo, useCallback, useState } from "react";
import {
  Banknote, CalendarClock, FileText, Globe, Handshake, Linkedin, Loader2,
  Mail, MapPin, Phone, Tag, UserCircle2,
} from "lucide-react";
import type { CompanyDTO, CompanyStatsDTO } from "@/lib/api/use-companies";
import { useUpdateCompany } from "@/lib/api/use-companies";
import { contactFullName, useContacts } from "@/lib/api/use-contacts";
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
  const contacts = useContacts({ companyId: company.id, limit: 20 });
  const [editing, setEditing] = useState<string | null>(null);

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
    <div className="space-y-3 p-4">
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

      <RecordFieldGroup title="Бизнес">
        <RecordField
          icon={Banknote}
          label="Годовой доход"
          kind="number"
          value={company.annualRevenue === null ? "" : String(company.annualRevenue)}
          display={company.annualRevenue !== null
            ? <span className="font-medium text-[#111111] tabular-nums">{formatMoney(company.annualRevenue)}</span>
            : undefined}
          validate={(value) => {
            if (value.trim() === "") return null;
            const parsed = Number(value);
            if (Number.isNaN(parsed)) return "Введите число";
            if (parsed < 0) return "Доход не может быть отрицательным";
            return null;
          }}
          {...field("revenue")}
          onCommit={(value) => {
            // Пустая строка очищает поле в null: «доход неизвестен» — это не 0.
            const trimmed = value.trim();
            commit({ annual_revenue: trimmed === "" ? null : Number(trimmed) });
          }}
        />
      </RecordFieldGroup>

      <RecordFieldGroup title="Контакты">
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

      <RecordFieldGroup title="Система">
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

      {/* Связанные записи: у Twenty на карточке компании это People и Opportunities.
          Список, а не счётчик: у них relation-виджет показывает сами записи, и по
          чипу можно перейти в запись. */}
      <RecordRelationSection title="Контакты" count={contacts.data?.total ?? company.contactsCount}>
        {contacts.isLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#888888]" />
        ) : (contacts.data?.items.length ?? 0) === 0 ? (
          <p className="px-1 text-xs text-[#888888]">Контактов нет</p>
        ) : (
          <div className="space-y-1">
            {contacts.data?.items.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => onOpenContact?.(contact.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[6px] px-1.5 py-1 text-left transition-colors",
                  onOpenContact !== undefined && "hover:bg-black/[0.04]",
                )}
              >
                <EntityChip name={contactFullName(contact)} size="sm" />
                <span className="min-w-0 flex-1 truncate text-xs text-[#111111]">{contactFullName(contact)}</span>
                {contact.jobTitle !== "" && (
                  <span className="shrink-0 truncate text-xs text-[#888888]">{contact.jobTitle}</span>
                )}
              </button>
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
  );
});
