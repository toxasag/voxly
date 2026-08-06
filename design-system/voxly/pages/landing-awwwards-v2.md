# Landing Awwwards v2 — Design Lock (getvoxly.ru)

> **Status:** BUILT + DEPLOYED 2026-08-03 (`saas-portal`).  
> **Overrides:** `pages/landing.md` + auto ui-ux-pro-max blue SaaS palette.  
> **Thesis (не размывать):** VoxlyCRM — командный центр продаж. Все каналы, диалоги, AI и рассылки управляются из CRM. Мобильный веб без приложений.

---

## 0. Message hierarchy

| Priority | Message | Where it may live |
|---|---|---|
| **Primary** | Командный центр продаж = CRM. Сделка + чат в одном экране. Телефон = браузер, apps не нужны. | Hero, Mobile Proof, Final CTA, sticky CTA |
| **Secondary** | Модули (секретарь / AI / каналы / gift / рассылки) — оружие CRM, не каталог | Modules (после CRM Deep), короткие упоминания в Deep Dive |
| **Tertiary** | Цена от 500 ₽ · 7 дней без карты · hard lock после trial | Pricing, FAQ, trust lines у CTA |

**5-second test:** без nav страница всё ещё Voxly; ясно «управляешь из CRM, в т.ч. с телефона».

---

## 1. Concept + signature + reference locks

### Concept one-liner
Industrial editorial light page: oversized type + amber signal strips, product UI as the only spectacle. Closing the deal — not buying traffic.

### Signature element (один риск)
**Phone foreground:** живой экран VoxlyCRM — открыта сделка → вкладка «Чат» → входящее + ответ оператора.  
**Ambient background:** десктоп-канбан (приглушённый, без карточек-hero). Один организм desk↔mobile.  
Всё остальное — тихо: сетка, линии, моно-лейблы `01 · CRM`.

Aesthetic risk: oversized industrial display (Unbounded) + amber CTA strips. Запрет: glassmorphism, bento ради bento, purple/neon, emoji-icons, mascot-as-hero-replacement (маскот можно в footer/empty — не в hero).

### Reference locks — ВЗЯТЬ

| Source | Craft taken | Why for Voxly |
|---|---|---|
| **GramGPT** | Product UI как главный visual; mini-UI в модулях; процесс 01→N; «веб без установки»; comparison «мы vs стек» | Доказывает CRM, а не обещает «платформу» |
| **TraffSoft** | Before/after по деньгам (8–15к → от 500); «с телефона/ПК без apps»; FAQ возражений; низкий порог | Снимает «дорого / нужно приложение» |
| **Easy AI** | Сценарии «кому подходит»; чеклист; dual path self-serve | Self-serve trial = наш dual path |
| **DarkTelegram** | Punch «ни один лид без ответа» (коротко, у AI/секретаря) | Closing-speed, не traffic |

### Reference locks — НЕ БРАТЬ
Purple/neon AI · emoji icons · фейковые №1/3000+ · оффер «трафик от 3₽» / масс-инвайт · feature dump в hero · dark-only hero · арбитражный density.

### Positioning vs market
Они продают **трафик в Telegram**.  
Мы продаём **закрытие**: лид уже написал → сделка в CRM → ответ / AI / команда / догон.

---

## 2. Tokens

### Color (marketing landing only — portal cabinet tokens отдельно)

| Token | Hex / value | Role |
|---|---|---|
| `--land-ink` | `#0A0A0A` | Text, borders heavy, inverse bg |
| `--land-paper` | `#FFFFFF` | Default surface |
| `--land-mist` | `#F3F3F3` | Alt section bg |
| `--land-amber` | `#F5A623` | CTA, signal strips, mono accents |
| `--land-amber-soft` | `#FFF4DE` | Soft highlight bands |
| `--land-muted` | `#5C5C5C` | Body secondary (≥4.5:1 on paper) |
| `--land-line` | `rgba(0,0,0,0.15)` | Section rules |
| Inverse | ink bg + white text | Problem→solution payoff, select modules |

