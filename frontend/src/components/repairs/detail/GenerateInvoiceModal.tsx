"use client";

import { memo, useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Receipt, Loader2, Building2, CloudUpload, ExternalLink } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { useDealActs } from "@/lib/api/use-repairs";
import {
  useCreateInvoiceFromActs,
  useFinanceOrganizations,
  type VatMode,
} from "@/lib/api/use-invoices";
import { TagPill } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface GenerateInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  repairOrderId: string;
  defaultCompanyId?: string | null;
  defaultCompanyName?: string | null;
  defaultCompanyInn?: string | null;
  defaultCompanyAddress?: string | null;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  dealId?: string | null;
  onSuccess?: () => void;
}

const VAT_OPTIONS: { mode: VatMode; rate: number; label: string }[] = [
  { mode: "none", rate: 0, label: "Без НДС (0%)" },
  { mode: "included_5", rate: 5, label: "НДС 5% (в т.ч. НДС)" },
  { mode: "included_7", rate: 7, label: "НДС 7% (в т.ч. НДС)" },
  { mode: "included_10", rate: 10, label: "НДС 10% (в т.ч. НДС)" },
  { mode: "included_20", rate: 20, label: "НДС 20% (в т.ч. НДС)" },
];

function vatModeToRate(mode: VatMode): number {
  const found = VAT_OPTIONS.find((v) => v.mode === mode);
  return found?.rate ?? 0;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 2,
  }).format(amount);
}

