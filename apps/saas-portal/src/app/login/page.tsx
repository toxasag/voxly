'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, ExternalLink, Loader2 } from 'lucide-react';
import { AuthShell } from '@/components/landing/friendly/auth-shell';

type OtpChallenge = {
  needsOtp: true;
  nonce: string;
  botDeepLink: string;
  botUsername: string;
  needsTelegramLink?: boolean;
  codeSent?: boolean;
  message?: string;
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otp, setOtp] = useState<OtpChallenge | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const finishLogin = (data: {
    token: string;
    user?: { role?: string; tenantRole?: string };
  }) => {
    localStorage.setItem('voxly_token', data.token);
    router.push(
      data.user?.role === 'superadmin'
        ? '/admin'
        : data.user?.tenantRole === 'member'
          ? '/dashboard/crm'
          : '/dashboard',
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (otp) {
        const res = await fetch('/api/auth/login/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nonce: otp.nonce, code: otpCode.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Неверный код');
        finishLogin(data);
        return;
      }

      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Не удалось войти');

      if (data.needsOtp && data.nonce) {
        setOtp(data as OtpChallenge);
        return;
      }
      if (!data.token) throw new Error('Нет токена в ответе');
      finishLogin(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Вход в кабинет"
      title="С возвращением."
      subtitle="Email, пароль и код из Telegram-бота @GetVoxlybot."
      headerAction={{ href: '/register', label: '7 дней бесплатно' }}
    >
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
        {otp ? 'Код из Telegram' : 'Войти'}
      </h2>
      <p className="mt-2 text-sm text-slate-500">
        {otp ? otp.message || 'Откройте бота и введите код' : 'Нет аккаунта? Сначала 7 дней trial.'}
      </p>

      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800"
        >
          {error}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {!otp ? (
          <>
            <Field
              id="email"
              label="Email"
              type="email"
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
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={setPassword}
              required
            />
          </>
        ) : (
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
              ← Назад к email/паролю
            </button>
          </>
        )}

        <button type="submit" className="friendly-btn w-full touch-manipulation" disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {loading ? 'Проверяем…' : otp ? 'Подтвердить' : 'Войти'}
          {!loading ? <ArrowRight className="h-4 w-4" aria-hidden /> : null}
        </button>
      </form>

      <p className="mt-8 text-sm text-slate-500">
        Нет аккаунта?{' '}
        <Link href="/register" className="font-semibold text-blue-600 underline-offset-4 hover:underline">
          Зарегистрироваться
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
