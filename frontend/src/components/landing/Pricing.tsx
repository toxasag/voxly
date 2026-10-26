import Link from "next/link";
import { Check } from "lucide-react";

type Plan = {
  name: string;
  price: string;
  period: string;
  description: string;
  highlight: boolean;
  features: string[];
};

const plans: Plan[] = [
  {
    name: "Старт",
    price: "0",
    period: "/ мес",
    description: "Для знакомства с платформой",
    highlight: false,
    features: [
      "До 100 контактов",
      "CRM-модуль",
      "1 пользователь",
      "Email-поддержка",
    ],
  },
  {
    name: "Бизнес",
    price: "4 990",
    period: "/ мес",
    description: "Для растущих команд",
    highlight: true,
    features: [
      "Неограниченные контакты",
      "CRM + Сервисный центр",
      "WhatsApp и Telegram",
      "AI-бот (базовый)",
      "До 5 пользователей",
      "Приоритетная поддержка",
    ],
  },
  {
    name: "Enterprise",
    price: "Индивидуально",
    period: "",
    description: "Полный контроль и кастомизация",
    highlight: false,
    features: [
      "Все модули включены",
      "Неограниченные пользователи",
      "AI-боты (продвинутые)",
      "SLA 99.9%",
      "Выделенный менеджер",
      "Кастомные интеграции",
    ],
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="px-6 py-24 border-t border-[#e5e5e5] bg-white">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#111111] sm:text-4xl">
            Простые и прозрачные тарифы
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-[#666666]">
            Начните бесплатно. Масштабируйтесь, когда будете готовы.
          </p>
        </div>

        <div className="mt-16 grid gap-6 lg:grid-cols-3">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={"relative rounded-[8px] border p-6 transition-all duration-200 " + (plan.highlight ? "border-2 border-[#4a38f5] bg-white shadow-md" : "border-[#e5e5e5] bg-white shadow-2xs hover:border-[#cccccc]")}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-6 rounded-full bg-[#4a38f5] px-3 py-0.5 text-xs font-semibold text-white shadow-xs">
                  Популярный
                </span>
              )}

              <h3 className="text-lg font-semibold text-[#111111]">
                {plan.name}
              </h3>
              <p className="mt-1 text-sm text-[#666666]">{plan.description}</p>

              <div className="mt-6 flex items-baseline gap-1">
                <span className="text-4xl font-bold font-mono text-[#111111] tabular-nums">
                  {plan.price === "0" ? "Бесплатно" : plan.price}
                </span>
                {plan.period && (
                  <span className="text-sm text-[#666666]">{plan.period}</span>
                )}
              </div>

              <Link
                href="/login"
                className={"mt-8 flex w-full items-center justify-center rounded-[8px] px-4 py-2.5 text-sm font-semibold transition-all duration-200 active:scale-[0.97] " +
                  (plan.highlight
                    ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] shadow-xs focus-visible:ring-2 focus-visible:ring-[#4a38f5]/50"
                    : "border border-[#e5e5e5] bg-[#fafafa] text-[#111111] hover:bg-[#f0f0f0] hover:border-[#cccccc] shadow-2xs focus-visible:ring-2 focus-visible:ring-[#4a38f5]/20")}
              >
                {plan.price === "0" ? "Начать" : "Подключить"}
              </Link>

              <ul className="mt-8 space-y-3">
                {plan.features.map((feat) => (
                  <li key={feat} className="flex items-start gap-3 text-sm text-[#111111]">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#15803d]" />
                    {feat}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
