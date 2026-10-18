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
  revenue: number;
  revenueChange: number;
  netProfit: number;
  profitChange: number;
  closedRepairs: number;
  repairsChange: number;
  avgTicket: number;
  ticketChange: number;
}

interface KpiCard {
  label: string;
  value: string;
  change: number;
  icon: LucideIcon;
  color: string;
}

function formatKpi(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

export const KpiCards = memo(function KpiCards({
  revenue,
  revenueChange,
  netProfit,
  profitChange,
  closedRepairs,
  repairsChange,
  avgTicket,
  ticketChange,
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
      color: "bg-emerald-500/10 text-emerald-400",
    },
    {
      label: "Закрыто ремонтов",
      value: formatNumber(closedRepairs),
      change: repairsChange,
      icon: Wrench,
      color: "bg-sky-500/10 text-sky-400",
    },
    {
      label: "Средний чек",
      value: formatKpi(avgTicket),
      change: ticketChange,
      icon: ShoppingCart,
      color: "bg-violet-500/10 text-violet-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const isPositive = card.change >= 0;
        const ChangeIcon = isPositive ? TrendingUp : TrendingDown;

        return (
          <div
            key={card.label}
            className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 transition-colors hover:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                {card.label}
              </span>
              <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", card.color)}>
                <Icon className="h-4 w-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">{card.value}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <ChangeIcon
                className={cn(
                  "h-3.5 w-3.5",
                  isPositive ? "text-emerald-400" : "text-rose-400",
                )}
              />
              <span
                className={cn(
                  "text-xs font-medium",
                  isPositive ? "text-emerald-400" : "text-rose-400",
                )}
              >
                {isPositive ? "+" : ""}
                {card.change}%
              </span>
              <span className="text-xs text-slate-600">к прошлому месяцу</span>
            </div>
          </div>
        );
      })}
    </div>
  );
});