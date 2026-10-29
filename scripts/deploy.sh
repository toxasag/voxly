#!/bin/sh
# Деплой GETVOXLY на VPS по SSH-ключу.
#
# Запускается С РАБОЧЕЙ МАШИНЫ: sh scripts/deploy.sh [backend|frontend|all]
#
# Требует алиас `getvoxly-vps` в ~/.ssh/config с ControlMaster (см.
# docs/05_OPERATIONS/05_02_DEPLOY.md §1). Без мультиплексирования шаги рвутся
# на середине: канал до сервера теряет часть новых TCP-соединений, и каждый
# новый ssh/rsync — это лотерея, тогда как внутри установленного соединения
# потерь нет.
set -eu

TARGET="${1:-all}"
case "$TARGET" in
  backend|frontend) SERVICES="$TARGET" ;;
  all) SERVICES="backend frontend" ;;
  *) printf 'usage: deploy.sh [backend|frontend|all]\n' >&2; exit 2 ;;
esac
# Deliberate operator gates: a backup filename is not proof of a successful restore.
: "${GETVOXLY_RELEASE_APPROVED:?Set only after staging acceptance and explicit deployment approval}"
: "${GETVOXLY_RESTORE_VERIFIED:?Reference the successful isolated restore rehearsal}"
[ "$GETVOXLY_RELEASE_APPROVED" = "yes" ] || exit 2
HOST="getvoxly-vps"
REMOTE="/opt/getvoxly"
LOCAL="$(cd "$(dirname "$0")/.." && pwd)"

log() { printf '\n=== %s\n' "$1"; }

# --- Проверки до выкладки ----------------------------------------------------
# Порядок неслучаен: типизация и тесты идут до rsync, иначе на сервер попадает
# код, который заведомо не собирается, и откатывать придётся уже прод.
if [ "$TARGET" = "backend" ] || [ "$TARGET" = "all" ]; then
  log "Типизация backend"
  (cd "$LOCAL/backend" && npx tsc --noEmit)

  log "Тесты backend"
  if nc -z 127.0.0.1 5432 2>/dev/null; then
    (cd "$LOCAL/backend" && env -i PATH="$PATH" HOME="$HOME" USER="${USER:-postgres}" \
      TEST_ADMIN_DATABASE_URL="postgres://postgres@127.0.0.1:5432/postgres" \
      TEST_DATABASE_NAME="getvoxly_audit_release_$$" TEST_APP_ROLE="getvoxly_audit_release_$$" NODE_ENV=test npm test --silent)
  else
    printf 'Локальный PostgreSQL недоступен (127.0.0.1:5432) — прогон модульных тестов без БД\n'
    (cd "$LOCAL/backend" && NODE_ENV=test npx vitest run src/tests/chat-from-me.test.ts src/tests/chat-stream.test.ts src/tests/crm-enrichment.test.ts src/tests/queue-worker.test.ts src/tests/robokassa-client.test.ts src/tests/sales-learn.test.ts src/tests/stage-funnels.test.ts src/tests/stories-service.test.ts)
  fi
fi

if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "all" ]; then
  log "Типизация frontend"
  (cd "$LOCAL/frontend" && npx tsc --noEmit && npm test -- --maxWorkers=2 --run)
fi

# Preserve code, image IDs and a database backup before rsync/build/migrations.
RELEASE="$(date -u +%Y%m%dT%H%M%SZ)-$$"
log "Резервная копия релиза $RELEASE"
ssh "$HOST" "set -eu; umask 077; mkdir -p /opt/getvoxly-releases/$RELEASE; \
  tar --exclude=node_modules --exclude=.next --exclude=.audit --exclude=.env --exclude='.env.*' \
  -czf /opt/getvoxly-releases/$RELEASE/source.tgz -C $REMOTE backend frontend docker-compose.yml; \
  docker exec getvoxly-db-1 pg_dump -U getvoxly -d getvoxly -Fc > /opt/getvoxly-releases/$RELEASE/database.dump; \
  test -s /opt/getvoxly-releases/$RELEASE/database.dump; \
  docker exec -i getvoxly-db-1 pg_restore --list < /opt/getvoxly-releases/$RELEASE/database.dump > /opt/getvoxly-releases/$RELEASE/database.list; \
  for service in $SERVICES; do \
    image=\$(docker inspect --format '{{.Image}}' getvoxly-\${service}-1); \
    docker image tag \"\$image\" getvoxly-rollback-\${service}:$RELEASE; \
    printf '%s %s\\n' \"\$service\" \"\$image\" >> /opt/getvoxly-releases/$RELEASE/images.txt; \
  done"
printf 'Rollback artifacts: /opt/getvoxly-releases/%s\n' "$RELEASE"

