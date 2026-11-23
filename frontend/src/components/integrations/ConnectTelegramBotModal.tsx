"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Key,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Zap,
} from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import type { ChannelAccountDTO } from "@/lib/api/use-channels";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import {
  useAutoActivatePendingBot,
  useAutoCreateTelegramBot,
  useCompleteManagedTelegramBot,
  useConnectTelegramBot,
  useCreateManagedTelegramBot,
  useTelegramBotManagerInfo,
  useVerifyTelegramBotToken,
  type TelegramBotInfoDTO,
} from "@/lib/api/use-telegram-bot";
import {
  botAutoCreateSchema,
  completeManagedTelegramBotSchema,
  connectTelegramBotSchema,
  createManagedTelegramBotSchema,
  type BotAutoCreateValues,
  type CompleteManagedTelegramBotValues,
  type ConnectTelegramBotValues,
  type CreateManagedTelegramBotValues,
} from "@/schemas/channel.schema";
import { cn } from "@/lib/utils";
import { Sheet, SheetHeader } from "@/components/ui/sheet";

interface ConnectTelegramBotModalProps {
  open: boolean;
  onClose: () => void;
  initialAccount?: ChannelAccountDTO | null;
}

type TabMode = "auto" | "existing" | "managed" | "complete";

export function ConnectTelegramBotModal({
  open,
  onClose,
  initialAccount,
}: ConnectTelegramBotModalProps) {
  const isPendingAccount = initialAccount?.status === "pending";
  const [tab, setTab] = useState<TabMode>(isPendingAccount ? "complete" : "auto");
  const [verifiedBot, setVerifiedBot] = useState<TelegramBotInfoDTO | null>(null);
  const [managedDeepLink, setManagedDeepLink] = useState<string | null>(null);

  const { data: agents = [] } = useAiAgents();
  const { data: managerInfo } = useTelegramBotManagerInfo();

  const autoCreateBot = useAutoCreateTelegramBot();
  const autoActivateBot = useAutoActivatePendingBot();
  const verifyToken = useVerifyTelegramBotToken();
  const connectBot = useConnectTelegramBot();
  const createManaged = useCreateManagedTelegramBot();
  const completeManaged = useCompleteManagedTelegramBot();

  // Форма мгновенного автоматического создания
  const autoForm = useForm<BotAutoCreateValues>({
    resolver: zodResolver(botAutoCreateSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      desired_username: "",
      agent_id: null,
    },
  });

  // Форма подключения существующего бота
  const existingForm = useForm<ConnectTelegramBotValues>({
    resolver: zodResolver(connectTelegramBotSchema),
    mode: "onChange",
    defaultValues: {
      label: initialAccount?.label ?? "",
      token: "",
      agent_id: initialAccount?.boundAgentId ?? null,
    },
  });

  // Форма создания управляемого бота через Bot Manager
  const managedForm = useForm<CreateManagedTelegramBotValues>({
    resolver: zodResolver(createManagedTelegramBotSchema),
    mode: "onChange",
    defaultValues: {
      name: "",
      username: "",
      token: "",
      agent_id: null,
    },
  });

  // Форма завершения pending-бота
  const completeForm = useForm<CompleteManagedTelegramBotValues>({
    resolver: zodResolver(completeManagedTelegramBotSchema),
    mode: "onChange",
    defaultValues: {
      token: "",
    },
  });

  useEffect(() => {
    if (open) {
      if (initialAccount?.status === "pending") {
        setTab("complete");
      } else {
        setTab("auto");
      }
      setVerifiedBot(null);
      setManagedDeepLink(null);
      autoForm.reset({
        name: "",
        desired_username: "",
        agent_id: null,
      });
      existingForm.reset({
        label: initialAccount?.label ?? "",
        token: "",
        agent_id: initialAccount?.boundAgentId ?? null,
      });
      managedForm.reset({
        name: "",
        username: "",
        token: "",
        agent_id: null,
      });
      completeForm.reset({ token: "" });
    }
  }, [open, initialAccount, autoForm, existingForm, managedForm, completeForm]);

  // Автоматическое создание бота в 1 клик (POST /api/bots/create)
  const onSubmitAuto = useCallback(
    async (values: BotAutoCreateValues) => {
      try {
        const result = await autoCreateBot.mutateAsync({
          name: values.name.trim(),
          desired_username: values.desired_username?.trim() || undefined,
          agent_id: values.agent_id || null,
        });
        toast.success(`Бот ${result.externalId} успешно зарегистрирован и подключен!`);
        onClose();
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.message : "Не удалось создать бота автоматически";
        toast.error(msg);
      }
    },
    [autoCreateBot, onClose],
  );

  // Мгновенная автоматическая активация зависшего pending-бота
  const handleAutoActivate = useCallback(async () => {
    if (!initialAccount?.id) return;
    try {
      const updated = await autoActivateBot.mutateAsync({
        accountId: initialAccount.id,
        name: initialAccount.label,
      });
      toast.success(`Бот ${updated.externalId} успешно активирован и переведён в статус «В сети»!`);
      onClose();
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Не удалось активировать бота";
      toast.error(msg);
    }
  }, [initialAccount, autoActivateBot, onClose]);

  const handleVerifyExisting = useCallback(async () => {
    const token = existingForm.getValues("token");
    if (!token || token.trim().length < 10) {
      existingForm.setError("token", { message: "Введите токен для проверки" });
      return;
    }
    setVerifiedBot(null);
    try {
      const info = await verifyToken.mutateAsync({ token: token.trim() });
      setVerifiedBot(info);
      if (!existingForm.getValues("label")) {
        existingForm.setValue("label", info.firstName, { shouldValidate: true });
      }
      toast.success(`Бот @${info.username} успешно проверен!`);
    } catch (err) {
      const msg = err instanceof ApiClientError ? err.message : "Не удалось проверить токен бота";
      existingForm.setError("token", { message: msg });
      toast.error(msg);
    }
  }, [existingForm, verifyToken]);

  const onSubmitExisting = useCallback(
    async (values: ConnectTelegramBotValues) => {
      try {
        await connectBot.mutateAsync({
          label: values.label.trim(),
          token: values.token.trim(),
          agent_id: values.agent_id || null,
        });
        toast.success("Telegram-бот успешно подключен!");
        onClose();
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.message : "Не удалось подключить Telegram-бота";
        toast.error(msg);
      }
    },
    [connectBot, onClose],
  );

  const onSubmitManaged = useCallback(
    async (values: CreateManagedTelegramBotValues) => {
      try {
        const cleanUsername = values.username.replace(/^@/, "").trim();
        const result = await createManaged.mutateAsync({
          name: values.name.trim(),
          username: cleanUsername,
          token: values.token?.trim() || undefined,
          agent_id: values.agent_id || null,
        });

        if (result.isPending) {
          setManagedDeepLink(result.deepLink);
          toast.success("Бот создан в системе! Перейдите в Telegram для подтверждения.");
        } else {
          toast.success("Бот успешно создан и активирован!");
          onClose();
        }
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.message : "Не удалось создать управляемого бота";
        toast.error(msg);
      }
    },
    [createManaged, onClose],
  );

  const onSubmitComplete = useCallback(
    async (values: CompleteManagedTelegramBotValues) => {
      if (!initialAccount?.id) return;
      try {
        await completeManaged.mutateAsync({
          accountId: initialAccount.id,
          values: { token: values.token.trim() },
        });
        toast.success("Бот успешно активирован!");
        onClose();
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.message : "Не удалось завершить настройку бота";
        toast.error(msg);
      }
    },
    [initialAccount?.id, completeManaged, onClose],
  );

  return (
    <Sheet open={open} onClose={onClose} width="w-[540px]" resizable>
      <div className="flex flex-col h-full bg-white">
        {/* Заголовок шторки */}
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <Bot className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">
                {initialAccount ? `Настройка: ${initialAccount.label}` : "Подключение Telegram-бота"}
              </h2>
              <p className="text-[11px] text-[#666666]">
                {isPendingAccount
                  ? "Завершение привязки токена"
                  : tab === "auto"
                    ? "Автоматическая регистрация (voxlyN_bot)"
                    : tab === "managed"
                      ? "Telegram Managed Bots (Bot API 8.0)"
                      : "Официальный Bot API (@BotFather)"}
              </p>
            </div>
          </div>
        </SheetHeader>

        {/* Тело формы */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Переключатель режимов */}
          {!isPendingAccount && (
            <div className="flex rounded-lg border border-[#e5e5e5] bg-[#fbfbfb] p-1 gap-1">
              <button
                type="button"
                onClick={() => setTab("auto")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  tab === "auto"
                    ? "bg-[#4a38f5] text-white shadow-2xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#eaeaea]",
                )}
              >
                <Zap className="h-3.5 w-3.5 text-amber-300" />
                Авто-бот (1 клик)
              </button>
              <button
                type="button"
                onClick={() => setTab("existing")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  tab === "existing"
                    ? "bg-[#4a38f5] text-white shadow-2xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#eaeaea]",
                )}
              >
                <Key className="h-3.5 w-3.5" />
                Свой токен
              </button>
              <button
                type="button"
                onClick={() => setTab("managed")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  tab === "managed"
                    ? "bg-[#4a38f5] text-white shadow-2xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#eaeaea]",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Bot Manager
              </button>
            </div>
          )}

          {/* Режим 1: Автоматическая регистрация нового бота (1 клик) */}
          {tab === "auto" && !isPendingAccount && (
            <form onSubmit={autoForm.handleSubmit(onSubmitAuto)} className="space-y-5">
              <div className="rounded-xl border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-[#4a38f5] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-semibold text-[#111111]">
                        Мгновенная регистрация бота
                      </h3>
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                        Рекомендуется
                      </span>
                    </div>
                    <p className="text-[12px] text-[#666666] leading-relaxed">
                      Введите желаемое имя бота (например <code className="text-[#111111] font-mono">freelancehuntervoxly_bot</code>).
                      Система автоматически подберет свободное уникальное имя вида <code className="text-[#4a38f5] font-semibold font-mono">voxlyN_bot</code> (N = 1…10),
                      сгенерирует токен и сразу активирует бота со статусом «В сети».
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-[#111111]">
                  Желаемое имя или username бота <span className="text-red-500">*</span>
                </label>
                <input
                  {...autoForm.register("name")}
                  placeholder="freelancehuntervoxly_bot или Консультант компании"
                  className={cn(
                    "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                    autoForm.formState.errors.name
                      ? "border-red-400 focus:border-red-500"
                      : "border-[#e5e5e5] focus:border-[#4a38f5]",
                  )}
                />
                {autoForm.formState.errors.name ? (
                  <p className="text-[11px] text-red-600">{autoForm.formState.errors.name.message}</p>
                ) : (
                  <p className="text-[11px] text-[#666666]">
                    Если имя занято, система автоматически зарегистрирует свободное имя <code className="text-[#111111] font-mono">voxly1_bot</code>...<code className="text-[#111111] font-mono">voxly10_bot</code>.
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-[#111111]">
                  Привязать AI-агента (автоответчик)
                </label>
                <select
                  {...autoForm.register("agent_id")}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] text-[#111111] transition-colors focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]"
                >
                  <option value="">Без автоответчика (только операторы CRM)</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.model})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#666666]">
                  AI-агент сразу возьмет на себя обработку входящих сообщений клиентов в Telegram.
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={autoCreateBot.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                >
                  {autoCreateBot.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Регистрация и запуск бота...
                    </>
                  ) : (
                    <>
                      <Zap className="h-4 w-4" />
                      Зарегистрировать и подключить бота
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Режим завершения pending-бота (решает проблему со скриншотов) */}
          {tab === "complete" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[13px] font-medium text-amber-900">
                      Статус: Требуется авторизация
                    </h3>
                    <p className="mt-1 text-[12px] text-amber-700 leading-relaxed">
                      Бот <span className="font-semibold text-amber-950 font-mono">{initialAccount?.externalId}</span> ожидает привязки токена.
                      Вы можете активировать его мгновенно в 1 клик или вставить токен вручную.
                    </p>
                  </div>
                </div>
              </div>

              {/* Мгновенная активация в 1 клик */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                <div className="flex items-center gap-2 text-emerald-950 text-[13px] font-medium">
                  <Zap className="h-4 w-4 text-emerald-600" />
                  Быстрая автоматическая активация
                </div>
                <p className="text-[11px] text-emerald-800 leading-relaxed">
                  Система сгенерирует токен доступа, свяжет его с аккаунтом и переведет статус бота в «В сети».
                </p>
                <button
                  type="button"
                  onClick={() => void handleAutoActivate()}
                  disabled={autoActivateBot.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {autoActivateBot.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Активация бота...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Активировать автоматически в 1 клик
                    </>
                  )}
                </button>
              </div>

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-[#e5e5e5]"></div>
                <span className="shrink mx-3 text-[11px] text-[#888888]">или укажите токен вручную</span>
                <div className="grow border-t border-[#e5e5e5]"></div>
              </div>

              <form onSubmit={completeForm.handleSubmit(onSubmitComplete)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#111111]">
                    Токен бота Telegram
                  </label>
                  <input
                    {...completeForm.register("token")}
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567"
                    className={cn(
                      "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                      completeForm.formState.errors.token
                        ? "border-red-400 focus:border-red-500"
                        : "border-[#e5e5e5] focus:border-[#4a38f5]",
                    )}
                  />
                  {completeForm.formState.errors.token && (
                    <p className="text-[11px] text-red-600">
                      {completeForm.formState.errors.token.message}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={completeManaged.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-[13px] font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa] disabled:opacity-50"
                >
                  {completeManaged.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Key className="h-4 w-4 text-[#666666]" />
                  )}
                  Применить токен
                </button>
              </form>
            </div>
          )}

          {/* Режим 2: Существующий токен @BotFather */}
          {tab === "existing" && (
            <form onSubmit={existingForm.handleSubmit(onSubmitExisting)} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-[#111111]">
                  Название подключения <span className="text-red-500">*</span>
                </label>
                <input
                  {...existingForm.register("label")}
                  placeholder="Например: Основной бот продаж"
                  className={cn(
                    "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                    existingForm.formState.errors.label
                      ? "border-red-400 focus:border-red-500"
                      : "border-[#e5e5e5] focus:border-[#4a38f5]",
                  )}
                />
                {existingForm.formState.errors.label && (
                  <p className="text-[11px] text-red-600">
                    {existingForm.formState.errors.label.message}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[13px] font-medium text-[#111111]">
                    Токен бота (@BotFather) <span className="text-red-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void handleVerifyExisting()}
                    disabled={verifyToken.isPending}
                    className="flex items-center gap-1.5 text-[12px] font-medium text-[#4a38f5] hover:text-[#3d2ee0] disabled:opacity-50"
                  >
                    {verifyToken.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    Проверить токен
                  </button>
                </div>
                <div className="relative">
                  <input
                    {...existingForm.register("token")}
                    type="password"
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567"
                    className={cn(
                      "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] font-mono text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                      existingForm.formState.errors.token
                        ? "border-red-400 focus:border-red-500"
                        : "border-[#e5e5e5] focus:border-[#4a38f5]",
                    )}
                  />
                </div>
                {existingForm.formState.errors.token && (
                  <p className="text-[11px] text-red-600">
                    {existingForm.formState.errors.token.message}
                  </p>
                )}
              </div>

              {/* Карточка успешно проверенного бота */}
              {verifiedBot && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3.5 flex items-start gap-3">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-[12px] space-y-0.5">
                    <p className="font-semibold text-emerald-950">
                      {verifiedBot.firstName}{" "}
                      <span className="font-normal text-emerald-700">(@{verifiedBot.username})</span>
                    </p>
                    <p className="text-emerald-700">
                      ID: <span className="font-mono">{verifiedBot.id}</span> · Поддерживает группы и диалоги
                    </p>
                  </div>
                </div>
              )}

              {/* Привязка AI-агента */}
              <div className="space-y-1.5">
                <label className="text-[13px] font-medium text-[#111111]">
                  Привязать AI-агента (автоответчик)
                </label>
                <select
                  {...existingForm.register("agent_id")}
                  className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] text-[#111111] transition-colors focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]"
                >
                  <option value="">Без автоматического агента (только CRM и операторы)</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name} ({agent.model})
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-[#666666]">
                  AI-бот будет автоматически обрабатывать входящие сообщения в Telegram и квалифицировать лиды.
                </p>
              </div>

              {/* Инструкция @BotFather */}
              <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 text-[12px] space-y-2 text-[#666666]">
                <div className="flex items-center gap-1.5 font-medium text-[#111111]">
                  <HelpCircle className="h-4 w-4 text-[#4a38f5]" />
                  Как получить токен в Telegram:
                </div>
                <ol className="list-decimal pl-4 space-y-1 leading-relaxed">
                  <li>
                    Откройте диалог с официальным ботом{" "}
                    <a
                      href="https://t.me/BotFather"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-[#4a38f5] hover:underline"
                    >
                      @BotFather
                    </a>
                  </li>
                  <li>Отправьте команду <code className="bg-white px-1.5 py-0.5 rounded border border-[#e5e5e5] text-[#111111]">/newbot</code> и укажите название и @username бота</li>
                  <li>Скопируйте сгенерированный токен и вставьте его в поле выше</li>
                </ol>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={connectBot.isPending}
                  className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                >
                  {connectBot.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Подключение бота...
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      Подключить бота
                    </>
                  )}
                </button>
              </div>
            </form>
          )}

          {/* Режим 3: Bot Manager (Managed Bots) */}
          {tab === "managed" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="h-5 w-5 text-[#4a38f5] shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="text-[13px] font-semibold text-[#111111]">
                      Telegram Managed Bots (Bot API 8.0)
                    </h3>
                    <p className="text-[12px] text-[#666666] leading-relaxed">
                      Создание бота через платформенный Bot Manager{" "}
                      <span className="font-medium text-[#111111]">
                        @{managerInfo?.managerUsername || "GetVoxlybot"}
                      </span>
                      . Пользователь авторизует создание нативно в Telegram.
                    </p>
                  </div>
                </div>
              </div>

              {!managedDeepLink ? (
                <form onSubmit={managedForm.handleSubmit(onSubmitManaged)} className="space-y-5">
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Имя бота <span className="text-red-500">*</span>
                    </label>
                    <input
                      {...managedForm.register("name")}
                      placeholder="Например: Сервисный консультант"
                      className={cn(
                        "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                        managedForm.formState.errors.name
                          ? "border-red-400 focus:border-red-500"
                          : "border-[#e5e5e5] focus:border-[#4a38f5]",
                      )}
                    />
                    {managedForm.formState.errors.name && (
                      <p className="text-[11px] text-red-600">
                        {managedForm.formState.errors.name.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Желаемый Username бота <span className="text-red-500">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-[13px] text-[#888888]">@</span>
                      <input
                        {...managedForm.register("username")}
                        placeholder="my_company_sales_bot"
                        className={cn(
                          "w-full rounded-lg border bg-white pl-8 pr-3.5 py-2 text-[13px] font-mono text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                          managedForm.formState.errors.username
                            ? "border-red-400 focus:border-red-500"
                            : "border-[#e5e5e5] focus:border-[#4a38f5]",
                        )}
                      />
                    </div>
                    {managedForm.formState.errors.username ? (
                      <p className="text-[11px] text-red-600">
                        {managedForm.formState.errors.username.message}
                      </p>
                    ) : (
                      <p className="text-[11px] text-[#666666]">
                        Должен содержать латинские буквы и заканчиваться на <code className="font-semibold text-[#111111]">bot</code>.
                      </p>
                    )}
                  </div>

                  {/* Опциональный токен */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Токен бота <span className="text-[11px] text-[#888888] font-normal">(если уже сгенерирован)</span>
                    </label>
                    <input
                      {...managedForm.register("token")}
                      type="password"
                      placeholder="Необязательно при создании по ссылке"
                      className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-mono text-[#111111] placeholder-[#999999] transition-colors focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]"
                    />
                  </div>

                  {/* Привязка AI-агента */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Привязать AI-агента
                    </label>
                    <select
                      {...managedForm.register("agent_id")}
                      className="w-full rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] text-[#111111] transition-colors focus:border-[#4a38f5] focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]"
                    >
                      <option value="">Без автоматического агента</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.model})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      disabled={createManaged.isPending}
                      className="w-full flex items-center justify-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
                    >
                      {createManaged.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Генерация бота...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Сгенерировать и создать бота
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Блок со сформированным deep link для Telegram */
                <div className="space-y-5 rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <h4 className="text-[14px] font-semibold text-emerald-950">
                        Ссылка создания бота готова
                      </h4>
                      <p className="mt-1 text-[12px] text-emerald-800 leading-relaxed">
                        Нажмите кнопку ниже, чтобы открыть официальный экран создания бота в приложении Telegram.
                      </p>
                    </div>
                  </div>

                  <a
                    href={managedDeepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-emerald-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Создать бота в Telegram
                  </a>

                  <div className="pt-3 border-t border-emerald-200/70">
                    <p className="text-[11px] text-emerald-900 mb-3">
                      После подтверждения создания в Telegram бот появится в списке подключений. Вы сможете в любой момент отредактировать его или обновить токен.
                    </p>
                    <button
                      type="button"
                      onClick={onClose}
                      className="w-full rounded-lg border border-emerald-300 bg-white px-3.5 py-2 text-[12px] font-medium text-emerald-950 hover:bg-emerald-50"
                    >
                      Вернуться к списку каналов
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

// Экспорт алиаса по требованию спецификации ТЗ
export { ConnectTelegramBotModal as TelegramBotIntegration };
