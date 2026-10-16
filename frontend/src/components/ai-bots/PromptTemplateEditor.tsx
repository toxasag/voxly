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
}

const MAX_LENGTH = 8000;

export function PromptTemplateEditor({
  value,
  onChange,
  contextWindow,
  error,
  rows = 8,
  label = "Системный промпт",
}: PromptTemplateEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showPreview, setShowPreview] = useState(false);

  const tokens = useMemo(() => estimateTokens(value), [value]);
  const usedVariables = useMemo(() => extractPromptVariables(value), [value]);
  const unknownVariables = useMemo(() => findUnknownVariables(value), [value]);
  const preview = useMemo(() => renderPromptPreview(value), [value]);

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
          className="flex items-center gap-1.5 text-xs font-medium text-slate-400"
        >
          <Braces className="h-3.5 w-3.5 text-slate-500" />
          {label}
        </label>
        <button
          type="button"
          onClick={togglePreview}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
        >
          {showPreview ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showPreview ? "Редактировать" : "Предпросмотр"}
        </button>
      </div>

      {/* Editor / preview */}
      {showPreview ? (
        <div
          className="min-h-[180px] whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-3 text-sm leading-relaxed text-slate-300"
          aria-live="polite"
        >
          {preview.length > 0 ? preview : (
            <span className="text-slate-600">Пока нечего показать.</span>
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
            "w-full resize-y rounded-lg border bg-slate-950 px-3.5 py-3 font-mono text-sm leading-relaxed text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
            error ? "border-rose-500 focus:border-rose-500" : "border-slate-700 focus:border-amber-500",
          )}
        />
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}

      {/* Token budget */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Hash className="h-3 w-3" />~{new Intl.NumberFormat("ru-RU").format(tokens)} токенов
            <span className="text-slate-600">
              / {new Intl.NumberFormat("en-US", { notation: "compact" }).format(contextWindow)} контекст
            </span>
          </span>
          <span className="text-xs text-slate-600">
            {value.length} / {MAX_LENGTH} симв.
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              budgetPercent > 80 ? "bg-rose-500" : budgetPercent > 40 ? "bg-amber-500" : "bg-emerald-500",
            )}
            style={{ width: `${Math.max(budgetPercent, tokens > 0 ? 2 : 0)}%` }}
          />
        </div>
      </div>

      {/* Unknown variable warning */}
      {unknownVariables.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-xs text-amber-400/90">
            Неизвестные переменные:{" "}
            <span className="font-mono">{unknownVariables.join(", ")}</span>. Они не будут
            подставлены во время выполнения и попадут в модель как есть.
          </p>
        </div>
      )}

      {/* Variable palette */}
      <div>
        <p className="mb-1.5 text-xs uppercase tracking-wider text-slate-600">
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
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                    : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
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
