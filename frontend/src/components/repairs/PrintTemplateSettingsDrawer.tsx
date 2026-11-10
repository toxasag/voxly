"use client";

import { useState, useEffect, useId } from "react";
import {
  X,
  SlidersHorizontal,
  Building2,
  FileText,
  CheckSquare,
  Hash,
  Save,
  RotateCcw,
  Check,
  Eye,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  usePrintTemplateSettings,
  useUpdatePrintTemplateSettings,
  formatTicketNumber,
  type UpdatePrintTemplateSettingsPayload,
} from "@/lib/api/use-print-templates";
import { cn } from "@/lib/utils";

interface PrintTemplateSettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "general" | "intake" | "completion" | "numbering";

const DEFAULT_INTAKE_TERMS = `1. Сервисный центр производит диагностику и устранение заявленных дефектов. При обнаружении скрытых повреждений стоимость и сроки согласуются дополнительно.
2. Сервисный центр не несет ответственности за возможную потерю данных на внутренних накопителях.
3. Срок бесплатного хранения готового оборудования — 14 дней с момента уведомления клиента.`;

const DEFAULT_PDN_CONSENT = `Заказчик подтверждает согласие на обработку персональных данных в соответствии с ФЗ №152-ФЗ для исполнения договора оказания услуг.`;

const DEFAULT_WARRANTY_TERMS = `1. Гарантийный срок на выполненные работы и установленные оригинальные запасные части составляет 30 календарных дней со дня выдачи изделия.
2. Гарантия не распространяется при наличии следов попадания влаги, механических повреждений, нарушения пломб или неквалифицированного вмешательства.`;

const DEFAULT_RETURN_POLICY = `Работы выполнены в полном объеме, в установленный срок и с надлежащим качеством. Оборудование протестировано в присутствии Заказчика. Претензий по качеству и комплектности не имею.`;

