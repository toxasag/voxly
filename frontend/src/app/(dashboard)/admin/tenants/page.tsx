"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Building2, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { PlatformOwnerGuard } from "@/components/auth/PlatformOwnerGuard";
import {
  renewSubscriptionDate,
  useAdminTenants,
  useDeleteTenant,
  useUpdateTenant,
  type AdminTenantDTO,
} from "@/lib/api/use-admin";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTable } from "@/components/shared/Skeleton";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  trial: "bg-amber-50 text-amber-700 border-amber-200",
  past_due: "bg-rose-50 text-rose-700 border-rose-200",
  suspended: "bg-[#fafafa] text-[#666666] border-[#e5e5e5]",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Активен",
  trial: "Пробный",
  past_due: "Просрочен",
  suspended: "Приостановлен",
};

function formatDate(value: string | null): string {
  if (value === null) return "—";
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value));
}

/** Копейки в рубли: денежные суммы хранятся целыми копейками. */
function formatRubles(kopecks: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: kopecks % 100 === 0 ? 0 : 2,
  }).format(kopecks / 100);
}

/**
 * Наценка на токены для конкретного арендатора.
 *
 * Правится на месте, а не в отдельном диалоге: это одно число, и модальное окно
 * на каждое изменение процента было бы тяжелее самого действия. Сохранение по
 * Enter или потере фокуса, и только при фактическом изменении значения — иначе
 * каждый клик по таблице отправлял бы запрос.
 */
function MarkupEditor({ tenant }: { tenant: AdminTenantDTO }) {
  const update = useUpdateTenant();
  const [value, setValue] = useState(String(tenant.ai_markup_percent));
  const [isSaving, setIsSaving] = useState(false);

  // Внешнее обновление (перезагрузка списка) должно вытеснить локальный черновик.
  useEffect(() => {
    setValue(String(tenant.ai_markup_percent));
  }, [tenant.ai_markup_percent]);

  const commit = useCallback(async () => {
    const parsed = Number(value.replace(",", "."));

    if (!Number.isFinite(parsed)) {
      setValue(String(tenant.ai_markup_percent));
      toast.error("Наценка должна быть числом");
      return;
    }

    if (parsed === tenant.ai_markup_percent) return;

    // Границы совпадают с CHECK в БД и схемой на сервере: показываем причину до
    // запроса, чтобы не получать 400 на очевидно неверном вводе.
    if (parsed < -100 || parsed > 1000) {
      setValue(String(tenant.ai_markup_percent));
      toast.error("Наценка допустима от -100% до 1000%");
      return;
    }

    setIsSaving(true);

    try {
      await update.mutateAsync({ id: tenant.id, ai_markup_percent: parsed });
      toast.success(`${tenant.name}: наценка ${parsed}%`);
    } catch (err) {
      setValue(String(tenant.ai_markup_percent));
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить наценку");
    } finally {
      setIsSaving(false);
    }
  }, [value, tenant, update]);

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="text"
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") void commit();
          if (event.key === "Escape") setValue(String(tenant.ai_markup_percent));
        }}
        disabled={isSaving}
        aria-label={`Наценка на токены для ${tenant.name}, %`}
        className="w-16 rounded-[8px] border border-[#e5e5e5] bg-white px-2 py-1 text-right text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:opacity-50"
      />
      <span className="text-xs text-[#666666]">%</span>
      {isSaving && <Loader2 className="h-3 w-3 animate-spin text-[#888888]" />}
    </div>
  );
}

