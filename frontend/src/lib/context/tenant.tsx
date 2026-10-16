"use client";

import type { CurrentUser, InstalledModule, Permission } from "@/types";

export function hasPermission(
  user: CurrentUser,
  permission: Permission,
): boolean {
  return user.permissions.has(permission);
}

export function isModuleInstalled(
  modules: InstalledModule[],
  slug: string,
): boolean {
  return modules.some((m) => m.slug === slug);
}
