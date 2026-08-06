'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Building2, Mail, Shield, UserRound } from 'lucide-react';
import { authHeaders } from '@/lib/auth';
import { AppShell, LoadingState } from '@/components/portal/app-shell';
import { Alert } from '@/components/portal/alert';

const SECTION =
  'rounded-2xl border border-black/10 bg-[#faf8f5] p-5 sm:p-6';
const SECTION_WARM =
  'rounded-2xl border border-[#f5a623]/35 bg-[#fff8ec] p-5 sm:p-6';

type MePayload = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string;
  telegramUserId?: string | null;
  tenant?: {
    id: string;
    slug: string;
    name?: string;
    membershipRole?: string;
    portalHost?: string | null;
  } | null;
};

function roleLabel(role?: string | null, membershipRole?: string | null): string {
  if (role === 'superadmin') return 'Супер-админ';
  if (membershipRole === 'owner' || role === 'owner') return 'Владелец';
  if (membershipRole === 'member') return 'Участник';
  return role || membershipRole || '—';
}

function displayName(me: MePayload): string {
  const parts = [me.firstName, me.lastName].filter(Boolean);
  if (parts.length) return parts.join(' ');
  const local = me.email?.split('@')[0];
  return local || '—';
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04]">
        <Icon className="h-4 w-4 text-black/55" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-black/40">{label}</p>
        <p className="mt-0.5 break-all text-sm font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<MePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }
    try {
      const res = await fetch('/api/auth/me', { headers: authHeaders() });
      if (!res.ok) throw new Error('Unauthorized');
      setMe((await res.json()) as MePayload);
    } catch (e) {
      if (e instanceof Error && e.message === 'Unauthorized') {
        localStorage.removeItem('voxly_token');
        router.push('/login');
        return;
      }
      setError(e instanceof Error ? e.message : 'Не удалось загрузить профиль');
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <AppShell maxWidth="3xl">
        <LoadingState label="Загрузка профиля…" />
      </AppShell>
    );
  }

  const backHref = me?.role === 'superadmin' ? '/admin' : '/dashboard';
  const backLabel = me?.role === 'superadmin' ? 'Админка' : 'Кабинет';

  return (
    <AppShell maxWidth="3xl" className="space-y-5">
      <section className="relative isolate overflow-hidden rounded-2xl bg-[#f5a623] px-5 py-6 sm:px-8 sm:py-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(10,10,10,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.45) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="relative z-10">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-sm text-black/55 transition-colors hover:text-black"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {backLabel}
          </Link>
          <p className="mt-3 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
            Аккаунт
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-black sm:text-3xl">
            Настройки профиля
          </h1>
          <p className="mt-1.5 max-w-lg text-sm text-black/65">
            Данные аккаунта Voxly. Смена пароля и редактирование профиля появятся позже.
          </p>
        </div>
      </section>

      {error ? <Alert variant="error">{error}</Alert> : null}

      {me ? (
        <section className={SECTION}>
          <h2 className="mb-4 text-sm font-semibold text-foreground">Профиль</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field icon={Mail} label="Email" value={me.email || '—'} />
            <Field icon={UserRound} label="Имя" value={displayName(me)} />
            <Field
              icon={Shield}
              label="Роль"
              value={roleLabel(me.role, me.tenant?.membershipRole)}
            />
            <Field
              icon={Building2}
              label="Компания / workspace"
              value={me.tenant?.slug || me.tenant?.name || '—'}
            />
          </div>
          {me.telegramUserId ? (
            <p className="mt-5 text-xs text-muted-foreground">
              Telegram ID: {me.telegramUserId}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className={SECTION_WARM}>
        <h2 className="text-sm font-semibold text-foreground">Скоро</h2>
        <p className="mt-1.5 text-sm text-black/65">
          Смена пароля, имя компании и уведомления — пока через поддержку. API обновления профиля
          и смены пароля ещё не подключены.
        </p>
      </section>
    </AppShell>
  );
}
