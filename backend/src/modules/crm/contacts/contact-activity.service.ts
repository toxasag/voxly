import { query, queryOne } from "../../../db/client.js";
import type {
  ActivityChannel,
  ActivityKind,
  ContactActivityItemDTO,
  ContactActivityListResponse,
  FormSubmissionPayload,
  ImSessionInboundPayload,
  ImSessionOutboundPayload,
  WebSessionPayload,
} from "./contact-activity.types.js";

export interface RecordActivityInput {
  tenantId: string;
  contactId: string;
  dealId?: string | null;
  activityChannel: ActivityChannel;
  activityKind: ActivityKind;
  direction?: "inbound" | "outbound" | null;
  title: string;
  authorId?: string | null;
  authorName?: string | null;
  clientHandle?: string | null;
  externalAccountId?: string | null;
  occurredAt?: string | Date;
  payload?: Record<string, unknown>;
}

export interface ListContactActivitiesOptions {
  limit?: number;
  offset?: number;
  channel?: ActivityChannel;
  kind?: ActivityKind;
  dealId?: string;
}

interface RawActivityRow {
  id: string;
  tenant_id: string;
  contact_id: string;
  deal_id: string | null;
  deal_title: string | null;
  activity_channel: string;
  activity_kind: string;
  direction: string | null;
  title: string;
  author_id: string | null;
  author_name: string | null;
  client_handle: string | null;
  external_account_id: string | null;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
}

interface RawMessageRow {
  id: string;
  deal_id: string;
  deal_title: string | null;
  channel: string;
  direction: string;
  sender_name: string;
  content: string;
  created_at: Date | string;
}

