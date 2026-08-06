# Voxly — память агента

Короткие факты для агентов. **Не дублируй** то, что уже есть здесь и в `CAPABILITIES.md`.

## Порядок чтения (каждый новый чат)

1. **Этот файл** → сразу `CAPABILITIES.md` (что уже есть — anti-reimplementation).
2. Протокол `apps/.cursorrules`: **`docs/ai/FEATURES.md`** + **`docs/ai/ARCHITECTURE.md`** (фичи и паттерны; обновлять после значимой работы).
3. При задаче по **чату / AI-агентам / WA / TG / GramJS** → **`CHAT.md`** (golden path — не регрессировать) + ADR-014 в `DECISIONS.md` + freeze-card в **`modules/`** (см. `modules/README.md`).
3b. При задаче по **gift-бот порталу** (`/dashboard/bots/[botId]`, превью, медиа, emoji, профиль) → **CAPABILITIES** «Gift bot detail» + **ADR-027** + `modules/gift-bot.md` — не регрессировать UX для всех тенантов.
3c. Перед правкой WA sync / GramJS CRM / chat panel / social links / deal dedupe → открой карточку в **`modules/`**, потом код; после — smoke из карточки.
4. При задаче по данным/API/воркерам → `DATA.md` / `FLOWS.md` / `SERVICES.md` (только нужные).
5. `steps.md` §4 «Текущее состояние» — снимок сессии, E2E, next steps.
6. При дебаге runtime → **сначала** `INCIDENTS.md`.
7. При выкладке на prod → **`DEPLOY.md`** + **`ENVIRONMENTS.md`** + `./scripts/prod-deploy.sh` (не ad-hoc rsync).
8. Graphify (`graphify query/path/explain`) → затем код.
9. Глубокий контекст: `docs/ARCHITECTURE.md`. Доки библиотек: Context7 MCP.
10. MAX personal smoke: `MAX-SMOKE.md` (ADR-025 Phase 1).

## Карта файлов

| Файл | Зачем |
|---|---|
| `../ai/FEATURES.md` | Журнал фич (шаблон из `apps/.cursorrules`) |
| `../ai/ARCHITECTURE.md` | Короткая карта слоёв/паттернов для агента |
| `STACK.md` | Стек, порты, как поднять (без секретов) |
| `DATA.md` | PG×2, Redis, ключевые Prisma-модели, кто R/W |
| `SERVICES.md` | Apps/workers: роль, порт, deps |
| `FLOWS.md` | E2E-потоки + пути файлов |
| `FORMS.md` | Web form lead intake (Tilda/WP) — клиентская инструкция + ADR-026 |
| `CHAT.md` | **Golden path** CRM/AI chat (WA эталон, TG/GramJS, агенты) — не регрессировать |
| `CAPABILITIES.md` | Чеклист существующего surface (API/UI/worker); gift-bot setup UX + Do not regress (ADR-027) |
| `modules/` | Freeze-cards рабочих модулей (paths/contract/smoke/incidents/deploy) — не ломать working surfaces |
| `DECISIONS.md` | Короткие ADR |
| `WORKLOG.md` | Журнал значимых сессий агента (append-only) |
| `INCIDENTS.md` | Известные runtime-сбои и диагностика |
| `OBS.md` | `docker logs`, health URL, логирование |
| `DEPLOY.md` | Безопасный prod deploy (`scripts/prod-deploy.sh`) |
| `ENVIRONMENTS.md` | Local vs prod; last verified code drift |
| `RELEASE-CHECKLIST.md` | Предрелизный / клиентский go/no-go по 7 направлениям + `pnpm verify` |
| `../specs/AI-AGENTS-TZ.md` | Черновик ТЗ AI (TG Business + GramJS + WA) |

## После значимой работы

1. Append в `WORKLOG.md` (шаблон вверху файла).
2. Обновить `CAPABILITIES.md` / `DECISIONS.md`, если изменился product surface или ADR.
3. Новый failure mode → `INCIDENTS.md`.
4. Обновить `steps.md` (§3 timeline + §4) — как раньше.
5. `source $HOME/.local/bin/env && graphify . --code-only --update`.

## Каскад памяти (токены)

1. `docs/agent/` — CAPABILITIES + WORKLOG/INCIDENTS (+ DEPLOY/ENVIRONMENTS при выкладке) (+ релевантные STACK/DATA/FLOWS)
2. `steps.md` §4
3. Graphify
4. `docs/ARCHITECTURE.md`
5. Context7
