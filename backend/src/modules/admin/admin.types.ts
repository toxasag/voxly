import { z } from "zod";

export const updateTenantSchema = z.object({
  status: z.enum(["trial", "active", "past_due", "suspended"]).optional(),
  plan: z.string().min(1).max(50).optional(),
  subscription_expires_at: z.string().datetime().nullable().optional(),
  /** УСТАРЕЛО: остаток в штуках токенов. Актуален ai_balance_rubles. */
  ai_tokens_balance: z.number().int().nonnegative().optional(),

  /**
   * Наценка платформы на стоимость токенов, % от цены провайдера.
   *
   * Отрицательная допустима как скидка, но не ниже -100%: там цена стала бы
   * отрицательной и расход пополнял бы баланс арендатора. Верхняя граница
   * совпадает с CHECK в БД — проверка на двух уровнях, потому что запрос можно
   * отправить минуя интерфейс.
   */
  ai_markup_percent: z.number().min(-100).max(1000).optional(),

  /** Баланс ИИ в рублях: владелец платформы задаёт его вручную. */
  ai_balance_rubles: z.number().min(0).max(10_000_000).optional(),

  /** Индивидуальная стоимость тарифа в рублях/мес (0 для бесплатного, null для сброса на цену плана). */
  custom_price_rubles: z.number().int().min(0).max(10_000_000).nullable().optional(),

  /** Название индивидуального тарифа («Партнёрский», «Грант», «VIP»). */
  custom_plan_name: z.string().max(100).nullable().optional(),

  /** Сфера деятельности / ниша бизнеса клиента. */
  business_niche: z.string().max(100).nullable().optional(),

  /** Внутренние заметки менеджера платформы (допродажи, договоренности). */
  custom_notes: z.string().max(4000).nullable().optional(),
});

export type UpdateTenantPayload = z.infer<typeof updateTenantSchema>;
