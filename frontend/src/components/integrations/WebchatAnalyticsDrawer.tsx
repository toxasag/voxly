"use client";

import { useState } from "react";
import {
  ArrowDown,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Eye,
  Globe,
  Loader2,
  MessageSquareText,
  MousePointerClick,
  Percent,
  RefreshCw,
  Trophy,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { Sheet, SheetHeader } from "@/components/ui/sheet";
import {
  useWidgetAnalytics,
  type WidgetFunnelPeriod,
  type WidgetFunnelStageDTO,
} from "@/lib/api/use-widget-analytics";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";

interface WebchatAnalyticsDrawerProps {
  account: ChannelAccountDTO | null;
  open: boolean;
  onClose: () => void;
}

export function WebchatAnalyticsDrawer({
  account,
  open,
  onClose,
}: WebchatAnalyticsDrawerProps) {
  const [period, setPeriod] = useState<WidgetFunnelPeriod>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);

  const { data: stats, isLoading, isError, error, refetch, isFetching } = useWidgetAnalytics(
    account?.id ?? null,
    {
      period,
      from: period === "custom" && customFrom ? customFrom : undefined,
      to: period === "custom" && customTo ? customTo : undefined,
      enabled: open && Boolean(account?.id),
    },
  );

  if (!account) return null;

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
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      width="w-full md:w-[780px]"
      isMaximized={isMaximized}
    >
      <SheetHeader
        onClose={onClose}
        onToggleMaximize={() => setIsMaximized((prev) => !prev)}
        isMaximized={isMaximized}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <BarChart3 className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#111111] truncate">
              Воронка конверсий: {account.label}
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-[#666666]">
              <Globe className="h-3.5 w-3.5 text-[#888888]" />
              <span className="truncate">{account.externalId}</span>
              <span className="text-[#888888]">·</span>
              <span className="text-[#888888]">Сквозная аналитика онлайн-чата</span>
            </p>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Панель переключения периодов */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] pb-4">
          <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-1">
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
                className={`rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors ${
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

        {/* Пользовательский выбор дат */}
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

        {/* Индикатор загрузки / Ошибка */}
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
            <p className="font-semibold">Не удалось загрузить данные аналитики</p>
            <p className="mt-1 text-rose-700">
              {error instanceof Error ? error.message : "Произошла сетевая ошибка при запросе статистики."}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-lg border border-rose-300 bg-white px-3 py-1 font-medium text-rose-800 shadow-2xs hover:bg-rose-50"
            >
              Попробовать снова
            </button>
          </div>
        ) : stats ? (
          <>
            {/* 5 Сводных карточек ключевых показателей (KPI Cards) */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {/* Посетители */}
              <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs text-[#666666]">
                  <span>Посетители</span>
                  <Users className="h-4 w-4 text-sky-600" />
                </div>
                <div className="mt-2 font-mono text-xl font-bold text-[#111111] tabular-nums">
                  {stats.summary.totalVisitors.toLocaleString("ru-RU")}
                </div>
                <div className="mt-1 text-[11px] text-[#888888] truncate">
                  Визитов на сайте
                </div>
              </div>

              {/* Запуски виджета */}
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

              {/* Диалоги */}
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

              {/* Лиды */}
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

              {/* Продажи */}
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

            {/* Выручка по закрытым сделкам (если есть) */}
            {stats.summary.totalWonRevenue > 0 && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-emerald-900">
                    Выручка по выигранным сделкам с этого виджета
                  </span>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    Сумма оплат клиентов, пришедших через форму и чат на сайте
                  </p>
                </div>
                <div className="font-mono text-xl font-bold text-emerald-800 tabular-nums">
                  {stats.summary.totalWonRevenue.toLocaleString("ru-RU")} ₽
                </div>
              </div>
            )}

            {/* Пошаговая воронка конверсий (Visual Funnel) */}
            <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm text-[#111111]">
                    Ступенчатая воронка переходов
                  </h3>
                  <span className="rounded-full bg-[#fafafa] border border-[#e5e5e5] px-2 py-0.5 text-[11px] text-[#666666]">
                    5 этапов
                  </span>
                </div>
                <div className="text-xs text-[#666666]">
                  Сквозная конверсия в оплату:{" "}
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

                      {/* Горизонтальная полоса прогресса воронки */}
                      <div className="h-3 w-full rounded-full bg-[#f0f0f0] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${color.bar}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>

                      {/* Индикатор отвала посетителей между шагами */}
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

            {/* Динамика по дням (Daily Dynamics) */}
            <div className="rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs">
              <div className="flex items-center justify-between border-b border-[#f0f0f0] pb-3">
                <h3 className="font-semibold text-sm text-[#111111]">
                  Ежедневная динамика активности
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

            {/* Памятка по методологии сбора данных */}
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 text-xs text-[#666666] space-y-2">
              <div className="font-semibold text-[#111111]">
                Как рассчитываются этапы воронки виджета:
              </div>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <strong className="text-[#111111]">Посетители:</strong> уникальные сессии пользователей на страницах с установленным кодом виджета.
                </li>
                <li>
                  <strong className="text-[#111111]">Запуски виджета:</strong> клик по капсуле или кнопке чата, либо автооткрытие проактивным приветствием.
                </li>
                <li>
                  <strong className="text-[#111111]">Диалоги:</strong> сессии, где клиент отправил хотя бы одно первое сообщение консультанту или AI-боту.
                </li>
                <li>
                  <strong className="text-[#111111]">Заявки (Лиды):</strong> получение контактов (телефон, email, имя) через диалог или форму лидогенерации.
                </li>
                <li>
                  <strong className="text-[#111111]">Продажи:</strong> сделки в CRM, созданные из этого веб-чата, переведённые на этап с признаком «Успешно реализовано».
                </li>
              </ul>
            </div>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