function DeleteTenantDialog({
  tenant,
  open,
  onClose,
  onDeleted,
}: {
  tenant: AdminTenantDTO | null;
  open: boolean;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const deleteMutation = useDeleteTenant();
  const [confirmText, setConfirmText] = useState("");

  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (open) {
      setConfirmText("");
    }
  }, [open, tenant]);

  if (!open || !tenant) return null;

  const targetName = tenant.name.trim();
  const isMatch =
    confirmText.trim().toLowerCase() === "удалить" ||
    confirmText.trim().toLowerCase() === targetName.toLowerCase();

  const handleDelete = async () => {
    if (!isMatch || deleteMutation.isPending) return;

    try {
      await deleteMutation.mutateAsync(tenant.id);
      toast.success(`Компания «${tenant.name}» успешно и полностью удалена`);
      onDeleted();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить компанию");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 border border-rose-200 text-rose-600">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                Полное удаление компании
              </h2>
              <p className="text-xs text-[#666666]">
                Безвозвратное уничтожение всех данных компании
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 rounded-[8px] border border-rose-200 bg-rose-50/40 p-3.5">
          <p className="text-sm font-semibold text-[#111111]">{tenant.name}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#666666]">
            {tenant.slug && (
              <span>
                Слаг: <span className="font-mono text-[#111111]">{tenant.slug}</span>
              </span>
            )}
            <span>
              Пользователей: <span className="font-mono text-[#111111]">{tenant.users_count}</span>
            </span>
            <span>
              Модулей: <span className="font-mono text-[#111111]">{tenant.modules_count}</span>
            </span>
            <span>
              Тариф: <span className="capitalize text-[#111111]">{tenant.plan}</span>
            </span>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          <p className="text-xs font-medium text-[#111111]">
            Будут окончательно и безвозвратно удалены:
          </p>
          <ul className="space-y-1.5 text-xs text-[#666666]">
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Все учётные записи сотрудников компании ({tenant.users_count}) и сессии</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Вся база CRM: контакты, компании, сделки, задачи и воронки</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Подключенные каналы связи (Telegram, WhatsApp, MAX)</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>База знаний, векторные эмбеддинги, AI-боты и файлы вложений</span>
            </li>
            <li className="flex items-start gap-1.5">
              <span className="text-rose-500 font-bold">•</span>
              <span>Заказ-наряды сервисного центра, счета, кассы и история транзакций</span>
            </li>
          </ul>
        </div>

        <div className="mt-5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
          <label className="block text-xs font-medium text-[#111111]">
            Для подтверждения введите слово <span className="font-semibold text-rose-600">удалить</span> или имя «{tenant.name}»:
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={tenant.name}
            className="mt-2 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500/20"
            autoFocus
          />
        </div>

        <div className="mt-6 flex items-center justify-end gap-2 border-t border-[#e5e5e5] pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={deleteMutation.isPending}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={!isMatch || deleteMutation.isPending}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-rose-600 bg-rose-600 px-3.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {deleteMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            <span>Удалить компанию навсегда</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function TenantsTable() {
  const { data, isLoading, isError, error, refetch } = useAdminTenants();
  const update = useUpdateTenant();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [deletingTenant, setDeletingTenant] = useState<AdminTenantDTO | null>(null);

  const handleToggleStatus = useCallback(
    async (tenant: AdminTenantDTO) => {
      const next = tenant.status === "suspended" ? "active" : "suspended";
      setPendingId(tenant.id);

      try {
        await update.mutateAsync({ id: tenant.id, status: next });
        toast.success(
          next === "suspended" ? `${tenant.name} приостановлен` : `${tenant.name} активирован`,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось изменить статус");
      } finally {
        setPendingId(null);
      }
    },
    [update],
  );

  const handleRenew = useCallback(
    async (tenant: AdminTenantDTO) => {
      setPendingId(tenant.id);
      try {
        await update.mutateAsync({
          id: tenant.id,
          subscription_expires_at: renewSubscriptionDate(tenant.subscription_expires_at, 30),
          status: "active",
        });
        toast.success(`Подписка ${tenant.name} продлена на 30 дней`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось продлить подписку");
      } finally {
        setPendingId(null);
      }
    },
    [update],
  );

  if (isLoading) return <SkeletonTable rows={6} />;

  if (isError) {
    return (
      <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-6">
        <p className="text-sm font-medium text-rose-700">
          Не удалось загрузить список компаний: {error?.message}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-[8px] border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
        >
          Повторить
        </button>
      </div>
    );
  }

  const tenants = data ?? [];

  if (tenants.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Компаний пока нет"
        description="Как только кто-то зарегистрируется, компания появится здесь."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-left text-xs uppercase tracking-wider text-[#666666]">
            <th className="px-4 py-3 font-medium">Компания</th>
            <th className="px-4 py-3 font-medium">План</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Подписка до</th>
            <th className="px-4 py-3 font-medium">Пользователи</th>
            <th className="px-4 py-3 font-medium">Модули</th>
            <th className="px-4 py-3 font-medium">Баланс ИИ</th>
            <th className="px-4 py-3 font-medium">Наценка</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody>
          {tenants.map((tenant) => (
            <tr
              key={tenant.id}
              className="border-b border-[#e5e5e5] transition-colors last:border-0 hover:bg-[#fafafa]"
            >
              <td className="px-4 py-3">
                <p className="font-medium text-[#111111]">{tenant.name}</p>
                <p className="text-xs text-[#888888]">{formatDate(tenant.created_at)}</p>
              </td>
              <td className="px-4 py-3 capitalize text-[#666666]">{tenant.plan}</td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                    STATUS_STYLES[tenant.status] ?? STATUS_STYLES.suspended,
                  )}
                >
                  {STATUS_LABEL[tenant.status] ?? tenant.status}
                </span>
              </td>
              <td className="px-4 py-3 text-[#666666]">
                {formatDate(tenant.subscription_expires_at)}
              </td>
              <td className="px-4 py-3 text-[#666666]">{tenant.users_count}</td>
              <td className="px-4 py-3 text-[#666666]">{tenant.modules_count}</td>
              <td className="px-4 py-3">
                <p className="font-medium text-[#111111]">{formatRubles(tenant.ai_balance_kopecks)}</p>
                <p className="text-xs text-[#888888]">
                  расход за месяц {formatRubles(tenant.ai_spent_month_kopecks)}
                </p>
              </td>
              <td className="px-4 py-3">
                <MarkupEditor tenant={tenant} />
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => void handleRenew(tenant)}
                    disabled={pendingId === tenant.id}
                    className="rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                  >
                    +30 дней
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToggleStatus(tenant)}
                    disabled={pendingId === tenant.id}
                    className={cn(
                      "rounded-[8px] px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 font-medium",
                      tenant.status === "suspended"
                        ? "border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        : "border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100",
                    )}
                  >
                    {pendingId === tenant.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : tenant.status === "suspended" ? (
                      "Включить"
                    ) : (
                      "Приостановить"
                    )}
                  </button>
                  {tenant.slug !== "voxly" && tenant.slug !== "platform" ? (
                    <button
                      type="button"
                      onClick={() => setDeletingTenant(tenant)}
                      disabled={pendingId === tenant.id}
                      title="Полное удаление компании"
                      className="flex items-center gap-1 rounded-[8px] border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Удалить</span>
                    </button>
                  ) : (
                    <span
                      title="Платформенная компания защищена от удаления"
                      className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-2.5 py-1.5 text-xs text-[#aaaaaa] cursor-not-allowed select-none"
                    >
                      Защищена
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <DeleteTenantDialog
        tenant={deletingTenant}
        open={deletingTenant !== null}
        onClose={() => setDeletingTenant(null)}
        onDeleted={() => void refetch()}
      />
    </div>
  );
}

export default function AdminTenantsPage() {
  const { refetch, isFetching } = useAdminTenants();

  return (
    <PlatformOwnerGuard>
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Все компании</h1>
            <p className="mt-1 text-sm text-[#666666]">
              Арендаторы платформы: план, статус подписки и лимиты
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#111111] transition-colors hover:bg-[#fafafa] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
            Обновить
          </button>
        </div>

        <TenantsTable />
      </div>
    </PlatformOwnerGuard>
  );
}
