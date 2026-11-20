# GETVOXLY — Память проекта

## Ссылки на мастер-документы:
- docs/00_INDEX.md
- docs/01_ARCHITECTURE
- docs/04_PROJECT_STATE
- docs/ACTION_PLAN_TRACKER.md

## Стек и окружение
- Next.js (App Router), Node.js, Prisma / SQLite / Postgres.
- Внешний домен: https://getvoxly.com / https://vibecode.team-big.ru/.
- Интеграции: Telegram bot / user api, CRM deals & contacts pipeline.

## 2026-11-20: Переработка формы «Акт приёма-передачи», талон мастера и slide-over редактор
- **Задача & Root Cause:**
  1. В форме «Акт приёма-передачи» нижняя отрывная часть ранее представляла собой талон клиента и содержала ссылку на «Заказ-наряд» (`documentSubtitle` и `Заказ-наряд: №...`). Требовалось переработать нижнюю часть так, чтобы она оставалась у мастера (экземпляр сервисного центра), включала полную информацию об инструменте, клиенте и свободные комментарии мастера, а ссылка на «Заказ-наряд» была полностью удалена и больше не сохранялась.
  2. В UI редактора требовалось добавить контролы ввода названия и комментариев, поддерживающие переименование пользовательских шаблонов (`isCustom: true`), а также поля для ввода данных инструмента (`toolInfo`), клиента (`clientInfo`) и комментариев (`comments`).
  3. В `RepairsTable.tsx` требовалось убрать передачу объекта `selectedTicket` в контекст шаблона, оставив только `orderId` для загрузки через `useRepair(orderId)`.
  4. Обернуть редактор печатных форм в slide-over шторку `Sheet` (стандарт Twenty CRM Light Canvas, `RecordDrawerSheet`) вместо центрированного модального окна.
  5. Обеспечить сохранение в БД с RLS-условием `WHERE tenant_id = $10 AND id = $11` без нарушения системных шаблонов (`is_custom = false`).
- **Что изменено:**
  1. `backend/src/db/migrations/0117_print_templates_intake_act_fields.sql`: миграция с добавлением колонок `tool_info`, `client_info`, `comments` в таблицу `print_templates`. Обновлен `backend/src/db/schema.sql`.
  2. `backend/src/modules/print-templates/print-presets.ts`: в `INTAKE_ACT_PRESET` убрана ссылка на «Заказ-наряд» из подзаголовка (`documentSubtitle: ""`), а отрывной талон переопределен как «ТАЛОН ПРИЕМА (ЭКЗЕМПЛЯР МАСТЕРА)» для сервисного центра.
  3. `backend/src/modules/print-templates/print-templates.types.ts`: добавлены поля `toolInfo`/`tool_info`, `clientInfo`/`client_info`, `comments` в `CreatePrintTemplatePayload`, `UpdatePrintTemplatePayload`, `PrintTemplateRow` и `PrintTemplateDTO`. Экспортирован тип `UpdateTemplateDto`.
  4. `backend/src/modules/print-templates/print-templates.service.ts`:
     - В `create` и `update` сохраняются новые поля;
     - Строгое RLS-обновление `WHERE tenant_id = $10 AND id = $11`;
     - В `renderForOrder` отрывная нижняя часть формируется как экземпляр мастера с блоками инструмента, заказчика, дефектов, комплектации и свободных комментариев, без упоминания «Заказ-наряд».
  5. `frontend/src/lib/repairs/print-presets-client.ts`: в клиентский пресет `INTAKE_ACT_CLIENT_PRESET` внесены аналогичные правки; в `PreviewSampleData` и `mapRepairToPreviewSampleData` добавлена автогенерация `toolInfo`, `clientInfo`, `comments`.
  6. `frontend/src/lib/api/use-print-templates.ts`: расширены интерфейсы DTO и payload новыми полями.
  7. `frontend/src/components/repairs/VisualPrintCanvas.tsx`: нижняя часть оформлена как талон мастера («Линия отреза талона (экземпляр мастера)», «ТАЛОН ПРИЕМА (ЭКЗЕМПЛЯР МАСТЕРА)», «Акт приёма: ...», заказчик, инструмент, неисправность, комплектация, свободные комментарии мастера), ссылка на заказ-наряд полностью убрана.
  8. `frontend/src/components/repairs/VisualPrintInspector.tsx`: блок отрывного талона переименован в «Талон мастера (нижняя часть)» с полями заголовка и свободных комментариев; кнопка-карандаш и обработчик `onRenameTemplate` для пользовательских шаблонов.
  9. `frontend/src/components/repairs/VisualPrintTemplateEditor.tsx`: внедрены хук `useRepair(orderId)` для выборки `orderDetail`, интерактивный тулбар с контролами `<input name="toolInfo">`, `<input name="clientInfo">`, `<textarea name="comments">`, сохранение полей в кастомные шаблоны и проп `isDrawer` для бесшовной интеграции со шторкой.
  10. `frontend/src/components/repairs/PrintTemplateSettingsDrawer.tsx`: редактор обёрнут в `Sheet` из `@/components/ui/sheet` (`side="right"`, `resizable`, ширина до 1450px) для естественного slide-over поведения Twenty CRM.
  11. `frontend/src/components/repairs/RepairsTable.tsx`: удален проброс `order={selectedTicketForSettings}`, оставлен только `orderId={selectedTicketForSettings?.id}`.
  12. `backend/src/tests/print-templates-act.test.ts`: юнит-тесты на пресет, RLS `$10/$11` и генерацию HTML акта без упоминания наряда.
