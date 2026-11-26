"use client";

import { useState, useCallback, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Banknote,
  TrendingUp,
  TrendingDown,
  DollarSign,
  ArrowRightLeft,
  Receipt,
  FileText,
  BarChart3,
  FolderTree,
  Building2,
  Pencil,
  Trash2,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";
import { BalanceCards } from "@/components/finance/BalanceCards";
import { CreateAccountModal } from "@/components/finance/CreateAccountModal";
import { TransactionsTable } from "@/components/finance/TransactionsTable";
import { CreateTransactionModal } from "@/components/finance/CreateTransactionModal";
import { TransferModal } from "@/components/finance/TransferModal";
import { InvoiceCreateModal } from "@/components/finance/InvoiceCreateModal";
import { InvoiceEditModal, type EditableInvoiceData } from "@/components/finance/InvoiceEditModal";
import { BulkEditInvoicesModal } from "@/components/finance/BulkEditInvoicesModal";
import { InvoiceViewModal } from "@/components/finance/InvoiceViewModal";
import { ProfitLossView } from "@/components/finance/ProfitLossView";
import { CategoriesSettingsModal } from "@/components/finance/CategoriesSettingsModal";
import { OrganizationSettingsTab } from "@/components/finance/OrganizationSettingsTab";
import { Guard } from "@/components/shared/Guard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import type { AccountBalance, Transaction } from "@/lib/finance/finance.types";
import type { Invoice } from "@/lib/finance/invoices.types";
import type { TransactionDTO, InvoiceDTO, PnlDTO } from "@/lib/api/use-invoices";
import {
  useAccounts,
  useTransactions,
  useInvoices,
  usePnl,
  useCreateTransaction,
  useTransfer,
  useCreateInvoice,
  useDeleteInvoice,
  useBulkDeleteInvoices,
} from "@/lib/api/use-invoices";
import type { CreateTransactionPayload } from "@/schemas/finance.schema";
import type { PrefilledInvoicePayload } from "@/components/finance/InvoiceCreateModal";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { TableBulkBar } from "@/components/crm/shared/TableBulkBar";
import {
  WarehousePagination,
  type WarehouseLimit,
} from "@/components/warehouse/WarehousePagination";
import { useTableSelection } from "@/lib/hooks/use-table-selection";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

type FinanceTab = "transactions" | "invoices" | "pnl" | "organization";

const TABS: { key: FinanceTab; label: string; icon: typeof Banknote }[] = [
  { key: "transactions", label: "Операции", icon: FileText },
  { key: "invoices", label: "Счета", icon: Receipt },
  { key: "pnl", label: "Отчёт о прибылях и убытках", icon: BarChart3 },
  { key: "organization", label: "Организация", icon: Building2 },
];

const INVOICE_STATUS_TEXT: Record<Invoice["status"], string> = {
  draft: "Черновик",
  sent: "Отправлен",
  paid: "Оплачен",
  overdue: "Просрочен",
  cancelled: "Отменён",
};

function toTransaction(dto: TransactionDTO): Transaction {
  return {
    id: dto.id,
    date: dto.occurredAt,
    type: dto.type,
    category: dto.categoryName as Transaction["category"],
    category_id: dto.categoryId ?? null,
    amount: dto.amount,
    account_id: dto.accountId,
    account_name: dto.accountName,
    description: dto.description,
    linked_entity_id: dto.dealId ?? dto.repairOrderId ?? dto.invoiceId ?? dto.supplierOrderId ?? null,
    linked_entity_type: dto.dealId
      ? "deal"
      : dto.repairOrderId
        ? "repair"
        : dto.invoiceId
          ? "invoice"
          : dto.supplierOrderId
            ? "supplier_order"
            : null,
    linked_entity_label: dto.dealTitle ?? dto.repairTicketNumber ?? null,
    deal_id: dto.dealId ?? null,
    deal_title: dto.dealTitle ?? null,
    repair_order_id: dto.repairOrderId ?? null,
    repair_ticket_number: dto.repairTicketNumber ?? null,
    supplier_order_id: dto.supplierOrderId ?? null,
    is_capitalized_cost: Boolean(dto.isCapitalizedCost),
    counterparty: dto.counterpartyName ?? "",
    counterparty_inn: dto.counterpartyInn ?? "",
    created_by_id: dto.createdById ?? null,
    created_by_name: dto.createdByName ?? "",
  };
}

function toInvoice(dto: InvoiceDTO): Invoice {
  return {
    id: dto.id,
    invoice_number: dto.invoiceNumber,
    status: dto.status,
    issue_date: dto.issueDate,
    due_date: dto.dueDate,
    company_name: dto.companyName,
    company_inn: dto.companyInn,
    company_address: dto.companyAddress,
    contact_name: dto.contactName,
    contact_phone: dto.contactPhone,
    line_items: dto.lineItems.map(li => ({
      id: li.id,
      description: li.description,
      quantity: li.quantity,
      unit_price: li.unitPrice,
      total: li.total,
      source: li.source as Invoice["line_items"][number]["source"],
      source_label: li.sourceLabel,
    })),
    subtotal: dto.subtotal,
    vat_mode: dto.vatMode,
    vat_rate: dto.vatRate,
    vat_amount: dto.vatAmount,
    total: dto.total,
    currency: dto.currency,
    notes: dto.notes,
    created_by: "",
    issuer_organization_id: dto.issuerOrganizationId ?? null,
    issuer_snapshot: dto.issuerSnapshot ?? null,
    elba_bill_id: dto.elbaBillId ?? "",
    elba_synced_at: dto.elbaSyncedAt ?? null,
    elba_sync_error: dto.elbaSyncError ?? "",
  };
}

/**
 * Содержимое вынесено из страницы, потому что `useSearchParams()` требует
 * границы Suspense: без неё сборка падает на пререндере `/finance`
 * (missing-suspense-with-csr-bailout). `Suspense` уже импортировался, но не
 * использовался.
 */
function FinancePageContent() {
  const [tab, setTab] = useState<FinanceTab>("transactions");
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [accountModalOpen, setAccountModalOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
  const [invoiceViewId, setInvoiceViewId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [deletingInvoice, setDeletingInvoice] = useState<Invoice | null>(null);
  const [bulkEditInvoicesOpen, setBulkEditInvoicesOpen] = useState(false);
  const [confirmBulkDeleteInvoicesOpen, setConfirmBulkDeleteInvoicesOpen] = useState(false);
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);
  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState(searchParams.get("search") ?? "");
  const [filterType, setFilterType] = useState<"all" | "income" | "expense">("all");

  const [txPage, setTxPage] = useState(1);
  const [txLimit, setTxLimit] = useState<WarehouseLimit>(25);
  const [txSortColumn, setTxSortColumn] = useState<string | null>(null);
  const [txSortAsc, setTxSortAsc] = useState(true);

  const [invPage, setInvPage] = useState(1);
  const [invLimit, setInvLimit] = useState<WarehouseLimit>(25);
  const [invSortColumn, setInvSortColumn] = useState<string | null>(null);
  const [invSortAsc, setInvSortAsc] = useState(true);

  const handleTxSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    setTxPage(1);
  }, []);

  const handleTxFilterTypeChange = useCallback((nextType: "all" | "income" | "expense") => {
    setFilterType(nextType);
    setTxPage(1);
  }, []);

  const handleTxSortChange = useCallback((columnId: string | null, asc: boolean) => {
    setTxSortColumn(columnId);
    setTxSortAsc(asc);
    setTxPage(1);
  }, []);

  const handleInvSortChange = useCallback((columnId: string | null, asc: boolean) => {
    setInvSortColumn(columnId);
    setInvSortAsc(asc);
    setInvPage(1);
  }, []);

  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: transactionsData, isLoading: txLoading, isError: txError } = useTransactions({
    limit: txLimit,
    offset: (txPage - 1) * txLimit,
    search: searchQuery || undefined,
    type: filterType !== "all" ? filterType : undefined,
    sortBy: txSortColumn ?? undefined,
    sortDir: txSortColumn ? (txSortAsc ? "asc" : "desc") : undefined,
  });
  const { data: invoicesData, isLoading: invLoading, isError: invError } = useInvoices({
    limit: invLimit,
    offset: (invPage - 1) * invLimit,
    sortBy: invSortColumn ?? undefined,
    sortDir: invSortColumn ? (invSortAsc ? "asc" : "desc") : undefined,
  });
  const { data: pnlData } = usePnl();

  const createTxMutation = useCreateTransaction();
  const transferMutation = useTransfer();
  const createInvoiceMutation = useCreateInvoice();
  const deleteInvoiceMutation = useDeleteInvoice();
  const bulkDeleteInvoicesMutation = useBulkDeleteInvoices();

  const transactions = useMemo(() => (transactionsData?.items ?? []).map(toTransaction), [transactionsData]);
  const invoices = useMemo(() => (invoicesData?.items ?? []).map(toInvoice), [invoicesData]);
  const invoiceViewTarget = useMemo(
    () => (invoiceViewId ? invoices.find((inv) => inv.id === invoiceViewId) ?? null : null),
    [invoiceViewId, invoices],
  );
  const editingInvoiceData = useMemo<EditableInvoiceData | null>(() => {
    if (!editingInvoiceId) return null;
    const dto = (invoicesData?.items ?? []).find((item) => item.id === editingInvoiceId);
    if (!dto) return null;
    return {
      id: dto.id,
      invoiceNumber: dto.invoiceNumber,
      status: dto.status,
      dueDate: dto.dueDate,
      issuerOrganizationId: dto.issuerOrganizationId ?? null,
      companyName: dto.companyName,
      companyInn: dto.companyInn,
      companyAddress: dto.companyAddress,
      contactName: dto.contactName,
      contactPhone: dto.contactPhone,
      vatMode: dto.vatMode,
      vatRate: dto.vatRate,
      notes: dto.notes,
      lineItems: dto.lineItems.map((li) => ({
        id: li.id,
        description: li.description,
        quantity: li.quantity,
        unitPrice: li.unitPrice,
        source: li.source,
        sourceLabel: li.sourceLabel,
      })),
    };
  }, [editingInvoiceId, invoicesData]);

  const transactionsTotal = transactionsData?.total ?? transactions.length;
  const invoicesTotal = invoicesData?.total ?? invoices.length;
  const pageInvoiceIds = useMemo(() => invoices.map((inv) => inv.id), [invoices]);
  const invoiceSelection = useTableSelection({
    filterKey: "finance-invoices",
    totalCount: invoicesTotal,
  });

  const selectedInvoices = useMemo(
    () => invoices.filter((inv) => invoiceSelection.selectedIds.has(inv.id)),
    [invoices, invoiceSelection.selectedIds],
  );
  const selectedPaidInvoicesCount = useMemo(
    () => selectedInvoices.filter((inv) => inv.status === "paid").length,
    [selectedInvoices],
  );

  const monthlyIncome = useMemo(() => transactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0), [transactions]);
  const monthlyExpense = useMemo(() => transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0), [transactions]);
  const monthlyPnL = monthlyIncome - monthlyExpense;

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setInvoiceCreateOpen(true);
    }
    const requestedTab = searchParams.get("tab");
    if (
      requestedTab === "transactions" ||
      requestedTab === "invoices" ||
      requestedTab === "pnl" ||
      requestedTab === "organization"
    ) {
      setTab(requestedTab);
    }
  }, [searchParams]);

  const handleCreateTransaction = useCallback(async (p: CreateTransactionPayload) => {
    try {
      await createTxMutation.mutateAsync(p);
      toast.success(p.type === "income" ? "Доходная операция создана" : "Расходная операция создана");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось создать операцию";
      toast.error(msg);
      throw err;
    }
  }, [createTxMutation]);

  const handleTransfer = useCallback(async (p: { from_account_id: string; to_account_id: string; amount: number }) => {
    try {
      await transferMutation.mutateAsync(p);
      toast.success("Перевод успешно выполнен");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось выполнить перевод";
      toast.error(msg);
      throw err;
    }
  }, [transferMutation]);

  const handleCreateInvoice = useCallback(async (p: PrefilledInvoicePayload) => {
    const payload: Parameters<typeof createInvoiceMutation.mutateAsync>[0] = {
      issuer_organization_id: p.issuer_organization_id || undefined,
      company_id: p.company_id || undefined,
      company_name: p.company_name || "Покупатель",
      company_inn: p.company_inn || "",
      company_address: p.company_address || "",
      contact_name: p.contact_name || "",
      contact_phone: p.contact_phone || "",
      due_date: p.due_date.includes("T") ? new Date(p.due_date).toISOString() : new Date(`${p.due_date}T12:00:00Z`).toISOString(),
      line_items: p.line_items.map(li => ({
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        source: li.source,
        source_label: li.source_label ?? "",
      })),
      vat_mode: p.vat_mode,
      vat_rate: p.vat_rate,
      notes: p.notes ?? "",
    };
    await createInvoiceMutation.mutateAsync(payload);
  }, [createInvoiceMutation]);

  const handleSingleDeleteInvoice = useCallback(async () => {
    if (!deletingInvoice) return;
    try {
      await deleteInvoiceMutation.mutateAsync(deletingInvoice.id);
      toast.success(`Счёт ${deletingInvoice.invoice_number} удалён`);
      setDeletingInvoice(null);
      if (invoiceSelection.isRowSelected(deletingInvoice.id)) {
        invoiceSelection.toggleRow(deletingInvoice.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить счёт");
    }
  }, [deletingInvoice, deleteInvoiceMutation, invoiceSelection]);

  const handleBulkDeleteInvoices = useCallback(async () => {
    if (invoiceSelection.effectiveSelectedCount === 0) return;
    try {
      const payload = invoiceSelection.buildBulkPayload({});
      const res = await bulkDeleteInvoicesMutation.mutateAsync(payload);
      if (res.skippedPaid > 0) {
        toast.success(`Удалено счетов: ${res.deleted} (пропущено оплаченных: ${res.skippedPaid})`);
      } else {
        toast.success(res.deleted === 1 ? "Счёт удалён" : `Удалено счетов: ${res.deleted}`);
      }
      invoiceSelection.clear();
      setConfirmBulkDeleteInvoicesOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить счета");
    }
  }, [invoiceSelection, bulkDeleteInvoicesMutation]);

  const invoiceBulkBar = useMemo(() => {
    return (
      <TableBulkBar
        selectedCount={invoiceSelection.effectiveSelectedCount}
        totalCount={invoicesTotal}
        isAllSelected={invoiceSelection.isAllSelected}
        excludedCount={invoiceSelection.excludedCount}
        entityNamePlural="счетов"
        pageItemCount={invoices.length}
        onSelectAll={invoiceSelection.selectAllAcrossPages}
        onClearSelection={invoiceSelection.clear}
        onDelete={() => setConfirmBulkDeleteInvoicesOpen(true)}
        isDeleting={bulkDeleteInvoicesMutation.isPending}
      >
        <button
          type="button"
          onClick={() => setBulkEditInvoicesOpen(true)}
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
          title="Массово изменить статус, срок оплаты или примечание"
        >
          <Pencil className="h-3.5 w-3.5 text-[#4a38f5]" />
          <span>Редактировать</span>
        </button>
      </TableBulkBar>
    );
  }, [
    invoiceSelection.effectiveSelectedCount,
    invoiceSelection.isAllSelected,
    invoiceSelection.excludedCount,
    invoiceSelection.selectAllAcrossPages,
    invoiceSelection.clear,
    invoicesTotal,
    invoices.length,
    bulkDeleteInvoicesMutation.isPending,
  ]);

  const invoiceColumns = useMemo<RecordColumn<Invoice>[]>(
    () => [
      {
        id: "invoice_number",
        header: "Счёт №",
        width: 140,
        sortValue: (inv) => inv.invoice_number,
        render: (inv) => (
          <RecordCellShell isLabelIdentifier>
            <span className="font-mono text-xs font-medium text-[#111111]">{inv.invoice_number}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "company_name",
        header: "Компания",
        width: 220,
        sortValue: (inv) => inv.company_name,
        render: (inv) => (
          <RecordCellShell>
            <span className="truncate text-xs text-[#111111]">{inv.company_name}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "total",
        header: "Сумма",
        width: 140,
        align: "right",
        sortValue: (inv) => inv.total,
        render: (inv) => (
          <RecordCellShell align="right">
            <span className="font-mono text-xs font-medium text-[#111111]">
              {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(inv.total)}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "status",
        header: "Статус",
        width: 120,
        sortValue: (inv) => inv.status,
        render: (inv) => {
          const color: TagColor =
            inv.status === "paid"
              ? "emerald"
              : inv.status === "overdue"
                ? "rose"
                : inv.status === "sent"
                  ? "sky"
                  : "slate";
          return (
            <RecordCellShell>
              <TagPill color={color}>{INVOICE_STATUS_TEXT[inv.status] ?? inv.status}</TagPill>
            </RecordCellShell>
          );
        },
      },
      {
        id: "row_actions",
        header: "",
        width: 112,
        sortable: false,
        render: (inv) => {
          const isPaid = inv.status === "paid";
          return (
            <RecordCellShell>
              <div
                className="flex w-full items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  disabled={isPaid}
                  title={isPaid ? "Оплаченный счёт нельзя редактировать" : "Редактировать счёт"}
                  onClick={() => setEditingInvoiceId(inv.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-transparent text-[#666666] hover:border-[#e5e5e5] hover:bg-white hover:text-[#4a38f5] transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-[#666666]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={isPaid}
                  title={isPaid ? "Оплаченный счёт нельзя удалить" : "Удалить счёт"}
                  onClick={() => setDeletingInvoice(inv)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-transparent text-[#888888] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-transparent disabled:hover:bg-transparent disabled:hover:text-[#888888]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  title="Открыть счёт"
                  onClick={() => setInvoiceViewId(inv.id)}
                  className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] border border-transparent text-[#888888] hover:border-[#e5e5e5] hover:bg-white hover:text-[#111111] transition-colors cursor-pointer"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </RecordCellShell>
          );
        },
      },
    ],
    [],
  );

  return (
    <Guard requiredPermission="finance:read" requiredModule="finance">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold text-[#111111]">Финансы</h1><p className="mt-1 text-sm text-[#666666]">Счета, операции, выставленные счета и прибыль</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setCategoriesModalOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"><FolderTree className="h-3.5 w-3.5 text-[#666666]" />Статьи</button>
            <button type="button" onClick={() => setTransferOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-700 hover:bg-sky-100 transition-colors"><ArrowRightLeft className="h-3.5 w-3.5" />Перевод</button>
            <button type="button" onClick={() => setInvoiceCreateOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"><Receipt className="h-3.5 w-3.5" />Новый счёт</button>
            <button type="button" onClick={() => setTxModalOpen(true)}
              className={cn("flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-colors bg-[#4a38f5] text-white hover:bg-[#3d2ee0]")}><Plus className="h-4 w-4" />Операция</button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs"><div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-50 p-1.5"><TrendingUp className="h-4 w-4 text-emerald-600" /></div><span className="text-xs font-medium text-[#666666]">Доходы за месяц</span></div><p className="mt-2 text-2xl font-bold text-[#111111]">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyIncome)}</p></div>
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs"><div className="flex items-center gap-2"><div className="rounded-lg bg-rose-50 p-1.5"><TrendingDown className="h-4 w-4 text-rose-600" /></div><span className="text-xs font-medium text-[#666666]">Расходы за месяц</span></div><p className="mt-2 text-2xl font-bold text-[#111111]">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyExpense)}</p></div>
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs"><div className="flex items-center gap-2"><div className="rounded-lg bg-[#4a38f5]/10 p-1.5"><DollarSign className="h-4 w-4 text-[#4a38f5]" /></div><span className="text-xs font-medium text-[#666666]">Чистая прибыль</span></div><p className={cn("mt-2 text-2xl font-bold", monthlyPnL >= 0 ? "text-emerald-600" : "text-rose-600")}>{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyPnL)}</p></div>
        </div>

        <BalanceCards accounts={accounts} onAddAccount={() => setAccountModalOpen(true)} />

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 rounded-lg bg-white border border-[#e5e5e5] p-1 w-fit">
          {TABS.map(t => { const Icon = t.icon; return (<button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn("flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer", tab === t.key ? "bg-[#4a38f5] text-white" : "text-[#666666] hover:text-[#111111]")}><Icon className="h-3.5 w-3.5" />{t.label}</button>); })}
        </div>

        {/* Tab Content */}
        {tab === "transactions" && (
          <TransactionsTable
            transactions={transactions}
            searchQuery={searchQuery}
            onSearchChange={handleTxSearchChange}
            filterType={filterType}
            onFilterTypeChange={handleTxFilterTypeChange}
            totalCount={transactionsTotal}
            page={txPage}
            limit={txLimit}
            onPageChange={setTxPage}
            onLimitChange={(newLimit) => {
              setTxLimit(newLimit as WarehouseLimit);
              setTxPage(1);
            }}
            serverSort={true}
            sortColumn={txSortColumn}
            sortAsc={txSortAsc}
            onSortChange={handleTxSortChange}
            isLoading={txLoading}
            isError={txError}
            error={txError ? new Error("Failed to load transactions") : null}
            onOpenCategories={() => setCategoriesModalOpen(true)}
          />
        )}
        {tab === "invoices" && (
          <RecordTable
            rows={invoices}
            columns={invoiceColumns}
            getRowId={(inv) => inv.id}
            tableId="finance_invoices"
            serverSort={true}
            sortColumn={invSortColumn}
            sortAsc={invSortAsc}
            onSortChange={handleInvSortChange}
            selectable
            selectedIds={invoiceSelection.getPageSelectedIds(pageInvoiceIds)}
            onSelectionChange={(next) => invoiceSelection.onPageSelectionChange(next, pageInvoiceIds)}
            bulkBar={invoiceBulkBar}
            pagination={
              <WarehousePagination
                total={invoicesTotal}
                page={invPage}
                pages={Math.max(1, Math.ceil(invoicesTotal / invLimit))}
                limit={invLimit}
                entityLabel="счетов"
                onPageChange={setInvPage}
                onLimitChange={(newLimit) => {
                  setInvLimit(newLimit as WarehouseLimit);
                  setInvPage(1);
                }}
                disabled={invLoading}
              />
            }
            onRowClick={(inv) => setInvoiceViewId(inv.id)}
            emptyState={
              <div className="flex flex-col items-center gap-2 py-16 text-center">
                <Receipt className="h-8 w-8 text-[#888888]" />
                <p className="text-xs text-[#666666]">Нет счетов</p>
              </div>
            }
          />
        )}
        {tab === "pnl" && <ProfitLossView transactions={transactions} pnl={pnlData} />}
        {tab === "organization" && <OrganizationSettingsTab />}

        {/* Modals */}
        <CreateTransactionModal
          open={txModalOpen}
          onClose={() => setTxModalOpen(false)}
          onSubmit={handleCreateTransaction}
          accounts={accounts}
          onOpenCategories={() => setCategoriesModalOpen(true)}
        />
        <CreateAccountModal open={accountModalOpen} onClose={() => setAccountModalOpen(false)} />
        <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onSubmit={handleTransfer} accounts={accounts} />
        <InvoiceCreateModal open={invoiceCreateOpen} onClose={() => setInvoiceCreateOpen(false)} onSubmit={handleCreateInvoice} />
        <InvoiceEditModal
          open={!!editingInvoiceData}
          invoice={editingInvoiceData}
          onClose={() => setEditingInvoiceId(null)}
        />
        <BulkEditInvoicesModal
          open={bulkEditInvoicesOpen}
          invoices={selectedInvoices}
          selectionMode={invoiceSelection.isAllSelected ? "all" : "ids"}
          excludedIds={Array.from(invoiceSelection.excludedIds)}
          effectiveCount={invoiceSelection.effectiveSelectedCount}
          onClose={() => setBulkEditInvoicesOpen(false)}
          onSaved={() => invoiceSelection.clear()}
        />
        <InvoiceViewModal open={!!invoiceViewTarget} invoice={invoiceViewTarget} onClose={() => setInvoiceViewId(null)} />
        <CategoriesSettingsModal open={categoriesModalOpen} onClose={() => setCategoriesModalOpen(false)} />
        <ConfirmDialog
          open={!!deletingInvoice}
          onClose={() => setDeletingInvoice(null)}
          onConfirm={handleSingleDeleteInvoice}
          title="Удалить счёт?"
          description={
            deletingInvoice
              ? `Вы уверены, что хотите удалить счёт ${deletingInvoice.invoice_number} (${deletingInvoice.company_name})? Связанные наряды на ремонт при отсутствии других активных счетов вернутся в статус «Не оплачен».`
              : ""
          }
          confirmLabel="Удалить счёт"
          variant="destructive"
          isPending={deleteInvoiceMutation.isPending}
        />
        <ConfirmDialog
          open={confirmBulkDeleteInvoicesOpen}
          onClose={() => setConfirmBulkDeleteInvoicesOpen(false)}
          onConfirm={handleBulkDeleteInvoices}
          title={`Удалить выбранные счета (${invoiceSelection.effectiveSelectedCount})?`}
          description={
            !invoiceSelection.isAllSelected && selectedPaidInvoicesCount > 0
              ? selectedPaidInvoicesCount === invoiceSelection.effectiveSelectedCount
                ? "Все выбранные счета уже оплачены — оплаченные счета нельзя удалить."
                : `Будут удалены неоплаченные счета (${invoiceSelection.effectiveSelectedCount - selectedPaidInvoicesCount} шт.). Оплаченные счета (${selectedPaidInvoicesCount} шт.) будут пропущены.`
              : `Вы уверены, что хотите удалить выбранные счета (${invoiceSelection.effectiveSelectedCount} шт.)? Оплаченные счета будут пропущены, а связанные наряды на ремонт без других активных счетов вернутся в статус «Не оплачен».`
          }
          confirmLabel="Удалить выбранные"
          variant="destructive"
          isPending={bulkDeleteInvoicesMutation.isPending}
        />
      </div>
    </Guard>
  );
}

export default function FinancePage() {
  return (
    <Suspense fallback={null}>
      <FinancePageContent />
    </Suspense>
  );
}

function invoicesLoading(isLoading: boolean, invoices: Invoice[]) {
  if (isLoading) {
    return Array.from({ length: 5 }).map((_, i) => (
      <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 w-full bg-[#f0f0f0] rounded animate-pulse" /></td></tr>
    ));
  }
  if (invoices.length === 0) {
    return (
      <tr><td colSpan={5} className="px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-2">
          <Receipt className="h-8 w-8 text-[#cccccc]" />
          <p className="text-sm text-[#888888]">Нет счетов</p>
        </div>
      </td></tr>
    );
  }
  return null;
}