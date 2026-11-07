"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Database,
  Edit3,
  ExternalLink,
  Eye,
  FileCode,
  FileText,
  Globe,
  Loader2,
  MessageSquare,
  MessageSquareQuote,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

import {
  useAddKnowledgeText,
  useAgentFeedbacks,
  useApproveFeedback,
  useCrawlSite,
  useCrmKnowledgeStats,
  useDeleteFeedback,
  useDeleteKnowledgeDocument,
  useImportKnowledgeUrl,
  useImportMapReviews,
  useKnowledgeDocuments,
  useRebuildAgentPrompt,
  useRejectFeedback,
  useSalesExamples,
  useSyncKnowledgeMd,
  useTestKnowledgeSearch,
  useUploadKnowledgeFile,
  type KnowledgeDocument,
  type KnowledgeSearchHitItem,
} from "@/lib/api/use-agent-knowledge";
import { useAiAgent } from "@/lib/api/use-ai-agents";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { cn } from "@/lib/utils";
import { EditDocumentSheet } from "./EditDocumentSheet";
import { WhatsAppImportModal } from "./WhatsAppImportModal";
import { CrmSyncModal } from "./CrmSyncModal";

// ---------------------------------------------------------------------------
// Вкладка «База знаний» на странице агента.
//
// Именно на странице агента, а не в модальном окне настроек: документ
// привязывается к существующему агенту, и до первого сохранения привязывать его
// некуда. В модальном окне создания раздел показывал бы поле загрузки, которое
// ничего не делает.
// ---------------------------------------------------------------------------

interface AgentKnowledgeTabProps {
  agentId: string;
  /** Право на изменение (`ai_bots:configure`); без него доступен только просмотр. */
  canEdit: boolean;
}

const STATUS_LABEL: Record<KnowledgeDocument["status"], string> = {
  draft: "Черновик (на проверке)",
  processing: "Векторизация...",
  ready: "Готов",
  failed: "Ошибка",
  approved: "Утверждён",
};

const STATUS_CLASS: Record<KnowledgeDocument["status"], string> = {
  draft: "bg-amber-500/10 text-amber-700 border-amber-300",
  processing: "bg-yellow-400/10 text-yellow-600 border-yellow-400/30",
  ready: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  failed: "bg-rose-500/10 text-rose-500 border-rose-500/30",
  approved: "bg-blue-500/10 text-blue-700 border-blue-300",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** «4 фрагмента» / «1 фрагмент» / «12 фрагментов». */
function pluralChunks(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} фрагмент`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} фрагмента`;
  return `${count} фрагментов`;
}

function isDocInCategory(
  filename: string,
  category: "prices" | "crm" | "whatsapp" | "site" | "reviews",
): boolean {
  const lower = filename.toLowerCase();
  if (category === "prices") {
    return (
      lower.includes("прайс") ||
      lower.includes("цена") ||
      lower.includes("цен") ||
      lower.includes("price") ||
      lower.includes("услуг") ||
      lower.includes("кп") ||
      lower.includes("коммерческ") ||
      lower.includes("тариф") ||
      lower.includes("смет") ||
      lower.includes("стоимост") ||
      lower.includes("расчет") ||
      lower.includes("расчёт") ||
      filename.endsWith(".docx") ||
      filename.endsWith(".pdf") ||
      filename.endsWith(".xlsx")
    );
  }
  if (category === "crm") {
    return filename.startsWith("[CRM]") || filename.startsWith("CRM") || lower.includes("сделка");
  }
  if (category === "whatsapp") {
    return (
      filename.startsWith("[WhatsApp]") ||
      filename.startsWith("WhatsApp") ||
      lower.includes("whatsapp") ||
      lower.includes("ватсап")
    );
  }
  if (category === "site") {
    return (
      filename.startsWith("Сайт") ||
      filename.startsWith("[Сайт]") ||
      lower.includes("http") ||
      lower.includes(".ru") ||
      lower.includes(".com")
    );
  }
  if (category === "reviews") {
    return (
      filename.startsWith("[Отзывы]") ||
      filename.startsWith("Отзывы") ||
      lower.includes("отзыв") ||
      lower.includes("карты") ||
      lower.includes("карт") ||
      lower.includes("яндекс") ||
      lower.includes("2gis")
    );
  }
  return false;
}