**Forbidden:** `#7C3AED` · pink · cream+#terracotta · broadsheet dense hairlines · indigo-as-primary.

### Typography

| Role | Family | Notes |
|---|---|---|
| Display | **Unbounded** (locked — уже в проде) | Brand VOXLY, section H2 oversized |
| Body | **Manrope** | 16–18px, lh 1.55, max ~62ch |
| Utility | **JetBrains Mono** | Eyebrows `01 · CRM`, SKU, prices |

Scale: Hero brand ~clamp(3.5rem, 10vw, 8rem) · H1 statement ~clamp(1.75rem, 4vw, 3.25rem) · H2 ~clamp(1.85rem, 4.5vw, 4.25rem) · body 1rem–1.125rem. Ratio hero display : body ≈ 5:1.

### Spacing / layout
- Base unit 8px. Section py: 80 / 112 (mobile/desktop).
- Content max 1280px. 12-col grid; editorial split often 5/7 or 4/8.
- Density dial **4** (воздух). Variance **7**. Motion **6**.
- Radius: 0–4px for marketing chrome (industrial); product mocks may use CRM’s soft radius internally.

### Motion
- Hero: block fade + y:16 stagger (brand → H1 → sub → CTA → visual), 400–600ms. Words OK if H1 < 8 words; else block.
- Scroll reveal: y 12–24, 300–500ms, stagger ≤8 children.
- **ONE pinned/scrub:** Mobile Proof only. Desktop preferred; mobile = simple step reveal.
- `prefers-reduced-motion: reduce` → opacity only / no pin.

### Icons / touch / a11y
- Lucide outline only. Min tap 44×44, gap ≥8px. `touch-action: manipulation`.
- Sticky mobile bottom CTA. Focus rings 2px amber/ink. Contrast ≥4.5:1.

---

## 3. Wireframe (order)

```
0  Sticky header: VOXLY · CRM · Возможности · Цены · FAQ · [7 дней] · Войти
   Mobile bottom sticky: «7 дней бесплатно» → /register

1  HERO (amber or paper+amber strip — prefer paper with amber signal bar;
        NOT full amber dump of current page if it fights product mock)
   Brand VOXLY oversized
   H1 + sub + CTA group + «Смотреть CRM» (#crm)
   Visual: phone chat + ambient kanban (full-bleed plane)

2  PROBLEM — Before (white)
   3–4 боли + цифровая полоса 3–4 сервиса / 8–15к / ночной лид

3  TRANSFORM — After (split/slider or wipe)
   Вкладки хаоса → одна VoxlyCRM
   Payoff: стек 8–15к → от 500 ₽ (ориентир; без фейковых «клиентов»)

4  CRM DEEP DIVE ★ (#crm) — longest
   Sticky chapter nav: Воронка · Чат · Контакты · Команда · Рассылки · Сигналы
   Editorial rows: scenario + 3–6 bullets + mock UI (no card grid)

5  MOBILE PROOF ★ (#mobile) — only pin/scrub
   «CRM в кармане. App Store не нужен.»
   Sequence: канбан → сделка → чат → отправка

6  HOW IT WORKS (#how) — 01→04 conveyor
   Регистрация → CRM готова → канал → ответ из сделки (в т.ч. mobile)

7  MODULES (#modules) — secondary
   Секретарь / AI / TG·WA·MAX / Gift / Рассылки+сторис
   Formula: боль → делает → в CRM → цена → CTA trial

8  PRICING (#pricing)
   CRM 500 крупно · modular SKU grid · «Собери контур» · trial CTA

9  FAQ (#faq)
10 FINAL CTA — amber full-bleed
11 Footer — LEGAL ИП + terms/privacy/consent/refund
```

---

## 4. Full RU copy

### Header
- Nav: CRM · Возможности · Цены · FAQ  
- CTA: `7 дней бесплатно`  
- Login: `Войти`  
- Mobile sticky: `7 дней бесплатно · без карты`

