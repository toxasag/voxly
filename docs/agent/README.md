# Voxly — память агента

Короткие факты для агентов. **Не дублируй** то, что уже есть здесь и в `CAPABILITIES.md`.

## Порядок чтения (каждый новый чат)

1. **Этот файл** → сразу `CAPABILITIES.md` (что уже есть — anti-reimplementation).
2. Протокол `apps/.cursorrules`: **`docs/ai/FEATURES.md`** + **`docs/ai/ARCHITECTURE.md`** (фичи и паттерны; обновлять после значимой работы).
3. При задаче по **чату / AI-агентам / WA / TG / GramJS** → **`CHAT.md`** (golden path — не регрессировать) + ADR-014 в `DECISIONS.md`.
4. При задаче по данным/API/воркерам → `DATA.md` / `FLOWS.md` / `SERVICES.md` (только нужные).
5. `steps.md` §4 «Текущее состояние» — снимок сессии, E2E, next steps.
6. При дебаге runtime → **сначала** `INCIDENTS.md`.
7. При выкладке на prod → **`DEPLOY.md`** + **`ENVIRONMENTS.md`** + `./scripts/prod-deploy.sh` (не ad-hoc rsync).
8. Graphify (`graphify query/path/explain`) → затем код.
9. Глубокий контекст: `docs/ARCHITECTURE.md`. Доки библиотек: Context7 MCP.

## Карта файлов

| Файл | Зачем |
|---|---|
| `../ai/FEATURES.md` | Журнал фич (шаблон из `apps/.cursorrules`) |
| `../ai/ARCHITECTURE.md` | Короткая карта слоёв/паттернов для агента |
| `STACK.md` | Стек, порты, как поднять (без секретов) |
| `DATA.md` | PG×2, Redis, ключевые Prisma-модели, кто R/W |
| `SERVICES.md` | Apps/workers: роль, порт, deps |
| `FLOWS.md` | E2E-потоки + пути файлов |
| `CHAT.md` | **Golden path** CRM/AI chat (WA эталон, TG/GramJS, агенты) — не регрессировать |
| `CAPABILITIES.md` | Чеклист существующего surface (API/UI/worker) |
| `DECISIONS.md` | Короткие ADR |
| `WORKLOG.md` | Журнал значимых сессий агента (append-only) |
| `INCIDENTS.md` | Известные runtime-сбои и диагностика |
| `OBS.md` | `docker logs`, health URL, логирование |
| `DEPLOY.md` | Безопасный prod deploy (`scripts/prod-deploy.sh`) |
| `ENVIRONMENTS.md` | Local vs prod; last verified code drift |
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
