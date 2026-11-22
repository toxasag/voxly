"use client";

import { LoginForm } from "@/components/auth/LoginForm";
import { Logo } from "@/components/brand";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12 transition-colors">
      <div className="w-full max-w-md space-y-8">
        <div className="flex flex-col items-center space-y-2 text-center">
          <Logo size="lg" href="/" />
          <p className="text-sm text-[#666666]">Вход в рабочее пространство</p>
        </div>

        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-8 shadow-2xs transition-colors">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
