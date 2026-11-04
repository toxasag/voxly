"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  Copy,
  Download,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { KeywordClusterSummary, KeywordIntent, KeywordItem } from "@/types/seo.types";

export interface KeywordMatrixTableProps {
  cluster?: KeywordClusterSummary;
  keywords: KeywordItem[];
  selectedKeywordId?: string;
  onSelectKeyword?: (keyword: KeywordItem) => void;
}

type SortField = "volume" | "cpc" | "competition" | "score" | "keyword";
type SortDirection = "asc" | "desc";

export function KeywordMatrixTable({
  cluster,
  keywords,
  selectedKeywordId,
  onSelectKeyword,
}: KeywordMatrixTableProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("volume");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [filterIntent, setFilterIntent] = useState<KeywordIntent | "ALL">("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  // Сортировка и фильтрация
  const sortedKeywords = useMemo(() => {
    let list = [...keywords];

    if (filterIntent !== "ALL") {
      list = list.filter((kw) => kw.intent === filterIntent);
    }

    list.sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (typeof valA === "string") {
        const cmp = (valA as string).localeCompare(valB as string);
        return sortDirection === "asc" ? cmp : -cmp;
      }

      valA = valA as number;
      valB = valB as number;
      return sortDirection === "asc" ? valA - valB : valB - valA;
    });

    return list;
  }, [keywords, sortField, sortDirection, filterIntent]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  };

  const handleSelectAll = () => {
    if (selectedIds.size === sortedKeywords.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedKeywords.map((k) => k.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleExportCSV = () => {
    const targets = keywords.filter((k) => selectedIds.size === 0 || selectedIds.has(k.id));
    const header = "Keyword,Volume,CPC,Competition,Score,Intent,Source\n";
    const rows = targets
      .map((k) => `"${k.keyword}",${k.volume},${k.cpc},${k.competition},${k.score},${k.intent},${k.source}`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `keywords-export-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setShowExport(false);
  };

  const handleCopy = () => {
    const targets = keywords.filter((k) => selectedIds.size === 0 || selectedIds.has(k.id));
    const text = targets.map((k) => `${k.keyword}\t${k.volume}\t$${k.cpc.toFixed(2)}\t${k.intent}`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowExport(false);
  };

  const formatNumber = (num: number) => num.toLocaleString("en-US");

  // Бейджи интентов
  const renderIntentBadge = (intent: KeywordIntent) => {
    switch (intent) {
      case "Trans":
        return (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            Trans
          </span>
        );
      case "Comm":
        return (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-sky-50 text-sky-700 border border-sky-200">
            Comm
          </span>
        );
      case "Info":
        return (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-200">
            Info
          </span>
        );
      case "Nav":
        return (
          <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium bg-purple-50 text-purple-700 border border-purple-200">
            Nav
          </span>
        );
    }
  };

  // Цветовая градация скора
  const renderScoreBadge = (score: number) => {
    let colorClass = "bg-emerald-50 text-emerald-700 border-emerald-200";
    if (score > 40 && score <= 70) {
      colorClass = "bg-amber-50 text-amber-700 border-amber-200";
    } else if (score > 70) {
      colorClass = "bg-rose-50 text-rose-700 border-rose-200";
    }

    return (
      <span
        className={cn(
          "inline-flex w-7 justify-center items-center rounded px-1 py-0.5 text-[11px] font-mono font-medium border tabular-nums",
          colorClass,
        )}
      >
        {score}
      </span>
    );
  };

  return (
    <div className="flex flex-col rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors">
      {/* Шапка кластера (Keyword Cluster Summary) */}
      {cluster && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
          <div className="flex items-center gap-2">
            <h2 className="text-[14px] font-semibold text-[#111111]">{cluster.name}</h2>
            <span className="inline-flex items-center rounded-[4px] bg-[#4a38f5] px-1.5 py-0.5 text-[11px] font-mono font-medium text-white tabular-nums">
              [{cluster.score}]
            </span>
          </div>

          <div className="flex items-center gap-4 text-xs font-mono tabular-nums text-[#666666]">
            <div>
              <span className="text-[#888888] font-sans mr-1">Vol</span>
              <span className="font-semibold text-[#111111]">{formatNumber(cluster.volume)}</span>
            </div>
            <div className="h-3 w-px bg-[#e5e5e5]" />
            <div>
              <span className="text-[#888888] font-sans mr-1">CPC</span>
              <span className="font-semibold text-[#111111]">${cluster.cpc.toFixed(2)}</span>
            </div>
            <div className="h-3 w-px bg-[#e5e5e5]" />
            <div>
              <span className="text-[#888888] font-sans mr-1">Comp</span>
              <span className="font-semibold text-[#111111]">{cluster.competition.toFixed(2)}</span>
            </div>
            <div className="h-3 w-px bg-[#e5e5e5]" />
            <div>{renderIntentBadge(cluster.intent)}</div>
          </div>
        </div>
      )}

      {/* Тулбар таблицы */}
      <div className="flex items-center justify-between border-b border-[#f0f0f0] px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              "flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] px-2.5 text-xs font-medium text-[#666666] transition-colors hover:border-[#cccccc] hover:text-[#111111]",
              showFilters && "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]",
            )}
          >
            <Filter className="h-3 w-3" />
            <span>Filters</span>
          </button>

          <span className="text-[#888888]">Showing {sortedKeywords.length} keywords</span>

          {selectedIds.size > 0 && (
            <span className="rounded bg-[#4a38f5]/10 px-2 py-0.5 text-[11px] font-medium text-[#4a38f5]">
              {selectedIds.size} selected
            </span>
          )}
        </div>

        {/* Экспорт */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowExport(!showExport)}
            className="flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors"
          >
            <Download className="h-3 w-3" />
            <span>Export</span>
            <ChevronDown className="h-3 w-3 ml-0.5" />
          </button>

          {showExport && (
            <div className="absolute right-0 top-8 z-20 w-44 rounded-[8px] border border-[#e5e5e5] bg-white py-1 shadow-md animate-in fade-in slide-in-from-top-1">
              <button
                type="button"
                onClick={handleExportCSV}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa]"
              >
                <Download className="h-3.5 w-3.5 text-[#666666]" />
                Export as CSV
              </button>
              <button
                type="button"
                onClick={handleCopy}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa]"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5 text-[#666666]" />}
                {copied ? "Copied to Clipboard" : "Copy to Clipboard"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Фильтры по интенту */}
      {showFilters && (
        <div className="flex items-center gap-2 border-b border-[#f0f0f0] bg-[#fbfbfb] px-4 py-2 text-xs">
          <span className="text-[#888888] font-medium">Intent:</span>
          {(["ALL", "Trans", "Comm", "Info", "Nav"] as const).map((intent) => (
            <button
              key={intent}
              type="button"
              onClick={() => setFilterIntent(intent)}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                filterIntent === intent
                  ? "bg-[#4a38f5] text-white font-medium"
                  : "bg-white border border-[#e5e5e5] text-[#666666] hover:text-[#111111]",
              )}
            >
              {intent === "ALL" ? "All" : intent}
            </button>
          ))}
        </div>
      )}

      {/* Таблица */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="h-8 border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium text-[#666666] uppercase tracking-wider select-none">
              <th className="w-8 px-3 text-center">
                <input
                  type="checkbox"
                  checked={sortedKeywords.length > 0 && selectedIds.size === sortedKeywords.length}
                  onChange={handleSelectAll}
                  className="rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]/20 cursor-pointer"
                />
              </th>
              <th
                className="px-3 py-1.5 cursor-pointer hover:text-[#111111]"
                onClick={() => toggleSort("keyword")}
              >
                <div className="flex items-center gap-1">
                  <span>Keyword</span>
                  {sortField === "keyword" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </div>
              </th>
              <th
                className="w-24 px-3 py-1.5 text-right cursor-pointer hover:text-[#111111]"
                onClick={() => toggleSort("volume")}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Volume</span>
                  {sortField === "volume" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </div>
              </th>
              <th
                className="w-20 px-3 py-1.5 text-right cursor-pointer hover:text-[#111111]"
                onClick={() => toggleSort("cpc")}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>CPC</span>
                  {sortField === "cpc" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </div>
              </th>
              <th
                className="w-20 px-3 py-1.5 text-right cursor-pointer hover:text-[#111111]"
                onClick={() => toggleSort("competition")}
              >
                <div className="flex items-center justify-end gap-1">
                  <span>Comp.</span>
                  {sortField === "competition" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </div>
              </th>
              <th
                className="w-16 px-3 py-1.5 text-center cursor-pointer hover:text-[#111111]"
                onClick={() => toggleSort("score")}
              >
                <div className="flex items-center justify-center gap-1">
                  <span>Score</span>
                  {sortField === "score" ? (
                    sortDirection === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 opacity-30" />
                  )}
                </div>
              </th>
              <th className="w-16 px-3 py-1.5 text-center">Intent</th>
              <th className="w-16 px-3 py-1.5 text-center">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0] text-[13px]">
            {sortedKeywords.map((kw) => {
              const isSelected = selectedIds.has(kw.id);
              const isActive = selectedKeywordId === kw.id;

              return (
                <tr
                  key={kw.id}
                  onClick={() => onSelectKeyword?.(kw)}
                  className={cn(
                    "h-8 transition-colors cursor-pointer",
                    isActive
                      ? "bg-[#4a38f5]/5 font-medium"
                      : isSelected
                        ? "bg-[#fafafa]"
                        : "hover:bg-black/[0.02]",
                  )}
                >
                  <td
                    className="w-8 px-3 text-center"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelectOne(kw.id);
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelectOne(kw.id)}
                      className="rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]/20 cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-1 text-[#111111] truncate max-w-[280px]">
                    {kw.keyword}
                  </td>
                  <td className="w-24 px-3 py-1 text-right font-mono text-xs tabular-nums text-[#111111]">
                    {formatNumber(kw.volume)}
                  </td>
                  <td className="w-20 px-3 py-1 text-right font-mono text-xs tabular-nums text-[#666666]">
                    ${kw.cpc.toFixed(2)}
                  </td>
                  <td className="w-20 px-3 py-1 text-right font-mono text-xs tabular-nums text-[#666666]">
                    {kw.competition.toFixed(2)}
                  </td>
                  <td className="w-16 px-3 py-1 text-center">
                    {renderScoreBadge(kw.score)}
                  </td>
                  <td className="w-16 px-3 py-1 text-center">
                    {renderIntentBadge(kw.intent)}
                  </td>
                  <td className="w-16 px-3 py-1 text-center">
                    <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-gray-100 text-gray-700">
                      {kw.source}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
