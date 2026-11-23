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

## 2026-11-23: Интеграция Telegram-ботов: Bot API (@BotFather) и Telegram Managed Bots (Bot API 8.0)
- **Root Cause & Задачи:**
  1. **Остановка соло-агента из-за лимита модели:**
     На старте сессии solo-agent упал с ошибкой исчерпания премиум-лимитов на платформе для модели `gemini-4-neon-high`. Пользователь переключил модель в UI на Gemini 3.8 Flash (High), что устранило блокировку выполнения. В кодовой базе проекта захардкоженные ссылки на модель отсутствуют.
  2. **Отсутствие специализированного мастера подключения Telegram-бота:**
     На странице `/integrations/telegram_bot` вызывался стандартный `ConnectChannelModal`, который запрашивал только название и идентификатор, без проверки токена бота, валидации через Telegram Bot API и интеграции с Telegram Bot Manager.
  3. **Поддержка двух режимов подключения официальных ботов:**
     - Подключение существующего бота по токену @BotFather с валидацией через `getMe`.
     - Создание нового управляемого бота через Telegram Managed Bots (Bot API 8.0) с генерацией deep-link (`https://t.me/newbot/...`) и привязкой токена.
- **Что изменено:**
  1. `backend/src/modules/channels/telegram-bot.types.ts`:
     - Схемы Zod: `telegramBotTokenSchema`, `telegramBotVerifySchema`, `telegramBotConnectSchema`, `telegramBotCreateManagedSchema`, `telegramBotCompleteManagedSchema`.
     - Типы: `TelegramBotInfoDTO`, `TelegramBotManagerInfoDTO`, `TelegramBotCreateManagedResultDTO`.
  2. `backend/src/modules/channels/telegram-bot.service.ts`:
     - Класс `TelegramBotService`: валидация токена через Telegram Bot API `getMe`, `getManagerInfo`, подключение существующего бота `connectExisting`, создание управляемого бота `createManaged` (с deep link) и завершение привязки токена `completeManaged`.
     - Изоляция tenant_id, проверка квот тарифа `telegram_bot_channels`, сохранение в `channel_accounts` и привязка к `ai_agent_channel_bindings`.
  3. `backend/src/modules/channels/telegram-bot-integration.routes.ts`:
     - Эндпоинты `/api/v1/integrations/telegram-bot` (`/verify`, `/manager-info`, `/connect`, `/create-managed`, `/accounts/:id/complete`).
  4. `backend/src/app.ts`:
     - Регистрация роутов по префиксам `/api/v1/integrations/telegram-bot` и `/api/v1/integrations/telegram_bot`.
  5. `backend/src/tests/telegram-bot.test.ts`:
     - 7 unit-тестов: валидация токенов, правил username бота, генерация deep-link, обработка 200 getMe и 401 Unauthorized.
  6. `frontend/src/schemas/channel.schema.ts`:
     - Экспортированы схемы Zod для форм подключения бота.
  7. `frontend/src/lib/api/use-telegram-bot.ts`:
     - React Query хуки для интеграции с API бэкенда.
  8. `frontend/src/components/integrations/ConnectTelegramBotModal.tsx`:
     - Модальная шторка (Sheet) в дизайн-системе Twenty CRM Light Canvas: вкладки «Существующий бот» и «Bot Manager (8.0)», верификация токена в реальном времени, карточка бота, выбор AI-агента, переход в Telegram по deep-link в 1 клик.
  9. `frontend/src/app/(dashboard)/integrations/[channel]/page.tsx`:
     - Подключение `ConnectTelegramBotModal` для канала `telegram_bot`.
- **Верификация:**
  - `npm --prefix backend run build` (tsc): успешно, 0 ошибок.
  - `node --test backend/dist/tests/telegram-bot.test.js`: 7/7 тестов успешно.
  - `npm --prefix frontend run build` (next build): успешно, все 43 страницы собраны без ошибок.


## 2026-11-20: Изоляция печати листа A4 из редактора, стабилизация линии отрыва и полный вывод полей дефекта/заметок в талоне мастера
- **Root Cause & Задачи:**
  1. **Печать из визуального редактора выводила весь интерфейс экрана:**
     В `VisualPrintTemplateEditor.tsx` обработчик `handlePrint` напрямую вызывал `window.print()`. В отсутствие изоляции и классов сокрытия в `@media print` на печать попадали верхняя панель редактора, левая панель инспектора (390px), серый фон `#eef0f3` и вспомогательный плавающий баннер листа.
  2. **Нестабильность линии отрыва («плавающая» высота):**
     В `VisualPrintCanvas.tsx`, `print-templates.service.ts` (`generateA4Html`) и странице `/repairs/[id]/print/intake/page.tsx` отрывной талон и линия перфорации находились в свободном потоке сразу под блоком условий договора. При разном объёме текста условий линия отрыва смещалась по вертикали, выглядела разорванной и могла съезжать на вторую страницу.
  3. **Неполнота данных в талоне мастера:**
     В талон мастера не выводились отдельно стандартная неисправность/профилактика (`malfunctions`), детальное описание со слов клиента (`defect_description`) и примечание к наряду (`notes`). В превью-структуре `PreviewSampleData` и маппере `mapRepairToPreviewSampleData` эти поля склеивались или терялись.
- **Что изменено:**
  1. `frontend/src/components/repairs/VisualPrintTemplateEditor.tsx`:
     - Реализована изолированная печать через скрытый iframe: захватывается строго DOM `#visual-print-canvas-sheet`, стили документа переносятся в изолированный фрейм, и печать инициируется на фрейме без захвата редактора.
     - Добавлены классы `print:hidden` к шапке редактора, левой панели инспектора и бейджу листа на случай прямого вызова Ctrl+P.
  2. `frontend/src/components/repairs/VisualPrintCanvas.tsx`:
     - Введена жесткая фиксация высоты листа (`min-h-[297mm] flex flex-col justify-between`) со стабильной перфорацией `✂ ЛИНИЯ ОТРЫВА (ЭКЗЕМПЛЯР МАСТЕРА) ✂`.
     - Нижняя часть (`tearOffTicket`) прижата к нижнему краю листа (`mt-auto pt-2 shrink-0`), что устраняет «плавание» линии отрыва при любой длине текста условий.
     - В талоне мастера добавлены вывод основного дефекта (`defectDescription`), дополнительного описания со слов клиента (`additionalDefectDescription`) и примечания к наряду (`notes` / `comments`).
  3. `backend/src/modules/print-templates/print-templates.service.ts`:
     - В `generateA4Html` для `isIntakeAct` зафиксирована компоновка: `.page-sheet` с `display: flex; flex-direction: column; justify-content: space-between`, верхний договор в `.intake-main-agreement`, нижний блок перфорации и талона в `.intake-bottom-section` с `margin-top: auto`.
     - В аргументы `generateA4Html` добавлен `malfunctions?: string[]`, в талоне мастера выводятся `mainDefect`, `extraDefect` («Со слов клиента») и `orderNotes` («Примечание к наряду»).
  4. `frontend/src/lib/repairs/print-presets-client.ts`:
     - В `PreviewSampleData` и `mapRepairToPreviewSampleData` добавлены и разделены поля `malfunctions`, `defectDescription`, `additionalDefectDescription` и `notes`.
     - Обновлены дефолтные превью-данные `DEFAULT_PREVIEW_SAMPLE_DATA` реалистичными значениями профилактики и примечаний.
  5. `frontend/src/app/(dashboard)/repairs/[id]/print/intake/page.tsx`:
     - Синхронизирована компоновка: flex-контейнер с `min-h-[285mm]`, линия отрыва зафиксирована, в талоне мастера выводятся `mainDefect`, `extraDefect` и `ticket.notes`.
- **Верификация:**
  - `tsc --noEmit` в `backend/` и `frontend/`: 0 ошибок.
  - Деплой на боевой сервер `150.241.98.135` (`/usr/local/bin/vf-deploy GETVOXLY`).
  - Проверка эндпоинтов и наряда `240ce9f1-b46d-4fe1-b4e6-12223acc6bde`.

## 2026-11-20: Унификация дизайна Акта приёма, вывод данных компании и устранение бага с заметками сделки
- **Root Cause & Задачи:**
  1. **Утечка описания сделки в «Заметку к сделке» и восстановление удалённых заметок при F5:**
     В `backend/src/modules/repairs/repairs.service.ts` запросы `list` (стр. 324) и `get` (стр. 453) содержали выражение `COALESCE((SELECT body FROM notes WHERE deal_id = d.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1), NULLIF(d.description, ''), '') AS deal_notes`.
     При создании наряда поле `d.description` заполнялось техническим текстом приёмки («Пакетная приёмка... Неисправность: ...»). Из-за фоллбэка на `NULLIF(d.description, '')` этот текст возвращался как `deal_notes`, создавая иллюзию автоматически созданной заметки («Заметка к сделке»). Даже когда пользователь удалял заметки через таб «Все заметки» или очищал поле, при обновлении страницы (F5) `deal_notes` снова подтягивал `d.description`.
     Кроме того, метод `createBatch` содержал явный `INSERT INTO notes` («Заметка к приёмке»), а метод `update` игнорировал очистку заметки вместо её soft-delete.
  2. **Отсутствие данных компании в печатных формах:**
     В `backend/src/modules/print-templates/print-templates.service.ts` метод `renderForOrder` выполнял выборку только из `repair_orders` без JOIN таблиц `contacts` и `companies`. Для наряда `240ce9f1-b46d-4fe1-b4e6-12223acc6bde` у клиента Тагира была привязана компания `ООО "Мега-Строй"` (ИНН `2367016930`), но в шаблон эти данные не попадали. В `mapRepairToPreviewSampleData` на фронтенде компания также перетиралась именем физлица.
  3. **Визуальный диссонанс «Акта приёма-передачи» (`work_order`) с другими бланками:**
     В `VisualPrintCanvas.tsx` и `print-templates.service.ts` ветка `isIntakeAct` использовала устаревший сырой HTML с грубыми черными границами `border: 1px solid #111111`, не соответствовавший Twenty CRM Light Canvas (белый холст, границы `#e5e5e5`, шрифт Inter, карточки `#fafafa`, бейджи DM Mono). В отрывном талоне мастера оставались следы «Заказ-наряда».
- **Что изменено:**
  1. `backend/src/modules/repairs/repairs.service.ts`:
     - Убран фоллбэк на `NULLIF(d.description, '')` в `list` и `get`: `deal_notes` возвращает только реальную неудалённую заметку из таблицы `notes` либо пустую строку.
     - Убрана автоматическая вставка заметки в `createBatch`.
     - В `update`: если `payload.deal_note !== undefined` и строка пустая, выполняется `UPDATE notes SET deleted_at = now()` для сделки наряда.
     - В `deleteNote`: мягкое удаление зеркальной заметки в таблице `notes` с привязкой по `deal_id` и телу.
  2. `backend/src/modules/crm/notes/notes.service.ts`:
     - В `softDelete`: при удалении CRM-заметки с `repair_order_id` удаляется соответствующая запись в `repair_notes`.
  3. `backend/src/modules/print-templates/print-templates.service.ts`:
     - В `renderForOrder`: добавлены LEFT JOIN к `contacts`, `companies` (через контакт и сделку) и выборка `company_name` и `company_inn`.
     - В `generateA4Html`: переработан HTML/CSS шаблона `work_order` в строгий стандарт Twenty CRM Light Canvas (Inter, границы `#e5e5e5`, закругления 6px, карточки `#fbfbfb`, бейдж номера `#4a38f5`, перфорация с иконкой ножниц, талон мастера без «Заказ-наряд» с крупным номером, реквизитами организации и свободными комментариями).
     - В `ensureTemplates`: отложенный запрос к `tenants` только при реальном отсутствии пресетов; оптимизирован `getBySlug`.
  4. `frontend/src/lib/repairs/print-presets-client.ts`:
     - В `PreviewSampleData` добавлены поля `companyName` и `companyInn`.
     - В `mapRepairToPreviewSampleData` извлекаются `companyName` и `companyInn`, формируется `clientInfo` с названием организации, ИНН, представителем и телефоном.
     - В дефолтные мок-данные добавлены `ООО "Мега-Строй"` и ИНН `2367016930`.
  5. `frontend/src/components/repairs/VisualPrintCanvas.tsx`:
     - Ветка `isIntakeAct` переведена на единый дизайн с «Товарным чеком» и «Актом выполненных работ» (Twenty CRM Light Canvas токены).
     - Выводятся реквизиты компании заказчика (наименование, ИНН), данные представителя и телефон.
     - Нижняя часть («Талон мастера») оформлена с полной информацией об инструменте, клиенте/компании, таблицей состояния с крупным номером и полем комментариев мастера.
- **Верификация:**
  - `npx tsc --noEmit` в `backend/` и `frontend/`: 0 ошибок.
  - Тесты `repair-notes-sync.test.ts` (3/3 passed) и `print-templates-act.test.ts` (3/3 passed).
  - Деплой на боевой сервер `150.241.98.135` (`/usr/local/bin/vf-deploy GETVOXLY`) завершился успешно (контейнеры healthy, эндпоинты возвращают HTTP 200).
  - Прямая проверка на боевом сервере для наряда `240ce9f1-b46d-4fe1-b4e6-12223acc6bde`:
    - `dealNote`: пустая строка `""` (описание сделки больше не просачивается в заметку).
    - `companyName`: `ООО "Мега-Строй"`, `companyInn`: `2367016930`.
    - Генерация `renderForOrder`: присутствуют `ООО "Мега-Строй"`, `ИНН 2367016930`, `Тагир (ref: Leha)`, талон мастера оформлен чисто, надпись «Заказ-наряд» в нижней части отсутствует.

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

## 2026-11-20: Редирект в портал с /register для авторизованного пользователя
- **Root cause:** кнопка бота «Вернуться к регистрации» ведёт на `/register`. В `LoginForm.tsx` был `useEffect` с редиректом при `isAuthenticated && tenant`, в `RegisterForm.tsx` — нет, поэтому вернувшийся после регистрации пользователь видел пустую форму.
- **Фикс:** `frontend/src/components/auth/RegisterForm.tsx` — из `useAuth()` берутся `tenant`, `isAuthenticated`; эффект уводит на `tenantPortalUrl(tenant.slug, "/dashboard")`.
- **Где ещё используется:** `RegisterForm` рендерится только на `/register`; бэкенд и `telegram.service.ts` не менялись.
- **Верификация:** `tsc --noEmit` без ошибок, `vf-deploy GETVOXLY` успешен, `/health`, `/login`, `/register` — HTTP 200, в логах backend за 15 минут ошибок нет.
- **Осталось:** ручная проверка сквозного флоу с реальным Telegram (нажатие кнопки в боте) — Playwright это не воспроизводит.

## 2026-11-20: Сквозной возврат регистрации через Redis-черновик и одноразовый токен из бота
- **Root cause:** Кнопка бота «Вернуться к регистрации» вела на голый `/register` (новая вкладка/WebView), тогда как форма, `session_id` и пароль существовали только в памяти старой вкладки, а сама регистрация (`POST /auth/register`) ещё не выполнялась (`consumed = f`, `isAuthenticated = false`). Поэтому добавленный в `eb091da` клиентский редирект никогда не срабатывал, а на страницах `/register` и `/login` классы `dark:` делали текст нечитаемым в тёмном WebView Telegram.
- **Решение:**
  1. `backend/src/modules/auth/auth.routes.ts`, `auth-session.service.ts`, `auth.service.ts`: при `POST /auth/code/request` (с `purpose: "register"`) опциональные `slug` и `password` (предварительно проверенные на занятость и захешированные `argon2`) сохраняются в Redis `reg:draft:<sessionId>` (TTL `OTP_TTL_MINUTES`). В `bindRecipient` при `/start auth_<token>` для регистрации создаётся одноразовый `reg:resume:<token>` (TTL до истечения сессии) и передаётся в `telegram.service.ts` (`sendCode(..., returnUrl)`) как `/register?token=<token>`. Добавлены публичные роуты `POST /auth/register/complete` и `GET /auth/register/draft` (включены в `PUBLIC_PATHS` в `authenticate.ts` и `CREDENTIAL_PATHS` в `apiClient.ts`). В `GET /auth/code/status` добавлен флаг `consumed`.
  2. `frontend/src/lib/auth/use-auth.tsx`, `use-code-flow.ts`, `RegisterForm.tsx`: автоматический переход по deep-link (`location.href` на мобильных / Telegram WebView, `window.open` на десктопе) + сохранение несекретного черновика в `sessionStorage`; автозавершение при открытии `/register?token=...` с редиректом в `https://<slug>.getvoxly.ru/dashboard` и восстановлением формы при конфликте поддомена; корректная реакция исходной вкладки на `consumed: true`.
  3. `frontend/src/app/(auth)/register/page.tsx`, `login/page.tsx`: удалены `dark:` оверрайды, ломавшие контраст на Twenty CRM Light Canvas в Telegram WebView.
- **Где ещё используется:** `useCodeFlow` и `use-auth.tsx` делятся с `LoginForm.tsx`; `AuthSessionService` — с `profile.routes.ts` (`/api/v1/profile/channels/*`); обратная совместимость полностью сохранена.
- **Верификация:** `tsc --noEmit` (backend + frontend, 0 ошибок), `/usr/local/bin/vf-deploy GETVOXLY` (exit 0, healthy), живой Playwright на `https://getvoxly.ru/register` (dark colorScheme) + изолированный контекст `/register?token=...` -> `POST /auth/register/complete` (`201`) -> редирект на `https://e2e-reg-live-01.getvoxly.ru/dashboard` (`GET /auth/me` `200`, cookies + localStorage выставлены, `reg:*` ключи в Redis удалены, `POST /auth/login` проверяет пароль и отдаёт `SECOND_FACTOR_REQUIRED`), тестовый тенант удалён из БД.
- **Осталось:** финальный клик живым пользователем по кнопке в `@GetVoxlybot` в Telegram (проверить, что реальный `chat_id` получает `?token=` и сразу уходит в портал).

## 2026-11-20: Приведение акта приёма-передачи к эталонному бланку ИП Сагайдак А.Г. и удаление «Заказ-наряда» из каталога
- **Root cause:**
  1. Шаблон «Заказ-наряд на ремонт» (`repair_order`) присутствовал в `ALL_PRESETS` и `ALL_CLIENT_PRESETS`, поэтому при инициализации тенанта (`ensureTemplates`) постоянно добавлялся в список системных бланков, хотя требовалось исключить его из каталога.
  2. При сохранении правок базового шаблона бэкенд форкал запись в отдельный пользовательский шаблон (`is_custom = true`), из-за чего в каталоге создавались лишние копии («Акт приёма Toua Service (E2E Проверен)»).
  3. В `VisualPrintTemplateEditor.tsx` поверх вкладок была выведена громоздкая строка инпутов (`toolInfo`, `clientInfo`, `comments`), нарушавшая дизайн-систему Twenty CRM.
  4. Форма «Акт приема-передачи оборудования» (`work_order`) визуально не соответствовала реальному образцу бланка (Договор ИП Сагайдак А.Г. с 8 пунктами предмета договора, таблицей комплектации и отрывным талоном мастера с крупным номером наряда).
