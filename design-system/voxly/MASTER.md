# Design System Master File — ServiceApp UI Design System

> **LOGIC:** When building a specific page, first check `design-system/voxly/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Voxly (ServiceApp UI Design System)
**Updated:** 2026-07-27
**Target Framework:** React / Tailwind CSS
**Component Library:** shadcn/ui
**Icon Library:** lucide-react
**Primary Brand Color:** `#2563EB` (Brand Blue)
**Category:** B2B SaaS CRM & Client Management
**Design Dials:** Variance 3/10 (Centered / Minimal) | Motion 4/10 (Standard) | Density 7/10 (Standard)

## ServiceApp UI Design System (Source of Truth)

Portal tokens live in `apps/saas-portal/src/app/globals.css` and `apps/saas-portal/tailwind.config.ts`:
- **Brand Primary:** `#2563EB` (Blue), Hover: `#1D4ED8`, Light: `#EFF6FF`
- **Brand Slate:** `#1E293B` (Dark Slate), Hover: `#0F172A`
- **Neutrals:** Canvas `#F8FAFC`, Surface `#FFFFFF`, Subtle `#F1F5F9`, Border Default `#E2E8F0`
- **Text:** Main `#0F172A`, Body `#334155`, Muted `#64748B`, Placeholder `#94A3B8`
- **Status colors:**
  - Success: Text `#059669` / BG `#ECFDF5` / Border `#A7F3D0`
  - In Progress: Text `#2563EB` / BG `#EFF6FF` / Border `#BFDBFE`
  - Warning: Text `#D97706` / BG `#FFFBEB` / Border `#FDE68A`
  - Danger: Text `#DC2626` / BG `#FEF2F2` / Border `#FECACA`
  - Info: Text `#6366F1` / BG `#EEF2FF` / Border `#C7D2FE`
  - Neutral Badge: Text `#475569` / BG `#F1F5F9` / Border `#E2E8F0`

---

## Global Rules

### Color Palette

| Role | Hex | Token | Usage |
|------|-----|-------|-------|
| Background Canvas | `#F8FAFC` | `--neutral-bg-canvas` | Page background |
| Surface / Card | `#FFFFFF` | `--neutral-bg-surface` | Cards, modals, panels |
| Text Main | `#0F172A` | `--neutral-text-main` | Headlines |
| Text Body | `#334155` | `--neutral-text-body` | Descriptions |
| Text Muted | `#64748B` | `--neutral-text-muted` | Meta, captions |
| Border Default | `#E2E8F0` | `--neutral-border-default` | Hairline borders |
| Primary CTA | `#2563EB` | `--brand-primary` | Main buttons, active links |
| Primary Hover | `#1D4ED8` | `--brand-primary-hover` | Button hover state |
| Primary Light | `#EFF6FF` | `--brand-primary-light` | Light badges, highlight BG |

### Typography

- **Font Family:** `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Scale:**
  - `xs`: 0.6875rem (11px)
  - `sm`: 0.75rem (12px)
  - `base`: 0.8125rem (13px)
  - `md`: 0.875rem (14px)
  - `lg`: 1rem (16px)
  - `xl`: 1.25rem (20px)
  - `2xl`: 1.5rem (24px)
  - `kpi`: 1.875rem (30px)
- **Weights:** Regular 400 | Medium 500 | Semibold 600 | Bold 700

### Spacing & Layout

| Token | Value | Usage |
|-------|-------|-------|
| `--spacing-sidebar-slim` | `64px` | Collapsed sidebar |
| `--spacing-sidebar-sub` | `200px` | Secondary sub-sidebar |
| `--spacing-header-height` | `60px` | Header height |
| `--spacing-card-padding` | `20px` | Card internal padding |
| `--spacing-grid-gap` | `16px` | Grid gap |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-button` | `8px` | Buttons, inputs |
| `--radius-input` | `8px` | Form inputs |
| `--radius-card` | `12px` | Cards |
| `--radius-banner` | `16px` | Hero banners |
| `--radius-badge` | `9999px` | Badges |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| `--shadow-card` | `0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 1px 2px -1px rgba(0, 0, 0, 0.05)` | Card lift |
| `--shadow-drawer` | `-4px 0 24px rgba(0, 0, 0, 0.12)` | Slide-over drawer |

---

## Component Specs

### Header
- Height: 60px
- Search Box: `#F1F5F9`, Shortcut `"Ctrl K"`, Icon `Search`
- Profile Avatar: BG `#0F172A`, Text `#FFFFFF`, Initials `"AC"`

### Hero Banner
- Background: Gradient Hero (`linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)`)
- Radius: `16px`
- CTA Buttons: White glass, Primary light

### KPI Card
- Background: `#FFFFFF`, Border: `1px solid #E2E8F0`, Radius: `12px`
- Value Style: `font-bold text-slate-900 text-2xl`
- Sparkline: Stroke `#10B981`, Fill `rgba(16, 185, 129, 0.1)`

### Data Table
- Header BG: `#FAFAFA`, Text: `#64748B`, Row Height: `56px`
- Row Hover BG: `#F8FAFC`, Border: `1px solid #F1F5F9`

### Slide-Over Drawer
- Width: `540px`, Position: Right, Backdrop: `rgba(15, 23, 42, 0.4)`
- Sticky Footer: Primary (Создать) | Outline | Ghost

---

## AI Prompt Rules

1. Strictly adhere to ServiceApp tokens (`serviceapp_design_system.json`).
2. Use Tailwind utility classes corresponding to colors, border radius, and typography scales defined in tokens.
3. Keep buttons `rounded-[8px]`, cards `rounded-[12px]`, banners `rounded-[16px]`.
4. Maintain 60px header height, 20px card padding, 16px grid gap.
