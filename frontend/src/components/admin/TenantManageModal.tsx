"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";
import {
  Building2,
  Briefcase,
  Calendar,
  Sparkles,
  Bot,
  CheckCircle2,
  Circle,
  HelpCircle,
  Loader2,
  Mail,
  Phone,
  User,
  Tag,
  DollarSign,
  FileText,
  Save,
  Shield,
  ShieldCheck,
  Check,
  Users,
} from "lucide-react";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import {
  useUpdateTenant,
  type AdminTenantDTO,
  renewSubscriptionDate,
} from "@/lib/api/use-admin";
import { cn } from "@/lib/utils";

interface TenantManageModalProps {
  open: boolean;
  tenant: AdminTenantDTO | null;
  allTenants?: AdminTenantDTO[];
  onClose: () => void;
  onSaved?: () => void;
}

const STANDARD_PLANS = [
  { value: "trial", label: "Пробный (Trial)" },
  { value: "starter", label: "Starter" },
  { value: "business", label: "Business" },
  { value: "enterprise", label: "Enterprise" },
];

const STATUS_OPTIONS: { value: "trial" | "active" | "past_due" | "suspended"; label: string }[] = [
  { value: "active", label: "Активен" },
  { value: "trial", label: "Пробный период" },
  { value: "past_due", label: "Просрочен" },
  { value: "suspended", label: "Приостановлен" },
];

const POPULAR_NICHES = [
  "Сервисный центр (ремонт техники)",
  "Автосервис / СТО / Детейлинг",
  "Юридические и финансовые услуги",
  "Недвижимость и риелторы",
  "Салон красоты / Косметология",
  "Розничная торговля / E-commerce",
  "Оптовые продажи и дистрибуция",
  "Онлайн-школа / Образование",
  "Строительство и ремонт",
  "Медицина / Стоматология",
  "Производство",
];

const CLIENT_PRICE_PRESETS = [
  { label: "0 ₽ (Бесплатный клиент)", value: 0, defaultPlanName: "Бесплатный (Клиент)" },
  { label: "990 ₽/мес", value: 990, defaultPlanName: "Starter" },
  { label: "1 990 ₽/мес", value: 1990, defaultPlanName: "Стандарт" },
  { label: "3 900 ₽/мес", value: 3900, defaultPlanName: "Бизнес" },
  { label: "9 900 ₽/мес", value: 9900, defaultPlanName: "Enterprise" },
];

const PARTNER_PRICE_PRESETS = [
  { label: "0 ₽ (Партнёрский тариф)", value: 0, defaultPlanName: "Партнёрский тариф" },
  { label: "4 900 ₽/мес (Партнёр PRO)", value: 4900, defaultPlanName: "Партнёр PRO" },
];

