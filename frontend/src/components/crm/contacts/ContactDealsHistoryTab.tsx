"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  DollarSign,
  Plus,
  TrendingUp,
  UserCheck,
  XCircle,
} from "lucide-react";
import { useContactDealsHistory } from "@/lib/api/use-contact-deals-history";
import { useCreateDeal, useKanban, usePipelines } from "@/lib/api/use-deals";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { TagPill } from "@/components/ui/tag";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface ContactDealsHistoryTabProps {
  contactId: string;
}

const formatCurrency = (val: number, currency = "RUB") => {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency === "RUB" ? "RUB" : currency,
    maximumFractionDigits: 0,
  }).format(val);
};

const formatDate = (isoString: string | null) => {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(isoString));
  } catch {
    return "—";
  }
};

export function ContactDealsHistoryTab({ contactId }: ContactDealsHistoryTabProps) {
  const router = useRouter();
  const historyQuery = useContactDealsHistory(contactId);
  const pipelines = usePipelines();
  const createDeal = useCreateDeal();

  const [isCreating, setIsCreating] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealBudget, setDealBudget] = useState("");

  const firstPipelineId = pipelines.data?.[0]?.id ?? null;
  const kanban = useKanban(firstPipelineId);

  const firstStageId = useMemo(() => {
    const cols = [...(kanban.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
    return cols[0]?.stageId ?? null;
  }, [kanban.data]);

  const handleCreateDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealTitle.trim()) return;
    if (!firstPipelineId || !firstStageId) {
      toast.error("Не удалось определить базовую воронку");
      return;
    }

    try {
      await createDeal.mutateAsync({
        title: dealTitle.trim(),
        budget: Number(dealBudget) || 0,
        pipeline_id: firstPipelineId,
        stage_id: firstStageId,
        contact_id: contactId,
        currency: "RUB",
      });
      toast.success("Сделка создана");
      setDealTitle("");
      setDealBudget("");
      setIsCreating(false);
      void historyQuery.refetch();
    } catch {
      toast.error("Не удалось создать сделку");
    }
  };

  if (historyQuery.isLoading) {
    return (
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
        </div>
        <Skeleton className="h-40 w-full rounded-[8px]" />
      </div>
    );
  }

  const { deals, metrics } = historyQuery.data ?? {
    deals: [],
    metrics: {
      totalDeals: 0,
      wonDeals: 0,
      lostDeals: 0,
      openDeals: 0,
      totalBudget: 0,
      wonRevenue: 0,
      ltv: 0,
      avgCheck: 0,
      firstDealAt: null,
      lastDealAt: null,
      repeatCustomer: false,
    },
  };

  const winRate =
    metrics.totalDeals > 0
      ? Math.round((metrics.wonDeals / metrics.totalDeals) * 100)
      : 0;

  return (
    <div className="space-y-5 p-5">
      {/* Метрики LTV и истории взаимодействия */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* LTV */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">LTV (Выручка)</span>
            <DollarSign className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-[#111111]">
            {formatCurrency(metrics.ltv)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#666666]">
            <span>Потенциал:</span>
            <span className="font-mono text-[#111111]">{formatCurrency(metrics.totalBudget)}</span>
          </div>
        </div>

        {/* Средний чек */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Средний чек</span>
            <TrendingUp className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-[#111111]">
            {formatCurrency(metrics.avgCheck)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[#666666]">
            <span>Win-Rate:</span>
            <span className="font-mono font-medium text-emerald-700">{winRate}%</span>
          </div>
        </div>

        {/* Сделок всего */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Всего сделок</span>
            <Briefcase className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[18px] font-semibold tracking-tight text-[#111111]">
            {metrics.totalDeals}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="flex items-center gap-0.5 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> {metrics.wonDeals}
            </span>
            <span className="flex items-center gap-0.5 text-rose-600">
              <XCircle className="h-3 w-3" /> {metrics.lostDeals}
            </span>
            <span className="flex items-center gap-0.5 text-[#666666]">
              <Clock className="h-3 w-3" /> {metrics.openDeals}
            </span>
          </div>
        </div>

        {/* Статус клиента */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Тип клиента</span>
            <UserCheck className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1">
            {metrics.repeatCustomer ? (
              <TagPill color="emerald">Повторный клиент</TagPill>
            ) : (
              <TagPill color="sky">Первичный клиент</TagPill>
            )}
          </div>
          <div className="mt-1.5 text-[11px] text-[#666666]">
            Первое: {formatDate(metrics.firstDealAt)}
          </div>
        </div>
      </div>

      {/* Панель заголовка списка сделок + кнопка создания */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[13px] font-semibold text-[#111111]">
            История обращений и сделок ({deals.length})
          </h3>
          <p className="text-[11px] text-[#666666]">
            Полная хронология всех сделок и заказов данного контакта
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreating(!isCreating)}
          className="inline-flex h-7 items-center rounded-[8px] bg-[#4a38f5] px-2.5 text-[12px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Новая сделка
        </button>
      </div>

      {/* Быстрое создание новой сделки */}
      {isCreating && (
        <form
          onSubmit={handleCreateDeal}
          className="flex flex-col gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 sm:flex-row sm:items-center"
        >
          <input
            value={dealTitle}
            onChange={(e) => setDealTitle(e.target.value)}
            placeholder="Название новой сделки..."
            className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            autoFocus
          />
          <input
            type="number"
            value={dealBudget}
            onChange={(e) => setDealBudget(e.target.value)}
            placeholder="Сумма (₽)"
            className="h-8 w-32 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <div className="flex items-center gap-1.5">
            <button
              type="submit"
              disabled={createDeal.isPending || !dealTitle.trim()}
              className="inline-flex h-8 items-center rounded-[8px] bg-[#4a38f5] px-3 text-[12px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50"
            >
              Создать
            </button>
            <button
              type="button"
              onClick={() => setIsCreating(false)}
              className="inline-flex h-8 items-center rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#666666] hover:bg-[#f5f5f5]"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {/* Список сделок */}
      {deals.length === 0 ? (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white py-12">
          <EmptyState
            title="Нет связанных сделок"
            description="У данного контакта пока нет истории обращений и заказов."
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
          <table className="w-full border-collapse text-left text-[12px]">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium text-[#666666]">
                <th className="px-3.5 py-2">Сделка</th>
                <th className="px-3 py-2">Воронка</th>
                <th className="px-3 py-2">Этап</th>
                <th className="px-3 py-2 text-right">Бюджет</th>
                <th className="px-3 py-2 text-center">В воронке</th>
                <th className="px-3.5 py-2 text-right">Создана</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {deals.map((deal) => {
                const colorKey = stageTagColor(deal.stageColorKey);

                return (
                  <tr
                    key={deal.id}
                    onClick={() => router.push(`/crm/deals?record=${deal.id}`)}
                    className="group cursor-pointer transition-colors hover:bg-black/[0.02]"
                  >
                    <td className="px-3.5 py-2.5">
                      <div className="font-medium text-[#111111] group-hover:text-[#4a38f5]">
                        {deal.title}
                      </div>
                      {deal.ownerName && (
                        <div className="text-[11px] text-[#888888]">
                          Ответственный: {deal.ownerName}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[#666666]">
                      {deal.pipelineName}
                    </td>
                    <td className="px-3 py-2.5">
                      <TagPill color={colorKey}>{deal.stageName}</TagPill>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium text-[#111111]">
                      {formatCurrency(deal.budget, deal.currency)}
                    </td>
                    <td className="px-3 py-2.5 text-center font-mono text-[11px] text-[#666666]">
                      {deal.daysInPipeline} дн.
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono text-[11px] text-[#666666]">
                      {formatDate(deal.createdAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
