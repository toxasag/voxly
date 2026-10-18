"use client";

import { useState, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  ChevronRight,
  ChevronLeft,
  User,
  Building2,
  Briefcase,
  PartyPopper,
  Loader2,
  Check,
  Globe,
  Hash,
  Coins,
} from "lucide-react";
import {
  ownerSchema,
  workspaceSchema,
  businessDomainSchema,
  type OwnerFormValues,
  type WorkspaceFormValues,
  type BusinessDomainValues,
  type OnboardingStep,
  type OnboardingState,
  CURRENCY_OPTIONS,
  TIMEZONE_OPTIONS,
  BUSINESS_DOMAIN_MODULES,
} from "@/schemas/onboarding.schema";
import { cn } from "@/lib/utils";

const STEPS: { key: OnboardingStep; label: string; icon: typeof User }[] = [
  { key: "owner", label: "О вас", icon: User },
  { key: "workspace", label: "Портал", icon: Building2 },
  { key: "business", label: "Бизнес", icon: Briefcase },
  { key: "finish", label: "Готово", icon: PartyPopper },
];

const STEP_INDEX: Record<OnboardingStep, number> = {
  owner: 0,
  workspace: 1,
  business: 2,
  finish: 3,
};

export function OnboardingWizard() {
  const [currentStep, setCurrentStep] = useState<OnboardingStep>("owner");
  const [isSaving, setIsSaving] = useState(false);
  const [completedSteps, setCompletedSteps] = useState<Set<OnboardingStep>>(
    new Set(),
  );
  const [onboardingState, setOnboardingState] = useState<OnboardingState>({
    step: "owner",
    owner: { first_name: "", last_name: "" },
    workspace: { company_name: "", slug: "", currency: "RUB", timezone: "" },
    business: { domain: "service_center" },
    installedModules: [],
  });

  const ownerForm = useForm<OwnerFormValues>({
    resolver: zodResolver(ownerSchema),
    defaultValues: onboardingState.owner,
    mode: "onChange",
  });

  const workspaceForm = useForm<WorkspaceFormValues>({
    resolver: zodResolver(workspaceSchema),
    defaultValues: onboardingState.workspace,
    mode: "onChange",
  });

  const businessForm = useForm<BusinessDomainValues>({
    resolver: zodResolver(businessDomainSchema),
    defaultValues: onboardingState.business,
    mode: "onChange",
  });

  const autoSlug = useCallback(
    (companyName: string) => {
      const slug = companyName
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
      workspaceForm.setValue("slug", slug, { shouldValidate: true });
    },
    [workspaceForm],
  );

  const handleNextOwner = useCallback(
    (values: OwnerFormValues) => {
      setOnboardingState((prev) => ({ ...prev, owner: values }));
      setCompletedSteps((prev) => new Set(prev).add("owner"));
      setCurrentStep("workspace");
    },
    [],
  );

  const handleNextWorkspace = useCallback(
    (values: WorkspaceFormValues) => {
      setOnboardingState((prev) => ({ ...prev, workspace: values }));
      setCompletedSteps((prev) => new Set(prev).add("workspace"));
      setCurrentStep("business");
    },
    [],
  );

  const handleNextBusiness = useCallback(
    (values: BusinessDomainValues) => {
      const domainConfig = BUSINESS_DOMAIN_MODULES[values.domain];
      setOnboardingState((prev) => ({
        ...prev,
        business: values,
        installedModules: domainConfig.modules,
      }));
      setCompletedSteps((prev) => new Set(prev).add("business"));
      setCurrentStep("finish");
    },
    [],
  );

  const handleFinish = useCallback(async () => {
    setIsSaving(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const finalState: OnboardingState = {
        ...onboardingState,
        step: "finish",
      };
      localStorage.setItem("getvoxly_onboarding", JSON.stringify(finalState));
      window.location.href = "/dashboard";
    } finally {
      setIsSaving(false);
    }
  }, [onboardingState]);

  const goToStep = useCallback(
    (step: OnboardingStep) => {
      const targetIndex = STEP_INDEX[step];
      const currentIndex = STEP_INDEX[currentStep];
      if (targetIndex > currentIndex && !completedSteps.has(currentStep)) {
        return;
      }
      setCurrentStep(step);
    },
    [currentStep, completedSteps],
  );

  const handleBack = useCallback(() => {
    const currentIndex = STEP_INDEX[currentStep];
    if (currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1].key);
    }
  }, [currentStep]);

  const currentStepIndex = STEP_INDEX[currentStep];
  const progressPercent = ((currentStepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="w-full max-w-xl mx-auto space-y-8">
      {/* Progress Bar */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          {STEPS.map((step, idx) => {
            const isActive = step.key === currentStep;
            const isCompleted = completedSteps.has(step.key);
            const isClickable =
              completedSteps.has(step.key) || idx <= currentStepIndex;

            return (
              <div key={step.key} className="flex items-center">
                <button
                  type="button"
                  onClick={() => goToStep(step.key)}
                  disabled={!isClickable}
                  className={cn(
                    "flex flex-col items-center gap-1.5 transition-colors",
                    isClickable ? "cursor-pointer" : "cursor-not-allowed",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full border transition-colors",
                      isCompleted &&
                        "border-emerald-300 bg-emerald-50 text-emerald-700",
                      isActive &&
                        !isCompleted &&
                        "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]",
                      !isActive &&
                        !isCompleted &&
                        "border-[#e5e5e5] bg-white text-[#888888]",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <step.icon className="h-4 w-4" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium transition-colors",
                      isActive && "text-[#4a38f5]",
                      isCompleted && "text-[#111111]",
                      !isActive && !isCompleted && "text-[#888888]",
                    )}
                  >
                    {step.label}
                  </span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn("mx-2 mb-5 h-0.5 flex-1", "bg-[#e5e5e5]")}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="h-1 w-full rounded-full bg-[#f0f0f0]">
          <div
            className="h-1 rounded-full bg-[#4a38f5] transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-2xs">
        {/* Step 1 — Owner */}
        {currentStep === "owner" && (
          <form
            onSubmit={ownerForm.handleSubmit(handleNextOwner)}
            className="space-y-5"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[#111111]">
                Добро пожаловать! Расскажите о себе
              </h2>
              <p className="text-xs text-[#666666]">
                Профиль владельца рабочего пространства.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="first_name"
                className="block text-xs font-medium text-[#111111]"
              >
                Имя
              </label>
              <input
                id="first_name"
                type="text"
                autoFocus
                placeholder="Иван"
                value={ownerForm.watch("first_name")}
                onChange={(e) =>
                  ownerForm.setValue("first_name", e.target.value, {
                    shouldValidate: true,
                  })
                }
                className={cn(
                  "w-full rounded-[8px] border bg-white py-2.5 px-3.5 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  ownerForm.formState.errors.first_name
                    ? "border-rose-300"
                    : "border-[#e5e5e5]",
                )}
              />
              {ownerForm.formState.errors.first_name && (
                <p className="text-xs text-rose-600">
                  {ownerForm.formState.errors.first_name.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="last_name"
                className="block text-xs font-medium text-[#111111]"
              >
                Фамилия
              </label>
              <input
                id="last_name"
                type="text"
                placeholder="Петров"
                value={ownerForm.watch("last_name")}
                onChange={(e) =>
                  ownerForm.setValue("last_name", e.target.value, {
                    shouldValidate: true,
                  })
                }
                className={cn(
                  "w-full rounded-[8px] border bg-white py-2.5 px-3.5 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                  "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                  ownerForm.formState.errors.last_name
                    ? "border-rose-300"
                    : "border-[#e5e5e5]",
                )}
              />
              {ownerForm.formState.errors.last_name && (
                <p className="text-xs text-rose-600">
                  {ownerForm.formState.errors.last_name.message}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={!ownerForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[13px] font-medium transition-colors shadow-2xs",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Далее
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 2 — Workspace */}
        {currentStep === "workspace" && (
          <form
            onSubmit={workspaceForm.handleSubmit(handleNextWorkspace)}
            className="space-y-5"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-[#111111]">
                Создание рабочего пространства
              </h2>
              <p className="text-xs text-[#666666]">
                Персональный портал вашей компании и команды.
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="company_name"
                className="block text-xs font-medium text-[#111111]"
              >
                Название компании
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
                <input
                  id="company_name"
                  type="text"
                  autoFocus
                  placeholder="ООО «Ромашка»"
                  value={workspaceForm.watch("company_name")}
                  onChange={(e) => {
                    workspaceForm.setValue(
                      "company_name",
                      e.target.value,
                      { shouldValidate: true },
                    );
                    autoSlug(e.target.value);
                  }}
                  className={cn(
                    "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    workspaceForm.formState.errors.company_name
                      ? "border-rose-300"
                      : "border-[#e5e5e5]",
                  )}
                />
              </div>
              {workspaceForm.formState.errors.company_name && (
                <p className="text-xs text-rose-600">
                  {workspaceForm.formState.errors.company_name.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="slug"
                className="block text-xs font-medium text-[#111111]"
              >
                Адрес портала
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
                <input
                  id="slug"
                  type="text"
                  placeholder="acme-corp"
                  value={workspaceForm.watch("slug")}
                  onChange={(e) =>
                    workspaceForm.setValue("slug", e.target.value, {
                      shouldValidate: true,
                    })
                  }
                  className={cn(
                    "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-24 text-[13px] text-[#111111] placeholder:text-[#888888] font-mono tabular-nums transition-colors",
                    "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                    workspaceForm.formState.errors.slug
                      ? "border-rose-300"
                      : "border-[#e5e5e5]",
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#888888]">
                  .getvoxly.ru
                </span>
              </div>
              {workspaceForm.formState.errors.slug && (
                <p className="text-xs text-rose-600">
                  {workspaceForm.formState.errors.slug.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="currency"
                  className="block text-xs font-medium text-[#111111]"
                >
                  Валюта
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
                  <select
                    id="currency"
                    value={workspaceForm.watch("currency")}
                    onChange={(e) =>
                      workspaceForm.setValue(
                        "currency",
                        e.target.value as WorkspaceFormValues["currency"],
                        { shouldValidate: true },
                      )
                    }
                    className={cn(
                      "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] transition-colors appearance-none",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      workspaceForm.formState.errors.currency
                        ? "border-rose-300"
                        : "border-[#e5e5e5]",
                    )}
                  >
                    {CURRENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                {workspaceForm.formState.errors.currency && (
                  <p className="text-xs text-rose-600">
                    {workspaceForm.formState.errors.currency.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="timezone"
                  className="block text-xs font-medium text-[#111111]"
                >
                  Часовой пояс
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#888888]" />
                  <select
                    id="timezone"
                    value={workspaceForm.watch("timezone")}
                    onChange={(e) =>
                      workspaceForm.setValue("timezone", e.target.value, {
                        shouldValidate: true,
                      })
                    }
                    className={cn(
                      "w-full rounded-[8px] border bg-white py-2.5 pl-10 pr-4 text-[13px] text-[#111111] transition-colors appearance-none",
                      "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                      workspaceForm.formState.errors.timezone
                        ? "border-rose-300"
                        : "border-[#e5e5e5]",
                    )}
                  >
                    <option value="" disabled>
                      Выберите часовой пояс...
                    </option>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                {workspaceForm.formState.errors.timezone && (
                  <p className="text-xs text-rose-600">
                    {workspaceForm.formState.errors.timezone.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <button
                type="submit"
                disabled={!workspaceForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[13px] font-medium transition-colors shadow-2xs",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Далее
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 3 — Business Domain */}
        {currentStep === "business" && (
          <form
            onSubmit={businessForm.handleSubmit(handleNextBusiness)}
            className="space-y-6"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">
                What describes your business?
              </h2>
              <p className="text-sm text-slate-400">
                We&apos;ll pre-configure the right modules for you. You can
                always adjust later.
              </p>
            </div>

            <div className="grid gap-3">
              {(
                Object.entries(BUSINESS_DOMAIN_MODULES) as [
                  string,
                  { name: string; modules: string[] },
                ][]
              ).map(([value, config]) => {
                const isSelected = businessForm.watch("domain") === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      businessForm.setValue(
                        "domain",
                        value as "service_center" | "retail" | "services",
                        { shouldValidate: true },
                      )
                    }
                    className={cn(
                      "flex items-start gap-4 rounded-[8px] border p-4 text-left transition-colors",
                      isSelected
                        ? "border-[#4a38f5] bg-[#4a38f5]/5"
                        : "border-[#e5e5e5] bg-white hover:bg-[#fafafa]",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                        isSelected
                          ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                          : "border-[#cccccc]",
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3" />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <span
                        className={cn(
                          "text-[13px] font-semibold transition-colors",
                          isSelected ? "text-[#4a38f5]" : "text-[#111111]",
                        )}
                      >
                        {config.name}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {config.modules.map((mod) => (
                          <span
                            key={mod}
                            className={cn(
                              "rounded-[4px] px-2 py-0.5 text-xs font-medium border",
                              isSelected
                                ? "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/20"
                                : "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5]",
                            )}
                          >
                            {mod === "service_center"
                              ? "Сервисный центр"
                              : mod === "finance"
                                ? "Финансы"
                                : mod === "ai_bots"
                                  ? "AI Боты"
                                  : mod}
                          </span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            {businessForm.formState.errors.domain && (
              <p className="text-xs text-rose-600">
                {businessForm.formState.errors.domain.message}
              </p>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <button
                type="submit"
                disabled={!businessForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[13px] font-medium transition-colors shadow-2xs",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Далее
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 4 — Finish */}
        {currentStep === "finish" && (
          <div className="space-y-6">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 border border-emerald-200">
                <PartyPopper className="h-7 w-7 text-emerald-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#111111]">
                  Всё готово к работе!
                </h2>
                <p className="text-xs text-[#666666] mt-1">
                  Проверьте параметры и перейдите в рабочее пространство.
                </p>
              </div>
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] divide-y divide-[#e5e5e5]">
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">Владелец</span>
                <span className="font-medium text-[#111111]">
                  {onboardingState.owner.first_name}{" "}
                  {onboardingState.owner.last_name}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">Компания</span>
                <span className="font-medium text-[#111111]">
                  {onboardingState.workspace.company_name}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">Адрес портала</span>
                <span className="font-mono tabular-nums font-medium text-[#111111]">
                  {onboardingState.workspace.slug}.getvoxly.ru
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">Часовой пояс</span>
                <span className="font-medium text-[#111111]">
                  {onboardingState.workspace.timezone}
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">Домен</span>
                <span className="font-medium text-[#111111]">
                  {
                    BUSINESS_DOMAIN_MODULES[onboardingState.business.domain]
                      .name
                  }
                </span>
              </div>
              <div className="flex justify-between px-4 py-2.5 text-[13px]">
                <span className="text-[#666666]">
                  Установленные модули
                </span>
                <div className="flex gap-1.5">
                  {onboardingState.installedModules.map((mod) => (
                    <span
                      key={mod}
                      className="rounded-[4px] bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-medium text-[#4a38f5] border border-[#4a38f5]/20"
                    >
                      {mod}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-[8px] px-4 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Назад
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={isSaving}
                className={cn(
                  "flex items-center gap-2 rounded-[8px] px-5 py-2.5 text-[13px] font-medium transition-colors shadow-2xs",
                  "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Настраиваем...
                  </>
                ) : (
                  <>
                    Начать работу в GETVOXLY
                    <ChevronRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}