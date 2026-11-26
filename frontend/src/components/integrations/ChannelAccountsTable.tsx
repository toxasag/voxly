"use client";

import { memo, useCallback, useState } from "react";
import { toast } from "sonner";
import {
  History,
  Link2,
  Loader2,
  Pencil,
  Plug,
  Power,
  PowerOff,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge, type StatusBadgeVariant } from "@/components/shared/StatusBadge";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { ConfigureLinkModal } from "./ConfigureLinkModal";
import { EditChannelAccountModal } from "./EditChannelAccountModal";
import {
  CHANNEL_STATUS_LABELS,
  useDeleteChannelAccount,
  useSyncChannelHistory,
  useUpdateChannelAccount,
  type ChannelAccountDTO,
} from "@/lib/api/use-channels";
import { useTelegramCheckAccount } from "@/lib/api/use-telegram-auth";
import { cn } from "@/lib/utils";
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

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return "—";
  }
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
  onReconnect?: (account: ChannelAccountDTO) => void;
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
  onReconnect,
  limitReached,
}: ChannelAccountsTableProps) {
  const update = useUpdateChannelAccount(channel);
  const remove = useDeleteChannelAccount(channel);
  const syncHistory = useSyncChannelHistory(channel);
  const checkTelegram = useTelegramCheckAccount();

  const [removeTarget, setRemoveTarget] = useState<ChannelAccountDTO | null>(null);
  const [toggleTarget, setToggleTarget] = useState<ChannelAccountDTO | null>(null);
  const [editTarget, setEditTarget] = useState<ChannelAccountDTO | null>(null);
  const [configureTarget, setConfigureTarget] = useState<ChannelAccountDTO | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Проверка живости сессии — только для Telegram: у него есть реальное
   * соединение, которое пользователь может отозвать в настройках приложения, и
   * тогда подключение продолжало бы отображаться активным.
   */
  const supportsSessionCheck = channel === "telegram";
  const supportsHistorySync = channel === "max" || channel === "telegram" || channel === "whatsapp";

  const handleSyncHistory = useCallback(
    async (account: ChannelAccountDTO) => {
      setBusyId(account.id);
      try {
        await syncHistory.mutateAsync({ id: account.id });
        toast.success(`«${account.label}»: запущена синхронизация переписки с контактами CRM`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось запустить синхронизацию истории");
      } finally {
        setBusyId(null);
      }
    },
    [syncHistory],
  );

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
   * Безопасное переключение состояния подключения с предварительным
   * диалогом подтверждения.
   */
  const handleConfirmToggle = useCallback(async () => {
    if (toggleTarget === null) return;
    const isDisabling = toggleTarget.status !== "disabled";
    const nextStatus: ChannelStatus = isDisabling ? "disabled" : "pending";
    setBusyId(toggleTarget.id);

    try {
      await update.mutateAsync({
        id: toggleTarget.id,
        status: nextStatus,
        is_enabled: !isDisabling,
      });
      toast.success(
        isDisabling
          ? `«${toggleTarget.label}» отключён`
          : `«${toggleTarget.label}» включён`,
      );
      setToggleTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось изменить состояние");
    } finally {
      setBusyId(null);
    }
  }, [update, toggleTarget]);

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
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm text-rose-700">
          Не удалось загрузить подключения: {error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5]"
        >
          Повторить
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="rounded-xl border border-[#e5e5e5] bg-white">
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
                className="rounded-lg bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3b2be0]"
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
      <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-2xs">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                Название
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                Идентификатор
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                Статус
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase text-[#666666]">
                Привязан
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase text-[#666666]">
                Действия
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {accounts.map((account) => (
              <tr key={account.id} className="transition-colors hover:bg-[#f5f5f5]">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-[#111111]">{account.label}</p>
                  {Boolean(account.statusMessage && account.statusMessage.length > 0) && (
                    <p className="mt-0.5 text-xs text-rose-600">{account.statusMessage}</p>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[#666666]">{account.externalId}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <StatusBadge variant={STATUS_VARIANTS[account.status] ?? "neutral"} size="sm">
                      {CHANNEL_STATUS_LABELS[account.status] ?? account.status}
                    </StatusBadge>
                    {account.historySyncStatus === "queued" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#666666]">
                        <Loader2 className="h-3 w-3 animate-spin text-[#4a38f5]" />
                        В очереди на синк...
                      </span>
                    )}
                    {account.historySyncStatus === "syncing" && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-[#4a38f5]">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Синк: {account.historySyncProcessed ?? 0}/{account.historySyncTotal ?? 0} ({account.historySyncMessages ?? 0} сообщ.)
                      </span>
                    )}
                    {account.historySyncStatus === "completed" && (account.historySyncMessages ?? 0) > 0 && (
                      <span className="text-[11px] text-emerald-700">
                        История: {account.historySyncMessages} сообщ.
                      </span>
                    )}
                    {account.historySyncStatus === "error" && account.historySyncError && (
                      <span className="text-[11px] text-rose-600" title={account.historySyncError}>
                        Ошибка синка истории
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm text-[#666666]">
                  {/* Дата привязки, а не создания: до авторизации канал не
                      работает, и «привязан» относится именно к ней. */}
                  {account.connectedAt !== null ? formatDate(account.connectedAt) : "—"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Кнопка явной авторизации / переподключения, если статус pending или error */}
                    {Boolean(onReconnect && (account.status === "pending" || account.status === "error")) && (
                      <button
                        type="button"
                        onClick={() => onReconnect?.(account)}
                        title={
                          account.status === "pending"
                            ? "Авторизовать аккаунт (сканировать QR / войти)"
                            : "Повторить авторизацию аккаунта"
                        }
                        aria-label={
                          account.status === "pending"
                            ? `Авторизовать ${account.label}`
                            : `Повторить авторизацию ${account.label}`
                        }
                        className="flex items-center gap-1 rounded-[6px] border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 shadow-2xs transition-colors hover:bg-amber-100 cursor-pointer"
                      >
                        <QrCode className="h-3.5 w-3.5 text-amber-700" />
                        <span>Авторизовать</span>
                      </button>
                    )}

                    {/* Проверка живости сессии (только Telegram connected) */}
                    {supportsSessionCheck && account.status === "connected" && (
                      <button
                        type="button"
                        onClick={() => void handleCheckSession(account)}
                        disabled={busyId === account.id}
                        title="Проверить сессию Telegram"
                        aria-label={`Проверить сессию ${account.label}`}
                        className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111] disabled:opacity-40"
                      >
                        {busyId === account.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ShieldCheck className="h-4 w-4 text-emerald-600" />
                        )}
                      </button>
                    )}

                    {/* Синхронизация истории переписки с контактами CRM */}
                    {supportsHistorySync && account.status === "connected" && (
                      <button
                        type="button"
                        onClick={() => void handleSyncHistory(account)}
                        disabled={
                          busyId === account.id ||
                          account.historySyncStatus === "syncing" ||
                          account.historySyncStatus === "queued"
                        }
                        title="Подтянуть историю переписки с контактами CRM"
                        aria-label={`Синхронизировать историю ${account.label}`}
                        className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#4a38f5] disabled:opacity-40"
                      >
                        {account.historySyncStatus === "syncing" || account.historySyncStatus === "queued" ? (
                          <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                        ) : (
                          <History className="h-4 w-4" />
                        )}
                      </button>
                    )}

                    {/* Повторная авторизация для подключённого аккаунта */}
                    {Boolean(onReconnect && account.status === "connected") && (
                      <button
                        type="button"
                        onClick={() => onReconnect?.(account)}
                        title="Переподключить аккаунт"
                        aria-label={`Переподключить ${account.label}`}
                        className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111]"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    )}

                    {/* Редактирование названия */}
                    <button
                      type="button"
                      onClick={() => setEditTarget(account)}
                      title="Редактировать название подключения"
                      aria-label={`Редактировать название ${account.label}`}
                      className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111]"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    {/* Ссылки для сайта и кнопок */}
                    {channel !== "webchat" && (
                      <button
                        type="button"
                        onClick={() => setConfigureTarget(account)}
                        title="Ссылки для сайта и кнопок (Direct & Deep Links)"
                        aria-label={`Ссылки ${account.label}`}
                        className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#4a38f5]"
                      >
                        <Link2 className="h-4 w-4" />
                      </button>
                    )}

                    {/* Включение / Отключение с подтверждением */}
                    <button
                      type="button"
                      onClick={() => setToggleTarget(account)}
                      disabled={busyId === account.id}
                      title={account.status === "disabled" ? "Включить аккаунт" : "Отключить аккаунт"}
                      aria-label={
                        account.status === "disabled"
                          ? `Включить ${account.label}`
                          : `Отключить ${account.label}`
                      }
                      className={cn(
                        "rounded-md p-1.5 transition-colors disabled:opacity-40",
                        account.status === "disabled"
                          ? "text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
                          : "text-[#666666] hover:bg-amber-50 hover:text-amber-700",
                      )}
                    >
                      {busyId === account.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : account.status === "disabled" ? (
                        <Power className="h-4 w-4" />
                      ) : (
                        <PowerOff className="h-4 w-4" />
                      )}
                    </button>

                    {/* Удаление подключения */}
                    <button
                      type="button"
                      onClick={() => setRemoveTarget(account)}
                      title="Удалить подключение"
                      aria-label={`Удалить ${account.label}`}
                      className="rounded-md p-1.5 text-[#666666] transition-colors hover:bg-rose-50 hover:text-rose-600"
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

      {/* Диалог подтверждения отключения / включения */}
      <ConfirmDialog
        open={toggleTarget !== null}
        onClose={() => setToggleTarget(null)}
        onConfirm={handleConfirmToggle}
        title={
          toggleTarget?.status === "disabled"
            ? "Включить подключение?"
            : "Отключить подключение?"
        }
        description={
          toggleTarget === null
            ? undefined
            : toggleTarget.status === "disabled"
              ? `Возобновить приём и отправку сообщений для «${toggleTarget.label}»?`
              : `«${toggleTarget.label}» перестанет принимать и отправлять сообщения. Сессия останется сохранённой, вы сможете включить подключение в любой момент.`
        }
        confirmLabel={toggleTarget?.status === "disabled" ? "Включить" : "Отключить"}
        variant={toggleTarget?.status === "disabled" ? "default" : "destructive"}
        isPending={update.isPending}
      />

      {/* Диалог подтверждения удаления */}
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

      {/* Модальное окно редактирования названия */}
      <EditChannelAccountModal
        open={editTarget !== null}
        channel={channel}
        channelName={channelName}
        account={editTarget}
        onClose={() => setEditTarget(null)}
      />

      {/* Модальное окно конфигурации ссылок */}
      <ConfigureLinkModal
        open={configureTarget !== null}
        onClose={() => setConfigureTarget(null)}
        channel={channel}
        account={configureTarget}
      />
    </>
  );
});
