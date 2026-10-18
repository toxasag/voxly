"use client";

import { memo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { FunnelStep, TopRepairDefect, MasterLoad } from "@/lib/analytics/mock-analytics";
import { cn } from "@/lib/utils";

/** «320 сделок», «2 сделки», «1 сделка». */
function pluralDeals(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сделка";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сделки";
  return "сделок";
}

/** «48 ремонтов», «2 ремонта», «1 ремонт». */
function pluralRepairs(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "ремонт";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ремонта";
  return "ремонтов";
}

interface FunnelChartProps {
  data: FunnelStep[];
}

const FUNNEL_COLORS = [
  "#64748b",
  "#0ea5e9",
  "#4a38f5",
  "#10b981",
  "#10b981",
];

export const FunnelChart = memo(function FunnelChart({ data }: FunnelChartProps) {
  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <h2 className="text-sm font-semibold text-[#111111] mb-4">
        Воронка продаж
      </h2>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 20 }}
        >
          <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#666666", fontSize: 12 }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
          />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fill: "#666666", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
            width={100}
          />
          <Tooltip
            formatter={(value) => [`${Number(value)} ${pluralDeals(Number(value))}`, "Количество"]}
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e5e5e5",
              borderRadius: "8px",
              fontSize: "13px",
              color: "#111111",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
            }}
            itemStyle={{ padding: "2px 0", color: "#111111" }}
            labelStyle={{ color: "#666666" }}
          />
          <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={32}>
            {data.map((_, index) => (
              <Cell key={`cell-${index}`} fill={FUNNEL_COLORS[index] ?? FUNNEL_COLORS[0]} />
            ))}
            <LabelList
              dataKey="percentage"
              position="right"
              formatter={(v) => `${Number(v)}%`}
              style={{ fill: "#666666", fontSize: 11, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

interface TopRepairsChartProps {
  data: TopRepairDefect[];
}

const TOP_COLORS = ["#4a38f5", "#0ea5e9", "#10b981", "#8b5cf6", "#f43f5e"];

export const TopRepairsChart = memo(function TopRepairsChart({ data }: TopRepairsChartProps) {
  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <h2 className="text-sm font-semibold text-[#111111] mb-4">
        Топ-5 частых ремонтов
      </h2>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 20 }}
        >
          <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: "#666666", fontSize: 12 }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
          />
          <YAxis
            dataKey="name"
            type="category"
            tick={{ fill: "#666666", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={120}
          />
          <Tooltip
            formatter={(value, name) => {
              const count = Number(value);
              const entry = data.find((d) => d.count === count);
              return [
                `${count} ${pluralRepairs(count)} · средний чек ${new Intl.NumberFormat("ru-RU", {
                  style: "currency",
                  currency: "RUB",
                  maximumFractionDigits: 0,
                }).format(entry?.avg_cost ?? 0)}`,
                "Количество",
              ];
            }}
            contentStyle={{
              backgroundColor: "#ffffff",
              border: "1px solid #e5e5e5",
              borderRadius: "8px",
              fontSize: "13px",
              color: "#111111",
              boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
            }}
            itemStyle={{ padding: "2px 0", color: "#111111" }}
            labelStyle={{ color: "#666666" }}
          />
          <Bar dataKey="count" name="Количество" radius={[0, 4, 4, 0]} barSize={28}>
            {data.map((_, index) => (
              <Cell key={`top-${index}`} fill={TOP_COLORS[index] ?? TOP_COLORS[0]} />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              style={{ fill: "#666666", fontSize: 12, fontWeight: 600 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
});

interface MasterLoadChartProps {
  data: MasterLoad[];
}

export const MasterLoadChart = memo(function MasterLoadChart({ data }: MasterLoadChartProps) {
  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <h2 className="text-sm font-semibold text-[#111111] mb-4">
        Загрузка мастеров
      </h2>
      <div className="space-y-3">
        {data.map((master) => {
          const total = master.active + master.completed;
          const activePct = total > 0 ? Math.round((master.active / total) * 100) : 0;
          const completedPct = 100 - activePct;

          return (
            <div key={master.name} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#111111]">{master.name}</span>
                <span className="text-xs text-[#666666]">
                  {master.active} в работе · {master.completed} завершено
                </span>
              </div>
              <div className="flex h-2.5 w-full rounded-full bg-[#f0f0f0] overflow-hidden">
                <div
                  className="h-full bg-[#4a38f5] transition-all duration-500"
                  style={{ width: `${activePct}%` }}
                  title={`В работе: ${master.active}`}
                />
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${completedPct}%` }}
                  title={`Завершено: ${master.completed}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});