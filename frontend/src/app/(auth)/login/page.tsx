"use client";

import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-12">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">GETVOXLY</h1>
          <p className="text-sm text-slate-400">Вход в рабочее пространство</p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-8">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}
