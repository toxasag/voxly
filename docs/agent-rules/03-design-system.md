# UI / Design System (Twenty CRM Light Canvas)

> Вынесено без изменений смысла из `AGENTS.md` проекта GETVOXLY (исходные строки 271–383 прежней версии; прежний полный файл — коммит `1115feb`/`4cc8860`). Читай этот файл перед работой в соответствующей области.

## 6. UI / DESIGN SYSTEM (Twenty CRM Light Canvas — MANDATORY STANDARD)

> ⚡ **СТРОЖАЙШИЙ СТАНДАРТ:** Проект полностью работает на **Twenty CRM Light Canvas**.
> **КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО:**
> - Использовать тёмную тему и классы `slate-950`, `slate-900`, `slate-800` для фонов, панелей и карточек.
> - Использовать `amber-500` / `orange-400` в качестве дефолтных акцентов или кнопок (янтарный допустим исключительно для семантических предупреждений и чипов заметок).
> - Использовать центрированные модальные окна для сущностей CRM — только Slide-over шторки справа (`Sheet.tsx`) с URL-параметром `?record=<id>`.
> - Использовать самодельные `<table>` — все списки сущностей CRM строятся строго на `RecordTable` со строгой высотой строки 32px, липкими заголовками и навигацией стрелками.
> Полная документация — `docs/01_ARCHITECTURE/01_06_DESIGN_SYSTEM.md` и `01_05_UI_CONVENTIONS.md`.

### Color Palette & Design Tokens (Twenty CRM Light Canvas)

| Role | Token / Value | Usage & Rules |
|---|---|---|
| **Page / Canvas Background** | `#ffffff` (`--color-bg`) | Чистый белый холст страниц, рабочих областей, основных панелей |
| **Sidebar / Secondary Background** | `#fbfbfb` / `#fafafa` (`--color-bg-secondary`) | Навигационный сайдбар, подложки списков, свимлейны |
| **Card / Surface** | `#ffffff` + `border-[#e5e5e5]` + `shadow-2xs` | Карточки записей, канбан-карточки, модальные поверхности |
| **Elevated Surface (Hover)** | `#fafafa` / `#f5f5f5` | Подсветка строк при наведении, дропдауны, поповеры, `hover:bg-black/[0.04]` |
| **Borders & Dividers** | `#e5e5e5` (`--color-border`) | 1px solid разделители строк, границы карточек, колонок, полей ввода |
| **Border (Hover)** | `#cccccc` | Рамка карточки или инпута при наведении |
| **Border (Subtle Divider)** | `#f0f0f0` | Внутренние тонкие разделители шапок, сплиттеров и тулбаров |
| **Text Primary (High Contrast)** | `#111111` / `#000000` | Заголовки, названия сделок/контактов, значения в ячейках, основной текст (WCAG AAA) |
| **Text Secondary** | `#666666` | Вторичные подписи, лейблы колонок, описания, таймстампы |
| **Text Muted / Icons** | `#888888` | Плейсхолдеры («Указать …»), служебные иконки в тулбарах, счетчики |
| **Primary Brand Accent** | `#4a38f5` (Ультрамарин / Indigo) | Главная кнопка действия (CTA), бренд-маркер, активный таб, фокус |
| **Primary Hover** | `#3d2ee0` | Наведение на primary-кнопки |
| **Secondary Accent / Monochrome** | `#111111` / `#888888` | Второстепенные контролы, нейтральные тулбары, иконки |
| **Focus State** | `#4a38f5` / `#03b2cb` | Рамка активного ввода (`focus:border-[#4a38f5] focus:ring-1 focus:ring-[#4a38f5]/20`) |
| **Selection / DnD Highlight** | `#3b82f6` | Маркер перетаскивания колонок, активные чекбоксы |
| **Success** | `emerald-700` (`#15803d`) / `bg-emerald-50` / `border-emerald-200` | Положительные статусы (closed_won, paid, ready, выполнено) |
| **Danger / Destructive** | `rose-600` / `rose-700` / `bg-rose-50` / `border-rose-200` | Кнопки удаления, ошибки, отказ, closed_lost, просрочено |
| **Warning / Note Chip** | `#854d0e` / `bg-[#fefce8]` / `border-[#fef08a]` | Чип заметки (Twenty UX), предупреждения |
| **Info / Tag** | `sky-700` / `bg-sky-50` / `border-sky-200` | Информационные бейджи, теги, ссылки |

