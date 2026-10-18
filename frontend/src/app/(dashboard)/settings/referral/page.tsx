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
      <div><h1 className="text-xl font-bold text-slate-100">Партнёрская программа</h1><p className="mt-1 text-sm text-slate-400">Приглашайте партнёров и получайте вознаграждение</p></div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-sky-500/10 p-1.5"><Users className="h-4 w-4 text-sky-400" /></div><span className="text-xs font-medium text-slate-500">Приглашено</span></div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{stats.total_invited}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-[#4a38f5]/10 p-1.5"><Gift className="h-4 w-4 text-amber-400" /></div><span className="text-xs font-medium text-slate-500">Всего начислено</span></div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{formatAmt(stats.total_earned)}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-500/10 p-1.5"><Banknote className="h-4 w-4 text-emerald-400" /></div><span className="text-xs font-medium text-slate-500">Доступно к выплате</span></div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{formatAmt(stats.available_payout)}</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <div className="flex items-center gap-2 mb-2"><Link2 className="h-4 w-4 text-amber-400" /><span className="text-sm font-medium text-slate-300">Ваша партнёрская ссылка</span></div>
        <div className="flex items-center gap-2">
          <code className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-sm text-amber-400 font-mono truncate">{stats.referral_link}</code>
          <button type="button" onClick={handleCopy} className={cn("flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors", copied ? "bg-emerald-600 text-white" : "bg-[#4a38f5] text-white hover:bg-[#3b2be0]")}>
            {copied ? <><Check className="h-4 w-4" />Скопировано</> : <><Copy className="h-4 w-4" />Копировать</>}
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="border-b border-slate-800 px-4 py-3"><span className="text-sm font-semibold text-slate-200">История выплат</span></div>
        <table className="w-full"><thead><tr className="border-b border-slate-800"><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Сумма</th><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Способ</th><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase">Статус</th><th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase w-[100px]">Дата</th></tr></thead>
          <tbody className="divide-y divide-slate-800">
            {MOCK_REFERRAL_PAYOUTS.map(p => (
              <tr key={p.id}><td className="px-4 py-3"><span className="text-sm font-semibold text-slate-200">{formatAmt(p.amount)}</span></td><td className="px-4 py-3"><span className="text-xs text-slate-400">{p.method}</span></td><td className="px-4 py-3"><span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", p.status === "completed" ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30" : "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/30")}>{p.status}</span></td><td className="px-4 py-3"><span className="text-xs text-slate-500">{formatDate(p.created_at)}</span></td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}