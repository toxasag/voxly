# Incidents (runtime)

Известные сбои и как диагностировали. **При дебаге читай первым.**  
Новый failure mode → добавь запись сюда + строку в WORKLOG.

---

---

### INC-008 — CRM opens blank tab / `/welcome` from dashboard
- **Симптом:** пустая вкладка; или `localhost:3007/welcome`; или `*.lvh.me` blank SPA.
- **Причины:** (1) noopener `_blank`; (2) SSO на голый localhost → `/welcome`; (3) rewrite на `*.lvh.me` — в браузере белый/чёрный экран; Chromium нормально открывает `*.localhost`.
- **Диагностика:** `test2.lvh.me` blank vs `test2.localhost` рендерит Voxly; `crm-login` host.
- **Фикс:** local `SERVER_URL=http://localhost:3007`; SSO `http://{slug}.localhost:3007/verify?…`; не lvh.me; named window `voxly_crm`.
- **Дата:** 2026-07-20.

### INC-007 — CRM Person/Opportunity not created on gift `/start`
- **Симптом:** чат в портале есть, в Twenty нет контакта/сделки; `GiftSubscriber.twentyPersonId` пустой.
- **Причина:** Twenty 2.22 GraphQL: `createPerson(input:)` → `Argument not allowed: input`; нужно `createPerson(data:)`.
- **Диагностика:** `docker logs gift-bot-worker | rg 'CRM sync error|Argument not allowed'`.
- **Фикс:** `packages/twenty-client` mutations `data:` + fallback `name{firstName,lastName}`; дедуп Person по telegramId/username.
- **Дата:** 2026-07-20.

### INC-006 — Portal :3001 down (docker saas-portal exited)
- **Симптом:** сайт/дашборд не грузятся (`portal:000`); API/CRM могут быть ок.
- **Причина:** контейнер `saas-portal` остановлен (раньше крутили host `next start`, docker portal `Exited`); порт 3001 мог держать lima SSH mux.
- **Диагностика:** `docker ps -a --filter name=saas-portal`; `curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/`.
- **Фикс:** `cd docker && docker compose --env-file ../.env up -d saas-portal` (Colima running).
- **Дата:** 2026-07-18.

### INC-001 — Redis AOF corrupt (локально)
- **Симптом:** Redis / зависимые сервисы unhealthy; BullMQ/Twenty не стартуют.
- **Причина:** повреждённый AOF в volume `redis-data` (compose: `--appendonly yes`).
- **Диагностика:** `docker logs redis`; `redis-cli ping` fails / AOF load error.
- **Фикс:** починить/сбросить AOF (осторожно с данными очередей) → контейнер healthy → поднять api/workers.
- **Дата:** ~2026-07-18 (Colima restart session).

### INC-002 — `api.telegram.org` unreachable
- **Симптом:** `manager-bot-service` рестартится; gift-bot polling падает; Google/прочий HTTPS ок.
- **Причина:** сеть/ISP блокирует Telegram (таймаут с хоста и из контейнеров).
- **Диагностика:** `curl -m 5 https://api.telegram.org` с хоста и `docker compose exec … curl`.
- **Фикс:** VPN/прокси до Telegram → restart `manager-bot-service` + `gift-bot-worker`.
- **Дата:** 2026-07-18.

### INC-003 — Docker portal показывает старый dark/purple UI
- **Симптом:** `:3001` — indigo gradient, white-on-white «Войти», ghost inputs; в git уже Twenty light.
- **Причина:** stale image/container без rebuild.
- **Диагностика:** сравнить UI с исходниками `apps/saas-portal`; проверить дату image.
- **Фикс:**  
  `docker compose --env-file ../.env up -d --build saas-portal`  
  Также: `next/font/google` → ETIMEDOUT в Docker build → system font stack.
- **Дата:** 2026-07-18.

### INC-004 — Portal `/api` бил не туда (ранний local)
- **Симптом:** register/login 404 / connection refused к API.
- **Причина:** rewrite на `localhost` без префикса `/api` или без Docker DNS.
- **Фикс:** `next.config.ts` → `SAAS_API_URL` + `/api/:path*` → `${apiBase}/api/:path*`.
- **Дата:** 2026-07-15 (зафиксировано в steps.md).

### INC-005 — Gift media silent fail (photo vs document)
- **Симптом:** подарок/медиа не уходит в Telegram.
- **Причина:** неверный метод send по типу; `file_id` префиксы путались.
- **Фикс:** `detectStoredMediaKind` / `resolveTelegramMedia` (`AgAC`→photo, `BQAC`→document, …).
- **Дата:** ~2026-07-16.

### INC-006 — Twenty Apps: `installApp` missing (2.22)
- **Симптом:** provisioning warn+skip; custom App не ставится.
- **Причина:** в 2.22 нет legacy `installApp`; есть `syncApplication` / `installApplication`.
- **Фикс (план):** ADR-001 — SDK app + новые mutation; stub не патчить.
- **Дата:** 2026-07-17.