### 1. Hero
- Eyebrow: `01 · VOXLYCRM`
- Brand: `VOXLY`
- **H1:** `Командный центр продаж. В браузере — с компьютера и с телефона.`
- **Sub:** `Клиент пишет в Telegram или WhatsApp — сделка и чат уже в CRM. Отвечай с компьютера или с телефона. Приложения ставить не нужно.`
- Primary CTA: `Попробовать 7 дней бесплатно`
- Secondary: `Смотреть CRM` → `#crm`
- Trust: `Без карты · CRM Base от 500 ₽ · 10 мест`

### 2. Problem — Before
- Eyebrow: `02 · ДО`
- **H2:** `Вкладки. Ночной лид. И ещё одно приложение «для команды».`
- Body L: `Воронка в одном сервисе. WhatsApp — в другом. Сделка — в третьем. Менеджер копирует сообщения руками и теряет контекст.`
- Body R: `Ночью человек написал. Утром он уже у конкурента. А счёт за стек легко уходит за 8–15 тысяч — ещё до AI.`
- Strip:
  - `3–4` · сервиса вместо одного экрана
  - `8–15 тыс. ₽` · типичный ориентир стека
  - `1 лид` · может стоить дороже подписки

### 3. Transform — After
- Eyebrow: `03 · ПОСЛЕ`
- **H2:** `Одна VoxlyCRM вместо зоопарка вкладок.`
- Payoff line: `Меньше стек на 8–15 тысяч. CRM Base — от 500 ₽ в месяц.`
- Before labels (mock tabs): `Salebot` · `Wazzup` · `amo` · `ещё чат`
- After label: `VoxlyCRM · сделка + чат + каналы`
- Note under: `Цены конкурентов — публичный ориентир; у всех меняются. Сравнивайте свой счёт.`

### 4. CRM Deep Dive

**Section intro**
- Eyebrow: `04 · VOXLYCRM`
- **H2:** `Не табличка лидов. Рабочее пространство продаж.`
- Lead: `Единое окно: контакты, сделки, переписка из мессенджеров, AI и рассылки — в одной системе. Русские лейблы. Открывается в браузере на компьютере и на телефоне.`

#### 4.1 Воронка и канбан
- Chapter: `01 · Воронка`
- Scenario: `Утро понедельника. Открываешь канбан — новые лиды слева, деньги справа. Карточка уже с именем, суммой и заметкой.`
- Bullets:
  - Виды: **Канбан** (по умолчанию) и **Списком**
  - Сделка: сумма, этап, заметки, владелец
  - Этапы: зафиксированы «Новый лид» / «Успешная» / «Провалена»; середину настраивает команда
  - Запись открывается в **боковой панели** — контекст канбана не теряется
  - На карточке: имя, дата, сумма, заметки
- Mock: desktop kanban 4–5 columns, amber badge unread on 1–2 cards

#### 4.2 Чат в сделке (сердце)
- Chapter: `02 · Чат`
- Scenario: `Открыл сделку → вкладка «Чат» сразу после «Главная». История канала, ответ из карточки, AI на паузе одним тапом.`
- Bullets:
  - Чат на **контакте** и на **сделке**
  - Multi-channel в одном UI: gift-бот / Telegram Business / личный Telegram / WhatsApp / MAX
  - Переключатель тредов, если каналов несколько
  - Шапка: канал · от чьего имени · peer; presence / last-seen где канал умеет
  - Toolbar, MarkdownV2, кликабельные ссылки
  - Вложения: фото, видео, аудио, документы (preview PDF/DOCX)
  - Pinned composer — удобный ответ, в т.ч. на мобильном
  - AI на треде: включить / пауза / выключить (handoff человеку)
  - Открыл чат = прочитано
- Punch: `Ни один лид не должен ждать ответа в пустом мессенджере.`
- Mock: annotated side-panel chat (callouts ниже в §5)

