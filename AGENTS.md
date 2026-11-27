# GETVOXLY — B2B SaaS Modular Platform
# Core CRM + Pluggable Modules: Service Center, Finance, AI Bots

> ⚡ **Паспорт проекта GETVOXLY (Мгновенная память сессии):**
> - **Деплой:** `/usr/local/bin/vf-deploy GETVOXLY` (синхронизирует backend/frontend на 150.241.98.135 и перезапускает контейнеры).
> - **Верификация:** https://api.getvoxly.ru/health и https://getvoxly.ru/login с реальным HTTP 200 (health сам по себе не доказывает фичу — проверяй саму фичу).
> - **Продукт:** B2B SaaS Modular CRM Platform (Fastify 5 + Next.js 15 + Postgres 16 RLS + Redis 7).
> - **Боевой сервер (VPS):** IP 150.241.98.135, путь /opt/getvoxly (SSH root@150.241.98.135).
> - **Боевой домен:** https://getvoxly.ru/ и https://api.getvoxly.ru/
> - **Документация и деплой:** вся архитектура в `docs/` (`docs/05_OPERATIONS/05_01_SERVER_ACCESS.md`).
> - **СТРОЖАЙШАЯ ИЗОЛЯЦИЯ:** запрещено выходить за пределы GETVOXLY или трогать другие проекты (`/home/vibeforge/projects/vertex-siam`, `freelance-hunter`).

> 📚 Этот файл — короткое ядро правил. Подробные правила (код-примеры, палитра, шаблоны) лежат в `docs/agent-rules/` — читай нужный файл по таблице в конце.

---

## 0. АВТОПАМЯТЬ ПРОЕКТА И КАРТА ВЛИЯНИЯ (ОБЯЗАТЕЛЬНО ПЕРЕД ЛЮБОЙ ПРАВКОЙ КОДА)

Сервис сам выгружает историю ВСЕХ сессий проекта в `<папка проекта>/.vibeforge-memory/` (обновляется каждые ~15 секунд, в git не попадает). В рабочей копии сессии это `./.vibeforge-memory/`; если ссылки нет — читай напрямую `/home/vibeforge/projects/GETVOXLY/.vibeforge-memory/` (папка ТВОЕГО проекта, изоляция не нарушается).

| Файл | Что внутри |
|---|---|
| `COMPONENTS_MAP.md` | Карта всех готовых UI-компонентов, модалок, таблиц и справочников (СТРОГО переиспользовать) |
| `SESSIONS_INDEX.md` | таблица всех сессий: статус, влито ли в main, сколько файлов затронуто |
| `SESSIONS_DIGEST.md` | запросы пользователя и итог агента по каждой сессии |
| `sessions/<ID>.md` | подробная хронология одной сессии |
| `FILE_HISTORY.md` | для каждого файла — какие сессии его меняли («горячие точки» сверху) |
| `IMPORTED_BY.md` | для каждого файла — какие файлы его импортируют |

### Step 0 — перед первой правкой (без исключений)
0. **Предпочтительный 3-шаговый поиск (MCP `vibeforge-memory`):** вместо чтения длинных `.md` сначала вызови `memory_search(query)` → `memory_timeline(session_id)` → `memory_details(session_ids, file_path)`. Он изолирован по текущему проекту, хранит AI-выжимки сессий с меткой актуальности, `FILE_HISTORY` и `IMPORTED_BY` (JS/TS + Python). Файлы `.vibeforge-memory/*.md` используй как локальный фоллбэк, если MCP не подключён.
1. Прочитай `SESSIONS_INDEX.md`: какие задачи уже решались и что влито в main.
2. Найди файлы, которые будешь менять, в `FILE_HISTORY.md`. Файл менялся 4+ сессиями — «горячая точка», там чаще всего чинят и ломают: действуй осторожно.
3. Для релевантных сессий открой `sessions/<ID>.md` (или `SESSIONS_DIGEST.md`).
4. Если папки нет или она пуста — честно скажи пользователю, не выдумывай историю.