- **Верификация:**
  - `npx tsc --noEmit` в backend и frontend: 0 ошибок.
  - `npm run build` (Next.js 15 production build): 43 статических и динамических маршрута скомпилированы успешно.
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY` и живая E2E проверка в браузере.

## 2026-11-20: Устранение сбоя RLS при регистрации и внедрение бесшовной Telegram-авторизации
- **Root Cause (P0):** При регистрации (`POST /auth/register`) на этапе создания арендатора выполнялась вставка в `ai_balance_topups` (стартовый баланс 50 000 коп) и `tenant_notification_channels`. Обе таблицы имеют `FORCE ROW LEVEL SECURITY` с политикой `tenant_id = current_tenant_id()`. Так как регистрирующийся пользователь ещё не авторизован, параметр PostgreSQL `app.tenant_id` был равен `NULL`, что приводило к ошибке `42501 new row violates row-level security policy for table "ai_balance_topups"` и возвращало 500 Internal Server Error (toast в UI).
- **Решение:** В `AuthService.register()` сразу после создания записи в `tenants` вызывается `await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenant.id]);` и `setRequestTenant(tenant.id);`. Это устанавливает транзакционный контекст RLS для последующих вставок баланса и каналов уведомлений. Также фиксируется запись в `tenant_audit_log` с действием `tenant.register`.
- **Аудит и логирование авторизации:** Внедрено структурированное логирование во все шаги авторизации: `AuthSessionService` (`requestCode`, `status`, `bindRecipient`, `verifyCode`, `consumeVerifiedIn`), Fastify роуты (`/auth/code/request`, `/telegram/webhook`, `/auth/register`). Все персональные данные (номера телефонов, e-mail, токены) маскируются (`maskPhone`, `maskEmail`, `maskToken`).
- **Бесшовная Telegram-авторизация (реверс-инжиниринг noovkus):** При старте бота по ссылке `https://t.me/<bot>?start=auth_<token>` Telegram Bot API webhook привязывает чат и выставляет `verified_at = now()` в сессии. Опрос `/auth/code/status` сообщает фронтенду `verified: true`, форма `RegisterForm` отображает подтверждённый статус Telegram и позволяет завершить регистрацию в 1 клик без ручного ввода цифр, сохраняя при этом возможность ручного ввода OTP при необходимости.

## 2026-11-20: Фикс регистрации, инлайн-кнопок возврата из бота и авторизации
- **Root Cause 1 (Регистрация не нажималась / RegisterForm.tsx):** В `RegisterForm.tsx` обработчик `handleSubmit` был обёрнут в `useCallback` с зависимостями `[code.sessionId, otp, form, registerTenant]`, но свойство `code.verified` отсутствовало в массиве зависимостей. При получении статуса `verified: true` из поллинга сессии `code.sessionId` не менялся, и `handleSubmit` замыкал устаревшее значение `code.verified === false`. При клике на «Зарегистрироваться» срабатывало условие `!code.verified && !/^\d{6}$/.test(otp)`, выставлялся `setOtpError("Код состоит из 6 цифр")` и функция делала тихий `return`. Так как блок ввода OTP был скрыт условием `!code.verified`, пользователь не видел ни ошибки, ни отправки запроса в сеть.
- **Root Cause 2 («Неверный e-mail или пароль» / LoginForm.tsx):** Ошибка входа была прямым следствием сбоя регистрации: из-за тихого `return` в `RegisterForm` запрос `POST /auth/register` не отправлялся на бэкенд, пользователь не создавался в базе данных, и последующая попытка входа с введёнными данными возвращала 401 Unauthorized («Неверный e-mail или пароль»).
- **Решение:**
  1. `frontend/src/components/auth/RegisterForm.tsx`: добавлен `codeRef = useRef(code)` с синхронизацией в `useEffect` для устранения stale closure; в зависимости `handleSubmit` добавлены `code.sessionId, code.verified, slugStatus`; добавлен вызов валидации `await form.trigger()` перед отправкой; сохранено отображение поля ввода кода при `code.stage === "sent"` с индикацией `Подтверждён (ввод не обязателен)` и подсветкой изумрудным бордером; кнопка «Зарегистрироваться» активируется мгновенно при `code.verified || otp.length === 6` с состоянием загрузки `isSubmitting`.
  2. `frontend/src/components/auth/LoginForm.tsx`: аналогично добавлен `codeRef = useRef(code)`, проверка `!currentCode.verified && !/^\d{6}$/.test(otp)`, зелёный баннер подтверждения Telegram и активация кнопки «Войти» без обязательного ручного ввода при подтверждённой сессии.
  3. `backend/src/modules/auth/telegram.service.ts`: во все сообщения отправки кода (`sendCode`), приветствия (`sendGreeting`) и просроченной ссылки (`sendLinkExpired`) добавлены инлайн-клавиатуры Telegram Bot API (`reply_markup.inline_keyboard`) с URL-кнопками прямого возврата на веб-портал: `Вернуться к регистрации` (`/register`), `Вернуться ко входу` (`/login`), `Вернуться в настройки` (`/settings/profile`), `Перейти на сайт GETVOXLY` (`/`).
  4. `backend/src/modules/auth/auth.service.ts`: устранён критический сбой транзакции регистрации `42P08 inconsistent types deduced for parameter $1 (uuid versus text)` при вставке в `tenant_audit_log`, где `$1` ошибочно подставлялся и в `tenant_id (uuid)`, и в `entity_id (text)`. Запрос скорректирован с явными параметрами `$3` и `$4::jsonb`.
  5. `tenant_notification_channels` (`ON CONFLICT`): после миграции `0096_notification_channels_bitrix24` уникальный индекс стал частичным (`WHERE channel_type IN ('email', 'telegram', 'whatsapp')`). Вызовы `ON CONFLICT (tenant_id, channel_type, destination)` без секции `WHERE` приводили к ошибке PostgreSQL `42P10 there is no unique or exclusion constraint matching the ON CONFLICT specification` при регистрации и привязке бота. Предикат добавлен в `auth.service.ts`, `auth-session.service.ts`, `auth.routes.ts` и `notification-channels.service.ts`.

