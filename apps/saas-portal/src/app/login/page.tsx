'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2 } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Не удалось войти');
      }

      localStorage.setItem('voxly_token', data.token);
      router.push(
        data.user?.role === 'superadmin'
          ? '/admin'
          : data.user?.tenantRole === 'member'
            ? '/dashboard/crm'
            : '/dashboard',
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="landing-root min-h-svh">
      <div className="grid min-h-svh lg:grid-cols-2">
        {/* Amber brand panel — matches landing hero */}
        <section className="relative isolate flex flex-col bg-[#f5a623] px-5 py-6 sm:px-8 sm:py-8 lg:px-12 lg:py-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.07]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(10,10,10,.45) 1px, transparent 1px), linear-gradient(90deg, rgba(10,10,10,.45) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />

          <header className="relative z-10 flex items-center justify-between">
            <Link href="/" className="land-display text-base font-bold uppercase tracking-[-0.04em]">
              Voxly
            </Link>
            <Link href="/register" className="land-btn min-h-11 px-4 py-2.5 text-sm">
              7 дней бесплатно
            </Link>
          </header>

          <div className="relative z-10 mt-10 flex flex-1 flex-col lg:mt-0 lg:justify-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              Вход в кабинет
            </p>
            <h1 className="land-rise mt-4 max-w-[16ch] text-[clamp(2rem,4.5vw,3.5rem)] leading-[1.1] tracking-[-0.04em]">
              С возвращением.
            </h1>
            <p className="land-rise-delay mt-4 max-w-[36ch] text-base text-black/65">
              Email и пароль — и ты в CRM, ботах и чатах.
            </p>

            <div className="relative mx-auto mt-8 w-[min(52vw,200px)] sm:w-[220px] lg:mt-12 lg:w-[min(100%,280px)]">
              <div className="land-mascot-float relative aspect-[3/4] w-full">
                <Image
                  src="/mascot/voxly-hero-v5.png"
                  alt="Voxly"
                  fill
                  priority
                  sizes="(max-width: 1024px) 220px, 280px"
                  className="object-contain object-bottom"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Form panel */}
        <section className="flex items-center bg-white px-5 py-10 sm:px-10 lg:px-16">
          <div className="land-rise mx-auto w-full max-w-[400px]">
            <h2 className="text-2xl tracking-[-0.03em] sm:text-3xl">Войти</h2>
            <p className="mt-2 text-sm text-[var(--land-muted)]">Нет аккаунта? Сначала 7 дней trial.</p>

            {error ? (
              <div
                role="alert"
                className="mt-6 rounded-xl border border-[#b04a43]/35 bg-[#b04a43]/8 px-4 py-3 text-sm font-medium text-[#8b2e2e]"
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-8 space-y-5">
              <div>
                <label htmlFor="email" className="land-label">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@company.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="land-input"
                />
              </div>
              <div>
                <label htmlFor="password" className="land-label">
                  Пароль
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="land-input"
                />
              </div>

              <button type="submit" className="land-btn w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {loading ? 'Входим…' : 'Войти'}
                {!loading ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
              </button>
            </form>

            <p className="mt-8 text-sm text-[var(--land-muted)]">
              Нет аккаунта?{' '}
              <Link href="/register" className="font-semibold text-[var(--land-ink)] underline underline-offset-4">
                Зарегистрироваться
              </Link>
            </p>
            <p className="mt-3">
              <Link href="/" className="text-sm font-medium text-[var(--land-muted)] underline-offset-4 hover:underline">
                ← На главную
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
