"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Building2,
  CloudUpload,
  ExternalLink,
  FileText,
  Loader2,
  Receipt,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import type { DealDTO, DealItemDTO } from "@/lib/api/use-deals";
import { useCompany } from "@/lib/api/use-companies";
import {
  useCreateInvoice,
  useFinanceOrganizations,
  type InvoiceDocumentType,
  type InvoiceDTO,
  type VatMode,
} from "@/lib/api/use-invoices";
import { cn, toLocalDateKey } from "@/lib/utils";
import { formatRub } from "@/lib/utils/format";

interface GenerateDealDocumentModalProps {
  open: boolean;
  onClose: () => void;
  deal: DealDTO;
  items: DealItemDTO[];
  documentType: InvoiceDocumentType;
  onSuccess?: (created: InvoiceDTO) => void;
}

const VAT_OPTIONS: { mode: VatMode; rate: number; label: string }[] = [
  { mode: "none", rate: 0, label: "Без НДС (0%)" },
  { mode: "included_5", rate: 5, label: "НДС 5% (в т.ч. НДС)" },
  { mode: "included_7", rate: 7, label: "НДС 7% (в т.ч. НДС)" },
  { mode: "included_10", rate: 10, label: "НДС 10% (в т.ч. НДС)" },
  { mode: "included_20", rate: 20, label: "НДС 20% (в т.ч. НДС)" },
];

function vatModeToRate(mode: VatMode): number {
  return VAT_OPTIONS.find((v) => v.mode === mode)?.rate ?? 0;
}

function defaultDueDate(docType: InvoiceDocumentType): string {
  const days = docType === "proposal" ? 7 : 3;
  return toLocalDateKey(new Date(Date.now() + days * 86400 * 1000));
}

