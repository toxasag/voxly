#!/usr/bin/env bash
# =============================================================================
# Voxly safe production deploy
# =============================================================================
# Runs FROM THE LAPTOP (not on the VPS). Pushes a whitelist of repo paths to
# /opt/voxly, backs up Postgres, rebuilds selected compose services, smokes HTTPS.
#
# Why this exists:
#   Ad-hoc rsync of several files into one parent dir overwrote landing page.tsx.
#   Local DB must never overwrite prod volumes. Local .env must never overwrite
#   /opt/voxly/.env. Prod compose must never include docker-compose.override.yml.
#
# Docs:  docs/agent/DEPLOY.md  |  docs/agent/ENVIRONMENTS.md  |  ADR-013
# Diff:  ./scripts/prod-diff.sh
#
# Usage:
#   ./scripts/prod-deploy.sh saas-portal
#   ./scripts/prod-deploy.sh saas-api,saas-portal
#   ./scripts/prod-deploy.sh --dry-run saas-api
#   ./scripts/prod-deploy.sh --skip-backup gift-bot-worker
#
# Env:
#   VOXLY_PROD_HOST   default 150.241.98.135
#   VOXLY_PROD_USER   default root
#   VOXLY_PROD_DIR    default /opt/voxly
#   SSHPASS           password auth (sshpass -e); falls back to macOS keychain
#                     item: account $(id -un), service voxly-prod-ssh
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VOXLY_PROD_HOST:-150.241.98.135}"
USER="${VOXLY_PROD_USER:-root}"
REMOTE_DIR="${VOXLY_PROD_DIR:-/opt/voxly}"
DRY_RUN=0
SKIP_BACKUP=0
SERVICES_RAW=""

usage() {
  cat <<'EOF'
Usage: ./scripts/prod-deploy.sh [--dry-run] [--skip-backup] <service[,service…]>

Services:
  saas-portal | saas-api | gift-bot-worker | manager-bot-service
  ai-telegram-worker | ai-whatsapp-worker | gramjs-bridge | evolution-api | twenty | compose | all-apps

Examples:
  ./scripts/prod-deploy.sh --dry-run saas-portal
  ./scripts/prod-deploy.sh saas-api,saas-portal,ai-telegram-worker,ai-whatsapp-worker
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --skip-backup) SKIP_BACKUP=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*)
      echo "Unknown flag: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      SERVICES_RAW="$1"
      shift
      ;;
  esac
done

if [[ -z "$SERVICES_RAW" ]]; then
  usage >&2
  exit 2
fi

# --- SSH helpers ---
# SSHPASS is exported from ~/.zshrc, which non-interactive shells never read —
# fall back to the macOS keychain item so agent/CI-style runs still authenticate.
if [[ -z "${SSHPASS:-}" ]] && command -v security >/dev/null 2>&1; then
  SSHPASS="$(security find-generic-password -a "$(id -un)" -s voxly-prod-ssh -w 2>/dev/null || true)"
  export SSHPASS
fi
if [[ -z "${SSHPASS:-}" && "$DRY_RUN" -eq 0 ]]; then
  echo "No SSH password. Export SSHPASS, or store it once in the keychain:" >&2
  echo "  security add-generic-password -a \"\$(id -un)\" -s voxly-prod-ssh -w '<password>'" >&2
  exit 1
fi

