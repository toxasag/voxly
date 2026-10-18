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
    <tr className="border-b border-slate-800 transition-colors last:border-0 hover:bg-slate-800/40">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-slate-100">{module.name}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-mono text-slate-400">
            {module.slug}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-slate-400 line-clamp-1">{module.description}</p>
        {module.pendingUnitPrice !== null && (
          <div className="mt-1 flex items-center gap-1 text-[11px] text-amber-400">
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
              ? "bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/30"
              : module.billingKind === "per_seat"
                ? "bg-sky-500/10 text-sky-400 border border-sky-500/30"
                : "bg-slate-800 text-slate-300 border border-slate-700",
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
            className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-[#4a38f5] focus:outline-none"
          />
          <span className="text-xs text-slate-400">₽</span>
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
            className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:border-[#4a38f5] focus:outline-none"
          />
          <span className="text-xs text-slate-400">{module.unitLabel || "ед."}</span>
        </div>
      </td>

      {/* Отложенное применение для действующих */}
      <td className="px-4 py-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={delayedForExisting}
            onChange={(e) => setDelayedForExisting(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-[#4a38f5] focus:ring-[#4a38f5]/20"
          />
          <span className="text-xs text-slate-400">Со следующего периода</span>
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
          <div className="peer h-5 w-9 rounded-full bg-slate-800 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-slate-400 after:transition-all after:content-[''] peer-checked:bg-[#4a38f5] peer-checked:after:translate-x-full peer-checked:after:bg-slate-950"></div>
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
              : "border border-slate-800 text-slate-500 opacity-50 cursor-not-allowed",
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
    <div className="space-y-6 pt-4 border-t border-slate-800">
      {/* 1. Блок Базового тарифа CRM и бесплатных квот */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-amber-400" />
              <h2 className="text-lg font-bold text-slate-100">Базовый тариф CRM и включённые квоты</h2>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Стоимость пакета ядра CRM, лимит сотрудников и бесплатные квоты модулей платформы
            </p>
          </div>

          {configSuccess && (
            <span className="flex items-center gap-1 text-sm font-medium text-emerald-400">
              <Check className="h-4 w-4" />
              Квоты сохранены
            </span>
          )}
        </div>

        <form onSubmit={handleSaveBaseCrm} className="mt-5 space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Базовая цена пакета CRM
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={basePrice}
                  onChange={(e) => setBasePrice(Number(e.target.value))}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-100 focus:border-[#4a38f5] focus:outline-none"
                />
                <span className="text-sm text-slate-400">₽/мес</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">Минимальный тариф для всех клиентов</p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Пользователей включено в пакет
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={baseUsers}
                  onChange={(e) => setBaseUsers(Number(e.target.value))}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-100 focus:border-[#4a38f5] focus:outline-none"
                />
                <span className="text-sm text-slate-400">пользователей</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">До 10 сотрудников включено бесплатно</p>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950 p-4">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Доплата за сотрудника сверх квоты
              </label>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  step={50}
                  value={extraUserPrice}
                  onChange={(e) => setExtraUserPrice(Number(e.target.value))}
                  className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm font-bold text-slate-100 focus:border-[#4a38f5] focus:outline-none"
                />
                <span className="text-sm text-slate-400">₽/мес</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-500">За 11-го и каждого последующего</p>
            </div>
          </div>

          {/* Бесплатные единицы, включенные в Базовый тариф CRM */}
          <div className="rounded-lg border border-slate-800/80 bg-slate-950 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Бесплатно входит в Базовый тариф CRM:
            </h3>

            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
              <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                  <Bot className="h-4 w-4 text-amber-400" />
                  <span>AI-агенты</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={aiAgents}
                    onChange={(e) => setAiAgents(Number(e.target.value))}
                    className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">агента</span>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                  <Send className="h-4 w-4 text-sky-400" />
                  <span>Telegram</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={telegramAccs}
                    onChange={(e) => setTelegramAccs(Number(e.target.value))}
                    className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">аккаунта</span>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                  <MessageCircle className="h-4 w-4 text-emerald-400" />
                  <span>WhatsApp</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={whatsappAccs}
                    onChange={(e) => setWhatsappAccs(Number(e.target.value))}
                    className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">номера</span>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                  <Hash className="h-4 w-4 text-indigo-400" />
                  <span>MAX</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={maxAccs}
                    onChange={(e) => setMaxAccs(Number(e.target.value))}
                    className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">аккаунта</span>
                </div>
              </div>

              <div className="rounded border border-slate-800 bg-slate-900/60 p-2.5">
                <div className="flex items-center gap-1.5 text-xs text-slate-300 font-medium">
                  <MessageSquareText className="h-4 w-4 text-amber-400" />
                  <span>WebChat</span>
                </div>
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number"
                    min={0}
                    value={webchatSites}
                    onChange={(e) => setWebchatSites(Number(e.target.value))}
                    className="w-16 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
                  />
                  <span className="text-xs text-slate-400">сайт</span>
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
      <div className="rounded-xl border border-slate-800 bg-slate-900 overflow-hidden shadow-sm">
        <div className="p-6 border-b border-slate-800 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-100">Каталог модулей маркетплейса и тарифы</h2>
            <p className="mt-1 text-sm text-slate-400">
              Управление стоимостью подписок, включёнными бесплатными единицами и отложенным применением цен
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <span>Отложенное применение защищает действующих клиентов от внезапного списания</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 text-left text-xs uppercase tracking-wider text-slate-500 bg-slate-950/40">
                <th className="px-4 py-3 font-medium">Модуль</th>
                <th className="px-4 py-3 font-medium">Тип биллинга</th>
                <th className="px-4 py-3 font-medium">Цена / ед.</th>
                <th className="px-4 py-3 font-medium">В базе бесплатно</th>
                <th className="px-4 py-3 font-medium">Отложить для действующих</th>
                <th className="px-4 py-3 font-medium">В каталоге</th>
                <th className="px-4 py-3 font-medium text-right">Действие</th>
              </tr>
            </thead>
            <tbody>
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
