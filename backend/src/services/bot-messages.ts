import { getEnv } from "../config/env.js";
import { pluralRu } from "../lib/string.utils.js";

// ---------------------------------------------------------------------------
// Общие тексты и склонения для сообщений ботов.
//
// Вынесено из `telegram.service.ts` и `max.service.ts`: оба формируют одно и то
// же сообщение с кодом, и третья копия при добавлении канала неизбежно
// разошлась бы с остальными. Срок действия берётся из конфигурации — прежде в
// обоих сервисах стояли захардкоженные «5 минут», которые начинали врать при
// первом изменении `OTP_TTL_MINUTES` (findings M0.12.13).
// ---------------------------------------------------------------------------

/** Назначение кода. `link` — привязка канала из настроек профиля. */
export type CodePurpose = "register" | "login" | "link";

export const CODE_PURPOSE_LABEL: Record<CodePurpose, string> = {
  register: "регистрации",
  login: "входа",
  link: "привязки аккаунта",
};

/** «5 минут», «2 минуты», «1 минута». */
export function pluralMinutes(count: number): string {
  return pluralRu(count, ["минуту", "минуты", "минут"]);
}

/** Строка «Код действует 5 минут» с актуальным сроком из конфигурации. */
export function codeTtlSentence(): string {
  const ttl = getEnv().OTP_TTL_MINUTES;
  return `Код действует ${ttl} ${pluralMinutes(ttl)}.`;
}
