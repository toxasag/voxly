#!/bin/sh
# Сборка образа в отсоединённом процессе.
#
# Запускается НА СЕРВЕРЕ. Причина существования: сборка frontend занимает
# больше времени, чем живёт SSH-сессия при `MaxStartups 10:30:60` — обрыв
# соединения убивал бы дочерний процесс docker-compose вместе с сессией.
# `setsid` отвязывает процесс от терминала, поэтому разрыв SSH его не касается.
#
# Использование: remote-build.sh <service>
set -eu

SERVICE="${1:?usage: remote-build.sh <service>}"
case "$SERVICE" in backend|frontend) ;; *) printf 'Invalid service\n' >&2; exit 2 ;; esac
LOG="/tmp/getvoxly-build-${SERVICE}.log"

cd /opt/getvoxly

# Маркер начала пишется до запуска: по нему deploy.sh отличает «сборка идёт»
# от «скрипт не запускался».
echo "BUILD_STARTED $(date -Is) ${SERVICE}" > "$LOG"

setsid sh -c "docker-compose build ${SERVICE} >> ${LOG} 2>&1; echo \"BUILD_EXIT \$?\" >> ${LOG}" < /dev/null > /dev/null 2>&1 &

echo "started ${SERVICE}, log: ${LOG}"
