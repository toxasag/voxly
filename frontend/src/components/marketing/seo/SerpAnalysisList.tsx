"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Globe,
} from "lucide-react";
import type { SerpOrganicResult } from "@/types/seo.types";

export interface SerpAnalysisListProps {
  serp?: SerpOrganicResult[];
  query?: string;
}

export function SerpAnalysisList({ serp = [], query = "soundspeaker rent" }: SerpAnalysisListProps) {
  const [showExport, setShowExport] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleExportCSV = () => {
    const header = "Position,Title,Domain,URL,Snippet\n";
    const rows = serp
      .map(
        (item) =>
          `${item.position},"${item.title.replace(/"/g, '""')}","${item.domain}","${item.url}","${(item.snippet || "").replace(/"/g, '""')}"`,
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `serp-${query.replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setShowExport(false);
  };

  const handleCopy = () => {
    const text = serp.map((item) => `${item.position}. ${item.title} (${item.url})`).join("\n");
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowExport(false);
  };

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs transition-colors">
      {/* Шапка SERP анализа */}
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
        <div className="truncate pr-2">
          <div className="flex items-center gap-1.5">
            <Globe className="h-3.5 w-3.5 text-[#4a38f5]" />
            <h3 className="text-[13px] font-semibold text-[#111111]">SERP Analysis</h3>
          </div>
          <p className="text-[11px] text-[#666666] truncate max-w-[260px]">
            Target query: <span className="font-medium text-[#111111]">"{query}"</span>
          </p>
        </div>

        {/* Экспорт выпадающий список */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowExport(!showExport)}
            className="flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#666666] hover:border-[#cccccc] hover:text-[#111111] transition-colors"
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

      {/* Список результатов ТОП-10 */}
      <div className="divide-y divide-[#f0f0f0] max-h-[460px] overflow-y-auto">
        {serp.length === 0 ? (
          <div className="p-6 text-center text-xs text-[#888888]">
            No organic SERP results found for this query
          </div>
        ) : (
          serp.map((item) => (
            <div
              key={item.position}
              className="flex items-start gap-3 p-3 transition-colors hover:bg-[#fafafa] group"
            >
              {/* Номер позиции */}
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] font-mono text-[11px] font-semibold text-[#666666]">
                {item.position}
              </div>

              {/* Контент ссылки */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="truncate text-[13px] font-medium text-[#111111] hover:text-[#4a38f5] hover:underline transition-colors"
                  >
                    {item.title}
                  </a>
                  <ExternalLink className="h-3 w-3 shrink-0 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                <div className="text-[11px] font-mono text-emerald-700 truncate mt-0.5">
                  {item.domain}
                </div>

                {item.snippet && (
                  <p className="text-[11px] text-[#666666] line-clamp-2 mt-1 leading-relaxed">
                    {item.snippet}
                  </p>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
