# Capabilities (существует — не переписывать)

Чеклист product surface. ✅ = в коде. ❌ = нет / stub / pending. Пути — якоря.

Обновляй этот файл при изменении API/UI/worker surface.

---

## Portal pages (`apps/saas-portal/src/app`)

| Path | Статус | Файл |
|---|---|---|
| `/` лендинг | ✅ Twenty light | `page.tsx` |
| `/login`, `/register` | ✅ | `login/page.tsx`, `register/page.tsx` |
| `/dashboard` | ✅ 4 блока, CRM new tab, referral copy | `dashboard/page.tsx` |
| `/dashboard/bots` | ✅ список gift-ботов | `dashboard/bots/page.tsx` |
| `/dashboard/bots/[botId]` | ✅ канал, promo, funnel, media, chat, subscribers | `dashboard/bots/[botId]/page.tsx` |
| `/dashboard/bots/broadcasts` | ✅ | `dashboard/bots/broadcasts/page.tsx` |
| `/admin` | ✅ stats + tenants + воронки | `admin/page.tsx` |
| Tenant funnel stats на `/dashboard/bots` | ❌ только супер-админ | — |
| Deal-card chat UI в Twenty | ✅ inject: format, attach, media; Person + Opportunity | `docker/twenty-deal-chat.js` |

Shared UI: `components/portal/*`, `components/ui/*`, `components/telegram-preview.tsx`.

**Design workflow:** Cursor skill `ui-ux-pro-max` at `.cursor/skills/ui-ux-pro-max/` (`uipro init --ai cursor`). Persist/search via `python3 .cursor/skills/ui-ux-pro-max/scripts/search.py … --design-system`. Tokens stay Twenty light in `globals.css`; synthesized rules in `design-system/voxly/MASTER.md`.

---

## API (`apps/saas-api` → prefix в `src/index.ts`)

### Auth `/api/auth`
| Method | Path | ✅ |
|---|---|---|
| POST | `/register`, `/login` | ✅ |
| GET | `/me` | ✅ flat `user.tenant` |
| POST | `/invite` | ✅ |

### Billing `/api/billing`
| Method | Path | ✅ |
|---|---|---|
| POST | `/checkout`, `/result` | ✅ |
| GET | `/success`, `/status` | ✅ |

### Tenant `/api/tenant`
| Method | Path | ✅ |
|---|---|---|
| GET | `/`, `/members`, `/crm-login` | ✅ |
| PATCH | `/` | ✅ |
| DELETE | `/members/:memberId` | ✅ |

### Bots `/api/bots`
| Method | Path | ✅ |
|---|---|---|
| POST | `/gift/start-trial`, `/provision-link` | ✅ |
| GET | `/` (+ subscriberCount, promoPost) | ✅ |
| PUT | `/:botId/campaign` (+ `campaignId`, `name`) | ✅ |
| POST | `/:botId/campaigns` (создать проект) | ✅ |
| PATCH | `/:botId/campaigns/:campaignId` (`name`, `isActive`; **один active на бота**) | ✅ |
| GET | `/` → `campaigns[]` + `campaign` (active/newest) | ✅ |
| PUT | `/:botId/promo` (+ `campaignId`) | ✅ |
| POST | `/:botId/media`, `/:botId/promo/publish`, `/:botId/channel/verify` | ✅ |
| POST/GET | `/:botId/broadcasts` | ✅ |
| GET | `/:botId/subscribers`, `.../messages` | ✅ |
| POST | `.../reply` | ✅ |
| DELETE | `/:botId` | ✅ |
| POST | `/webhook/:botId` | ✅ (prod webhook; local = poll) |
| GET/POST | `/api/crm/chat/:recordId` (+ `/reply`, `/file/:fileId`) | ✅ Opportunity **или** Person id; text+media+MarkdownV2 |

### Admin `/api/admin`
| Method | Path | ✅ |
|---|---|---|
| GET | `/stats`, `/tenants`, `/tenants/:id`, `/funnels` | ✅ |
| POST | `.../suspend`, `.../pricing`, `.../credit`, `.../reapply-crm-defaults` | ✅ |
| PATCH | `/settings` | ✅ |

### Referral `/api/referrals`
| Method | Path | ✅ |
|---|---|---|
| GET | `/`, `/rules`, `/click/:code` | ✅ |
| POST | `/rules` (superadmin) | ✅ |

### Analytics `/api/analytics`
| Method | Path | ✅ |
|---|---|---|
| GET/POST/DELETE | integrations | ✅ |
| GET | `/click/:code`, `/conversions`, `/admin/stats` | ✅ |
| POST | `/fire` | ✅ |

### Health
`GET /health` ✅

---

## Workers / features

| Feature | Где | ✅ |
|---|---|---|
| Managed Bot provision + encrypt token | manager-bot-service | ✅ |
| Funnel + delays + channel verify + gift | gift-bot-worker | ✅ |
| Promo click / deep-link `g_{id}` | gift-bot-worker + bots routes | ✅ |
| Media via Telegram `file_id` | bots media + worker send | ✅ |
| Client Markdown → MarkdownV2 | `packages/shared/src/telegram-md.ts` | ✅ |
| Broadcasts | gift-bot-worker | ✅ |
| CRM Person/Opportunity + notes | gift-bot-worker + twenty-client | ✅ + custom Person.`telegram` (`@username`) |
| fireGoal + campaignId/botInstanceId | gift-bot-worker → ConversionEvent | ✅ |
| Username `voxly_{slug}_{NN}_bot` | `buildVoxlyBotUsername` | ✅ |
| AI Telegram / WhatsApp workers | apps/ai-* | ✅ код есть; E2E не фокус |
| `emailWorker` SMTP | queues.ts | ❌ logging stub |
| `notifyHumanOperator` | AI workers | ❌ |
| GramJS bridge | — | ❌ pending |
| Twenty App SDK deal chat | twenty-app + `/api/crm/chat` | ⬜ SDK later; inject ✅ |
| `installApp` in provisioning | provisioning.ts | ❌ dead; use sync/install later |

---

## Shared helpers (не дублировать)

- `DEFAULT_GIFT_FUNNEL` / `DEFAULT_GIFT_PROMO` — `packages/shared`
- `resolveTelegramMedia`, `buildVoxlyBotUsername`
- `parseTelegramClientMd` / `clientMdToMarkdownV2`
- Crypto: `@voxly/crypto`
