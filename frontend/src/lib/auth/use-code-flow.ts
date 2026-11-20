"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ApiClientError } from "@/lib/api/apiClient";
import { useAuth, type AuthChannel, type RequestCodeResult } from "@/lib/auth/use-auth";

// ---------------------------------------------------------------------------
// Запрос и ожидание кода подтверждения.
//
// Общий для /login и /register: обе формы проходят один и тот же путь — запрос
// кода, возможная привязка бота, ожидание доставки, ввод кода.
//
// Опрос статуса нужен потому, что при первой привязке код отправляется не в
// ответе на запрос, а позже: сначала пользователь нажимает Start в боте, и
// только тогда webhook присылает код. Без опроса поле ввода оставалось бы
// заблокированным до перезагрузки страницы.
// ---------------------------------------------------------------------------

/** Пауза между опросами: код приходит за секунды, чаще опрашивать незачем. */
const POLL_INTERVAL_MS = 2000;
/** Ограничение по времени опроса — TTL кода (5 минут) плюс небольшой запас. */
const POLL_TIMEOUT_MS = 5 * 60_000;

export type CodeStage = "idle" | "requesting" | "awaiting_bot" | "sent";

export interface CodeFlowState {
  stage: CodeStage;
  sessionId: string | null;
  deepLink: string | null;
  botUsername: string;
  channel: AuthChannel;
  cooldown: number;
  error: string | null;
  fieldErrors: Record<string, string> | null;
  verified: boolean;
  consumed: boolean;
  popupBlocked: boolean;
}

const RESEND_COOLDOWN_SECONDS = 60;

function buildNativeTelegramUrl(deepLink: string): string {
  try {
    const parsed = new URL(deepLink);
    const domain = parsed.pathname.replace(/^\/+/, "");
    const start = parsed.searchParams.get("start");
    if (domain.length > 0 && start !== null && start.length > 0) {
      return `tg://resolve?domain=${encodeURIComponent(domain)}&start=${encodeURIComponent(start)}`;
    }
  } catch {
    // Используем исходный URL, если разбор не удался.
  }
  return deepLink;
}

function tryOpenDeepLink(
  url: string,
  channel: AuthChannel,
  purpose: "register" | "login",
): { opened: boolean } {
  if (typeof window === "undefined") return { opened: false };
  const ua = navigator.userAgent || "";
  const isMobileOrWebView = /Android|iPhone|iPad|iPod|Telegram/i.test(ua);
  const targetUrl = channel === "telegram" && isMobileOrWebView ? buildNativeTelegramUrl(url) : url;

  if (isMobileOrWebView) {
    window.location.href = targetUrl;
    return { opened: true };
  }

  const popup = window.open(url, "_blank");
  if (popup !== null) {
    popup.opener = null;
    return { opened: true };
  }

  // Если браузер заблокировал всплывающее окно при регистрации, переводим
  // текущую вкладку: черновик уже сохранён на сервере, кнопка в боте вернёт назад.
  if (purpose === "register") {
    window.location.href = url;
    return { opened: true };
  }

  return { opened: false };
}

/** Человекочитаемое имя канала: используется в тостах и подсказках форм. */
export const CHANNEL_LABEL: Record<AuthChannel, string> = {
  telegram: "Telegram",
  max: "MAX",
};

/**
 * Имена ботов по умолчанию.
 *
 * Нужны только до первого ответа сервера: он присылает `bot_username`, и именно
 * это значение показывается пользователю. Прежняя версия жёстко подставляла
 * `GetVoxlybot`, поэтому при выборе MAX в подсказке стоял бы чужой бот.
 */
const DEFAULT_BOT_USERNAME: Record<AuthChannel, string> = {
  telegram: "GetVoxlybot",
  max: "id505030516451_bot",
};

