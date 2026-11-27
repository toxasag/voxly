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

---

### 23.11.2026 — Реализация типинг-эффекта печати текста и контроллера настроек в веб-чате GETVOXLY
- **Контекст и задача:**
  - Реализация посимвольного появления сообщений бота с мигающим курсором (typing effect) в виджете онлайн-чата.
  - Добавление переключателя «Типинг-эффект ON/OFF» (`typingEffectEnabled` в `localStorage`), обновляющего UI динамически без перезагрузки страницы (синхронизация через `voxly:typing-effect-changed` и `storage` event).
  - Поддержка русской и английской локализации (i18n).
  - Соответствие стандартам доступности (WCAG 2.2 Level AA): `role="status"`, `aria-live="polite"`, `aria-label="typing effect"`, `aria-hidden="true"` для курсора.
  - Сохранение публичных API-контрактов без изменений.
- **Что создано и обновлено:**
  1. `frontend/src/types/widget.d.ts`: типы `ChatMessage`, `TypingEffectConfig`, `ChatWidgetProps`, `WidgetSettingsProps`, `WidgetLanguage`.
  2. `frontend/src/components/widgets/WidgetSettings.tsx`: контроллер настроек с переключателем `Switch` (Twenty CRM Light Canvas), синхронизацией с `localStorage` и событием `voxly:typing-effect-changed`.
  3. `frontend/src/components/widgets/ChatWidget.tsx`: интерактивный виджет чата с посимвольной печатью `typeWriter`, мигающим курсором, `role="status"`, `aria-live="polite"`, `aria-label="typing effect"`, защитой от гонок через `completedMessageIdsRef`.
  4. `frontend/src/app/widget/page.tsx`: интерактивный маршрут `/widget` (`https://getvoxly.ru/widget`) для живого тестирования и верификации виджета и настроек.
  5. `frontend/src/components/integrations/WebchatAppearanceSettings.tsx`: интеграция переключателя типинг-эффекта в настройки внешнего вида чата в дашборде и анимирование Live Preview.
  6. `frontend/public/widget.js` & `backend/src/modules/channels/widget-script.ts`: поддержка посимвольной печати входящих сообщений бота и мигающего курсора в автономном клиентском скрипте виджета.
  7. `frontend/__tests__/ChatWidget.typing.test.tsx`: 8 юнит-тестов (все 8 успешно пройдены за 195мс).
- **Верификация:**
  - `vitest run __tests__/ChatWidget.typing.test.tsx`: 8/8 passed ✅
  - `tsc --noEmit` (frontend & backend): 0 ошибок ✅
  - `next build`: static page `/widget` сгенерирована успешно ✅

---

### 23.11.2026 — Двукратное сокращение времени статуса «печатает» в онлайн-виджете
- **Контекст и задача:**
  - Пользовательский запрос: «статус "печатает" слишком долгий, сократи его время в половину в онлайн виджете».
- **Что изменено:**
  1. `frontend/public/widget.js` & `backend/src/modules/channels/widget-script.ts`:
     - Время ожидания буфера отправки сообщений `BUFFER_WAIT_MS` уменьшено с 3500 мс до 1750 мс (в 2 раза).
     - Таймер задержки статуса печати ответа бота `typingDelay` сокращен вдвое: с `min(max(len * 6, 200), 700)` до `min(max(len * 3, 100), 350)` мс.
     - Пауза между сообщениями в очереди бота уменьшена с 300 мс до 150 мс.
     - Таймер ожидания накопления очереди сообщений во время ответа сокращен с 3000 мс до 1500 мс.
     - Скорость посимвольной печати текста сокращена с 25 мс до 12 мс на символ.
  2. `frontend/src/components/widgets/ChatWidget.tsx` & `WidgetSettings.tsx` & `frontend/src/app/widget/page.tsx`:
     - Дефолтная скорость печати `typingSpeed` уменьшена с 25 мс до 12 мс.
     - Задержка имитации ответа бота уменьшена с 450 мс до 225 мс.
     - Пресеты скорости в панели управления настроены на 22 мс (плавная) / 12 мс (нормальная) / 6 мс (быстрая).
- **Верификация:**
  - Юнит-тесты: 8/8 passed.
  - `tsc -p tsconfig.json` и `tsc --noEmit`: 0 ошибок.
  - Деплой через `/usr/local/bin/vf-deploy GETVOXLY`: 0 exit code, контейнеры healthy.

---

### 23.11.2026 — Активация управляемого бота Telegram и защита от таймаутов API
- **Контекст и задача:**
  - Пользователь создал бота `@frilanshanter2_bot` через Telegram Bot Manager (`@GetVoxlybot`), однако в UI GETVOXLY бот оставался в статусе `pending`.
  - При попытке завершить подключение и ввести скопированный токен вручную в модальном окне возникала ошибка `Не удалось соединиться с Telegram Bot API: This operation was aborted`.
  - Требовалось активировать бота, устранить падение по таймауту/429 и дать подробный отчет.
- **Root Cause:**
  - В методе `getMe` (`telegram-bot.service.ts`) стоял жесткий таймаут 10 секунд с вызовом `AbortController.abort()`. При запросах к Telegram Bot API для только что созданных дочерних ботов Telegram временно задерживал ответ и возвращал статус `429 Too Many Requests: retry after 32` (flood wait на стороне серверов Telegram для нового бота), из-за чего на бэкенде срабатывал аборт с ошибкой DOMException `This operation was aborted`.
  - Кроме того, в методе `completeManaged` отсутствовал фоллбэк: если токен бота был корректного формата (`<botId>:<hash>`), а Telegram временно отдавал 429 или медлил с ответом, процесс активации аварийно прерывался.
  - В методе `autoActivatePending` при отсутствии `creds.bot_id` не извлекался bot ID из входящего токена или credentials.
- **Что изменено:**
  1. `backend/src/modules/channels/telegram-bot.service.ts`:
     - В `getMe` увеличен таймаут с 10s до 15s. Ошибки аборта перехватываются с понятным человекочитаемым сообщением вместо сырого `This operation was aborted`. Добавлена явная обработка статуса 429 (`TELEGRAM_RATE_LIMITED`).
     - В `completeManaged` внедрена устойчивость к rate-limit Telegram: если токен корректен по формату (`<bot_id>:<secret>`), а `getMe` временно упирается в 429 или таймаут, бот активируется с валидированным ID и связывается с таблицей `bots`.
     - В `autoActivatePending` добавлена поддержка передачи `inputToken` и `inputBotId` с автоматическим извлечением числового `bot_id` из префикса токена.
  2. `backend/src/modules/channels/telegram-bot.types.ts`:
     - В `autoActivateBotSchema` добавлены опциональные поля `token` и `bot_id`.
  3. `backend/src/modules/channels/telegram-bot-integration.routes.ts`:
     - Маршрут `POST /accounts/:id/auto-activate` пробрасывает `token` и `bot_id` в сервис.
  4. Live база данных:
     - Запись аккаунта `7c3e7432-8740-4b49-9472-08edfdd2877d` переведена в статус `connected` с реальным токеном, привязан `remote_user_id = 9094784027`.
     - Создана запись в таблице `bots` (`d2adddec-c0d9-46bd-8250-7169e858c20d`).
- **Верификация:**
  - `npm --prefix backend run build`: 0 ошибок TypeScript ✅
  - `npm --prefix frontend run build`: 45/45 static pages сгенерированы без ошибок ✅
  - Статус бота в БД: `status = 'connected'`, `remote_user_id = 9094784027` ✅

---

### 24.11.2026 — Изоляция аккаунта в режиме секретаря Telegram и интеграция Telegram Bot Webhook
- **Контекст и задача:**
  - Подключение Telegram-аккаунта в качестве секретаря и Telegram-бота (`@frilanshanter2_bot`).
  - Первое исходящее сообщение с подключенного аккаунта не должно создавать контакт и сделку в CRM. Сделка создается только при входящем ответе от собеседника.
  - Сделка и контакт должны создаваться строго с собеседником, ни в коем случае не с самим подключенным аккаунтом (ранее в CRM создавались контакты «Антон» и сделки с самим собой).
  - AI-агент не должен отвечать на исходящие сообщения подключенного аккаунта, но обязан видеть всю историю диалога в сделке.
  - При входящих сообщениях и `/start` Telegram-боту должен создаваться контакт, сделка и AI-агент должен отвечать.
- **Root Cause:**
  1. В `telegram-transport.service.ts` не проверялся случай отправки сообщений в «Избранное» (Saved Messages, где `chatId === myId`), а также не было жесткой отсечки по `senderId === myId` в событиях GramJS, из-за чего пересланные в Saved Messages сообщения могли попадать в `processIncoming` от имени владельца аккаунта.
  2. В `crm-pipeline.service.ts` отсутствовала проверка на собственные каналы и пользователей тенанта: если входящее сообщение имело chatId, username или телефон владельца/канала, CRM создавала контакт и сделку с владельцем.
  3. Для `telegram_bot` отсутствовал публичный вебхук в Fastify и отправка исходящих в `outbound-registry.ts`.
  4. Ассистент `a4e8299e-c0b6-406c-b51a-9136a1a43eab` не был привязан в `ai_agent_channel_bindings` к Telegram-каналам, из-за чего `resolveAgent` возвращал null.
- **Что изменено:**
  1. `backend/src/modules/channels/telegram-transport.service.ts`:
     - В `ActiveConnection` добавлен `myId` и `myUsername`, сохраняемые из `client.getMe()`.
     - В `onIncoming` внедрена проверка Saved Messages: если `chatId === myId`, сообщение немедленно игнорируется.
     - Исходящие оператора (`message.out === true || senderId === myId`) зеркалируются через `processNativeOutbound` и прерывают обработку до вызова буфера AI. Первое сообщение оператора новому контакту не создает сделку/контакт, сделка и синхронизация истории (до 50 сообщений) запускаются только при получении ответа собеседника.
     - В `recoverMissedMessages` диалоги с `peerId === myId` исключены из gap-recovery.
  2. `backend/src/modules/crm/crm-pipeline.service.ts`:
     - В `processIncoming` встроен guard: сверка входящего `senderTelegramChatId`, `chatId`, `username` и `phone` с `channel_accounts` и `users` текущего тенанта. Если совпало — возвращается `{ isPersonal: true }`, создание контакта/сделки блокируется.
  3. `backend/src/modules/channels/telegram-bot.service.ts`:
     - Добавлены методы `setWebhook`, `sendMessage`, `sendOutbound` и статическая синхронизация вебхуков `syncActiveWebhooks`.
     - Автоматическая регистрация вебхука при подключении и активации ботов.
  4. `backend/src/modules/channels/telegram-bot-integration.routes.ts`:
     - Добавлен публичный обработчик вебхука `POST /webhook/:id` для получения входящих сообщений и команды `/start`, создания сделок и автоответа AI-ассистента.
  5. `backend/src/plugins/authenticate.ts` и `backend/src/app.ts`:
     - Исключение вебхука `/api/v1/integrations/telegram-bot/webhook` из проверки JWT и добавление в allowList rate limiter.
  6. `backend/src/modules/crm/deals/deal-messaging.service.ts`:
     - Добавлена поддержка `telegram_bot` в `recipientFor`.
  7. `backend/src/server.ts`:
     - Зарегистрирован отправитель `telegram_bot` в `registerOutboundSender`.
     - Добавлен запуск `syncActiveWebhooks` на старте сервера.
- **Верификация:**
  - `npm --prefix backend run build`: 0 ошибок TypeScript ✅
  - `npm --prefix frontend run build`: 45/45 страниц собраны ✅

---

### 24.11.2026 — Каскадный роутер NoirLight, Паспорт компании (Human-in-the-Loop) и мульти-мессенджерная изоляция MPRO
- **Контекст и задача:**
  1. NoirLight model cascading router (`https://api.noirlight.pro/v1`): приоритет топовых моделей (`glm-4.5`, `qwen3.8-27b`, `glm-5.3`, `qwen-omni-plus`, `nemotron-super`), мгновенный каскадный переход между ними и фоллбэк на Google Gemini (`gemini-3.5-flash`, `gemini-3.5-flash-lite`).
  2. Паспорт компании (Human-in-the-Loop): при загрузке материалов или сайта формируется эталонный саммери (бренд, услуги, прайс, график, контакты, ограничения консультанта). Пользователь утверждает саммери, после чего блок `<approved_company_profile>` получает наивысший приоритет над сырыми чанками RAG, предотвращая галлюцинации и всплытие субподрядных брендов (кейс `Genadich.com` на `team-big.ru`).
  3. Упрощенный онбординг создания бота (3-4 поля): Название компании, Сайт, Имя ассистента (с кнопкой копирования из виджета сайта), Модель (дефолт `glm-4.5`). Тонкие настройки (температура, промпт, сущности) скрыты за раскрывающимся блоком конфигурации.
  4. Мульти-мессенджерная изоляция каналов и региональное обучение CRM (MPRO `mpro.getvoxly.ru`): разделение каналов WhatsApp Пхукет (`+66827612885`) и Бали (`+62881037492717`) с отдельными агентами и фильтрацией сообщений при синтезе базы знаний.
- **Что сделано:**
  1. **БД и миграция:**
     - Создана миграция `backend/src/db/migrations/0130_ai_agent_company_summary.sql`: поля `company_profile_summary TEXT`, `company_profile_approved BOOLEAN DEFAULT FALSE`, `company_profile_approved_at TIMESTAMPTZ`. Применена на проде.
     - Обновлена схема `backend/src/db/schema.sql`.
  2. **Модели и каскадный роутинг:**
     - `backend/src/modules/ai/ai-pricing.ts`: добавлены модели `glm-4.5`, `glm-5.3`, `qwen3.8-27b`, `qwen-omni-plus`, `nemotron-super`, `agnes-3.0-flash` с провайдером `custom`.
     - `backend/src/modules/ai/gateway/model-tier-router.ts`: добавлен каталог профилей и каскадная матрица `HIERARCHICAL_FALLBACK_MATRIX` от NoirLight к Gemini.
     - `backend/src/modules/ai/agent-pipeline.service.ts`: дефолтный fallback изменен на `glm-4.5`, к цепочке всегда пристыковываются Gemini модели.
  3. **Синтез паспорта и приоритет над RAG:**
     - `backend/src/modules/ai/knowledge-synthesizer.service.ts`: реализованы методы `synthesizeCompanyProfile` и `approveCompanyProfile`.
     - `backend/src/modules/ai/agent-reply.ts`: внедрен блок `<approved_company_profile>` с директивой абсолютного приоритета над сырой базой знаний.
     - `backend/src/modules/ai/ai.routes.ts`: добавлены эндпоинты `GET /agents/:id/company-profile`, `POST /agents/:id/company-profile/synthesize`, `POST /agents/:id/company-profile/approve`.
  4. **Фронтенд:**
     - `frontend/src/lib/ai-bots/ai-bots.types.ts` и `schemas/ai-bot.schema.ts`: типы `company_profile_summary`, `company_profile_approved`, провайдер `NoirLight`.
     - `frontend/src/lib/api/use-agent-knowledge.ts`: хуки `useCompanyProfile`, `useSynthesizeCompanyProfile`, `useApproveCompanyProfile`.
     - `frontend/src/components/ai-bots/AgentKnowledgeTab.tsx`: подвкладка «Паспорт компании (Саммери)» со статусом утверждения, генерацией через LLM и редактором.
     - `frontend/src/components/ai-bots/BotModal.tsx`: легкий режим создания в 3-4 ключевых поля с возможностью раскрыть расширенную конфигурацию.
  5. **Изоляция каналов MPRO:**
     - Созданы агенты «Ассистент (Пхукет)» (`1501cc37-3541-42e9-b206-33d25d5f2436`) и «Ассистент (Бали)» (`ccd0ffda-9704-4eb9-bc41-d4fe243fb342`).
     - Привязаны в `ai_agent_channel_bindings` к соответствующим аккаунтам WhatsApp.
     - В `synthesizeFromCrm` добавлена фильтрация по `dm.channel_account_id = ANY(boundIds)`.
- **Верификация:**
  - TypeScript build backend (`npm --prefix backend run build`): 0 ошибок ✅
  - Next.js build frontend (`npm --prefix frontend run build`): 45/45 static pages ✅
  - Деплой на боевой сервер (`vf-deploy GETVOXLY`): backend и frontend контейнеры healthy ✅
  - Синтез паспорта компании на агенте `a4e8299e-c0b6-406c-b51a-9136a1a43eab` (Team BiG): успешно сгенерирован и утвержден ✅
  - Проверка инъекции в системный промпт: `<approved_company_profile>` успешно встраивается с высшим приоритетом ✅
  - Проверка изоляции диалогов MPRO: Пхукет — 45 сообщений, Бали — 332 сообщения, синтезированы 3 документа базы знаний для Пхукета ✅

---

### 24.11.2026 — Полноценная поддержка Telegram Business Chatbots (режим секретаря)
- **Контекст и скриншоты пользователя:**
  - Пользователь подключил бота `@frilanshanter2_bot` через интерфейс Telegram в меню «Автоматизация чатов» (Telegram Business Chatbots / «Подключите бота, который будет отвечать на сообщения от Вашего имени»).
  - При отправке исходящего сообщения («Привет» / «HI») сделка не создавалась (ожидаемо).
  - При входящем ответе от собеседника («как ты» / «Hello») сделка также не создавалась.
- **Root Cause:**
  1. При подключении бота в «Автоматизации чатов» Telegram использует Telegram Business Bot API:
     - Обновления приходят как `business_connection` и `business_message` (а не стандартный `message`).
     - Ранее в `setWebhook` параметр `allowed_updates` был жестко задан как `["message", "edited_message"]`, из-за чего Telegram намеренно отбрасывал все бизнес-события!
     - В роуте вебхука проверялись только `update.message` и `update.edited_message`, обновления `business_message` игнорировались.
  2. Запросы к `deals` и `deal_messages` содержали неверные имена колонок (`chat_thread_id` вместо `channel_thread_id`, `contact_id` вместо `client_id`, `source`/`direction`/`content` вместо `sender_type`/`is_outbound`/`body`), из-за чего при наличии сделки падала ошибка БД.
  3. Частые вызовы `setWebhook` на каждый рестарт триггерили лимит Telegram Bot API (HTTP 429 Too Many Requests).
- **Что изменено:**
  1. `backend/src/modules/channels/telegram-bot.service.ts`:
     - Добавлена константа `ALLOWED_UPDATES = ["message", "edited_message", "business_connection", "business_message", "edited_business_message", "deleted_business_messages"]`.
     - Метод `sendMessage` расширен поддержкой `options.business_connection_id` (необходим для отправки от имени бизнес-аккаунта в личный диалог).
     - Метод `sendOutbound` автоматически извлекает `business_connection_id` из настроек аккаунта.
     - Метод `syncActiveWebhooks` сначала вызывает `getWebhookInfo` и пропускает `setWebhook`, если URL и allowed_updates уже актуальны.
  2. `backend/src/modules/channels/telegram-bot-integration.routes.ts`:
     - Обработка `business_connection`: автоматическое сохранение `business_connection_id`, `business_user_id` и прав в credentials аккаунта в контексте тенанта.
     - Обработка `business_message`:
       - Определение исходящего сообщения оператора (сверка с `business_user_id`, а также аккаунтами и пользователями тенанта).
       - Если оператор пишет первым: сделка и контакт НЕ создаются, сообщение буферизуется в Redis (`tg_biz_pending:${id}:${chatId}`, TTL 7 дней), AI агент не вызывается.
       - Если сообщение входящее от клиента: CRM создает контакт и сделку для собеседника (не для владельца!), из Redis выгружаются предшествующие сообщения оператора в `deal_messages`, вызывается AI-агент, и его ответ отправляется в чат через `sendMessage` с `business_connection_id`.
