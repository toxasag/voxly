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
}

const RESEND_COOLDOWN_SECONDS = 60;

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
            return;
          }

          try {
            const status = await codeStatus(sessionId);

            if (status.expired) {
              stopPolling();
              setState((prev) => ({ ...prev, stage: "idle", sessionId: null, deepLink: null }));
              toast.error("Срок действия кода истёк. Запросите код заново.");
              return;
            }

            if (status.delivered) {
              stopPolling();
              setState((prev) => ({ ...prev, stage: "sent", deepLink: null }));
              toast.success(`Код отправлен в ${CHANNEL_LABEL[channel]}`);
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
        return fields.phone ?? fields.email ?? fields._root ?? error.message;
      }
      switch (error.code) {
        case "MAX_UNAVAILABLE":
          return "MAX-бот не настроен. Обратитесь к администратору платформы.";
        case "TELEGRAM_UNAVAILABLE":
          return "Telegram-бот не настроен. Обратитесь к администратору платформы.";
        case "TOO_MANY_REQUESTS":
          return "Слишком много запросов кода. Попробуйте через минуту.";
        default:
          return error.message;
      }
    }
    return "Нет связи с сервером. Проверьте подключение и повторите попытку.";
  }, []);

  const request = useCallback(
    async (input: { channel: AuthChannel; phone: string; email?: string }): Promise<boolean> => {
      setState((prev) => ({
        ...prev,
        stage: "requesting",
        channel: input.channel,
        // Заранее подставляем бота выбранного канала: иначе на время запроса в
        // подсказке оставалось бы имя предыдущего.
        botUsername: DEFAULT_BOT_USERNAME[input.channel],
      }));

      try {
        const result: RequestCodeResult = await requestCode({ purpose, ...input });

        setState((prev) => ({
          ...prev,
          sessionId: result.session_id,
          botUsername: result.bot_username,
          deepLink: result.deep_link,
          channel: result.channel,
          stage: result.delivered ? "sent" : "awaiting_bot",
        }));

        startCooldown();

        if (result.delivered) {
          toast.success(`Код отправлен в ${CHANNEL_LABEL[result.channel]}`);
        } else {
          // Чат ещё не привязан: код придёт после нажатия Start.
          toast.info("Откройте бота и нажмите «Start» — код придёт автоматически");
          beginPolling(result.session_id, result.channel);
        }

        return true;
      } catch (error) {
        setState((prev) => ({ ...prev, stage: "idle" }));
        toast.error(describeError(error));
        return false;
      }
    },
    [purpose, requestCode, startCooldown, beginPolling, describeError],
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
    });
  }, [stopPolling]);

  return { ...state, request, reset, describeError };
}
