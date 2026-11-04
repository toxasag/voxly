"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BarChart2,
  Globe,
  Layers,
  Loader2,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useDeleteRecentSearch,
  useKeywordSearch,
  useRecentSearches,
} from "@/lib/api/use-seo-keywords";
import { KeywordSearchBar } from "@/components/marketing/seo/KeywordSearchBar";
import { RecentSearchesBar } from "@/components/marketing/seo/RecentSearchesBar";
import { KeywordMatrixTable } from "@/components/marketing/seo/KeywordMatrixTable";
import { KeywordTrendsChart } from "@/components/marketing/seo/KeywordTrendsChart";
import { SerpAnalysisList } from "@/components/marketing/seo/SerpAnalysisList";
import type { KeywordItem, RecentSearchItem } from "@/types/seo.types";

export default function SeoKeywordsPage() {
  const [query, setQuery] = useState("soundspeaker rent");
  const [country, setCountry] = useState("Thailand");
  const [location, setLocation] = useState("Phuket, Phuket, Tha");
  const [selectedKeyword, setSelectedKeyword] = useState<KeywordItem | null>(null);
  const [mobileTab, setMobileTab] = useState<"matrix" | "serp">("matrix");

  const searchMutation = useKeywordSearch();
  const { data: recentSearches = [], isLoading: isLoadingRecent } = useRecentSearches();
  const deleteRecentMutation = useDeleteRecentSearch();

  // Автоматический первичный поиск при открытии страницы
  useEffect(() => {
    searchMutation.mutate({
      query,
      country,
      location,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = (params: { query: string; country: string; location: string }) => {
    setQuery(params.query);
    setCountry(params.country);
    setLocation(params.location);
    setSelectedKeyword(null);

    searchMutation.mutate(params, {
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "Не удалось выполнить поиск ключевых слов");
      },
    });
  };

  const handleSelectRecent = (item: RecentSearchItem) => {
    setQuery(item.query);
    setCountry(item.country);
    setLocation(item.location);
    setSelectedKeyword(null);

    searchMutation.mutate({
      query: item.query,
      country: item.country,
      location: item.location,
    });
  };

  const handleDeleteRecent = (id: string) => {
    deleteRecentMutation.mutate(id);
  };

  const searchData = searchMutation.data;
  const isSearching = searchMutation.isPending;

  // Выбранный запрос для SERP: либо конкретный кликнутый ключ из таблицы, либо общий поисковый запрос
  const activeSerpQuery = selectedKeyword?.keyword || query;

  return (
    <div className="flex flex-col min-h-screen bg-[#ffffff] p-4 md:p-6 space-y-4">
      {/* Заголовок страницы и навигационный контекст */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-1">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-[#111111]">
              Keyword Research & SERP Analysis
            </h1>
            <span className="rounded-full bg-[#4a38f5]/10 px-2.5 py-0.5 text-xs font-medium text-[#4a38f5]">
              Intelligence
            </span>
          </div>
          <p className="text-xs text-[#666666] mt-0.5">
            Анализ поискового объема, CPC, конкуренции и органической выдачи по странам и городам
          </p>
        </div>

        {/* Индикатор кэша / статуса */}
        {searchData?.cached && (
          <div className="flex items-center gap-1.5 rounded-[6px] border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs text-emerald-800 self-start sm:self-auto">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>Cached in Redis (24h TTL)</span>
          </div>
        )}
      </div>

      {/* Шапка поиска (Keyword Search Bar) */}
      <KeywordSearchBar
        initialQuery={query}
        initialCountry={country}
        initialLocation={location}
        isLoading={isSearching}
        onSearch={handleSearch}
      />

      {/* Лента недавних запросов (Recent Search Pills) */}
      <RecentSearchesBar
        searches={recentSearches}
        activeQuery={query}
        activeLocation={location}
        onSelect={handleSelectRecent}
        onDelete={handleDeleteRecent}
      />

      {/* Мобильный переключатель вкладок (< lg) */}
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] pb-2 lg:hidden">
        <button
          type="button"
          onClick={() => setMobileTab("matrix")}
          className={cn(
            "flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors",
            mobileTab === "matrix"
              ? "bg-[#4a38f5] text-white"
              : "bg-[#f5f5f5] text-[#666666] hover:text-[#111111]",
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Keyword Matrix ({searchData?.keywords?.length || 0})</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileTab("serp")}
          className={cn(
            "flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors",
            mobileTab === "serp"
              ? "bg-[#4a38f5] text-white"
              : "bg-[#f5f5f5] text-[#666666] hover:text-[#111111]",
          )}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          <span>Trends & SERP</span>
        </button>
      </div>

      {/* Состояние загрузки первичного поиска */}
      {isSearching && !searchData && (
        <div className="flex flex-col items-center justify-center py-20 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
          <Loader2 className="h-8 w-8 animate-spin text-[#4a38f5]" />
          <p className="mt-3 text-xs font-medium text-[#666666]">
            Получение метрик поискового объема и SERP выдачи...
          </p>
        </div>
      )}

      {/* Основной двухколоночный лэйаут 1:1 со скриншотом */}
      {searchData && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* Левая колонка — Таблица ключевых слов (Keyword Matrix) */}
          <div
            className={cn(
              "lg:col-span-7 xl:col-span-8 space-y-4",
              mobileTab === "serp" ? "hidden lg:block" : "block",
            )}
          >
            <KeywordMatrixTable
              cluster={searchData.cluster}
              keywords={searchData.keywords}
              selectedKeywordId={selectedKeyword?.id}
              onSelectKeyword={(kw) => setSelectedKeyword(kw)}
            />
          </div>

          {/* Правая колонка — Аналитика спроса и выдачи (Analytics & SERP Insights) */}
          <div
            className={cn(
              "lg:col-span-5 xl:col-span-4 space-y-4",
              mobileTab === "matrix" ? "hidden lg:block" : "block",
            )}
          >
            {/* Блок 1: Search Trends (Recharts) */}
            <KeywordTrendsChart
              trends={searchData.trends}
              title={`Trends: ${query}`}
              rangeLabel="Dec 2025 - Nov 2026"
            />

            {/* Блок 2: SERP Analysis Top-10 */}
            <SerpAnalysisList
              serp={searchData.serp}
              query={activeSerpQuery}
            />
          </div>
        </div>
      )}
    </div>
  );
}