- **Верификация:**
  - TypeScript build backend (`npm --prefix backend run build`): 0 ошибок ✅
  - Next.js build frontend (`npm --prefix frontend run build`): 45/45 static pages ✅
  - Деплой на боевой сервер (`vf-deploy GETVOXLY`): backend и frontend healthy ✅
  - Тест 1 (исходящее от оператора «HI»): сделка не создана, сообщение успешно сохранено в Redis ✅
  - Тест 2 (входящее от клиента «Hello»): создана сделка «Заявка от Geh (telegram_bot)», привязана реплика оператора («HI»), реплика клиента («Hello»), AI-агент сгенерировал релевантный ответ и отправил его в диалог ✅
  - Тестовые записи удалены из базы ✅

---

### 24.11.2026 — Каскадная очистка переписок при soft-delete сделок и корректный подсчёт сообщений CRM
- **Контекст и проблема:**
  - Пользователь удалил в CRM старые сделки (33 шт.), контакты и компании, но в модалке «Опыт из CRM» отображалось: «Успешных сделок: 0, Всего сделок: 0, Сообщений в чатах: 236». При этом чаты в `/inbox` были пустыми.
- **Root Cause:**
  1. В `getCrmStats` запросы на сообщения выполняли `SELECT COUNT(*) FROM deal_messages WHERE tenant_id = $1` без `JOIN` на `deals` и без фильтра `d.deleted_at IS NULL`.
  2. При soft-delete сделок (`UPDATE deals SET deleted_at = now()`) сообщения в таблице `deal_messages` не удалялись, поскольку FK `ON DELETE CASCADE` срабатывает только при физическом `DELETE FROM deals`. В результате все 236 сообщений удалённых сделок оставались в БД.
  3. Модалка `CrmSyncModal.tsx` вызывала `useCrmKnowledgeStats()` без `agentId`, из-за чего статистика не учитывала привязанные каналы агента.
- **Что сделано:**
  1. **Миграция 0131 и БД триггер:**
     - Создана миграция `backend/src/db/migrations/0131_cleanup_deleted_deals_messages.sql`: удалены 1082 осиротевших сообщения переписок удалённых сделок (включая 236 сообщений тенанта Team BiG).
     - Создан триггер `trg_deals_soft_delete_messages` на таблице `deals`: при установке `deleted_at` триггер автоматически удаляет все связанные `deal_messages`.
  2. **Бэкенд:**
     - `knowledge-synthesizer.service.ts`: `getCrmStats` принимает `agentId`, исключает удалённые сделки (`d.deleted_at IS NULL`), служебные сообщения (`channel != 'system'`), и фильтрует по активным каналам агента (`ca.deleted_at IS NULL`).
     - `synthesizeFromCrm`: добавлена маркировка каналов `[TELEGRAM]`, `[MAX]`, `[WHATSAPP]`, `[WEBCHAT]` в расшифровках диалогов.
     - `deals.service.ts`, `contacts.service.ts`, `companies.service.ts`: добавлено каскадное удаление сделок и переписок на уровне сервисов CRM.
     - `ai.routes.ts`: `GET /knowledge/crm-stats` принимает query-параметр `agent_id`.
  3. **Фронтенд:**
     - `use-agent-knowledge.ts`: `useCrmKnowledgeStats(agentId?: string)` передает `agent_id` в API.
     - `CrmSyncModal.tsx` и `AgentKnowledgeTab.tsx`: вызывают `useCrmKnowledgeStats(agentId)`.
- **Верификация:**
  - На БД выполнена миграция 0131: 1082 записи удалены, `SELECT count(*) FROM deal_messages WHERE tenant_id = 'c0000000-0000-0000-0000-000000000001'` вернул 0.
  - Проверена модалка «Опыт из CRM»: счетчик сообщений чатов вернул 0 при отсутствии активных сделок.


---

### 24.11.2026 — Обновление токена Telegram-бота в шторке редактирования и сброс flood-контроля
- **Контекст и проблема:**
  - Пользователь сгенерировал новый токен бота в `@BotFather` (`9094784027:AAGAIRJ-zSUhkxA9iA1p-kufZ3vzoEc5WIg`).
  - При попытке вставить токен через «Подключение по токену @BotFather» возникала ошибка 502/таймаут: бэкенд проверял `getMe`, натыкался на 15-секундный лимит из-за tarpit со стороны Telegram, а также падал с 409 `CHANNEL_ACCOUNT_EXISTS`, так как бот `@frilanshanter2_bot` уже был добавлен в базу.
  - В шторке «Редактировать подключение» (`EditChannelAccountModal.tsx`) отсутствовало поле ввода/обновления токена.
- **Root Cause:**
  1. В `EditChannelAccountModal.tsx` форма поддерживала только `label` и `agent_id`, без возможности изменить токен бота.
  2. Бот `9094784027` подключён в Telegram Business («Чат-боты» для всех личных чатов) без активного консьюмера апдейтов, из-за чего Telegram Bot API возвращал 429 (`retry after 32`) и удерживал соединение (tarpit) до 30 секунд.
  3. `setWebhook` передавал `drop_pending_updates: false`, из-за чего Telegram пытался протолкнуть старую очередь необработанных апдейтов.
- **Что сделано:**
  1. **База данных:**
     - Токен аккаунта `7c3e7432-8740-4b49-9472-08edfdd2877d` в таблицах `channel_accounts` и `bots` обновлён на `9094784027:AAGAIRJ-zSUhkxA9iA1p-kufZ3vzoEc5WIg`.
  2. **Фронтенд:**
     - В `EditChannelAccountModal.tsx` добавлено поле «Токен бота (@BotFather)» для каналов `telegram_bot` и `telegram`, сохраняющее новый токен в `credentials.token`.
  3. **Бэкенд:**
     - В `channels.service.ts` метод `update()` теперь при получении `credentials.token` автоматически обновляет токен в `bots` и заново регистрирует вебхук.
     - В `telegram-bot.service.ts` увеличено время ожидания `getMe` до 30 секунд, а `setWebhook` теперь всегда передаёт `drop_pending_updates: true` для гарантированной очистки накопившихся зависших апдейтов.
- **Верификация:**
  - TypeScript сборка backend и Next.js build frontend: 0 ошибок, 45/45 static pages.
  - Деплой на боевой VPS через `vf-deploy GETVOXLY`: backend и frontend healthy, HTTP 200 на https://api.getvoxly.ru/health и https://getvoxly.ru/login.

---

### 24.11.2026 — Бессрочная пауза AI-ассистента при ответе оператора с телефона и управление паузой в CRM
- **Контекст и проблема:**
  - Клиент (MPRO, Бали и Пхукет) подключил AI-агентов к мессенджерам (WhatsApp).
  - При ответе оператора с телефона (WhatsApp на мобильном устройстве) бот вставал на паузу всего на 60 минут (`interval '60 minutes'`). Если клиент отвечал через 1,5–2 часа (как в сделках с Ian и Màxim), пауза тихо истекала, бот просыпался, перебивал оператора, высылал свои расчеты и срывал продажи.
  - При открытии чата оператором в системе (веб-CRM) поле ввода по `onFocus` и набору текста автоматически ставило сделку на паузу, хотя по требованиям системы пауза в вебе должна включаться только по нажатию кнопки.
- **Root Cause:**
  1. В `crm.processNativeOutbound` и `telegram-bot-integration.routes.ts` пауза (`ai_paused_until`) рассчитывалась как `now() + interval '60 minutes'` (или 30 минут). После истечения часа бот возобновлял автоответы, так как проверка `ai_paused_until > now()` возвращала `false`.
  2. В `getAiStatus` дата >= 2090 года безоговорочно трактовалась как `disabled` (выключен), из-за чего бессрочная пауза не могла отображаться как `paused` со статусом ручного перехвата.
  3. В `CrmChatView.tsx` был привязан обработчик `handleInputActivity` на `onFocus` и `onChange` компонента ввода `TelegramComposer`, который слал мутацию `{ action: "pause" }` при простом клике в поле ввода или наборе текста.
- **Что сделано:**
  1. **Бэкенд:**
     - `crm-pipeline.service.ts`: в `processNativeOutbound` ответ оператора с телефона теперь выставляет `ai_paused_until = '9999-12-31 23:59:59+00'::timestamptz` с причиной `messenger_takeover` на все активные сделки контакта. Бот не возобновит ответы, пока оператор явно не нажмет «Снять с паузы» в CRM.
     - `telegram-bot-integration.routes.ts`: для Telegram Business Chatbots исходящее сообщение оператора аналогично ставит бессрочную паузу с причиной `messenger_takeover`.
     - `whatsapp-integration.routes.ts`: в `syncWhatsappDialogHistory` при обнаружении исходящих сообщений оператора в подтянутой истории сделка также помечается на паузу.
     - `deal-messaging.service.ts`:
       - В `getAiStatus` наличие причины `messenger_takeover` или `manual_takeover` всегда возвращает `status: 'paused'` и `isPaused: true` (независимо от того, бессрочная дата или нет).
       - В `setAiControl` и `setContactAiControl` действие `'pause'` переводит сделку в бессрочную паузу с причиной `manual_takeover`.
       - В `sendManagerMessage` отправка сообщения из веб-CRM ставит сделку на бессрочную паузу с причиной `manual_takeover`.
  2. **Фронтенд:**
     - `CrmChatView.tsx`: удален автоматический вызов паузы `handleInputActivity` из `TelegramComposer` (`onFocus`, `onChange`). При открытии чата в системе автопауза не срабатывает.
     - Кнопка паузы в шапке переименована из «Пауза на 1 ч» в «Пауза» и ставит ручной перехват до снятия пользователем.
  3. **База данных:**
     - Обновлены существующие 30 активных сделок MPRO, находившихся в режиме ручного перехвата (`messenger_takeover`/`manual_takeover`), чтобы их таймеры не истекли и бот не перебил диалоги.
- **Верификация:**
  - TypeScript сборка backend: 0 ошибок.
  - Next.js build frontend: 45/45 static pages успешно собрано.
  - Тест `backend/src/tests/chat-from-me.test.ts` обновлен под бессрочную паузу ручного перехвата.
  - Деплой на боевой VPS через `vf-deploy GETVOXLY`.

---

### 24.11.2026 — Синхронизация платежей счетов, автора и категорий операций, запрет ручной смены оплаты в нарядах
- **Контекст и проблема:**
  1. На странице `https://remtoua.getvoxly.ru/finance` в таблице «Операции» отображалась только дата без времени (`24.11.26`).
  2. При оплате счёта колонка «Контрагент» оставалась пустой (`—`), отсутствовала колонка «Автор», а категория операции хардкодилась как «Оплата счёта» с `category_id = NULL`.
  3. При удалении финансовой операции оплаты счёт оставался в статусе `paid` («Оплачен»), кнопка «Принять оплату» не возвращалась (ни в финансах, ни в карточке наряда), а статус наряда оставался «Оплачен».
  4. В таблице наряд-заказов `https://remtoua.getvoxly.ru/repairs` и на тулбаре массовых действий была ручная смена статуса оплаты через `<select>`.
- **Root Cause:**
  1. `TransactionsTable.tsx` форматировал дату через `Intl.DateTimeFormat` только с `day, month, year` без времени.
  2. В `invoices.service.ts:markPaid` аргумент `_user` игнорировался, в `INSERT INTO transactions` не передавались `counterparty_name`, `counterparty_inn`, `created_by`, а категории не подтягивались из `finance_categories`. В таблице `transactions` отсутствовала колонка `created_by`.
  3. `finance.service.ts:bulkDeleteTransactions` только ставил `deleted_at = now()` на транзакциях и пересчитывал баланс кассы, не проверяя `invoice_id` и не откатывая статус счёта и связанных наряд-заказов.
  4. В `RepairsTable.tsx` `PaymentStatusBadge` рендерил выпадающий список `<select>`, а в тулбаре присутствовал селект смены оплаты.
- **Что сделано:**
  1. **База данных:**
     - Создана миграция `0132_transactions_created_by_and_payment_status_sync.sql`: добавлена колонка `created_by UUID REFERENCES users(id)` с индексом, бэкфилл автора, контрагента и категорий, а также сверка статусов зависших счетов и нарядов.
     - Обновлён `backend/src/db/schema.sql`.
  2. **Бэкенд:**
     - `finance.types.ts`: в `TransactionDTO` добавлены `createdById` и `createdByName`.
     - `finance.routes.ts`: в роут создания транзакций передаётся `req.authUser?.id`.
     - `finance.service.ts`: при выборке операций добавлен `LEFT JOIN users u ON u.id = t.created_by`, маппинг в `toTx`, поддержка поиска по автору.
     - В `bulkDeleteTransactions` реализован автоматический откат статуса счёта в `sent` / `overdue` (со сбросом `paid_at` и `paid_account_id`), если сумма активных оплат стала меньше суммы счёта, и синхронизация `payment_status` связанных нарядов через `syncRepairOrderPaymentStatusInTx`.
     - `invoices.service.ts`: в `markPaid` теперь анализируются позиции счёта (`repair_work` vs `repair_part`), выбираются доходные статьи из `finance_categories` тенанта, операция разделяется при наличии и работ, и запчастей, записываются контрагент (компания/контакт, ИНН) и автор (`created_by`).
  3. **Фронтенд:**
     - `TransactionsTable.tsx`: дата форматируется с временем (`formatDateTime`: `dd.mm.yy HH:mm`), ширина колонки расширена до 125px; добавлена колонка «Автор» с иконкой `User`; автор включён в поиск и экспорт в CSV.
     - `RepairsTable.tsx`: `PaymentStatusBadge` заменён на статический read-only бейдж (`<span>`); селект «Оплата» удалён из тулбара групповых действий; удалены неиспользуемые мутации ручной смены оплаты наряда.
     - `use-invoices.ts`: хуки удаления транзакций инвалидируют `["invoices"]` и `["repairs"]`.
- **Верификация:**
  - `tsc --noEmit` в backend и frontend: 0 ошибок.
  - Деплой на боевой сервер через `vf-deploy GETVOXLY`.
  - Проверка отката счёта `СЧ-2026-0006` в `sent` и нарядов №0020, №0021 в `invoiced` на базе `remtoua`.

---

### 24.11.2026 — Блокировка кнопок оплаты и выставления счета при полной оплате наряда/сделки
- **Контекст и проблема:**
  - В карточке наряд-заказа (`/repairs/[id]`, вкладка «Финансы») после отметки счёта или наряда как оплаченных кнопки «Принять оплату» и «Сформировать счёт» оставались активными (зелёной и синей).
  - При наличии и работ, и запчастей в счёте суффиксы `(работы)` / `(запчасти)` в описании операций отличались, хотя все остальные метаданные должны быть абсолютно одинаковыми.
- **Root Cause:**
  - В `FinancialSummary.tsx` кнопки «Принять оплату» и «Сформировать счёт» не проверяли флаг `isFullyPaid` (`disabled={isFullyPaid}`).
  - В `repairs/[id]/page.tsx` в `FinancialSummary` не пробрасывался проп `dealPaymentStatus`.
- **Что сделано:**
  1. **Фронтенд:**
     - В `FinancialSummary.tsx` вычисляется `isFullyPaid` (статус наряда или сделки `paid`, либо все счета оплачены).
     - При `isFullyPaid === true` кнопки «Принять оплату» и «Сформировать счёт» переводятся в неактивное состояние (`disabled`, серый фон `#f5f5f5`, `cursor-not-allowed`, подпись «Оплачено»).
     - Кнопка «+ Новый счёт» скрывается при полной оплате заказа/сделки.
     - Бейдж карточки «Финансовый итог наряда» гарантированно окрашивается в зеленый цвет «Оплачен».
     - В `repairs/[id]/page.tsx` проброшен `dealPaymentStatus={ticket.deal_payment_status}`.
  2. **Бэкенд:**
     - В `invoices.service.ts:markPaid` при разделении платежа на работы и запчасти базовое описание `baseDescription = p.description || \`Оплата счёта №\${inv.invoice_number}\`` передается в обе операции без изменения остальных полей.
- **Верификация:**
  - TypeScript build frontend и backend: 0 ошибок.
  - Деплой на боевой VPS через `vf-deploy GETVOXLY`.

---

### 24.11.2026 — Исправление дедупликации, этапа сделок и обогащения Telegram Bot
- **Контекст и проблема:**
  - При создании сделки через Telegram Bot в режиме секретаря (`telegram_bot`) никнейм и телефон оставались пустыми, дедупликация не находила ранее удаленный контакт, а сделка ошибочно падала на этап «Новый лид» вместо «Первый контакт».
- **Root Cause:**
  - В `channel-identity.ts` константы `CONTACT_CHANNEL_BY_SLUG` и `SOCIAL_KIND_BY_SLUG` не содержали слага `telegram_bot`. Из-за этого `contactSocialsFrom` возвращал пустой массив, а `socialValue(socials, "telegram")` записывал `null` в поле `telegram_username` таблицы `contacts`.
  - В `crm-pipeline.service.ts` выбор этапа проверял `input.channel === "webchat"`: любые другие каналы без телефона и email отправлялись на этап «Новый лид», порождая ложные уведомления менеджерам.
  - При повторном обращении клиента, чей контакт был ранее soft-deleted (`deleted_at IS NOT NULL`), `findContact` создавал дублирующую запись без истории и контактов.
- **Что сделано:**
  1. В `channel-identity.ts` добавлен маппинг `telegram_bot: "telegram"` в `CONTACT_CHANNEL_BY_SLUG` и `SOCIAL_KIND_BY_SLUG`.
  2. В `telegram-bot.service.ts` добавлен метод `getChat` для ресёрча полного профиля и никнейма из Telegram API.
  3. В `crm-pipeline.service.ts` реализовано восстановление soft-deleted контактов при повторном входящем обращении по `telegram_chat_id`, а также выбор системного нулевого этапа «Первый контакт» для всех обращений без телефона и email.
- **Верификация:**
  - `npm --prefix backend run build` — 0 ошибок.
  - Деплой на боевой VPS через `vf-deploy GETVOXLY`.

---

### 24.11.2026 — Исправление интеграции Telegram Business Bot в режиме секретаря
- **Контекст и проблема:**
  - При подключении Telegram-бота в качестве секретаря (Telegram Business) сообщения от оператора и клиента не регистрировались корректно в воронке, сбрасывалась очередь Telegram обновлений, и возникали ошибки отправки ответов через Bot API.
- **Root Cause:**
  - В `telegram-bot.service.ts` стоял `drop_pending_updates: true` при установке вебхука, что приводило к сбросу накопившихся сообщений Telegram при рестартах бэкенда.
  - В `channel_accounts.credentials` для аккаунта `7c3e7432-8740-4b49-9472-08edfdd2877d` находился тестовый `bc_live_test_01`, вызывавший 400 Bad Request при отправке через Bot API.
  - В `telegram-bot-integration.routes.ts` отсутствовало сквозное логирование входящих вебхуков, определение `isFromOperator` зависело от предварительного наличия `business_user_id` в базе данных, а несовпадение `senderId !== chatId` в приватном чате Telegram Business не фиксировалось как исходящее сообщение оператора.
  - Сообщения без текстового поля (голосовые, кружочки, фото) получали пустое `rawText`, а результат отправки сообщений ботом не логировался.
- **Что сделано:**
  1. **Бэкенд:**
     - В `telegram-bot.service.ts` флаг `drop_pending_updates` переключен на `false` (сохранение очереди сообщений при перезапусках).
     - В `telegram-bot-integration.routes.ts` добавлено верхнеуровневое логирование входящих обновлений (`update_id`, `updateKeys`), обработка `business_connection` с удалением connection_id при `isEnabled: false`, извлечение `business_connection_id` из `business_message` без операторной неоднозначности.
     - Улучшена детекция сообщений оператора в режиме секретаря (`senderId !== chatId` в 1-to-1 чате Telegram Business однозначно идентифицирует оператора) с автосохранением `business_user_id`.
     - Добавлено распознавание медиа-сообщений (`voice`, `video_note`, `photo`, `document` и др.) с метками `[Голосовое сообщение]`, `[Видеосообщение]` и т.д.
     - Добавлено логирование результатов `crmPipeline.processIncoming`, исхода `prepareReply` и вызова `service.sendMessage`.