export const GenerateDealDocumentModal = memo(function GenerateDealDocumentModal({
  open,
  onClose,
  deal,
  items,
  documentType,
  onSuccess,
}: GenerateDealDocumentModalProps) {
  const isProposal = documentType === "proposal";
  const { data: organizations = [], isLoading: isLoadingOrgs } = useFinanceOrganizations();
  const { data: companyDetail } = useCompany(open ? deal.companyId : null);
  const createInvoice = useCreateInvoice();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [issuerOrgId, setIssuerOrgId] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [companyInn, setCompanyInn] = useState<string>("");
  const [companyAddress, setCompanyAddress] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(() => defaultDueDate(documentType));
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [notes, setNotes] = useState<string>("");
  const [syncToElba, setSyncToElba] = useState<boolean>(false);

  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  const selectedOrg = useMemo(
    () =>
      organizations.find((o) => o.id === issuerOrgId) ??
      organizations.find((o) => o.isDefault) ??
      organizations[0],
    [organizations, issuerOrgId],
  );

  // Автовыбор организации-поставщика и режима НДС
  useEffect(() => {
    if (!open || organizations.length === 0) return;
    const def = organizations.find((o) => o.isDefault) ?? organizations[0];
    if (def && (!issuerOrgId || !organizations.some((o) => o.id === issuerOrgId))) {
      setIssuerOrgId(def.id);
      setVatMode(def.vatMode || "none");
      setSyncToElba(
        !isProposal && Boolean(def.elbaEnabled && def.elbaHasApiKey && def.elbaAutoSyncInvoices),
      );
    }
  }, [open, organizations, issuerOrgId, isProposal]);

  const selectableItems = useMemo(
    () => items.filter((it) => it.totalAmount > 0 || it.price > 0),
    [items],
  );

  // Инициализация полей при открытии
  useEffect(() => {
    if (!open) return;
    setSelectedIds(selectableItems.map((it) => it.id));
    setDueDate(defaultDueDate(documentType));
    setCompanyName((deal.companyName || deal.contactName || deal.title || "").trim());
    setContactName((deal.contactName || "").trim());
    setContactPhone((deal.contactPhone || deal.companyPhone || "").trim());
    setNotes("");
    if (selectedOrg) {
      setSyncToElba(
        !isProposal &&
          Boolean(
            selectedOrg.elbaEnabled &&
              selectedOrg.elbaHasApiKey &&
              selectedOrg.elbaAutoSyncInvoices,
          ),
      );
    }
  }, [open, documentType, deal, selectableItems, isProposal, selectedOrg]);

  // Дозаполнение ИНН и юр. адреса из карточки компании, когда запрос завершится
  useEffect(() => {
    if (!open || !companyDetail) return;
    setCompanyName((prev) => prev || companyDetail.name || "");
    const inn = companyDetail.requisites?.inn || "";
    if (inn) {
      setCompanyInn(inn);
    }
    const addr =
      companyDetail.requisites?.legalAddress ||
      [companyDetail.address?.city, companyDetail.address?.street].filter(Boolean).join(", ");
    if (addr) {
      setCompanyAddress(addr);
    }
  }, [open, companyDetail]);

  const allSelected =
    selectableItems.length > 0 && selectableItems.every((it) => selectedIds.includes(it.id));
  const someSelected = selectedIds.length > 0 && !allSelected;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = someSelected;
    }
  }, [someSelected]);

  const selectedItems = useMemo(
    () => items.filter((it) => selectedIds.includes(it.id)),
    [items, selectedIds],
  );

  const totalAmount = useMemo(
    () => selectedItems.reduce((sum, it) => sum + Number(it.totalAmount ?? it.price * it.quantity), 0),
    [selectedItems],
  );

  const toggleItem = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableItems.map((it) => it.id));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedItems.length === 0) {
      toast.error("Выберите хотя бы одну позицию для включения в документ");
      return;
    }
    const payerName = companyName.trim() || contactName.trim() || deal.title.trim();
    if (!payerName) {
      toast.error("Укажите наименование заказчика / покупателя");
      return;
    }

    try {
      const lineItems = selectedItems.map((it) => {
        const qty = Math.max(0.01, Number(it.quantity) || 1);
        const lineTotal = Number(it.totalAmount ?? it.price * qty);
        const effectiveUnitPrice = qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : it.price;
        return {
          description: it.sku ? `${it.name} (${it.sku})` : it.name,
          quantity: qty,
          unit_price: Math.max(0, effectiveUnitPrice),
          source: it.itemType === "service" ? "repair_work" : "deal",
          source_label: "",
        };
      });

      const created = await createInvoice.mutateAsync({
        document_type: documentType,
        issuer_organization_id: selectedOrg?.id || undefined,
        company_id: deal.companyId || undefined,
        company_name: payerName,
        company_inn: companyInn.trim(),
        company_address: companyAddress.trim(),
        contact_name: contactName.trim(),
        contact_phone: contactPhone.trim(),
        deal_id: deal.id,
        due_date: dueDate,
        vat_mode: vatMode,
        vat_rate: vatModeToRate(vatMode),
        currency: deal.currency || "RUB",
        notes: notes.trim(),
        sync_to_elba: !isProposal && hasElba ? syncToElba : false,
        line_items: lineItems,
      });

      toast.success(
        isProposal
          ? `Коммерческое предложение № ${created.invoiceNumber} сформировано`
          : `Счёт № ${created.invoiceNumber} сформирован`,
      );
      onSuccess?.(created);
      onClose();
    } catch (err: unknown) {
      toast.error(
        err instanceof Error
          ? err.message
          : isProposal
            ? "Не удалось сформировать КП"
            : "Не удалось сформировать счёт",
      );
    }
  };

  const hasElba = Boolean(
    !isProposal &&
      selectedOrg?.elbaEnabled &&
      selectedOrg?.elbaHasApiKey &&
      selectedOrg?.elbaOrganizationId,
  );

  return (
    <Sheet open={open} onClose={onClose} width="w-[640px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            {isProposal ? <FileText className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              {isProposal ? "Сформировать коммерческое предложение" : "Сформировать счёт на оплату"}
            </h2>
            <p className="text-xs text-[#666666]">Позиции из сделки «{deal.title}»</p>
          </div>
        </div>
      </SheetHeader>
      <SheetContent className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Организация-поставщик */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-[#111111]">
                {isProposal ? "Организация-исполнитель" : "Организация-поставщик"}
              </label>
              <Link
                href="/finance"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline"
              >
                <span>Реквизиты</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            {isLoadingOrgs ? (
              <div className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs text-[#666666]">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                Загрузка организаций...
              </div>
            ) : organizations.length === 0 ? (
              <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Организация не настроена — документ сформируется по базовым реквизитам. Вы можете
                добавить организацию в разделе «Финансы».
              </div>
            ) : (
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
                <select
                  value={selectedOrg?.id ?? ""}
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setIssuerOrgId(nextId);
                    const nextOrg = organizations.find((o) => o.id === nextId);
                    if (nextOrg) {
                      setVatMode(nextOrg.vatMode || "none");
                      setSyncToElba(
                        !isProposal &&
                          Boolean(
                            nextOrg.elbaEnabled &&
                              nextOrg.elbaHasApiKey &&
                              nextOrg.elbaAutoSyncInvoices,
                          ),
                      );
                    }
                  }}
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-8 pr-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                >
                  {organizations.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                      {o.inn ? ` (ИНН ${o.inn})` : ""}
                      {o.isDefault ? " — основная" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Выбор позиций сделки */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-xs font-medium text-[#111111]">
                Позиции для включения ({selectedItems.length} из {selectableItems.length})
              </span>
              <span className="font-mono text-xs font-semibold text-[#111111] tabular-nums">
                Итого: {formatRub(totalAmount)}
              </span>
            </div>

            {selectableItems.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] p-4 text-center text-xs text-[#666666]">
                В сделке нет товаров или услуг с ценой больше 0. Добавьте позиции на вкладке
                «Услуги/Товары».
              </div>
            ) : (
              <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white">
                <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-[11px] font-medium text-[#666666]">
                  <input
                    ref={masterCheckboxRef}
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                  />
                  <span className="flex-1">Наименование</span>
                  <span className="w-16 text-right">Кол-во</span>
                  <span className="w-24 text-right">Сумма</span>
                </div>
                <div className="max-h-56 divide-y divide-[#f0f0f0] overflow-y-auto">
                  {selectableItems.map((it) => {
                    const checked = selectedIds.includes(it.id);
                    const sum = Number(it.totalAmount ?? it.price * it.quantity);
                    return (
                      <label
                        key={it.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[#fafafa]",
                          !checked && "opacity-60",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleItem(it.id)}
                          className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium",
                                it.itemType === "service"
                                  ? "bg-[#4a38f5]/10 text-[#4a38f5]"
                                  : "bg-[#f3f4f6] text-[#555555]",
                              )}
                            >
                              {it.itemType === "service" ? "Услуга" : "Товар"}
                            </span>
                            <span className="truncate font-medium text-[#111111]">{it.name}</span>
                          </div>
                        </div>
                        <span className="w-16 shrink-0 text-right font-mono text-[11px] text-[#666666] tabular-nums">
                          {it.quantity} {it.unit || "шт"}
                        </span>
                        <span className="w-24 shrink-0 text-right font-mono font-medium text-[#111111] tabular-nums">
                          {formatRub(sum)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Реквизиты заказчика / покупателя */}
          <div className="space-y-3 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#666666]">
              {isProposal ? "Заказчик" : "Плательщик / Покупатель"}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#111111]">
                  Организация или ФИО <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ООО «Ромашка» или Иванов И.И."
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#111111]">ИНН</label>
                <input
                  type="text"
                  value={companyInn}
                  onChange={(e) => setCompanyInn(e.target.value)}
                  placeholder="7700000000"
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-[#111111]">
                  Телефон контакта
                </label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+7 (999) 000-00-00"
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-[#111111]">Адрес</label>
                <input
                  type="text"
                  value={companyAddress}
                  onChange={(e) => setCompanyAddress(e.target.value)}
                  placeholder="Юридический или фактический адрес"
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>
          </div>

          {/* Параметры документа: срок, НДС, примечание */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-[#111111]">
                {isProposal ? "Предложение действительно до" : "Оплатить до"}
              </label>
              <input
                type="date"
                required
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 font-mono text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[#111111]">Режим НДС</label>
              <select
                value={vatMode}
                onChange={(e) => setVatMode(e.target.value as VatMode)}
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {VAT_OPTIONS.map((v) => (
                  <option key={v.mode} value={v.mode}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-[#111111]">
              {isProposal ? "Условия и примечание к КП" : "Примечание к счёту"}
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isProposal
                  ? "Срок поставки, условия оплаты, гарантия..."
                  : "Комментарий для бухгалтерии или клиента..."
              }
              className="w-full resize-none rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          {hasElba && (
            <label className="flex cursor-pointer items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs text-[#111111]">
              <input
                type="checkbox"
                checked={syncToElba}
                onChange={(e) => setSyncToElba(e.target.checked)}
                className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <CloudUpload className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Автоматически выгрузить счёт в Контур.Эльбу</span>
            </label>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createInvoice.isPending || selectedItems.length === 0}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              {createInvoice.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : isProposal ? (
                <FileText className="h-3.5 w-3.5" />
              ) : (
                <Receipt className="h-3.5 w-3.5" />
              )}
              <span>
                {isProposal ? "Сформировать КП" : "Сформировать счёт"} ({formatRub(totalAmount)})
              </span>
            </button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
});
