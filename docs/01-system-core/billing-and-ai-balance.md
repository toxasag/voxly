# Billing & AI Balance — биллинг Robokassa и AI-кошелёк

Дата ревизии: 2026-08-16. Секреты — только плейсхолдеры (`{{ROBOKASSA_PASSWORD1}}` и т.п.).

## 1. Компоненты

| Слой | Файл | Роль |
|---|---|---|
| Клиент Robokassa | `packages/billing/src/index.ts` | подписи 54-ФЗ, URL чекаута, верификация webhook |
| HTTP-роуты | `apps/saas-api/src/routes/billing.ts` | создание Payment, `/result`, `/success` |
| AI-кошелёк | `packages/ai-core/src/index.ts` | списания с наценкой, top-up |
| Админ | `apps/saas-api/src/routes/admin-ai-balance.ts` | управление балансами |
| Cron | `apps/saas-api/src/jobs/scheduler.ts` | `checkExpiredSubscriptions`, `checkAiWalletAlerts`, `releaseStaleBalanceHolds` |

## 2. Robokassa-клиент (`packages/billing/src/index.ts`)

```ts
export class RobokassaClient {
  constructor(config: RobokassaConfig)
  generatePaymentUrl(params: CheckoutParams): string
  verifyResultSignature(params: { outSum: string; invId: string; signatureValue: string; customData?: Record<string, string> }): boolean
  verifySuccessSignature(params: { outSum: string; invId: string; signatureValue: string; customData?: Record<string, string> }): boolean
}
export function paymentAmountMatchesOutSum(expectedAmount: number | string, outSum: string): boolean
export function calculateSubscriptionPrice(monthlyPrice: number, periodMonths: number, discountPercent: number): number
export function calculateProratedSeatPrice(monthlyPrice: number, remainingDays: number, totalDaysInPeriod: number): number
```

- Подпись чекаута: `MerchantLogin:OutSum:InvId[:Receipt]:Password#1[:Shp_*=…]`; Receipt — raw JSON (encodeURIComponent даёт Robokassa error 29).
- ResultURL проверяется Password#2, SuccessURL — Password#1; `OutSum` сравнивается как получен (prod шлёт до 6 знаков).
- Сравнение подписей — `safeCompare` (рукописный constant-time, строки 181-188).
- Инициализация в `apps/saas-api/src/index.ts:118-124`: `ROBOKASSA_LOGIN/PASSWORD1/PASSWORD2`, `ROBOKASSA_IS_TEST=1`, `ROBOKASSA_HASH_ALG` (`md5|sha256`, default sha256).

## 3. Платёжный поток

1. `POST /api/billing/...` создаёт `Payment` (`status: pending`, `idempotencyKey @unique`, `robokassaInvId @unique`, `shpTenantId`) — `apps/saas-api/src/routes/billing.ts:279` и далее; `generatePaymentUrl` — там же, строка 344.
2. Robokassa → `POST/GET /api/billing/result` (`billing.ts:492-493`): `robokassa.verifyResultSignature({...})` (строка 391), поиск по `robokassaInvId` (строка 417), сверка суммы `paymentAmountMatchesOutSum`.
3. При успехе: активация `Subscription`, top-up AI-кошелька (`topUpWallet`, см. ниже), начисление партнёрских `ReferralEarning`.
4. `/success` — только отображение (строка 495).

