#!/usr/bin/env bash
# =============================================================================
# Voxly local ↔ prod hot-file checksum diff
# =============================================================================
# Compares a curated list of files (not full trees) so you know what a deploy
# would change BEFORE running prod-deploy.sh.
#
# Exit 0 = all compared paths match.
# Exit 1 = drift / missing / SSH failure — print table + hint to deploy.
#
# Docs: docs/agent/ENVIRONMENTS.md (keep drift table updated after deploys)
# Pair: ./scripts/prod-deploy.sh
#
# Usage:
#   ./scripts/prod-diff.sh
#   ./scripts/prod-diff.sh saas-portal
#   ./scripts/prod-diff.sh saas-api,saas-portal
#
# Env: same as prod-deploy.sh (VOXLY_PROD_HOST, VOXLY_PROD_USER, VOXLY_PROD_DIR, SSHPASS)
# =============================================================================

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${VOXLY_PROD_HOST:-150.241.98.135}"
USER="${VOXLY_PROD_USER:-root}"
REMOTE_DIR="${VOXLY_PROD_DIR:-/opt/voxly}"
SERVICES_RAW="${1:-all-apps}"

ssh_base=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)
if [[ -n "${SSHPASS:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "SSHPASS is set but sshpass is not installed" >&2
    exit 1
  fi
  ssh_base=(sshpass -e "${ssh_base[@]}")
fi

remote() {
  "${ssh_base[@]}" "${USER}@${HOST}" "$@"
}

sha_local_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    sha256sum "$1" | awk '{print $1}'
  fi
}

# Key files per service (files only — dirs expanded to known hot files)
files_for_service() {
  local svc="$1"
  case "$svc" in
    saas-portal)
      echo "apps/saas-portal/src/app/globals.css"
      echo "apps/saas-portal/src/app/page.tsx"
      echo "apps/saas-portal/src/app/login/page.tsx"
      echo "apps/saas-portal/src/app/dashboard/page.tsx"
      echo "apps/saas-portal/package.json"
      ;;
    saas-api)
      echo "apps/saas-api/src/jobs/queues.ts"
      echo "apps/saas-api/src/routes/crm-chat.ts"
      echo "apps/saas-api/src/routes/auth.ts"
      echo "apps/saas-api/src/routes/tenant.ts"
      echo "apps/saas-api/src/services/twenty-custom-domain.ts"
      echo "apps/saas-api/Dockerfile"
      echo "packages/twenty-client/src/index.ts"
      echo "twenty-app/voxly-crm-chat/src/front-components/chat-panel.tsx"
      ;;
    gift-bot-worker)
      echo "apps/gift-bot-worker/package.json"
      ;;
    manager-bot-service)
      echo "apps/manager-bot-service/src/index.ts"
      ;;
    ai-telegram-worker)
      echo "apps/ai-telegram-worker/src/index.ts"
      echo "apps/ai-telegram-worker/package.json"
      ;;
    ai-whatsapp-worker)
      echo "apps/ai-whatsapp-worker/src/index.ts"
      echo "apps/ai-whatsapp-worker/package.json"
      echo "packages/twenty-client/src/index.ts"
      ;;
    gramjs-bridge)
      echo "apps/gramjs-bridge/src/index.ts"
      echo "apps/gramjs-bridge/package.json"
      ;;
    twenty)
      echo "docker/twenty.Dockerfile"
      echo "docker/patch-twenty-functions-url.cjs"
      echo "docker/patch-twenty-front-component-url.cjs"
      ;;
    compose)
      echo "docker/docker-compose.yml"
      echo "docker/docker-compose.prod-npm.yml"
      ;;
    all-apps)
      files_for_service saas-portal
      files_for_service saas-api
      files_for_service gift-bot-worker
      files_for_service manager-bot-service
      files_for_service ai-telegram-worker
      files_for_service ai-whatsapp-worker
      files_for_service twenty
      files_for_service compose
      ;;
    *)
      echo "Unknown service: $svc" >&2
      exit 2
      ;;
  esac
}

IFS=',' read -r -a REQ <<<"$SERVICES_RAW"
ALL_FILES=()
for s in "${REQ[@]}"; do
  s="$(echo "$s" | tr -d '[:space:]')"
  [[ -z "$s" ]] && continue
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    ALL_FILES+=("$f")
  done < <(files_for_service "$s")
done

FILES=()
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  FILES+=("$f")
done < <(printf '%s\n' "${ALL_FILES[@]}" | awk 'NF && !seen[$0]++')
echo "=== prod-diff ${USER}@${HOST}:${REMOTE_DIR} (services: ${SERVICES_RAW}) ==="
printf '%-10s  %-10s  %s\n' "STATUS" "MATCH" "PATH"

drift=0
for f in "${FILES[@]}"; do
  local_path="$ROOT/$f"
  if [[ ! -f "$local_path" ]]; then
    printf '%-10s  %-10s  %s\n' "LOCAL_MISS" "-" "$f"
    drift=1
    continue
  fi
  lh="$(sha_local_file "$local_path")"
  rh="$(remote "if [ -f '${REMOTE_DIR}/$f' ]; then sha256sum '${REMOTE_DIR}/$f' | awk '{print \$1}'; else echo MISSING; fi" || echo FAIL)"
  if [[ "$rh" == "MISSING" ]]; then
    printf '%-10s  %-10s  %s\n' "PROD_MISS" "-" "$f"
    drift=1
  elif [[ "$rh" == "FAIL" ]]; then
    printf '%-10s  %-10s  %s\n' "SSH_FAIL" "-" "$f"
    drift=1
  elif [[ "$lh" == "$rh" ]]; then
    printf '%-10s  %-10s  %s\n' "OK" "yes" "$f"
  else
    printf '%-10s  %-10s  %s\n' "DRIFT" "no" "$f"
    drift=1
  fi
done

echo
if [[ "$drift" -ne 0 ]]; then
  echo "Drift detected. Ship with: ./scripts/prod-deploy.sh <service>"
  exit 1
fi
echo "All compared paths match."
