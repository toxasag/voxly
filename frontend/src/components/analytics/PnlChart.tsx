"use client";

import { memo } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { MonthlyPnL } from "@/lib/analytics/mock-analytics";

interface PnlChartProps {
  data: MonthlyPnL[];
}

function formatTooltip(value: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(value);
}

export const PnlChart = memo(function PnlChart({ data }: PnlChartProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-sm font-semibold text-slate-200 mb-4">
        Доходы и расходы (P&L)
      </h2>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="rgb(51, 65, 85)" strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "rgb(51, 65, 85)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "rgb(51, 65, 85)" }}
            tickLine={false}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat("ru-RU", {
                notation: "compact",
                maximumFractionDigits: 1,
              }).format(v)
            }
          />
          <Tooltip
            formatter={(value) => formatTooltip(Number(value))}
            contentStyle={{
              backgroundColor: "rgb(15, 23, 42)",
              border: "1px solid rgb(51, 65, 85)",
              borderRadius: "8px",
              fontSize: "13px",
              color: "#e2e8f0",
            }}
            itemStyle={{ padding: "2px 0" }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", paddingTop: "8px" }}
            iconType="circle"
          />
          <Bar
            dataKey="revenue"
            name="Выручка"
            fill="rgb(245, 158, 11)"
            radius={[3, 3, 0, 0]}
            barSize={24}
          />
          <Line
            type="monotone"
            dataKey="expenses"
            name="Расходы"
            stroke="rgb(244, 63, 94)"
            strokeWidth={2}
            dot={{ fill: "rgb(244, 63, 94)", r: 4 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});