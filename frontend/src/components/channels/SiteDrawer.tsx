"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  ExternalLink,
  Globe,
  HelpCircle,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";
import { Sheet, SheetHeader } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { usePipelines } from "@/lib/api/use-deals";
import {
  type SiteIntegrationDTO,
  useCreateSiteIntegration,
  useRegenerateSiteToken,
  useUpdateSiteIntegration,
} from "@/lib/api/use-site-integrations";
import { cn } from "@/lib/utils";

interface SiteDrawerProps {
  open: boolean;
  onClose: () => void;
  site: SiteIntegrationDTO | null;
  mode: "create" | "edit" | "guide";
  onSwitchMode?: (mode: "create" | "edit" | "guide") => void;
}

export function SiteDrawer({
  open,
  onClose,
  site,
  mode,
  onSwitchMode,
}: SiteDrawerProps) {
  const [name, setName] = useState("");
  const [siteUrl, setSiteUrl] = useState("");
  const [targetPipelineId, setTargetPipelineId] = useState<string>("");
  const [targetStageId, setTargetStageId] = useState<string>("");
  const [isActive, setIsActive] = useState(true);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [activeGuideTab, setActiveGuideTab] = useState<"tilda" | "wordpress" | "webflow" | "html">("tilda");

  const { data: pipelines = [], isLoading: pipelinesLoading } = usePipelines();

  const createMutation = useCreateSiteIntegration();
  const updateMutation = useUpdateSiteIntegration();
  const regenerateMutation = useRegenerateSiteToken();

  // Синхронизация формы при открытии
  useEffect(() => {
    if (site && (mode === "edit" || mode === "guide")) {
      setName(site.name);
      setSiteUrl(site.site_url || "");
      setTargetPipelineId(site.target_pipeline_id || "");
      setTargetStageId(site.target_stage_id || "");
      setIsActive(site.is_active);
    } else if (mode === "create") {
      setName("");
      setSiteUrl("");
      setTargetPipelineId(pipelines[0]?.id || "");
      setTargetStageId("");
      setIsActive(true);
    }
  }, [site, mode, pipelines]);

  // Выбранная воронка и список её этапов
  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === targetPipelineId) || pipelines[0],
    [pipelines, targetPipelineId],
  );

  const stages = useMemo(() => {
    if (!selectedPipeline) return [];
    // Если stages есть в объекте воронки
    const s = (selectedPipeline as unknown as { stages?: { id: string; name: string }[] }).stages;
    return s || [];
  }, [selectedPipeline]);

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    toast.success("Webhook URL скопирован в буфер обмена");
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleRegenerateToken = () => {
    if (!site) return;
    if (!confirm("Вы уверены, что хотите перегенерировать токен? Предыдущий URL перестанет принимать заявки.")) return;

    regenerateMutation.mutate(
      { id: site.id },
      {
        onSuccess: (updated) => {
          toast.success("Токен обновлен. Скопируйте новый Webhook URL.");
        },
        onError: () => {
          toast.error("Не удалось обновить токен");
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Укажите название сайта");
      return;
    }

    if (mode === "create") {
      createMutation.mutate(
        {
          name: name.trim(),
          site_url: siteUrl.trim() || undefined,
          target_pipeline_id: targetPipelineId || undefined,
          target_stage_id: targetStageId || undefined,
          is_active: isActive,
        },
        {
          onSuccess: (created) => {
            toast.success("Сайт успешно добавлен");
            if (onSwitchMode) {
              onSwitchMode("guide");
            } else {
              onClose();
            }
          },
          onError: (err) => {
            toast.error(err.message || "Ошибка при создании сайта");
          },
        },
      );
    } else if (mode === "edit" && site) {
      updateMutation.mutate(
        {
          id: site.id,
          name: name.trim(),
          site_url: siteUrl.trim() || undefined,
          target_pipeline_id: targetPipelineId || null,
          target_stage_id: targetStageId || null,
          is_active: isActive,
        },
        {
          onSuccess: () => {
            toast.success("Настройки сайта сохранены");
            onClose();
          },
          onError: (err) => {
            toast.error(err.message || "Ошибка при сохранении");
          },
        },
      );
    }
  };

  const webhookUrl = site?.webhook_url || "https://api.getvoxly.ru/api/v1/webhooks/sites/<TOKEN>";

  return (
    <Sheet open={open} onClose={onClose} width="w-[540px]">
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[#4a38f5]/10 text-[#4a38f5]">
            <Globe className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-[14px] font-semibold text-[#111111]">
              {mode === "create" && "Подключение нового сайта"}
              {mode === "edit" && `Настройки сайта: ${site?.name || ""}`}
              {mode === "guide" && `Инструкция по интеграции: ${site?.name || ""}`}
            </h2>
            <p className="text-[12px] text-[#666666]">
              {mode === "guide"
                ? "Пошаговая настройка отправки лидов в CRM"
                : "Приём заявок с внешних форм через персональный Webhook"}
            </p>
          </div>
        </div>
      </SheetHeader>

      {/* Переключатель режима для существующего сайта */}
      {site && mode !== "create" && onSwitchMode && (
        <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-5 py-2.5 bg-[#fafafa]">
          <button
            type="button"
            onClick={() => onSwitchMode("guide")}
            className={cn(
              "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "guide"
                ? "bg-[#4a38f5] text-white"
                : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
            )}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Инструкция Tilda / Webhook
          </button>
          <button
            type="button"
            onClick={() => onSwitchMode("edit")}
            className={cn(
              "flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-[12px] font-medium transition-colors",
              mode === "edit"
                ? "bg-[#4a38f5] text-white"
                : "text-[#666666] hover:bg-black/[0.04] hover:text-[#111111]",
            )}
          >
            <Workflow className="h-3.5 w-3.5" />
            Настройки воронки
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* БЛОК WEBHOOK URL (всегда на виду, если сайт уже создан) */}
        {site && (
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#111111] flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-[#4a38f5]" />
                Ваш персональный Webhook URL
              </span>
              <button
                type="button"
                onClick={handleRegenerateToken}
                disabled={regenerateMutation.isPending}
                className="text-[11px] text-[#666666] hover:text-[#111111] flex items-center gap-1 transition-colors"
                title="Перегенерировать токен"
              >
                <RefreshCw className={cn("h-3 w-3", regenerateMutation.isPending && "animate-spin")} />
                Обновить токен
              </button>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  type="text"
                  readOnly
                  value={webhookUrl}
                  className="w-full h-8 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 font-mono text-[11px] text-[#111111] focus:outline-none select-all"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
              </div>
              <button
                type="button"
                onClick={() => handleCopyUrl(webhookUrl)}
                className="h-8 gap-1.5 bg-[#4a38f5] text-white hover:bg-[#3d2ee0] px-3 shrink-0 rounded-[6px] text-[12px] flex items-center font-medium transition-colors"
              >
                {copiedUrl ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copiedUrl ? "Скопировано" : "Скопировать"}
              </button>
            </div>

            <p className="text-[11px] text-[#888888] leading-relaxed">
              Вставьте этот URL в настройки вебхука на Tilda или в форму WordPress. Все отправленные заявки будут мгновенно создавать сделку и контакт.
            </p>
          </div>
        )}

        {/* РЕЖИМ: ИНСТРУКЦИЯ (Tilda, WordPress, Webflow, HTML) */}
        {mode === "guide" ? (
          <div className="space-y-4">
            {/* Табы платформ */}
            <div className="flex border-b border-[#e5e5e5] gap-2 pb-1">
              <button
                type="button"
                onClick={() => setActiveGuideTab("tilda")}
                className={cn(
                  "px-3 py-1 text-[12px] font-medium border-b-2 -mb-[5px] transition-colors",
                  activeGuideTab === "tilda"
                    ? "border-[#4a38f5] text-[#4a38f5]"
                    : "border-transparent text-[#666666] hover:text-[#111111]",
                )}
              >
                Tilda
              </button>
              <button
                type="button"
                onClick={() => setActiveGuideTab("wordpress")}
                className={cn(
                  "px-3 py-1 text-[12px] font-medium border-b-2 -mb-[5px] transition-colors",
                  activeGuideTab === "wordpress"
                    ? "border-[#4a38f5] text-[#4a38f5]"
                    : "border-transparent text-[#666666] hover:text-[#111111]",
                )}
              >
                WordPress
              </button>
              <button
                type="button"
                onClick={() => setActiveGuideTab("webflow")}
                className={cn(
                  "px-3 py-1 text-[12px] font-medium border-b-2 -mb-[5px] transition-colors",
                  activeGuideTab === "webflow"
                    ? "border-[#4a38f5] text-[#4a38f5]"
                    : "border-transparent text-[#666666] hover:text-[#111111]",
                )}
              >
                Webflow
              </button>
              <button
                type="button"
                onClick={() => setActiveGuideTab("html")}
                className={cn(
                  "px-3 py-1 text-[12px] font-medium border-b-2 -mb-[5px] transition-colors",
                  activeGuideTab === "html"
                    ? "border-[#4a38f5] text-[#4a38f5]"
                    : "border-transparent text-[#666666] hover:text-[#111111]",
                )}
              >
                HTML / JS
              </button>
            </div>

            {/* TAB: TILDA */}
            {activeGuideTab === "tilda" && (
              <div className="space-y-4 text-[13px] text-[#333333]">
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-3">
                  <h3 className="font-semibold text-[#111111] flex items-center gap-1.5 text-[13px]">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] text-[10px] font-bold text-white">
                      1
                    </span>
                    Добавление Webhook в настройках сайта Tilda
                  </h3>
                  <ol className="list-decimal list-inside space-y-1.5 text-[12px] text-[#555555] pl-1">
                    <li>В кабинете Tilda откройте <strong>Настройки сайта</strong> $\rightarrow$ вкладка <strong>Формы</strong>.</li>
                    <li>В блоке «Другие сервисы» выберите <strong>Webhook</strong>.</li>
                    <li>В поле <strong>Webhook URL</strong> вставьте ваш персональный адрес из блока выше.</li>
                    <li>
                      Нажмите кнопку <strong>Добавить</strong>. Tilda автоматически отправит проверочный запрос (handshake),
                      и GETVOXLY мгновенно вернёт <code className="bg-[#f0f0f0] px-1 py-0.5 rounded text-[11px]">200 OK</code>.
                    </li>
                  </ol>
                </div>

                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-3">
                  <h3 className="font-semibold text-[#111111] flex items-center gap-1.5 text-[13px]">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] text-[10px] font-bold text-white">
                      2
                    </span>
                    Подключение сервиса к форме на странице
                  </h3>
                  <ol className="list-decimal list-inside space-y-1.5 text-[12px] text-[#555555] pl-1">
                    <li>Откройте страницу с вашей формой в редакторе Tilda.</li>
                    <li>Нажмите кнопку <strong>Контент</strong> у блока с формой.</li>
                    <li>В разделе «Приём данных из форм» поставьте галочку напротив добавленного вебхука.</li>
                    <li>Нажмите <strong>Сохранить и закрыть</strong>, затем обязательно <strong>Опубликовать</strong> страницу.</li>
                  </ol>
                </div>

                <div className="rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-3 text-[12px] text-[#854d0e] flex items-start gap-2">
                  <Info className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <strong>Автоматическое распознавание:</strong> GETVOXLY понимает стандартные имена полей Tilda
                    (Имя/Name, Телефон/Phone, Email, Комментарий/Comment, UTM-метки и Client ID Яндекс.Метрики).
                  </div>
                </div>
              </div>
            )}

            {/* TAB: WORDPRESS */}
            {activeGuideTab === "wordpress" && (
              <div className="space-y-4 text-[13px] text-[#333333]">
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2">
                  <h4 className="font-semibold text-[#111111] text-[13px]">Contact Form 7 / Elementor / WPForms</h4>
                  <p className="text-[12px] text-[#555555] leading-relaxed">
                    Для отправки заявок из WordPress используйте встроенные вебхуки (в Elementor Pro: Actions After Submit $\rightarrow$ Webhook)
                    либо бесплатный плагин <strong>WP Webhooks</strong> / <strong>CF7 to Webhook</strong>.
                  </p>
                  <div className="bg-[#f5f5f5] p-2.5 rounded-[6px] font-mono text-[11px] text-[#222222]">
                    URL: {webhookUrl}
                    <br />
                    Method: POST
                  </div>
                </div>
              </div>
            )}

            {/* TAB: WEBFLOW */}
            {activeGuideTab === "webflow" && (
              <div className="space-y-4 text-[13px] text-[#333333]">
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2">
                  <h4 className="font-semibold text-[#111111] text-[13px]">Интеграция с Webflow</h4>
                  <ol className="list-decimal list-inside space-y-1.5 text-[12px] text-[#555555] pl-1">
                    <li>Откройте <strong>Project Settings</strong> $\rightarrow$ вкладка <strong>Integrations</strong>.</li>
                    <li>В блоке <strong>Webhooks</strong> нажмите <strong>Add Webhook</strong>.</li>
                    <li>Выберите триггер <strong>Form Submission</strong>.</li>
                    <li>Вставьте Webhook URL и нажмите <strong>Save</strong>.</li>
                  </ol>
                </div>
              </div>
            )}

            {/* TAB: HTML */}
            {activeGuideTab === "html" && (
              <div className="space-y-4 text-[13px] text-[#333333]">
                <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-2">
                  <h4 className="font-semibold text-[#111111] text-[13px]">Отправка через JavaScript (Fetch API)</h4>
                  <p className="text-[12px] text-[#555555]">
                    Вы можете слать форму нативным JavaScript со своего кастомного лендинга или SPA:
                  </p>
                  <pre className="bg-[#111111] text-[#f5f5f5] p-3 rounded-[6px] font-mono text-[11px] overflow-x-auto">
{`await fetch("${webhookUrl}", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    Name: "Александр",
    Phone: "+7 (999) 123-45-67",
    Email: "alex@example.ru",
    COMMENT: "Интересует тариф Про",
    utm_source: "yandex",
    utm_campaign: "brand"
  })
});`}
                  </pre>
                </div>
              </div>
            )}

            {/* СПРАВОЧНИК ПОЛЕЙ */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 space-y-3">
              <h4 className="font-semibold text-[#111111] text-[12px] uppercase tracking-wide text-[#666666]">
                Поддерживаемые поля формы
              </h4>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[11px] text-[#444444]">
                  <thead>
                    <tr className="border-b border-[#f0f0f0] text-[#888888]">
                      <th className="py-1.5 font-medium">Поле в CRM</th>
                      <th className="py-1.5 font-medium">Имена в форме / Webhook</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Имя клиента</td>
                      <td className="py-1.5 font-mono">Name, FIO, first_name, ФИО, Имя</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Телефон</td>
                      <td className="py-1.5 font-mono">Phone, tel, Телефон, Номер (нормализуется в E.164)</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Email</td>
                      <td className="py-1.5 font-mono">Email, mail, e-mail, Почта</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Комментарий</td>
                      <td className="py-1.5 font-mono">COMMENT, comment, message, Комментарий</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Название формы</td>
                      <td className="py-1.5 font-mono">formname, form_name, formid, Форма</td>
                    </tr>
                    <tr>
                      <td className="py-1.5 font-semibold text-[#111111]">Сквозная аналитика</td>
                      <td className="py-1.5 font-mono">utm_source, utm_medium, ym_client_id, ga_client_id</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          /* РЕЖИМ: СОЗДАНИЕ / РЕДАКТИРОВАНИЕ */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="site-name" className="text-[12px] font-medium text-[#111111] block">
                Название сайта <span className="text-rose-500">*</span>
              </label>
              <input
                id="site-name"
                type="text"
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder="Например: Основной лендинг Tilda"
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="site-url" className="text-[12px] font-medium text-[#111111] block">
                Адрес сайта (URL)
              </label>
              <input
                id="site-url"
                type="text"
                value={siteUrl}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSiteUrl(e.target.value)}
                placeholder="https://mysite.ru"
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[13px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="space-y-1.5">
                <label htmlFor="site-pipeline" className="text-[12px] font-medium text-[#111111] block">
                  Воронка для новых сделок
                </label>
                <select
                  id="site-pipeline"
                  value={targetPipelineId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                    setTargetPipelineId(e.target.value);
                    setTargetStageId("");
                  }}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">(Основная воронка по умолчанию)</option>
                  {pipelines.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="site-stage" className="text-[12px] font-medium text-[#111111] block">
                  Этап для нового лида
                </label>
                <select
                  id="site-stage"
                  value={targetStageId}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setTargetStageId(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">(Автовыбор: «Новый лид» / первый этап)</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-[#f0f0f0]">
              <div className="space-y-0.5">
                <span className="text-[12px] font-medium text-[#111111] block">
                  Активность интеграции
                </span>
                <span className="text-[11px] text-[#888888] block">
                  Если выключить — новые вебхуки с этого сайта будут отклоняться
                </span>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="pt-4 flex items-center justify-end gap-2 border-t border-[#e5e5e5]">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-[8px] px-3.5 text-[12px] font-medium border border-[#e5e5e5] bg-white text-[#333333] hover:bg-[#f5f5f5] transition-colors"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || updateMutation.isPending}
                className="h-8 rounded-[8px] bg-[#4a38f5] text-white hover:bg-[#3d2ee0] text-[12px] px-4 font-medium flex items-center transition-colors disabled:opacity-50"
              >
                {(createMutation.isPending || updateMutation.isPending) && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {mode === "create" ? "Создать и получить ссылку" : "Сохранить изменения"}
              </button>
            </div>
          </form>
        )}
      </div>
    </Sheet>
  );
}