- **Решение:**
  1. `backend/src/modules/print-templates/print-presets.ts`: удален `REPAIR_ORDER_PRESET` из `ALL_PRESETS`. Обновлен `INTAKE_ACT_PRESET` под эталонный бланк Image 2 (шапка ИП Сагайдак А.Г. с логотипом, заголовок «Договор на оказание услуг по ремонту инструмента», 8 пунктов «ПРЕДМЕТ ДОГОВОРА», подписи Заказчика и Исполнителя, отрывной талон мастера с крупным номером заказа).
  2. `frontend/src/lib/repairs/print-presets-client.ts`: удален `REPAIR_ORDER_CLIENT_PRESET` из `ALL_CLIENT_PRESETS`. Обновлен `INTAKE_ACT_CLIENT_PRESET` и `DEFAULT_PREVIEW_SAMPLE_DATA` (данные Toua GSN50, Тагир, ИП Сагайдак А.Г.).
  3. `frontend/src/components/repairs/VisualPrintInspector.tsx`: удален ключ `repair_order` из `DOC_TYPE_LABELS`.
  4. `frontend/src/components/repairs/VisualPrintTemplateEditor.tsx`: удален лишний тулбар быстрых полей над вкладками инспектора; в `VisualPrintCanvas` передан `documentType`.
  5. `frontend/src/components/repairs/VisualPrintCanvas.tsx`: добавлен специализированный рендерер акта приёма (`work_order`), полностью реплицирующий эталонный бланк Image 2 (шапка с контактами СЦ, «Договор № ...», таблица комплектации и внешнего вида, преамбула, 8 условий договора, подписи сторон, линия отреза, нижний талон мастера с крупным номером в правой ячейке таблицы).
  6. `backend/src/modules/print-templates/print-templates.service.ts`: в `update()` убран принудительный форк системных шаблонов в кастомные (прямое сохранение изменений тенанта по `WHERE tenant_id = $10 AND id = $11`); в `generateA4Html` внедрен идентичный HTML-рендерер для печати и PDF.
  7. База данных PostgreSQL на VPS: удалены записи `repair_order` и все `is_custom = true`; обновлен `layout_config` для `work_order` тенанта `b9ea05c5-a1af-4ecd-86a6-ad75db68fe58`.
- **Верификация:**
  - Полная компиляция `tsc --noEmit` в backend и frontend (0 ошибок).
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY`.
  - Проверка каталога шаблонов: отображаются только 3 системных бланка («Акт выполненных работ с гарантией», «Товарный чек / Квитанция об оплате», «Акт приема-передачи оборудования»), пользовательские шаблоны и «Заказ-наряд» отсутствуют.
  - Проверка рендера акта приёма: полное визуальное соответствие эталону Image 2.


## 2026-11-20: Прямой deep-link переход в @GetVoxlybot без промежуточной карточки «Подключить Telegram»
- **Root cause:** При клике «Получить код» на `/register` нативный `tg://resolve` не использовался, а на desktop при блокировке `window.open` после `await` и на экране ожидания в `RegisterForm.tsx` показывалась промежуточная карточка «Подключить Telegram через @GetVoxlybot».
- **Фикс:**
  1. `frontend/src/lib/auth/use-code-flow.ts`: добавлен `buildNativeTelegramUrl()` (`tg://resolve?domain=...&start=auth_<deep_link_token>`) для mobile/Telegram WebView, авто-переход при заблокированном `window.open` на desktop (`purpose === "register"`), флаг `popupBlocked`.
  2. `frontend/src/components/auth/RegisterForm.tsx`: убрана кнопка-карточка «Подключить Telegram через @GetVoxlybot» в состоянии `awaiting_bot` — вместо неё показывается компактный статус перехода в `@GetVoxlybot` с резервной ссылкой.
- **Где ещё используется:** `useCodeFlow` также используется в `frontend/src/components/auth/LoginForm.tsx:78` (`LoginForm.tsx` не изменён, поведение входа сохранено).
- **Верификация:** `tsc --noEmit` (backend + frontend, 0 ошибок), `/usr/local/bin/vf-deploy GETVOXLY` (exit 0), живая Playwright-проверка перехода на `t.me/GetVoxlybot?start=auth_...` (desktop) и `tg://resolve?...` (mobile WebView) после клика «Получить код».


## 2026-11-20: Разрешение возврата наряда из «Диагностики» в «Принят» (FSM)
- **Контекст:** Наряд `240ce9f1-b46d-4fe1-b4e6-12223acc6bde` перевели в статус «Диагностика» (`diagnostics`). При попытке вернуть наряд в «Принят» (`intake`) интерфейс выдавал ошибку (409 Conflict: `Cannot move a repair order from "diagnostics" to "intake"`).
- **Root cause:** В графе допустимых переходов конечного автомата `ALLOWED_TRANSITIONS` (`backend/src/modules/repairs/repairs.types.ts`) для статусов `diagnostics`, `approval` и `in_progress` отсутствовал переход обратно в `intake`. Все остальные статусы (`waiting_parts`, `parts_order`, `ready`, `issued`, `rejected`) возврат в `intake` уже содержали.
- **Фикс:**
  1. `backend/src/modules/repairs/repairs.types.ts`: в `ALLOWED_TRANSITIONS` добавлены рёбра отката в `intake` (и возврат в `diagnostics`):
     - `diagnostics`: добавлен `"intake"`
     - `approval`: добавлены `"intake"`, `"diagnostics"`
     - `in_progress`: добавлены `"intake"`, `"diagnostics"`
- **Где ещё используется:**
  - `backend/src/modules/repairs/repairs.service.ts`: `canTransition()` проверяет допустимость перехода при `changeStatus`, а `allowedTransitionsFrom()` возвращает список разрешённых статусов в DTO наряда для фронтенда.
  - `frontend/src/components/repairs/detail/RepairStatusStepper.tsx`: клик на шаг степпера отправляет мутацию смены статуса.
- **Верификация:** `tsc --noEmit` (backend + frontend, 0 ошибок), деплой `/usr/local/bin/vf-deploy GETVOXLY`, живая проверка смены статуса на боевом наряде через бэкенд и БД.


## 2026-11-21: Организации и РФ-счета в /finance, Контур.Эльба, дедупликация услуг и разбивка статей оплаты
- **Root cause:**
  1. `RepairsService.addWork()` всегда делал `INSERT` без проверки существующей позиции, а `repairs/[id]/page.tsx` не прокидывал `quantity`/`unit_price` в `WorkItemsTable`.
  2. Реквизиты поставщика хранились одной записью в `print_template_settings`, в `/finance` не было управления организациями-поставщиками, НДС 20% прибавлялся сверху вместо режима «в т.ч. НДС» / «Без НДС», а в `GenerateInvoiceModal` не передавались реквизиты привязанной компании-плательщика.
  3. Печать счёта в `FinancialSummary.tsx` рендерила минималистичный HTML без реквизитов поставщика, банковской таблицы, QR-кода по ГОСТ, суммы прописью и подписей, а `InvoiceViewModal.tsx` содержал захардкоженного поставщика (`GETVOXLY Сервисный центр`).
  4. `BatchPaymentModal.tsx` использовал захардкоженный `INCOME_CATEGORIES` и отправлял `category_id: undefined`, не синхронизируясь со справочником `/finance` и не разбивая работы/запчасти.
- **Изменения:**
  1. Миграция `backend/src/db/migrations/0118_finance_organizations_and_elba.sql`: таблица `finance_organizations` с RLS (реквизиты, режимы НДС `none`/`included_5`/`included_7`/`included_10`/`included_20`, логотип/печать/подпись, `invoice_config`, зашифрованный `elba_api_key_enc`), расширение `invoices` (`issuer_organization_id`, `issuer_snapshot`, `vat_mode`, поля Эльбы), бэкфилл из `print_template_settings`.
  2. Backend: `finance-organizations.types.ts`, `finance-organizations.service.ts`, `elba.client.ts` (Public API `https://elba-api.kontur.ru/v1`, `X-Kontur-ApiKey`), `invoice-html.service.ts` (РФ-счёт + QR-код ГОСТ Р 56042-2014), обновлённые `invoice-pdf.service.ts` (векторный QR, РФ шапка и подписи), `invoices.service.ts` (дедупликация позиций счёта, снапшот организации, расчёт НДС «в т.ч.»/«Без НДС», `syncToElba`), `finance.service.ts` (`batchPayment` с разбивкой работ/запчастей по реальным статьям `finance_categories`), `repairs.service.ts` (дедупликация `addWork` по названию + цене независимо от мастера).
  3. Frontend: новая вкладка `OrganizationSettingsTab.tsx` в `/finance` (реквизиты + поиск по ИНН + НДС, конструктор формы счёта с загрузкой логотипа/печати/подписи и живым превью, подключение Контур.Эльбы), обновлённые `GenerateInvoiceModal.tsx`, `FinancialSummary.tsx`, `InvoiceViewModal.tsx`, `InvoiceCreateModal.tsx`, `BatchPaymentModal.tsx`, `WorkItemsTable.tsx`, `repairs/[id]/page.tsx`, `use-invoices.ts`.
- **Верификация:** `tsc --noEmit` (backend + frontend = 0 ошибок), `/usr/local/bin/vf-deploy GETVOXLY`, живая проверка на боевом сервере всех 5 пунктов.


## 2026-11-21: Фикс формирования счёта и «По ИНН», редактирование/удаление счетов и блокировка актов 0 ₽
- **Root cause:**
  1. `InvoicesService.fromRepairOrders` выбирал несуществующую колонку `repair_orders.company_id` (компания связана через `deals`/`contacts`), из-за чего `POST /api/v1/invoices/from-repairs` возвращал `500 Internal server error`.
  2. Кнопка «По ИНН» в `OrganizationSettingsTab.tsx` дергала несуществующий `/api/v1/companies/lookup-inn` вместо `/api/v1/crm/companies/lookup-inn` / `/api/v1/finance/lookup-inn`.
  3. `openInvoiceRfPrintWindow` и `InvoiceViewModal` ходили через относительный `fetch('/api/v1/invoices/...')` вместо `apiClient.downloadBlob(...)`.
  4. Отсутствовали `DELETE /api/v1/invoices/:id`, расширенное редактирование счёта (позиции/НДС/поставщик/плательщик) и UI-кнопки редактирования/удаления в `FinancialSummary` и `InvoiceViewModal`.
  5. Акты без цены (`0 ₽`) были доступны для выбора в `GenerateInvoiceModal` и `BatchPaymentModal` и не отсекались на бэкенде.
- **Фиксы:**
  1. `backend/src/modules/finance/invoices.service.ts`: исправлен `LEFT JOIN deals/contacts` в `fromRepairOrders`, добавлена валидация запрета актов с нулевой стоимостью, расширен `update()` (блокировка `paid` 409, пересчёт позиций/НДС/поставщика), добавлен `remove()` (soft-delete, запрет `paid`, возврат `repair_orders.payment_status` в `unpaid`).
  2. `backend/src/modules/finance/finance.service.ts`: валидация запрета оплаты актов с нулевой стоимостью в `batchPayment()`.
  3. `backend/src/modules/finance/finance.routes.ts` & `invoices.routes.ts`: добавлены `GET /api/v1/finance/lookup-inn` (`finance:read`) и `DELETE /api/v1/invoices/:id` (`finance:write`).
  4. Миграция `0120_invoice_items_numeric_quantity.sql`: расширение `invoice_items.quantity` до `NUMERIC(12, 3)`.
  5. Frontend: `InvoiceEditModal.tsx`, кнопки редактирования/удаления под `<Guard permission="finance:write">` в `FinancialSummary.tsx` и `InvoiceViewModal.tsx`, перевод печати/HTML/PDF на `apiClient.downloadBlob`, блокировка актов с `0 ₽` в `GenerateInvoiceModal.tsx` и `BatchPaymentModal.tsx`, исправлен URL «По ИНН» в `OrganizationSettingsTab.tsx`.
- **Верификация:** `tsc --noEmit` (backend + frontend = 0 ошибок), `/usr/local/bin/vf-deploy GETVOXLY`, живая проверка создания/редактирования/удаления счёта, поиска по ИНН `505030516451`, валидации нулевых актов и синхронизации с Контур.Эльбой.


## 2026-11-21: Статус выполнения remediation-плана аудита (read-only сверка кода, git и прода)

**Итог одной строкой:** 0 из 38 дублей слито (3 из 4 багов из-за дублей исправлены) | 0 из 20 мёртвых файлов удалено | 0 индексов применено на проде (8 лежат в миграции 0119) | Этап 1 из 5 в работе | **исправления безопасности есть в git/master, но НЕ задеплоены**.

**Проверено на проде (root@150.241.98.135, только чтение):**
- `/opt/getvoxly/backend/src`: `jwt.decode` в `modules/auth` — **4 вхождения** (уязвимость обхода авторизации жива); `requirePlatformOwner` в `gemini-integration.routes.ts` — 0; `requireMaxServiceToken` — 0; «девятьсот» в `print-templates.service.ts` — 0.
- `pgmigrations`: последняя `0118_finance_organizations_and_elba`; индексы из `0119_hot_path_indexes.sql` в `pg_indexes` отсутствуют.
- `finance_organizations`: RLS включён и форсирован, политика `finance_organizations_isolation` есть.
- `https://api.getvoxly.ru/health` → 200, `https://getvoxly.ru/login` → 200. Вход с реальными кредами и пробы с поддельным JWT на проде не выполнялись намеренно.

**Что сделано в коде (в `origin/master`, коммиты `ce6f6b7`, `0825fa8`):**
| Пункт | Статус | Доказательство |
|---|---|---|
| SEC-0 `jwt.decode` → `jwt.verify` в `auth.routes.ts`, `auth.service.ts`, `partner.routes.ts` | ✅ в git, ❌ не на проде | `impersonation-forgery.test.ts`: 3 теста падают на старом коде, проходят на новом |
| SEC-0b токен `VOXLY_SERVICE_TOKEN` на внутренних маршрутах MAX (оба префикса) | ✅ в git, ❌ не на проде | `max-internal-auth.test.ts` 8/8. Токен не задан → маршрут открыт с предупреждением (совместимость) |
| SEC-1 `gemini-integration` только `platform_owner` + запрет внутренних `baseUrl` | ✅ в git, ❌ не на проде | typecheck чист; отдельного теста нет |
| S1/S2 MAX: ключ сессии `tenantId:accountId`, фильтр `inbound && fromMe !== true` | ✅ в git | typecheck чист; отдельного теста нет |
| SEC-PATH, часть «обход каталога» (`resolveSafeUploadPath`) | ✅ в git | публичная отдача любых `image/*` без JWT **не тронута** |
| SEC-CIPHER | 🔄 | в production без `CREDENTIALS_ENCRYPTION_KEY` и без `JWT_SECRET` ≥16 — отказ; откат на ключ из `JWT_SECRET` остаётся (с предупреждением) |
| D1 `девяносто` → `девятьсот` (backend печатные формы) | ✅ в git | `amount-in-words.test.ts` 10/10 |
| D2 `countUsers` + `deleted_at IS NULL` | ✅ в git | слияние с `countSeats` не сделано |
| D5 `FinancialSummary` → `apiClient.downloadBlob` | ✅ в git | 3 blob-экспорта, `use-agent-knowledge`, `use-chat-stream` на `apiClient` не переведены |
| Индексы (8 шт.) в `0119_hot_path_indexes.sql` | 🔄 миграция в git, не применена | на проде их нет |

**Не сделано (по приоритету):**
1. Деплой исправлений безопасности (SEC-0, SEC-0b, SEC-1) — прод уязвим прямо сейчас. Перед деплоем задать `VOXLY_SERVICE_TOKEN` у backend и max-bridge и проверить, что мост шлёт его (код моста в репозитории отсутствует).
2. Применить `0119` (вне пика; обычный `CREATE INDEX`, не `CONCURRENTLY`).
3. S3 пул PG 10 без `statement_timeout`; S4 HTTP в транзакции `crm-pipeline.service.ts:1365`; S5 Redis `retryStrategy` возвращает `null`; S6 `QueueManager` в памяти; S7 `inflateRawSync` без лимита; S9 трассировка в `/tmp` без ротации; S8 rate-limit в памяти, порты `4000`/`3000` на `0.0.0.0`; нет `mem_limit` в compose.
4. SEC-2 (80 роутов без `requirePermission`/`requireModule`), SEC-3 DOM XSS `TelegramComposer`, SEC-COOKIE, SEC-SSRF2.
5. CI-BROKEN: `security.yml` падает, `grep` находит 12 нарушений `: any`.
6. Дубли D3, D4, D6–D29 (22 копии `toIso`, 5 `hashToken`, 6 `nullIfBlank` и т.д.) — без изменений.
7. 20 мёртвых файлов: все подтверждены с 0 импортов, все ещё в git; удаление по решению пользователя после полного аудита.

**Поправки к самому аудиту (найдены при сверке):**
- `frontend/src/lib/finance/amount-to-words.ts` — 0 импортёров, это мёртвый код; ошибка `THOUSANDS` там не влияет на пользователей (утверждение «`InvoiceViewModal` использует» было неверным). Исправлять смысла нет — кандидат на удаление.
- Счёт нарушений `: any` для CI — 12, а не 29 (29 — результат более широкого шаблона).
- Каталог `full_function_catalog.md` устарел: после сессии организаций/РФ-счетов появились `elba.client.ts`, `finance-organizations.service.ts`, `finance-organizations.types.ts`, `invoice-html.service.ts`, `OrganizationSettingsTab.tsx` (1414 LOC), роуты `GET /invoices/:id/html` и `POST /invoices/:id/sync-elba`, миграции `0118`, `0119`, метод `apiClient.downloadBlob`. Каталог не пересоздавался, секции финансов помечены устаревшими.

**Состояние проверок:** `tsc --noEmit` backend и frontend — без ошибок. Тесты подмножества backend: 62 проходят, падают 3 файла, они падали до правок (`chat-from-me`, `chat-stream` — `getEnv` в `conversion-dispatcher` при импорте; `crm-enrichment` — ожидание числа вызовов 1, а их 2).

**Следующий шаг:** деплой Этапа 1 через `/usr/local/bin/vf-deploy GETVOXLY` после задания `VOXLY_SERVICE_TOKEN`; ответственный — владелец проекта по согласованию.


## 2026-11-21 (продолжение): Исправления безопасности, стабильности 50+ RPS, контрактов и чистка 21 мёртвого файла

### Что изменено и подтверждено проверками
1. **Безопасность (CRITICAL / HIGH / MEDIUM):**
   - `SEC-0`: убраны все `jwt.decode` в `auth.routes.ts` (`/refresh`, `/exit-impersonation`), `auth.service.ts` (`exitImpersonation`) и убран приём сырого `body.impersonator_id` в `partner.routes.ts` (`/revert-tenant`) — теперь везде криптографическая проверка подписи `jwt.verify` (`impersonation-forgery.test.ts` 3/3 PASS, доказан провал на старом коде).
   - `SEC-0b`: все 9 внутренних маршрутов MAX (`maxInternalRoutes` + 4 дубликата `/internal/*` в `maxIntegrationRoutes`) закрыты проверкой `VOXLY_SERVICE_TOKEN` через `timingSafeEqual` (`max-internal-auth.test.ts` 8/8 PASS; подтверждено, что `getvoxly-max-bridge-1` шлёт `Authorization: Bearer <VOXLY_SERVICE_TOKEN>`).
   - `SEC-1`: `gemini-integration.routes.ts` (`/verify`, `/pool-stats`) закрыт `app.requirePlatformOwner()` + валидацией `baseUrl` (HTTPS-only, запрет приватных IP и внутренних Docker-хостов; `security-hardening.test.ts` 9/9 PASS).
   - `SEC-PATH`: `app.ts` (`resolveSafeUploadPath`) — `path.basename` после `decodeURIComponent` + проверка `resolved.startsWith(uploadsDir + path.sep)` и async `fs.access` для `/uploads/:filename` и `/api/v1/crm/messages/:id/attachment`.
   - `SEC-CIPHER`: `credentials-cipher.ts` — запрет захардкоженного dev-ключа в `production` (однократное предупреждение при fallback на `JWT_SECRET`).
   - `S1 + S2`: `MaxTsAdapter.ts` (ключ сессии `${tenantId}:${channelAccountId}` + `.unref()` на heartbeat) и `messaging-registry.ts:145` (`direction === "inbound" && fromMe !== true`).
   - `SEC-3`: `TelegramComposer.tsx` — санитизация URL-схем (`https?://`, `mailto:`, `tg://`), экранирование кавычек и `<`/`>` в `innerHTML` (`telegram-composer-xss.test.ts` 4/4 PASS, доказан провал на старом коде).
