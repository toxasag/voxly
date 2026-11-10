"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./apiClient";

export interface PrintTemplateDTO {
  id: string;
  slug: "work_order" | "completion_act" | "warranty_ticket" | "receipt";
  name: string;
  description: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  bodyTemplate: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UpdatePrintTemplatePayload {
  name?: string;
  description?: string;
  page_size?: "A4" | "A5" | "thermal_80mm";
  orientation?: "portrait" | "landscape";
  body_template: string;
}

export interface PrintTemplateSettingsDTO {
  id: string;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail: string;
  companyWebsite: string;
  companyInn: string;
  companyOgrn: string;
  workingHours: string;
  logoUrl: string;
  numberingFormat: "compact" | "full";
  numberingPrefix: string;
  intakeTerms: string;
  intakePdnConsent: string;
  showEquipmentSerial: boolean;
  showAppearance: boolean;
  showPackageContents: boolean;
  showDefectDescription: boolean;
  showEstimatedCost: boolean;
  showClientTearOffTicket: boolean;
  showIntakeSignatures: boolean;
  warrantyTerms: string;
  returnPolicy: string;
  showWorksTable: boolean;
  showPartsTable: boolean;
  showCompletionSignatures: boolean;
  showCompletionStamp: boolean;
  updatedAt: string;
}

export type UpdatePrintTemplateSettingsPayload = Partial<{
  company_name: string;
  company_address: string;
  company_phone: string;
  company_email: string;
  company_website: string;
  company_inn: string;
  company_ogrn: string;
  working_hours: string;
  logo_url: string;
  numbering_format: "compact" | "full";
  numbering_prefix: string;
  intake_terms: string;
  intake_pdn_consent: string;
  show_equipment_serial: boolean;
  show_appearance: boolean;
  show_package_contents: boolean;
  show_defect_description: boolean;
  show_estimated_cost: boolean;
  show_client_tear_off_ticket: boolean;
  show_intake_signatures: boolean;
  warranty_terms: string;
  return_policy: string;
  show_works_table: boolean;
  show_parts_table: boolean;
  show_completion_signatures: boolean;
  show_completion_stamp: boolean;
}>;

export const printTemplateKeys = {
  all: ["print-templates"] as const,
  list: () => [...printTemplateKeys.all, "list"] as const,
  detail: (slug: string) => [...printTemplateKeys.all, "detail", slug] as const,
  settings: () => [...printTemplateKeys.all, "settings"] as const,
};

export function usePrintTemplates() {
  return useQuery({
    queryKey: printTemplateKeys.list(),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateDTO[]>("/api/v1/print-templates");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function usePrintTemplate(slug: string) {
  return useQuery({
    queryKey: printTemplateKeys.detail(slug),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateDTO>(`/api/v1/print-templates/${slug}`);
      return res.data;
    },
    enabled: Boolean(slug),
  });
}

export function useUpdatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: UpdatePrintTemplatePayload }) => {
      const res = await apiClient.put<PrintTemplateDTO>(`/api/v1/print-templates/${id}`, payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all });
    },
  });
}

export function usePrintTemplateSettings() {
  return useQuery({
    queryKey: printTemplateKeys.settings(),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateSettingsDTO>("/api/v1/print-templates/settings");
      return res.data;
    },
    staleTime: 60_000,
  });
}

export function useUpdatePrintTemplateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpdatePrintTemplateSettingsPayload) => {
      const res = await apiClient.put<PrintTemplateSettingsDTO>("/api/v1/print-templates/settings", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all });
    },
  });
}

export function formatTicketNumber(
  rawNumber: string | null | undefined,
  format: "compact" | "full" = "compact",
  prefix: string = "№",
): string {
  if (!rawNumber) return "";
  const clean = rawNumber.trim();
  const match = clean.match(/(?:.*-)?(\d+)$/);
  const digits = match && match[1] ? match[1] : clean.replace(/^[^0-9]+/, "");

  if (format === "full") {
    if (clean.includes("-") && !clean.startsWith("№")) {
      return clean;
    }
    const year = new Date().getFullYear();
    const padDigits = digits ? digits.padStart(4, "0") : "0001";
    return `ЗН-${year}-${padDigits}`;
  }

  const padDigits = digits ? digits.padStart(4, "0") : clean;
  const cleanPrefix = prefix ? prefix.trim() : "№";
  return `${cleanPrefix}${padDigits}`;
}

export function getPrintRenderUrl(slug: string, orderId: string): string {
  return `/api/v1/print-templates/${slug}/render?orderId=${encodeURIComponent(orderId)}`;
}
