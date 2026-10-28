import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "../config/env.js";
import { AppError } from "../plugins/errorHandler.js";

// ---------------------------------------------------------------------------
// Почтовый сервис (Nodemailer + SMTP.bz).
//
// Транспорт создаётся один раз и переиспользуется: nodemailer держит пул
// соединений, а создание транспорта на каждое письмо открывало бы новое
// TLS-соединение и упиралось бы в лимиты провайдера.
//
// Отправка сознательно не бросает исключение наверх в тех местах, где письмо
// вторично (welcome при регистрации): недоступность SMTP не должна отменять
// уже созданного арендатора. Явный тест (`POST /admin/test-email`) наоборот
// возвращает ошибку, потому что его цель — узнать состояние транспорта.
// ---------------------------------------------------------------------------

export interface SendResult {
  sent: boolean;
  messageId?: string;
  /** Причина отказа: для лога и для ответа диагностического эндпоинта. */
  error?: string;
}

export class EmailNotConfiguredError extends AppError {
  constructor() {
    super(
      503,
      "EMAIL_NOT_CONFIGURED",
      "Почтовый сервис не настроен: не задан SMTP_HOST.",
    );
  }
}

/** Экранирование под HTML-шаблоны: в письма попадают поддомен и адрес. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Шаблон письма
// ---------------------------------------------------------------------------

const BRAND_ORANGE = "#F97316";
const BRAND_ORANGE_DARK = "#EA580C";

/**
 * Каркас брендированного письма.
 *
 * Вся вёрстка на таблицах и inline-стилях: почтовые клиенты (в первую очередь
 * Outlook и Mail.ru) игнорируют внешние стили, flexbox и grid. Светлая тема
 * зафиксирована намеренно — тёмный фон письма в части клиентов инвертируется
 * непредсказуемо.
 */
