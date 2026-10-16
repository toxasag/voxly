import { z } from "zod";

export const ownerSchema = z.object({
  first_name: z.string().min(1, "First name is required").max(100),
  last_name: z.string().min(1, "Last name is required").max(100),
});

export type OwnerFormValues = z.infer<typeof ownerSchema>;

export const workspaceSchema = z.object({
  company_name: z.string().min(1, "Company name is required").max(200),
  slug: z
    .string()
    .min(3, "Slug must be at least 3 characters")
    .max(30, "Slug must be at most 30 characters")
    .regex(
      /^[a-z0-9]+(-[a-z0-9]+)*$/,
      "Only lowercase letters, numbers and hyphens. Cannot start or end with a hyphen.",
    ),
  currency: z.enum(["RUB", "USD", "EUR", "KZT", "BYN"], {
    errorMap: () => ({ message: "Select a currency" }),
  }),
  timezone: z.string().min(1, "Timezone is required"),
});

export type WorkspaceFormValues = z.infer<typeof workspaceSchema>;

export const businessDomainSchema = z.object({
  domain: z.enum(["service_center", "retail", "services"], {
    errorMap: () => ({ message: "Select your business domain" }),
  }),
});

export type BusinessDomainValues = z.infer<typeof businessDomainSchema>;

export type OnboardingStep = "owner" | "workspace" | "business" | "finish";

export interface OnboardingState {
  step: OnboardingStep;
  owner: OwnerFormValues;
  workspace: WorkspaceFormValues;
  business: BusinessDomainValues;
  installedModules: string[];
}

export const CURRENCY_OPTIONS = [
  { value: "RUB", label: "₽ RUB — Russian Ruble" },
  { value: "USD", label: "$ USD — US Dollar" },
  { value: "EUR", label: "€ EUR — Euro" },
  { value: "KZT", label: "₸ KZT — Kazakhstani Tenge" },
  { value: "BYN", label: "Br BYN — Belarusian Ruble" },
] as const;

export const TIMEZONE_OPTIONS = [
  "Europe/Moscow",
  "Europe/Minsk",
  "Europe/Kyiv",
  "Asia/Almaty",
  "Asia/Tashkent",
  "Asia/Baku",
  "Asia/Yerevan",
  "Asia/Tbilisi",
  "Europe/Istanbul",
  "Europe/Berlin",
  "Europe/London",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
] as const;

export const BUSINESS_DOMAIN_MODULES: Record<
  string,
  { name: string; modules: string[] }
> = {
  service_center: {
    name: "Service Center",
    modules: ["service_center", "ai_bots"],
  },
  retail: {
    name: "Retail & Trade",
    modules: ["finance"],
  },
  services: {
    name: "Professional Services",
    modules: ["finance", "ai_bots"],
  },
};