#### 4.3 Контакты и соцполя
- Chapter: `03 · Контакты`
- Scenario: `Тот же человек написал в Telegram, потом в WhatsApp. В CRM это один контакт — не два «новых клиента».`
- Bullets:
  - Person: имя, телефоны, соцсети
  - Поля: Telegram, WhatsApp, VK, OK, Instagram, Facebook, Threads, LinkedIn, сайт
  - Входящее → контакт + сделка (не теряется в мессенджере)
  - Cross-channel merge по телефону (TG ↔ WA)
  - Сообщения пишутся всегда; AI отвечает только если назначен агент

#### 4.4 Команда
- Chapter: `04 · Команда`
- Scenario: `Десять менеджеров в CRM Base. Каждый отвечает из CRM — от имени подключённого канала.`
- Bullets:
  - 10 пользователей в CRM Base
  - Инвайт сотрудников, доступы, учётные данные
  - В сайдбаре: «Кабинет Voxly» (биллинг/каналы) и «Рассылка»
  - Extra seat — 300 ₽

#### 4.5 Рассылки из CRM
- Chapter: `05 · Рассылки`
- Scenario: `Сделка перешла на этап «Догрев» — ушла отложенная серия. Всё из папки «Рассылка» внутри CRM, не из третьего кабинета.`
- Bullets:
  - Папка: бот / аккаунты / WhatsApp / сторис
  - Фильтры: этап сделки, статусы, gift, прочитанность
  - Правила автоотправки при смене этапа
  - История, превью, редактирование отложенных

#### 4.6 Уведомления
- Chapter: `06 · Сигналы`
- Scenario: `На канбане красный unread. Слева toast «новое входящее». Открытый чат подтягивает сообщение сам.`
- Bullets:
  - Unread badges на карточках сделок и контактов
  - Toast слева + автообновление открытого чата
  - Mark read при открытии чата

**Deep Dive CTA strip:** `Открыть CRM на 7 дней` → register

### 5. Mobile Proof
- Eyebrow: `05 · МОБИЛЬНЫЙ ВЕБ`
- **H2:** `CRM в кармане. App Store не нужен.`
- Lead: `Это адаптивный веб-CRM, не урезанная «мобилка» и не обещание магазина приложений. Канбан, сделка, чат, вложения, AI-контроль — в браузере телефона.`
- Steps (scrub):
  1. `Канбан` — увидел badge на сделке в метро
  2. `Сделка` — side panel / карточка с суммой и этапом
  3. `Чат` — история канала, AI на паузе
  4. `Отправка` — pinned composer, вложение, «отправлено»
- Anti-claim: `Не нужно ставить iOS или Android приложение команде. Откройте CRM в браузере.`
- Scene line: `Сделка и переписка в одном экране. Даже в метро.`

### 6. How it works
- Eyebrow: `06 · ЗАПУСК`
- **H2:** `Четыре шага. Без внедрения на полгода.`
- 01 Регистрация — минута, кабинет на месте  
- 02 CRM готова — рабочее пространство провижинится при регистрации  
- 03 Канал — бот, WhatsApp QR, Telegram или MAX — что используешь  
- 04 Ответ из сделки — с компьютера или с телефона  

### 7. Modules around CRM

Intro:
- Eyebrow: `07 · ОРУЖИЕ CRM`
- **H2:** `Модули подключаются к сделке — не живут отдельной жизнью.`
- Lead: `Каждый модуль кормит одну воронку в VoxlyCRM.`

#### 7.1 Телеграм Секретарь — 1000 ₽ / 10 Business
- Боль: сторис и прогрев размазаны по аккаунтам, inbox никто не видит в CRM  
- Делает: до 10 Business-аккаунтов → один inbox  
- В CRM: треды в чате сделки/контакта  
- Extra: +200 ₽  
- CTA: `Подключить в trial`

#### 7.2 AI-агент — 500 ₽ / слот
- Боль: ночной лид без ответа  
- Делает: KB + обучение на успешных сделках; пачки, «печатает», пауза/выкл  
- В CRM: тумблеры AI прямо в чате сделки  
- Punch: `AI отвечает первым. Менеджер забирает диалог одним тапом.`  
- CTA: `Подключить в trial`

