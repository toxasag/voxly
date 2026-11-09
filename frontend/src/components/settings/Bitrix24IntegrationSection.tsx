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
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TagPill } from "@/components/ui/tag";
import {
  useBitrix24Config,
  useTenantWidgets,
  useTestBitrix24Connection,
  useUpdateBitrix24Config,
  type LeadSource,
} from "@/lib/api/use-bitrix24";
import { SourceMultiSelect } from "@/components/settings/SourceMultiSelect";
import { WidgetMultiSelect } from "@/components/settings/WidgetMultiSelect";

export function Bitrix24IntegrationSection() {
  const { data: config, isLoading } = useBitrix24Config();
  const { data: widgets = [], isLoading: widgetsLoading } = useTenantWidgets();
  const updateMutation = useUpdateBitrix24Config();
  const testMutation = useTestBitrix24Connection();

  const [webhookUrl, setWebhookUrl] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [allowedSources, setAllowedSources] = useState<LeadSource[]>([]);
  const [selectedWidgetIds, setSelectedWidgetIds] = useState<string[]>([]);
  const [customSourceId, setCustomSourceId] = useState("UC_VWN1ZK");
  const [sendUtmMarks, setSendUtmMarks] = useState(true);
  const [sendGeoData, setSendGeoData] = useState(true);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    leadId?: number | string;
    message: string;
    error?: string;
  } | null>(null);

  // Синхронизируем локальный стейт при получении данных с сервера
  useEffect(() => {
    if (config) {
      setWebhookUrl(config.webhook_url || "");
      setIsEnabled(Boolean(config.is_enabled));
      setAllowedSources(config.allowed_sources ?? []);
      setSelectedWidgetIds(config.selected_widget_ids ?? []);
      setCustomSourceId(config.custom_source_id || "UC_VWN1ZK");
      setSendUtmMarks(config.send_utm_marks ?? true);
      setSendGeoData(config.send_geo_data ?? true);
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
        allowed_sources: allowedSources,
        selected_widget_ids: selectedWidgetIds,
        custom_source_id: customSourceId.trim() || "UC_VWN1ZK",
        send_utm_marks: sendUtmMarks,
        send_geo_data: sendGeoData,
      });
      toast.success("Настройки Битрикс24 сохранены");
      setTestResult(null);
    } catch (err: unknown) {
      const anyErr = err as { data?: { message?: string; details?: string }; message?: string };
      const msg = anyErr.data?.details || anyErr.data?.message || anyErr.message || "Не удалось сохранить настройки";
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
        const msg = res.message || res.error || "Ошибка проверки подключения";
        setTestResult({
          success: false,
          message: msg,
          error: msg,
        });
        toast.error(msg);
      }
    } catch (err: unknown) {
      const anyErr = err as { data?: { message?: string; details?: string; error?: string }; message?: string };
      const msg = anyErr.data?.details || anyErr.data?.message || anyErr.data?.error || anyErr.message || "Ошибка проверки вебхука";
      setTestResult({
        success: false,
        message: msg,
        error: msg,
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
          allowed_sources: allowedSources,
          selected_widget_ids: selectedWidgetIds,
          custom_source_id: customSourceId.trim() || "UC_VWN1ZK",
          send_utm_marks: sendUtmMarks,
          send_geo_data: sendGeoData,
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

  const showWidgetFilter = allowedSources.length === 0 || allowedSources.includes("site_widget");

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

        {/* Блок фильтрации источников заявок */}
        <div className="pt-2 border-t border-[#f0f0f0] space-y-4">
          <SourceMultiSelect
            value={allowedSources}
            onChange={setAllowedSources}
            disabled={updateMutation.isPending}
          />

          {/* Селектор конкретных виджетов тенанта */}
          {showWidgetFilter && (
            <div className="pt-3 border-t border-[#f0f0f0]">
              <WidgetMultiSelect
                widgets={widgets}
                selectedIds={selectedWidgetIds}
                onChange={setSelectedWidgetIds}
                disabled={updateMutation.isPending}
                isLoading={widgetsLoading}
              />
            </div>
          )}
        </div>

        {/* Кастомный идентификатор источника (SOURCE_ID) */}
        <div className="pt-3 border-t border-[#f0f0f0]">
          <label className="text-xs font-medium text-[#111111] block mb-1">
            Идентификатор источника в Битрикс24 (SOURCE_ID)
          </label>
          <div className="max-w-md">
            <input
              type="text"
              value={customSourceId}
              onChange={(e) => setCustomSourceId(e.target.value)}
              placeholder="UC_VWN1ZK (или WIDGET, WEB, CALL)"
              className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono"
            />
          </div>
          <p className="mt-1 text-[11px] text-[#666666]">
            Код источника из справочника CRM Битрикс24 (<strong>Настройки → Справочники → Источники</strong>). Если не заполнено — используется <code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono text-[#111111]">UC_VWN1ZK</code>.
          </p>
        </div>

        {/* Опции обогащения данных */}
        <div className="pt-3 border-t border-[#f0f0f0] grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-start justify-between gap-3 p-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-[#111111] block">
                Передавать UTM-метки
              </span>
              <span className="text-[11px] text-[#666666] block leading-snug">
                utm_source, utm_medium, utm_campaign, utm_content, utm_term в нативные поля Битрикс24
              </span>
            </div>
            <Switch
              checked={sendUtmMarks}
              onCheckedChange={setSendUtmMarks}
              disabled={updateMutation.isPending}
            />
          </div>

          <div className="flex items-start justify-between gap-3 p-3 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa]">
            <div className="space-y-0.5">
              <span className="text-xs font-medium text-[#111111] block">
                Геолокация и данные визита
              </span>
              <span className="text-[11px] text-[#666666] block leading-snug">
                Город, страна, IP, устройство, визиты и Client ID Яндекс.Метрики в комментарий
              </span>
            </div>
            <Switch
              checked={sendGeoData}
              onCheckedChange={setSendGeoData}
              disabled={updateMutation.isPending}
            />
          </div>
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
            <div className="space-y-0.5 flex-1 min-w-0">
              <p className="font-semibold">{testResult.message}</p>
              {testResult.success ? (
                <p className="text-[11px] text-emerald-700">
                  Вебхук проверен методом crm.lead.fields. Права на создание лидов подтверждены.
                </p>
              ) : (
                <p className="text-[11px] text-rose-700">
                  Проверьте адрес портала, ключ вебхука и права доступа (требуется раздел CRM).
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
                Передаётся <code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono text-[#111111]">{customSourceId.trim() || "UC_VWN1ZK"}</code>
              </span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">UF_CRM_YA_CID:</span>
              <span>Client ID Яндекс.Метрики (<code className="bg-[#f0f0f0] px-1 py-0.5 rounded font-mono text-[#111111]">_ym_uid</code>)</span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">Виджеты:</span>
              <span>
                {selectedWidgetIds.length > 0
                  ? `Ограничено ${selectedWidgetIds.length} виджетами`
                  : "Все виджеты на сайтах"}
              </span>
            </div>

            <div className="flex items-start gap-1.5">
              <span className="font-mono text-[#4a38f5] font-semibold shrink-0">Обогащение:</span>
              <span>
                UTM: {sendUtmMarks ? "активно" : "выкл"} · Гео/Визит: {sendGeoData ? "активно" : "выкл"}
              </span>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
