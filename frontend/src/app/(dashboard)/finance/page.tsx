"use client";

import { useState, useCallback, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Plus, Banknote, TrendingUp, TrendingDown, DollarSign, ArrowRightLeft, Receipt, FileText, BarChart3 } from "lucide-react";
import { BalanceCards } from "@/components/finance/BalanceCards";
import { TransactionsTable } from "@/components/finance/TransactionsTable";
import { CreateTransactionModal } from "@/components/finance/CreateTransactionModal";
import { TransferModal } from "@/components/finance/TransferModal";
import { InvoiceCreateModal } from "@/components/finance/InvoiceCreateModal";
import { InvoiceViewModal } from "@/components/finance/InvoiceViewModal";
import { ProfitLossView } from "@/components/finance/ProfitLossView";
import { Guard } from "@/components/shared/Guard";
import type { AccountBalance, Transaction } from "@/lib/finance/finance.types";
import type { Invoice } from "@/lib/finance/invoices.types";
import type { TransactionDTO, InvoiceDTO, PnlDTO } from "@/lib/api/use-invoices";
import { useAccounts, useTransactions, useInvoices, usePnl, useCreateTransaction, useTransfer, useCreateInvoice } from "@/lib/api/use-invoices";
import type { CreateTransactionPayload } from "@/schemas/finance.schema";
import type { PrefilledInvoicePayload } from "@/components/finance/InvoiceCreateModal";
import { cn } from "@/lib/utils";

type FinanceTab = "transactions" | "invoices" | "pnl";

