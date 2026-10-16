"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  Camera,
  Check,
  ExternalLink,
  Hash,
  KeyRound,
  Loader2,
  Mail,
  Phone,
  Send,
  ShieldCheck,
  Trash2,
  Unlink,
  User,
} from "lucide-react";
import { PasswordField } from "@/components/auth/PasswordField";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Skeleton } from "@/components/shared/Skeleton";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ApiClientError } from "@/lib/api/apiClient";
import {
  CHANNEL_LABELS,
  fetchChannelStatus,
  useChangePassword,
  useLinkChannel,
  useProfile,
  useUnlinkChannel,
  useUpdateProfile,
  useVerifyChannel,
  type ChannelBindingDTO,
} from "@/lib/api/use-profile";
import { userInitials } from "@/lib/api/use-tenant-users";
import { ROLE_LABELS } from "@/lib/api/use-team";
import { readRefreshToken } from "@/lib/auth/session";
import type { AuthChannel } from "@/lib/auth/use-auth";
import { AvatarError, loadImageFile, releaseImage } from "@/lib/utils/avatar";
import { AvatarCropModal } from "@/components/settings/AvatarCropModal";
import { cn, formatPhone } from "@/lib/utils";
import {
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordValues,
  type UpdateProfileValues,
} from "@/schemas/profile.schema";

const CHANNEL_ICONS: Record<AuthChannel, typeof Send> = {
  telegram: Send,
  max: Hash,
};

/** Состояние привязки одного канала: ссылка выдана, ждём код. */
interface LinkFlow {
  channel: AuthChannel;
  sessionId: string;
  deepLink: string | null;
  botUsername: string;
  delivered: boolean;
}

// ---------------------------------------------------------------------------
// Личные данные и аватар
// ---------------------------------------------------------------------------

