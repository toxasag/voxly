"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiClient, type ApiClientError } from "@/lib/api/apiClient";
import { pageLayoutTabKeys } from "@/lib/api/use-page-layout-tabs";
import { tenantModuleKeys } from "@/lib/api/use-tenant-modules";

// Зеркалит backend/src/modules/marketplace/marketplace.types.ts.

export type BillingKind = "flat" | "per_seat" | "per_unit";

export interface MarketplaceModuleDTO {
  slug: string;
  name: string;
  description: string;
  priceMonthly: number;
  billingKind: BillingKind;
  basePrice: number;
  unitPrice: number;
  includedUnits: number;
  unitLabel: string;
  isMulti: boolean;
  /** Базовый модуль, который нельзя отключить (приходит с сервера). */
  isBaseModule: boolean;
  category: string;
  icon: string;
  trialDays: number;
  features: string[];
  installed: boolean;
  installedAt: string | null;
  quantity: number;
  trialEndsAt: string | null;
  trialActive: boolean;
  monthlyTotal: number;
}

export interface BillingSummaryDTO {
  monthlyTotal: number;
  monthlyAfterTrials: number;
  usersCount: number;
  items: {
    slug: string;
    name: string;
    quantity: number;
    monthlyTotal: number;
    trialActive: boolean;
    trialEndsAt: string | null;
  }[];
  billingProvider?: {
    connected: boolean;
    provider: string | null;
    testMode?: boolean;
  };
}

export const marketplaceKeys = {
  modules: ["marketplace", "modules"] as const,
  billing: ["marketplace", "billing"] as const,
};

/** Каталог модулей с ценами и состоянием подключения текущего арендатора. */
export function useMarketplaceModules(): UseQueryResult<MarketplaceModuleDTO[], ApiClientError> {
  return useQuery({
    queryKey: marketplaceKeys.modules,
    queryFn: async () =>
      (await apiClient.get<MarketplaceModuleDTO[]>("/api/v1/marketplace/modules")).data,
  });
}

/** Сводка по подписке: текущая сумма и сумма после окончания пробных периодов. */
export function useMarketplaceBilling(): UseQueryResult<BillingSummaryDTO, ApiClientError> {
  return useQuery({
    queryKey: marketplaceKeys.billing,
    queryFn: async () =>
      (await apiClient.get<BillingSummaryDTO>("/api/v1/marketplace/billing")).data,
  });
}

interface ToggleResult {
  slug: string;
  enabled: boolean;
  quantity: number;
  trialEndsAt: string | null;
  /**
   * Сколько строк скрыто при отключении либо восстановлено при подключении.
   * Показывается в тосте: без числа пользователь не знает, что произошло с его
   * данными.
   */
  affectedRows: number;
  /** Дата окончательной очистки; null при подключении. */
  purgeAfter: string | null;
  /** Сколько дней данные хранятся; null при подключении. */
  graceDays: number | null;
}

/**
 * Подключение и отключение модуля.
 *
 * Инвалидируется и каталог, и сводка: подключение меняет обе выборки, а
 * рассинхрон показал бы модуль установленным при неизменившейся сумме.
 */
export function useToggleModule(): UseMutationResult<
  ToggleResult,
  ApiClientError,
  { slug: string; enabled: boolean; quantity?: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slug, enabled, quantity }) =>
      (
        await apiClient.post<ToggleResult>(`/api/v1/marketplace/modules/${slug}/toggle`, {
          enabled,
          ...(quantity !== undefined && { quantity }),
        })
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.modules });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.billing });
      // Sidebar и <Guard> читают настоящий tenant catalog, а не marketplace
      // карточки. Эта инвалидация делает видимость пунктов реактивной в том же
      // тике после toggle, без reload страницы.
      void queryClient.invalidateQueries({ queryKey: tenantModuleKeys.all });
      void queryClient.invalidateQueries({ queryKey: pageLayoutTabKeys.all });
    },
  });
}

/** Изменение числа агентов или аккаунтов у подключённого модуля. */
export function useUpdateModuleQuantity(): UseMutationResult<
  { slug: string; quantity: number },
  ApiClientError,
  { slug: string; quantity: number }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ slug, quantity }) =>
      (
        await apiClient.patch<{ slug: string; quantity: number }>(
          `/api/v1/marketplace/modules/${slug}/quantity`,
          { quantity },
        )
      ).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.modules });
      void queryClient.invalidateQueries({ queryKey: marketplaceKeys.billing });
      // Sidebar и <Guard> читают настоящий tenant catalog, а не marketplace
      // карточки. Эта инвалидация делает видимость пунктов реактивной в том же
      // тике после toggle, без reload страницы.
      void queryClient.invalidateQueries({ queryKey: tenantModuleKeys.all });
    },
  });
}

/** Формат рублёвой суммы: 600 ₽, 1 200 ₽. */
export function formatRub(value: number): string {
  return `${new Intl.NumberFormat("ru-RU").format(value)} ₽`;
}

/** Сколько дней осталось до конца пробного периода. */
export function trialDaysLeft(trialEndsAt: string | null): number {
  if (trialEndsAt === null) return 0;
  const diff = new Date(trialEndsAt).getTime() - Date.now();
  return diff <= 0 ? 0 : Math.ceil(diff / 86_400_000);
}