ssh_base=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
rsync_ssh="ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
if [[ -n "${SSHPASS:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "SSHPASS is set but sshpass is not installed" >&2
    exit 1
  fi
  # Prefer password-only to avoid MaxAuthTries from unused pubkey attempts.
  ssh_opts=(
    -o StrictHostKeyChecking=accept-new
    -o ConnectTimeout=20
    -o PreferredAuthentications=password
    -o PubkeyAuthentication=no
    -o NumberOfPasswordPrompts=1
  )
  ssh_base=(sshpass -e ssh "${ssh_opts[@]}")
  rsync_ssh="sshpass -e ssh ${ssh_opts[*]}"
fi

remote() {
  "${ssh_base[@]}" "${USER}@${HOST}" "$@"
}

# --- Path maps (relative to repo root). Never include .env or override. ---
ROOT_MANIFESTS=(
  package.json
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json
)

RSYNC_EXCLUDES=(
  --exclude '.env'
  --exclude '.env.*'
  --exclude 'docker-compose.override.yml'
  --exclude 'node_modules'
  --exclude '.next'
  --exclude 'dist'
  --exclude '.turbo'
  --exclude '.cursor'
  --exclude 'graphify-out'
  --exclude '.git'
  --exclude '*.log'
)

paths_for_service() {
  local svc="$1"
  case "$svc" in
    saas-portal)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/saas-portal/"
      ;;
    saas-api)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/saas-api/"
      echo "twenty-app/voxly-crm-chat/"
      ;;
    gift-bot-worker)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/gift-bot-worker/"
      ;;
    manager-bot-service)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/manager-bot-service/"
      ;;
    ai-telegram-worker)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/ai-telegram-worker/"
      ;;
    ai-whatsapp-worker)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/ai-whatsapp-worker/"
      ;;
    gramjs-bridge)
      printf '%s\n' "${ROOT_MANIFESTS[@]}"
      echo "packages/"
      echo "apps/gramjs-bridge/"
      ;;
    twenty)
      echo "docker/twenty.Dockerfile"
      echo "docker/twenty-shell-ux.js"
      echo "docker/twenty-cabinet-link.js"
      echo "docker/twenty-deal-chat.js"
      echo "docker/patch-twenty-functions-url.cjs"
      echo "docker/patch-twenty-front-component-url.cjs"
      echo "docker/patch-twenty-file-base64.cjs"
      echo "docker/set-opportunity-kanban-default.sql"
      echo "docker/set-opportunity-kanban-card-defaults.sql"
      echo "docker/set-chat-tab-position.sql"
      echo "docker/dedupe-cabinet-nav.sql"
      ;;
    compose)
      echo "docker/docker-compose.yml"
      echo "docker/docker-compose.prod-npm.yml"
      echo "docker/evolution-api.Dockerfile"
      ;;
    evolution-api)
      echo "docker/docker-compose.yml"
      echo "docker/evolution-api.Dockerfile"
      ;;
    all-apps)
      paths_for_service saas-portal
      paths_for_service saas-api
      paths_for_service gift-bot-worker
      paths_for_service manager-bot-service
      paths_for_service ai-telegram-worker
      paths_for_service ai-whatsapp-worker
      paths_for_service twenty
      paths_for_service compose
      ;;
    *)
      echo "Unknown service: $svc" >&2
      exit 2
      ;;
  esac
}

compose_services_for() {
  local svc="$1"
  case "$svc" in
    saas-portal) echo "saas-portal" ;;
    saas-api) echo "saas-api" ;;
    gift-bot-worker) echo "gift-bot-worker" ;;
    manager-bot-service) echo "manager-bot-service" ;;
    ai-telegram-worker) echo "ai-telegram-worker" ;;
    ai-whatsapp-worker) echo "ai-whatsapp-worker" ;;
    gramjs-bridge) echo "gramjs-bridge" ;;
    evolution-api) echo "evolution-api" ;;
    twenty) echo "twenty-server twenty-worker" ;;
    compose) echo "" ;; # files only
    all-apps) echo "saas-api saas-portal gift-bot-worker manager-bot-service ai-telegram-worker ai-whatsapp-worker twenty-server twenty-worker" ;;
    *) echo "" ;;
  esac
}

# Expand + dedupe requested services
IFS=',' read -r -a REQ <<<"$SERVICES_RAW"
declare -a EXPANDED=()
for s in "${REQ[@]}"; do
  s="$(echo "$s" | tr -d '[:space:]')"
  [[ -z "$s" ]] && continue
  EXPANDED+=("$s")
done

declare -a ALL_PATHS=()
declare -a COMPOSE_SVCS=()
for s in "${EXPANDED[@]}"; do
  while IFS= read -r p; do
    [[ -z "$p" ]] && continue
    ALL_PATHS+=("$p")
  done < <(paths_for_service "$s")
  while IFS= read -r cs; do
    [[ -z "$cs" ]] && continue
    COMPOSE_SVCS+=("$cs")
  done < <(compose_services_for "$s" | tr ' ' '\n')
done