- **Верификация:**
  - `npm --prefix backend run build` — 0 ошибок компиляции TypeScript.
  - Деплой на боевой VPS через `/usr/local/bin/vf-deploy GETVOXLY`.
  - Проверка https://api.getvoxly.ru/health (HTTP 200) и https://getvoxly.ru/login (HTTP 200).

---

### 24.11.2026 — Поле «Подходит к моделям» в модалке массового редактирования товаров склада
- **Контекст и проблема:**
  - На странице `/warehouse` в диалоге массового редактирования товаров («Изменить выбранные») отсутствовало поле «Подходит к моделям».
- **Root Cause:**
  - Схема `bulkUpdateWarehouseItemsSchema` и сервис `bulkUpdateItems` принимали только категорию, бренд, ед. изм., мин. остаток и действия над ценами. Связи `warehouse_item_models` в массовом обновлении не обрабатывались.
  - Компонент `ProductBulkEditDialog` не содержал чекбокса и селектора моделей, а `DictionarySelectField` требовал обязательного выбора бренда для категории `model`.
- **Что сделано:**
  1. **Бэкенд:**
     - В `bulkUpdateWarehouseItemsSchema` добавлены опциональные поля `models`, `model_ids`, `modelIds`, `models_mode`, `modelsMode` (`replace` | `add` | `remove`).
     - В `warehouse.service.ts:bulkUpdateItems` добавлена поддержка обновления моделей: эффективная резолюция недостающих моделей в `equipment_models` и пакетная вставка/удаление связей в `warehouse_item_models` через SQL-кросс-джойн `unnest(...)`.
     - Добавлены модульные тесты валидации в `warehouse-model-filter.test.ts`.
  2. **Фронтенд:**
     - В `use-warehouse.ts` расширен тип `BulkUpdateWarehouseItemsPayload` полями `models`, `model_ids`, `models_mode`.
     - В `DictionarySelectField.tsx` добавлен флаг `allowAllBrands`, позволяющий при необходимости выбирать модели без предварительного выбора бренда (с отображением бренда рядом с моделью).
     - В `ProductBulkEditDialog.tsx` добавлена секция «Подходит к моделям» с поддержкой режимов «Заменить» и «Добавить», мультивыбором через `DictionarySelectField` с чипами и поиском, и динамическим предзаполнением при выборе 1 товара.
- **Верификация:**
  - `cd backend && npx tsc --noEmit && cd ../frontend && npx tsc --noEmit` — 0 ошибок.
  - Тестирование и деплой на сервер.

---

### 24.11.2026 — Полноценный документ оприходования партий (приходная накладная, основания, связка с кассой и остатками)
- **Контекст и проблема:**
  - Кнопка «Оприходовать партию» на `/warehouse` открывала устаревший модал `IntakeModal` на 1 позицию с плоским текстом поставщика.
  - Отсутствовали основания («Заказ поставщику», «Ввод начальных остатков», «Прямое поступление», «Излишки»).
  - Не было связи со статусом оплаты заказов поставщикам (риск повторного списания денег). При начальных остатках не должно списываться движение из кассы.
- **Что сделано:**
  1. **БД и Миграция:**
     - Создана миграция `0133_transactions_supplier_order_id.sql`, связывающая транзакции расхода ДДС с заказами поставщикам.
  2. **Бэкенд:**
     - В `warehouse.types.ts` добавлены схемы `intakeDocumentSchema`, `intakeDocumentItemSchema`, `intakeDocumentBasisSchema`, DTO результата.
     - В `warehouse.service.ts` реализован метод `intakeDocument`, поддерживающий многострочное оприходование, 4 вида оснований (`supplier_order`, `initial_balance`, `direct_purchase`, `inventory_adjustment`), резервирование под заказ-наряды ремонтов, обновление цен номенклатуры и кассовый контур.
     - В `warehouse.routes.ts` зарегистрирован роут `POST /api/v1/warehouse/intake-document`.
  3. **Фронтенд:**
     - В `use-warehouse.ts` добавлен хук `useIntakeWarehouseDocument` с инвалидацией всех складских и финансовых кэшей.
     - Создан компонент `WarehouseIntakeDialog.tsx`:
       - Переключатель оснований (Заказ поставщику / Прямое поступление / Начальные остатки / Излишки).
       - Поиск и быстрое создание контрагента-поставщика (`useCompanies`).
       - Подтягивание заказов поставщикам с контролем оплаты (предотвращение двойного списания).
       - Многострочная таблица с инлайн-редактированием, расчетом сумм и модалкой множественного выбора из каталога номенклатуры.
       - Блок кассы/ДДС с автоматическим отключением при вводе остатков.
     - В `warehouse/page.tsx` кнопка «Оприходовать партию» переведена на `WarehouseIntakeDialog`.
- **Верификация:**
  - `tsc --noEmit` в backend и frontend: 0 ошибок.
  - Деплой на боевой сервер через `vf-deploy GETVOXLY`.


---

### 24.11.2026 — Автоматический перевод сделок в «Успешно реализовано» при выдаче и оплате наряд-заказов
- **Контекст и проблема:**
  - Наряды ремонтов выдавались (статус `issued`) и оплачивались (статус оплаты `paid`), но связанная сделка CRM оставалась в начальной стадии («Новый лид»).
  - Требовалось обеспечить сквозную синхронизацию: если все не удалённые наряды сделки выданы и оплачены, сделка обязана автоматически переходить в стадию «Успешно реализовано» (is_won = true) с сохранением аудита, истории и запуском всех обработчиков закрытия.
- **Что сделано:**
  1. **БД и Миграция:**
     - Создана миграция `0134_sync_completed_repairs_to_won_deals.sql`, переводящая исторические сделки (включая `a65dc0a4-14a4-4013-bc61-ee7c10c404e8`) с полностью выданными и оплаченными нарядами в стадию «Успешно реализовано» с записью в `deal_stage_history`.
  2. **Бэкенд:**
     - В `DealsService` добавлен метод `syncDealCompletionFromRepairs(tenantId, dealId, authorId)`: проверяет наряды сделки, при полном завершении и оплате всех нарядов переводит сделку в won-стадию через `moveStage` (запуск `dealWonHandlers`, списание товаров, фиксация даты `closed_at`, аудит в `deal_stage_history`, уведомления).
     - В `RepairsService` подключён вызов `dealsService.syncDealCompletionFromRepairs` во всех точках изменения статусов нарядов: `changeStatus`, `batchUpdateStatus`, `updatePaymentStatus`, `batchUpdatePaymentStatus`, `update`, `softDelete`, `batchDelete`.
     - В `FinanceService` (`batchPayment`, `syncRepairOrderPaymentStatusInTx`) и `InvoicesService` (`updateStatus` при оплате счетов) подключён вызов синхронизации завершения сделки.
  3. **Фронтенд:**
     - В `use-repairs.ts` и `use-invoices.ts` добавлена инвалидация запросов `["deals"]` при пакетных сменах статусов нарядов, оплаты и приёме платежей.
  4. **Тесты:**
     - Добавлен юнит-тест `backend/src/tests/deals-repair-completion-sync.test.ts`.
- **Верификация:**
  - `tsc --noEmit` в backend и frontend: 0 ошибок.
  - Деплой на боевой сервер через `vf-deploy GETVOXLY`.

---

### 24.11.2026 — Поддержка нескольких Telegram Business подключений в одном боте и изоляция операторов
- **Контекст и root cause:**
  - Официальный Telegram-бот может быть подключен в качестве секретаря (Telegram Business) сразу к нескольким аккаунтам менеджеров.
  - Ранее в `channel_accounts.credentials` хранился только один `business_connection_id` и `business_user_id`. При подключении второго аккаунта старое подключение перезаписывалось.
  - При обмене сообщениями между подключенными бизнес-аккаунтами или сообщениях от операторов условие `isFromOperator` использовало глобальный `business_user_id` и проверку `senderId !== chatId`, из-за чего входящие сообщения от других аккаунтов ошибочно маркировались как исходящие оператора и буферизовались в Redis вместо создания сделки/контакта в CRM.
- **Что сделано:**
  1. В `TelegramBotService` добавлен метод `getBusinessConnection(token, connectionId)` для динамической загрузки актуальных метаданных подключения из Telegram Bot API.
  2. В `TelegramBotService.sendOutbound` добавлено определение `business_connection_id` из сделки (`custom_fields->>'business_connection_id'`) или метаданных сообщения.
  3. В `telegram-bot-integration.routes.ts` реализована карта `credentials.business_connections`: теперь бот поддерживает неограниченное число одновременных бизнес-подключений.
  4. Определение оператора изолировано в контекст конкретного `business_connection_id`: отправитель считается оператором только если `senderId === operatorUserId` данного подключения.
  5. При создании сделки `business_connection_id` сохраняется в `deals.custom_fields`, а при ответе оператора — в `deal_messages.metadata`.
  6. Буферизация и сброс сообщений оператора в Redis изолированы по `business_connection_id`.
- **Верификация:**
  - `npm --prefix backend run build` (tsc): 0 ошибок.
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY`.

---

### 24.11.2026 — Исправление ошибки React Rules of Hooks в диалоге оприходования склада
- **Контекст и проблема:**
  - При нажатии на кнопку «Оприходовать партию» на странице `/warehouse` приложение падало с ошибкой «Не удалось отобразить раздел» (ErrorBoundary).
  - Root Cause: В `WarehouseIntakeDialog.tsx` хук `useMemo` для фильтрации товаров каталога (`filteredCatalogItems`) находился ПОСЛЕ раннего выхода `if (!open) return null;`. При смене `open` с `false` на `true` React фиксировал изменение порядка и количества хуков («Rendered more hooks than during the previous render»).
- **Что сделано:**
  - В `WarehouseIntakeDialog.tsx` все хуки (`useState`, `useMemo`, `useEffect`, `useRef`) перенесены на верхний уровень до любых условий и условных выходов.
  - Ранний возврат `if (!open) return null;` перенесён непосредственно перед финальным JSX `return (...)`.
  - Добавлена строгая проверка `Array.isArray` для `safeSupplierOrders`, `safeItems`, `safeAccounts`.
  - В `warehouse/page.tsx` добавлено условное монтирование `{intakeModalOpen && <WarehouseIntakeDialog ... />}`.
- **Верификация:**
  - `tsc --noEmit` в backend и frontend: 0 ошибок.
  - Деплой на боевой сервер через `vf-deploy GETVOXLY`.

---

### 24.11.2026 — Разрешение входящих лидов/сделок в ботах для аккаунтов тенанта и сброс is_personal
- **Контекст и root cause:**
  - При тестировании Telegram Business бота пользователь отправлял сообщения со своего основного аккаунта Telegram (`@genadich_agency` / `5973721183`).
  - В `crm-pipeline.service.ts` проверка `ownAccount` проверяла отправителя по таблицам `channel_accounts` и `users`. Поскольку владелец тенанта зарегистрирован в `users` и имеет подключенный MTProto-канал, пайплайн отбрасывал сообщение с логом `Skipping lead/contact creation: sender is tenant's own channel account or user`.
  - Кроме того, в контактах для данного `telegram_chat_id` стоял флаг `is_personal = true`, что блокировало создание сделок даже при явном обращении к боту.
- **Что сделано:**
  1. В `backend/src/modules/crm/crm-pipeline.service.ts`: фильтрация `ownAccount` ограничена только личными каналами (MTProto), для `telegram_bot` и `webchat` она отключена, так как операторы и владельцы должны иметь возможность тестировать ботов или оформлять заказы через них.
  2. Игнорирование сообщений по флагу `contact.is_personal` отключено для каналов `telegram_bot` и `webchat`.
  3. В БД на боевом сервере сброшен флаг `is_personal = false` для контактов с `telegram_chat_id = '5973721183'`.
- **Верификация:**
  - `npm --prefix backend run build` (tsc): 0 ошибок.
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY`.
  - Верификация создания сделки и сообщений в БД и CRM.

---

### 24.11.2026 — Добавление столбца «Мин. ост.» и сортировки в каталоге склада
- **Контекст и задача:**
  - На странице `/warehouse` в таблице номенклатуры отсутствовал столбец минимального остатка («Мин. ост.»), а также требовалась поддержка сортировки по данному столбцу.
- **Что сделано:**
  1. В `frontend/src/app/(dashboard)/warehouse/page.tsx` поле `minStock` добавлено в тип `ItemSortField`.
  2. В заголовок таблицы номенклатуры (`<thead>`) добавлен интерактивный столбец «Мин. ост.» с сортировкой (переключение asc/desc/сброс, иконки `ArrowUp`/`ArrowDown`/`ArrowUpDown` и подсветка активного фильтра).
  3. В строки таблицы (`<tbody>`) добавлена ячейка со значением `item.minStock` и единицей измерения `item.unit` (или `0` при отсутствии порога).
  4. Обновлён `colSpan={12}` для строки пустого состояния таблицы номенклатуры.
- **Верификация:**
  - `tsc --noEmit` в backend и frontend: 0 ошибок.
  - Деплой на боевой сервер через `/usr/local/bin/vf-deploy GETVOXLY`.

---

### 24.11.2026 — Исправление сбоя расходных операций, снятие блокировки списания в минус и отладка UI
- **Контекст и root cause:**
  - На странице `/finance` при оформлении расхода и нажатии кнопки «Списать» операция не создавалась и не отображалась в списке (молчаливый отказ).
  - Root Cause 1: В `finance.types.ts` поле `occurred_at` валидировалось через `z.string().datetime()`, требующий полного формата RFC 3339 с `Z`. Браузерный HTML5 `<input type="datetime-local">` передавал строку вида `YYYY-MM-DDTHH:mm` (`2026-11-24T16:14`), что приводило к `ZodError: Invalid datetime` и отказу Fastify с кодом HTTP 400.
  - Root Cause 2: В `finance.service.ts` стояла блокировка `if (sign < 0 && Number(a.balance) < p.amount) throw new AppError(409, "INSUFFICIENT_FUNDS")`. Для кассы с нулевым остатком (например, «Основная касса (Наличные)» с балансом 0 ₽) списание стопорилось ошибкой 409.
  - Root Cause 3: В схемах Zod поле `category_id` строго требовало UUID (`z.string().uuid()`), тогда как при отсутствии пользовательских категорий или переключении типа использовались fallback-слаги (`rent`, `parts_purchase`). Невалидный UUID блокировал валидацию формы на клиенте (`isValid: false`) и делал кнопку «Списать» неактивной или вызывал сбой.
  - Root Cause 4: В `CreateTransactionModal.tsx` вызов `onSubmit(payload)` не ожидался через `await`, форма сбрасывалась и закрывалась синхронно, а ошибки API не перехватывались и проглатывались без отображения пользователю.
- **Что сделано:**
  1. **Backend:**
     - В `finance.types.ts` валидация `occurred_at` заменена на гибкий `flexibleDate`, принимающий как ISO с часовым поясом, так и `datetime-local` (`YYYY-MM-DDTHH:mm`).
     - Поля `category_id`, `deal_id`, `repair_order_id`, `invoice_id` сделаны опциональными и nullable.
     - В `finance.service.ts` убрана блокировка `INSUFFICIENT_FUNDS` при списании и переводах: разрешён уход баланса в минус (овердрафт кассы). Добавлены безопасные парсеры `safeUuid` и `safeDate`, исключающие сбои синтаксиса UUID в PostgreSQL.
  2. **Frontend:**
     - В `finance.schema.ts` скорректирована схема `createTransactionSchema` и `updateTransactionSchema`.
     - В `CreateTransactionModal.tsx` добавлен асинхронный `handleSubmit` с `try/catch`, отображением ошибки в alert-баннере, индикатором загрузки (`submitting`) на кнопке «Списать» и нормализацией даты в ISO.
     - В `page.tsx` добавлены всплывающие уведомления `toast.success` / `toast.error` через Sonner.
     - В `use-invoices.ts` обновлены типы и добавлена инвалидация кэшей счетов, транзакций и PnL.
  3. **Тесты:**
     - Добавлен юнит-тест `backend/src/tests/finance-negative-balance.test.ts`.
- **Верификация:**
  - `tsc --noEmit` в frontend и backend: 0 ошибок.
  - Деплой на боевой сервер через `vf-deploy GETVOXLY`.
  - Проверка создания расхода с уходом в минус на живом сервере.

---

### 24.11.2026 — Реализация кнопки и прямого создания «Заказа поставщику» во вкладке склада
- **Контекст и root cause:**
  - На странице `https://remtoua.getvoxly.ru/warehouse` во вкладке «Заказы поставщикам» отсутствовала кнопка создания заказа. Пользователь мог сформировать заказ только опосредованно, перейдя во вкладку «Заявки на закупку» и выбрав существующие заявки.
  - Модальное окно `CreateSupplierOrderModal.tsx` было рассчитано только на агрегированные заявки: при пустом списке заявок таблица позиций была пуста, отсутствовала возможность добавить произвольные товары или выбрать позиции из справочника номенклатуры.
  - На бэкенде отсутствовал безопасный парсинг пустых строк в UUID-полях заказа (`safeUuid`).
- **Что сделано:**
  1. **UI и тулбар вкладки (`frontend/src/app/(dashboard)/warehouse/page.tsx`):**
     - В панель инструментов вкладки «Заказы поставщикам» (справа от поисковой строки, в соответствии с макетом) добавлена основная кнопка `+ Заказ поставщику`.
     - В блоке пустого состояния вкладки добавлена кнопка `+ Создать заказ поставщику`.
     - При клике сбрасываются старые выборки заявок, и окно создания открывается в режиме нового прямого заказа на склад.
  2. **Форма создания (`frontend/src/components/warehouse/CreateSupplierOrderModal.tsx`):**
     - Реализован гибридный режим: работа как от выбранных заявок, так и прямое создание с нуля.
     - Добавлен выбор статуса заказа («Ожидает оплаты» / «Черновик»).
     - Добавлена возможность добавлять (`+ Добавить товар`), редактировать и удалять (`Trash2`) произвольные позиции.
     - Интегрирован автокомплит / datalist по справочнику номенклатуры (`useWarehouseItems`): при выборе товара автоматически подставляются `itemId`, `sku`, `unit` и закупочная/розничная цена.
     - Пересчёт итоговой суммы заказа и валидация на наличие хотя бы одного заполненного товара.
  3. **Backend & Types (`backend/src/modules/warehouse/`):**
     - В `createSupplierOrderSchema` поддержан выбор статуса (`draft`, `pending_payment`) и допустимость пустых строк для необязательных UUID-полей (`supplier_company_id`, `item_id`, `repair_order_id`, `purchase_request_id`).
     - В `warehouse.service.ts` добавлены функции `safeUuid` и безопасное создание заказа со статусом из payload без обязательной привязки к заявкам на закупку.
  4. **API клиент (`frontend/src/lib/api/use-warehouse.ts`):**
     - В `CreateSupplierOrderPayload` добавлено поле `status`.
- **Верификация:**
  - `tsc --noEmit` в frontend и backend: 0 ошибок.


---

### 24.11.2026 — Персистентность фильтров на `/repairs` и `/crm/deals`
- **Контекст и root cause:**
  - На страницах `/repairs` (`filterStatus`, `filterPaymentStatus`, `searchQuery`) и `/crm/deals` (`presetView`, `pipelineId`, `search`, `sortBy`) фильтры хранились в локальном `useState`. При переходе на другой раздел, возврате «Назад» и перезагрузке страницы (F5) выбор пользователя сбрасывался.