### Typography & Spacing
- **Шрифты:**
  - `Inter` (13px, regular/medium/semibold) — основной UI-текст и заголовки.
  - `DM Mono` с `tabular-nums` — числовые данные, ID записей, даты, суммы и валюты.
- **Размеры:** Display `13.3px`, H1 `13px`, Body `13px` / `12px` (`text-xs`), Label `11px`, Tiny `10px`.
- **Строка таблицы записей:** строго `32px` (`RECORD_TABLE_ROW_HEIGHT = 32`, `h-8`).
- **Скругления:**
  - `16px` (`rounded-2xl` / `rounded-[16px]`): боковые шторки (`Sheet`), контейнеры создания, диалоги.
  - `8px` (`rounded-[8px]` / `rounded-lg`): карточки записей, канбан, поля ввода, кнопки действия.
  - `4px` (`rounded-[4px]`): бейджи, теги, чипы заметок, чекбоксы.
- **Анимации:** быстрые `75ms` (hover), стандартные `150ms` (дропдауны, табы), оверлеи `300ms` (slide-over sheet).

### Component Patterns

**Card:**
```tsx
<div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs hover:border-[#cccccc] transition-colors">
```

**Primary Button:**
```tsx
<Button className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]">
  Сохранить
</Button>
```

**Destructive Button:**
```tsx
<Button className="h-8 rounded-[8px] border border-rose-200 bg-rose-50 px-3 text-[13px] font-medium text-rose-600 shadow-xs transition-colors hover:bg-rose-100">
  Удалить
</Button>
```

**Input:**
```tsx
<Input className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20" />
```

**Note Chip (Twenty UX Pattern):**
```tsx
<div className="rounded-[4px] border border-[#fef08a] bg-[#fefce8] p-2 text-xs text-[#854d0e] line-clamp-3">
  {noteBody}
</div>
```

**Status Badge (TagPill / StatusBadge):**
```tsx
import { TagPill, type TagColor } from "@/components/ui/tag";
import { StatusBadge } from "@/components/shared/StatusBadge";

<TagPill color="emerald">Активен</TagPill>
<TagPill color="amber">В обработке</TagPill>
<TagPill color="rose">Отменён</TagPill>

<StatusBadge variant="success">Выполнено</StatusBadge>
<StatusBadge variant="warning">Ожидает</StatusBadge>
<StatusBadge variant="destructive">Отклонено</StatusBadge>
```

**Table (RecordTable — единственная таблица записей CRM):**
```tsx
<RecordTable
  rows={items}
  columns={columns}
  getRowId={(item) => item.id}
  tableId="module_table"
  onRowClick={(item) => openRecord(item.id)}
/>
```

### Layout Rules
- **Паттерн боковых шторок (Slide-Over Drawers):** Просмотр и редактирование сущностей происходят в правой боковой шторке (`Sheet.tsx`), а не в центрированных модальных окнах. Синхронизируется с URL (`?record=<id>`).
- **Строка таблицы:** Фиксированная высота `32px`, липкие колонки чекбокса (`28px`) и первой колонки (`COLLAPSED_IDENTIFIER_WIDTH = 38px`), ресайз колонок через CSS-переменные напрямую в DOM.
- **Сайдбар:** фиксированная ширина `w-60` (складывается до `w-16`), `bg-[#fbfbfb] border-r border-[#e5e5e5]`. На мобильном (< 768px) скрывается (`hidden md:flex`), а навигация уходит в маршрут-меню и нижний бар.
- **Шапка:** `h-14`, `bg-white border-b border-[#e5e5e5]`, sticky к верху.
- **Один брейкпоинт:** `md:` (768px). Структурная раскладка строится на Tailwind-префиксах, а не на `useIsMobile`.
- **Оверлеи:** Прокрутку фона и закрытие по Escape выполняет исключительно `useOverlay` (`lib/utils/use-scroll-lock.ts`).

Полные правила вёрстки — `docs/01_ARCHITECTURE/01_06_DESIGN_SYSTEM.md` и `docs/01_ARCHITECTURE/01_05_UI_CONVENTIONS.md`.
