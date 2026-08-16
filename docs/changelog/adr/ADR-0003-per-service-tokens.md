# ADR-0003: Per-Service Auth Tokens

## Status

Accepted

## Context

Все внутренние сервисы использовали единый `VOXLY_SERVICE_TOKEN` для взаимной
аутентификации. При компрометации токена — все сервисы уязвимы одновременно.
Отсутствовала возможность ротировать доступ к отдельному сервису.

## Decision

Внедрены **per-service токены** с fallback на shared token:

| ENV | Сервис |
|-----|--------|
| `VOXLY_TOKEN_SAAS_API` | saas-api |
| `VOXLY_TOKEN_GRAMJS_BRIDGE` | gramjs-bridge |
| `VOXLY_TOKEN_MAX_BRIDGE` | max-bridge |
| `VOXLY_TOKEN_AI_TELEGRAM_WORKER` | ai-telegram-worker |
| `VOXLY_TOKEN_AI_WHATSAPP_WORKER` | ai-whatsapp-worker |
| `VOXLY_TOKEN_PLATFORM_BOT` | platform-bot-service |

Механизм:
- `resolveServiceToken(target)` → читает `VOXLY_TOKEN_{TARGET}` или fallback `VOXLY_SERVICE_TOKEN`.
- `verifyServiceToken(presented, self)` → принимает per-service ИЛИ shared token.
- Constant-time comparison через `timingSafeEqualStr`.

## Consequences

### Позитивные
- Возможность ротировать токен отдельного сервиса.
- Обратная совместимость: пустой per-service → fallback на shared.

### Негативные
- Ротация per-service токена требует пересборки зависимых контейнеров.
- Shared token всё ещё существует — gradual migration.

## References

- Commit: `d60b7cb` (feat(security): 9.2 per-service auth tokens)
- Code: `packages/shared/src/service-auth.ts`
- Docs: `docs/03-saas-api-internal/auth-and-token-contracts.md`