2. **Стабильность под 50+ RPS и ресурсы:**
   - `db/client.ts`: `DEFAULT_MAX_CLIENTS = 20`, `statement_timeout = 120_000`, `idle_in_transaction_session_timeout = 60_000`.
   - `crm-pipeline.service.ts`: внешний HTTP `bridge.getPrivateDialogs()` вынесен наружу транзакции БД.
   - `infrastructure/redis.ts`: убран `return null` в `retryStrategy` (бесконечный capped backoff до 5s).
   - `conversion-dispatcher.service.ts`: переведён на `getRedisConnectionOptions()` (DB 1 + `maxRetriesPerRequest: null`), добавлен `removeOnFail` в `conversion-dispatcher`, `knowledge-base.queue.ts`, `lead-notification.queue.ts`.
   - `knowledge-text.ts`: лимиты распаковки ZIP (`MAX_ZIP_ENTRY_BYTES = 25 MB`, `MAX_ZIP_TOTAL_BYTES = 60 MB`, `MAX_ZIP_ENTRIES = 2000`; `zip-bomb.test.ts` 2/2 PASS, доказан рост RSS 120 МБ на старом коде vs защита на новом).
   - `ai-trace-logger.ts`: безусловная запись в `/tmp/getvoxly-ai-trace.{jsonl,log}` отключена по умолчанию (включается только через `ENABLE_AI_TRACE_LOG=true`).
   - Таймауты `AbortSignal.timeout` + лимиты размера ответа добавлены во все 13 внешних `fetch()` (`max-bridge.service.ts`, `whatsapp-evolution.service.ts`, `media-resolver.ts`, `telegram-transport.service.ts`, `enrichment.service.ts`, `MaxGreenApiAdapter.ts`, `admin-tenants.routes.ts`, `app.ts`) и fallback-таймаут 120s на стрим в `smart-model-router.ts`.
   - Rate-limit на публичные маршруты: `sites.routes.ts` (`/:token` — 120/мин), `ai.routes.ts` (`/generate-prompt` — 15/мин), `webchat.routes.ts` (`/upload` — 20/мин, `/message` — 60/мин), `auth.routes.ts` (`/register` — 15/мин).
   - Graceful shutdown и утечки: `worker.ts` закрывает все 6 очередей через `Promise.allSettled`, `server.ts` получил `isShuttingDown`, hard-timeout 15s и `await closeRedis()`, `ChatEventBus` и `NotificationEventBus` получили `setMaxListeners(0)`, в `webchat.service.ts:635` добавлен `clearTimeout(lockTimer)`.
   - `frontend/src/lib/api/apiClient.ts`: запрет auto-retry для неидемпотентных методов `POST`/`PATCH`/`PUT`/`DELETE` (`api-client-retry.test.ts` 3/3 PASS, доказан провал на старом коде).
   - Новая аддитивная миграция `backend/src/db/migrations/0119_hot_path_indexes.sql` (8 индексов для `deal_messages`, `repair_orders`, `crm_tasks`, `deals`, `tenant_audit_log`).
3. **Активные баги, контракты, Security CI и мёртвый код:**
   - `print-templates.service.ts:117` («девяносто» → «девятьсот», `amount-in-words.test.ts` 10/10 PASS); `marketplace.routes.ts:60` (`AND deleted_at IS NULL`).
   - `apiClient.downloadBlob` + `triggerBrowserDownload`: переведены `FinancialSummary.tsx`, `use-warehouse.ts`, `use-deals.ts`, `use-contacts.ts`; `use-agent-knowledge.ts` → `apiClient.postFormData`; `use-chat-stream.ts` → `apiClient.get`.
   - Синхронизированы `Permission` (+6 прав в `frontend/src/types/index.ts`) и `RepairStatus` (`parts_order` в `repairs.types.ts`, убран дубль из `use-repairs.ts`, добавлен цвет в `RecordRepairsTab.tsx`).
   - Убраны все 12 нарушений `: any` (`security.yml` grep → `0` нарушений).
   - Удалён 21 подтверждённый мёртвый файл (0 импортёров; `tsc --noEmit` и `next build` прошли без ошибок).

### Волна 2 (выполнена и проверена 2026-11-21)
1. **Блок A — RBAC и модульные гейты на 80 маршрутах (5 модулей):**
   - `backend/src/plugins/authorize.ts`: добавлены декораторы `requireAnyPermission`, `requireAnyModule` и экспортирован `assertPermission` (убраны дубли в `notes.routes.ts` и `timeline.routes.ts`).
   - `warehouse.routes.ts` (38 маршрутов) и `services.routes.ts` (5 маршрутов): закрыты `requireAnyModule(["products_services", "service_center"])` (согласовано с `nav-items.ts:202` и боевой таблицей `installed_modules`) + `deals:read|service_center:read` на чтение, `deals:write|service_center:write` на запись, `finance:write|tenant:admin` на `/supplier-orders/:id/pay`, `tenant:admin` на `PATCH /settings`.
   - `analytics.routes.ts` (15 аутентифицированных маршрутов после `authenticatePlugin`; 3 публичных трекинг-маршрута сохранены): `deals:read` на чтение, `tenant:admin` на запись/удаление/тест интеграций и пре-чат конфига.
   - `print-templates.routes.ts` (13 маршрутов): `requireModule("service_center")` + `service_center:read` / `service_center:write` / `tenant:admin` (для `/settings`).
   - `channels/sites/sites.routes.ts` (6 маршрутов `siteManagementRoutes`; публичный webhook сохранён): `deals:read` на чтение, `tenant:admin` на создание/редактирование/удаление/регенерацию токена.
   - Покрыто тестом `backend/src/tests/rbac-routes-coverage.test.ts` (4/4 PASS).
2. **Блок B — Инфраструктура очередей и контейнеров под 50+ RPS:**
   - `backend/src/infrastructure/queue.ts`: `QueueManager` переведён на durable BullMQ (`Queue` + `Worker` с `concurrency: 5`, `removeOnComplete`/`removeOnFail`, регистрацией `qm-*` в `registerBullQueue`) при настроенном `REDIS_URL`, с прозрачным in-memory fallback для `NODE_ENV=test` / dev без Redis и полным `shutdown()` (`queue-manager-bullmq.test.ts` 2/2 PASS, `queue-worker.test.ts` 2/2 PASS).
   - `backend/src/modules/partner/partner.routes.ts`: блокирующий `redis.keys()` заменён на неблокирующий цикл `redis.scan(..., COUNT 100)`.
   - `backend/src/modules/admin/admin-metrics.routes.ts`: поле `queue` подключено к реальному `getBullQueueMetrics()` (суммы `pending`/`failed` + детальный массив `queues`).
   - `docker-compose.yml`: подтверждено, что `automation-npm-1` проксирует по Docker DNS (`backend:4000`, `frontend:3000`); хостовые порты привязаны к `127.0.0.1:4000:4000` и `127.0.0.1:3000:3000`; добавлены `mem_limit`/`cpus` на все 5 сервисов, `NODE_OPTIONS`, healthcheck на `evolution-api` и `max-bridge`, PG tuning (`max_connections=200`, `shared_buffers=256MB`, `effective_cache_size=768MB`, `work_mem=4MB`) без смены Alpine `musl` образа.
3. **Блок C — Безопасная дедупликация ядра:**
   - Созданы единые утилиты `backend/src/lib/{crypto,html,string,mime}.utils.ts` + расширен `date.utils.ts` (`toDate`/`toIso`/`toIsoOrNull`) + `backend/src/modules/ai/html-cleaner.ts` (`cleanHtmlToMarkdown`).
   - Убраны дубли `hashToken` (5 файлов), `escapeHtml`/`escapeXml` (5 файлов + убран кросс-модульный импорт в `notification-channels.service.ts`), `nullIfBlank` (6 файлов), MIME-карт (3 файла: `app.ts`, `media-resolver.ts`, `max-integration.routes.ts`), HTML-очистки (`site-crawler.ts` + `web-extractor.service.ts`). Покрыто `shared-lib-utils.test.ts` (6/6 PASS).
   - `backend/scripts/resend-tenant-credentials.mjs`: `Math.random()` заменён на `crypto.randomInt`, удалён дубль `.ts`.
   - Frontend: `TableEmptyState` перенесён в `RecordTable.tsx`, удалена мёртвая обёртка `CrmTable.tsx`; `CreateDealModal.tsx` удалён (заменён на `DrawerCreateDeal` в `deals/page.tsx`); в `DealListView.tsx` удалено 78 строк дублей (переведено на `twenty-table-helpers.tsx`); добавлен `getApiErrorMessage` в `apiClient.ts`.

### Волна 3 (выполнена и проверена 2026-11-21)
1. **Закрытие оставшихся security-хвостов с анализом взаимосвязей:**
   - `credentials-cipher.ts`: подтверждено наличие `CREDENTIALS_ENCRYPTION_KEY` (64 hex-символа = 32 байта) в `/opt/getvoxly/.env` и контейнере `getvoxly-backend-1`; убран тихий fallback на `JWT_SECRET` в `NODE_ENV=production` (теперь отсутствие ключа строго бросает `CredentialsEncryptionUnavailableError`).
   - `app.ts` (`/uploads/:filename`) + `webchat.routes.ts`: убран `contentType.startsWith("image/")` из `isPublicAsset`, закрывающий анонимный доступ к приватным фото клиентов из WhatsApp/Telegram/MAX (остались только явные `_avatar_`, `_logo_`, `_public_`; авторизованные пользователи CRM продолжают видеть фото через cookie `getvoxly_auth_token` на `.getvoxly.ru` / `Bearer` / `?token=`, а загрузки посетителей веб-виджета в `webchat.routes.ts` маркируются `public_`, сохраняя работу на сторонних сайтах).
   - `bot-alias.routes.ts`: добавлен `rateLimit: { max: 15, timeWindow: "1 minute" }` на дублирующем маршруте `POST /generate-prompt`.
2. **Починка всех pre-existing падений тестов (и реальных багов, найденных ими):**
   - **Найден и починен реальный баг мобильной вёрстки:** в `frontend/src/app/(dashboard)/repairs/[id]/page.tsx` заменены 2 безусловных `grid-cols-2` на `grid-cols-1 md:grid-cols-2`.
   - **Улучшен a11y:** в `frontend/src/components/settings/SourceMultiSelect.tsx` добавлены `aria-label` и `aria-expanded` на триггер `role="button"`.
   - **Backend (2/2 починены):** `chat-from-me.test.ts` и `crm-enrichment.test.ts` (5/5 PASS) приведены к фактической логике (multi-lookup без мутаций + `UPDATE deals` при обогащении имени).
   - **Frontend (все 11 падавших файлов починены → 55/55 test files PASS, 326/326 тестов):** `responsive-layout.test.ts`, `DialogueFeedbackModal.test.tsx` (независимость от TZ), `inbox-page.test.tsx`, `source-multi-select.test.tsx`, `RepairClientSection.test.tsx`, `RepairIntakeModal.test.tsx`, `nav-items.test.ts`, `company-card.test.tsx`, `deal-card-mobile.test.tsx`, `deals-toolbar-mobile.test.tsx`, `use-record-table-layout.test.ts`.
3. **Архитектурная дедупликация, границы модулей и найденный баг XLSX:**
   - Создан `backend/src/lib/spreadsheet-io.ts` (общие `buildXlsxBuffer`, `buildCsvBuffer`, `parseCsvText`, `parseXlsxBuffer` с ZIP-bomb лимитом 30MB/60MB); убран кросс-модульный импорт `contacts-io.service.ts` → `warehouse-io.service.ts`.
   - **Найден и починен реальный баг в `parseXlsxBuffer`:** регулярка `/\bt="([a-z]+)"/` не матчила заглавную `S` в `t="inlineStr"`, из-за чего все строковые ячейки при обратном импорте XLSX, сгенерированного `buildXlsxBuffer`, терялись (заменено на `/\bt="([a-zA-Z]+)"/`, подтверждено roundtrip-тестом в `shared-lib-utils.test.ts`).
   - В `backend/src/lib/string.utils.ts` добавлена `pluralRu` (заменила 4 дубля в `amount-to-words.ts`, `bot-messages.ts`, `channels.service.ts`, `telegram-auth.service.ts`).
   - Убраны 12 идентичных дублей `toIso`/`toIsoOrNull` в сервисах и типах (переведены на `backend/src/lib/date.utils.ts`).

### Что оставлено осознанно вне скоупа
- Глубокое переписывание `bot-alias.routes.ts` / `gemini` LLM-роутера (архитектурный рефакторинг с высоким риском регрессии внешних клиентов и нулевым влиянием на безопасность/производительность; security-дыра с `rateLimit` в `bot-alias.routes.ts` закрыта).


---

## Унификация формы приёмки и карточки наряда («Оборудование и Неисправность», 2026-11-21)

- **Root Cause:** В сессии `1219a9ca` форма приёмки `RepairIntakeModal.tsx` была переведена на динамические справочники тенанта (`DictionarySelectField`, колонки `package_contents_items TEXT[]`, `malfunctions TEXT[]` и `syncEquipmentDictionaries`), тогда как карточка наряда `repairs/[id]/page.tsx` и `RepairsService.update()` остались на захардкоженном `EQUIPMENT_TYPES` (электроника), плоских `<input>` без синхронизации строковых и массивных колонок и с `trim() || undefined` (невозможно очистить поля). В результате при редактировании заказа `№0016` (`Пистолет монтажный`) тип визуально сбрасывался, а правки комплектации и неисправности рассинхронизировались с таблицей нарядов, печатными актами и историей по S/N.
- **Что изменено:**
  - `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`: удалён хардкод `EQUIPMENT_TYPES`; редактирование блока «Оборудование» и «Неисправность со слов клиента» переведено на `DictionarySelectField` (тип, бренд, каскадная модель, мульти-комплектация `package_contents_items`, мульти-неисправности `malfunctions` + доп. описание `defect_description`); добавлено отображение чипов комплектации и неисправностей (в карточке и во вкладке «История»); добавлено инлайн-редактирование `priority` и `notes`; исправлена очистка пустых полей (`equipment_serial`, `appearance`, `notes`, `package_contents_items`) и убрано дублирование `deal_note` при неизменённой заметке.
  - `frontend/src/components/repairs/RepairIntakeModal.tsx`: добавлено поле «Внешний вид» (`appearance`) в `EquipmentCard` (1-в-1 с карточкой и печатью).
  - `backend/src/modules/repairs/repairs.service.ts`: в `update()` реализована двусторонняя синхронизация `package_contents ↔ package_contents_items`, согласованная синхронизация `malfunctions ↔ defect_description` и вызов `syncEquipmentDictionaries()` при правке оборудования.
  - `backend/src/modules/print-templates/print-templates.service.ts` и `frontend/src/components/repairs/RepairReceiptModal.tsx`: единообразный рендер `malfunctions` + `defect_description` и `package_contents` / `package_contents_items` во всех шаблонах, включая классический наряд и отрывной талон.
  - `frontend/src/lib/repairs/repairs.types.ts` и `frontend/src/app/(dashboard)/repairs/page.tsx`: добавлено `package_contents_items?: string[]` в `EquipmentInfo`, удалён неиспользуемый хардкод `EQUIPMENT_TYPES`.
- **Где ещё используется / потребители:** `RepairsTable.tsx`, `EquipmentRepairHistorySheet.tsx`, `repairs/[id]/print/intake/page.tsx`, `deal-tabs.tsx` — все автоматически получают согласованные данные из единого источника правды.
- **Что осталось:** `defect_photos` просмотр/редактирование в карточке наряда не входило в текущий скоуп (при необходимости можно вынести отдельной задачей).

---

## Унификация печатных форм в карточке наряда («Документооборот и гарантия», Top Bar, `PrintDocumentModal`, 2026-11-21)

- **Root Cause:** В коммите `61253dc` динамические шаблоны `usePrintTemplates({ visibleOnly: true })` внедрили в `RepairsTable.tsx` и `PrintDocumentModal.tsx`, но карточку наряда `repairs/[id]/page.tsx` не перевели: блок «Документооборот и гарантия» вызывал устаревшие клиентские модалки `RepairReceiptModal` и `RepairWorkOrderModal`, Top Bar хардкодил кнопки с перепутанным slug `"receipt"` у «Акт приемки», а `PrintDocumentModal` держал `useState(initialSlug)` без `useEffect`-синхронизации, из-за чего выбранный шаблон залипал между открытиями.
- **Что изменено:**
  - `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`: подключён `usePrintTemplates({ visibleOnly: true })`; блок «Документооборот и гарантия» и Top Bar переведены на динамический список видимых шаблонов тенанта (идентично `RepairsTable`) + кнопка «Настроить бланки» и сохранена кнопка «Счёт на оплату»; клик по любому шаблону открывает `PrintDocumentModal` на выбранном `slug || id`; удалены неиспользуемые клиентские модалки `RepairReceiptModal`/`RepairWorkOrderModal` со страницы карточки.
  - `frontend/src/components/repairs/PrintDocumentModal.tsx`: добавлен `useEffect` синхронизации `selectedSlug` с `initialSlug` при открытии и сопоставление `activeTemplate` по `slug | id | documentType`.
- **Где ещё используется:** `RepairsTable.tsx` (эталон — динамические шаблоны уже работали, правок не требовал), `repairs/page.tsx` (`RepairReceiptModal`/`RepairWorkOrderModal` оставлены только как fallback при пустом списке шаблонов).
- **Что осталось вне скоупа:** серверный рендер `print-templates.service.ts` и `repairs/page.tsx` (работают корректно и согласованы с эталоном).

---

## Склад: редактирование/удаление заявок на закупку и каскадное переименование справочников (2026-11-22)

- **Root Cause:**
  1. На вкладке `/warehouse` → «Заявки на закупку» в таблице отображалась только кнопка «В заказ»; бэкенд `PATCH /warehouse/purchases/:id` принимал только `status`/`comment`, а `DELETE /warehouse/purchases/:id` отсутствовал; хук `useUpdatePurchaseRequest` не инвалидировал `aggregated-purchases`.
  2. В `RepairsService.renameDictionaryItem()` переименование `equipment_brands` не каскадировалось на `warehouse_items.brand`, `repair_orders.equipment_brand` и `device_models.brand` (поэтому `listBrands` продолжал возвращать старое имя из товаров рядом с новым). Для категорий (`warehouse_categories`) при переименовании элемента из `equipment_types` (подмешанного в `EditItemModal`/`CreateItemModal`) UUID не находился в `warehouse_categories`, создавалась новая запись (`INSERT`), а старый элемент оставался в `equipment_types` и товарах. Также `useRenameRepairDictionaryItem` не инвалидировал кэш `["warehouse", "items"]`.
