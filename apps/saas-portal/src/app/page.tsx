import Link from 'next/link';

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section style={{ padding: '120px 24px', textAlign: 'center', maxWidth: 1200, margin: '0 auto' }}>
        <h1 style={{ fontSize: 64, fontWeight: 700, marginBottom: 24, letterSpacing: -2 }}>
          CRM для чат-ботов
          <br />
          <span style={{ background: 'linear-gradient(90deg, #6366f1, #a855f7)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            и AI-ассистентов
          </span>
        </h1>
        <p style={{ fontSize: 22, color: '#a1a1aa', maxWidth: 700, margin: '0 auto 40px' }}>
          Voxly объединяет Telegram-ботов, WhatsApp AI-ассистентов и CRM в одной платформе.
          Автоматизируйте воронки, общайтесь с клиентами, отслеживайте конверсии.
        </p>
        <div style={{ display: 'flex', gap: 16, justifyContent: 'center' }}>
          <Link href="/register" style={{ padding: '16px 32px', background: '#6366f1', color: 'white', borderRadius: 12, fontSize: 18, fontWeight: 600 }}>
            Начать бесплатно
          </Link>
          <Link href="/login" style={{ padding: '16px 32px', background: 'rgba(255,255,255,0.05)', color: 'white', borderRadius: 12, fontSize: 18, fontWeight: 600, border: '1px solid rgba(255,255,255,0.1)' }}>
            Войти
          </Link>
        </div>
        <p style={{ marginTop: 24, color: '#71717a', fontSize: 14 }}>
          500 ₽/мес · 10 пользователей включено · 14 дней бесплатно
        </p>
      </section>

      {/* Features */}
      <section style={{ padding: '80px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24 }}>
          {[
            { icon: '🤖', title: 'Gift-боты', desc: 'Воронки, проверка подписки на канал, отложенные сообщения, рассылки' },
            { icon: '✨', title: 'AI Telegram', desc: 'Умный ассистент для Telegram. Handoff оператору при необходимости' },
            { icon: '💬', title: 'AI WhatsApp', desc: 'AI-ассистент для WhatsApp Cloud API. Та же логика, другой канал' },
            { icon: '📊', title: 'Сквозная аналитика', desc: 'Метрика, GA4, Facebook, VK. Offline-конверсии из ботов' },
            { icon: '👥', title: 'Реферальная программа', desc: 'Привлекайте клиентов и получайте кредиты на баланс' },
            { icon: '🔗', title: 'Twenty CRM', desc: 'Полноценная CRM на базе Twenty. Контакты, сделки, воронки' },
          ].map((f) => (
            <div key={f.title} style={{ padding: 32, background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 32, marginBottom: 16 }}>{f.icon}</div>
              <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>{f.title}</h3>
              <p style={{ color: '#a1a1aa', fontSize: 15 }}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section style={{ padding: '80px 24px', maxWidth: 1200, margin: '0 auto' }}>
        <h2 style={{ fontSize: 40, fontWeight: 700, textAlign: 'center', marginBottom: 48 }}>Тарифы</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
          {[
            { name: 'CRM Base', price: '500 ₽', period: '/мес', features: ['10 пользователей', 'Twenty CRM', 'Безлимит контактов', 'API доступ'] },
            { name: 'Gift Bot', price: '500 ₽', period: '/канал/мес', features: ['Воронки', 'Проверка подписки', 'Рассылки', 'Отложенные сообщения'] },
            { name: 'AI Telegram', price: '1000 ₽', period: '/10 акк/мес', features: ['AI-ассистент', 'Handoff оператору', '10 аккаунтов', 'AI баланс отдельно'] },
            { name: 'AI WhatsApp', price: '1000 ₽', period: '/номер/мес', features: ['AI-ассистент', 'WhatsApp Cloud API', 'Handoff оператору', 'AI баланс отдельно'] },
            { name: 'Аналитика', price: '500 ₽', period: '/платформа/мес', features: ['Яндекс Метрика', 'Google Analytics 4', 'Facebook CAPI', 'VK Pixel'] },
          ].map((plan) => (
            <div key={plan.name} style={{ padding: 32, background: 'rgba(255,255,255,0.03)', borderRadius: 16, border: '1px solid rgba(255,255,255,0.05)' }}>
              <h3 style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>{plan.name}</h3>
              <div style={{ fontSize: 36, fontWeight: 700, marginBottom: 24 }}>
                {plan.price}
                <span style={{ fontSize: 16, fontWeight: 400, color: '#71717a' }}>{plan.period}</span>
              </div>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {plan.features.map((f) => (
                  <li key={f} style={{ padding: '8px 0', color: '#a1a1aa', fontSize: 15 }}>
                    ✓ {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer style={{ padding: '40px 24px', textAlign: 'center', color: '#71717a', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <p>© 2026 Voxly · getvoxly.ru</p>
      </footer>
    </main>
  );
}
