"use client";

import { useState, useCallback, useEffect } from "react";
import {
  X,
  Building2,
  Calendar,
  Users,
  Banknote,
  Zap,
  ToggleLeft,
  ToggleRight,
  Wrench,
  Receipt,
  BellRing,
  Save,
  type LucideIcon,
} from "lucide-react";
import type { PlatformTenant, SubscriptionPlan } from "@/lib/admin/admin.types";
import { getPlanLabel, getPlanColors, getStatusLabel, getStatusColors } from "@/lib/admin/admin.types";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

interface TenantManageModalProps {
  open: boolean;
  tenant: PlatformTenant | null;
  onClose: () => void;
  onSave: (tenant: PlatformTenant) => void;
  isSubmitting?: boolean;
}

const PLANS: { value: SubscriptionPlan; label: string }[] = [
  { value: "trial", label: "Пробный (14 дней)" },
  { value: "starter", label: "Starter" },
  { value: "professional", label: "Professional" },
  { value: "enterprise", label: "Enterprise" },
];

const ALL_MODULES = [
  { slug: "service_center", name: "Service Center", icon: Wrench, color: "sky" },
  { slug: "finance", name: "Finance", icon: Receipt, color: "emerald" },
  { slug: "ai_bots", name: "AI Bots", icon: BellRing, color: "violet" },
] as const;

function formatTokens(n: number): string {
  return new Intl.NumberFormat("ru-RU").format(n);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(iso));
}

