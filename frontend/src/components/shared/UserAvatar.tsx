"use client";

import { userInitials, type TenantUserDTO } from "@/lib/api/use-tenant-users";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  user: TenantUserDTO | undefined;
  /** Shown when the id could not be resolved (user removed, catalog loading). */
  fallbackLabel?: string;
  size?: "sm" | "md";
  className?: string;
}

const SIZES = { sm: "h-5 w-5 text-xs", md: "h-7 w-7 text-xs" } as const;

/**
 * Avatar + name for a tenant user. Renders `avatarUrl` when present, otherwise
 * initials. Handles the unresolved case rather than leaking a raw UUID.
 */
export function UserAvatar({ user, fallbackLabel = "Не назначен", size = "sm", className }: UserAvatarProps) {
  const label = user?.fullName ?? fallbackLabel;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      {user?.avatarUrl != null ? (
        // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary external URLs, not build-time assets
        <img src={user.avatarUrl} alt="" className={cn("shrink-0 rounded-full object-cover", SIZES[size])} />
      ) : (
        <span className={cn("flex shrink-0 items-center justify-center rounded-full bg-slate-700 font-semibold text-slate-200", SIZES[size])} aria-hidden="true">
          {user ? userInitials(user.fullName) : "?"}
        </span>
      )}
      <span className="truncate text-xs text-slate-400">{label}</span>
    </span>
  );
}
