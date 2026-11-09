"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TagPill } from "@/components/ui/tag";
import {
  useBitrix24Config,
  useTestBitrix24Connection,
  useUpdateBitrix24Config,
} from "@/lib/api/use-bitrix24";

export function Bitrix24IntegrationSection() {
  const { data: config, isLoading } = useBitrix24Config();
  const updateMutation = useUpdateBitrix24Config();
  const testMutation = useTestBitrix24Connection();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    leadId?: number | string;
    message: string;
  } | null>(null);

  // Синхронизируем локальный стейт при получении данных с сервера
  useEffect(() => {
    if (config) {
      setWebhookUrl(config.webhook_url || "");
      setIsEnabled(Boolean(config.is_enabled));
    }
  }, [config]);

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanUrl = webhookUrl.trim();

    if (isEnabled && !cleanUrl) {
      toast.error("Укажите URL входящего вебхука для активации интеграции");
      return;
    }

    try {
      await updateMutation.mutateAsync({
        webhook_url: cleanUrl,
        is_enabled: isEnabled,
      });
      toast.success("Настройки Битрикс24 сохранены");
      setTestResult(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Не удалось сохранить настройки";
      toast.error(msg);
    }
  };

  const handleTest = async () => {
    const cleanUrl = webhookUrl.trim();
    if (!cleanUrl) {
      toast.error("Сначала укажите URL входящего вебхука Битрикс24");
      return;
    }

    setTestResult(null);
    try {
      const res = await testMutation.mutateAsync({ webhook_url: cleanUrl });
      if (res.success) {
        setTestResult({
          success: true,
          leadId: res.leadId,
          message: res.message,
        });
        toast.success(res.message);
      } else {
        setTestResult({
          success: false,
          message: res.message,
        });
        toast.error(res.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Ошибка проверки вебхука";
      setTestResult({
        success: false,
        message: msg,
      });
      toast.error(msg);
    }
  };

  const handleToggle = (checked: boolean) => {
    setIsEnabled(checked);
    // Автосохранение при переключении тоггла, если URL уже заполнен
    if (webhookUrl.trim()) {
      void updateMutation
        .mutateAsync({
          webhook_url: webhookUrl.trim(),
          is_enabled: checked,
        })
        .then(() => {
          toast.success(
            checked ? "Экспорт в Битрикс24 активирован" : "Экспорт в Битрикс24 приостановлен",
          );
        })
        .catch(() => {
          toast.error("Не удалось изменить статус интеграции");
          setIsEnabled(!checked);
        });
    }
  };

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
      {/* Шапка карточки интеграции */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-5 border-b border-[#f0f0f0] gap-4">
        <div className="flex items-start gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-[#f5f5f5]">
            <Layers className="h-5 w-5 text-[#4a38f5]" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold text-[#111111]">
                Битрикс24 (Входящий вебхук)
              </h3>
              <TagPill color="sky">Экспорт лидов в CRM</TagPill>
              {config?.last_lead_id && (
                <span className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-[4px] font-mono">
                  Посл. лид #{config.last_lead_id}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-[#666666]">
              Автоматическое создание лида в Битрикс24 при поступлении квалифицированной заявки с сайта
            </p>
          </div>
        </div>

        {/* Переключатель активности */}
        <div className="flex items-center gap-3 self-end sm:self-auto shrink-0 bg-[#fafafa] sm:bg-transparent p-2.5 sm:p-0 rounded-[8px] w-full sm:w-auto justify-between sm:justify-start">
          <span className="text-xs font-medium text-[#444444]">
            {isEnabled ? "Интеграция активна" : "Интеграция отключена"}
          </span>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={isLoading || updateMutation.isPending}
          />
        </div>
      </div>

      {/* Форма настройки вебхука */}
      <form onSubmit={handleSave} className="p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-[#111111] block mb-1.5">
            URL входящего вебхука Битрикс24
          </label>
          <div className="flex flex-col sm:flex-row gap-2.5">
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://domain.bitrix24.ru/rest/1/token/ или https://domain.bitrix24.ru/rest/1/token/crm.lead.add.json"
              className="flex-1 h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleTest}
                disabled={testMutation.isPending || !webhookUrl.trim()}
                className="h-9 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f5f5f5] hover:border-[#cccccc] disabled:opacity-40 inline-flex items-center gap-1.5 shrink-0"
              >
                {testMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[#4a38f5]" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5 text-[#666666]" />
                )}
                <span>Проверить подключение</span>
              </button>

              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="h-9 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 inline-flex items-center gap-1.5 shrink-0"
              >
                {updateMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                <span>Сохранить</span>
              </button>
            </div>
          </div>

          <p className="mt-1.5 text-[11px] text-[#666666] leading-relaxed">
            В Битрикс24 перейдите в <strong>Разработчикам → Другое → Входящий вебхук</strong>. Убедитесь,
            что в правах доступа отмечен модуль <strong>CRM</strong>.
          </p>
        </div>

        {/* Результат проверки подключения */}
        {testResult && (
          <div
            className={`rounded-[8px] p-3 text-xs border flex items-start gap-2.5 transition-all ${
              testResult.success
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            )}
            <div className="space-y-0.5">
              <p className="font-semibold">{testResult.message}</p>
              {testResult.success && testResult.leadId && (
                <p className="text-[11px] text-emerald-700">
                  В Битрикс24 создан тестовый лид с переданным SOURCE_ID и UF_CRM_YA_CID.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Информация о последней ошибке, если есть */}
        {!testResult && config?.last_error && (
          <div className="rounded-[8px] bg-rose-50 border border-rose-200 p-3 text-xs text-rose-900 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-semibold">Ошибка последней синхронизации:</p>
              <p className="text-[11px] text-rose-700 mt-0.5">{config.last_error}</p>
            </div>
          </div>
        )}

        {/* Информационный баннер о бизнес-правилах Битрикс24 */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3.5 space-y-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#4a38f5] shrink-0" />
            <span className="text-xs font-semibold text-[#111111]">
              Параметры полезной нагрузки лида (Payload)
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-[#555555]">
            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">SOURCE_ID:</span>
              <span>
                Строго передаётся <code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono text-[#111111]">UC_VWN1ZK</code>
              </span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">UF_CRM_YA_CID:</span>
              <span>Client ID Яндекс.Метрики (<code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono text-[#111111]">_ym_uid</code>) из заявки</span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">Стандартные поля:</span>
              <span>TITLE, NAME, PHONE (WORK), EMAIL, COMMENTS, STATUS_ID = NEW</span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">Сквозная аналитика:</span>
              <span>Автоматическая передача UTM-меток (source, medium, campaign, content, term)</span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
