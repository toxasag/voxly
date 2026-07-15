'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
        throw new Error(data.error || 'Login failed');
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
        <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 8 }}>Вход</h1>
        <p style={{ color: '#a1a1aa', marginBottom: 32 }}>Войдите в ваш воркспейс Voxly</p>

        {error && (
          <div style={{ padding: 16, background: 'rgba(239,68,68,0.1)', borderRadius: 12, marginBottom: 24, color: '#ef4444' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
          <button
            type="submit"
            disabled={loading}
            style={{ padding: '16px 32px', background: '#6366f1', color: 'white', borderRadius: 12, fontSize: 18, fontWeight: 600, opacity: loading ? 0.5 : 1 }}
          >
            {loading ? 'Вход...' : 'Войти'}
          </button>
        </form>

        <p style={{ marginTop: 24, textAlign: 'center', color: '#a1a1aa' }}>
          Нет аккаунта? <a href="/register" style={{ color: '#6366f1' }}>Зарегистрироваться</a>
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
