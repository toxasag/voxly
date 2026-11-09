"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { AlertTriangle, Braces, Eye, EyeOff, Hash } from "lucide-react";
import {
  PROMPT_VARIABLES,
  estimateTokens,
  extractPromptVariables,
  findUnknownVariables,
  renderPromptPreview,
} from "@/lib/ai-bots/ai-bots.types";
import { cn } from "@/lib/utils";

interface PromptTemplateEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** Context window of the selected model, used for the token budget bar. */
  contextWindow: number;
  error?: string;
  rows?: number;
  label?: string;
  bot?: Parameters<typeof renderPromptPreview>[1];
  tenantName?: string;
}

const MAX_LENGTH = 50000;

export function PromptTemplateEditor({
  value,
  onChange,
  contextWindow,
  error,
  rows = 8,
  label = "Системный промпт",
  bot,
  tenantName,
}: PromptTemplateEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  const tokens = useMemo(() => estimateTokens(value), [value]);
  const usedVariables = useMemo(() => extractPromptVariables(value), [value]);
  const unknownVariables = useMemo(() => findUnknownVariables(value), [value]);
  const preview = useMemo(() => renderPromptPreview(value, bot, tenantName), [value, bot, tenantName]);

  const budgetPercent = Math.min(100, Math.round((tokens / contextWindow) * 100));

  /** Inserts `{{token}}` at the caret, keeping focus and selection sane. */
  const insertVariable = useCallback(
    (token: string) => {
      const snippet = `{{${token}}}`;
      const textarea = textareaRef.current;

      if (!textarea) {
        onChange(value + snippet);
        return;
      }

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const next = value.slice(0, start) + snippet + value.slice(end);

      if (next.length > MAX_LENGTH) return;

      onChange(next);

      // Restore the caret after React re-renders the controlled textarea.
      requestAnimationFrame(() => {
        textarea.focus();
        const caret = start + snippet.length;
        textarea.setSelectionRange(caret, caret);
      });
    },
    [onChange, value],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value),
    [onChange],
  );

  const togglePreview = useCallback(() => setShowPreview((prev) => !prev), []);

  return (
    <div className="space-y-2.5">
      {/* Label row */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="prompt-template-body"
          className="flex items-center gap-1.5 text-xs font-medium text-[#666666]"
        >
          <Braces className="h-3.5 w-3.5 text-[#888888]" />
          {label}
        </label>
        <button
          type="button"
          onClick={togglePreview}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-[#111111]"
        >
          {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showPreview ? "Редактировать" : "Предпросмотр"}
        </button>
      </div>

      {/* Editor / preview */}
      {showPreview ? (
        <div
          className="min-h-[180px] whitespace-pre-wrap rounded-lg border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-3 text-sm leading-relaxed text-[#111111]"
          aria-live="polite"
        >
          {preview.length > 0 ? preview : (
            <span className="text-[#888888]">Пока нечего показать.</span>
          )}
        </div>
      ) : (
        <textarea
          id="prompt-template-body"
          ref={textareaRef}
          rows={rows}
          value={value}
          maxLength={MAX_LENGTH}
          onChange={handleChange}
          placeholder="Вы — ассистент по продажам для {{tenant.name}}. Ответьте {{contact.name}} по теме {{deal.title}}..."
          className={cn(
            "w-full resize-y rounded-lg border bg-white px-3.5 py-3 font-mono text-sm leading-relaxed text-[#111111] placeholder:text-[#888888] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20",
            error ? "border-rose-500 focus:border-rose-500" : "border-[#e5e5e5] focus:border-[#4a38f5]",
          )}
        />
      )}

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {/* Token budget */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs text-[#666666]">
            <Hash className="h-3 w-3 text-[#888888]" />~{new Intl.NumberFormat("ru-RU").format(tokens)} токенов
            <span className="text-[#888888]">
              / {new Intl.NumberFormat("en-US", { notation: "compact" }).format(contextWindow)} контекст
            </span>
          </span>
          <span className="text-xs text-[#888888]">
            {value.length} / {MAX_LENGTH} симв.
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-[#f0f0f0]">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              budgetPercent > 80 ? "bg-rose-500" : budgetPercent > 40 ? "bg-[#4a38f5]" : "bg-emerald-500",
            )}
            style={{ width: `${Math.max(budgetPercent, tokens > 0 ? 2 : 0)}%` }}
          />
        </div>
      </div>

      {/* Unknown variable warning */}
      {unknownVariables.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-[#fef08a] bg-[#fefce8] px-3 py-2 text-[#854d0e]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#854d0e]" />
          <p className="text-xs leading-relaxed">
            Неизвестные переменные:{" "}
            <span className="font-mono font-medium">{unknownVariables.join(", ")}</span>. Они не будут
            подставлены во время выполнения и попадут в модель как есть.
          </p>
        </div>
      )}

      {/* Variable palette */}
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wider text-[#888888]">
          Вставить переменную
        </p>
        <div className="flex flex-wrap gap-1.5">
          {PROMPT_VARIABLES.map((variable) => {
            const isUsed = usedVariables.includes(variable.token);
            return (
              <button
                key={variable.token}
                type="button"
                onClick={() => insertVariable(variable.token)}
                title={`${variable.label} — например: ${variable.example}`}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-xs transition-colors",
                  isUsed
                    ? "border-[#4a38f5]/40 bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                {`{{${variable.token}}}`}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
