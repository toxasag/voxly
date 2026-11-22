"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Building2,
  Plus,
  Star,
  Trash2,
  Save,
  Loader2,
  Search,
  Upload,
  FileText,
  CloudUpload,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ExternalLink,
  X,
  Eye,
  KeyRound,
} from "lucide-react";
import {
  useFinanceOrganizations,
  useCreateFinanceOrganization,
  useUpdateFinanceOrganization,
  useSetDefaultFinanceOrganization,
  useDeleteFinanceOrganization,
  useTestElbaConnection,
  useElbaBankAccounts,
  useInvoicePreviewHtml,
  type FinanceOrganizationDTO,
  type InvoiceFormConfig,
  type OrgType,
  type VatMode,
  type ElbaOrganization,
  type ElbaBankAccount,
} from "@/lib/api/use-invoices";
import { apiClient } from "@/lib/api/apiClient";
import type { CompanyInnLookupResult } from "@/lib/api/use-companies";
import { cn } from "@/lib/utils";

type SubTab = "requisites" | "invoice_form" | "elba";

const ORG_TYPES: { value: OrgType; label: string; defaultTitle: string }[] = [
  { value: "ip", label: "ИП", defaultTitle: "Индивидуальный предприниматель" },
  { value: "ooo", label: "ООО / Юр. лицо", defaultTitle: "Генеральный директор" },
  { value: "self_employed", label: "Самозанятый", defaultTitle: "Самозанятый" },
];

const VAT_MODES: { value: VatMode; label: string; hint: string }[] = [
  { value: "none", label: "Без НДС (0%)", hint: "По умолчанию для ИП / УСН / ПСН" },
  { value: "included_5", label: "НДС 5% (в т.ч.)", hint: "УСН с НДС 5%" },
  { value: "included_7", label: "НДС 7% (в т.ч.)", hint: "УСН с НДС 7%" },
  { value: "included_10", label: "НДС 10% (в т.ч.)", hint: "Льготная ставка 10%" },
  { value: "included_20", label: "НДС 20% (в т.ч.)", hint: "ОСНО / стандартная ставка" },
];

const DEFAULT_FORM_CONFIG: InvoiceFormConfig = {
  showLogo: true,
  showQrCode: true,
  showContactsHeader: true,
  showEdo: true,
  showNotice: false,
  noticeText:
    "Внимание! Оплата данного счёта означает согласие с условиями поставки товара / оказания услуг.",
  showBasis: false,
  showAccountant: false,
  showStamp: true,
  showSignature: true,
  invoiceNumberPrefix: "СЧ",
  accentColor: "#4a38f5",
  footerNote: "",
};

interface OrgDraft {
  orgType: OrgType;
  name: string;
  shortName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  website: string;
  edoInfo: string;
  bankName: string;
  bik: string;
  corrAccount: string;
  settlementAccount: string;
  directorTitle: string;
  directorName: string;
  accountantName: string;
  vatMode: VatMode;
  logoUrl: string;
  logoWidth: number;
  stampUrl: string;
  signatureUrl: string;
  invoiceConfig: InvoiceFormConfig;
  elbaEnabled: boolean;
  elbaApiKeyInput: string;
  elbaOrganizationId: string;
  elbaOrganizationName: string;
  elbaBankAccountId: string;
  elbaAutoSyncInvoices: boolean;
}

function orgToDraft(org: FinanceOrganizationDTO): OrgDraft {
  return {
    orgType: org.orgType,
    name: org.name,
    shortName: org.shortName,
    inn: org.inn,
    kpp: org.kpp,
    ogrn: org.ogrn,
    legalAddress: org.legalAddress,
    actualAddress: org.actualAddress,
    phone: org.phone,
    email: org.email,
    website: org.website,
    edoInfo: org.edoInfo,
    bankName: org.bankName,
    bik: org.bik,
    corrAccount: org.corrAccount,
    settlementAccount: org.settlementAccount,
    directorTitle: org.directorTitle,
    directorName: org.directorName,
    accountantName: org.accountantName,
    vatMode: org.vatMode,
    logoUrl: org.logoUrl,
    logoWidth: org.logoWidth,
    stampUrl: org.stampUrl,
    signatureUrl: org.signatureUrl,
    invoiceConfig: { ...DEFAULT_FORM_CONFIG, ...org.invoiceConfig },
    elbaEnabled: org.elbaEnabled,
    elbaApiKeyInput: "",
    elbaOrganizationId: org.elbaOrganizationId,
    elbaOrganizationName: org.elbaOrganizationName,
    elbaBankAccountId: org.elbaBankAccountId,
    elbaAutoSyncInvoices: org.elbaAutoSyncInvoices,
  };
}

