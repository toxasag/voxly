"use client";

import { useAuth } from "@/lib/auth/use-auth";
import {
  LayoutDashboard,
  Handshake,
  Users,
  Building2,
  ListChecks,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";

const STATS = [
  { label: "Всего сделок", value: "24", change: "+12%", up: true, icon: Handshake },
  { label: "Активные контакты", value: "148", change: "+8%", up: true, icon: Users },
  { label: "Компании", value: "32", change: "+3%", up: true, icon: Building2 },
  { label: "Открытые задачи", value: "17", change: "-5%", up: false, icon: ListChecks },
];

export default function DashboardPage() {
  const { user, tenant } = useAuth();
  const displayUser = user ?? { name: "" };
  const displayTenant = tenant ?? { tenantName: "", plan: "", installedModules: [] };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[15px] font-semibold text-[#111111]">
          С возвращением, {displayUser.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-xs text-[#666666]">
          {displayTenant.tenantName} — тариф {displayTenant.plan}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#666666]">{stat.label}</span>
              <div className="rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5">
                <stat.icon className="h-4 w-4 text-[#666666]" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xl font-semibold font-mono tabular-nums text-[#111111]">{stat.value}</span>
              <span
                className={`inline-flex items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums border ${
                  stat.up
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-rose-200 bg-rose-50 text-rose-700"
                }`}
              >
                {stat.up ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {stat.change}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
          <h2 className="text-[13px] font-semibold text-[#111111]">Последние сделки</h2>
          <p className="mt-3 text-xs text-[#888888]">
            Здесь появится воронка сделок.
          </p>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
          <h2 className="text-[13px] font-semibold text-[#111111]">Ближайшие задачи</h2>
          <p className="mt-3 text-xs text-[#888888]">
            Здесь появится список ваших задач.
          </p>
        </div>
      </div>

      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-[#888888]" />
          <h2 className="text-[13px] font-semibold text-[#111111]">Установленные модули</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {displayTenant.installedModules.map((mod) => (
            <span
              key={mod.slug}
              className="rounded-[4px] bg-[#4a38f5]/10 px-2.5 py-1 text-xs font-medium text-[#4a38f5] border border-[#4a38f5]/20"
            >
              {mod.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}