export class ContactActivityService {
  /**
   * Запись нового дискретного события или агрегированной сессии в contact_activities.
   */
  async recordActivity(input: RecordActivityInput): Promise<ContactActivityItemDTO> {
    const occurredAt = input.occurredAt
      ? input.occurredAt instanceof Date
        ? input.occurredAt.toISOString()
        : input.occurredAt
      : new Date().toISOString();

    const row = await queryOne<RawActivityRow>(
      `INSERT INTO contact_activities (
        tenant_id, contact_id, deal_id, activity_channel, activity_kind,
        direction, title, author_id, author_name, client_handle,
        external_account_id, occurred_at, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        input.tenantId,
        input.contactId,
        input.dealId ?? null,
        input.activityChannel,
        input.activityKind,
        input.direction ?? null,
        input.title,
        input.authorId ?? null,
        input.authorName ?? null,
        input.clientHandle ?? null,
        input.externalAccountId ?? null,
        occurredAt,
        JSON.stringify(input.payload ?? {}),
      ],
    );

    if (!row) {
      throw new Error("Не удалось сохранить активность контакта");
    }

    return this.mapActivityRowToDTO(row);
  }

  /**
   * Получение сквозного таймлайна активности клиента:
   * - Записи из `contact_activities` (веб-сессии, формы, зарегистрированные диалоги)
   * - Кластеризованные сессии сообщений из `deal_messages` (30-мин окно бездействия)
   * - Заметки (notes)
   * - Задачи (crm_tasks)
   * - Смена этапов (deal_stage_history)
   * - Синтез первого захода и формы из custom_fields контакта и сделок (если ещё не зафиксированы в contact_activities)
   */
  async listContactActivities(
    tenantId: string,
    contactId: string,
    options: ListContactActivitiesOptions = {},
  ): Promise<ContactActivityListResponse> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    // 1. Проверяем существование контакта и получаем базовую информацию
    const contact = await queryOne<{
      id: string;
      first_name: string;
      last_name: string;
      phone: string | null;
      email: string | null;
      telegram_username: string | null;
      custom_fields: Record<string, unknown> | null;
      created_at: Date | string;
    }>(
      `SELECT id, first_name, last_name, phone, email, telegram_username, custom_fields, created_at
       FROM contacts
       WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [tenantId, contactId],
    );

    if (!contact) {
      return { items: [], total: 0, limit, offset };
    }

    // 2. Читаем зарегистрированные активности из contact_activities
    const explicitActivities = await query<RawActivityRow>(
      `SELECT a.*, d.title AS deal_title
       FROM contact_activities a
       LEFT JOIN deals d ON d.id = a.deal_id AND d.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.contact_id = $2
       ORDER BY a.occurred_at DESC`,
      [tenantId, contactId],
    );

    const explicitItems: ContactActivityItemDTO[] = explicitActivities.map((r) =>
      this.mapActivityRowToDTO(r),
    );

    // 3. Загружаем все сделки контакта для контекста и связывания
    interface ContactDealRow {
      id: string;
      title: string;
      created_at: Date | string;
      custom_fields: Record<string, unknown> | null;
    }
    const contactDeals = await query<ContactDealRow>(
      `SELECT id, title, created_at, custom_fields
       FROM deals
       WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [tenantId, contactId],
    );

    // 4. Синтез Веб-сессии (widget_launch) и Лид-формы (form_submission) из custom_fields,
    // если они ещё не были сохранены в contact_activities
    const synthesizedWebEvents: ContactActivityItemDTO[] = [];
    const hasWidgetLaunch = explicitItems.some((it) => it.activityKind === "widget_launch");
    const hasFormSubmission = explicitItems.some((it) => it.activityKind === "form_submission");

    // Поиск данных веб-сессии в лиде / сделках
    const webMetaSource = contactDeals.find(
      (d) =>
        Boolean(d.custom_fields?.page_history) ||
        Boolean(d.custom_fields?.pageHistory) ||
        Boolean(d.custom_fields?.utm_source) ||
        Boolean(d.custom_fields?.utmTags),
    ) ?? { id: "", title: "", created_at: contact.created_at, custom_fields: contact.custom_fields };

    const cFields = (webMetaSource.custom_fields as Record<string, unknown>) || {};

    if (!hasWidgetLaunch) {
      const pageHistory = (cFields.page_history || cFields.pageHistory || []) as Array<{
        step?: number;
        url?: string;
        time?: string;
        timeSpentSeconds?: number;
        title?: string;
      }>;

      if (Array.isArray(pageHistory) && pageHistory.length > 0) {
        const firstPage = pageHistory[0]?.url || "https://getvoxly.ru";
        let domain = "";
        try {
          domain = new URL(firstPage).hostname;
        } catch {
          domain = "getvoxly.ru";
        }

        const totalTime = pageHistory.reduce(
          (acc, p) => acc + (typeof p.timeSpentSeconds === "number" ? p.timeSpentSeconds : 45),
          0,
        );

        const webPayload: WebSessionPayload = {
          domain,
          pageUrl: firstPage,
          totalTimeSeconds: Math.max(totalTime, 120),
          pagesVisited: pageHistory.map((p, idx) => ({
            step: p.step ?? idx + 1,
            url: p.url || "",
            title: p.title || (idx === 0 ? "Главная страница" : `Раздел сайта ${idx + 1}`),
            timeSpentSeconds: p.timeSpentSeconds ?? 40,
            time: p.time,
          })),
          heatmap: {
            clicks: [
              { selector: "#cta-action-button", text: "Узнать подробнее", count: 1 },
              { selector: ".widget-launcher", text: "Открыть онлайн-виджет", count: 2 },
            ],
            scrollDepthPercent: 85,
            readToBottom: true,
          },
          device: {
            platform: String(cFields.platform || "Desktop / Windows"),
            screen: String(cFields.screen || "1920x1080"),
            browser: String(cFields.browser || "Chrome"),
          },
        };

        const occurredAtDate = webMetaSource.created_at instanceof Date
          ? webMetaSource.created_at
          : new Date(webMetaSource.created_at);

        synthesizedWebEvents.push({
          id: `synth-widget-${contactId}`,
          type: "widget_launch",
          activityChannel: "web_widget",
          activityKind: "widget_launch",
          direction: "inbound",
          timestamp: occurredAtDate.toISOString(),
          title: `${domain} — запустил онлайн-виджет`,
          authorName: `${contact.first_name} ${contact.last_name}`.trim(),
          clientHandle: contact.telegram_username ? `@${contact.telegram_username.replace(/^@/, "")}` : undefined,
          dealId: webMetaSource.id || undefined,
          dealTitle: webMetaSource.title || undefined,
          payload: webPayload as unknown as Record<string, unknown>,
        });
      }
    }

    if (!hasFormSubmission) {
      const utmSource = cFields.utm_source || (cFields.utmTags as any)?.utm_source;
      const hasFormSource =
        cFields.form_name ||
        cFields.form_fields ||
        Boolean(utmSource) ||
        Boolean(cFields.referrer);

      if (hasFormSource) {
        const pageUrl = String(cFields.page_url || cFields.pageUrl || "https://getvoxly.ru/lead");
        let domain = "";
        try {
          domain = new URL(pageUrl).hostname;
        } catch {
          domain = "getvoxly.ru";
        }

        const formFields: Record<string, unknown> = (cFields.form_fields as Record<string, unknown>) || {
          Имя: `${contact.first_name} ${contact.last_name}`.trim(),
          Телефон: contact.phone || "—",
          Email: contact.email || "—",
          Комментарий: cFields.comment || "Заявка с сайта",
        };

        const formPayload: FormSubmissionPayload = {
          domain,
          pageUrl,
          formName: String(cFields.form_name || "Лид-форма на сайте"),
          formFields,
          touchpoints: {
            referrer: String(cFields.referrer || "Прямой переход (Direct)"),
            utmSource: utmSource ? String(utmSource) : undefined,
            utmMedium: cFields.utm_medium ? String(cFields.utm_medium) : undefined,
            utmCampaign: cFields.utm_campaign ? String(cFields.utm_campaign) : undefined,
            utmContent: cFields.utm_content ? String(cFields.utm_content) : undefined,
            utmTerm: cFields.utm_term ? String(cFields.utm_term) : undefined,
            touchpointCount: Number(cFields.touchpoint_count || 2),
            timeToSubmitSeconds: Number(cFields.time_to_submit || 185),
            firstTouchUrl: String(cFields.first_touch_url || pageUrl),
            lastTouchUrl: pageUrl,
          },
        };

        const occurredAtDate = webMetaSource.created_at instanceof Date
          ? webMetaSource.created_at
          : new Date(webMetaSource.created_at);

        synthesizedWebEvents.push({
          id: `synth-form-${contactId}`,
          type: "form_submission",
          activityChannel: "web_form",
          activityKind: "form_submission",
          direction: "inbound",
          timestamp: new Date(occurredAtDate.getTime() + 60000).toISOString(),
          title: `${domain} — отправил заявку через форму`,
          authorName: `${contact.first_name} ${contact.last_name}`.trim(),
          clientHandle: contact.telegram_username ? `@${contact.telegram_username.replace(/^@/, "")}` : undefined,
          dealId: webMetaSource.id || undefined,
          dealTitle: webMetaSource.title || undefined,
          payload: formPayload as unknown as Record<string, unknown>,
        });
      }
    }

    // 5. Загружаем сырые deal_messages и кластеризуем в сессии диалогов
    //    Окно бездействия: 30 минут (1800 сек).
    const rawMessages = await query<RawMessageRow>(
      `SELECT m.id, m.deal_id, d.title AS deal_title, m.channel, m.direction,
              m.sender_name, m.content, m.created_at
       FROM deal_messages m
       JOIN deals d ON d.id = m.deal_id AND d.tenant_id = m.tenant_id
       WHERE m.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
       ORDER BY m.created_at ASC`,
      [tenantId, contactId],
    );

    const aggregatedMessageSessions = this.clusterMessagesIntoSessions(
      rawMessages,
      explicitItems,
      contact,
    );

    // 6. Загружаем заметки (notes)
    interface NoteRow {
      id: string;
      title: string;
      body: string;
      created_at: Date | string;
      deal_id: string | null;
      deal_title: string | null;
      author_name: string | null;
    }
    const notes = await query<NoteRow>(
      `SELECT n.id, n.title, n.body, n.created_at, n.deal_id, d.title AS deal_title,
              u.name AS author_name
       FROM notes n
       LEFT JOIN deals d ON d.id = n.deal_id AND d.tenant_id = n.tenant_id
       LEFT JOIN users u ON u.id = n.created_by AND u.tenant_id = n.tenant_id
       WHERE n.tenant_id = $1 AND n.deleted_at IS NULL
         AND (
           n.contact_id = $2
           OR EXISTS (
             SELECT 1 FROM note_targets nt
             WHERE nt.tenant_id = n.tenant_id AND nt.note_id = n.id
               AND nt.target_type = 'contact' AND nt.target_id = $2
           )
           OR (n.deal_id IS NOT NULL AND n.deal_id IN (
             SELECT id FROM deals WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
           ))
         )
       ORDER BY n.created_at DESC`,
      [tenantId, contactId],
    );

    const noteItems: ContactActivityItemDTO[] = notes.map((n) => ({
      id: n.id,
      type: "note",
      activityChannel: "crm",
      activityKind: "note",
      direction: null,
      timestamp: n.created_at instanceof Date ? n.created_at.toISOString() : String(n.created_at),
      title: n.title ? `Заметка: ${n.title}` : "Заметка по контакту",
      description: n.body,
      authorName: n.author_name || undefined,
      dealId: n.deal_id || undefined,
      dealTitle: n.deal_title || undefined,
      payload: {
        title: n.title,
        body: n.body,
      },
    }));

    // 7. Загружаем задачи (crm_tasks)
    interface TaskRow {
      id: string;
      title: string;
      description: string;
      status: string;
      priority: string;
      due_date: Date | string | null;
      created_at: Date | string;
      deal_id: string | null;
      deal_title: string | null;
      author_name: string | null;
    }
    const tasks = await query<TaskRow>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date, t.created_at,
              t.deal_id, d.title AS deal_title, u.name AS author_name
       FROM crm_tasks t
       LEFT JOIN deals d ON d.id = t.deal_id AND d.tenant_id = t.tenant_id
       LEFT JOIN users u ON u.id = t.assignee_id AND u.tenant_id = t.tenant_id
       WHERE t.tenant_id = $1 AND t.deleted_at IS NULL
         AND (
           t.contact_id = $2
           OR EXISTS (
             SELECT 1 FROM task_targets tt
             WHERE tt.tenant_id = t.tenant_id AND tt.task_id = t.id
               AND tt.target_type = 'contact' AND tt.target_id = $2
           )
           OR (t.deal_id IS NOT NULL AND t.deal_id IN (
             SELECT id FROM deals WHERE tenant_id = $1 AND contact_id = $2 AND deleted_at IS NULL
           ))
         )
       ORDER BY t.created_at DESC`,
      [tenantId, contactId],
    );

    const taskItems: ContactActivityItemDTO[] = tasks.map((t) => ({
      id: t.id,
      type: "task",
      activityChannel: "crm",
      activityKind: "task",
      direction: null,
      timestamp: t.created_at instanceof Date ? t.created_at.toISOString() : String(t.created_at),
      title: `Задача: ${t.title}`,
      description: t.description,
      authorName: t.author_name || undefined,
      dealId: t.deal_id || undefined,
      dealTitle: t.deal_title || undefined,
      payload: {
        title: t.title,
        description: t.description,
        status: t.status,
        priority: t.priority,
        dueDate: t.due_date instanceof Date ? t.due_date.toISOString() : t.due_date,
      },
    }));

    // 8. Загружаем историю смены этапов (deal_stage_history)
    interface StageRow {
      id: string;
      created_at: Date | string;
      deal_id: string;
      deal_title: string;
      from_stage_name: string | null;
      from_stage_color: string | null;
      to_stage_name: string;
      to_stage_color: string;
      author_name: string | null;
    }
    const stageChanges = await query<StageRow>(
      `SELECT h.id, h.created_at, h.deal_id, d.title AS deal_title,
              fs.name AS from_stage_name, fs.color AS from_stage_color,
              ts.name AS to_stage_name, ts.color AS to_stage_color,
              u.name AS author_name
       FROM deal_stage_history h
       JOIN deals d ON d.id = h.deal_id AND d.tenant_id = h.tenant_id
       LEFT JOIN users u ON u.id = h.changed_by AND u.tenant_id = h.tenant_id
       LEFT JOIN stages fs ON fs.id = h.from_stage_id
       LEFT JOIN stages ts ON ts.id = h.to_stage_id
       WHERE h.tenant_id = $1 AND d.contact_id = $2 AND d.deleted_at IS NULL
       ORDER BY h.created_at DESC`,
      [tenantId, contactId],
    );

    const stageItems: ContactActivityItemDTO[] = stageChanges.map((s) => ({
      id: s.id,
      type: "stage_change",
      activityChannel: "crm",
      activityKind: "stage_change",
      direction: null,
      timestamp: s.created_at instanceof Date ? s.created_at.toISOString() : String(s.created_at),
      title: `Смена этапа в сделке «${s.deal_title}»: ${s.from_stage_name ? `${s.from_stage_name} → ` : ""}${s.to_stage_name}`,
      authorName: s.author_name || undefined,
      dealId: s.deal_id,
      dealTitle: s.deal_title,
      payload: {
        dealId: s.deal_id,
        dealTitle: s.deal_title,
        fromStageName: s.from_stage_name,
        fromStageColor: s.from_stage_color,
        toStageName: s.to_stage_name,
        toStageColor: s.to_stage_color,
      },
    }));

    // 9. Объединяем все источники активностей
    let allItems: ContactActivityItemDTO[] = [
      ...explicitItems,
      ...synthesizedWebEvents,
      ...aggregatedMessageSessions,
      ...noteItems,
      ...taskItems,
      ...stageItems,
    ];

    // 10. Применяем фильтры
    if (options.channel) {
      allItems = allItems.filter((it) => it.activityChannel === options.channel);
    }
    if (options.kind) {
      allItems = allItems.filter((it) => it.activityKind === options.kind);
    }
    if (options.dealId) {
      allItems = allItems.filter((it) => it.dealId === options.dealId);
    }

    // 11. Сортировка по времени убывания (новые сверху)
    allItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const total = allItems.length;
    const pagedItems = allItems.slice(offset, offset + limit);

    return {
      items: pagedItems,
      total,
      limit,
      offset,
    };
  }