#### 7.3 Личный Telegram / WhatsApp / MAX — по 500 ₽
- Боль: личные переписки вне CRM  
- Делает: QR/подключение → диалоги в той же CRM  
- В CRM: тот же чат, тот же mark-read  
- CTA: `Подключить в trial`

#### 7.4 Gift-бот — 500 ₽
- Боль: подписка и подарки живут в боте, сделки — «потом вручную»  
- Делает: подписка, воронка, подарки по расписанию → лиды в CRM  
- В CRM: контакт + сделка с этапа «Новый лид»  
- CTA: `Подключить в trial`

#### 7.5 Рассылки — bot 500 / accounts 500 / stories 1000
- Боль: догон аудитории в отдельном кабинете  
- Делает: по этапам CRM, аудиториям, расписанию; постинг сторис  
- В CRM: папка «Рассылка»  
- CTA: `Подключить в trial`

**Кому подходит (Easy AI pattern, без воды):**
- Команда 2–10, продажи в мессенджерах  
- Уже есть трафик/лиды — нужна дисциплина закрытия  
- Не хотят три биллинга и три приложения  
- Нужен AI на первой линии с handoff человеку  

### 8. Pricing
- Eyebrow: `08 · ЦЕНЫ`
- **H2:** `Собери свой контур. Плати за то, чем пользуешься.`
- Hero price block:
  - `CRM Base` · `500 ₽/мес` · `10 мест` · Extra seat `300 ₽`
  - `Trial 7 дней · без карты`
  - After: `После trial доступ к CRM требует подписки (hard lock). Честно.`
- Modular grid (mono SKU labels):

| SKU | Price |
|---|---|
| `CRM_BASE` | 500 ₽ / 10 мест |
| `EXTRA_SEAT` | 300 ₽ |
| `AI_TG` Секретарь | 1000 ₽ / 10 акк · +200 extra |
| `AI_AGENT` | 500 ₽ / слот |
| `AI_GRAMJS` / `AI_WA` / `AI_MAX` | 500 ₽ |
| `GIFT_BOT` | 500 ₽ |
| `MAILING_BOT` / `MAILING_ACCOUNTS` | 500 ₽ |
| `MAILING_STORIES` | 1000 ₽ |

- CTA: `Собрать и начать 7 дней`
- Stack line: `Ориентир рынка 8–15 тыс. за разрозненный стек → Voxly от 500 ₽ за CRM-ядро.`

### 9. FAQ
1. **Нужно ли приложение?** — Нет. VoxlyCRM — веб в браузере на компьютере и телефоне.  
2. **Можно ли работать только с телефона?** — Да. Канбан, сделка, чат, ответ и вложения доступны в мобильном вебе.  
3. **Что входит в 500 ₽?** — CRM Base: рабочее пространство, канбан/список, чат в сделке, до 10 пользователей. Каналы и AI — отдельными модулями.  
4. **Чем это не amo/Bitrix + Wazzup?** — Не склеиваем чужие кабинеты. Чат, сделки и каналы изначально в одной CRM; биллинг модульный, без «места × коннектор × конструктор» как обязательного трио.  
5. **AI обязателен?** — Нет. Сообщения пишутся в CRM всегда. AI отвечает только если назначен агент; в любой момент пауза или handoff.  
6. **Куда падают лиды после сторис/рассылки?** — В контакты и сделки VoxlyCRM. Дальше — этап, чат, команда.  
7. **Сколько менеджеров?** — 10 в Base, каждый следующий 300 ₽.  
8. **Что после 7 дней?** — Без оплаты CRM уходит в hard lock до подписки. Карту для старта не просим; автосписаний нет.

### 10. Final CTA
- **H2:** `Открой командный центр. С телефона — в браузере.`
- Sub: `7 дней на своих диалогах. Без карты. После trial — подписка на CRM, если оставляешь.`
- CTA: `Попробовать 7 дней бесплатно`
- Micro: `Не ставьте приложения команде. Откройте CRM в браузере.`

### Footer
Реквизиты из `lib/legal.ts` + links: Условия · Конфиденциальность · Согласие · Возврат.

---

