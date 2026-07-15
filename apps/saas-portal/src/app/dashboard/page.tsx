'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface UserData {
  id: string;
  email: string;
  firstName: string;
  role: string;
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: string;
    subscription: any;
    addons: any[];
    aiWallet: any;
    referralCode: { code: string } | null;
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }

    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => setUser(data))
      .catch(() => {
        localStorage.removeItem('voxly_token');
        router.push('/login');
      })
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) {
    return <div style={{ padding: 40, textAlign: 'center', color: '#a1a1aa' }}>Загрузка...</div>;
  }

  if (!user) return null;

  const sub = user.tenant.subscription;
  const isSuperadmin = user.role === 'superadmin';

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>{user.tenant.name}</h1>
          <p style={{ color: '#a1a1aa' }}>{user.email}</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {isSuperadmin && (
            <a href="/admin" style={navBtnStyle}>Админка</a>
          )}
          <button
            onClick={() => {
              localStorage.removeItem('voxly_token');
              router.push('/');
            }}
            style={navBtnStyle}
          >
            Выйти
          </button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard label="Статус подписки" value={sub?.status === 'active' ? '✅ Активна' : '❌ Неактивна'} />
        <StatCard label="Тариф" value={sub?.plan || '—'} />
        <StatCard label="AI-баланс" value={`${user.tenant.aiWallet?.balanceRub || 0} ₽`} />
        <StatCard
          label="Реферальный код"
          value={user.tenant.referralCode?.code || '—'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
        {/* Subscription */}
        <Section title="Подписка">
          {sub?.status === 'active' ? (
            <>
              <p style={muted}>Тариф: {sub.plan}</p>
              <p style={muted}>Действует до: {sub.expiresAt ? new Date(sub.expiresAt).toLocaleDateString('ru-RU') : '—'}</p>
              <p style={muted}>Пользователей: {sub.seatsUsed} / {sub.seatsIncluded}</p>
              <button style={primaryBtn}>Продлить</button>
            </>
          ) : (
            <>
              <p style={muted}>Подписка не активна</p>
              <button style={primaryBtn}>Оформить подписку — 500 ₽/мес</button>
            </>
          )}
        </Section>

        {/* Add-ons */}
        <Section title="Дополнения">
          {user.tenant.addons?.length === 0 ? (
            <p style={muted}>Нет активных дополнений</p>
          ) : (
            user.tenant.addons?.map((a) => (
              <div key={a.id} style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 8, marginBottom: 8 }}>
                <strong>{a.type}</strong>
                <p style={muted}>Статус: {a.status}</p>
              </div>
            ))
          )}
        </Section>

        {/* AI Wallet */}
        <Section title="AI-баланс">
          <p style={{ fontSize: 32, fontWeight: 700, marginBottom: 16 }}>
            {user.tenant.aiWallet?.balanceRub || 0} ₽
          </p>
          <button style={primaryBtn}>Пополнить</button>
        </Section>

        {/* Referral */}
        <Section title="Реферальная программа">
          <p style={muted}>Ваш код: <strong style={{ color: 'white' }}>{user.tenant.referralCode?.code}</strong></p>
          <p style={muted}>
            Ссылка:{' '}
            <a
              href={`https://getvoxly.ru/r/${user.tenant.referralCode?.code}`}
              style={{ color: '#6366f1' }}
            >
              getvoxly.ru/r/{user.tenant.referralCode?.code}
            </a>
          </p>
        </Section>

        {/* CRM Access */}
        <Section title="CRM">
          <a
            href={`https://${user.tenant.slug}.app.getvoxly.ru`}
            style={primaryBtn}
          >
            Открыть Twenty CRM →
          </a>
        </Section>
      </div>
    </main>
  );
}

const muted: React.CSSProperties = { color: '#a1a1aa', fontSize: 14, marginBottom: 8 };
const navBtnStyle: React.CSSProperties = { padding: '10px 20px', background: 'rgba(255,255,255,0.05)', color: 'white', borderRadius: 8, fontSize: 14, border: '1px solid rgba(255,255,255,0.1)' };
const primaryBtn: React.CSSProperties = { padding: '12px 24px', background: '#6366f1', color: 'white', borderRadius: 8, fontSize: 15, fontWeight: 600, display: 'inline-block', marginTop: 12 };

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
      <p style={{ color: '#71717a', fontSize: 13, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 600 }}>{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: 24, background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>{title}</h3>
      {children}
    </div>
  );
}
