"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus, Users, Search, Building2, AlertCircle, RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { ContactModal } from "@/components/crm/contacts/ContactModal";
import { DrawerCreateContact } from "@/components/crm/deals/DrawerCreateContact";
import { Sheet } from "@/components/ui/sheet";
import { ContactCard } from "@/components/crm/contacts/ContactCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { type RecordColumn } from "@/components/crm/shared/RecordTable";
import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import { RecordCellShell, RecordCellEditor } from "@/components/crm/shared/RecordCell";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
import { CompanyCard } from "@/components/crm/companies/CompanyCard";
import { useCompany, useCompanyStats } from "@/lib/api/use-companies";
import { formatPhone } from "@/lib/utils/phone";
import { timeAgo } from "@/lib/utils";
import { useRecordParam } from "@/lib/utils/use-record-param";
import {
  DEFAULT_PAGE_SIZE,
  contactFullName,
  toContactFormValues,
  useContacts,
  useCreateContact,
  useDeleteContact,
  useUpdateContact,
  type ContactDTO,
} from "@/lib/api/use-contacts";
import type { ContactChannel, CreateContactPayload } from "@/schemas/contact.schema";
import { cn } from "@/lib/utils";

const CHANNEL_TAG_COLORS: Record<ContactChannel, "sky" | "emerald" | "violet" | "amber" | "cyan"> = {
  telegram: "sky", whatsapp: "emerald", rumax: "violet", phone: "amber", email: "cyan",
};

const CHANNEL_FILTERS = [
  { value: "all", label: "Все" },
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "rumax", label: "RuMAX" },
  { value: "phone", label: "Телефон" },
  { value: "email", label: "E-mail" },
] as const;

const PAGE_SIZE = DEFAULT_PAGE_SIZE;
const SEARCH_DEBOUNCE_MS = 300;

/** Russian plural form for the contacts counter in the page subtitle. */
function contactsPlural(count: number): string {
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 14) return "контактов";

  switch (count % 10) {
    case 1:
      return "контакт";
    case 2:
    case 3:
    case 4:
      return "контакта";
    default:
      return "контактов";
  }
}

