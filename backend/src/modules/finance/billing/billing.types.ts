import { z } from "zod";

export const PRODUCT_CODES = {
  CRM_BASE: "crm_base",
  EXTRA_SEAT: "extra_seat",
  AI_TOPUP: "ai_topup",
  GIFT_BOT: "gift_bot",
} as const;

export type ProductCode = (typeof PRODUCT_CODES)[keyof typeof PRODUCT_CODES] | string;

export const createCheckoutSchema = z.object({
  amount_rubles: z.coerce
    .number()
    .min(1, "Минимальная сумма платежа — 1 рубль")
    .max(1_000_000, "Максимальная сумма платежа — 1 000 000 рублей"),
  product_code: z.string().min(1, "Укажите код продукта"),
  period_months: z.coerce.number().int().min(1).max(24).optional().default(1),
  description: z.string().max(200).optional(),
  customer_email: z.string().email("Некорректный email").optional(),
  idempotency_key: z.string().max(128).optional(),
});

export type CreateCheckoutPayload = z.input<typeof createCheckoutSchema>;

export interface CheckoutResultDTO {
  paymentId: string;
  invId: number;
  paymentUrl: string;
  amountRubles: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  productCode: string;
}

export interface BillingPaymentRow {
  id: string;
  tenant_id: string;
  subscription_id: string | null;
  robokassa_inv_id: number;
  amount: string;
  balance_applied_rub: string;
  status: "pending" | "paid" | "failed" | "cancelled";
  product_code: string;
  period_months: number | null;
  description: string;
  idempotency_key: string;
  fiscal_receipt: unknown;
  paid_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SubscriptionRow {
  id: string;
  tenant_id: string;
  product_code: string;
  period_months: number;
  seats_included: number;
  extra_seats: number;
  starts_at: Date | string;
  ends_at: Date | string;
  status: "active" | "expired" | "cancelled" | "past_due";
  created_at: Date | string;
  updated_at: Date | string;
}
