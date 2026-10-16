"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { Bot, MessageSquare, Settings2, Zap, Clock } from "lucide-react";
import type { AiBot } from "@/lib/ai-bots/ai-bots.types";
import {
  getAccentClasses,
  getBotModeLabel,
  getModelInfo,
} from "@/lib/ai-bots/ai-bots.types";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { cn } from "@/lib/utils";

interface BotCardProps {
  bot: AiBot;
  onToggleStatus: (id: string) => void;
  onConfigure: (bot: AiBot) => void;
}

function formatRelative(iso: string | null): string {
  if (iso === null) return "не использовался";

  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн назад`;

  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short" }).format(
    new Date(iso),
  );
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

export const BotCard = memo(function BotCard({
  bot,
  onToggleStatus,
  onConfigure,
}: BotCardProps) {
  const isActive = bot.status === "active";
  // tokens_limit = 0 означает «лимита нет»: расход ограничен балансом ИИ, а не
  // квотой на агента. Деление на ноль дало бы NaN в шкале.
  const hasLimit = bot.tokens_limit > 0;
  const usagePercent = hasLimit
    ? Math.min(100, Math.round((bot.tokens_used / bot.tokens_limit) * 100))
    : 0;
  const model = getModelInfo(bot.model);

  const handleToggle = useCallback(() => onToggleStatus(bot.id), [bot.id, onToggleStatus]);
  const handleConfigure = useCallback(() => onConfigure(bot), [bot, onConfigure]);

  return (
    <div className="flex flex-col rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700">
      {/* Header: avatar, name, status */}
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            getAccentClasses(bot.accent),
          )}
        >
          <Bot className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-100">{bot.name}</h3>
            <StatusBadge variant={isActive ? "success" : "neutral"} size="sm" withDot>
              {isActive ? "Активен" : "На паузе"}
            </StatusBadge>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{bot.description}</p>
        </div>

        {/* Active toggle */}
        <button
          type="button"
          role="switch"
          aria-checked={isActive}
          aria-label={isActive ? `Поставить на паузу: ${bot.name}` : `Активировать: ${bot.name}`}
          onClick={handleToggle}
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40",
            isActive ? "bg-amber-500" : "bg-slate-700",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-4 w-4 rounded-full bg-slate-950 transition-transform",
              isActive ? "translate-x-[18px]" : "translate-x-0.5",
            )}
          />
        </button>
      </div>

      {/* Meta badges */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex items-center rounded-md border border-slate-700 bg-slate-950/60 px-2 py-0.5 font-mono text-xs text-slate-400">
          {model.label}
        </span>
        <span className="inline-flex items-center rounded-md border border-orange-400/30 bg-orange-400/10 px-2 py-0.5 text-xs font-medium text-orange-400">
          {getBotModeLabel(bot.mode)}
        </span>
        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          {formatRelative(bot.last_used_at)}
        </span>
      </div>

      {/*
        Расход токенов.
        
        Персонального лимита у агента больше нет: он заменён общим балансом ИИ в
        деньгах (миграция 0014). Поэтому вместо полосы «использовано из лимита»
        показывается просто израсходованное число — деление на нулевой лимит
        давало «NaN%» в шкале (проверено в браузере).
      */}
      <div className="mt-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <Zap className="h-3 w-3 text-amber-400" />
            {formatCompact(bot.tokens_used)} токенов израсходовано
          </span>
          {hasLimit && <span className="text-xs text-slate-500">{usagePercent}%</span>}
        </div>

        {hasLimit && (
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                usagePercent > 80
                  ? "bg-rose-500"
                  : usagePercent > 50
                    ? "bg-amber-500"
                    : "bg-emerald-500",
              )}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-slate-800 pt-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-600">Запросы</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-200">
            {new Intl.NumberFormat("ru-RU").format(bot.requests_count)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-600">Ср. задержка</p>
          <p className="mt-0.5 text-sm font-semibold text-slate-200">
            {bot.avg_latency_ms === 0 ? "—" : `${bot.avg_latency_ms} ms`}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-slate-600">Стоимость</p>
          <p className="mt-0.5 text-sm font-semibold text-amber-400">
            {new Intl.NumberFormat("ru-RU", {
              style: "currency",
              currency: "RUB",
              maximumFractionDigits: 0,
            }).format(bot.cost_rub)}
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Link
          href={`/modules/ai-bots/${bot.id}`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Чат
        </Link>
        <button
          type="button"
          onClick={handleConfigure}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-slate-600 hover:text-slate-200"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Настроить
        </button>
      </div>
    </div>
  );
});
