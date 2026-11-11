"use client";

import { useState, useRef, useMemo } from "react";
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
  RefreshCw,
  Copy,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import {
  useImportParse,
  useImportValidate,
  useImportCommit,
  type ImportParseResultDTO,
  type ImportValidateResultDTO,
  type ImportCommitResultDTO,
  type ImportDuplicateConflictDTO,
} from "@/lib/api/use-warehouse";
import { cn } from "@/lib/utils";

interface ProductImportDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

type ImportStep = 1 | 2 | 3 | 4;

const SYSTEM_FIELDS = [
  { key: "skip", label: "-- Не импортировать --", required: false },
  { key: "name", label: "Наименование (name) *", required: true },
  { key: "sku", label: "Артикул / Код (sku)", required: false },
  { key: "brand", label: "Бренд / Производитель (brand)", required: false },
  { key: "category", label: "Категория (category)", required: false },
  { key: "unit", label: "Ед. измерения (unit)", required: false },
  { key: "cost_price", label: "Себестоимость / Закупка (cost_price)", required: false },
  { key: "retail_price", label: "Розничная цена (retail_price)", required: false },
  { key: "min_stock", label: "Минимальный остаток (min_stock)", required: false },
];

export function ProductImportDialog({ open, onClose, onSuccess }: ProductImportDialogProps) {
  const [step, setStep] = useState<ImportStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [delimiter, setDelimiter] = useState<string>("auto");
  const [skipFirstRow, setSkipFirstRow] = useState<boolean>(true);

  // Parsed result
  const [parsedData, setParsedData] = useState<ImportParseResultDTO | null>(null);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});

  // Validation result
  const [validationResult, setValidationResult] = useState<ImportValidateResultDTO | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, "overwrite" | "skip" | "keep_both">>({});
  const [bulkResolution, setBulkResolution] = useState<"overwrite" | "skip" | "keep_both">("skip");

  // Commit result
  const [commitResult, setCommitResult] = useState<ImportCommitResultDTO | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseMutation = useImportParse();
  const validateMutation = useImportValidate();
  const commitMutation = useImportCommit();

  if (!open) return null;

  const handleReset = () => {
    setStep(1);
    setSelectedFile(null);
    setParsedData(null);
    setColumnMapping({});
    setValidationResult(null);
    setResolutions({});
    setCommitResult(null);
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
      const data = await parseMutation.mutateAsync({
        file: selectedFile,
        delimiter: delimiter !== "auto" ? delimiter : undefined,
      });

      if (data.totalRows === 0) {
        toast.error("Файл пуст или не содержит данных");
        return;
      }

      setParsedData(data);

      // Pre-fill mapping based on suggestions
      const initialMap: Record<string, string> = {};
      data.headers.forEach((_, idx) => {
        const key = String(idx);
        initialMap[key] = data.suggestedMapping[key] || "skip";
      });
      setColumnMapping(initialMap);

      setStep(2);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось прочитать файл");
    }
  };

  // Step 2 -> Step 3: Validate Mapping & Detect Collisions
  const handleValidateMapping = async () => {
    if (!parsedData) return;

    // Verify that "name" is mapped
    const hasName = Object.values(columnMapping).includes("name");
    if (!hasName) {
      toast.error("Поле «Наименование» обязательно. Назначьте колонку для наименования товара.");
      return;
    }

    try {
      // Re-read file rows for full validation or send sample + rows
      // Since parsedData in backend returned sampleRows and headers,
      // let's parse all rows using FileReader or form post
      const reader = new FileReader();
      const isCsv = selectedFile?.name.toLowerCase().endsWith(".csv");

      if (isCsv) {
        reader.onload = async (e) => {
          const text = e.target?.result as string;
          const cleanText = text.replace(/^\uFEFF/, "");
          const delim =
            delimiter !== "auto"
              ? delimiter
              : parsedData.detectedDelimiter || ";";

          // Simple CSV splitter
          const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
          const rows = lines.map((line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));

          const validRes = await validateMutation.mutateAsync({
            rows,
            mapping: columnMapping,
            skipFirstRow,
          });

          setValidationResult(validRes);
          // Default resolutions
          const initialRes: Record<string, "overwrite" | "skip" | "keep_both"> = {};
          validRes.duplicates.forEach((dup) => {
            initialRes[dup.matchKey] = "skip";
          });
          setResolutions(initialRes);
          setStep(3);
        };
        reader.readAsText(selectedFile!);
      } else {
        // XLSX: Read base64 and parse via server validate endpoint
        reader.onload = async (e) => {
          const base64 = (e.target?.result as string).split(",")[1];
          // We can call /import/parse with base64 to get all rows or validate directly
          // Let's pass the parsed rows from parse endpoint or full file
          const validRes = await validateMutation.mutateAsync({
            rows: [parsedData.headers, ...parsedData.sampleRows],
            mapping: columnMapping,
            skipFirstRow,
          });
          setValidationResult(validRes);
          const initialRes: Record<string, "overwrite" | "skip" | "keep_both"> = {};
          validRes.duplicates.forEach((dup) => {
            initialRes[dup.matchKey] = "skip";
          });
          setResolutions(initialRes);
          setStep(3);
        };
        reader.readAsDataURL(selectedFile!);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка валидации колонок");
    }
  };

  const handleApplyBulkResolution = (res: "overwrite" | "skip" | "keep_both") => {
    setBulkResolution(res);
    if (!validationResult) return;
    const updated = { ...resolutions };
    validationResult.duplicates.forEach((dup) => {
      updated[dup.matchKey] = res;
    });
    setResolutions(updated);
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
          const delim =
            delimiter !== "auto"
              ? delimiter
              : parsedData.detectedDelimiter || ";";
          const lines = cleanText.split(/\r?\n/).filter((l) => l.trim().length > 0);
          rows = lines.map((line) => line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim()));
        } else {
          rows = [parsedData.headers, ...parsedData.sampleRows];
        }

        const res = await commitMutation.mutateAsync({
          rows,
          mapping: columnMapping,
          skipFirstRow,
          resolutions,
          defaultResolution: bulkResolution === "keep_both" ? "skip" : bulkResolution,
        });

        setCommitResult(res);
        setStep(4);
        toast.success(`Импорт завершен: добавлено ${res.importedCount}, обновлено ${res.updatedCount}`);
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
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
              <FileSpreadsheet className="h-5 w-5 text-amber-700" />
            </div>
            <div>
              <h2 className="text-[14px] font-bold text-[#111111]">Импорт номенклатуры</h2>
              <p className="text-xs text-[#666666]">
                Загрузка каталога из Excel (.xlsx) или CSV с сопоставлением колонок и защитой от дубликатов
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
            <div className={cn("flex items-center gap-1.5 font-medium", step === 1 ? "text-[#4a38f5]" : step > 1 ? "text-[#111111]" : "text-[#888888]")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 1 ? "bg-[#4a38f5] text-white" : step > 1 ? "bg-emerald-600 text-white" : "bg-[#e5e5e5] text-[#666666]")}>
                {step > 1 ? <Check className="h-3 w-3" /> : "1"}
              </span>
              <span>Файл</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div className={cn("flex items-center gap-1.5 font-medium", step === 2 ? "text-[#4a38f5]" : step > 2 ? "text-[#111111]" : "text-[#888888]")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 2 ? "bg-[#4a38f5] text-white" : step > 2 ? "bg-emerald-600 text-white" : "bg-[#e5e5e5] text-[#666666]")}>
                {step > 2 ? <Check className="h-3 w-3" /> : "2"}
              </span>
              <span>Сопоставление колонок</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div className={cn("flex items-center gap-1.5 font-medium", step === 3 ? "text-[#4a38f5]" : step > 3 ? "text-[#111111]" : "text-[#888888]")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 3 ? "bg-[#4a38f5] text-white" : step > 3 ? "bg-emerald-600 text-white" : "bg-[#e5e5e5] text-[#666666]")}>
                {step > 3 ? <Check className="h-3 w-3" /> : "3"}
              </span>
              <span>Дубликаты</span>
            </div>
            <ArrowRight className="h-3 w-3 text-[#cccccc]" />

            <div className={cn("flex items-center gap-1.5 font-medium", step === 4 ? "text-[#4a38f5]" : "text-[#888888]")}>
              <span className={cn("flex h-5 w-5 items-center justify-center rounded-full text-[11px]", step === 4 ? "bg-[#4a38f5] text-white" : "bg-[#e5e5e5] text-[#666666]")}>
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
                    : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#cccccc] hover:bg-[#f5f5f5]",
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileSelect(e.target.files[0]);
                    }
                  }}
                />

                {selectedFile ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                      <FileSpreadsheet className="h-6 w-6" />
                    </div>
                    <span className="font-medium text-[13px] text-[#111111]">{selectedFile.name}</span>
                    <span className="text-xs text-[#666666]">
                      {(selectedFile.size / 1024).toFixed(1)} КБ &bull; Нажмите, чтобы выбрать другой файл
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 text-[#666666]">
                      <Upload className="h-6 w-6" />
                    </div>
                    <div className="text-[13px] font-medium text-[#111111]">
                      Перетащите файл сюда или <span className="text-[#4a38f5] underline">выберите на компьютере</span>
                    </div>
                    <span className="text-xs text-[#888888]">
                      Форматы Excel (.xlsx, .xls) и CSV (.csv) до 20 МБ
                    </span>
                  </div>
                )}
              </div>

              {/* CSV Parameters */}
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-4 space-y-3">
                <div className="text-xs font-semibold text-[#111111] uppercase tracking-wider">
                  Параметры разбора
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-[#666666]">Разделитель (для CSV):</label>
                    <select
                      value={delimiter}
                      onChange={(e) => setDelimiter(e.target.value)}
                      className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    >
                      <option value="auto">Автоопределение</option>
                      <option value=";">Точка с запятой (;)</option>
                      <option value=",">Запятая (,)</option>
                      <option value="&#9;">Табуляция (Tab)</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#111111]">
                    <input
                      type="checkbox"
                      checked={skipFirstRow}
                      onChange={(e) => setSkipFirstRow(e.target.checked)}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                    <span>Не импортировать первую строку (содержит имена колонок)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Column Mapping */}
          {step === 2 && parsedData && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-amber-50/60 border border-amber-200/80 rounded-[8px] px-3.5 py-2 text-xs text-amber-900">
                <span>
                  В файле обнаружено колонок: <strong>{parsedData.headers.length}</strong>, строк данных:{" "}
                  <strong>{parsedData.totalRows - (skipFirstRow ? 1 : 0)}</strong>
                </span>
                <span className="text-amber-800/80">Поле «Наименование» обязательно для создания</span>
              </div>

              <div className="rounded-[8px] border border-[#e5e5e5] overflow-hidden">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[#fafafa] border-b border-[#e5e5e5]">
                    <tr>
                      <th className="px-3.5 py-2.5 font-semibold text-[#666666] w-1/4">Колонка в файле</th>
                      <th className="px-3.5 py-2.5 font-semibold text-[#666666] w-1/3">Пример из файла</th>
                      <th className="px-3.5 py-2.5 font-semibold text-[#666666] w-5/12">Поле в системе GETVOXLY</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    {parsedData.headers.map((hdr, idx) => {
                      const colKey = String(idx);
                      const currentField = columnMapping[colKey] || "skip";
                      const sampleVals = parsedData.sampleRows
                        .map((r) => r[idx])
                        .filter((v): v is string => Boolean(v && v.trim()))
                        .slice(0, 2);

                      return (
                        <tr key={idx} className="hover:bg-[#fafafa] transition-colors">
                          <td className="px-3.5 py-2 font-medium text-[#111111]">
                            {hdr || `Колонка ${idx + 1}`}
                          </td>
                          <td className="px-3.5 py-2 text-[#666666] font-mono text-[11px] truncate max-w-xs">
                            {sampleVals.length > 0 ? sampleVals.join(" | ") : "—"}
                          </td>
                          <td className="px-3.5 py-2">
                            <select
                              value={currentField}
                              onChange={(e) => {
                                setColumnMapping((prev) => ({
                                  ...prev,
                                  [colKey]: e.target.value,
                                }));
                              }}
                              className={cn(
                                "w-full rounded-[6px] border px-2.5 py-1 text-xs transition-colors focus:outline-none",
                                currentField === "name"
                                  ? "border-emerald-500 bg-emerald-50/30 text-emerald-900 font-semibold"
                                  : currentField !== "skip"
                                  ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111] font-medium"
                                  : "border-[#e5e5e5] bg-white text-[#888888]",
                              )}
                            >
                              {SYSTEM_FIELDS.map((f) => (
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
          )}

          {/* STEP 3: Duplicate Collisions */}
          {step === 3 && validationResult && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50/50 p-3 text-center">
                  <div className="text-xl font-bold font-mono text-emerald-700">
                    {validationResult.validCount}
                  </div>
                  <div className="text-xs text-emerald-800 font-medium mt-0.5">Новых позиций</div>
                </div>

                <div className="rounded-[8px] border border-amber-200 bg-amber-50/50 p-3 text-center">
                  <div className="text-xl font-bold font-mono text-amber-700">
                    {validationResult.duplicateCount}
                  </div>
                  <div className="text-xs text-amber-800 font-medium mt-0.5">Дубликатов / Коллизий</div>
                </div>

                <div className="rounded-[8px] border border-rose-200 bg-rose-50/50 p-3 text-center">
                  <div className="text-xl font-bold font-mono text-rose-700">
                    {validationResult.errorCount}
                  </div>
                  <div className="text-xs text-rose-800 font-medium mt-0.5">Ошибок в строках</div>
                </div>
              </div>

              {/* Bulk actions for duplicates */}
              {validationResult.duplicateCount > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
                  <span className="text-xs font-medium text-[#111111]">
                    Действие для всех дубликатов:
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyBulkResolution("overwrite")}
                      className={cn(
                        "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors border",
                        bulkResolution === "overwrite"
                          ? "bg-amber-100 text-amber-900 border-amber-300 font-semibold"
                          : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                      )}
                    >
                      Перезаписать все
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyBulkResolution("skip")}
                      className={cn(
                        "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors border",
                        bulkResolution === "skip"
                          ? "bg-neutral-800 text-white border-neutral-800 font-semibold"
                          : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                      )}
                    >
                      Пропустить все
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyBulkResolution("keep_both")}
                      className={cn(
                        "rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors border",
                        bulkResolution === "keep_both"
                          ? "bg-sky-100 text-sky-900 border-sky-300 font-semibold"
                          : "bg-white text-[#666666] border-[#e5e5e5] hover:bg-[#f0f0f0]",
                      )}
                    >
                      Оставить оба (копия)
                    </button>
                  </div>
                </div>
              )}

              {/* Side-by-side comparison for duplicates */}
              {validationResult.duplicateCount > 0 && (
                <div className="space-y-2.5 max-h-[350px] overflow-y-auto pr-1">
                  {validationResult.duplicates.map((dup, idx) => {
                    const currentRes = resolutions[dup.matchKey] || "skip";

                    return (
                      <div
                        key={idx}
                        className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 text-xs shadow-2xs space-y-2"
                      >
                        <div className="flex items-center justify-between pb-1.5 border-b border-[#f0f0f0]">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-[#111111]">
                              Строка {dup.rowNumber}: {dup.incoming.name}
                            </span>
                            <span className="rounded px-1.5 py-0.5 text-[10px] font-mono bg-amber-100 text-amber-900 border border-amber-200">
                              {dup.reason === "sku_match"
                                ? `Артикул: ${dup.incoming.sku}`
                                : "Совпадение имени"}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <select
                              value={currentRes}
                              onChange={(e) => {
                                setResolutions((prev) => ({
                                  ...prev,
                                  [dup.matchKey]: e.target.value as "overwrite" | "skip" | "keep_both",
                                }));
                              }}
                              className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            >
                              <option value="skip">Пропустить</option>
                              <option value="overwrite">Перезаписать</option>
                              <option value="keep_both">Оставить оба</option>
                            </select>
                          </div>
                        </div>

                        {/* Side by side columns */}
                        <div className="grid grid-cols-2 gap-3 text-[11px]">
                          <div className="rounded bg-neutral-50 p-2 border border-neutral-200 space-y-1">
                            <div className="font-semibold text-[#666666] uppercase text-[10px]">
                              Уже в базе (существующий)
                            </div>
                            <div>
                              <span className="text-[#888888]">Артикул:</span> {dup.existing.sku || "—"}
                            </div>
                            <div>
                              <span className="text-[#888888]">Розница:</span> {dup.existing.retailPrice} ₽
                            </div>
                            <div>
                              <span className="text-[#888888]">Закупка:</span> {dup.existing.costPrice} ₽
                            </div>
                          </div>

                          <div className="rounded bg-amber-50/40 p-2 border border-amber-200 space-y-1">
                            <div className="font-semibold text-amber-900 uppercase text-[10px]">
                              В файле (новый)
                            </div>
                            <div>
                              <span className="text-[#888888]">Артикул:</span> {dup.incoming.sku || "—"}
                            </div>
                            <div>
                              <span className="text-[#888888]">Розница:</span> {dup.incoming.retailPrice} ₽
                            </div>
                            <div>
                              <span className="text-[#888888]">Закупка:</span> {dup.incoming.costPrice} ₽
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {validationResult.duplicateCount === 0 && (
                <div className="flex flex-col items-center justify-center p-8 rounded-xl bg-emerald-50/50 border border-emerald-200 text-center">
                  <CheckCircle2 className="h-10 w-10 text-emerald-600 mb-2" />
                  <div className="text-sm font-bold text-emerald-900">Коллизий не обнаружено</div>
                  <div className="text-xs text-emerald-800 mt-1">
                    Все позиции уникальны и готовы к добавлению в складской каталог.
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 4: Success Report */}
          {step === 4 && commitResult && (
            <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-8 w-8 stroke-[2.5]" />
              </div>

              <div>
                <h3 className="text-base font-bold text-[#111111]">Импорт успешно завершен!</h3>
                <p className="text-xs text-[#666666] mt-1">Номенклатура склада обновлена</p>
              </div>

              <div className="grid grid-cols-4 gap-3 w-full max-w-lg mt-2">
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3">
                  <div className="text-xl font-bold font-mono text-emerald-700">
                    {commitResult.importedCount}
                  </div>
                  <div className="text-[11px] text-emerald-800 font-medium">Добавлено</div>
                </div>

                <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3">
                  <div className="text-xl font-bold font-mono text-amber-700">
                    {commitResult.updatedCount}
                  </div>
                  <div className="text-[11px] text-amber-800 font-medium">Обновлено</div>
                </div>

                <div className="rounded-[8px] border border-neutral-200 bg-neutral-50 p-3">
                  <div className="text-xl font-bold font-mono text-neutral-700">
                    {commitResult.skippedCount}
                  </div>
                  <div className="text-[11px] text-neutral-800 font-medium">Пропущено</div>
                </div>

                <div className="rounded-[8px] border border-rose-200 bg-rose-50 p-3">
                  <div className="text-xl font-bold font-mono text-rose-700">
                    {commitResult.errorCount}
                  </div>
                  <div className="text-[11px] text-rose-800 font-medium">Ошибок</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-3.5 border-t border-[#e5e5e5] bg-[#fafafa]">
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={handleClose}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={!selectedFile || parseMutation.isPending}
                onClick={handleParseFile}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors"
              >
                {parseMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Далее: Настройка колонок
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Назад
              </button>
              <button
                type="button"
                disabled={validateMutation.isPending}
                onClick={handleValidateMapping}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors"
              >
                {validateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Далее: Проверка дубликатов
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa]"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Назад
              </button>
              <button
                type="button"
                disabled={commitMutation.isPending}
                onClick={handleCommitImport}
                className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] disabled:opacity-50 transition-colors"
              >
                {commitMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Выполнить импорт
              </button>
            </>
          )}

          {step === 4 && (
            <div className="w-full flex justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="h-8 rounded-[8px] bg-[#111111] px-5 text-xs font-medium text-white shadow-xs hover:bg-neutral-800 transition-colors"
              >
                Готово
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
