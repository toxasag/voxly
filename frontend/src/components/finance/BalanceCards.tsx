"use client";

import { memo } from "react";
import { Wallet, TrendingUp, Landmark, CreditCard, Shield, Plus } from "lucide-react";
import type { AccountBalance, AccountType } from "@/lib/finance/finance.types";
import { cn } from "@/lib/utils";

interface BalanceCardsProps {
  accounts: AccountBalance[];
  onAddAccount?: () => void;
}

function formatBalance(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

const ACCOUNT_TYPE_META: Record<
  AccountType,
  { label: string; icon: typeof Wallet; iconClass: string; badgeClass: string }
> = {
  cash: {
    label: "Наличные",
    icon: Wallet,
    iconClass: "text-[#4a38f5]",
    badgeClass: "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5]",
  },
  bank: {
    label: "Расчётный счёт",
    icon: Landmark,
    iconClass: "text-emerald-600",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  acquiring: {
    label: "Эквайринг",
    icon: CreditCard,
    iconClass: "text-sky-600",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
  },
  safe: {
    label: "Сейф",
    icon: Shield,
    iconClass: "text-slate-600",
    badgeClass: "bg-slate-50 text-slate-700 border-slate-200",
  },
};

export const BalanceCards = memo(function BalanceCards({
  accounts,
  onAddAccount,
}: BalanceCardsProps) {
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-4">
      {/* Total */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-6 py-5 shadow-2xs">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#4a38f5]/10">
              <TrendingUp className="h-5 w-5 text-[#4a38f5]" />
            </div>
            <div>
              <p className="text-xs font-medium text-[#666666] uppercase tracking-wider">
                Общий баланс
              </p>
              <p className="text-2xl font-bold font-mono tabular-nums text-[#111111]">
                {formatBalance(totalBalance)}
              </p>
            </div>
          </div>

          {onAddAccount && (
            <button
              type="button"
              onClick={onAddAccount}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:border-[#cccccc] hover:bg-[#fafafa] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 text-[#4a38f5]" />
              <span>Добавить кассу / р/с</span>
            </button>
          )}
        </div>
      </div>

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map((account) => {
          const type: AccountType = account.accountType ?? account.account_type ?? "cash";
          const meta = ACCOUNT_TYPE_META[type] ?? ACCOUNT_TYPE_META.cash;
          const Icon = meta.icon;
          const accNum = account.accountNumber?.trim();

          return (
            <div
              key={account.id}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 transition-colors hover:border-[#cccccc] shadow-2xs"
            >
              <div className="flex items-center justify-between gap-2">
                <div
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa]",
                    meta.iconClass,
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                    meta.badgeClass,
                  )}
                >
                  {meta.label}
                </span>
              </div>
              <div className="mt-3">
                <p className="truncate text-xs font-medium text-[#666666]" title={account.name}>
                  {account.name}
                </p>
                {accNum && (
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[#888888]" title={`р/с ${accNum}`}>
                    р/с {accNum}
                  </p>
                )}
                <p className="mt-1 text-xl font-bold font-mono tabular-nums text-[#111111]">
                  {formatBalance(account.balance)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});
