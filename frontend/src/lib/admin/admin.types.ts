export type SubscriptionPlan = "trial" | "starter" | "professional" | "enterprise";

export type TenantStatus = "active" | "trial" | "expired" | "suspended";

export interface PlatformTenant {
  id: string;
  company_name: string;
  slug: string;
  owner_name: string;
  owner_email: string;
  owner_phone: string;
  plan: SubscriptionPlan;
  status: TenantStatus;
  registered_at: string;
  trial_ends_at: string | null;
  subscription_ends_at: string;
  installed_modules: string[];
  ai_tokens_deepseek: number;
  ai_tokens_deepseek_used: number;
  ai_tokens_openai: number;
  ai_tokens_openai_used: number;
  total_revenue: number;
  active_users: number;
}

export interface Referral {
  id: string;
  referrer_id: string;
  referrer_name: string;
  referred_tenant: string;
  referred_plan: SubscriptionPlan;
  status: "pending" | "active" | "paid";
  reward_amount: number;
  reward_currency: string;
  created_at: string;
}

export interface PayoutHistory {
  id: string;
  referrer_name: string;
  amount: number;
  currency: string;
  method: "bank_transfer" | "card" | "paypal";
  status: "pending" | "completed" | "failed";
  paid_at: string | null;
}

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  trial: "Trial",
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
};

const STATUS_LABELS: Record<TenantStatus, string> = {
  active: "Active",
  trial: "Trial",
  expired: "Expired",
  suspended: "Suspended",
};

const STATUS_COLORS: Record<TenantStatus, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  trial: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  expired: "bg-rose-500/10 text-rose-400 border-rose-500/30",
  suspended: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/30",
};

const PLAN_COLORS: Record<SubscriptionPlan, string> = {
  trial: "bg-sky-500/10 text-sky-400 border-sky-500/30",
  starter: "bg-slate-500/10 text-slate-400 border-slate-500/30",
  professional: "bg-[#4a38f5]/10 text-[#4a38f5] border-[#4a38f5]/30",
  enterprise: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
};

export function getPlanLabel(plan: SubscriptionPlan): string {
  return PLAN_LABELS[plan];
}

export function getPlanColors(plan: SubscriptionPlan): string {
  return PLAN_COLORS[plan];
}

export function getStatusLabel(status: TenantStatus): string {
  return STATUS_LABELS[status];
}

export function getStatusColors(status: TenantStatus): string {
  return STATUS_COLORS[status];
}