### Карта влияния — до того, как менять функцию / компонент / поле / API / константу
1. Найди ВСЕ места использования: `IMPORTED_BY.md` (кто импортирует файл) + `grep -rn` / `codegraph_explore` (вызовы функции, роуты, SQL/схема, фронт-вызовы API, тесты, конфиги).
2. Покажи пользователю список: «Эта функция используется здесь и здесь: `<файл:строка — как используется>`». Отдельно отметь места из истории сессий (какая сессия их касалась).
3. Спроси: «Исправлять во всех этих местах или только в `<X>`?» — и жди ответа. Не расширяй и не сужай объём молча.
4. Делай изменение так, чтобы не ломать остальных потребителей (обратная совместимость либо правка всех мест по согласию).
5. После правки проверь каждое затронутое место вживую (тесты / сборка / запрос / браузер) и отчитайся по каждому.

### Если пользователь пишет «опять не работает / снова сломалось»
Сначала найди в памяти, какая прошлая сессия правила это место и что меняла; сравни с текущим состоянием и объясни, что регрессировало. Только потом чини.

### Final Step
По завершении дополни `docs/PROJECT_MEMORY.md`: дата, что изменено, root cause, где ещё используется, что осталось. Папки `~/Session-Context` на сервере нет — не ссылайся на неё.

---

## 1. SYSTEM IDENTITY & STACK

Ты — Senior Fullstack Architect проекта GETVOXLY. Каждое изменение обязано соблюдать multi-tenant изоляцию, границы модулей и strict TypeScript. Без срезания углов.

- **Frontend:** Next.js 15 (App Router, только `app/`), Tailwind CSS 4 + shadcn/ui, Lucide Icons (никаких emoji в UI), React Hook Form + Zod, React Context для tenant/auth, TanStack Query v5 для серверного состояния. Без Redux/Zustand.
- **Backend:** Fastify 5 (TypeScript, ESM), PostgreSQL 16 + JSONB, без ORM (raw SQL / тонкий query-builder), Redis 7 + BullMQ.
- **AI Bots:** вызовы LLM только через абстракцию провайдеров (никакого прямого `fetch` к OpenAI/Anthropic); стриминг — SSE.

## 2. ЖЁСТКИЕ ПРАВИЛА (кратко; детали и примеры — в `docs/agent-rules/`)

- **TypeScript:** никаких `any`, `@ts-ignore`, `as any`; неизвестное — `unknown` + type guards / Zod. `strictNullChecks` всегда. Типы PascalCase без `I`-префикса; `Row` — результат БД, `DTO` — API.
- **Tenant isolation:** каждый запрос с `WHERE tenant_id = $1` (кроме системных операций); `tenant_id` берётся из сессии на бэкенде, НИКОГДА не приходит с клиента; RLS включён; у каждой таблицы `tenant_id UUID NOT NULL`.
- **Права:** UI-`Guard` скрывает (не дизейблит) недоступное, но источник истины — проверка прав в каждом Fastify-роуте. Модуль не установлен → `notFound()` на фронте, `403 MODULE_NOT_INSTALLED` на бэкенде.
- **Границы модулей:** импорты только в одну сторону (`app/modules/<m>` → `components/modules/<m>` → `lib/api/<m>`); общее выносится в `lib/`, `types/`, `schemas/`, никогда не лежит в соседнем модуле.
- **UI — Twenty CRM Light Canvas (обязательный стандарт):**
  - ЗАПРЕЩЕНО: тёмная тема и `slate-950/900/800` для фонов; `amber-500`/`orange-400` как дефолтный акцент; центрированные модалки для сущностей CRM (только правая шторка `Sheet.tsx` с `?record=<id>`); самодельные `<table>` (списки CRM — только `RecordTable`, строка 32px).
  - Ключевые токены: фон `#ffffff`, сайдбар `#fbfbfb`, граница `#e5e5e5`, текст `#111111`/`#666666`, акцент `#4a38f5` (hover `#3d2ee0`), шрифт Inter 13px (числа — DM Mono).
  - Один брейкпоинт `md:` (768px). Полная палитра и компоненты — `docs/agent-rules/03-design-system.md`.
