"use client";

import { useState, useCallback, useId } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Building2,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Phone,
  RefreshCw,
  Send,
  Shield,
  ShieldAlert,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";
import {
  useCreatePartnerTenant,
  type CreatePartnerTenantResponse,
} from "@/lib/api/use-partner";
import { useAuth, type AuthTokensDTO } from "@/lib/auth/use-auth";
import { writeImpersonationBackup, type ImpersonationBackup } from "@/lib/auth/impersonation";
import { readAccessToken, readRefreshToken, writeTokens } from "@/lib/auth/session";
import { apiClient } from "@/lib/api/apiClient";
import { tenantPortalUrl } from "@/lib/auth/tenant-host";

const SLUG_REGEX = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

const formSchema = z.object({
  name: z.string().trim().min(2, "Название компании должно быть не менее 2 символов").max(100),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Поддомен должен быть от 3 символов")
    .max(63, "Поддомен не более 63 символов")
    .regex(SLUG_REGEX, "Только строчные латинские буквы, цифры и дефисы"),
  admin_email: z.string().trim().toLowerCase().email("Введите корректный email"),
  admin_password: z.string().min(6, "Пароль не менее 6 символов"),
  admin_name: z.string().trim().optional(),
  admin_phone: z.string().trim().optional(),
  telegram_id: z.string().trim().optional(),
  plan: z.string().default("pro"),
  price_override: z.string().optional(),
  is_complimentary: z.boolean().default(false),
  require_telegram_auth: z.boolean().default(false),
});

type FormValues = z.infer<typeof formSchema>;

