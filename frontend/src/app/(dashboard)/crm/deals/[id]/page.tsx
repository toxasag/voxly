"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Handshake } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { useDeal, useKanban, usePipelines } from "@/lib/api/use-deals";
import { useTenantUsers, indexTenantUsers } from "@/lib/api/use-tenant-users";
import { dealTabContents, type DealStageInfo, type DealTabsContext } from "@/components/crm/deals/deal-tabs";
import { PinnedPageTabs } from "@/components/crm/shared/PinnedPageTabs";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";

// ---------------------------------------------------------------------------
// Сделка по прямой ссылке.
//
// Точка входа для уведомлений (`NotificationDropdown`) и запасной ветки карточки
// канбана (`DealCard`) — поэтому адрес сохранён, удалять страницу нельзя.
//
// Содержимое то же, что в дровере (`deal-tabs.tsx`): у сделки один экран
// деталей. Состав/порядок вкладок — из `page_layout_tabs` через
// `useTabsRenderer`. Отличается только оболочка: здесь весь экран, в дровере
// панель справа.
// ---------------------------------------------------------------------------

function DealDetailContent() {
  const { id } = useParams<{ id: string }>();
  const deal = useDeal(id);
  const pipelines = usePipelines();
  const tenantUsers = useTenantUsers();
  const kanban = useKanban(deal.data?.pipelineId ?? null);

  const usersById = useMemo(() => indexTenantUsers(tenantUsers.data), [tenantUsers.data]);

  const stagesById = useMemo(() => {
    const map = new Map<string, DealStageInfo>();
    for (const column of kanban.data ?? []) {
      map.set(column.stageId, {
        name: column.stageName,
        colorKey: column.stageColor,
        isWon: column.isWon,
        isLost: column.isLost,
      });
    }
    return map;
  }, [kanban.data]);

  const context: DealTabsContext = useMemo(
    () => ({ usersById, pipelines: pipelines.data, stagesById }),
    [pipelines.data, stagesById, usersById],
  );
  const contents = useMemo(
    () => (deal.data !== undefined ? dealTabContents(deal.data, context) : {}),
    [context, deal.data],
  );
  const tabs = useTabsRenderer({ objectType: "deal", contents });

  if (deal.isLoading) return <SkeletonTable rows={5} columns={3} />;

  if (deal.isError) {
    return (
      <EmptyState
        icon={Handshake}
        title="Сделка не найдена"
        description={deal.error.message}
        action={
          <Link href="/crm/deals" className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300">
            Назад к воронке
          </Link>
        }
      />
    );
  }

  const currentDeal = deal.data;
  if (currentDeal === undefined) return null;

  return (
    <div className="-m-6 flex h-[calc(100vh-4rem)] flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-800 bg-slate-900 px-6 py-3">
        <Link href="/crm/deals" className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-slate-800">
          <ChevronLeft className="h-4 w-4" />
          Назад к воронке
        </Link>
        <h1 className="min-w-0 truncate text-sm font-semibold text-slate-100">{currentDeal.title}</h1>
      </div>

      <PinnedPageTabs
        tabs={tabs}
        overflowClassName={(id) =>
          id === "chat" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-y-auto"
        }
      />
    </div>
  );
}

export default function DealDetailPage() {
  return (
    <Guard
      requiredPermission="deals:read"
      fallback={
        <EmptyState
          icon={Handshake}
          title="Нет доступа к сделке"
          description="Запросите право deals:read у администратора."
        />
      }
    >
      <DealDetailContent />
    </Guard>
  );
}
