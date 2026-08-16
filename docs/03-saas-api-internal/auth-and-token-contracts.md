# Auth & Token Contracts

> Сервисные токены, per-service fallback, верификация.

## Исходные файлы

- `packages/shared/src/service-auth.ts` — core функции токен-аутентификации
- `apps/saas-api/src/index.ts` — middleware верификации
- `docker/docker-compose.yml` — `x-voxly-service-tokens` (ENV mapping)

## Ключевые функции

### `resolveServiceToken(targetService: string): string`
```typescript
export function resolveServiceToken(targetService: string): string
```
Возвращает per-service токен для целевого сервиса (VOXLY_TOKEN_{SERVICE}) или fallback на shared VOXLY_SERVICE_TOKEN.

### `extractBearer(authorizationHeader): string`
```typescript
export function extractBearer(authorizationHeader: string | null | undefined): string
```
Извлекает токен из `Authorization: Bearer <token>`.

### `verifyServiceToken(presentedToken, selfService): boolean`
```typescript
export function verifyServiceToken(
  presentedToken: string | null | undefined,
  selfService: string,
): boolean
```
Проверяет предъявленный токен для selfService. Accepts per-service token OR shared fallback. Constant-time comparison via `timingSafeEqualStr`.

### `timingSafeEqualStr(a, b): boolean`
```typescript
export function timingSafeEqualStr(a: string, b: string): boolean
```
Constant-time string comparison (без утечки длины через ранний выход).

## Per-service токены (docker-compose.yml)

| ENV-переменная | Целевой сервис | Fallback |
|----------------|----------------|----------|
| `VOXLY_TOKEN_SAAS_API` | saas-api | `VOXLY_SERVICE_TOKEN` |
| `VOXLY_TOKEN_GRAMJS_BRIDGE` | gramjs-bridge | `VOXLY_SERVICE_TOKEN` |
| `VOXLY_TOKEN_MAX_BRIDGE` | max-bridge | `VOXLY_SERVICE_TOKEN` |
| `VOXLY_TOKEN_AI_TELEGRAM_WORKER` | ai-telegram-worker | `VOXLY_SERVICE_TOKEN` |
| `VOXLY_TOKEN_AI_WHATSAPP_WORKER` | ai-whatsapp-worker | `VOXLY_SERVICE_TOKEN` |
| `VOXLY_TOKEN_PLATFORM_BOT` | platform-bot-service | `VOXLY_SERVICE_TOKEN` |

**Callers / Inbound:** Все внутренние route-файлы (`crm-enrich-internal.ts`, `max-internal.ts`, `gramjs-internal.ts`, `platform-bot-internal.ts`)

## Инварианты безопасности

- Constant-time comparison — защита от timing-атак.
- Per-service токены позволяют ротировать доступ к отдельным сервисам.
- Shared fallback обеспечивает обратную совместимость.
- Нет hardcoded секретов — только ENV.

## Риски

- **Пустой токен** → `verifyServiceToken` вернёт `false` (нет configured candidates).
- **Ротация** per-service токена требует пересборки всех зависимых контейнеров.
