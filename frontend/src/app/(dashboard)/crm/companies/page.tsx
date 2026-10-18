"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Building2, Search, AlertCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CompanyModal } from "@/components/crm/companies/CompanyModal";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import { Sheet } from "@/components/ui/sheet";
import { CompanyCard } from "@/components/crm/companies/CompanyCard";
import { ContactCard } from "@/components/crm/contacts/ContactCard";
import { useContact } from "@/lib/api/use-contacts";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Guard } from "@/components/shared/Guard";
import { type RecordColumn } from "@/components/crm/shared/RecordTable";
import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import { RecordCellShell, RecordCellEditor } from "@/components/crm/shared/RecordCell";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { timeAgo } from "@/lib/utils";
import {
  useCompanies,
  useCompanyStats,
  useCreateCompany,
  useDeleteCompany,
  useUpdateCompany,
  toCompanyFormValues,
  type CompanyDTO,
} from "@/lib/api/use-companies";
import type { CreateCompanyPayload } from "@/schemas/company.schema";
import { useRecordParam } from "@/lib/utils/use-record-param";

const PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

const money = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 });

function CompaniesContent() {
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  /**
   * Только идентификатор, а не снимок объекта: иначе правка поля на карточке
   * сохранялась на сервере, но на экране оставалось прежнее значение — тот же
   * дефект, что был у контактов.
   */
  /**
   * Открытая карточка живёт в адресе (`?record=`), а не в локальном состоянии:
   * поиск в палитре обязан открывать саму компанию, а своего маршрута у карточки
   * нет. Побочно — работающая кнопка «назад» на телефоне и ссылка на карточку.
   */
  const { recordId: detailId, openRecord: setDetailId, closeRecord: closeDetail } =
    useRecordParam();
  /** Контакт, открытый из секции «Контакты» карточки компании. */
  const [contactDetailId, setContactDetailId] = useState<string | null>(null);
  const [edit, setEdit] = useState<CompanyDTO | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CompanyDTO | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [editing, setEditing] = useState<{ rowId: string; columnId: string } | null>(null);

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearch(input.trim());
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [input]);

  const query = useCompanies({ search: search || undefined, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const create = useCreateCompany();
  const update = useUpdateCompany();
  const deleteCompany = useDeleteCompany();
  const stats = useCompanyStats(detailId);
  const contactDetail = useContact(contactDetailId);

  const items = query.data?.items ?? [];
  /** Запись карточки берётся из текущего списка — обновляется вместе с ним. */
  const detail = detailId === null
    ? null
    : items.find((company) => company.id === detailId) ?? null;
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);

  const onCreate = useCallback(async (payload: CreateCompanyPayload) => {
    const created = await create.mutateAsync(payload);
    toast.success(`Компания ${created.name} создана`);
  }, [create]);

  const onUpdate = useCallback(async (payload: CreateCompanyPayload) => {
    if (edit === null) return;
    const updated = await update.mutateAsync({ id: edit.id, payload });
    toast.success(`Компания ${updated.name} обновлена`);
    setEdit(null);
    // Синхронизировать карточку вручную не нужно: она читает запись из кэша
    // списка, а мутация его инвалидирует.
  }, [edit, update]);

  const initialValues = useMemo(() => (edit === null ? undefined : toCompanyFormValues(edit)), [edit]);

  const confirmDelete = useCallback(async () => {
    if (deleteTarget === null) return;
    setIsDeleting(true);
    try {
      await deleteCompany.mutateAsync(deleteTarget.id);
      closeDetail();
      setDeleteTarget(null);
      toast.success(`Компания ${deleteTarget.name} удалена`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось удалить компанию");
    } finally {
      setIsDeleting(false);
    }
  }, [deleteCompany, deleteTarget]);

  const commitCompany = useCallback(
    (company: CompanyDTO, payload: CreateCompanyPayload) => {
      setEditing(null);
      update.mutate(
        { id: company.id, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [update],
  );

  const isEditing = useCallback(
    (rowId: string, columnId: string): boolean => editing?.rowId === rowId && editing.columnId === columnId,
    [editing],
  );

  const companyColumns = useMemo<RecordColumn<CompanyDTO>[]>(() => [
    {
      id: "name",
      header: "Название",
      width: 240,
      sortValue: (company) => company.name,
      render: (company) =>
        isEditing(company.id, "name") ? (
          <RecordCellEditor
            value={company.name}
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length === 0) {
                toast.error("Название не может быть пустым");
                setEditing(null);
                return;
              }
              commitCompany(company, { ...toCompanyFormValues(company), name: trimmed });
            }}
          />
        ) : (
          <RecordCellShell
            editable
            isLabelIdentifier
            onStartEdit={() => setEditing({ rowId: company.id, columnId: "name" })}
          >
            <EntityChip name={company.name} domain={company.domainName} icon={Building2} />
            <span className="truncate font-medium text-[#111111]">{company.name}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "domain",
      header: "Домен",
      width: 180,
      sortValue: (company) => company.domainName,
      render: (company) =>
        isEditing(company.id, "domain") ? (
          <RecordCellEditor
            value={company.domainName}
            onCancel={() => setEditing(null)}
            onCommit={(value) =>
              commitCompany(company, { ...toCompanyFormValues(company), domain_name: value.trim() })
            }
          />
        ) : (
          <RecordCellShell
            editable
            isEmpty={company.domainName === ""}
            emptyLabel="домен"
            onStartEdit={() => setEditing({ rowId: company.id, columnId: "domain" })}
          >
            <span className="truncate text-[#4a38f5]">{company.domainName}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "reach",
      header: "Телефон / E-mail",
      width: 240,
      render: (company) => (
        <RecordCellShell isEmpty={company.phone === "" && company.email === ""} emptyLabel="контакты">
          <span className="truncate text-[#666666]">
            {[company.phone, company.email].filter((value) => value !== "").join(" · ")}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "inn",
      header: "ИНН",
      width: 140,
      sortValue: (company) => company.requisites.inn,
      render: (company) => (
        <RecordCellShell isEmpty={company.requisites.inn === ""} emptyLabel="ИНН">
          <span className="truncate font-mono text-xs text-[#666666]">{company.requisites.inn}</span>
        </RecordCellShell>
      ),
    },
    {
      id: "manager",
      header: "Ответственный",
      width: 180,
      sortValue: (company) => company.managerName,
      render: (company) => (
        <RecordCellShell isEmpty={company.managerName === ""} emptyLabel="ответственного">
          {company.managerName !== "" && (
            <EntityChip name={company.managerName} label={company.managerName} size="sm" />
          )}
        </RecordCellShell>
      ),
    },
    {
      id: "contacts",
      header: "Контактов",
      width: 110,
      align: "right",
      sortValue: (company) => company.contactsCount,
      render: (company) => (
        <RecordCellShell align="right">
          <span className={company.contactsCount > 0 ? "tabular-nums text-[#111111]" : "tabular-nums text-[#888888]"}>
            {company.contactsCount}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "deals",
      header: "Сделок",
      width: 104,
      align: "right",
      sortValue: (company) => company.dealsCount,
      render: (company) => (
        <RecordCellShell align="right">
          <span className={company.dealsCount > 0 ? "tabular-nums text-[#111111]" : "tabular-nums text-[#888888]"}>
            {company.dealsCount}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "budget",
      header: "Сумма сделок",
      width: 150,
      align: "right",
      sortValue: (company) => company.dealsBudgetTotal,
      render: (company) => (
        <RecordCellShell align="right">
          <span className={company.dealsBudgetTotal > 0 ? "font-medium tabular-nums text-[#111111]" : "tabular-nums text-[#888888]"}>
            {money.format(company.dealsBudgetTotal)}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "created",
      header: "Создана",
      width: 120,
      align: "right",
      sortValue: (company) => company.createdAt,
      render: (company) => (
        <RecordCellShell align="right">
          <span
            title={new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(company.createdAt))}
            className="text-[#888888]"
          >
            {timeAgo(company.createdAt)}
          </span>
        </RecordCellShell>
      ),
    },
  ], [isEditing, commitCompany]);

  const subtitle = query.isLoading ? "Загрузка…" : `Компаний: ${total} · страница ${page} из ${pages}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#111111]">Компании</h1>
          <p className="mt-1 text-xs text-[#666666]">{subtitle}</p>
        </div>
        <Guard requiredPermission="companies:write">
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0]"
          >
            <Plus className="h-3.5 w-3.5" />Добавить компанию
          </button>
        </Guard>
      </div>

      <div className="relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
        <input
          type="search"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Поиск по названию, ИНН, телефону, ответственному..."
          aria-label="Поиск компаний"
          className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white py-1.5 pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
        />
      </div>

      {query.isLoading ? (
        <SkeletonTable rows={6} columns={5} />
      ) : query.isError ? (
        <div role="alert" className="flex gap-3 rounded-[8px] border border-rose-200 bg-rose-50 p-6">
          <AlertCircle className="h-5 w-5 text-rose-600" />
          <div>
            <p className="text-sm font-semibold text-rose-700">Не удалось загрузить компании</p>
            <p className="mt-1 text-sm text-[#666666]">{query.error.message}</p>
            <button type="button" onClick={() => void query.refetch()} className="mt-3 flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-800">
              <RefreshCw className="h-3.5 w-3.5" />Повторить
            </button>
          </div>
        </div>
      ) : (
        <SyncedRecordTable
          rows={items}
          getRowId={(company) => company.id}
          columns={companyColumns}
          tableId="companies"
          onRowClick={editing === null ? (company) => setDetailId(company.id) : undefined}
          onCellEdit={(company, columnId) => setEditing({ rowId: company.id, columnId })}
          footerCells={{
            name: `${total} записей`,
            budget: (
              <span className="font-semibold text-[#111111] tabular-nums">
                {money.format(items.reduce((sum, company) => sum + company.dealsBudgetTotal, 0))}
              </span>
            ),
          }}
          emptyState={
            <EmptyState
              icon={Building2}
              title={search !== "" ? "Нет компаний по фильтру" : "Нет компаний"}
              description={search !== "" ? "Измените поисковый запрос." : "Добавьте первую компанию."}
              action={
                <Guard requiredPermission="companies:write">
                  <button type="button" onClick={() => setCreateOpen(true)} className="rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#3b2be0]">
                    Добавить компанию
                  </button>
                </Guard>
              }
            />
          }
          pagination={
            pages > 1 ? (
              <div className="flex justify-between border-t border-[#e5e5e5] px-4 py-3">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="text-xs text-[#666666] disabled:opacity-40">Назад</button>
                <span className="text-xs text-[#666666]">Страница {page} из {pages}</span>
                <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="text-xs text-[#666666] disabled:opacity-40">Вперёд</button>
              </div>
            ) : undefined
          }
        />
      )}

      <Sheet open={createOpen} onClose={() => setCreateOpen(false)} resizable>
        <DrawerCreateCompany
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

      {edit !== null && (
        <CompanyModal open onClose={() => setEdit(null)} onSubmit={onUpdate} initial={initialValues} />
      )}

      {detail !== null && (
        <CompanyCard
          company={detail}
          stats={stats.data}
          statsLoading={stats.isLoading}
          onClose={() => closeDetail()}
          onEdit={() => {
            setEdit(detail);
            closeDetail();
          }}
          onDelete={() => setDeleteTarget(detail)}
          isDeleting={isDeleting}
          onOpenContact={(contactId) => setContactDetailId(contactId)}
        />
      )}

      {/* Карточка контакта поверх карточки компании — переход по связи, как у
          Twenty, где relation-чип открывает запись в той же панели. */}
      {contactDetail.data !== undefined && (
        <ContactCard
          contact={contactDetail.data}
          onClose={() => setContactDetailId(null)}
          onEdit={() => setContactDetailId(null)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Удалить компанию"
        description={`Удалить ${deleteTarget?.name ?? ""}? Связанные контакты и сделки останутся, но потеряют ссылку на компанию.`}
        confirmLabel="Удалить"
        variant="destructive"
        isPending={isDeleting}
      />
    </div>
  );
}

export default function CompaniesPage() {
  return (
    <Guard requiredPermission="companies:read" fallback={<EmptyState icon={Building2} title="Нет доступа к компаниям" description="Запросите право companies:read у администратора." />}>
      <CompaniesContent />
    </Guard>
  );
}
