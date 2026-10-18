"use client";

import { useMemo, useState } from "react";
import { CheckSquare, Clock, FileText, Handshake, Heart, Home, Mail, MoreHorizontal, Paperclip } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDeal } from "@/lib/api/use-deals";
import { dealTabContents, type DealStageInfo, type DealTabsContext } from "@/components/crm/deals/deal-tabs";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import { chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import type { PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Карточка сделки в боковой панели — Twenty CRM pixel-perfect drawer.
//
// Заголовок: монограмма-бейдж [W], название сделки, кнопка разворачивания,
// закрытие.
// Вкладки с иконками: Home, Timeline, Tasks, Notes, Files с активной линией.
// Нижний плавающий бар: меню «⋯», избранное «♡», кнопка «✉ Send Email».
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

function TabIcon({ id }: { id: string }) {
  switch (id) {
    case "home":
      return <Home className="h-3.5 w-3.5 shrink-0" />;
    case "chat":
      return <Clock className="h-3.5 w-3.5 shrink-0" />;
    case "tasks":
      return <CheckSquare className="h-3.5 w-3.5 shrink-0" />;
    case "notes":
      return <FileText className="h-3.5 w-3.5 shrink-0" />;
    case "files":
      return <Paperclip className="h-3.5 w-3.5 shrink-0" />;
    default:
      return null;
  }
}

export function DealDrawer({ dealId, open, onClose, onDelete, isDeleting = false, usersById, pipelines, stagesById }: DealDrawerProps) {
  const deal = useDeal(dealId);
  const [tab, setTab] = useState("home");
  const [isMaximized, setIsMaximized] = useState(false);

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

  const dealTitle = deal.data?.title ?? "Сделка";

  return (
    <Sheet open={open} onClose={onClose} resizable isMaximized={isMaximized}>
      <SheetHeader
        onClose={onClose}
        onDelete={onDelete === undefined || deal.data === undefined ? undefined : () => onDelete(deal.data!.id)}
        isDeleting={isDeleting}
        onToggleMaximize={() => setIsMaximized((prev) => !prev)}
        isMaximized={isMaximized}
      >
        {deal.isLoading ? (
          <Skeleton className="h-5 w-40" />
        ) : (
          <div className="flex items-center gap-2 min-w-0">
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] font-bold shadow-2xs",
                paletteFor(dealTitle),
              )}
            >
              {chipInitials(dealTitle)}
            </span>
            <h2 className="truncate text-sm font-semibold text-[#111111]">{dealTitle}</h2>
          </div>
        )}
      </SheetHeader>
      <SheetContent className="flex flex-col">
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
            <TabsList className="px-4 bg-white border-b border-[#e5e5e5] gap-1 shrink-0">
              {tabs.map((item) => (
                <TabsTrigger
                  key={item.id}
                  value={item.id}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium"
                >
                  <TabIcon id={item.id} />
                  <span>{item.label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
            {tabs.map((item) => (
              <TabsContent
                key={item.id}
                value={item.id}
                className={cn("mt-0 flex-1", item.id === "chat" ? "overflow-hidden" : "overflow-y-auto")}
              >
                {item.content}
              </TabsContent>
            ))}
          </Tabs>
        )}
      </SheetContent>

      {/* Sticky Bottom Actions Bar (Twenty CRM drawer footer) */}
      {deal.data !== undefined && (
        <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-[#e5e5e5] bg-white px-4 py-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Больше действий"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="В избранное"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
            >
              <Heart className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={() => setTab("chat")}
            className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#f5f5f5] transition-colors"
          >
            <Mail className="h-3.5 w-3.5 text-[#666666]" />
            <span>Send Email</span>
          </button>
        </div>
      )}
    </Sheet>
  );
}
