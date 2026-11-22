"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2, Loader2, Building2, Save } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import {
  useFinanceOrganizations,
  useUpdateInvoice,
  type InvoiceStatus,
  type VatMode,
} from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

export interface EditableInvoiceData {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  dueDate: string;
  issuerOrganizationId?: string | null;
  companyName: string;
  companyInn: string;
  companyAddress: string;
  contactName: string;
  contactPhone: string;
  vatMode?: VatMode;
  vatRate: number;
  notes: string;
  lineItems: {
    id: string;
    description: string;
    quantity: number;
    unitPrice: number;
    source: string;
    sourceLabel: string | null;
  }[];
}

interface InvoiceEditModalProps {
  open: boolean;
  invoice: EditableInvoiceData | null;
  onClose: () => void;
  onSaved?: () => void;
}

interface LineRow {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
  source: "manual" | "repair_work" | "repair_part" | "deal";
  sourceLabel: string;
}

const VAT_OPTIONS: { mode: VatMode; rate: number; label: string }[] = [
  { mode: "none", rate: 0, label: "Без НДС (0%)" },
  { mode: "included_5", rate: 5, label: "НДС 5% (в т.ч.)" },
  { mode: "included_7", rate: 7, label: "НДС 7% (в т.ч.)" },
  { mode: "included_10", rate: 10, label: "НДС 10% (в т.ч.)" },
  { mode: "included_20", rate: 20, label: "НДС 20% (в т.ч.)" },
];

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "draft", label: "Черновик" },
  { value: "sent", label: "Выставлен" },
  { value: "overdue", label: "Просрочен" },
  { value: "cancelled", label: "Отменён" },
];

function vatRateToMode(rate: number): VatMode {
  if (rate === 5) return "included_5";
  if (rate === 7) return "included_7";
  if (rate === 10) return "included_10";
  if (rate === 20) return "included_20";
  return "none";
}

function vatModeToRate(mode: VatMode): number {
  return VAT_OPTIONS.find((v) => v.mode === mode)?.rate ?? 0;
}

function formatRub(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(amount);
}

const inputCls =
  "w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20";