export function TenantManageModal({ open, tenant, onClose, onSave, isSubmitting = false }: TenantManageModalProps) {
  const [plan, setPlan] = useState<SubscriptionPlan>("trial");
  const [modules, setModules] = useState<string[]>([]);
  const [deepseekTotal, setDeepseekTotal] = useState(0);
  const [openaiTotal, setOpenaiTotal] = useState(0);
  const [trialEndsAt, setTrialEndsAt] = useState("");
  const [subEndsAt, setSubEndsAt] = useState("");

  // Единый стек оверлеев. Закрывает два дефекта разом: прямая правка
  // `body.style.overflow` возвращала прокрутку фону при закрытии верхнего из
  // нескольких оверлеев, а собственный слушатель Escape закрывал их все сразу.
  useOverlay(open, { onEscape: onClose });

  useEffect(() => {
    if (tenant) {
      setPlan(tenant.plan);
      setModules([...tenant.installed_modules]);
      setDeepseekTotal(tenant.ai_tokens_deepseek);
      setOpenaiTotal(tenant.ai_tokens_openai);
      setTrialEndsAt(tenant.trial_ends_at ?? "");
      setSubEndsAt(tenant.subscription_ends_at);
    }
  }, [tenant, open]);

  const toggleModule = useCallback((slug: string) => {
    setModules((prev) =>
      prev.includes(slug) ? prev.filter((m) => m !== slug) : [...prev, slug],
    );
  }, []);

  const handleSave = useCallback(() => {
    if (!tenant) return;
    onSave({
      ...tenant,
      plan,
      installed_modules: modules,
      ai_tokens_deepseek: deepseekTotal,
      ai_tokens_openai: openaiTotal,
      trial_ends_at: trialEndsAt || null,
      subscription_ends_at: subEndsAt || tenant.subscription_ends_at,
    });
    onClose();
  }, [tenant, plan, modules, deepseekTotal, openaiTotal, trialEndsAt, subEndsAt, onSave, onClose]);

  const handleBackdrop = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);


  if (!open || !tenant) return null;

  const deepseekUsed = tenant.ai_tokens_deepseek_used;
  const openaiUsed = tenant.ai_tokens_openai_used;
  const deepseekPct = deepseekTotal > 0 ? Math.round((deepseekUsed / deepseekTotal) * 100) : 0;
  const openaiPct = openaiTotal > 0 ? Math.round((openaiUsed / openaiTotal) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/80 backdrop-blur-sm p-4 overflow-y-auto" onClick={handleBackdrop}>
      <div className="w-full max-w-2xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl my-8">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/10">
              <Building2 className="h-4 w-4 text-rose-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">{tenant.company_name}</h2>
              <p className="text-xs text-slate-500">{tenant.slug}.getvoxly.ru</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-800 hover:text-slate-300 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Owner Info */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-xs text-slate-500">Владелец</span>
              <p className="font-medium text-slate-200">{tenant.owner_name}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">E-mail</span>
              <p className="font-medium text-slate-200">{tenant.owner_email}</p>
            </div>
            <div>
              <span className="text-xs text-slate-500">Статус</span>
              <span className={cn("ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", getStatusColors(tenant.status))}>
                {getStatusLabel(tenant.status)}
              </span>
            </div>
            <div>
              <span className="text-xs text-slate-500">Регистрация</span>
              <p className="font-medium text-slate-200">{formatDate(tenant.registered_at)}</p>
            </div>
          </div>

          {/* Plan */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Calendar className="h-3 w-3" /> Subscription Plan
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {PLANS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlan(p.value)}
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-xs font-medium transition-colors",
                    plan === p.value
                      ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                      : "border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-300",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">Пробный период до (необязательно)</label>
                <input
                  type="datetime-local"
                  value={trialEndsAt ? trialEndsAt.slice(0, 16) : ""}
                  onChange={(e) => setTrialEndsAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Подписка до</label>
                <input
                  type="datetime-local"
                  value={subEndsAt ? subEndsAt.slice(0, 16) : ""}
                  onChange={(e) => setSubEndsAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>
          </fieldset>

          {/* Modules */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Users className="h-3 w-3" /> Installed Modules
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {ALL_MODULES.map((mod) => {
                const isOn = modules.includes(mod.slug);
                return (
                  <button
                    key={mod.slug}
                    type="button"
                    onClick={() => toggleModule(mod.slug)}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-4 py-3 text-xs font-medium transition-colors",
                      isOn
                        ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-slate-700 text-slate-500 hover:border-slate-600",
                    )}
                  >
                    <mod.icon className="h-4 w-4" />
                    <span className="flex-1 text-left">{mod.name}</span>
                    {isOn ? <ToggleRight className="h-4 w-4 text-amber-400" /> : <ToggleLeft className="h-4 w-4 text-slate-600" />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* AI Balance */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-medium text-slate-400 flex items-center gap-1.5">
              <Zap className="h-3 w-3" /> AI Token Balance
            </legend>

            {/* DeepSeek */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">DeepSeek</span>
                <span className="text-xs text-slate-500">
                  {formatTokens(deepseekUsed)} / {formatTokens(deepseekTotal)} used
                </span>
              </div>
              <div className="flex h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.min(deepseekPct, 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={deepseekTotal}
                  onChange={(e) => setDeepseekTotal(Number(e.target.value))}
                  className="w-40 rounded-lg border border-slate-700 bg-slate-950 py-1.5 px-3 text-sm text-slate-100 focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-xs text-slate-500">total tokens</span>
              </div>
            </div>

            {/* OpenAI */}
            <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">OpenAI</span>
                <span className="text-xs text-slate-500">
                  {formatTokens(openaiUsed)} / {formatTokens(openaiTotal)} used
                </span>
              </div>
              <div className="flex h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(openaiPct, 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={openaiTotal}
                  onChange={(e) => setOpenaiTotal(Number(e.target.value))}
                  className="w-40 rounded-lg border border-slate-700 bg-slate-950 py-1.5 px-3 text-sm text-slate-100 focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-xs text-slate-500">total tokens</span>
              </div>
            </div>
          </fieldset>

          {/* Revenue Summary */}
          <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-slate-500" />
              <span className="text-xs text-slate-500">Всего выручки</span>
            </div>
            <span className="text-sm font-bold text-amber-400">
              {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(tenant.total_revenue)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors">
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold bg-[#4a38f5] text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}