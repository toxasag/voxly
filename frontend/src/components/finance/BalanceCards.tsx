"use client";

import { memo } from "react";
import { Wallet, TrendingUp } from "lucide-react";
import type { AccountBalance } from "@/lib/finance/finance.types";

interface BalanceCardsProps {
  accounts: AccountBalance[];
}

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
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-6 py-5 shadow-2xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#4a38f5]/10">
              <TrendingUp className="h-5 w-5 text-[#4a38f5]" />
            </div>
            <div>
              <p className="text-xs font-medium text-[#666666] uppercase tracking-wider">
                Общий баланс
              </p>
              <p className="text-2xl font-bold text-[#111111]">{formatBalance(totalBalance)}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Account Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {accounts.map((account) => {
          const Icon = Wallet;
          return (
            <div
              key={account.id}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 transition-colors hover:border-[#cccccc] shadow-2xs"
            >
              <div className="flex items-center justify-between">
                <div className="flex h-8 w-8 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] text-[#4a38f5]">
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium text-[#666666]">{account.name}</p>
                <p className="mt-1 text-xl font-bold text-[#111111]">
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