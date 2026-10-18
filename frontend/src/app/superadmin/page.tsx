"use client";

import Link from "next/link";
import {
  ShieldCheck,
  Building2,
  Users,
  MessageSquare,
  Database,
  ChevronLeft,
  RefreshCw,
  Ban,
  CheckCircle2,
  Clock,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { PlatformOwnerGuard } from "@/components/superadmin/PlatformOwnerGuard";
import {
  useAdminTenants,
  useAdminMetrics,
  useUpdateTenant,
  renewSubscriptionDate,
  type UpdateTenantPayload,
} from "@/lib/api/use-admin";
import { ApiClientError } from "@/lib/api/apiClient";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Форматтеры
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDate(iso: string | null): string {
  if (iso === null) return "—";
  return dateFmt.format(new Date(iso));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  return days > 0 ? `${days} д ${hours} ч` : `${hours} ч`;
}

// ---------------------------------------------------------------------------
// Бейджи
// ---------------------------------------------------------------------------

const statusVariants: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  trial: "bg-yellow-400/10 text-yellow-400 border-yellow-400/30",
  past_due: "bg-orange-400/10 text-orange-400 border-orange-400/30",
  suspended: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  active: "активен",
  trial: "триал",
  past_due: "просрочен",
  suspended: "приостановлен",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        statusVariants[status] ?? "bg-slate-800 text-slate-300 border-slate-700",
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

const PLAN_OPTIONS = [
  { value: "trial", label: "Триал" },
  { value: "start", label: "Старт" },
  { value: "business", label: "Бизнес" },
  { value: "enterprise", label: "Enterprise" },
] as const;

// ---------------------------------------------------------------------------
// Карточки метрик
// ---------------------------------------------------------------------------

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors duration-200 hover:border-slate-700">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4a38f5]/10">
          <Icon className="h-4 w-4 text-amber-400" />
        </div>
        <span className="text-sm text-slate-400">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-100">{value}</p>
      {hint !== undefined && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Таблица тенантов
// ---------------------------------------------------------------------------

function TenantsTable() {
  const { data: tenants, isLoading, isError, error } = useAdminTenants();
  const updateTenant = useUpdateTenant();

  const patch = (id: string, payload: UpdateTenantPayload): void => {
    updateTenant.mutate(
      { id, ...payload },
      {
        onSuccess: () => toast.success("Тенант обновлён"),
        onError: (err: ApiClientError) => toast.error(err.message),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded-lg bg-slate-900" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6 text-center">
        <p className="text-sm text-rose-400">
          Не удалось загрузить тенанты: {error?.message ?? "ошибка сети"}
        </p>
      </div>
    );
  }

  if (tenants === undefined || tenants.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-10 text-center">
        <Building2 className="mx-auto h-10 w-10 text-slate-600" />
        <p className="mt-3 text-sm text-slate-400">Тенантов пока нет</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[900px] text-left text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900 text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3 font-medium">Компания</th>
            <th className="px-4 py-3 font-medium">Тариф</th>
            <th className="px-4 py-3 font-medium">Статус</th>
            <th className="px-4 py-3 font-medium">Подписка до</th>
            <th className="px-4 py-3 font-medium">Пользователи</th>
            <th className="px-4 py-3 font-medium">Модули</th>
            <th className="px-4 py-3 font-medium">AI-токены</th>
            <th className="px-4 py-3 font-medium">Действия</th>
          </tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr
              key={t.id}
              className="border-b border-slate-800 transition-colors duration-200 hover:bg-slate-800/50"
            >
              <td className="px-4 py-3">
                <p className="font-medium text-slate-100">{t.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  зарегистрирован {formatDate(t.created_at)}
                </p>
              </td>
              <td className="px-4 py-3">
                <select
                  value={t.plan}
                  disabled={updateTenant.isPending}
                  onChange={(e) => {
                    const plan = PLAN_OPTIONS.find((p) => p.value === e.target.value)?.value;
                    if (plan !== undefined) patch(t.id, { plan });
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 focus:border-[#4a38f5] focus:outline-none focus:ring-[#4a38f5]/20 disabled:opacity-50"
                >
                  {PLAN_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={t.status} />
              </td>
              <td className="px-4 py-3 text-slate-300">
                <div className="flex flex-col">
                  <span>{formatDate(t.subscription_expires_at)}</span>
                  <button
                    type="button"
                    disabled={updateTenant.isPending}
                    onClick={() =>
                      patch(t.id, {
                        subscription_expires_at: renewSubscriptionDate(
                          t.subscription_expires_at,
                          30,
                        ),
                      })
                    }
                    className="mt-0.5 inline-flex w-fit items-center gap-1 text-xs text-amber-400 transition-colors hover:text-[#3b2be0] disabled:opacity-50"
                  >
                    <Clock className="h-3 w-3" />+30 дней
                  </button>
                </div>
              </td>
              <td className="px-4 py-3 text-slate-300">{t.users_count}</td>
              <td className="px-4 py-3 text-slate-300">{t.modules_count}</td>
              <td className="px-4 py-3 text-slate-300">
                {t.ai_tokens_balance.toLocaleString("ru-RU")}
              </td>
              <td className="px-4 py-3">
                {t.status === "suspended" ? (
                  <button
                    type="button"
                    disabled={updateTenant.isPending}
                    onClick={() => patch(t.id, { status: "active" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-400 transition-all duration-200 hover:bg-emerald-500/20 disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Включить
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={updateTenant.isPending}
                    onClick={() => patch(t.id, { status: "suspended" })}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-400 transition-all duration-200 hover:bg-rose-500/20 disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Приостановить
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Секция метрик
// ---------------------------------------------------------------------------

function MetricsSection() {
  const { data: metrics } = useAdminMetrics();

  if (metrics === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-28 w-full animate-pulse rounded-xl bg-slate-900" />
        ))}
      </div>
    );
  }

  const c = metrics.counts;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        icon={Building2}
        label="Тенанты"
        value={String(c.tenants_total)}
        hint={`${c.tenants_active} активных · ${c.tenants_trial} триал · ${c.tenants_suspended} приост.`}
      />
      <MetricCard icon={Users} label="Пользователи" value={String(c.users_total)} />
      <MetricCard
        icon={Activity}
        label="CRM"
        value={String(c.deals_total)}
        hint={`${c.contacts_total} контактов · ${c.repair_orders_total} ремонтов`}
      />
      <MetricCard icon={MessageSquare} label="Сообщения" value={String(c.messages_total)} />
      <MetricCard
        icon={Database}
        label="База данных"
        value={formatBytes(metrics.database.size_bytes)}
        hint={`${metrics.database.connections} подключений · uptime ${formatUptime(metrics.database.uptime_seconds)}`}
      />
      <MetricCard
        icon={Clock}
        label="Очередь сообщений"
        value={metrics.queue.implemented ? `${metrics.queue.pending} в очереди` : "n/a"}
        hint={
          metrics.queue.implemented
            ? `${metrics.queue.failed} ошибочных`
            : "BullMQ появится в M6.x — очередь ещё не в стеке"
        }
      />
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-5 sm:col-span-2">
        <p className="text-xs uppercase tracking-wide text-slate-500">Сводка</p>
        <p className="mt-2 text-sm text-slate-300">
          Платформа обслуживает {c.tenants_total} тенант(ов) и {c.users_total} пользователей.
          Данные обновляются автоматически каждые 30 секунд.
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Снимок: {new Date(metrics.generated_at).toLocaleString("ru-RU")}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Страница
// ---------------------------------------------------------------------------

export default function SuperadminPage() {
  return (
    <PlatformOwnerGuard>
      <div className="flex min-h-screen flex-col bg-slate-950">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-slate-800 bg-slate-900 px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4a38f5] text-white">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-sm font-bold tracking-tight text-slate-100">GETVOXLY</span>
              <span className="ml-2 rounded bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-semibold text-amber-400">
                SUPERADMIN
              </span>
            </div>
          </div>
          <div className="flex-1" />
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" />
            В CRM
          </Link>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 p-6">
          <section>
            <h1 className="text-xl font-bold text-slate-100">Платформенная панель</h1>
            <p className="mt-1 text-sm text-slate-400">
              Тенанты, тарифы, лимиты и системные метрики GETVOXLY
            </p>
          </section>

          <section aria-label="Системные метрики">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              <RefreshCw className="h-4 w-4" />
              Мониторинг
            </h2>
            <MetricsSection />
          </section>

          <section aria-label="Тенанты">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
              <Building2 className="h-4 w-4" />
              Тенанты и подписки
            </h2>
            <TenantsTable />
          </section>
        </main>
      </div>
    </PlatformOwnerGuard>
  );
}