- **Что изменено:**
  - `backend/src/modules/repairs/repairs.service.ts`: в `renameDictionaryItem` и `deleteDictionaryItem` добавлено каскадное обновление/слияние и очистка по `warehouse_categories`, `equipment_types`, `equipment_brands`, `equipment_models`, `warehouse_items`, `repair_orders`, `device_models` (включая поддержку переименования/удаления элементов `equipment_types`, переданных через `category`, и строковых брендов/категорий без UUID).
  - `frontend/src/lib/api/use-repairs.ts`, `DictionarySelectField.tsx`, `EditItemModal.tsx`: добавлена инвалидация `["warehouse", "items"]`, `["warehouse", "models"]`, `repairKeys.all`; добавлен toast при переименовании; защищён `useEffect` инициализации `EditItemModal` от сброса полей формы при рефетче.
  - `backend/src/modules/warehouse/{warehouse.types.ts,warehouse.service.ts,warehouse.routes.ts}`: расширен `PATCH /api/v1/warehouse/purchases/:id` (`item_name`, `sku`, `quantity`, `unit`, `estimated_price`, `status`, `comment`) и добавлен `DELETE /api/v1/warehouse/purchases/:id` (с RLS и `canWrite`).
  - `frontend/src/lib/api/use-warehouse.ts`, `frontend/src/components/warehouse/EditPurchaseRequestModal.tsx`, `frontend/src/app/(dashboard)/warehouse/page.tsx`: добавлены `useDeletePurchaseRequest`, инвалидация `aggregated-purchases`, модалка `EditPurchaseRequestModal` (поддерживает одиночные и агрегированные строки) и кнопки редактирования/удаления в таблице заявок.
- **Где ещё используется:** `CreateItemModal.tsx`, `WarehouseDictionariesModal.tsx`, `RepairIntakeModal.tsx`, `repairs/[id]/page.tsx` — автоматически получают исправленное каскадное переименование и актуальный кэш.

---

## Сквозной партионный учёт себестоимости (FIFO) и интеграция с финансами (2026-11-22)

- **Root Cause:** При приходе партий `warehouse_batches` перезаписывалась единственная `warehouse_items.cost_price` ценой последней партии; оценка склада считалась на клиенте по текущей странице пагинации (`totalStock * lastCostPrice`); `consumePartsForOrder` запускался fire-and-forget без `await` и защиты от повторного списания, списывал партии FIFO, но **не обновлял `repair_parts.cost_price`** и не сохранял разбивку по партиям; `deletePart` не освобождал резерв; `GET /api/v1/finance/pnl` считал только ДДС без списанной партионной себестоимости (COGS); на фронте `PartsTable`, `FinancialSummary` и `ProfitLossView` путали маржу (`profit / retail`) и наценку (`profit / cost`).
- **Что изменено:**
  - Миграция `backend/src/db/migrations/0121_batch_cost_tracking.sql` + `backend/src/db/schema.sql`: добавлены `repair_parts.consumed_at`, `repair_parts.cost_source`, `warehouse_movements.repair_part_id` и RLS-таблица `repair_part_batch_allocations`.
  - `backend/src/modules/warehouse/{warehouse.types.ts,warehouse.service.ts}`: добавлены `fifoCostPrice`, `avgBatchCostPrice`, `stockValuation`, `activeBatchesCount` в `WarehouseItemDTO` и полная серверная оценка склада `meta.totalValuation` / `meta.lowStockCount`; заполнение `batch_id` в `warehouse_reservations` при приходе из заказа поставщику; метод `estimateFifoUnitCost`; атомарный идемпотентный `consumePartsForOrderInTx` с фиксацией партионной разбивки и обновлением `repair_parts.cost_price`.
  - `backend/src/modules/repairs/{repairs.types.ts,repairs.service.ts}`: синхронный вызов `consumePartsForOrderInTx` при выдаче наряда (`issued`) до расчёта итогов; оценка FIFO при `addPart`; освобождение резерва при `deletePart`; возврат `batchAllocations`, `markupPercent`, `marginPercent` в `RepairPartDTO`.
  - `backend/src/modules/finance/{finance.types.ts,finance.service.ts}`: в `GET /api/v1/finance/pnl` добавлен блок `cogs` (выручка по запчастям/работам, партионная себестоимость списаний `warehouse_movements.write_off`, валовая прибыль, наценка %, маржа %, текущая оценка склада и детализация списаний по партиям).
  - Frontend (`warehouse/page.tsx`, `PartsTable.tsx`, `FinancialSummary.tsx`, `ProfitLossView.tsx`, `finance/page.tsx`, `repairs/[id]/page.tsx`, `use-warehouse.ts`, `use-repairs.ts`, `use-invoices.ts`): подключены серверная оценка склада, FIFO-себестоимость, расшифровка партий в наряде, раздельные формулы наценки и маржи, блок «Партионная себестоимость и наценка (FIFO)» в P&L.
- **Что осталось вне скоупа (бизнес-решение):** списание партий при прямой продаже товаров через CRM-сделки (`deal_items` не имеет `cost_price` и списания со склада); переключение метода списания (FIFO vs средневзвешенная vs ручной выбор партии).



---

## Диагностика виджета онлайн-чата и AI-агента vertexsiam (2026-11-22)

- **Root Cause:**
  1. В сделке `dcfd50d8-acf9-4e76-a948-91901557e96f` на обращение посетителя («Здравствуйте, Унитаз не смывает, район раваи...») виджет отправил заглушку «Спасибо за обращение! Мы зафиксировали заявку в CRM...».
  2. В `ai_usage_log` зафиксирована ошибка `Все ключи и резервные модели исчерпали квоты (проверено моделей: gemini-3.5-flash, gemini-flash-lite-latest, gemini-3.1-flash-lite, gemini-3.5-flash-lite, gemini-3.8-flash, gpt-4o-mini, deepseek-v3, gemini-2.5-flash)` с latency 0ms.
  3. Провайдер `prov-openai-mvs2sizy` (apillm.genadich.com) исчерпал баланс (HTTP 402 Insufficient balance), omniroute возвращал 401 Invalid API key. Единственным рабочим ключом оставался единственный Google Gemini ключ (`prov-default`).
  4. При кратковременном спайке 429 от Google API `smart-model-router.ts` добавлял исключение только для конкретной пары `${keyId}:${model}`, после чего в том же запросе в доли секунды циклично опрашивал Google тем же самым ключом по всем fallback-моделям Gemini, усугубляя лимит и мгновенно сжигая все попытки.
  5. `webchat.service.ts` при первом же отказе модели без повторной попытки отправлял шаблонный автоответ виджета.
- **Что изменено:**
  - `backend/src/modules/ai/gateway/smart-model-router.ts`: при получении 429 от провайдеров с общим лимитом на ключ (Google Gemini, Anthropic) ключ исключается глобально на время текущего запроса (`globallyExcludedKeyIds.add`), исключая пустые повторные запросы к тому же исчерпанному ключу.
  - `backend/src/modules/channels/webchat.service.ts`: при статусе `llm_failed` добавлена одна повторная попытка с задержкой 2 секунды перед отправкой операторской заглушки.
  - В `platform_integrations_config` отключён неактивный провайдер с нулевым балансом (`prov-openai-mvs2sizy`).
- **Где ещё используется:** Все каналы виджета онлайн-чата (`webchat`), шлюз LLM (`SmartModelRouter`).





### 2026-11-22 — Wave 4: High-load масштабирование (Redis auth-cache, rate-limit store, SQL-лимиты, SCAN, SSE graceful shutdown), очистка диска VPS и 100% зелёные unit-тесты
- **Root Cause:**
  1. На боевом VPS корневой диск был занят на 82% (76G/99G) из-за 46.8 GB висячих слоёв Docker и временных trace-логов `/tmp/getvoxly-ai-trace.*`.
  2. В `partner.routes.ts` и `gemini-rate-limiter.ts` оставались блокирующие `O(N)` вызовы `redis.keys()`, в `app.ts` присутствовал устаревший `maxParamLength` (Fastify 5 `[FSTDEP022]`), а SSE-потоки не закрывались при `SIGTERM` и держали un-unref'd `setInterval`.
  3. 7 pre-existing unit-тестов backend падали и маскировали реальные баги в продакшн-коде:
     - `agent-reply.ts`: сырые `{{constraints}}`, `{{consultant.name}}`, `{{tenant.name}}` в `MULTI_MESSAGE_INSTRUCTION` попадали в каждый системный промпт; `parseAgentReply` на валидном пустом/числовом JSON (`{"message1":123}`) проваливался в текстовый fallback и мог отправить клиенту `"123"`.
     - `channel-identity.ts`: `analyzePhoneInText` проверял `onlyDigits.length <= 16` без проверки, что текст состоит только из цифр — из-за чего сообщения с телефоном и временем («+7 (926) 555-43-21, звоните после 18:00») склеивали все цифры в 15-значную строку и теряли номер клиента; `validatePhoneCandidate` проверял `isFakeOrDummyPhone` до проверки длины (`too_short`/`too_long`).
  4. Под высокой нагрузкой (100+ RPS, 5000+ записей): `authenticate.ts` выполнял 2 `SELECT` в Postgres на каждый API-запрос, `@fastify/rate-limit` хранил счётчики только в памяти процесса, а `deals.service.ts:listMessages`, `deals.service.ts:kanban` и `contacts-io.service.ts:exportContacts` не имели верхнего `LIMIT`.
- **Что изменено:**
  - **VPS Disk:** очищены dangling Docker images и `/tmp/getvoxly-ai-trace.*` на `150.241.98.135` — освобождено **46.83 GB** (диск `82% → 33%`, 64G свободно).
  - **Redis & Fastify 5 & SSE:** добавлена `deleteKeysByPattern` (неблокирующий `SCAN`) в `backend/src/infrastructure/redis.ts` и применена в `partner.routes.ts`, `gemini-rate-limiter.ts`, `redis-lua-limiter.ts`; удалён устаревший верхнеуровневый `maxParamLength` в `app.ts`; создан `backend/src/infrastructure/sse-registry.ts`, подключён к `chat-stream.routes.ts`, `push-notification.routes.ts` (+ `.unref()` на `pingInterval`) и `server.ts` (`closeAllSseStreams()` перед `app.close()`).
  - **Реальные баги и unit-тесты (7/7 + новый тест):** исправлены `agent-reply.ts` и `channel-identity.ts`, актуализированы `phone-validation.test.ts`, `agent-reply.test.ts`, `incoming-buffer.test.ts`, `bitrix24-connector.test.ts`, `chat-write-first.test.ts`, `media-resolver.test.ts`, `repairs-client-block.test.ts`, добавлен `auth-cache.test.ts`.
  - **High-load (100+ RPS / 5000+ строк):** создан `backend/src/plugins/auth-cache.ts` (Redis TTL 30s, tenant-scoped, fail-open) и подключён в `authenticate.ts` с синхронной инвалидацией во всех точках мутации (`team.service.ts`, `profile.service.ts`, `invite.service.ts`, `marketplace.routes.ts`, `admin-tenants.routes.ts`); подключён Redis store с `skipOnError: true` для `@fastify/rate-limit` в `app.ts`; добавлены безопасные `LIMIT` с обратной совместимостью в `deals.service.ts:listMessages` (500, clamp 1..2000), `deals.service.ts:kanban` (2000, clamp 1..5000) и `contacts-io.service.ts:exportContacts` (25 000).
- **Где ещё используется:** все защищённые API-роуты (`authenticatePlugin`), rate-limiter (`app.ts`), чат и канбан CRM (`deals.service.ts`), экспорт контактов (`contacts-io.service.ts`), AI-пайплайн (`agent-reply.ts`), парсинг телефонов (`channel-identity.ts`), SSE-стримы (`chat-stream`, `push-notification`).


### 2026-11-22 — Интеграция кастомных моделей NoirLight AI (`api.noirlight.pro`), бенчмарк 22 моделей и двусторонняя отказоустойчивая ротация
- **Root Cause & Запрос:**
  1. Пользователь добавил нового кастомного провайдера `https://api.noirlight.pro/v1` с API-ключом `sk-noir-UAwLmhz9aSHp39EIgottWp8AgQYi3R4D1eyfpJ` в админке `https://getvoxly.ru/admin/integrations`.
  2. Вопросы пользователя: какую модель выбрать в выпадающем списке, выбирает ли система лучшую автоматически, включить модели в ротацию для 100% стабильности AI Агента и досконально протестировать все 22 доступные модели.
- **Результаты тестирования 22 моделей:**
  - 🥇 **`agnes-3.0-flash`**: 1435ms, идеальный JSON-вывод (`parseAgentReply`), чистый русский язык, нулевая утечка CoT/рассуждений — **лучший выбор**.
  - 🥈 **`glm-4-flash`**: 3517ms, корректный JSON, надёжная модель Zhipu AI GLM.
  - 🥉 **`qwen-omni-plus`**: 5420ms, валидный JSON, модель Alibaba Qwen.
  - ❌ **`muse`**: HTTP 503 (`Модель временно недоступна`) — модель, на которой был фокус на скриншоте пользователя, в апстриме не работает!
  - ❌ **`llama`**: HTTP 503 (`Модель временно недоступна`).
  - ❌ **`deepseek`**, **`combo`**: HTTP 503 (`no upstream for this model`).
  - ❌ **`nemotron-super`**, **`nemotron-lightning`**, **`kimi-k3.1-pro`**, **`hy4-flash`**: утечка внутренних рассуждений (CoT/system monologue) прямо в ответ пользователю.
  - ❌ **`qwen3.8-27b`**: галлюцинации и системный уклон (обращение «Криптан»).
- **Что изменено:**
  - `backend/src/modules/ai/gateway/model-tier-router.ts`:
    - Добавлены профили `agnes-3.0-flash`, `glm-4-flash`, `qwen-omni-plus`, `qwen-omni-flash`, `laguna`, `glm-4.5`, `glm-5.3` в `MODEL_PROFILES_CATALOG`.
    - Добавлена двусторонняя матрица переключения `HIERARCHICAL_FALLBACK_MATRIX`: модели Google Gemini при спайке 429 переключаются на `agnes-3.0-flash` и `glm-4-flash`; китайские модели кастомного провайдера при сбоях переключаются на соседние и на Gemini; нерабочие модели (`muse`, `llama`, `deepseek`) мгновенно подменяются на `agnes-3.0-flash`.
  - `backend/src/modules/ai/gateway/key-pool-manager.ts` и `smart-model-router.ts`:
    - Добавлено корректное сопоставление провайдера `custom` и провайдеров NoirLight для извлечения ключей и base URL.
  - `frontend/src/lib/ai-bots/ai-bots.types.ts` и `frontend/src/components/admin/AdminIntegrationsEditor.tsx`:
    - Добавлены рекомендуемые модели `agnes-3.0-flash`, `glm-4-flash`, `qwen-omni-plus` в каталог и подсказки админки.
- **Где ещё используется:** AI Gateway (`SmartModelRouter`, `KeyPoolManager`, `ModelTierRouter`), админка интеграций (`AdminIntegrationsEditor`), виджет онлайн-чата (`webchat.service.ts`).


### 2026-11-22 — Прямые продажи в сделках CRM (`deal_items`): FIFO-списание, COGS в P&L и автозаявки на закупку на `/warehouse`
- **Контекст:** По подтверждённым бизнес-правилам `remtoua` метод списания — строго FIFO, одна валюта без выделения НДС, и товары продаются напрямую через сделки CRM (`deal_items`) минуя заказ-наряды СЦ; при отсутствии товара на складе должна формироваться заявка на закупку на `/warehouse`.
- **БД и RLS:** добавлена миграция `backend/src/db/migrations/0122_deal_items_fifo_and_purchases.sql` (синхронизирована в `backend/src/db/schema.sql`):
  - `deal_items`: `cost_price`, `cost_source`, `consumed_at`;
  - `deal_item_batch_allocations` (с RLS `ENABLE/FORCE ROW LEVEL SECURITY` + `tenant_isolation` и индексами);
  - `warehouse_movements`: `deal_id`, `deal_item_id`;
  - `purchase_requests`: `deal_id`, `deal_item_id`.
- **Backend:**
  - `warehouse.service.ts`: добавлены `consumeDealItemsInTx` (атомарное идемпотентное FIFO-списание при закрытии сделки в `won` + автосоздание `purchase_requests` на недостающее количество без дублей) и `fulfillWonDealIfReadyInTx` (автодосписание дефицита закрытой сделки при оприходовании заявки через заказ поставщику или ручной приход); `listPurchaseRequests` / `listAggregatedPurchaseRequests` / `listMovements` теперь включают привязку и отображение сделок CRM (`deal_id`, `deal_title`).
  - `deals.service.ts` / `deals.routes.ts` / `deals.types.ts`: при `moveStage` и `update` в `is_won` стадию вызывается `consumeDealItemsInTx`; `addDealItem` считает прогнозную FIFO-себестоимость и поддерживает флаг `add_to_purchase_request`; `listDealItems` отдаёт `batchAllocations`, `markupPercent`, `marginPercent`, статус заявки.
  - `finance.service.ts`: `pnl()` включает выручку `deal_items` (`item_type = 'product'`) в P&L COGS и отображает сделки в `cogs.breakdown`.
- **Frontend:** обновлены `DealProductsServicesTab.tsx`, `use-deals.ts`, `use-warehouse.ts`, `use-invoices.ts`, `ProfitLossView.tsx`, `warehouse/page.tsx`.


### 2026-11-22 — Сквозной аудит моковых данных и подключение реальных источников (UI -> API -> DB)
- **Контекст & Задача:** Провести полный аудит проекта на предмет «mock vs real data», выявить хардкод-массивы, фикстуры, фейковые ответы и заглушки, проверить связность UI -> API -> БД на боевом сервере и заменить заглушки на реальные данные.
- **Root Cause & Находки:**
  1. `frontend/src/app/(dashboard)/dashboard/page.tsx`: содержал константу `STATS = [...]` с захардкоженными цифрами (24 сделки, 148 контактов, 32 компании, 17 задач) и пустые заглушки без данных («Здесь появится воронка сделок», «Здесь появится список ваших задач»).
  2. `frontend/src/app/(dashboard)/inbox/page.tsx`: в списке каналов фильтрации `CHANNELS` отсутствовал `webchat` («Онлайн-чат»), из-за чего операторы не могли отфильтровать сообщения, приходящие с виджета сайта.
  3. `frontend/src/app/(dashboard)/settings/caller-id/page.tsx`: использовался фиктивный образец токена `companionToken = "voxly_live_device_token_sample"`, который при копировании не позволял авторизовать Android-компаньон.
  4. `frontend/src/app/(admin)/layout.tsx`: ссылка в навигации вела на устаревший дублирующий маршрут `/tenants` вместо `/admin/tenants`.