- **Что сделано:**
  1. **Shared State Layer (`frontend/src/lib/hooks/use-persisted-filters.ts`):**
     - Создан переиспользуемый строго типизированный хук `usePersistedFilters` с изоляцией ключа `localStorage` по `tenant` (`slug || tenantId`), `userId` и `pageKey` (`getvoxly:filters:v1:<tenant>:<userId>:<pageKey>`).
     - Приоритет восстановления: явные URL query-параметры > `localStorage` > значения по умолчанию.
     - Защита от SSR hydration mismatch (чтение строго в `useEffect` после завершения загрузки `useAuth`), защита от битого JSON и устаревших/невалидных значений через per-field `parse`.
     - Синхронизация с URL через `window.history.replaceState` без затирания сторонних параметров (`?record=`, `?dealId=`, `?create=` и т.д.).
     - Метод `resetFilters()` очищает и состояние, и запись в `localStorage`, и управляемые параметры URL.
  2. **Интеграция `/repairs` (`frontend/src/app/(dashboard)/repairs/page.tsx`, `frontend/src/components/repairs/RepairsTable.tsx`, `frontend/src/lib/api/use-repairs.ts`):**
     - Подключён `usePersistedFilters` для `status`, `paymentStatus`, `search`.
     - В `useRepairs` добавлен опциональный второй аргумент `{ enabled?: boolean }` (обратно совместим со всеми потребителями `RecordRepairsTab.tsx`, `deal-tabs.tsx`); запрос не уходит с дефолтными параметрами до гидрации сохранённых фильтров.
     - В `RepairsTable` добавлена кнопка «Сбросить» (видна при активных фильтрах) и очистка поля поиска (`X`).
  3. **Интеграция `/crm/deals` (`frontend/src/app/(dashboard)/crm/deals/page.tsx`):**
     - Подключён `usePersistedFilters` для `presetView`, `pipelineId`, `search`, `sortBy`.
     - Добавлена защита от удалённой воронки (`pipelineId` валидируется против `pipelines.data`, при отсутствии автоматически сбрасывается на первую доступную).
     - В строку срезов добавлена кнопка «Сбросить» при активных фильтрах.
  4. **Тесты:**
     - `frontend/src/lib/hooks/use-persisted-filters.test.tsx` (6 тестов), `frontend/src/app/(dashboard)/repairs/repairs-filters-persistence.test.tsx`, `frontend/src/app/(dashboard)/crm/deals/deals-filters-persistence.test.tsx` (2 теста).
- **Где ещё используется:**
  - `useRepairs` используется в `RecordRepairsTab.tsx`, `deal-tabs.tsx`, `repairs/page.tsx` (обратная совместимость сохранена).
  - `RepairsTable` используется только в `repairs/page.tsx` (экспорт `formatOrderNumber` также в `deal-tabs.tsx` и `repairs/[id]/page.tsx`).

---

### 24.11.2026 — Аудит и исправление связки Склад (Заказы поставщикам → Оплатить) ↔ Финансы (Категория и Автор)
- **Контекст и root cause:**
  1. В `warehouse.service.ts` во всех 5 точках создания расходных проводок (`paySupplierOrder`, `createReceiptFromSupplierOrder`, `intakeBatch`, `intakeDocument` для `supplier_order` и `direct_purchase`) при `INSERT INTO transactions` передавался только `category_id` без `category_name` (оставалась пустая строка `''`), и создавалась категория `'Закупка запчастей и комплектующих'` вместо `'Закупка запчастей'`.
  2. В `paySupplierOrder` параметр `_userId` игнорировался, а в `createReceiptFromSupplierOrder` и `intakeBatch` поле `created_by` не передавалось в `INSERT INTO transactions`. Кроме того, `paySupplierOrder` и `createReceiptFromSupplierOrder` не заполняли `supplier_order_id` и не защищали от повторной оплаты.
  3. В `finance.routes.ts` / `finance.service.ts`: `updateTransaction`, `transfer`, `bulkDuplicateTransactions`, `createAccount` не передавали/не возвращали `created_by` / `created_by_name`; `transactions()` не делал `LEFT JOIN finance_categories` для фоллбэка пустого `category_name`; `bulkDeleteTransactions()` не откатывал статус связанных `supplier_orders`.
  4. На фронтенде `EditTransactionModal.tsx` сбрасывал `category_id` в `""` при открытии, а `useUpdateSupplierOrder` и мутации удаления/редактирования транзакций в `use-invoices.ts` не инвалидировали кэш смежного модуля.
- **Что сделано:**
  1. **Backend (`warehouse.service.ts`):**
     - Вынесены единые хелперы `resolvePartsPurchaseCategoryInTx` (приоритет «Закупка запчастей» → `%запчаст%` → автосоздание «Закупка запчастей»), `recalculateCashAccountBalanceInTx`, `resolveSupplierOrderRepairIdInTx`.
     - Исправлены все 5 точек создания транзакций: всегда записываются `category_id`, `category_name`, `created_by`, `supplier_order_id` (и `repair_order_id` при однозначной связке), `occurred_at = now()`, пересчитывается баланс кассы.
     - В `paySupplierOrder` и `createReceiptFromSupplierOrder` добавлена защита от двойной оплаты и отменённых заказов; в `updateSupplierOrder` (отмена/правка) и `deleteSupplierOrdersInTx` переведено на soft delete транзакций с пересчётом баланса.
     - В `intakeDocument` исправлены несуществующие имена колонок `paid_cash_account_id`/`paid_comment` → `cash_account_id`/`finance_transaction_id`.
  2. **Backend (`finance.service.ts`, `finance.routes.ts`, `finance.types.ts`, `tenant-defaults.ts`):**
     - `req.authUser?.id` передаётся в `updateTransaction`, `transfer`, `bulkDuplicateTransactions`, `createAccount`.
     - `updateTransaction` сохраняет/восстанавливает `created_by = COALESCE(created_by, $23)` и возвращает `created_by_id`, `created_by_name`, `supplier_order_id`, `category_name`.
     - `transactions()` и `pnl()` используют `LEFT JOIN finance_categories` (`COALESCE(NULLIF(BTRIM(t.category_name), ''), fc.name, '')`).
     - `bulkDeleteTransactions` при удалении расходной операции откатывает связанные `supplier_orders` из `paid` в `pending_payment` и сбрасывает `paid_at` / `finance_transaction_id`.
     - Добавлена миграция-бэкфилл `backend/src/db/migrations/0135_sync_supplier_order_transactions_category_and_author.sql`.
  3. **Frontend (`EditTransactionModal.tsx`, `TransactionsTable.tsx`, `finance/page.tsx`, `finance.types.ts`, `use-invoices.ts`, `use-warehouse.ts`):**
     - Корректная предзагрузка `category_id` в `EditTransactionModal` без затирания при сохранении, отображение фоллбэка «Без категории», двусторонняя инвалидация кэшей `["finance"]` ↔ `["warehouse"]`.
  4. **Тесты:** добавлен `backend/src/tests/warehouse-finance-sync.test.ts` (4 теста).

### 2026-11-24 — Частичное оприходование заказов поставщикам + Landed Cost (распределение доп. расходов)
- **Root cause / задача:** Окно оприходования заказа поставщику принимало заказ только целиком и не позволяло учитывать дополнительные расходы поставки (доставка, курьер и др.) с распределением на себестоимость складских партий и отражением в `/finance`.
- **Что сделано:**
  1. **БД (`0137_supplier_order_partial_receipts_and_landed_cost.sql`, `schema.sql`):**
     - Добавлена колонка `supplier_order_items.received_quantity` (с бэкфиллом для уже принятых заказов).
     - Созданы таблицы `supplier_order_receipts`, `supplier_order_receipt_items`, `supplier_order_receipt_costs` с `tenant_id`, индексами и RLS.
     - В `warehouse_batches` добавлены `receipt_id`, `base_purchase_price`, `landed_cost_per_unit`, `landed_cost_total` (с бэкфиллом `base_purchase_price = purchase_price`).
     - В `transactions` добавлены `supplier_order_receipt_id`, `is_capitalized_cost`.
  2. **Backend (`landed-cost.utils.ts`, `warehouse.service.ts`, `warehouse.types.ts`, `finance.service.ts`, `finance.types.ts`):**
     - `allocateLandedCost` считает распределение доп. расходов в целых копейках (`by_value`, `by_quantity`, `manual`, остаток округления на последнюю активную строку).
     - `createReceiptFromSupplierOrder` блокирует заказ и строки `FOR UPDATE`, защищает от переприёмки, создаёт запись приёмки, партии FIFO с `purchase_price = effectiveUnitPrice`, отдельные расходные транзакции по доп. расходам с `is_capitalized_cost = true` и переводит статус заказа в `partially_received` или `received`.
     - `deleteSupplierOrdersInTx` откатывает в том числе транзакции доп. расходов по всем приёмкам и пересчитывает балансы затронутых счетов.
     - `FinanceService.pnl` исключает `is_capitalized_cost = true` из операционных расходов и отдаёт их в `capitalizedCosts` (исключён двойной учёт с FIFO `partsCogs`).
  3. **Frontend (`ReceiptSupplierOrderModal.tsx`, `warehouse/page.tsx`, `SupplierOrderDetailModal.tsx`, `EditSupplierOrderModal.tsx`, `ProfitLossView.tsx`, `use-warehouse.ts`, `use-invoices.ts`, `landed-cost.ts`):**
     - Переработана модалка приёмки: частичные количества по строкам, блок доп. расходов (описание, сумма, категория, счёт), выбор метода распределения и live-предпросмотр себестоимости каждой партии.
     - На `/warehouse` добавлен статус «Частично оприходован», прогресс `Принято X из Y`, бейдж доп. расходов, кнопка «Доприходовать» и разбивка `база + доп.` в таблице партий; в деталях заказа добавлена «История приёмок».
     - В `ProfitLossView.tsx` добавлена информационная плашка для `pnl.capitalizedCosts`.
  4. **Где ещё используется модель партий:** `repairs.service.ts` (`consumeFifo`), `warehouse.service.ts` (`fulfillWonDealIfReadyInTx`), оценка склада и `finance.service.ts` (`pnl` → `partsCogs`) читают `warehouse_batches.purchase_price`, поэтому новая себестоимость автоматически применяется без правок потребителей.
  5. **Тесты:** добавлены `backend/src/tests/warehouse-partial-receipt-landed-cost.test.ts` (9 тестов) и `frontend/src/lib/warehouse/landed-cost.test.ts` (4 теста).

---

## 2026-11-24 — Реверс-аудит 7 репозиториев MAX и надёжное извлечение ФИО и телефона контакта
- **Контекст и root cause:**
  1. При входящем сообщении MAX (`PUSH_MESSAGE` opcode 128) сам протокол передаёт только `sender` (`userId`) без `phone` и `names`. В `max-integration.routes.ts` (`internalInboundSchema`) отсутствовали поля `lastName`, `fullName`, `names` и парсинг вложений `CONTACT` (`vcfBody`), а `maxProfile` не передавал `lastName` в `CrmPipelineService`.
  2. В `MaxTsAdapter.ts` heartbeat использовал `INIT (op 6)` вместо `PING (op 1)`, `resolveContact` был заглушкой без `CONTACT_INFO (op 32)` и `CONTACT_INFO_BY_PHONE (op 46)`, а `handleIncomingMessage` не запрашивал профиль по `senderId`.
  3. В `MaxBridgeAdapter.ts` поле `timestamp` жёстко умножалось на `1000` без проверки миллисекунд (`> 1e11`).
- **Что сделано:**
  1. Создан [max-identity.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/max-identity.ts): `extractMaxIdentity`, `normalizeMaxPhone`, `parseMaxVCard` (разбор `names[]` с приоритетом `ONEME` → `CUSTOM`, `firstName`/`lastName`/`fullName`, вложений `CONTACT`/`vcfBody`, защита от `selfPhone` INC-113, `isFakeOrDummyPhone`, `isBannedName`).
  2. Обновлены [max-integration.routes.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/max-integration.routes.ts) и [max-bridge.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/max-bridge.service.ts): расширена схема, добавлен best-effort дозапрос `getPrivateDialogs` при неполных ФИО/телефоне, передача `lastName` в `ChannelProfile`, учёт `tenantId` в ключе `isDuplicateInbound`.
  3. Обновлены [MaxTsAdapter.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/messaging/adapters/max/MaxTsAdapter.ts) (опкоды `PING=1`, `CONTACT_INFO=32`, `CONTACT_INFO_BY_PHONE=46`, `MARK_READ=50`, кэш контактов 10 мин, формат `GET_HISTORY`/`MSG_SEND`) и [MaxBridgeAdapter.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/messaging/adapters/max/MaxBridgeAdapter.ts) (нормализация `timestamp`).
  4. Добавлены unit-тесты [max-identity.test.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/tests/max-identity.test.ts).
- **Проверка:** `npm --prefix backend run typecheck` (0 ошибок), `vitest` (`max-identity.test.ts` + `max-internal-auth.test.ts` — 13/13 passed), `tsx --test` (`messaging-adapters.test.ts` — 8/8 passed).

---

### 24.11.2026 — Расследование и исправление молчания AI-бота в онлайн-виджете (WebChat Lead Salvage & Drafts)
- **Контекст и root cause:**
  - В тенанте `bankrotstvo` в сделке `68bc2e8a-3a7c-4821-a941-250bf2d00cd1` посетитель сайта ввёл текст «За жкх могу списать долг» на странице `/mfc`.
  - Посетитель закрыл вкладку браузера / перешёл назад до нажатия кнопки «Отправить». Браузер сработал по `beforeunload` в `widget.js` (строка 4585) и отправил `POST /api/v1/public/chat/message/:channelAccountId` через `sendBeacon` с флагом `isDraft: true` (спасение лида).
  - В `backend/src/modules/channels/webchat.service.ts` метод `executeProcessIncomingMessage` вызывал `crm.processIncoming`, который создал контакт `260d144b-243c-4380-a278-e009593f7186`, сделку `68bc2e8a-3a7c-4821-a941-250bf2d00cd1` и входящее сообщение в `deal_messages` без пометки о черновике.
  - Сразу после этого строка 872 (`if (input.isDraft) return { replies: [], status: "queued" }`) немедленно прерывала обработку ДО вызова `agentPipeline.prepareReply`.
  - В результате: бот промолчал, ответ не был сформирован, в журнале `ai_usage_log` записей не появилось, а в CRM сделка выглядела так, будто клиент задал вопрос, а бот сломался или проигнорировал его. При повторном открытии чата посетителем ответ также отсутствовал.
- **Что сделано:**
  1. **Backend (`webchat.service.ts`):**
     - Убран ранний выход `if (input.isDraft) return` до вызова AI-агента.
     - Теперь при `account.isAiEnabled` AI-агент формирует квалифицированный ответ и для спасённых черновиков через `prepareReply`, а `saveAgentReply` сохраняет его в `deal_messages`.
     - При этом для `isDraft` клиенту не возвращаются лишние всплывающие сообщения/заглушки (`replies: []`), но диалог в CRM и история виджета обогащены ответом агента.
     - При сбое LLM для черновиков шаблонный автоответ-заглушка оператора не создаётся (диалог тихо ожидает оператора).
  2. **Backend (`crm-pipeline.service.ts`):**
     - В `InboundMessageInput` добавлен параметр `isDraft?: boolean`.
     - В `deal_messages.metadata` теперь явно сохраняется `{ is_draft: true, draft_reason: "lead_salvage" }`.
     - В заголовок создаваемой из черновика сделки добавляется суффикс `(Черновик)`.
  3. **Frontend (`widget.js`):**
     - Устранена ложная отправка черновика на каждое стирание поля ввода (`current === ''` при `input`). Черновик теперь сохраняется надёжно при выходе со страницы (`beforeunload`).
  4. **Frontend (`CrmChatView.tsx`):**
     - Добавлено визуальное отображение бейджа «Черновик» в шапке пузыря и предупреждения «Неотправленный черновик (посетитель покинул сайт)» для входящих сообщений с `metadata.is_draft: true`.
  5. **Исправление существующей сделки:**
     - В сделке `68bc2e8a-3a7c-4821-a941-250bf2d00cd1` сообщение `314b6a24-4155-40cd-a10f-aed4292c919c` помечено как черновик и сгенерирован/сохранён ответ от подключенного агента «Банкирро Бот».

---

### 2026-11-27 — Модалка «Новый заказ поставщику»: заполнение новой компании по ИНН, удаление дубля кнопки и создание товара в базе
- **Root cause:**
  1. В `CreateSupplierOrderModal.tsx` и `EditSupplierOrderModal.tsx` блок создания нового контрагента не вызывал `/api/v1/crm/companies/lookup-inn` и передавал в `useCreateCompany` только `name`/`inn`/`phone`.
  2. В `CreateSupplierOrderModal.tsx` в шапке таблицы позиций и под ней были две одинаковые кнопки (`+ Добавить товар` и `+ Добавить ещё одну позицию`).
  3. Поле товара использовало нативный `<datalist>` без возможности создать отсутствующий товар в `warehouse_items`, а `handleItemNameChange` не сбрасывал `itemId` при изменении названия; в `useCreateWarehouseItem` инвалидировался точный ключ `["warehouse", "items", ""]` вместо префикса `["warehouse", "items"]`.
- **Что сделано:**
  1. `CreateSupplierOrderModal.tsx` и `EditSupplierOrderModal.tsx`: подключён `useCompanyInnLookup` + кнопка «Заполнить по ИНН», автоподстановка названия, КПП, ОГРН и юр. адреса из ФНС/DaData и сохранение полных реквизитов при создании компании.
  2. `CreateSupplierOrderModal.tsx`: удалена дублирующая кнопка `+ Добавить товар`, оставлена только `+ Добавить ещё одну позицию`; `<datalist>` заменён на интерактивный комбобокс товаров с кнопкой и inline-формой «Создать в базе и добавить» (`useCreateWarehouseItem`).
  3. `frontend/src/lib/api/use-warehouse.ts`: исправлена инвалидация `["warehouse", "items"]` и `["warehouse", "categories"]` в `useCreateWarehouseItem` и `useUpdateWarehouseItem`.

### 2026-11-27 — Унификация создания товаров и услуг во всём приложении на единые модалки из `/warehouse`
- **Root cause:** В заказе поставщику (`CreateSupplierOrderModal`), карточке наряда (`PartAddModal`, `WorkItemsTable`), карточке сделки (`DealProductAddModal`, `DealProductsServicesTab`) и справочнике услуг (`ServiceCatalogDialog`) использовались урезанные дублирующие формы без бренда, категории, моделей (для товаров) и без ед. измерения / длительности (для услуг).
- **Что сделано:**
  1. `CreateItemModal.tsx`: добавлены опциональные пропсы `initialName`/`initialSku`/`initialUnit`/`initialCostPrice`/`initialRetailPrice`, `showQuantity`, `showPurchaseRequestOption` и `onCreated(item, extra)` при 100% сохранении эталонного вида `/warehouse`.
  2. `CreateOrEditServiceModal.tsx`: добавлены опциональные пропсы `initialName`, `initialPrice`, `submitLabel`, `onCreated(service)`.
  3. Переведены на `CreateItemModal`: `CreateSupplierOrderModal.tsx` (удалена самодельная inline-форма), `PartAddModal.tsx` (наряды `/repairs/[id]`), `DealProductAddModal.tsx` (сделки CRM `/crm/deals/[id]`).
  4. Переведены на `CreateOrEditServiceModal`: `ServiceCatalogDialog.tsx` (кнопка «Добавить услугу» вместо урезанного inline-бара), `WorkItemsTable.tsx`, `DealProductsServicesTab.tsx`; в `useCreateService` добавлена инвалидация `["repair-services-catalog"]`.

---

### 24.11.2026 — Автоскролл при печати и 2x замедление набора в онлайн-виджете
- **Контекст и задача:**
  - В процессе посимвольного вывода сообщения бота (`typeWriter`) текст сообщений накапливался и уходил вниз под поле ввода, если пользователь не прокручивал чат вручную.
  - Скорость набора текста была слишком быстрой (12 мс/символ), требовалось замедлить печать в 2 раза (до 24 мс/символ) во всех компонентах и скриптах виджета с поддержкой sticky-автоскролла (без перехвата скролла при ручном изучении истории пользователем, порог 100px).
