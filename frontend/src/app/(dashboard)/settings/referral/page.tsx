"use client";

import { useState } from "react";
import { Link2, Copy, Gift, Users, Banknote, Check } from "lucide-react";
import { MOCK_REFERRAL_STATS, MOCK_REFERRAL_PAYOUTS } from "@/lib/mock/marketplace-data";
import { cn } from "@/lib/utils";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

function formatAmt(v: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(v);
}

export default function ReferralSettingsPage() {
  const stats = MOCK_REFERRAL_STATS;
  const [copied, setCopied] = useState(false);

  const handleCopy = () => { navigator.clipboard.writeText(stats.referral_link); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#111111]">Партнёрская программа</h1>
        <p className="mt-1 text-[13px] text-[#666666]">Приглашайте партнёров и получайте вознаграждение</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-sky-50 p-1.5"><Users className="h-4 w-4 text-sky-600" /></div>
            <span className="text-xs font-medium text-[#666666]">Приглашено</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">{stats.total_invited}</p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-indigo-50 p-1.5"><Gift className="h-4 w-4 text-[#4a38f5]" /></div>
            <span className="text-xs font-medium text-[#666666]">Всего начислено</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">{formatAmt(stats.total_earned)}</p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-emerald-50 p-1.5"><Banknote className="h-4 w-4 text-emerald-700" /></div>
            <span className="text-xs font-medium text-[#666666]">Доступно к выплате</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">{formatAmt(stats.available_payout)}</p>
        </div>
      </div>

      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2 mb-2"><Link2 className="h-4 w-4 text-[#4a38f5]" /><span className="text-sm font-medium text-[#111111]">Ваша партнёрская ссылка</span></div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-sm text-[#111111] font-mono truncate">{stats.referral_link}</code>
          <button type="button" onClick={handleCopy} className={cn("flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium shadow-2xs transition-colors", copied ? "bg-emerald-600 text-white" : "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]")}>
            {copied ? <><Check className="h-4 w-4" />Скопировано</> : <><Copy className="h-4 w-4" />Копировать</>}
          </button>
        </div>
      </div>

      <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-3"><span className="text-sm font-semibold text-[#111111]">История выплат</span></div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase">Сумма</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase">Способ</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase">Статус</th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-[#666666] uppercase w-[100px]">Дата</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {MOCK_REFERRAL_PAYOUTS.map(p => (
              <tr key={p.id} className="hover:bg-[#fafafa]">
                <td className="px-4 py-3"><span className="text-sm font-semibold text-[#111111] tabular-nums font-mono">{formatAmt(p.amount)}</span></td>
                <td className="px-4 py-3"><span className="text-xs text-[#666666]">{p.method}</span></td>
                <td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", p.status === "completed" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-indigo-50 text-[#4a38f5] border-indigo-200")}>{p.status}</span></td>
                <td className="px-4 py-3"><span className="text-xs text-[#888888]">{formatDate(p.created_at)}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}