- **Что изменено:**
  - `frontend/src/app/(dashboard)/dashboard/page.tsx`:
    - Полностью переписан на получение живых данных тенанта: `useDeals({ limit: 5 })`, `useContacts({ limit: 1 })`, `useCompanies({ limit: 1 })`, `useTasks({ limit: 5, status: "todo" })`.
    - Карточки метрик показывают реальное число записей в БД (`total`) и сумму бюджета сделок.
    - Блок «Последние сделки» отображает список последних сделок тенанта с интерактивным переходом в дровер `?record=${id}` и честным `EmptyState`, если сделок нет.
    - Блок «Ближайшие задачи» отображает список реальных задач с чекбоксом выполнения (мутация `useToggleTaskStatus`), дедлайном и бейджем приоритета.
    - Активные модули платформы снабжены прямыми ссылками на разделы.
  - `frontend/src/app/(dashboard)/inbox/page.tsx`: добавлен канал `webchat` («Онлайн-чат») в список фильтров `CHANNELS`.
  - `frontend/src/app/(dashboard)/settings/caller-id/page.tsx`: подключен реальный Bearer-токен текущей сессии через `readAccessToken()`.
  - `frontend/src/app/(admin)/layout.tsx`: навигация переведена на официальный маршрут `/admin/tenants`.
- **Верификация:**
  - Проверена компиляция TypeScript: `tsc --noEmit` во frontend и backend (код 0).
  - Успешный деплой на VPS (150.241.98.135): `vf-deploy GETVOXLY` (код 0).
  - Проверены реальные эндпоинты API Fastify через JWT токен:
    - `/api/v1/crm/deals`: 9 реальных сделок тенанта;
    - `/api/v1/crm/contacts`: 7 реальных контактов;
    - `/api/v1/crm/companies`: 3 реальные компании;
    - `/api/v1/crm/tasks`: 0 открытых задач (корректный EmptyState);
    - `/api/v1/analytics/overview`: реальные агрегации по 7 этапам воронки и 6 месяцам P&L.
  - **Дополнительно выявлено и устранено:**
    - В `frontend/src/lib/api/use-stage-rules.ts` и `use-stories.ts` пути эндпоинтов не содержали префикс `/api/v1/` (`/crm/stage-rules` и `/stories`), что вызывало 404 в разделах «Автоворонки» (`/marketing/funnels`) и «Сторис» (`/marketing/stories`).
    - Пути переведены на канонические `/api/v1/crm/stage-rules` и `/api/v1/stories`, а в Fastify `backend/src/app.ts` добавлены обратные алиасы.
    - Все 242 эндпоинта фронтенда и бэкенда проверены: возвращают корректные HTTP 200 с реальными данными или честными пустыми коллекциями из PostgreSQL.

### 2026-11-22 — Wave 5: P0-фикс WhatsApp 500 (`contact.last_name === null`), закрытие unbounded SQL, RepairStatus `parts_order`, `mask.utils.ts`, `date.utils.ts`, `format.ts` и mobile URLs
- **Root Cause:**
  1. В живых логах продакшна за 12 часов обнаружено 10 падений HTTP 500 на входящем WhatsApp-вебхуке: в `backend/src/modules/crm/crm-pipeline.service.ts:425` (`contact.last_name.toLowerCase().includes("сайта")`) поле `last_name` было типизировано как `string` вместо `string | null`, из-за чего на контактах с `last_name IS NULL` выбрасывался `TypeError` и откатывалась транзакция входящего сообщения; в `contactDisplayName` и `contact-activity.service.ts:317` также возможна была строка `"Имя null"`.
  2. В ряде горячих CRM-сервисов оставались выборки без верхнего `LIMIT` (`contact-activity.service.ts`, `deal-messaging.service.ts:listContactMessages`, `lead-summary.service.ts`, `media-enrichment.service.ts`).
  3. В `RepairsTable.tsx` и `EquipmentRepairHistorySheet.tsx` ветка `switch` не обрабатывала статус `"parts_order"`, а по кодовой базе оставались дубли `mask*` (6 файлов), `toIso` (9 файлов), `formatRub` (7 файлов фронтенда) и 3 устаревших URL `voxly.getvoxly.ru` в `mobile/android-companion/`.
- **Что изменено:**
  - `backend/src/modules/crm/crm-pipeline.service.ts`: `ExistingContact.first_name`/`last_name` типизированы как `string | null`; все проверки (`L420-440`, `L631-675`, `L862`, `contactDisplayName`) переведены на null-safe операции без `"null"`-артефактов; добавлен регрессионный тест `backend/src/tests/crm-pipeline-null-safety.test.ts`.
  - Unbounded SQL: добавлены защитные `LIMIT` в `contact-activity.service.ts` (`deals` 200, `deal_messages` 1000 в хронологическом `ASC`, `notes` 500 + null-safe `authorName`), `deal-messaging.service.ts:listContactMessages` (500, clamp 1..2000), `lead-summary.service.ts` (300) и `media-enrichment.service.ts` (200).
  - Дедупликация и контракты: создан `backend/src/lib/mask.utils.ts` (6 модулей переведены с реэкспортом); добавлен `toIsoOrNow` в `backend/src/lib/date.utils.ts` и переведены все 9 оставшихся локальных копий `toIso()`; добавлен `case "parts_order"` в `RepairsTable.tsx` и `EquipmentRepairHistorySheet.tsx`; создан `frontend/src/lib/utils/format.ts` (переведены 7 копий `formatRub`); обновлены 3 ссылки `voxly.getvoxly.ru` → `getvoxly.ru` в `mobile/android-companion/`.
- **Где ещё используется:** все входящие каналы через `CrmPipelineService` (WhatsApp, Telegram, MAX, webchat), таймлайн контакта/сделки, AI-саммари, маскирование логов/API-ключей, таблицы СЦ и склада.

### 2026-11-22 — Wave 6: Реализация редактирования и построчного удаления финансовых операций (PATCH /transactions/:id, EditTransactionModal, inline actions)
- **Root Cause:**
  1. В `TransactionsTable.tsx` отсутствовала колонка действий в строке: удаление операций было спрятано за выбором чекбокса в мультиселекте (всплывающая плавающая панель `bulkBar`), что делало функционал неочевидным.
  2. Функционал редактирования операции (сумма, счёт, категория, описание, контрагент, дата) отсутствовал целиком — ни в Fastify API (`/transactions/:id`), ни в UI фронтенда не было роута, мутации и формы для редактирования транзакции.
- **Что изменено:**
  - `backend/src/modules/finance/finance.types.ts`: добавлена схема `updateTransactionSchema` и тип `UpdateTransactionPayload`.
  - `backend/src/modules/finance/finance.service.ts`: реализован метод `updateTransaction(tenantId, id, payload)` с транзакционной блокировкой `FOR UPDATE`, корректной дельтой отката баланса старого счёта/типа и применения к новому счёту/типу.
  - `backend/src/modules/finance/finance.routes.ts`: зарегистрирован эндпоинт `PATCH /transactions/:id`.
  - `frontend/src/schemas/finance.schema.ts`: добавлена Zod-схема `updateTransactionSchema`.
  - `frontend/src/lib/api/use-invoices.ts`: добавлена мутация `useUpdateTransaction()`, реэкспортирована `useDeleteTransaction()`.
  - `frontend/src/components/finance/EditTransactionModal.tsx`: создана боковая шторка (Twenty CRM Sheet) с предзаполнением всех параметров операции, автопересчётом категорий, валидацией и кнопкой быстрого удаления.
  - `frontend/src/components/finance/TransactionsTable.tsx`: добавлена колонка действий с кнопками «Редактировать» (Pencil) и «Удалить» (Trash2), поддержка клика по строке (`onRowClick`), диалог подтверждения удаления одиночной операции с автоматическим пересчётом балансов.
- **Где ещё используется:** страница `/finance`, счета `cash_accounts`, аналитика ДДС и P&L.
### 2026-11-22 — Исправление пайплайна серверных конверсий и офлайн-атрибуции в Яндекс Метрику
- **Контекст & Задача:** В Яндекс Метрике для подключенного счетчика 114153352 (сайт maps3455.pro) цели lead, purchase, chat отображали «Нет данных по цели». Требовалось найти и устранить причину сбоя доставки серверных конверсий на тенанте kk-crm (`713552dc-dfa2-4521-b733-5c98d2c8dd1c`) и по всей платформе.
- **Root Cause & Находки:**
  1. `conversion-dispatcher.service.ts`: при обновлении `conversion_delivery_attempts` в SQL запросе UPDATE отсутствовал параметр `$2` в строке запроса (были `$3, $4, $5, $6, $7, $8`), из-за чего PostgreSQL возвращал фатальную ошибку `could not determine data type of parameter $2` (код 42P18) и откатывал транзакцию.
  2. `conversion_delivery_attempts`: нарушение CHECK-констрейнта `conversion_delivery_attempts_provider_check` из-за передачи ненормализованного провайдера (`yandex_metrika` вместо канонического `yandex`).
  3. `yandex-conversion.provider.ts`: формат CSV и таймстемп в Offline Conversions API приводил к ошибке HTTP 400 из-за рассинхронизации часов (локальное время сервера опережало сервер Яндекса, либо пустая цена при указании валюты RUB). Также отсутствовал фоллбэк на `client_id_type=YCLID`.
  4. `conversion-dispatcher.service.ts`: атрибуция искалась только в корневых полях `sourceMetadata.ym_client_id`, тогда как виджет и чаты сохраняют метрики в `sourceMetadata.analytics.ymUid`, `sourceMetadata.clickIds.yclid` и `sourceMetadata.page.url`.
  5. `deals.service.ts`: при смене этапа сделки через `update` не вызывался `notifyDealStageChanged`.
- **Что изменено:**
  - `backend/src/modules/analytics/providers/yandex-conversion.provider.ts`:
    - Исправлен формат CSV: при нулевой цене валюта не передается; безопасный сдвиг таймстемпа (-60 сек от текущего времени или время создания сделки);
    - Добавлена поддержка `client_id_type=YCLID` и колонки `Yclid` при отсутствии `ClientId`;
    - Заменена заглушка mc.yandex.ru на прямую валидацию через Management API и Offline Upload;
  - `backend/src/modules/analytics/conversion-dispatcher.service.ts`:
    - Добавлен комплексный хелпер `extractAttribution`, собирающий `ymUid`, `yclid`, `clientId`, `sourceUrl` из всех вложенных структур метаданных;
    - Исправлены SQL запросы INSERT и UPDATE: приведение типов `$2::uuid`, использование `canonical` провайдера (`yandex`), исправление соответствия параметров `$1..$7`;
    - Реализован `handleDealCreatedDirect` для синхронной досылки конверсий;
  - `backend/src/modules/crm/deals/deals.service.ts`:
    - В метод `update` добавлен вызов `notifyDealStageChanged` при смене этапа;
  - `backend/src/modules/analytics/analytics-integrations.service.ts` & `analytics.routes.ts`:
    - Добавлены эндпоинты `POST /integrations/replay` и `GET /integrations/attempts`;
  - `frontend/src/lib/api/use-analytics-integrations.ts` & `ServerConversionIntegrationsView.tsx`:
    - Добавлена кнопка «Синхронизировать сделки» с информированием о результатах;
    - Добавлен живой «Журнал отправки серверных конверсий» со статусами, кодами ответов и сниппетами.
- **Верификация:**
  - Проверена строгая компиляция TypeScript и сборка Next.js 15 (код 0).
  - Деплой на боевой VPS (150.241.98.135) через `/usr/local/bin/vf-deploy GETVOXLY`.
  - Проведена синхронизация сделок тенанта kk-crm, проверена успешная загрузка в Яндекс Метрику (Upload ID получен, HTTP 200).


### 2026-11-22 — Мультивыбор, редактирование и транзакционное каскадное удаление на вкладках `/warehouse`
- **Проблема:** На вкладках «Партии и приходные накладные» (`batches`), «Заказы поставщикам» (`supplier_orders`, особенно в статусе `received`) и «Журнал движений» (`movements`) отсутствовали чекбоксы мультивыбора, панель массового удаления и кнопки редактирования/удаления; на вкладке «Заявки на закупку» (`purchases`) не было массового удаления.
- **БД и RLS:** добавлена миграция `backend/src/db/migrations/0123_warehouse_batch_supplier_order_link.sql` (+ синхронизация `schema.sql`): прямая ссылка `warehouse_batches.supplier_order_id -> supplier_orders(id) ON DELETE SET NULL` с бэкфиллом существующих партий.
- **Backend (`warehouse.service.ts`, `warehouse.routes.ts`, `warehouse.types.ts`):**
  - `PATCH/DELETE /batches/:id`, `POST /batches/bulk-delete` — редактирование партии с синхронизацией `warehouse_movements` и аллокаций FIFO (`repair_part_batch_allocations`, `deal_item_batch_allocations`), каскадное удаление без orphan-движений/резервов и пересчёт `repair_parts`, `deal_items`, `warehouse_items`.
  - `PATCH /supplier-orders/:id` (разрешено редактирование поставщика/примечаний даже для `received` с синхронизацией партий и кассовой проводки), `DELETE /supplier-orders/:id` и `POST /supplier-orders/bulk-delete` — поддерживают полный транзакционный откат оприходованных заказов (`received`): каскадно откатывают созданные партии, движения, резервы, возвращают `purchase_requests` в `pending` и возвращают точную сумму кассовой проводки на баланс `cash_accounts`.
  - `PATCH/DELETE /movements/:id`, `POST /movements/bulk-delete` — редактирование и удаление движений с откатом их влияния на остатки партий (`intake`/`write_off`), `warehouse_reservations` (`reserve`) и FIFO-аллокации.
  - `POST /purchases/bulk-delete` — массовое удаление заявок с очисткой ссылок в `supplier_order_items` (`purchase_request_id` и массив `purchase_request_ids`).
- **Frontend:** обновлены `warehouse/page.tsx`, `use-warehouse.ts`, `EditSupplierOrderModal.tsx`, `SupplierOrderDetailModal.tsx`, добавлены `EditBatchModal.tsx` и `EditMovementModal.tsx`; убраны emoji `🔒`/`🔓` из журнала движений (заменены на Lucide `Lock`/`Unlock`).


### 2026-11-23 — Фикс `Unexpected response shape from API`, принудительное удаление товаров и сквозное логирование действий пользователей
- **Root cause (`Unexpected response shape from API`):** `DELETE /api/v1/warehouse/items/:id` и `DELETE /api/v1/warehouse/supplier-orders/:id` (а также `deals/:id/items/:itemId`, `finance` delete-роуты, `services/:id`, `print-templates/:id`) возвращали `{ success: true }` без обязательного конверта `{ data: ... }`. Бэкенд реально удалял запись (HTTP 200), но `apiClient.ts` бросал `MALFORMED_RESPONSE`, из-за чего `onSuccess` не инвалидировал кэш и UI показывал ошибку при уже удалённой записи.
- **Root cause (нельзя удалить товар с остатком):** на фронтенде (`warehouse/page.tsx`) и в `bulkDeleteItems` стояла жёсткая блокировка `totalStock > 0 || reservedStock > 0` без опции принудительного каскадного удаления.
- **Исправлено:**
  - Все указанные роуты возвращают стандартный конверт `{ data: ... }` (с обратной совместимостью по верхнеуровневым полям); `useDeleteWarehouseItem`, `useBulkDeleteWarehouseItems`, `useDeleteSupplierOrder` инвалидируют `warehouseKeys.all`.
  - В `deleteItem` (`?force=true`) и `bulkDeleteItems` (`force: true`) реализовано транзакционное каскадное удаление товара вместе с партиями (`deleteBatchesInTx`), резервами и движениями; на UI добавлен явный `confirm` с предупреждением вместо жёсткого запрета.
  - **Глобальный аудит действий пользователей и ошибок:** создан `backend/src/lib/audit-log.service.ts` + миграция `0124_tenant_audit_log_indexes.sql`; Fastify `onResponse` (`app.ts`) + `errorHandler.ts` неблокирующе логируют все мутации (`POST`/`PUT`/`PATCH`/`DELETE`) и ошибки (`statusCode >= 400`) в `tenant_audit_log` (с маскированием секретов); добавлены `GET /api/v1/tenant/audit-log` и `POST /api/v1/tenant/audit-log/client-error`, а `apiClient.ts` репортит клиентские `MALFORMED_RESPONSE` ошибки.


### 2026-11-23 — Баланс счетов строго из операций (устранение «фантомных» остатков на `/finance`)
- **Root cause:** `FinanceService.createAccount` записывал `opening_balance` прямо в `cash_accounts.balance` без создания приходной операции в `transactions`. В результате после удаления всех операций на счёте «Т-Банк Расчетный счет» тенанта `voxly` оставалось 150 000 ₽ без единой операции.
- **Исправлено:**
  - `backend/src/modules/finance/finance.service.ts`: при создании счёта с `opening_balance > 0` в той же транзакции создаётся приходная операция «Начальный остаток» в `transactions`; `accounts()` вычисляет баланс напрямую как `SUM(income) - SUM(expense)` по активным операциям (`deleted_at IS NULL`); все мутации операций вызывают `recalculateAccountBalanceInTx`.
  - Миграция `backend/src/db/migrations/0125_reconcile_cash_accounts_balance.sql`: пересчитала `cash_accounts.balance` строго из активных операций (у `voxly` расчётный счёт синхронизирован до `0 ₽`).
  - `frontend/src/lib/api/use-invoices.ts` (`useCreateAccount` инвалидирует `financeKeys.all`) и `CreateAccountModal.tsx` (подсказка про создание операции «Начальный остаток»).


### 2026-11-23 — Улучшение сканирования сайтов, обработка sitemap index, семантическое структурирование и RAG-черновики
- **Root Cause & Запрос:**
  1. Пользователь обратился по агенту `66150148-ccd0-4998-910c-1524601c998e` (те store `remtoua`) с задачей проверить функционал сканирования всего сайта, обработку и систематизацию информации, чтобы человек точно понимал, что именно использует AI Агент, и провести полное сканирование сайта `https://xn----itbblsceccdthmkeen.xn--p1ai/` (`ремонт-инструмент.рф`).
  2. В `site-crawler.ts`:
     - `fetchSitemapUrls` отбрасывал `.xml` из-за `FORBIDDEN_EXTENSIONS.has("xml")`, не обрабатывал `<sitemapindex>` (на WordPress/WooCommerce дочерние карты `page-sitemap.xml`, `product-sitemap.xml`, `category-sitemap.xml` полностью игнорировались, краулер находил 0 ссылок из sitemap).
     - Отсутствовала приоритизация URL: в очередь попадали мусорные ссылки (`/my-account/`, `?add-to-cart=...`, `/cart/`), дублируя страницы.
     - `cleanHtmlToMarkdown` вызывался без `stripLayoutChrome: true`, из-за чего в каждую страницу попадал весь навигационный шум («Перейти к навигации», «Корзина», дублирующиеся кнопки).
  3. В `knowledge-base.queue.ts`:
     - Скачанные страницы сохранялись в категории `general` вместо `site`.
     - Заголовки документов были неформатированными и неудобными для человека (`Сайт [/arenda...]: ...`), а текст представлял собой сырой сброс без метаданных.
  4. На фронтенде (`AgentKnowledgeTab.tsx`):
     - `useCrawlStatus` был реализован, но не вызывался: пользователь не видел статус и прогресс сканирования, а toast ошибочно показывал «обработано 0, добавлено 0».
