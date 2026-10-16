"use client";

import { OnboardingWizard } from "@/components/auth/OnboardingWizard";

export default function OnboardingPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            GETVOXLY
          </h1>
          <p className="text-sm text-slate-400">
            Set up your workspace in under 2 minutes
          </p>
        </div>

        <OnboardingWizard />
      </div>
    </div>
  );
}