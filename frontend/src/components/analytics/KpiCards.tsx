"use client";

import { memo } from "react";
import {
  TrendingUp,
  TrendingDown,
  Banknote,
  Wrench,
  ShoppingCart,
  DollarSign,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiCardsProps {
  revenue?: number;
  revenueChange?: number;
  netProfit?: number;
  profitChange?: number;
  closedRepairs?: number;
  repairsChange?: number;
  avgTicket?: number;
  ticketChange?: number;
}

interface KpiCard {
  label: string;
  value: string;
  change: number;
  icon: LucideIcon;
  color: string;
}

function formatKpi(amount?: number): string {
  const safe = typeof amount === "number" && Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(safe);
}

function formatNumber(n?: number): string {
  const safe = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return new Intl.NumberFormat("ru-RU").format(safe);
}

export const KpiCards = memo(function KpiCards({
  revenue = 0,
  revenueChange = 0,
  netProfit = 0,
  profitChange = 0,
  closedRepairs = 0,
  repairsChange = 0,
  avgTicket = 0,
  ticketChange = 0,
}: KpiCardsProps) {
  const cards: KpiCard[] = [
    {
      label: "Выручка за месяц",
      value: formatKpi(revenue),
      change: revenueChange,
      icon: Banknote,
      color: "bg-[#4a38f5]/10 text-[#4a38f5]",
    },
    {
      label: "Чистая прибыль",
      value: formatKpi(netProfit),
      change: profitChange,
      icon: DollarSign,
      color: "bg-emerald-50 text-emerald-700",
    },
    {
      label: "Закрыто ремонтов",
      value: formatNumber(closedRepairs),
      change: repairsChange,
      icon: Wrench,
      color: "bg-sky-50 text-sky-700",
    },
    {
      label: "Средний чек",
      value: formatKpi(avgTicket),
      change: ticketChange,
      icon: ShoppingCart,
      color: "bg-violet-50 text-violet-700",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const change = typeof card.change === "number" && Number.isFinite(card.change) ? card.change : 0;
        const isPositive = change >= 0;
        const ChangeIcon = isPositive ? TrendingUp : TrendingDown;

        return (
          <div
            key={card.label}
            className="rounded-xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs transition-colors hover:border-[#cccccc]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#666666] uppercase tracking-wider">
                {card.label}
              </span>
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", card.color)}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-[#111111]">{card.value}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <ChangeIcon
                className={cn(
                  "h-3.5 w-3.5",
                  isPositive ? "text-emerald-700" : "text-rose-600",
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isPositive ? "text-emerald-700" : "text-rose-600",
                )}
              >
                {isPositive ? "+" : ""}
                {change}%
              </span>
              <span className="text-xs text-[#888888]">к прошлому месяцу</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});