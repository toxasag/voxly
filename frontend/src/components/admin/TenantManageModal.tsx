"use client";

import { useState, useCallback, useEffect } from "react";
import {
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
} from "lucide-react";
import type { PlatformTenant, SubscriptionPlan } from "@/lib/admin/admin.types";
import { getPlanLabel, getPlanColors, getStatusLabel, getStatusColors } from "@/lib/admin/admin.types";
import { cn } from "@/lib/utils";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";

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


  if (!open || !tenant) return null;

  const deepseekUsed = tenant.ai_tokens_deepseek_used;
  const openaiUsed = tenant.ai_tokens_openai_used;
  const deepseekPct = deepseekTotal > 0 ? Math.round((deepseekUsed / deepseekTotal) * 100) : 0;
  const openaiPct = openaiTotal > 0 ? Math.round((openaiUsed / openaiTotal) * 100) : 0;

  return (
    <Sheet open={open} onClose={onClose} width="w-[580px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10">
            <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">{tenant.company_name}</h2>
            <p className="text-[11px] text-[#666666]">{tenant.slug}.getvoxly.ru</p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent>
        <div className="space-y-5">
          {/* Owner Info */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 grid grid-cols-2 gap-2.5 text-xs">
            <div>
              <span className="text-[11px] text-[#888888]">Владелец</span>
              <p className="font-medium text-[#111111]">{tenant.owner_name || "—"}</p>
            </div>
            <div>
              <span className="text-[11px] text-[#888888]">E-mail</span>
              <p className="font-medium text-[#111111]">{tenant.owner_email || "—"}</p>
            </div>
            <div>
              <span className="text-[11px] text-[#888888]">Статус</span>
              <span className={cn("ml-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", getStatusColors(tenant.status))}>
                {getStatusLabel(tenant.status)}
              </span>
            </div>
            <div>
              <span className="text-[11px] text-[#888888]">Регистрация</span>
              <p className="font-medium text-[#111111]">{formatDate(tenant.registered_at)}</p>
            </div>
          </div>

          {/* Plan */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-[#666666] flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" /> Тарифный план
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {PLANS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPlan(p.value)}
                  className={cn(
                    "rounded-[8px] border px-2.5 py-2 text-xs font-medium transition-colors text-center",
                    plan === p.value
                      ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                      : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] text-[#888888] mb-1">Пробный период до</label>
                <input
                  type="datetime-local"
                  value={trialEndsAt ? trialEndsAt.slice(0, 16) : ""}
                  onChange={(e) => setTrialEndsAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#888888] mb-1">Подписка до</label>
                <input
                  type="datetime-local"
                  value={subEndsAt ? subEndsAt.slice(0, 16) : ""}
                  onChange={(e) => setSubEndsAt(e.target.value ? new Date(e.target.value).toISOString() : "")}
                  className="h-8 w-full rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>
            </div>
          </fieldset>

          {/* Modules */}
          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-[#666666] flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" /> Установленные модули
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
                      "flex items-center gap-2 rounded-[8px] border px-3 py-2.5 text-xs font-medium transition-colors",
                      isOn
                        ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                    )}
                  >
                    <mod.icon className="h-4 w-4" />
                    <span className="flex-1 text-left">{mod.name}</span>
                    {isOn ? <ToggleRight className="h-4 w-4 text-[#4a38f5]" /> : <ToggleLeft className="h-4 w-4 text-[#888888]" />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* AI Balance */}
          <fieldset className="space-y-3">
            <legend className="text-xs font-medium text-[#666666] flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5" /> Баланс токенов ИИ
            </legend>

            {/* DeepSeek */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#111111]">DeepSeek</span>
                <span className="text-[#888888]">
                  {formatTokens(deepseekUsed)} / {formatTokens(deepseekTotal)} used
                </span>
              </div>
              <div className="flex h-1.5 w-full rounded-full bg-[#e5e5e5] overflow-hidden">
                <div className="h-full bg-violet-500 transition-all" style={{ width: `${Math.min(deepseekPct, 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={deepseekTotal}
                  onChange={(e) => setDeepseekTotal(Number(e.target.value))}
                  className="h-7 w-36 rounded-[4px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[11px] text-[#888888]">лимит токенов</span>
              </div>
            </div>

            {/* OpenAI */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium text-[#111111]">OpenAI</span>
                <span className="text-[#888888]">
                  {formatTokens(openaiUsed)} / {formatTokens(openaiTotal)} used
                </span>
              </div>
              <div className="flex h-1.5 w-full rounded-full bg-[#e5e5e5] overflow-hidden">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${Math.min(openaiPct, 100)}%` }} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={openaiTotal}
                  onChange={(e) => setOpenaiTotal(Number(e.target.value))}
                  className="h-7 w-36 rounded-[4px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[11px] text-[#888888]">лимит токенов</span>
              </div>
            </div>
          </fieldset>

          {/* Revenue Summary */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Banknote className="h-4 w-4 text-[#888888]" />
              <span className="text-xs text-[#666666]">Всего выручки</span>
            </div>
            <span className="text-xs font-bold text-amber-600">
              {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(tenant.total_revenue)}
            </span>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#e5e5e5]">
            <button type="button" onClick={onClose} className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors">
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSubmitting}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Save className="h-3.5 w-3.5" />
              {isSubmitting ? "Сохранение..." : "Сохранить"}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}