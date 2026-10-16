"use client";

import { useMemo, useState, useCallback } from "react";
import { Building2, Users } from "lucide-react";
import { TenantsTable } from "@/components/admin/TenantsTable";
import { TenantManageModal } from "@/components/admin/TenantManageModal";
import { ReferralTab } from "@/components/admin/ReferralTab";
import { Guard } from "@/components/shared/Guard";
import type { PlatformTenant } from "@/lib/admin/admin.types";
import { useAdminTenants, useUpdateTenant } from "@/lib/api/use-admin";
import { MOCK_REFERRALS, MOCK_PAYOUTS } from "@/lib/admin/mock-admin";
import { cn } from "@/lib/utils";

type AdminTab = "tenants" | "referrals";

function mapAdminTenantToPlatform(dto: {
  id: string;
  name: string;
  plan: string;
  status: string;
  ai_tokens_balance: number;
  subscription_expires_at: string | null;
  created_at: string;
  users_count: number;
  modules_count: number;
}): PlatformTenant {
  return {
    id: dto.id,
    company_name: dto.name,
    slug: dto.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    owner_name: "",
    owner_email: "",
    owner_phone: "",
    plan: dto.plan as PlatformTenant["plan"],
    status: dto.status as PlatformTenant["status"],
    registered_at: dto.created_at,
    trial_ends_at: dto.subscription_expires_at,
    subscription_ends_at: dto.subscription_expires_at ?? "",
    installed_modules: [],
    ai_tokens_deepseek: dto.ai_tokens_balance,
    ai_tokens_deepseek_used: 0,
    ai_tokens_openai: 0,
    ai_tokens_openai_used: 0,
    total_revenue: 0,
    active_users: dto.users_count,
  };
}

export default function TenantsPage() {
  const { data: adminTenants = [], isLoading, isError, error, refetch } = useAdminTenants();
  const updateTenant = useUpdateTenant();
  const [activeTab, setActiveTab] = useState<AdminTab>("tenants");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "trial" | "expired" | "suspended">("all");
  const [manageTarget, setManageTarget] = useState<PlatformTenant | null>(null);
  const [manageOpen, setManageOpen] = useState(false);

  const tenants = useMemo(() => adminTenants.map(mapAdminTenantToPlatform), [adminTenants]);

  const filteredTenants = useMemo(() => {
    return tenants.filter((t) => {
      if (filterStatus !== "all" && t.status !== filterStatus) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matches =
          t.company_name.toLowerCase().includes(q) ||
          t.owner_name.toLowerCase().includes(q) ||
          t.owner_email.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q);
        if (!matches) return false;
      }
      return true;
    });
  }, [tenants, filterStatus, searchQuery]);

  const handleManage = useCallback((t: PlatformTenant) => {
    setManageTarget(t);
    setManageOpen(true);
  }, []);

  const handleSaveTenant = useCallback(async (updated: PlatformTenant) => {
    await updateTenant.mutateAsync({
      id: updated.id,
      status: updated.status === "expired" ? "past_due" : updated.status,
      plan: updated.plan === "starter" ? "start" : updated.plan === "professional" ? "business" : updated.plan,
      subscription_expires_at: updated.subscription_ends_at || null,
      ai_tokens_balance: updated.ai_tokens_deepseek,
    });
    setManageTarget(null);
    setManageOpen(false);
  }, [updateTenant]);

  const totalTenants = tenants.length;
  const activeTenants = tenants.filter((t) => t.status === "active" || t.status === "trial").length;
  const totalRevenue = tenants.reduce((sum, t) => sum + t.total_revenue, 0);

  return (
    <Guard requiredRole={["owner"]}>
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-100">Администрирование платформы</h1>
        <p className="mt-1 text-sm text-slate-400">Tenant management, subscriptions, and referral program</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-amber-500/10 p-1.5"><Building2 className="h-4 w-4 text-amber-400" /></div>
            <span className="text-xs font-medium text-slate-500">Всего компаний</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{totalTenants}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-emerald-500/10 p-1.5"><Users className="h-4 w-4 text-emerald-400" /></div>
            <span className="text-xs font-medium text-slate-500">Активные компании</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-100">{activeTenants}</p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-violet-500/10 p-1.5"><Building2 className="h-4 w-4 text-violet-400" /></div>
            <span className="text-xs font-medium text-slate-500">Выручка платформы</span>
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-100">
            {new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(totalRevenue)}
          </p>
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex items-center gap-1 rounded-lg bg-slate-900 border border-slate-800 p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab("tenants")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "tenants"
              ? "bg-amber-500 text-slate-950"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          <Building2 className="h-4 w-4" />
          Tenants
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("referrals")}
          className={cn(
            "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "referrals"
              ? "bg-amber-500 text-slate-950"
              : "text-slate-400 hover:text-slate-200",
          )}
        >
          <Users className="h-4 w-4" />
          Referral Program
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "tenants" ? (
        <TenantsTable
          tenants={filteredTenants}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          onManage={handleManage}
          isLoading={isLoading}
          isError={isError}
          error={error}
          onRetry={refetch}
        />
      ) : (
        <ReferralTab referrals={MOCK_REFERRALS} payouts={MOCK_PAYOUTS} />
      )}

      {/* Modal */}
      <TenantManageModal
        open={manageOpen}
        tenant={manageTarget}
        onClose={() => setManageOpen(false)}
        onSave={handleSaveTenant}
        isSubmitting={updateTenant.isPending}
      />
    </div>
    </Guard>
  );
}