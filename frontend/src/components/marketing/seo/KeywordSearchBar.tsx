"use client";

import { useState } from "react";
import {
  Globe,
  Loader2,
  MapPin,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface KeywordSearchBarProps {
  initialQuery?: string;
  initialCountry?: string;
  initialLocation?: string;
  isLoading?: boolean;
  onSearch: (params: { query: string; country: string; location: string }) => void;
}

const COUNTRIES = [
  { code: "TH", name: "Thailand", flag: "🇹🇭" },
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "RU", name: "Russia", flag: "🇷🇺" },
];

export function KeywordSearchBar({
  initialQuery = "soundspeaker rent",
  initialCountry = "Thailand",
  initialLocation = "Phuket, Phuket, Tha",
  isLoading = false,
  onSearch,
}: KeywordSearchBarProps) {
  const [query, setQuery] = useState(initialQuery);
  const [country, setCountry] = useState(initialCountry);
  const [location, setLocation] = useState(initialLocation);
  const [showOptions, setShowOptions] = useState(false);
  const [currency, setCurrency] = useState("USD");
  const [language, setLanguage] = useState("en");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    onSearch({ query: query.trim(), country, location });
  };

  return (
    <div className="space-y-2">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-[8px] border border-[#e5e5e5] bg-white p-2 shadow-2xs md:flex-row md:items-center transition-colors"
      >
        {/* Поисковая фраза + подсказка */}
        <div className="relative flex-1">
          <div className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#888888]">
            <Search className="h-4 w-4" />
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keyword (e.g. soundspeaker rent)..."
            className={cn(
              "h-10 w-full rounded-[6px] bg-transparent pl-9 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888]",
              "focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/30",
            )}
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden lg:block text-[11px] text-[#888888] tabular-nums">
            Local volume adds ~$0.09 per search
          </div>
        </div>

        <div className="h-6 w-px bg-[#e5e5e5] hidden md:block" />

        {/* Дропдаун страны */}
        <div className="relative flex items-center">
          <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
          <select
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className={cn(
              "h-10 rounded-[6px] border-0 bg-transparent pl-8 pr-6 text-[13px] font-medium text-[#111111] cursor-pointer",
              "focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/30",
            )}
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.name}>
                Country: {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="h-6 w-px bg-[#e5e5e5] hidden md:block" />

        {/* Селектор локации/города */}
        <div className="relative flex items-center md:max-w-[200px]">
          <MapPin className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="City / Region"
            className={cn(
              "h-10 w-full rounded-[6px] bg-transparent pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888]",
              "focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/30",
            )}
          />
        </div>

        {/* Кнопки Options и Search */}
        <div className="flex items-center gap-1.5 pt-1 md:pt-0">
          <button
            type="button"
            onClick={() => setShowOptions(!showOptions)}
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] px-3 text-[13px] font-medium text-[#666666] transition-colors",
              "hover:border-[#cccccc] hover:bg-[#fafafa] hover:text-[#111111]",
              showOptions && "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]",
            )}
            title="Search Options"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Options</span>
          </button>

          <button
            type="submit"
            disabled={isLoading || !query.trim()}
            className={cn(
              "flex h-9 items-center justify-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-2xs transition-colors",
              "hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {isLoading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <Search className="h-3.5 w-3.5" />
                <span>Search</span>
              </>
            )}
          </button>
        </div>
      </form>

      {/* Выпадающая панель дополнительных настроек поиска */}
      {showOptions && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 shadow-sm transition-all animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
            <span className="text-xs font-semibold text-[#111111]">Advanced Search Parameters</span>
            <button
              type="button"
              onClick={() => setShowOptions(false)}
              className="rounded p-1 text-[#888888] hover:bg-[#f5f5f5] hover:text-[#111111]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 pt-3 sm:grid-cols-3">
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">Currency</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5]"
              >
                <option value="USD">USD ($) - US Dollar</option>
                <option value="EUR">EUR (€) - Euro</option>
                <option value="THB">THB (฿) - Thai Baht</option>
                <option value="RUB">RUB (₽) - Russian Ruble</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5]"
              >
                <option value="en">English (en)</option>
                <option value="th">Thai (th)</option>
                <option value="ru">Russian (ru)</option>
                <option value="de">German (de)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">Data Provider</label>
              <div className="flex h-8 items-center rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2 text-xs text-[#666666]">
                Google Organic SERP (v4)
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
