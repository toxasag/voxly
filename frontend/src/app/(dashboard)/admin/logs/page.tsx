"use client";

import { useState } from "react";
import { Info, RefreshCw, ScrollText, Search } from "lucide-react";
import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import { useAdminLogs } from "@/lib/api/use-admin";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

export default function AdminLogsPage() {
  const [page, setPage] = useState(0);
  const [action, setAction] = useState("");

  const { data, isLoading, isError, error, refetch, isFetching } = useAdminLogs({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
    ...(action.trim().length > 0 && { action: action.trim() }),
  });

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-100">Системные логи</h1>
            <p className="mt-1 text-sm text-slate-400">
              Аудит действий по всем арендаторам платформы
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-300 transition-colors hover:border-slate-600 disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Обновить
          </button>
        </div>

        {/*
          Честная оговорка о содержимом: здесь аудит действий, а не поток stdout
          приложения. Логи pino пишутся в контейнер, агрегатора нет.
        */}
        <div className="flex items-start gap-3 rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
          <p className="text-sm text-slate-400">
            Раздел показывает журнал действий (изменения арендаторов, установка модулей). Логи
            приложения пишутся в stdout контейнера и здесь недоступны — для них нужен внешний
            сборщик.
          </p>
        </div>

        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            type="search"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(0);
            }}
            placeholder="Фильтр по действию, например module.install"
            aria-label="Фильтр по действию"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 py-2.5 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          />
        </div>

        {isLoading ? (
          <SkeletonTable rows={8} columns={5} />
        ) : isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
            <p className="text-sm text-rose-400">Не удалось загрузить логи: {error?.message}</p>
          </div>
        ) : data === undefined || data.items.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={action.length > 0 ? "Ничего не найдено" : "Записей пока нет"}
            description={
              action.length > 0
                ? "Измените фильтр по действию."
                : "Действия появятся здесь по мере работы арендаторов."
            }
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-4 py-3 font-medium">Время</th>
                    <th className="px-4 py-3 font-medium">Компания</th>
                    <th className="px-4 py-3 font-medium">Пользователь</th>
                    <th className="px-4 py-3 font-medium">Действие</th>
                    <th className="px-4 py-3 font-medium">Объект</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-slate-800 transition-colors last:border-0 hover:bg-slate-800/50"
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-slate-400">
                        {formatDateTime(log.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-slate-200">{log.tenantName ?? "—"}</td>
                      <td className="px-4 py-3 text-slate-400">{log.actorEmail ?? "система"}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-xs text-orange-400">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {log.entityType}
                        {log.entityId !== null && (
                          <span className="ml-1 font-mono text-xs text-slate-500">
                            {log.entityId.slice(0, 12)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between text-sm text-slate-400">
              <span>
                {total} записей · страница {page + 1} из {pages}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs transition-colors hover:border-slate-600 disabled:opacity-40"
                >
                  Назад
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page + 1 >= pages}
                  className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs transition-colors hover:border-slate-600 disabled:opacity-40"
                >
                  Вперёд
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </PlatformOwnerGuard>
  );
}