- **Формы:** Zod-схема в `schemas/` (не inline), `react-hook-form` + `zodResolver`, у мутаций loading/disabled/ошибки через `form.setError()`.
- **Сервер (Fastify):** роуты с `authenticate` + `requirePermission`, ответы в конверте `{ data, meta? }` / `{ error: { code, message, details? } }`, BullMQ-задачи несут `tenant_id`.
- **БД:** таблицы `snake_case` во множественном числе, PK `uuid`, `created_at`/`updated_at`, soft delete через `deleted_at`.
- **Импорты:** алиас `@/`, группировка React/Next → сторонние → `@/`; без `../../../`.
- **Git:** Conventional Commits; не коммитить `.env`, `node_modules`, `.next`, `dist`; lint + tsc перед push.

## 3. FINAL CHECKLIST — ПЕРЕД ТЕМ КАК ПИСАТЬ КОД

1. Запрос содержит `WHERE tenant_id = ...`?
2. Нет `any` / `@ts-ignore`?
3. Для модульного UI стоит `<Guard>`?
4. Цвета строго из Twenty CRM Light Canvas (белый холст, граница `#e5e5e5`, акцент `#4a38f5`, никакого dark slate и дефолтного amber)?
5. Zod-схема лежит в `schemas/`?
6. У формы обработаны loading / error / empty?
7. Импорты через `@/` и сгруппированы?
8. Новый модуль зарегистрирован и в backend-, и во frontend-реестре?
10. **ПРОВЕРКА НА ГОТОВЫЙ КОМПОНЕНТ (Anti-Reinvention):** Проверил ли ты `COMPONENTS_MAP.md` перед созданием модалки/формы/селектора? Если компонент уже есть (`CreateItemModal`, `PartsTable`, `WorkItemsTable`, `InnAutocomplete` и др.) — писать свой дубликат КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО.
9. **Карта влияния построена и показана пользователю до правки общей функции/компонента/API/поля БД?**

## 4. SPEC-DRIVEN DEVELOPMENT & DOCS DISCIPLINE

1. **Source of Truth:** `docs/` — источник правды по архитектуре и контрактам API.
2. **Перед генерацией:** читай PRD из `docs/02_PRD_AND_MODULES/` или контракт из `docs/03_API_CONTRACTS/`.
3. **Definition of Done:** `tsc --noEmit` без ошибок; статус задачи `[x]` в `docs/04_PROJECT_STATE/ROADMAP_TASKS.md`; запись в `docs/04_PROJECT_STATE/CHANGELOG.md`; запись в `docs/PROJECT_MEMORY.md`.
4. **Нет расхождения документации:** изменил сигнатуру API или таблицу/поле БД — обнови документ в `docs/` в той же итерации.

## 5. ГДЕ ЧИТАТЬ ПОДРОБНОСТИ (читай нужный файл ДО работы в этой области)

| Задача | Файл |
|---|---|
| Типы, структура папок, нейминг, границы модулей | `docs/agent-rules/01-typescript-and-structure.md` |
| Мультитенантность, права, UI Guard | `docs/agent-rules/02-tenancy-and-permissions.md` |
| Любая вёрстка / UI / цвета / компоненты | `docs/agent-rules/03-design-system.md` (+ `docs/01_ARCHITECTURE/01_06_DESIGN_SYSTEM.md`, `01_05_UI_CONVENTIONS.md`) |
| Формы, Zod, Fastify-роуты, BullMQ, формат ответов | `docs/agent-rules/04-forms-and-server.md` |
| Реестр модулей, общие правила кода, тесты, git, AI Bots | `docs/agent-rules/05-modules-and-general.md` |
| Набор `caveman-*` скилов (ритуал задач) | `docs/agent-rules/06-agent-skills-ritual.md` |
