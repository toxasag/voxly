"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2, Plug, Save } from "lucide-react";
import { toast } from "sonner";

import {
  useAgentChannels,
  useSaveAgentChannels,
  type AgentChannelBinding,
} from "@/lib/api/use-agent-knowledge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Вкладка «Подключенные каналы» на странице агента.
//
// Показывает все подключённые аккаунты арендатора с отметкой привязки. Список
// один и тот же для выбора и для отображения: отдельный запрос «доступных»
// аккаунтов означал бы два источника одного списка.
// ---------------------------------------------------------------------------

interface AgentChannelsTabProps {
  agentId: string;
  /** Право `ai_bots:configure`; без него доступен только просмотр. */
  canEdit: boolean;
}

const CHANNEL_LABEL: Record<string, string> = {
  telegram: "Telegram",
  whatsapp: "WhatsApp",
  max: "MAX",
  avito: "Avito",
  instagram: "Instagram",
  webchat: "Онлайн-чат (Сайт)",
  telegram_bot: "Telegram-бот",
  max_bot: "MAX-бот",
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Требуется авторизация",
  connected: "Подключён",
  error: "Ошибка соединения",
  disabled: "Отключён",
};

const STATUS_CLASS: Record<string, string> = {
  pending: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  connected: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  error: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  disabled: "bg-[#f5f5f5] text-[#888888] border-[#e5e5e5]",
};

export function AgentChannelsTab({ agentId, canEdit }: AgentChannelsTabProps) {
  const { data, isLoading, error } = useAgentChannels(agentId);
  const save = useSaveAgentChannels(agentId);

  const accounts: AgentChannelBinding[] = data ?? [];

  /** Отмеченные аккаунты. Локальное состояние: до нажатия «Сохранить» ничего не отправляется. */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Синхронизация с сервером после загрузки и после сохранения: иначе отметки
  // показывали бы прежнее состояние, а не то, что записано.
  useEffect(() => {
    if (data === undefined) return;
    setSelected(
      new Set(data.filter((item) => item.isBound).map((item) => item.channelAccountId)),
    );
  }, [data]);

  const serverSelection = useMemo(
    () => new Set(accounts.filter((item) => item.isBound).map((item) => item.channelAccountId)),
    [accounts],
  );

  const isDirty = useMemo(() => {
    if (selected.size !== serverSelection.size) return true;
    for (const id of selected) {
      if (!serverSelection.has(id)) return true;
    }
    return false;
  }, [selected, serverSelection]);

  const toggle = useCallback(
    (accountId: string) => {
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(accountId)) next.delete(accountId);
        else next.add(accountId);
        return next;
      });
    },
    [],
  );

  const handleSave = useCallback(() => {
    void save
      .mutateAsync({ channelAccountIds: [...selected] })
      .then(() => toast.success("Каналы агента сохранены"))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить каналы"),
      );
  }, [save, selected]);

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
      <div className="flex items-center justify-between gap-4 border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
        <div>
          <h3 className="text-sm font-semibold text-[#111111]">Подключенные каналы</h3>
          <p className="text-xs text-[#666666]">
            Аккаунты, в которых агент будет отвечать. Обмен сообщениями заработает после
            подключения транспорта — сейчас привязка только сохраняется.
          </p>
        </div>

        {canEdit && accounts.length > 0 && (
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || save.isPending}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-2 text-xs font-semibold text-white transition-colors",
              "hover:bg-[#3d2ee0] disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {save.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Сохранить
          </button>
        )}
      </div>

      <div className="p-6">
        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 2 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        )}

        {error !== null && !isLoading && (
          <p className="text-sm text-rose-500">Не удалось загрузить каналы: {error.message}</p>
        )}

        {!isLoading && error === null && accounts.length === 0 && (
          <EmptyState
            icon={Plug}
            title="Нет подключённых аккаунтов"
            description="Подключите аккаунт канала в разделе «Каналы связи», после чего его можно будет привязать к агенту."
          />
        )}

        {!isLoading && accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((account) => {
              const isChecked = selected.has(account.channelAccountId);

              return (
                <button
                  key={account.channelAccountId}
                  type="button"
                  onClick={() => canEdit && toggle(account.channelAccountId)}
                  disabled={!canEdit}
                  className={cn(
                    "flex w-full items-center gap-4 rounded-[8px] border px-4 py-3 text-left transition-colors",
                    isChecked
                      ? "border-[#4a38f5] bg-[#4a38f5]/5"
                      : "border-[#e5e5e5] bg-white hover:bg-[#f5f5f5]",
                    !canEdit && "cursor-default",
                  )}
                >
                  {/* Чекбокс нарисован, а не нативный: нативный внутри button не
                      получает клик, а обёртка label ломала бы выравнивание. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      isChecked
                        ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                        : "border-slate-600",
                    )}
                  >
                    {isChecked && <Check className="h-3 w-3" />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-200">
                      {account.label}
                    </p>
                    <p className="text-xs text-slate-500">
                      {CHANNEL_LABEL[account.channel] ?? account.channel} · {account.externalId}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                      STATUS_CLASS[account.status] ?? STATUS_CLASS.disabled,
                    )}
                  >
                    {STATUS_LABEL[account.status] ?? account.status}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