function PersonalSection({
  name,
  email,
  phone,
  role,
  avatarUrl,
}: {
  name: string;
  email: string;
  phone: string | null;
  role: string;
  avatarUrl: string | null;
}) {
  const update = useUpdateProfile();
  const fileInput = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [removeAvatarOpen, setRemoveAvatarOpen] = useState(false);
  // Загруженное изображение и его objectURL: живут, пока открыто окно обрезки.
  const [cropSource, setCropSource] = useState<{ image: HTMLImageElement; url: string } | null>(
    null,
  );

  const form = useForm<UpdateProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    mode: "onChange",
    defaultValues: { name, phone: phone === null ? "" : formatPhone(phone) },
  });

  // Форма пересобирается при смене серверных данных: без этого после успешного
  // сохранения поля показывали бы прежние значения из первого рендера.
  useEffect(() => {
    form.reset({ name, phone: phone === null ? "" : formatPhone(phone) });
  }, [name, phone, form]);

  const handleSubmit = useCallback(
    async (values: UpdateProfileValues) => {
      try {
        await update.mutateAsync({ name: values.name, phone: values.phone });
        toast.success("Личные данные сохранены");
      } catch (error) {
        if (error instanceof ApiClientError) {
          const fields = error.fieldErrors();
          if (fields.phone !== undefined) form.setError("phone", { message: fields.phone });
          if (fields.name !== undefined) form.setError("name", { message: fields.name });
          toast.error(fields.phone ?? fields.name ?? error.message);
          return;
        }
        toast.error("Нет связи с сервером. Повторите попытку.");
      }
    },
    [update, form],
  );

  /**
   * Выбор файла: открывает окно кадрирования.
   *
   * Изображение не обрабатывается сразу — область выбирает пользователь.
   * Автоматическая обрезка по центру срезала лицо на портретных снимках, где
   * оно смещено вверх.
   */
  const handleFile = useCallback(async (file: File | undefined) => {
    if (file === undefined) return;

    setIsProcessing(true);

    try {
      const loaded = await loadImageFile(file);
      setCropSource(loaded);
    } catch (error) {
      toast.error(error instanceof AvatarError ? error.message : "Не удалось прочитать изображение");
    } finally {
      setIsProcessing(false);
      // Сброс значения: без него повторный выбор того же файла не вызвал бы
      // событие change.
      if (fileInput.current !== null) fileInput.current.value = "";
    }
  }, []);

  /** Применение обрезки: сохраняет уже закодированный data-URI. */
  const handleCropApply = useCallback(
    async (dataUri: string) => {
      try {
        await update.mutateAsync({ avatar_url: dataUri });
        toast.success("Фото обновлено");

        if (cropSource !== null) releaseImage(cropSource.url);
        setCropSource(null);
      } catch (error) {
        if (error instanceof ApiClientError) {
          toast.error(error.fieldErrors().avatar_url ?? error.message);
        } else {
          toast.error("Не удалось сохранить фото");
        }
      }
    },
    [update, cropSource],
  );

  const handleRemoveAvatar = useCallback(async () => {
    try {
      await update.mutateAsync({ avatar_url: null });
      toast.success("Фото удалено");
      setRemoveAvatarOpen(false);
    } catch {
      toast.error("Не удалось удалить фото");
    }
  }, [update]);

  const errors = form.formState.errors;
  const isBusy = update.isPending || isProcessing;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-sm font-semibold text-slate-200">Личные данные</h2>
      <p className="mt-1 text-xs text-slate-500">Как вас видят коллеги в системе</p>

      <div className="mt-5 flex flex-col gap-6 sm:flex-row">
        {/* Аватар */}
        <div className="flex shrink-0 flex-col items-center gap-3">
          <div className="relative">
            {avatarUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- Base64 data-URI: next/image требует загрузчик и внешний URL
              <img
                src={avatarUrl}
                alt="Ваше фото"
                className="h-24 w-24 rounded-full border border-slate-700 object-cover"
              />
            ) : (
              <div className="flex h-24 w-24 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-2xl font-semibold text-slate-300">
                {userInitials(name)}
              </div>
            )}

            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={isBusy}
              aria-label="Загрузить фото"
              className="absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 text-slate-950 transition-colors hover:bg-amber-400 disabled:opacity-60"
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Camera className="h-4 w-4" />
              )}
            </button>
          </div>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />

          <div className="text-center">
            <p className="text-xs text-slate-500">JPEG, PNG или WebP</p>
            {avatarUrl !== null && (
              <button
                type="button"
                onClick={() => setRemoveAvatarOpen(true)}
                className="mt-1 text-xs text-slate-500 transition-colors hover:text-rose-400"
              >
                Удалить фото
              </button>
            )}
          </div>
        </div>

        {/* Поля */}
        <form
          onSubmit={form.handleSubmit((values) => void handleSubmit(values))}
          className="flex-1 space-y-4"
        >
          <div className="space-y-2">
            <label htmlFor="profile_name" className="block text-xs font-medium text-slate-400">
              Имя и фамилия
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="profile_name"
                {...form.register("name")}
                className={cn(
                  "w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-3.5 text-sm text-slate-100 placeholder:text-slate-500",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  errors.name !== undefined ? "border-rose-500" : "border-slate-700",
                )}
              />
            </div>
            {errors.name && <p className="text-xs text-rose-400">{errors.name.message}</p>}
          </div>

          {/*
            E-mail только для чтения: он служит логином и адресом восстановления
            пароля, поэтому смена требует подтверждения владения новым адресом —
            отдельного сценария, которого пока нет. Поле показано, чтобы человек
            видел свой логин, а подпись объясняет, почему его нельзя изменить.
          */}
          <div className="space-y-2">
            <label htmlFor="profile_email" className="block text-xs font-medium text-slate-400">
              E-mail
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <input
                id="profile_email"
                value={email}
                readOnly
                disabled
                className="w-full cursor-not-allowed rounded-lg border border-slate-800 bg-slate-900 py-2.5 pl-10 pr-3.5 text-sm text-slate-500"
              />
            </div>
            <p className="text-xs text-slate-500">
              Служит логином. Для смены обратитесь к администратору компании.
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor="profile_phone" className="block text-xs font-medium text-slate-400">
              Телефон
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                id="profile_phone"
                type="tel"
                inputMode="tel"
                placeholder="+7 999 123 45 67"
                value={form.watch("phone")}
                onChange={(event) =>
                  form.setValue("phone", formatPhone(event.target.value), {
                    shouldValidate: true,
                  })
                }
                className={cn(
                  "w-full rounded-lg border bg-slate-950 py-2.5 pl-10 pr-3.5 text-sm text-slate-100 placeholder:text-slate-500",
                  "focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20",
                  errors.phone !== undefined ? "border-rose-500" : "border-slate-700",
                )}
              />
            </div>
            {errors.phone ? (
              <p className="text-xs text-rose-400">{errors.phone.message}</p>
            ) : (
              <p className="text-xs text-slate-500">На него приходит код подтверждения при входе</p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-slate-800 pt-4">
            <span className="text-xs text-slate-500">
              Роль: <span className="text-slate-300">{role}</span>
            </span>
            <button
              type="submit"
              disabled={isBusy || !form.formState.isDirty}
              className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {update.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Сохраняем...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Сохранить изменения
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      <AvatarCropModal
        open={cropSource !== null}
        image={cropSource?.image ?? null}
        imageUrl={cropSource?.url ?? null}
        onCancel={() => setCropSource(null)}
        onApply={handleCropApply}
        isPending={update.isPending}
      />

      <ConfirmDialog
        open={removeAvatarOpen}
        onClose={() => setRemoveAvatarOpen(false)}
        onConfirm={handleRemoveAvatar}
        title="Удалить фото?"
        description="Вместо фото будут показаны ваши инициалы."
        confirmLabel="Удалить"
        variant="destructive"
        isPending={update.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Смена пароля
// ---------------------------------------------------------------------------

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const changePassword = useChangePassword();

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    mode: "onChange",
    defaultValues: { current_password: "", password: "", password_confirm: "" },
  });

  const handleSubmit = useCallback(
    async (values: ChangePasswordValues) => {
      try {
        // Свой refresh-токен передаётся, чтобы текущая сессия не была отозвана
        // вместе с остальными: иначе успешная смена пароля выкидывала бы
        // пользователя из интерфейса.
        const keep = readRefreshToken();

        const result = await changePassword.mutateAsync({
          current_password: values.current_password,
          password: values.password,
          ...(keep !== null && { keep_refresh_token: keep }),
        });

        toast.success(result.message);
        form.reset({ current_password: "", password: "", password_confirm: "" });
      } catch (error) {
        if (error instanceof ApiClientError) {
          const fields = error.fieldErrors();

          if (error.code === "INVALID_CURRENT_PASSWORD" || fields.current_password !== undefined) {
            form.setError("current_password", {
              message: fields.current_password ?? "Неверный текущий пароль",
            });
            toast.error("Текущий пароль указан неверно");
            return;
          }

          if (fields.password !== undefined) {
            form.setError("password", { message: fields.password });
            toast.error(fields.password);
            return;
          }

          toast.error(error.message);
          return;
        }
        toast.error("Нет связи с сервером. Повторите попытку.");
      }
    },
    [changePassword, form],
  );

  const errors = form.formState.errors;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-sm font-semibold text-slate-200">Безопасность</h2>
      <p className="mt-1 text-xs text-slate-500">
        После смены пароля сессии на других устройствах будут завершены
      </p>

      {!hasPassword ? (
        <p className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs text-slate-400">
          Пароль ещё не задан. Откройте ссылку из приглашения, чтобы задать его.
        </p>
      ) : (
        <form
          onSubmit={form.handleSubmit((values) => void handleSubmit(values))}
          className="mt-5 max-w-md space-y-4"
        >
          <PasswordField
            id="current_password"
            label="Текущий пароль"
            autoComplete="current-password"
            placeholder="••••••••"
            error={errors.current_password?.message}
            {...form.register("current_password")}
          />

          <PasswordField
            id="new_password"
            label="Новый пароль"
            autoComplete="new-password"
            placeholder="••••••••"
            error={errors.password?.message}
            hint="Минимум 8 символов"
            {...form.register("password")}
          />

          <PasswordField
            id="new_password_confirm"
            label="Повторите новый пароль"
            autoComplete="new-password"
            placeholder="••••••••"
            error={errors.password_confirm?.message}
            {...form.register("password_confirm")}
          />

          <button
            type="submit"
            disabled={changePassword.isPending}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {changePassword.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Обновляем...
              </>
            ) : (
              <>
                <KeyRound className="h-4 w-4" />
                Обновить пароль
              </>
            )}
          </button>
        </form>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Привязанные каналы
// ---------------------------------------------------------------------------

function ChannelRow({
  binding,
  flow,
  onLink,
  onUnlink,
  onVerify,
  onCancel,
  isBusy,
  canUnlink,
}: {
  binding: ChannelBindingDTO;
  flow: LinkFlow | null;
  onLink: () => void;
  onUnlink: () => void;
  onVerify: (code: string) => void;
  onCancel: () => void;
  isBusy: boolean;
  canUnlink: boolean;
}) {
  const [code, setCode] = useState("");
  const Icon = CHANNEL_ICONS[binding.channel];
  const label = CHANNEL_LABELS[binding.channel];
  const active = flow !== null && flow.channel === binding.channel;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg",
              binding.linked ? "bg-emerald-500/10" : "bg-slate-800",
            )}
          >
            <Icon className={cn("h-4 w-4", binding.linked ? "text-emerald-400" : "text-slate-500")} />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-slate-200">{label}</span>
              <StatusBadge variant={binding.linked ? "success" : "neutral"} size="sm">
                {binding.linked ? "Привязан" : "Не привязан"}
              </StatusBadge>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {binding.linked
                ? `ID: ${binding.externalId ?? "—"}`
                : binding.available
                  ? `Бот @${binding.botUsername}`
                  : "Канал не настроен на сервере"}
            </p>
          </div>
        </div>

        {binding.linked ? (
          <button
            type="button"
            onClick={onUnlink}
            disabled={isBusy || !canUnlink}
            title={
              canUnlink
                ? undefined
                : "Нельзя отвязать единственный канал: в него приходит код при входе"
            }
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-rose-500/40 hover:text-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Unlink className="h-3.5 w-3.5" />
            Отвязать
          </button>
        ) : (
          !active && (
            <button
              type="button"
              onClick={onLink}
              disabled={isBusy || !binding.available}
              className="flex items-center gap-1.5 rounded-lg bg-sky-500/10 px-3 py-2 text-xs font-medium text-sky-400 transition-colors hover:bg-sky-500/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ExternalLink className="h-3.5 w-3.5" />
              )}
              Привязать {label}
            </button>
          )
        )}
      </div>

      {/* Шаг привязки: открыть бота, затем ввести код. */}
      {active && flow !== null && (
        <div className="mt-4 space-y-3 border-t border-slate-800 pt-4">
          {flow.deepLink !== null && (
            <a
              href={flow.deepLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-sky-500/10 px-4 py-2.5 text-sm font-medium text-sky-400 transition-colors hover:bg-sky-500/20"
            >
              <ExternalLink className="h-4 w-4" />
              Открыть @{flow.botUsername} и нажать «Start»
            </a>
          )}

          <p className="flex items-center gap-2 text-xs text-slate-500">
            {flow.delivered ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" />
                Код отправлен в {label} — введите его ниже
              </>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                Ожидаем подтверждения из {label}...
              </>
            )}
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="------"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-32 rounded-lg border border-slate-700 bg-slate-900 py-2 text-center text-lg tracking-[0.3em] text-slate-100 placeholder:text-slate-600 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
            <button
              type="button"
              onClick={() => onVerify(code)}
              disabled={isBusy || code.length !== 6}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
              Подтвердить
            </button>
            <button
              type="button"
              onClick={() => {
                setCode("");
                onCancel();
              }}
              className="rounded-lg px-3 py-2 text-xs text-slate-500 transition-colors hover:text-slate-300"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ChannelsSection({ channels }: { channels: ChannelBindingDTO[] }) {
  const link = useLinkChannel();
  const verify = useVerifyChannel();
  const unlink = useUnlinkChannel();

  const [flow, setFlow] = useState<LinkFlow | null>(null);
  const [unlinkTarget, setUnlinkTarget] = useState<AuthChannel | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Опрос доставки: код приходит уже после ответа на запрос ссылки, когда
  // пользователь нажал Start в боте.
  useEffect(() => {
    if (flow === null || flow.delivered) return;

    const startedAt = Date.now();

    pollRef.current = setInterval(() => {
      void (async () => {
        if (Date.now() - startedAt > 5 * 60_000) {
          stopPolling();
          return;
        }

        try {
          const status = await fetchChannelStatus(flow.sessionId);

          if (status.expired) {
            stopPolling();
            setFlow(null);
            toast.error("Срок действия ссылки истёк. Запросите привязку заново.");
            return;
          }

          if (status.delivered) {
            stopPolling();
            setFlow((previous) => (previous === null ? null : { ...previous, delivered: true }));
          }
        } catch {
          // Разовая сетевая ошибка не должна прерывать ожидание.
        }
      })();
    }, 2000);

    return stopPolling;
  }, [flow, stopPolling]);

  const handleLink = useCallback(
    async (channel: AuthChannel) => {
      try {
        const result = await link.mutateAsync({ channel });
        setFlow({
          channel,
          sessionId: result.session_id,
          deepLink: result.deep_link,
          botUsername: result.bot_username,
          delivered: result.delivered,
        });
        toast.info(`Откройте бота @${result.bot_username} и нажмите «Start»`);
      } catch (error) {
        toast.error(error instanceof ApiClientError ? error.message : "Не удалось начать привязку");
      }
    },
    [link],
  );

  const handleVerify = useCallback(
    async (code: string) => {
      if (flow === null) return;

      try {
        await verify.mutateAsync({ session_id: flow.sessionId, code });
        stopPolling();
        setFlow(null);
        toast.success(`${CHANNEL_LABELS[flow.channel]} привязан`);
      } catch (error) {
        toast.error(error instanceof ApiClientError ? error.message : "Не удалось подтвердить код");
      }
    },
    [flow, verify, stopPolling],
  );

  const handleUnlink = useCallback(async () => {
    if (unlinkTarget === null) return;

    try {
      await unlink.mutateAsync({ channel: unlinkTarget });
      toast.success(`${CHANNEL_LABELS[unlinkTarget]} отвязан`);
      setUnlinkTarget(null);
    } catch (error) {
      toast.error(error instanceof ApiClientError ? error.message : "Не удалось отвязать канал");
    }
  }, [unlink, unlinkTarget]);

  const linkedCount = channels.filter((channel) => channel.linked).length;
  const isBusy = link.isPending || verify.isPending || unlink.isPending;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="text-sm font-semibold text-slate-200">Каналы для входа</h2>
      <p className="mt-1 text-xs text-slate-500">
        В привязанный канал приходит код подтверждения при входе
      </p>

      <div className="mt-5 space-y-3">
        {channels.map((binding) => (
          <ChannelRow
            key={binding.channel}
            binding={binding}
            flow={flow}
            isBusy={isBusy}
            // Единственный канал отвязать нельзя: без него код при входе
            // доставить некуда.
            canUnlink={linkedCount > 1}
            onLink={() => void handleLink(binding.channel)}
            onUnlink={() => setUnlinkTarget(binding.channel)}
            onVerify={(code) => void handleVerify(code)}
            onCancel={() => {
              stopPolling();
              setFlow(null);
            }}
          />
        ))}
      </div>

      <ConfirmDialog
        open={unlinkTarget !== null}
        onClose={() => setUnlinkTarget(null)}
        onConfirm={handleUnlink}
        title={unlinkTarget === null ? "Отвязать канал?" : `Отвязать ${CHANNEL_LABELS[unlinkTarget]}?`}
        description="Код подтверждения при входе больше не будет приходить в этот канал. Привязать его снова можно в любой момент."
        confirmLabel="Отвязать"
        variant="destructive"
        isPending={unlink.isPending}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const { data, isLoading, isError, error, refetch } = useProfile();

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError || data === undefined) {
    return (
      <div role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-6">
        <p className="text-sm text-rose-400">
          Не удалось загрузить профиль: {error?.message ?? "неизвестная ошибка"}
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Повторить
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Мой профиль</h1>
        <p className="mt-1 text-sm text-slate-400">
          Личные данные, пароль и каналы для входа
        </p>
      </div>

      <PersonalSection
        name={data.name}
        email={data.email}
        phone={data.phone}
        role={ROLE_LABELS[data.role]}
        avatarUrl={data.avatarUrl}
      />

      <PasswordSection hasPassword={data.hasPassword} />

      <ChannelsSection channels={data.channels} />

      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Trash2 className="h-3.5 w-3.5" />
        Удаление собственной учётной записи выполняет администратор компании в разделе «Сотрудники».
      </p>
    </div>
  );
}
