"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Clock, FileText, Handshake, Heart, Home, Mail, MoreHorizontal, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { useDeal, useDeleteDeal, useUpdateDeal } from "@/lib/api/use-deals";
import { dealTabContents, type DealStageInfo, type DealTabsContext } from "@/components/crm/deals/deal-tabs";
import { useTabsRenderer } from "@/components/crm/shared/TabsRenderer";
import { chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { DrawerCreateCompany } from "@/components/crm/deals/DrawerCreateCompany";
import { DrawerCreateContact } from "@/components/crm/deals/DrawerCreateContact";
import type { PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
  const router = useRouter();
  const deal = useDeal(dealId);
  const [tab, setTab] = useState("home");
  const [isMaximized, setIsMaximized] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleVal, setTitleVal] = useState("");
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [cardView, setCardView] = useState<"deal" | "create_company" | "create_contact">("deal");

  const updateDeal = useUpdateDeal();
  const deleteDeal = useDeleteDeal();

  useEffect(() => {
    setCardView("deal");
  }, [dealId, open]);

  const handleExpand = () => {
    if (deal.data) {
      onClose();
      router.push(`/crm/deals/${deal.data.id}`);
    }
  };

  const context: DealTabsContext = useMemo(
    () => ({
      usersById,
      pipelines,
      stagesById,
      onRequestCreateCompany: () => setCardView("create_company"),
      onRequestCreateContact: () => setCardView("create_contact"),
    }),
    [pipelines, stagesById, usersById],
  );
  const contents = useMemo(
    () => (deal.data !== undefined ? dealTabContents(deal.data, context) : {}),
    [context, deal.data],
  );
  const tabs = useTabsRenderer({ objectType: "deal", contents });

  if (!dealId) return null;

  const dealTitle = deal.data?.title ?? "Сделка";

  const saveTitle = () => {
    const trimmed = titleVal.trim();
    if (trimmed && trimmed !== dealTitle && deal.data) {
      updateDeal.mutate(
        { id: deal.data.id, pipelineId: deal.data.pipelineId, payload: { title: trimmed } },
        {
          onSuccess: () => toast.success("Название обновлено"),
          onError: (err) => toast.error(err.message || "Ошибка"),
        },
      );
    }
    setIsEditingTitle(false);
  };

  const handleDelete = () => {
    setMoreMenuOpen(false);
    if (!deal.data) return;
    if (confirm("Вы уверены, что хотите удалить эту сделку?")) {
      if (onDelete) {
        onDelete(deal.data.id);
      } else {
        deleteDeal.mutate(deal.data.id, {
          onSuccess: () => {
            toast.success("Сделка удалена");
            onClose();
          },
          onError: (err) => {
            toast.error(err.message || "Ошибка удаления сделки");
          },
        });
      }
    }
  };

  return (
    <Sheet open={open} onClose={onClose} resizable isMaximized={isMaximized}>
      {cardView === "create_company" && deal.data ? (
        <DrawerCreateCompany
          deal={deal.data}
          dealId={deal.data.id}
          dealTitle={deal.data.title}
          onBack={() => setCardView("deal")}
          onClose={onClose}
          onCreated={({ id }) => {
            updateDeal.mutate({
              id: deal.data!.id,
              pipelineId: deal.data!.pipelineId,
              payload: { company_id: id },
            });
            setCardView("deal");
          }}
          onSuccess={(id) => {
            updateDeal.mutate({
              id: deal.data!.id,
              pipelineId: deal.data!.pipelineId,
              payload: { company_id: id },
            });
            setCardView("deal");
          }}
          onExpand={handleExpand}
        />
      ) : cardView === "create_contact" && deal.data ? (
        <DrawerCreateContact
          deal={deal.data}
          dealId={deal.data.id}
          dealTitle={deal.data.title}
          onBack={() => setCardView("deal")}
          onClose={onClose}
          onCreated={({ id }) => {
            updateDeal.mutate({
              id: deal.data!.id,
              pipelineId: deal.data!.pipelineId,
              payload: { contact_id: id },
            });
            setCardView("deal");
          }}
          onSuccess={(id) => {
            updateDeal.mutate({
              id: deal.data!.id,
              pipelineId: deal.data!.pipelineId,
              payload: { contact_id: id },
            });
            setCardView("deal");
          }}
          onExpand={handleExpand}
        />
      ) : (
        <>
          <SheetHeader
            onClose={onClose}
            onDelete={onDelete === undefined || deal.data === undefined ? undefined : () => onDelete(deal.data!.id)}
            isDeleting={isDeleting || deleteDeal.isPending}
            onToggleMaximize={handleExpand}
            isMaximized={isMaximized}
          >
            {deal.isLoading ? (
              <Skeleton className="h-5 w-40" />
            ) : (
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border text-[10px] font-bold shadow-2xs",
                    paletteFor(dealTitle),
                  )}
                >
                  {chipInitials(dealTitle)}
                </span>
                {isEditingTitle ? (
                  <input
                    type="text"
                    value={titleVal}
                    onChange={(e) => setTitleVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveTitle();
                      } else if (e.key === "Escape") {
                        setIsEditingTitle(false);
                      }
                    }}
                    onBlur={saveTitle}
                    title="Название сделки"
                    className="rounded-[4px] border border-[#3b82f6] px-1.5 py-0.5 text-sm font-semibold text-[#111111] outline-none bg-white min-w-0 w-full"
                    autoFocus
                  />
                ) : (
                  <div className="flex items-center gap-1.5 min-w-0 group/title">
                    <h2
                      onClick={() => {
                        setIsEditingTitle(true);
                        setTitleVal(dealTitle);
                      }}
                      title="Нажмите для редактирования названия"
                      className="truncate text-sm font-semibold text-[#111111] cursor-pointer hover:underline"
                    >
                      {dealTitle}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingTitle(true);
                        setTitleVal(dealTitle);
                      }}
                      className="text-[#999999] opacity-0 group-hover/title:opacity-100 hover:text-[#111111] transition-opacity cursor-pointer"
                      aria-label="Редактировать название"
                      title="Редактировать название"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
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
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer"
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
              <div className="relative flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Больше действий"
                  title="Больше действий"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>

                {moreMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30 cursor-default" onClick={() => setMoreMenuOpen(false)} />
                    <div className="absolute bottom-full left-0 z-40 mb-1 w-48 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-xl">
                      <button
                        type="button"
                        onClick={handleDelete}
                        title="Удалить сделку"
                        className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-50 transition-colors text-left cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5 shrink-0" />
                        <span>Удалить сделку</span>
                      </button>
                    </div>
                  </>
                )}

                <button
                  type="button"
                  aria-label="В избранное"
                  title="В избранное"
                  onClick={() => {
                    setIsFavorite((v) => !v);
                    toast.success(!isFavorite ? "Добавлено в избранное" : "Удалено из избранного");
                  }}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] transition-colors cursor-pointer",
                    isFavorite
                      ? "border-rose-300 bg-rose-50 text-rose-500 hover:bg-rose-100"
                      : "text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111]",
                  )}
                >
                  <Heart className={cn("h-3.5 w-3.5", isFavorite && "fill-rose-500")} />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setTab("chat")}
                title="Отправить письмо"
                aria-label="Отправить письмо"
                className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
              >
                <Mail className="h-3.5 w-3.5 text-[#666666]" />
                <span>Отправить письмо</span>
              </button>
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
