"use client";

import { memo, useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Receipt, Loader2, Check } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { useDealActs } from "@/lib/api/use-repairs";
import { useCreateInvoiceFromActs } from "@/lib/api/use-invoices";
import { TagPill } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface GenerateInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  repairOrderId: string;
  defaultCustomerName?: string;
  defaultCustomerPhone?: string;
  dealId?: string | null;
  onSuccess?: () => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const GenerateInvoiceModal = memo(function GenerateInvoiceModal({
  open,
  onClose,
  repairOrderId,
  defaultCustomerName = "",
  defaultCustomerPhone = "",
  dealId = null,
  onSuccess,
}: GenerateInvoiceModalProps) {
  const { data: acts = [], isLoading: isLoadingActs } = useDealActs(open ? repairOrderId : null);
  const createInvoice = useCreateInvoiceFromActs();

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [companyName, setCompanyName] = useState<string>("");
  const [companyInn, setCompanyInn] = useState<string>("");
  const [companyAddress, setCompanyAddress] = useState<string>("");
  const [contactName, setContactName] = useState<string>("");
  const [contactPhone, setContactPhone] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(() => {
    const d = new Date(Date.now() + 3 * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  });
  const [vatRate, setVatRate] = useState<number>(20);
  const [notes, setNotes] = useState<string>("");

  const masterCheckboxRef = useRef<HTMLInputElement>(null);

  // Initialize selected acts and defaults
  useEffect(() => {
    if (open) {
      if (acts.length > 0) {
        const unpaidIds = acts.filter((a) => a.paymentStatus !== "paid").map((a) => a.id);
        setSelectedIds(unpaidIds.length > 0 ? unpaidIds : [repairOrderId]);
      }
      setCompanyName(defaultCustomerName);
      setContactName(defaultCustomerName);
      setContactPhone(defaultCustomerPhone);
    }
  }, [open, acts, repairOrderId, defaultCustomerName, defaultCustomerPhone]);

  // Master checkbox logic
  const isAllSelected = acts.length > 0 && selectedIds.length === acts.length;
  const isIndeterminate = selectedIds.length > 0 && selectedIds.length < acts.length;

  useEffect(() => {
    if (masterCheckboxRef.current) {
      masterCheckboxRef.current.indeterminate = isIndeterminate;
    }
  }, [isIndeterminate]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(acts.map((a) => a.id));
    }
  };

  const handleToggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const subtotal = useMemo(() => {
    return acts
      .filter((a) => selectedIds.includes(a.id))
      .reduce((sum, a) => sum + a.totalAmount, 0);
  }, [acts, selectedIds]);

  const vatAmount = useMemo(() => {
    return Math.round((subtotal * vatRate) / 100);
  }, [subtotal, vatRate]);

  const total = subtotal + vatAmount;

  const handleSubmit = async () => {
    if (selectedIds.length === 0) {
      toast.error("Выберите хотя бы один наряд-заказ для выставления счета");
      return;
    }
    if (!companyName.trim() && !contactName.trim()) {
      toast.error("Укажите плательщика / заказчика");
      return;
    }

    try {
      await createInvoice.mutateAsync({
        repair_order_ids: selectedIds,
        company_name: companyName.trim() || undefined,
        company_inn: companyInn.trim() || undefined,
        company_address: companyAddress.trim() || undefined,
        contact_name: contactName.trim() || undefined,
        contact_phone: contactPhone.trim() || undefined,
        deal_id: dealId ?? undefined,
        due_date: dueDate ? new Date(dueDate).toISOString() : undefined,
        vat_rate: vatRate,
        notes: notes.trim() || undefined,
      });

      toast.success("Счет на оплату успешно сформирован");
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Не удалось сформировать счет";
      toast.error(message);
    }
  };

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <Receipt className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">
              Сформировать счёт по актам из сделки
            </h2>
            <p className="text-xs text-[#666666]">
              Объединение выполненных работ и запчастей из выбранных актов в один счёт на оплату
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col justify-between p-6">
        <div className="space-y-5">
          {/* Acts Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-[#666666] tracking-wider">
                Акты наряд-заказов ({acts.length})
              </label>
              <span className="text-xs text-[#888888]">
                Включено в счёт: {selectedIds.length} из {acts.length}
              </span>
            </div>

            {isLoadingActs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
              </div>
            ) : acts.length === 0 ? (
              <div className="rounded-[8px] border border-[#e5e5e5] p-4 text-center text-xs text-[#888888]">
                Акты не найдены
              </div>
            ) : (
              <div className="rounded-[8px] border border-[#e5e5e5] overflow-hidden">
                <div className="bg-[#fafafa] border-b border-[#e5e5e5] px-3 py-2 flex items-center justify-between text-xs font-medium text-[#666666]">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      ref={masterCheckboxRef}
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>Выбрать все</span>
                  </label>
                  <span>Сумма по акту</span>
                </div>

                <div className="divide-y divide-[#f0f0f0] max-h-52 overflow-y-auto">
                  {acts.map((act) => {
                    const isChecked = selectedIds.includes(act.id);
                    return (
                      <div
                        key={act.id}
                        onClick={() => handleToggleRow(act.id)}
                        className={cn(
                          "px-3 py-2.5 flex items-center justify-between transition-colors cursor-pointer text-xs",
                          isChecked ? "bg-[#4a38f5]/5" : "hover:bg-[#fafafa]",
                        )}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => handleToggleRow(act.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                          />
                          <div>
                            <div className="flex items-center gap-1.5 font-medium text-[#111111]">
                              <span>{act.ticketNumber}</span>
                              {act.isCurrent && (
                                <span className="rounded bg-[#f0f0f0] px-1.5 py-0.2 text-[10px] text-[#666666]">
                                  текущий
                                </span>
                              )}
                              <span className="text-[#888888] font-normal">
                                {act.equipmentType} {act.equipmentBrand} {act.equipmentModel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 mt-0.5">
                              {act.paymentStatus === "paid" ? (
                                <TagPill color="emerald">Оплачен</TagPill>
                              ) : act.paymentStatus === "invoiced" ? (
                                <TagPill color="sky">Счет выставлен</TagPill>
                              ) : (
                                <TagPill color="amber">Не оплачен</TagPill>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="font-semibold text-sm font-mono text-[#111111]">
                            {formatCost(act.totalAmount)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Customer Requisites */}
          <div className="space-y-3 pt-1 border-t border-[#f0f0f0]">
            <label className="text-xs font-semibold uppercase text-[#666666] tracking-wider block">
              Реквизиты плательщика
            </label>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">
                  Организация / ФИО плательщика *
                </label>
                <input
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ООО или ФИО клиента"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">ИНН (для юр. лиц)</label>
                <input
                  type="text"
                  value={companyInn}
                  onChange={(e) => setCompanyInn(e.target.value)}
                  placeholder="10 или 12 цифр"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Контактное лицо</label>
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="ФИО контактного лица"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-[#666666]">Телефон</label>
                <input
                  type="text"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+7 (___) ___-__-__"
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-1">
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
                  value={vatRate}
                  onChange={(e) => setVatRate(Number(e.target.value))}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                >
                  <option value={20}>20% (в т.ч. НДС)</option>
                  <option value={10}>10%</option>
                  <option value={0}>Без НДС (0%)</option>
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
          </div>

          {/* Totals Preview */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-2">
            <div className="flex items-center justify-between text-xs text-[#666666]">
              <span>Сумма по работам и запчастям:</span>
              <span className="font-mono font-medium text-[#111111]">{formatCost(subtotal)}</span>
            </div>
            {vatRate > 0 && (
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>В том числе НДС ({vatRate}%):</span>
                <span className="font-mono font-medium text-[#111111]">{formatCost(vatAmount)}</span>
              </div>
            )}
            <div className="h-px bg-[#e5e5e5] my-1" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-[#111111]">Итого по счёту:</span>
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
