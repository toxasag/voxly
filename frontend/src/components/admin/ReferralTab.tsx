"use client";

import { memo } from "react";
import { Users, Banknote, Gift, ArrowDownUp } from "lucide-react";
import type { Referral, PayoutHistory } from "@/lib/admin/admin.types";
import { getPlanLabel } from "@/lib/admin/admin.types";
import { cn } from "@/lib/utils";

interface ReferralTabProps {
  referrals: Referral[];
  payouts: PayoutHistory[];
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatDateFull(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount);
}

const REFERRAL_STATUS: Record<string, string> = {
  pending: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/20",
  active: "bg-sky-50 text-sky-700 border-sky-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const PAYOUT_STATUS: Record<string, string> = {
  pending: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/20",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed: "bg-rose-50 text-rose-700 border-rose-200",
};

const METHOD_LABELS: Record<string, string> = {
  bank_transfer: "Банковский перевод",
  card: "На карту",
  // PayPal — имя собственное, не переводится.
  paypal: "PayPal",
};

export const ReferralTab = memo(function ReferralTab({ referrals, payouts }: ReferralTabProps) {
  const totalRewards = referrals
    .filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + r.reward_amount, 0);
  const pendingRewards = referrals
    .filter((r) => r.status === "active" || r.status === "pending")
    .reduce((sum, r) => sum + r.reward_amount, 0);
  const totalPaidOut = payouts
    .filter((p) => p.status === "completed")
    .reduce((sum, p) => sum + p.amount, 0);
  const totalReferrers = new Set(referrals.map((r) => r.referrer_id)).size;

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="rounded-xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-[#4a38f5]/10 p-1.5"><Users className="h-4 w-4 text-[#4a38f5]" /></div>
            <span className="text-xs font-medium text-[#666666]">Активные партнёры</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{totalReferrers}</p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-50 p-1.5"><Gift className="h-4 w-4 text-emerald-700" /></div>
            <span className="text-xs font-medium text-[#666666]">Выплаченные бонусы</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{formatAmount(totalRewards, "RUB")}</p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-sky-50 p-1.5"><ArrowDownUp className="h-4 w-4 text-sky-700" /></div>
            <span className="text-xs font-medium text-[#666666]">Ожидает</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{formatAmount(pendingRewards, "RUB")}</p>
        </div>
        <div className="rounded-xl border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-50 p-1.5"><Banknote className="h-4 w-4 text-violet-700" /></div>
            <span className="text-xs font-medium text-[#666666]">Всего выплачено</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111]">{formatAmount(totalPaidOut, "RUB")}</p>
        </div>
      </div>

      {/* Referrals Table */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
          <Users className="h-4 w-4 text-[#666666]" />
          <span className="text-sm font-semibold text-[#111111]">Список партнёров</span>
          <span className="ml-auto text-xs text-[#888888]">{referrals.length} referrals</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider">Партнёр</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider">Приглашённая компания</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[95px]">Тариф</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-[#666666] uppercase tracking-wider w-[100px]">Бонус</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[80px]">Статус</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[85px]">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {referrals.map((ref) => (
                <tr key={ref.id} className="transition-colors hover:bg-[#f5f5f5]">
                  <td className="px-4 py-3"><span className="text-sm font-medium text-[#111111]">{ref.referrer_name}</span></td>
                  <td className="px-4 py-3"><span className="text-sm text-[#111111]">{ref.referred_tenant}</span></td>
                  <td className="px-4 py-3"><span className="text-xs text-[#666666]">{getPlanLabel(ref.referred_plan)}</span></td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-emerald-700 font-mono tabular-nums">{formatAmount(ref.reward_amount, ref.reward_currency)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", REFERRAL_STATUS[ref.status])}>
                      {ref.status}
                    </span>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-[#888888]">{formatDate(ref.created_at)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payout History */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="flex items-center gap-2 border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
          <Banknote className="h-4 w-4 text-[#666666]" />
          <span className="text-sm font-semibold text-[#111111]">История выплат</span>
          <span className="ml-auto text-xs text-[#888888]">{payouts.length} payouts</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider">Партнёр</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-[#666666] uppercase tracking-wider w-[100px]">Сумма</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[100px]">Способ</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[80px]">Статус</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase tracking-wider w-[140px]">Выплачено</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {payouts.map((p) => (
                <tr key={p.id} className="transition-colors hover:bg-[#f5f5f5]">
                  <td className="px-4 py-3"><span className="text-sm font-medium text-[#111111]">{p.referrer_name}</span></td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-sm font-semibold text-[#111111] font-mono tabular-nums">{formatAmount(p.amount, p.currency)}</span>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs text-[#666666]">{METHOD_LABELS[p.method] ?? p.method}</span></td>
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", PAYOUT_STATUS[p.status])}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-[#888888]">{p.paid_at ? formatDateFull(p.paid_at) : "—"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});