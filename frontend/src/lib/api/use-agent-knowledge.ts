"use client";

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
  documents: (agentId: string) => ["ai", "agents", agentId, "knowledge"] as const,
  channels: (agentId: string) => ["ai", "agents", agentId, "channels"] as const,
};

export type DocumentStatus = "processing" | "ready" | "failed";

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