## 2026-11-20: Подстановка реальных данных наряда в редактор бланков и редактирование названий пользовательских шаблонов
- **Root Cause 1 (Моковые данные в превью бланков):** `VisualPrintTemplateEditor` принимал `orderId`, но не использовал его для подстановки данных, а передавал в `VisualPrintCanvas` статичную константу `DEFAULT_PREVIEW_SAMPLE_DATA`. Кроме того, при клике на иконку «Настроить бланки» в строке таблицы `RepairsTable` не сохранялся контекст строки `selectedTicket`, из-за чего редактор открывался без привязки к конкретному заказ-наряду.
- **Root Cause 2 (Невозможность переименовать пользовательский шаблон / копию):** В `VisualPrintInspector` и шапке `VisualPrintTemplateEditor` отсутствовали UI-контролы ввода нового названия для пользовательских шаблонов (`isCustom: true`), а бэкенд не валидировал разделение прав между базовыми неизменяемыми системными шаблонами (`is_custom = false`) и пользовательскими копиями.
- **Решение:**
  1. `frontend/src/lib/repairs/print-presets-client.ts`: разработана чистая функция `mapRepairToPreviewSampleData(order: any)`, маппящая реальные поля наряда (`ticketNumber`, `receivedAt`, `customerName`, `customerPhone`, `customerEmail`, `customerAddress`, `equipment.type/brand/model/serialNumber`, `defectDescription`, `appearance`, `packageContents`, `masterName`, `estimatedCost`, `works`, `parts`) в формат `PreviewSampleData`.
  2. `frontend/src/components/repairs/RepairsTable.tsx`: сохранение выбранного наряда в `selectedTicketForSettings` при клике на «Настроить бланки» в строке и проброс `order` и `orderId` в `PrintTemplateSettingsDrawer`.
  3. `frontend/src/components/repairs/VisualPrintTemplateEditor.tsx`: подключение хука `useRepair(orderId)`, селектор `effectiveSampleData` с фоллбэком на мок при отсутствии наряда; интерактивный контрол переименования с кнопкой-карандашом в Top Bar для кастомных шаблонов; индикатор-бейдж активного наряда в шапке редактора.
  4. `frontend/src/components/repairs/VisualPrintInspector.tsx`: добавление режима редактирования названия на карточках пользовательских шаблонов (`tpl.isCustom`), кнопки с иконкой `Pencil` («Переименовать шаблон») и обработчика `onRenameTemplate`.
  5. `frontend/src/components/repairs/RepairReceiptModal.tsx`, `RepairWorkOrderModal.tsx`, `app/(dashboard)/repairs/[id]/page.tsx`: проброс контекста `order` во всех связанных точках вызова.
  6. `backend/src/modules/print-templates/print-templates.service.ts`: защита системных шаблонов от прямой мутации с ошибкой 403 `SYSTEM_TEMPLATE_READONLY`; безопасный `PUT`/`PATCH` пользовательских шаблонов по `WHERE tenant_id = $10 AND id = $11` с соблюдением RLS.
- **Верификация:**
  - TypeScript компиляция `tsc --noEmit` в `frontend` и `backend` (0 ошибок).
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY` (HTTP 200 на `https://remtoua.getvoxly.ru/repairs` и `https://api.getvoxly.ru/health`).
  - Живой Playwright E2E-тест на боевом сервере: подтверждена подстановка реальных данных наряда Toua GSN50 (клиент Тагир, дефект «Профилактика», серийный номер), отсутствие мока Bosch GBH, успешное переименование пользовательского шаблона в UI и сохранение нового имени в PostgreSQL после полной перезагрузки страницы.
