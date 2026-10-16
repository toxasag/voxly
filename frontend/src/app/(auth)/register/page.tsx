"use client";

import { RegisterForm } from "@/components/auth/RegisterForm";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">GETVOXLY</h1>
          <p className="text-sm text-slate-400">
            Регистрация компании и личного поддомена
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8">
          <RegisterForm />
        </div>
      </div>
    </div>
  );
}
