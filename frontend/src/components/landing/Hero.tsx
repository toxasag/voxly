import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex min-h-[85vh] items-center justify-center overflow-hidden px-6 py-24">
      {/* Градиентный фон-акцент */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-amber-500/[0.07] blur-3xl" />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-1.5 text-sm font-medium text-amber-400">
          CRM нового поколения
        </span>

        <h1 className="text-4xl font-bold leading-tight tracking-tight text-slate-100 sm:text-5xl lg:text-6xl">
          Управляйте клиентами,&nbsp;
          <span className="bg-gradient-to-r from-amber-400 to-orange-400 bg-clip-text text-transparent">
            продажами и&nbsp;сервисом
          </span>
          &nbsp;в&nbsp;одном месте
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
          Модульная B2B-платформа с AI-ботами, омниканальными чатами и встроенным
          сервисным центром. Подключите нужные модули и&nbsp;начните работать за
          минуты.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-6 py-3 text-base font-semibold text-slate-950 transition-all duration-200 hover:bg-amber-400 focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.97]"
          >
            Попробовать бесплатно
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-6 py-3 text-base font-medium text-slate-100 transition-all duration-200 hover:border-slate-600 hover:bg-slate-800 focus-visible:ring-2 focus-visible:ring-slate-400/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.97]"
          >
            <LogIn className="h-4 w-4" />
            Войти
          </Link>
        </div>
      </div>
    </section>
  );
}
