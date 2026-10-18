"use client";

import { Activity, Database, RefreshCw, Users } from "lucide-react";
import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import { useAdminMetrics } from "@/lib/api/use-admin";
import { Skeleton } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${minutes} мин`;
  return `${minutes} мин`;
}

function Tile({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: string;
}) {
  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
      <p className="text-xs uppercase tracking-wider text-[#666666]">{label}</p>
      <p className={cn("mt-2 text-2xl font-bold text-[#111111]", accent)}>{value}</p>
    </div>
  );
}

export default function AdminMetricsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useAdminMetrics();

  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Метрики системы</h1>
            <p className="mt-1 text-sm text-[#666666]">
              Агрегированные показатели по всем арендаторам платформы
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Обновить
          </button>
        </div>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <p className="text-sm text-rose-400">Не удалось загрузить метрики: {error?.message}</p>
          </div>
        ) : data === undefined ? null : (
          <>
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Users className="h-4 w-4 text-[#4a38f5]" />
                Арендаторы и данные
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Tile label="Всего компаний" value={data.counts.tenants_total} />
                <Tile
                  label="Активных"
                  value={data.counts.tenants_active}
                  accent="text-emerald-400"
                />
                <Tile label="Пробных" value={data.counts.tenants_trial} accent="text-yellow-400" />
                <Tile
                  label="Приостановлено"
                  value={data.counts.tenants_suspended}
                  accent="text-rose-400"
                />
                <Tile label="Пользователей" value={data.counts.users_total} />
                <Tile label="Контактов" value={data.counts.contacts_total} />
                <Tile label="Сделок" value={data.counts.deals_total} />
                <Tile label="Наряд-заказов" value={data.counts.repair_orders_total} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Database className="h-4 w-4 text-[#4a38f5]" />
                База данных
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <Tile label="Размер БД" value={formatBytes(data.database.size_bytes)} />
                <Tile label="Соединений" value={data.database.connections} />
                <Tile label="Uptime" value={formatUptime(data.database.uptime_seconds)} />
              </div>
            </section>

            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-[#111111]">
                <Activity className="h-4 w-4 text-[#4a38f5]" />
                Очередь задач
              </h2>
              {/*
                Очередь честно помечена как отсутствующая: Redis/BullMQ в стек не
                развёрнуты, и показывать нули как «всё в порядке» вводило бы в
                заблуждение.
              */}
              {data.queue.implemented ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Tile label="В обработке" value={data.queue.pending} />
                  <Tile label="Ошибок" value={data.queue.failed} accent="text-rose-600 font-medium" />
                </div>
              ) : (
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs">
                  <p className="text-sm text-[#666666]">
                    Очередь задач не развёрнута: Redis и BullMQ пока не входят в стек, поэтому
                    фоновые задания (уведомления, экспорт, напоминания по счетам) не выполняются.
                  </p>
                </div>
              )}
            </section>

            <p className="text-xs text-[#888888]">
              Данные на{" "}
              {new Intl.DateTimeFormat("ru-RU", {
                dateStyle: "medium",
                timeStyle: "medium",
              }).format(new Date(data.generated_at))}
            </p>
          </>
        )}
      </div>
    </PlatformOwnerGuard>
  );
}
