"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bot, Plus, Search, Zap } from "lucide-react";
import type { AiBot, BotStatus } from "@/lib/ai-bots/ai-bots.types";
import { BotCard } from "@/components/ai-bots/BotCard";
import { BotModal } from "@/components/ai-bots/BotModal";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Guard } from "@/components/shared/Guard";
import { Skeleton } from "@/components/shared/Skeleton";
import { useHasPermission } from "@/lib/auth/use-auth";
import {
  useAiAgents,
  useCreateAiAgent,
  useDeleteAiAgent,
  useUpdateAiAgent,
} from "@/lib/api/use-ai-agents";
import { useTenantQuotas } from "@/lib/api/use-tenant-quotas";
import type { CreateBotPayload } from "@/schemas/ai-bot.schema";
import { cn } from "@/lib/utils";

type StatusFilter = BotStatus | "all";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "active", label: "Активные" },
  { key: "paused", label: "На паузе" },
];

const numberFormatter = new Intl.NumberFormat("ru-RU");

function AiBotsContent() {
  const { data, isLoading, isError, error, refetch } = useAiAgents();
  const create = useCreateAiAgent();
  const update = useUpdateAiAgent();
  const deleteMutation = useDeleteAiAgent();
  const canConfigure = useHasPermission("ai_bots:configure");

  const bots = useMemo(() => data ?? [], [data]);

  const { data: quotas } = useTenantQuotas();
  const aiQuota = useMemo(
    () => quotas?.find((q) => q.feature_key === "ai_agents"),
    [quotas],
  );

  const isUnlimited = Boolean(aiQuota?.is_unlimited);
  const maxLimit = aiQuota ? (aiQuota.is_unlimited ? null : aiQuota.max_limit) : 2;
  const isLimitReached = !isUnlimited && maxLimit !== null && bots.length >= maxLimit;

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiBot | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AiBot | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return bots.filter((bot) => {
      if (statusFilter !== "all" && bot.status !== statusFilter) return false;
      if (query.length === 0) return true;
      return (
        bot.name.toLowerCase().includes(query) ||
        bot.description.toLowerCase().includes(query) ||
        bot.model.toLowerCase().includes(query)
      );
    });
  }, [bots, search, statusFilter]);

  const totals = useMemo(() => {
    const activeCount = bots.filter((bot) => bot.status === "active").length;
    const tokens = bots.reduce((sum, bot) => sum + bot.tokens_used, 0);
    const cost = bots.reduce((sum, bot) => sum + bot.cost_rub, 0);
    return { activeCount, tokens, cost };
  }, [bots]);

  const openCreate = useCallback(() => {
    setEditTarget(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((bot: AiBot) => {
    setEditTarget(bot);
    setModalOpen(true);
  }, []);

  const closeModal = useCallback(() => setModalOpen(false), []);

  const handleSubmit = useCallback(
    async (payload: CreateBotPayload) => {
      if (editTarget !== null) {
        const updated = await update.mutateAsync({ id: editTarget.id, payload });
        toast.success(`Агент «${payload.name}» обновлён`);
        return updated;
      }

      const created = await create.mutateAsync(payload);
      toast.success(`Агент «${payload.name}» создан`);
      return created;
    },
    [create, editTarget, update],
  );

  /**
   * Пауза и возобновление.
   *
   * Идёт через ту же мутацию обновления: отдельного эндпоинта нет, потому что это
   * изменение одного поля, а не самостоятельное действие.
   */
  const handleToggleStatus = useCallback(
    async (id: string) => {
      const target = bots.find((bot) => bot.id === id);
      if (target === undefined) return;

      const status: BotStatus = target.status === "active" ? "paused" : "active";

      try {
        await update.mutateAsync({ id, payload: { status } });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус");
      }
    },
    [bots, update],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (pendingDelete === null) return;
    try {
      await deleteMutation.mutateAsync({ id: pendingDelete.id });
      toast.success(`AI-агент «${pendingDelete.name}» успешно удалён`);
      setPendingDelete(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить агента");
    }
  }, [deleteMutation, pendingDelete]);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-[#111111]">AI-агенты</h1>
            {isUnlimited ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                Безлимитно
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {bots.length} из {maxLimit} по тарифу
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-[#666666]">
            {bots.length === 0 ? (
              "Ассистенты для автоответов и квалификации лидов"
            ) : (
              <>
                {totals.activeCount} из {bots.length} активны ·{" "}
                {numberFormatter.format(totals.tokens)} токенов ·{" "}
                {new Intl.NumberFormat("ru-RU", {
                  style: "currency",
                  currency: "RUB",
                  maximumFractionDigits: 0,
                }).format(totals.cost)}{" "}
                затрачено
              </>
            )}
          </p>
        </div>

        {isLimitReached ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#888888]">Лимит тарифа ({maxLimit} шт.) исчерпан</span>
            <button
              type="button"
              disabled
              title={`Достигнут лимит создания AI-агентов (${maxLimit} шт.). Обратитесь к администратору для увеличения квоты.`}
              className="flex items-center gap-2 rounded-[8px] bg-[#e5e5e5] px-3.5 py-2 text-[13px] font-medium text-[#888888] cursor-not-allowed shadow-2xs"
            >
              <Plus className="h-4 w-4" />
              Создать AI-агента
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
          >
            <Plus className="h-4 w-4" />
            Создать AI-агента
          </button>
        )}
      </div>

      {/*
        Панель фильтров скрыта, пока агентов нет: искать и фильтровать пустой
        список незачем, а элементы управления над пустым состоянием выглядят как
        сбой загрузки.
      */}
      {bots.length > 0 && (
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск по названию, описанию или модели"
            aria-label="Поиск ботов"
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-9 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 shadow-2xs"
          />
        </div>

        <div className="flex w-fit items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-2xs">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatusFilter(filter.key)}
              className={cn(
                "rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors",
                statusFilter === filter.key
                  ? "bg-[#4a38f5] text-white shadow-2xs"
                  : "text-[#666666] hover:text-[#111111] hover:bg-[#fafafa]",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-52 w-full rounded-[8px]" />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-semibold text-rose-900">
            Не удалось загрузить агентов
          </p>
          <p className="mt-1 text-sm text-rose-700">
            {error?.message ?? "неизвестная ошибка"}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
          >
            Повторить
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
          <EmptyState
            icon={bots.length === 0 ? Bot : Search}
            title={bots.length === 0 ? "У вас пока нет AI-агентов" : "Ничего не найдено по фильтру"}
            description={
              bots.length === 0
                ? "Создайте первого ассистента для автоответов и квалификации лидов в Telegram, WhatsApp, MAX или Avito."
                : "Измените поисковый запрос или сбросьте фильтр по статусу."
            }
            action={
              bots.length === 0 ? (
                <button
                  type="button"
                  onClick={openCreate}
                  className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
                >
                  <Plus className="h-4 w-4" />
                  Создать AI-агента
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {filtered.map((bot) => (
            <BotCard
              key={bot.id}
              bot={bot}
              onToggleStatus={(id) => void handleToggleStatus(id)}
              onConfigure={openEdit}
              onDelete={canConfigure ? (target) => setPendingDelete(target) : undefined}
              isDeleting={deleteMutation.isPending && deleteMutation.variables?.id === bot.id}
            />
          ))}
        </div>
      )}

      {/* Provider notice */}
      <div className="flex items-start gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-5 py-4">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[#4a38f5]" />
        <p className="text-xs leading-relaxed text-[#666666]">
          Агенты и промпты хранятся на сервере; ключи провайдеров никогда не передаются в
          браузер. Расход списывается с баланса ИИ в разделе{" "}
          <span className="font-mono text-[#111111]">Настройки → Биллинг</span>. Обмен
          сообщениями с клиентами подключается вместе с транспортом каналов.
        </p>
      </div>

      <BotModal
        open={modalOpen}
        bot={editTarget}
        onClose={closeModal}
        onSubmit={handleSubmit}
        onDelete={canConfigure ? (target) => setPendingDelete(target) : undefined}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить AI-агента?"
        description={
          pendingDelete !== null
            ? `Вы уверены, что хотите удалить агента «${pendingDelete.name}»? Бот будет выведен из эксплуатации, а все привязанные каналы связи отвязаны. Действие необратимо.`
            : ""
        }
        confirmLabel="Удалить агента"
        cancelLabel="Отмена"
        variant="destructive"
        isPending={deleteMutation.isPending}
        onConfirm={handleConfirmDelete}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default function AiBotsPage() {
  return (
    <Guard
      requiredPermission="ai_bots:read"
      requiredModule="ai_bots"
      fallback={
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
          <EmptyState
            icon={Bot}
            title="Нет доступа к AI-ботам"
            description="Модуль не установлен для этого рабочего пространства, либо у вашей роли нет права ai_bots:read."
          />
        </div>
      }
    >
      <AiBotsContent />
    </Guard>
  );
}
