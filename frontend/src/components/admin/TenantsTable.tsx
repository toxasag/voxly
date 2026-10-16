"use client";

import { memo } from "react";
import { Search, Building2, Users, Wrench, Receipt, BellRing, Loader2, AlertCircle } from "lucide-react";
import type { PlatformTenant } from "@/lib/admin/admin.types";
import { getPlanLabel, getPlanColors, getStatusLabel, getStatusColors } from "@/lib/admin/admin.types";
import { cn } from "@/lib/utils";

interface TenantsTableProps {
  tenants: PlatformTenant[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: "all" | "active" | "trial" | "expired" | "suspended";
  onFilterStatusChange: (status: "all" | "active" | "trial" | "expired" | "suspended") => void;
  onManage: (tenant: PlatformTenant) => void;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
  onRetry?: () => void;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).format(new Date(iso));
}

function formatRevenue(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

const MODULE_ICONS: Record<string, typeof Wrench> = {
  service_center: Wrench,
  finance: Receipt,
  ai_bots: BellRing,
};

const MODULE_COLORS: Record<string, string> = {
  service_center: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  finance: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  ai_bots: "bg-violet-500/10 text-violet-400 border-violet-500/20",
};

const STATUSES = [
  { value: "all" as const, label: "Все" },
  { value: "active" as const, label: "Активен" },
  { value: "trial" as const, label: "Пробный" },
  { value: "expired" as const, label: "Просрочен" },
  { value: "suspended" as const, label: "Приостановлен" },
];

export const TenantsTable = memo(function TenantsTable({
  tenants,
  searchQuery,
  onSearchChange,
  filterStatus,
  onFilterStatusChange,
  onManage,
  isLoading,
  isError,
  error,
  onRetry,
}: TenantsTableProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-500 animate-pulse">Загрузка...</div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {["all", "active", "trial", "expired", "suspended"].map((s) => (
              <div key={s} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-900/50">{s}</div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
          <div className="divide-y divide-slate-800">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-4 py-3.5 flex items-center gap-4">
                <div className="h-4 w-32 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-40 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 w-20 bg-slate-800 rounded animate-pulse" />
                <div className="h-4 flex-1 bg-slate-800 rounded animate-pulse" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-400" />
        <div>
          <p className="text-sm font-medium text-rose-400">Не удалось загрузить тенантов</p>
          <p className="text-xs text-slate-500 mt-1">{error?.message ?? "Unknown error"}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700">
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по компании или владельцу..."
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onFilterStatusChange(s.value)}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                filterStatus === s.value
                  ? "border-amber-500 bg-amber-500/10 text-amber-400"
                  : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-slate-600">{tenants.length} tenants</span>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Компания</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Владелец</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[85px]">Регистрация</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[95px]">Тариф</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[85px]">Статус</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Модули</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-[110px]">Выручка</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[48px]"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tenants.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Building2 className="h-8 w-8 text-slate-700" />
                      <p className="text-sm text-slate-600">Компании не найдены</p>
                    </div>
                  </td>
                </tr>
              )}
              {tenants.map((t) => (
                <tr key={t.id} className="transition-colors hover:bg-slate-800/50">
                  <td className="px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-slate-200">{t.company_name}</p>
                      <p className="text-xs text-slate-500">{t.slug}.getvoxly.ru</p>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <div>
                      <p className="text-sm text-slate-300">{t.owner_name}</p>
                      <p className="text-xs text-slate-500">{t.owner_email}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-xs text-slate-400">{formatDate(t.registered_at)}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", getPlanColors(t.plan))}>
                      {getPlanLabel(t.plan)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", getStatusColors(t.status))}>
                      {getStatusLabel(t.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1 flex-wrap">
                      {t.installed_modules.length === 0 && <span className="text-xs text-slate-600">Нет</span>}
                      {t.installed_modules.map((mod) => {
                        const Icon = MODULE_ICONS[mod];
                        return (
                          <span key={mod} className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", MODULE_COLORS[mod] ?? "bg-slate-800 text-slate-400")}>
                            {Icon && <Icon className="h-2.5 w-2.5" />}
                            {mod === "service_center" ? "SC" : mod === "finance" ? "FIN" : mod === "ai_bots" ? "AI" : mod}
                          </span>
                        );
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-semibold text-slate-200">{formatRevenue(t.total_revenue)}</span>
                    <span className="block text-xs text-slate-600">{t.active_users} users</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => onManage(t)}
                      className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs font-medium text-slate-400 hover:border-slate-600 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                    >
                      Manage
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
});