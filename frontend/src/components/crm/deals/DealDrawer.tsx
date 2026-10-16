"use client";

import { useMemo, useState } from "react";
import { Handshake } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDeal } from "@/lib/api/use-deals";
import { dealTabContents, type DealStageInfo, type DealTabsContext } from "@/components/crm/deals/deal-tabs";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import type { PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";

// ---------------------------------------------------------------------------
// Карточка сделки в боковой панели — открывается из таблицы и канбана.
//
// Содержимое вкладок лежит в `deal-tabs.tsx` и общее со страницей
// `/crm/deals/[id]`. Состав/порядок приходят из `page_layout_tabs` через
// `useTabsRenderer`. Здесь остаётся только оболочка панели.
// ---------------------------------------------------------------------------

export type DrawerStageInfo = DealStageInfo;

interface DealDrawerProps {
  dealId: string | null;
  open: boolean;
  onClose: () => void;
  onDelete?: (dealId: string) => void;
  isDeleting?: boolean;
  usersById: Map<string, TenantUserDTO>;
  pipelines?: PipelineDTO[];
  stagesById?: Map<string, DealStageInfo>;
}

export function DealDrawer({ dealId, open, onClose, onDelete, isDeleting = false, usersById, pipelines, stagesById }: DealDrawerProps) {
  const deal = useDeal(dealId);
  const [tab, setTab] = useState("home");
  const context: DealTabsContext = useMemo(
    () => ({ usersById, pipelines, stagesById }),
    [pipelines, stagesById, usersById],
  );
  const contents = useMemo(
    () => (deal.data !== undefined ? dealTabContents(deal.data, context) : {}),
    [context, deal.data],
  );
  const tabs = useTabsRenderer({ objectType: "deal", contents });

  if (!dealId) return null;

  return (
    <Sheet open={open} onClose={onClose} resizable>
      <SheetHeader
        onClose={onClose}
        onDelete={onDelete === undefined || deal.data === undefined ? undefined : () => onDelete(deal.data!.id)}
        isDeleting={isDeleting}
      >
        {deal.isLoading ? <Skeleton className="h-5 w-40" /> : <h2 className="text-sm font-semibold text-slate-100">{deal.data?.title ?? "Сделка"}</h2>}
      </SheetHeader>
      <SheetContent>
        {deal.isLoading ? (
          <div className="space-y-3 p-5">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : deal.isError || !deal.data ? (
          <div className="p-5">
            <EmptyState icon={Handshake} title="Сделка не найдена" description={deal.error?.message ?? "Ошибка загрузки"} />
          </div>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="flex h-full flex-col">
            <TabsList className="px-5 pt-2">
              {tabs.map((item) => (
                <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((item) => (
              <TabsContent
                key={item.id}
                value={item.id}
                className={item.id === "chat" ? "flex-1 overflow-hidden" : "flex-1 overflow-y-auto"}
              >
                {item.content}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
