'use client';

export type RuleDraft = {
  type: string;
  value: number;
  durationMonths: number | null;
};

export const RULE_TYPE_OPTIONS: Array<{
  value: string;
  label: string;
  unit: '%' | '₽';
  hint: string;
}> = [
  {
    value: 'percent_recurring',
    label: 'Процент с каждой оплаты клиента',
    unit: '%',
    hint: 'Начисляем партнёру процент с каждой оплаты приведённого клиента. Срок можно ограничить месяцами.',
  },
  {
    value: 'percent_first_payment',
    label: 'Процент с первой оплаты',
    unit: '%',
    hint: 'Начисляем один раз — когда клиент оплатил впервые.',
  },
  {
    value: 'fixed_first_payment',
    label: 'Фиксированная сумма за клиента',
    unit: '₽',
    hint: 'Разовая сумма в рублях за каждого клиента, который оплатил.',
  },
  {
    value: 'credit_discount',
    label: 'Скидка на собственную оплату',
    unit: '₽',
    hint: 'Партнёр получает сумму скидкой на свою оплату Voxly, а не деньгами.',
  },
  {
    value: 'credit',
    label: 'Бонус на партнёрский баланс',
    unit: '₽',
    hint: 'Разовый бонус в рублях на баланс партнёра.',
  },
];

export const PRODUCT_SCOPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'Все оплаты' },
  { value: 'subscriptions', label: 'Подписки' },
  { value: 'crm', label: 'Только CRM' },
];

export function formatRub(n: number): string {
  return Math.round(n).toLocaleString('ru-RU');
}

export function ruleUnit(type: string): '%' | '₽' {
  return RULE_TYPE_OPTIONS.find((o) => o.value === type)?.unit ?? '₽';
}

export function rewardLabel(rule: RuleDraft | null): string {
  if (!rule || rule.type === 'none') return 'ставка не настроена';
  if (rule.type === 'percent_recurring') {
    return rule.durationMonths
      ? `${rule.value}% с каждой оплаты клиента, первые ${rule.durationMonths} мес.`
      : `${rule.value}% с каждой оплаты клиента, без ограничения по сроку`;
  }
  if (rule.type === 'percent_first_payment') return `${rule.value}% с первой оплаты клиента`;
  if (rule.type === 'fixed_first_payment')
    return `${formatRub(rule.value)} ₽ за каждого платящего клиента`;
  if (rule.type === 'credit_discount')
    return `${formatRub(rule.value)} ₽ скидкой на собственную оплату`;
  if (rule.type === 'credit') return `${formatRub(rule.value)} ₽ бонусом на баланс`;
  return `${formatRub(rule.value)} — нестандартное условие (${rule.type})`;
}

const FIELD =
  'mt-1.5 min-h-11 w-full cursor-pointer rounded-xl border border-black/15 bg-white px-3 text-sm outline-none focus:border-black/40';
const LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-black/45';

export function RuleFields({
  draft,
  onChange,
  disabled,
  idPrefix,
}: {
  draft: RuleDraft;
  onChange: (next: RuleDraft) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  const option = RULE_TYPE_OPTIONS.find((o) => o.value === draft.type);
  const isRecurring = draft.type === 'percent_recurring';

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm" htmlFor={`${idPrefix}-type`}>
          <span className={LABEL}>Что получает партнёр</span>
          <select
            id={`${idPrefix}-type`}
            value={draft.type}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, type: e.target.value })}
            className={`${FIELD} disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {RULE_TYPE_OPTIONS.every((o) => o.value !== draft.type) ? (
              <option value={draft.type}>{draft.type}</option>
            ) : null}
            {RULE_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm" htmlFor={`${idPrefix}-value`}>
          <span className={LABEL}>
            {option?.unit === '%' ? 'Ставка, %' : 'Сумма, ₽'}
          </span>
          <input
            id={`${idPrefix}-value`}
            type="number"
            min={0}
            max={option?.unit === '%' ? 100 : undefined}
            step={option?.unit === '%' ? 0.5 : 50}
            value={draft.value}
            disabled={disabled}
            onChange={(e) => onChange({ ...draft, value: Number(e.target.value) })}
            className={`${FIELD} tabular-nums disabled:cursor-not-allowed disabled:opacity-50`}
          />
        </label>
        {isRecurring ? (
          <label className="block text-sm" htmlFor={`${idPrefix}-duration`}>
            <span className={LABEL}>Начислять, мес.</span>
            <input
              id={`${idPrefix}-duration`}
              type="number"
              min={1}
              max={120}
              placeholder="без ограничения"
              value={draft.durationMonths ?? ''}
              disabled={disabled}
              onChange={(e) =>
                onChange({
                  ...draft,
                  durationMonths: e.target.value === '' ? null : Number(e.target.value),
                })
              }
              className={`${FIELD} tabular-nums disabled:cursor-not-allowed disabled:opacity-50`}
            />
          </label>
        ) : null}
      </div>
      <p className="text-xs leading-snug text-black/55">
        {option?.hint ?? 'Нестандартный тип условия — задан не через эту форму.'}
      </p>
    </div>
  );
}
