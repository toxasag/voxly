# Changelog — Журнал изменений и план отката

> Формат и правила фиксации изменений в системе Voxly.

## Правила

1. Каждое изменение фиксируется в [`system-history.md`](system-history.md).
2. Формат записи: `| Дата | Branch | Commit | Суть | Rollback-команда / шаги |`
3. Архитектурные решения — в [`adr/`](adr/) (Architecture Decision Records).
4. Rollback-шаги пишутся **до** деплоя.

## Формат rollback-записи

```markdown
| 2026-08-16 | feature/xxx | abc123f | Добавлена функция Y |
| — | — | — | Rollback: `git revert abc123f` + `pnpm typecheck && pnpm test` |
```

## Содержание

| Файл | Описание |
|------|-----------|
| [`system-history.md`](system-history.md) | Базовый снимок состояния + хронология |
| [`adr/`](adr/) | Architecture Decision Records |
