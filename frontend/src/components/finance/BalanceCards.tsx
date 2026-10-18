"use client";

import { memo } from "react";
import { Wallet, Building2, CreditCard, TrendingUp, TrendingDown } from "lucide-react";
import type { AccountBalance, AccountType } from "@/lib/finance/finance.types";
import { cn } from "@/lib/utils";

interface BalanceCardsProps {
  accounts: AccountBalance[];
}

const ACCOUNT_ICONS: Record<AccountType, typeof Wallet> = {
  cash: Wallet,
  bank: Building2,
  acquiring: CreditCard,
};

const ACCOUNT_COLORS: Record<AccountType, string> = {
  cash: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/20",
  bank: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  acquiring: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
};

const ACCOUNT_BG_HOVER: Record<AccountType, string> = {
  cash: "hover:border-[#4a38f5]/40",
  bank: "hover:border-sky-500/40",
  acquiring: "hover:border-emerald-500/40",
};

function formatBalance(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export const BalanceCards = memo(function BalanceCards({ accounts }: BalanceCardsProps) {
  const totalBalance = accounts.reduce((sum, a) => sum + a.balance, 0);

  return (
    <div className="space-y-4">
      {/* Total */}
      <div className="rounded-xl border border-slate-800 bg-gradient-to-r from-slate-900 to-slate-900/80 px-6 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4a38f5]/10">
              <TrendingUp className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                Общий баланс
              </p>
              <p className="text-2xl font-bold text-slate-100">{formatBalance(totalBalance)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Account Cards */}
      <div className="grid grid-cols-3 gap-4">
        {accounts.map((account) => {
          const Icon = Wallet;
          const colors = "bg-slate-500/10 text-slate-400 border-slate-500/20";
          const hover = "hover:border-slate-500/40";
          return (
            <div
              key={account.id}
              className={cn(
                "rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 transition-colors",
                hover,
              )}
            >
              <div className="flex items-center justify-between">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg", colors)}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium text-slate-500">{account.name}</p>
                <p className="mt-1 text-xl font-bold text-slate-100">
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