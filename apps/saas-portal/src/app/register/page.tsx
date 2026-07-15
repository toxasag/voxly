'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
      setError('Название воркспейса: латиница, цифры или дефис (минимум 2 символа)');
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
      let data: any = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(text || 'Registration failed');
      }

      if (!res.ok) {
        const errMsg =
          typeof data?.error === 'string'
            ? data.error
            : data?.error
              ? JSON.stringify(data.error)
              : 'Registration failed';
        throw new Error(errMsg);
      }

      localStorage.setItem('voxly_token', data.token);
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 480 }}>
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Регистрация</h1>
        <p style={{ color: '#a1a1aa', marginBottom: 32 }}>Создайте воркспейс Voxly за 1 минуту</p>

        {error && (
          <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', borderRadius: 12, marginBottom: 24, color: '#ef4444' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <input
            type="text"
            placeholder="Имя"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Пароль"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Slug воркспейса (например: my-company)"
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
            required
            minLength={2}
            maxLength={50}
            title="Только латиница, цифры и дефис"
            style={inputStyle}
          />
          <input
            type="text"
            placeholder="Реферальный код (необязательно)"
            value={refCode}
            onChange={(e) => setRefCode(e.target.value)}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '16px 32px', background: '#6366f1', color: 'white', borderRadius: 12, fontSize: 18, fontWeight: 600, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Создание...' : 'Создать аккаунт'}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', color: '#a1a1aa' }}>
          Уже есть аккаунт? <a href="/login" style={{ color: '#6366f1' }}>Войти</a>
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '14px 16px',
  background: 'rgba(255,255,255,0.05)',
  borderRadius: 12,
  border: '1px solid rgba(255,255,255,0.1)',
  color: 'white',
  fontSize: 16,
  outline: 'none',
};
