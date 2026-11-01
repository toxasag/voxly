"use client";

import { memo, useMemo } from "react";
import { Search, Building2, Wrench, Receipt, BellRing, AlertCircle, Settings, Trash2 } from "lucide-react";
import type { PlatformTenant } from "@/lib/admin/admin.types";
import { getPlanLabel, getStatusLabel } from "@/lib/admin/admin.types";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { cn } from "@/lib/utils";

interface TenantsTableProps {
  tenants: PlatformTenant[];
  searchQuery: string;
  onSearchChange: (query: string) => void;
  filterStatus: "all" | "active" | "trial" | "expired" | "suspended";
  onFilterStatusChange: (status: "all" | "active" | "trial" | "expired" | "suspended") => void;
  onManage: (tenant: PlatformTenant) => void;
  onDelete?: (tenant: PlatformTenant) => void;
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

function tenantPlanColor(plan: string): TagColor {
  switch (plan) {
    case "enterprise":
      return "amber";
    case "pro":
      return "violet";
    case "starter":
      return "sky";
    default:
      return "slate";
  }
}

function tenantStatusColor(status: string): TagColor {
  switch (status) {
    case "active":
      return "emerald";
    case "trial":
      return "cyan";
    case "expired":
    case "suspended":
      return "rose";
    default:
      return "slate";
  }
}

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
  onDelete,
  isLoading,
  isError,
  error,
  onRetry,
}: TenantsTableProps) {
  const columns = useMemo<RecordColumn<PlatformTenant>[]>(
    () => [
      {
        id: "company",
        header: "Компания",
        width: 220,
        sortValue: (t) => t.company_name,
        render: (t) => (
          <RecordCellShell isLabelIdentifier>
            <div className="truncate text-xs">
              <span className="font-medium text-[#111111]">{t.company_name}</span>
              <span className="ml-1.5 text-[#888888]">{t.slug}.getvoxly.ru</span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "owner",
        header: "Владелец",
        width: 180,
        sortValue: (t) => t.owner_name,
        render: (t) => (
          <RecordCellShell>
            <div className="truncate text-xs">
              <span className="text-[#111111]">{t.owner_name}</span>
              <span className="ml-1 text-[#888888]">({t.owner_email})</span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "registered",
        header: "Регистрация",
        width: 104,
        sortValue: (t) => t.registered_at,
        render: (t) => (
          <RecordCellShell>
            <span className="text-xs text-[#666666]">{formatDate(t.registered_at)}</span>
          </RecordCellShell>
        ),
      },
      {
        id: "plan",
        header: "Тариф",
        width: 104,
        sortValue: (t) => t.plan,
        render: (t) => (
          <RecordCellShell>
            <TagPill color={tenantPlanColor(t.plan)}>
              {getPlanLabel(t.plan)}
            </TagPill>
          </RecordCellShell>
        ),
      },
      {
        id: "status",
        header: "Статус",
        width: 110,
        sortValue: (t) => t.status,
        render: (t) => (
          <RecordCellShell>
            <TagPill color={tenantStatusColor(t.status)}>
              {getStatusLabel(t.status)}
            </TagPill>
          </RecordCellShell>
        ),
      },
      {
        id: "modules",
        header: "Модули",
        width: 150,
        render: (t) => (
          <RecordCellShell>
            <div className="flex items-center gap-1 flex-wrap">
              {t.installed_modules.length === 0 && <span className="text-xs text-[#888888]">Нет</span>}
              {t.installed_modules.map((mod) => {
                const Icon = MODULE_ICONS[mod];
                return (
                  <span
                    key={mod}
                    className="inline-flex items-center gap-1 rounded bg-[#f5f5f5] px-1.5 py-0.5 text-[10px] font-medium text-[#666666] border border-[#e5e5e5]"
                  >
                    {Icon && <Icon className="h-2.5 w-2.5 text-[#888888]" />}
                    {mod === "service_center" ? "SC" : mod === "finance" ? "FIN" : mod === "ai_bots" ? "AI" : mod}
                  </span>
                );
              })}
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "revenue",
        header: "Выручка",
        width: 130,
        align: "right",
        sortValue: (t) => t.total_revenue,
        render: (t) => (
          <RecordCellShell align="right">
            <span className="font-mono text-xs font-medium text-[#111111]">
              {formatRevenue(t.total_revenue)}
            </span>
          </RecordCellShell>
        ),
      },
      {
        id: "actions",
        header: "",
        width: 80,
        render: (t) => (
          <RecordCellShell>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onManage(t);
                }}
                className="rounded p-1 text-[#888888] hover:text-[#111111] hover:bg-black/[0.04] transition-colors"
                title="Управление"
              >
                <Settings className="h-3.5 w-3.5" />
              </button>
              {onDelete && t.slug !== "voxly" && t.slug !== "platform" && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t);
                  }}
                  className="rounded p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors"
                  title="Удалить компанию"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </RecordCellShell>
        ),
      },
    ],
    [onManage, onDelete],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-xs text-[#888888] animate-pulse">Загрузка...</div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUSES.map((s) => (
              <div key={s.value} className="rounded-[8px] border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#888888] bg-white">{s.label}</div>
            ))}
          </div>
        </div>
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-4">
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 w-full bg-[#f5f5f5] rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500" />
        <div>
          <p className="text-xs font-medium text-rose-600">Не удалось загрузить тенантов</p>
          <p className="text-xs text-[#888888] mt-1">{error?.message ?? "Unknown error"}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 rounded-[6px] bg-[#f5f5f5] px-3 py-1.5 text-xs text-[#111111] hover:bg-[#ebebeb] transition-colors">
              Повторить
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Поиск по компании или владельцу..."
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          />
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => onFilterStatusChange(s.value)}
              className={cn(
                "rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                filterStatus === s.value
                  ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[#888888]">{tenants.length} tenants</span>
      </div>

      <RecordTable
        rows={tenants}
        columns={columns}
        getRowId={(t) => t.id}
        tableId="admin_tenants"
        emptyState={
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Building2 className="h-8 w-8 text-[#888888]" />
            <p className="text-xs text-[#666666]">Компании не найдены</p>
          </div>
        }
      />
    </div>
  );
});