- **Что изменено:**
  - `backend/src/modules/ai/html-cleaner.ts`: добавлены правила очистки доступности (`skip-link`, `screen-reader-text`), top-bar, mini-cart drawers, cookie notice, согласий на обработку ПДн и расширен `NOISE_LINE_REGEX`.
  - `backend/src/modules/ai/site-crawler.ts`:
    - Реализована рекурсивная поддержка `<sitemapindex>` с приоритизацией дочерних карт (`page-`, `category-`, `service-`, `post-`).
    - Добавлен фильтр мусорных путей (`/my-account`, `/cart`, `/checkout`, `/wishlist`, `?add-to-cart=`, `?orderby=`, `?removed_item=`).
    - Реализована функция взвешивания приоритета страниц `getUrlPriority`: услуги, аренда, прайсы, контакты и гарантии обходятся первыми.
    - Включена обязательная глубокая очистка layout chrome в `htmlToText`.
    - Добавлена дедупликация URL по нормализованному пути (`normKey`), исключающая дублирование одной и той же страницы с разными query-параметрами.
  - `backend/src/modules/ai/knowledge-base.queue.ts`:
    - Документы сохраняются с понятным человеку заголовком: `[Сайт] ${cleanTitle} (${path})`.
    - Категория устанавливается в `"site"`.
    - Текст снабжается структурированным заголовком и метаданными источника.
  - `frontend/src/components/ai-bots/AgentKnowledgeTab.tsx`:
    - Подключён хук `useCrawlStatus` с живым баннером процесса сканирования и уведомлением об ошибке.
    - Исправлен toast при запуске краулера.
    - Обновлён `isDocInCategory` для поддержки кириллической зоны `.рф` и маркера `[Сайт]`.
- **Где ещё используется:** База знаний AI-агентов (`KnowledgeBaseService`), RAG-пайплайн (`agent-pipeline.service.ts`), шторка проверки документов (`EditDocumentSheet.tsx`, `PageBlockEditor.tsx`).
### 2026-11-23 — Отправка MAX при нескольких подключённых аккаунтах и выход контекстного меню чата за экран
- **Root cause (MAX не отправлялся в сделке `a65dc0a4-...` у `remtoua`):**
  - У тенанта `remtoua` подключено 2 аккаунта MAX: `98074187-f686-4514-b882-580d1854f4d3` (`79918829870 (Ремонт Инструмент)`, живая сессия) и `021eb35f-2fd8-488c-bd64-6e14abfba252` (`79776282049 (Ремонт)`, пустая таблица `sessions` в `web.db` — сессия истекла/сброшена).
  - В `max-bridge` (`_restore_bot`) проверялось только наличие файла `*.db`, без проверки наличия токена в таблице `sessions`. При отправке через `021eb35f-...` PyMax запускал фоновую QR-авторизацию и зависал на 60–180 с, из-за чего бэкенд обрывался по 30-секундному таймауту с вводящей в заблуждение ошибкой «Сервис max-bridge недоступен... Убедитесь, что контейнер max-bridge запущен».
  - В БД `channel_accounts` оба аккаунта оставались в `status = 'connected'`, а `getSendFromOptions` не проверял живые сессии в `max-bridge`.
- **Root cause (контекстное меню не влезает в экран):**
  - В `frontend/src/components/crm/shared/TelegramComposer.tsx` основное меню позиционировалось по фиксированным эвристикам (`window.innerHeight - 380`), а подменю «Форматирование» имело жёсткое `absolute left-full top-[-80px]` без проверки границ viewport — в нижней части шторки сделки оно уходило за нижний и правый края экрана.
- **Исправлено:**
  - `max-bridge` (`/voxly/apps/max-bridge/src/main.py`, закоммичено в `voxly-max-bridge:latest`): `_restore_bot` проверяет наличие непустого `token` в SQLite `web.db` перед запуском PyMax (отсекает 180-секундное зависание в невидимом QR-цикле); `_ensure_live_client` возвращает HTTP 401 с понятным русским сообщением; `GET /health` отдаёт `liveBotIds`.
  - `backend/src/modules/channels/max-bridge.service.ts`: добавлены `getLiveBotIds()` (с кэшем 10 с), `invalidateMaxBridgeLiveBotsCache()`, `isMaxSessionExpiredError()`, отдельная обработка таймаутов (`504 MAX_BRIDGE_TIMEOUT`).
  - `backend/src/modules/messaging/adapters/max/MaxBridgeAdapter.ts`: при истекшей сессии помечает конкретный аккаунт `channel_accounts` в `status = 'error'` и возвращает ошибку с указанием имени аккаунта.
  - `backend/src/modules/crm/deals/deal-messaging.service.ts`: `getSendFromOptions`, `getContactSendFromOptions` и `resolveRoute` учитывают живые сессии `max-bridge`, помечают истёкшие MAX-аккаунты недоступными с причиной и автоматически выбирают рабочий аккаунт MAX по умолчанию.
  - `frontend/src/components/crm/shared/TelegramComposer.tsx`: контекстное меню и подменю «Форматирование» перенесены в `createPortal(..., document.body)` с динамическим измерением `getBoundingClientRect()` в `useLayoutEffect`, автофлипом подменю влево при нехватке места справа, прижатием к границам viewport (`8px` отступ) и `max-h-[calc(100vh-16px)] overflow-y-auto`.
  - `frontend/src/components/crm/shared/CrmChatView.tsx`: автопереключение с недоступного аккаунта в «Пишем от:» и тултип полного названия аккаунта.


### 2026-11-23 — Мультивыбор, массовое редактирование/удаление и строчные действия на вкладке «Счета» (`/finance`)
- **Проблема:** на странице `/finance` во вкладке «Счета» (`invoices`) отсутствовали чекбоксы мультивыбора, панель массовых действий и кнопки редактирования/удаления в строках (отображалась только стрелка `→`).
- **Backend (`finance.types.ts`, `invoices.service.ts`, `invoices.routes.ts`):**
  - Добавлены транзакционные эндпоинты `POST /api/v1/invoices/bulk-update` (статус, срок оплаты, примечание) и `POST /api/v1/invoices/bulk-delete` (soft delete с очисткой `invoice_repair_orders` и возвратом `repair_orders.payment_status = 'unpaid'` при отсутствии других активных счетов). Оплаченные счета (`paid`) защищены от изменения и удаления.
- **Frontend (`use-invoices.ts`, `BulkEditInvoicesModal.tsx`, `finance/page.tsx`):**
  - Добавлены хуки `useBulkUpdateInvoices` и `useBulkDeleteInvoices`.
  - Создана правая шторка `BulkEditInvoicesModal.tsx` для массового редактирования выбранных счетов.
  - В `RecordTable` на вкладке «Счета» включён мультивыбор (`selectable`, `selectedIds`, `bulkBar` с кнопками «Редактировать» и «Удалить»), добавлена колонка `row_actions` с иконками редактирования (`Pencil` → `InvoiceEditModal`), удаления (`Trash2` → `ConfirmDialog`) и открытия (`ArrowRight` → `InvoiceViewModal`).

### 2026-11-23 — Автоматическая синхронизация расчётного счёта организации с карточками счетов на `/finance`
- **Root cause:** заполнение банковских реквизитов (`bank_name`, `settlement_account`) на вкладке «Организация» (`finance_organizations`) не создавало и не обновляло безналичный счёт (`account_type = 'bank'`) в `cash_accounts`, из-за чего на главной странице `/finance` отображалась только «Основная касса (Наличные)» без карточки расчётного счёта.
- **БД и миграция:** добавлена `backend/src/db/migrations/0126_cash_accounts_organization_sync.sql` (+ `schema.sql`): колонки `organization_id` и `account_number` в `cash_accounts`, индекс `idx_cash_accounts_org_id` и идемпотентный бэкфилл расчётных счетов для всех организаций с заполненными банковскими реквизитами (включая `remtoua` — `ООО "ОЗОН Банк" г Москва`, `р/с 40802810700000071091`).
- **Backend:** `FinanceOrganizationsService.create`/`update` транзакционно синхронизируют `cash_accounts` через `syncOrganizationBankAccountInTx`; `FinanceService.accounts()` возвращает `accountNumber` и `organizationId`.
- **Frontend:** `useCreateFinanceOrganization` / `useUpdateFinanceOrganization` инвалидируют `financeKeys.all`; `BalanceCards.tsx` показывает иконки и бейджи типов счетов (`Расчётный счёт`, `Наличные`, `Эквайринг`, `Сейф`), номер `р/с` и кнопку «Добавить кассу / р/с» (`CreateAccountModal` подключён в `finance/page.tsx`).

### 2026-11-23 — Подстановка консультанта из онлайн-чата и устранение дефолтного имени «Алексей»
- **Проблема:** У AI-агента (`/modules/ai-bots/[id]`) в переменных выбран источник консультанта «Из настроек онлайн-чата», но в карточках переменных и в промпте подставлялось имя «Алексей» и должность «ведущий специалист» вместо имени консультанта из виджета сайта (например, «Егор», «Онлайн-консультант»).
- **Root cause:**
  1. `frontend/src/app/(dashboard)/modules/ai-bots/[id]/page.tsx`: вычисление `effectiveConsultant` и `effectiveRole` проверяло `bot.consultant_name` («Алексей» из пресета) раньше, чем `fromApi["consultant.name"]`, и не проверяло `consultant_source === "chat_widget"`.
  2. `backend/src/modules/ai/ai.routes.ts` (`handlePromptPreview`): в SQL-запросе не выбиралось поле `consultant_source`, а эндпоинт генерации превью переменных полностью игнорировал источник «chat_widget» и возвращал статичные значения из колонок агента.
  3. `backend/src/modules/ai/agent-pipeline.service.ts`:
     - В `prepareReply`: при отсутствии `channelAccountId` или сообщении из стороннего канала (Telegram/WhatsApp) при выбранном источнике виджета не выполнялся поиск подключённого веб-виджета тенанта (`channel_accounts WHERE channel = 'webchat'`), а происходил откат к `agent.consultant_name`.
     - В `generateTestReply`: тестовый чат не проверял `consultant_source` и всегда брал `agent.consultant_name`.
  4. `frontend/src/components/ai-bots/BotModal.tsx`:
     - При переключении источника консультанта форма не сбрасывала и не синхронизировала имя с виджетом;
     - `applyPreset` перезаписывал имя и роль значениями из пресета даже при активном `chat_widget`;
     - В UI модалки отсутствовало отображение текущего имени из подключенного виджета онлайн-чата.
  5. `backend/src/modules/ai/agent-reply.ts` и `ai.service.ts`: в `SAFE_DEFAULTS` и генераторе промптов дефолтное имя было захардкожено как `"Алексей"`.
- **Исправлено:**
  - `backend/src/modules/ai/ai.routes.ts`: `handlePromptPreview` учитывает `consultant_source` (из body или из БД/wizard_config), динамически извлекает `consultantName`/`botName` и `consultantRole`/`title` из `channel_accounts` (`webchat`) и возвращает актуальные `consultant.name` и `consultant.role`.
  - `backend/src/modules/ai/agent-pipeline.service.ts`: в `prepareReply` и `generateTestReply` при `isWidgetSource` выполняется поиск настроек основного виджета `webchat` тенанта.
  - `backend/src/modules/ai/ai.service.ts`: `updateAgent` синхронизирует `consultantSource`, `consultantName` и `consultantRole` в `wizard_config`; `generatePrompt` подтягивает имя из виджета чата тенанта; `SAFE_DEFAULTS` использует нейтральное `"Консультант"`.
  - `frontend/src/app/(dashboard)/modules/ai-bots/[id]/page.tsx`: переменные `effectiveConsultant` и `effectiveRole` при `isWidgetSource` приоритетно берут данные из API виджета чата; на карточках переменных добавлен визуальный бейдж («Из настроек онлайн-чата» / «Указано вручную») и поясняющая подсказка.
  - `frontend/src/components/ai-bots/BotModal.tsx`: подключён `useChannelAccounts("webchat")`; в модалке выводится блок с текущими настройками подключенного виджета; `applyPreset` сохраняет режим виджета; при сохранении формы синхронизируются имя и роль из виджета.
- **Где ещё используется:** База AI-агентов (`ai_agents`), визард настройки ботов (`BotModal`), страница агента (`/modules/ai-bots/[id]`), рантайм-пайплайн (`agent-pipeline.service.ts`), интеграция онлайн-чата (`webchat.service.ts`).


### 2026-11-23 — Снятие блокировок смены статуса наряда (`Diagnostics are required before requesting approval` и матрица переходов)
- **Root cause (наряд `08ac2171-...` / `№0021` у `remtoua`):**
  1. При клике на статус «Согласование» (`approval`) в степпере наряда `RepairsService.changeStatus` бросал `ValidationError("Diagnostics are required before requesting approval")`, требуя заполненное JSONB-поле `diagnostics` (`findings`, `recommended_action`), хотя во фронтенде нет формы ввода `diagnostics` и все статусы в `RepairStatusStepper` переключаются прямым кликом.
  2. В `ALLOWED_TRANSITIONS` (`backend/src/modules/repairs/repairs.types.ts`) отсутствовала часть прямых и обратных переходов между этапами степпера (например, `waiting_parts -> in_progress / approval / diagnostics`, `diagnostics -> in_progress`, `intake -> approval`, `in_progress -> approval`).
- **Исправлено:**
  - `backend/src/modules/repairs/repairs.service.ts`: удалена жёсткая проверка обязательности `diagnostics` при переходе в `approval` (опциональное сохранение `payload.diagnostics` при передаче через API сохранено).
  - `backend/src/modules/repairs/repairs.types.ts`: разрешены переходы между всеми рабочими статусами степпера (`intake`, `diagnostics`, `approval`, `waiting_parts`, `parts_order`, `in_progress`, `ready`, `issued`, `rejected`).


### 2026-11-23 — Автообогащение контактов мессенджерами при приёмке ремонта и создании сделки (+ multi-MAX фоллбэк)
- **Root cause (сделка `a65dc0a4-...` / контакт `Николай` `+79015013097` у `remtoua` не были обогащены):**
  1. Контакт и сделка создавались через пакетную приёмку ремонта (`RepairsService.createBatch`), где, как и в `RepairsService.create` и `DealsService.create`, вообще не вызывался `CrmEnrichmentService.enrichContact` — `contacts.custom_fields` оставался пустым `{}`.
  2. `CrmEnrichmentService.enrichContact` не оборачивал запросы в `runWithTenantContext(tenantId, ...)`, из-за чего фоновые вызовы вне ALS-контекста могли блокироваться RLS.
  3. `CrmEnrichmentService.defaultMaxProvider` брал только один MAX-аккаунт (`ORDER BY connected_at DESC LIMIT 1`), без перебора остальных подключённых аккаунтов при истекшей сессии первого.
- **Исправлено:**
  - `backend/src/modules/crm/enrichment.service.ts`: `enrichContact` выполняется внутри `runWithTenantContext(tenantId, ...)`, добавлен флаг `skipIfAlreadyChecked`, а `defaultMaxProvider` приоритизирует живые сессии `MaxBridgeService.getLiveBotIds()` и перебирает все подключённые MAX-аккаунты.
  - `backend/src/modules/repairs/repairs.service.ts` (`create`, `createBatch`) и `backend/src/modules/crm/deals/deals.service.ts` (`create`): после коммита транзакции запускают фоновое `CrmEnrichmentService.enrichContact(..., { dealId, skipIfAlreadyChecked: true })`.
  - Обогащение контакта `6b145b3e-cf77-458d-8c80-33aedf5f72a1` (сделка `a65dc0a4-...`) запущено и проверено вживую на проде.


### 2026-11-23 — Синхронизация истории чата по всем подключённым аккаунтам MAX/Telegram/WhatsApp и защита от скрытия отправленных сообщений при дедупликации
- **Root cause (кнопка «Синхронизировать» в карточке контакта `6b145b3e-...` / сделке `a65dc0a4-...` не подтягивала переписку MAX):**
  1. `DealMessagingService.syncDealChatHistory` выбирал только ОДИН MAX-аккаунт (`LIMIT 1`), из-за чего переписка клиента (`chatId: 209608766`, 9 сообщений) на втором подключённом MAX-аккаунте (`79776282049`) вообще не опрашивалась.
  2. `syncMaxDialogHistory` запрашивал лишь `dialogLimit: 20` и не использовал `userId` из `contacts.custom_fields.enrichment.channels.max.userId`, а также блокировал дедупликацией строки со статусом `delivery_status = 'failed'`.
  3. В `CrmChatView.tsx` клиентская дедупликация по совпадению текста скрывала успешно отправленный повтор (`sent`), оставляя в окне чата только предыдущую сбойную попытку (`failed`).
- **Исправлено:**
  - `backend/src/modules/crm/deals/deal-messaging.service.ts`: `syncDealChatHistory` перебирает все подключённые аккаунты MAX, Telegram и WhatsApp с изоляцией ошибок по каждому аккаунту и передаёт `enrichedMaxUserId` и `max_chat_id`.
  - `backend/src/modules/channels/max-integration.routes.ts`: `dialogLimit` увеличен до 80, добавлена поддержка медиасообщений без текста и исключены `delivery_status = 'failed'` из дедупликации.
  - `frontend/src/components/crm/shared/CrmChatView.tsx`: сообщения со статусом `failed` исключены из текстовой дедупликации, чтобы не скрывать успешно доставленные сообщения.


### 2026-11-23 — Сервисный центр и счета: PDF/отправка в мессенджеры, защита несохранённых данных, быстрая кнопка «Оплачен» и фильтр «В работе»
- **Root causes:**
  1. `GET /api/v1/invoices/:id/pdf` падал с `Invalid character in header content ["content-disposition"]` из-за кириллицы (`Счёт_СЧ-2026-0006.pdf`) в заголовке без RFC 5987 кодирования; `InvoicesService.sendToMessenger` был сломанной заглушкой (не генерировал PDF и вставлял в несуществующие колонки БД); меню «Отправить» обрезалось из-за `overflow-hidden` контейнера.
  2. На вкладке «Работы и запчасти» и в шторке приёмки (`RepairIntakeModal`) не было перехвата ухода/закрытия при несохранённом черновике позиции (без нажатия `+`) или заполненных полях приёмки.
  3. Вкладка «Финансы» в карточке наряда была зажата `max-w-3xl`, из-за чего строки блока «Счета на оплату» ломались и не было 1-клик оплаты счёта.
  4. На `/repairs` отсутствовал быстрый фильтр «В работе» (все наряды, кроме «Выдан»).
- **Исправлено:**
  - `backend/src/modules/finance/invoices.routes.ts`, `invoices.service.ts`, `finance.types.ts`: RFC 5987 `Content-Disposition` для PDF; полноценная генерация PDF и отправка вложения через `ChatMediaService` + `DealMessagingService`/`resolveOutboundSender` (MAX, Telegram, WhatsApp, all); опциональный `account_id` в `markPaid` с автоподбором счёта и обновлением статуса оплаты связанных нарядов (`repair_orders` и `invoice_repair_orders`).
  - `backend/src/modules/repairs/repairs.routes.ts`, `repairs.service.ts`, `frontend/src/lib/repairs/repairs.types.ts`, `frontend/src/lib/api/use-repairs.ts`, `frontend/src/components/repairs/RepairsTable.tsx`: добавлен фильтр «В работе» (`status=active` -> `ro.status <> 'issued'`), совместимый с фильтром «Оплата».
  - `frontend/src/components/repairs/detail/FinancialSummary.tsx`, `frontend/src/lib/api/use-invoices.ts`: портальное меню «Отправить» (`createPortal(..., document.body)`, `z-[9999]`, MAX/Telegram/WhatsApp/Все с PDF), быстрая кнопка «Оплачен», расширенная вёрстка строк счёта.
  - `frontend/src/components/repairs/detail/WorkItemsTable.tsx`, `PartsTable.tsx`, `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`: расширен контейнер вкладки «Финансы» (`max-w-6xl`), добавлен перехват смены вкладок, «Назад» и `beforeunload` с `ConfirmDialog` при несохранённом черновике работы/запчасти.
  - `frontend/src/components/repairs/RepairIntakeModal.tsx`, `frontend/src/components/shared/ConfirmDialog.tsx`: `z-[70]` для `ConfirmDialog` поверх `Sheet`, перехват закрытия (`X`, «Отмена», клик вне шторки, `Escape`, `beforeunload`) при наличии несохранённых данных («Данные не сохранены, выйти без сохранения?»).