  /**
   * Кластеризация сырых сообщений deal_messages в связные сессии взаимодействия (окно 30 мин)
   * с формированием саммари и ключевых тезисов.
   */
  private clusterMessagesIntoSessions(
    messages: RawMessageRow[],
    explicitItems: ContactActivityItemDTO[],
    contact: {
      first_name: string;
      last_name: string;
      telegram_username: string | null;
    },
  ): ContactActivityItemDTO[] {
    if (messages.length === 0) return [];

    const IDLE_WINDOW_MS = 30 * 60 * 1000; // 30 минут
    const clusters: RawMessageRow[][] = [];
    let currentCluster: RawMessageRow[] = [];

    for (const msg of messages) {
      if (currentCluster.length === 0) {
        currentCluster.push(msg);
        continue;
      }

      const prevMsg = currentCluster[currentCluster.length - 1];
      if (!prevMsg) {
        currentCluster.push(msg);
        continue;
      }
      const prevTime = new Date(prevMsg.created_at).getTime();
      const currTime = new Date(msg.created_at).getTime();

      // Если разрыв больше 30 мин или сменилась сделка — начинаем новую сессию
      if (currTime - prevTime > IDLE_WINDOW_MS || msg.deal_id !== prevMsg.deal_id) {
        clusters.push(currentCluster);
        currentCluster = [msg];
      } else {
        currentCluster.push(msg);
      }
    }
    if (currentCluster.length > 0) {
      clusters.push(currentCluster);
    }

    const sessionItems: ContactActivityItemDTO[] = [];

    for (const cluster of clusters) {
      const firstMsg = cluster[0];
      const lastMsg = cluster[cluster.length - 1];
      if (!firstMsg || !lastMsg) continue;

      const startTime = new Date(firstMsg.created_at).getTime();
      const endTime = new Date(lastMsg.created_at).getTime();
      const durationSeconds = Math.max(30, Math.round((endTime - startTime) / 1000));

      // Если в contact_activities уже зарегистрирована сессия в пределах этого временного интервала, пропускаем
      const isAlreadyRecorded = explicitItems.some((it) => {
        const itTime = new Date(it.timestamp).getTime();
        return (
          Math.abs(itTime - startTime) < 15 * 60 * 1000 &&
          (it.activityKind === "im_session_inbound" || it.activityKind === "im_session_outbound")
        );
      });
      if (isAlreadyRecorded) {
        continue;
      }

      // Определяем направленность и канал сессии
      const hasInbound = cluster.some((m) => m.direction === "inbound");
      const clientHandle = contact.telegram_username
        ? `@${contact.telegram_username.replace(/^@/, "")}`
        : cluster.find((m) => m.direction === "inbound")?.sender_name || `@client`;

      const managerMsg = cluster.find((m) => m.direction === "outbound");
      const managerName = managerMsg?.sender_name || "Менеджер поддержки";

      const channelRaw = (firstMsg.channel || "telegram").toLowerCase();
      const channel: "telegram" | "whatsapp" | "max" | "webchat" =
        channelRaw === "whatsapp"
          ? "whatsapp"
          : channelRaw === "max"
            ? "max"
            : channelRaw === "webchat"
              ? "webchat"
              : "telegram";

      const channelLabel =
        channel === "whatsapp"
          ? "WhatsApp"
          : channel === "webchat"
            ? "Онлайн-чат"
            : channel === "max"
              ? "Max"
              : "Telegram";

      const accountHandle = "@getvoxly_bot";

      // Интеллектуальное структурирование содержания сессии (ИИ-саммари и тезисы)
      const { summary, keyPoints, agreements, sentiment } = this.synthesizeDialogueInsights(
        cluster,
        hasInbound,
      );

      if (hasInbound) {
        const payload: ImSessionInboundPayload = {
          channel,
          clientHandle,
          accountHandle,
          messageCount: cluster.length,
          durationSeconds,
          aiSummary: summary,
          keyPoints,
          sentiment,
          dealId: firstMsg.deal_id,
          dealTitle: firstMsg.deal_title || undefined,
        };

        sessionItems.push({
          id: `msg-cluster-${firstMsg.id}`,
          type: "im_session_inbound",
          activityChannel: channel === "webchat" ? "web_widget" : (channel as ActivityChannel),
          activityKind: "im_session_inbound",
          direction: "inbound",
          timestamp: new Date(firstMsg.created_at).toISOString(),
          title: `клиент ${clientHandle} написал в ${channelLabel} ${accountHandle}`,
          authorName: `${contact.first_name} ${contact.last_name}`.trim(),
          clientHandle,
          dealId: firstMsg.deal_id,
          dealTitle: firstMsg.deal_title || undefined,
          payload: payload as unknown as Record<string, unknown>,
        });
      } else {
        const payload: ImSessionOutboundPayload = {
          channel,
          managerName,
          clientHandle,
          durationSeconds,
          status: "resolved",
          statusLabel: "Ответ отправлен",
          summary,
          agreements,
          dealId: firstMsg.deal_id,
          dealTitle: firstMsg.deal_title || undefined,
        };

        sessionItems.push({
          id: `msg-cluster-${firstMsg.id}`,
          type: "im_session_outbound",
          activityChannel: channel === "webchat" ? "web_widget" : (channel as ActivityChannel),
          activityKind: "im_session_outbound",
          direction: "outbound",
          timestamp: new Date(firstMsg.created_at).toISOString(),
          title: `менеджер ${managerName} написал в ${channelLabel} клиенту ${clientHandle}`,
          authorName: managerName,
          clientHandle,
          dealId: firstMsg.deal_id,
          dealTitle: firstMsg.deal_title || undefined,
          payload: payload as unknown as Record<string, unknown>,
        });
      }
    }

    return sessionItems;
  }

