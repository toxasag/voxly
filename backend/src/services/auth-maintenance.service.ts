import { query, transaction } from "../db/client.js";

// ---------------------------------------------------------------------------
// Очистка просроченных строк аутентификации (M0.8.12).
//
// Четыре таблицы росли без ограничения: `otp_codes`, `auth_sessions`,
// `password_reset_tokens` и `refresh_tokens`. Ни одна строка в них не удалялась
// никогда — код, сессия подтверждения и ссылка восстановления только помечались
// `consumed_at`, а refresh-токен `revoked_at`. Каждая попытка входа добавляет
// строку в `auth_sessions`, каждое обновление токена — в `refresh_tokens`
// (ротация выпускает новый, не удаляя прежний), поэтому объём растёт линейно от
// трафика, а не от числа пользователей.
//
// Почему не BullMQ, хотя `.cursorrules` §8 называет его для фоновых задач:
// Redis в развёрнутом стеке нет (три контейнера — db, backend, frontend),
// поэтому очередь пришлось бы вводить вместе с новым сервисом ради одной
// периодической задачи. Здесь достаточно `setInterval` в процессе API: работа
// идемпотентна, повторный или пропущенный запуск ничего не портит, а при
// нескольких репликах лишний прогон удалит уже удалённое.
//
// Все четыре таблицы вне RLS (см. schema.sql §8), поэтому очистка выполняется
// без tenant-контекста и удаляет строки всех арендаторов одним запросом.
// ---------------------------------------------------------------------------

/**
 * Сроки хранения после истечения.
 *
 * Не ноль: строка нужна ещё некоторое время после того, как перестала
 * действовать. Удалив просроченный код немедленно, `verifyCode` отвечал бы
 * «Неверный код подтверждения» вместо «Срок действия кода истёк» — разные
 * причины требуют разных действий от пользователя. У `password_reset_tokens`
 * срок больше: `requested_ip` в них — единственный след того, кто запрашивал
 * восстановление, и он нужен при разборе жалоб на чужие письма.
 */
const RETENTION = {
  otpCodesDays: 1,
  authSessionsDays: 1,
  passwordResetTokensDays: 7,
  /**
   * Больше остальных: истёкший или отозванный refresh-токен — свидетельство
   * того, что сессия существовала. Повторное предъявление отозванного токена
   * гасит всю семью (см. `AuthService.refreshToken`), и слишком ранняя очистка
   * превратила бы кражу токена в обычный «Invalid refresh token» без отзыва
   * остальных сессий.
   */
  refreshTokensDays: 30,
  /**
   * Приглашения: срок хранения самого токена после истечения. Строка `users`
   * при этом НЕ удаляется — см. комментарий в `purgeExpiredInvites`.
   */
  inviteTokensDays: 7,
} as const;

export interface MaintenanceReport {
  otp_codes: number;
  auth_sessions: number;
  password_reset_tokens: number;
  refresh_tokens: number;
  invite_tokens: number;
}

/**
 * Число удалённых строк.
 *
 * `RETURNING id` вместо `rowCount`: обёртка `query()` отдаёт только строки, и
 * добавлять к ней прокидывание `rowCount` ради статистики очистки означало бы
 * менять сигнатуру, которой пользуются ~40 мест.
 */
async function deleteAndCount(sql: string, params: readonly (string | number)[]): Promise<number> {
  const rows = await query<{ id: string }>(sql, params);
  return rows.length;
}

/**
 * Просроченные и погашенные коды телефонного OTP.
 *
 * Условие по `consumed_at` нужно отдельно от `expires_at`: погашенный код
 * остаётся в таблице до конца своего TTL, а строк таких столько же, сколько
 * успешных входов.
 */
function purgeOtpCodes(): Promise<number> {
  return deleteAndCount(
    `DELETE FROM otp_codes
     WHERE expires_at < now() - ($1::int * INTERVAL '1 day')
        OR consumed_at < now() - ($1::int * INTERVAL '1 day')
     RETURNING id`,
    [RETENTION.otpCodesDays],
  );
}

/** Сессии подтверждения: регистрация, второй фактор входа, привязка канала. */
function purgeAuthSessions(): Promise<number> {
  return deleteAndCount(
    `DELETE FROM auth_sessions
     WHERE expires_at < now() - ($1::int * INTERVAL '1 day')
        OR consumed_at < now() - ($1::int * INTERVAL '1 day')
     RETURNING id`,
    [RETENTION.authSessionsDays],
  );
}

function purgePasswordResetTokens(): Promise<number> {
  return deleteAndCount(
    `DELETE FROM password_reset_tokens
     WHERE expires_at < now() - ($1::int * INTERVAL '1 day')
        OR consumed_at < now() - ($1::int * INTERVAL '1 day')
     RETURNING id`,
    [RETENTION.passwordResetTokensDays],
  );
}

