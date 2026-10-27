"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LeadNotificationChannels } from "@/components/settings/LeadNotificationChannels";
import { Guard } from "@/components/shared/Guard";

export default function NotificationSettingsPage() {
  return (
    <Guard requiredPermission="tenant:admin">
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Назад к настройкам</span>
          </Link>
        </div>

        <LeadNotificationChannels />
      </div>
    </Guard>
  );
}
