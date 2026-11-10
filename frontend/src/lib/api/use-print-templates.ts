"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./apiClient";

// ---------------------------------------------------------------------------
// Print Layout & Template Types (Visual Designer)
// ---------------------------------------------------------------------------

export type PrintSectionType =
  | "header"
  | "customer"
  | "equipment"
  | "works_table"
  | "parts_table"
  | "totals"
  | "terms"
  | "signatures"
  | "tear_off_ticket";

export interface PrintLayoutColumn {
  id: string;
  label: string;
  visible: boolean;
  widthPercent?: number;
}

export interface PrintLayoutTheme {
  fontFamily: "Inter" | "Arial" | "Times New Roman" | "Roboto";
  fontSize: "small" | "medium" | "large";
  primaryColor: string;
  margins: "compact" | "normal" | "spacious";
  accentHeaders: boolean;
  showBorders: boolean;
}

export interface PrintLayoutHeader {
  showLogo: boolean;
  logoUrl?: string;
  logoWidth: number;
  showCompanyDetails: boolean;
  companyName: string;
  companyAddress: string;
  companyPhone: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyInn?: string;
  companyOgrn?: string;
  workingHours?: string;
  documentTitle: string;
  documentSubtitle?: string;
  showDate: boolean;
  showDocNumber: boolean;
}

export interface PrintLayoutCustomer {
  visible: boolean;
  title: string;
  showName: boolean;
  showPhone: boolean;
  showEmail: boolean;
  showAddress: boolean;
  showPassport: boolean;
}

export interface PrintLayoutEquipment {
  visible: boolean;
  title: string;
  showTypeBrandModel: boolean;
  showSerial: boolean;
  showDefect: boolean;
  showAppearance: boolean;
  showPackage: boolean;
  showMaster: boolean;
  showEstimatedCost: boolean;
}

export interface PrintLayoutTable {
  visible: boolean;
  worksTitle: string;
  partsTitle: string;
  columns: PrintLayoutColumn[];
  showWorks: boolean;
  showParts: boolean;
  showVat: boolean;
  vatRate: number;
  showDiscount: boolean;
  showTotals: boolean;
  showGrandTotalWords: boolean;
}

export interface PrintLayoutTerms {
  visible: boolean;
  title: string;
  termsText: string;
  showPdnConsent: boolean;
  pdnText: string;
  showWarrantyText: boolean;
  warrantyDays: number;
}

export interface PrintLayoutSignatures {
  visible: boolean;
  showExecutor: boolean;
  executorTitle: string;
  showClient: boolean;
  clientTitle: string;
  showStamp: boolean;
  stampText: string;
}

export interface PrintLayoutTearOffTicket {
  visible: boolean;
  title: string;
  showBarcodeOrQr: boolean;
  customNote: string;
}

export interface PrintLayoutConfig {
  sectionsOrder: string[];
  theme: PrintLayoutTheme;
  header: PrintLayoutHeader;
  customer: PrintLayoutCustomer;
  equipment: PrintLayoutEquipment;
  table: PrintLayoutTable;
  terms: PrintLayoutTerms;
  signatures: PrintLayoutSignatures;
  tearOffTicket: PrintLayoutTearOffTicket;
}

export interface PrintTemplateDTO {
  id: string;
  slug: string;
  name: string;
  description: string;
  documentType: string;
  pageSize: "A4" | "A5" | "thermal_80mm";
  orientation: "portrait" | "landscape";
  bodyTemplate: string;
  layoutConfig: PrintLayoutConfig;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePrintTemplatePayload {
  name: string;
  description?: string;
  document_type?: string;
  page_size?: "A4" | "A5" | "thermal_80mm";
  orientation?: "portrait" | "landscape";
  layout_config?: PrintLayoutConfig;
  body_template?: string;
  is_default?: boolean;
  clone_from_id?: string;
}

export interface UpdatePrintTemplatePayload {
  name?: string;
  description?: string;
  document_type?: string;
  page_size?: "A4" | "A5" | "thermal_80mm";
  orientation?: "portrait" | "landscape";
  layout_config?: PrintLayoutConfig;
  body_template?: string;
  is_default?: boolean;
}

// ---------------------------------------------------------------------------
// Legacy Print Template Settings DTO (Реквизиты, брендинг, правила нумерации)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// React Query Keys
// ---------------------------------------------------------------------------

export const printTemplateKeys = {
  all: ["print-templates"] as const,
  list: (type?: string) => [...printTemplateKeys.all, "list", type ?? "all"] as const,
  detail: (idOrSlug: string) => [...printTemplateKeys.all, "detail", idOrSlug] as const,
  settings: () => [...printTemplateKeys.all, "settings"] as const,
};

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function usePrintTemplates(documentType?: string) {
  return useQuery({
    queryKey: printTemplateKeys.list(documentType),
    queryFn: async () => {
      const query = documentType ? { document_type: documentType } : undefined;
      const res = await apiClient.get<PrintTemplateDTO[]>("/api/v1/print-templates", { query });
      if (Array.isArray(res.data)) {
        return res.data;
      }
      return [];
    },
    staleTime: 30_000,
  });
}

export function usePrintTemplate(idOrSlug: string) {
  return useQuery({
    queryKey: printTemplateKeys.detail(idOrSlug),
    queryFn: async () => {
      const res = await apiClient.get<PrintTemplateDTO>(`/api/v1/print-templates/${idOrSlug}`);
      return res.data;
    },
    enabled: Boolean(idOrSlug),
  });
}

export function useCreatePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePrintTemplatePayload) => {
      const res = await apiClient.post<PrintTemplateDTO>("/api/v1/print-templates", payload);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all });
    },
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

export function useSetDefaultPrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.post<PrintTemplateDTO>(`/api/v1/print-templates/${id}/set-default`);
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: printTemplateKeys.all });
    },
  });
}

export function useDeletePrintTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiClient.delete<{ deleted: boolean }>(`/api/v1/print-templates/${id}`);
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

export function getPrintRenderUrl(slugOrId: string, orderId: string): string {
  return `/api/v1/print-templates/${encodeURIComponent(slugOrId)}/render?orderId=${encodeURIComponent(orderId)}`;
}
