"use client";

import { memo } from "react";
import { ClipboardCheck, User, Calendar, AlertTriangle, CheckCircle2 } from "lucide-react";
import type { DiagnosticsResult } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

interface DiagnosticsPanelProps {
  diagnostics: DiagnosticsResult | null;
  status: string;
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export const DiagnosticsPanel = memo(function DiagnosticsPanel({
  diagnostics,
  status,
}: DiagnosticsPanelProps) {
  if (!diagnostics) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10">
            <ClipboardCheck className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Диагностика</h2>
            <p className="text-xs text-slate-500">
              {status === "received" ? "Ожидает — ещё не выполнена" : "Диагностика не зафиксирована"}
            </p>
          </div>
        </div>

        {status === "received" && (
          <div className="rounded-lg border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-4 py-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-400">Ожидает диагностики</p>
                <p className="text-xs text-amber-400/70 mt-1">
                  Устройство ещё в очереди на приёмку. Результаты диагностики появятся здесь.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Диагностика завершена</h2>
          <p className="text-xs text-slate-500">
            Выполнена {formatDateTime(diagnostics.performed_at)}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        {/* Performed By */}
        <div className="flex items-center gap-2">
          <User className="h-3.5 w-3.5 text-slate-500 shrink-0" />
          <span className="text-sm text-slate-400">Выполнил</span>
          <span className="text-sm font-medium text-slate-200">{diagnostics.performed_by}</span>
        </div>

        {/* Findings */}
        <div>
          <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
            Результаты
          </span>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {diagnostics.findings}
            </p>
          </div>
        </div>

        {/* Recommended Action */}
        <div>
          <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
            Рекомендуемые работы
          </span>
          <div className="rounded-lg border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-4 py-3">
            <p className="text-sm text-amber-300 leading-relaxed whitespace-pre-wrap">
              {diagnostics.recommended_action}
            </p>
          </div>
        </div>

        {/* Condition Notes */}
        <div>
          <span className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
            Состояние устройства
          </span>
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-4 py-3">
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {diagnostics.condition_notes}
            </p>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-1.5">
          <Calendar className="h-3.5 w-3.5 text-slate-500" />
          <span className="text-xs text-slate-500">{formatDateTime(diagnostics.performed_at)}</span>
        </div>
      </div>
    </div>
  );
});