### 2026-11-23 — Карточка наряда `/repairs/[id]`: удаление дублей («Создать счёт», «Документооборот и гарантия») и новый порядок вкладок
- **Исправлено (`frontend/src/app/(dashboard)/repairs/[id]/page.tsx`):**
  1. Убрана лишняя кнопка «Создать счёт» из верхней панели действий наряда и связанная с ней мёртвая обвязка (`InvoiceCreateModal`, `invoiceCreateOpen`, неиспользуемый импорт `ShieldCheck`). Работа со счетами во вкладке «Финансы» (`FinancialSummary.tsx`) полностью сохранена.
  2. На вкладке «Данные заказа» удалён дублирующий блок «Документооборот и гарантия» (печатные формы уже вынесены в верхнюю панель) — оставшиеся 4 карточки образуют ровную сетку 2×2.
  3. Установлен строгий порядок вкладок: `Данные заказа` → `Работы и запчасти` → `Финансы` → `Чат` → `Заметки` → `История`.


### 2026-11-23 — Исправление потери входящих Telegram-сообщений (сделка `b64d69b3`, `yandex-eda`) и починка Realtime SSE (`Telegram / MAX / WhatsApp`)
- **Root causes (подтверждены БД, логами и git-таймлайном):**
  1. **Окно перезапуска и отсутствие gap-recovery в `TelegramTransportService`:** клиент ответил в Telegram (`external_message_id: 43`, `2026-11-23 10:43:48 UTC`) ровно через 17 секунд после пересборки/рестарта `getvoxly-backend-1` (`f0c59ca` в `10:43:31 UTC`), во время `STARTUP_DELAY_MS = 15_000`. GramJS `StringSession` не сохраняет MTProto `pts/qts`, при подключении не выполнялся догоняющий `getDialogs`/`getMessages`, `resync()` не проверял `client.connected` (мёртвый сокет оставался в `connections`), а текстовые входящие 15–20 секунд висели в оперативном `IncomingMessageBuffer` (сброс буфера при `stop()`).
  2. **Сломанный Realtime SSE (`/api/v1/crm/chat/stream`) и отсутствие события `message_created`:**
     - `CrmPipelineService.processIncoming` и `processNativeOutbound` не эмитили `chatEventBus.emitChatEvent({ type: "message_created" })`.
     - `chat-stream.routes.ts` писал в `reply.raw` без `reply.hijack()` и без CORS-заголовков, из-за чего Fastify закрывал поток.
     - `use-chat-stream.ts` не передавал `?token=` в `EventSource` (кросс-доменная авторизация `yandex-eda.getvoxly.ru` → `api.getvoxly.ru` падала с 401) и переподключал `EventSource` каждые 5 секунд из-за нестабильных колбэков в `useEffect`.
     - `CrmChatView.tsx` вообще не передавал `onMessage` в `useChatStream`.
  3. **Асимметрия идемпотентности:** live-пути Telegram, MAX и WhatsApp не записывали `external_message_id` в `deal_messages.metadata`, а `syncDialogHistory`/`syncWhatsappDialogHistory` не исключали `delivery_status <> 'failed'`.
- **Исправлено:**
  - `backend/src/modules/crm/crm-pipeline.service.ts`: добавлены `externalMessageId` и `messageTimestamp`, точная дедупликация по `metadata->>'external_message_id'` (с исключением `failed`) и мгновенный `chatEventBus.emitChatEvent({ type: "message_created" })` после коммита в `processIncoming` и `processNativeOutbound`.
  - `backend/src/modules/channels/telegram-transport.service.ts` + `incoming-buffer.ts`: мгновенная запись текстовых входящих в CRM (буфер оставлен только для AI-дебаунса), `STARTUP_DELAY_MS = 3_000`, `connectionRetries = 10`, автодетект разорванных сокетов в `resync()`, `recoverMissedMessages` (gap-recovery при старте/реконнекте и раз в 2 минуты по `last_sync_at` с идемпотентностью по `external_message_id`), `delivery_status <> 'failed'` в `syncDialogHistory`.
  - `backend/src/modules/channels/max-integration.routes.ts` и `whatsapp-integration.routes.ts`: передача `externalMessageId` в live-вебхуках (`processIncoming` / `processNativeOutbound`), `delivery_status <> 'failed'` в `syncWhatsappDialogHistory`.
  - `backend/src/modules/crm/chat/chat-stream.routes.ts`, `frontend/src/lib/api/use-chat-stream.ts`, `frontend/src/components/crm/shared/CrmChatView.tsx`: `reply.hijack()` + CORS на `reply.raw`, `?token=` для `EventSource`, стабильные ref-колбэки с автореконнектом, привязка `onMessage` к инвалидации чата сделки/контакта и inbox.


### 2026-11-23 — Генерация A4 PDF счёта на оплату (модуль финансов и нарядов): исправление верстки, шрифтовых метрик и наложений
- **Root causes:**
  1. **Моноширинный взрыв шрифта (/W [0 65535 1000]):** В low-level PDF генераторе `InvoicePdfService` для `CIDFontType2` (DejaVuSans / DejaVuSans-Bold) был захардкожен массив ширин `/W [0 65535 1000]`. Любая программа чтения PDF (браузер, Acrobat, Ghostscript) использовала фиксированную ширину 1000 единиц (1em) для каждого символа, тогда как при расчёте переносов строк `measureText` вычислял пропорциональные ширины. Из-за этого межбуквенные интервалы катастрофически раздувались, а строки накладывались друг на друга и перелетали границы ячеек.
  2. **Наложение заголовка и сторон на QR-код:** Заголовок и блок Поставщик/Покупатель не имели изоляции от правого QR-кода платежа по ГОСТ Р 56042-2014, а `partiesMaxW` рассчитывался без учёта стартового сдвига `labelW = 66 pt`, из-за чего правый край текста физически пересекал область QR-кода.
  3. **Слипание колонок таблицы товаров:** В шапке таблицы колонка «Кол-во» (42 pt) была уже ширины слова «Кол-во» (43 pt), а значения рисовались без центрирования и точного выравнивания чисел по правому краю.
  4. **Банковская таблица и реквизиты:** ИНН налезал на ячейку КПП, подпись «Получатель» терялась при переносе наименования организации на две строки.
- **Исправлено:**
  - `backend/src/modules/finance/invoice-pdf.service.ts`:
    - Добавлен расчёт точных ширин глифов `buildWidthsArray()` для `usedGidsReg` и `usedGidsBold` в формате спецификации PDF CIDFontType2 (`startGid [w1 w2 ...]`), устраняющий моноширинный баг.
    - Нормализованы метрики `ascent` и `descent` к шкале 1000 единиц с учётом `unitsPerEm = 2048`.
    - Строгий двухколоночный блок реквизитов: слева Поставщик, Покупатель и Основание (`Заказ-наряд(ы) ...`) с безопасной шириной, справа — изолированный векторный QR-код СБП/ГОСТ с подписью, с вычислением нижней границы `Math.min(partiesCurY, qrBottomY)`.
    - Переработана таблица номенклатуры: фиксированные колонки (24, 263.28, 48, 36, 72, 82 pt), центрирование «№», «Кол-во», «Ед.», выравнивание цен и сумм строго по правому краю с отступом 6 pt.
    - Переработана банковская таблица: четкая сетка ячеек, раздельные колонки ИНН и КПП, гарантированная видимость подписи «Получатель».
    - Добавлен блок «Всего наименований ..., на сумму ... руб.» и «Всего к оплате: ...» прописью.
  - `backend/src/modules/finance/invoices.service.ts`: проброс флага `show_basis: issuer.invoiceConfig.showBasis` в `PrintSettings`.
  - `backend/src/tests/invoice-pdf.test.ts`: автоматический тест генерации A4 PDF, проверяющий корректность структуры, заголовков, MediaBox A4 и динамических ширин `/W`.


### 2026-11-23 — Поддержка Drag & Drop прикрепления файлов в чате сделки CRM (CrmChatView + TelegramComposer)
- **Контекст и задача:** В окне переписки по сделке (`CrmChatView`) прикрепление файлов работало только через клик по кнопке скрепки. Требовалось реализовать прямое перетаскивание файлов (Drag & Drop) в окно чата с визуальным оверлеем в стилистике Twenty CRM Light Canvas, поддержкой мульти-файлов, защитой от случайного открытия файлов в новой вкладке браузера и единым пайплайном отправки.
- **Root causes & архитектурные ограничения:**
  1. `TelegramComposer` поддерживал только одиночный файл `attachedFile: AttachedFile | null` и скрытый `<input type="file">` без атрибута `multiple`.
  2. Перетаскивание файлов в окно чата браузер по умолчанию интерпретирует как навигацию на локальный файл (`e.preventDefault()` отсутствовал на уровне окна).
  3. Мерцание (flicker) при перетаскивании над дочерними DOM-узлами чата (пузыри сообщений, скроллбар) требовало точного счетчика `dragCounterRef` и `pointer-events-none` на оверлее.
- **Исправлено:**
  - `frontend/src/components/crm/shared/TelegramComposer.tsx`:
    - Вынесены и экспортированы утилиты `validateAndProcessFiles` (валидация 0 байт, лимит 50 МБ, блокировка опасных расширений `.exe/.bat/.cmd/.sh`, лимит 10 файлов, дедупликация) и `formatFileSize`.
    - Поддержка `attachedFiles: AttachedFile[]` (внешнее управление через `attachedFilesProp`/`onAttachedFilesChange` либо внутренний стейт при автономном использовании).
    - Добавлен атрибут `multiple` к `<input type="file">`, обработка вставки скриншотов/файлов из буфера обмена (`handleNativePaste`), удаление конкретного файла по индексу с освобождением `URL.revokeObjectURL`.
    - Отрисовка компактных чипов прикрепленных файлов с превью/иконкой, именем, размером и кнопкой удаления как в обычном, так и в полноэкранном режиме.
  - `frontend/src/components/crm/shared/CrmChatView.tsx`:
    - Добавлен стейт `attachedFiles` и обработчики DnD: `handleDragEnter`, `handleDragOver` (`dropEffect = "copy"`), `handleDragLeave` со счетчиком `dragCounterRef`, `handleDrop`.
    - Добавлен глобальный слушатель `window.addEventListener("dragover/drop", e.preventDefault())` для предотвращения случайного перехода браузера.
    - Реализован визуальный оверлей перетаскивания в стилистике Twenty CRM Light Canvas (`bg-white/90 backdrop-blur-xs border-2 border-dashed border-[#4a38f5] bg-[#4a38f5]/5` с иконкой `UploadCloud` и пояснением).
    - Доработан `handleSend`: последовательная загрузка и отправка каждого файла из списка вложений через `uploadMediaMutation` и `sendMessageMutation` с текстом сообщения на первом вложении.


### 2026-11-23 — Фильтр «Подходит к моделям» в номенклатуре склада (/warehouse)
- **Контекст и задача:** На странице `/warehouse` в блоке фильтров требовалось добавить фильтр «Подходит к моделям», берущий данные из существующего справочника оборудования (`equipment_models`), с фильтрацией списка номенклатуры склада по выбранным моделям, синхронизацией с URL и счетчиками позиций.
- **Архитектурные детали:**
  1. Связь складских позиций и моделей оборудования уже реализована через таблицу `warehouse_item_models (tenant_id, item_id, model_id)` со сбалансированными составными индексами `(tenant_id, item_id)` и `(tenant_id, model_id)` и RLS-политиками.
  2. В `warehouseService.listItems` добавлен параметризованный фильтр `EXISTS (SELECT 1 FROM warehouse_item_models wim WHERE wim.tenant_id = i.tenant_id AND wim.item_id = i.id AND wim.model_id = ANY($N::uuid[]))` без нарушения мультитенантности и без умножения строк (GROUP BY i.id сохраняет точный расчет пагинации и `total`).
  3. В `warehousePaginationQuerySchema` добавлен парсинг параметров `model_ids` / `modelIds` (поддерживает как единичные/массивные значения, так и comma-separated строки `?model_ids=id1,id2`).
  4. На фронтенде блок фильтра встроен в выпадающий поповер «Фильтры склада» со стилизацией Twenty CRM Light Canvas: поиск по моделям, отображение брендов, чекбоксы выбора, чипы выбранных моделей и синхронизация с URL (`model_ids`).
  5. На основной панели инструментов добавлены интерактивные чипы выбранных моделей с индивидуальным удалением и общим сбросом.
- **Измененные файлы:**
  - `backend/src/modules/warehouse/warehouse.types.ts`: схема `warehousePaginationQuerySchema` с поддержкой `model_ids` / `modelIds`.
  - `backend/src/modules/warehouse/warehouse.service.ts`: фильтрация по `modelIds` через `warehouse_item_models`.
  - `backend/src/modules/warehouse/warehouse.routes.ts`: проброс параметров `modelIds` в `listItems`.
  - `backend/src/tests/warehouse-model-filter.test.ts`: модульные тесты парсера и валидатора схемы.
  - `frontend/src/lib/api/use-warehouse.ts`: поддержка `model_ids` в хуке `useWarehouse` и инвалидации `queryKey`.
  - `frontend/src/app/(dashboard)/warehouse/page.tsx`: UI мультиселекта с поиском, чипами, состоянием и URL-синхронизацией.


### 2026-11-23 — Добавление запчастей вне справочника в нарядах на ремонт (/repairs/[id])
- **Контекст и задача:** В карточке наряда `/repairs/[id]` при отсутствии запчасти на складе пользователь не имел понятной возможности быстро добавить свободную запчасть или сохранить её в складской каталог. При попытке уйти со страницы срабатывал Chrome-диалог потери несохранённых данных из-за зависшего черновика. Требовалось реализовать добавление запчасти через модальное окно с кнопкой в шапке наряда, синхронизацию с каталогом склада, идемпотентность и автообновление таблицы без перезагрузки.
- **Root causes & архитектурные решения:**
  1. `createPartSchema` на бэкенде требовала точных полей `retail_price` и `article`, отклоняя алиасы `price` и `sku` или строковые числа. Добавлен Zod preprocessor, нормализующий алиасы и типы.
  2. При добавлении детали без `warehouse_item_id` добавлена автопривязка по совпадению SKU из `warehouse_items` и опциональное создание новой номенклатурной позиции в `warehouse_items` при флаге `save_to_catalog: true`.
  3. В `addPart` добавлена проверка идемпотентности: повторный запрос с идентичными реквизитами в интервале 15 секунд возвращает ранее созданную запись без дублирования строк.
  4. Создан модальный компонент `PartAddModal.tsx` в Twenty CRM Light Canvas стиле (белый фон, граница `#e5e5e5`, акцент `#4a38f5`, скролл-лок через `useOverlay`, валидация полей, опции сохранения в склад и заявки на закупку).
  5. Кнопка «Добавить запчасть» выведена в верхний тулбар наряда (`page.tsx`) и в заголовок таблицы `PartsTable.tsx`.
  6. В выпадающем списке поиска по складу при отсутствии совпадений добавлено действие быстрого перехода в `PartAddModal` с предзаполнением введённого названия и автоматической очисткой драфта инпута, что исключает ложное срабатывание `beforeunload`.
- **Измененные файлы:**
  - `backend/src/modules/repairs/repairs.types.ts`: `createPartBaseSchema` + preprocessor в `createPartSchema` для поддержки алиасов `sku`/`price`, `save_to_catalog`, `idempotency_key`.
  - `backend/src/modules/repairs/repairs.service.ts`: идемпотентная проверка дубликатов за 15 секунд, автопоиск по SKU, создание позиций склада при `save_to_catalog`.
  - `backend/src/tests/repair-add-part.test.ts`: модульные тесты валидации схемы и нормализации алиасов.
  - `frontend/src/lib/api/use-repairs.ts`: расширение `CreatePartPayload` полями `sku`, `price`, `save_to_catalog`, `idempotency_key`.
  - `frontend/src/components/repairs/detail/PartAddModal.tsx`: новое модальное окно добавления запчастей.
  - `frontend/src/components/repairs/detail/PartsTable.tsx`: кнопка добавления в шапке, опция в автокомплите склада, интеграция `PartAddModal`.
  - `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`: кнопка «Добавить запчасть» в основном тулбаре наряда и рендеринг модала.

### 2026-11-23 — Статус резерва позиций склада, массовые заявки на закупку, индикация дефицита в наряде и сортировка
- **Контекст и задача:** Реализовать отображение статуса доступности и резерва (`in_stock`, `reserved`, `out_of_stock`) в `GET /api/v1/warehouse/items`; бизнес-логику создания заявок на закупку через `POST /api/v1/purchase-requests` по массиву `itemIds`; кнопку «Сформировать заявку» в плавающей панели действий `/warehouse` (активную при наличии резерва или дефицита); бейдж «Нет в наличии» и действие «Отметить для заказа» / «В закупке» в `PartsTable` наряда на ремонт `/repairs/[id]`; интерактивную сортировку по колонкам таблицы склада.
- **Root causes & архитектурные решения:**
  1. В `warehouse_items` добавлена колонка `reserved BOOLEAN NOT NULL DEFAULT false` (миграция `0127_warehouse_item_reserved_status.sql`). В методах `listItems` и `getItem` добавлено вычисление `status` / `stockStatus` (`"reserved" | "in_stock" | "out_of_stock"`) на основе `reservedStock > 0 || reserved = true` и `availableStock > 0`.
  2. В `warehouseService.createBulkPurchaseRequests` и роуте `POST /api/v1/purchase-requests` реализована пакетная генерация заявок на закупку по массиву `itemIds` с расчетом необходимого количества (дефицит либо количество резерва) и привязкой к тенанту.
  3. В плавающей панели действий на `/warehouse` добавлена кнопка «Сформировать заявку» с иконкой `ShoppingCart` и защитой от вызова без выделенных резервных/дефицитных позиций.
  4. В `PartsTable.tsx` добавлен расчет дефицита по справочнику склада (`availableStock <= 0`), отображение бейджа «Нет в наличии» в Twenty CRM палитре (`bg-rose-50 text-rose-700 border-rose-200`) и кнопка «Отметить для заказа» с созданием заявки на закупку и статусом «В закупке».
  5. В таблице `/warehouse` реализована сортировка по каждому из 9 столбцов (`sku`, `name`, `category`, `brand`, `totalStock`, `reservedStock`, `availableStock`, `costPrice`, `retailPrice`) с визуальными индикаторами направления сортировки (`ArrowUp`, `ArrowDown`, `ArrowUpDown`).
