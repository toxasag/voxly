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
  Sparkles,
  Zap,
} from "lucide-react";

import { ApiClientError } from "@/lib/api/apiClient";
import { useChannelAccounts, type ChannelAccountDTO } from "@/lib/api/use-channels";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import {
  useCompleteManagedTelegramBot,
  useConnectTelegramBot,
  useCreateManagedTelegramBot,
  useTelegramBotManagerInfo,
  useVerifyTelegramBotToken,
  type TelegramBotInfoDTO,
} from "@/lib/api/use-telegram-bot";
import {
  completeManagedTelegramBotSchema,
  connectTelegramBotSchema,
  createManagedTelegramBotSchema,
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

type TabMode = "managed" | "existing" | "complete";

/**
 * Транслитерация кириллицы в латиницу для автоматического подбора username бота.
 */
function transliterateToBotUsername(name: string): string {
  const ru: Record<string, string> = {
    а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh",
    з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
    п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
    ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  };
  const latin = name
    .toLowerCase()
    .split("")
    .map((c) => ru[c] ?? c)
    .join("")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 26);

  if (!latin) return "";
  if (latin.endsWith("bot")) return latin;
  return `${latin}_bot`;
}

export function ConnectTelegramBotModal({
  open,
  onClose,
  initialAccount,
}: ConnectTelegramBotModalProps) {
  const isPendingAccount = initialAccount?.status === "pending";
  const [tab, setTab] = useState<TabMode>(isPendingAccount ? "complete" : "managed");
  const [verifiedBot, setVerifiedBot] = useState<TelegramBotInfoDTO | null>(null);
  const [managedDeepLink, setManagedDeepLink] = useState<string | null>(null);
  const [createdUsername, setCreatedUsername] = useState<string | null>(null);
  const [usernameUserEdited, setUsernameUserEdited] = useState(false);
  const [isSuccessConfirmed, setIsSuccessConfirmed] = useState(false);

  const { data: agents = [] } = useAiAgents();
  const { data: managerInfo } = useTelegramBotManagerInfo();
  const { data: accountsData, refetch: refetchAccounts } = useChannelAccounts("telegram_bot");

  const verifyToken = useVerifyTelegramBotToken();
  const connectBot = useConnectTelegramBot();
  const createManaged = useCreateManagedTelegramBot();
  const completeManaged = useCompleteManagedTelegramBot();

  // Форма создания управляемого бота через Bot Manager (официально в Telegram)
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

  // Форма подключения существующего бота через токен @BotFather
  const existingForm = useForm<ConnectTelegramBotValues>({
    resolver: zodResolver(connectTelegramBotSchema),
    mode: "onChange",
    defaultValues: {
      label: initialAccount?.label ?? "",
      token: "",
      agent_id: initialAccount?.boundAgentId ?? null,
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

  // Сброс состояния при открытии/закрытии
  useEffect(() => {
    if (open) {
      if (initialAccount?.status === "pending") {
        setTab("complete");
      } else {
        setTab("managed");
      }
      setVerifiedBot(null);
      setManagedDeepLink(null);
      setCreatedUsername(null);
      setUsernameUserEdited(false);
      setIsSuccessConfirmed(false);

      managedForm.reset({
        name: "",
        username: "",
        token: "",
        agent_id: null,
      });
      existingForm.reset({
        label: initialAccount?.label ?? "",
        token: "",
        agent_id: initialAccount?.boundAgentId ?? null,
      });
      completeForm.reset({ token: "" });
    }
  }, [open, initialAccount, managedForm, existingForm, completeForm]);

  // Периодический опрос статуса при ожидании подтверждения в Telegram
  useEffect(() => {
    if (!managedDeepLink || isSuccessConfirmed) return;

    const interval = setInterval(() => {
      void refetchAccounts();
    }, 2000);

    return () => clearInterval(interval);
  }, [managedDeepLink, isSuccessConfirmed, refetchAccounts]);

  // Реакция на изменение статуса аккаунта в "connected"
  useEffect(() => {
    if (!createdUsername || !managedDeepLink || isSuccessConfirmed) return;

    const target = accountsData?.items.find((a) => {
      const ext = a.externalId.toLowerCase().replace(/^@/, "");
      const search = createdUsername.toLowerCase().replace(/^@/, "");
      return ext === search;
    });

    if (target && target.status === "connected") {
      setIsSuccessConfirmed(true);
      toast.success(`Бот @${createdUsername} успешно создан и подключен!`);
      const timer = setTimeout(() => {
        onClose();
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [accountsData, createdUsername, managedDeepLink, isSuccessConfirmed, onClose]);

  // Создание бота через Telegram Bot Manager
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
          setCreatedUsername(cleanUsername);
          setManagedDeepLink(result.deepLink);

          // Пытаемся автоматически открыть Telegram в новом окне/вкладке
          try {
            window.open(result.deepLink, "_blank", "noopener,noreferrer");
          } catch {
            // если браузер заблокировал всплывающее окно — пользователь нажмет кнопку
          }

          toast.info("Подтвердите создание бота в открывшемся окне Telegram");
        } else {
          toast.success("Бот успешно создан и активирован!");
          onClose();
        }
      } catch (err) {
        const msg = err instanceof ApiClientError ? err.message : "Не удалось создать бота";
        toast.error(msg);
      }
    },
    [createManaged, onClose],
  );

  // Проверка токена от @BotFather
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

  // Подключение бота по токену @BotFather
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

  // Ручной ввод токена для завершения pending-бота
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
    [initialAccount, completeManaged, onClose],
  );

  return (
    <Sheet open={open} onClose={onClose} width="w-[520px]" resizable>
      <div className="flex h-full flex-col bg-white">
        <SheetHeader onClose={onClose}>
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">
                {isPendingAccount
                  ? "Завершение подключения бота"
                  : tab === "managed"
                    ? "Создание бота в Telegram"
                    : "Подключение по токену @BotFather"}
              </h2>
              <p className="text-[12px] text-[#666666]">
                {isPendingAccount
                  ? "Подтверждение создания в Telegram"
                  : tab === "managed"
                    ? "Официальное создание через Telegram Bot Manager"
                    : "Подключение созданного в @BotFather бота"}
              </p>
            </div>
          </div>
        </SheetHeader>

        {/* Тело формы */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {/* Переключатель режимов (если не режим завершения) */}
          {!isPendingAccount && (
            <div className="flex rounded-lg border border-[#e5e5e5] bg-[#fbfbfb] p-1 gap-1">
              <button
                type="button"
                onClick={() => {
                  setTab("managed");
                  setManagedDeepLink(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  tab === "managed"
                    ? "bg-[#4a38f5] text-white shadow-2xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#eaeaea]",
                )}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Создать в Telegram
              </button>
              <button
                type="button"
                onClick={() => {
                  setTab("existing");
                  setManagedDeepLink(null);
                }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  tab === "existing"
                    ? "bg-[#4a38f5] text-white shadow-2xs"
                    : "text-[#666666] hover:text-[#111111] hover:bg-[#eaeaea]",
                )}
              >
                <Key className="h-3.5 w-3.5" />
                Свой токен (@BotFather)
              </button>
            </div>
          )}

          {/* Режим 1: Создание управляемого бота через Bot Manager (Основной, 1 клик) */}
          {tab === "managed" && !isPendingAccount && (
            <div className="space-y-5">
              {!managedDeepLink ? (
                <form onSubmit={managedForm.handleSubmit(onSubmitManaged)} className="space-y-5">
                  <div className="rounded-xl border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-[#4a38f5] shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[13px] font-semibold text-[#111111]">
                            Официальное создание бота в Telegram
                          </h3>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-800">
                            Рекомендуется
                          </span>
                        </div>
                        <p className="text-[12px] text-[#666666] leading-relaxed">
                          Создание реального бота под управлением менеджера{" "}
                          <span className="font-semibold text-[#111111]">
                            @{managerInfo?.managerUsername || "GetVoxlybot"}
                          </span>
                          . Вы указываете имя, подтверждаете создание в Telegram в 1 клик — и бот моментально подключается со статусом «В сети».
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Имя бота <span className="text-red-500">*</span>
                    </label>
                    <input
                      placeholder="Например: Фриланс Хантер или Консультант"
                      {...managedForm.register("name")}
                      onChange={(e) => {
                        managedForm.setValue("name", e.target.value, { shouldValidate: true });
                        if (!usernameUserEdited) {
                          const suggested = transliterateToBotUsername(e.target.value);
                          managedForm.setValue("username", suggested, { shouldValidate: true });
                        }
                      }}
                      className={cn(
                        "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
                        managedForm.formState.errors.name
                          ? "border-red-400 focus:border-red-500"
                          : "border-[#e5e5e5] focus:border-[#4a38f5]",
                      )}
                    />
                    {managedForm.formState.errors.name ? (
                      <p className="text-[11px] text-red-600">
                        {managedForm.formState.errors.name.message}
                      </p>
                    ) : (
                      <p className="text-[11px] text-[#666666]">
                        Отображаемое имя бота в Telegram и диалогах CRM
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Username бота в Telegram <span className="text-red-500">*</span>
                    </label>
                    <div className="relative flex items-center">
                      <span className="absolute left-3 text-[13px] text-[#888888]">@</span>
                      <input
                        placeholder="freelancehunter_bot"
                        {...managedForm.register("username")}
                        onChange={(e) => {
                          setUsernameUserEdited(true);
                          managedForm.setValue("username", e.target.value, { shouldValidate: true });
                        }}
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
                        Уникальный адрес в Telegram (латиница, обязан оканчиваться на <code className="font-semibold text-[#111111]">bot</code>)
                      </p>
                    )}
                  </div>

                  {/* Привязка AI-агента */}
                  <div className="space-y-1.5">
                    <label className="text-[13px] font-medium text-[#111111]">
                      Привязать AI-агента (автоответчик)
                    </label>
                    <select
                      {...managedForm.register("agent_id")}
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
                      AI-агент сразу возьмет на себя обработку входящих сообщений клиентов в Telegram
                    </p>
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
                          Подготовка ссылки...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Создать бота в Telegram
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* Экран ожидания подтверждения в Telegram */
                <div className="space-y-5">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 space-y-4">
                    <div className="flex items-start gap-3">
                      {isSuccessConfirmed ? (
                        <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                      ) : (
                        <Loader2 className="h-6 w-6 text-emerald-600 animate-spin shrink-0" />
                      )}
                      <div className="space-y-1">
                        <h4 className="text-[14px] font-semibold text-emerald-950">
                          {isSuccessConfirmed
                            ? "Бот успешно активирован!"
                            : "Подтвердите создание бота в Telegram"}
                        </h4>
                        <p className="text-[12px] text-emerald-800 leading-relaxed">
                          {isSuccessConfirmed
                            ? `Бот @${createdUsername} готов к работе и принимает входящие сообщения.`
                            : `Мы сформировали официальный запрос на создание бота @${createdUsername} в Telegram.`}
                        </p>
                      </div>
                    </div>

                    {!isSuccessConfirmed && (
                      <>
                        <a
                          href={managedDeepLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-emerald-700"
                        >
                          <ExternalLink className="h-4 w-4" />
                          Открыть Telegram для подтверждения
                        </a>

                        <div className="rounded-lg border border-emerald-200/80 bg-white/70 p-3.5 text-[12px] space-y-2 text-emerald-950">
                          <p className="font-semibold text-emerald-900">Что произойдет дальше:</p>
                          <ol className="list-decimal pl-4 space-y-1 text-emerald-800 text-[11px] leading-relaxed">
                            <li>В Telegram откроется окно подтверждения создания бота</li>
                            <li>Нажмите «Создать» (или «Confirm») в Telegram</li>
                            <li>Telegram зарегистрирует бота и наш сервер автоматически подключит его со статусом «В сети»</li>
                          </ol>
                        </div>

                        <div className="flex items-center justify-center gap-2 py-1 text-emerald-700 text-[11px]">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Ожидаем подтверждения в приложении Telegram...
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <button
                      type="button"
                      onClick={() => setManagedDeepLink(null)}
                      className="text-xs text-[#666666] hover:text-[#111111] hover:underline"
                    >
                      ← Изменить имя или username
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#fafafa]"
                    >
                      Закрыть
                    </button>
                  </div>
                </div>
              )}
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

          {/* Режим завершения pending-бота */}
          {tab === "complete" && (
            <div className="space-y-5">
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[13px] font-medium text-amber-900">
                      Статус: Требуется подтверждение в Telegram
                    </h3>
                    <p className="mt-1 text-[12px] text-amber-700 leading-relaxed">
                      Бот <span className="font-semibold text-amber-950 font-mono">{initialAccount?.externalId}</span> ожидает подтверждения создания в приложении Telegram или ввода токена вручную.
                    </p>
                  </div>
                </div>
              </div>

              {/* Ссылка на создание в Telegram */}
              {initialAccount && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-emerald-950 text-[13px] font-medium">
                    <ExternalLink className="h-4 w-4 text-emerald-600" />
                    Подтвердить создание в Telegram
                  </div>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    Откройте экран создания бота в Telegram для завершения автоматической привязки.
                  </p>
                  <a
                    href={`https://t.me/newbot/${managerInfo?.managerUsername || "GetVoxlybot"}/${initialAccount.externalId.replace(/^@/, "")}?name=${encodeURIComponent(initialAccount.label)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-emerald-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Перейти в Telegram для подтверждения
                  </a>
                </div>
              )}

              <div className="relative flex py-1 items-center">
                <div className="grow border-t border-[#e5e5e5]"></div>
                <span className="shrink mx-3 text-[11px] text-[#888888]">или укажите токен от @BotFather</span>
                <div className="grow border-t border-[#e5e5e5]"></div>
              </div>

              <form onSubmit={completeForm.handleSubmit(onSubmitComplete)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[13px] font-medium text-[#111111]">
                    Токен бота Telegram <span className="text-red-500">*</span>
                  </label>
                  <input
                    {...completeForm.register("token")}
                    type="password"
                    placeholder="123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ_1234567"
                    className={cn(
                      "w-full rounded-lg border bg-white px-3.5 py-2 text-[13px] font-mono text-[#111111] placeholder-[#999999] transition-colors focus:outline-hidden focus:ring-1 focus:ring-[#4a38f5]",
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
        </div>
      </div>
    </Sheet>
  );
}

// Экспорт алиаса по требованию спецификации ТЗ
export { ConnectTelegramBotModal as TelegramBotIntegration };
