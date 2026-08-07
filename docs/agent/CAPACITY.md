# Prod capacity & scaling (Voxly VPS)

Факты с prod, **не выдумывать**. Обновляй после значимого infra/ops или перед фичей с постоянной нагрузкой.

**Host:** `150.241.98.135` · code `/opt/voxly` · deploy только `./scripts/prod-deploy.sh` · **never** `docker compose down -v`.

---

## Snapshot (measured)

| Field | Value |
|---|---|
| Measured at (UTC) | **2026-08-07T07:44:55Z** (post Stage-0 prune) |
| Hostname | `ai-agents-server-n8n.com` |
| Kernel | Linux 5.15.0-185-generic x86_64 |
| vCPU | **6** (guest: AMD Ryzen 9 5950X 16-Core, 6 online) |
| RAM | **9.7 GiB** total · ~3.7 GiB MemAvailable · **0 swap** (pre-prune measure 07:35Z) |
| Disk `/` | **99G** total · **22G** used · **72G avail (24%)** — was 97%/3.2G free before prune |
| Load | 0.09 / 0.10 / 0.08 (idle at 07:35Z measure) |
| Tenants (control DB) | **3** total · **3** with `twentyWorkspaceId` |

**Ops 2026-08-07:** Stage 0 — `docker image prune -af` reclaimed **~66.9GB** unused images; container prune **882MB**; journal vacuum **160MB**. Volumes untouched. API/portal **200**. Pre-prune: Images 309 / 71GB reclaimable (INC-052/092 pattern).

### Top memory consumers (docker stats, no-stream)

| Container | Mem | Mem% |
|---|---|---|
| baserow (automation) | ~1.9 GiB | ~19% |
| twenty-server | ~914 MiB | ~9% |
| twenty-worker | ~769 MiB | ~8% |
| automation-n8n | ~717 MiB | ~7% |
| evolution-api | ~217 MiB | ~2% |
| saas-portal | ~151 MiB | ~1.5% |
| + control/twenty PG, redis, bridges, workers | smaller | — |

**Status at measure:** disk **OK after prune** (72G free). Re-check before multi-service deploy; keep ≥15–20G free. RAM headroom still thin for rebuild spikes. CPU load low — bottleneck remains **RAM + co-hosted automation**, not idle CPU. Disk can refill fast after many rebuilds (dangling images).

---

## Workload model (why heavy)

One box runs:

- Twenty multi-workspace (**server + worker** ~1.7 GiB steady)
- **2× Postgres** (control + twenty) + Redis
- Evolution (WA) + GramJS + MAX bridge + AI/gift workers + portal/api + Traefik
- **Alongside:** n8n + Baserow + automation postgres/redis/nocodb/npm — competes for RAM/disk

Any new always-on worker, media AI, full-tenant history sync, or research-bot increases ENOSPC/OOM risk **before** product logic fails.

---

## Capacity bands (ranges — not false precision)

При текущем профиле (**~10 GiB RAM / ~100G disk / 6 vCPU**) и соседней automation:

| Band | Active CRM portals (rough) | Notes |
|---|---|---|
| **Comfortable** | **~2–4** | Нужна гигиена диска (≥15–20G free). Сейчас 3 тенанта уже на диске в danger. |
| **Stretch** | **~4–6** | Только после Stage 0 hygiene **и** ideally выноса automation; деплои с prune; без тяжёлых all-tenant sync. |
| **Danger** | признаки ниже | Не «число клиентов», а метрики. |

### Danger signals

- Disk free **&lt; 15 GB** (лучше &lt; 20 GB → уже ops alert) — deploy ENOSPC, PG panic, Redis MISCONF (INC-052, INC-092)
- Disk free **&lt; 5 GB** — stop deploys; prune first
- MemAvailable низкий / thrash; **no swap**
- Load average **стойко &gt; vCPU** (сейчас 6)
- `refresh-crm-chat` mid-ENOSPC → вкладка «Чат» пропала (INC-070)
- Долгие WA/TG/MAX **history sync** на многих аккаунтах одновременно

**Сколько «клиентов тянет» сейчас:** порядка **нескольких** активных CRM-порталов (единицы), не десятки. При 3 тенантах диск уже 97% — лимит **не** «бизнес логика CRM», а **место под Docker images + shared automation**.

---

## Known INC (disk / deploy)

- **INC-052** — disk full → Postgres panic mid-deploy
- **INC-092** — disk full → login 500 / PG recovery / Redis MISCONF (~68GB dangling images)
- **INC-070** — ENOSPC during `refresh-crm-chat` → Chat tab missing
- **INC-090** — related timeout/deploy pressure (gift media / Traefik); keep free space before heavy ops

Prevention: `docker image prune` (**without** `-v`), log vacuum, backup retention; keep ≥15GB free before rebuilds.

---

## Scaling playbook (order)

### Stage 0 — ops hygiene (do first, always)

- `docker image prune -f` (dangling); careful `prune -af` only when sure unused
- Truncate huge `*-json.log`; `journalctl --vacuum-size=50M`
- Retention on `/opt/voxly/backups/`
- **Never** wipe named volumes / `down -v`
- Target: **≥20GB** free on `/` before multi-service deploy

### Stage 1 — bigger single VPS

Целевой ориентир для **этого** стека (Twenty×N + messengers + AI), скорректировано от факта 6 vCPU / 10G / 100G:

- **Min next box:** **8+ vCPU / 32 GB RAM / 300+ GB NVMe**
- Comfortable growth: **12–16 vCPU / 64 GB RAM / 500 GB+ NVMe**
- Вынести automation (n8n/baserow) раньше или сразу на Stage 2

### Stage 2 — split by role

| Role | Services |
|---|---|
| **Data** | postgres-control, postgres-twenty, Redis, backups |
| **App** | saas-api, saas-portal, edge/Traefik (NPM) |
| **CRM** | twenty-server, twenty-worker |
| **Messengers** | evolution-api, gramjs-bridge, max-bridge, ai-whatsapp/telegram/gift workers |
| **Automation** | n8n, baserow, etc. — **отдельный хост**, не prod CRM box |

---

## Agent rule

Перед фичей с **новой постоянной нагрузкой** (worker, тяжёлый sync, media AI, research-бот, all-tenant backfill):

1. Открыть этот файл.
2. В Risk Gate §6 явно: риск «упрёмся в **disk/RAM** раньше бизнес-логики».
3. Если disk &lt;15GB — сначала Stage 0, не ship.

---

## Refresh commands (readonly SSH)

Если snapshot **STALE** или SSH недоступен — не выдумывать цифры; пометить STALE и попросить прогон:

```bash
hostname; uname -a
nproc; lscpu | egrep 'Model name|CPU\(s\)|Core|Thread'
free -h
df -h / /opt /var/lib/docker 2>/dev/null | head
uptime
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' | head -40
docker exec docker-postgres-control-1 psql -U voxly -d voxly_control -t -A \
  -c 'SELECT count(*) FROM "Tenant";'
docker exec docker-postgres-control-1 psql -U voxly -d voxly_control -t -A \
  -c 'SELECT count(*) FROM "Tenant" WHERE "twentyWorkspaceId" IS NOT NULL;'
```
