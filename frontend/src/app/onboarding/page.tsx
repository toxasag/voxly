"use client";

import { OnboardingWizard } from "@/components/auth/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">
            GETVOXLY
          </h1>
          <p className="text-sm text-[#666666]">
            Настройка рабочего пространства за 2 минуты
          </p>
        </div>

        <OnboardingWizard />
      </div>
    </div>
  );
}