export const InvoiceEditModal = memo(function InvoiceEditModal({
  open,
  invoice,
  onClose,
  onSaved,
}: InvoiceEditModalProps) {
  const { data: organizations = [] } = useFinanceOrganizations();
  const updateInvoice = useUpdateInvoice();

  const [issuerOrgId, setIssuerOrgId] = useState("");
  const [status, setStatus] = useState<InvoiceStatus>("sent");
  const [dueDate, setDueDate] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [companyInn, setCompanyInn] = useState("");
  const [companyAddress, setCompanyAddress] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [notes, setNotes] = useState("");
  const [rows, setRows] = useState<LineRow[]>([]);

  useEffect(() => {
    if (!open || !invoice) return;
    setIssuerOrgId(invoice.issuerOrganizationId ?? "");
    setStatus(invoice.status === "paid" ? "sent" : invoice.status);
    setDueDate(invoice.dueDate ? invoice.dueDate.slice(0, 10) : "");
    setCompanyName(invoice.companyName || "");
    setCompanyInn(invoice.companyInn || "");
    setCompanyAddress(invoice.companyAddress || "");
    setContactName(invoice.contactName || "");
    setContactPhone(invoice.contactPhone || "");
    setVatMode(invoice.vatMode ?? vatRateToMode(invoice.vatRate));
    setNotes(invoice.notes || "");
    setRows(
      invoice.lineItems.map((li, idx) => ({
        key: li.id || `row-${idx}`,
        description: li.description,
        quantity: String(li.quantity),
        unitPrice: String(li.unitPrice),
        source:
          li.source === "repair_work" ||
          li.source === "repair_part" ||
          li.source === "deal"
            ? li.source
            : "manual",
        sourceLabel: li.sourceLabel ?? "",
      })),
    );
  }, [open, invoice]);

  const subtotal = useMemo(() => {
    return rows.reduce((sum, r) => {
      const q = parseFloat(r.quantity) || 0;
      const p = parseFloat(r.unitPrice) || 0;
      return sum + q * p;
    }, 0);
  }, [rows]);

  const vatRate = vatModeToRate(vatMode);
  const vatAmount = useMemo(() => {
    if (vatRate <= 0) return 0;
    return Math.round(((subtotal * vatRate) / (100 + vatRate)) * 100) / 100;
  }, [subtotal, vatRate]);

  if (!open || !invoice) return null;

  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}`,
        description: "",
        quantity: "1",
        unitPrice: "0",
        source: "manual",
        sourceLabel: "",
      },
    ]);
  };

  const handleRemoveRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const handleRowChange = (
    key: string,
    field: "description" | "quantity" | "unitPrice" | "source",
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
    );
  };

  const handleSave = async () => {
    if (!companyName.trim()) {
      toast.error("Укажите наименование плательщика");
      return;
    }

    const validItems = rows
      .map((r) => ({
        description: r.description.trim(),
        quantity: parseFloat(r.quantity),
        unit_price: parseFloat(r.unitPrice),
        source: r.source,
        source_label: r.sourceLabel,
      }))
      .filter((r) => r.description.length > 0 && !isNaN(r.quantity) && r.quantity > 0 && !isNaN(r.unit_price) && r.unit_price >= 0);

    if (validItems.length === 0) {
      toast.error("Добавьте хотя бы одну корректную позицию в счёт");
      return;
    }

    try {
      await updateInvoice.mutateAsync({
        id: invoice.id,
        payload: {
          status,
          issuer_organization_id: issuerOrgId || undefined,
          company_name: companyName.trim(),
          company_inn: companyInn.trim(),
          company_address: companyAddress.trim(),
          contact_name: contactName.trim(),
          contact_phone: contactPhone.trim(),
          due_date: dueDate ? new Date(`${dueDate}T12:00:00Z`).toISOString() : undefined,
          vat_mode: vatMode,
          vat_rate: vatRate,
          notes: notes.trim(),
          line_items: validItems,
        },
      });
      toast.success(`Счёт № ${invoice.invoiceNumber} обновлён`);
      onSaved?.();
      onClose();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить счёт");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[680px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <Pencil className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Редактировать счёт № {invoice.invoiceNumber}
            </h2>
            <p className="text-xs text-[#666666]">
              Изменение реквизитов, позиций, НДС и статуса счёта
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6 flex flex-col justify-between min-h-[calc(100%-60px)]">
        <div className="space-y-5">
          {/* Issuer & Status */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="flex items-center gap-1 text-xs font-medium text-[#666666]">
                <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                Организация-поставщик
              </label>
              <select
                value={issuerOrgId}
                onChange={(e) => {
                  const id = e.target.value;
                  setIssuerOrgId(id);
                  const found = organizations.find((o) => o.id === id);
                  if (found) setVatMode(found.vatMode);
                }}
                className={inputCls}
              >
                <option value="">Текущие реквизиты счёта</option>
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                    {org.inn ? ` (ИНН ${org.inn})` : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666666]">Статус счёта</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as InvoiceStatus)}
                className={inputCls}
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Payer */}
          <div className="space-y-3">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[#666666]">
              Плательщик и условия
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Плательщик *</label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">ИНН</label>
                <input
                  type="text"
                  value={companyInn}
                  onChange={(e) => setCompanyInn(e.target.value)}
                  className={cn(inputCls, "font-mono")}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Контактное лицо</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Телефон</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className={inputCls}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Срок оплаты до</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Режим НДС</label>
                <select
                  value={vatMode}
                  onChange={(e) => setVatMode(e.target.value as VatMode)}
                  className={inputCls}
                >
                  {VAT_OPTIONS.map((opt) => (
                    <option key={opt.mode} value={opt.mode}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666666]">Адрес</label>
              <input
                type="text"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          {/* Line Items */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
                Позиции счёта ({rows.length})
              </span>
              <button
                type="button"
                onClick={handleAddRow}
                className="inline-flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] cursor-pointer"
              >
                <Plus className="h-3 w-3 text-[#4a38f5]" />
                Добавить строку
              </button>
            </div>

            <div className="space-y-1.5">
              {rows.map((row) => {
                const lineTotal = (parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0);
                return (
                  <div key={row.key} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={row.description}
                      onChange={(e) => handleRowChange(row.key, "description", e.target.value)}
                      placeholder="Наименование товара / услуги"
                      className="flex-1 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0.01}
                      step="any"
                      value={row.quantity}
                      onChange={(e) => handleRowChange(row.key, "quantity", e.target.value)}
                      className="w-16 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs text-center font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                    <input
                      type="number"
                      min={0}
                      step="any"
                      value={row.unitPrice}
                      onChange={(e) => handleRowChange(row.key, "unitPrice", e.target.value)}
                      className="w-24 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs text-right font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                    <span className="w-20 text-right text-xs font-mono font-semibold text-[#111111] shrink-0">
                      {formatRub(lineTotal)}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(row.key)}
                      disabled={rows.length <= 1}
                      className="p-1.5 rounded text-[#888888] hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                      title="Удалить строку"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-[#666666]">Примечание</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          {/* Totals */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-1.5">
            <div className="flex items-center justify-between text-xs text-[#666666]">
              <span>{vatRate > 0 ? `В том числе НДС (${vatRate}%):` : "В том числе НДС:"}</span>
              <span className="font-mono font-medium text-[#111111]">
                {vatRate > 0 ? formatRub(vatAmount) : "Без НДС"}
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-[#e5e5e5]">
              <span className="text-sm font-semibold text-[#111111]">Итого к оплате:</span>
              <span className="text-base font-bold font-mono text-[#4a38f5]">
                {formatRub(subtotal)}
              </span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-[#e5e5e5] flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateInvoice.isPending}
            className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-semibold text-white hover:bg-[#3d2ee0] flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {updateInvoice.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Сохранить изменения
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