export function AgentKnowledgeTab({ agentId, canEdit }: AgentKnowledgeTabProps) {
  const { data, isLoading, error } = useKnowledgeDocuments(agentId);
  const addText = useAddKnowledgeText(agentId);
  const uploadFile = useUploadKnowledgeFile(agentId);
  const importUrl = useImportKnowledgeUrl(agentId);
  const crawlSite = useCrawlSite(agentId);
  const importMapReviews = useImportMapReviews(agentId);
  const remove = useDeleteKnowledgeDocument(agentId);
  const { data: salesExamplesData, isLoading: isLoadingSales } = useSalesExamples(agentId);
  const { data: agentData } = useAiAgent(agentId);
  const { data: feedbacksData, isLoading: isLoadingFeedbacks } = useAgentFeedbacks(agentId);
  const approveFeedback = useApproveFeedback(agentId);
  const rejectFeedback = useRejectFeedback(agentId);
  const deleteFeedback = useDeleteFeedback(agentId);
  const rebuildPrompt = useRebuildAgentPrompt(agentId);
  const syncKnowledgeMd = useSyncKnowledgeMd(agentId);

  const [activeSubTab, setActiveSubTab] = useState<"documents" | "markdown" | "feedback" | "sales" | "inspector">("documents");
  const [markdownContent, setMarkdownContent] = useState("");
  const [isMarkdownDirty, setIsMarkdownDirty] = useState(false);
  const [feedbackFilter, setFeedbackFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchHitItem[] | null>(null);
  const testSearch = useTestKnowledgeSearch(agentId);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [textOpen, setTextOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const [urlOpen, setUrlOpen] = useState(false);
  const [urlValue, setUrlValue] = useState("");
  const [urlTitle, setUrlTitle] = useState("");
  const [isCrawlAll, setIsCrawlAll] = useState(true);
  const [crawlMaxPages, setCrawlMaxPages] = useState(25);

  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewsUrl, setReviewsUrl] = useState("");
  const [manualReviewMode, setManualReviewMode] = useState(false);
  const [reviewsSource, setReviewsSource] = useState("Яндекс Карты");
  const [reviewsText, setReviewsText] = useState("");

  const [pendingDelete, setPendingDelete] = useState<KnowledgeDocument | null>(null);
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [whatsappOpen, setWhatsappOpen] = useState(false);
  const [crmSyncOpen, setCrmSyncOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "prices" | "crm" | "whatsapp" | "site" | "reviews"
  >("all");

  const { data: crmStats } = useCrmKnowledgeStats();

  const meta = data?.meta;
  const documents = data?.documents ?? [];
  const vectorisationAvailable = meta?.vectorisationAvailable ?? false;

  const filteredDocuments = useMemo(() => {
    if (categoryFilter === "all") return documents;
    return documents.filter((doc) => isDocInCategory(doc.filename, categoryFilter));
  }, [documents, categoryFilter]);

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Значение сбрасывается сразу: без этого повторный выбор того же файла не
      // вызывает `change`, и загрузка после ошибки выглядела бы неработающей.
      event.target.value = "";

      if (file === undefined) return;

      void uploadFile
        .mutateAsync(file)
        .then((document) => {
          toast.success(
            `«${document.filename}» загружен: ${pluralChunks(document.chunksCount)}`,
          );
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Не удалось загрузить файл");
        });
    },
    [uploadFile],
  );

  const handleAddText = useCallback(() => {
    if (title.trim().length === 0 || text.trim().length === 0) {
      toast.error("Укажите название и текст документа");
      return;
    }

    void addText
      .mutateAsync({ title: title.trim(), text: text.trim() })
      .then((document) => {
        toast.success(`«${document.filename}» добавлен: ${pluralChunks(document.chunksCount)}`);
        setTitle("");
        setText("");
        setTextOpen(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить документ");
      });
  }, [addText, title, text]);

  const handleImportUrl = useCallback(() => {
    const raw = urlValue.trim();
    if (raw.length === 0) {
      toast.error("Укажите адрес веб-сайта (например, https://mysite.ru)");
      return;
    }

    if (isCrawlAll) {
      void crawlSite
        .mutateAsync({ url: raw, maxPages: crawlMaxPages })
        .then((res) => {
          toast.success(
            `Сайт успешно просканирован! Обработано страниц: ${res.scannedCount}, добавлено в базу знаний: ${res.indexedCount}`,
          );
          setUrlValue("");
          setUrlTitle("");
          setUrlOpen(false);
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Не удалось просканировать сайт");
        });
    } else {
      void importUrl
        .mutateAsync({ url: raw, title: urlTitle.trim() || undefined })
        .then((doc) => {
          toast.success(`Страница «${doc.filename}» успешно импортирована: ${pluralChunks(doc.chunksCount)}`);
          setUrlValue("");
          setUrlTitle("");
          setUrlOpen(false);
          if (doc?.id) {
            setEditingDocId(doc.id);
          }
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Не удалось импортировать страницу");
        });
    }
  }, [crawlSite, importUrl, isCrawlAll, crawlMaxPages, urlValue, urlTitle]);

  const handleImportMapReviews = useCallback(() => {
    if (manualReviewMode) {
      if (reviewsText.trim().length === 0) {
        toast.error("Вставьте текст отзывов или описание справочника");
        return;
      }

      const docTitle = `Отзывы и репутация (${reviewsSource})`;
      void addText
        .mutateAsync({ title: docTitle, text: reviewsText.trim() })
        .then((doc) => {
          toast.success(`Отзывы успешно добавлены в базу знаний: ${pluralChunks(doc.chunksCount)}`);
          setReviewsText("");
          setReviewsOpen(false);
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Не удалось сохранить отзывы");
        });
      return;
    }

    const raw = reviewsUrl.trim();
    if (raw.length === 0) {
      toast.error("Укажите ссылку на карточку компании на картах (Яндекс Карты, 2ГИС, Google Maps, Zoon)");
      return;
    }

    void importMapReviews
      .mutateAsync({ url: raw })
      .then((res) => {
        const ratingInfo = res.details.rating ? `Рейтинг: ${res.details.rating}★` : "Профиль загружен";
        const reviewsInfo = res.details.reviewsCount ? ` (${res.details.reviewsCount} отзывов)` : "";
        toast.success(
          `«${res.details.orgName}» успешно импортирован с ${res.details.platform}! ${ratingInfo}${reviewsInfo}`,
        );
        setReviewsUrl("");
        setReviewsOpen(false);
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Не удалось загрузить данные с карт");
      });
  }, [addText, importMapReviews, manualReviewMode, reviewsSource, reviewsText, reviewsUrl]);

  const handleDelete = useCallback(() => {
    if (pendingDelete === null) return;
    const target = pendingDelete;

    void remove
      .mutateAsync({ documentId: target.id })
      .then(() => toast.success(`«${target.filename}» удалён`))
      .catch((err: unknown) =>
        toast.error(err instanceof Error ? err.message : "Не удалось удалить документ"),
      )
      .finally(() => setPendingDelete(null));
  }, [pendingDelete, remove]);

  const agentKnowledgeMd = agentData?.knowledge_base_md;
  // Инициализация редактора живой базы знаний из данных агента
  useEffect(() => {
    if (agentKnowledgeMd !== undefined && !isMarkdownDirty) {
      setMarkdownContent(agentKnowledgeMd ?? "");
    }
  }, [agentKnowledgeMd, isMarkdownDirty]);

  const handleSaveMarkdown = useCallback(() => {
    void syncKnowledgeMd
      .mutateAsync({ knowledgeBaseMd: markdownContent })
      .then(() => {
        setIsMarkdownDirty(false);
        toast.success("Живая база знаний (.md) сохранена и синхронизирована!");
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Не удалось сохранить базу знаний");
      });
  }, [markdownContent, syncKnowledgeMd]);

  const handleApproveFeedback = useCallback(
    (feedbackId: string) => {
      void approveFeedback
        .mutateAsync({ feedbackId })
        .then((res) => {
          toast.success("Правило утверждено и внесено в базу знаний!");
          if (res.knowledgeBaseMd) {
            setMarkdownContent(res.knowledgeBaseMd);
            setIsMarkdownDirty(false);
          }
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Ошибка утверждения правила");
        });
    },
    [approveFeedback],
  );

  const handleRejectFeedback = useCallback(
    (feedbackId: string) => {
      void rejectFeedback
        .mutateAsync({ feedbackId })
        .then(() => {
          toast.success("Отзыв отклонён");
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Ошибка отклонения");
        });
    },
    [rejectFeedback],
  );

  const handleDeleteFeedback = useCallback(
    (feedbackId: string) => {
      void deleteFeedback
        .mutateAsync({ feedbackId })
        .then(() => {
          toast.success("Запись отзыва удалена");
        })
        .catch((err: unknown) => {
          toast.error(err instanceof Error ? err.message : "Ошибка удаления отзыва");
        });
    },
    [deleteFeedback],
  );

  const handleRebuildPrompt = useCallback(() => {
    void rebuildPrompt
      .mutateAsync()
      .then((res) => {
        toast.success(res.summaryOfChanges || "Системный промпт агента успешно пересобран!");
      })
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : "Не удалось пересобрать промпт");
      });
  }, [rebuildPrompt]);

  const handleTestSearch = useCallback(
    async (e?: React.FormEvent) => {
      if (e) e.preventDefault();
      const q = searchQuery.trim();
      if (!q) return;

      try {
        const hits = await testSearch.mutateAsync({ query: q, limit: 10 });
        setSearchResults(hits);
      } catch (err: unknown) {
        toast.error(err instanceof Error ? err.message : "Ошибка выполнения поиска по вектору");
      }
    },
    [searchQuery, testSearch],
  );

  const isBusy =
    uploadFile.isPending ||
    addText.isPending ||
    importUrl.isPending ||
    crawlSite.isPending ||
    importMapReviews.isPending;
  const accept = (meta?.supportedExtensions ?? []).map((ext) => `.${ext}`).join(",");

  return (
    <div className="space-y-4">
      {/* Sub-tab switcher */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setActiveSubTab("documents")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer border",
            activeSubTab === "documents"
              ? "bg-[#4a38f5] text-white border-[#4a38f5] shadow-2xs"
              : "bg-white text-[#666666] border-[#e5e5e5] hover:text-[#111111] hover:bg-slate-50",
          )}
        >
          <FileText className="h-3.5 w-3.5" />
          Документы и файлы ({documents.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("markdown")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer border",
            activeSubTab === "markdown"
              ? "bg-[#4a38f5] text-white border-[#4a38f5] shadow-2xs"
              : "bg-white text-[#666666] border-[#e5e5e5] hover:text-[#111111] hover:bg-slate-50",
          )}
        >
          <BookOpen className="h-3.5 w-3.5" />
          Живая база знаний (.md)
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("feedback")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer border",
            activeSubTab === "feedback"
              ? "bg-[#4a38f5] text-white border-[#4a38f5] shadow-2xs"
              : "bg-white text-[#666666] border-[#e5e5e5] hover:text-[#111111] hover:bg-slate-50",
          )}
        >
          <MessageSquareQuote className="h-3.5 w-3.5" />
          Обучение на диалогах ({feedbacksData?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("sales")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer border",
            activeSubTab === "sales"
              ? "bg-[#4a38f5] text-white border-[#4a38f5] shadow-2xs"
              : "bg-white text-[#666666] border-[#e5e5e5] hover:text-[#111111] hover:bg-slate-50",
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          Опыт успешных сделок ({salesExamplesData?.length ?? 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveSubTab("inspector")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-[8px] transition-colors cursor-pointer border",
            activeSubTab === "inspector"
              ? "bg-[#4a38f5] text-white border-[#4a38f5] shadow-2xs"
              : "bg-white text-[#666666] border-[#e5e5e5] hover:text-[#111111] hover:bg-slate-50",
          )}
        >
          <Search className="h-3.5 w-3.5" />
          Инспектор RAG-поиска
        </button>
      </div>

      {/* Предупреждение о неготовности платформы */}
      {!isLoading && !vectorisationAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-yellow-400/30 bg-yellow-400/5 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-400" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-yellow-400">Векторизация недоступна</p>
            <p className="text-slate-400">
              На платформе не настроен доступ к моделям, поэтому загрузка документов сейчас
              невозможна. Обратитесь к администратору платформы.
            </p>
          </div>
        </div>
      )}

      {/* Вкладка 1: ДОКУМЕНТЫ И МАТЕРИАЛЫ */}
      {activeSubTab === "documents" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">База знаний и регламенты</h3>
              <p className="text-xs text-[#666666]">
                Файлы, тексты регламентов, сайт компании и отзывы. Текст индексируется в векторы для поиска по смыслу.
              </p>
            </div>

            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTextOpen((open) => !open);
                    setUrlOpen(false);
                    setReviewsOpen(false);
                  }}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] transition-colors",
                    "hover:bg-[#f5f5f5]",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Текстом
                </button>

                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] transition-colors",
                    "hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  {uploadFile.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Файлом
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setUrlOpen((open) => !open);
                    setTextOpen(false);
                    setReviewsOpen(false);
                  }}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#4a38f5] transition-colors",
                    "hover:bg-[#4a38f5]/5 disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Globe className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Ссылка на сайт
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setReviewsOpen((open) => !open);
                    setTextOpen(false);
                    setUrlOpen(false);
                  }}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-semibold text-[#111111] transition-colors",
                    "hover:bg-[#f5f5f5] disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Star className="h-3.5 w-3.5 text-amber-500" />
                  Отзывы (Карты)
                </button>

                <button
                  type="button"
                  onClick={() => setCrmSyncOpen(true)}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-[#4a38f5]/30 bg-[#4a38f5]/5 px-3 py-1.5 text-xs font-semibold text-[#4a38f5] transition-colors",
                    "hover:bg-[#4a38f5]/10 disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Опыт из CRM
                  {crmStats?.wonDeals ? (
                    <span className="ml-0.5 rounded-full bg-[#4a38f5] px-1.5 py-0.2 text-[10px] text-white font-mono">
                      {crmStats.wonDeals}
                    </span>
                  ) : null}
                </button>

                <button
                  type="button"
                  onClick={() => setWhatsappOpen(true)}
                  disabled={!vectorisationAvailable || isBusy}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[8px] border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors",
                    "hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50",
                  )}
                >
                  <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
                  Архив WhatsApp (.txt)
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  accept={accept}
                  onChange={handleFileChange}
                  className="hidden"
                />
              </div>
            )}
          </div>

          {/* Форма: Текстом */}
          {textOpen && canEdit && (
            <div className="space-y-3 border-b border-[#e5e5e5] bg-[#fafafa] px-6 py-4">
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Название документа, например «Прайс-лист на ремонт и ТО 2026»"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
                placeholder="Вставьте регламент, ответы на частые вопросы или правила обслуживания..."
                className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#666666]">{text.length} символов</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTextOpen(false)}
                    className="rounded-[8px] px-3 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111]"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleAddText}
                    disabled={addText.isPending}
                    className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                  >
                    {addText.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Добавить в базу знаний
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Форма: Импорт и сканирование сайта (Краулер / Страница) */}
          {urlOpen && canEdit && (
            <div className="space-y-4 border-b border-[#e5e5e5] bg-blue-50/30 px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#111111]">
                  <Globe className="h-4 w-4 text-[#4a38f5]" />
                  Импорт и сканирование сайта компании
                </div>
                <div className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white p-0.5">
                  <button
                    type="button"
                    onClick={() => setIsCrawlAll(true)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors cursor-pointer",
                      isCrawlAll
                        ? "bg-[#4a38f5] text-white shadow-2xs"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    Весь сайт (краулер)
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCrawlAll(false)}
                    className={cn(
                      "px-2.5 py-1 text-[11px] font-medium rounded-[4px] transition-colors cursor-pointer",
                      !isCrawlAll
                        ? "bg-[#4a38f5] text-white shadow-2xs"
                        : "text-[#666666] hover:text-[#111111]",
                    )}
                  >
                    Одна страница
                  </button>
                </div>
              </div>

              <p className="text-xs text-[#666666]">
                {isCrawlAll
                  ? "Краулер автоматически найдёт все страницы через sitemap.xml и внутренние ссылки (услуги, прайсы, контакты, условия), очистит разметку и проиндексирует базу знаний."
                  : "Загрузить текст только одной конкретной страницы сайта по прямому адресу."}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className={cn(isCrawlAll ? "sm:col-span-2" : "sm:col-span-1")}>
                  <input
                    type="url"
                    value={urlValue}
                    onChange={(e) => setUrlValue(e.target.value)}
                    placeholder={isCrawlAll ? "https://mysite.ru" : "https://mysite.ru/services/prices"}
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                {isCrawlAll ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[#666666] whitespace-nowrap">Лимит:</span>
                    <select
                      value={crawlMaxPages}
                      onChange={(e) => setCrawlMaxPages(Number(e.target.value))}
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 cursor-pointer"
                    >
                      <option value={10}>до 10 страниц</option>
                      <option value={25}>до 25 страниц (рекомендуется)</option>
                      <option value={50}>до 50 страниц (полный охват)</option>
                    </select>
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <input
                      type="text"
                      value={urlTitle}
                      onChange={(e) => setUrlTitle(e.target.value)}
                      placeholder="Название (например «Услуги и цены»)"
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setUrlOpen(false)}
                  className="rounded-[8px] px-3 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111] cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleImportUrl}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                >
                  {(crawlSite.isPending || importUrl.isPending) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {isCrawlAll
                    ? crawlSite.isPending
                      ? "Сканируем сайт..."
                      : "Запустить сканирование сайта"
                    : importUrl.isPending
                      ? "Импортируем..."
                      : "Импортировать страницу"}
                </button>
              </div>
            </div>
          )}

          {/* Форма: Отзывы и профиль из справочников по ссылке */}
          {reviewsOpen && canEdit && (
            <div className="space-y-4 border-b border-[#e5e5e5] bg-amber-50/30 px-6 py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#854d0e]">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  Импорт отзывов и рейтинга с карт по ссылке
                </div>
                <button
                  type="button"
                  onClick={() => setManualReviewMode((m) => !m)}
                  className="text-xs text-[#4a38f5] hover:underline cursor-pointer text-left"
                >
                  {manualReviewMode ? "← Импортировать по ссылке на карты" : "Вставить текст отзывов вручную"}
                </button>
              </div>

              <p className="text-xs text-[#666666]">
                {manualReviewMode
                  ? "Скопируйте текст реальных отзывов клиентов и вставьте сюда. Агент будет использовать цитаты и высокий рейтинг компании для снятия сомнений и закрытия сделок."
                  : "Вставьте прямую ссылку на карточку компании на картах. Система извлечёт название, общий рейтинг (например, 4.9★), адрес и реальные цитаты клиентов для использования в диалогах."}
              </p>

              {!manualReviewMode ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs font-medium text-[#111111] mr-1">Поддерживаемые сервисы:</span>
                    {[
                      { name: "Яндекс Карты", sample: "https://yandex.ru/maps/org/..." },
                      { name: "2ГИС", sample: "https://2gis.ru/moscow/firm/..." },
                      { name: "Google Maps", sample: "https://maps.google.com/..." },
                      { name: "Zoon", sample: "https://zoon.ru/..." },
                      { name: "Flamp", sample: "https://flamp.ru/..." },
                    ].map((svc) => (
                      <button
                        key={svc.name}
                        type="button"
                        onClick={() => {
                          if (!reviewsUrl) setReviewsUrl(svc.sample);
                        }}
                        className="rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[11px] text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors cursor-pointer"
                      >
                        {svc.name}
                      </button>
                    ))}
                  </div>

                  <input
                    type="url"
                    value={reviewsUrl}
                    onChange={(e) => setReviewsUrl(e.target.value)}
                    placeholder="https://yandex.ru/maps/org/remont_i_servis/123456789/ или https://2gis.ru/..."
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-[#111111]">Источник:</span>
                    {["Яндекс Карты", "2ГИС", "Google Карты", "Zoon"].map((source) => (
                      <button
                        key={source}
                        type="button"
                        onClick={() => setReviewsSource(source)}
                        className={cn(
                          "px-2.5 py-1 text-xs rounded-[6px] border font-medium transition-colors cursor-pointer",
                          reviewsSource === source
                            ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                            : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-slate-50",
                        )}
                      >
                        {source}
                      </button>
                    ))}
                  </div>
                  <textarea
                    value={reviewsText}
                    onChange={(e) => setReviewsText(e.target.value)}
                    rows={5}
                    placeholder="Вставьте скопированные отзывы (например: «Отличный сервис, починили за 2 часа, дали гарантию на год. Мастер Дмитрий все объяснил... Рейтинг 4.9 из 5»)..."
                    className="w-full resize-y rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setReviewsOpen(false)}
                  className="rounded-[8px] px-3 py-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111] cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleImportMapReviews}
                  disabled={isBusy}
                  className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer"
                >
                  {(importMapReviews.isPending || addText.isPending) && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {importMapReviews.isPending
                    ? "Загружаем отзывы..."
                    : !manualReviewMode
                      ? "Импортировать отзывы по ссылке"
                      : "Сохранить отзывы в базу"}
                </button>
              </div>
            </div>
          )}

          {/* Фильтры категорий базы знаний */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-[#e5e5e5] px-6 py-2.5 bg-white">
            <span className="text-xs text-[#888888] mr-1">Категория:</span>
            {[
              { id: "all", label: "Все", count: documents.length },
              {
                id: "prices",
                label: "💰 Прайс и услуги",
                count: documents.filter((d) => isDocInCategory(d.filename, "prices")).length,
              },
              {
                id: "crm",
                label: "⚡ Из CRM",
                count: documents.filter((d) => isDocInCategory(d.filename, "crm")).length,
              },
              {
                id: "whatsapp",
                label: "💬 WhatsApp",
                count: documents.filter((d) => isDocInCategory(d.filename, "whatsapp")).length,
              },
              {
                id: "site",
                label: "🌐 Сайт",
                count: documents.filter((d) => isDocInCategory(d.filename, "site")).length,
              },
              {
                id: "reviews",
                label: "⭐ Отзывы",
                count: documents.filter((d) => isDocInCategory(d.filename, "reviews")).length,
              },
            ].map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() =>
                  setCategoryFilter(
                    cat.id as "all" | "prices" | "crm" | "whatsapp" | "site" | "reviews",
                  )
                }
                className={cn(
                  "px-2.5 py-1 text-xs rounded-[6px] transition-colors cursor-pointer border",
                  categoryFilter === cat.id
                    ? "bg-[#111111] text-white border-[#111111] font-medium"
                    : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-[#f5f5f5] hover:text-[#111111]",
                )}
              >
                {cat.label} ({cat.count})
              </button>
            ))}
          </div>

          {/* Список документов */}
          <div className="p-6">
            {isLoading && (
              <div className="space-y-2">
                {Array.from({ length: 3 }, (_, index) => (
                  <Skeleton key={index} className="h-14 w-full" />
                ))}
              </div>
            )}

            {error !== null && !isLoading && (
              <p className="text-sm text-rose-500">
                Не удалось загрузить документы: {error.message}
              </p>
            )}

            {!isLoading && error === null && filteredDocuments.length === 0 && (
              <EmptyState
                icon={FileText}
                title={
                  categoryFilter === "all"
                    ? "База знаний пока пуста"
                    : "В этой категории пока нет документов"
                }
                description={
                  categoryFilter === "all"
                    ? "Загрузите регламент, прайс, добавьте ссылку на сайт или синхронизируйте опыт из CRM / WhatsApp — агент будет опираться на них при диалогах."
                    : "Выберите другую категорию или добавьте материалы с соответствующим типом."
                }
              />
            )}

            {!isLoading && filteredDocuments.length > 0 && (
              <div className="space-y-2">
                {filteredDocuments.map((document) => {
                  const isPrice = isDocInCategory(document.filename, "prices");

                  return (
                    <div
                      key={document.id}
                      onClick={() => setEditingDocId(document.id)}
                      className="flex items-center gap-4 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-3 transition-colors hover:bg-[#fafafa] hover:border-[#cccccc] cursor-pointer group"
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[#888888] group-hover:text-[#4a38f5] transition-colors" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="truncate text-sm font-medium text-[#111111] group-hover:text-[#4a38f5] transition-colors">
                            {document.filename}
                          </p>
                          {isPrice && (
                            <span className="shrink-0 rounded-[4px] border border-[#fef08a] bg-[#fefce8] px-1.5 py-0.5 text-[10px] font-semibold text-[#854d0e]">
                              Приоритет цен
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[#666666]">
                          {pluralChunks(document.chunksCount)} · {formatSize(document.fileSize)} ·{" "}
                          {formatDate(document.createdAt)}
                          {document.agentId === null && " · общий для всех агентов"}
                        </p>
                        {document.status === "failed" && document.errorMessage.length > 0 && (
                          <p className="mt-1 text-xs text-rose-400">{document.errorMessage}</p>
                        )}
                      </div>

                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          STATUS_CLASS[document.status],
                        )}
                      >
                        {STATUS_LABEL[document.status]}
                      </span>

                      {document.status === "draft" && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingDocId(document.id);
                          }}
                          className="shrink-0 rounded-[6px] border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
                        >
                          Проверить черновик
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingDocId(document.id);
                        }}
                        title="Просмотреть и редактировать"
                        className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-[#4a38f5]/10 hover:text-[#4a38f5]"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>

                      {canEdit && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete(document);
                          }}
                          aria-label={`Удалить ${document.filename}`}
                          className="shrink-0 rounded-md p-1.5 text-slate-500 transition-colors hover:bg-rose-500/10 hover:text-rose-400"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Вкладка: ЖИВАЯ БАЗА ЗНАНИЙ (.MD) */}
      {activeSubTab === "markdown" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3.5 rounded-[8px] border border-[#4a38f5]/20 bg-[#4a38f5]/[0.03] p-4">
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[#4a38f5]" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-[#111111]">
                Живая база знаний агента (.md)
              </p>
              <p className="text-[#555555] leading-relaxed">
                Этот Markdown-документ является активным живым источником знаний и правил агента. Все изменения синхронизируются атомарно и внедряются в системный контекст агента с наивысшим приоритетом над фоновыми векторными выдержками.
              </p>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">Редактор базы знаний (.md)</h3>
                <p className="text-xs text-[#666666]">
                  Свободно структурируйте факты о компании, прайс-лист, тарифы, регламенты и утвержденные правила.
                </p>
              </div>

              {canEdit && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const template = `# База знаний компании\n\n## 1. Основные направления и услуги\n- Услуга 1: описание и условия\n- Услуга 2: описание и условия\n\n## 2. Прайс-лист и ценообразование\n- Базовый тариф: от ... руб.\n- Полный комплекс: от ... руб.\n\n## 3. Регламент консультации\n- Всегда уточнять ключевые параметры запроса\n- Запрашивать номер телефона для связи с профильным специалистом\n\n## Обучение на диалогах (Утвержденные правила)\n`;
                      setMarkdownContent((prev) => (prev.trim().length > 0 ? `${prev.trim()}\n\n${template}` : template));
                      setIsMarkdownDirty(true);
                    }}
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                  >
                    Вставить шаблон
                  </button>

                  <button
                    type="button"
                    disabled={syncKnowledgeMd.isPending}
                    onClick={handleSaveMarkdown}
                    className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                  >
                    {syncKnowledgeMd.isPending ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Синхронизация...</span>
                      </>
                    ) : (
                      <>
                        <Save className="h-3.5 w-3.5" />
                        <span>Сохранить базу знаний (.md)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            <div className="p-6 space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Формат: Markdown / GFM</span>
                <span>{markdownContent.length} символов</span>
              </div>
              <textarea
                rows={18}
                value={markdownContent}
                disabled={!canEdit}
                onChange={(e) => {
                  setMarkdownContent(e.target.value);
                  setIsMarkdownDirty(true);
                }}
                placeholder="# Введите структурированные знания, прайс, факты или регламенты компании..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 text-xs text-[#111111] font-mono leading-relaxed focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 resize-y"
              />
            </div>
          </div>
        </div>
      )}

      {/* Вкладка: ОБУЧЕНИЕ НА ДИАЛОГАХ (ОБРАТНАЯ СВЯЗЬ) */}
      {activeSubTab === "feedback" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3.5 rounded-[8px] border border-amber-200 bg-amber-50/70 p-4">
            <MessageSquareQuote className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-[#111111]">
                Петля самообучения через обратную связь диалогов (Human-in-the-loop)
              </p>
              <p className="text-[#555555] leading-relaxed">
                Операторы и клиенты могут оценивать качество работы агента (1-5 звёзд) и оставлять комментарии после диалогов. Если замечание обоснованно, вы можете в один клик утвердить правило, и оно автоматически дополнит живую базу знаний агента.
              </p>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
              <div>
                <h3 className="text-sm font-semibold text-[#111111]">
                  Журнал обратной связи и предложенных правил
                </h3>
                <p className="text-xs text-[#666666]">
                  Оценки ответов бота, комментарии операторов и статус включения в базу знаний.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canEdit && (
                  <button
                    type="button"
                    disabled={rebuildPrompt.isPending}
                    onClick={handleRebuildPrompt}
                    className="h-8 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50 cursor-pointer flex items-center gap-1.5 transition-colors shadow-2xs"
                    title="Собрать все утвержденные правила обучения и встроить их в системный промпт агента"
                  >
                    {rebuildPrompt.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3.5 w-3.5" />
                    )}
                    <span>Пересобрать промпт агента</span>
                    {(feedbacksData?.filter((fb) => fb.status === "approved").length ?? 0) > 0 && (
                      <span className="ml-1 inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono font-medium">
                        {feedbacksData?.filter((fb) => fb.status === "approved").length}
                      </span>
                    )}
                  </button>
                )}

                {/* Фильтр по статусу */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-[#e5e5e5]">
                  {(["all", "pending", "approved", "rejected"] as const).map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setFeedbackFilter(status)}
                      className={cn(
                        "px-2.5 py-1 text-xs rounded font-medium transition-colors cursor-pointer",
                        feedbackFilter === status
                          ? "bg-[#4a38f5] text-white"
                          : "text-[#666666] hover:text-[#111111] hover:bg-slate-50",
                      )}
                    >
                      {status === "all" && "Все"}
                      {status === "pending" && "На проверке"}
                      {status === "approved" && "Утверждённые"}
                      {status === "rejected" && "Отклонённые"}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6">
              {isLoadingFeedbacks && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-20 w-full" />
                  ))}
                </div>
              )}

              {!isLoadingFeedbacks &&
                (!feedbacksData ||
                  feedbacksData.filter(
                    (fb) => feedbackFilter === "all" || fb.status === feedbackFilter,
                  ).length === 0) && (
                  <EmptyState
                    icon={MessageSquareQuote}
                    title="Нет отзывов с выбранным статусом"
                    description="Комментарии операторов после диалогов с агентом появятся здесь. Вы сможете подтвердить правило или отклонить его."
                  />
                )}

              {!isLoadingFeedbacks && feedbacksData && feedbacksData.length > 0 && (
                <div className="space-y-3">
                  {feedbacksData
                    .filter((fb) => feedbackFilter === "all" || fb.status === feedbackFilter)
                    .map((item) => {
                      const isPending = item.status === "pending";
                      const isApproved = item.status === "approved";
                      return (
                        <div
                          key={item.id}
                          className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-3 hover:border-[#cccccc] transition-colors shadow-2xs"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {/* Звёздочки */}
                              <div className="flex items-center gap-0.5 text-amber-500">
                                {Array.from({ length: 5 }, (_, i) => (
                                  <Star
                                    key={i}
                                    className={cn(
                                      "h-3.5 w-3.5",
                                      i < item.rating
                                        ? "fill-amber-400 text-amber-400"
                                        : "text-slate-200",
                                    )}
                                  />
                                ))}
                              </div>
                              <span className="text-xs font-semibold text-[#111111]">
                                Оценка {item.rating} из 5
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <span className="text-[11px] text-[#888888] font-mono">
                                {formatDate(item.createdAt)}
                              </span>
                              <span
                                className={cn(
                                  "text-[11px] px-2 py-0.5 rounded-full font-medium border",
                                  isPending && "bg-amber-50 text-amber-700 border-amber-200",
                                  isApproved && "bg-emerald-50 text-emerald-700 border-emerald-200",
                                  item.status === "rejected" && "bg-slate-50 text-slate-600 border-slate-200",
                                )}
                              >
                                {isPending && "Ожидает проверки"}
                                {isApproved && "Утверждено в базу знаний"}
                                {item.status === "rejected" && "Отклонено"}
                              </span>
                              {canEdit && (
                                <button
                                  type="button"
                                  disabled={deleteFeedback.isPending}
                                  onClick={() => handleDeleteFeedback(item.id)}
                                  className="p-1 text-slate-400 hover:text-rose-600 rounded hover:bg-rose-50 transition-colors cursor-pointer"
                                  title="Удалить запись обратной связи"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Источник: Сделка в CRM и последнее сообщение */}
                          {(item.dealId || item.lastMessagePreview) && (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 text-xs">
                              {item.dealId ? (
                                <Link
                                  href={`/crm/deals?record=${item.dealId}`}
                                  target="_blank"
                                  className="inline-flex items-center gap-1.5 font-medium text-[#4a38f5] hover:underline"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  <span>{item.dealTitle || "Сделка в CRM"}</span>
                                  {item.contactName && (
                                    <span className="text-[#666666]">({item.contactName})</span>
                                  )}
                                </Link>
                              ) : (
                                <span className="text-[#666666]">Диалог в CRM</span>
                              )}

                              {item.lastMessagePreview && (
                                <span className="text-[11px] text-[#666666] line-clamp-1 max-w-md">
                                  <span className="font-medium text-[#111111]">Реплика:</span> {item.lastMessagePreview}
                                </span>
                              )}
                            </div>
                          )}

                          {/* Комментарий */}
                          <div className="text-xs bg-[#fafafa] p-3 rounded-[6px] border border-[#f0f0f0] space-y-1.5">
                            <div>
                              <span className="font-semibold text-slate-700">Комментарий оператора: </span>
                              <span className="text-[#111111]">{item.userComment}</span>
                            </div>

                            {/* Уточняющие вопросы/ответы */}
                            {item.clarificationQa && item.clarificationQa.length > 0 && (
                              <div className="pt-1.5 border-t border-[#f0f0f0] text-[11px] space-y-1">
                                {item.clarificationQa.map((qa, i) => (
                                  <div key={i} className="text-slate-600">
                                    <p className="italic">Вопрос: {qa.question}</p>
                                    {qa.answer && <p className="font-medium text-[#111111]">Ответ: {qa.answer}</p>}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Скомпилированное правило */}
                            {item.compiledRule && (
                              <div className="pt-1 border-t border-[#f0f0f0] text-xs">
                                <span className="font-semibold text-[#4a38f5]">Скомпилированное правило: </span>
                                <span className="font-mono text-xs text-[#111111]">{item.compiledRule}</span>
                              </div>
                            )}
                          </div>

                          {/* Кнопки управления (для pending) */}
                          {canEdit && isPending && (
                            <div className="flex items-center justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={rejectFeedback.isPending}
                                onClick={() => handleRejectFeedback(item.id)}
                                className="h-7 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-100 cursor-pointer flex items-center gap-1 transition-colors"
                              >
                                <XCircle className="h-3 w-3" />
                                <span>Отклонить</span>
                              </button>
                              <button
                                type="button"
                                disabled={approveFeedback.isPending}
                                onClick={() => handleApproveFeedback(item.id)}
                                className="h-7 rounded-[6px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] cursor-pointer flex items-center gap-1 transition-colors"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Утвердить правило</span>
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Вкладка: ОБУЧЕНИЕ НА СДЕЛКАХ (CLOSED-WON RAG) */}
      {activeSubTab === "sales" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3.5 rounded-[8px] border border-blue-200 bg-blue-50/70 p-4">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#4a38f5]" />
            <div className="space-y-1.5 text-xs">
              <p className="font-semibold text-[#111111]">
                Автоматическое обучение на закрытых сделках (Closed-Won Sales Learning)
              </p>
              <p className="text-[#555555] leading-relaxed">
                Когда любая сделка в CRM переходит на этап <strong>«Успешно реализовано» (closed_won)</strong>, система автоматически анализирует переписку менеджеров с клиентом, находит связки «вопрос клиента → победный ответ менеджера», векторизует их через ИИ и сохраняет в память агента.
              </p>
              <p className="text-[#555555] leading-relaxed">
                При последующих диалогах с новыми клиентами бот выполняет векторный поиск по этому опыту и применяет реальные победные формулировки вашей команды.
              </p>
            </div>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <div className="border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
              <h3 className="text-sm font-semibold text-[#111111]">
                Извлеченные диалоги победных сделок
              </h3>
              <p className="text-xs text-[#666666]">
                Список вопросов клиентов и ответов операторов, сохраненных как золотой эталон продаж.
              </p>
            </div>

            <div className="p-6">
              {isLoadingSales && (
                <div className="space-y-2">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-16 w-full" />
                  ))}
                </div>
              )}

              {!isLoadingSales && (!salesExamplesData || salesExamplesData.length === 0) && (
                <EmptyState
                  icon={Sparkles}
                  title="Пока нет данных обучения"
                  description="Как только менеджеры переведут сделки с историей диалогов в статус «Успешно реализовано», система автоматически извлечет эффективные ответы и отобразит их здесь."
                />
              )}

              {!isLoadingSales && salesExamplesData && salesExamplesData.length > 0 && (
                <div className="space-y-3">
                  {salesExamplesData.map((example) => (
                    <div
                      key={example.id}
                      className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2 hover:border-[#cccccc] transition-colors shadow-2xs"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-[#111111]">
                          Сделка: {example.dealTitle}
                        </span>
                        <span className="text-[#888888] font-mono text-[11px]">
                          {formatDate(example.createdAt)}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-xs bg-[#fafafa] p-3 rounded-[6px] border border-[#f0f0f0]">
                        <div>
                          <span className="font-medium text-[#666666]">Клиент: </span>
                          <span className="text-[#111111]">{example.customerQuery}</span>
                        </div>
                        <div>
                          <span className="font-medium text-[#4a38f5]">Менеджер (эталон): </span>
                          <span className="text-[#111111]">{example.agentReply}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Инспектор RAG-поиска */}
      {activeSubTab === "inspector" && (
        <div className="space-y-4">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
                <Search className="h-4 w-4 text-[#4a38f5]" />
                Инспектор RAG-поиска (Retrieval Inspector)
              </h3>
              <p className="text-xs text-[#666666] leading-relaxed">
                Введите реальный вопрос клиента, чтобы увидеть, какие именно фрагменты базы знаний и с каким коэффициентом сходства модель извлекает из PostgreSQL Vector и подмешивает в системный контекст.
              </p>
            </div>

            <form onSubmit={handleTestSearch} className="flex gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Например: Сколько стоит списание долга? / Какие гарантии? / Где вы находитесь?"
                className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 shadow-2xs"
              />
              <button
                type="submit"
                disabled={testSearch.isPending || !searchQuery.trim()}
                className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer shrink-0"
              >
                {testSearch.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                Проверить RAG-поиск
              </button>
            </form>

            {searchResults !== null && (
              <div className="space-y-3 pt-2 border-t border-[#f0f0f0]">
                <div className="flex items-center justify-between text-xs text-[#666666]">
                  <span>
                    Найдено релевантных фрагментов:{" "}
                    <strong className="text-[#111111] font-mono">{searchResults.length}</strong>
                  </span>
                  <span className="text-[11px] text-[#888888]">
                    Порог отсечения: дистанция &lt;= 0.45 (сходство &gt;= 55%)
                  </span>
                </div>

                {searchResults.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-[#e5e5e5] p-6 text-center text-xs text-[#666666]">
                    По данному запросу в базе знаний агента нет похожих фрагментов. Модель ответит без специфических фактов или запросит уточнение.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {searchResults.map((hit, idx) => {
                      const similarity = Math.max(0, Math.round((1 - hit.distance) * 100));
                      const isHigh = similarity >= 70;
                      const isMedium = similarity >= 55;

                      return (
                        <div
                          key={idx}
                          className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5]/10 text-[10px] font-bold text-[#4a38f5]">
                                #{idx + 1}
                              </span>
                              <span className="font-semibold text-[#111111]">{hit.filename}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border",
                                  isHigh
                                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                                    : isMedium
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-slate-50 text-slate-700 border-slate-200"
                                )}
                              >
                                Сходство: {similarity}% (дистанция: {hit.distance.toFixed(3)})
                              </span>
                            </div>
                          </div>

                          <div className="rounded-[6px] bg-[#fbfbfb] border border-[#f0f0f0] p-3 font-mono text-[11px] text-[#222222] whitespace-pre-wrap leading-relaxed select-text">
                            {hit.content}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Удалить документ?"
        description={
          pendingDelete === null
            ? ""
            : `«${pendingDelete.filename}» и ${pluralChunks(pendingDelete.chunksCount)} будут удалены безвозвратно. Агент перестанет опираться на этот материал.`
        }
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
        onConfirm={handleDelete}
        onClose={() => setPendingDelete(null)}
      />

      {/* Шторка просмотра и редактирования документа */}
      <EditDocumentSheet
        agentId={agentId}
        documentId={editingDocId}
        open={editingDocId !== null}
        onClose={() => setEditingDocId(null)}
        canEdit={canEdit}
      />

      {/* Модалка импорта переписки из WhatsApp */}
      <WhatsAppImportModal
        agentId={agentId}
        open={whatsappOpen}
        onClose={() => setWhatsappOpen(false)}
      />

      {/* Модалка синхронизации опыта из CRM */}
      <CrmSyncModal
        agentId={agentId}
        open={crmSyncOpen}
        onClose={() => setCrmSyncOpen(false)}
      />
    </div>
  );
}
