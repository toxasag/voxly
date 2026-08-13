'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/landing/friendly/auth-shell';
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
        <div className="friendly-lp flex min-h-screen items-center justify-center bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
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
    <AuthShell
      eyebrow="7 дней без карты"
      title="Запусти кабинет за минуту."
      subtitle="CRM, мессенджеры и заявки с сайта в одном месте. Сначала пробуешь — потом решаешь."
      headerAction={{ href: '/login', label: 'Войти' }}
    >
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {otp ? 'Код из Telegram' : 'Регистрация'}
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        {otp
          ? otp.message || 'Откройте @GetVoxlybot и введите код'
          : 'Заполни поля, подтверди код в боте — и в кабинет.'}
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
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
              className="friendly-btn flex w-full items-center justify-center gap-2 touch-manipulation"
            >
              Открыть @{otp.botUsername}
              <ExternalLink className="h-4 w-4" aria-hidden />
            </a>
            <Field
              id="otp"
              label="Код из бота"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="6 цифр"
              value={otpCode}
              onChange={setOtpCode}
              required
              className="tracking-widest"
            />
            <button
              type="button"
              className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-800 hover:underline"
              onClick={() => {
                setOtp(null);
                setOtpCode('');
                setError('');
              }}
            >
              ← Изменить данные
            </button>
          </>
        ) : (
          <>
            <Field
              id="firstName"
              label="Имя"
              autoComplete="given-name"
              name="given-name"
              placeholder="Как к тебе обращаться"
              value={firstName}
              onChange={setFirstName}
              required
            />
            <Field
              id="email"
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@company.ru"
              value={email}
              onChange={setEmail}
              required
            />
            <Field
              id="password"
              label="Пароль"
              type="password"
              name="new-password"
              autoComplete="new-password"
              placeholder="Не меньше 8 символов"
              value={password}
              onChange={setPassword}
              required
              minLength={8}
            />
            <div>
              <label htmlFor="workspace" className="mb-1.5 block text-sm font-medium text-slate-800">
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
                className="friendly-input w-full"
              />
              <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                Это имя вашего воркспейса / CRM-портала.
                {companySlug.length >= 2 ? (
                  <>
                    {' '}
                    Адрес кабинета: <span className="font-semibold text-slate-800">{companySlug}</span>
                  </>
                ) : (
                  <> Из названия сделаем латинский адрес для ссылки.</>
                )}
              </p>
            </div>
            <Field
              id="ref"
              label="Реферальный код"
              name="referral"
              placeholder="Если есть — сюда"
              value={refCode}
              onChange={setRefCode}
            />
            <label
              htmlFor="legal"
              className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"
            >
              <input
                id="legal"
                type="checkbox"
                checked={acceptedLegal}
                onChange={(e) => setAcceptedLegal(e.target.checked)}
                required
                aria-required="true"
                className="mt-1 h-5 w-5 shrink-0 accent-blue-600"
              />
              <span className="text-sm leading-snug text-slate-600">
                Принимаю{' '}
                <Link
                  href="/terms"
                  className="font-semibold text-blue-600 underline underline-offset-4"
                  target="_blank"
                >
                  оферту
                </Link>{' '}
                и{' '}
                <Link
                  href="/consent"
                  className="font-semibold text-blue-600 underline underline-offset-4"
                  target="_blank"
                >
                  согласие на обработку ПДн
                </Link>
                . Читал{' '}
                <Link
                  href="/privacy"
                  className="font-semibold text-blue-600 underline underline-offset-4"
                  target="_blank"
                >
                  политику
                </Link>{' '}
                и{' '}
                <Link
                  href="/refund"
                  className="font-semibold text-blue-600 underline underline-offset-4"
                  target="_blank"
                >
                  правила возврата
                </Link>
                .
              </span>
            </label>
          </>
        )}

        <button
          type="submit"
          className="friendly-btn w-full touch-manipulation"
          disabled={loading || (!otp && !acceptedLegal)}
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {loading ? 'Проверяем…' : otp ? 'Подтвердить и создать' : 'Продолжить'}
          {!loading ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </button>
      </form>

      <p className="mt-7 text-sm text-slate-500">
        Уже есть аккаунт?{' '}
        <Link href="/login" className="font-semibold text-blue-600 underline-offset-4 hover:underline">
          Войти
        </Link>
      </p>
      <p className="mt-3">
        <Link href="/" className="text-sm font-medium text-slate-500 underline-offset-4 hover:underline">
          ← На главную
        </Link>
      </p>
    </AuthShell>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  className = '',
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'className'>) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`friendly-input w-full ${className}`}
        {...rest}
      />
    </div>
  );
}
