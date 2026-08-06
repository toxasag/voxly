'use client';

function formatRub(n: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(n);
}

/**
 * Opt-in «Зачесть партнёрский баланс» for any checkout invoice step.
 * Renders nothing when free balance is 0. Default unchecked.
 */
export function PartnerBalanceApply({
  availableRub,
  invoiceRub,
  useBalance,
  onUseBalanceChange,
  balanceInput,
  onBalanceInputChange,
  appliedRub,
  netRub,
  disabled = false,
  idPrefix = 'partner-balance',
}: {
  availableRub: number;
  invoiceRub: number;
  useBalance: boolean;
  onUseBalanceChange: (on: boolean) => void;
  balanceInput: string;
  onBalanceInputChange: (value: string) => void;
  appliedRub: number;
  netRub: number;
  disabled?: boolean;
  idPrefix?: string;
}) {
  if (availableRub <= 0) return null;

  const balanceCap = Math.min(availableRub, Math.max(0, invoiceRub));
  const coversAll = appliedRub > 0 && netRub <= 0;
  const checkboxId = `${idPrefix}-use`;
  const amountId = `${idPrefix}-amount`;

  return (
    <div className="rounded-lg border border-black/10 bg-white px-3 py-2.5">
      <label
        htmlFor={checkboxId}
        className="flex cursor-pointer items-start gap-2 text-sm text-black"
      >
        <input
          id={checkboxId}
          type="checkbox"
          checked={useBalance}
          disabled={disabled}
          onChange={(e) => onUseBalanceChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[#f5a623] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="leading-snug">
          Зачесть партнёрский баланс
          <span className="block text-xs text-black/50">
            доступно {formatRub(availableRub)} ₽ · по умолчанию не тратится
          </span>
        </span>
      </label>

      {useBalance ? (
        <div className="mt-2 flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor={amountId} className="text-xs text-black/45">
              Сколько зачесть, ₽
            </label>
            <input
              id={amountId}
              type="number"
              inputMode="numeric"
              min={0}
              max={balanceCap}
              step={1}
              value={balanceInput}
              disabled={disabled}
              onChange={(e) => onBalanceInputChange(e.target.value)}
              className="mt-1 min-h-11 w-full rounded-md border border-black/15 bg-white px-3 text-sm tabular-nums text-black shadow-sm transition-colors duration-200 focus:border-black/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <button
            type="button"
            onClick={() => onBalanceInputChange(String(balanceCap))}
            disabled={disabled}
            className="land-btn-ghost min-h-11 min-w-9 cursor-pointer px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            Всё
          </button>
        </div>
      ) : null}

      {useBalance ? (
        <p aria-live="polite" className="mt-2 text-xs leading-snug text-black/55">
          {(Number(balanceInput) || 0) > balanceCap
            ? `Зачтём только ${formatRub(balanceCap)} ₽ — больше по этому счёту нельзя. `
            : `Максимум по этому счёту — ${formatRub(balanceCap)} ₽${
                availableRub > invoiceRub
                  ? ' (вся его сумма). '
                  : ' (весь свободный баланс). '
              }`}
          Зачтённое сразу уходит в резерв и пропадает из «Доступно» на странице партнёрской
          программы, пока счёт не оплачен.
        </p>
      ) : null}

      {appliedRub > 0 ? (
        <p className="mt-2 text-xs leading-snug text-[#166534]">
          {coversAll
            ? 'Счёт полностью закрывается балансом — платить картой не нужно.'
            : `С баланса спишется ${formatRub(appliedRub)} ₽, картой — ${formatRub(netRub)} ₽.`}
        </p>
      ) : null}
    </div>
  );
}