export function TenantManageModal({
  open,
  tenant,
  allTenants = [],
  onClose,
  onSaved,
}: TenantManageModalProps) {
  const update = useUpdateTenant();

  const [tenantType, setTenantType] = useState<"partner" | "client">("client");
  const [parentPartnerId, setParentPartnerId] = useState<string>("");
  const [status, setStatus] = useState<"trial" | "active" | "past_due" | "suspended">("active");
  const [plan, setPlan] = useState<string>("trial");
  const [isCustomPrice, setIsCustomPrice] = useState<boolean>(false);
  const [customPriceRubles, setCustomPriceRubles] = useState<string>("");
  const [customPlanName, setCustomPlanName] = useState<string>("");
  const [businessNiche, setBusinessNiche] = useState<string>("");
  const [customNotes, setCustomNotes] = useState<string>("");
  const [aiBalanceRubles, setAiBalanceRubles] = useState<string>("");
  const [aiMarkupPercent, setAiMarkupPercent] = useState<string>("");
  const [subscriptionExpiresAt, setSubscriptionExpiresAt] = useState<string>("");
  const [requireTelegramAuth, setRequireTelegramAuth] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  const isPlatformRoot =
    tenant?.slug === "voxly" ||
    tenant?.id === "c0000000-0000-0000-0000-000000000001";

  const availablePartners = useMemo(() => {
    return (allTenants || []).filter(
      (t) =>
        (t.is_partner ||
          t.tenant_type === "partner" ||
          t.slug === "voxly" ||
          t.id === "c0000000-0000-0000-0000-000000000001") &&
        t.id !== tenant?.id,
    );
  }, [allTenants, tenant?.id]);

  useEffect(() => {
    if (tenant) {
      const initialType: "partner" | "client" =
        tenant.is_partner || tenant.tenant_type === "partner" ? "partner" : "client";
      setTenantType(initialType);
      setParentPartnerId(tenant.parent_tenant_id || tenant.owner_partner_id || "");

      setStatus(
        (tenant.status === "active" ||
        tenant.status === "trial" ||
        tenant.status === "past_due" ||
        tenant.status === "suspended"
          ? tenant.status
          : "active") as "trial" | "active" | "past_due" | "suspended",
      );
      setPlan(tenant.plan || "trial");

      const hasCustom = tenant.custom_price_rubles !== null || Boolean(tenant.custom_plan_name);
      setIsCustomPrice(hasCustom);
      setCustomPriceRubles(
        tenant.custom_price_rubles !== null ? String(tenant.custom_price_rubles) : "",
      );
      setCustomPlanName(tenant.custom_plan_name ?? "");
      setBusinessNiche(tenant.business_niche ?? "");
      setCustomNotes(tenant.custom_notes ?? "");
      setAiBalanceRubles(String(Math.round(tenant.ai_balance_kopecks / 100)));
      setAiMarkupPercent(String(tenant.ai_markup_percent));
      setSubscriptionExpiresAt(
        tenant.subscription_expires_at
          ? tenant.subscription_expires_at.slice(0, 10)
          : "",
      );
      setRequireTelegramAuth(
        Boolean(
          tenant.auth_settings?.require_telegram_auth ??
          tenant.require_telegram_auth ??
          false,
        ),
      );
    }
  }, [tenant, open]);

  const handleSave = useCallback(async () => {
    if (!tenant) return;
    setIsSaving(true);

    try {
      const isPartner = tenantType === "partner";
      const parentId = isPartner ? null : (parentPartnerId.trim() ? parentPartnerId.trim() : null);

      const payload: Parameters<typeof update.mutateAsync>[0] = {
        id: tenant.id,
        status,
        plan,
        tenant_type: tenantType,
        is_partner: isPartner,
        parent_tenant_id: parentId,
        owner_partner_id: parentId,
        business_niche: businessNiche.trim() ? businessNiche.trim() : null,
        custom_notes: customNotes.trim() ? customNotes.trim() : null,
        require_telegram_auth: requireTelegramAuth,
        auth_settings: {
          require_telegram_auth: requireTelegramAuth,
          allow_password_auth: true,
        },
      };

      if (isCustomPrice) {
        const parsedPrice = customPriceRubles.trim() !== "" ? Number(customPriceRubles.replace(/\s+/g, "")) : 0;
        payload.custom_price_rubles = Number.isFinite(parsedPrice) && parsedPrice >= 0 ? parsedPrice : 0;
        if (customPlanName.trim()) {
          payload.custom_plan_name = customPlanName.trim();
        } else {
          payload.custom_plan_name =
            payload.custom_price_rubles === 0
              ? (isPartner ? "Партнёрский тариф" : "Бесплатный (Клиент)")
              : "Индивидуальный";
        }
      } else {
        payload.custom_price_rubles = null;
        payload.custom_plan_name = null;
      }

      const parsedAiBalance = Number(aiBalanceRubles.replace(/\s+/g, "").replace(",", "."));
      if (Number.isFinite(parsedAiBalance) && parsedAiBalance >= 0) {
        payload.ai_balance_rubles = parsedAiBalance;
      }

      const parsedMarkup = Number(aiMarkupPercent.replace(/\s+/g, "").replace(",", "."));
      if (Number.isFinite(parsedMarkup) && parsedMarkup >= -100 && parsedMarkup <= 1000) {
        payload.ai_markup_percent = parsedMarkup;
      }

      if (subscriptionExpiresAt) {
        payload.subscription_expires_at = new Date(`${subscriptionExpiresAt}T23:59:59.000Z`).toISOString();
      } else {
        payload.subscription_expires_at = null;
      }

      await update.mutateAsync(payload);
      toast.success(`Настройки компании «${tenant.name}» успешно сохранены`);
      onSaved?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить настройки компании");
    } finally {
      setIsSaving(false);
    }
  }, [
    tenant,
    tenantType,
    parentPartnerId,
    status,
    plan,
    isCustomPrice,
    customPriceRubles,
    customPlanName,
    businessNiche,
    customNotes,
    requireTelegramAuth,
    aiBalanceRubles,
    aiMarkupPercent,
    subscriptionExpiresAt,
    update,
    onSaved,
    onClose,
  ]);

  const handleAddDays = (days: number) => {
    const currentVal = subscriptionExpiresAt ? new Date(subscriptionExpiresAt).toISOString() : null;
    const nextDate = renewSubscriptionDate(currentVal, days);
    setSubscriptionExpiresAt(nextDate.slice(0, 10));
    setStatus("active");
  };

  if (!open || !tenant) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">{tenant.name}</h2>
            <p className="text-[11px] text-[#666666]">
              {tenant.slug ? `${tenant.slug}.getvoxly.ru` : "ID: " + tenant.id.slice(0, 8)}
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="space-y-6 p-6">
        {/* Карточка контактов владельца и Adoption Score */}
        <div className="rounded-[10px] border border-[#e5e5e5] bg-[#fafafa] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ececec] pb-3">
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-[#666666]" />
              <span className="text-xs font-medium text-[#111111]">
                {tenant.owner_name || "Владелец не указан"}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs text-[#666666]">
              {tenant.owner_email && (
                <a
                  href={`mailto:${tenant.owner_email}`}
                  className="flex items-center gap-1 hover:text-[#111111]"
                >
                  <Mail className="h-3 w-3" />
                  <span>{tenant.owner_email}</span>
                </a>
              )}
              {tenant.owner_phone && (
                <a
                  href={`tel:${tenant.owner_phone}`}
                  className="flex items-center gap-1 hover:text-[#111111]"
                >
                  <Phone className="h-3 w-3" />
                  <span>{tenant.owner_phone}</span>
                </a>
              )}
            </div>
          </div>

          {/* Индекс внедрения (Adoption Score) */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#666666]">Индекс внедрения возможностей платформы:</span>
              <span
                className={cn(
                  "font-semibold",
                  tenant.adoption_score >= 80
                    ? "text-emerald-700"
                    : tenant.adoption_score >= 40
                      ? "text-amber-700"
                      : "text-rose-600",
                )}
              >
                {tenant.adoption_score}%
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[#e5e5e5]">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-300",
                  tenant.adoption_score >= 80
                    ? "bg-emerald-500"
                    : tenant.adoption_score >= 40
                      ? "bg-amber-500"
                      : "bg-rose-500",
                )}
                style={{ width: `${Math.max(5, tenant.adoption_score)}%` }}
              />
            </div>

            {/* Чеклист внедрения */}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[#555555]">
              <div className="flex items-center gap-1.5">
                {tenant.adoption_checklist?.has_channels ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#aaaaaa]" />
                )}
                <span>Каналы ({tenant.channels_count ?? 0} подкл.)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {tenant.adoption_checklist?.has_deals ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#aaaaaa]" />
                )}
                <span>Сделки CRM ({tenant.deals_count ?? 0})</span>
              </div>
              <div className="flex items-center gap-1.5">
                {tenant.adoption_checklist?.has_ai ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#aaaaaa]" />
                )}
                <span>AI-боты ({tenant.ai_agents_count ?? 0} шт.)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {tenant.adoption_checklist?.has_knowledge ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#aaaaaa]" />
                )}
                <span>База знаний ({tenant.knowledge_docs_count ?? 0} док.)</span>
              </div>
              <div className="flex items-center gap-1.5">
                {tenant.adoption_checklist?.has_team ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                ) : (
                  <Circle className="h-3.5 w-3.5 text-[#aaaaaa]" />
                )}
                <span>Команда ({tenant.users_count} сотр.)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5 text-[#666666]" />
                <span>
                  Статус ИИ:{" "}
                  <strong>
                    {tenant.ai_status === "active"
                      ? "Работает"
                      : tenant.ai_status === "paused"
                        ? "На паузе"
                        : "Не настроен"}
                  </strong>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Секция 0: Тип и роль аккаунта в системе */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-3.5 bg-white">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Тип и роль аккаунта в системе
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* Карточка: Партнёр */}
            <button
              type="button"
              onClick={() => {
                setTenantType("partner");
                setParentPartnerId("");
                if (isCustomPrice && (customPriceRubles === "0" || !customPlanName)) {
                  setCustomPlanName("Партнёрский тариф");
                }
              }}
              className={cn(
                "relative flex flex-col items-start rounded-[8px] border p-3.5 text-left transition-all",
                tenantType === "partner"
                  ? "border-[#4a38f5] bg-[#4a38f5]/5 shadow-xs"
                  : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#cccccc] hover:bg-white",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-[6px]",
                      tenantType === "partner"
                        ? "bg-[#4a38f5] text-white"
                        : "bg-white text-[#666666] border border-[#e5e5e5]",
                    )}
                  >
                    <Briefcase className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-[#111111]">Партнёр платформы</span>
                </div>
                {tenantType === "partner" && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] text-white">
                    <Check className="h-3 w-3" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#666666]">
                Интегратор или агентство. Может привлекать суб-клиентов и управлять ими в системе.
              </p>
            </button>

            {/* Карточка: Клиент */}
            <button
              type="button"
              disabled={isPlatformRoot}
              title={isPlatformRoot ? "Основная платформа GETVOXLY не может быть клиентским аккаунтом" : undefined}
              onClick={() => {
                if (isPlatformRoot) return;
                setTenantType("client");
                if (isCustomPrice && (customPriceRubles === "0" || !customPlanName)) {
                  setCustomPlanName("Бесплатный (Клиент)");
                }
              }}
              className={cn(
                "relative flex flex-col items-start rounded-[8px] border p-3.5 text-left transition-all",
                isPlatformRoot
                  ? "border-[#e5e5e5] bg-[#f5f5f5] opacity-50 cursor-not-allowed"
                  : tenantType === "client"
                    ? "border-[#4a38f5] bg-[#4a38f5]/5 shadow-xs"
                    : "border-[#e5e5e5] bg-[#fafafa] hover:border-[#cccccc] hover:bg-white",
              )}
            >
              <div className="flex w-full items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-[6px]",
                      tenantType === "client"
                        ? "bg-[#4a38f5] text-white"
                        : "bg-white text-[#666666] border border-[#e5e5e5]",
                    )}
                  >
                    <Building2 className="h-3.5 w-3.5" />
                  </div>
                  <span className="text-xs font-semibold text-[#111111]">Клиентский аккаунт</span>
                </div>
                {tenantType === "client" && (
                  <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] text-white">
                    <Check className="h-3 w-3" />
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[#666666]">
                {isPlatformRoot
                  ? "Основная платформа GETVOXLY управляет всеми организациями."
                  : "Конечный пользователь CRM (прямой клиент платформы или суб-клиент партнёра)."}
              </p>
            </button>
          </div>

          {/* Если выбран Клиентский аккаунт: выбор партнёра-родителя */}
          {tenantType === "client" && (
            <div className="mt-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
              <label className="block text-xs font-medium text-[#111111]">
                Партнёр-владелец или портал платформы (Parent Organization)
              </label>
              <select
                value={parentPartnerId}
                onChange={(e) => setParentPartnerId(e.target.value)}
                className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                <option value="">Без партнёра (Прямой независимый клиент)</option>
                {availablePartners.map((p) => {
                  const isRoot =
                    p.slug === "voxly" ||
                    p.id === "c0000000-0000-0000-0000-000000000001";
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.slug ? `(@${p.slug})` : ""} — {isRoot ? "Основная платформа (Voxly)" : "Партнёр платформы"}
                    </option>
                  );
                })}
              </select>
              <p className="text-[11px] text-[#666666]">
                {parentPartnerId ? (
                  <>
                    Клиент закреплён за выбранной организацией. В списке компаний он будет отображаться в иерархическом дереве как дочерний портал.
                  </>
                ) : (
                  <>Клиент работает напрямую и не привязан ни к какому родительскому порталу или партнёру.</>
                )}
              </p>
            </div>
          )}

          {tenantType === "partner" && (
            <div className="mt-2 rounded-[8px] border border-indigo-200 bg-indigo-50/50 p-2.5 text-[11px] text-indigo-900">
              Компания является корневым партнёром. Все зарегистрированные им клиенты отображаются под ним с визуальной связью дерева.
            </div>
          )}
        </div>

        {/* Секция 1: Индивидуальный тариф и стоимость */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-4 bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-[#4a38f5]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
                Тарифный план и оплата
              </h3>
            </div>
            <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-[#111111]">
              <input
                type="checkbox"
                checked={isCustomPrice}
                onChange={(e) => setIsCustomPrice(e.target.checked)}
                className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
              />
              <span>Индивидуальный тариф / Бесплатно</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#666666]">
                Базовый пакет функций (План)
              </label>
              <select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                className="mt-1.5 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {STANDARD_PLANS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#666666]">
                Статус подписки
              </label>
              <select
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as "trial" | "active" | "past_due" | "suspended")
                }
                className="mt-1.5 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Блок индивидуальной цены */}
          {isCustomPrice && (
            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#111111]">
                    Кастомная цена (₽/мес)
                  </label>
                  <div className="relative mt-1">
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={customPriceRubles}
                      onChange={(e) => setCustomPriceRubles(e.target.value)}
                      placeholder="0 для бесплатного"
                      className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 pr-8 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                    <span className="absolute right-2.5 top-2 text-xs text-[#888888]">₽</span>
                  </div>
                  <span className="mt-1 block text-[11px] text-[#666666]">
                    {tenantType === "partner"
                      ? "0 ₽ — специальный партнёрский тариф для интегратора"
                      : "0 ₽ — бесплатный доступ для клиента (субклиент партнёра или грант)"}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#111111]">
                    Название тарифа в интерфейсе
                  </label>
                  <input
                    type="text"
                    value={customPlanName}
                    onChange={(e) => setCustomPlanName(e.target.value)}
                    placeholder={tenantType === "partner" ? "Партнёрский тариф" : "Бесплатный (Клиент)"}
                    className="mt-1 h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  <span className="mt-1 block text-[11px] text-[#666666]">
                    Отображается в профиле клиента
                  </span>
                </div>
              </div>

              {/* Пресеты цены */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[11px] text-[#666666] mr-1">
                  Пресеты ({tenantType === "partner" ? "партнёр" : "клиент"}):
                </span>
                {(tenantType === "partner" ? PARTNER_PRICE_PRESETS : CLIENT_PRICE_PRESETS).map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    onClick={() => {
                      setCustomPriceRubles(String(preset.value));
                      setCustomPlanName(preset.defaultPlanName);
                    }}
                    className={cn(
                      "rounded-[4px] border px-2 py-0.5 text-[11px] font-medium transition-colors",
                      Number(customPriceRubles) === preset.value
                        ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Срок подписки */}
          <div className="pt-2 border-t border-[#f0f0f0]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs font-medium text-[#111111]">
                <Calendar className="h-3.5 w-3.5 text-[#666666]" />
                <span>Подписка действует до:</span>
              </label>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleAddDays(30)}
                  className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0]"
                >
                  +30 дней
                </button>
                <button
                  type="button"
                  onClick={() => handleAddDays(90)}
                  className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0]"
                >
                  +90 дней
                </button>
                <button
                  type="button"
                  onClick={() => handleAddDays(365)}
                  className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-[11px] font-medium text-[#111111] hover:bg-[#f0f0f0]"
                >
                  +1 год
                </button>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="date"
                value={subscriptionExpiresAt}
                onChange={(e) => setSubscriptionExpiresAt(e.target.value)}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <span className="text-[11px] text-[#666666]">
                {subscriptionExpiresAt
                  ? `Дата окончания: ${new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" }).format(new Date(subscriptionExpiresAt))}`
                  : "Бессрочно / Не ограничено"}
              </span>
            </div>
          </div>
        </div>

        {/* Секция: Политика аутентификации */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-3 bg-white">
          <div className="flex items-center gap-2 border-b border-[#f0f0f0] pb-2">
            <ShieldCheck className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Политика аутентификации портала
            </h3>
          </div>

          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-[#111111]">
                  Обязательный вход через Telegram-бота (2FA)
                </span>
                <p className="text-[11px] text-[#666666] mt-0.5">
                  {requireTelegramAuth
                    ? "Вход защищен кодом из Telegram-бота. Пользователи обязаны подтверждать вход через бота."
                    : "Вход только по логину и паролю. Подтверждение через Telegram-бота отключено."}
                </p>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={requireTelegramAuth}
                onClick={() => setRequireTelegramAuth((prev) => !prev)}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#4a38f5] focus:ring-offset-2",
                  requireTelegramAuth ? "bg-[#4a38f5]" : "bg-[#cccccc]",
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                    requireTelegramAuth ? "translate-x-4" : "translate-x-0",
                  )}
                />
              </button>
            </div>

            {!requireTelegramAuth && (
              <div className="flex items-center gap-2 pt-1.5 text-xs text-[#854d0e]">
                <Shield className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>
                  Сотрудники смогут входить по e-mail и паролю без необходимости запускать Telegram-бота.
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Секция 2: Ниша бизнеса (Сфера деятельности) */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-3 bg-white">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Сфера бизнеса / Ниша клиента
            </h3>
          </div>
          <p className="text-[11px] text-[#666666]">
            Помогает фильтровать компании и сегментировать допродажи профильных модулей и AI-сценариев.
          </p>

          <input
            type="text"
            value={businessNiche}
            onChange={(e) => setBusinessNiche(e.target.value)}
            placeholder="Укажите нишу или выберите из списка ниже..."
            className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />

          <div className="flex flex-wrap gap-1.5 pt-1">
            {POPULAR_NICHES.map((niche) => (
              <button
                key={niche}
                type="button"
                onClick={() => setBusinessNiche(niche)}
                className={cn(
                  "rounded-[4px] border px-2 py-0.5 text-[11px] transition-colors",
                  businessNiche === niche
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                    : "border-[#e5e5e5] bg-[#fafafa] text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                {niche}
              </button>
            ))}
          </div>
        </div>

        {/* Секция 3: Баланс ИИ и наценка */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-3 bg-white">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Баланс ИИ и наценка платформы
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-[#666666]">
                Баланс ИИ (рубли)
              </label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={aiBalanceRubles}
                  onChange={(e) => setAiBalanceRubles(e.target.value)}
                  placeholder="0"
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 pr-8 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <span className="absolute right-2.5 top-2 text-xs text-[#888888]">₽</span>
              </div>
              <span className="mt-1 block text-[11px] text-[#666666]">
                Расход за текущий месяц: {Math.round(tenant.ai_spent_month_kopecks / 100)} ₽
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#666666]">
                Наценка на токены (%)
              </label>
              <div className="relative mt-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={aiMarkupPercent}
                  onChange={(e) => setAiMarkupPercent(e.target.value)}
                  placeholder="0"
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 pr-8 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <span className="absolute right-2.5 top-2 text-xs text-[#888888]">%</span>
              </div>
              <span className="mt-1 block text-[11px] text-[#666666]">
                0% — по себестоимости, &gt;0% — маржа, &lt;0% — скидка
              </span>
            </div>
          </div>
        </div>

        {/* Секция 4: Внутренние заметки менеджера платформы */}
        <div className="rounded-[10px] border border-[#e5e5e5] p-4 space-y-2 bg-white">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[#4a38f5]" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Внутренние заметки менеджера
            </h3>
          </div>
          <p className="text-[11px] text-[#666666]">
            Видны только суперадминистраторам платформы. Фиксируйте договорённости, условия партнёрства или статус интеграции.
          </p>
          <textarea
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            rows={3}
            placeholder="Например: Договорились на бесплатный период на 2 месяца в обмен на кейс и отзыв. Куратор — Артём."
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
        </div>

        {/* Кнопки сохранения */}
        <div className="flex items-center justify-end gap-2.5 border-t border-[#e5e5e5] pt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa] disabled:opacity-50"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            <span>Сохранить настройки</span>
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
