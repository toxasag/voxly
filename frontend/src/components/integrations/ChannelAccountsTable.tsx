"use client";

import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plug, RefreshCw, Settings2, Trash2 } from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusBadgeVariant } from "@/components/shared/StatusBadge";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  CHANNEL_STATUS_LABELS,
  useDeleteChannelAccount,
  useUpdateChannelAccount,
  type ChannelAccountDTO,
} from "@/lib/api/use-channels";
import { useTelegramCheckAccount } from "@/lib/api/use-telegram-auth";
import type { ChannelStatus } from "@/schemas/channel.schema";
import type { ChannelSlug } from "@/types";

/**
 * Соответствие состояния и вида бейджа.
 *
 * `pending` — предупреждение, а не ошибка: аккаунт создан, авторизация впереди.
 */
const STATUS_VARIANTS: Record<ChannelStatus, StatusBadgeVariant> = {
  connected: "success",
  pending: "warning",
  error: "destructive",
  disabled: "neutral",
};

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

interface ChannelAccountsTableProps {
  channel: ChannelSlug;
  channelName: string;
  accounts: ChannelAccountDTO[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  onRetry: () => void;
  onConnect: () => void;
  /** Достигнут лимит тарифа — кнопка в пустом состоянии не предлагается. */
  limitReached: boolean;
}

export const ChannelAccountsTable = memo(function ChannelAccountsTable({
  channel,
  channelName,
  accounts,
  isLoading,
  isError,
  error,
  onRetry,
  onConnect,
  limitReached,
}: ChannelAccountsTableProps) {
  const update = useUpdateChannelAccount(channel);
  const remove = useDeleteChannelAccount(channel);
  const checkTelegram = useTelegramCheckAccount();

  const [removeTarget, setRemoveTarget] = useState<ChannelAccountDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Проверка живости сессии — только для Telegram: у него есть реальное
   * соединение, которое пользователь может отозвать в настройках приложения, и
   * тогда подключение продолжало бы отображаться активным.
   */
  const supportsSessionCheck = channel === "telegram";

  const handleCheckSession = useCallback(
    async (account: ChannelAccountDTO) => {
      setBusyId(account.id);

      try {
        const result = await checkTelegram.mutateAsync({ id: account.id });
        if (result.alive) {
          toast.success(`«${account.label}»: сессия активна`);
        } else {
          toast.error(`«${account.label}»: ${result.reason ?? "сессия недействительна"}`);
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось проверить сессию");
      } finally {
        setBusyId(null);
      }
    },
    [checkTelegram],
  );

  /**
   * Переключение «Отключён ↔ Требуется авторизация».
   *
   * Транспорта каналов ещё нет, поэтому кнопка меняет состояние записи, а не
   * действительно переавторизует аккаунт: подписи говорят именно то, что
   * происходит, вместо обещания работающего соединения.
   */
  const handleToggleStatus = useCallback(
    async (account: ChannelAccountDTO) => {
      const next: ChannelStatus = account.status === "disabled" ? "pending" : "disabled";
      setBusyId(account.id);

      try {
        await update.mutateAsync({ id: account.id, status: next });
        toast.success(
          next === "disabled"
            ? `«${account.label}» отключён`
            : `«${account.label}» включён — требуется авторизация`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить состояние");
      } finally {
        setBusyId(null);
      }
    },
    [update],
  );

  const handleRemove = useCallback(async () => {
    if (removeTarget === null) return;

    try {
      await remove.mutateAsync({ id: removeTarget.id });
      toast.success(`Подключение «${removeTarget.label}» удалено`);
      setRemoveTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить подключение");
    }
  }, [remove, removeTarget]);

  if (isLoading) return <SkeletonTable rows={4} columns={5} />;

  if (isError) {
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-400">
          Не удалось загрузить подключения: {error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900">
        <EmptyState
          icon={Plug}
          title={`Нет подключённых аккаунтов ${channelName}`}
          description={
            limitReached
              ? "Все оплаченные подключения исчерпаны. Увеличьте количество в маркетплейсе."
              : supportsSessionCheck
                ? "Подключите личный аккаунт по коду из приложения Telegram, чтобы переписка с клиентами попадала в CRM."
                : "Подключите аккаунт, чтобы принимать и отправлять сообщения в CRM."
          }
          action={
            limitReached ? undefined : (
              <button
                type="button"
                onClick={onConnect}
                className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
              >
                Подключить аккаунт
              </button>
            )
          }
        />
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                Название
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                Идентификатор
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                Статус
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-slate-500">
                Привязан
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-slate-500">
                Действия
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {accounts.map((account) => (
              <tr key={account.id} className="transition-colors hover:bg-slate-800/50">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-slate-200">{account.label}</p>
                  {account.statusMessage.length > 0 && (
                    <p className="mt-0.5 text-xs text-rose-400">{account.statusMessage}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-slate-400">{account.externalId}</td>
                <td className="px-4 py-3">
                  <StatusBadge variant={STATUS_VARIANTS[account.status]} size="sm">
                    {CHANNEL_STATUS_LABELS[account.status]}
                  </StatusBadge>
                </td>
                <td className="px-4 py-3 text-sm text-slate-400">
                  {/* Дата привязки, а не создания: до авторизации канал не
                      работает, и «привязан» относится именно к ней. */}
                  {account.connectedAt !== null ? formatDate(account.connectedAt) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    {supportsSessionCheck ? (
                      <button
                        type="button"
                        onClick={() => void handleCheckSession(account)}
                        disabled={busyId === account.id}
                        title="Проверить сессию"
                        aria-label={`Проверить сессию ${account.label}`}
                        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
                      >
                        {busyId === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleToggleStatus(account)}
                        disabled={busyId === account.id}
                        title={account.status === "disabled" ? "Включить" : "Отключить"}
                        aria-label={
                          account.status === "disabled"
                            ? `Включить ${account.label}`
                            : `Отключить ${account.label}`
                        }
                        className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300 disabled:opacity-40"
                      >
                        {busyId === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Settings2 className="h-4 w-4" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(account)}
                      aria-label={`Удалить ${account.label}`}
                      className="rounded-md p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={handleRemove}
        title="Удалить подключение?"
        description={
          removeTarget === null
            ? undefined
            : `«${removeTarget.label}» перестанет принимать сообщения. Освободится одно оплаченное подключение канала.`
        }
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
      />
    </>
  );
});
