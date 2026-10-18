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
        <h1 className="text-xl font-bold text-slate-100">
          С возвращением, {displayUser.name.split(" ")[0]}
        </h1>
        <p className="mt-1 text-sm text-slate-400">
          {displayTenant.tenantName} — тариф {displayTenant.plan}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-slate-800 bg-slate-900 p-5 transition-colors hover:border-slate-700"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{stat.label}</span>
              <div className="rounded-lg bg-slate-800 p-1.5">
                <stat.icon className="h-4 w-4 text-slate-400" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">{stat.value}</span>
              <span
                className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                  stat.up ? "text-emerald-400" : "text-rose-400"
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
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-sm font-semibold text-slate-200">Последние сделки</h2>
          <p className="mt-3 text-sm text-slate-500">
            Здесь появится воронка сделок.
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
          <h2 className="text-sm font-semibold text-slate-200">Ближайшие задачи</h2>
          <p className="mt-3 text-sm text-slate-500">
            Здесь появится список ваших задач.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-200">Установленные модули</h2>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {displayTenant.installedModules.map((mod) => (
            <span
              key={mod.slug}
              className="rounded-md bg-[#4a38f5]/10 px-3 py-1.5 text-xs font-medium text-amber-400 border border-[#4a38f5]/20"
            >
              {mod.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}