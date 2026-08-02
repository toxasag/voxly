#!/usr/bin/env bash
# Create / migrate the local control-plane test database `voxly_test`.
# Uses the same Postgres container as local docker-compose (port 5433).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGHOST="${VOXLY_TEST_PGHOST:-127.0.0.1}"
PGPORT="${VOXLY_TEST_PGPORT:-5433}"
PGUSER="${VOXLY_TEST_PGUSER:-voxly}"
PGPASSWORD="${VOXLY_TEST_PGPASSWORD:-voxly_pass}"
PGDATABASE_ADMIN="${VOXLY_TEST_PGDATABASE_ADMIN:-voxly_control}"
TEST_DB="${VOXLY_TEST_DB:-voxly_test}"

export PGPASSWORD

echo "[test-db] ensuring database ${TEST_DB} on ${PGHOST}:${PGPORT}"
exists="$(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE_ADMIN" -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${TEST_DB}'" || true)"
if [[ "$exists" != "1" ]]; then
  psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE_ADMIN" \
    -c "CREATE DATABASE ${TEST_DB} OWNER ${PGUSER};"
  echo "[test-db] created ${TEST_DB}"
else
  echo "[test-db] ${TEST_DB} already exists"
fi

export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${TEST_DB}?schema=public"
cd "$ROOT/packages/db"
pnpm exec prisma migrate deploy
pnpm exec tsx prisma/seed.ts
echo "[test-db] migrations + seed applied to ${TEST_DB}"
echo "DATABASE_URL=${DATABASE_URL}"
