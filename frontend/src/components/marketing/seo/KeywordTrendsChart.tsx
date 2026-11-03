"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SearchTrendPoint } from "@/types/seo.types";

export interface KeywordTrendsChartProps {
  trends?: SearchTrendPoint[];
  title?: string;
  rangeLabel?: string;
}

export function KeywordTrendsChart({
  trends = [],
  title = "Search Trends",
  rangeLabel = "Dec 2025 - Nov 2026",
}: KeywordTrendsChartProps) {
  const formatYAxis = (val: number) => {
    if (val >= 1000) return `${(val / 1000).toFixed(1)}k`;
    return String(val);
  };

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors">
      <div className="flex items-center justify-between pb-3">
        <div>
          <h3 className="text-[13px] font-semibold text-[#111111]">{title}</h3>
          <p className="text-[11px] text-[#888888]">{rangeLabel}</p>
        </div>
        <div className="rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[10px] font-medium text-[#666666]">
          12 Months Dynamic
        </div>
      </div>

      <div className="h-[180px] w-full">
        {trends.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-[#888888]">
            No trend data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trends} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="seoTrendGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4a38f5" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#4a38f5" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
              <XAxis
                dataKey="month"
                stroke="#888888"
                fontSize={10}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="#888888"
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatYAxis}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0]?.payload as SearchTrendPoint;
                    return (
                      <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-2 shadow-md text-xs">
                        <p className="text-[11px] font-medium text-[#888888]">{data.month}</p>
                        <p className="font-mono font-semibold text-[#4a38f5]">
                          {data.volume.toLocaleString()} searches
                        </p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke="#4a38f5"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#seoTrendGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