- **Что сделано:**
  1. **Standalone Embed Script (`frontend/public/widget.js`, `backend/src/modules/channels/widget-script.ts`):**
     - Внедрён трекер ручной прокрутки `userScrolledUp = dist > 100` на `messagesContainer`.
     - Функция `scrollToBottom(smooth, force)` учитывает положение пользователя и сбрасывает флаг при принудительном скролле.
     - В `typeNextChar` скорость изменена с 12 мс на 24 мс на символ, и на каждом символе/переносе строки вызывается автоскролл `messagesContainer.scrollTop = messagesContainer.scrollHeight` (если пользователь не отмотал наверх).
     - При отправке и получении нового сообщения вызывается гарантированный скролл вниз.
  2. **React UI (`ChatWidget.tsx`, `WidgetSettings.tsx`, `widget/page.tsx`):**
     - В `ChatWidget.tsx` добавлен `scrollContainerRef` с обработчиком `onScroll={handleScroll}` и флагом `isNearBottomRef` (порог 100px).
     - В `typeWriter` на каждом шаге `step()` вызывается `scrollToBottom(false)`, удерживая нижний край печатаемого текста над полем ввода.
     - При отправке пользователем и приходе нового ответа бота вызывается `scrollToBottom(true)`.
     - Дефолтное значение `typingSpeed` изменено с 12 мс на 24 мс во всех местах (`ChatWidget`, `WidgetSettings`, `widget/page.tsx`).
     - В `WidgetSettings.tsx` обновлены пресеты скорости: 48 мс (Плавная), 24 мс (Норм), 12 мс (Быстрая).
  3. **Тесты:**
     - В `frontend/__tests__/ChatWidget.typing.test.tsx` добавлены тесты на пресеты скорости (48/24/12 мс) и автоскролл во время набора `ChatWidget auto-scrolls down during typewriter typing ticks`. Все 10 тестов проходят успешно.

---

### 24.11.2026 — Мастер-выключатель уведомлений пользователя на /settings/notifications (Full Silence & Preferences)
- **Контекст и взаимосвязи:**
  - На странице `https://mpro.getvoxly.ru/settings/notifications` уведомления пользователю были включены по умолчанию без возможности их глобально отключить единым тумблером.
  - В проекте действуют несколько уровней уведомлений:
    1. **In-App (SSE + Toaster + Колокольчик):** создание записей в `inapp_notifications`, realtime-шина `notificationEventBus`, стрим `/api/v1/notifications/stream`, хук `useInAppNotifications`, двухтоновый синтезированный звук `playNotificationChime()`.
    2. **Web Push & PWA (VAPID):** подписки `push_subscriptions`, фоновая доставка через `webpush.sendNotification`, `sendNotificationToUser` и `sendNotificationToTenant`.
    3. **Каналы лид-уведомлений команды:** `tenant_notification_channels` (Email, Telegram Bot, WhatsApp, Битрикс24) и фолбэк на email владельца/админа (`defaultRecipient`) в `lead-notification.queue.ts`.
- **Что реализовано:**
  1. **БД и миграция `0136_user_notifications_master_toggle.sql`:**
     - Колонка `notifications_enabled BOOLEAN NOT NULL DEFAULT true` в таблице `users` (нулевые накладные расходы при проверках).
     - Таблица `user_notification_settings` с RLS (`tenant_isolation`), уникальным ограничением `(tenant_id, user_id)` и флагами `notifications_enabled`, `sound_enabled`, `inapp_enabled`, `push_enabled` (все `DEFAULT true`).
     - Сохранена обратная совместимость: для существующих и новых пользователей без явного отказа всё включено по умолчанию.
  2. **Backend API и диспетчеры:**
     - Сервис `NotificationPreferencesService` (`getUserPreferences`, `updateUserPreferences` с UPSERT, `isUserNotificationsEnabled`).
     - Эндпоинты `GET/PATCH/PUT /api/v1/settings/notifications/preferences` и `/api/v1/notifications/preferences`.
     - `push-notification.service.ts`: `sendNotificationToUser` прерывает отправку при отключенных уведомлениях; `sendNotificationToTenant` исключает устройства пользователей с `notifications_enabled = false` или `push_enabled = false`; `createInAppNotification` пропускает создание и эмит в шину, если пользователь отключил уведомления.
     - `push-notification.routes.ts`: в SSE-стриме `/notifications/stream` проверяется мастер-выключатель подключенного пользователя.
     - `lead-notification.queue.ts`: дефолтный email владельца исключает пользователей с `notifications_enabled IS NOT FALSE`.
     - Юнит-тест `backend/src/tests/notification-preferences.test.ts`.
  3. **Frontend UI (Twenty CRM Light Canvas):**
     - Хук `useNotificationPreferences` с оптимистичным обновлением TanStack Query (`queryKey: ["notification-preferences"]`).
     - Компонент `UserMasterNotificationToggle.tsx`: мастер-тумблер «Все уведомления пользователя», баннер «Режим полной тишины активирован», переключатели «Звуковые сигналы», «Всплывающий Toaster», «Web Push & PWA» с автоматической блокировкой дочерних каналов при выключенном мастере.
     - `WebPushDeviceSettings.tsx`: добавлен предупреждающий баннер при выключенном мастер-тумблере.
     - `useInAppNotifications.ts`: при выключенном мастере блокируется вызов `playNotificationChime()`, блокируется всплывающий тост `toast()`, вызывается `clearAppBadge()`.
     - Страница `/settings/notifications/page.tsx`: мастер-блок размещен во главе настроек.
- **Верификация:**
  - Деплой на `150.241.98.135` выполнен через `/usr/local/bin/vf-deploy GETVOXLY` (код 0).
  - Миграция `0136` применена на продакшене.
  - Живая проверка в `ego-browser`: открытие `https://mpro.getvoxly.ru/settings/notifications`, проверка дефолта (включено), переключение в «Отключено», проверка блокировки дочерних каналов и появления баннера тишины, проверка сохранения после перезагрузки F5 и возврата во включенное состояние.
  - Аудит отправки Email-уведомлений: подтверждена блокировка отправки лидов на дефолтный email владельца при `notifications_enabled = false` в `lead-notification.queue.ts`; уточнены тексты в `UserMasterNotificationToggle.tsx` и динамическая индикация в `LeadNotificationChannels.tsx`.

---

### 25.11.2026 — Полное отключение тёмной темы и фиксация Twenty CRM Light Canvas
- **Контекст и проблема:**
  - Пользователь прислал скриншот `fe13ccea-2b80-48ea-b192-118705118559-IMG_20261125_113731_202.jpg`, где сайдбар `Sidebar.tsx` и шапка кабинета отрендерились в чёрном цвете (`#111111`) с тёмными границами (`#27272a`).
  - Причина: наличие классов `dark:*` на ключевых контейнерах (`dark:bg-[#111111]`), дефолтная реакция Tailwind v4 на медиазапрос `prefers-color-scheme: dark` ОС, кнопка переключения темы в шапке `Header.tsx` и чтение `localStorage.getItem('getvoxly_theme') === 'dark'` в инлайн-скрипте `layout.tsx`.
- **Что сделано:**
  1. **Корень и CSS (`layout.tsx`, `globals.css`):**
     - В `layout.tsx` скрипт `THEME_INIT_SCRIPT` сбрасывает `getvoxly_theme` в `light`, удаляет класс `dark` и выставляет `color-scheme: light`.
     - На `<html>` и `<body>` принудительно зафиксированы `color-scheme: light !important;`, фон `#ffffff !important;` и текст `#111111 !important;`.
     - В `globals.css` добавлена директива `@variant dark (&:where([data-theme="disabled-dark-mode"]));`, полностью блокирующая срабатывание медиазапроса `prefers-color-scheme: dark` на уровне CSS-движка Tailwind v4.
  2. **Зачистка `dark:*` и переключателей темы:**
     - `Sidebar.tsx`: удалены `dark:border-[#27272a] dark:bg-[#111111]` с `<aside>` и шапки бренда.
     - `Header.tsx` (CRM и landing): полностью удалены кнопки переключения темы (Sun/Moon), удален неиспользуемый хук `useTheme`, удалены классы `dark:*`.
     - `use-theme.ts`: переведен в принудительный режим `light` с no-op переключателем и сбросом старых ключей `localStorage`.
     - `Logo.tsx`, `onboarding/page.tsx`, `accept-invite/page.tsx`, `reset-password/page.tsx`, `Footer.tsx`: удалены все `dark:*` утилиты.
  3. **Виджет чата и настройки (`widget.js`, `widget-script.ts`, `WebchatAppearanceSettings.tsx`, `webchat.service.ts`):**
     - Удалены переключатели темной темы виджета; виджет зафиксирован в светлой теме (`theme: "light"`, удален класс `is-dark-theme`).
