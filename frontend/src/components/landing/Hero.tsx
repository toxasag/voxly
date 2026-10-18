import Link from "next/link";
import { ArrowRight, LogIn } from "lucide-react";

export function Hero() {
  return (
    <section className="relative flex min-h-[85vh] items-center justify-center overflow-hidden px-6 py-24">
      {/* Градиентный фон-акцент */}
      <div className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[#4a38f5]/[0.07] blur-3xl" />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#4a38f5]/20 bg-[#4a38f5]/5 px-4 py-1.5 text-sm font-medium text-[#4a38f5]">
          CRM нового поколения
        </span>

        <h1 className="text-4xl font-bold leading-tight tracking-tight text-[#111111] sm:text-5xl lg:text-6xl">
          Управляйте клиентами,&nbsp;
          <span className="bg-gradient-to-r from-[#4a38f5] to-[#7c3aed] bg-clip-text text-transparent">
            продажами и&nbsp;сервисом
          </span>
          &nbsp;в&nbsp;одном месте
        </h1>

        <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-[#666666]">
          Модульная B2B-платформа с AI-ботами, омниканальными чатами и встроенным
          сервисным центром. Подключите нужные модули и&nbsp;начните работать за
          минуты.
        </p>

        <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-6 py-3 text-base font-semibold text-white shadow-xs transition-all duration-200 hover:bg-[#3d2ee0] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.97]"
          >
            Попробовать бесплатно
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-6 py-3 text-base font-medium text-[#111111] shadow-2xs transition-all duration-200 hover:border-[#cccccc] hover:bg-[#fafafa] focus-visible:ring-2 focus-visible:ring-[#4a38f5]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:scale-[0.97]"
          >
            <LogIn className="h-4 w-4" />
            Войти
          </Link>
        </div>
      </div>
    </section>
  );
}
