"use client";

import { useState } from "react";
import { Link2, Copy, Gift, Users, Banknote, Check, Info } from "lucide-react";
import { useTenantInfo } from "@/lib/api/use-team";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/shared/Skeleton";

function formatAmt(v: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(v);
}

export default function ReferralSettingsPage() {
  const tenant = useTenantInfo();
  const [copied, setCopied] = useState(false);

  const slug = tenant.data?.slug ?? "partner";
  const referralLink = `https://getvoxly.ru/register?ref=${slug}`;

  // Честные показатели: для новых тенантов пока 0
  const stats = {
    total_invited: 0,
    total_earned: 0,
    available_payout: 0,
    referral_link: referralLink,
  };

  const payouts: { id: string; amount: number; method: string; status: string; created_at: string }[] = [];

  const handleCopy = () => {
    navigator.clipboard.writeText(stats.referral_link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (tenant.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 w-full rounded-[8px]" />
          <Skeleton className="h-24 w-full rounded-[8px]" />
          <Skeleton className="h-24 w-full rounded-[8px]" />
        </div>
        <Skeleton className="h-24 w-full rounded-[8px]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[#111111]">Партнёрская программа</h1>
        <p className="mt-1 text-[13px] text-[#666666]">
          Приглашайте коллег и партнёров по своей реферальной ссылке и получайте 20% от их платежей
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-sky-50 p-1.5">
              <Users className="h-4 w-4 text-sky-600" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Приглашено компаний</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {stats.total_invited}
          </p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-indigo-50 p-1.5">
              <Gift className="h-4 w-4 text-[#4a38f5]" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Всего начислено</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {formatAmt(stats.total_earned)}
          </p>
        </div>
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white px-5 py-4 shadow-2xs">
          <div className="flex items-center gap-2">
            <div className="rounded-[6px] bg-emerald-50 p-1.5">
              <Banknote className="h-4 w-4 text-emerald-700" />
            </div>
            <span className="text-xs font-medium text-[#666666]">Доступно к выводу</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-[#111111] tabular-nums font-mono">
            {formatAmt(stats.available_payout)}
          </p>
        </div>
      </div>

      {/* Партнёрская ссылка */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2 mb-2">
          <Link2 className="h-4 w-4 text-[#4a38f5]" />
          <span className="text-sm font-medium text-[#111111]">Ваша партнёрская ссылка</span>
        </div>
        <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
          <code className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-sm text-[#111111] font-mono truncate">
            {stats.referral_link}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              "flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium shadow-2xs transition-colors shrink-0",
              copied
                ? "bg-emerald-600 text-white"
                : "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
            )}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                Скопировано
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                Копировать ссылку
              </>
            )}
          </button>
        </div>
      </div>

      {/* Условия */}
      <div className="flex gap-3 rounded-[8px] border border-sky-200 bg-sky-50/60 p-4">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div className="text-xs leading-relaxed text-sky-950">
          <p className="font-medium text-sky-900">Как работает партнёрская программа</p>
          <p className="mt-1 text-sky-800">
            Делитесь ссылкой с клиентами и коллегами. При регистрации они привязываются к вашему аккаунту, и вы получаете 20% от суммы каждой их оплаты подписки и модулей в течение 12 месяцев. Вывод средств доступен от 1 000 ₽ на расчётный счёт или карту.
          </p>
        </div>
      </div>

      {/* История выплат */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="border-b border-[#e5e5e5] px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-semibold text-[#111111]">История выплат</span>
          <span className="text-xs text-[#666666]">0 операций</span>
        </div>
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-xs text-[#888888]">
            Выплат пока не производилось. Заявку на вывод можно подать при накоплении от 1 000 ₽.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left font-medium text-[#666666]">Сумма</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#666666]">Способ</th>
                <th className="px-4 py-2.5 text-left font-medium text-[#666666]">Статус</th>
                <th className="px-4 py-2.5 text-right font-medium text-[#666666]">Дата</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {payouts.map((p) => (
                <tr key={p.id} className="h-8 hover:bg-[#fafafa]">
                  <td className="px-4 py-2 font-semibold text-[#111111] tabular-nums font-mono">
                    {formatAmt(p.amount)}
                  </td>
                  <td className="px-4 py-2 text-[#666666]">{p.method}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center rounded-[4px] border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      {p.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right text-[#888888]">{p.created_at}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}