function transliterate(text: string): string {
  const ruToEn: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };

  return text
    .toLowerCase()
    .split("")
    .map((char) => ruToEn[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

function generateStrongPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#$%";
  let pass = "";
  for (let i = 0; i < 12; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

const PLAN_OPTIONS = [
  { id: "starter", title: "Стартовый (Starter)", price: 1900, desc: "До 5 сотрудников, базовые каналы" },
  { id: "pro", title: "Профессиональный (Pro)", price: 3900, desc: "Все модули, ИИ-боты, воронки" },
  { id: "enterprise", title: "Корпоративный", price: 7900, desc: "Безлимит, кастомные интеграции" },
];

interface CreateTenantDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateTenantDialog({ open, onClose }: CreateTenantDialogProps) {
  const { user } = useAuth();
  const titleId = useId();
  const [showPassword, setShowPassword] = useState(false);
  const [isEntering, setIsEntering] = useState(false);
  const [createdResult, setCreatedResult] = useState<{
    result: CreatePartnerTenantResponse;
    pass: string;
  } | null>(null);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const createMutation = useCreatePartnerTenant();

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      slug: "",
      admin_email: "",
      admin_password: "",
      admin_name: "Администратор",
      admin_phone: "",
      telegram_id: "",
      plan: "pro",
      price_override: "",
      is_complimentary: false,
      require_telegram_auth: false,
    },
  });

  const isSubmitting = createMutation.isPending;

  useOverlay(open, {
    onEscape: onClose,
    disabled: isSubmitting,
  });

  const copyToClipboard = async (text: string, key: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      toast.success(`${label} скопирован в буфер`);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      toast.error("Не удалось скопировать");
    }
  };

  const handleNameChange = (val: string) => {
    form.setValue("name", val);
    const currentSlug = form.getValues("slug");
    // Автоматически генерируем slug, если он еще пуст или совпадает с транслитом предыдущего
    if (!currentSlug || currentSlug === transliterate(form.getValues("name").slice(0, -1))) {
      const generated = transliterate(val);
      if (generated.length >= 3) {
        form.setValue("slug", generated, { shouldValidate: true });
      }
    }
  };

  const handleGeneratePassword = () => {
    const pass = generateStrongPassword();
    form.setValue("admin_password", pass, { shouldValidate: true });
    setShowPassword(true);
    toast.info("Сгенерирован надежный пароль");
  };

  const onSubmit = async (values: FormValues) => {
    try {
      const priceNum = values.is_complimentary
        ? 0
        : values.price_override && values.price_override.trim() !== ""
        ? parseFloat(values.price_override.replace(/\s/g, ""))
        : null;

      const res = await createMutation.mutateAsync({
        name: values.name.trim(),
        slug: values.slug.trim().toLowerCase(),
        admin_email: values.admin_email.trim().toLowerCase(),
        admin_password: values.admin_password,
        admin_name: values.admin_name?.trim() || "Администратор",
        admin_phone: values.admin_phone?.trim(),
        telegram_id: values.telegram_id?.trim() || undefined,
        plan: values.plan,
        price_override: priceNum,
        is_complimentary: values.is_complimentary,
        auth_settings: {
          require_telegram_auth: values.require_telegram_auth,
          allow_password_auth: true,
        },
      });

      setCreatedResult({
        result: res,
        pass: values.admin_password,
      });

      toast.success("Портал компании успешно создан!");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Не удалось создать компанию";
      toast.error(message);
    }
  };

  const handleClose = () => {
    if (isSubmitting) return;
    form.reset();
    setCreatedResult(null);
    onClose();
  };

  if (!open) return null;

  const isComplimentary = form.watch("is_complimentary");
  const requireTelegramAuth = form.watch("require_telegram_auth");
  const selectedPlan = form.watch("plan");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xl text-[#111111]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка диалога */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <h2 id={titleId} className="text-base font-semibold text-[#111111]">
                {createdResult ? "Портал успешно создан" : "Создание нового портала (компании)"}
              </h2>
              <p className="text-xs text-[#666666]">
                {createdResult
                  ? "Сохраните или отправьте данные доступа клиенту"
                  : "Партнерское развертывание изолированного рабочего пространства"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={isSubmitting}
            className="rounded-[6px] p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Содержимое: Экран успеха или Форма создания */}
        <div className="flex-1 overflow-y-auto p-6">
          {createdResult ? (
            <div className="space-y-5">
              <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/60 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <span>Компания {createdResult.result.tenant.name} готова к работе</span>
                </div>
                <p className="text-xs text-emerald-700 leading-relaxed">
                  Суперадмин портала зарегистрирован, воронки продаж и рабочее пространство
                  инициализированы. Вы можете сразу войти под его учетной записью.
                </p>
              </div>

              {/* Реквизиты доступа */}
              <div className="rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2">
                  <span className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                    Реквизиты для входа
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text = `Вход в CRM: https://${createdResult.result.tenant.slug}.getvoxly.ru/login\nЛогин: ${createdResult.result.admin.email}\nПароль: ${createdResult.pass}`;
                      void copyToClipboard(text, "all", "Все реквизиты");
                    }}
                    className="inline-flex items-center gap-1.5 text-xs text-[#4a38f5] hover:underline font-medium"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Скопировать всё</span>
                  </button>
                </div>

                <div className="space-y-2 text-[13px]">
                  <div className="flex items-center justify-between">
                    <span className="text-[#666666]">Адрес портала:</span>
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://${createdResult.result.tenant.slug}.getvoxly.ru/login`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[#4a38f5] hover:underline flex items-center gap-1"
                      >
                        https://{createdResult.result.tenant.slug}.getvoxly.ru
                        <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(
                            `https://${createdResult.result.tenant.slug}.getvoxly.ru/login`,
                            "url",
                            "Адрес",
                          )
                        }
                        className="text-[#888888] hover:text-[#111111]"
                      >
                        {copiedKey === "url" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#666666]">E-mail (логин):</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-[#111111]">
                        {createdResult.result.admin.email}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(
                            createdResult.result.admin.email,
                            "email",
                            "E-mail",
                          )
                        }
                        className="text-[#888888] hover:text-[#111111]"
                      >
                        {copiedKey === "email" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[#666666]">Пароль:</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-medium text-[#111111]">
                        {createdResult.pass}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          void copyToClipboard(createdResult.pass, "pass", "Пароль")
                        }
                        className="text-[#888888] hover:text-[#111111]"
                      >
                        {copiedKey === "pass" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[#666666]">Политика входа:</span>
                    <span className="font-medium text-[#111111]">
                      {createdResult.result.tenant.auth_settings.require_telegram_auth
                        ? "Обязательный Telegram 2FA"
                        : "Логин и пароль (без бота)"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors"
                >
                  Закрыть
                </button>
                <button
                  type="button"
                  disabled={isEntering}
                  onClick={async () => {
                    try {
                      setIsEntering(true);
                      const currentAccessToken = readAccessToken();
                      const currentRefreshToken = readRefreshToken();
                      const child = createdResult.result.tenant;
                      let backupData: ImpersonationBackup | null = null;
                      if (currentAccessToken) {
                        backupData = {
                          accessToken: currentAccessToken,
                          refreshToken: currentRefreshToken || currentAccessToken,
                          adminUserEmail: user?.email ?? "",
                          adminUserName: user?.name ?? "",
                          adminOriginHost: typeof window !== "undefined" ? window.location.host : "",
                          adminOriginPath: "/partner",
                          isPartner: true,
                          isPlatformOwner: user?.platform_role === "platform_owner",
                          impersonatedTenantSlug: child.slug,
                          impersonatedTenantName: child.name,
                          impersonatedUserEmail: createdResult.result.admin.email,
                          enteredAt: new Date().toISOString(),
                        };
                        writeImpersonationBackup(backupData);
                      }
                      const res = await apiClient.post<AuthTokensDTO>("/api/v1/auth/impersonate", {
                        slug: child.slug,
                      });
                      if (res.data) {
                        const { access_token, refresh_token } = res.data;
                        if (access_token && refresh_token) {
                          writeTokens({ accessToken: access_token, refreshToken: refresh_token });
                        }
                        const targetUrl = tenantPortalUrl(child.slug, "/dashboard");
                        const hashParams = new URLSearchParams();
                        if (access_token) hashParams.set("tenant_token", access_token);
                        if (backupData) hashParams.set("impersonator_backup", JSON.stringify(backupData));

                        window.location.href =
                          targetUrl.includes("://")
                            ? `${targetUrl}#${hashParams.toString()}`
                            : targetUrl;
                      }
                    } catch (err) {
                      console.error("Ошибка входа в созданный портал:", err);
                      toast.error("Не удалось войти в созданный портал");
                      setIsEntering(false);
                    }
                  }}
                  className="inline-flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white hover:bg-[#3d2ee0] transition-colors shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4" />
                  <span>{isEntering ? "Вход..." : "Войти в созданный портал"}</span>
                </button>
                <a
                  href={`https://${createdResult.result.tenant.slug}.getvoxly.ru/login`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2 text-[13px] font-medium text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors"
                >
                  <span>Ссылка на вход</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>
          ) : (
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              {/* СЕКЦИЯ 1: Данные компании */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#666666] border-b border-[#f0f0f0] pb-1.5">
                  <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Компания и поддомен</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1">
                      Название компании / портала <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="Например: МедТех Лаб или Клиника Альфа"
                      value={form.watch("name")}
                      onChange={(e) => handleNameChange(e.target.value)}
                      className={cn(
                        "w-full rounded-[8px] border bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                        "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                        form.formState.errors.name ? "border-rose-400" : "border-[#e5e5e5]",
                      )}
                    />
                    {form.formState.errors.name && (
                      <p className="mt-1 text-xs text-rose-600">
                        {form.formState.errors.name.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1">
                      Поддомен портала (URL) <span className="text-rose-500">*</span>
                    </label>
                    <div className="flex items-center">
                      <input
                        type="text"
                        placeholder="medtech"
                        {...form.register("slug")}
                        className={cn(
                          "flex-1 rounded-l-[8px] border bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] font-mono transition-colors",
                          "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                          form.formState.errors.slug ? "border-rose-400" : "border-[#e5e5e5]",
                        )}
                      />
                      <span className="rounded-r-[8px] border border-l-0 border-[#e5e5e5] bg-[#fafafa] px-3 py-2 text-xs font-mono text-[#666666]">
                        .getvoxly.ru
                      </span>
                    </div>
                    {form.formState.errors.slug && (
                      <p className="mt-1 text-xs text-rose-600">
                        {form.formState.errors.slug.message}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* СЕКЦИЯ 2: Суперадмин создаваемого портала */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#666666] border-b border-[#f0f0f0] pb-1.5">
                  <User className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Учетные данные суперадмина</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1">
                      Email (логин) <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
                      <input
                        type="email"
                        placeholder="admin@company.ru"
                        {...form.register("admin_email")}
                        className={cn(
                          "w-full rounded-[8px] border bg-white py-2 pl-9 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] transition-colors",
                          "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                          form.formState.errors.admin_email ? "border-rose-400" : "border-[#e5e5e5]",
                        )}
                      />
                    </div>
                    {form.formState.errors.admin_email && (
                      <p className="mt-1 text-xs text-rose-600">
                        {form.formState.errors.admin_email.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-medium text-[#111111]">
                        Пароль <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleGeneratePassword}
                        className="text-[11px] text-[#4a38f5] hover:underline flex items-center gap-1"
                      >
                        <RefreshCw className="h-3 w-3" />
                        <span>Сгенерировать</span>
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
                      <input
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••••••"
                        {...form.register("admin_password")}
                        className={cn(
                          "w-full rounded-[8px] border bg-white py-2 pl-9 pr-9 text-[13px] text-[#111111] font-mono placeholder:text-[#888888] transition-colors",
                          "focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20",
                          form.formState.errors.admin_password ? "border-rose-400" : "border-[#e5e5e5]",
                        )}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#111111]"
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                    {form.formState.errors.admin_password && (
                      <p className="mt-1 text-xs text-rose-600">
                        {form.formState.errors.admin_password.message}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1">
                      Имя администратора
                    </label>
                    <input
                      type="text"
                      placeholder="Иван Петров"
                      {...form.register("admin_name")}
                      className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1">
                      Telegram ID / Chat ID (опционально)
                    </label>
                    <div className="relative">
                      <Send className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
                      <input
                        type="text"
                        placeholder="123456789"
                        {...form.register("telegram_id")}
                        className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-9 pr-3 text-[13px] text-[#111111] font-mono placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* СЕКЦИЯ 3: Партнерское ценообразование */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#666666] border-b border-[#f0f0f0] pb-1.5">
                  <KeyRound className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Тарифные условия и прайсинг</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[#111111] mb-1.5">
                      Тарифный план
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {PLAN_OPTIONS.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => form.setValue("plan", plan.id)}
                          className={cn(
                            "rounded-[8px] border p-2.5 text-left transition-all",
                            selectedPlan === plan.id
                              ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111] shadow-2xs"
                              : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc]",
                          )}
                        >
                          <div className="font-semibold text-xs text-[#111111]">{plan.title}</div>
                          <div className="text-[11px] font-mono text-[#4a38f5] mt-0.5">
                            {plan.price.toLocaleString("ru-RU")} ₽/мес
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3">
                    <div className="space-y-0.5">
                      <label
                        htmlFor="free_access_checkbox"
                        className="text-xs font-medium text-[#111111] cursor-pointer"
                      >
                        Бесплатный доступ (0 ₽ / мес)
                      </label>
                      <p className="text-[11px] text-[#666666]">
                        Партнерский или тестовый аккаунт без выставления ежемесячных счетов
                      </p>
                    </div>
                    <input
                      id="free_access_checkbox"
                      type="checkbox"
                      checked={isComplimentary}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        form.setValue("is_complimentary", checked);
                        if (checked) {
                          form.setValue("price_override", "0");
                        } else {
                          form.setValue("price_override", "");
                        }
                      }}
                      className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                  </div>

                  {!isComplimentary && (
                    <div>
                      <label className="block text-xs font-medium text-[#111111] mb-1">
                        Кастомная партнерская цена (₽ в месяц)
                      </label>
                      <input
                        type="number"
                        placeholder="Оставьте пустым для базовой цены тарифа"
                        {...form.register("price_override")}
                        className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-[13px] text-[#111111] font-mono placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* СЕКЦИЯ 4: Политика аутентификации */}
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#666666] border-b border-[#f0f0f0] pb-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-[#4a38f5]" />
                  <span>Политика аутентификации портала</span>
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
                      onClick={() => form.setValue("require_telegram_auth", !requireTelegramAuth)}
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

              {/* Кнопки действий */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#f0f0f0]">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={isSubmitting}
                  className="rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#111111] hover:bg-[#fafafa] transition-colors disabled:opacity-50"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-[8px] bg-[#4a38f5] px-4 py-2 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                >
                  {isSubmitting ? "Создание портала..." : "Создать компанию"}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
