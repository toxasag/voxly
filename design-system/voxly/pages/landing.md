# Landing `/`

## Active design lock

**Source of truth for next rebuild:** [`landing-awwwards-v2.md`](./landing-awwwards-v2.md) (PROMPT v2 — Awwwards / conversion).

Until that file is implemented in `apps/saas-portal/src/app/page.tsx`, production may still show the AIDA industrial page (mascot hero). Do not mix thesis: **CRM command center + mobile web without apps** wins over “трёх сервисов” alone.

## Positioning (locked)

**Primary:** VoxlyCRM — командный центр продаж. Каналы, диалоги, AI и рассылки управляются из CRM. Мобильный веб, apps не нужны.

**Secondary:** модули как оружие CRM (не каталог трафика).

**Tertiary:** от 500 ₽ · 7 дней без карты · hard lock после trial.

**Vs market:** конкуренты (GramGPT / TraffSoft / Easy AI / DarkTelegram craft only) продают трафик в TG; Voxly продаёт закрытие лида в CRM.

## Market anchors (public tariffs, mid-2026)

| Category | Market entry | Voxly |
|---|---|---|
| TG funnel builder | BotHelp ~1 599, Salebot ~2 999 | Gift 500/канал |
| AI + CRM bundle | 7sales ~3 990, Botseller Start ~4 900 | CRM 500 + AI channel 500–1 000 |
| WA in CRM | Wazzup ~1 000–6 000, Pact from ~2 000 | WA 500/акк |
| CRM seats | amo/Kommo per seat → 10 seats easily 10k+ | CRM Base 500 / 10 users |

Stack example: market ~8–15k vs Voxly from 500 (CRM) / ~1.5–2k typical contour. Label as ориентир.

## Visual (marketing)

- Swiss Modernism 2.0 × Industrial Editorial
- Tokens: ink `#0A0A0A`, paper, mist `#F3F3F3`, amber `#F5A623` — **not** ServiceApp blue, **not** purple AI
- Type: Unbounded + Manrope + JetBrains Mono
- Signature: phone CRM chat + ambient desktop kanban
- No cards in hero; one pin section = Mobile Proof

## Components

Landing uses `@/components/ui/*` sparingly (Button patterns via land-btn, Accordion FAQ). Prefer editorial rows over Card grids. Keep `RegisterLink`, `ReferralCapture`, `LEGAL`.
