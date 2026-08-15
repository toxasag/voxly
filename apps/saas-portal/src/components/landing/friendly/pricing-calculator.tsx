'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bot,
  Check,
  Gift,
  MessageCircle,
  Minus,
  Plus,
  Send,
  Sparkles,
  Users,
} from 'lucide-react';
import { PRICING } from '@voxly/shared';
import { RegisterLink } from '@/components/landing/register-link';

type CatalogPrices = {
  crm_base: number;
  extra_seat: number;
  gift_bot: number;
  ai_tg: number;
  ai_tg_extra_conn: number;
  ai_gramjs: number;
  ai_max: number;
  ai_wa: number;
  mailing_bot: number;
  mailing_accounts: number;
  mailing_stories: number;
};

type Catalog = {
  seatsIncluded: number;
  secretaryIncludedAccounts: number;
  prices: CatalogPrices;
};

const FALLBACK: Catalog = {
  seatsIncluded: PRICING.SEATS_INCLUDED,
  secretaryIncludedAccounts: PRICING.AI_TELEGRAM_MAX_BUSINESS_CONNECTIONS,
  prices: {
    crm_base: PRICING.CRM_BASE_MONTHLY,
    extra_seat: PRICING.EXTRA_SEAT_MONTHLY,
    gift_bot: PRICING.GIFT_BOT_MONTHLY,
    ai_tg: PRICING.AI_TELEGRAM_MONTHLY,
    ai_tg_extra_conn: PRICING.AI_TG_EXTRA_CONN_MONTHLY,
    ai_gramjs: PRICING.AI_GRAMJS_MONTHLY,
    ai_max: PRICING.AI_MAX_MONTHLY,
    ai_wa: PRICING.AI_WHATSAPP_MONTHLY,
    mailing_bot: PRICING.MAILING_BOT_MONTHLY,
    mailing_accounts: PRICING.MAILING_ACCOUNTS_MONTHLY,
    mailing_stories: PRICING.MAILING_STORIES_MONTHLY,
  },
};

const QTY_MAX = 10;

function rub(n: number) {
  return n.toLocaleString('ru-RU');
}

type Props = { refCode?: string | null };