function layout(options: { title: string; preheader: string; body: string }): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <!-- Прехедер: строка предпросмотра в списке писем. Скрыт в теле. -->
  <div style="display:none;font-size:1px;color:#f8fafc;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
    ${escapeHtml(options.preheader)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background-color:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">

          <!-- Логотип -->
          <tr>
            <td style="padding:28px 32px 8px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="width:36px;height:36px;background-color:${BRAND_ORANGE};border-radius:9px;text-align:center;vertical-align:middle;font-size:18px;font-weight:800;color:#ffffff;line-height:36px;">V</td>
                  <td style="padding-left:12px;font-size:17px;font-weight:700;color:#0f172a;letter-spacing:-0.2px;">Voxly</td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:8px 32px 32px 32px;">
              ${options.body}
            </td>
          </tr>

          <!-- Подпись -->
          <tr>
            <td style="padding:20px 32px;background-color:#f8fafc;border-top:1px solid #e2e8f0;">
              <p style="margin:0 0 6px 0;font-size:13px;color:#475569;">С уважением, команда Voxly</p>
              <p style="margin:0;font-size:12px;color:#94a3b8;">
                <a href="https://getvoxly.ru" style="color:${BRAND_ORANGE_DARK};text-decoration:none;">getvoxly.ru</a>
                &nbsp;·&nbsp; Письмо отправлено автоматически, отвечать на него не нужно.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
  <tr>
    <td style="background-color:${BRAND_ORANGE};border-radius:8px;">
      <a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

// ---------------------------------------------------------------------------
// Сервис
// ---------------------------------------------------------------------------

export class EmailService {
  private static transporter: Transporter | null = null;

  /** Настроен ли транспорт. Без SMTP_HOST отправка невозможна. */
  static get isConfigured(): boolean {
    const env = getEnv();
    return env.SMTP_HOST !== undefined && env.SMTP_HOST.length > 0;
  }

  private static getTransport(): Transporter {
    if (EmailService.transporter !== null) return EmailService.transporter;

    const env = getEnv();
    if (env.SMTP_HOST === undefined) throw new EmailNotConfiguredError();

    EmailService.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      // true → неявный TLS (465), false → STARTTLS (587).
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER !== undefined &&
        env.SMTP_PASS !== undefined && {
          auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        }),
      // Ограничиваем ожидание: зависший SMTP не должен держать HTTP-запрос.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
      pool: true,
      maxConnections: 3,
    });

    return EmailService.transporter;
  }

  /**
   * Базовая отправка. Ошибку возвращает, а не бросает: вызывающий сам решает,
   * критична ли она для его сценария.
   */
  private static async send(options: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }): Promise<SendResult> {
    if (!EmailService.isConfigured) {
      return { sent: false, error: "SMTP is not configured" };
    }

    try {
      const info = await EmailService.getTransport().sendMail({
        from: getEnv().SMTP_FROM,
        to: options.to,
        subject: options.subject,
        html: options.html,
        // Текстовая версия обязательна: без неё спам-фильтры понижают рейтинг
        // письма, а часть клиентов показывает пустое тело.
        text: options.text,
      });

      return { sent: true, messageId: info.messageId };
    } catch (error) {
      return {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown SMTP error",
      };
    }
  }

  /** Код подтверждения (резервный канал, если Telegram недоступен). */
  static async sendVerificationEmail(to: string, code: string): Promise<SendResult> {
    const safeCode = escapeHtml(code);

    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Код подтверждения</h1>
      <p style="margin:0 0 20px 0;font-size:14px;line-height:22px;color:#475569;">
        Используйте этот код, чтобы подтвердить действие в Voxly. Код действует 5 минут.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px 0;">
        <tr>
          <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px 28px;font-size:30px;font-weight:700;letter-spacing:8px;color:#0f172a;font-family:'SF Mono',Menlo,Consolas,monospace;">
            ${safeCode}
          </td>
        </tr>
      </table>
      <p style="margin:0;font-size:13px;line-height:20px;color:#94a3b8;">
        Если вы не запрашивали код, просто проигнорируйте это письмо — никакие действия не будут выполнены.
      </p>`;

    return EmailService.send({
      to,
      subject: `Код подтверждения Voxly: ${code}`,
      html: layout({
        title: "Код подтверждения Voxly",
        preheader: `Ваш код: ${code}. Действует 5 минут.`,
        body,
      }),
      text: `Код подтверждения Voxly: ${code}\n\nКод действует 5 минут.\nЕсли вы не запрашивали код, проигнорируйте это письмо.\n\nКоманда Voxly · getvoxly.ru`,
    });
  }

  /** Приветственное письмо после регистрации арендатора. */
  static async sendWelcomeEmail(to: string, subdomain: string): Promise<SendResult> {
    const portal = `https://${subdomain}.getvoxly.ru`;
    const safePortal = escapeHtml(portal);

    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Добро пожаловать в Voxly</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        Рабочее пространство создано и готово к работе. Ваш личный адрес портала:
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 4px 0;">
        <tr>
          <td style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;font-size:15px;font-weight:600;color:#0f172a;">
            ${safePortal}
          </td>
        </tr>
      </table>
      ${button(portal, "Открыть портал")}
      <p style="margin:0 0 8px 0;font-size:14px;font-weight:600;color:#0f172a;">С чего начать</p>
      <ul style="margin:0 0 16px 0;padding-left:20px;font-size:14px;line-height:24px;color:#475569;">
        <li>Добавьте первые контакты и компании</li>
        <li>Настройте воронку продаж под свой процесс</li>
        <li>Подключите нужные модули в разделе «Маркетплейс модулей»</li>
      </ul>
      <p style="margin:0;font-size:13px;line-height:20px;color:#94a3b8;">
        Вход выполняется по e-mail и паролю с подтверждением кодом из Telegram-бота.
      </p>`;

    return EmailService.send({
      to,
      subject: `Voxly: рабочее пространство ${subdomain}.getvoxly.ru готово`,
      html: layout({
        title: "Добро пожаловать в Voxly",
        preheader: `Портал ${subdomain}.getvoxly.ru создан и готов к работе.`,
        body,
      }),
      text: `Добро пожаловать в Voxly!\n\nВаш портал: ${portal}\n\nС чего начать:\n- Добавьте контакты и компании\n- Настройте воронку продаж\n- Подключите модули в маркетплейсе\n\nКоманда Voxly · getvoxly.ru`,
    });
  }

  /**
   * Приглашение сотрудника в компанию.
   *
   * Роль называется прямо в письме: получатель должен понимать, какой доступ
   * ему выдали, до того как задаст пароль.
   */
  static async sendTeamInviteEmail(options: {
    to: string;
    inviteeName: string;
    companyName: string;
    roleLabel: string;
    link: string;
    expiresInHours: number;
  }): Promise<SendResult> {
    const safeLink = escapeHtml(options.link);
    const safeCompany = escapeHtml(options.companyName);
    const safeName = escapeHtml(options.inviteeName);
    const safeRole = escapeHtml(options.roleLabel);

    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Вас пригласили в ${safeCompany}</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        ${safeName}, для вас создана учётная запись в Voxly — рабочем пространстве компании
        «${safeCompany}». Уровень доступа: <strong style="color:#0f172a;">${safeRole}</strong>.
      </p>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        Чтобы начать работу, задайте пароль и укажите телефон для подтверждения входа.
        Ссылка действует ${options.expiresInHours} часа и срабатывает один раз.
      </p>
      ${button(options.link, "Принять приглашение")}
      <p style="margin:0 0 8px 0;font-size:13px;color:#475569;">Если кнопка не работает, откройте ссылку вручную:</p>
      <p style="margin:0 0 20px 0;font-size:12px;line-height:18px;word-break:break-all;">
        <a href="${safeLink}" style="color:${BRAND_ORANGE_DARK};text-decoration:none;">${safeLink}</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:20px;color:#94a3b8;">
        Если вы не ожидали это приглашение, просто проигнорируйте письмо — учётная запись останется неактивной.
      </p>`;

    return EmailService.send({
      to: options.to,
      subject: `Voxly: приглашение в ${options.companyName}`,
      html: layout({
        title: `Приглашение в ${options.companyName}`,
        preheader: `Задайте пароль и начните работу. Ссылка действует ${options.expiresInHours} часа.`,
        body,
      }),
      text: `Вас пригласили в ${options.companyName}\n\n${options.inviteeName}, для вас создана учётная запись в Voxly.\nУровень доступа: ${options.roleLabel}.\n\nЗадайте пароль по ссылке:\n${options.link}\n\nСсылка действует ${options.expiresInHours} часа и срабатывает один раз.\nЕсли вы не ожидали приглашение, проигнорируйте письмо.\n\nКоманда Voxly · getvoxly.ru`,
    });
  }

  /**
   * Ссылка восстановления пароля.
   *
   * Адрес выводится и текстом рядом с кнопкой: часть клиентов вырезает
   * кнопки-таблицы, и без дублирования у получателя не осталось бы способа
   * перейти по ссылке.
   */
  static async sendPasswordResetEmail(
    to: string,
    link: string,
    ttlMinutes: number,
  ): Promise<SendResult> {
    const safeLink = escapeHtml(link);

    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Восстановление пароля</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        Мы получили запрос на смену пароля в Voxly. Нажмите кнопку ниже, чтобы задать новый пароль.
        Ссылка действует ${ttlMinutes} минут и срабатывает один раз.
      </p>
      ${button(link, "Задать новый пароль")}
      <p style="margin:0 0 8px 0;font-size:13px;color:#475569;">Если кнопка не работает, откройте ссылку вручную:</p>
      <p style="margin:0 0 20px 0;font-size:12px;line-height:18px;word-break:break-all;">
        <a href="${safeLink}" style="color:${BRAND_ORANGE_DARK};text-decoration:none;">${safeLink}</a>
      </p>
      <p style="margin:0;font-size:13px;line-height:20px;color:#94a3b8;">
        Если вы не запрашивали смену пароля, просто проигнорируйте это письмо — текущий пароль останется прежним.
      </p>`;

    return EmailService.send({
      to,
      subject: "Voxly: восстановление пароля",
      html: layout({
        title: "Восстановление пароля Voxly",
        preheader: `Ссылка для смены пароля действует ${ttlMinutes} минут.`,
        body,
      }),
      text: `Восстановление пароля Voxly\n\nЧтобы задать новый пароль, откройте ссылку:\n${link}\n\nСсылка действует ${ttlMinutes} минут и срабатывает один раз.\nЕсли вы не запрашивали смену пароля, проигнорируйте это письмо.\n\nКоманда Voxly · getvoxly.ru`,
    });
  }

  /** Уведомление о смене пароля владельцу аккаунта. */
  static async sendPasswordChangedEmail(to: string, changedAt = new Date()): Promise<SendResult> {
    const stamp = changedAt.toLocaleString("ru-RU", { timeZone: "Europe/Moscow" });
    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Пароль изменён</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        Пароль вашей учётной записи Voxly был изменён ${escapeHtml(stamp)} (МСК).
      </p>
      <p style="margin:0;font-size:13px;line-height:20px;color:#94a3b8;">
        Если это были не вы, немедленно запросите восстановление пароля и обратитесь к администратору компании.
      </p>`;

    return EmailService.send({
      to,
      subject: "Voxly: пароль изменён",
      html: layout({ title: "Пароль изменён", preheader: "Пароль вашей учётной записи Voxly был изменён.", body }),
      text: `Пароль вашей учётной записи Voxly был изменён ${stamp} (МСК).\n\nЕсли это были не вы, запросите восстановление пароля и обратитесь к администратору компании.\n\nКоманда Voxly · getvoxly.ru`,
    });
  }
  /** Диагностическое письмо для `POST /admin/test-email`. */
  static async sendTestEmail(to: string): Promise<SendResult> {
    const env = getEnv();
    const stamp = new Date().toISOString();
    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Проверка почтового сервиса</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        Если вы читаете это письмо, SMTP настроен верно и Voxly может отправлять почту.
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin:0 0 16px 0;">
        <tr><td style="padding:12px 16px;font-size:13px;color:#475569;">
          <strong style="color:#0f172a;">Хост:</strong> ${escapeHtml(env.SMTP_HOST ?? "—")}<br>
          <strong style="color:#0f172a;">Порт:</strong> ${env.SMTP_PORT} (${env.SMTP_SECURE ? "TLS" : "STARTTLS"})<br>
          <strong style="color:#0f172a;">Отправлено:</strong> ${escapeHtml(stamp)}
        </td></tr>
      </table>`;

    return EmailService.send({
      to,
      subject: "Voxly: проверка почтового сервиса",
      html: layout({
        title: "Проверка почтового сервиса",
        preheader: "SMTP настроен верно.",
        body,
      }),
      text: `Проверка почтового сервиса Voxly.\n\nХост: ${env.SMTP_HOST ?? "—"}\nПорт: ${env.SMTP_PORT} (${env.SMTP_SECURE ? "TLS" : "STARTTLS"})\nОтправлено: ${stamp}`,
    });
  }

  /**
   * Сборка темы, HTML и текстовой версии уведомления о новом лиде (без эмодзи).
   */
  static renderLeadNotificationEmail(options: {
    tenantName: string;
    leadTitle: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    telegram?: string | null;
    channel?: string | null;
    stageName?: string | null;
    budget?: number | string | null;
    currency?: string | null;
    conversationSummary?: string | null;
    customFields?: Record<string, unknown> | null;
    createdAt?: Date | string | null;
    crmUrl: string;
  }): { subject: string; html: string; text: string } {
    const safeTitle = escapeHtml(options.leadTitle || "Новая заявка");
    const safeContact = escapeHtml(options.contactName || "Не указано");
    const safePhone = options.phone ? escapeHtml(options.phone) : null;
    const safeEmail = options.email ? escapeHtml(options.email) : null;
    const safeTelegram = options.telegram ? escapeHtml(options.telegram) : null;
    const safeChannel = escapeHtml(options.channel || "Прямое обращение");
    const safeStage = escapeHtml(options.stageName || "Новый лид");

    let formattedDate = "Не указано";
    if (options.createdAt) {
      try {
        const d = new Date(options.createdAt);
        formattedDate = d.toLocaleString("ru-RU", {
          timeZone: "Europe/Moscow",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }) + " (МСК)";
      } catch {
        formattedDate = String(options.createdAt);
      }
    }

    const budgetNum = typeof options.budget === "string" ? parseFloat(options.budget) : options.budget;
    const formattedBudget = budgetNum !== undefined && budgetNum !== null && !isNaN(budgetNum) && budgetNum > 0
      ? `${budgetNum.toLocaleString("ru-RU")} ${escapeHtml(options.currency || "RUB")}`
      : null;

    // Сборка таблицы атрибутов
    const rowsHtml: string[] = [];
    rowsHtml.push(`
      <tr>
        <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;width:38%;border-bottom:1px solid #e2e8f0;">Название заявки</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">${safeTitle}</td>
      </tr>`);

    rowsHtml.push(`
      <tr>
        <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Контактное лицо</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeContact}</td>
      </tr>`);

    if (safePhone) {
      rowsHtml.push(`
        <tr>
          <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Телефон</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">
            <a href="tel:${safePhone}" style="color:#0f172a;text-decoration:none;">${safePhone}</a>
          </td>
        </tr>`);
    }

    if (safeEmail) {
      rowsHtml.push(`
        <tr>
          <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">E-mail</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">
            <a href="mailto:${safeEmail}" style="color:#2563eb;text-decoration:none;">${safeEmail}</a>
          </td>
        </tr>`);
    }

    if (safeTelegram) {
      rowsHtml.push(`
        <tr>
          <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Telegram / Мессенджер</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeTelegram}</td>
        </tr>`);
    }

    rowsHtml.push(`
      <tr>
        <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Источник (канал)</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeChannel}</td>
      </tr>`);

    rowsHtml.push(`
      <tr>
        <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Этап воронки</td>
        <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${safeStage}</td>
      </tr>`);

    if (formattedBudget) {
      rowsHtml.push(`
        <tr>
          <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">Бюджет</td>
          <td style="padding:10px 14px;font-size:13px;color:#0f172a;font-weight:600;border-bottom:1px solid #e2e8f0;">${formattedBudget}</td>
        </tr>`);
    }

    // Кастомные поля из JSONB
    if (options.customFields && typeof options.customFields === "object") {
      for (const [key, val] of Object.entries(options.customFields)) {
        if (val === null || val === undefined || val === "") continue;
        const displayVal = typeof val === "object" ? JSON.stringify(val) : String(val);
        rowsHtml.push(`
          <tr>
            <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;">${escapeHtml(key)}</td>
            <td style="padding:10px 14px;font-size:13px;color:#0f172a;border-bottom:1px solid #e2e8f0;">${escapeHtml(displayVal)}</td>
          </tr>`);
      }
    }

    rowsHtml.push(`
      <tr>
        <td style="padding:10px 14px;background-color:#f8fafc;font-size:13px;color:#64748b;font-weight:600;">Время поступления</td>
        <td style="padding:10px 14px;font-size:13px;color:#64748b;">${escapeHtml(formattedDate)}</td>
      </tr>`);

    const summaryBlockHtml = options.conversationSummary
      ? `
      <div style="background:#f8fafc;border-left:4px solid #3b82f6;padding:12px 16px;margin:16px 0;border-radius:0 8px 8px 0;">
        <strong style="display:block;font-size:13px;color:#1e293b;margin-bottom:6px;">Краткая суть обращения:</strong>
        <div style="font-size:13px;color:#334155;line-height:20px;white-space:pre-line;">${escapeHtml(options.conversationSummary)}</div>
      </div>`
      : "";

    const body = `
      <h1 style="margin:16px 0 6px 0;font-size:20px;font-weight:700;color:#0f172a;">Новая заявка в CRM</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">
        В рабочем пространстве «${escapeHtml(options.tenantName)}» зарегистрирована новая заявка с контактными данными.
      </p>

      ${summaryBlockHtml}

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px 0;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;overflow:hidden;">
        ${rowsHtml.join("")}
      </table>

      ${button(options.crmUrl, "Открыть карточку в CRM")}

      <p style="margin:16px 0 0 0;font-size:12px;color:#94a3b8;line-height:18px;">
        Если кнопка не срабатывает, скопируйте ссылку в браузер:
        <a href="${escapeHtml(options.crmUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(options.crmUrl)}</a>
      </p>`;

    const textLines = [
      `Новая заявка в CRM — ${options.tenantName}`,
      ``,
      `Название: ${options.leadTitle || "Новая заявка"}`,
      `Контакт: ${options.contactName || "Не указано"}`,
    ];
    if (options.conversationSummary) {
      textLines.push(``);
      textLines.push(`Краткая суть обращения:`);
      textLines.push(options.conversationSummary);
      textLines.push(``);
    }
    if (options.phone) textLines.push(`Телефон: ${options.phone}`);
    if (options.email) textLines.push(`E-mail: ${options.email}`);
    if (options.telegram) textLines.push(`Telegram: ${options.telegram}`);
    textLines.push(`Источник: ${options.channel || "Прямое обращение"}`);
    textLines.push(`Этап: ${options.stageName || "Новый лид"}`);
    if (formattedBudget) textLines.push(`Бюджет: ${formattedBudget}`);
    textLines.push(`Время: ${formattedDate}`);
    textLines.push(``);
    textLines.push(`Ссылка на сделку в CRM: ${options.crmUrl}`);
    textLines.push(``);
    textLines.push(`Команда Voxly · getvoxly.ru`);

    return {
      subject: `Новая заявка: ${options.leadTitle || "Заявка с сайта"} (${options.tenantName})`,
      html: layout({
        title: `Новая заявка в CRM: ${options.leadTitle || "Заявка с сайта"}`,
        preheader: `Новая заявка: ${options.leadTitle || "Заявка с сайта"}. Контакт: ${options.contactName || options.phone || options.email || "Получены данные"}.`,
        body,
      }),
      text: textLines.join("\n"),
    };
  }

  /**
   * Уведомление арендатора о новой заявке / лиде.
   * Отправляется асинхронно через BullMQ при переходе из «Первого контакта»
   * или при создании лида с заполненными контактами. Без эмодзи в шаблоне.
   */
  static async sendLeadNotificationEmail(options: {
    to: string;
    tenantName: string;
    leadTitle: string;
    contactName?: string | null;
    phone?: string | null;
    email?: string | null;
    telegram?: string | null;
    channel?: string | null;
    stageName?: string | null;
    budget?: number | string | null;
    currency?: string | null;
    conversationSummary?: string | null;
    customFields?: Record<string, unknown> | null;
    createdAt?: Date | string | null;
    crmUrl: string;
  }): Promise<SendResult> {
    const rendered = EmailService.renderLeadNotificationEmail(options);
    return EmailService.send({
      to: options.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
  }

  /** Напоминание о просроченном счёте. */
  static async sendInvoiceReminderEmail(options: {
    to: string;
    invoiceNumber: string;
    companyName: string;
    total: number;
    currency: string;
    dueDate: Date | string;
  }): Promise<SendResult> {
    const due = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(options.dueDate));
    const amount = `${options.total.toLocaleString("ru-RU")} ${options.currency}`;
    const body = `
      <h1 style="margin:16px 0 8px 0;font-size:20px;font-weight:700;color:#0f172a;">Просрочен счёт ${escapeHtml(options.invoiceNumber)}</h1>
      <p style="margin:0 0 16px 0;font-size:14px;line-height:22px;color:#475569;">Срок оплаты счёта для компании «${escapeHtml(options.companyName)}» истёк ${escapeHtml(due)}.</p>
      <p style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">К оплате: ${escapeHtml(amount)}</p>`;
    return EmailService.send({
      to: options.to,
      subject: `Voxly: просрочен счёт ${options.invoiceNumber}`,
      html: layout({ title: "Просрочен счёт Voxly", preheader: `Счёт ${options.invoiceNumber} требует внимания.`, body }),
      text: `Просрочен счёт ${options.invoiceNumber}\nКомпания: ${options.companyName}\nК оплате: ${amount}\nСрок оплаты: ${due}\n\nКоманда Voxly · getvoxly.ru`,
    });
  }
  /** Проверка соединения и авторизации без отправки письма. */
  static async verifyConnection(): Promise<SendResult> {
    if (!EmailService.isConfigured) {
      return { sent: false, error: "SMTP is not configured" };
    }

    try {
      await EmailService.getTransport().verify();
      return { sent: true };
    } catch (error) {
      return {
        sent: false,
        error: error instanceof Error ? error.message : "Unknown SMTP error",
      };
    }
  }
}
