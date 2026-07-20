# Voxly — память агента

Короткие факты для агентов. **Не дублируй** то, что уже есть здесь и в `CAPABILITIES.md`.

## Порядок чтения (каждый новый чат)

1. **Этот файл** → сразу `CAPABILITIES.md` (что уже есть — anti-reimplementation).
2. При задаче по данным/API/воркерам → `DATA.md` / `FLOWS.md` / `SERVICES.md` (только нужные).
3. `steps.md` §4 «Текущее состояние» — снимок сессии, E2E, next steps.
4. При дебаге runtime → **сначала** `INCIDENTS.md`.
5. Graphify (`graphify query/path/explain`) → затем код.
6. Глубокий контекст: `docs/ARCHITECTURE.md`. Доки библиотек: Context7 MCP.

## Карта файлов

| Файл | Зачем |
|---|---|
| `STACK.md` | Стек, порты, как поднять (без секретов) |
| `DATA.md` | PG×2, Redis, ключевые Prisma-модели, кто R/W |
| `SERVICES.md` | Apps/workers: роль, порт, deps |
| `FLOWS.md` | E2E-потоки + пути файлов |
| `CAPABILITIES.md` | Чеклист существующего surface (API/UI/worker) |
| `DECISIONS.md` | Короткие ADR |
| `WORKLOG.md` | Журнал значимых сессий агента (append-only) |
| `INCIDENTS.md` | Известные runtime-сбои и диагностика |
| `OBS.md` | `docker logs`, health URL, логирование |

## После значимой работы

1. Append в `WORKLOG.md` (шаблон вверху файла).
2. Обновить `CAPABILITIES.md` / `DECISIONS.md`, если изменился product surface или ADR.
3. Новый failure mode → `INCIDENTS.md`.
4. Обновить `steps.md` (§3 timeline + §4) — как раньше.
5. `source $HOME/.local/bin/env && graphify . --code-only --update`.

## Каскад памяти (токены)

1. `docs/agent/` — CAPABILITIES + WORKLOG/INCIDENTS (+ релевантные STACK/DATA/FLOWS)
2. `steps.md` §4
3. Graphify
4. `docs/ARCHITECTURE.md`
5. Context7