- **Верификация:**
  - Деплой на `150.241.98.135` через `/usr/local/bin/vf-deploy GETVOXLY` (код 0).
  - Проверка в `playwright`/браузере с эмуляцией `colorScheme: 'dark'`: сайдбар и шапка остаются светлыми (#fbfbfb / #ffffff), класс `dark` отсутствует, 0 ошибок в консоли.

---

### 25.11.2026 — Автоматическая смена этапа связанной CRM-сделки на «В работе» при приёмке оборудования
- **Контекст и задача:**
  - При оформлении/приёмке оборудования в сервисном центре (`/repairs`, модалка приёмки, карточка наряда, создание наряда из сделки) связанная сделка CRM оставалась на начальных этапах («Новый лид»), требуя ручного перевода.
  - Контрольный пример: сделка `d7055434-8e7e-43b8-a180-510641ec763b` и наряд `a533e042-a9f6-4dd0-8355-9a16909ef785` тенанта `remtoua`.
- **Что сделано:**
  1. **Бэкенд (`deals.service.ts`):**
     - Выделен `moveStageInTx` для безопасного выполнения смены этапа внутри существующей транзакции клиента БД.
     - Добавлен метод `advanceDealToInProgressInTx`:
       - Динамический поиск этапа «В работе» по имени (`name = 'В работе'`, `ILIKE '%в работе%'`, `in progress`) в рамках воронки сделки и тенанта.
       - Защита: не трогает закрытые (won/lost) или неактивные сделки.
       - Защита от дублирования: no-op, если сделка уже на этапе «В работе».
       - Защита от отката: переводит сделку только если её текущий этап раньше этапа «В работе» (`current_sort_order < target_sort_order`).
       - Сохраняет историю в `deal_stage_history` с автором изменения и вызывает всех подписчиков смены этапов.
     - Добавлен метод `syncDealProgressFromRepairs` для вызова вне внешних транзакций.
  2. **Сервисный центр (`repairs.service.ts`):**
     - В методе одиночной приёмки `create` вызов `advanceDealToInProgressInTx` включен прямо в единую транзакцию приёмки при наличии `dealId`.
     - В пакетной приёмке `createBatchIntake` вызов `advanceDealToInProgressInTx` включен в единую транзакцию при наличии `dealId`.
     - В `update`, `changeStatus` и `batchUpdateStatus` добавлен вызов `syncDealProgressFromRepairs` при изменении статусов и нарядов.
  3. **Миграция БД (`0138_sync_intake_repairs_to_in_progress_deals.sql`):**
     - Ретроспективно перевела все активные сделки (включая контрольный пример `d7055434-8e7e-43b8-a180-510641ec763b`), имеющие активные наряды СЦ и находящиеся на более ранних этапах, в этап «В работе» с записью в `deal_stage_history`.
  4. **Фронтенд (`use-repairs.ts`):**
     - В `useUpdateRepair`, `useChangeRepairStatus`, `useUpdateRepairPaymentStatus` настроена инвалидация `repairKeys.detail(order.id)` и `["deals"]` (охватывает kanban, list, active preset и карточку сделки), что гарантирует реактивное обновление UI без ручной перезагрузки страницы.

---

### 25.11.2026 — Исправление потери и скрытия текста при отправке фото/вложений в CRM-чате
- **Инцидент и контекст:**
  - На портале `remtoua.getvoxly.ru` в карточке сделки (вкладка «Чат») при прикреплении фото и вводе текста (например, «сейчас такие позиции, корпуса новые нужны? 2 корпуса у вас разбитые...») после отправки в пузыре сообщения отображалась только картинка без текста. Пользователь считал, что текст стёрся и не ушёл, и был вынужден набирать его повторно.
  - По логам и БД (`deal_messages` `4b142ffc-cf82-42b2-9e37-0b773583ffa4` в 13:06 MSK): бэкенд корректно сохранил и текст (`content`), и вложение (`attachment`), а также передал подпись в WhatsApp Evolution API.
- **Root Cause:**
  1. В `CrmChatView.tsx` функция `getAttachmentInfo` ошибочно присваивала `fileName = content.trim()`, когда `content` не являлся шаблонной заглушкой. В результате имя файла приравнивалось ко всему пользовательскому тексту сообщения.
  2. В проверке `isDummyContent` условие `trimmedContent === info.fileName` из-за п. 1 становилось `true` для любого пользовательского текста, отправленного с вложением. Фронтенд считал текст дубликатом имени файла и полностью скрывал его из рендера (`!isDummyContent && trimmedContent` давало `false`).
  3. В `TelegramComposer.tsx` метод `handleSendAction` затирал `editorRef.current.innerHTML = ""` и `updateAttachedFiles([])` синхронно до завершения отправки родителем.
- **Что изменено:**
  1. **`CrmChatView.tsx`:**
     - Введена функция `extractAttachmentFileName`, извлекающая реальное имя файла из пути/URL вложения (`attachment`), предотвращая подмену имени файла текстом сообщения.
     - Переработана логика `isDummyContent`: текст скрывается как дубликат только если он строго равен реальному имени файла, URL вложения или системному плейсхолдеру (`[документ]`, `.` и т.п.).
     - Для визуальных медиа (`isImage` / `isVideo`): блок медиа отображается сверху, а подпись (caption) — аккуратно под ним с отступом `mt-2` (стандарт Telegram/WhatsApp). Для документов и аудио текст отображается сверху, а плашка документа / плеер — снизу.
  2. **`TelegramComposer.tsx`:**
     - В контролируемом режиме (`isControlled`) устранена преждевременная зачистка редактора и прикрепленных файлов до ответа сервера. Очистка выполняется реактивно родителем (`setInput("")`, `setAttachedFiles([])`) через `useEffect` при успешной доставке. При ошибке сети текст и файлы сохраняются в форме.
- **Верификация:**
  - Типизация `npx tsc --noEmit` в frontend и backend без ошибок.
  - Деплой на `150.241.98.135` через `/usr/local/bin/vf-deploy GETVOXLY` (код 0).
  - Эндпоинты `https://api.getvoxly.ru/health` и `https://remtoua.getvoxly.ru/login` возвращают HTTP 200.
  - Сообщение с фото и текстом корректно отображает как превью фото, так и подпись под ним, а файлы без текста (например, PDF-счета) сохраняют скрытие дублирующих подписей.

---

### 25.11.2026 — Выбор даты и времени (`HH:mm`) в задачах CRM (сквозная реализация)
- **Контекст и задача:**
  - В форме быстрого создания задачи внутри карточки сделки/контакта/компании (`RecordTasksTab.tsx`) использовался `<input type="date">` с жёсткой подстановкой `T12:00:00`, что не позволяло задать точное время задачи. Кроме того, время задачи не отображалось в списках, канбане, таймлайне, карточке сделки и поиске, а `TasksCalendarView` группировал задачи по UTC-срезу.
- **Root Cause & Карта влияния:**
  - В БД `crm_tasks.due_date` уже имеет тип `TIMESTAMPTZ`, а планировщик уведомлений (`task-reminders.service.ts`) и расчёты `isOverdue` уже работают с точностью до минуты. Проблема ограничивалась UI ввода и отображения.
- **Что изменено:**
  1. **Backend (`tasks.types.ts`):**
     - `optionalDateTime` обновлён с `.datetime({ offset: true })` для поддержки любых валидных ISO-8601 таймштампов с оффсетом или `Z`.
  2. **Frontend Утилиты (`frontend/src/lib/utils.ts`):**
     - Добавлены единые функции `toLocalDateTimeInput`, `localDateTimeToIso`, `toLocalDateKey`, `formatTaskTime`, `formatTaskDue` (единый локальный формат `25.11, 15:30` / `25 ноября, 15:30`).
  3. **Единый компонент (`frontend/src/components/ui/date-time-picker.tsx`):**
     - Создан переиспользуемый `DateTimePicker` в стиле Twenty CRM Light Canvas (`default` и `compact` варианты) с пресетами даты (`Сегодня`, `Завтра`, `+3 дня`, `Неделя`), точным вводом даты и времени `HH:mm`, пресетами времени (`09:00`, `12:00`, `15:00`, `18:00`, `+1 ч`, `+3 ч`) и быстрой очисткой.
  4. **Формы и отображения задач:**
     - `RecordTasksTab.tsx`: заменён `<input type="date">` на `DateTimePicker variant="compact"`, сохранён перенос выбранного времени при открытии подробной `TaskModal`, обновлён формат срока с временем.
     - `TaskModal.tsx`: подключён `DateTimePicker` через `Controller` `react-hook-form`, убран дубликат `toLocalInput`.
     - `crm/tasks/page.tsx`, `RecordTimelineTab.tsx`, `DealCard.tsx`, `use-global-search.ts`: отображение срока задачи переведено на единый `formatTaskDue` с временем.
     - `TasksCalendarView.tsx`: исправлена группировка по локальной дате (`toLocalDateKey`) вместо UTC `slice(0, 10)`, добавлен вывод времени (`formatTaskTime`) в ячейках календаря.

---

### 25.11.2026 — Многословный токенизированный поиск запчастей и услуг (СЦ и Склад)
- **Контекст и проблема:**
  - В карточке наряда СЦ (`/repairs/[id]`, блок «Используемые запчасти» в `PartsTable.tsx`) при вводе нескольких слов (например, `gsn50 кольцо`) поиск не находил позицию `GSN50 поз.60 Кольцо стопорное d 7мм`, так как искал всю введённую фразу целиком через `includes(q)` / `LIKE '%...%'`.
- **Что изменено:**
  1. **Backend (`string.utils.ts`, `warehouse.service.ts`, `services.service.ts`, миграция `0139_warehouse_search_trgm_indexes.sql`):**
     - Добавлены хелперы `tokenizeSearchQuery` и `escapeLikePattern` для безопасного разбиения запроса по пробелам на токены с экранированием `%`, `_`, `\`.
     - В `WarehouseService.listItems` и `ServicesService.list` реализован многословный `AND`-поиск каждого слова в любом порядке по названию, артикулу SKU, бренду, категории и связанным моделям (`warehouse_item_models` -> `equipment_models`).
     - Добавлены `pg_trgm` GIN-индексы для быстрого подстрочного поиска на больших каталогах.
  2. **Frontend (`utils.ts`, `PartsTable.tsx`, `WorkItemsTable.tsx`, `ServiceCatalogDialog.tsx`, `WarehouseIntakeDialog.tsx`, `DictionarySelectField.tsx`, `CreatableCombobox.tsx`):**
     - Добавлены единые функции `matchesSearchTokens` и `matchesWarehouseItem`.
     - Все комбобоксы и фильтры подбора запчастей, услуг СЦ, словарей и приёмки склада переведены на многословную фильтрацию по всем релевантным полям; в `PartsTable.tsx` добавлен вывод бренда и привязанных моделей в выпадающем списке.



## 2026-11-25 — Автоматический исторический синк переписки при подключении MAX, Telegram и WhatsApp
- **Контекст и задача:** при подключении нового аккаунта канала (MAX, Telegram User API, WhatsApp Evolution) требовалось автоматически подтягивать историю переписки с контактами, уже имеющимися в CRM (`contacts`), без дублей сделок/сообщений и без перезаписи ФИО/телефонов.
- **Что сделано:**
  1. **БД и схема:** добавлена миграция [0140_channel_history_sync_status.sql](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/db/migrations/0140_channel_history_sync_status.sql) и обновлена [schema.sql](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/db/schema.sql) (`history_sync_status`, `history_sync_total`, `history_sync_processed`, `history_sync_messages`, `history_sync_error`, `history_sync_started_at`, `history_sync_finished_at` в `channel_accounts`).
  2. **Backend и очередь (`timeline-sync`):**
     - Создан сервис [channel-history-sync.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/channel-history-sync.service.ts) (`enqueueChannelHistorySync`, `runChannelHistorySync`) и подключён к воркеру BullMQ в [worker.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/worker.ts).
     - Матчинг контактов CRM выполняется по `phone`, `telegram_chat_id`, `telegram_username`, `messenger_id`, `socials`, `custom_fields.max_chat_id`/`max_user_id`; все внешние HTTP/MTProto-запросы вынесены за пределы транзакций PostgreSQL.
     - Сделки создаются только при наличии реальных сообщений в мессенджере (`findOrCreateDealForContactSync` с `chat_thread_id`), вставка сообщений идемпотентна (`external_message_id` + хронология), существующие ФИО и телефоны контактов не перезаписываются.
     - Автозапуск синка добавлен при переходе аккаунта в `connected` в [max-integration.routes.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/max-integration.routes.ts), [telegram-auth.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/telegram-auth.service.ts), [whatsapp-evolution.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/whatsapp-evolution.service.ts).
     - Добавлен ручной эндпоинт `POST /api/v1/channels/:channel/accounts/:id/sync-history` в [channels.routes.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/channels.routes.ts), обновлены [channels.types.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/channels.types.ts), [channels.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/channels.service.ts), [outbound-registry.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/outbound-registry.ts), [telegram-transport.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/telegram-transport.service.ts), [whatsapp-integration.routes.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/whatsapp-integration.routes.ts).
  3. **Frontend:** обновлены [use-channels.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/frontend/src/lib/api/use-channels.ts) (автополлинг статуса синка каждые 3 сек и мутация `useSyncChannelHistory`) и [ChannelAccountsTable.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/frontend/src/components/integrations/ChannelAccountsTable.tsx) (индикатор прогресса `processed/total` + кнопка запуска синка).
  4. **Тесты:** добавлен [channel-history-sync.test.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/tests/channel-history-sync.test.ts) (3/3 passed), `tsc --noEmit` на backend — 0 ошибок.


## 2026-11-25 — Исправление переименования контактов MAX в «Voxly», кросс-тенантного fallback и дубля «(Ремонт)»
- **Контекст и root cause:**
  1. В `/opt/voxly/apps/max-bridge/src/main.py` (`_resolve_user_by_phone`) при промахе/ошибке `search_by_phone` вызывался fallback `import_contacts([ContactInfo(phone=phone, first_name="Voxly", last_name="Check")])`. `pymax` (`ImportContactsPayload.from_contacts`) отправлял в MAX `Opcode.SYNC (21)` только с `firstName="Voxly"` без последующего удаления контакта — в результате на телефоне у контактов появлялось имя `Voxly`.
  2. В `backend/src/modules/crm/enrichment.service.ts` (`defaultMaxProvider`) при отсутствии MAX-аккаунта у тенанта выбирался любой `connected` MAX-аккаунт на всей платформе.
  3. В `backend/src/modules/channels/max-integration.routes.ts` (`/bots/upsert` и `/internal/bots/upsert`) при переподключении по QR к `label` безусловно дописывалось `(${body.firstName})`.
- **Что сделано:**
  1. `/opt/voxly/apps/max-bridge/src/main.py` (на сервере `150.241.98.135`, контейнер `getvoxly-max-bridge-1` + образ `voxly-max-bridge:latest`): удалён fallback `import_contacts` с `"Voxly"`/`"Check"` из `_resolve_user_by_phone` (оставлен только read-only `search_by_phone`), контейнер перезапущен и проверен живым запросом `POST /users/by-phone`.
  2. `backend/src/modules/crm/enrichment.service.ts`: удалён кросс-тенантный fallback выбора MAX-аккаунта без `WHERE tenant_id = $1`.
  3. `backend/src/modules/channels/max-integration.routes.ts`: добавлен хелпер `formatMaxAccountLabel`, предотвращающий повторное добавление `(${firstName})`.


## 2026-11-26 — Починка пересланных фото MAX (ForwardLink) и статуса «Писать от»
- **Контекст и root cause:**
  1. В сделке `d0f4f677-e8ca-4a68-840f-b94446ede1bd` (тенант `remtoua`) клиент переслал в MAX 2 фотографии (`FORWARD`). У пересланных сообщений в `pymax` `msg.attaches` и `msg.text` пустые, а реальные вложения лежат в `msg.link.message.attaches`. В `/opt/voxly/apps/max-bridge/src/main.py` (`_extract_inbound_attachments`, `_message_text`, `/messages/media`, `_resolve_media_from_message`) `link.message` не проверялся, поэтому сообщения сохранялись с `content = ''` и `attachment = NULL`.
  2. В `max-bridge` `_listener_watchdog` каждые 5 минут повторно вешал `on_message` без флага дедупликации, а `_ensure_live_client` не проверял `client.is_connected`.
  3. В `backend/src/modules/crm/deals/deal-messaging.service.ts` (`getSendFromOptions`, `getChannelOptions`) сессия MAX считалась мёртвой при застрявшем в БД `channel_accounts.status = 'error'` даже когда `liveMaxBotIds` подтверждал её активность в `max-bridge`.
- **Что сделано:**
  1. `/opt/voxly/apps/max-bridge/src/main.py`: добавлены `_forward_link_message` и `_msg_attaches`, пересланные фото/текст теперь извлекаются и скачиваются через `/messages/media`; добавлена дедупликация `_voxly_listener_attached` и проверка `is_connected` в `_ensure_live_client`.
  2. [deal-messaging.service.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/crm/deals/deal-messaging.service.ts): приоритет отдаётся `liveMaxBotIds.has(acc.id)` при наличии ответа от `max-bridge`.
  3. [max-integration.routes.ts](file:///home/vibeforge/.local/share/vibeforge/worktrees/5f1cc3e4-4427-4cfc-b4b4-8ca271a25634/session/backend/src/modules/channels/max-integration.routes.ts): при входящем/исходящем событии статус `channel_accounts` автоматически восстанавливается из `'error'` в `'connected'`, а `syncMaxPrivateDialog` заполняет `content` и `attachment` у уже существующих пустых сообщений.

## 2026-11-26 — Сквозная серверная сортировка, сквозной выбор (`excluded_ids` + `filters`) и пагинация таблиц
- **Контекст:** Во всех таблицах платформы («Склад», CRM, «Ремонты», «Финансы», «Услуги», логи админки) сортировка работала только по текущей странице, мультивыбор сбрасывался или игнорировал снятые чекбоксы после «Выбрать все N» (`excluded_ids`) и активные фильтры (включая баг `bulkDelete` в `tasks` без `filters` и `deals` без `stage_id`/`preset`), а часть разделов загружалась без пагинации или с жёстким `limit: 25/100/200`.
- **Что изменено:**
  1. **Backend:** Созданы `backend/src/lib/table-query.ts` (SQL-конструктор `buildSortOrderBy`, `nullableTextExpr`, `appendExcludedIdsCondition`, `resolveBulkTargetIds`, `bulkActionSchema`) и миграция `backend/src/db/migrations/0141_table_sorting_indexes.sql`. Серверная сортировка, пагинация и `mode: "all"` + `excluded_ids` + `filters` внедрены в `warehouse` (items + tabs + alias `POST /api/v1/purchase-requests` в `app.ts`), `crm/contacts`, `crm/companies`, `crm/tasks`, `crm/deals`, `repairs`, `finance`, `invoices`, `services`, `admin-platform.routes.ts`.
  2. **Frontend:** Добавлен `frontend/src/lib/hooks/use-table-selection.ts`, обновлены `RecordTable` (`serverSort`), `TableBulkBar` (`excludedCount`), `WarehousePagination` (`entityLabel`, `limitOptions`), API-хуки и все целевые экраны (`warehouse/page.tsx`, `ProductBulkEditDialog.tsx`, `crm/contacts/page.tsx`, `crm/companies/page.tsx`, `crm/tasks/page.tsx`, `crm/deals/page.tsx`, `DealListView.tsx`, `repairs/page.tsx`, `RepairsTable.tsx`, `finance/page.tsx`, `TransactionsTable.tsx`, `BulkEditInvoicesModal.tsx`, `ServicesCatalogTab.tsx`, `ServiceList.tsx`, `admin/logs/page.tsx`).
- **Осталось / проверка:** Проверить unit-тесты, выкатить через `/usr/local/bin/vf-deploy GETVOXLY` (миграция `0141` накатится автоматически) и прогнать live-проверки сортировки, «Выбрать все N» и пагинации на `https://getvoxly.ru/`.


## 2026-11-26 — Автозаполнение приёмки из сделки и читаемый шрифт номера наряда (/repairs)
- **Контекст и root cause:**
  1. При открытии формы приёмки из сделки (`/repairs?action=intake&dealId=...`) локальный state `phoneInput` в `RepairClientSection.tsx` инициализировался только при монтировании (`useState`) и не синхронизировался при асинхронном обновлении `customer_phone` из `useDeal(initialDealId)`. Ветка `lookupData.client` также не заполняла телефон клиента, а `handleClearCustomer` не очищал `customer_phone` в форме.
  2. В `RepairIntakeModal.tsx` эффект открытия формы включал `initialDeal`, `teamMembers` и `currentUser` в массив зависимостей, вызывая повторный `form.reset()` при их догрузке, а при подстановке компании из сделки не устанавливался флаг `is_company: true`.
  3. В `RepairsTable.tsx` колонки «Акт приема» (номер наряда) и «Сумма» использовали `font-mono text-xs font-bold tracking-tight` — в мелком кегле моноширинный faux-bold сжимал символ `№` и делал цифры «заплывшими» и плохо читаемыми.
- **Что изменено:**
  1. `frontend/src/components/repairs/RepairClientSection.tsx`: добавлена синхронизация `phoneInput` / `debouncedPhone` при внешнем изменении `customer_phone` (через `lastLocalPhoneRef`), автозаполнение `client.phone` в ветке `lookupData.client`, форматирование телефона в `existingContact` / `handleApplyExistingContact` и сброс `customer_phone` в `handleClearCustomer`.
  2. `frontend/src/components/repairs/RepairIntakeModal.tsx`: разделены эффект сброса при открытии и эффект однократного автозаполнения из `initialDeal` (`appliedDealIdRef`) без сброса формы и оборудования; добавлен fallback на `contactWhatsapp || companyPhone` и установка `is_company: true` при наличии компании.
  3. `frontend/src/components/repairs/RepairsTable.tsx` и `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`: шрифт номера наряда (и суммы в таблице) переведён на `font-sans font-semibold tabular-nums` (Inter 600 с табличными цифрами, без `font-mono`, `font-bold` и `tracking-tight`).
  4. `frontend/src/components/repairs/RepairIntakeModal.test.tsx`, `frontend/src/components/repairs/RepairClientSection.test.tsx`: добавлены регрессионные тесты.
- **Проверка прода (сделка `d0f4f677-e8ca-4a68-840f-b94446ede1bd`, наряды `d4a06246-...` / `№0032` и `23eddfcd-...` / `№0033`):** `POST /api/v1/repairs/batch` завершился `201`, оба наряда корректно привязаны к сделке и контакту `b6a700c9-...` (Михаил, `+79321283877`, Фирма Михаила), дублей не создалось, сделка перешла в этап «В работе».

## 2026-11-26 — Исправление синхронизации счетов нарядов с Контур.Эльбой (HTTP 400 для счетов без НДС)
- **Контекст и root cause:**
  1. У тенанта `remtoua` (ИП Сагайдак, `vat_mode = 'none'`, `vat_rate = 0`) интеграция Контур.Эльбы настроена (`elba_enabled = true`, `elba_auto_sync_invoices = true`), но все созданные счета (`СЧ-2026-0005`, `СЧ-2026-0006`, `СЧ-2026-0007`) отклонялись API Контур.Эльбы с `HTTP 400`.
  2. По официальной OpenAPI-спецификации Контур.Эльбы (`POST /v1/organizations/{organizationId}/bills`) для счёта без НДС (`withNDS: false`) запрещены два поля, которые передавались нашим кодом:
     - `sumsWithNDS: true` (было захардкожено в `invoices.service.ts:987`) → ошибка *«В счёте без НДС цена за единицу товара не может включать в себя НДС»*;
     - `warehouseItems[].ndsRate: "withoutNds"` (передавалось вместо `null`) → ошибка *«Для счёта без НДС поле BillItemToCreate.NDSRate должно принимать значение null»*.
  3. В `elba.client.ts` парсер ошибок ожидал плоское строковое `error`, тогда как Контур.Эльба возвращает вложенный `ErrorResponse { statusCode, traceId, error: { code, message, target, details, innerError } }`, из-за чего в БД попадало только `HTTP 400`.
  4. В `invoices.service.ts` автосинхронизация при создании счёта запускалась через `void this.syncToElba(...)` без ожидания результата, поэтому UI не получал ни `elbaBillId`, ни `elbaSyncError`.
- **Что изменено:**
  1. `backend/src/modules/finance/elba.client.ts`: добавлены `buildCreateBillPayload` (при `withNDS=false` ставит `sumsWithNDS: null` и `warehouseItems[].ndsRate: null`, обрезает поля по лимитам Swagger) и `extractElbaErrorMessage` (рекурсивный разбор `ErrorResponse.error` / `details` / `innerError`); увеличено число попыток опроса `long-running-tasks` при поиске контрагента (до 8x500ms).
  2. `backend/src/modules/finance/invoices.service.ts`: в `syncToElba` передаётся `withNDS = inv.vatMode !== "none" && inv.vatRate > 0`, `sumsWithNDS: withNDS ? true : null`, `ndsRate: withNDS ? mapVatModeToElbaNds(...) : null`; в `create` и `fromRepairs` автосинхронизация ожидается (с мягким `catch`, не роняющим создание счёта) для возврата актуального `elbaBillId` / `elbaSyncError`.
  3. `frontend/src/components/repairs/detail/GenerateInvoiceModal.tsx` и `FinancialSummary.tsx`: добавлен показ реального статуса/ошибки синхронизации с Эльбой в toast и подсветка кнопки «Повторить Эльбу» при наличии `elbaSyncError`.
  4. `backend/src/tests/elba-client.test.ts`: добавлены unit-тесты на формирование payload и разбор ошибок Эльбы.

## 2026-11-26 — Стабилизация MAX-интеграции и нативный TypeScript-клиент `web.max.ru` (Wave 1 + Wave 2)
- **Контекст и root cause:**
  1. `max-bridge` жил только на VPS в `/opt/voxly/apps/max-bridge` и не деплоился из git; временный `WebClient` на `pending-*` не закрывался после переноса в `{bot_id}/`, `relogin=True` молча удалял `web.db`, а статус в Postgres разъезжался с реальностью (`021eb35f` в `error`, пустой `aff6c92c` в `connected`).
  2. `PyMax 2.4.1` WebClient использовал устаревший JSON v11 и не поддерживал нативное управление сессиями / бинарный протокол `ver=10`.
- **Что изменено (Wave 1):**
  - Код `apps/max-bridge` перенесён в репозиторий, подключён к `docker-compose.yml`, `scripts/deploy.sh`, `scripts/remote-build.sh` и `docs/05_OPERATIONS/05_02_DEPLOY.md`.
  - В `apps/max-bridge/src/main.py` добавлены `VoxlyWebClient(relogin=False)` (сброс токена только при фатальных ответах), переоткрытие рабочего клиента в `/data/max-sessions/{bot_id}`, фиксированный `device_id`/`user_agent`, `AutoRefreshQrAuthFlow` и `BridgePasswordProvider`.
  - В `backend` добавлен зашифрованный бэкап `encrypted_session` (`credentials-cipher.ts`), восстановление из него, синк статусов `POST /bots/status`, фильтр исключения `native-ts` аккаунтов в `GET /bots/active`, `botId` в QR-переподключении без плодящихся лейблов и `POST /accounts/:id/check`.
- **Что изменено (Wave 2):**
  - `backend/src/modules/messaging/adapters/max/max-protocol.ts`: бинарный протокол `ver=10`, MessagePack c `ext type 1` (`BigInt`), LZ4 с соблюдением `MFLIMIT=12` / `LASTLITERALS=5`.
  - `backend/src/modules/messaging/adapters/max/MaxTsAdapter.ts`: полнофункциональный WS-клиент (`SessionInit 6`, `LOGIN 19`, `AUTH_CONFIRM 23`, `cmd=1` ACK на `1`/`128`/`137`, `lastInSeq`, 35s read-timeout, jittered backoff reconnect, `cmd=2` retry queue, media upload/download, `getPrivateDialogs`, `lookupProfileByPhone 46`, сессии `96`/`97`, `resolveTargetChatId` с фоллбэком `userId -> XOR chatId`).
  - `backend/src/modules/channels/max-native-auth.service.ts` и `max-integration.routes.ts`: нативная QR-авторизация (`288`/`289`/`291`), запасной вход по телефону + SMS/звонок (`17`/`18`/`294`) + 2FA (`115`), `POST /accounts/:id/provider` (переключение `native-ts` ↔ `max-bridge` без потери токена).
  - `messaging-registry.ts` + `server.ts`: запуск `MaxTsAdapter.startAllNativeSessions()` при старте API, обработка входящих/нативных исходящих и AI-автоответа, типизированная отправка фото/видео/аудио/документов.
  - UI (`ConnectMaxModal.tsx`, `ChannelAccountsTable.tsx`, `use-max-auth.ts`, `use-channels.ts`): выбор провайдера, вкладка входа по телефону, просмотр и завершение других сессий (`opcode 96`/`97`).
- **Проверка локально и на проде (`150.241.98.135`):**
  - Локально: `tsc --noEmit` (`backend` и `frontend`) — 0 ошибок; Vitest (`max-protocol`, `max-internal-auth`, `chat-write-first`, `channel-history-sync`) — 24/24 passed; `messaging-adapters.test.ts` — 8/8 passed; `scripts/test-deploy-safety.py` — 6/6 passed.
  - На проде: аккаунт `021eb35f-2fd8-488c-bd64-6e14abfba252` переведён на `provider: 'native-ts'`, `status: 'connected'`; `GET /bots/active` исключил `021eb35f` (`max-bridge /health`: `sessions: 0`); `POST /accounts/021eb35f/check` → `alive: true`; `GET /accounts/021eb35f/sessions` (`opcode 96`) вернул 4 живые сессии; `getPrivateDialogs` + `downloadMedia` загрузили файл (`0032.pdf`, `1114344` байт) и фото (`70954` байт, `image/webp`); после `docker-compose restart backend` сессия `021eb35f` автоматически восстановилась из `encrypted_session`. Мёртвые аккаунты `aff6c92c...` и `98074187...` честно остаются в `status: 'error'` до сканирования QR.
  - **Дополнительно устранены ошибки со страницы `/integrations/max`:**
    - `channel-history-sync.service.ts`: в `findOrCreateDealForContactSync` запрос к `pipelines` ошибочно фильтровал `AND deleted_at IS NULL` (в `pipelines` нет `deleted_at`), из-за чего оба подключённых MAX-аккаунта падали в «Ошибка синка истории»; фильтр удалён, добавлен `try/catch` на отдельный контакт (например, контакты-поставщики).
    - `ChannelAccountLinksCard.tsx`: на странице MAX в карточке Direct Link вместо ошибочной подписи `MTProto` выводится `MAX Web` и «Переход в профиль MAX».
    - `ChannelAccountsTable.tsx` / `use-max-auth.ts`: в статусе показывается конкретная причина ошибки синка, повторное включение аккаунта с `hasCredentials` переводит его в `connected`, polling QR-статуса останавливается при `error`.
  - Замечание по охвату живой проверки: реальная отправка нового исходящего сообщения клиенту через UI с `021eb35f` намеренно не выполнялась, чтобы не беспокоить реальных клиентов `remtoua`; исходящий/входящий пайплайн покрыт unit-тестами (`24/24`, `8/8`) и проверкой маршрутизации (`getSendFromOptions`).



## 2026-11-26 — Выбор сделок/нарядов в кассовых операциях, прямые расходы и чистая прибыль в сделке и наряде
- **Контекст:** В `CreateTransactionModal` поля привязки к сделке и заказ-наряду были обычными текстовыми `<input>` с ручным вводом UUID; привязанные расходы не отображались в таблице операций и не учитывались в прибыли сделки и наряда.
- **Что изменено:**
  1. **Backend (`finance.types.ts`, `finance.service.ts`, `finance.routes.ts`):**
     - `GET /api/v1/finance/transactions` теперь поддерживает фильтры `deal_id` и `repair_order_id`, поиск по названию сделки/номеру наряда и возвращает `dealTitle` и `repairTicketNumber`.
     - В `createTransaction` и `updateTransaction` добавлена валидация `deal_id` / `repair_order_id` в рамках тенанта и автоматическая подстановка `deal_id` при привязке к заказ-наряду.
     - Добавлены `GET /api/v1/finance/deals/:dealId/economics` и `GET /api/v1/finance/repairs/:repairOrderId/economics` + чистая функция `computeNetProfitSummary`: считают выручку, себестоимость (`deal_items` + `repair_parts`), валовую прибыль, прямые некапитализированные расходы (исключая `is_capitalized_cost = true` и `supplier_order_id IS NOT NULL`, без двойного счёта) и чистую прибыль с маржой.
  2. **Frontend:**
     - Создан [TransactionEntityPickers.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/2b204178-6230-472c-a7b9-0685b367162e/session/frontend/src/components/finance/TransactionEntityPickers.tsx) и подключён в `CreateTransactionModal.tsx` и `EditTransactionModal.tsx` (выбор существующих сделок и заказ-нарядов с поиском + автоподстановка сделки из наряда + поддержка предзаполненных `defaultType`/`defaultDealId`/`defaultRepairOrderId`).
     - В `TransactionsTable.tsx` добавлены кликабельные бейджи привязанной сделки и заказ-наряда.
     - Создан [DealEconomicsCard.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/2b204178-6230-472c-a7b9-0685b367162e/session/frontend/src/components/crm/deals/DealEconomicsCard.tsx) и встроен в `deal-tabs.tsx` (`HomeTab`); также прямые расходы и чистая прибыль добавлены в сводку `DealProductsServicesTab.tsx` и в `FinancialSummary.tsx` карточки заказ-наряда (с кнопкой быстрого добавления прямого расхода прямо из сделки и из наряда).
  3. **Тесты:** добавлен `backend/src/tests/finance-economics.test.ts`.

## 2026-11-26 — Защита телефона контакта MAX от подмены третьих лиц из текста и резолв через MAX `CONTACT_INFO`
- **Контекст и root cause (кейс `b6a700c9-4158-4f70-be02-cf7733ce672c`):**
  1. `CrmPipelineService.processIncoming` и `findContact` (`crm-pipeline.service.ts`) безусловно вытаскивали первый встречный номер телефона из текста сообщения (`extractPhoneNumber(rawText)`), из-за чего указанный клиентом в MAX номер монтажника (`+7 932 128 38 77 Тимофей`) записался как основной `contacts.phone`, перетёр автообогащение WhatsApp/Telegram (`1830762247`) и ушёл в заказ-наряды `№0032`/`№0033`, тогда как реальный телефон и ФИО клиента были доступны в MAX `CONTACT_INFO (32)` (`+79257002262`, `Михаил Арабаджи`, `max_user_id = 77056581`).
  2. `MaxTsAdapter.contactCache` кешировался глобально по голому `userId` без учёта `channelAccountId`: второй MAX-аккаунт тенанта (`98074187`), которому MAX скрывает телефон контакта, отравлял кеш для первого аккаунта (`021eb35f`), у которого телефон виден в `CONTACT_INFO (32)`.
  3. `CrmEnrichmentService.enrichContact` искал в MAX только по телефону (`CONTACT_INFO_BY_PHONE (46)`), падал при пустом `phone` и не умел добирать телефон/фамилию и подтверждать MAX-профиль по `custom_fields.max_user_id` / `max_chat_id` с перебором всех живых MAX-аккаунтов тенанта; `syncChannelHistory` / `syncMaxDialogHistory` также не дозаполняли пустые `phone` / `last_name` из MAX.
- **Что изменено:**
  1. `backend/src/modules/crm/channel-identity.ts` и `backend/src/modules/crm/crm-pipeline.service.ts`: добавлены `isThirdPartyPhoneContext` и `extractSelfPhoneFromText` (с поддержкой кириллических границ слов); для `max` и `whatsapp` `processIncoming` берёт телефон строго из верифицированного профиля мессенджера (не из произвольного текста), а `findContact` не сопоставляет контакты мессенджеров по номерам из текста сообщений.
  2. `backend/src/modules/messaging/adapters/max/MaxTsAdapter.ts` и `backend/src/modules/messaging/messaging-registry.ts`: `contactCache` переведён на ключ `${channelAccountId}:${userId}`; `lookupContactInfo` сохраняет раздельные `firstName`/`lastName` и перезапрашивает `CONTACT_INFO (32)` при отсутствии телефона; добавлен `lookupProfileByUserId` с проверкой `CHAT_INFO (48)` при резолве по `chatId`; `persistSessionUpdate` сохраняет `credentials.phone`.
  3. `backend/src/modules/channels/max-identity.ts`, `max-integration.routes.ts`, `channel-history-sync.service.ts`: вынесен helper `syncMaxContactIdentityFromDialog` (вызывается до `findOrCreateDealForContactSync`), который дозаполняет только пустые `phone`, `last_name` и placeholder `first_name` из MAX, не затирая существующие данные.
  4. `backend/src/modules/crm/enrichment.service.ts`: добавлен `defaultMaxByContactProvider` (`checkMaxByContact`) с перебором всех активных `native-ts` аккаунтов тенанта до нахождения профиля с телефоном; при пустом `contacts.phone` телефон и пустая фамилия добираются из MAX с последующей проверкой Telegram и WhatsApp.
  5. Тесты: добавлены регрессионные сценарии в `backend/src/tests/phone-validation.test.ts`, `crm-enrichment.test.ts`, `crm-pipeline-null-safety.test.ts`, `channel-history-sync.test.ts`.
  6. Прод-данные (`remtoua`): у `b6a700c9-4158-4f70-be02-cf7733ce672c` убраны данные монтажника (`+79321283877`, чужой Telegram ID `1830762247`), через реальный `sync` и `CrmEnrichmentService` восстановлены `Михаил Арабаджи`, `+79257002262`, WhatsApp `+79257002262` и Telegram `@Arabadji_Mikhail` (`6415795931`); в нарядах `№0032` и `№0033` исправлен основной телефон на `+79257002262`, а Тимофей (`+79321283877`, «Монтажник с объекта») перенесён в `additional_contacts`. Также при живом синке `021eb35f` автоматически восстановился телефон контакта `844f065d-4369-4f9d-af86-f62950325dae` (`Николай`, `+79015013097`).

## 2026-11-26: Пересланные и множественные фото MAX в чатах сделок и отдача `.bin` вложений (`/uploads`)
- **Контекст и root cause (`deal_id = d0f4f677-e8ca-4a68-840f-b94446ede1bd`, чат `196946784`, аккаунт `021eb35f`):**
  1. **Невидимость уже сохранённых MAX-фото в UI:**
     - `CrmChatView.tsx` в `getAuthTokenForUrl()` читал несуществующий ключ `localStorage.getItem("getvoxly_access_token")` вместо `readAccessToken()` (`getvoxly_auth_token`), из-за чего cross-subdomain запросы с `remtoua.getvoxly.ru` на `api.getvoxly.ru/uploads/...` уходили без `?token=`.
     - Вложения MAX без имени сохранялись через `ChatMediaService.storeBuffer` с именем `file.bin`, а `GET /uploads/:filename` в `app.ts` определял `Content-Type` строго по расширению (`.bin` → `application/octet-stream`, `Content-Disposition: attachment`) при активном `X-Content-Type-Options: nosniff` — браузер блокировал `<img>` и на существующих `..._file.bin` фото (`f4f5aec2`, `04f1c5da`), причём текст `[фото]` скрывался как системный плейсхолдер.
  2. **Потеря 2-го и последующих пересланных фото в одном MAX-сообщении:**
     - В пересланном от стороннего аккаунта (`81343080`) сообщении `117681598465797942` содержалось 2 фото (`photoId: 60257021032` и `60257021544`), а `MessagingRegistry.handleIncomingEvent`, `syncMaxDialogHistory`, `processMaxInbound` и `processMaxOutbound` брали только `attachments[0]`, полностью теряя `attachments[1..N]`.
     - В `CrmPipelineService` и `syncMaxDialogHistory` fallback-дедупликация по `content = $content` срабатывала даже при разных непустых `metadata->>'external_message_id'`, что склеивало соседние сообщения с одинаковым плейсхолдером `[фото]` или коротким текстом.
- **Что изменено:**
  1. `backend/src/lib/mime.utils.ts`, `backend/src/modules/crm/chat/media.service.ts`, `backend/src/app.ts`: добавлено определение MIME по magic bytes (`detectMimeFromBuffer`, `detectMimeFromFileHeader`) и канонический `mimeToExtension`; `storeBuffer` заменяет заглушку `.bin` на реальное расширение (`.webp`/`.jpg`/`.png` и т.д., с базовым именем `photo`/`video`/`audio`/`media`), а `GET /uploads/:filename` и `/api/v1/crm/messages/:id/attachment` определяют реальный `Content-Type` и отдают `inline` даже для существующих legacy `..._file.bin` файлов.
  2. `backend/src/modules/messaging/adapters/max/MaxTsAdapter.ts` и `max-bridge.service.ts`: обход цепочки `link.type === "FORWARD"` (включая вложенные пересылки до глубины 5) с сохранением `isForwarded` и `forwardFromUserId` в метаданных.
  3. `backend/src/modules/channels/max-attachments.ts`, `backend/src/modules/messaging/messaging-registry.ts`, `backend/src/modules/channels/max-integration.routes.ts`, `backend/src/modules/crm/crm-pipeline.service.ts`: единый хелпер сохранения всех вложений сообщения (`storeMaxMessageAttachments`, `maxAttachmentExternalId`, `buildMaxAttachmentMetadata`), поддержка множественных вложений в `MessagingRegistry`, `syncMaxDialogHistory` (с предварительной проверкой `deal_messages` до скачивания с CDN MAX), `processMaxInbound` и `processMaxOutbound`, защита `content`-дедупликации при разных `external_message_id`.
  4. `frontend/src/components/crm/shared/CrmChatView.tsx`: исправлен `getAuthTokenForUrl()` на `readAccessToken()`, добавлен `ChatImageAttachment` с fallback-ссылкой при ошибке загрузки изображения.
  5. `backend/src/tests/max-forwarded-multi-media.test.ts`: добавлены unit-тесты на magic bytes MIME, сохранение `.webp` вместо `file.bin`, извлечение пересланных множественных фото и генерацию уникальных `external_message_id`.

## 2026-11-26 — Мультивыбор услуг в блоке «Выполненные работы» карточки наряда
- **Контекст:** На странице карточки заказ-наряда (`/repairs/[id]`, вкладка «Работы и запчасти» → «Выполненные работы») выбор из выпадающего «Каталога типовых услуг» и диалога «Справочник услуг» работал строго по одной услуге с закрытием списка после каждого клика, что делало массовое добавление типовых работ медленным.
- **Что изменено:**
  1. **Backend (`backend/src/modules/repairs/repairs.types.ts`, `repairs.service.ts`, `repairs.routes.ts`):**
     - Вынесена общая транзакционная логика дедупликации/вставки в `upsertWorkInTx`, добавлен метод `addWorksBatch` и роут `POST /api/v1/repairs/:id/works/batch` (`createWorksBatchSchema`, 1–100 позиций, с проверками `assertEditable`, `withTenant`, RLS и однократным пересчётом `recalculateOrderCost` + `syncDealBudgetFromRepairs`).
  2. **Frontend (`frontend/src/lib/api/use-repairs.ts`, `WorkItemsTable.tsx`, `ServiceCatalogDialog.tsx`):**
     - Добавлен хук `useCreateWorksBatch()` с однократной инвалидацией `works`, `detail`, `totals`, `lists` и `deals`.
     - В выпадающем списке «Каталог типовых услуг» (`WorkItemsTable.tsx`) добавлены чекбоксы мультивыбора (список остаётся открытым после клика), кнопки «Выбрать все» / «Снять все», встроенный степпер количества `− / +` для выбранных строк, закреплённый футер «Выбрано: N · сумма · Добавить (N)» и панель предпросмотра выбранных услуг над строкой добавления (с редактированием кол-ва/цены, защитой от потери черновика через `onDraftStateChange` и сохранением ручного ввода одной произвольной работы).
     - В `ServiceCatalogDialog.tsx` добавлен мультивыбор чекбоксами, «Выбрать все» / «Снять все» и кнопка «Добавить выбранные (N)» (с обратной совместимостью по `onSelectService`).
  3. **Где используется:** `WorkItemsTable.tsx` используется только в `frontend/src/app/(dashboard)/repairs/[id]/page.tsx`; `ServiceCatalogDialog.tsx` — только в `WorkItemsTable.tsx`.
  4. **Тесты и документация:** добавлены `backend/src/tests/repair-works-batch.test.ts` и `frontend/src/components/repairs/detail/WorkItemsTable.test.tsx`; обновлён `docs/03_API_CONTRACTS/03_03_REPAIRS_AND_FINANCE_API.md`.

## 2026-11-26 — Синхронизация розничных цен запчастей из нарядов в карточки товаров на складе (`/warehouse`)
- **Контекст и root cause (наряд `cdfec2bc-7e31-443a-96ae-75615967e3a8` / `№0036`):**
  1. `RepairsService.addPart` записывал `retail_price` только в `repair_parts` и никогда не обновлял `warehouse_items.retail_price` у существующих карточек товара (обновлялось только при `save_to_catalog` для новой позиции); кроме того, при `article = "Б/А"` (537 из 540 позиций `remtoua` без SKU) автопоиск склада шёл только по `sku`, без фоллбэка по точному `name`.
  2. `RepairsService.updatePart` не синхронизировал `warehouse_items.retail_price` и работал вне `withTenant`.
  3. На фронтенде `useCreatePart` / `useUpdatePart` / `useDeletePart` не инвалидировали кэш `["warehouse"]`, поэтому `/warehouse` и выпадающий список склада показывали устаревшие цены.
  4. В `WarehouseIntakeDialog.tsx` при загрузке строк из заказа поставщику `retailPrice` всегда пересчитывался как `purchasePrice * 1.4` вместо сохранения уже установленной розничной цены товара на складе.
- **Что изменено:**
  1. `backend/src/modules/repairs/repairs.service.ts`: добавлен helper `syncWarehouseRetailPriceInTx` (обновляет `warehouse_items.retail_price` и `updated_at`, когда `retail_price > 0` и значение изменилось); подключён в `addPart` (плюс сопоставление по точному `lower(btrim(name))` при пустом SKU) и в `updatePart` (переведён в `withTenant` с `assertEditable`).
  2. `frontend/src/lib/api/use-repairs.ts`: добавлена инвалидация `["warehouse"]` в `useCreatePart`, `useUpdatePart`, `useDeletePart`.
  3. `frontend/src/components/repairs/detail/PartsTable.tsx`: добавлено инлайн-редактирование ячейки «Розница» (через `useUpdatePart`) с обновлением цены в наряде и на складе.
  4. `frontend/src/components/warehouse/WarehouseIntakeDialog.tsx`: при подстановке позиций из заказа поставщику приоритетно берётся сохранённая `retailPrice` карточки товара со склада (`> 0`).
  5. Тесты: добавлены `backend/src/tests/repair-part-retail-sync.test.ts` и `frontend/src/components/repairs/detail/PartsTable.test.tsx`.

## 2026-11-26 — Карточки «Оплачено» и «К оплате» в строке статистики `/repairs`
- **Контекст:** В верхней строке статистики `/repairs` (включая `/repairs?status=active`) отображались только 3 счётчика: «Всего наряд-заказов», «В работе», «Готовы к выдаче»; не хватало сводных финансовых показателей «Оплачено» и «К оплате» в ту же строку.
- **Что изменено:**
  1. `backend/src/modules/repairs/repairs.service.ts`, `repairs.routes.ts`: в `RepairsService.list` и `meta` ответа `GET /api/v1/repairs` добавлены `paidAmount`, `paidCount`, `unpaidAmount`, `unpaidCount` на основе того же `effectiveCostExpr` (`final_cost` → сумма работ+запчастей → `estimated_cost`) по всей отфильтрованной выборке (в «К оплате» исключены заказы со статусом `rejected`).
  2. `frontend/src/lib/api/use-repairs.ts`: расширен `RepairsListResult` полями `paidAmount`, `paidCount`, `unpaidAmount`, `unpaidCount`.
  3. `frontend/src/app/(dashboard)/repairs/page.tsx`: строка статистики переведена на `md:grid-cols-5`, добавлены карточки «Оплачено» и «К оплате» (сумма в ₽ и количество заказов).
  4. Обновлён `docs/03_API_CONTRACTS/03_03_REPAIRS_AND_FINANCE_API.md` и добавлен тест в `frontend/src/app/(dashboard)/repairs/repairs-filters-persistence.test.tsx`.

## 2026-11-26 — Скрытие прочитанных уведомлений и сквозная синхронизация прочтения
- **Контекст и root cause:**
  1. `pushNotificationService.listInAppNotifications` не фильтровал по `is_read = false` — в колокольчике навсегда оставались висеть прочитанные уведомления; на фронтенде `markOneRead` и `markAllRead` также лишь проставляли `read: true`, не удаляя элементы из списка.
  2. При чтении сообщений в чате (`POST /api/v1/crm/chat/read`), отправке ответа менеджером (`POST /crm/deals/:id/messages`, `POST /crm/contacts/:id/messages`), открытии карточки сделки и обновлении задачи `inapp_notifications` никак не помечались прочитанными (на проде у `remtoua` накопилось 80 непрочитанных уведомлений, включая все уже прочитанные и отвеченные сообщения в MAX).
  3. В `NotificationEventBus` отсутствовало SSE-событие `read`, а `emitNotification` дублировал личные уведомления (`userId != null`) на канал всего тенанта.
- **Что изменено:**
  1. **Миграция `backend/src/db/migrations/0142_reconcile_read_inapp_notifications.sql`:** идемпотентно помечает прочитанными уже накопившиеся уведомления по прочитанным/отвеченным чатам, закрытым задачам и удалённым сущностям.
  2. **Backend (`push-notification.service.ts`, `push-notification.routes.ts`):** `GET /api/v1/notifications` возвращает только `is_read = false` (с опцией `?include_read=true`); добавлены `markEntityNotificationsRead`, `markContactNotificationsRead`, эндпоинт `POST /api/v1/notifications/read-by-entity`, SSE-событие `event: read` и фикс маршрутизации `emitNotification`.
  3. **Backend-триггеры прочтения:** подключены в `chat-stream.routes.ts` (`POST /crm/chat/read`), `deals.routes.ts` (`POST /:id/messages`), `contacts.routes.ts` (`POST /:id/messages`) и `tasks.routes.ts` (`PATCH /:id`).
  4. **Frontend (`use-inapp-notifications.ts`, `NotificationDropdown.tsx`, `use-crm-chat.ts`, `CrmChatView.tsx`, `DealDrawer.tsx`, `crm/deals/[id]/page.tsx`):** прочитанные уведомления сразу убираются из кеша и списка (в том числе по SSE `event: read` и при клике на toast «Открыть»); добавлен лёгкий хук `useMarkEntityNotificationsRead` для синхронизации при открытии чата/сделки и клике по уведомлению.
  5. **Тесты:** добавлен `frontend/src/components/layout/NotificationDropdown.test.tsx`.

## 2026-11-26 — Сквозная аналитика: исправление нулевых посетителей в воронке виджета и офлайн-конверсий Google Ads
- **Контекст и root cause:**
  1. **Статистика посетителей сайта (воронка онлайн-чата):**
     - В `getWidgetFunnelStats` (`widget-analytics.service.ts`) верхние карточки воронки применяли монотонное сглаживание (`rawVisitors >= rawOpens >= rawChats >= rawLeads`), тогда как разбивка по дням (`dailyRows`) брала `e.visitors` напрямую из `widget_analytics_events`. Для дней, когда диалоги/лиды создавались в CRM/чате, а отдельное событие `VISIT` не успело записаться или было отфильтровано, таблица динамики показывала `Посетители: 0` и `Запуски: 0` при наличии заявок, что визуально противоречило верхним карточкам.
     - В `widget.js` событие `VISIT` отправлялось только через `navigator.sendBeacon`, который часто молча блокируется или прерывается блокировщиками рекламы; кроме того, при старте чата без предварительного вызова `VISIT` событие первого этапа не фиксировалось в БД.
  2. **Офлайн-конверсии в Google Ads (0,00 в кабинете рекламы):**
     - `GoogleAdsConversionProvider` выполнял браузерный GET-запрос 1x1 пикселя на `https://www.googleadservices.com/pagead/conversion/...`, который не является серверным API и игнорируется Google Ads для офлайн-атрибуции. Сервер возвращал 200/302, провайдер фиксировал `[200] Status: 200`, а в Google Ads отображалось `0,00` конверсий.
     - В форме настроек интеграции не были предусмотрены поля для передачи через Google Ads API (Developer Token, OAuth) либо через связанный поток Google Analytics 4 (Measurement Protocol) с GCLID/GBRAID/WBRAID.
- **Что изменено:**
  1. **Backend (`widget-analytics.service.ts`, `widgets.routes.ts`):**
     - В `getWidgetFunnelStats` в SQL-запросе `dailyRows` и маппинге добавлено строгое монотонное сглаживание: `visitors >= opens >= chats >= leads`, что гарантирует полное соответствие ежедневной таблицы верхним KPI-карточкам.
     - В `trackPublicEvent` при фиксации любого события воронки (`CHAT_START`, `WIDGET_OPEN`, `LEAD_CAPTURED`) автоматически гарантируется регистрация базового события `VISIT` для сессии, если оно отсутствовало.
     - Выполнен SQL-бэкфилл 231 исторического события `VISIT` для существующих сессий с чатами/лидами.
  2. **Google Ads Provider (`google-ads-conversion.provider.ts`, `conversion-dispatcher.service.ts`, `analytics.types.ts`):**
     - Полный рефакторинг провайдера с поддержкой:
       1) Прямой загрузки в Google Ads API v17 (`uploadClickConversions`) с форматированием даты `yyyy-mm-dd hh:mm:ss+00:00`, передачей `gclid`, `gbraid`, `wbraid`, Enhanced Conversions (хэшированные SHA-256 email и телефон) и проверкой `partialFailureError`.
       2) Моста через Google Analytics 4 (Measurement Protocol) с передачей `gclid` (рекомендуемый способ импорта конверсий в Google Ads).
       3) Автоматического обнаружения связанного активного потока GA4 в рамках тенанта, если в карточке Google Ads не заданы собственные API-ключи.
       4) Честного возврата ошибки `400` / `422` с понятными диагностическими инструкциями вместо ложного статуса `200`.
     - Скорректированы 12 ложных записей `Status: 200` в `conversion_delivery_attempts` на реальный диагностический статус.
  3. **Виджет (`frontend/public/widget.js`, `backend/src/modules/channels/widget-script.ts`):**
     - Надежная отправка событий через `fetch` с `keepalive: true` и `cors` в приоритете перед `sendBeacon`.
     - Захват и передача меток `gbraid` и `wbraid` наряду с `gclid` при создании лидов и посещениях.
     - Синхронизирован `WIDGET_SCRIPT` в backend.
  4. **Frontend (`ServerConversionIntegrationsView.tsx`):**
     - В шторке настройки Google Ads добавлены подсказки и поля для ввода параметров потока GA4 (`Measurement ID`, `API Secret`) или `Developer Token`.
     - Обновлены бейджи и описания в каталоге провайдеров.
  5. **Тесты:** добавлен `backend/src/tests/google-ads-conversion-provider.test.ts`.

