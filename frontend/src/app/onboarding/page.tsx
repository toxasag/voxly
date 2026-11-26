"use client";

import { OnboardingWizard } from "@/components/auth/OnboardingWizard";
import { Logo } from "@/components/brand";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12 transition-colors">
      <div className="w-full max-w-xl space-y-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Logo size="lg" href="/" />
          <p className="text-[13px] text-[#666666]">
            Настройка рабочего пространства за 2 минуты
          </p>
        </div>

        <OnboardingWizard />
      </div>
    </div>
  );
}