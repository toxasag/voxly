"use client";

import { useState } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RecordDetailTab } from "@/components/crm/shared/RecordDetailShell";
import { splitPinnedTabs } from "@/components/crm/shared/resolve-page-layout-tabs";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Раскладка вкладок полной страницы записи (пункт 29a).
//
// Twenty: на широком экране первая вкладка — колонка слева, остальные в ряду
// справа. На мобильном закрепления нет. Структура на CSS (`md:`), не на хуке.
// Содержимое «Главной» монтируется один раз: CSS двигает его в колонку на
// десктопе и в поток на телефоне — две копии ломали бы хуки внутри вкладки.
// ---------------------------------------------------------------------------

interface PinnedPageTabsProps {
  tabs: readonly RecordDetailTab[];
  defaultTab?: string;
  overflowClassName?: (tabId: string) => string;
}

export function PinnedPageTabs({
  tabs,
  defaultTab,
  overflowClassName,
}: PinnedPageTabsProps) {
  const { pinned, rest } = splitPinnedTabs(tabs);
  const overflow = overflowClassName ?? (() => "min-h-0 flex-1 overflow-y-auto");
  const [tab, setTab] = useState(defaultTab ?? pinned?.id ?? "");

  if (pinned === undefined) return null;

  const all = [pinned, ...rest];
  const activeId = all.some((item) => item.id === tab) ? tab : pinned.id;
  const restActive = rest.some((item) => item.id === activeId);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div
        className={cn(
          "min-h-0 overflow-y-auto",
          restActive && "hidden md:block",
          "md:w-[320px] md:shrink-0 md:border-r md:border-slate-800",
        )}
      >
        {pinned.content}
      </div>

      <Tabs
        value={activeId}
        onValueChange={setTab}
        className="flex min-h-0 min-w-0 flex-1 flex-col"
      >
        <TabsList className="shrink-0 overflow-x-auto px-4 pt-2 md:px-6">
          <TabsTrigger value={pinned.id} className="md:hidden">
            {pinned.label}
          </TabsTrigger>
          {rest.map((item) => (
            <TabsTrigger key={item.id} value={item.id}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
        {rest.map((item) => (
          <TabsContent
            key={item.id}
            value={item.id}
            className={cn("mx-auto h-full w-full max-w-3xl", overflow(item.id))}
          >
            {item.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