function fileToDataUrl(file: File, maxWidth = 600): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.type === "image/svg+xml") {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Не удалось прочитать SVG"));
      reader.readAsDataURL(file);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = img.width > maxWidth ? maxWidth / img.width : 1;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(String(reader.result ?? ""));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png", 0.9));
      };
      img.onerror = () => reject(new Error("Не удалось обработать изображение"));
      img.src = String(reader.result ?? "");
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

const inputCls =
  "w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] text-[#111111] placeholder:text-[#999999] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20";
const labelCls = "block text-xs font-medium text-[#666666] mb-1";

export function OrganizationSettingsTab() {
  const { data: organizations = [], isLoading } = useFinanceOrganizations();
  const createOrg = useCreateFinanceOrganization();
  const updateOrg = useUpdateFinanceOrganization();
  const setDefaultOrg = useSetDefaultFinanceOrganization();
  const deleteOrg = useDeleteFinanceOrganization();
  const testElba = useTestElbaConnection();
  const fetchElbaAccounts = useElbaBankAccounts();
  const previewMutation = useInvoicePreviewHtml();

  const [selectedId, setSelectedId] = useState<string>("");
  const [subTab, setSubTab] = useState<SubTab>("requisites");
  const [draft, setDraft] = useState<OrgDraft | null>(null);
  const [isLookingUpInn, setIsLookingUpInn] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  const [elbaOrgs, setElbaOrgs] = useState<ElbaOrganization[]>([]);
  const [elbaAccounts, setElbaAccounts] = useState<ElbaBankAccount[]>([]);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);
  const sigInputRef = useRef<HTMLInputElement>(null);

  const selectedOrg =
    organizations.find((o) => o.id === selectedId) ??
    organizations.find((o) => o.isDefault) ??
    organizations[0] ??
    null;

  useEffect(() => {
    if (selectedOrg && selectedOrg.id !== selectedId) {
      setSelectedId(selectedOrg.id);
    }
  }, [selectedOrg, selectedId]);

  useEffect(() => {
    if (selectedOrg) {
      setDraft(orgToDraft(selectedOrg));
      setElbaOrgs([]);
      setElbaAccounts([]);
    }
  }, [selectedOrg?.id, selectedOrg?.updatedAt]);

  const buildPayload = useCallback((d: OrgDraft) => {
    return {
      org_type: d.orgType,
      name: d.name.trim(),
      short_name: d.shortName.trim(),
      inn: d.inn.trim(),
      kpp: d.kpp.trim(),
      ogrn: d.ogrn.trim(),
      legal_address: d.legalAddress.trim(),
      actual_address: d.actualAddress.trim(),
      phone: d.phone.trim(),
      email: d.email.trim(),
      website: d.website.trim(),
      edo_info: d.edoInfo.trim(),
      bank_name: d.bankName.trim(),
      bik: d.bik.trim(),
      corr_account: d.corrAccount.trim(),
      settlement_account: d.settlementAccount.trim(),
      director_title: d.directorTitle.trim(),
      director_name: d.directorName.trim(),
      accountant_name: d.accountantName.trim(),
      vat_mode: d.vatMode,
      logo_url: d.logoUrl,
      logo_width: d.logoWidth,
      stamp_url: d.stampUrl,
      signature_url: d.signatureUrl,
      invoice_config: d.invoiceConfig,
      elba_enabled: d.elbaEnabled,
      ...(d.elbaApiKeyInput.trim() ? { elba_api_key: d.elbaApiKeyInput.trim() } : {}),
      elba_organization_id: d.elbaOrganizationId.trim(),
      elba_organization_name: d.elbaOrganizationName.trim(),
      elba_bank_account_id: d.elbaBankAccountId.trim(),
      elba_auto_sync_invoices: d.elbaAutoSyncInvoices,
    };
  }, []);

  const refreshPreview = useCallback(
    async (orgId: string, d: OrgDraft) => {
      try {
        const res = await previewMutation.mutateAsync({
          id: orgId,
          payload: buildPayload(d),
        });
        setPreviewHtml(res.html);
      } catch {
        // ignore transient preview error
      }
    },
    [previewMutation, buildPayload],
  );

  // Авто-обновление живого превью при открытии вкладки конструктора счёта
  useEffect(() => {
    if (subTab === "invoice_form" && selectedOrg && draft) {
      const timer = setTimeout(() => {
        void refreshPreview(selectedOrg.id, draft);
      }, 280);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [subTab, selectedOrg?.id, draft]);

  const handleSave = async () => {
    if (!selectedOrg || !draft) return;
    if (!draft.name.trim()) {
      toast.error("Укажите наименование организации");
      return;
    }
    try {
      const updated = await updateOrg.mutateAsync({
        id: selectedOrg.id,
        payload: buildPayload(draft),
      });
      setDraft(orgToDraft(updated));
      toast.success("Настройки организации сохранены");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить настройки");
    }
  };

  const handleCreateNew = async () => {
    try {
      const created = await createOrg.mutateAsync({
        name: `Новая организация ${organizations.length + 1}`,
        org_type: "ip",
        vat_mode: "none",
      });
      setSelectedId(created.id);
      setSubTab("requisites");
      toast.success("Организация добавлена — заполните реквизиты");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить организацию");
    }
  };

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultOrg.mutateAsync(id);
      toast.success("Организация выбрана основной для выставления счетов");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось назначить основной");
    }
  };

  const handleDelete = async (id: string) => {
    if (organizations.length <= 1) {
      toast.error("Нельзя удалить единственную организацию");
      return;
    }
    try {
      await deleteOrg.mutateAsync(id);
      toast.success("Организация удалена");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить организацию");
    }
  };

  const handleInnLookup = async () => {
    if (!draft) return;
    const cleanInn = draft.inn.replace(/\D+/g, "");
    if (cleanInn.length !== 10 && cleanInn.length !== 12) {
      toast.error("Введите корректный ИНН (10 цифр для ООО или 12 для ИП)");
      return;
    }
    setIsLookingUpInn(true);
    try {
      const res = await apiClient.get<CompanyInnLookupResult>("/api/v1/finance/lookup-inn", {
        query: { inn: cleanInn },
      });
      const info = res.data;
      if (!info) {
        toast.error("Организация по этому ИНН не найдена");
        return;
      }
      const detectedType: OrgType = cleanInn.length === 10 ? "ooo" : "ip";
      setDraft((prev) =>
        prev
          ? {
              ...prev,
              orgType: detectedType,
              name: info.fullName || info.name || prev.name,
              shortName: info.name || prev.shortName,
              inn: info.inn || cleanInn,
              kpp: info.kpp || prev.kpp,
              ogrn: info.ogrn || prev.ogrn,
              legalAddress: info.legalAddress || prev.legalAddress,
              directorTitle:
                info.directorPost ||
                (detectedType === "ooo"
                  ? "Генеральный директор"
                  : "Индивидуальный предприниматель"),
              directorName: info.directorName || prev.directorName,
              vatMode: detectedType === "ip" ? "none" : prev.vatMode,
            }
          : prev,
      );
      toast.success("Реквизиты заполнены по ИНН");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось загрузить данные по ИНН");
    } finally {
      setIsLookingUpInn(false);
    }
  };

  const handleImageUpload = async (
    file: File | undefined,
    field: "logoUrl" | "stampUrl" | "signatureUrl",
    maxWidth: number,
  ) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Максимальный размер файла — 2 МБ");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file, maxWidth);
      setDraft((prev) => (prev ? { ...prev, [field]: dataUrl } : prev));
      toast.success("Изображение загружено — нажмите «Сохранить»");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Ошибка загрузки файла");
    }
  };

  const handleTestElba = async () => {
    if (!selectedOrg || !draft) return;
    try {
      const res = await testElba.mutateAsync({
        id: selectedOrg.id,
        api_key: draft.elbaApiKeyInput.trim() || undefined,
      });
      setElbaOrgs(res.organizations);
      setElbaAccounts(res.bankAccounts);

      if (res.organizations.length > 0) {
        const currentStillValid = res.organizations.find(
          (o) => o.id === draft.elbaOrganizationId,
        );
        const picked = currentStillValid ?? res.organizations[0]!;
        setDraft((prev) =>
          prev
            ? {
                ...prev,
                elbaEnabled: true,
                elbaOrganizationId: picked.id,
                elbaOrganizationName: picked.name,
                elbaBankAccountId:
                  res.bankAccounts.find((b) => b.id === prev.elbaBankAccountId)?.id ??
                  res.bankAccounts.find((b) => !b.closed)?.id ??
                  prev.elbaBankAccountId,
              }
            : prev,
        );
      }
      toast.success(`Подключено к Контур.Эльбе (организаций: ${res.organizations.length})`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Ошибка подключения к Контур.Эльбе");
    }
  };

  const handleElbaOrgSelect = async (elbaOrgId: string) => {
    if (!selectedOrg || !draft) return;
    const found = elbaOrgs.find((o) => o.id === elbaOrgId);
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            elbaOrganizationId: elbaOrgId,
            elbaOrganizationName: found?.name ?? prev.elbaOrganizationName,
            elbaBankAccountId: "",
          }
        : prev,
    );
    if (!elbaOrgId) return;
    try {
      const accounts = await fetchElbaAccounts.mutateAsync({
        id: selectedOrg.id,
        elba_organization_id: elbaOrgId,
        api_key: draft.elbaApiKeyInput.trim() || undefined,
      });
      setElbaAccounts(accounts);
      const active = accounts.find((a) => !a.closed) ?? accounts[0];
      if (active) {
        setDraft((prev) => (prev ? { ...prev, elbaBankAccountId: active.id } : prev));
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось загрузить счета из Эльбы");
    }
  };

  const handleApplyElbaBankToRequisites = () => {
    if (!draft) return;
    const acc = elbaAccounts.find((a) => a.id === draft.elbaBankAccountId);
    const elbaOrg = elbaOrgs.find((o) => o.id === draft.elbaOrganizationId);
    if (!acc && !elbaOrg) {
      toast.error("Сначала проверьте подключение и выберите организацию / счёт в Эльбе");
      return;
    }
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            ...(elbaOrg?.name ? { name: elbaOrg.name } : {}),
            ...(elbaOrg?.inn ? { inn: elbaOrg.inn } : {}),
            ...(elbaOrg?.kpp ? { kpp: elbaOrg.kpp } : {}),
            ...(elbaOrg?.ogrn ? { ogrn: elbaOrg.ogrn } : {}),
            ...(acc?.accountNumber ? { settlementAccount: acc.accountNumber } : {}),
            ...(acc?.bank.name
              ? {
                  bankName: [acc.bank.name, acc.bank.cityType, acc.bank.city]
                    .filter(Boolean)
                    .join(" "),
                }
              : {}),
            ...(acc?.bank.bik ? { bik: acc.bank.bik } : {}),
            ...(acc?.bank.corrAccount ? { corrAccount: acc.bank.corrAccount } : {}),
          }
        : prev,
    );
    toast.success("Реквизиты подтянуты из Контур.Эльбы — нажмите «Сохранить»");
  };

  const handleClearElbaKey = async () => {
    if (!selectedOrg) return;
    try {
      const updated = await updateOrg.mutateAsync({
        id: selectedOrg.id,
        payload: { clear_elba_api_key: true, elba_enabled: false },
      });
      setDraft(orgToDraft(updated));
      setElbaOrgs([]);
      setElbaAccounts([]);
      toast.success("API-ключ Контур.Эльбы удалён");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить API-ключ");
    }
  };

  if (isLoading || !draft || !selectedOrg) {
    return (
      <div className="flex items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#4a38f5]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Organization switcher bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {organizations.map((org) => {
            const active = org.id === selectedOrg.id;
            return (
              <button
                key={org.id}
                type="button"
                onClick={() => setSelectedId(org.id)}
                className={cn(
                  "flex items-center gap-2 rounded-[8px] border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                  active
                    ? "border-[#4a38f5] bg-[#4a38f5]/8 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-[#fbfbfb] text-[#111111] hover:bg-[#f5f5f5]",
                )}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span className="max-w-[240px] truncate">{org.name}</span>
                {org.isDefault && (
                  <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                    <Star className="h-2.5 w-2.5 fill-emerald-600" />
                    Основная
                  </span>
                )}
              </button>
            );
          })}

          <button
            type="button"
            onClick={() => void handleCreateNew()}
            disabled={createOrg.isPending}
            className="flex items-center gap-1.5 rounded-[8px] border border-dashed border-[#cccccc] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors cursor-pointer"
          >
            {createOrg.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Добавить организацию
          </button>
        </div>

        <div className="flex items-center gap-2">
          {!selectedOrg.isDefault && (
            <button
              type="button"
              onClick={() => void handleSetDefault(selectedOrg.id)}
              disabled={setDefaultOrg.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
            >
              <Star className="h-3.5 w-3.5 text-amber-500" />
              Сделать основной
            </button>
          )}

          {organizations.length > 1 && (
            <button
              type="button"
              onClick={() => void handleDelete(selectedOrg.id)}
              disabled={deleteOrg.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
              title="Удалить организацию"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={updateOrg.isPending}
            className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-semibold text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
          >
            {updateOrg.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            Сохранить
          </button>
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-white p-1 w-fit">
        {(
          [
            { key: "requisites", label: "Реквизиты и НДС", icon: Building2 },
            { key: "invoice_form", label: "Форма счёта РФ и логотип", icon: FileText },
            { key: "elba", label: "Контур.Эльба", icon: CloudUpload },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setSubTab(item.key)}
              className={cn(
                "flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                subTab === item.key
                  ? "bg-[#4a38f5] text-white"
                  : "text-[#666666] hover:text-[#111111]",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{item.label}</span>
              {item.key === "elba" && selectedOrg.elbaEnabled && selectedOrg.elbaHasApiKey && (
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              )}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: Requisites & VAT */}
      {subTab === "requisites" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Legal & Contact Info */}
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-4">
            <h3 className="text-sm font-semibold text-[#111111]">Юридические данные и контакты</h3>

            <div className="grid grid-cols-3 gap-2">
              {ORG_TYPES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() =>
                    setDraft((prev) =>
                      prev
                        ? {
                            ...prev,
                            orgType: t.value,
                            directorTitle: prev.directorTitle || t.defaultTitle,
                            vatMode: t.value === "ip" ? "none" : prev.vatMode,
                          }
                        : prev,
                    )
                  }
                  className={cn(
                    "h-8 rounded-[8px] border text-xs font-medium transition-colors cursor-pointer",
                    draft.orgType === t.value
                      ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                      : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <label className={labelCls}>ИНН *</label>
                <div className="flex gap-1.5">
                  <input
                    type="text"
                    value={draft.inn}
                    onChange={(e) => setDraft({ ...draft, inn: e.target.value })}
                    placeholder="10 или 12 цифр"
                    className={cn(inputCls, "font-mono")}
                  />
                  <button
                    type="button"
                    onClick={() => void handleInnLookup()}
                    disabled={isLookingUpInn}
                    className="shrink-0 h-8 inline-flex items-center gap-1 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isLookingUpInn ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Search className="h-3.5 w-3.5 text-[#4a38f5]" />
                    )}
                    По ИНН
                  </button>
                </div>
              </div>
              <div>
                <label className={labelCls}>КПП (для ООО)</label>
                <input
                  type="text"
                  value={draft.kpp}
                  onChange={(e) => setDraft({ ...draft, kpp: e.target.value })}
                  placeholder="9 цифр"
                  className={cn(inputCls, "font-mono")}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Полное наименование (как в счёте РФ) *</label>
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder="Индивидуальный предприниматель Иванов Иван Иванович"
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>ОГРН / ОГРНИП</label>
                <input
                  type="text"
                  value={draft.ogrn}
                  onChange={(e) => setDraft({ ...draft, ogrn: e.target.value })}
                  placeholder="13 или 15 цифр"
                  className={cn(inputCls, "font-mono")}
                />
              </div>
              <div>
                <label className={labelCls}>ЭДО (строка в шапке счёта)</label>
                <input
                  type="text"
                  value={draft.edoInfo}
                  onChange={(e) => setDraft({ ...draft, edoInfo: e.target.value })}
                  placeholder="ЭДО В КОНТУР ДИАДОК"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Юридический адрес</label>
              <input
                type="text"
                value={draft.legalAddress}
                onChange={(e) => setDraft({ ...draft, legalAddress: e.target.value })}
                placeholder="143923, Московская обл., г. Балашиха, ул. ..."
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Фактический адрес / адрес офиса (опционально)</label>
              <input
                type="text"
                value={draft.actualAddress}
                onChange={(e) => setDraft({ ...draft, actualAddress: e.target.value })}
                placeholder="127018, Москва, 3-й проезд Марьиной Рощи, 40с1..."
                className={inputCls}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className={labelCls}>Телефон</label>
                <input
                  type="text"
                  value={draft.phone}
                  onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  placeholder="+7 985 501 40 40"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Эл. почта</label>
                <input
                  type="email"
                  value={draft.email}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  placeholder="info@company.ru"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Сайт</label>
                <input
                  type="text"
                  value={draft.website}
                  onChange={(e) => setDraft({ ...draft, website: e.target.value })}
                  placeholder="https://site.ru"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Bank Details, VAT & Signatories */}
          <div className="space-y-4">
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#111111]">Банковские реквизиты (для платёжки и QR-кода)</h3>

              <div>
                <label className={labelCls}>Банк получателя</label>
                <input
                  type="text"
                  value={draft.bankName}
                  onChange={(e) => setDraft({ ...draft, bankName: e.target.value })}
                  placeholder='ООО "ОЗОН Банк" г Москва'
                  className={inputCls}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>БИК</label>
                  <input
                    type="text"
                    value={draft.bik}
                    onChange={(e) => setDraft({ ...draft, bik: e.target.value })}
                    placeholder="044525068"
                    className={cn(inputCls, "font-mono")}
                  />
                </div>
                <div>
                  <label className={labelCls}>Корреспондентский счёт (к/с)</label>
                  <input
                    type="text"
                    value={draft.corrAccount}
                    onChange={(e) => setDraft({ ...draft, corrAccount: e.target.value })}
                    placeholder="30101810645374525068"
                    className={cn(inputCls, "font-mono")}
                  />
                </div>
              </div>

              <div>
                <label className={labelCls}>Расчётный счёт (р/с)</label>
                <input
                  type="text"
                  value={draft.settlementAccount}
                  onChange={(e) => setDraft({ ...draft, settlementAccount: e.target.value })}
                  placeholder="40802810700000071091"
                  className={cn(inputCls, "font-mono")}
                />
              </div>
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#111111]">Режим НДС по умолчанию</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {VAT_MODES.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft({ ...draft, vatMode: opt.value })}
                    className={cn(
                      "rounded-[8px] border px-3 py-2 text-left transition-colors cursor-pointer",
                      draft.vatMode === opt.value
                        ? "border-[#4a38f5] bg-[#4a38f5]/8"
                        : "border-[#e5e5e5] bg-white hover:bg-[#fafafa]",
                    )}
                  >
                    <div
                      className={cn(
                        "text-xs font-semibold",
                        draft.vatMode === opt.value ? "text-[#4a38f5]" : "text-[#111111]",
                      )}
                    >
                      {opt.label}
                    </div>
                    <div className="text-[11px] text-[#888888] mt-0.5">{opt.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#111111]">Подписанты</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>Должность поставщика</label>
                  <input
                    type="text"
                    value={draft.directorTitle}
                    onChange={(e) => setDraft({ ...draft, directorTitle: e.target.value })}
                    placeholder="Индивидуальный предприниматель"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className={labelCls}>Расшифровка подписи</label>
                  <input
                    type="text"
                    value={draft.directorName}
                    onChange={(e) => setDraft({ ...draft, directorName: e.target.value })}
                    placeholder="Сагайдак А. Г."
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Главный бухгалтер (если требуется строка)</label>
                <input
                  type="text"
                  value={draft.accountantName}
                  onChange={(e) => setDraft({ ...draft, accountantName: e.target.value })}
                  placeholder="Оставьте пустым для ИП"
                  className={inputCls}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: RF Invoice Form Designer + Logo + Live Preview */}
      {subTab === "invoice_form" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          {/* Left Controls */}
          <div className="xl:col-span-5 space-y-4">
            {/* Logo / Stamp / Signature */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-4">
              <h3 className="text-sm font-semibold text-[#111111]">Логотип, печать и факсимиле</h3>

              {/* Logo */}
              <div className="space-y-2">
                <label className={labelCls}>Логотип компании на счёте</label>
                <input
                  ref={logoInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={(e) => void handleImageUpload(e.target.files?.[0], "logoUrl", 520)}
                />
                {draft.logoUrl ? (
                  <div className="flex items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3">
                    <img
                      src={draft.logoUrl}
                      alt="Логотип"
                      className="max-h-12 max-w-[160px] object-contain"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] hover:bg-[#f5f5f5] cursor-pointer"
                      >
                        Заменить
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, logoUrl: "" })}
                        className="h-7 w-7 flex items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-rose-600 hover:bg-rose-50 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#cccccc] bg-[#fbfbfb] py-4 text-xs font-medium text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors cursor-pointer"
                  >
                    <Upload className="h-4 w-4" />
                    Загрузить логотип (PNG, JPG, SVG)
                  </button>
                )}

                {draft.logoUrl && (
                  <div className="pt-1">
                    <div className="flex items-center justify-between text-xs text-[#666666] mb-1">
                      <span>Ширина логотипа</span>
                      <span className="font-mono text-[#111111]">{draft.logoWidth} px</span>
                    </div>
                    <input
                      type="range"
                      min={60}
                      max={240}
                      step={5}
                      value={draft.logoWidth}
                      onChange={(e) => setDraft({ ...draft, logoWidth: Number(e.target.value) })}
                      className="w-full accent-[#4a38f5]"
                    />
                  </div>
                )}
              </div>

              {/* Stamp & Signature */}
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-[#f0f0f0]">
                <div>
                  <label className={labelCls}>Печать (PNG с прозр.)</label>
                  <input
                    ref={stampInputRef}
                    type="file"
                    accept="image/png,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => void handleImageUpload(e.target.files?.[0], "stampUrl", 320)}
                  />
                  {draft.stampUrl ? (
                    <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-2">
                      <img src={draft.stampUrl} alt="Печать" className="h-10 w-10 object-contain" />
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, stampUrl: "" })}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => stampInputRef.current?.click()}
                      className="w-full h-9 flex items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[#cccccc] text-xs text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Загрузить
                    </button>
                  )}
                </div>

                <div>
                  <label className={labelCls}>Факсимиле подписи</label>
                  <input
                    ref={sigInputRef}
                    type="file"
                    accept="image/png,image/webp,image/svg+xml"
                    className="hidden"
                    onChange={(e) => void handleImageUpload(e.target.files?.[0], "signatureUrl", 320)}
                  />
                  {draft.signatureUrl ? (
                    <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-2">
                      <img src={draft.signatureUrl} alt="Подпись" className="h-10 max-w-[90px] object-contain" />
                      <button
                        type="button"
                        onClick={() => setDraft({ ...draft, signatureUrl: "" })}
                        className="p-1 text-rose-600 hover:bg-rose-50 rounded cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => sigInputRef.current?.click()}
                      className="w-full h-9 flex items-center justify-center gap-1.5 rounded-[8px] border border-dashed border-[#cccccc] text-xs text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] cursor-pointer"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Загрузить
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Blocks & Numbering */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[#111111]">Состав и оформление счёта</h3>

              <div>
                <label className={labelCls}>Префикс нумерации счетов</label>
                <input
                  type="text"
                  value={draft.invoiceConfig.invoiceNumberPrefix}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      invoiceConfig: {
                        ...draft.invoiceConfig,
                        invoiceNumberPrefix: e.target.value,
                      },
                    })
                  }
                  placeholder="СЧ"
                  className={cn(inputCls, "font-mono max-w-[140px]")}
                />
              </div>

              <div className="space-y-2 pt-1">
                {(
                  [
                    { key: "showLogo", label: "Показывать логотип в шапке счёта" },
                    { key: "showContactsHeader", label: "Показывать шапку контактов и адресов поставщика" },
                    { key: "showEdo", label: "Показывать строку ЭДО (Контур.Диадок и др.)" },
                    { key: "showQrCode", label: "Показывать QR-код для оплаты по ГОСТ Р 56042-2014" },
                    { key: "showBasis", label: "Показывать строку «Основание» (номера актов)" },
                    { key: "showNotice", label: "Показывать блок предупреждения над реквизитами" },
                    { key: "showAccountant", label: "Показывать строку подписи главного бухгалтера" },
                    { key: "showStamp", label: "Накладывать печать (если загружена)" },
                    { key: "showSignature", label: "Накладывать факсимиле подписи (если загружено)" },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 text-xs text-[#111111] cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={draft.invoiceConfig[item.key]}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          invoiceConfig: {
                            ...draft.invoiceConfig,
                            [item.key]: e.target.checked,
                          },
                        })
                      }
                      className="h-3.5 w-3.5 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>

              {draft.invoiceConfig.showNotice && (
                <div className="pt-1">
                  <label className={labelCls}>Текст блока предупреждения</label>
                  <textarea
                    rows={2}
                    value={draft.invoiceConfig.noticeText}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        invoiceConfig: { ...draft.invoiceConfig, noticeText: e.target.value },
                      })
                    }
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className={labelCls}>Примечание в подвале счёта (опционально)</label>
                <input
                  type="text"
                  value={draft.invoiceConfig.footerNote}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      invoiceConfig: { ...draft.invoiceConfig, footerNote: e.target.value },
                    })
                  }
                  placeholder="Например: Счёт действителен в течение 5 банковских дней"
                  className={inputCls}
                />
              </div>
            </div>
          </div>

          {/* Right Live Preview */}
          <div className="xl:col-span-7 rounded-[8px] border border-[#e5e5e5] bg-white overflow-hidden flex flex-col">
            <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fbfbfb] px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[#4a38f5]" />
                <span className="text-xs font-semibold text-[#111111]">
                  Предпросмотр печатной формы счёта (стандарт РФ A4)
                </span>
              </div>
              <button
                type="button"
                onClick={() => void refreshPreview(selectedOrg.id, draft)}
                disabled={previewMutation.isPending}
                className="inline-flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#666666] hover:text-[#111111] cursor-pointer"
              >
                <RefreshCw className={cn("h-3 w-3", previewMutation.isPending && "animate-spin")} />
                Обновить
              </button>
            </div>
            <div className="flex-1 bg-[#f5f5f5] p-4 min-h-[720px]">
              {previewHtml ? (
                <iframe
                  title="Предпросмотр счёта РФ"
                  srcDoc={previewHtml}
                  className="w-full h-[760px] rounded-[6px] border border-[#e5e5e5] bg-white shadow-xs"
                />
              ) : (
                <div className="flex items-center justify-center h-[400px] text-xs text-[#888888]">
                  <Loader2 className="h-4 w-4 animate-spin mr-2 text-[#4a38f5]" />
                  Генерация предпросмотра...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 3: Kontur.Elba Integration */}
      {subTab === "elba" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 rounded-[8px] border border-[#e5e5e5] bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
                  <CloudUpload className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#111111]">Интеграция с Контур.Эльбой</h3>
                  <p className="text-xs text-[#666666]">
                    Public API v1 (`elba-api.kontur.ru`) — загрузка реквизитов и выгрузка счетов
                  </p>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#111111] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={draft.elbaEnabled}
                  onChange={(e) => setDraft({ ...draft, elbaEnabled: e.target.checked })}
                  className="h-4 w-4 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                />
                Включено
              </label>
            </div>

            {/* Status banner */}
            {selectedOrg.elbaHasApiKey && (
              <div className="flex items-center justify-between rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>
                    API-ключ сохранён в зашифрованном виде (<span className="font-mono">{selectedOrg.elbaApiKeyHint}</span>)
                    {selectedOrg.elbaLastSyncAt && (
                      <span className="text-emerald-700 ml-2">
                        • Последняя синхронизация: {new Date(selectedOrg.elbaLastSyncAt).toLocaleString("ru-RU")}
                      </span>
                    )}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void handleClearElbaKey()}
                  className="text-xs font-medium text-rose-600 hover:underline cursor-pointer shrink-0 ml-2"
                >
                  Удалить ключ
                </button>
              </div>
            )}

            {selectedOrg.elbaLastError && (
              <div className="flex items-start gap-2 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Последняя ошибка Эльбы: {selectedOrg.elbaLastError}</span>
              </div>
            )}

            {/* API Key input */}
            <div>
              <label className={labelCls}>
                <span className="inline-flex items-center gap-1">
                  <KeyRound className="h-3.5 w-3.5 text-[#4a38f5]" />
                  API-ключ Контур.Эльбы (`X-Kontur-ApiKey`)
                </span>
              </label>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={draft.elbaApiKeyInput}
                  onChange={(e) => setDraft({ ...draft, elbaApiKeyInput: e.target.value })}
                  placeholder={
                    selectedOrg.elbaHasApiKey
                      ? "Оставьте пустым, чтобы использовать сохранённый ключ, или введите новый"
                      : "Вставьте API-ключ из Настроек сервиса Эльбы"
                  }
                  className={cn(inputCls, "font-mono")}
                />
                <button
                  type="button"
                  onClick={() => void handleTestElba()}
                  disabled={testElba.isPending}
                  className="shrink-0 h-8 inline-flex items-center gap-1.5 rounded-[8px] border border-[#4a38f5] bg-[#4a38f5]/8 px-3 text-xs font-semibold text-[#4a38f5] hover:bg-[#4a38f5]/15 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {testElba.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Проверить и загрузить
                </button>
              </div>
            </div>

            {/* Elba Organization & Bank Account */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div>
                <label className={labelCls}>Организация в Контур.Эльбе</label>
                {elbaOrgs.length > 0 ? (
                  <select
                    value={draft.elbaOrganizationId}
                    onChange={(e) => void handleElbaOrgSelect(e.target.value)}
                    className={inputCls}
                  >
                    <option value="">Выберите организацию...</option>
                    {elbaOrgs.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} {o.inn ? `(ИНН ${o.inn})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={draft.elbaOrganizationId}
                    onChange={(e) => setDraft({ ...draft, elbaOrganizationId: e.target.value })}
                    placeholder="UUID организации (подтянется при проверке)"
                    className={cn(inputCls, "font-mono")}
                  />
                )}
                {draft.elbaOrganizationName && (
                  <p className="text-[11px] text-[#888888] mt-1">{draft.elbaOrganizationName}</p>
                )}
              </div>

              <div>
                <label className={labelCls}>Банковский счёт в Эльбе</label>
                {elbaAccounts.length > 0 ? (
                  <select
                    value={draft.elbaBankAccountId}
                    onChange={(e) => setDraft({ ...draft, elbaBankAccountId: e.target.value })}
                    className={inputCls}
                  >
                    <option value="">Счёт по умолчанию</option>
                    {elbaAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.accountNumber} — {acc.bank.name || "Банк"}{acc.closed ? " (закрыт)" : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={draft.elbaBankAccountId}
                    onChange={(e) => setDraft({ ...draft, elbaBankAccountId: e.target.value })}
                    placeholder="UUID счёта (опционально)"
                    className={cn(inputCls, "font-mono")}
                  />
                )}
              </div>
            </div>

            {(elbaOrgs.length > 0 || elbaAccounts.length > 0) && (
              <div>
                <button
                  type="button"
                  onClick={handleApplyElbaBankToRequisites}
                  className="inline-flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-1.5 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
                >
                  <Building2 className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Заполнить реквизиты организации и банка из Эльбы
                </button>
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-3 text-xs text-[#111111] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draft.elbaAutoSyncInvoices}
                onChange={(e) =>
                  setDraft({ ...draft, elbaAutoSyncInvoices: e.target.checked })
                }
                className="mt-0.5 h-3.5 w-3.5 rounded border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
              />
              <div>
                <div className="font-medium">Автоматически выгружать новые счета в Контур.Эльбу</div>
                <div className="text-[11px] text-[#666666] mt-0.5">
                  При нажатии «Сформировать счёт» контрагент будет найден/создан по ИНН, а исходящий счёт автоматически создастся в Эльбе.
                </div>
              </div>
            </label>
          </div>

          {/* Right Help Card */}
          <div className="lg:col-span-5 rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] p-5 space-y-3 h-fit">
            <h4 className="text-sm font-semibold text-[#111111]">Как подключить Контур.Эльбу</h4>
            <ol className="list-decimal list-inside space-y-2 text-xs text-[#444444] leading-relaxed">
              <li>Откройте веб-кабинет <strong>Контур.Эльбы</strong> (тариф с поддержкой API).</li>
              <li>В правом верхнем углу перейдите в <strong>«Настройки и оплата» → «Настройки сервиса» → «API»</strong>.</li>
              <li>Выпустите новый API-ключ и вставьте его в поле слева.</li>
              <li>Нажмите <strong>«Проверить и загрузить»</strong> — подтянутся ваши организации и расчётные счета.</li>
              <li>Сохраните настройки: ключ шифруется по AES-256-GCM и никогда не возвращается в открытом виде.</li>
            </ol>
            <div className="pt-2 border-t border-[#e5e5e5]">
              <a
                href="https://developer.kontur.ru/doc/elba.public.api"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-[#4a38f5] hover:underline"
              >
                <span>Документация Kontur.Elba Public API</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
