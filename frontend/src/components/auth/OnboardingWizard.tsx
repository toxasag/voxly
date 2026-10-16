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
                      "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                      isCompleted &&
                        "border-emerald-500 bg-emerald-500 text-slate-950",
                      isActive &&
                        !isCompleted &&
                        "border-amber-500 bg-amber-500/10 text-amber-400",
                      !isActive &&
                        !isCompleted &&
                        "border-slate-700 bg-slate-900 text-slate-600",
                    )}
                  >
                    {isCompleted ? (
                      <Check className="h-5 w-5" />
                    ) : (
                      <step.icon className="h-5 w-5" />
                    )}
                  </div>
                  <span
                    className={cn(
                      "text-xs font-medium transition-colors",
                      isActive && "text-amber-400",
                      isCompleted && "text-slate-300",
                      !isActive && !isCompleted && "text-slate-600",
                    )}
                  >
                    {step.label}
                  </span>
                </button>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn("mx-2 mb-5 h-0.5 flex-1", "bg-slate-800")}
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="h-1 w-full rounded-full bg-slate-800">
          <div
            className="h-1 rounded-full bg-amber-500 transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Step Content */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-8">
        {/* Step 1 — Owner */}
        {currentStep === "owner" && (
          <form
            onSubmit={ownerForm.handleSubmit(handleNextOwner)}
            className="space-y-6"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">
                Welcome! Tell us about yourself
              </h2>
              <p className="text-sm text-slate-400">
                This is the account owner profile.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="first_name"
                className="block text-sm font-medium text-slate-300"
              >
                First Name
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
                  "w-full rounded-lg border bg-slate-900 py-3 px-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  ownerForm.formState.errors.first_name
                    ? "border-rose-500"
                    : "border-slate-700",
                )}
              />
              {ownerForm.formState.errors.first_name && (
                <p className="text-xs text-rose-400">
                  {ownerForm.formState.errors.first_name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="last_name"
                className="block text-sm font-medium text-slate-300"
              >
                Last Name
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
                  "w-full rounded-lg border bg-slate-900 py-3 px-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  ownerForm.formState.errors.last_name
                    ? "border-rose-500"
                    : "border-slate-700",
                )}
              />
              {ownerForm.formState.errors.last_name && (
                <p className="text-xs text-rose-400">
                  {ownerForm.formState.errors.last_name.message}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={!ownerForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                  "bg-amber-500 text-slate-950 hover:bg-amber-400",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 2 — Workspace */}
        {currentStep === "workspace" && (
          <form
            onSubmit={workspaceForm.handleSubmit(handleNextWorkspace)}
            className="space-y-6"
          >
            <div className="space-y-1">
              <h2 className="text-lg font-semibold text-slate-100">
                Create your workspace
              </h2>
              <p className="text-sm text-slate-400">
                This will be your team&apos;s dedicated space.
              </p>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="company_name"
                className="block text-sm font-medium text-slate-300"
              >
                Company Name
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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
                    "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-4 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    workspaceForm.formState.errors.company_name
                      ? "border-rose-500"
                      : "border-slate-700",
                  )}
                />
              </div>
              {workspaceForm.formState.errors.company_name && (
                <p className="text-xs text-rose-400">
                  {workspaceForm.formState.errors.company_name.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label
                htmlFor="slug"
                className="block text-sm font-medium text-slate-300"
              >
                Workspace URL
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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
                    "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-24 text-sm text-slate-100 placeholder:text-slate-500 transition-colors",
                    "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                    workspaceForm.formState.errors.slug
                      ? "border-rose-500"
                      : "border-slate-700",
                  )}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                  .getvoxly.ru
                </span>
              </div>
              {workspaceForm.formState.errors.slug && (
                <p className="text-xs text-rose-400">
                  {workspaceForm.formState.errors.slug.message}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label
                  htmlFor="currency"
                  className="block text-sm font-medium text-slate-300"
                >
                  Currency
                </label>
                <div className="relative">
                  <Coins className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
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
                      "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-4 text-sm text-slate-100 transition-colors appearance-none",
                      "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                      workspaceForm.formState.errors.currency
                        ? "border-rose-500"
                        : "border-slate-700",
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
                  <p className="text-xs text-rose-400">
                    {workspaceForm.formState.errors.currency.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  htmlFor="timezone"
                  className="block text-sm font-medium text-slate-300"
                >
                  Timezone
                </label>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                  <select
                    id="timezone"
                    value={workspaceForm.watch("timezone")}
                    onChange={(e) =>
                      workspaceForm.setValue("timezone", e.target.value, {
                        shouldValidate: true,
                      })
                    }
                    className={cn(
                      "w-full rounded-lg border bg-slate-900 py-3 pl-10 pr-4 text-sm text-slate-100 transition-colors appearance-none",
                      "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                      workspaceForm.formState.errors.timezone
                        ? "border-rose-500"
                        : "border-slate-700",
                    )}
                  >
                    <option value="" disabled>
                      Select timezone...
                    </option>
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </select>
                </div>
                {workspaceForm.formState.errors.timezone && (
                  <p className="text-xs text-rose-400">
                    {workspaceForm.formState.errors.timezone.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={!workspaceForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                  "bg-amber-500 text-slate-950 hover:bg-amber-400",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Next
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
                      "flex items-start gap-4 rounded-lg border p-4 text-left transition-colors",
                      isSelected
                        ? "border-amber-500 bg-amber-500/10"
                        : "border-slate-700 bg-slate-900 hover:border-slate-600",
                    )}
                  >
                    <div
                      className={cn(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        isSelected
                          ? "border-amber-500 bg-amber-500"
                          : "border-slate-600",
                      )}
                    >
                      {isSelected && (
                        <Check className="h-3 w-3 text-slate-950" />
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <span
                        className={cn(
                          "text-sm font-semibold transition-colors",
                          isSelected ? "text-amber-400" : "text-slate-200",
                        )}
                      >
                        {config.name}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {config.modules.map((mod) => (
                          <span
                            key={mod}
                            className={cn(
                              "rounded-md px-2 py-0.5 text-xs font-medium",
                              isSelected
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-slate-800 text-slate-500",
                            )}
                          >
                            {mod === "service_center"
                              ? "Service Center"
                              : mod === "finance"
                                ? "Finance"
                                : mod === "ai_bots"
                                  ? "AI Bots"
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
              <p className="text-xs text-rose-400">
                {businessForm.formState.errors.domain.message}
              </p>
            )}

            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={handleBack}
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="submit"
                disabled={!businessForm.formState.isValid}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                  "bg-amber-500 text-slate-950 hover:bg-amber-400",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </form>
        )}

        {/* Step 4 — Finish */}
        {currentStep === "finish" && (
          <div className="space-y-6">
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 border border-emerald-500/30">
                <PartyPopper className="h-8 w-8 text-emerald-400" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  You&apos;re all set!
                </h2>
                <p className="text-sm text-slate-400 mt-1">
                  Review your setup below and jump into your workspace.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/50 divide-y divide-slate-800">
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">Владелец</span>
                <span className="text-sm font-medium text-slate-200">
                  {onboardingState.owner.first_name}{" "}
                  {onboardingState.owner.last_name}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">Компания</span>
                <span className="text-sm font-medium text-slate-200">
                  {onboardingState.workspace.company_name}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">Адрес портала</span>
                <span className="text-sm font-medium text-slate-200">
                  {onboardingState.workspace.slug}.getvoxly.ru
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">Часовой пояс</span>
                <span className="text-sm font-medium text-slate-200">
                  {onboardingState.workspace.timezone}
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">Домен</span>
                <span className="text-sm font-medium text-slate-200">
                  {
                    BUSINESS_DOMAIN_MODULES[onboardingState.business.domain]
                      .name
                  }
                </span>
              </div>
              <div className="flex justify-between px-4 py-3">
                <span className="text-sm text-slate-400">
                  Pre-installed modules
                </span>
                <div className="flex gap-1.5">
                  {onboardingState.installedModules.map((mod) => (
                    <span
                      key={mod}
                      className="rounded-md bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 border border-amber-500/20"
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
                className="flex items-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-medium text-slate-400 hover:text-slate-200 transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>
              <button
                type="button"
                onClick={handleFinish}
                disabled={isSaving}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-colors",
                  "bg-emerald-600 text-white hover:bg-emerald-500",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    Start Using GETVOXLY
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