"use client";

import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">GETVOXLY</h1>
          <p className="text-sm text-[#666666]">Вход в рабочее пространство</p>
        </div>

        <div className="rounded-2xl border border-[#e5e5e5] bg-white p-8 shadow-2xs">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
