'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/portal/alert';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [refCode, setRefCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const companySlug = workspaceName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!companySlug || companySlug.length < 2) {
      setError('Slug воркспейса: латиница, цифры или дефис (минимум 2 символа)');
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Пароль должен быть не короче 8 символов');
      setLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
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
      let data: { token?: string; error?: unknown } | null = null;
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

      if (!data?.token) throw new Error('Нет токена в ответе');
      localStorage.setItem('voxly_token', data.token);
      router.push('/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6 py-16">
      <div className="w-full max-w-md animate-in">
        <div className="mb-8 text-center">
          <Link
            href="/"
            className="text-[24px] font-semibold tracking-[-0.025em] text-ink transition-opacity duration-[var(--duration-fast)] hover:opacity-70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hairline"
          >
            Voxly
          </Link>
          <p className="mt-2 text-sm text-mid-gray">Новый воркспейс</p>
        </div>
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-[24px] tracking-[-0.025em]">Регистрация</CardTitle>
            <CardDescription>Создайте воркспейс за минуту</CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert className="mb-4" variant="error">
                {error}
              </Alert>
            )}
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="space-y-1.5">
                <Label htmlFor="firstName">Имя</Label>
                <Input
                  id="firstName"
                  name="given-name"
                  autoComplete="given-name"
                  placeholder="Как к вам обращаться"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  placeholder="you@company.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Пароль</Label>
                <Input
                  id="password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="Не меньше 8 символов"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="workspace">Slug воркспейса</Label>
                <Input
                  id="workspace"
                  name="organization"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  placeholder="my-company"
                  required
                  minLength={2}
                  maxLength={50}
                  title="Только латиница, цифры и дефис"
                />
                <p className="text-xs text-mid-gray">Латиница, цифры, дефис · станет адресом кабинета</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ref">Реферальный код</Label>
                <Input
                  id="ref"
                  name="referral"
                  value={refCode}
                  onChange={(e) => setRefCode(e.target.value)}
                  placeholder="необязательно"
                />
              </div>
              <Button type="submit" variant="solid" className="mt-1 w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loading ? 'Создание…' : 'Создать аккаунт'}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-mid-gray">
              Уже есть аккаунт?{' '}
              <Link href="/login" className="font-medium text-ink underline-offset-4 hover:underline">
                Войти
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
