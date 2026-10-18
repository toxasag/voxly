"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  Calendar,
  Check,
  Clock,
  Globe,
  Hash,
  HelpCircle,
  Layers,
  Loader2,
  MessageCircle,
  MessageSquareText,
  Save,
  Send,
  Sparkles,
  Users,
} from "lucide-react";
import {
  type AdminMarketplaceModuleDTO,
  type AdminPlatformBillingConfigDTO,
  useAdminBillingConfig,
  useAdminMarketplaceModules,
  useUpdateAdminBillingConfig,
  useUpdateMarketplaceModule,
} from "@/lib/api/use-admin";
import { cn } from "@/lib/utils";

function ModuleRow({
  module,
  onSave,
  isPending,
}: {
  module: AdminMarketplaceModuleDTO;
  onSave: (payload: {
    slug: string;
    unit_price: number;
    base_price: number;
    included_units: number;
    is_available: boolean;
    delayed_for_existing: boolean;
  }) => void;
  isPending: boolean;
}) {
  const [unitPrice, setUnitPrice] = useState(module.unitPrice);
  const [basePrice, setBasePrice] = useState(module.basePrice);
  const [includedUnits, setIncludedUnits] = useState(module.includedUnits);
  const [isAvailable, setIsAvailable] = useState(module.isAvailable);
  const [delayedForExisting, setDelayedForExisting] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    setUnitPrice(module.unitPrice);
    setBasePrice(module.basePrice);
    setIncludedUnits(module.includedUnits);
    setIsAvailable(module.isAvailable);
    setHasChanges(false);
  }, [module]);

  const checkChanged = (
    newUnit = unitPrice,
    newBase = basePrice,
    newInc = includedUnits,
    newAvail = isAvailable,
  ) => {
    setHasChanges(
      newUnit !== module.unitPrice ||
        newBase !== module.basePrice ||
        newInc !== module.includedUnits ||
        newAvail !== module.isAvailable,
    );
  };

  return (
    <tr className="border-b border-[#e5e5e5] transition-colors last:border-0 hover:bg-[#f5f5f5]">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-[#111111]">{module.name}</span>
          <span className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[10px] font-mono text-[#666666]">
            {module.slug}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-[#666666] line-clamp-1">{module.description}</p>
        {module.pendingUnitPrice !== null && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-[#854d0e]">
            <Clock className="h-3 w-3 shrink-0" />
            <span>
              Новая цена {module.pendingUnitPrice} ₽/мес вступит с расчетного периода{" "}
              {module.pendingEffectiveAt
                ? new Date(module.pendingEffectiveAt).toLocaleDateString("ru-RU")
                : ""}
            </span>
          </div>
        )}
      </td>

      <td className="px-4 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium",
            module.billingKind === "per_unit"
              ? "bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20"
              : module.billingKind === "per_seat"
                ? "bg-sky-50 text-sky-700 border border-sky-200"
                : "bg-[#f5f5f5] text-[#666666] border border-[#e5e5e5]",
          )}
        >
          {module.billingKind === "per_unit"
            ? "за единицу"
            : module.billingKind === "per_seat"
              ? "за пользователя"
              : "фиксированный"}
        </span>
      </td>

      {/* Цена за единицу */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            step={50}
            value={unitPrice}
            onChange={(e) => {
              const val = Number(e.target.value);
              setUnitPrice(val);
              checkChanged(val, basePrice, includedUnits, isAvailable);
            }}
            className="w-20 rounded border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <span className="text-xs text-[#888888]">₽</span>
        </div>
      </td>

      {/* Бесплатно в базе (квота) */}
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            value={includedUnits}
            onChange={(e) => {
              const val = Number(e.target.value);
              setIncludedUnits(val);
              checkChanged(unitPrice, basePrice, val, isAvailable);
            }}
            className="w-16 rounded border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <span className="text-xs text-[#888888]">{module.unitLabel || "ед."}</span>
        </div>
      </td>

      {/* Отложенное применение для действующих */}
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={delayedForExisting}
            onChange={(e) => setDelayedForExisting(e.target.checked)}
            className="rounded border-[#e5e5e5] bg-white text-[#4a38f5] focus:ring-[#4a38f5]/20"
          />
          <span className="text-xs text-[#666666]">Со следующего периода</span>
        </label>
      </td>

      {/* Доступность */}
      <td className="px-4 py-3">
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            checked={isAvailable}
            onChange={(e) => {
              const val = e.target.checked;
              setIsAvailable(val);
              checkChanged(unitPrice, basePrice, includedUnits, val);
            }}
            className="peer sr-only"
          />
          <div className="peer h-5 w-9 rounded-full bg-[#e5e5e5] after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-xs after:transition-all after:content-[''] peer-checked:bg-[#4a38f5] peer-checked:after:translate-x-full"></div>
        </label>
      </td>

      {/* Сохранение */}
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={() => {
            onSave({
              slug: module.slug,
              unit_price: unitPrice,
              base_price: basePrice,
              included_units: includedUnits,
              is_available: isAvailable,
              delayed_for_existing: delayedForExisting,
            });
            setHasChanges(false);
          }}
          disabled={!hasChanges || isPending}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
            hasChanges
              ? "bg-[#4a38f5] text-white hover:bg-[#3b2be0]"
              : "border border-[#e5e5e5] text-[#888888] opacity-50 cursor-not-allowed",
          )}
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Сохранить
        </button>
      </td>
    </tr>
  );
}

export function AdminPricingCatalogEditor() {
  const { data: modules = [], isLoading: modulesLoading } = useAdminMarketplaceModules();
  const updateModule = useUpdateMarketplaceModule();

  const { data: billingConfig, isLoading: configLoading } = useAdminBillingConfig();
  const updateBillingConfig = useUpdateAdminBillingConfig();

  // Локальное состояние для Базового тарифа CRM
  const [basePrice, setBasePrice] = useState<number>(600);
  const [baseUsers, setBaseUsers] = useState<number>(10);
  const [extraUserPrice, setExtraUserPrice] = useState<number>(200);

  const [aiAgents, setAiAgents] = useState<number>(2);
  const [telegramAccs, setTelegramAccs] = useState<number>(2);
  const [whatsappAccs, setWhatsappAccs] = useState<number>(2);
  const [maxAccs, setMaxAccs] = useState<number>(2);
  const [webchatSites, setWebchatSites] = useState<number>(1);

  const [configSuccess, setConfigSuccess] = useState(false);

  useEffect(() => {
    if (billingConfig) {
      setBasePrice(billingConfig.baseCrmPrice);
      setBaseUsers(billingConfig.baseCrmUsers);
      setExtraUserPrice(billingConfig.baseCrmExtraUserPrice);
      setAiAgents(billingConfig.baseCrmIncludedAiAgents);
      setTelegramAccs(billingConfig.baseCrmIncludedTelegram);
      setWhatsappAccs(billingConfig.baseCrmIncludedWhatsapp);
      setMaxAccs(billingConfig.baseCrmIncludedMax);
      setWebchatSites(billingConfig.baseCrmIncludedWebchat);
    }
  }, [billingConfig]);

  const handleSaveBaseCrm = (e: React.FormEvent) => {
    e.preventDefault();
    updateBillingConfig.mutate(
      {
        baseCrmPrice: basePrice,
        baseCrmUsers: baseUsers,
        baseCrmExtraUserPrice: extraUserPrice,
        baseCrmIncludedAiAgents: aiAgents,
        baseCrmIncludedTelegram: telegramAccs,
        baseCrmIncludedWhatsapp: whatsappAccs,
        baseCrmIncludedMax: maxAccs,
        baseCrmIncludedWebchat: webchatSites,
      },
      {
        onSuccess: () => {
          setConfigSuccess(true);
          setTimeout(() => setConfigSuccess(false), 3000);
        },
      },
    );
  };

  return (
    <div className="space-y-6 pt-4 border-t border-[#e5e5e5]">
      {/* 1. Блок Базового тарифа CRM и бесплатных квот */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white p-6 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e5e5e5] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-[#4a38f5]" />
              <h2 className="text-lg font-bold text-[#111111]">Базовый тариф CRM и включённые квоты</h2>
            </div>
            <p className="mt-1 text-sm text-[#666666]">
              Стоимость пакета ядра CRM, лимит сотрудников и бесплатные квоты модулей платформы
            </p>
          </div>

          {configSuccess && (
            <span className="flex items-center gap-1 text-sm font-medium text-emerald-700">
              <Check className="h-4 w-4" />
              Квоты сохранены
            </span>
          )}
        </div>

        <form onSubmit={handleSaveBaseCrm} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Базовая цена пакета CRM
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number(e.target.value))}
                  className="w-full rounded border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm font-bold text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <span className="text-sm text-[#888888]">₽/мес</span>
              </div>
              <p className="mt-1 text-[11px] text-[#888888]">Минимальный тариф для всех клиентов</p>
            </div>

            <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Пользователей включено в пакет
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={baseUsers}
                  onChange={(e) => setBaseUsers(Number(e.target.value))}
                  className="w-full rounded border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm font-bold text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <span className="text-sm text-[#888888]">пользователей</span>
              </div>
              <p className="mt-1 text-[11px] text-[#888888]">До 10 сотрудников включено бесплатно</p>
            </div>

            <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
              <label className="text-xs font-semibold text-[#666666] uppercase tracking-wider">
                Доплата за сотрудника сверх квоты
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={extraUserPrice}
                  onChange={(e) => setExtraUserPrice(Number(e.target.value))}
                  className="w-full rounded border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm font-bold text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <span className="text-sm text-[#888888]">₽/мес</span>
              </div>
              <p className="mt-1 text-[11px] text-[#888888]">За 11-го и каждого последующего</p>
            </div>
          </div>

          {/* Бесплатные единицы, включенные в Базовый тариф CRM */}
          <div className="rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#111111]">
              Бесплатно входит в Базовый тариф CRM:
            </h3>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded border border-[#e5e5e5] bg-white p-2.5 shadow-2xs">
                <div className="flex items-center gap-1.5 text-xs text-[#111111] font-medium">
                  <Bot className="h-4 w-4 text-[#4a38f5]" />
                  <span>AI-агенты</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={aiAgents}
                    onChange={(e) => setAiAgents(Number(e.target.value))}
                    className="w-16 rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="text-xs text-[#888888]">агента</span>
                </div>
              </div>

              <div className="rounded border border-[#e5e5e5] bg-white p-2.5 shadow-2xs">
                <div className="flex items-center gap-1.5 text-xs text-[#111111] font-medium">
                  <Send className="h-4 w-4 text-sky-600" />
                  <span>Telegram</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={telegramAccs}
                    onChange={(e) => setTelegramAccs(Number(e.target.value))}
                    className="w-16 rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="text-xs text-[#888888]">аккаунта</span>
                </div>
              </div>

              <div className="rounded border border-[#e5e5e5] bg-white p-2.5 shadow-2xs">
                <div className="flex items-center gap-1.5 text-xs text-[#111111] font-medium">
                  <MessageCircle className="h-4 w-4 text-emerald-600" />
                  <span>WhatsApp</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={whatsappAccs}
                    onChange={(e) => setWhatsappAccs(Number(e.target.value))}
                    className="w-16 rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="text-xs text-[#888888]">номера</span>
                </div>
              </div>

              <div className="rounded border border-[#e5e5e5] bg-white p-2.5 shadow-2xs">
                <div className="flex items-center gap-1.5 text-xs text-[#111111] font-medium">
                  <Hash className="h-4 w-4 text-[#4a38f5]" />
                  <span>MAX</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={maxAccs}
                    onChange={(e) => setMaxAccs(Number(e.target.value))}
                    className="w-16 rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="text-xs text-[#888888]">аккаунта</span>
                </div>
              </div>

              <div className="rounded border border-[#e5e5e5] bg-white p-2.5 shadow-2xs">
                <div className="flex items-center gap-1.5 text-xs text-[#111111] font-medium">
                  <MessageSquareText className="h-4 w-4 text-[#4a38f5]" />
                  <span>WebChat</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={webchatSites}
                    onChange={(e) => setWebchatSites(Number(e.target.value))}
                    className="w-16 rounded border border-[#e5e5e5] bg-[#fafafa] px-2 py-1 text-xs text-[#111111] font-mono tabular-nums focus:border-[#4a38f5] focus:outline-none"
                  />
                  <span className="text-xs text-[#888888]">сайт</span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={updateBillingConfig.isPending}
              className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3b2be0] disabled:opacity-50"
            >
              {updateBillingConfig.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Сохранить параметры Базового тарифа
            </button>
          </div>
        </form>
      </div>

      {/* 2. Таблица настройки цен всех модулей маркетплейса */}
      <div className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
        <div className="p-6 border-b border-[#e5e5e5] flex items-start justify-between bg-white">
          <div>
            <h2 className="text-lg font-bold text-[#111111]">Каталог модулей маркетплейса и тарифы</h2>
            <p className="mt-1 text-sm text-[#666666]">
              Управление стоимостью подписок, включёнными бесплатными единицами и отложенным применением цен
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-[#666666] bg-[#fafafa] border border-[#e5e5e5] rounded-lg px-3 py-2">
            <Clock className="h-4 w-4 text-[#854d0e]" />
            <span>Отложенное применение защищает действующих клиентов от внезапного списания</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#e5e5e5] text-left text-xs uppercase tracking-wider text-[#666666] bg-[#fafafa]">
                <th className="px-4 py-3 font-medium">Модуль</th>
                <th className="px-4 py-3 font-medium">Тип биллинга</th>
                <th className="px-4 py-3 font-medium">Цена / ед.</th>
                <th className="px-4 py-3 font-medium">В базе бесплатно</th>
                <th className="px-4 py-3 font-medium">Отложить для действующих</th>
                <th className="px-4 py-3 font-medium">В каталоге</th>
                <th className="px-4 py-3 font-medium text-right">Действие</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {modules.map((m) => (
                <ModuleRow
                  key={m.slug}
                  module={m}
                  isPending={updateModule.isPending && updateModule.variables?.slug === m.slug}
                  onSave={(payload) => updateModule.mutate(payload)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
