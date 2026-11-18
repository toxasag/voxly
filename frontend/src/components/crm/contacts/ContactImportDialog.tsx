"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import {
  X,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Check,
  Building2,
  Handshake,
  Bot,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import {
  useParseContactImport,
  useValidateContactImport,
  useCommitContactImport,
  type ContactImportParseResultDTO,
  type ContactImportValidateResultDTO,
  type ContactImportCommitResultDTO,
} from "@/lib/api/use-contacts";
import { usePipelines, useKanban as useDealsKanban } from "@/lib/api/use-deals";
import { cn } from "@/lib/utils";

interface ContactImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialCreateDeal?: boolean;
}

type ImportStep = 1 | 2 | 3 | 4;

const CONTACT_SYSTEM_FIELDS = [
  { key: "skip", label: "-- Не импортировать --" },
  { key: "phone", label: "Телефон (phone) *" },
  { key: "full_name", label: "ФИО целиком (авторазбор)" },
  { key: "first_name", label: "Имя (first_name)" },
  { key: "last_name", label: "Фамилия (last_name)" },
  { key: "middle_name", label: "Отчество (middle_name)" },
  { key: "email", label: "E-mail (email)" },
  { key: "company_name", label: "Компания (company_name)" },
  { key: "job_title", label: "Должность (job_title)" },
  { key: "telegram", label: "Telegram (username / phone)" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "city", label: "Город" },
  { key: "address", label: "Адрес" },
  { key: "notes", label: "Заметки / Комментарий" },
  { key: "channel", label: "Канал контакта" },
];

