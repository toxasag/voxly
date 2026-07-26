# Landing `/`

## Positioning (locked)

**Offer:** полный нужный контур (CRM + боты + AI TG/WA + рассылки) → **7 дней бесплатно**, после оплаты **~в 3 раза дешевле** типичной рыночной сборки.

**Audience:** владельцы малого/среднего бизнеса и агентства, которые сейчас платят за Salebot/BotHelp + Wazzup/Pact + amo/Kommo (или AI-пакеты 7sales/Botseller).

## Market anchors (public tariffs, mid-2026)

| Category | Market entry | Voxly |
|---|---|---|
| TG funnel builder | BotHelp ~1 599, Salebot ~2 999 | Gift 500/канал |
| AI + CRM bundle | 7sales ~3 990, Botseller Start ~4 900 | CRM 500 + AI channel 500–1 000 |
| WA in CRM | Wazzup ~1 000–6 000, Pact from ~2 000, Chat2Desk ~7–8 000 | WA 500/акк |
| CRM seats | amo/Kommo per seat → 10 seats easily 10k+ | CRM Base 500 / 10 users |

Stack example on page: market ~8–15k vs Voxly ~1.5–2k. Always label as ориентир; disclaimer that competitor prices change.

## Hero

- Brand: Voxly
- H1: free 7 days + 3× cheaper (benefit, not feature list)
- Primary CTA: «Попробовать 7 дней бесплатно» → `/register`
- One product preview (deal chat), no decorative card grid

## Visual

**Theme:** shadcn indigo (ADR-020) — primary indigo CTAs, zinc surfaces (`globals.css`). No fake social proof numbers.

## Components (shadcn)

Landing uses `@/components/ui/*`: Button, Badge, Card, Separator, Table, Accordion, Alert. Keep marketing copy in `page.tsx`.