export function PrintTemplateSettingsDrawer({
  open,
  onClose,
}: PrintTemplateSettingsDrawerProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { data: settings, isLoading } = usePrintTemplateSettings();
  const updateMutation = useUpdatePrintTemplateSettings();

  const [form, setForm] = useState<UpdatePrintTemplateSettingsPayload>({
    company_name: "",
    company_address: "",
    company_phone: "",
    company_email: "",
    company_website: "",
    company_inn: "",
    company_ogrn: "",
    working_hours: "",
    logo_url: "/service-logo.png",
    numbering_format: "compact",
    numbering_prefix: "№",
    intake_terms: DEFAULT_INTAKE_TERMS,
    intake_pdn_consent: DEFAULT_PDN_CONSENT,
    show_equipment_serial: true,
    show_appearance: true,
    show_package_contents: true,
    show_defect_description: true,
    show_estimated_cost: true,
    show_client_tear_off_ticket: true,
    show_intake_signatures: true,
    warranty_terms: DEFAULT_WARRANTY_TERMS,
    return_policy: DEFAULT_RETURN_POLICY,
    show_works_table: true,
    show_parts_table: true,
    show_completion_signatures: true,
    show_completion_stamp: true,
  });

  useEffect(() => {
    if (settings) {
      setForm({
        company_name: settings.companyName ?? "",
        company_address: settings.companyAddress ?? "",
        company_phone: settings.companyPhone ?? "",
        company_email: settings.companyEmail ?? "",
        company_website: settings.companyWebsite ?? "",
        company_inn: settings.companyInn ?? "",
        company_ogrn: settings.companyOgrn ?? "",
        working_hours: settings.workingHours ?? "",
        logo_url: settings.logoUrl || "/service-logo.png",
        numbering_format: settings.numberingFormat ?? "compact",
        numbering_prefix: settings.numberingPrefix ?? "№",
        intake_terms: settings.intakeTerms || DEFAULT_INTAKE_TERMS,
        intake_pdn_consent: settings.intakePdnConsent || DEFAULT_PDN_CONSENT,
        show_equipment_serial: settings.showEquipmentSerial ?? true,
        show_appearance: settings.showAppearance ?? true,
        show_package_contents: settings.showPackageContents ?? true,
        show_defect_description: settings.showDefectDescription ?? true,
        show_estimated_cost: settings.showEstimatedCost ?? true,
        show_client_tear_off_ticket: settings.showClientTearOffTicket ?? true,
        show_intake_signatures: settings.showIntakeSignatures ?? true,
        warranty_terms: settings.warrantyTerms || DEFAULT_WARRANTY_TERMS,
        return_policy: settings.returnPolicy || DEFAULT_RETURN_POLICY,
        show_works_table: settings.showWorksTable ?? true,
        show_parts_table: settings.showPartsTable ?? true,
        show_completion_signatures: settings.showCompletionSignatures ?? true,
        show_completion_stamp: settings.showCompletionStamp ?? true,
      });
    }
  }, [settings]);

  const handleFieldChange = <K extends keyof UpdatePrintTemplateSettingsPayload>(
    key: K,
    value: UpdatePrintTemplateSettingsPayload[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync(form);
      toast.success("Настройки печатных форм сохранены");
      onClose();
    } catch {
      toast.error("Не удалось сохранить настройки");
    }
  };

  const handleResetDefaults = () => {
    setForm((prev) => ({
      ...prev,
      intake_terms: DEFAULT_INTAKE_TERMS,
      intake_pdn_consent: DEFAULT_PDN_CONSENT,
      warranty_terms: DEFAULT_WARRANTY_TERMS,
      return_policy: DEFAULT_RETURN_POLICY,
      show_equipment_serial: true,
      show_appearance: true,
      show_package_contents: true,
      show_defect_description: true,
      show_estimated_cost: true,
      show_client_tear_off_ticket: true,
      show_intake_signatures: true,
      show_works_table: true,
      show_parts_table: true,
      show_completion_signatures: true,
      show_completion_stamp: true,
    }));
    toast.info("Тексты и переключатели сброшены к эталонным");
  };

  const previewSample = "0005";
  const previewFormatted = formatTicketNumber(
    previewSample,
    form.numbering_format,
    form.numbering_prefix,
  );

  return (
    <Sheet open={open} onClose={onClose} width="w-full sm:w-[580px] md:w-[620px]">
      <div className="flex h-full flex-col bg-white text-[#111111]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-[#e5e5e5] px-6 py-4 bg-[#fafafa]">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-[14px] font-semibold text-[#111111]">
                Настройки печатных форм
              </h2>
              <p className="text-[12px] text-[#666666]">
                Реквизиты, условия договоров, акты и нумерация
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex shrink-0 items-center border-b border-[#e5e5e5] bg-white px-6">
          <button
            type="button"
            onClick={() => setActiveTab("general")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-3 text-[12px] font-medium transition-colors cursor-pointer",
              activeTab === "general"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]",
            )}
          >
            <Building2 className="h-3.5 w-3.5" />
            <span>Общие и реквизиты</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("intake")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-3 text-[12px] font-medium transition-colors cursor-pointer",
              activeTab === "intake"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]",
            )}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Акт приемки</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("completion")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-3 text-[12px] font-medium transition-colors cursor-pointer",
              activeTab === "completion"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]",
            )}
          >
            <CheckSquare className="h-3.5 w-3.5" />
            <span>Акт работ</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("numbering")}
            className={cn(
              "flex items-center gap-2 border-b-2 px-3 py-3 text-[12px] font-medium transition-colors cursor-pointer",
              activeTab === "numbering"
                ? "border-[#4a38f5] text-[#4a38f5]"
                : "border-transparent text-[#666666] hover:text-[#111111]",
            )}
          >
            <Hash className="h-3.5 w-3.5" />
            <span>Нумерация</span>
          </button>
        </div>

        {/* Tab Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center text-xs text-[#666666]">
              Загрузка настроек...
            </div>
          ) : null}

          {!isLoading && activeTab === "general" && (
            <div className="space-y-4">
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <span className="text-[12px] font-semibold text-[#111111]">
                  Логотип сервиса
                </span>
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white">
                    <img
                      src={form.logo_url || "/service-logo.png"}
                      alt="Превью логотипа"
                      className="h-full w-full object-contain p-1"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = "/service-logo.png";
                      }}
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <label className="text-[11px] font-medium text-[#666666]">
                      URL адрес логотипа
                    </label>
                    <input
                      type="text"
                      value={form.logo_url || ""}
                      onChange={(e) => handleFieldChange("logo_url", e.target.value)}
                      placeholder="/service-logo.png или https://..."
                      className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Название сервисного центра / организации
                  </label>
                  <input
                    type="text"
                    value={form.company_name || ""}
                    onChange={(e) => handleFieldChange("company_name", e.target.value)}
                    placeholder="Ремонт инструмента ИП Сагайдак А.Г."
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="sm:col-span-2 space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Адрес мастерской / пункта приема
                  </label>
                  <input
                    type="text"
                    value={form.company_address || ""}
                    onChange={(e) => handleFieldChange("company_address", e.target.value)}
                    placeholder="Москва 3й проезд Марьиной рощи 40с1, 2 этаж, каб. 214"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Контактный телефон
                  </label>
                  <input
                    type="text"
                    value={form.company_phone || ""}
                    onChange={(e) => handleFieldChange("company_phone", e.target.value)}
                    placeholder="+7 977 628 20 49"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    График работы
                  </label>
                  <input
                    type="text"
                    value={form.working_hours || ""}
                    onChange={(e) => handleFieldChange("working_hours", e.target.value)}
                    placeholder="Пн-Пт 10:00-19:00"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Веб-сайт или соцсеть
                  </label>
                  <input
                    type="text"
                    value={form.company_website || ""}
                    onChange={(e) => handleFieldChange("company_website", e.target.value)}
                    placeholder="РЕМОНТ-ИНСТРУМЕНТ.РФ"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Email организации
                  </label>
                  <input
                    type="text"
                    value={form.company_email || ""}
                    onChange={(e) => handleFieldChange("company_email", e.target.value)}
                    placeholder="support@remont.ru"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    ИНН
                  </label>
                  <input
                    type="text"
                    value={form.company_inn || ""}
                    onChange={(e) => handleFieldChange("company_inn", e.target.value)}
                    placeholder="770000000000"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-[#666666]">
                    ОГРН / ОГРНИП
                  </label>
                  <input
                    type="text"
                    value={form.company_ogrn || ""}
                    onChange={(e) => handleFieldChange("company_ogrn", e.target.value)}
                    placeholder="321770000000000"
                    className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                </div>
              </div>
            </div>
          )}

          {!isLoading && activeTab === "intake" && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Условия приема техники (Договор)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFieldChange("intake_terms", DEFAULT_INTAKE_TERMS)}
                    className="text-[10px] text-[#4a38f5] hover:underline"
                  >
                    Восстановить текст
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={form.intake_terms || ""}
                  onChange={(e) => handleFieldChange("intake_terms", e.target.value)}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white p-2.5 text-[11px] leading-relaxed text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Согласие на обработку персональных данных (ПДН)
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFieldChange("intake_pdn_consent", DEFAULT_PDN_CONSENT)}
                    className="text-[10px] text-[#4a38f5] hover:underline"
                  >
                    Восстановить текст
                  </button>
                </div>
                <textarea
                  rows={2}
                  value={form.intake_pdn_consent || ""}
                  onChange={(e) => handleFieldChange("intake_pdn_consent", e.target.value)}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white p-2.5 text-[11px] leading-relaxed text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111111]">
                  <Eye className="h-3.5 w-3.5 text-[#666666]" />
                  <span>Видимость секций в акте приемки</span>
                </div>

                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Серийный номер / IMEI</span>
                    <Switch
                      checked={form.show_equipment_serial}
                      onCheckedChange={(v) => handleFieldChange("show_equipment_serial", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Внешний вид и дефекты корпуса</span>
                    <Switch
                      checked={form.show_appearance}
                      onCheckedChange={(v) => handleFieldChange("show_appearance", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Комплектация оборудования</span>
                    <Switch
                      checked={form.show_package_contents}
                      onCheckedChange={(v) => handleFieldChange("show_package_contents", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Заявленная клиентом неисправность</span>
                    <Switch
                      checked={form.show_defect_description}
                      onCheckedChange={(v) => handleFieldChange("show_defect_description", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Ориентировочная стоимость ремонта</span>
                    <Switch
                      checked={form.show_estimated_cost}
                      onCheckedChange={(v) => handleFieldChange("show_estimated_cost", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Блок подписей мастера и заказчика</span>
                    <Switch
                      checked={form.show_intake_signatures}
                      onCheckedChange={(v) => handleFieldChange("show_intake_signatures", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Отрывной талон для клиента</span>
                    <Switch
                      checked={form.show_client_tear_off_ticket}
                      onCheckedChange={(v) => handleFieldChange("show_client_tear_off_ticket", v)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isLoading && activeTab === "completion" && (
            <div className="space-y-5">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Гарантийные обязательства сервисного центра
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFieldChange("warranty_terms", DEFAULT_WARRANTY_TERMS)}
                    className="text-[10px] text-[#4a38f5] hover:underline"
                  >
                    Восстановить текст
                  </button>
                </div>
                <textarea
                  rows={4}
                  value={form.warranty_terms || ""}
                  onChange={(e) => handleFieldChange("warranty_terms", e.target.value)}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white p-2.5 text-[11px] leading-relaxed text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-[#666666]">
                    Текст приемки работ и отсутствия претензий
                  </label>
                  <button
                    type="button"
                    onClick={() => handleFieldChange("return_policy", DEFAULT_RETURN_POLICY)}
                    className="text-[10px] text-[#4a38f5] hover:underline"
                  >
                    Восстановить текст
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={form.return_policy || ""}
                  onChange={(e) => handleFieldChange("return_policy", e.target.value)}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white p-2.5 text-[11px] leading-relaxed text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-[#111111]">
                  <Eye className="h-3.5 w-3.5 text-[#666666]" />
                  <span>Видимость секций в акте выполненных работ</span>
                </div>

                <div className="space-y-2.5 pt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Таблица выполненных работ и услуг</span>
                    <Switch
                      checked={form.show_works_table}
                      onCheckedChange={(v) => handleFieldChange("show_works_table", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Таблица использованных запчастей</span>
                    <Switch
                      checked={form.show_parts_table}
                      onCheckedChange={(v) => handleFieldChange("show_parts_table", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Подписи исполнителя и заказчика</span>
                    <Switch
                      checked={form.show_completion_signatures}
                      onCheckedChange={(v) => handleFieldChange("show_completion_signatures", v)}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-[#111111]">Место для печати организации (М.П.)</span>
                    <Switch
                      checked={form.show_completion_stamp}
                      onCheckedChange={(v) => handleFieldChange("show_completion_stamp", v)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {!isLoading && activeTab === "numbering" && (
            <div className="space-y-6">
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
                <span className="text-[12px] font-semibold text-[#111111]">
                  Формат отображения номера наряда
                </span>
                <p className="text-[11px] text-[#666666]">
                  Определяет, как формируется номер заказа-наряда в таблице ремонтов и в печатных бланках.
                </p>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-1">
                  <div
                    onClick={() => handleFieldChange("numbering_format", "compact")}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-[8px] border p-3 cursor-pointer transition-colors",
                      form.numbering_format === "compact"
                        ? "border-[#4a38f5] bg-white ring-1 ring-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-[#111111]">Компактный</span>
                      {form.numbering_format === "compact" && (
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#4a38f5] text-white">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[14px] font-bold text-[#4a38f5]">№0005</span>
                    <span className="text-[10px] text-[#888888]">
                      Удобно для стикеров, полок и быстрой выдачи клиенту
                    </span>
                  </div>

                  <div
                    onClick={() => handleFieldChange("numbering_format", "full")}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-[8px] border p-3 cursor-pointer transition-colors",
                      form.numbering_format === "full"
                        ? "border-[#4a38f5] bg-white ring-1 ring-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-semibold text-[#111111]">Полный официальный</span>
                      {form.numbering_format === "full" && (
                        <div className="flex h-4 w-4 items-center justify-center rounded-full bg-[#4a38f5] text-white">
                          <Check className="h-2.5 w-2.5" />
                        </div>
                      )}
                    </div>
                    <span className="font-mono text-[14px] font-bold text-[#111111]">
                      ЗН-2026-0005
                    </span>
                    <span className="text-[10px] text-[#888888]">
                      Строгий сквозной номер с годом для бухгалтерии и юрлиц
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-medium text-[#666666]">
                  Префикс компактного номера (по умолчанию «№»)
                </label>
                <input
                  type="text"
                  value={form.numbering_prefix || "№"}
                  onChange={(e) => handleFieldChange("numbering_prefix", e.target.value)}
                  placeholder="№"
                  className="h-8 w-32 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-[12px] text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              {/* Live Preview Box */}
              <div className="rounded-[8px] border border-sky-200 bg-sky-50/60 p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-[12px] font-semibold text-sky-900">
                  <Info className="h-3.5 w-3.5 text-sky-700" />
                  <span>Синхронизация и предпросмотр нумерации</span>
                </div>
                <p className="text-[11px] text-sky-800">
                  В таблице сервисного центра и во всех актах (приемки, работ, гарантийном талоне) номер будет отображаться синхронно и единообразно:
                </p>
                <div className="flex items-center gap-3 pt-1">
                  <span className="text-[11px] text-[#666666]">Результат:</span>
                  <span className="rounded-[4px] border border-[#e5e5e5] bg-white px-2.5 py-1 font-mono text-[13px] font-bold text-[#111111]">
                    {previewFormatted}
                  </span>
                  <span className="text-[10px] text-[#888888]">
                    (никаких двойных №№ и разночтений)
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex shrink-0 items-center justify-between border-t border-[#e5e5e5] bg-[#fafafa] px-6 py-3.5">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-[12px] font-medium text-[#666666] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Сброс</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-1.5 text-[12px] font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={updateMutation.isPending}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-[12px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{updateMutation.isPending ? "Сохранение..." : "Сохранить"}</span>
            </button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}
