"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ShieldOff } from "lucide-react";
import type { ModuleSlug, Permission, Role } from "@/types";
import { useAuth } from "@/lib/auth/use-auth";

// ---------------------------------------------------------------------------
// Role hierarchy — higher roles inherit lower-role permissions
// ---------------------------------------------------------------------------

const ROLE_HIERARCHY: Record<Role, Role[]> = {
  owner: ["owner", "admin", "partner", "manager", "technician", "viewer"],
  admin: ["admin", "partner", "manager", "technician", "viewer"],
  partner: ["partner", "manager", "technician", "viewer"],
  manager: ["manager", "technician", "viewer"],
  technician: ["technician", "viewer"],
  viewer: ["viewer"],
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface GuardProps {
  /** Require at least one of these roles */
  requiredRole?: Role[];
  /** Require a specific permission (e.g. "contacts:write") */
  requiredPermission?: Permission;
  /** Require the specified module to be installed */
  requiredModule?: ModuleSlug;
  /** Render this instead of children when the check fails */
  fallback?: ReactNode;
  children: ReactNode;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Guard({
  requiredRole,
  requiredPermission,
  requiredModule,
  fallback = null,
  children,
}: GuardProps) {
  const { user, tenant } = useAuth();

  // Not authenticated — hide
  if (!user) return <>{fallback}</>;

  // Role check
  if (requiredRole && requiredRole.length > 0) {
    const allowedRoles = ROLE_HIERARCHY[user.role] ?? [];
    const hasRole = requiredRole.some((r) => allowedRoles.includes(r));
    if (!hasRole) return <>{fallback}</>;
  }

  // Permission check
  if (requiredPermission && !user.permissions.has(requiredPermission)) {
    return <>{fallback}</>;
  }

  // Module check. Source of truth is the live installedModules query injected
  // into AuthProvider; a stale/assumed list must never grant a disabled route.
  if (requiredModule && tenant) {
    const installed = tenant.installedModules.some(
      (m) => m.slug === requiredModule,
    );
    if (!installed) {
      return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-center">
          <ShieldOff className="h-8 w-8 text-[#4a38f5]" />
          <h2 className="text-lg font-semibold text-[#111111]">Модуль отключён</h2>
          <p className="max-w-sm text-sm text-[#666666]">
            Включите этот модуль в Маркетплейсе, чтобы открыть раздел.
          </p>
          <Link
            href="/marketplace"
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white shadow-xs hover:bg-[#3d2ee0]"
          >
            Открыть Маркетплейс <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      );
    }
  }

  return <>{children}</>;
}