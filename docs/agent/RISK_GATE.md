# Risk Gate — обязательный чеклист ПЕРЕД кодом

Агент заполняет **коротко в ответе пользователю** до любых правок runtime/docs-heavy implementation. Шаблон — не эссе.

Правило freeze: если задет WORKING/FROZEN модуль (`modules/README.md`) и пользователь **явно не просил** менять его поведение → **STOP**, спроси / предложи additive path.

При фоне/deploy/sync/новом worker — обязательно §6 + `CAPACITY.md`.

---

## Шаблон (копируй в ответ)

```
### Risk Gate
1. Цель / DoD: …
2. Freeze задеты: … (ссылки cards) | none
3. Blast radius: сервисы=…; tenants new=… / existing=…; миграции=да/нет; Twenty refresh=да/нет
4. Нельзя ломать: (1–4 contract bullets из cards)
5. Failure / rollback: …; volumes untouched; INC-* …
6. Infra: CPU/RAM/disk; ENOSPC risk; тяжёлый sync/backfill?=да/нет → CAPACITY.md
7. Smoke (1–3 мин): old portal …; new portal …
8. Backfill existing?: да/нет + команда/admin route
9. Docs после: CAPABILITIES / module card / WORKLOG / INCIDENTS / ADDRESS_BOOK / CAPACITY
```

---

## Пояснения по пунктам

1. **Цель / DoD** — что «готово» для пользователя (проверяемо).
2. **Freeze** — строки из `modules/README.md`; открыть card до кода.
3. **Blast radius** — какие docker-сервисы пересобираются; затронуты ли все тенанты на shared runtime; Prisma migrate; `refresh-crm-chat` / `reapply-crm-defaults`.
4. **Нельзя ломать** — дословно из **Contract** карточек (не выдумывать).
5. **Failure / rollback** — как откатить код (redeploy previous image / backup path). **Никогда** wipe volumes. Ссылки INC при известных failure modes.
6. **Infra** — любая постоянная нагрузка (worker, media AI, history sync, research-бот, backfill all tenants): явно «упрёмся в disk/RAM раньше бизнес-логики» если CAPACITY в danger/stretch. Перед deploy: свободное место ≥15GB (INC-052/092).
7. **Smoke** — из card + 1 проверка old tenant + 1 что new provision получит фичу.
8. **Backfill** — runtime shared ≠ данные/layout у старых. Примеры: `enrich-persons-by-phone`, `sync-opportunity-chat-activity`, `backfill-telegram-open-links`, INC-107 SQL Social order, `refresh-crm-chat`.
9. **Docs** — только то, что реально изменилось; ADDRESS_BOOK — новая строка при новом surface.

## New vs existing (обязательно в §3 + §8)

| | New portal | Existing portal |
|---|---|---|
| Runtime | тот же код на shared services | тот же код |
| Defaults / apps | provision / install path | может отставать layout/app version |
| Данные | пусто → фича с первого lead | часто нужен admin backfill |
| UI Twenty | `applyWorkspaceDefaults` на create | `reapply-crm-defaults` и/или SQL (INC-107) |

Агент **обязан** явно написать: «у новых будет …» и «для старых сделать …».
