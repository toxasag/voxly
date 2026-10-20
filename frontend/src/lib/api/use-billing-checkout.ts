"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/apiClient";

export interface CreateCheckoutPayload {
  amount_rubles: number;
  product_code: "subscription_monthly" | "subscription_yearly" | "ai_balance_topup";
  period_months?: number;
  customer_email?: string;
  description?: string;
  idempotency_key?: string;
}

export interface CheckoutResultDTO {
  paymentId: string;
  invId: number;
  paymentUrl: string;
  amountRubles: number;
  status: string;
  productCode: string;
}

export interface BillingPaymentItem {
  id: string;
  robokassa_inv_id: number;
  amount: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  product_code: string;
  description: string;
  paid_at: string | null;
  created_at: string;
}

export const billingKeys = {
  payments: ["billing", "payments"] as const,
  subscriptions: ["billing", "subscriptions"] as const,
};

/**
 * Создание платёжного счёта Robokassa и получение ссылки для перенаправления.
 */
export function useCreateCheckout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: CreateCheckoutPayload): Promise<CheckoutResultDTO> => {
      const res = await apiClient.post<{ data: CheckoutResultDTO }>("/api/v1/billing/checkout", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: billingKeys.payments });
    },
  });
}

/**
 * История платежей арендатора.
 */
export function useBillingPayments() {
  return useQuery({
    queryKey: billingKeys.payments,
    queryFn: async () => {
      const res = await apiClient.get<{ data: BillingPaymentItem[] }>("/api/v1/billing/payments");
      return res.data;
    },
  });
}
