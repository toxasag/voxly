# Design System Master File — ServiceApp Palette

> **LOGIC:** When building a specific page, first check `design-system/voxly/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Voxly (ServiceApp UI Design System)
**Generated:** 2026-07-27
**Design Framework:** React / Tailwind CSS + shadcn/ui
**Primary Color:** #2563EB (Brand Blue)
**Category:** B2B SaaS CRM & Client Management
**Design Dials:** Variance 3/10 (Minimal) | Motion 4/10 (Standard) | Density 7/10 (Standard)

## ServiceApp Override — Primary Source of Truth

Portal tokens live in `apps/saas-portal/src/app/globals.css` with ServiceApp palette:
- **Brand Primary:** #2563EB (Blue) + hover state #1D4ED8
- **Neutrals:** Slate/blue-gray palette (#F8FAFC to #0F172A)
- **Status colors:** Success (emerald), Warning (amber), Danger (red), Info (indigo)
- **Typography:** Inter, system UI stack (no external font fetches in Docker)
- **Spacing:** Component-relative grid with 16px gap, 20px card padding

Use this file for **structure, UX checklist, density, anti-patterns** — CSS variables defined in globals.css.

---

## Global Rules

### Color Palette (implemented — ServiceApp)

| Role | Hex | Token | Usage |
|------|-----|-------|-------|
| Background / Canvas | `#F8FAFC` | `--neutral-bg-canvas` | Page background |
| Surface / Card | `#FFFFFF` | `--neutral-bg-surface` | Card, modal, panel |
| Foreground / Text Main | `#0F172A` | `--neutral-text-main` | Headlines, primary text |
| Text Body | `#334155` | `--neutral-text-body` | Body text, descriptions |
| Text Muted | `#64748B` | `--neutral-text-muted` | Hints, secondary labels |
| Border Default | `#E2E8F0` | `--neutral-border-default` | Card borders, dividers |
| **Primary CTA** | `#2563EB` | `--brand-primary` | Buttons, links, highlights |
| Primary Hover | `#1D4ED8` | `--brand-primary-hover` | Hover state |
| Primary Light (BG) | `#EFF6FF` | `--brand-primary-light` | Light backgrounds for primary |
| **Status: Success** | `#059669` (text) / `#ECFDF5` (bg) | `--status-success-*` | Completed, ready |
| **Status: In Progress** | `#2563EB` (text) / `#EFF6FF` (bg) | `--status-in-progress-*` | Active, processing |
| **Status: Warning** | `#D97706` (text) / `#FFFBEB` (bg) | `--status-warning-*` | Pending, caution |
| **Status: Danger** | `#DC2626` (text) / `#FEF2F2` (bg) | `--status-danger-*` | Error, overdue |
| **Status: Info** | `#6366F1` (text) / `#EEF2FF` (bg) | `--status-info-*` | New leads, channels |
| **Status: Neutral** | `#475569` (text) / `#F1F5F9` (bg) | `--status-neutral-*` | Archived, inactive |

### Typography (implemented)

- **Font Stack:** `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Mood:** Clean, professional, B2B SaaS, accessible
- **Sizing:** Base 13px (0.8125rem), XL 16px (1rem), KPI 30px (1.875rem)

| Size | Token | Usage |
|------|-------|-------|
| XS | `0.6875rem` (11px) | Badges, tags, micro labels |
| SM | `0.75rem` (12px) | Captions, secondary meta |
| Base | `0.8125rem` (13px) | Body text default |
| MD | `0.875rem` (14px) | Input, button text |
| LG | `1rem` (16px) | Section headlines, emphasis |
| XL | `1.25rem` (20px) | Page headings |
| 2XL | `1.5rem` (24px) | Main headings |
| KPI | `1.875rem` (30px) | Large metrics, dashboard KPIs |

**Weights:** Regular 400 · Medium 500 · Semibold 600 · Bold 700

### Spacing Variables (Implemented)

*Density: 7/10 — Standard, B2B-comfortable*

| Token | Value | Usage |
|-------|-------|-------|
| `--spacing-grid-gap` | `16px` | Grid gaps, component spacing |
| `--spacing-card-padding` | `20px` | Inner padding of cards, panels |
| `--spacing-header-height` | `60px` | Fixed header / top nav |
| `--spacing-sidebar-slim` | `64px` | Collapsed sidebar icon width |
| `--spacing-sidebar-sub` | `200px` | Expanded sidebar content |

### Border Radius (Implemented)

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-button` | `8px` | Buttons, inputs |
| `--radius-input` | `8px` | Form inputs, selects |
| `--radius-card` | `12px` | Card containers, modals |
| `--radius-banner` | `16px` | Hero banners, large CTAs |
| `--radius-badge` | `9999px` | Fully rounded badges, pills |

