"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  BarChart3,
  Calendar,
  Globe,
  Loader2,
  MessageSquareText,
  MousePointerClick,
  Plus,
  RefreshCw,
  Trophy,
  UserCheck,
  Users,
} from "lucide-react";
import { useChannelAccounts } from "@/lib/api/use-channels";
import {
  useWidgetAnalytics,
  type WidgetFunnelPeriod,
} from "@/lib/api/use-widget-analytics";
import { EmptyState } from "@/components/shared/EmptyState";

export function WebchatAnalyticsDashboardTab() {
  const { data: channelData, isLoading: isLoadingAccounts } = useChannelAccounts("webchat");
  const accounts = useMemo(() => channelData?.items ?? [], [channelData]);

  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [period, setPeriod] = useState<WidgetFunnelPeriod>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const activeAccountId = selectedAccountId || accounts[0]?.id || "";

  const activeAccount = useMemo(
    () => accounts.find((a) => a.id === activeAccountId) ?? null,
    [accounts, activeAccountId],
  );

  const { data: stats, isLoading, isError, error, refetch, isFetching } = useWidgetAnalytics(
    activeAccountId || null,
    {
      period,
      from: period === "custom" && customFrom ? customFrom : undefined,
      to: period === "custom" && customTo ? customTo : undefined,
      enabled: Boolean(activeAccountId),
    },
  );

  if (isLoadingAccounts) {
    return (
      <div className="space-y-4">
        <div className="h-10 w-64 animate-pulse rounded-lg bg-[#fafafa]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
          ))}
        </div>
        <div className="h-72 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={MessageSquareText}
        title="Онлайн-виджеты пока не настроены"
        description="Подключите ваш первый сайт в разделе интеграций онлайн-чата, чтобы собирать сквозную воронку конверсий."
        action={
          <Link
            href="/integrations/webchat"
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3d2ee0] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Подключить сайт для онлайн-чата
          </Link>
        }
      />
    );
  }

  const stageIcons: Record<string, React.ComponentType<{ className?: string }>> = {
    visit: Users,
    open: MousePointerClick,
    chat: MessageSquareText,
    lead: UserCheck,
    won: Trophy,
  };

  const stageColors: Record<string, { bg: string; text: string; bar: string }> = {
    visit: { bg: "bg-sky-50", text: "text-sky-700", bar: "bg-sky-500" },
    open: { bg: "bg-indigo-50", text: "text-[#4a38f5]", bar: "bg-[#4a38f5]" },
    chat: { bg: "bg-amber-50", text: "text-amber-700", bar: "bg-amber-500" },
    lead: { bg: "bg-emerald-50", text: "text-emerald-700", bar: "bg-emerald-500" },
    won: { bg: "bg-emerald-100", text: "text-emerald-800", bar: "bg-emerald-600" },
  };

  return (
    <div className="space-y-6">
      {/* Селектор сайта и периода */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#e5e5e5] bg-white p-4 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
            <Globe className="h-4 w-4 text-[#4a38f5]" />
            Сайт:
          </label>
          <select
            value={activeAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.label} ({acc.externalId})
              </option>
            ))}
          </select>

          {activeAccount && (
            <Link
              href="/integrations/webchat"
              className="text-xs text-[#4a38f5] hover:underline"
            >
              Настройки виджета →
            </Link>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Период */}
          <div className="flex items-center gap-1 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-1">
            {(
              [
                { id: "today", label: "Сегодня" },
                { id: "7d", label: "7 дней" },
                { id: "30d", label: "30 дней" },
                { id: "all", label: "Все время" },
                { id: "custom", label: "Период" },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setPeriod(btn.id)}
                className={`rounded-[6px] px-3 py-1 text-xs font-medium transition-colors ${
                  period === btn.id
                    ? "bg-white text-[#111111] shadow-2xs font-semibold"
                    : "text-[#666666] hover:text-[#111111]"
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isFetching ? "animate-spin text-[#4a38f5]" : "text-[#666666]"}`}
            />
            Обновить
          </button>
        </div>
      </div>

      {/* Пользовательский период */}
      {period === "custom" && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#111111]">
          <Calendar className="h-4 w-4 text-[#888888]" />
          <div className="flex items-center gap-2">
            <span className="text-[#666666]">От:</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#666666]">До:</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* Контент аналитики */}
      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
          <p className="font-semibold">Ошибка загрузки воронки</p>
          <p className="mt-1 text-rose-700">
            {error instanceof Error ? error.message : "Произошла сетевая ошибка при запросе аналитики."}
          </p>
        </div>
      ) : stats ? (
        <>
          {/* 5 KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>Посетители</span>
                <Users className="h-4 w-4 text-sky-600" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#111111] tabular-nums">
                {stats.summary.totalVisitors.toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] text-[#888888]">Визитов сайта</div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>Запуски</span>
                <MousePointerClick className="h-4 w-4 text-[#4a38f5]" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#111111] tabular-nums">
                {stats.summary.totalOpens.toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] font-medium text-[#4a38f5]">
                CR {stats.stages[1]?.conversionRateToPrevious ?? 0}%
              </div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>Диалоги</span>
                <MessageSquareText className="h-4 w-4 text-amber-600" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#111111] tabular-nums">
                {stats.summary.totalChats.toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] font-medium text-amber-700">
                CR {stats.stages[2]?.conversionRateToPrevious ?? 0}%
              </div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>Заявки / Лиды</span>
                <UserCheck className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-[#111111] tabular-nums">
                {stats.summary.totalLeads.toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] font-medium text-emerald-700">
                CR {stats.stages[3]?.conversionRateToPrevious ?? 0}%
              </div>
            </div>

            <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs col-span-2 sm:col-span-1">
              <div className="flex items-center justify-between text-xs text-[#666666]">
                <span>Продажи</span>
                <Trophy className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="mt-2 font-mono text-xl font-bold text-emerald-700 tabular-nums">
                {stats.summary.totalWonDeals.toLocaleString("ru-RU")}
              </div>
              <div className="mt-1 text-[11px] font-medium text-emerald-700">
                Сквозная CR {stats.summary.overallConversionRate}%
              </div>
            </div>
          </div>

          {/* Выручка */}
          {stats.summary.totalWonRevenue > 0 && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-emerald-900">
                  Выручка по выигранным сделкам с этого сайта
                </span>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Сумма оплат клиентов, обратившихся через онлайн-чат
                </p>
              </div>
              <div className="font-mono text-xl font-bold text-emerald-800 tabular-nums">
                {stats.summary.totalWonRevenue.toLocaleString("ru-RU")} ₽
              </div>
            </div>
          )}

          {/* Воронка */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm text-[#111111]">
                  Воронка конверсий посетителей в продажи
                </h3>
                <span className="rounded-full bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 text-[11px] text-[#666666]">
                  {stats.widgetLabel}
                </span>
              </div>
              <div className="text-xs text-[#666666]">
                Сквозная конверсия:{" "}
                <strong className="text-emerald-700 font-mono">
                  {stats.summary.overallConversionRate}%
                </strong>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {stats.stages.map((stage, idx) => {
                const Icon = stageIcons[stage.key] || Users;
                const color = stageColors[stage.key] || {
                  bg: "bg-gray-50",
                  text: "text-gray-700",
                  bar: "bg-[#4a38f5]",
                };
                const pct = Math.max(3, stage.conversionRateToFirst);

                return (
                  <div key={stage.key} className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#fafafa] border border-[#e5e5e5] text-[11px] font-semibold text-[#666666]">
                          {idx + 1}
                        </span>
                        <div className={`flex h-6 w-6 items-center justify-center rounded-md ${color.bg} ${color.text}`}>
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                        <span className="font-medium text-[#111111]">{stage.label}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        {idx > 0 && (
                          <span className="text-[11px] font-medium text-[#666666] bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 rounded-full">
                            Конверсия шага: <strong className="text-[#111111] font-mono">{stage.conversionRateToPrevious}%</strong>
                          </span>
                        )}

                        <span className="font-mono text-sm font-bold text-[#111111] tabular-nums">
                          {stage.count.toLocaleString("ru-RU")}
                        </span>
                      </div>
                    </div>

                    <div className="h-3 w-full rounded-full bg-[#f0f0f0] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${color.bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>

                    {idx < stats.stages.length - 1 && stage.dropOffCount > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-[#888888] pt-0.5 pl-7">
                        <div className="flex items-center gap-1 text-rose-600">
                          <ArrowDown className="h-3 w-3" />
                          <span>Отвал на этом шаге: -{stage.dropOffRate}%</span>
                        </div>
                        <span>
                          Покинули воронку: <strong>{stage.dropOffCount.toLocaleString("ru-RU")}</strong>
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Таблица динамики */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
              <h3 className="font-semibold text-sm text-[#111111]">
                Динамика по дням
              </h3>
              <span className="text-xs text-[#666666]">
                Дней в отчете: {stats.daily.length}
              </span>
            </div>

            {stats.daily.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#888888]">
                За выбранный период активности пока не зафиксировано
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[#e5e5e5] text-[#666666]">
                      <th className="pb-2 font-medium">Дата</th>
                      <th className="pb-2 font-medium text-right">Посетители</th>
                      <th className="pb-2 font-medium text-right">Запуски</th>
                      <th className="pb-2 font-medium text-right">Диалоги</th>
                      <th className="pb-2 font-medium text-right">Лиды</th>
                      <th className="pb-2 font-medium text-right">Продажи</th>
                      <th className="pb-2 font-medium text-right">Выручка</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    {stats.daily.map((day) => (
                      <tr key={day.date} className="hover:bg-[#fafafa] transition-colors">
                        <td className="py-2.5 font-mono text-[#111111]">{day.date}</td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#666666]">
                          {day.visitors}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#4a38f5]">
                          {day.opens}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-amber-700">
                          {day.chats}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-emerald-700">
                          {day.leads}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums font-bold text-emerald-700">
                          {day.won}
                        </td>
                        <td className="py-2.5 text-right font-mono tabular-nums text-[#111111]">
                          {day.revenue > 0 ? `${day.revenue.toLocaleString("ru-RU")} ₽` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
