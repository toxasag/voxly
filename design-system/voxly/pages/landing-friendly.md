# Landing Friendly (live `/`)

Promoted 2026-08-07 from `/lp/friendly` draft. Previous Awwwards v3 kept at `apps/saas-portal/src/app/_archive/landing-v3/`.

## Paths

- `apps/saas-portal/src/app/page.tsx`
- `apps/saas-portal/src/components/landing/friendly/*`
- Alias: `/lp/friendly` → redirect `/` (preserves `?ref=`)
- CSS: `.friendly-lp` in `globals.css`

## Contract

- CTA → `/register` via `RegisterLink` (+ `?ref=` / ReferralCapture)
- Forms free (ADR-026); CRM Base 500 / 10 seats / +300 extra; Stories + Gift optional modules
- Referral default 20%
- Mobile sticky CTA + gift FAB
- Legal footer links unchanged
