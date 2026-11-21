// ---------------------------------------------------------------------------
// IMessagingAdapter — универсальный контракт интеграции мессенджеров GETVOXLY.
//
// Изолирует бизнес-логику CRM, модуль /inbox и AI-агентов от реализации
// конкретных провайдеров и SDK (MAX, Telegram, WhatsApp, WebChat).
// ---------------------------------------------------------------------------

export interface OutboundAttachment {
  type: "image" | "document" | "audio" | "video";
  url?: string;
  buffer?: Buffer;
  base64?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface SendMessageParams {
  tenantId: string;
  channelAccountId: string;
  /** Внешний идентификатор получателя: phone (E.164), chat_id или user_id */
  recipient: string;
  text: string;
  attachments?: OutboundAttachment[];
  replyToMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface SentMessageResult {
  ok: boolean;
  messageId?: string;
  timestamp?: number;
  error?: string;
}

export interface MessageHistoryParams {
  tenantId: string;
  channelAccountId: string;
  chatId: string;
  limit?: number;
  cursor?: string;
}

export interface InboundAttachment {
  type: string;
  fileId?: string;
  url?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

export interface NormalizedMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName?: string;
  senderPhone?: string;
  senderUsername?: string;
  text: string;
  direction: "inbound" | "outbound";
  fromMe: boolean;
  timestamp: number;
  attachments?: InboundAttachment[];
  rawPayload?: Record<string, unknown>;
}

export interface MessagePage {
  messages: NormalizedMessage[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface ResolvedContact {
  id: string;
  phone?: string;
  name?: string;
  username?: string;
  avatarUrl?: string;
  isRegistered: boolean;
}

export interface IncomingEvent {
  tenantId: string;
  channelAccountId: string;
  channel: "max" | "telegram" | "whatsapp" | "webchat";
  eventType: "message" | "delivery_status" | "typing" | "presence";
  chatId: string;
  message?: NormalizedMessage;
  status?: "sent" | "delivered" | "read" | "failed";
  timestamp: number;
}

export type Unsubscribe = () => void;

export interface AdapterHealthStatus {
  ok: boolean;
  status: "connected" | "connecting" | "disconnected" | "error" | "unauthorized";
  lastSyncAt?: string;
  error?: string;
  details?: Record<string, unknown>;
}

export interface IMessagingAdapter {
  readonly channel: string;
  readonly providerName: string;

  /**
   * Отправка сообщения клиенту в мессенджер.
   */
  sendMessage(params: SendMessageParams): Promise<SentMessageResult>;

  /**
   * Получение истории диалога из мессенджера (для синхронизации и скролла в /inbox).
   */
  getHistory(params: MessageHistoryParams): Promise<MessagePage>;

  /**
   * Поиск/резолв контакта по номеру телефона или юзернейму.
   */
  resolveContact(
    tenantId: string,
    channelAccountId: string,
    identifier: string,
  ): Promise<ResolvedContact | null>;

  /**
   * Подписка на входящие события в реальном времени.
   */
  subscribeToEvents(handler: (event: IncomingEvent) => void): Unsubscribe;

  /**
   * Проверка жизнеспособности подключения и сессии.
   */
  healthCheck(tenantId: string, channelAccountId: string): Promise<AdapterHealthStatus>;
}