# Dedupe paths / compose services (bash 3.2 — no associative arrays)
dedupe_lines() {
  if [[ $# -eq 0 ]]; then
    return 0
  fi
  printf '%s\n' "$@" | awk 'NF && !seen[$0]++'
}

PATHS=()
while IFS= read -r p; do
  [[ -z "$p" ]] && continue
  PATHS+=("$p")
done < <(dedupe_lines "${ALL_PATHS[@]+"${ALL_PATHS[@]}"}")

BUILD_SVCS=()
while IFS= read -r c; do
  [[ -z "$c" ]] && continue
  BUILD_SVCS+=("$c")
done < <(dedupe_lines "${COMPOSE_SVCS[@]+"${COMPOSE_SVCS[@]}"}")
# Safety: refuse forbidden basenames anywhere in the sync set
for p in "${PATHS[@]}"; do
  base="$(basename "$p")"
  case "$base" in
    .env|.env.local|.env.production|docker-compose.override.yml)
      echo "REFUSE: refusing to sync forbidden path: $p" >&2
      exit 1
      ;;
  esac
  if [[ "$p" == *'/.env'* ]] || [[ "$p" == *'/docker-compose.override.yml' ]]; then
    echo "REFUSE: forbidden path pattern: $p" >&2
    exit 1
  fi
  if [[ ! -e "$ROOT/$p" ]]; then
    echo "Missing local path: $ROOT/$p" >&2
    exit 1
  fi
done

echo "=== Voxly prod deploy ==="
echo "Host:     ${USER}@${HOST}:${REMOTE_DIR}"
echo "Services: ${EXPANDED[*]}"
echo "Paths:"
for p in "${PATHS[@]}"; do echo "  - $p"; done
if [[ ${#BUILD_SVCS[@]} -eq 0 ]]; then
  echo "Compose build: (none)"
else
  echo "Compose build: ${BUILD_SVCS[*]}"
fi
echo "Dry-run: $DRY_RUN  Skip-backup: $SKIP_BACKUP"
echo

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would rsync paths above"
  # Determine if prisma migrations apply
  NEEDS_MIGRATE=0
  for svc in "${BUILD_SVCS[@]}"; do
    case "$svc" in
      saas-api|gift-bot-worker|manager-bot-service|ai-telegram-worker|ai-whatsapp-worker|gramjs-bridge)
        NEEDS_MIGRATE=1; break ;;
    esac
  done
  if [[ "$NEEDS_MIGRATE" -eq 1 ]]; then
    echo "[dry-run] would: docker-compose ... build saas-api (for prisma CLI)"
    echo "[dry-run] would: docker-compose ... run --rm saas-api sh -c 'cd /voxly/packages/db && ./node_modules/.bin/prisma migrate deploy'"
  fi
  if [[ ${#BUILD_SVCS[@]} -gt 0 ]]; then
    echo "[dry-run] would: cd ${REMOTE_DIR}/docker && docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env up -d --build ${BUILD_SVCS[*]}"
  fi
  echo "[dry-run] would smoke-wait (up to 60s per endpoint, retries every 3s) https://getvoxly.ru/ and https://api.getvoxly.ru/health"
  exit 0
fi

# Connectivity
remote 'echo ok >/dev/null'

# --- Backup DBs ---
if [[ "$SKIP_BACKUP" -eq 0 ]]; then
  STAMP="$(date -u +%Y%m%d-%H%M%S)"
  echo "=== Backup DBs → ${REMOTE_DIR}/backups/${STAMP} ==="
  remote "bash -s" <<REMOTE
set -euo pipefail
STAMP='${STAMP}'
DIR='${REMOTE_DIR}/backups/'\$STAMP
mkdir -p "\$DIR"
# Prefer compose project container names
CTRL=\$(docker ps --format '{{.Names}}' | grep -E 'postgres-control' | head -1 || true)
TWENTY=\$(docker ps --format '{{.Names}}' | grep -E 'postgres-twenty' | head -1 || true)
if [[ -z "\$CTRL" || -z "\$TWENTY" ]]; then
  echo "Could not find postgres containers" >&2
  docker ps --format '{{.Names}}' >&2
  exit 1
fi
docker exec "\$CTRL" pg_dump -U voxly -d voxly_control -Fc > "\$DIR/voxly_control.dump"
docker exec "\$TWENTY" pg_dump -U twenty -d twenty -Fc > "\$DIR/twenty.dump"
ls -lh "\$DIR"
REMOTE
else
  echo "=== Skipping DB backup (--skip-backup) ==="
fi

# --- Rsync each path into the same relative location (never flatten into a parent dir) ---
echo "=== Rsync ==="
for p in "${PATHS[@]}"; do
  src="$ROOT/$p"
  # Trailing slash semantics: dir contents vs dir itself — keep path identity on remote
  if [[ -d "$src" ]]; then
    remote "mkdir -p '${REMOTE_DIR}/${p%/}'"
    rsync -az --delete "${RSYNC_EXCLUDES[@]}" -e "$rsync_ssh" \
      "${src%/}/" "${USER}@${HOST}:${REMOTE_DIR}/${p%/}/"
  else
    remote "mkdir -p '$(dirname "${REMOTE_DIR}/$p")'"
    rsync -az "${RSYNC_EXCLUDES[@]}" -e "$rsync_ssh" \
      "$src" "${USER}@${HOST}:${REMOTE_DIR}/$p"
  fi
  echo "  synced $p"
done

# Guard: never leave override on prod as active compose file
remote "rm -f '${REMOTE_DIR}/docker/docker-compose.override.yml' || true"

# --- Prisma migrate deploy (before container restart) ---
NEEDS_MIGRATE=0
for svc in "${BUILD_SVCS[@]}"; do
  case "$svc" in
    saas-api|gift-bot-worker|manager-bot-service|ai-telegram-worker|ai-whatsapp-worker|gramjs-bridge)
      NEEDS_MIGRATE=1; break ;;
  esac
done

if [[ "$NEEDS_MIGRATE" -eq 1 ]]; then
  echo "=== Prisma migrate deploy (control DB) ==="
  # Build saas-api image first (contains prisma CLI + migration files)
  remote "bash -s" <<REMOTE
set -euo pipefail
cd '${REMOTE_DIR}/docker'
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env build saas-api
REMOTE
  # Run migration in a one-off container (postgres-control already running)
  remote "bash -s" <<REMOTE
set -euo pipefail
cd '${REMOTE_DIR}/docker'
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env \
  run --rm saas-api sh -c "cd /voxly/packages/db && ./node_modules/.bin/prisma migrate deploy"
REMOTE
  echo "  migrations applied (or already up-to-date)"
else
  echo "=== Skipping Prisma migrate (no prisma-using services in this deploy) ==="
fi

# --- Rebuild ---
if [[ ${#BUILD_SVCS[@]} -gt 0 ]]; then
  echo "=== docker-compose up -d --build ${BUILD_SVCS[*]} ==="
  PROFILE_FLAG=""
  for svc in "${BUILD_SVCS[@]}"; do
    if [[ "$svc" == "evolution-api" ]]; then
      PROFILE_FLAG="--profile whatsapp"
      break
    fi
  done
  remote "bash -s" <<REMOTE
set -euo pipefail
cd '${REMOTE_DIR}/docker'
# Explicitly do NOT pass -v / override
# evolution-api lives under compose profile "whatsapp".
docker-compose -f docker-compose.yml -f docker-compose.prod-npm.yml --env-file ../.env \
  ${PROFILE_FLAG} up -d --build ${BUILD_SVCS[*]}
docker ps --format 'table {{.Names}}\t{{.Status}}' | head -40
REMOTE
else
  echo "=== No compose services to rebuild (compose files only) ==="
fi

# --- Smoke (retry until ready or timeout) ---
SMOKE_TIMEOUT=60   # seconds total per endpoint
SMOKE_INTERVAL=3   # seconds between retries

smoke_wait() {
  local url="$1"
  local elapsed=0
  local code=""
  while (( elapsed < SMOKE_TIMEOUT )); do
    code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)" || code="000"
    if [[ "$code" == "200" ]]; then
      echo "  OK $code  $url  (${elapsed}s)"
      return 0
    fi
    echo "  waiting… $url → $code (${elapsed}/${SMOKE_TIMEOUT}s)"
    sleep "$SMOKE_INTERVAL"
    (( elapsed += SMOKE_INTERVAL )) || true
  done
  # Final attempt after last sleep
  code="$(curl -sk -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 "$url" 2>/dev/null)" || code="000"
  if [[ "$code" == "200" ]]; then
    echo "  OK $code  $url  (${elapsed}s)"
    return 0
  fi
  echo "  FAIL $url → last $code (gave up after ${SMOKE_TIMEOUT}s)" >&2
  return 1
}

echo "=== Smoke (waiting up to ${SMOKE_TIMEOUT}s per endpoint) ==="
fail=0
for url in \
  'https://getvoxly.ru/' \
  'https://api.getvoxly.ru/health'
do
  if ! smoke_wait "$url"; then
    fail=1
  fi
done

# Extra smoke if twenty rebuilt
if [[ ${#BUILD_SVCS[@]} -gt 0 ]]; then
  for cs in "${BUILD_SVCS[@]}"; do
    if [[ "$cs" == twenty-server || "$cs" == twenty-worker ]]; then
      if ! smoke_wait 'https://app.getvoxly.ru/healthz'; then
        fail=1
      fi
      break
    fi
  done
fi

if [[ "$fail" -ne 0 ]]; then
  echo "SMOKE FAILED — check containers/logs; DB backup kept under ${REMOTE_DIR}/backups/" >&2
  exit 1
fi

echo
echo "OK. Append WORKLOG: services=${EXPANDED[*]} host=${HOST}"
echo "Prisma migrations applied automatically before container rebuild."
echo "Reminder: never docker compose down -v on prod."