export const GenerateInvoiceModal = memo(function GenerateInvoiceModal({
  open,
  onClose,
  repairOrderId,
  defaultCompanyId = null,
  defaultCompanyName = null,
  defaultCompanyInn = null,
  defaultCompanyAddress = null,
  defaultCustomerName = "",
  defaultCustomerPhone = "",
  dealId = null,
  onSuccess,
}: GenerateInvoiceModalProps) {
  const { data: acts = [], isLoading: isLoadingActs } = useDealActs(open ? repairOrderId : null);
  const { data: organizations = [], isLoading: isLoadingOrgs } = useFinanceOrganizations();
  const createInvoice = useCreateInvoiceFromActs();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [issuerOrgId, setIssuerOrgId] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [companyInn, setCompanyInn] = useState<string>("");
  const [companyAddress, setCompanyAddress] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date(Date.now() + 3 * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [vatMode, setVatMode] = useState<VatMode>("none");
  const [notes, setNotes] = useState<string>("");
  const [syncToElba, setSyncToElba] = useState<boolean>(false);

  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  const selectedOrg = useMemo(
    () => organizations.find((o) => o.id === issuerOrgId) ?? organizations.find((o) => o.isDefault) ?? organizations[0],
    [organizations, issuerOrgId],
  );

  // Автовыбор основной организации-поставщика и её режима НДС
  useEffect(() => {
    if (!open || organizations.length === 0) return;
    const def = organizations.find((o) => o.isDefault) ?? organizations[0];
    if (def && (!issuerOrgId || !organizations.some((o) => o.id === issuerOrgId))) {
      setIssuerOrgId(def.id);
      setVatMode(def.vatMode || "none");
      setSyncToElba(Boolean(def.elbaEnabled && def.elbaHasApiKey && def.elbaAutoSyncInvoices));
    }
  }, [open, organizations, issuerOrgId]);

  const selectableActs = useMemo(
    () => acts.filter((a) => a.totalAmount > 0),
    [acts],
  );

  // Автоподстановка актов (только с ценой > 0) и реквизитов плательщика
  useEffect(() => {
    if (open) {
      if (acts.length > 0) {
        const pricedActs = acts.filter((a) => a.totalAmount > 0);
        const unpaidPricedIds = pricedActs
          .filter((a) => a.paymentStatus !== "paid")
          .map((a) => a.id);
        const currentIsPriced = pricedActs.some((a) => a.id === repairOrderId);
        setSelectedIds(
          unpaidPricedIds.length > 0
            ? unpaidPricedIds
            : currentIsPriced
              ? [repairOrderId]
              : pricedActs.map((a) => a.id),
        );
      } else {
        setSelectedIds([]);
      }
      setCompanyName((defaultCompanyName || defaultCustomerName || "").trim());
      setCompanyInn((defaultCompanyInn || "").trim());
      setCompanyAddress((defaultCompanyAddress || "").trim());
      setContactName(defaultCustomerName);
      setContactPhone(defaultCustomerPhone);
    }
  }, [
    open,
    acts,
    repairOrderId,
    defaultCompanyName,
    defaultCompanyInn,
    defaultCompanyAddress,
    defaultCustomerName,
    defaultCustomerPhone,
  ]);

  const handleIssuerChange = (nextOrgId: string) => {
    setIssuerOrgId(nextOrgId);
    const org = organizations.find((o) => o.id === nextOrgId);
    if (org) {
      setVatMode(org.vatMode || "none");
      setSyncToElba(Boolean(org.elbaEnabled && org.elbaHasApiKey && org.elbaAutoSyncInvoices));
    }
  };

  const isAllSelected =
    selectableActs.length > 0 && selectedIds.length === selectableActs.length;
  const isIndeterminate =
    selectedIds.length > 0 && selectedIds.length < selectableActs.length;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(selectableActs.map((a) => a.id));
    }
  };

  const handleToggleRow = (id: string, isSelectable: boolean) => {
    if (!isSelectable) return;
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const subtotal = useMemo(() => {
    return acts
      .filter((a) => selectedIds.includes(a.id))
      .reduce((sum, a) => sum + a.totalAmount, 0);
  }, [acts, selectedIds]);

  const vatRate = vatModeToRate(vatMode);
  // НДС «в том числе»: итоговая сумма не раздувается сверху
  const vatAmount = useMemo(() => {
    if (vatRate <= 0) return 0;
    return Math.round(((subtotal * vatRate) / (100 + vatRate)) * 100) / 100;
  }, [subtotal, vatRate]);

  const total = subtotal;

  const canElbaSync = Boolean(
    selectedOrg?.elbaEnabled && selectedOrg?.elbaHasApiKey && selectedOrg?.elbaOrganizationId,
  );

  const handleSubmit = async () => {
    if (selectedIds.length === 0) {
      toast.error("Выберите хотя бы один наряд-заказ для выставления счёта");
      return;
    }
    if (!companyName.trim() && !contactName.trim()) {
      toast.error("Укажите плательщика / заказчика");
      return;
    }

    try {
      const inv = await createInvoice.mutateAsync({
        repair_order_ids: selectedIds,
        issuer_organization_id: selectedOrg?.id || undefined,
        company_id: defaultCompanyId || undefined,
        company_name: companyName.trim() || contactName.trim(),
        company_inn: companyInn.trim() || undefined,
        company_address: companyAddress.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
        deal_id: dealId || undefined,
        due_date: dueDate ? new Date(`${dueDate}T12:00:00Z`).toISOString() : undefined,
        vat_mode: vatMode,
        vat_rate: vatRate,
        notes: notes.trim() || undefined,
        sync_to_elba: canElbaSync ? syncToElba : false,
      });

      toast.success(`Счёт № ${inv.invoiceNumber} на сумму ${formatCost(inv.total)} сформирован`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Не удалось сформировать счёт";
      toast.error(msg);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[660px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Сформировать счёт по актам из сделки</h2>
            <p className="text-xs text-[#666666]">
              Объединение работ и запчастей из выбранных актов с автодедупликацией позиций
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="p-6 flex flex-col justify-between min-h-[calc(100%-60px)]">
        <div className="space-y-5">
          {/* Организация-поставщик (от имени которой выставляется счёт) */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                Организация-поставщик (от кого счёт)
              </label>
              <Link
                href="/finance?tab=organization"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline"
              >
                <span>Настроить в «Финансах»</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            {isLoadingOrgs ? (
              <div className="flex items-center gap-2 text-xs text-[#888888] py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Загрузка организаций...
              </div>
            ) : (
              <select
                value={selectedOrg?.id ?? ""}
                onChange={(e) => handleIssuerChange(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {organizations.map((org) => (
                  <option key={org.id} value={org.id}>
                    {org.name}
                    {org.inn ? ` (ИНН ${org.inn})` : ""}
                    {org.isDefault ? " — основная" : ""}
                  </option>
                ))}
              </select>
            )}

            {selectedOrg && (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#666666]">
                {selectedOrg.inn ? (
                  <span>ИНН: <strong className="font-mono text-[#111111]">{selectedOrg.inn}</strong></span>
                ) : (
                  <span className="text-amber-700">ИНН не заполнен — укажите в разделе «Финансы → Организация»</span>
                )}
                {selectedOrg.bankName && (
                  <span>Банк: <strong className="text-[#111111]">{selectedOrg.bankName}</strong></span>
                )}
                {selectedOrg.settlementAccount && (
                  <span>р/с: <strong className="font-mono text-[#111111]">{selectedOrg.settlementAccount}</strong></span>
                )}
              </div>
            )}
          </div>

          {/* Acts Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
                Акты наряд-заказов ({acts.length})
              </span>
              <span className="text-xs text-[#888888]">
                Включено в счёт: {selectedIds.length} из {selectableActs.length} доступных
              </span>
            </div>

            {isLoadingActs ? (
              <div className="flex items-center justify-center py-8 border border-[#e5e5e5] rounded-[8px] bg-[#fafafa]">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden">
                <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs font-medium text-[#666666]">
                  <label className={cn("flex items-center gap-2.5 select-none", selectableActs.length > 0 ? "cursor-pointer" : "opacity-50 cursor-not-allowed")}>
                    <input
                      ref={masterCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      disabled={selectableActs.length === 0}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] disabled:opacity-40"
                    />
                    <span>Выбрать все с ценой ({selectableActs.length})</span>
                  </label>
                  <span>Сумма по акту</span>
                </div>

                <div className="divide-y divide-[#f0f0f0] max-h-[190px] overflow-y-auto">
                  {acts.map((act) => {
                    const hasPrice = act.totalAmount > 0;
                    const checked = hasPrice && selectedIds.includes(act.id);
                    const isPaid = act.paymentStatus === "paid";

                    return (
                      <label
                        key={act.id}
                        title={hasPrice ? undefined : "Акт без указанной стоимости (0 ₽) нельзя включить в счёт"}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 transition-colors",
                          hasPrice ? "cursor-pointer hover:bg-[#f8f9fa]" : "opacity-55 bg-[#fafafa] cursor-not-allowed",
                          checked && "bg-[#4a38f5]/[0.03]",
                        )}
                      >
                        <div className="flex items-start gap-2.5 min-w-0 pr-3">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!hasPrice}
                            onChange={() => handleToggleRow(act.id, hasPrice)}
                            className="mt-0.5 h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5] disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-[#111111] font-mono">
                                {act.ticketNumber}
                              </span>
                              <span className="text-xs text-[#666666] truncate">
                                {[act.equipmentType, act.equipmentBrand, act.equipmentModel]
                                  .filter(Boolean)
                                  .join(" ")}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                              {!hasPrice ? (
                                <span className="inline-flex items-center rounded-full border border-[#e5e5e5] bg-white px-2 py-0.5 text-[10px] font-medium text-[#888888]">
                                  Без цены — недоступно
                                </span>
                              ) : isPaid ? (
                                <TagPill color="emerald">Оплачен</TagPill>
                              ) : act.paymentStatus === "invoiced" ? (
                                <TagPill color="sky">Выставлен счёт</TagPill>
                              ) : (
                                <TagPill color="amber">Не оплачен</TagPill>
                              )}
                            </div>
                          </div>
                        </div>

                        <span className={cn("text-xs font-semibold font-mono shrink-0", hasPrice ? "text-[#111111]" : "text-[#888888]")}>
                          {formatCost(act.totalAmount)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Payer Details */}
          <div className="space-y-3">
            <span className="block text-xs font-semibold uppercase tracking-wider text-[#666666]">
              Реквизиты плательщика
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">
                  Организация / ФИО плательщика *
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder='ООО "Ромашка" или ФИО'
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">ИНН (для юр. лиц / ИП)</label>
                <input
                  type="text"
                  value={companyInn}
                  onChange={(e) => setCompanyInn(e.target.value)}
                  placeholder="10 или 12 цифр"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Телефон</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Ставка НДС</label>
                <select
                  value={vatMode}
                  onChange={(e) => setVatMode(e.target.value as VatMode)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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
              <label className="text-xs font-medium text-[#666666]">Адрес доставки / оказания услуг</label>
              <input
                type="text"
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="г. Москва, ул. ..."
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-[#666666]">Примечание к счёту</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Дополнительные условия, номер договора..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            {canElbaSync && (
              <label className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 text-xs text-[#111111] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={syncToElba}
                  onChange={(e) => setSyncToElba(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                <CloudUpload className="h-3.5 w-3.5 text-[#4a38f5]" />
                <span>
                  Сразу выгрузить счёт в Контур.Эльбу ({selectedOrg?.elbaOrganizationName || "подключено"})
                </span>
              </label>
            )}
          </div>

          {/* Totals Preview */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#666666]">
              <span>Сумма по работам и запчастям:</span>
              <span className="font-mono font-medium text-[#111111]">{formatCost(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-[#666666]">
              <span>{vatRate > 0 ? `В том числе НДС (${vatRate}%):` : "В том числе НДС:"}</span>
              <span className="font-mono font-medium text-[#111111]">
                {vatRate > 0 ? formatCost(vatAmount) : "Без НДС"}
              </span>
            </div>
            <div className="h-px bg-[#e5e5e5] my-1" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111111]">Итого к оплате:</span>
              <span className="text-base font-bold font-mono text-[#4a38f5]">{formatCost(total)}</span>
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="pt-4 border-t border-[#e5e5e5] flex items-center justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={createInvoice.isPending || selectedIds.length === 0}
            className={cn(
              "h-8 rounded-[8px] px-4 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center gap-1.5",
              "bg-[#4a38f5] hover:bg-[#3d2ee0] disabled:opacity-50 disabled:cursor-not-allowed",
            )}
          >
            {createInvoice.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Формирование...
              </>
            ) : (
              <>
                <Receipt className="h-3.5 w-3.5" />
                Сформировать счёт ({formatCost(total)})
              </>
            )}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
});