Партнёрский баланс: `Payment.balanceAppliedRub` (`amount = gross - balanceAppliedRub`, схема `schema.prisma:147-148`); hold на 24ч снимается cron'ом `release-stale-balance-holds` (см. [cron-scheduler-locks.md](./cron-scheduler-locks.md)). В транзакции оплаты применяется advisory-lock: `await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(87236401)')` (`apps/saas-api/src/routes/billing.ts:1123`) — сериализация расчёта `invId`/баланса.

### Подписки и грейс

`model Subscription` (`schema.prisma:118`): `productCode` (`crm_base`, `extra_seat`, `gift_bot`, …), `periodMonths` (1/3/6/12/24; **0 = триал**), `startsAt/endsAt`, `status` (active/expired/cancelled). `GRACE_PERIOD_DAYS = 7` (`packages/shared/src/index.ts:225`); `PERIOD_DISCOUNTS`, `PRICING` — там же (строки 183-222). Cron `checkExpiredSubscriptions` (`apps/saas-api/src/jobs/scheduler.ts:120-198`): триал (`periodMonths === 0`) истекает без грейса; платные — suspend после 7 дней и `syncTwentyCrmLock(..., true)`; аддоны истекают по `activeUntil`.

## 4. AI-кошелёк (`packages/ai-core/src/index.ts`)

Модели: `AiWallet` (`tenantId @unique`, `balanceRub Decimal(10,2)`) и `AiUsageLog` (`tokens`, `providerCostRub`, `markupPercent`, `chargedRub`, `uncollectedRub`, `channel`, `usageChargeKey @unique`) — `schema.prisma:194-234`.

```ts
export async function getEffectiveMarkup(tenantId: string): Promise<number>
export async function chargeAiUsage(params: ChargeAiUsageParams): Promise<ChargeResult>
export async function hasAiBalance(tenantId: string, minAmount = 1): Promise<boolean>
export async function topUpWallet(tenantId: string, amountRub: number): Promise<void>
export async function getAiUsageReport(tenantId?: string)
```

`getEffectiveMarkup`: `Tenant.aiMarkupPercent` (оверрайд) → `PlatformSetting['ai_markup_percent']` → default `50`.

### Атомарное списание (ядро)

`chargeAiUsage` внутри `prisma.$transaction`:

1. **Идемпотентность**: если `usageChargeKey` уже есть в `AiUsageLog` — duplicate no-op (unique-индекс гарантирует).
2. **Условный декремент** (защита от гонок перезаписи):
   ```ts
   const debited = await tx.aiWallet.updateMany({
     where: { tenantId: params.tenantId, balanceRub: { gte: chargedRub } },
     data: { balanceRub: { decrement: chargedRub } },
   });
   ```
3. Если списалось (`debited.count > 0`) — читаем обновлённый баланс.
4. **No-debt режим** (`isNoDebtModeEnabled()`): при нехватке — не списывать, не логировать, вернуть `insufficient: true, paused: true`.
5. Иначе (частичное покрытие): блокировка строки и обнуление:
   ```ts
   const locked = await tx.$queryRaw`
     SELECT "balanceRub" FROM "AiWallet" WHERE "tenantId" = ${params.tenantId} FOR UPDATE`;
   // uncollectedRub = chargedRub - collected; balanceRub = 0
   ```
6. Запись `AiUsageLog` в той же транзакции; `paused = balance <= 0` → воркер канала ставит AI-агента на паузу.

### Callers / Inbound (grep `chargeAiUsage(`)

- `packages/ai-core/src/ai-usage-queue.ts` (BullMQ-воркер `aiUsageWorker`), `packages/ai-core/src/rag.ts`
- `apps/ai-telegram-worker/src/index.ts`, `apps/ai-whatsapp-worker/src/index.ts`, `apps/gift-bot-worker/src/index.ts`
- тесты: `apps/saas-api/tests/money-and-tenant.test.ts`

`topUpWallet` — upsert с `balanceRub: { increment: amountRub }`; вызывается после оплаты Robokassa (маршрут AI-topup; продукт `PRODUCT_CODES.AI_TOPUP`, исключён из реферальных начислений — `REFERRAL_EXCLUDED_PRODUCTS`, `packages/shared/src/index.ts:36`).

Каналы usage: `AI_USAGE_CHANNELS` (`ai_tg | ai_gramjs | ai_max | ai_wa | gift_bot | system`) — `packages/shared/src/index.ts:145`.

## 5. Инварианты безопасности

1. Webhook `/result` валиден только с корректной подписью Password#2 (constant-time) **и** совпадающей суммой (`paymentAmountMatchesOutSum`, допуск 1 копейка).
2. `Payment.idempotencyKey` и `AiUsageLog.usageChargeKey` — unique на уровне БД; повторные webhook/retry — no-op.
3. Списание баланса всегда через условный `updateMany ... gte` или `SELECT ... FOR UPDATE` — никогда через read-modify-write.
4. `amount = gross - balanceAppliedRub`: партнёрский баланс нельзя «оплатить» дважды — hold снимается только `releaseBalanceHold` (платёж или sweep).
5. Robokassa-креды отсутствуют → API стартует, но чекаут невалиден (warning в `apps/saas-api/src/index.ts:125-129`); в prod должны быть установлены `{{ROBOKASSA_LOGIN}}/{{ROBOKASSA_PASSWORD1}}/{{ROBOKASSA_PASSWORD2}}`.

## 6. Риски поломки

- Смена алгоритма хеша (`ROBOKASSA_HASH_ALG`) должна совпадать с настройкой кабинета Robokassa, иначе все подписи невалидны.
- Префикс пользовательских параметров чувствителен к регистру: `Shp_` ≠ `shp_` → error 29 (комментарий в `billing/src/index.ts:110`).
- `pg_advisory_xact_lock(87236401)` — магическая константа; переиспользование этого числа в другом месте нарушит сериализацию.
- Долговой режим (`uncollectedRub`): при выключении no-debt баланс может уходить в минус «виртуально» (обнуление + недобор) — аналитика должна учитывать `uncollectedRub`.
- Триал (`periodMonths === 0`) не получает грейс — изменение этой логики в `scheduler.ts:140-169` влияет на обещанные пользователям сроки.