export function useCodeFlow(purpose: "register" | "login") {
  const { requestCode, codeStatus } = useAuth();

  const [state, setState] = useState<CodeFlowState>({
    stage: "idle",
    sessionId: null,
    deepLink: null,
    botUsername: DEFAULT_BOT_USERNAME.telegram,
    channel: "telegram",
    cooldown: 0,
    error: null,
    fieldErrors: null,
    verified: false,
    consumed: false,
    popupBlocked: false,
  });

  // Таймеры держим в ref, чтобы очистить их при размонтировании: иначе опрос
  // продолжался бы после ухода со страницы и обновлял состояние отмонтированного
  // компонента.
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current !== null) clearInterval(pollRef.current);
      if (cooldownRef.current !== null) clearInterval(cooldownRef.current);
    };
  }, []);

  const startCooldown = useCallback(() => {
    setState((prev) => ({ ...prev, cooldown: RESEND_COOLDOWN_SECONDS }));

    if (cooldownRef.current !== null) clearInterval(cooldownRef.current);

    cooldownRef.current = setInterval(() => {
      setState((prev) => {
        if (prev.cooldown <= 1) {
          if (cooldownRef.current !== null) clearInterval(cooldownRef.current);
          return { ...prev, cooldown: 0 };
        }
        return { ...prev, cooldown: prev.cooldown - 1 };
      });
    }, 1000);
  }, []);

  /** Опрос доставки после привязки бота. */
  const beginPolling = useCallback(
    (sessionId: string, channel: AuthChannel) => {
      stopPolling();
      const startedAt = Date.now();

      pollRef.current = setInterval(() => {
        void (async () => {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            stopPolling();
            setState((prev) => ({ ...prev, stage: "idle", sessionId: null, deepLink: null, error: "Время ожидания истекло. Запросите новый код или выберите другой канал." }));
            toast.error("Время ожидания истекло. Запросите новый код.");
            return;
          }

          try {
            const status = await codeStatus(sessionId);

            if (status.consumed) {
              stopPolling();
              setState((prev) => ({
                ...prev,
                stage: "sent",
                verified: true,
                consumed: true,
                deepLink: null,
                error: null,
              }));
              return;
            }

            if (status.expired) {
              stopPolling();
              setState((prev) => ({ ...prev, stage: "idle", sessionId: null, deepLink: null, error: "Срок действия кода истёк. Запросите код заново." }));
              toast.error("Срок действия кода истёк. Запросите код заново.");
              return;
            }

            if (status.verified || status.delivered) {
              stopPolling();
              setState((prev) => ({
                ...prev,
                stage: "sent",
                verified: status.verified,
                deepLink: null,
                error: null,
              }));
              if (status.verified) {
                toast.success(`${CHANNEL_LABEL[channel]} подтверждён!`);
              } else {
                toast.success(`Код отправлен в ${CHANNEL_LABEL[channel]}`);
              }
            }
          } catch {
            // Разовая сетевая ошибка не должна прерывать ожидание: следующая
            // итерация повторит запрос.
          }
        })();
      }, POLL_INTERVAL_MS);
    },
    [codeStatus, stopPolling],
  );

  const describeError = useCallback((error: unknown): string => {
    if (error instanceof ApiClientError) {
      if (error.isValidationError) {
        const fields = error.fieldErrors();
        return fields.slug ?? fields.email ?? fields.phone ?? fields.password ?? fields._root ?? error.message;
      }
      switch (error.code) {
        case "TOO_MANY_REQUESTS":
          return "Слишком много запросов кода. Попробуйте через минуту.";
        case "CODE_NOT_DELIVERED":
          return "Код ещё не доставлен. Откройте бота и нажмите Start, затем повторите проверку.";
        case "TENANT_INACTIVE":
          return "Доступ приостановлен: подписка компании неактивна";
        case "TELEGRAM_UNAVAILABLE":
          return "Telegram-бот не настроен. Обратитесь к администратору платформы.";
        case "MAX_UNAVAILABLE":
          return "MAX-бот не настроен. Обратитесь к администратору платформы.";
        default:
          return error.message;
      }
    }
    return "Нет связи с сервером. Проверьте подключение и повторите попытку.";
  }, []);

  const request = useCallback(
    async (input: {
      channel: AuthChannel;
      phone: string;
      email?: string;
      slug?: string;
      password?: string;
      onSessionCreated?: (sessionId: string, deepLink: string | null) => void;
    }): Promise<boolean> => {
      setState((prev) => ({
        ...prev,
        stage: "requesting",
        channel: input.channel,
        fieldErrors: null,
        consumed: false,
        verified: false,
        // Заранее подставляем бота выбранного канала: иначе на время запроса в
        // подсказке оставалось бы имя предыдущего.
        botUsername: DEFAULT_BOT_USERNAME[input.channel],
      }));

      try {
        const result: RequestCodeResult = await requestCode({
          purpose,
          channel: input.channel,
          phone: input.phone,
          ...(input.email !== undefined && { email: input.email }),
          ...(input.slug !== undefined && { slug: input.slug }),
          ...(input.password !== undefined && { password: input.password }),
        });

        input.onSessionCreated?.(result.session_id, result.deep_link);

        setState((prev) => ({
          ...prev,
          sessionId: result.session_id,
          botUsername: result.bot_username,
          deepLink: result.deep_link,
          channel: result.channel,
          stage: result.delivered ? "sent" : "awaiting_bot",
          error: null,
          fieldErrors: null,
        }));

        startCooldown();

        if (result.delivered) {
          toast.success(`Код отправлен в ${CHANNEL_LABEL[result.channel]}`);
        } else {
          // Чат ещё не привязан: начинаем polling и открываем deep-link бота.
          beginPolling(result.session_id, result.channel);
          if (result.deep_link !== null) {
            const { opened } = tryOpenDeepLink(result.deep_link, result.channel, purpose);
            if (!opened) {
              setState((prev) => ({ ...prev, popupBlocked: true }));
            }
          }
          if (purpose === "login") {
            toast.info("Откройте бота и нажмите «Start» — код придёт автоматически");
          }
        }

        return true;
      } catch (error) {
        const fieldErrors =
          error instanceof ApiClientError && error.isValidationError
            ? error.fieldErrors()
            : null;
        setState((prev) => ({
          ...prev,
          stage: "idle",
          error: describeError(error),
          fieldErrors,
        }));
        toast.error(describeError(error));
        return false;
      }
    },
    [purpose, requestCode, startCooldown, beginPolling, describeError],
  );

  const hydrateSession = useCallback(
    (input: {
      sessionId: string;
      channel: AuthChannel;
      verified?: boolean;
      deepLink?: string | null;
    }) => {
      setState((prev) => ({
        ...prev,
        sessionId: input.sessionId,
        channel: input.channel,
        botUsername: DEFAULT_BOT_USERNAME[input.channel],
        deepLink: input.deepLink ?? null,
        stage: input.verified ? "sent" : "awaiting_bot",
        verified: Boolean(input.verified),
        consumed: false,
        popupBlocked: false,
        error: null,
        fieldErrors: null,
      }));
      if (!input.verified) {
        beginPolling(input.sessionId, input.channel);
      }
    },
    [beginPolling],
  );

  const reset = useCallback(() => {
    stopPolling();
    setState({
      stage: "idle",
      sessionId: null,
      deepLink: null,
      botUsername: DEFAULT_BOT_USERNAME.telegram,
      channel: "telegram",
      cooldown: 0,
      error: null,
      fieldErrors: null,
      verified: false,
      consumed: false,
      popupBlocked: false,
    });
  }, [stopPolling]);

  return { ...state, request, reset, hydrateSession, describeError };
}