### Shadows (Implemented)

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)` | Card subtle lift |
| `--shadow-drawer` | `-4px 0 24px rgba(0, 0, 0, 0.12)` | Slide-over drawer shadow |

---

## Component Specifications

### Header
- **Height:** 60px fixed
- **Background:** `--neutral-bg-surface` (#FFFFFF)
- **Border Bottom:** 1px `--neutral-border-default`
- **Search Box BG:** `--neutral-bg-subtle` (#F1F5F9)
- **Profile Avatar BG:** `--brand-dark-slate` (#1E293B)
- **Profile Avatar Text:** #FFFFFF
- **Keyboard Shortcut Hint:** "Ctrl K"

### Hero Banner
- **Background:** Linear gradient `#3B82F6 → #1D4ED8` (135deg)
- **Text Color:** #FFFFFF
- **Border Radius:** 16px
- **CTA Buttons:**
  - Primary: Brand blue with white text
  - Secondary: White glass effect / primary light BG
- **Padding:** 20px card padding

### KPI Card
- **Background:** `--neutral-bg-surface` (#FFFFFF)
- **Border:** 1px `--neutral-border-default`
- **Border Radius:** 12px
- **Value Style:** Bold, text-slate-900 (#0F172A), size 2XL
- **Sparkline Color:** Emerald green (#10B981) with 10% opacity fill

### Data Table
- **Background:** `--neutral-bg-surface`
- **Border:** 1px `--neutral-border-default`
- **Header BG:** `#FAFAFA` (very subtle)
- **Header Text Color:** `--neutral-text-muted` (#64748B)
- **Row Height:** 56px
- **Row Hover BG:** `--neutral-bg-subtle` (#F1F5F9)
- **Row Border:** 1px `--neutral-border-light` (#F1F5F9)

### Slide-Over Drawer
- **Width:** 540px
- **Position:** Right
- **Backdrop:** rgba(#0F172A, 0.4) (dark slate with 40% opacity)
- **Footer:** Sticky, buttons: Primary | Outline | Ghost
- **Shadow:** `--shadow-drawer`

### Chat Inbox
- **Layout:** Split ratio 320px | 1fr
- **Channel Badge (Avito):** BG #EBF5FF, text #0066FF
- **Message Composer:** Send button (dark slate bg, white text, 8px radius, 4px 16px padding)

### Status Badge Variants

```
Success:     bg-#ECFDF5    text-#059669    border-#A7F3D0
In Progress: bg-#EFF6FF    text-#2563EB    border-#BFDBFE
Warning:     bg-#FFFBEB    text-#D97706    border-#FDE68A
Danger:      bg-#FEF2F2    text-#DC2626    border-#FECACA
Info:        bg-#EEF2FF    text-#6366F1    border-#C7D2FE
Neutral:     bg-#F1F5F9    text-#475569    border-#E2E8F0
```

---

## Tailwind Integration

### Color Shortcuts in Components

```jsx
// Use Tailwind utilities with design system colors
<button className="bg-[#2563EB] hover:bg-[#1D4ED8] text-white rounded-[8px]">
  Action
</button>

// Or reference CSS variables
<div className="bg-blue-50 border border-blue-200 rounded-lg">
  Content
</div>
```

### Custom Tailwind Aliases (if needed)

```js
// tailwind.config.ts extend
{
  colors: {
    'brand-primary': '#2563EB',
    'brand-dark': '#1E293B',
    'status-success': '#059669',
    'status-warning': '#D97706',
    'status-danger': '#DC2626',
    'status-info': '#6366F1',
  }
}
```

---

## AI Prompt Rules

**For Cursor, v0, Bolt, Lovable code generation:**

1. **Always use hex colors from this palette** — avoid inventing new colors.
2. **Match border radius to component type** — buttons 8px, cards 12px, banners 16px.
3. **Maintain 60px header height, 20px card padding, 16px grid gaps.**
4. **Status colors are semantic** — use `success` for completed, `in_progress` for active, `warning` for pending, `danger` for errors.
5. **Typography:** Inter primary, base size 13px body, scale up for KPIs to 30px.
6. **Dark mode:** All colors have dark alternatives in `globals.css` .dark selector.
7. **Shadows:** Use subtle shadows for cards, drawer shadow for side panels.
8. **Component library:** shadcn/ui — maintain compatibility.

---

## Anti-patterns (Do NOT use)

- ❌ Indigo, purple, or AI-slop colors outside of `--status-info-*`
- ❌ Fonts other than Inter (Geist, custom fonts add Docker build complexity)
- ❌ Border radius > 16px except badges (9999px)
- ❌ Arbitrary spacing — use 16px grid, 20px card padding, 60px header as base units
- ❌ Overlapping shadows (card + drawer shadow together)
- ❌ RGB/HSL notation — prefer hex (#2563EB) or CSS var references

---

## File References

- **CSS Variables:** `apps/saas-portal/src/app/globals.css`
- **Design Tokens JSON:** `design-system/voxly/serviceapp_design_system.json`
- **Component Library:** shadcn/ui in `apps/saas-portal/src/components/ui/`
- **Icons:** lucide-react

---

**Last Updated:** 2026-07-27 | **Version:** 1.0.0