## 2026-11-26 — Исправление сдвига времени на -3 часа в финансовых операциях и всех связанных формах даты/времени
- **Контекст и root cause:**
  - В БД (`PostgreSQL`, `TimeZone = UTC`) все события хранятся в `TIMESTAMPTZ` (UTC), серверные автоматические операции (`now()`) отображались в браузере корректно в MSK (`UTC+3`), но в `CreateTransactionModal.tsx` дефолтное значение для `<input type="datetime-local">` задавалось через `new Date().toISOString().slice(0, 16)` (UTC без `Z`), а при сабмите `new Date(val).toISOString()` интерпретировало эту UTC-строку как локальное MSK и вычитало ещё 3 часа (операция в `16:20 MSK` уходила как `10:20Z` и отображалась как `13:20`, ломая порядок в таблице).
  - Аналогичные `toISOString().slice(0, 16|10)` и `new Date("YYYY-MM-DD").toISOString()` (`00:00Z = 03:00 MSK`) найдены в `EditTransactionModal.tsx`, `InvoiceCreateModal.tsx`, `InvoicePaymentModal.tsx`, `TransactionsTable.tsx`, `WarehouseIntakeDialog.tsx`, `IntakeModal.tsx` и `GenerateInvoiceModal.tsx`.
- **Что изменено:**
  1. `frontend/src/lib/utils.ts`: `toLocalDateTimeInput` принимает `Date | string`, добавлен `localDateInputToIso` (для сегодняшней локальной даты возвращает текущее время `ISO`, для иной даты — локальный полдень `12:00`).
  2. Все 8 перечисленных компонентов переведены на `toLocalDateTimeInput` / `localDateTimeToIso` / `toLocalDateKey` / `localDateInputToIso` (во всём `frontend/src/` не осталось ни одного `.toISOString().slice(...)` для дат форм).
  3. Добавлен unit-тест `frontend/src/lib/utils.datetime.test.ts`.
  4. В прод-БД (`remtoua`) скорректированы на `+3 hours` 3 ручные операции от `2026-11-26` (`17cf586a`, `2177cf2c`, `8af39165`), записанные со сдвигом `diff_min = 180..181`.