# --- Синхронизация -----------------------------------------------------------
# .env исключён всегда: на сервере лежит рабочий файл с секретами, и
# `--delete` без этого исключения снёс бы его вместе с чужими файлами.
if [ "$TARGET" = "backend" ] || [ "$TARGET" = "all" ]; then
  log "Синхронизация backend"
  rsync -az --delete --exclude node_modules --exclude .git --exclude .env \
    --exclude '.env.*' --exclude .audit --exclude 'scripts/audit-*' --exclude '*.tsbuildinfo' \
    -e ssh "$LOCAL/backend/" "$HOST:$REMOTE/backend/"
fi

if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "all" ]; then
  log "Синхронизация frontend"
  rsync -az --delete --exclude node_modules --exclude .next --exclude .git \
    --exclude .env --exclude '.env.*' --exclude '*.tsbuildinfo' -e ssh "$LOCAL/frontend/" "$HOST:$REMOTE/frontend/"
fi

if [ "$TARGET" = "all" ]; then
  log "Синхронизация docker-compose.yml"
  rsync -az -e ssh "$LOCAL/docker-compose.yml" "$HOST:$REMOTE/docker-compose.yml"
fi

# --- Сборка ------------------------------------------------------------------
# Сборка идёт отсоединённым процессом через remote-build.sh: образ frontend
# собирается дольше, чем держится сессия при обрыве канала, и потеря SSH
# убивала бы docker-compose на середине шага.
rsync -az -e ssh "$LOCAL/scripts/remote-build.sh" "$HOST:$REMOTE/remote-build.sh"
ssh "$HOST" "chmod +x $REMOTE/remote-build.sh"

build_and_wait() {
  service="$1"
  log "Сборка $service"
  ssh "$HOST" "$REMOTE/remote-build.sh $service"

  # Ожидание по маркеру в логе, а не по фиксированной паузе: время сборки
  # зависит от кеша слоёв и загрузки машины (она делится со стеком automation).
  waited=0
  while [ "$waited" -lt 1800 ]; do
    sleep 20
    waited=$((waited + 20))
    if ssh "$HOST" "grep -q BUILD_EXIT /tmp/getvoxly-build-${service}.log"; then
      code=$(ssh "$HOST" "grep BUILD_EXIT /tmp/getvoxly-build-${service}.log | tail -1 | tr -dc '0-9'")
      if [ "$code" = "0" ]; then
        printf 'сборка %s готова\n' "$service"
        return 0
      fi
      printf 'сборка %s провалилась (код %s), последние строки:\n' "$service" "$code"
      ssh "$HOST" "tail -30 /tmp/getvoxly-build-${service}.log"
      return 1
    fi
    printf 'сборка %s идёт (%s c)\n' "$service" "$waited"
  done

  printf 'сборка %s не завершилась за 30 минут\n' "$service"
  return 1
}

if [ "$TARGET" = "backend" ] || [ "$TARGET" = "all" ]; then
  build_and_wait backend
fi

if [ "$TARGET" = "frontend" ] || [ "$TARGET" = "all" ]; then
  build_and_wait frontend
fi

# --- Пересоздание ------------------------------------------------------------
# `stop` + `rm` перед `up`, а не `restart`: restart переиспользует контейнер со
# старым образом, и свежая сборка на прод не попадает.
log "Пересоздание контейнеров"
ssh "$HOST" "cd $REMOTE && docker-compose up -d --no-deps --force-recreate $SERVICES"

log "Ожидание healthcheck"
sleep 45

# --- Проверка ----------------------------------------------------------------
log "Состояние контейнеров"
ssh "$HOST" "docker ps --filter name=getvoxly --format '{{.Names}} {{.Status}}'"

log "Применённые миграции"
ssh "$HOST" "docker exec getvoxly-db-1 psql -U getvoxly -d getvoxly -tAc 'SELECT count(*) FROM pgmigrations'"

log "Проверка здоровья контейнеров"
ssh "$HOST" "set -eu; for service in $SERVICES; do \
  state=\$(docker inspect --format '{{.State.Health.Status}}' getvoxly-\${service}-1); \
  test \"\$state\" = healthy || { printf 'Unhealthy: %s %s\\n' \"\$service\" \"\$state\"; exit 1; }; done"

log "Проверка HTTP изнутри и снаружи"
ssh "$HOST" "set -eu; test \"\$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/login)\" = 200; \
  test \"\$(curl --max-time 15 -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/health)\" = 200"
for url in https://getvoxly.ru/login https://api.getvoxly.ru/health; do
  code=$(curl --max-time 20 --retry 2 -sS -o /dev/null -w '%{http_code}' "$url")
  [ "$code" = 200 ] || { printf 'HTTP %s: %s\n' "$code" "$url" >&2; exit 1; }
done
printf 'Release %s: health gates passed.\n' "$RELEASE"
