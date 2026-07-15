'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AdminStats {
  totalTenants: number;
  activeTenants: number;
  mrr: number;
  aiRevenue: number;
  aiMargin: number;
}

export default function AdminPage() {
  const router = useRouter();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [tenants, setTenants] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('voxly_token');
    if (!token) {
      router.push('/login');
      return;
    }

    Promise.all([
      fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
      fetch('/api/admin/tenants', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    ])
      .then(([s, t]) => {
        setStats(s);
        setTenants(t.tenants || []);
      })
      .catch(() => router.push('/login'))
      .finally(() => setLoading(false));
  }, [router]);

  if (loading) return <div style={{ padding: 40, color: '#a1a1aa' }}>Загрузка...</div>;
  if (!stats) return <div style={{ padding: 40, color: '#ef4444' }}>Доступ запрещён</div>;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '40px 24px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 32 }}>Супер-админка</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
        <StatCard label="Всего клиентов" value={String(stats.totalTenants)} />
        <StatCard label="Активных" value={String(stats.activeTenants)} />
        <StatCard label="MRR" value={`${stats.mrr} ₽`} />
        <StatCard label="AI доход" value={`${stats.aiRevenue} ₽`} />
        <StatCard label="AI маржа" value={`${stats.aiMargin} ₽`} />
      </div>

      <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Клиенты</h2>
      <div style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 16, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <th style={thStyle}>Название</th>
              <th style={thStyle}>Slug</th>
              <th style={thStyle}>Статус</th>
              <th style={thStyle}>Подписка</th>
              <th style={thStyle}>AI баланс</th>
              <th style={thStyle}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                <td style={tdStyle}>{t.name}</td>
                <td style={tdStyle}>{t.slug}</td>
                <td style={tdStyle}>{t.status}</td>
                <td style={tdStyle}>{t.subscription?.plan || '—'}</td>
                <td style={tdStyle}>{t.aiWallet?.balanceRub || 0} ₽</td>
                <td style={tdStyle}>
                  <a href={`/admin/tenant/${t.id}`} style={{ color: '#6366f1' }}>Детали</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

const thStyle: React.CSSProperties = { padding: 16, textAlign: 'left', fontSize: 13, color: '#71717a', fontWeight: 500 };
const tdStyle: React.CSSProperties = { padding: 16, fontSize: 14 };

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ padding: 20, background: 'rgba(255,255,255,0.03)', borderRadius: 12, border: '1px solid rgba(255,255,255,0.05)' }}>
      <p style={{ color: '#71717a', fontSize: 13, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700 }}>{value}</p>
    </div>
  );
}
