"use client";

import { CreditCard, Info, Loader2, RefreshCw } from "lucide-react";
import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import { useAdminBilling } from "@/lib/api/use-admin";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { AdminPricingCatalogEditor } from "@/components/admin/AdminPricingCatalogEditor";
import { cn } from "@/lib/utils";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

const PLAN_LABEL: Record<string, string> = {
  trial: "Пробный",
  starter: "Starter",
  business: "Business",
  enterprise: "Enterprise",
};

export default function AdminBillingPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminBilling();

  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">
              Тарифы и биллинг
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Распределение арендаторов по планам и оценка выручки
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Обновить
          </button>
        </div>

        {/*
          Явная оговорка вместо тихой подачи оценки как факта: платёжного
          провайдера в системе нет, поэтому MRR считается умножением прайса на
          число активных арендаторов.
        */}
        {data?.billingProvider.connected === false && (
          <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            <div className="text-sm text-slate-300">
              <p className="font-medium text-sky-400">Платёжный провайдер не подключён</p>
              <p className="mt-1 text-slate-400">
                Суммы ниже — расчётные: прайс плана × число активных арендаторов. Фактических
                платежей и счетов в системе пока нет.
              </p>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <p className="text-sm text-rose-400">Не удалось загрузить данные: {error?.message}</p>
          </div>
        ) : data === undefined || data.plans.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="Данных по тарифам нет"
            description="Появятся, как только в системе будет хотя бы один арендатор."
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
                <p className="text-xs uppercase tracking-wider text-[#666666]">Всего компаний</p>
                <p className="mt-2 text-3xl font-bold text-[#111111]">{data.totals.tenants}</p>
              </div>
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
                <p className="text-xs uppercase tracking-wider text-[#666666]">Активных</p>
                <p className="mt-2 text-3xl font-bold text-emerald-600">{data.totals.active}</p>
              </div>
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
                <p className="text-xs uppercase tracking-wider text-[#666666]">
                  MRR (расчётный)
                </p>
                <p className="mt-2 text-3xl font-bold text-[#4a38f5]">
                  {formatMoney(data.totals.estimatedMrr)}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs uppercase tracking-wider text-[#666666]">
                    <th className="px-4 py-3 font-medium">План</th>
                    <th className="px-4 py-3 font-medium">Цена / мес</th>
                    <th className="px-4 py-3 font-medium">Компаний</th>
                    <th className="px-4 py-3 font-medium">Активных</th>
                    <th className="px-4 py-3 font-medium">Пробных</th>
                    <th className="px-4 py-3 font-medium">Просрочено</th>
                    <th className="px-4 py-3 font-medium">Приостановлено</th>
                    <th className="px-4 py-3 font-medium">AI-токены</th>
                    <th className="px-4 py-3 font-medium">Расчётно / мес</th>
                  </tr>
                </thead>
                <tbody>
                  {data.plans.map((plan) => (
                    <tr
                      key={plan.plan}
                      className="border-b border-[#e5e5e5] transition-colors last:border-0 hover:bg-[#fafafa]"
                    >
                      <td className="px-4 py-3 font-medium text-[#111111]">
                        {PLAN_LABEL[plan.plan] ?? plan.plan}
                      </td>
                      <td className="px-4 py-3 text-[#666666]">{formatMoney(plan.priceMonthly)}</td>
                      <td className="px-4 py-3 text-[#666666]">{plan.tenants}</td>
                      <td className="px-4 py-3 font-medium text-emerald-600">{plan.active}</td>
                      <td className="px-4 py-3 font-medium text-amber-700">{plan.trial}</td>
                      <td className="px-4 py-3 font-medium text-rose-600">{plan.pastDue}</td>
                      <td className="px-4 py-3 text-[#888888]">{plan.suspended}</td>
                      <td className="px-4 py-3 text-[#666666]">
                        {plan.aiTokensBalance.toLocaleString("ru-RU")}
                      </td>
                      <td className="px-4 py-3 font-medium text-[#4a38f5]">
                        {formatMoney(plan.estimatedMonthly)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <AdminPricingCatalogEditor />
          </>
        )}
      </div>
    </PlatformOwnerGuard>
  );
}
