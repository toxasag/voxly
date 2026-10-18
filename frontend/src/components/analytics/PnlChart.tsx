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
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <h2 className="text-sm font-semibold text-[#111111] mb-4">
        Доходы и расходы (P&L)
      </h2>
      <ResponsiveContainer width="100%" height={320}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="#f0f0f0" strokeDasharray="3 3" />
          <XAxis
            dataKey="month"
            tick={{ fill: "#666666", fontSize: 12 }}
            axisLine={{ stroke: "#e5e5e5" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#666666", fontSize: 12 }}
            axisLine={{ stroke: "#e5e5e5" }}
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
          <Legend
            wrapperStyle={{ fontSize: "12px", paddingTop: "8px", color: "#666666" }}
            iconType="circle"
          />
          <Bar
            dataKey="revenue"
            name="Выручка"
            fill="#4a38f5"
            radius={[3, 3, 0, 0]}
            barSize={24}
          />
          <Line
            type="monotone"
            dataKey="expenses"
            name="Расходы"
            stroke="rgb(225, 29, 72)"
            strokeWidth={2}
            dot={{ fill: "rgb(225, 29, 72)", r: 4 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});