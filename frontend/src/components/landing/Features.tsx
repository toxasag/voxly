import {
  Bot,
  MessageSquare,
  Users,
  Puzzle,
  BarChart3,
  Headphones,
} from "lucide-react";

type Feature = {
  icon: React.ElementType;
  title: string;
  description: string;
};

const features: Feature[] = [
  {
    icon: Bot,
    title: "AI-боты",
    description:
      "Плагинные LLM-ассистенты для продаж, поддержки и автоматизации рутинных задач. Настройте промпт — бот работает 24/7.",
  },
  {
    icon: MessageSquare,
    title: "Омниканальные чаты",
    description:
      "WhatsApp, Telegram и другие каналы в едином интерфейсе. Клиент пишет откуда удобно — вы отвечаете в CRM.",
  },
  {
    icon: Users,
    title: "CRM",
    description:
      "Контакты, компании, сделки с Kanban-доской и таймлайном. Полная история коммуникаций по каждому клиенту.",
  },
  {
    icon: Headphones,
    title: "Сервисный центр",
    description:
      "Ремонтные заказы, склад запчастей, учёт устройств. Модуль для сервисных бизнесов из коробки.",
  },
  {
    icon: BarChart3,
    title: "Финансы",
    description:
      "Счета, транзакции, кассовые счета и аналитика. Интеграция с бухгалтерией через универсальный API.",
  },
  {
    icon: Puzzle,
    title: "Модульная архитектура",
    description:
      "Подключайте только нужные модули через маркетплейс. Изолированные данные, единая база клиентов.",
  },
];

export function Features() {
  return (
    <section id="features" className="px-6 py-24 border-t border-[#e5e5e5] bg-[#fafafa]">
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight text-[#111111] sm:text-4xl">
            Всё, что нужно вашему бизнесу
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-[#666666]">
            Каждый модуль работает самостоятельно и интегрируется с другими.
            Подключайте то, что нужно сейчас — остальное добавите позже.
          </p>
        </div>

        <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const Icon = f.icon;
            return (
              <div
                key={f.title}
                className="rounded-[8px] border border-[#e5e5e5] bg-white p-6 shadow-2xs transition-colors duration-200 hover:border-[#cccccc] hover:shadow-xs"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#4a38f5]/10">
                  <Icon className="h-5 w-5 text-[#4a38f5]" />
                </div>
                <h3 className="text-lg font-semibold text-[#111111]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#666666]">
                  {f.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
