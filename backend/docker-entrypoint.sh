#!/bin/sh
# ---------------------------------------------------------------------------
# Entrypoint контейнера backend: миграции, затем приложение.
#
# Почему не внутри `server.ts`, хотя задание допускало оба варианта:
# приложение подключается как `app_user` — роль, намеренно лишённая прав
# (`NOSUPERUSER`, `NOBYPASSRLS`) ради работающего RLS. Проверено на проде:
# `CREATE TABLE` от её имени отдаёт `permission denied for schema public`.
# Прогон DDL из основного пула потребовал бы выдать ей права на схему и
# обесценил бы изоляцию арендаторов, ради которой она и создавалась. Здесь
# используется отдельное подключение под владельцем БД, живущее только на время
# миграций.
#
# Второе следствие: при падении миграции контейнер не стартует вовсе. Это
# осознанно — приложение на схеме, которая не доехала, работает хуже, чем не
# работает совсем: часть запросов проходит, часть падает на отсутствующих
# колонках, и данные пишутся наполовину.
# ---------------------------------------------------------------------------

set -e

cd /app

echo "[entrypoint] Проверяем доступность БД и состояние схемы..."

# Ждём готовности БД. `depends_on: condition: service_healthy` в compose это уже
# гарантирует, но entrypoint должен быть самодостаточным: его запускают и вручную
# (`docker compose run backend`), и в окружениях без healthcheck.
ATTEMPTS=0
MAX_ATTEMPTS=30
PLAN="wait"

while [ "$ATTEMPTS" -lt "$MAX_ATTEMPTS" ]; do
  PLAN=$(node scripts/migrate-plan.mjs 2>/dev/null || echo "wait")

  if [ "$PLAN" != "wait" ]; then
    break
  fi

  ATTEMPTS=$((ATTEMPTS + 1))
  echo "[entrypoint] БД ещё не готова (попытка ${ATTEMPTS}/${MAX_ATTEMPTS}), ждём 2с..."
  sleep 2
done

if [ "$PLAN" = "wait" ]; then
  echo "[entrypoint] БД недоступна после ${MAX_ATTEMPTS} попыток — прекращаем." >&2
  exit 1
fi

if [ "$PLAN" = "baseline" ]; then
  echo "[entrypoint] Схема существует, история миграций пуста — помечаем baseline (--fake)."
  npm run --silent migrate:baseline
else
  echo "[entrypoint] Применяем непримененные миграции..."
  npm run --silent migrate:up
fi

echo "[entrypoint] Состояние миграций:"
# `|| true`: скрипт возвращает код 2 при наличии ожидающих миграций (для CI), а
# здесь это только отчёт — прогон уже выполнен выше.
npm run --silent migrate:status || true

echo "[entrypoint] Запускаем приложение."
exec "$@"
