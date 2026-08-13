# Address Book — быстрый lookup для агента

Lean index: **тема → docs + code + freeze + риск**. Не эссе. Не дублирует `CAPABILITIES.md` — только адреса.

**Как пользоваться:** найди 1–3 строки по задаче → открой docs/card → graphify query → Risk Gate (`RISK_GATE.md`) → код. Не читай весь файл вслух.

**New vs existing portals:** runtime shared на одних сервисах; новые тенанты получают поведение с provision; existing часто нужен backfill/reapply (см. Risk Gate §8 + `CAPACITY.md`).

| Тема / симптом | Адрес (docs) | Код / graphify | Freeze? | Риск при правке |
|---|---|---|---|---|
| Landing / portal UI | CAPABILITIES «Portal pages»; `design-system/voxly/pages/landing.md` | `apps/saas-portal/src/app/page.tsx`, `components/landing/friendly/*` · archive `_archive/landing-v{2,3}/` · `graphify query "landing portal"` | NO | ad-hoc rsync loose files в `src/app/` сносит лендинг |
| Auth OTP / register / login | CAPABILITIES Auth; DECISIONS GetVoxlybot | `saas-api/.../auth.ts`, `saas-portal/.../login\|register` · `graphify query "register OTP auth"` | NO | ломает вход всем тенантам; INC-092 disk→login 500 |
| Billing / Robokassa | CAPABILITIES Billing; DECISIONS ADR-023 | `saas-api/.../billing.ts`, `packages/billing` · `graphify query "Robokassa billing"` | NO | ResultURL/out_sum; hard lock paywall CRM |
| CRM Twenty provision / defaults | CAPABILITIES provision; FLOWS | `packages/twenty-client`, `saas-api` queues provision · `graphify query "applyWorkspaceDefaults provision"` | NO | reapply ≠ layout fix (INC-107); wipe workspace = data loss |
| Person social LINKS / open/tg / open/max | `modules/person-social-links.md`, CHAT.md | `twenty-client` social + `open-tg.ts` + `open-max.ts` · `graphify query "telegramOpenLink open/max"` | YES* | invent `t.me/+` / `max.ru/+`; layout drift INC-107 |
| CRM вкладка Чат | `modules/crm-chat-panel.md` (**FROZEN 2026-08-07 ~16:14** MAX+WA), CHAT.md | `twenty-app/voxly-crm-chat` **0.1.29**, `saas-api/.../crm-chat.ts` · `graphify query "ChatPanel crm-chat"` | YES | `refresh-crm-chat` при ENOSPC сносит вкладку (INC-070/090); keep `__typename` (INC-116); GramJS attach/format INC-117 (не ломать MAX/WA) |
| Unread badges / inbound toast | CHAT.md; CAPABILITIES unread | `crm-chat.ts` unread + `docker/twenty-shell-ux.js` · `graphify query "unread-badges inbound-toasts"` | YES | poll/shell-ux рассинхрон с app uninstall |
| Opp sort by chat activity | CHAT.md; `modules/cross-channel-enrich.md` | `touchOpportunityActivity`, `sync-opportunity-chat-activity.ts` · `graphify query "touchOpportunityActivity"` | NO† | existing Opps без backfill останутся «старыми» в Kanban |
| WA → Person/Opp + CRM WA chat | `modules/wa-crm-sync.md` (**FROZEN 2026-08-07 ~16:14**), CHAT.md | `apps/ai-whatsapp-worker`, crm-chat WA media · `graphify query "syncLeadToCrm LID Evolution"` | YES | LID/phone invent; дубли сделок; Contact book ≠ deals; pure base64 send (INC-114); multi-channel preview (INC-115) |
| GramJS / TG personal → CRM | `modules/gramjs-crm-sync.md`, CHAT.md | `gramjs-bridge`, `gramjs-chat-sync.ts`, portal gramjs · `graphify query "gramjs-chat-sync"` | YES | historySyncing / QR; social link ≠ chat send |
| TG Business / secretary | `modules/telegram-secretary.md` | `dashboard/ai`, `ai-telegram-worker` ai_tg · `graphify query "ai_tg Business secretary"` | YES | handoff/mode human; billing slots |
| Gift bot portal + worker | `modules/gift-bot.md`, ADR-027 | `dashboard/bots/[botId]`, `gift-bot-worker` · `graphify query "gift bot greeting preview"` | YES | UX regress all tenants; gift only subscribers |
| AI agent | `modules/ai-agent.md` | `AiAgent`, ai-telegram/whatsapp workers · `graphify query "AiAgent wallet markup"` | YES | wallet/markup; media ASR cost |
| MAX personal | `modules/max-personal.md` (**FROZEN 2026-08-07 ~16:14**), MAX-SMOKE.md | `max-bridge`, `max.ts`, `max-chat-sync.ts`, `max-phone-guard.ts` · `graphify query "max-bridge by-phone"` | YES‡ | PyMax hang INC-104; never invent max.ru/+; INC-113 channel/self/`me.contact`/owner-phone; chat_id≠user_id; freeze checklist in card |
| Cross-channel enrich by phone | `modules/cross-channel-enrich.md`, CHAT.md §7 | `enrich-person-by-phone.ts`, form-lead, WA/TG/MAX · `graphify query "enrichPersonCrossChannelByPhone"` | YES* | invent links; heavy admin backfill all tenants |
| Forms сайт (Tilda/WP) | FORMS.md, ADR-026 | `forms.ts`, `form-lead-parse.ts`, portal form-leads · `graphify query "processFormLead forms"` | NO | не путать с gift funnel; phone enrich side-effects |
| Deal / Opp dedupe | `modules/deal-dedupe.md` | `crm-deal-dedupe.ts`, crm-chat LFs · `graphify query "crm-deal-dedupe"` | YES* | hard-delete People; twin Opp |
| Referrals / partners | CAPABILITIES partners | `saas-api` referrals, `dashboard/partners`, admin partners · `graphify query "ReferralRule withdrawal"` | NO | payout/holds math; productScope rates |
| Super-admin | CAPABILITIES `/admin` | `saas-api/.../admin.ts`, `saas-portal/.../admin` · `graphify query "admin tenants reapply"` | NO | purge/delete tenant; service token ≠ JWT (INC-107) |
| Deploy / backups / local vs prod | DEPLOY.md, ENVIRONMENTS.md | `scripts/prod-deploy.sh`, `prod-diff.sh` · `graphify query "prod-deploy"` | N/A | **never** `down -v`; ad-hoc rsync; local `.env`→prod |
| Prod capacity / сколько клиентов | **CAPACITY.md** | host `150.241.98.135` `/opt/voxly` · (facts in CAPACITY) | N/A | новый worker/sync упрётся в disk/RAM раньше логики |
| Disk full / ENOSPC | INCIDENTS INC-052/070/090/092; CAPACITY; DEPLOY; rule `prod-disk-hygiene.mdc` | ops prune images (no `-v`) · — | N/A | PG panic + Redis MISCONF + chat tab loss mid-refresh |
| Graphify / agent memory | README.md, ADDRESS_BOOK, RISK_GATE | `graphify-out/`; rules `project-state`, `graphify`, `agent-memory-gate` | N/A | broad Grep без graphify = токены + пропуск edges |

\* Supporting freeze — открыть card до правки; baseline 2026-08-06 для TG/gift/AI/secretary; **MAX + WA CRM chat + panel FROZEN 2026-08-07 ~16:14** (user-confirmed).
† Live bump on new messages; **existing** deals need admin `sync-opportunity-chat-activity`.
‡ MAX + WA CRM chat: frozen 2026-08-07 ~16:14 MSK — see `max-personal.md` / `wa-crm-sync.md` / `crm-chat-panel.md` (do not regress without explicit ask).

## После значимой работы

Если появился новый surface/адрес — добавь **одну строку** сюда. Не раздувай.
