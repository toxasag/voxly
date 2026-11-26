"use client";

import { useState, useEffect, useRef } from "react";
import { Briefcase, Wrench, Search, X, Loader2 } from "lucide-react";
import { useDeals, useDeal, type DealDTO } from "@/lib/api/use-deals";
import { useRepairs, useRepair, type RepairOrderDTO } from "@/lib/api/use-repairs";
import { formatTicketNumber } from "@/lib/api/use-print-templates";
import { cn } from "@/lib/utils";

interface TransactionEntityPickersProps {
  dealId: string;
  repairOrderId: string;
  initialDealTitle?: string | null;
  initialRepairTicketNumber?: string | null;
  onDealChange: (dealId: string, deal?: DealDTO | null) => void;
  onRepairOrderChange: (repairOrderId: string, order?: RepairOrderDTO | null) => void;
}

function formatBudget(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function TransactionEntityPickers({
  dealId,
  repairOrderId,
  initialDealTitle = null,
  initialRepairTicketNumber = null,
  onDealChange,
  onRepairOrderChange,
}: TransactionEntityPickersProps) {
  // --- Deal picker state ---
  const [dealOpen, setDealOpen] = useState(false);
  const [dealSearch, setDealSearch] = useState("");
  const [debouncedDealSearch, setDebouncedDealSearch] = useState("");
  const [selectedDealLabel, setSelectedDealLabel] = useState<string>(initialDealTitle || "");
  const dealWrapRef = useRef<HTMLDivElement>(null);

  // --- Repair picker state ---
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairSearch, setRepairSearch] = useState("");
  const [debouncedRepairSearch, setDebouncedRepairSearch] = useState("");
  const [selectedRepairLabel, setSelectedRepairLabel] = useState<string>(
    initialRepairTicketNumber ? formatTicketNumber(initialRepairTicketNumber) : "",
  );
  const repairWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedDealSearch(dealSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [dealSearch]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedRepairSearch(repairSearch.trim()), 250);
    return () => clearTimeout(t);
  }, [repairSearch]);

  useEffect(() => {
    if (!dealId) {
      setSelectedDealLabel("");
    } else if (initialDealTitle) {
      setSelectedDealLabel(initialDealTitle);
    }
  }, [dealId, initialDealTitle]);

  useEffect(() => {
    if (!repairOrderId) {
      setSelectedRepairLabel("");
    } else if (initialRepairTicketNumber) {
      setSelectedRepairLabel(formatTicketNumber(initialRepairTicketNumber));
    }
  }, [repairOrderId, initialRepairTicketNumber]);

  // Закрытие выпадающих списков по клику вне
  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (dealWrapRef.current && !dealWrapRef.current.contains(e.target as Node)) {
        setDealOpen(false);
      }
      if (repairWrapRef.current && !repairWrapRef.current.contains(e.target as Node)) {
        setRepairOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const { data: dealsResult, isFetching: dealsLoading } = useDeals(
    { search: debouncedDealSearch || undefined, limit: 20 },
    { enabled: dealOpen },
  );
  const { data: resolvedDeal } = useDeal(dealId && !selectedDealLabel ? dealId : null);

  const { data: repairsResult, isFetching: repairsLoading } = useRepairs(
    { search: debouncedRepairSearch || undefined, limit: 20 },
    { enabled: repairOpen },
  );
  const { data: resolvedRepair } = useRepair(repairOrderId && !selectedRepairLabel ? repairOrderId : null);

  const dealDisplayLabel = selectedDealLabel || resolvedDeal?.title || "";
  const repairDisplayLabel =
    selectedRepairLabel ||
    (resolvedRepair
      ? `${formatTicketNumber(resolvedRepair.ticketNumber)} · ${[resolvedRepair.equipment.brand, resolvedRepair.equipment.model].filter(Boolean).join(" ")}`.trim()
      : "");

  const deals = dealsResult?.items ?? [];
  const repairs = repairsResult?.items ?? [];

  return (
    <div className="space-y-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
      {/* Сделка (CRM) */}
      <div className="space-y-1" ref={dealWrapRef}>
        <label className="text-[11px] font-medium text-[#666666]">Сделка (CRM)</label>
        {dealId ? (
          <div className="flex items-center justify-between gap-2 h-8 rounded-[6px] border border-[#4a38f5]/30 bg-white px-2.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Briefcase className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
              <span className="truncate font-medium text-[#111111]">
                {dealDisplayLabel || "Сделка выбрана"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedDealLabel("");
                setDealSearch("");
                onDealChange("", null);
              }}
              title="Отвязать сделку"
              className="rounded p-0.5 text-[#888888] hover:bg-[#f5f5f5] hover:text-rose-600 transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={dealSearch}
              onFocus={() => setDealOpen(true)}
              onChange={(e) => {
                setDealSearch(e.target.value);
                setDealOpen(true);
              }}
              placeholder="Найти и выбрать сделку..."
              className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-7 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            {dealsLoading && (
              <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
            )}

            {dealOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white py-1 shadow-lg">
                {dealsLoading && deals.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#888888]">Поиск сделок...</div>
                ) : deals.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#888888]">Сделки не найдены</div>
                ) : (
                  deals.map((deal) => (
                    <button
                      key={deal.id}
                      type="button"
                      onClick={() => {
                        setSelectedDealLabel(deal.title);
                        setDealSearch("");
                        setDealOpen(false);
                        onDealChange(deal.id, deal);
                      }}
                      className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-[#111111]">
                          {deal.title}
                        </div>
                        {(deal.contactName || deal.companyName) && (
                          <div className="truncate text-[11px] text-[#666666]">
                            {[deal.contactName, deal.companyName].filter(Boolean).join(" · ")}
                          </div>
                        )}
                      </div>
                      {deal.budget > 0 && (
                        <span className="shrink-0 text-[11px] font-medium tabular-nums text-[#666666]">
                          {formatBudget(deal.budget)}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Заказ-наряд (Сервис) */}
      <div className="space-y-1" ref={repairWrapRef}>
        <label className="text-[11px] font-medium text-[#666666]">Заказ-наряд (Сервисный центр)</label>
        {repairOrderId ? (
          <div className="flex items-center justify-between gap-2 h-8 rounded-[6px] border border-[#4a38f5]/30 bg-white px-2.5 text-xs">
            <div className="flex items-center gap-1.5 min-w-0">
              <Wrench className="h-3.5 w-3.5 shrink-0 text-[#4a38f5]" />
              <span className="truncate font-medium text-[#111111]">
                {repairDisplayLabel || "Наряд выбран"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelectedRepairLabel("");
                setRepairSearch("");
                onRepairOrderChange("", null);
              }}
              title="Отвязать заказ-наряд"
              className="rounded p-0.5 text-[#888888] hover:bg-[#f5f5f5] hover:text-rose-600 transition-colors cursor-pointer shrink-0"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={repairSearch}
              onFocus={() => setRepairOpen(true)}
              onChange={(e) => {
                setRepairSearch(e.target.value);
                setRepairOpen(true);
              }}
              placeholder="Найти по номеру наряда, модели или клиенту..."
              className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-7 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            {repairsLoading && (
              <Loader2 className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
            )}

            {repairOpen && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white py-1 shadow-lg">
                {repairsLoading && repairs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#888888]">Поиск нарядов...</div>
                ) : repairs.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[#888888]">Наряды не найдены</div>
                ) : (
                  repairs.map((order) => {
                    const num = formatTicketNumber(order.ticketNumber);
                    const equip = [order.equipment.brand, order.equipment.model].filter(Boolean).join(" ");
                    const label = [num, equip].filter(Boolean).join(" · ");
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => {
                          setSelectedRepairLabel(label);
                          setRepairSearch("");
                          setRepairOpen(false);
                          onRepairOrderChange(order.id, order);
                          if (!dealId && order.dealId) {
                            setSelectedDealLabel(order.dealTitle || "");
                            onDealChange(order.dealId, null);
                          }
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                        )}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-[#111111] tabular-nums">
                            {label}
                          </div>
                          <div className="truncate text-[11px] text-[#666666]">
                            {[order.customerName, order.dealTitle].filter(Boolean).join(" · ")}
                          </div>
                        </div>
                        {(order.finalCost ?? order.estimatedCost) > 0 && (
                          <span className="shrink-0 text-[11px] font-medium tabular-nums text-[#666666]">
                            {formatBudget(order.finalCost ?? order.estimatedCost)}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
