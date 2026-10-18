"use client";

import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fbfbfb] px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">GETVOXLY</h1>
          <p className="text-sm text-[#666666]">
            Регистрация компании и личного поддомена
          </p>
        </div>

        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-8 shadow-2xs">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