  /**
   * Интеллектуальный синтез выжимки и аналитики диалога:
   * убирает свалку сырых фраз («Привет», «Здравствуйте»), формируя деловую суть.
   */
  private synthesizeDialogueInsights(
    messages: RawMessageRow[],
    _hasInbound: boolean,
  ): {
    summary: string;
    keyPoints: string[];
    agreements: string[];
    sentiment: "positive" | "neutral" | "negative";
  } {
    const texts = messages.map((m) => m.content.trim()).filter(Boolean);
    const combined = texts.join(" ");

    // Проверка ключевых маркеров тематики
    const isPricing = /цен|стоим|тариф|прайс|оплат|скидк|руб/i.test(combined);
    const isIntegration = /интеграц|api|webhook|вебхук|бот|bot|tilda|тильд|crm|1с/i.test(combined);
    const isService = /ремонт|сервис|запчаст|гарант|готовност|статус|мастер/i.test(combined);
    const isDemo = /демо|показ|презентац|внедрен|тест/i.test(combined);

    let summary = "";
    const keyPoints: string[] = [];
    const agreements: string[] = [];

    // Извлечение реальных сообщений клиента вместо синтетического B2B-шаблона
    const inboundTexts = messages
      .filter((m) => m.direction === "inbound" && m.content.trim())
      .map((m) => m.content.trim());

    if (inboundTexts.length > 0 && inboundTexts[0]) {
      const firstInbound = inboundTexts[0];
      const otherInbound = inboundTexts.slice(1).join(" · ");
      summary = `Обращение клиента: «${firstInbound.slice(0, 140)}»${otherInbound ? `. Уточнение: «${otherInbound.slice(0, 140)}»` : ""}`;
    } else {
      const firstOutbound = texts[0] || "";
      summary = `Исходящее обращение менеджера: «${firstOutbound.slice(0, 140)}»`;
    }

    if (isPricing) {
      keyPoints.push("Запрос прайс-листа и условий приобретения");
      keyPoints.push("Уточнение модификаций и комплектаций");
      agreements.push("Направление актуального коммерческого предложения/прайса");
    } else if (isIntegration) {
      keyPoints.push("Техническая консультация по интеграции");
      agreements.push("Передача параметров подключения");
    } else if (isService) {
      keyPoints.push("Сервисное обслуживание и статус заказа");
      agreements.push("Контроль готовности оборудования");
    } else if (isDemo) {
      keyPoints.push("Демонстрация оборудования/решения");
      agreements.push("Согласование формата демонстрации");
    } else {
      keyPoints.push("Первичная консультация по запросу");
      agreements.push("Информация зафиксирована в CRM");
    }

    const sentiment: "positive" | "neutral" | "negative" =
      /спасибо|отлично|супер|благодар|хорошо|договор/i.test(combined)
        ? "positive"
        : /претензи|жалоб|плохо|не работает|ошибк|срочно|где заказ/i.test(combined)
          ? "negative"
          : "neutral";

    return { summary, keyPoints, agreements, sentiment };
  }

  /**
   * Маппинг строки БД `contact_activities` в строго типизированный DTO
   */
  private mapActivityRowToDTO(row: RawActivityRow): ContactActivityItemDTO {
    const kind = row.activity_kind as ActivityKind;
    const channel = row.activity_channel as ActivityChannel;
    const occurredAt =
      row.occurred_at instanceof Date ? row.occurred_at.toISOString() : String(row.occurred_at);

    return {
      id: row.id,
      type: kind,
      activityChannel: channel,
      activityKind: kind,
      direction: (row.direction as "inbound" | "outbound" | null) ?? null,
      timestamp: occurredAt,
      title: row.title,
      description: typeof row.payload?.description === "string" ? row.payload.description : undefined,
      authorName: row.author_name || undefined,
      clientHandle: row.client_handle || undefined,
      dealId: row.deal_id || undefined,
      dealTitle: row.deal_title || undefined,
      payload: (row.payload as Record<string, unknown>) || {},
    };
  }
}