const TABS: { key: FinanceTab; label: string; icon: typeof Banknote }[] = [
  { key: "transactions", label: "Операции", icon: FileText },
  { key: "invoices", label: "Счета", icon: Receipt },
  { key: "pnl", label: "Отчёт о прибылях и убытках", icon: BarChart3 },
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
    amount: dto.amount,
    account_id: dto.accountId,
    account_name: dto.accountName,
    description: dto.description,
    linked_entity_id: dto.dealId ?? dto.repairOrderId ?? dto.invoiceId,
    linked_entity_type: dto.dealId ? "deal" : dto.repairOrderId ? "repair" : dto.invoiceId ? "invoice" : null,
    linked_entity_label: null,
    counterparty: "",
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
    vat_rate: dto.vatRate,
    vat_amount: dto.vatAmount,
    total: dto.total,
    currency: dto.currency,
    notes: dto.notes,
    created_by: "",
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
  const [transferOpen, setTransferOpen] = useState(false);
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
  const [invoiceViewTarget, setInvoiceViewTarget] = useState<Invoice | null>(null);
  const searchParams = useSearchParams();

  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const { data: transactionsData, isLoading: txLoading, isError: txError } = useTransactions({ limit: 25, offset: 0 });
  const { data: invoicesData, isLoading: invLoading, isError: invError } = useInvoices({ limit: 25, offset: 0 });
  const { data: pnlData } = usePnl();

  const createTxMutation = useCreateTransaction();
  const transferMutation = useTransfer();
  const createInvoiceMutation = useCreateInvoice();

  const transactions = useMemo(() => (transactionsData?.items ?? []).map(toTransaction), [transactionsData]);
  const invoices = useMemo(() => (invoicesData?.items ?? []).map(toInvoice), [invoicesData]);

  const monthlyIncome = useMemo(() => transactions.filter(t => t.type === "income").reduce((s, t) => s + t.amount, 0), [transactions]);
  const monthlyExpense = useMemo(() => transactions.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0), [transactions]);
  const monthlyPnL = monthlyIncome - monthlyExpense;

  useEffect(() => {
    if (searchParams.get("create") === "1") {
      setInvoiceCreateOpen(true);
    }
  }, [searchParams]);

  const handleCreateTransaction = useCallback(async (p: CreateTransactionPayload) => {
    await createTxMutation.mutateAsync(p);
  }, [createTxMutation]);

  const handleTransfer = useCallback(async (p: { from_account_id: string; to_account_id: string; amount: number }) => {
    await transferMutation.mutateAsync(p);
  }, [transferMutation]);

  const handleCreateInvoice = useCallback(async (p: PrefilledInvoicePayload) => {
    const payload: Parameters<typeof createInvoiceMutation.mutateAsync>[0] = {
      company_name: p.company_name || "Acme Corp",
      due_date: p.due_date,
      line_items: p.line_items.map(li => ({
        description: li.description,
        quantity: li.quantity,
        unit_price: li.unit_price,
        source: li.source,
        source_label: li.source_label ?? "",
      })),
      vat_rate: p.vat_rate,
      notes: p.notes ?? "",
    };
    await createInvoiceMutation.mutateAsync(payload);
  }, [createInvoiceMutation]);

  return (
    <Guard requiredPermission="finance:read" requiredModule="finance">
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div><h1 className="text-xl font-bold text-slate-100">Финансы</h1><p className="mt-1 text-sm text-slate-400">Счета, операции, выставленные счета и прибыль</p></div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTransferOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-400 hover:bg-sky-500/20 transition-colors"><ArrowRightLeft className="h-3.5 w-3.5" />Перевод</button>
            <button type="button" onClick={() => setInvoiceCreateOpen(true)} className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-400 hover:bg-emerald-500/20 transition-colors"><Receipt className="h-3.5 w-3.5" />Новый счёт</button>
            <button type="button" onClick={() => setTxModalOpen(true)}
              className={cn("flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors bg-amber-500 text-slate-950 hover:bg-amber-400")}><Plus className="h-4 w-4" />Операция</button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"><div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-500/10 p-1.5"><TrendingUp className="h-4 w-4 text-emerald-400" /></div><span className="text-xs font-medium text-slate-500">Доходы за месяц</span></div><p className="mt-2 text-2xl font-bold text-slate-100">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyIncome)}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"><div className="flex items-center gap-2"><div className="rounded-lg bg-rose-500/10 p-1.5"><TrendingDown className="h-4 w-4 text-rose-400" /></div><span className="text-xs font-medium text-slate-500">Расходы за месяц</span></div><p className="mt-2 text-2xl font-bold text-slate-100">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyExpense)}</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4"><div className="flex items-center gap-2"><div className="rounded-lg bg-amber-500/10 p-1.5"><DollarSign className="h-4 w-4 text-amber-400" /></div><span className="text-xs font-medium text-slate-500">Чистая прибыль</span></div><p className={cn("mt-2 text-2xl font-bold", monthlyPnL >= 0 ? "text-emerald-400" : "text-rose-400")}>{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(monthlyPnL)}</p></div>
        </div>

        <BalanceCards accounts={accounts} />

        {/* Tab Switcher */}
        <div className="flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-800 p-1 w-fit">
          {TABS.map(t => { const Icon = t.icon; return (<button key={t.key} type="button" onClick={() => setTab(t.key)} className={cn("flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors", tab === t.key ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-slate-200")}><Icon className="h-4 w-4" />{t.label}</button>); })}
        </div>

        {/* Tab Content */}
        {tab === "transactions" && <TransactionsTable transactions={transactions} searchQuery={searchParams.get("search") ?? ""} onSearchChange={() => {}} filterType={"all"} onFilterTypeChange={() => {}} isLoading={txLoading} isError={txError} error={txError ? new Error("Failed to load transactions") : null} />}
        {tab === "invoices" && (
          <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
            <table className="w-full"><thead><tr className="border-b border-slate-800"><th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Счёт №</th><th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Компания</th><th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase w-[120px]">Сумма</th><th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase w-[90px]">Статус</th><th className="px-4 py-3 w-[48px]"></th></tr></thead>
              <tbody className="divide-y divide-slate-800">
                {invoicesLoading(invLoading, invoices)}
                {invoices.map(inv => (
                  <tr key={inv.id} onClick={() => setInvoiceViewTarget(inv)} className="cursor-pointer hover:bg-slate-800/50 transition-colors">
                    <td className="px-4 py-3.5"><span className="text-sm font-mono font-semibold text-slate-200">{inv.invoice_number}</span></td>
                    <td className="px-4 py-3.5"><span className="text-sm text-slate-300">{inv.company_name}</span></td>
                    <td className="px-4 py-3.5 text-right"><span className="text-sm font-bold text-slate-200">{new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(inv.total)}</span></td>
                    <td className="px-4 py-3.5"><span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", inv.status === "paid" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : inv.status === "overdue" ? "bg-rose-500/10 text-rose-400 border-rose-500/30" : inv.status === "sent" ? "bg-sky-500/10 text-sky-400 border-sky-500/30" : "bg-slate-500/10 text-slate-400 border-slate-500/30")}>{inv.status}</span></td>
                    <td className="px-4 py-3.5"><span className="text-xs text-slate-600">→</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === "pnl" && <ProfitLossView transactions={transactions} />}

        {/* Modals */}
        <CreateTransactionModal open={txModalOpen} onClose={() => setTxModalOpen(false)} onSubmit={handleCreateTransaction} accounts={accounts} />
        <TransferModal open={transferOpen} onClose={() => setTransferOpen(false)} onSubmit={handleTransfer} accounts={accounts} />
        <InvoiceCreateModal open={invoiceCreateOpen} onClose={() => setInvoiceCreateOpen(false)} onSubmit={handleCreateInvoice} />
        <InvoiceViewModal open={!!invoiceViewTarget} invoice={invoiceViewTarget} onClose={() => setInvoiceViewTarget(null)} />
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
      <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 w-full bg-slate-800 rounded animate-pulse" /></td></tr>
    ));
  }
  if (invoices.length === 0) {
    return (
      <tr><td colSpan={5} className="px-4 py-16 text-center">
        <div className="flex flex-col items-center gap-2">
          <Receipt className="h-8 w-8 text-slate-700" />
          <p className="text-sm text-slate-600">Нет счетов</p>
        </div>
      </td></tr>
    );
  }
  return null;
}