export function ContactImportDialog({
  open,
  onClose,
  onSuccess,
  initialCreateDeal = false,
}: ContactImportDialogProps) {
  const [step, setStep] = useState<ImportStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [delimiter, setDelimiter] = useState<string>("auto");
  const [skipFirstRow, setSkipFirstRow] = useState<boolean>(true);

  // Parsed result
  const [parsedData, setParsedData] = useState<ContactImportParseResultDTO | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Deal creation options
  const [createDeal, setCreateDeal] = useState<boolean>(initialCreateDeal);
  const [dealTitleMode, setDealTitleMode] = useState<"field" | "random" | "template">("field");
  const [dealTitleField, setDealTitleField] = useState<string>("company_name");
  const [dealTitleTemplate, setDealTitleTemplate] = useState<string>("Сделка: {company}");
  const [selectedPipelineId, setSelectedPipelineId] = useState<string>("");
  const [selectedStageId, setSelectedStageId] = useState<string>("");

  // Contact research option
  const [triggerResearch, setTriggerResearch] = useState<boolean>(true);

  // Validation result & duplicate resolution
  const [validationResult, setValidationResult] = useState<ContactImportValidateResultDTO | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState<"skip" | "update" | "create_anyway">("skip");

  // Commit result
  const [commitResult, setCommitResult] = useState<ContactImportCommitResultDTO | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseMutation = useParseContactImport();
  const validateMutation = useValidateContactImport();
  const commitMutation = useCommitContactImport();

  const { data: pipelines = [] } = usePipelines();
  const defaultPipeline = pipelines[0];

  useEffect(() => {
    if (defaultPipeline && !selectedPipelineId) {
      setSelectedPipelineId(defaultPipeline.id);
    }
  }, [defaultPipeline, selectedPipelineId]);

  const { data: kanbanColumns = [] } = useDealsKanban(selectedPipelineId);

  useEffect(() => {
    if (kanbanColumns.length > 0 && !selectedStageId) {
      setSelectedStageId(kanbanColumns[0].stageId);
    }
  }, [kanbanColumns, selectedStageId]);

  useEffect(() => {
    if (initialCreateDeal) {
      setCreateDeal(true);
    }
  }, [initialCreateDeal]);

  if (!open) return null;

  const handleReset = () => {
    setStep(1);
    setSelectedFile(null);
    setParsedData(null);
    setColumnMapping({});
    setValidationResult(null);
    setDuplicateStrategy("skip");
    setCommitResult(null);
    setCreateDeal(initialCreateDeal);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const handleFileSelect = (file: File) => {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xlsx", "xls", "csv", "txt"].includes(ext || "")) {
      toast.error("Поддерживаются только форматы Excel (.xlsx, .xls) и CSV (.csv)");
      return;
    }
    setSelectedFile(file);
  };

  // Step 1 -> Step 2: Parse File
  const handleParseFile = async () => {
    if (!selectedFile) {
      toast.error("Выберите файл для импорта");
      return;
    }

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      if (delimiter !== "auto") {
        formData.append("delimiter", delimiter);
      }

      const res = await parseMutation.mutateAsync(formData);
      setParsedData(res);
      setColumnMapping(res.suggestedMapping || {});
      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось прочитать файл");
    }
  };

  // Step 2 -> Step 3: Validate Mapping
  const handleValidateMapping = async () => {
    if (!parsedData || !selectedFile) return;

    // Проверяем, что замапплен хотя бы один ключевой идентификатор (телефон или e-mail)
    const hasPhone = Object.values(columnMapping).some((v) => v === "phone");
    const hasEmail = Object.values(columnMapping).some((v) => v === "email");
    const hasName = Object.values(columnMapping).some((v) => ["full_name", "first_name", "company_name"].includes(v));

    if (!hasPhone && !hasEmail && !hasName) {
      toast.error("Сопоставьте хотя бы одно из обязательных полей: Телефон, E-mail или Имя");
      return;
    }

    try {
      const isCsv = selectedFile.name.toLowerCase().endsWith(".csv");
      const reader = new FileReader();

      reader.onload = async (e) => {
        let rows: string[][] = [];
        if (isCsv) {
          const text = e.target?.result as string;
          const cleanText = text.replace(/^\uFEFF/, "");
          const delim = delimiter !== "auto" ? delimiter : parsedData.detectedDelimiter || ";";
          const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
          rows = lines.map((line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));
        } else {
          rows = [parsedData.headers, ...parsedData.sampleRows];
        }

        const res = await validateMutation.mutateAsync({
          rows,
          mapping: columnMapping,
          skipFirstRow,
        });

        setValidationResult(res);
        setStep(3);
      };

      if (isCsv) {
        reader.readAsText(selectedFile);
      } else {
        reader.readAsDataURL(selectedFile);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка проверки колонок");
    }
  };

  // Step 3 -> Step 4: Commit Import
  const handleCommitImport = async () => {
    if (!parsedData || !selectedFile) return;

    try {
      const isCsv = selectedFile.name.toLowerCase().endsWith(".csv");
      const reader = new FileReader();

      reader.onload = async (e) => {
        let rows: string[][] = [];
        if (isCsv) {
          const text = e.target?.result as string;
          const cleanText = text.replace(/^\uFEFF/, "");
          const delim = delimiter !== "auto" ? delimiter : parsedData.detectedDelimiter || ";";
          const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
          rows = lines.map((line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));
        } else {
          rows = [parsedData.headers, ...parsedData.sampleRows];
        }

        const res = await commitMutation.mutateAsync({
          rows,
          mapping: columnMapping,
          skipFirstRow,
          duplicateStrategy,
          createDeal,
          dealOptions: createDeal
            ? {
                titleMode: dealTitleMode,
                titleField: dealTitleField,
                titleTemplate: dealTitleTemplate,
                pipelineId: selectedPipelineId || undefined,
                stageId: selectedStageId || undefined,
              }
            : undefined,
          triggerResearch,
        });

        setCommitResult(res);
        setStep(4);
        toast.success(`Импорт завершен: создано ${res.imported}, обновлено ${res.updated}`);
        onSuccess?.();
      };

      if (isCsv) {
        reader.readAsText(selectedFile);
      } else {
        reader.readAsDataURL(selectedFile);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось выполнить импорт");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs">
      <div className="flex flex-col w-full max-w-3xl max-h-[90vh] rounded-2xl border border-[#e5e5e5] bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e5e5e5] bg-white">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200">
              <FileSpreadsheet className="h-5 w-5 text-[#4a38f5]" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-[#111111]">Импорт контактов</h2>
              <p className="text-xs text-[#666666]">
                Загрузка базы из Excel (.xlsx) или CSV с генерацией сделок, дедупликацией и ресёрчем
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Steps Breadcrumbs Twenty CRM Standard */}
        <div className="flex items-center border-b border-[#e5e5e5] bg-[#fbfbfb] px-6 py-2.5 text-xs">
          <div className="flex items-center gap-6">
            <div
              className={cn(
                "flex items-center gap-1.5 font-medium",
                step === 1 ? "text-[#4a38f5]" : step > 1 ? "text-[#111111]" : "text-[#888888]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  step === 1
                    ? "bg-[#4a38f5] text-white"
                    : step > 1
                    ? "bg-emerald-600 text-white"
                    : "bg-[#e5e5e5] text-[#666666]",
                )}
              >
                {step > 1 ? <Check className="h-3 w-3" /> : "1"}
              </span>
              <span>Файл</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div
              className={cn(
                "flex items-center gap-1.5 font-medium",
                step === 2 ? "text-[#4a38f5]" : step > 2 ? "text-[#111111]" : "text-[#888888]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  step === 2
                    ? "bg-[#4a38f5] text-white"
                    : step > 2
                    ? "bg-emerald-600 text-white"
                    : "bg-[#e5e5e5] text-[#666666]",
                )}
              >
                {step > 2 ? <Check className="h-3 w-3" /> : "2"}
              </span>
              <span>Колонки и сделки</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div
              className={cn(
                "flex items-center gap-1.5 font-medium",
                step === 3 ? "text-[#4a38f5]" : step > 3 ? "text-[#111111]" : "text-[#888888]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  step === 3
                    ? "bg-[#4a38f5] text-white"
                    : step > 3
                    ? "bg-emerald-600 text-white"
                    : "bg-[#e5e5e5] text-[#666666]",
                )}
              >
                {step > 3 ? <Check className="h-3 w-3" /> : "3"}
              </span>
              <span>Дубликаты</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div
              className={cn(
                "flex items-center gap-1.5 font-medium",
                step === 4 ? "text-[#4a38f5]" : "text-[#888888]",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px]",
                  step === 4 ? "bg-[#4a38f5] text-white" : "bg-[#e5e5e5] text-[#666666]",
                )}
              >
                4
              </span>
              <span>Итог</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* STEP 1: Upload */}
          {step === 1 && (
            <div className="space-y-5">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleFileSelect(e.dataTransfer.files[0]);
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer",
                  isDragging
                    ? "border-[#4a38f5] bg-[#4a38f5]/5"
                    : selectedFile
                    ? "border-emerald-300 bg-emerald-50/30"
                    : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#cccccc] hover:bg-white",
                )}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                  accept=".xlsx,.xls,.csv,.txt"
                  className="hidden"
                />

                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-2xs border border-[#e5e5e5] mb-3">
                  <Upload className="h-5 w-5 text-[#4a38f5]" />
                </div>

                {selectedFile ? (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[#111111]">{selectedFile.name}</p>
                    <p className="text-xs text-[#666666]">
                      {(selectedFile.size / 1024).toFixed(1)} КБ — нажмите для замены файла
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-[#111111]">
                      Перетащите файл сюда или нажмите для выбора
                    </p>
                    <p className="text-xs text-[#888888]">
                      Поддерживаются таблицы Microsoft Excel (.xlsx, .xls) и CSV (.csv) до 20 МБ
                    </p>
                  </div>
                )}
              </div>

              {/* Options */}
              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-[#111111]">Разделитель колонок (для CSV)</p>
                    <p className="text-[11px] text-[#666666]">Определяется автоматически или задается вручную</p>
                  </div>
                  <select
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value)}
                    className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] outline-none focus:border-[#4a38f5]"
                  >
                    <option value="auto">Автоопределение</option>
                    <option value=";">Точка с запятой (;)</option>
                    <option value=",">Запятая (,)</option>
                    <option value="	">Табуляция (\t)</option>
                  </select>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[#e5e5e5]">
                  <div>
                    <p className="text-xs font-semibold text-[#111111]">Заголовки в первой строке</p>
                    <p className="text-[11px] text-[#666666]">
                      Пропускать первую строку таблицы при чтении данных
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skipFirstRow}
                      onChange={(e) => setSkipFirstRow(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#e5e5e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4a38f5]"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Mapping & Deal Options */}
          {step === 2 && parsedData && (
            <div className="space-y-6">
              {/* Column Mapping Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                    Сопоставление колонок ({parsedData.headers.length} найдено в файле)
                  </h3>
                  <span className="text-xs text-[#666666]">Всего строк: {parsedData.totalRows}</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-[#e5e5e5] bg-white shadow-2xs">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-[#e5e5e5] bg-[#fafafa] text-[#666666]">
                      <tr>
                        <th className="px-3.5 py-2 font-medium">Колонка в файле</th>
                        <th className="px-3.5 py-2 font-medium">Пример значения (первая строка)</th>
                        <th className="px-3.5 py-2 font-medium">Поле контакта CRM</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#f0f0f0]">
                      {parsedData.headers.map((header, idx) => {
                        const sampleVal = parsedData.sampleRows[0]?.[idx] || "—";
                        const currentMapped = columnMapping[String(idx)] || "skip";
                        return (
                          <tr key={idx} className="hover:bg-[#fafafa]">
                            <td className="px-3.5 py-2 font-medium text-[#111111]">{header || `Колонка ${idx + 1}`}</td>
                            <td className="px-3.5 py-2 text-[#666666] truncate max-w-[200px]" title={sampleVal}>
                              {sampleVal}
                            </td>
                            <td className="px-3.5 py-1.5">
                              <select
                                value={currentMapped}
                                onChange={(e) =>
                                  setColumnMapping((prev) => ({
                                    ...prev,
                                    [String(idx)]: e.target.value,
                                  }))
                                }
                                className={cn(
                                  "h-7 w-full rounded-[6px] border px-2 text-xs outline-none focus:border-[#4a38f5]",
                                  currentMapped === "skip"
                                    ? "border-[#e5e5e5] text-[#888888] bg-[#fafafa]"
                                    : "border-[#4a38f5]/40 text-[#111111] bg-white font-medium",
                                )}
                              >
                                {CONTACT_SYSTEM_FIELDS.map((f) => (
                                  <option key={f.key} value={f.key}>
                                    {f.label}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Deal Options Card */}
              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Handshake className="h-4 w-4 text-[#4a38f5]" />
                    <div>
                      <p className="text-xs font-semibold text-[#111111]">Создавать сделку к контакту</p>
                      <p className="text-[11px] text-[#666666]">
                        Автоматически создавать новую сделку на указанном этапе воронки
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={createDeal}
                      onChange={(e) => setCreateDeal(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#e5e5e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4a38f5]"></div>
                  </label>
                </div>

                {createDeal && (
                  <div className="space-y-3 pt-3 border-t border-[#e5e5e5] animate-in fade-in duration-100">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-medium text-[#666666] mb-1 block">Воронка</label>
                        <select
                          value={selectedPipelineId}
                          onChange={(e) => {
                            setSelectedPipelineId(e.target.value);
                            setSelectedStageId("");
                          }}
                          className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] outline-none focus:border-[#4a38f5]"
                        >
                          {pipelines.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-medium text-[#666666] mb-1 block">Этап воронки</label>
                        <select
                          value={selectedStageId}
                          onChange={(e) => setSelectedStageId(e.target.value)}
                          className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] outline-none focus:border-[#4a38f5]"
                        >
                          {kanbanColumns.map((col) => (
                            <option key={col.stageId} value={col.stageId}>
                              {col.stageName}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-[#666666] mb-1 block">Название сделки</label>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <button
                          type="button"
                          onClick={() => setDealTitleMode("field")}
                          className={cn(
                            "rounded-[8px] border p-2 text-left text-xs transition-colors",
                            dealTitleMode === "field"
                              ? "border-[#4a38f5] bg-indigo-50/50 text-[#111111] font-medium"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                          )}
                        >
                          Из поля контакта
                        </button>
                        <button
                          type="button"
                          onClick={() => setDealTitleMode("random")}
                          className={cn(
                            "rounded-[8px] border p-2 text-left text-xs transition-colors",
                            dealTitleMode === "random"
                              ? "border-[#4a38f5] bg-indigo-50/50 text-[#111111] font-medium"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                          )}
                        >
                          Случайный номер (#XXXX)
                        </button>
                        <button
                          type="button"
                          onClick={() => setDealTitleMode("template")}
                          className={cn(
                            "rounded-[8px] border p-2 text-left text-xs transition-colors",
                            dealTitleMode === "template"
                              ? "border-[#4a38f5] bg-indigo-50/50 text-[#111111] font-medium"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                          )}
                        >
                          По шаблону
                        </button>
                      </div>

                      {dealTitleMode === "field" && (
                        <select
                          value={dealTitleField}
                          onChange={(e) => setDealTitleField(e.target.value)}
                          className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] outline-none focus:border-[#4a38f5]"
                        >
                          <option value="company_name">Компания контакта</option>
                          <option value="full_name">ФИО контакта</option>
                          <option value="phone">Телефон контакта</option>
                        </select>
                      )}

                      {dealTitleMode === "template" && (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={dealTitleTemplate}
                            onChange={(e) => setDealTitleTemplate(e.target.value)}
                            placeholder="Сделка: {company} - {name}"
                            className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] outline-none focus:border-[#4a38f5]"
                          />
                          <p className="text-[10px] text-[#888888]">
                            Доступные переменные: &#123;company&#125;, &#123;name&#125;, &#123;phone&#125;, &#123;email&#125;
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Contact Research Card */}
              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Bot className="h-4 w-4 text-[#4a38f5]" />
                  <div>
                    <p className="text-xs font-semibold text-[#111111]">
                      Запустить ресёрч контактов (Telegram, WhatsApp, MAX)
                    </p>
                    <p className="text-[11px] text-[#666666]">
                      Фоновый поиск юзернеймов, мессенджеров и проверка активности для каждого контакта
                    </p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={triggerResearch}
                    onChange={(e) => setTriggerResearch(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-9 h-5 bg-[#e5e5e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#4a38f5]"></div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 3: Duplicate Resolution */}
          {step === 3 && validationResult && (
            <div className="space-y-5">
              {/* Summary Stats Banner */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <p className="text-[11px] text-[#666666]">Всего строк к импорту</p>
                  <p className="text-lg font-bold text-[#111111]">{validationResult.totalRows}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3.5 shadow-2xs">
                  <p className="text-[11px] text-emerald-800">Уникальных контактов</p>
                  <p className="text-lg font-bold text-emerald-700">
                    {validationResult.totalRows - validationResult.duplicatesCount}
                  </p>
                </div>
                <div
                  className={cn(
                    "rounded-xl border p-3.5 shadow-2xs",
                    validationResult.duplicatesCount > 0
                      ? "border-amber-200 bg-amber-50/50"
                      : "border-[#e5e5e5] bg-white",
                  )}
                >
                  <p className="text-[11px] text-amber-800">Найдено дубликатов</p>
                  <p
                    className={cn(
                      "text-lg font-bold",
                      validationResult.duplicatesCount > 0 ? "text-amber-700" : "text-[#111111]",
                    )}
                  >
                    {validationResult.duplicatesCount}
                  </p>
                </div>
              </div>

              {/* Strategy Selector */}
              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <p className="text-xs font-semibold text-[#111111]">
                  Как поступить с найденными дубликатами по телефону или e-mail?
                </p>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-xs text-[#111111] cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={duplicateStrategy === "skip"}
                      onChange={() => setDuplicateStrategy("skip")}
                      className="text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>
                      <strong>Пропускать дубликаты</strong> (сохранять существующий контакт без изменений)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[#111111] cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={duplicateStrategy === "update"}
                      onChange={() => setDuplicateStrategy("update")}
                      className="text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>
                      <strong>Обновлять существующие контакты</strong> (дополнять новыми полями из файла)
                    </span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[#111111] cursor-pointer">
                    <input
                      type="radio"
                      name="strategy"
                      checked={duplicateStrategy === "create_anyway"}
                      onChange={() => setDuplicateStrategy("create_anyway")}
                      className="text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>
                      <strong>Создавать новый контакт в любом случае</strong> (разрешить несколько записей)
                    </span>
                  </label>
                </div>
              </div>

              {/* Duplicate List Preview */}
              {validationResult.duplicates.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-[#111111]">
                    Список найденных совпадений ({validationResult.duplicates.length}):
                  </h4>
                  <div className="max-h-48 overflow-y-auto rounded-xl border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] text-xs">
                    {validationResult.duplicates.slice(0, 50).map((dup, idx) => (
                      <div key={idx} className="flex items-center justify-between p-2.5 hover:bg-[#fafafa]">
                        <div>
                          <span className="font-medium text-[#111111]">Строка #{dup.rowIndex}: </span>
                          <span className="text-[#666666]">совпадение с «{dup.existingName}»</span>
                        </div>
                        <span className="rounded bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                          {dup.field === "phone" ? "Телефон" : "E-mail"}: {dup.value}
                        </span>
                      </div>
                    ))}
                    {validationResult.duplicates.length > 50 && (
                      <div className="p-2 text-center text-[11px] text-[#888888]">
                        И ещё {validationResult.duplicates.length - 50} совпадений...
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Success / Done */}
          {step === 4 && commitResult && (
            <div className="space-y-6 py-4 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200 mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>

              <div className="space-y-1">
                <h3 className="text-base font-bold text-[#111111]">Импорт успешно завершен!</h3>
                <p className="text-xs text-[#666666]">
                  База контактов обновлена в реальном времени. Все задачи и сделки распределены.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-left">
                <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <p className="text-[11px] text-[#666666]">Новых контактов</p>
                  <p className="text-lg font-bold text-emerald-600">+{commitResult.imported}</p>
                </div>
                <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <p className="text-[11px] text-[#666666]">Обновлено контактов</p>
                  <p className="text-lg font-bold text-[#4a38f5]">{commitResult.updated}</p>
                </div>
                <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <p className="text-[11px] text-[#666666]">Создано сделок</p>
                  <p className="text-lg font-bold text-amber-600">+{commitResult.dealsCreated}</p>
                </div>
                <div className="rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
                  <p className="text-[11px] text-[#666666]">Запущено ресёрчей</p>
                  <p className="text-lg font-bold text-indigo-600">{commitResult.researchTriggered}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between border-t border-[#e5e5e5] bg-[#fbfbfb] px-6 py-3.5">
          {step > 1 && step < 4 ? (
            <button
              type="button"
              onClick={() => setStep((s) => (s - 1) as ImportStep)}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Назад
            </button>
          ) : (
            <div></div>
          )}

          <div className="flex items-center gap-2">
            {step < 4 && (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
              >
                Отмена
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                disabled={!selectedFile || parseMutation.isPending}
                onClick={handleParseFile}
                className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {parseMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Далее: Сопоставление <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                disabled={validateMutation.isPending}
                onClick={handleValidateMapping}
                className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {validateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Далее: Проверка дубликатов <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                disabled={commitMutation.isPending}
                onClick={handleCommitImport}
                className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {commitMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Выполнить импорт
              </button>
            )}

            {step === 4 && (
              <button
                type="button"
                onClick={handleClose}
                className="rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors cursor-pointer shadow-xs"
              >
                Готово
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}