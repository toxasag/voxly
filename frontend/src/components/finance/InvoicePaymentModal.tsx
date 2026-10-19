"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useAccounts, useMarkInvoicePaid } from "@/lib/api/use-invoices";

interface InvoicePaymentModalProps {
  open: boolean;
  invoice: {
    id: string;
    invoice_number?: string;
    invoiceNumber?: string;
    total: number;
    currency?: string;
  } | null;
  onClose: () => void;
  onSuccess?: () => void;
}

function formatMoney(amount: number, currency = "RUB"): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function InvoicePaymentModal({
  open,
  invoice,
  onClose,
  onSuccess,
}: InvoicePaymentModalProps) {
  const { data: accounts = [], isLoading: accountsLoading } = useAccounts();
  const markPaid = useMarkInvoicePaid();

  const [accountId, setAccountId] = useState("");
  const [occurredAt, setOccurredAt] = useState(() => {
    const today = new Date();
    return today.toISOString().slice(0, 10);
  });
  const [description, setDescription] = useState("");

  const invoiceNumber = invoice?.invoice_number ?? invoice?.invoiceNumber ?? "";

  useEffect(() => {
    if (invoice) {
      setDescription(`Оплата счёта №${invoiceNumber}`);
    }
  }, [invoice, invoiceNumber]);

  useEffect(() => {
    if (accounts.length > 0 && !accountId) {
      const defaultAcc = accounts.find((a) => a.isDefault) ?? accounts[0];
      if (defaultAcc) {
        setAccountId(defaultAcc.id);
      }
    }
  }, [accounts, accountId]);

  if (!open || !invoice) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accountId) {
      toast.error("Выберите кассу / счёт для зачисления");
      return;
    }

    try {
      await markPaid.mutateAsync({
        id: invoice.id,
        payload: {
          account_id: accountId,
          occurred_at: occurredAt ? new Date(occurredAt).toISOString() : undefined,
          description: description.trim() || undefined,
        },
      });

      toast.success(`Счёт №${invoiceNumber} успешно оплачен`);
      onSuccess?.();
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось провести оплату счёта",
      );
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white p-6 shadow-xl animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">Принять оплату</h3>
              <p className="text-xs text-[#666666]">Счёт №{invoiceNumber}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 text-center">
            <span className="text-xs text-[#666666]">Сумма к оплате</span>
            <p className="text-xl font-bold font-mono tabular-nums text-[#111111]">
              {formatMoney(invoice.total, invoice.currency ?? "RUB")}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-[#444444] mb-1">
              Касса / Счёт зачисления *
            </label>
            {accountsLoading ? (
              <div className="flex items-center gap-2 text-xs text-[#888888] py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Загрузка счетов...
              </div>
            ) : accounts.length === 0 ? (
              <p className="text-xs text-rose-600">Нет доступных счетов в модуле Финансы</p>
            ) : (
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              >
                {accounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({formatMoney(acc.balance, acc.currency)})
                    {acc.isDefault ? " — Основной" : ""}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-[#444444] mb-1">
              Дата платежа
            </label>
            <input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-[#444444] mb-1">
              Назначение / Комментарий
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Комментарий к транзакции"
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] px-3 py-1.5 text-xs font-medium text-[#666666] hover:bg-black/5 hover:text-[#111111] transition-colors"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={markPaid.isPending || !accountId}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              {markPaid.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Подтвердить оплату
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
