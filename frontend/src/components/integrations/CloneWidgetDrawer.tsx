"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Bot,
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  Palette,
  ShoppingBag,
  Sparkles,
  Volume2,
  Wand2,
  X,
} from "lucide-react";
import { Sheet, SheetHeader } from "@/components/ui/sheet";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { useCloneChannelAccount } from "@/lib/api/use-channels";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface CloneWidgetDrawerProps {
  sourceAccount: ChannelAccountDTO | null;
  open: boolean;
  onClose: () => void;
  onSuccessCloned: (clonedAccount: ChannelAccountDTO) => void;
  limitReached?: boolean;
}

/**
 * Очищает и нормализует введенный адрес сайта:
 * отсекает https://, http://, концевые слэши и пути.
 */
function cleanDomainInput(raw: string): string {
  let cleaned = raw.trim().toLowerCase();
  cleaned = cleaned.replace(/^[a-z]+:\/\//i, "");
  cleaned = cleaned.replace(/[/?#].*$/, "");
  cleaned = cleaned.replace(/:\d+$/, "");
  cleaned = cleaned.replace(/[./]+$/, "");
  return cleaned;
}

export function CloneWidgetDrawer({
  sourceAccount,
  open,
  onClose,
  onSuccessCloned,
  limitReached = false,
}: CloneWidgetDrawerProps) {
  const [siteDomain, setSiteDomain] = useState("");
  const [widgetLabel, setWidgetLabel] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [domainError, setDomainError] = useState<string | null>(null);

  const domainInputRef = useRef<HTMLInputElement>(null);
  const domainHelpId = useId();

  const cloneMutation = useCloneChannelAccount("webchat");
  const { data: agents = [] } = useAiAgents();

  // Инициализация полей при открытии с новым исходным виджетом
  useEffect(() => {
    if (sourceAccount && open) {
      setSiteDomain("");
      setWidgetLabel(`${sourceAccount.label} (Копия)`);
      setSelectedAgentId(sourceAccount.boundAgentId ?? "");
      setDomainError(null);

      // Автофокус на поле ввода домена после монтирования/анимации шторки
      const timer = setTimeout(() => {
        domainInputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sourceAccount, open]);

  if (!sourceAccount) return null;

  const creds = (sourceAccount.credentials ?? {}) as Record<string, unknown>;
  const accentColor = typeof creds.accentColor === "string" ? creds.accentColor : "#4a38f5";
  const launcherStyle = creds.launcherStyle === "pill" ? "Капсула с фото" : "Круглая кнопка";
  const consultantName = typeof creds.consultantName === "string" ? creds.consultantName : "Консультант";
  const greetingText =
    typeof creds.greeting === "string" && creds.greeting.trim()
      ? creds.greeting
      : "Здравствуйте! Чем могу помочь?";
  const attentionEffect = typeof creds.attentionEffect === "string" ? creds.attentionEffect : "none";
  const soundEnabled = creds.soundEnabled !== false;

  const normalizedDomain = cleanDomainInput(siteDomain);
  const isSameAsSource =
    normalizedDomain.length > 0 &&
    normalizedDomain === cleanDomainInput(sourceAccount.externalId);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!normalizedDomain) {
      setDomainError("Укажите адрес или домен сайта");
      domainInputRef.current?.focus();
      return;
    }

    if (isSameAsSource) {
      setDomainError("Укажите новый адрес сайта, отличный от исходного");
      domainInputRef.current?.focus();
      return;
    }

    if (limitReached) {
      toast.error("Достигнут лимит сайтов по тарифу. Увеличьте количество сайтов в маркетплейсе.");
      return;
    }

    setDomainError(null);

    cloneMutation.mutate(
      {
        id: sourceAccount.id,
        external_id: normalizedDomain,
        label: widgetLabel.trim() || `${sourceAccount.label} (Копия)`,
        agent_id: selectedAgentId ? selectedAgentId : null,
      },
      {
        onSuccess: (clonedAccount) => {
          onSuccessCloned(clonedAccount);
        },
        onError: (err) => {
          const message =
            err.message ||
            "Не удалось клонировать виджет. Проверьте правильность домена и лимиты тарифа.";
          toast.error(message);
        },
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      side="right"
      width="w-full sm:w-[540px] md:w-[600px]"
    >
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <Copy className="h-4.5 w-4.5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-[#111111] truncate">
              Клонировать виджет онлайн-чата
            </h2>
            <p className="flex items-center gap-1.5 text-xs text-[#666666]">
              <span>Дублирование под новый сайт</span>
              <span className="text-[#888888]">·</span>
              <span className="truncate text-[#888888]">
                из «{sourceAccount.label}»
              </span>
            </p>
          </div>
        </div>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
        {/* Карточка исходного виджета-донора */}
        <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 text-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[#111111] flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-[#4a38f5]" />
              Исходный виджет (донор настроек):
            </span>
            <span className="text-[#888888] font-mono">{sourceAccount.externalId}</span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#f0f0f0]">
            <div className="flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full shrink-0 border border-black/10"
                style={{ backgroundColor: accentColor }}
              />
              <span className="text-[#666666] truncate">Цвет: {accentColor}</span>
            </div>
            <div className="flex items-center gap-2">
              <Palette className="h-3 w-3 text-[#888888] shrink-0" />
              <span className="text-[#666666] truncate">{launcherStyle}</span>
            </div>
            <div className="flex items-center gap-2">
              <Bot className="h-3 w-3 text-[#4a38f5] shrink-0" />
              <span className="text-[#666666] truncate">
                {sourceAccount.boundAgentName || "Без автоответов"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-3 w-3 text-amber-500 shrink-0" />
              <span className="text-[#666666] truncate">
                {consultantName}
              </span>
            </div>
          </div>

          <p className="text-[11px] text-[#888888] leading-relaxed">
            Все стили оформления, цвета, фразы приветствия, маскоты, сценарии AI-бота и звуки
            будут перенесены 1-в-1. Для нового сайта сгенерируется отдельный уникальный ключ скрипта.
          </p>
        </div>

        {/* Предупреждение о лимите сайтов, если достигнут */}
        {limitReached && (
          <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-xs text-amber-900 space-y-2">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-amber-950">
                  Достигнут лимит подключенных сайтов по тарифу
                </p>
                <p className="text-amber-800 mt-0.5">
                  Чтобы подключить копию виджета для дополнительного сайта, добавьте сайты в маркетплейсе (+500 ₽/мес).
                </p>
              </div>
            </div>
            <div className="pt-1">
              <Link
                href="/marketplace"
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 shadow-2xs hover:bg-amber-100/50"
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Увеличить количество сайтов
              </Link>
            </div>
          </div>
        )}

        {/* Форма клонирования */}
        <form id="clone-widget-form" onSubmit={handleSubmit} className="space-y-4">
          {/* Адрес / Домен нового сайта (autoFocus) */}
          <div>
            <label className="block text-xs font-semibold text-[#111111]">
              Адрес / Домен нового сайта <span className="text-rose-500">*</span>
            </label>
            <div className="relative mt-1">
              <input
                ref={domainInputRef}
                type="text"
                required
                autoFocus
                value={siteDomain}
                onChange={(e) => {
                  setSiteDomain(e.target.value);
                  if (domainError) setDomainError(null);
                }}
                aria-describedby={domainHelpId}
                placeholder="myshop2.ru или promo.company.ru"
                className={cn(
                  "h-9 w-full rounded-lg border bg-white px-3 text-sm text-[#111111] placeholder:text-[#888888] focus:outline-none focus:ring-1 transition-colors",
                  domainError
                    ? "border-rose-400 focus:border-rose-500 focus:ring-rose-500/20"
                    : "border-[#e5e5e5] focus:border-[#4a38f5] focus:ring-[#4a38f5]/20",
                )}
              />
            </div>

            {domainError ? (
              <p className="mt-1 text-xs text-rose-600 font-medium">{domainError}</p>
            ) : normalizedDomain ? (
              <p id={domainHelpId} className="mt-1 text-xs text-emerald-700 font-mono">
                Виджет будет привязан к: {normalizedDomain}
              </p>
            ) : (
              <p id={domainHelpId} className="mt-1 text-xs text-[#888888]">
                Укажите домен сайта без https://. Скрипт будет загружаться и открываться на этом сайте.
              </p>
            )}
          </div>

          {/* Название виджета в CRM */}
          <div>
            <label className="block text-xs font-semibold text-[#111111]">
              Название виджета в CRM <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={widgetLabel}
              onChange={(e) => setWidgetLabel(e.target.value)}
              placeholder="Интернет-магазин (Копия)"
              className="mt-1 h-9 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <p className="mt-1 text-xs text-[#888888]">
              Название отображается в списке виджетов, чатах и карточках сделок.
            </p>
          </div>

          {/* Назначенный AI-ассистент */}
          <div>
            <label className="block text-xs font-semibold text-[#111111]">
              AI-ассистент для нового сайта
            </label>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            >
              <option value="">Не назначать (только ручные ответы)</option>
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id}>
                  {ag.name} ({ag.model})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-[#888888]">
              По умолчанию скопирован ассистент из исходного виджета. Вы можете назначить другого или отключить автоответы.
            </p>
          </div>

          {/* Аккордеон / Сводка скопированных параметров */}
          <div className="rounded-xl border border-[#e5e5e5] bg-white p-4 text-xs space-y-2">
            <span className="font-semibold text-[#111111] block">
              Параметры, копируемые автоматически:
            </span>
            <ul className="space-y-1.5 text-[#666666]">
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  Приветствие: «<span className="text-[#111111] font-medium">{greetingText}</span>»
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  Внешний вид кнопки: <strong className="text-[#111111]">{launcherStyle}</strong>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  Акцентный цвет: <strong className="text-[#111111]">{accentColor}</strong>
                </span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                <span>
                  Звуковые уведомления:{" "}
                  <strong className="text-[#111111]">
                    {soundEnabled ? "Включены" : "Выключены"}
                  </strong>
                </span>
              </li>
              {attentionEffect !== "none" && (
                <li className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                  <span>
                    Анимация привлечения: <strong className="text-[#111111]">{attentionEffect}</strong>
                  </span>
                </li>
              )}
            </ul>
          </div>
        </form>
      </div>

      {/* Липкий подвал с кнопками действия */}
      <div className="border-t border-[#e5e5e5] bg-white p-4 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="h-9 rounded-lg border border-[#e5e5e5] bg-white px-4 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
        >
          Отмена
        </button>

        <button
          type="submit"
          form="clone-widget-form"
          disabled={cloneMutation.isPending || !normalizedDomain || isSameAsSource || limitReached}
          className="h-9 flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 text-xs font-semibold text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-xs"
        >
          {cloneMutation.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Копирование...
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" />
              Создать копию виджета
            </>
          )}
        </button>
      </div>
    </Sheet>
  );
}