/**
 * Истёкшие и отозванные refresh-токены — вся просроченная цепочка за один
 * прогон.
 *
 * `replaced_by` ссылается на `refresh_tokens(id)` без `ON DELETE`, то есть
 * `NO ACTION`: удаление строки, на которую ссылается другая, отклонялось бы с
 * 23503. Поэтому ссылки сначала разрываются, и только затем выполняется
 * удаление — обе операции в одной транзакции.
 *
 * Прежняя версия вместо этого пропускала строки, на которые кто-то ссылается
 * (`NOT EXISTS`), и удаляла лишь по одному звену за прогон. `issueTokens` пишет
 * `replaced_by` **старой** строке, указывая на новую, поэтому под условие
 * попадала только голова цепочки, а `NOT EXISTS` вычисляется по снимку начала
 * оператора и каскада не даёт. При ротации раз в 15 минут (`ACCESS_TOKEN_TTL`)
 * это ~96 новых строк в сутки против одной удаляемой: таблица, которую сервис
 * должен ограничивать, продолжала расти.
 *
 * Каскадное удаление здесь по-прежнему было бы неверным: `ON DELETE CASCADE`
 * снёс бы вместе со старым звеном все более новые, включая действующую сессию.
 * Разрыв ссылки безопаснее — `replaced_by` служит только для разбора инцидентов
 * и ни на что в логике входа не влияет.
 */
async function purgeRefreshTokens(): Promise<number> {
  const expired = `(expires_at < now() - ($1::int * INTERVAL '1 day')
                    OR revoked_at < now() - ($1::int * INTERVAL '1 day'))`;

  return transaction(async (tx) => {
    // Снимаем ссылки на удаляемые строки — и у самих удаляемых, и у тех, что
    // остаются (более новое звено ссылается на просроченное).
    await tx.query(
      `UPDATE refresh_tokens
       SET replaced_by = NULL
       WHERE replaced_by IN (SELECT id FROM refresh_tokens WHERE ${expired})`,
      [RETENTION.refreshTokensDays],
    );

    const rows = await tx.query<{ id: string }>(
      `DELETE FROM refresh_tokens WHERE ${expired} RETURNING id`,
      [RETENTION.refreshTokensDays],
    );

    return rows.length;
  });
}

/**
 * Токены просроченных приглашений.
 *
 * Удаляется **только токен**, а не строка `users`.
 *
 * Строка приглашённого сотрудника занимает место в тарифе и видна на
 * `/settings/team` со статусом «Приглашён»; администратор снимает её сам
 * («Удалить»), и тогда она уходит в мягкое удаление. Автоматическое удаление по
 * истечении ссылки означало бы, что сотрудник молча исчезает из списка через
 * неделю, а счёт за место так же молча уменьшается, — решение уровня
 * администратора, а не задачи обслуживания.
 *
 * Токен же обязан исчезнуть: `InviteService.preview` и `accept` и так проверяют
 * `invite_expires_at`, поэтому хранение хеша ничего не даёт, а сузить его
 * присутствие в БД правильно.
 */
function purgeExpiredInvites(): Promise<number> {
  return deleteAndCount(
    `UPDATE users
     SET invite_token_hash = NULL, updated_at = now()
     WHERE invite_token_hash IS NOT NULL
       AND activated_at IS NULL
       AND invite_expires_at < now() - ($1::int * INTERVAL '1 day')
     RETURNING id`,
    [RETENTION.inviteTokensDays],
  );
}

/**
 * Один прогон очистки.
 *
 * Запросы идут последовательно, а не через `Promise.all`: пул ограничен 10
 * соединениями и обслуживает живой трафик, а обслуживание не должно занимать
 * половину пула ради выигрыша в доли секунды.
 */
export async function runAuthMaintenance(): Promise<MaintenanceReport> {
  return {
    otp_codes: await purgeOtpCodes(),
    auth_sessions: await purgeAuthSessions(),
    password_reset_tokens: await purgePasswordResetTokens(),
    refresh_tokens: await purgeRefreshTokens(),
    invite_tokens: await purgeExpiredInvites(),
  };
}

/** Раз в сутки: строки живут днями, чаще запускать нечего. */
const INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Задержка первого прогона после старта.
 *
 * Не сразу: при перезапуске контейнера нагружать БД удалением одновременно с
 * прогревом приложения незачем, а миграции в entrypoint только что закончились.
 */
const INITIAL_DELAY_MS = 60_000;

interface MaintenanceLogger {
  info: (obj: object, message: string) => void;
  error: (obj: object, message: string) => void;
}

/**
 * Ставит очистку на расписание и возвращает функцию остановки.
 *
 * `unref()` на обоих таймерах: иначе ожидающий таймер удерживал бы event loop и
 * процесс не завершался бы по SIGTERM до истечения суток.
 */
export function scheduleAuthMaintenance(log: MaintenanceLogger): () => void {
  let stopped = false;
  let interval: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;

    try {
      const report = await runAuthMaintenance();
      log.info(report, "Auth maintenance completed");
    } catch (error) {
      // Отказ не фатален и не повторяется вручную: следующий прогон через
      // сутки сделает то же самое. Падать из-за очистки нельзя — API работает и
      // с разросшимися таблицами.
      log.error({ error }, "Auth maintenance failed");
    }
  };

  const initial = setTimeout(() => {
    void tick();
    interval = setInterval(() => void tick(), INTERVAL_MS);
    interval.unref();
  }, INITIAL_DELAY_MS);

  initial.unref();

  return () => {
    stopped = true;
    clearTimeout(initial);
    if (interval !== null) clearInterval(interval);
  };
}