export function PricingCalculator({ refCode }: Props) {
  const [catalog, setCatalog] = useState<Catalog>(FALLBACK);
  const [seats, setSeats] = useState(1);
  const [gramjsQty, setGramjsQty] = useState(0);
  const [waQty, setWaQty] = useState(0);
  const [maxQty, setMaxQty] = useState(0);
  const [giftQty, setGiftQty] = useState(0);
  const [secretary, setSecretary] = useState(false);
  const [secretaryExtra, setSecretaryExtra] = useState(0);
  const [mailingBot, setMailingBot] = useState(false);
  const [mailingAccounts, setMailingAccounts] = useState(false);
  const [stories, setStories] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/pricing/catalog')
      .then(async (res) => {
        if (!res.ok) return null;
        return res.json() as Promise<{
          seatsIncluded?: number;
          secretaryIncludedAccounts?: number;
          prices?: Partial<CatalogPrices>;
        }>;
      })
      .then((data) => {
        if (cancelled || !data?.prices) return;
        setCatalog({
          seatsIncluded: data.seatsIncluded ?? FALLBACK.seatsIncluded,
          secretaryIncludedAccounts:
            data.secretaryIncludedAccounts ?? FALLBACK.secretaryIncludedAccounts,
          prices: { ...FALLBACK.prices, ...data.prices },
        });
      })
      .catch(() => {
        /* keep FALLBACK */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const p = catalog.prices;
  const included = catalog.seatsIncluded;

  const { lines, total, crmPrice, modulesTotal } = useMemo(() => {
    const extraSeats = Math.max(0, seats - included);
    const crm = p.crm_base + extraSeats * p.extra_seat;
    const rows: { label: string; amount: number }[] = [
      {
        label:
          extraSeats > 0
            ? `CRM (${included} мест + ${extraSeats} доп.)`
            : `CRM (до ${included} мест)`,
        amount: crm,
      },
    ];
    if (gramjsQty > 0) {
      rows.push({ label: `Личный Telegram ×${gramjsQty}`, amount: p.ai_gramjs * gramjsQty });
    }
    if (waQty > 0) {
      rows.push({ label: `Личный WhatsApp ×${waQty}`, amount: p.ai_wa * waQty });
    }
    if (maxQty > 0) {
      rows.push({ label: `Личный MAX ×${maxQty}`, amount: p.ai_max * maxQty });
    }
    if (giftQty > 0) {
      rows.push({ label: `Gift-бот ×${giftQty}`, amount: p.gift_bot * giftQty });
    }
    if (secretary) {
      const sec = p.ai_tg + Math.max(0, secretaryExtra) * p.ai_tg_extra_conn;
      rows.push({
        label:
          secretaryExtra > 0
            ? `Секретарь (+${secretaryExtra} акк.)`
            : 'Телеграм Секретарь',
        amount: sec,
      });
    }
    if (mailingBot) rows.push({ label: 'Рассылка из ботов', amount: p.mailing_bot });
    if (mailingAccounts) rows.push({ label: 'Рассылка с аккаунтов', amount: p.mailing_accounts });
    if (stories) rows.push({ label: 'Постинг Stories', amount: p.mailing_stories });

    const sum = rows.reduce((acc, r) => acc + r.amount, 0);
    return {
      lines: rows,
      total: sum,
      crmPrice: crm,
      modulesTotal: sum - crm,
    };
  }, [
    seats,
    included,
    p,
    gramjsQty,
    waQty,
    maxQty,
    giftQty,
    secretary,
    secretaryExtra,
    mailingBot,
    mailingAccounts,
    stories,
  ]);

  const maxSeats = Math.max(included + 10, 20);
  const seatProgress = Math.min(100, ((seats - 1) / (maxSeats - 1)) * 100);

  return (
    <div className="overflow-hidden rounded-xl border border-[rgba(2,8,23,0.1)] bg-white shadow-[0_24px_60px_-40px_rgba(2,8,23,0.35)]">
      <div className="grid lg:grid-cols-[1.15fr_0.85fr]">
        {/* Config */}
        <div className="space-y-8 p-5 sm:p-8 lg:p-9">
          {/* CRM seats */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#020817] text-white">
                <Users className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h3 className="text-base font-semibold text-[#020817]">Команда в CRM</h3>
                <p className="text-xs text-[#64686f]">
                  База {rub(p.crm_base)} ₽ · до {included} мест · далее +{rub(p.extra_seat)} ₽
                </p>
              </div>
            </div>

            <div className="rounded-lg bg-[#fafafa] p-4 ring-1 ring-[rgba(2,8,23,0.08)] sm:p-5">
              <div className="flex items-end justify-between gap-3">
                <p className="text-sm font-medium text-[#4b5160]">Сотрудников</p>
                <p className="tabular-nums text-3xl font-semibold tracking-tight text-[#020817]">
                  {seats}
                  <span className="ml-1 text-sm font-medium text-[#9aa0aa]">/ {included}+</span>
                </p>
              </div>
              <input
                type="range"
                min={1}
                max={maxSeats}
                value={seats}
                onChange={(e) => setSeats(Number(e.target.value))}
                className="vx-range mt-5 w-full"
                aria-valuetext={`${seats} сотрудник${seats === 1 ? '' : seats < 5 ? 'а' : 'ов'}`}
                style={
                  {
                    background: `linear-gradient(to right, #8261fb 0%, #8261fb ${seatProgress}%, #e6e7ec ${seatProgress}%, #e6e7ec 100%)`,
                  } as React.CSSProperties
                }
              />
              <div className="mt-3 flex flex-wrap gap-2">
                {[1, included, Math.min(included + 2, maxSeats)]
                  .filter((n, i, a) => a.indexOf(n) === i)
                  .map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setSeats(n)}
                      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                        seats === n
                          ? 'bg-[#020817] text-white'
                          : 'bg-white text-[#4b5160] ring-1 ring-[rgba(2,8,23,0.12)] hover:ring-[#8261fb]'
                      }`}
                    >
                      {n === included ? `${n} мест` : `${n}`}
                    </button>
                  ))}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 ring-1 ring-emerald-100">
              <Check className="h-4 w-4 shrink-0" aria-hidden />
              Заявки с сайтов (Tilda / WordPress) — всегда бесплатно
            </div>
          </section>

          {/* Channels qty */}
          <section>
            <GroupTitle
              icon={<MessageCircle className="h-4 w-4" />}
              title="Личные мессенджеры"
              hint="Можно несколько аккаунтов"
              tone="sky"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <QtyCard
                accent="bg-[#2AABEE]"
                label="Telegram"
                unitPrice={p.ai_gramjs}
                unitHint="аккаунт"
                qty={gramjsQty}
                onChange={setGramjsQty}
              />
              <QtyCard
                accent="bg-[#25D366]"
                label="WhatsApp"
                unitPrice={p.ai_wa}
                unitHint="аккаунт"
                qty={waQty}
                onChange={setWaQty}
              />
              <QtyCard
                accent="bg-violet-500"
                label="MAX"
                unitPrice={p.ai_max}
                unitHint="аккаунт"
                qty={maxQty}
                onChange={setMaxQty}
              />
              <QtyCard
                accent="bg-amber-500"
                label="Gift-бот"
                unitPrice={p.gift_bot}
                unitHint="бот · канал"
                qty={giftQty}
                onChange={setGiftQty}
              />
            </div>
          </section>

          {/* Secretary + mailing */}
          <section>
            <GroupTitle
              icon={<Sparkles className="h-4 w-4" />}
              title="Автоматизация"
              hint="Вкл / выкл модули"
              tone="violet"
            />
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <ToggleCard
                icon={<Bot className="h-4 w-4" />}
                checked={secretary}
                onChange={setSecretary}
                title="Телеграм Секретарь"
                price={`${rub(p.ai_tg)} ₽/мес`}
                detail={`${catalog.secretaryIncludedAccounts} аккаунтов в базе`}
              />
              <ToggleCard
                icon={<Send className="h-4 w-4" />}
                checked={mailingBot}
                onChange={setMailingBot}
                title="Рассылка из ботов"
                price={`${rub(p.mailing_bot)} ₽/мес`}
              />
              <ToggleCard
                icon={<Users className="h-4 w-4" />}
                checked={mailingAccounts}
                onChange={setMailingAccounts}
                title="Рассылка с аккаунтов"
                price={`${rub(p.mailing_accounts)} ₽/мес`}
              />
              <ToggleCard
                icon={<Gift className="h-4 w-4" />}
                checked={stories}
                onChange={setStories}
                title="Постинг Stories"
                price={`${rub(p.mailing_stories)} ₽/мес`}
              />
            </div>
            {secretary ? (
              <div className="mt-3 rounded-lg bg-[#f4f2ff] p-4 ring-1 ring-[rgba(130,97,251,0.18)]">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-[#3a4050]">Доп. аккаунты секретаря</p>
                    <p className="text-xs text-[#64686f]">
                      +{rub(p.ai_tg_extra_conn)} ₽ сверх {catalog.secretaryIncludedAccounts}
                    </p>
                  </div>
                  <span className="tabular-nums text-xl font-semibold text-[#8261fb]">
                    {secretaryExtra}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={20}
                  value={secretaryExtra}
                  onChange={(e) => setSecretaryExtra(Number(e.target.value))}
                  className="vx-range mt-3 w-full"
                />
              </div>
            ) : null}
          </section>
        </div>

        {/* Summary */}
        <aside className="relative flex flex-col justify-between bg-[#0a0b07] p-5 text-white sm:p-8 lg:p-9">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                'radial-gradient(ellipse 80% 50% at 20% 0%, rgba(130,97,251,0.4), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(224,254,86,0.16), transparent 50%)',
            }}
            aria-hidden
          />
          <div className="relative">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#e0fe56]">
              Ваша оценка
            </p>
            <p className="mt-3 flex items-baseline gap-2">
              <span className="tabular-nums text-4xl font-semibold tracking-tight sm:text-5xl">
                {rub(total)}
              </span>
              <span className="text-base font-medium text-white/50">₽ / мес</span>
            </p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/80">
                CRM {rub(crmPrice)} ₽
              </span>
              {modulesTotal > 0 ? (
                <span className="rounded-full bg-[#e0fe56]/15 px-2.5 py-1 text-[#e0fe56]">
                  Модули {rub(modulesTotal)} ₽
                </span>
              ) : (
                <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/70">
                  Только CRM
                </span>
              )}
            </div>

            <ul className="mt-6 max-h-[14rem] space-y-2.5 overflow-y-auto text-sm">
              {lines.map((line) => (
                <li
                  key={line.label}
                  className="flex items-center justify-between gap-3 border-b border-white/10 pb-2.5 last:border-0"
                >
                  <span className="text-white/70">{line.label}</span>
                  <span className="tabular-nums font-medium text-white">{rub(line.amount)} ₽</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative mt-8 space-y-3">
            <p className="rounded-md bg-[#e0fe56]/15 px-3 py-2.5 text-sm font-medium text-[#e0fe56] ring-1 ring-[#e0fe56]/20">
              Цены как в кабинете · формы бесплатно · без скрытых платежей
            </p>
            <RegisterLink
              refCode={refCode}
              className="vx-btn-lime flex w-full items-center justify-center touch-manipulation"
            >
              Тестировать 7 дней бесплатно
            </RegisterLink>
            <p className="text-center text-xs text-white/50">Без карты · полный доступ</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function GroupTitle({
  icon,
  title,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  hint: string;
  tone: 'sky' | 'violet';
}) {
  const toneCls =
    tone === 'sky'
      ? 'bg-[#e6f6fd] text-[#0e86c4] ring-[rgba(14,134,196,0.15)]'
      : 'bg-[#f4f2ff] text-[#8261fb] ring-[rgba(130,97,251,0.18)]';
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${toneCls}`}>
          {icon}
        </span>
        <h3 className="text-base font-semibold text-[#020817]">{title}</h3>
      </div>
      <span className="hidden text-xs text-[#9aa0aa] sm:inline">{hint}</span>
    </div>
  );
}

function QtyCard({
  accent,
  label,
  unitPrice,
  unitHint,
  qty,
  onChange,
}: {
  accent: string;
  label: string;
  unitPrice: number;
  unitHint: string;
  qty: number;
  onChange: (n: number) => void;
}) {
  const active = qty > 0;
  return (
    <div
      className={`rounded-lg p-3.5 transition ring-1 ${
        active
          ? 'bg-[#f4f2ff] ring-[rgba(130,97,251,0.3)] shadow-sm'
          : 'bg-white ring-[rgba(2,8,23,0.1)] hover:ring-[rgba(2,8,23,0.2)]'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${accent}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#020817]">{label}</p>
          <p className="mt-0.5 text-xs text-[#64686f]">
            {rub(unitPrice)} ₽ · {unitHint}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="tabular-nums text-xs font-medium text-[#64686f]">
          {qty > 0 ? `${rub(unitPrice * qty)} ₽` : 'не выбрано'}
        </span>
        <div className="flex items-center gap-1" role="group" aria-label={label}>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-[#3a4050] ring-1 ring-[rgba(2,8,23,0.12)] transition hover:ring-[#8261fb] disabled:opacity-35"
            disabled={qty <= 0}
            onClick={() => onChange(Math.max(0, qty - 1))}
            aria-label="Меньше"
          >
            <Minus className="h-3.5 w-3.5" aria-hidden />
          </button>
          <span className="min-w-[1.5rem] text-center tabular-nums text-sm font-semibold text-[#020817]">
            {qty}
          </span>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-md bg-[#020817] text-white transition hover:bg-[#1a2233] disabled:opacity-35"
            disabled={qty >= QTY_MAX}
            onClick={() => onChange(Math.min(QTY_MAX, qty + 1))}
            aria-label="Больше"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}

function ToggleCard({
  icon,
  checked,
  onChange,
  title,
  price,
  detail,
}: {
  icon: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  price: string;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={`rounded-lg p-3.5 text-left transition ring-1 ${
        checked
          ? 'bg-[#f4f2ff] ring-[rgba(130,97,251,0.3)] shadow-sm'
          : 'bg-white ring-[rgba(2,8,23,0.1)] hover:ring-[rgba(2,8,23,0.2)]'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            checked ? 'bg-[#8261fb] text-white' : 'bg-[#f3f4f6] text-[#4b5160]'
          }`}
        >
          {icon}
        </span>
        <span
          className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md ring-1 ${
            checked ? 'bg-[#8261fb] ring-[#8261fb] text-white' : 'bg-white ring-[rgba(2,8,23,0.2)]'
          }`}
          aria-hidden
        >
          {checked ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      </div>
      <p className="mt-3 text-sm font-semibold text-[#020817]">{title}</p>
      <p className="mt-0.5 text-xs font-medium text-[#4b5160]">{price}</p>
      {detail ? <p className="mt-1 text-[11px] text-[#9aa0aa]">{detail}</p> : null}
    </button>
  );
}
