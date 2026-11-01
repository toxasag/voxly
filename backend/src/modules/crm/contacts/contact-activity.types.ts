import { z } from "zod";

// ---------------------------------------------------------------------------
// Типы и Zod-схемы сквозного таймлайна активности клиента (Contact Activities).
//
// Дискретные бизнес-события и агрегированные сессии взаимодействия
// (веб-поведение, лидогенерация, диалоговые сессии в мессенджерах).
// ---------------------------------------------------------------------------

export const activityChannelSchema = z.enum([
  "web_widget",
  "web_form",
  "telegram",
  "whatsapp",
  "max",
  "call",
  "crm",
]);
export type ActivityChannel = z.infer<typeof activityChannelSchema>;

export const activityKindSchema = z.enum([
  "widget_launch",
  "form_submission",
  "im_session_inbound",
  "im_session_outbound",
  "note",
  "task",
  "stage_change",
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

// ---------------------------------------------------------------------------
// 1. Полезная нагрузка для Типа 1: Веб-сессия / Запуск виджета
// ---------------------------------------------------------------------------
export const webPageVisitSchema = z.object({
  step: z.number().int().optional(),
  url: z.string(),
  title: z.string().optional(),
  timeSpentSeconds: z.number().optional(),
  time: z.string().optional(),
});
export type WebPageVisit = z.infer<typeof webPageVisitSchema>;

export const webHeatmapClickSchema = z.object({
  selector: z.string(),
  text: z.string().optional(),
  count: z.number().int().default(1),
  timestamp: z.string().optional(),
});
export type WebHeatmapClick = z.infer<typeof webHeatmapClickSchema>;

export const webSessionPayloadSchema = z.object({
  domain: z.string().default(""),
  pageUrl: z.string().default(""),
  totalTimeSeconds: z.number().default(0),
  pagesVisited: z.array(webPageVisitSchema).default([]),
  heatmap: z
    .object({
      clicks: z.array(webHeatmapClickSchema).default([]),
      scrollDepthPercent: z.number().min(0).max(100).default(0),
      readToBottom: z.boolean().default(false),
    })
    .default({ clicks: [], scrollDepthPercent: 0, readToBottom: false }),
  device: z
    .object({
      platform: z.string().optional(),
      screen: z.string().optional(),
      browser: z.string().optional(),
    })
    .optional(),
});
export type WebSessionPayload = z.infer<typeof webSessionPayloadSchema>;

// ---------------------------------------------------------------------------
// 2. Полезная нагрузка для Типа 2: Лид-форма / Конверсионное действие
// ---------------------------------------------------------------------------
export const formSubmissionPayloadSchema = z.object({
  domain: z.string().default(""),
  pageUrl: z.string().default(""),
  formName: z.string().optional(),
  formFields: z.record(z.unknown()).default({}),
  touchpoints: z
    .object({
      referrer: z.string().optional(),
      utmSource: z.string().optional(),
      utmMedium: z.string().optional(),
      utmCampaign: z.string().optional(),
      utmContent: z.string().optional(),
      utmTerm: z.string().optional(),
      timeToSubmitSeconds: z.number().optional(),
      touchpointCount: z.number().int().optional(),
      firstTouchUrl: z.string().optional(),
      lastTouchUrl: z.string().optional(),
    })
    .default({}),
});
export type FormSubmissionPayload = z.infer<typeof formSubmissionPayloadSchema>;

// ---------------------------------------------------------------------------
// 3. Полезная нагрузка для Типа 3: Входящая сессия Telegram / Мессенджера
// ---------------------------------------------------------------------------
export const imSessionInboundPayloadSchema = z.object({
  channel: z.enum(["telegram", "whatsapp", "max", "webchat"]).default("telegram"),
  clientHandle: z.string().default(""),
  accountHandle: z.string().default(""),
  messageCount: z.number().int().default(1),
  durationSeconds: z.number().int().default(0),
  aiSummary: z.string().default(""),
  keyPoints: z.array(z.string()).default([]),
  sentiment: z.enum(["positive", "neutral", "negative"]).optional(),
  dealId: z.string().optional(),
  dealTitle: z.string().optional(),
});
export type ImSessionInboundPayload = z.infer<typeof imSessionInboundPayloadSchema>;

// ---------------------------------------------------------------------------
// 4. Полезная нагрузка для Типа 4: Исходящая сессия менеджера
// ---------------------------------------------------------------------------
export const imSessionOutboundPayloadSchema = z.object({
  channel: z.enum(["telegram", "whatsapp", "max", "webchat"]).default("telegram"),
  managerName: z.string().default(""),
  clientHandle: z.string().default(""),
  durationSeconds: z.number().int().default(0),
  status: z.enum(["resolved", "waiting_reply", "follow_up_scheduled", "closed"]).default("resolved"),
  statusLabel: z.string().default("Ответ отправлен"),
  summary: z.string().default(""),
  agreements: z.array(z.string()).default([]),
  dealId: z.string().optional(),
  dealTitle: z.string().optional(),
});
export type ImSessionOutboundPayload = z.infer<typeof imSessionOutboundPayloadSchema>;

// ---------------------------------------------------------------------------
// Единый DTO активности в таймлайне
// ---------------------------------------------------------------------------
export interface ContactActivityItemDTO {
  id: string;
  type: ActivityKind;
  activityChannel: ActivityChannel;
  activityKind: ActivityKind;
  direction?: "inbound" | "outbound" | null;
  timestamp: string;
  title: string;
  description?: string;
  authorName?: string;
  clientHandle?: string;
  dealId?: string;
  dealTitle?: string;
  payload: Record<string, unknown>;
}

export interface ContactActivityListResponse {
  items: ContactActivityItemDTO[];
  total: number;
  limit: number;
  offset: number;
}
