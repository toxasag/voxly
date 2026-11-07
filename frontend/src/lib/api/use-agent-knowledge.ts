"use client";

import { useEffect, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { apiClient, type ApiClientError } from "@/lib/api/apiClient";

// ---------------------------------------------------------------------------
// База знаний агента и привязка к аккаунтам каналов.
//
// Отдельный модуль от `use-ai-agents.ts`: там сам агент и баланс ИИ, здесь его
// материалы и каналы. Ключи кеша вложены в ключ агента, поэтому обновление
// документа не сбрасывает список агентов.
// ---------------------------------------------------------------------------

const BASE_PATH = "/api/v1/ai";

export const knowledgeKeys = {
  documents: (agentId: string) => ["ai", "agents", agentId, "knowledge", "docs"] as const,
  channels: (agentId: string) => ["ai", "agents", agentId, "channels"] as const,
};

export type DocumentStatus = "draft" | "processing" | "ready" | "failed" | "approved";

export interface KnowledgeDocument {
  id: string;
  agentId: string | null;
  filename: string;
  mimeType: string;
  fileSize: number;
  status: DocumentStatus;
  errorMessage: string;
  chunksCount: number;
  category?: string;
  sourceUrl?: string | null;
  createdAt: string;
}

export interface KnowledgeDocumentDetail extends KnowledgeDocument {
  contentText: string;
}

export interface CrmKnowledgeStats {
  totalDeals: number;
  wonDeals: number;
  totalMessages: number;
  dealsWithMessages: number;
  isAvailable: boolean;
}

export interface SyncCrmResult {
  documentsCreated: number;
  dealsAnalyzed: number;
  messagesAnalyzed: number;
}

export interface ImportWhatsAppResult {
  documentsCreated: number;
  participants: string[];
  messagesAnalyzed: number;
}

/**
 * Метаданные раздела: приходят вместе со списком, а не отдельным запросом.
 *
 * `vectorisationAvailable` нужен интерфейсу до попытки загрузки — иначе
 * пользователь узнавал бы о ненастроенном на платформе доступе к моделям только
 * по ошибке после выбора файла.
 */
export interface KnowledgeMeta {
  vectorisationAvailable: boolean;
  supportedExtensions: string[];
  maxFileSizeBytes: number;
}

export interface KnowledgeList {
  documents: KnowledgeDocument[];
  meta: KnowledgeMeta;
}

export interface AgentChannelBinding {
  channelAccountId: string;
  channel: string;
  label: string;
  externalId: string;
  status: string;
  isBound: boolean;
  isEnabled: boolean;
}

/** Значения по умолчанию, пока ответ не пришёл: список форматов нужен полю выбора файла. */
const FALLBACK_META: KnowledgeMeta = {
  vectorisationAvailable: false,
  supportedExtensions: ["txt", "md", "docx", "pdf"],
  maxFileSizeBytes: 10 * 1024 * 1024,
};

function parseMeta(raw: unknown): KnowledgeMeta {
  if (typeof raw !== "object" || raw === null) return FALLBACK_META;

  const meta = raw as {
    vectorisationAvailable?: unknown;
    supportedExtensions?: unknown;
    maxFileSizeBytes?: unknown;
  };

  return {
    vectorisationAvailable: meta.vectorisationAvailable === true,
    supportedExtensions: Array.isArray(meta.supportedExtensions)
      ? meta.supportedExtensions.filter((item): item is string => typeof item === "string")
      : FALLBACK_META.supportedExtensions,
    maxFileSizeBytes:
      typeof meta.maxFileSizeBytes === "number"
        ? meta.maxFileSizeBytes
        : FALLBACK_META.maxFileSizeBytes,
  };
}

export function useKnowledgeDocuments(
  agentId: string,
): UseQueryResult<KnowledgeList, ApiClientError> {
  return useQuery({
    queryKey: knowledgeKeys.documents(agentId),
    queryFn: async () => {
      const res = await apiClient.get<KnowledgeDocument[]>(
        `${BASE_PATH}/agents/${agentId}/knowledge`,
      );
      return { documents: res.data, meta: parseMeta(res.meta) };
    },
  });
}

/** Загрузка текстом: вставка регламента из буфера — основной короткий путь. */
export function useAddKnowledgeText(
  agentId: string,
): UseMutationResult<KnowledgeDocument, ApiClientError, { title: string; text: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<KnowledgeDocument>(
        `${BASE_PATH}/agents/${agentId}/knowledge`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

/**
 * Загрузка файла.
 *
 * Через `fetch` напрямую, а не через `apiClient`: тот всегда ставит
 * `Content-Type: application/json` и сериализует тело в JSON, что для
 * `FormData` неприменимо — браузер обязан сам выставить `multipart/form-data` с
 * boundary. Токен и обработка ошибок повторяют поведение `apiClient`.
 */
export function useUploadKnowledgeFile(
  agentId: string,
): UseMutationResult<KnowledgeDocument, Error, File | { file: File; category?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input) => {
      const file = input instanceof File ? input : input.file;
      const category = input instanceof File ? undefined : input.category;
      const { API_BASE_URL } = await import("@/lib/api/apiClient");
      const { readAccessToken } = await import("@/lib/auth/session");

      const form = new FormData();
      form.append("file", file);
      if (category) {
        form.append("category", category);
      }

      const token = readAccessToken();

      const response = await fetch(`${API_BASE_URL}${BASE_PATH}/agents/${agentId}/knowledge`, {
        method: "POST",
        body: form,
        credentials: "include",
        ...(token !== null && { headers: { Authorization: `Bearer ${token}` } }),
      });

      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);

        const message =
          typeof body === "object" &&
          body !== null &&
          typeof (body as { error?: { message?: unknown } }).error?.message === "string"
            ? (body as { error: { message: string } }).error.message
            : `Не удалось загрузить файл (HTTP ${response.status})`;

        throw new Error(message);
      }

      const parsed: unknown = await response.json();

      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("data" in parsed)
      ) {
        throw new Error("Неожиданный ответ сервера при загрузке файла");
      }

      return (parsed as { data: KnowledgeDocument }).data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

export function useDeleteKnowledgeDocument(
  agentId: string,
): UseMutationResult<void, ApiClientError, { documentId: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ documentId }) => {
      await apiClient.delete<null>(`${BASE_PATH}/agents/${agentId}/knowledge/${documentId}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Каналы
// ---------------------------------------------------------------------------

export function useAgentChannels(
  agentId: string,
): UseQueryResult<AgentChannelBinding[], ApiClientError> {
  return useQuery({
    queryKey: knowledgeKeys.channels(agentId),
    queryFn: async () => {
      const res = await apiClient.get<AgentChannelBinding[]>(
        `${BASE_PATH}/agents/${agentId}/channels`,
      );
      return res.data;
    },
  });
}

/**
 * Сохраняет набор привязок целиком.
 *
 * PUT со полным списком, а не добавление по одному: интерфейс отправляет
 * итоговое состояние чекбоксов, и вычисление разницы на клиенте расходилось бы
 * при параллельном редактировании из двух вкладок.
 */
export function useSaveAgentChannels(
  agentId: string,
): UseMutationResult<AgentChannelBinding[], ApiClientError, { channelAccountIds: string[] }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ channelAccountIds }) => {
      const res = await apiClient.put<AgentChannelBinding[]>(
        `${BASE_PATH}/agents/${agentId}/channels`,
        { channel_account_ids: channelAccountIds },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.channels(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Импорт веб-страниц по ссылке (URL)
// ---------------------------------------------------------------------------

export function useImportKnowledgeUrl(
  agentId: string,
): UseMutationResult<KnowledgeDocument, ApiClientError, { url: string; title?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ url, title }) => {
      const res = await apiClient.post<KnowledgeDocument>(
        `${BASE_PATH}/agents/${agentId}/knowledge/url`,
        { url, title },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Сканирование сайта (Краулер по sitemap.xml и внутренним ссылкам)
// ---------------------------------------------------------------------------

export interface CrawlSiteResult {
  scannedCount: number;
  indexedCount: number;
  documents: KnowledgeDocument[];
}

export function useCrawlSite(
  agentId: string,
): UseMutationResult<CrawlSiteResult, ApiClientError, { url: string; maxPages?: number }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ url, maxPages }) => {
      const res = await apiClient.post<CrawlSiteResult>(
        `${BASE_PATH}/agents/${agentId}/knowledge/crawl-site`,
        { url, maxPages },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Импорт отзывов и профиля организации с карт (Яндекс Карты, 2ГИС, Google Maps, Zoon)
// ---------------------------------------------------------------------------

export interface MapReviewsImportResult {
  document: KnowledgeDocument;
  details: {
    platform: string;
    orgName: string;
    rating?: string;
    reviewsCount?: string;
    reviewsFound: number;
  };
}

export function useImportMapReviews(
  agentId: string,
): UseMutationResult<MapReviewsImportResult, ApiClientError, { url: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ url }) => {
      const res = await apiClient.post<MapReviewsImportResult>(
        `${BASE_PATH}/agents/${agentId}/knowledge/map-reviews`,
        { url },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Обучение на успешных сделках (Closed-Won RAG)
// ---------------------------------------------------------------------------

export interface SalesExample {
  id: string;
  dealId: string;
  dealTitle: string;
  customerQuery: string;
  agentReply: string;
  createdAt: string;
}

export function useSalesExamples(
  agentId: string,
): UseQueryResult<SalesExample[], ApiClientError> {
  return useQuery({
    queryKey: ["ai", "agents", agentId, "sales-examples"],
    queryFn: async () => {
      const res = await apiClient.get<SalesExample[]>(
        `${BASE_PATH}/agents/${agentId}/sales-examples`,
      );
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Просмотр и редактирование документов (актуализация цен и регламентов)
// ---------------------------------------------------------------------------

export interface KnowledgeChunkItem {
  id: string;
  chunkIndex: number;
  content: string;
  charsCount: number;
}

export function useKnowledgeDocumentChunks(
  agentId: string,
  docId: string | null,
): UseQueryResult<KnowledgeChunkItem[], ApiClientError> {
  return useQuery({
    queryKey: ["ai", "agents", agentId, "knowledge", docId, "chunks"],
    queryFn: async () => {
      if (!docId) throw new Error("No docId");
      const res = await apiClient.get<KnowledgeChunkItem[]>(
        `${BASE_PATH}/agents/${agentId}/knowledge/${docId}/chunks`,
      );
      return res.data;
    },
    enabled: Boolean(agentId && docId),
  });
}

export interface KnowledgeSearchHitItem {
  content: string;
  distance: number;
  documentId: string;
  filename: string;
}

export function useTestKnowledgeSearch(
  agentId: string,
): UseMutationResult<
  KnowledgeSearchHitItem[],
  ApiClientError,
  { query: string; limit?: number }
> {
  return useMutation({
    mutationFn: async ({ query, limit }) => {
      const res = await apiClient.post<KnowledgeSearchHitItem[]>(
        `${BASE_PATH}/agents/${agentId}/knowledge/search`,
        { query, limit },
      );
      return res.data;
    },
  });
}

export function useKnowledgeDocumentDetail(
  agentId: string,
  docId: string | null,
): UseQueryResult<KnowledgeDocumentDetail, ApiClientError> {
  return useQuery({
    queryKey: ["ai", "agents", agentId, "knowledge", docId],
    queryFn: async () => {
      if (!docId) throw new Error("No docId");
      const res = await apiClient.get<KnowledgeDocumentDetail>(
        `${BASE_PATH}/agents/${agentId}/knowledge/${docId}`,
      );
      return res.data;
    },
    enabled: Boolean(agentId && docId),
  });
}

export function useUpdateKnowledgeDocument(
  agentId: string,
): UseMutationResult<
  KnowledgeDocumentDetail,
  ApiClientError,
  { docId: string; text: string; filename?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docId, text, filename }) => {
      const res = await apiClient.put<KnowledgeDocumentDetail>(
        `${BASE_PATH}/agents/${agentId}/knowledge/${docId}`,
        { text, filename },
      );
      return res.data;
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
      queryClient.setQueryData(["ai", "agents", agentId, "knowledge", variables.docId], data);
    },
  });
}

export function useApproveKnowledgeDocument(
  agentId: string,
): UseMutationResult<
  KnowledgeDocumentDetail,
  ApiClientError,
  { docId: string; text?: string; filename?: string; category?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docId, text, filename, category }) => {
      const res = await apiClient.post<KnowledgeDocumentDetail>(
        `${BASE_PATH}/agents/${agentId}/knowledge/${docId}/approve`,
        { text, filename, category },
      );
      return res.data;
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
      queryClient.setQueryData(["ai", "agents", agentId, "knowledge", variables.docId], data);
    },
  });
}

export function useRestructureKnowledgeDocument(
  agentId: string,
): UseMutationResult<
  KnowledgeDocumentDetail,
  ApiClientError,
  { docId: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ docId }) => {
      const res = await apiClient.post<KnowledgeDocumentDetail>(
        `${BASE_PATH}/agents/${agentId}/knowledge/${docId}/restructure`,
      );
      return res.data;
    },
    onSuccess: (data, variables) => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
      queryClient.setQueryData(["ai", "agents", agentId, "knowledge", variables.docId], data);
    },
  });
}

export function useCreateKnowledgeDraft(
  agentId: string,
): UseMutationResult<
  KnowledgeDocumentDetail,
  ApiClientError,
  { title: string; text: string; category?: string; sourceUrl?: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ title, text, category, sourceUrl }) => {
      const res = await apiClient.post<KnowledgeDocumentDetail>(
        `${BASE_PATH}/agents/${agentId}/knowledge/draft`,
        { title, text, category, sourceUrl },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Синтез базы знаний из CRM и WhatsApp
// ---------------------------------------------------------------------------

export function useCrmKnowledgeStats(): UseQueryResult<CrmKnowledgeStats, ApiClientError> {
  return useQuery({
    queryKey: ["ai", "knowledge", "crm-stats"],
    queryFn: async () => {
      const res = await apiClient.get<CrmKnowledgeStats>(`${BASE_PATH}/knowledge/crm-stats`);
      return res.data;
    },
  });
}

export function useSyncCrmKnowledge(
  agentId: string,
): UseMutationResult<SyncCrmResult, ApiClientError, void> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<SyncCrmResult>(
        `${BASE_PATH}/agents/${agentId}/knowledge/sync-crm`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

export function useImportWhatsAppKnowledge(
  agentId: string,
): UseMutationResult<ImportWhatsAppResult, ApiClientError, { text: string; filename?: string }> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ text, filename }) => {
      const res = await apiClient.post<ImportWhatsAppResult>(
        `${BASE_PATH}/agents/${agentId}/knowledge/import-whatsapp`,
        { text, filename },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(agentId) });
    },
  });
}

// ---------------------------------------------------------------------------
// Мониторинг прогресса сканирования сайта
// ---------------------------------------------------------------------------

export interface CrawlStatusData {
  status: "idle" | "pending" | "in_progress" | "ready" | "failed";
  websiteUrl: string | null;
  pagesScanned: number;
  pagesIndexed: number;
  error: string | null;
  updatedAt: string | null;
}

export function useCrawlStatus(
  agentId: string | null | undefined,
): UseQueryResult<CrawlStatusData, ApiClientError> {
  const queryClient = useQueryClient();
  const prevStatusRef = useRef<CrawlStatusData["status"] | null>(null);

  const query = useQuery<CrawlStatusData, ApiClientError>({
    queryKey: ["ai", "agents", agentId, "crawl-status"],
    queryFn: async () => {
      if (!agentId) throw new Error("No agentId");
      const res = await apiClient.get<CrawlStatusData>(
        `${BASE_PATH}/agents/${agentId}/knowledge/crawl-status`,
      );
      return res.data;
    },
    enabled: Boolean(agentId),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data && (data.status === "pending" || data.status === "in_progress")) {
        return 3000;
      }
      return false;
    },
  });

  const currentStatus = query.data?.status;
  useEffect(() => {
    if (!agentId || !currentStatus) return;
    const prev = prevStatusRef.current;
    prevStatusRef.current = currentStatus;

    // Инвалидируем список документов строго по завершению активного сканирования (переход из pending/in_progress в ready/failed)
    if (
      (prev === "pending" || prev === "in_progress") &&
      (currentStatus === "ready" || currentStatus === "failed")
    ) {
      void queryClient.invalidateQueries({
        queryKey: knowledgeKeys.documents(agentId),
      });
    }
  }, [agentId, currentStatus, queryClient]);

  return query;
}

// ---------------------------------------------------------------------------
// Генеративный синтез системного промпта
// ---------------------------------------------------------------------------

export interface GeneratePromptInput {
  target_page_url?: string;
  targetPageUrl?: string;
  business_niche?: string;
  businessNiche?: string;
  company_name?: string;
  companyName?: string;
  client_profile?: string;
  clientProfile?: string;
  target_action?: string;
  targetAction?: string;
  constraints?: string;
  handoff_specialist?: string;
  handoffSpecialist?: string;
  consultant_name?: string;
  consultantName?: string;
  consultant_role?: string;
  consultantRole?: string;
}

export interface GeneratedPromptResponse {
  systemPrompt: string;
  businessNiche: string;
  clientProfile: string;
  targetAction: string;
  constraints: string;
  consultantName: string;
  consultantRole: string;
  handoffSpecialist: string;
  knowledgeBaseDraftMd: string;
}

export function useGeneratePrompt(): UseMutationResult<
  GeneratedPromptResponse,
  ApiClientError,
  GeneratePromptInput
> {
  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<GeneratedPromptResponse>(
        `${BASE_PATH}/generate-prompt`,
        payload,
      );
      return res.data;
    },
  });
}

// ---------------------------------------------------------------------------
// Синхронизация Markdown-базы знаний агента
// ---------------------------------------------------------------------------

export function useSyncKnowledgeMd(agentId: string): UseMutationResult<
  { id: string; knowledgeBaseMd: string },
  ApiClientError,
  { knowledgeBaseMd: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ knowledgeBaseMd }) => {
      const res = await apiClient.post<{ id: string; knowledgeBaseMd: string }>(
        `${BASE_PATH}/agents/${agentId}/knowledge-sync`,
        { knowledgeBaseMd },
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Петля обучения на диалогах (Dialogue Feedback Loop)
// ---------------------------------------------------------------------------

export interface AgentDialogueFeedback {
  id: string;
  agentId: string;
  dealId?: string | null;
  dealTitle?: string | null;
  contactName?: string | null;
  conversationId?: string | null;
  lastMessagePreview?: string | null;
  rating: number;
  userComment: string;
  clarificationQa: Array<{ question: string; answer?: string | null }>;
  compiledRule?: string | null;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  updatedAt: string;
}

export function useAgentFeedbacks(
  agentId: string | null | undefined,
): UseQueryResult<AgentDialogueFeedback[], ApiClientError> {
  return useQuery({
    queryKey: ["ai", "agents", agentId, "feedbacks"],
    queryFn: async () => {
      if (!agentId) throw new Error("No agentId");
      const res = await apiClient.get<AgentDialogueFeedback[]>(
        `${BASE_PATH}/agents/${agentId}/feedback`,
      );
      return res.data;
    },
    enabled: Boolean(agentId),
  });
}

export function useCreateDialogueFeedback(agentId?: string): UseMutationResult<
  AgentDialogueFeedback,
  ApiClientError,
  {
    rating: number;
    user_comment: string;
    deal_id?: string;
    conversation_id?: string;
    clarification_answer?: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      if (!agentId) throw new Error("No agentId provided");
      const res = await apiClient.post<AgentDialogueFeedback>(
        `${BASE_PATH}/agents/${agentId}/feedback`,
        payload,
      );
      return res.data;
    },
    onSuccess: () => {
      if (agentId) {
        void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId, "feedbacks"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
    },
  });
}

export function useCreateDealFeedback(dealId: string): UseMutationResult<
  AgentDialogueFeedback,
  ApiClientError,
  {
    rating: number;
    user_comment: string;
    agent_id?: string;
    conversation_id?: string;
    clarification_answer?: string;
  }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload) => {
      const res = await apiClient.post<AgentDialogueFeedback>(
        `/api/v1/crm/deals/${dealId}/feedback`,
        payload,
      );
      return res.data;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
      if (data?.agentId) {
        void queryClient.invalidateQueries({ queryKey: ["ai", "agents", data.agentId, "feedbacks"] });
      }
      void queryClient.invalidateQueries({ queryKey: ["crm-chat", "deal", dealId] });
    },
  });
}

export function useApproveFeedback(agentId: string): UseMutationResult<
  { feedback: AgentDialogueFeedback; knowledgeBaseMd: string },
  ApiClientError,
  { feedbackId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ feedbackId }) => {
      const res = await apiClient.post<{ feedback: AgentDialogueFeedback; knowledgeBaseMd: string }>(
        `${BASE_PATH}/agents/${agentId}/feedback/${feedbackId}/approve`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId, "feedbacks"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
    },
  });
}

export function useRejectFeedback(agentId: string): UseMutationResult<
  AgentDialogueFeedback,
  ApiClientError,
  { feedbackId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ feedbackId }) => {
      const res = await apiClient.post<AgentDialogueFeedback>(
        `${BASE_PATH}/agents/${agentId}/feedback/${feedbackId}/reject`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId, "feedbacks"] });
    },
  });
}

export interface RebuildAgentPromptResult {
  agentId: string;
  systemPrompt: string;
  knowledgeBaseMd: string;
  summaryOfChanges: string;
  feedbacksCount: number;
}

export function useRebuildAgentPrompt(agentId: string): UseMutationResult<
  RebuildAgentPromptResult,
  ApiClientError,
  void
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<RebuildAgentPromptResult>(
        `${BASE_PATH}/agents/${agentId}/rebuild-prompt`,
        {},
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId, "feedbacks"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
    },
  });
}

export function useDeleteFeedback(agentId: string): UseMutationResult<
  { success: boolean; id: string },
  ApiClientError,
  { feedbackId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ feedbackId }) => {
      const res = await apiClient.delete<{ success: boolean; id: string }>(
        `${BASE_PATH}/agents/${agentId}/feedback/${feedbackId}`,
      );
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId, "feedbacks"] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents", agentId] });
      void queryClient.invalidateQueries({ queryKey: ["ai", "agents"] });
    },
  });
}




