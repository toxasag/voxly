"use client";

import { memo, useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Activity, Coins, Gauge, Zap } from "lucide-react";
import type { AiBot, AiLogEntry, DailyUsage } from "@/lib/ai-bots/ai-bots.types";
import { getModelInfo } from "@/lib/ai-bots/ai-bots.types";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

interface BotUsageStatsProps {
  bot: AiBot;
  usage: DailyUsage[];
  logs: AiLogEntry[];
}

const rubFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat("ru-RU");

function formatDayLabel(isoDate: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

const TOOLTIP_STYLE = {
  backgroundColor: "rgb(15, 23, 42)",
  border: "1px solid rgb(51, 65, 85)",
  borderRadius: "8px",
  fontSize: "12px",
  color: "#e2e8f0",
} as const;

const AXIS_TICK = { fill: "#94a3b8", fontSize: 11 } as const;
const AXIS_LINE = { stroke: "rgb(51, 65, 85)" } as const;

interface KpiTileProps {
  icon: typeof Zap;
  label: string;
  value: string;
  accent: string;
  hint?: string;
}

const KpiTile = memo(function KpiTile({ icon: Icon, label, value, accent, hint }: KpiTileProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
      <div className="flex items-center gap-2">
        <div className={cn("rounded-lg p-1.5", accent)}>
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-100">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-600">{hint}</p>}
    </div>
  );
});

export const BotUsageStats = memo(function BotUsageStats({
  bot,
  usage,
  logs,
}: BotUsageStatsProps) {
  const model = getModelInfo(bot.model);

  const totals = useMemo(() => {
    const requests = usage.reduce((sum, day) => sum + day.requests, 0);
    const tokens = usage.reduce((sum, day) => sum + day.tokens, 0);
    const activeDays = usage.filter((day) => day.requests > 0);
    const avgLatency =
      activeDays.length === 0
        ? 0
        : Math.round(
            activeDays.reduce((sum, day) => sum + day.avg_latency_ms, 0) / activeDays.length,
          );
    return { requests, tokens, avgLatency };
  }, [usage]);

  const chartData = useMemo(
    () =>
      usage.map((day) => ({
        label: formatDayLabel(day.date),
        requests: day.requests,
        tokens: day.tokens,
        latency: day.avg_latency_ms,
      })),
    [usage],
  );

  // tokens_limit = 0 — лимита на агента нет, расход ограничен балансом ИИ.
  // Без проверки деление давало NaN в подписи.
  const hasLimit = bot.tokens_limit > 0;
  const usagePercent = hasLimit
    ? Math.min(100, Math.round((bot.tokens_used / bot.tokens_limit) * 100))
    : 0;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-4 gap-4">
        <KpiTile
          icon={Zap}
          label="Использовано токенов"
          value={numberFormatter.format(bot.tokens_used)}
          accent="bg-amber-500/10 text-amber-400"
          hint={
            hasLimit
              ? `${usagePercent}% от лимита ${numberFormatter.format(bot.tokens_limit)}`
              : "расход списывается с баланса ИИ"
          }
        />
        <KpiTile
          icon={Activity}
          label="Запросы (14 дн)"
          value={numberFormatter.format(totals.requests)}
          accent="bg-sky-500/10 text-sky-400"
          hint={`${numberFormatter.format(bot.requests_count)} за всё время`}
        />
        <KpiTile
          icon={Gauge}
          label="Ср. задержка"
          value={totals.avgLatency === 0 ? "—" : `${numberFormatter.format(totals.avgLatency)} ms`}
          accent="bg-emerald-500/10 text-emerald-400"
          hint={model.label}
        />
        <KpiTile
          icon={Coins}
          label="Затраты на сегодня"
          value={rubFormatter.format(bot.cost_rub)}
          accent="bg-orange-400/10 text-orange-400"
          hint={`${model.price_in_per_1k} ₽ вход / ${model.price_out_per_1k} ₽ выход за 1 тыс.`}
        />
      </div>

      {/* Requests + tokens */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-200">Запросы и токены по дням</h3>
        {chartData.length === 0 ? (
          <EmptyState icon={Activity} title="Нет данных об использовании" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <CartesianGrid stroke="rgb(51, 65, 85)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
              <YAxis
                yAxisId="requests"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={40}
              />
              <YAxis
                yAxisId="tokens"
                orientation="right"
                tick={AXIS_TICK}
                axisLine={AXIS_LINE}
                tickLine={false}
                width={52}
                tickFormatter={(value: number) =>
                  new Intl.NumberFormat("en-US", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(value)
                }
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} iconType="circle" />
              <Bar
                yAxisId="requests"
                dataKey="requests"
                name="Запросы"
                fill="rgb(245, 158, 11)"
                radius={[3, 3, 0, 0]}
                barSize={16}
              />
              <Line
                yAxisId="tokens"
                type="monotone"
                dataKey="tokens"
                name="Токены"
                stroke="rgb(56, 189, 248)"
                strokeWidth={2}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Latency */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h3 className="mb-4 text-sm font-semibold text-slate-200">Средняя задержка (мс)</h3>
        {chartData.length === 0 ? (
          <EmptyState icon={Gauge} title="Нет данных о задержке" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
              <defs>
                <linearGradient id="latencyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="rgb(52, 211, 153)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="rgb(52, 211, 153)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgb(51, 65, 85)" strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} />
              <YAxis tick={AXIS_TICK} axisLine={AXIS_LINE} tickLine={false} width={48} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area
                type="monotone"
                dataKey="latency"
                name="Задержка"
                stroke="rgb(52, 211, 153)"
                strokeWidth={2}
                fill="url(#latencyFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Recent calls */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-200">
            Последние вызовы
            <span className="ml-1.5 text-xs font-normal text-slate-600">
              из ai_logs
            </span>
          </h3>
        </div>

        {logs.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Вызовы не зафиксированы"
            description="Каждый вызов LLM записывается в ai_logs с тенантом, моделью, токенами и задержкой."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Когда
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Пользователь
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Токенов вход
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Токенов выход
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Задержка
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Стоимость
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Статус
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {logs.map((log) => (
                <tr key={log.id} className="transition-colors hover:bg-slate-800/50">
                  <td className="px-4 py-3 text-xs text-slate-400">
                    {formatDateTime(log.created_at)}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300">{log.user_name}</td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {numberFormatter.format(log.tokens_in)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {numberFormatter.format(log.tokens_out)}
                  </td>
                  <td className="px-4 py-3 text-right text-xs text-slate-400">
                    {numberFormatter.format(log.latency_ms)} мс
                  </td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-amber-400">
                    {rubFormatter.format(log.cost_rub)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge
                      variant={log.status === "success" ? "success" : "destructive"}
                      size="sm"
                    >
                      {log.status}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
