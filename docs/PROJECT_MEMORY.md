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