function ContactsPageContent() {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [channelFilter, setChannelFilter] = useState<ContactChannel | "all">("all");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ContactDTO | null>(null);
  /**
   * Открытая карточка хранится идентификатором, а не объектом.
   *
   * Прежде здесь лежал снимок ContactDTO. Правка поля на карточке уходила на
   * сервер и сохранялась, но снимок в состоянии не обновлялся, и значение на
   * экране оставалось старым до закрытия и повторного открытия карточки.
   * Проверено в браузере: PATCH уходил с верным телом, БД содержала новое
   * значение, карточка показывала прежнее. По идентификатору запись берётся из
   * того же кэша, что и таблица, поэтому обновляется вместе с ней.
   *
   * Сам идентификатор живёт в адресе (`?record=`), а не только в состоянии: поиск
   * в палитре обязан открывать саму запись, а у карточки контакта своего маршрута
   * нет. Побочно это даёт работающую кнопку «назад» на телефоне и ссылку на
   * карточку, которую можно отправить коллеге.
   */
  const { recordId: detailId, openRecord: setDetailId, closeRecord: closeDetail } =
    useRecordParam();
  /**
   * Карточка компании, открытая по клику на название компании.
   *
   * Отдельным запросом, а не из кэша списка компаний: у контакта может стоять
   * компания, которой нет на текущей странице списка.
   */
  const {
    recordId: companyDetailId,
    openRecord: setCompanyDetailId,
    closeRecord: closeCompanyDetail,
  } = useRecordParam("company");
  const [deleteTarget, setDeleteTarget] = useState<ContactDTO | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editing, setEditing] = useState<{ rowId: string; columnId: string } | null>(null);

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [searchInput]);

  const query = useContacts({
    search: search.length > 0 ? search : undefined,
    channel: channelFilter === "all" ? undefined : channelFilter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });

  const createContact = useCreateContact();
  const updateContact = useUpdateContact();
  const deleteContact = useDeleteContact();
  const companyDetail = useCompany(companyDetailId);
  const companyStats = useCompanyStats(companyDetailId);

  const contacts = query.data?.items ?? [];
  /** Запись для карточки берётся из текущего списка: обновляется вместе с ним. */
  const detailTarget = detailId === null
    ? null
    : contacts.find((contact) => contact.id === detailId) ?? null;
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilters = search.length > 0 || channelFilter !== "all";

  // Deleting the last row of the last page would otherwise leave the user on an
  // empty page with no way back.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const handleCreate = useCallback(
    async (payload: CreateContactPayload) => {
      const created = await createContact.mutateAsync(payload);
      toast.success(`Контакт ${contactFullName(created)} создан`);
    },
    [createContact],
  );

  const handleUpdate = useCallback(
    async (payload: CreateContactPayload) => {
      if (editTarget === null) return;

      const updated = await updateContact.mutateAsync({ id: editTarget.id, payload });
      toast.success(`Контакт ${contactFullName(updated)} обновлён`);
      setEditTarget(null);
      // Синхронизировать карточку вручную больше не нужно: она читает запись из
      // кэша списка, который инвалидируется мутацией.
    },
    [editTarget, updateContact],
  );

  const handleDelete = useCallback((contact: ContactDTO) => {
    setDeleteTarget(contact);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    setIsDeleting(true);
    try {
      const result = await deleteContact.mutateAsync(deleteTarget.id);
      closeDetail();
      setDeleteTarget(null);
      if (result.warning !== null) toast.warning(result.warning);
      else toast.success(`Контакт ${contactFullName(deleteTarget)} удалён`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить контакт");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteContact, deleteTarget]);

  const editInitialValues = useMemo(
    () => (editTarget === null ? undefined : toContactFormValues(editTarget)),
    [editTarget],
  );

  const subtitle = query.isLoading
    ? "Загрузка…"
    : `${total} ${contactsPlural(total)} · страница ${page} из ${totalPages}`;

  // Правка прямо в таблице: имя, должность и телефон — поля, которые чаще всего
  // уточняют по ходу разговора, ради них не стоит открывать модалку.
  const commitContact = useCallback(
    (contact: ContactDTO, payload: Parameters<typeof updateContact.mutate>[0]["payload"]) => {
      setEditing(null);
      updateContact.mutate(
        { id: contact.id, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [updateContact],
  );

  const isEditing = useCallback(
    (rowId: string, columnId: string): boolean => editing?.rowId === rowId && editing.columnId === columnId,
    [editing],
  );

  const contactColumns = useMemo<RecordColumn<ContactDTO>[]>(() => [
    {
      id: "name",
      header: "ФИО",
      width: 260,
      sortValue: (contact) => contactFullName(contact),
      render: (contact) =>
        isEditing(contact.id, "name") ? (
          <RecordCellEditor
            value={contactFullName(contact)}
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              // Разбор «Фамилия Имя Отчество»: обязательна одна часть — имя.
              // Двойные фамилии и отсутствие отчества здесь неразличимы, поэтому
              // полный разбор оставлен карточке, где части правятся по отдельности.
              const parts = value.trim().split(/\s+/).filter((part) => part !== "");

              if (parts.length === 0) {
                toast.error("Укажите хотя бы имя");
                setEditing(null);
                return;
              }

              if (parts.length === 1) {
                commitContact(contact, { first_name: parts[0] ?? "", last_name: "", middle_name: "" });
                return;
              }

              commitContact(contact, {
                last_name: parts[0] ?? "",
                first_name: parts[1] ?? "",
                middle_name: parts.slice(2).join(" "),
              });
            }}
          />
        ) : (
          <RecordCellShell
            editable
            isLabelIdentifier
            onStartEdit={() => setEditing({ rowId: contact.id, columnId: "name" })}
          >
            <EntityChip name={contactFullName(contact)} />
            <span className="truncate font-medium text-slate-100">{contactFullName(contact)}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "jobTitle",
      header: "Должность",
      width: 170,
      sortValue: (contact) => contact.jobTitle,
      render: (contact) =>
        isEditing(contact.id, "jobTitle") ? (
          <RecordCellEditor
            value={contact.jobTitle}
            onCancel={() => setEditing(null)}
            onCommit={(value) => commitContact(contact, { job_title: value.trim() })}
          />
        ) : (
          <RecordCellShell
            editable
            isEmpty={contact.jobTitle === ""}
            emptyLabel="должность"
            onStartEdit={() => setEditing({ rowId: contact.id, columnId: "jobTitle" })}
          >
            <span className="truncate text-slate-300">{contact.jobTitle}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "phone",
      header: "Телефон",
      width: 180,
      sortValue: (contact) => contact.phone,
      render: (contact) => {
        const [primary, ...rest] = contact.phones;

        // Правка номера — только на карточке: там есть селектор кода страны и
        // проверка формата, которых в однострочном редакторе ячейки нет.
        return (
          <RecordCellShell isEmpty={primary === undefined} emptyLabel="телефон">
            {primary !== undefined && (
              <>
                <span className="truncate text-slate-300">
                  {formatPhone(primary.number, primary.countryCode)}
                </span>
                {rest.length > 0 && (
                  <span
                    title={rest.map((phone) => formatPhone(phone.number, phone.countryCode)).join(", ")}
                    className="shrink-0 rounded bg-slate-800 px-1.5 text-xs text-slate-400"
                  >
                    +{rest.length}
                  </span>
                )}
              </>
            )}
          </RecordCellShell>
        );
      },
    },
    {
      id: "email",
      header: "E-mail",
      width: 200,
      sortValue: (contact) => contact.email ?? "",
      render: (contact) => (
        <RecordCellShell isEmpty={contact.email === null || contact.email === ""} emptyLabel="e-mail">
          <span className="truncate text-slate-400">{contact.email}</span>
        </RecordCellShell>
      ),
    },
    {
      id: "company",
      header: "Компания",
      width: 200,
      sortValue: (contact) => contact.companyName,
      render: (contact) => (
        <RecordCellShell isEmpty={contact.companyName === ""} emptyLabel="компанию">
          {contact.companyName !== "" && (
            contact.companyId !== null ? (
              <button
                type="button"
                onClick={(event) => {
                  // Клик остаётся в ячейке: строка открыла бы карточку контакта,
                  // а по названию компании ожидается переход в компанию.
                  event.stopPropagation();
                  // Проверка на null нужна теперь явно: `openRecord` принимает
                  // идентификатор, а не «идентификатор или ничего» — ссылка в
                  // адресе без значения бессмысленна.
                  if (contact.companyId !== null) setCompanyDetailId(contact.companyId);
                }}
                className="inline-flex min-w-0 items-center rounded hover:underline"
              >
                <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
              </button>
            ) : (
              <EntityChip name={contact.companyName} label={contact.companyName} icon={Building2} size="sm" />
            )
          )}
        </RecordCellShell>
      ),
    },
    {
      id: "channel",
      header: "Канал",
      width: 130,
      sortValue: (contact) => contact.channel,
      render: (contact) => (
        <RecordCellShell>
          <TagPill color={CHANNEL_TAG_COLORS[contact.channel]}>{contact.channel}</TagPill>
        </RecordCellShell>
      ),
    },
    {
      id: "deals",
      header: "Сделок",
      width: 104,
      align: "right",
      sortValue: (contact) => contact.dealsCount,
      render: (contact) => (
        <RecordCellShell align="right">
          <span className={contact.dealsCount > 0 ? "tabular-nums text-slate-200" : "tabular-nums text-slate-600"}>
            {contact.dealsCount}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "created",
      header: "Создан",
      width: 120,
      align: "right",
      sortValue: (contact) => contact.createdAt,
      render: (contact) => (
        <RecordCellShell align="right">
          <span
            title={new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(contact.createdAt))}
            className="text-slate-500"
          >
            {timeAgo(contact.createdAt)}
          </span>
        </RecordCellShell>
      ),
    },
  ], [isEditing, commitContact]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Контакты</h1>
          <p className="mt-1 text-xs text-[#666666]">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {query.isFetching && !query.isLoading && (
            <span className="flex items-center gap-1.5 text-xs text-[#666666]">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />Обновляем
            </span>
          )}
          <Guard requiredPermission="contacts:write">
            <button type="button" onClick={() => setCreateOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0]">
              <Plus className="h-3.5 w-3.5" />Создать контакт
            </button>
          </Guard>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
          <input type="search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Поиск по имени, телефону, e-mail, компании..." aria-label="Поиск контактов"
            className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white py-1.5 pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20" />
        </div>
        {/*
          Фильтры каналов на 360px не помещались в ряд и выносили страницу за
          край. Как на задачах: горизонтальная прокрутка до `md:`, с `md:` —
          обычный перенос. Найдено браузерной проверкой.
        */}
        <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {CHANNEL_FILTERS.map((filter) => (
            <button key={filter.value} type="button"
              onClick={() => { setChannelFilter(filter.value === "all" ? "all" : filter.value); setPage(1); }}
              aria-pressed={channelFilter === filter.value}
              className={cn("shrink-0 whitespace-nowrap rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors",
                channelFilter === filter.value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]")}>
              {filter.label}
            </button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : query.isError ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6" role="alert">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-slate-200">Не удалось загрузить контакты</h3>
              <p className="mt-1 text-sm text-slate-400">{query.error.message}</p>
              <button type="button" onClick={() => void query.refetch()}
                className="mt-3 flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 transition-colors hover:bg-slate-800">
                <RefreshCw className="h-3.5 w-3.5" />Повторить
              </button>
            </div>
          </div>
        </div>
      ) : contacts.length === 0 ? (
        <EmptyState icon={Users}
          title={hasFilters ? "Нет контактов по фильтру" : "Нет контактов"}
          description={hasFilters
            ? "Измените поисковый запрос или фильтр по каналу."
            : "Создайте первый контакт, чтобы начать работу."}
          action={hasFilters ? (
            <button type="button" onClick={() => { setSearchInput(""); setChannelFilter("all"); }}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa]">
              Сбросить фильтры
            </button>
          ) : (
            <Guard requiredPermission="contacts:write">
              <button type="button" onClick={() => setCreateOpen(true)}
                className="rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0]">
                Создать контакт
              </button>
            </Guard>
          )} />
      ) : (
        <div>
          <SyncedRecordTable
            rows={contacts}
            getRowId={(contact) => contact.id}
            columns={contactColumns}
            tableId="contacts"
            onRowClick={editing === null ? (contact) => setDetailId(contact.id) : undefined}
            // Enter на ячейке в фокусе открывает тот же редактор, что и клик:
            // состояние правки уже описано парой {rowId, columnId}.
            onCellEdit={(contact, columnId) => setEditing({ rowId: contact.id, columnId })}
            pagination={
              totalPages > 1 ? (
                <div className="flex items-center justify-between border-t border-[#e5e5e5] px-4 py-3">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                    className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-40">
                    Назад
                  </button>
                  <span className="text-xs text-[#888888]">Страница {page} из {totalPages}</span>
                  <button type="button" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                    className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#666666] transition-colors hover:bg-[#fafafa] hover:text-[#111111] disabled:opacity-40">
                    Вперёд
                  </button>
                </div>
              ) : undefined
            }
          />
        </div>
      )}

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} resizable>
        <DrawerCreateContact
          onBack={() => setCreateOpen(false)}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            void query.refetch();
          }}
          onSuccess={() => {
            setCreateOpen(false);
            void query.refetch();
          }}
        />
      </Sheet>

      {editTarget !== null && (
        <ContactModal open onClose={() => setEditTarget(null)} onSubmit={handleUpdate} initial={editInitialValues} />
      )}

      {detailTarget !== null && (
        <ContactCard contact={detailTarget}
          onClose={() => closeDetail()}
          onEdit={() => { setEditTarget(detailTarget); closeDetail(); }}
          onDelete={() => handleDelete(detailTarget)}
          isDeleting={isDeleting}
          onOpenCompany={(companyId) => setCompanyDetailId(companyId)} />
      )}

      {/* Карточка компании поверх карточки контакта: переход по связи, как у
          Twenty, где relation-чип открывает запись в той же боковой панели. */}
      {companyDetail.data !== undefined && (
        <CompanyCard
          company={companyDetail.data}
          stats={companyStats.data}
          statsLoading={companyStats.isLoading}
          onClose={() => closeCompanyDetail()}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Удалить контакт"
        description={`Удалить ${deleteTarget !== null ? contactFullName(deleteTarget) : ""}? В связанных сделках останется ссылка на удалённый контакт.`}
        confirmLabel="Удалить"
        variant="destructive"
        isPending={isDeleting}
      />
    </div>
  );
}

export default function ContactsPage() {
  // Cosmetic gate: the API enforces contacts:read on every request.
  return (
    <Guard
      requiredPermission="contacts:read"
      fallback={
        <EmptyState icon={Users} title="Нет доступа к контактам"
          description="У вашей роли нет права contacts:read. Запросите доступ у администратора рабочего пространства." />
      }
    >
      <ContactsPageContent />
    </Guard>
  );
}