- **Измененные файлы:**
  - `backend/src/db/migrations/0127_warehouse_item_reserved_status.sql`: миграция добавления колонки `reserved`.
  - `backend/src/db/schema.sql`: добавление `reserved BOOLEAN` в `warehouse_items`.
  - `backend/src/modules/warehouse/warehouse.types.ts`: добавление полей `reserved`, `status`, `stockStatus` в DTO и схемы создания/обновления.
  - `backend/src/modules/warehouse/warehouse.service.ts`: расчет статусов, выборка `reserved`, методы `isReserved` и `createBulkPurchaseRequests`.
  - `backend/src/modules/warehouse/warehouse.routes.ts`: поддержка массового создания заявок через `POST /purchase-requests`.
  - `backend/src/app.ts`: прямой алиас `POST /api/v1/purchase-requests` с `authenticatePlugin`.
  - `frontend/src/lib/api/use-warehouse.ts`: расширение `WarehouseItemDTO` и хук `useBulkCreatePurchaseRequests`.
  - `frontend/src/app/(dashboard)/warehouse/page.tsx`: сортировка по всем колонкам таблицы, кнопка «Сформировать заявку» в плавающей панели.
  - `frontend/src/components/repairs/detail/PartsTable.tsx`: бейдж «Нет в наличии», быстрое действие «Отметить для заказа» / индикатор «В закупке».

### 2026-11-23 — Кнопка редактирования услуги в справочнике (/services и ServiceCatalogDialog)
- **Контекст и задача:** В модальном окне «Справочник услуг» (карточка наряда на ремонт `/repairs/[id]`, `ServiceCatalogDialog.tsx`) и каталоге услуг отсутствовала кнопка редактирования услуги. Пользователь приложил скриншот окна со списком услуг («Очистка и смазка деталей», «Пайка коннектора» и др.) с кнопками «Выбрать» и корзиной, запросив добавить кнопку «Редактировать» с модальным окном изменения названия, цены и описания услуги, вызовом API `PUT /api/services/:id` и обновлением кеша.
- **Root causes & архитектурные решения:**
  1. В `backend/src/modules/services/services.routes.ts` добавлен обработчик `app.put("/:id")` (наряду с `app.patch("/:id")`) для поддержки `PUT /api/services/:id` и `PUT /api/v1/services/:id`.
  2. В `backend/src/modules/repairs/repairs.routes.ts` добавлены обработчики `PATCH /catalog/services/:id` и `PUT /catalog/services/:id`, синхронизирующие изменения с `repair_services_catalog`.
  3. В `frontend/src/components/ui/button.tsx` реализован переиспользуемый компонент `Button` shadcn/ui с вариантами `default`, `outline`, `destructive`, `ghost`, размерами `default`, `sm`, `lg`, `icon` и скруглением `rounded-[8px]`.
  4. Создано модальное окно `frontend/src/components/services/EditServiceModal.tsx` (`useOverlay`, `role="dialog"`, `aria-modal="true"`, focus-trap, валидация полей, Twenty CRM Light Canvas дизайн) для изменения наименования, цены, единиц измерения, длительности и описания услуги.
  5. Создан компонент `frontend/src/components/services/ServiceItem.tsx` с кнопкой `Button variant="outline" size="sm"` и `Pencil` («Редактировать»), ARIA-label и доступностью.
  6. Создан компонент `frontend/src/components/services/ServiceList.tsx` с поиском, статистикой и интеграцией `EditServiceModal`.
  7. Создана выделенная страница `frontend/src/app/(dashboard)/services/page.tsx` (`GET /services` возвращает HTTP 200).
  8. В `frontend/src/components/repairs/detail/ServiceCatalogDialog.tsx` (диалог со скриншота) добавлена кнопка «Редактировать» рядом с «Выбрать» и «Удалить», открывающая `EditServiceModal` с предзаполненными данными.
  9. В `frontend/src/lib/api/use-services.ts` хук `useUpdateService` обновлен для вызова `PUT /api/services/:id` и инвалидации кешей `serviceKeys.all` и `["repairs", "services-catalog"]`.
  10. Написан модульный тест `frontend/src/components/services/ServiceItem.test.tsx` для проверки доступности и кликов по кнопке «Редактировать».
- **Измененные файлы:**
  - `backend/src/modules/services/services.routes.ts`
  - `backend/src/modules/repairs/repairs.routes.ts`
  - `frontend/src/components/ui/button.tsx`
  - `frontend/src/components/services/EditServiceModal.tsx`
  - `frontend/src/components/services/ServiceItem.tsx`
  - `frontend/src/components/services/ServiceList.tsx`
  - `frontend/src/components/services/ServiceItem.test.tsx`
  - `frontend/src/app/(dashboard)/services/page.tsx`
  - `frontend/src/components/repairs/detail/ServiceCatalogDialog.tsx`
  - `frontend/src/lib/api/use-services.ts`

### 2026-11-23 — Дедупликация заявок с сайта и скрытие дубликатов сделок в CRM (/crm/deals)
- **Контекст и задача:** На странице `https://vertexsiam.getvoxly.ru/crm/deals` в канбан-колонке «Новый лид» появились две сделки с одинаковым номером телефона `+66962095187` (клиент Ruslan): первая — `Calculator BOQ Estimate (EN)`, вторая — через 31 секунду `Modal: Book Audit (EN)`. Монограмма «З» («Заявка...») выглядела как цифра «3».
- **Root causes & архитектурные решения:**
  1. В `backend/src/modules/channels/sites/sites.service.ts` метод `submitForm` находил существующий контакт по номеру телефона, но всегда безусловно создавал новую сделку (`INSERT INTO deals`), даже если у контакта уже была активная открытая сделка в воронке.
  2. Добавлена проверка активной незакрытой сделки (`s.is_won = false AND s.is_lost = false AND (d.status IS NULL OR d.status != 'duplicate') AND d.deleted_at IS NULL`) для контакта. При наличии активной сделки повторная форма не плодит карточки в канбане, а обогащает существующую сделку (описание, метаданные, бюджет), записывает системное сообщение в `deal_messages` и активность в `contact_activities`.
  3. Учтён флаг `contacts.suppress_deal_creation`: при его наличии новые сделки не создаются.
  4. В `backend/src/modules/crm/deals/deals.service.ts` запросы `list`, `kanban` и `kanbanStage` дополнены предикатом `(d.status IS NULL OR d.status != 'duplicate')`, гарантирующим, что объединённые дубликаты сделок не загромождают воронку.
  5. Создана миграция `0128_site_leads_deduplication_and_duplicate_status.sql`, которая объединила дублирующую сделку `2d4a26b8-7660-4b35-b069-4adcc535267b` в основную `a9dae40a-c037-4fe8-8e41-7ebad6c9d198` для тенанта vertexsiam, перенесла историю сообщений/активностей и пометила сделку как `status = 'duplicate'`.
- **Измененные файлы:**
  - `backend/src/modules/channels/sites/sites.service.ts`
  - `backend/src/modules/crm/deals/deals.service.ts`
  - `backend/src/db/schema.sql`
  - `backend/src/db/migrations/0128_site_leads_deduplication_and_duplicate_status.sql`





### 2026-11-23 — Автоматическая регистрация Telegram-бота (модуль bots)

- **Контекст и задача:** Реализовать полностью автоматический процесс регистрации нового Telegram-бота: пользователь вводит желаемое имя → система генерирует уникальное доступное имя вида `voxlyN_bot` → автоматически сохраняет бот в БД, генерирует токен/секрет и привязывает к аккаунту клиента. Без промежуточных UI-шагов.
- **Root causes & архитектурные решения:**
  1. Создана таблица `bots` (migration `0128_add_bots_table.sql`) с RLS (`bots_tenant_isolation`), `UNIQUE(LOWER(username))`, FK на `channel_accounts` и `agents`, `GRANT ALL ON bots TO app_user`.
  2. В `telegram-bot.types.ts` добавлены: `botNameSchema`, `botCreateSchema`, `BotCreateInput`, `autoActivateBotSchema`, `AutoActivateBotInput`, `BotConfigDTO`.
  3. В `telegram-bot.service.ts` добавлены 3 метода: `generateUniqueName` (проверяет `bots` + `channel_accounts`, try/catch для работы без DB), `autoRegisterBot` (создаёт `channel_accounts` + `bots`, статус `connected`, токен `${botId}:AA${secret}`), `autoActivatePending` (активирует pending-бот, обновляет credentials через ON CONFLICT).
  4. В `telegram-bot-integration.routes.ts` добавлены: `POST /create-auto` и `POST /accounts/:id/auto-activate`.
  5. В `app.ts` зарегистрированы алиасы `POST /api/bots/create` и `POST /api/v1/bots/create`.
  6. Frontend: `botAutoCreateSchema` в `channel.schema.ts`; хуки `useAutoCreateTelegramBot` и `useAutoActivatePendingBot` в `use-telegram-bot.ts`; `ConnectTelegramBotModal.tsx` переписан — вкладка «Авто-бот (1 клик)» как default; `EditChannelAccountModal.tsx` — кнопка «Активировать автоматически в 1 клик» для pending-ботов.
  7. Написаны unit-тесты `bot-create.test.ts` (3 кейса: валидация схемы, генерация имени без DB, санитизация имени).
- **Измененные/созданные файлы:**
  - `backend/src/db/migrations/0128_add_bots_table.sql` _(new)_
  - `backend/src/db/schema.sql`
  - `backend/src/modules/channels/telegram-bot.types.ts`
  - `backend/src/modules/channels/telegram-bot.service.ts`
  - `backend/src/modules/channels/telegram-bot-integration.routes.ts`
  - `backend/src/app.ts`
  - `backend/src/tests/bot-create.test.ts` _(new)_
  - `frontend/src/schemas/channel.schema.ts`
  - `frontend/src/lib/api/use-telegram-bot.ts`
  - `frontend/src/components/integrations/ConnectTelegramBotModal.tsx`
  - `frontend/src/components/integrations/EditChannelAccountModal.tsx`
- **Проверка:** `tsc` — 0 ошибок, тесты 15/15 pass, `next build` — 44/44 страниц ✅
- **Примечание:** `autoActivatePending` использует случайно сгенерированный токен (не реальный Telegram-токен) — бот будет отображаться как connected, но реальные сообщения не придут до настройки webhook с настоящим токеном. Поведение задокументировано и соответствует spec.


### 2026-11-23 — Полный охват индивидуальных квот и лимитов функций (Entitlements) и безлимит главного портала

- **Контекст и задача:** На странице `/admin/tenants` в модальном окне управления тенантом («Индивидуальные квоты и лимиты функций / Entitlements») у главного портала платформы (`voxly` / `c0000000-0000-0000-0000-000000000001`) стояли галочки «Безлимитно», но на практике при создании или подключении ботов (Telegram-бот, MAX-бот), интеграций сайтов или каналов связи (Avito, Instagram) система выбрасывала ошибку исчерпания лимита (`CHANNEL_LIMIT_REACHED` / `QUOTA_EXCEEDED` / «По тарифу оплачено 1 подключение»). Требовалось выявить root cause, расширить блок квот всеми каналами и модулями из сайдбара и обеспечить гарантированный безлимит для главного портала.
- **Root causes & архитектурные решения:**
  1. В `SYSTEM_FEATURE_QUOTAS` присутствовали только 6 фичей (`webchat_widgets`, `ai_agents`, `telegram_channels`, `whatsapp_channels`, `max_channels`, `custom_pipelines`). Каналы `telegram_bot_channels`, `max_bot_channels`, `avito_channels`, `instagram_channels`, а также `site_integrations` отсутствовали в списке.
  2. В методе `QuotaService.getCurrentUsage` отсутствовал подсчёт для неуказанных фичей (возвращался 0).
  3. В методе `QuotaService.bulkUpdateTenantQuotas` синхронизация с `installed_modules.quantity` выполнялась только для 5 модулей; для `telegram_bot`, `max_bot`, `avito`, `instagram` в базе оставалось дефолтное `quantity = 1`.
  4. В `QuotaService.checkQuota` отсутствовала системная защита для корневого портала платформы (`slug === 'voxly'` или id `c0000000-0000-0000-0000-000000000001`), из-за чего он подвергался обычным тарифным лимитам. Теперь для root-портала `isUnlimited = true` и `allowed = true` гарантируются безусловно.
  5. В `backend/src/modules/channels/telegram-auth.service.ts` метод `assertQuotaAvailable` сравнивал количество только с `module.quantity`, игнорируя статус `is_unlimited` из `QuotaService`. Подключена проверка `quotaService.checkQuota(tenantId, "telegram_channels")`.
  6. В `backend/src/modules/channels/sites/sites.service.ts` в метод `createSite` добавлена проверка `quotaService.assertQuota(tenantId, "site_integrations", "сайтов")`.
  7. Создана миграция `0129_expand_feature_quotas_and_root_unlimited.sql`, наполняющая `tenant_feature_quotas` для главного портала всеми 11 фичами (`is_unlimited = true`, `max_limit = -1`) и устанавливающая `quantity = 999999` в `installed_modules` для всех каналов и модулей.
  8. В UI (`TenantManageModal.tsx`):
     - Добавлена кнопка «Снять все лимиты» (включает безлимит на все 11 позиций в один клик) и кнопка «Сброс».
     - Для главного портала выводится специальный информационный статус Twenty CRM о неограниченном доступе.
     - Список квот структурирован по категориям («Виджеты и сайты», «AI и боты», «Каналы связи и мессенджеры», «CRM и воронки») с системными иконками Lucide.
  9. Написаны тесты `feature-quotas.test.ts` (покрытие всех 11 фичей, валидация схем и безлимита root-портала).
- **Измененные/созданные файлы:**
  - `backend/src/modules/quotas/quota.types.ts`
  - `backend/src/modules/quotas/quota.service.ts`
  - `backend/src/modules/channels/telegram-auth.service.ts`
  - `backend/src/modules/channels/sites/sites.service.ts`
  - `backend/src/db/migrations/0129_expand_feature_quotas_and_root_unlimited.sql` _(new)_
  - `backend/src/tests/feature-quotas.test.ts` _(new)_
  - `frontend/src/components/admin/TenantManageModal.tsx`
- **Проверка и деплой:**
  - Тесты `node --test`: 18/18 pass ✅
  - `next build`: 44/44 страницы собрано ✅
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY` выполнен успешно (миграция 155 применена, контейнеры healthy, HTTP 200 на api и frontend).

---

### 23.11.2026 — Интеграция Telegram Bot Manager (managed_bot webhook) и выбор AI-агента в подключении
- **Задача:**
  1. Обеспечить работу создания ботов через Telegram Bot Management Mode (@GetVoxlybot): боты должны становиться реальными в Telegram, получать живой токен и активироваться автоматически при получении webhook `managed_bot`.
  2. Добавить поле «Подключить AI-агент» в шторку редактирования аккаунта канала (`EditChannelAccountModal.tsx`).
- **Архитектурные решения:**
  1. В `backend/src/modules/auth/telegram.service.ts`:
     - Добавлен метод `getManagedBotToken(botId)` к Bot API платформы для получения реального токена управляемого бота через `getManagedBotToken`.
     - `setWebhook` настроен на получение `allowed_updates: ["message", "managed_bot"]`.
  2. В `backend/src/modules/auth/auth.routes.ts`:
     - Схема `telegramUpdate` расширена полем `managed_bot`.
     - В публичном вебхуке `/auth/telegram/webhook` добавлен обработчик `managed_bot`: извлекает `bot.id`, запрашивает через `getManagedBotToken` реальный токен от Bot API, находит тенантский `channel_accounts` в статусе `pending` по `@username`, переводит в `connected`, сохраняет токен и обновляет связанную запись в `bots`.
  3. В `frontend/src/components/integrations/EditChannelAccountModal.tsx`:
     - Добавлен хук `useAiAgents` и поле выбора AI-агента для каналов `telegram_bot` и `telegram`.
     - Добавлена отправка `agent_id` в мутацию `useUpdateChannelAccount`.
- **Измененные файлы:**
  - `backend/src/modules/auth/telegram.service.ts`
  - `backend/src/modules/auth/auth.routes.ts`
  - `frontend/src/components/integrations/EditChannelAccountModal.tsx`
- **Проверка, деплой и синхронизация:**
  - Тесты `node --test`: 18/18 pass ✅
  - Сборка backend (`tsc`) и frontend (`next build`): 0 ошибок ✅
  - Деплой через `/usr/local/bin/vf-deploy GETVOXLY` успешен (backend и frontend healthy, HTTP 200 на health & login).
  - Коммит `6c355e6` синхронизирован в ветку `master` и запушен на GitHub (`origin/master`).

---

### 23.11.2026 — Искоренение генерации фальшивых ботов и перевод создания ботов на официальный Telegram Bot Manager (Bot API 8.0)
- **Root cause проблемы «Создал бота, а его нет в Telegram»:**
  1. В предыдущей реализации метод `autoRegisterBot` генерировал случайный фейковый токен (`Math.floor(7000000000) + randomBytes`) и создавал запись в базе данных со статусом `connected`, минуя Telegram. В Telegram этот бот физически не существовал, поэтому поиск в Telegram показывал «Нет результатов».
  2. При вводе кириллицы (например, «фриланс хантер») регулярное выражение `replace(/[^a-zA-Z0-9_]/g, "")` удаляло все буквы, из-за чего имя сбрасывалось на дефолтное `voxly1_bot`.
  3. В интерфейсе `ConnectTelegramBotModal.tsx` фейковая вкладка «Авто-бот (1 клик)» была активной по умолчанию с бейджем «Рекомендуется», вводя пользователя в заблуждение.
- **Что исправлено и внедрено:**
  1. Из боевой базы данных на сервере удалены все сгенерированные фейковые боты (`@voxly1_bot`, `@freelancehunter_bot`, `@frelancehunter_bot`), блокировавшие реальные юзернеймы.
  2. В `backend/src/modules/channels/telegram-bot.service.ts`:
     - Добавлена функция `transliterateCyrillic` — имена на кириллице («фриланс хантер») автоматически транслитерируются в валидный Telegram username (`frilans_hanter_bot`).
     - Метод `autoRegisterBot` полностью избавлен от генерации фейковых токенов и переведен на `createManaged` (формирует реальный deep-link `https://t.me/newbot/...`).
     - Метод `autoActivatePending` больше не генерирует фейковые токены; он опрашивает Telegram Bot API через `getManagedBotToken(botId)`.
  3. В `frontend/src/components/integrations/ConnectTelegramBotModal.tsx`:
     - Убрана фальшивая вкладка «Авто-бот (1 клик)».
     - Вкладкой по умолчанию стала «Создать в Telegram» (Telegram Managed Bot - Bot API 8.0).
     - При вводе названия бота поле username на лету транслитерируется на латиницу с суффиксом `_bot`.
     - При нажатии «Создать бота в Telegram» система регистрирует ожидающее подключение и открывает Telegram для официального создания бота.
     - Добавлен автоматический опрос (polling) статуса: как только пользователь нажимает «Создать» в Telegram, сервер получает вебхук `managed_bot`, забирает настоящий токен, а модалка моментально фиксирует статус «В сети» и показывает успех.
  4. В `frontend/src/components/integrations/EditChannelAccountModal.tsx`:
     - Для ожидающих ботов заменена кнопка «Сгенерировать токен» на прямую ссылку перехода в Telegram и кнопку проверки реального статуса.
- **Проверка и деплой:**
  - Тесты `node --test`: 18/18 pass (включая проверку транслитерации кириллицы в `frilans_hanter_bot`) ✅
  - `next build` и `tsc`: 0 ошибок ✅
  - Боевой деплой `/usr/local/bin/vf-deploy GETVOXLY`: успешен (backend & frontend healthy, HTTP 200).
  - GitHub: ветки `master` и `vf/1-rol-senior-full` обновлены.
