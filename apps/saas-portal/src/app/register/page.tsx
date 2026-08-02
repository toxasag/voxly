'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import { REF_STORAGE_KEY } from '@/lib/referral-ref';

type OtpChallenge = {
  needsOtp: true;
  nonce: string;
  botDeepLink: string;
  botUsername: string;
  message?: string;
};

/** Cyrillic → latin for URL slug; latin/digits kept. */
function toCompanySlug(raw: string): string {
  const map: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  return raw
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => {
      if (map[ch] !== undefined) return map[ch];
      if (/[a-z0-9-]/.test(ch)) return ch;
      if (/\s|_/.test(ch)) return '-';
      return '-';
    })
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [refCode, setRefCode] = useState('');
  const [acceptedLegal, setAcceptedLegal] = useState(false);
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [otpCode, setOtpCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const companySlug = useMemo(() => toCompanySlug(workspaceName), [workspaceName]);

  useEffect(() => {
    const fromUrl = searchParams.get('ref')?.trim();
    if (fromUrl) {
      setRefCode(fromUrl);
      try {
        sessionStorage.setItem(REF_STORAGE_KEY, fromUrl);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      const stored = sessionStorage.getItem(REF_STORAGE_KEY)?.trim();
      if (stored) setRefCode(stored);
    } catch {
      /* ignore */
    }
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!companySlug || companySlug.length < 2) {
      setError('Название портала слишком короткое. Нужно минимум 2 символа для адреса.');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Пароль — не короче 8 символов.');
      setLoading(false);
      return;
    }

    if (!otp && !acceptedLegal) {
      setError('Нужно принять оферту и согласие на обработку персональных данных.');
      setLoading(false);
      return;
    }

    try {
      if (otp) {
        const res = await fetch('/api/auth/register/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: otp.nonce, code: otpCode.trim() }),
        });
        const text = await res.text();
        let data: { token?: string; error?: unknown } | null = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          throw new Error(text || 'Не удалось подтвердить код');
        }
        if (!res.ok) {
          const errMsg =
            typeof data?.error === 'string'
              ? data.error
              : data?.error
                ? JSON.stringify(data.error)
                : 'Не удалось подтвердить код';
          throw new Error(errMsg);
        }
        if (!data?.token) throw new Error('Нет токена в ответе');
        localStorage.setItem('voxly_token', data.token);
        router.push('/dashboard');
        return;
      }

      const res = await fetch('/api/auth/register/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          firstName,
          companySlug,
          referralCode: refCode || undefined,
        }),
      });

      const text = await res.text();
      let data: (OtpChallenge & { token?: string; error?: unknown }) | null = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(text || 'Не удалось зарегистрироваться');
      }

      if (!res.ok) {
        const errMsg =
          typeof data?.error === 'string'
            ? data.error
            : data?.error
              ? JSON.stringify(data.error)
              : 'Не удалось зарегистрироваться';
        throw new Error(errMsg);
      }

      if (data?.needsOtp && data.nonce) {
        setOtp(data);
        return;
      }
      throw new Error('Ожидался шаг подтверждения через Telegram');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="landing-root min-h-svh">
      <div className="grid min-h-svh lg:grid-cols-2">
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

          <header className="relative z-10 flex items-center justify-between gap-3">
            <Link href="/" className="land-display text-base font-bold uppercase tracking-[-0.04em]">
              Voxly
            </Link>
            <Link href="/login" className="land-btn-ghost min-h-11 border-black/20 bg-transparent px-4 py-2.5 text-sm">
              Войти
            </Link>
          </header>

          <div className="relative z-10 mt-8 flex flex-1 flex-col lg:mt-0 lg:justify-center">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-black/45">
              7 дней без карты
            </p>
            <h1 className="land-rise mt-4 max-w-[18ch] text-[clamp(1.85rem,4.2vw,3.25rem)] leading-[1.1] tracking-[-0.04em]">
              Запусти кабинет за минуту.
            </h1>
            <p className="land-rise-delay mt-4 max-w-[38ch] text-base text-black/65">
              CRM, боты и мессенджеры в одном месте. Сначала пробуешь — потом решаешь, платить или нет.
            </p>

            <div className="relative mx-auto mt-6 hidden w-[min(48vw,180px)] sm:block sm:w-[200px] lg:mt-10 lg:w-[min(100%,260px)]">
              <div className="land-mascot-float relative aspect-[3/4] w-full">
                <Image
                  src="/mascot/voxly-cta-v5.png"
                  alt="Voxly"
                  fill
                  priority
                  sizes="(max-width: 1024px) 200px, 260px"
                  className="object-contain object-bottom"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="flex bg-white px-5 py-8 sm:px-10 sm:py-12 lg:items-center lg:px-14 lg:py-12">
          <div className="land-rise mx-auto w-full max-w-[420px]">
            <h2 className="text-2xl tracking-[-0.03em] sm:text-3xl">
              {otp ? 'Код из Telegram' : 'Регистрация'}
            </h2>
            <p className="mt-2 text-sm text-[var(--land-muted)]">
              {otp
                ? otp.message || 'Откройте @GetVoxlybot и введите код'
                : 'Заполни поля, подтверди код в боте — и в кабинет.'}
            </p>

            {error ? (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-[#b04a43]/35 bg-[#b04a43]/8 px-4 py-3 text-sm font-medium text-[#8b2e2e]"
              >
                {error}
              </div>
            ) : null}

            <form onSubmit={handleSubmit} className="mt-7 space-y-4">
              {otp ? (
                <>
                  <a
                    href={otp.botDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="land-btn flex w-full items-center justify-center gap-2"
                  >
                    Открыть @{otp.botUsername}
                    <ExternalLink className="h-4 w-4" aria-hidden />
                  </a>
                  <div>
                    <label htmlFor="otp" className="land-label">
                      Код из бота
                    </label>
                    <input
                      id="otp"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6 цифр"
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      required
                      className="land-input tracking-widest"
                    />
                  </div>
                  <button
                    type="button"
                    className="text-sm font-medium text-[var(--land-muted)] underline-offset-4 hover:underline"
                    onClick={() => {
                      setOtp(null);
                      setOtpCode('');
                      setError('');
                    }}
                  >
                    ← Изменить данные
                  </button>
                </>
              ) : null}
              {!otp ? (
              <>
              <div>
                <label htmlFor="firstName" className="land-label">
                  Имя
                </label>
                <input
                  id="firstName"
                  name="given-name"
                  autoComplete="given-name"
                  placeholder="Как к тебе обращаться"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                  className="land-input"
                />
              </div>

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
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Не меньше 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="land-input"
                />
              </div>

              <div>
                <label htmlFor="workspace" className="land-label">
                  Название вашего CRM-портала
                </label>
                <input
                  id="workspace"
                  name="organization"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="Например: Студия Антона"
                  required
                  minLength={2}
                  maxLength={50}
                  className="land-input"
                />
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--land-muted)]">
                  Это имя вашего воркспейса / CRM-портала.
                  {companySlug.length >= 2 ? (
                    <>
                      {' '}
                      Адрес кабинета:{' '}
                      <span className="font-semibold text-[var(--land-ink)]">{companySlug}</span>
                    </>
                  ) : (
                    <> Из названия сделаем латинский адрес для ссылки.</>
                  )}
                </p>
              </div>

              <div>
                <label htmlFor="ref" className="land-label">
                  Реферальный код
                </label>
                <input
                  id="ref"
                  name="referral"
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value)}
                  placeholder="Если есть — сюда"
                  className="land-input"
                />
              </div>

              <label
                htmlFor="legal"
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-black/10 bg-[#f7f7f7] px-3 py-3"
              >
                <input
                  id="legal"
                  type="checkbox"
                  checked={acceptedLegal}
                  onChange={(e) => setAcceptedLegal(e.target.checked)}
                  required
                  aria-required="true"
                  className="mt-1 h-5 w-5 shrink-0 accent-[#0a0a0a]"
                />
                <span className="text-sm leading-snug text-[var(--land-muted)]">
                  Принимаю{' '}
                  <Link href="/terms" className="font-semibold text-[var(--land-ink)] underline underline-offset-4" target="_blank">
                    оферту
                  </Link>{' '}
                  и{' '}
                  <Link href="/consent" className="font-semibold text-[var(--land-ink)] underline underline-offset-4" target="_blank">
                    согласие на обработку ПДн
                  </Link>
                  . Читал{' '}
                  <Link href="/privacy" className="font-semibold text-[var(--land-ink)] underline underline-offset-4" target="_blank">
                    политику
                  </Link>{' '}
                  и{' '}
                  <Link href="/refund" className="font-semibold text-[var(--land-ink)] underline underline-offset-4" target="_blank">
                    правила возврата
                  </Link>
                  .
                </span>
              </label>
              </>
              ) : null}

              <button
                type="submit"
                className="land-btn w-full"
                disabled={loading || (!otp && !acceptedLegal)}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {loading ? 'Проверяем…' : otp ? 'Подтвердить и создать' : 'Продолжить'}
                {!loading ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
              </button>
            </form>

            <p className="mt-7 text-sm text-[var(--land-muted)]">
              Уже есть аккаунт?{' '}
              <Link href="/login" className="font-semibold text-[var(--land-ink)] underline underline-offset-4">
                Войти
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