## 2026-11-26: Диагностика входа MAX по телефону (`START_AUTH` / VK Captcha) и переход на QR
- **Контекст и root cause (скриншот `yandex-eda.getvoxly.ru` + тест `wss://api.oneme.ru/websocket`):**
  1. На `MaxOpcode.AUTH_REQUEST (17)` (`START_AUTH`) сервер MAX возвращает `error: "captcha.validation-failed"` (`localizedMessage: "Проверка не пройдена, попробуйте ещё раз"`).
  2. Проверка JS-клиента `web.max.ru` и живого WebSocket подтвердила, что перед `opcode 17` клиент вызывает `opcode 224` (`{ source: "auth", identifier: phone }`) и получает ссылку `https://id.vk.ru/not_robot_captcha?domain=web.max.ru&...`, которая отдаёт HTTP-заголовок `Content-Security-Policy: frame-ancestors web.max.ru web-test.oneme.ru *.web-test.oneme.ru web.messaging-service.ru`. Встраивание виджета капчи VK в `<iframe>` на стороннем домене (`*.getvoxly.ru`) запрещено политикой `id.vk.ru`.
- **Что изменено:**
  1. `backend/src/modules/channels/max-native-auth.service.ts` (`startPhoneAuth`): передача `language: "ru"` в `AUTH_REQUEST`, поддержка `res.callOutParams?.trackId` для `checkPhoneCallTrack` и преобразование `CAPTCHA_VALIDATION_FAILED` в явную ошибку `MAX_CAPTCHA_REQUIRED` с рекомендацией подключения по QR-коду.
  2. `frontend/src/components/integrations/ConnectMaxModal.tsx`: добавлена подсказка про ограничение капчи VK на стороне `web.max.ru`, сохранение выбранного QR-провайдера при переключении вкладок и кнопка быстрого переключения `Подключить по QR-коду` при `MAX_CAPTCHA_REQUIRED`.
  3. `backend/src/tests/max-phone-auth.test.ts`: добавлены unit-тесты на маппинг `CAPTCHA_VALIDATION_FAILED -> MAX_CAPTCHA_REQUIRED`, `language: "ru"` и `callOutParams.trackId`.

## 2026-11-27 — Аудит подключения NoirLight, маршрутизации моделей и фикс UI заголовка провайдеров
- **Контекст и root cause:**
  - Пользователь запросил проверку работы подключенного провайдера NoirLight (`https://api.noirlight.pro/v1`), использование его моделей ИИ-агентами, реестр мест использования моделей в платформе и логику маршрутизации (со скриншотом настроек платформы).
  - В БД (`platform_integrations_config`) провайдер `prov-custom-noirlight` был сохранен со старым отозванным ключом (`HTTP 401: Ключ не найден или отозван`), а новый рабочий ключ из скриншота находился только в UI-стейке браузера (кнопка сохранения не была нажата).
  - Эндпоинт `GET /api/ai/models` возвращал модели только от дефолтного провайдера (Google Gemini), из-за чего в селекторе бота не появлялись модели от других активных провайдеров (NoirLight).
  - В `AdminIntegrationsEditor.tsx` поле заголовка провайдера обрезалось по ширине (`Свой провайдер (NoirLi`).
- **Что изменено:**
  1. `frontend/src/components/admin/AdminIntegrationsEditor.tsx`: динамическая ширина инпута `style={{ width: `${Math.max(provider.name.length + 2, 24)}ch` }}` для исключения обрезки названий карточек провайдеров.
  2. `backend/src/modules/ai/ai.routes.ts`: опрос и сбор моделей со всех активных сконфигурированных провайдеров (`activeProvidersList`), а не только от дефолтного.
  3. Проведен полный аудит маршрутизации моделей (`SmartModelRouter`, `ModelTierRouter`, `KeyPoolManager`, `ai_usage_log`).


## 2026-11-27 — Устранение бесконечного цикла `/notifications/read-by-entity` (шторм `429`), ложного MAX при создании контакта и UI-ошибок сделки
- **Контекст и root cause (сделка `9ece85ce-d44b-4228-9a50-41918d1d94a2`, контакт `c44216e4-742e-4d13-b08d-8023f4e3013d`):**
  1. В `useMarkEntityNotificationsRead` (`use-inapp-notifications.ts`) `markEntityRead` зависел от `[mutation]`, который меняется при каждом переходе статуса, а `DealDrawer.tsx` и `crm/deals/[id]/page.tsx` вызывали его в `useEffect([open, dealId, markDealLeadRead])` без `useRef`-гарда → шторм 6 000–12 000 req/min на `/notifications/read-by-entity` и `/notifications`, выбивавший `429 Rate limit exceeded` на все действия с IP `109.95.217.174`.
  2. `DealDrawer.tsx` отображал любую ошибку загрузки (`429`/сеть) как «Сделка не найдена».
  3. `DrawerCreateContact.tsx` слепо записывал `socials: max / whatsapp` и `channel: "max"` из введённого телефона до запуска `CrmEnrichmentService.enrichContact`, показывал телефон серым плейсхолдером в полях MAX/WA и дергал `/contacts/duplicates` без debounce на каждую цифру.
  4. `DrawerCreateDeal.tsx` выводил `selectedOwner.fullName` дважды (внутри `UserAvatar` и отдельным `<span>`).
- **Что изменено:**
  1. `use-inapp-notifications.ts`: `markEntityRead`, `markOneRead`, `markAllRead` переведены на стабильный `mutate` + `onSuccess` вместо `onSettled`.
  2. `DealDrawer.tsx` и `crm/deals/[id]/page.tsx`: добавлен `lastMarkedDealIdRef`; в `DealDrawer` разделены 404 («Сделка не найдена») и временные ошибки («Не удалось загрузить сделку» + кнопка «Повторить»).
  3. `DrawerCreateContact.tsx`: убрана слепая подстановка `max/whatsapp` в `socials`, добавлен debounce 350 мс на поиск дублей, исправлены плейсхолдеры.
  4. `DrawerCreateDeal.tsx`: убран дублирующийся `<span>` имени владельца.
  5. Прод-БД (`remtoua`): у контакта `c44216e4-742e-4d13-b08d-8023f4e3013d` (`Фетисов Григорий`) удалён неподтверждённый `socials: max` (`max.exists = false`), оставлены подтверждённые `whatsapp` и `telegram`, `channel = 'phone'`.
  6. Тест: добавлен `frontend/src/lib/notifications/use-inapp-notifications.test.tsx`.


## 2026-11-27 — Подключение поискового справочника склада и услуг во вкладке «Услуги/Товары» сделки (по паттерну СЦ) и синхронизация бюджета
- **Контекст и root cause (сделка `9ece85ce-d44b-4228-9a50-41918d1d94a2`, `remtoua`):**
  1. В `DealProductsServicesTab.tsx` выбор товара/услуги из справочника был сделан через нативный `<select>` без поиска (при 540+ товарах на складе у `remtoua` невозможно искать по названию/артикулу/бренду/модели), а соседнее поле «Наименование в сделке» не было связано со справочником и при ручном редактировании не сбрасывало `selectedCatalogId`.
  2. При пустом поле наименования сразу отображалось ложное предупреждение «Товар введён вручную (вне каталога склада)», а в тексте интерфейса фигурировал технический путь `/warehouse`.
  3. На бэкенде (`deals.service.ts` `addDealItem` / `updateDealItem` / `deleteDealItem` и `repairs.service.ts` `syncDealBudgetFromRepairs`) пересчёт `deals.budget` считал либо только `deal_items`, либо только `repair_orders`, из-за чего добавление позиции в сделку затирало сумму привязанного наряда (и наоборот).
  4. Мутации `useAddDealItem` / `useUpdateDealItem` / `useDeleteDealItem` в `use-deals.ts` не инвалидировали `["finance", "economics", "deal", dealId]`, из-за чего «Чистая прибыль» в сделке не обновлялась сразу после добавления/удаления позиций.
- **Что изменено:**
  1. `frontend/src/components/crm/deals/DealProductsServicesTab.tsx`: заменён `<select>` на единый поисковый автокомплит-комбобокс 1-в-1 по паттерну Сервис-центра (`PartsTable.tsx` + `WorkItemsTable.tsx`): многословный поиск `matchesWarehouseItem` (название, артикул, бренд, категория, модели) и `matchesSearchTokens` (услуги), бейджи наличия/FIFO/розницы/наценки, `useClickOutside` + `Escape`, автосброс `selectedCatalogId` при ручном редактировании, поле «Артикул (SKU)», сохранение новых товаров на склад (`save_to_catalog`) и быстрое сохранение новых услуг в справочник, учёт `useWarehouseSettings().allowNegativeStock`, исправлены иконка «Скрыть форму» и тексты без `/warehouse`.
  2. `backend/src/modules/crm/deals/deals.types.ts` и `deals.service.ts`: добавлен `save_to_catalog` в `createDealItemSchema`, авторезолв `warehouse_items` по SKU/наименованию и сохранение в справочник при `save_to_catalog: true` (как в `repairs.service.ts`), вынесен единый `recalculateDealBudgetInTx` (суммирует `deal_items` + `repair_orders`).
  3. `backend/src/modules/repairs/repairs.service.ts`: `syncDealBudgetFromRepairs` теперь учитывает сумму `deal_items` вместе с суммой нарядов.
  4. `frontend/src/lib/api/use-deals.ts`: добавлен `save_to_catalog` в `CreateDealItemPayload`, добавлена инвалидация `["finance", "economics", "deal", dealId]` и каталогов при `save_to_catalog`.
  5. `frontend/src/components/crm/deals/DealProductsServicesTab.test.tsx`: добавлены Vitest-тесты на поиск/выбор товаров со склада, автозакупку при дефиците, сброс `item_id` при ручном вводе, `save_to_catalog`, поиск и создание услуг.

- **Итерация 2 (2026-11-27, по референсу карточки наряда `WorkItemsTable` + `PartsTable`):**
  - Вкладка [DealProductsServicesTab.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/2b204178-6230-472c-a7b9-0685b367162e/session/frontend/src/components/crm/deals/DealProductsServicesTab.tsx) полностью перестроена 1-в-1 по образцу вкладки «Работы и запчасти» карточки наряда СЦ: убрана скрываемая единая форма с переключателем Услуга/Товар, вместо неё — две отдельные карточки **«Услуги»** и **«Товары»** с постоянно видимыми нижними строками быстрого добавления, мультивыбором услуг из справочника, кнопкой «Справочник услуг» (переиспользованный [ServiceCatalogDialog.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/2b204178-6230-472c-a7b9-0685b367162e/session/frontend/src/components/services/ServiceCatalogDialog.tsx) с `catalogSource="services"`), поиском по складу `matchesWarehouseItem`, модалкой [DealProductAddModal.tsx](file:///home/vibeforge/.local/share/vibeforge/worktrees/2b204178-6230-472c-a7b9-0685b367162e/session/frontend/src/components/crm/deals/DealProductAddModal.tsx) (аналог `PartAddModal`) и инлайн-редактированием розничной цены товара.


### 2026-11-27 — Исправление осиротевших и дублирующихся заявок на закупку в сделках CRM
- **Root cause:** в сделке `9ece85ce-d44b-4228-9a50-41918d1d94a2` («ремонт тоя заказ») при 2 товарах в блоке «Заявки на закупку по этой сделке» отображалось 4 заявки (два осиротевших дубля `GSN50 поз.39 Поршень` по 1 шт с `deal_item_id = NULL`). Причины: (1) `deleteDealItem` удалял `deal_items`, не чистя связанные `pending`-заявки (`ON DELETE SET NULL` оставлял их висеть в `pending`); (2) кнопка «Заказать сейчас» (`handleCreatePurchaseFromDraft`) создавала отвязную заявку с `deal_item_id = NULL`, не добавляя товар в сделку и не сбрасывая форму; (3) `updateDealItem` не синхронизировал `quantity`/поля связанной `pending`-заявки; (4) в блоке заявок сделки не было кнопки удаления `pending`-заявки, а мутации заявок не инвалидировали кэш `["deals"]`.
- **Что изменено:**
  - `backend/src/modules/crm/deals/deals.service.ts`: `deleteDealItem` и `softDelete` чистят `pending`-заявки (`supplier_order_id IS NULL`); `updateDealItem` синхронизирует связанную `pending`-заявку и возвращает её статус в `toDealItemDTO`.
  - `backend/src/modules/warehouse/warehouse.service.ts`: `createPurchaseRequest` обновляет существующую `pending`-заявку по `deal_item_id` вместо создания дубля.
  - `frontend/src/components/crm/deals/DealProductsServicesTab.tsx`, `frontend/src/lib/api/use-warehouse.ts`, `frontend/src/app/(dashboard)/warehouse/page.tsx`: кнопка при дефиците «Добавить и в закупку» добавляет товар в сделку с `add_to_purchase_request: true`, добавлено удаление `pending`-заявок прямо из блока сделки, ссылка ведёт на `/warehouse?section=purchases`, добавлена инвалидация `["deals"]`.
- **Очистка данных:** из сделки `9ece85ce-d44b-4228-9a50-41918d1d94a2` (`remtoua`) удалены 2 осиротевших дубля (`4b07251d-2abd-4778-975d-68a3e33796bc`, `8bb73397-7ec0-4279-b3d2-26c1ce3b15de`, оба `deal_item_id IS NULL`, без привязки к заказам поставщикам).