## 5. Visual specs

### Hero composition
- Full-bleed visual plane (right 55% desktop / below fold mobile stacked carefully: type first, then phone).
- **Foreground:** device frame (neutral bezel, no iOS marketing chrome overload) — CRM chat thread, deal title chip, channel header, composer pinned, 1 unread toast peek optional (not floating badge sticker).
- **Background:** desaturated desktop kanban, large, slightly blurred or opacity 0.35–0.5, cropped by edge — not a card.
- Amber horizontal signal strip 4–8px under header OR left rail 6px.
- No cards in hero. No pill badges on media. Brand VOXLY must survive nav removal.

### Annotated CRM chat (Deep Dive 4.2)
Callouts (max 5, numbered mono):
1. Вкладка «Чат»  
2. Channel / identity header  
3. Thread switcher  
4. AI вкл/пауза/выкл  
5. Pinned composer + attach  
Lines = thin ink 15% opacity; labels JetBrains Mono 11px.

### Kanban mock
- Columns: Новый лид · Квалификация · Договор · Успешная (sample middle names OK)
- 1–2 cards with unread badge (numeric, not emoji)
- Side panel ghost open on one deal

### Mobile sequence (pinned)
- 4 phone states shared layout; progress label `01/04`…`04/04`
- Scrub maps scrollY → state index; reduced-motion = buttons «Дальше»

### Module mini-UIs (GramGPT-style)
- Secretary: list of Business accounts → unified inbox row  
- AI: chat bubbles with «печатает…» + pause control  
- Channel connect: QR panel stub  
- Gift: funnel timeline → CRM deal chip  
- Mailing: audience filter chips (stage) + schedule row  
Each mini-UI ≤ 280px tall; sits in editorial row, not bento mosaic.

---

## 6. Checklists

### Anti-AI-slop
- [ ] No indigo/violet primary  
- [ ] No cream+terracotta / calm editorial serif autopilot  
- [ ] No dark-mode-by-default hero  
- [ ] No cards in hero; cards only if interactive (pricing SKU, FAQ accordion)  
- [ ] No emoji icons  
- [ ] No fake social proof counts  
- [ ] No traffic/CPA offer language  
- [ ] One aesthetic risk only (type + amber strips)  
- [ ] Modules visually quieter than CRM Deep Dive  
- [ ] Product UI > illustration/mascot in hero  

### Conversion QA
- [ ] 5s: CRM command center + mobile web clear  
- [ ] Primary CTA above fold + sticky mobile  
- [ ] Secondary «Смотреть CRM» scrolls to Deep Dive  
- [ ] Price 500 + trial visible before FAQ  
- [ ] Hard lock after trial stated honestly  
- [ ] Before/after money comparison present  
- [ ] FAQ covers app / mobile-only / 500 / vs amo+Wazzup / AI optional / leads destination / seats / after 7 days  
- [ ] Every module CTA → same trial register (with ref)  

### A11y / touch / motion
- [ ] Contrast ≥4.5:1 (muted on paper checked)  
- [ ] Focus visible  
- [ ] Tap ≥44×44, gap ≥8  
- [ ] `touch-action: manipulation` on CTAs  
- [ ] prefers-reduced-motion kills pin/scrub  
- [ ] One pinned section max  
- [ ] Keyboard: skip link, accordion FAQ operable  
- [ ] Images/mocks have meaningful alt  

---

## 7. Build notes (when implementing)

- Replace mascot-hero with product signature mock (HTML/CSS mock OK; screenshots if available).  
- Keep Unbounded + Manrope + existing `--land-*` where aligned; extend for chapter sticky nav.  
- Reuse `RegisterLink` / `ReferralCapture` / `LEGAL`.  
- Do not port ServiceApp blue `#2563EB` onto marketing.  
- Portal cabinet remains ServiceApp tokens — landing is a separate surface.

### Dual path
Self-serve only on marketing: trial register. «Под ключ» не обещать, пока нет партнёрского delivery оффера на лендинге (partners page exists separately — optional quiet link in footer, not hero).
