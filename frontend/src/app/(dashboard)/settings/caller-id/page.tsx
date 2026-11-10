"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import {
  PhoneCall,
  Smartphone,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Search,
  Building2,
  Briefcase,
  Play,
  Loader2,
  ChevronLeft,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/apiClient";
import { TagPill } from "@/components/ui/tag";

interface CallerIdContact {
  id: string;
  fullName: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  phone: string;
  jobTitle?: string;
  companyName?: string;
  crmUrl: string;
  activeDeal?: {
    id: string;
    title: string;
    budget: number;
    currency: string;
    stageName: string;
  } | null;
}

interface LookupResult {
  found: boolean;
  phone: string;
  normalizedPhone: string;
  contact: CallerIdContact | null;
}

export default function CallerIdSettingsPage() {
  const [testPhone, setTestPhone] = useState("+7 (999) 123-45-67");
  const [lookupResult, setLookupResult] = useState<LookupResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [copied, setCopied] = useState(false);

  // Образец токена для мобильного компаньона
  const companionToken = "voxly_live_device_token_sample";

  const handleCopyToken = () => {
    navigator.clipboard.writeText(companionToken);
    setCopied(true);
    toast.success("Токен скопирован в буфер обмена");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLookup = useCallback(async () => {
    if (!testPhone.trim()) return;
    setIsLoading(true);
    try {
      const res = await apiClient.get<LookupResult>(
        `/api/v1/crm/contacts/caller-id-lookup?phone=${encodeURIComponent(testPhone.trim())}`
      );
      setLookupResult(res.data);
      if (res.data.found) {
        toast.success(`Контакт найден: ${res.data.contact?.fullName}`);
      } else {
        toast.info("Контакт с таким номером не найден в базе CRM");
      }
    } catch {
      toast.error("Ошибка при проверке номера телефона");
    } finally {
      setIsLoading(false);
    }
  }, [testPhone]);

  const handleSimulateCall = useCallback(async () => {
    setIsSimulating(true);
    try {
      await apiClient.post("/api/v1/crm/contacts/caller-id-log", {
        phone: testPhone.trim(),
        direction: "inbound",
        status: "answered",
        duration_seconds: 45,
        contact_id: lookupResult?.contact?.id,
        deal_id: lookupResult?.contact?.activeDeal?.id,
      });
      toast.success("Входящий звонок зафиксирован в таймлайне CRM");
    } catch {
      toast.error("Не удалось эмулировать звонок");
    } finally {
      setIsSimulating(false);
    }
  }, [testPhone, lookupResult]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Навигация назад */}
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#666666] transition-colors hover:text-[#111111]"
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Назад в настройки</span>
      </Link>

      {/* Заголовок */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl font-bold tracking-tight text-[#111111]">
              Определитель номера (Caller ID)
            </h1>
            <TagPill color="emerald">Активно</TagPill>
          </div>
          <p className="mt-1 text-xs text-[#666666]">
            Идентификация входящих GSM-звонков на SIM-карты смартфонов сотрудников и всплывающие карточки клиентов в CRM
          </p>
        </div>
      </div>

      {/* Блок 1: Как это работает */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <h2 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
          <Smartphone className="h-4 w-4 text-[#4a38f5]" />
          <span>Android Companion App (Мобильный АОН)</span>
        </h2>
        <p className="mt-1.5 text-xs text-[#666666] leading-relaxed">
          Легковесная системная служба Android перехватывает номер входящего звонка SIM-карты за 10 мс,
          запрашивает базу GETVOXLY и выводит плавающее окно поверх стандартной звонилки телефона:
          имя клиента, компанию, сумму и стадию текущей сделки.
        </p>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-[8px] border border-[#f0f0f0] bg-[#fafafa] p-3">
            <span className="text-[11px] font-semibold text-[#111111]">1. Звонок на SIM</span>
            <p className="mt-0.5 text-[11px] text-[#666666]">
              Клиент звонит мастеру или менеджеру на обычный рабочий мобильный телефон.
            </p>
          </div>
          <div className="rounded-[8px] border border-[#f0f0f0] bg-[#fafafa] p-3">
            <span className="text-[11px] font-semibold text-[#111111]">2. Оверлей на экране</span>
            <p className="mt-0.5 text-[11px] text-[#666666]">
              Поверх экрана звонка появляется карточка: кто звонит, из какой компании и по какой сделке.
            </p>
          </div>
          <div className="rounded-[8px] border border-[#f0f0f0] bg-[#fafafa] p-3">
            <span className="text-[11px] font-semibold text-[#111111]">3. Карточка на мониторе</span>
            <p className="mt-0.5 text-[11px] text-[#666666]">
              В открытой CRM на компьютере автоматически выдвигается карточка сделки еще до снятия трубки.
            </p>
          </div>
        </div>
      </div>

      {/* Блок 2: Интерактивный симулятор Caller ID */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs">
        <h2 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-[#4a38f5]" />
          <span>Симулятор и проверка номера</span>
        </h2>
        <p className="mt-1 text-xs text-[#666666]">
          Проверьте, какую информацию покажет мобильный компаньон сотрудника при входящем звонке с этого номера
        </p>

        <div className="mt-4 flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#888888]" />
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              placeholder="+7 (999) 123-45-67"
              className="h-9 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>
          <button
            type="button"
            onClick={() => void handleLookup()}
            disabled={isLoading}
            className="flex h-9 items-center justify-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            <span>Проверить номер</span>
          </button>
        </div>

        {/* Превью всплывающей плавающей карточки Caller ID */}
        {lookupResult && (
          <div className="mt-5 rounded-[12px] border border-[#e5e5e5] bg-[#fafafa] p-4">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-2.5">
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#4a38f5]">
                  Превью оверлея на экране смартфона
                </span>
              </div>
              <span className="text-[11px] text-[#888888]">{lookupResult.normalizedPhone}</span>
            </div>

            {lookupResult.found && lookupResult.contact ? (
              <div className="mt-3 space-y-2.5">
                <div>
                  <h3 className="text-base font-bold text-[#111111]">
                    {lookupResult.contact.fullName}
                  </h3>
                  <div className="mt-0.5 flex flex-wrap items-center gap-3 text-xs text-[#666666]">
                    {lookupResult.contact.companyName && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5 text-[#888888]" />
                        <span>{lookupResult.contact.companyName}</span>
                      </span>
                    )}
                    {lookupResult.contact.jobTitle && (
                      <span className="flex items-center gap-1">
                        <Briefcase className="h-3.5 w-3.5 text-[#888888]" />
                        <span>{lookupResult.contact.jobTitle}</span>
                      </span>
                    )}
                  </div>
                </div>

                {lookupResult.contact.activeDeal ? (
                  <div className="rounded-[6px] border border-[#fef08a] bg-[#fefce8] p-2.5 text-xs text-[#854d0e]">
                    <div className="flex items-center justify-between font-semibold">
                      <span>Сделка: {lookupResult.contact.activeDeal.title}</span>
                      <span>
                        {lookupResult.contact.activeDeal.budget.toLocaleString("ru-RU")}{" "}
                        {lookupResult.contact.activeDeal.currency}
                      </span>
                    </div>
                    <span className="mt-0.5 block text-[11px] text-[#a16207]">
                      Этап воронки: {lookupResult.contact.activeDeal.stageName}
                    </span>
                  </div>
                ) : (
                  <div className="rounded-[6px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#888888]">
                    Активных сделок нет (только карточка контакта)
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <a
                    href={lookupResult.contact.crmUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
                  >
                    <span>Открыть карточку в CRM</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>

                  <button
                    type="button"
                    onClick={() => void handleSimulateCall()}
                    disabled={isSimulating}
                    className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#f5f5f5]"
                  >
                    {isSimulating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 text-emerald-600" />}
                    <span>Эмулировать звонок</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 text-xs text-[#666666]">
                Контакт с таким номером не зарегистрирован в CRM. Будет отображен стандартный номер звонящего.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Блок 3: Подключение и исходный код */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
        <h2 className="text-sm font-semibold text-[#111111] flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-[#4a38f5]" />
          <span>Подключение телефона сотрудника</span>
        </h2>

        <div>
          <label className="block text-xs font-medium text-[#666666]">
            API адрес сервера
          </label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="text"
              readOnly
              value="https://api.getvoxly.ru"
              className="h-8 w-full max-w-md rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3 text-[13px] text-[#111111]"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#666666]">
            Репозиторий проекта Companion App
          </label>
          <p className="mt-1 text-xs text-[#666666]">
            Исходный код нативного Android-приложения (Kotlin) находится в папке <code className="rounded bg-[#f5f5f5] px-1.5 py-0.5 font-mono text-[11px] text-[#111111]">mobile/android-companion</code> репозитория и собирается через Android Studio или GitHub Actions.
          </p>
        </div>
      </div>
    </div>
  );
}
