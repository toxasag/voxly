"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, notFound } from "next/navigation";
import {
  ChevronLeft, Wrench, User, Calendar, Banknote, Building2,
  FileText, History, MessageCircle, Printer, Receipt, CheckCircle2,
  Loader2, Pencil, Check, X, Phone, Mail, Briefcase, Tag, Hash,
  AlertCircle, ExternalLink, Clock, ShieldCheck, Users,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RepairStatusStepper } from "@/components/repairs/detail/RepairStatusStepper";
import { WorkItemsTable } from "@/components/repairs/detail/WorkItemsTable";
import { PartsTable } from "@/components/repairs/detail/PartsTable";
import { FinancialSummary } from "@/components/repairs/detail/FinancialSummary";
import { formatOrderNumber } from "@/components/repairs/RepairsTable";
import { RepairReceiptModal } from "@/components/repairs/RepairReceiptModal";
import { RepairWorkOrderModal } from "@/components/repairs/RepairWorkOrderModal";
import { ContactPickerModal } from "@/components/repairs/detail/ContactPickerModal";
import { CompanyPickerModal } from "@/components/repairs/detail/CompanyPickerModal";
import { InvoiceCreateModal } from "@/components/finance/InvoiceCreateModal";
import { CrmChatView } from "@/components/crm/shared/CrmChatView";
import { TagPill, type TagColor } from "@/components/ui/tag";
import { Guard } from "@/components/shared/Guard";
import { isModuleInstalled } from "@/lib/context/tenant";
import { useAuth } from "@/lib/auth/use-auth";
import type { WorkItem, PartItem, RepairTicket, RepairStatus } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel, getRepairStatusColors, EQUIPMENT_TYPES } from "@/lib/repairs/repairs.types";
import {
  useRepair,
  useChangeRepairStatus,
  useRepairWorks,
  useRepairParts,
  useUpdateRepair,
  useSearchEquipmentBySerial,
} from "@/lib/api/use-repairs";
import { useTeamMembers } from "@/lib/api/use-team";
import { cn } from "@/lib/utils";

type DetailTab = "details" | "work_parts" | "history" | "finance" | "chat";

const TABS: { key: DetailTab; label: string; icon: typeof FileText }[] = [
  { key: "details", label: "Данные заказа", icon: FileText },
  { key: "work_parts", label: "Работы и запчасти", icon: Wrench },
  { key: "history", label: "История", icon: History },
  { key: "finance", label: "Финансы", icon: Receipt },
  { key: "chat", label: "Чат", icon: MessageCircle },
];

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatCost(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "0 ₽";
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

function getStatusBadge(status: string): { label: string; color: TagColor } {
  switch (status.toLowerCase()) {
    case "intake":
    case "received":
      return { label: "Принят", color: "slate" };
    case "diagnostics":
      return { label: "Диагностика", color: "sky" };
    case "in_progress":
    case "in-progress":
      return { label: "В работе", color: "sky" };
    case "waiting_parts":
      return { label: "Заказ запчастей", color: "amber" };
    case "approval":
      return { label: "Согласование", color: "amber" };
    case "ready":
    case "completed":
      return { label: "Готов", color: "emerald" };
    case "issued":
    case "delivered":
      return { label: "Выдан", color: "emerald" };
    case "rejected":
    case "cancelled":
      return { label: "Отказ", color: "rose" };
    default:
      return { label: status, color: "slate" };
  }
}

export default function RepairDetailPage() {
  const params = useParams<{ id: string }>();
  const { tenant } = useAuth();
  const displayTenant = tenant ?? { tenantName: "", plan: "", installedModules: [] };
  const hasFinance = isModuleInstalled(displayTenant.installedModules, "finance");
  const [tab, setTab] = useState<DetailTab>("details");

  const { data: detail, isLoading, isError, error } = useRepair(params.id);
  const { data: works = [] } = useRepairWorks(params.id);
  const { data: parts = [] } = useRepairParts(params.id);
  const { data: teamData } = useTeamMembers();
  const teamMembers = teamData?.members ?? [];

  const changeStatusMutation = useChangeRepairStatus();
  const updateMutation = useUpdateRepair();

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [workOrderOpen, setWorkOrderOpen] = useState(false);
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);
  const [contactPickerOpen, setContactPickerOpen] = useState(false);
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);

  // История по серийному номеру оборудования
  const serialNumber = detail?.equipment?.serialNumber ?? "";
  const equipmentHistoryQuery = useSearchEquipmentBySerial(serialNumber);
  const equipmentHistory = equipmentHistoryQuery.data?.history ?? [];

  // Состояние инлайн-редактирования карточки наряда
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    companyName: "",
    companyInn: "",
    dealTitle: "",
    dealNote: "",
    equipmentType: "",
    equipmentBrand: "",
    equipmentModel: "",
    equipmentSerial: "",
    packageContents: "",
    appearance: "",
    defectDescription: "",
    masterId: "",
    estimatedCost: "0",
  });

  const syncFormFromDetail = useCallback(() => {
    if (!detail) return;
    setEditForm({
      customerName: detail.customerName ?? "",
      customerPhone: detail.customerPhone ?? "",
      customerEmail: detail.customerEmail ?? "",
      companyName: detail.companyName ?? "",
      companyInn: detail.companyInn ?? "",
      dealTitle: detail.dealTitle ?? "",
      dealNote: detail.dealNote ?? "",
      equipmentType: detail.equipment?.type ?? "",
      equipmentBrand: detail.equipment?.brand ?? "",
      equipmentModel: detail.equipment?.model ?? "",
      equipmentSerial: detail.equipment?.serialNumber ?? "",
      packageContents: detail.equipment?.packageContents ?? "",
      appearance: detail.equipment?.appearance ?? "",
      defectDescription: detail.defectDescription ?? "",
      masterId: detail.masterId ?? "",
      estimatedCost: String(detail.estimatedCost ?? 0),
    });
  }, [detail]);

  useEffect(() => {
    if (detail && !isLoading) {
      setReceiptOpen(false);
      setWorkOrderOpen(false);
      setInvoiceCreateOpen(false);
      syncFormFromDetail();
    }
  }, [detail, isLoading, syncFormFromDetail]);

  const handleStartEdit = () => {
    syncFormFromDetail();
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    syncFormFromDetail();
    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!detail) return;
    const estNum = parseFloat(editForm.estimatedCost);

    try {
      await updateMutation.mutateAsync({
        id: detail.id,
        payload: {
          deal_title: editForm.dealTitle.trim() || undefined,
          deal_note: editForm.dealNote.trim() || undefined,
          equipment_type: editForm.equipmentType.trim() || undefined,
          equipment_brand: editForm.equipmentBrand.trim() || undefined,
          equipment_model: editForm.equipmentModel.trim() || undefined,
          equipment_serial: editForm.equipmentSerial.trim() || undefined,
          package_contents: editForm.packageContents.trim() || undefined,
          appearance: editForm.appearance.trim() || undefined,
          defect_description: editForm.defectDescription.trim() || undefined,
          master_id: editForm.masterId || undefined,
          estimated_cost: !isNaN(estNum) && estNum >= 0 ? estNum : undefined,
        },
      });
      toast.success("Данные наряд-заказа сохранены");
      setIsEditing(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить наряд-заказ");
    }
  };

  const handleMasterChange = async (newMasterId: string) => {
    if (!detail) return;
    const member = teamMembers.find((m) => m.id === newMasterId);
    const masterName = member ? member.fullName : "";
    try {
      await updateMutation.mutateAsync({
        id: detail.id,
        payload: {
          master_id: newMasterId || undefined,
          master_name: masterName || undefined,
        },
      });
      setEditForm((prev) => ({ ...prev, masterId: newMasterId }));
      toast.success(member ? `Ответственный мастер: ${member.fullName}` : "Мастер снят с заказа");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось изменить мастера");
    }
  };

  const handleSelectContact = async (c: {
    id: string;
    name: string;
    phone: string;
    email?: string | null;
    companyId?: string | null;
    companyName?: string | null;
  }) => {
    if (!detail) return;
    try {
      await updateMutation.mutateAsync({
        id: detail.id,
        payload: {
          customer_id: c.id,
        },
      });
      setEditForm((prev) => ({
        ...prev,
        customerName: c.name,
        customerPhone: c.phone,
        customerEmail: c.email ?? "",
        companyName: c.companyName ?? prev.companyName,
      }));
      toast.success(`Клиент наряда изменён: ${c.name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить клиента");
    }
  };

  const handleSelectCompany = async (comp: {
    id: string | null;
    name: string | null;
    inn: string | null;
  }) => {
    if (!detail) return;
    try {
      await updateMutation.mutateAsync({
        id: detail.id,
        payload: {
          company_id: comp.id ?? "",
        },
      });
      setEditForm((prev) => ({
        ...prev,
        companyName: comp.name ?? "",
        companyInn: comp.inn ?? "",
      }));
      toast.success(comp.id ? `Компания наряда: ${comp.name}` : "Компания отвязана (физ. лицо)");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить компанию");
    }
  };

  // Прямое изменение статуса при клике на шаги в степпере
  const handleChangeStatus = useCallback(
    (newStatus: RepairStatus) => {
      if (!detail || detail.status === newStatus) return;
      changeStatusMutation.mutate(
        { id: detail.id, payload: { status: newStatus, comment: `Статус изменен на ${getRepairStatusLabel(newStatus)}` } },
        {
          onSuccess: () => {
            toast.success(`Статус наряда изменен на «${getRepairStatusLabel(newStatus)}»`);
          },
          onError: (err) => {
            toast.error(err instanceof Error ? err.message : "Не удалось изменить статус");
          },
        },
      );
    },
    [detail, changeStatusMutation],
  );

  const handleIssue = useCallback(() => {
    if (!detail) return;
    changeStatusMutation.mutate(
      { id: detail.id, payload: { status: "issued", comment: "Order issued to client" } },
      {
        onSuccess: () => {
          toast.success("Оборудование успешно выдано заказчику");
        },
      },
    );
  }, [detail, changeStatusMutation]);

  const ticket: RepairTicket | null = detail
    ? {
        id: detail.id,
        ticket_number: detail.ticketNumber,
        deal_id: detail.dealId ?? null,
        deal_title: detail.dealTitle ?? null,
        deal_note: detail.dealNote ?? null,
        deal_budget: detail.dealBudget ?? null,
        deal_stage_name: detail.dealStageName ?? null,
        company_id: detail.companyId ?? null,
        company_name: detail.companyName ?? null,
        company_inn: detail.companyInn ?? null,
        customer_name: detail.customerName,
        customer_phone: detail.customerPhone,
        customer_email: detail.customerEmail ?? null,
        customer_id: detail.customerId,
        additional_contacts: detail.additionalContacts ?? [],
        equipment: {
          type: detail.equipment.type,
          brand: detail.equipment.brand,
          model: detail.equipment.model,
          serial_number: detail.equipment.serialNumber,
          package_contents: detail.equipment.packageContents,
          appearance: detail.equipment.appearance,
        },
        defect_description: detail.defectDescription,
        defect_photos: detail.defectPhotos,
        status: detail.status,
        priority: detail.priority,
        master_id: detail.masterId,
        master_name: detail.masterName,
        estimated_cost: detail.estimatedCost,
        final_cost: detail.finalCost,
        notes: detail.notes,
        diagnostics: detail.diagnostics
          ? {
              performed_at: detail.diagnostics.performed_at,
              performed_by: detail.diagnostics.performed_by,
              findings: detail.diagnostics.findings,
              recommended_action: detail.diagnostics.recommended_action,
              condition_notes: detail.diagnostics.condition_notes,
            }
          : null,
        received_at: detail.receivedAt,
        completed_at: detail.completedAt,
        delivered_at: detail.deliveredAt,
        work_items: works.map((w) => ({
          id: w.id,
          description: w.description,
          master_name: w.masterName,
          master_id: w.masterId,
          cost: w.cost,
        })),
        parts_used: parts.map((p) => ({
          id: p.id,
          name: p.name,
          article: p.article,
          quantity: p.quantity,
          retail_price: p.retailPrice,
          cost_price: p.costPrice,
        })),
        nextStatus: detail.nextStatus,
        allowedTransitions: detail.allowedTransitions,
      }
    : null;

  if (!ticket && !isLoading) {
    if (isError) {
      return (
        <div className="m-6 rounded-[8px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
          Ошибка загрузки: {error?.message}
        </div>
      );
    }
    notFound();
  }

  const workTotal = works.reduce((s, w) => s + w.cost, 0);
  const partsRetail = parts.reduce((s, p) => s + p.retailPrice * p.quantity, 0);
  const grandTotal = workTotal + partsRetail;

  if (isLoading || !ticket) {
    return (
      <Guard requiredPermission="service_center:read" requiredModule="service_center">
        <div className="flex flex-col md:h-[calc(100vh-4rem)] -m-6 bg-white">
          <div className="shrink-0 flex items-center justify-between border-b border-[#e5e5e5] bg-white px-6 py-3">
            <div className="h-4 w-32 bg-[#f0f0f0] rounded animate-pulse" />
            <div className="h-8 w-48 bg-[#f0f0f0] rounded animate-pulse" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-[#888888]" />
          </div>
        </div>
      </Guard>
    );
  }

  return (
    <Guard requiredPermission="service_center:read" requiredModule="service_center">
      <div className="flex flex-col h-[calc(100vh-4rem)] -m-6 bg-white">
        {/* Top Bar с кнопками «Акт приемки» и «Акт выполненных работ» */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-y-2 border-b border-[#e5e5e5] bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <Link
              href="/repairs"
              className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
              Назад
            </Link>
            <div className="h-4 w-px bg-[#e5e5e5]" />
            <span className="text-[13px] font-mono tabular-nums font-semibold text-[#111111]">
              {formatOrderNumber(ticket.ticket_number)}
            </span>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                getRepairStatusColors(ticket.status),
              )}
            >
              {getRepairStatusLabel(ticket.status)}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setReceiptOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-[#666666]" />
              Акт приемки
            </button>
            <button
              type="button"
              onClick={() => setWorkOrderOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5 text-[#666666]" />
              Акт выполненных работ
            </button>
            {hasFinance && (
              <button
                type="button"
                onClick={() => setInvoiceCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
              >
                <Receipt className="h-3.5 w-3.5" />
                Создать счёт
              </button>
            )}
            {ticket.status === "ready" && (
              <button
                type="button"
                onClick={handleIssue}
                disabled={changeStatusMutation.isPending}
                className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Завершить и выдать
              </button>
            )}
          </div>
        </div>

        {/* Компактный кликабельный статус-бар высотой ~38px (в 3 раза компактнее) */}
        <div className="shrink-0 px-6 py-2 bg-[#fbfbfb] border-b border-[#e5e5e5]">
          <RepairStatusStepper
            current={ticket.status}
            onChangeStatus={handleChangeStatus}
            disabled={changeStatusMutation.isPending}
          />
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-white">
          {/* Левая боковая панель — Карточка наряда и инлайн-редактирование */}
          <div className="w-full shrink-0 border-b border-[#e5e5e5] p-5 space-y-4 md:w-[360px] md:min-w-[360px] md:border-b-0 md:border-r md:overflow-y-auto bg-white">
            <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Карточка наряда
              </span>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
                  title="Редактировать данные заказа"
                >
                  <Pencil className="h-3 w-3" />
                  Редактировать
                </button>
              ) : (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={handleCancelEdit}
                    disabled={updateMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium text-[#666666] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={updateMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Сохранить
                  </button>
                </div>
              )}
            </div>

            {/* Client & Company Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                  Клиент и компания
                </span>
                {!isEditing && (
                  <button
                    type="button"
                    onClick={() => setContactPickerOpen(true)}
                    className="text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
                  >
                    Сменить
                  </button>
                )}
              </div>

              {!isEditing ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] text-sm font-semibold text-[#111111]">
                      {ticket.customer_name ? ticket.customer_name[0] : "К"}
                    </div>
                    <div className="min-w-0 flex-1">
                      {ticket.customer_id ? (
                        <Link
                          href={`/crm/contacts?record=${ticket.customer_id}`}
                          className="text-[13px] font-semibold text-[#111111] hover:text-[#4a38f5] hover:underline inline-flex items-center gap-1 group truncate max-w-full"
                          title="Открыть карточку контакта в CRM"
                        >
                          <span className="truncate">{ticket.customer_name}</span>
                          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 text-[#4a38f5] shrink-0 transition-opacity" />
                        </Link>
                      ) : (
                        <p className="text-[13px] font-semibold text-[#111111] truncate">
                          {ticket.customer_name}
                        </p>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-[#666666]">
                        <Phone className="h-3 w-3 text-[#888888]" />
                        <span className="font-mono">{ticket.customer_phone}</span>
                      </div>
                      {ticket.customer_email && (
                        <div className="flex items-center gap-1.5 text-xs text-[#666666] truncate mt-0.5">
                          <Mail className="h-3 w-3 text-[#888888]" />
                          <span className="truncate">{ticket.customer_email}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {ticket.company_name ? (
                    <div className="mt-2 rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-2 text-xs">
                      <div className="flex items-center justify-between font-medium text-[#111111]">
                        {ticket.company_id ? (
                          <Link
                            href={`/crm/companies?record=${ticket.company_id}`}
                            className="flex items-center gap-1.5 truncate hover:text-[#4a38f5] hover:underline group"
                            title="Открыть компанию в CRM"
                          >
                            <Building2 className="h-3.5 w-3.5 text-[#666666] shrink-0" />
                            <span className="truncate group-hover:text-[#4a38f5]">{ticket.company_name}</span>
                            <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 text-[#4a38f5] shrink-0 transition-opacity" />
                          </Link>
                        ) : (
                          <div className="flex items-center gap-1.5 truncate">
                            <Building2 className="h-3.5 w-3.5 text-[#666666] shrink-0" />
                            <span className="truncate">{ticket.company_name}</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setCompanyPickerOpen(true)}
                          className="text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer shrink-0 ml-2"
                        >
                          Сменить
                        </button>
                      </div>
                      {ticket.company_inn && (
                        <p className="mt-0.5 text-[11px] text-[#666666] font-mono">
                          ИНН: {ticket.company_inn}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center justify-between text-xs pt-1 border-t border-[#f0f0f0]">
                      <p className="text-[11px] text-[#888888]">Физ. лицо (без компании)</p>
                      <button
                        type="button"
                        onClick={() => setCompanyPickerOpen(true)}
                        className="text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
                      >
                        Привязать юр. лицо
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3 text-xs">
                  {/* Customer in Edit Mode */}
                  <div className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                        Клиент
                      </span>
                      <button
                        type="button"
                        onClick={() => setContactPickerOpen(true)}
                        className="text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
                      >
                        Выбрать из CRM
                      </button>
                    </div>
                    <p className="font-semibold text-[#111111]">{editForm.customerName || ticket.customer_name}</p>
                    <p className="text-[11px] text-[#666666] font-mono">{editForm.customerPhone || ticket.customer_phone}</p>
                  </div>

                  {/* Company in Edit Mode */}
                  <div className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                        Компания
                      </span>
                      <button
                        type="button"
                        onClick={() => setCompanyPickerOpen(true)}
                        className="text-[11px] font-medium text-[#4a38f5] hover:underline cursor-pointer"
                      >
                        Выбрать / Сменить
                      </button>
                    </div>
                    {editForm.companyName || ticket.company_name ? (
                      <div>
                        <p className="font-semibold text-[#111111]">{editForm.companyName || ticket.company_name}</p>
                        {(editForm.companyInn || ticket.company_inn) && (
                          <p className="text-[11px] text-[#666666] font-mono">
                            ИНН: {editForm.companyInn || ticket.company_inn}
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-[#888888]">Физ. лицо (без компании)</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* CRM Deal Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-2.5">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Сделка CRM
              </span>

              {!isEditing ? (
                <div className="space-y-2">
                  {ticket.deal_title ? (
                    <div>
                      {ticket.deal_id ? (
                        <Link
                          href={`/crm/deals?record=${ticket.deal_id}`}
                          className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/20 transition-colors group"
                          title="Открыть сделку в CRM"
                        >
                          <Briefcase className="h-3 w-3" />
                          <span className="truncate">{ticket.deal_title}</span>
                          <ExternalLink className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </Link>
                      ) : (
                        <div className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                          <Briefcase className="h-3 w-3" />
                          <span className="truncate">{ticket.deal_title}</span>
                        </div>
                      )}
                      <div className="inline-flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                        <Briefcase className="h-3 w-3" />
                        <span className="truncate">{ticket.deal_title}</span>
                      </div>

                      <div className="flex items-center gap-2 mt-2 text-xs text-[#666666]">
                        {ticket.deal_stage_name && (
                          <span className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[11px] text-[#666666]">
                            {ticket.deal_stage_name}
                          </span>
                        )}
                        {ticket.deal_budget !== null && ticket.deal_budget !== undefined && (
                          <span className="font-mono tabular-nums font-semibold text-[#111111]">
                            {formatCost(ticket.deal_budget)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-[#888888]">Сделка CRM не привязана</p>
                  )}

                  {ticket.deal_note && (
                    <div className="rounded-[4px] border border-[#fef08a] bg-[#fefce8] p-2 text-xs text-[#854d0e] leading-relaxed">
                      <div className="font-medium text-[11px] text-[#854d0e]/80 uppercase mb-0.5">
                        Заметка к сделке
                      </div>
                      {ticket.deal_note}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Название сделки</label>
                    <input
                      type="text"
                      value={editForm.dealTitle}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, dealTitle: e.target.value }))}
                      placeholder="Например: Ремонт iPhone 14 Pro"
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Заметка к сделке</label>
                    <textarea
                      rows={2}
                      value={editForm.dealNote}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, dealNote: e.target.value }))}
                      placeholder="Комментарий для CRM..."
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none resize-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Equipment Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-2.5">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Оборудование
              </span>

              {!isEditing ? (
                <div className="space-y-1.5 text-xs">
                  <p className="text-[13px] font-semibold text-[#111111]">
                    {ticket.equipment.brand} {ticket.equipment.model}
                  </p>
                  <div className="text-[#666666]">
                    Тип: <span className="text-[#111111]">{ticket.equipment.type || "Не указан"}</span>
                  </div>
                  <div className="text-[#666666]">
                    S/N:{" "}
                    <span className="font-mono tabular-nums text-[#111111]">
                      {ticket.equipment.serial_number || "—"}
                    </span>
                  </div>
                  <div className="text-[#666666]">
                    Комплектация:{" "}
                    <span className="text-[#111111]">
                      {ticket.equipment.package_contents || "Без комплекта"}
                    </span>
                  </div>
                  <div className="text-[#666666]">
                    Внешний вид:{" "}
                    <span className="text-[#111111]">
                      {ticket.equipment.appearance || "Без следов"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Тип устройства</label>
                    <select
                      value={editForm.equipmentType}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, equipmentType: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    >
                      <option value="">Выберите тип...</option>
                      {EQUIPMENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] text-[#666666] mb-0.5 block">Бренд</label>
                      <input
                        type="text"
                        value={editForm.equipmentBrand}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, equipmentBrand: e.target.value }))}
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-[#666666] mb-0.5 block">Модель</label>
                      <input
                        type="text"
                        value={editForm.equipmentModel}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, equipmentModel: e.target.value }))}
                        className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Серийный номер (S/N)</label>
                    <input
                      type="text"
                      value={editForm.equipmentSerial}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, equipmentSerial: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Комплектация</label>
                    <input
                      type="text"
                      value={editForm.packageContents}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, packageContents: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Внешний вид</label>
                    <input
                      type="text"
                      value={editForm.appearance}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, appearance: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Master Assignment Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-2">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
                Ответственный мастер
              </span>

              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-[#888888] shrink-0" />
                <select
                  value={isEditing ? editForm.masterId : (ticket.master_id ?? "")}
                  onChange={(e) => {
                    const newId = e.target.value;
                    if (isEditing) {
                      setEditForm((prev) => ({ ...prev, masterId: newId }));
                    } else {
                      handleMasterChange(newId);
                    }
                  }}
                  disabled={updateMutation.isPending}
                  className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] hover:border-[#cccccc] focus:border-[#4a38f5] focus:outline-none cursor-pointer transition-colors"
                >
                  <option value="">Не назначен</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Cost Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-2">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
                Финансы заказа
              </span>

              {!isEditing ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[#666666]">Предв. стоимость</span>
                    <span className="font-semibold text-[#111111] tabular-nums font-mono">
                      {formatCost(ticket.estimated_cost)}
                    </span>
                  </div>
                  {grandTotal > 0 && (
                    <div className="flex items-center justify-between border-t border-[#f0f0f0] pt-2 text-xs">
                      <span className="text-[#666666]">Итого по наряду</span>
                      <span className="font-bold text-[#111111] tabular-nums font-mono text-[13px]">
                        {formatCost(grandTotal)}
                      </span>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label className="text-[11px] text-[#666666] mb-0.5 block">
                    Предварительная стоимость (₽)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={editForm.estimatedCost}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, estimatedCost: e.target.value }))}
                    className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none font-mono"
                  />
                </div>
              )}
            </div>

            {/* Defect Description Card */}
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs space-y-2">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
                Неисправность со слов клиента
              </span>

              {!isEditing ? (
                <p className="text-xs text-[#111111] leading-relaxed whitespace-pre-wrap">
                  {ticket.defect_description || "Описание не указано."}
                </p>
              ) : (
                <textarea
                  rows={3}
                  value={editForm.defectDescription}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, defectDescription: e.target.value }))}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none resize-none leading-relaxed"
                />
              )}
            </div>
          </div>

          {/* Tab Bar + Content */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            <div className="shrink-0 flex items-center gap-1 overflow-x-auto border-b border-[#e5e5e5] bg-[#fbfbfb] px-6 py-2">
              {TABS.map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
                      tab === t.key
                        ? "bg-[#4a38f5] text-white shadow-2xs"
                        : "text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0]",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#fbfbfb]">
              {/* Вкладка 1: Данные заказа — 4 информативных блока */}
              {tab === "details" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Блок 1: Сроки и статус выполнения */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-[#f0f0f0]">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-[#4a38f5]" />
                        <h3 className="text-[13px] font-semibold text-[#111111]">
                          Сроки и статус выполнения
                        </h3>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                          getRepairStatusColors(ticket.status),
                        )}
                      >
                        {getRepairStatusLabel(ticket.status)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div className="rounded-[6px] bg-[#fafafa] p-2.5 border border-[#f0f0f0]">
                        <span className="text-[#888888] block text-[11px] mb-1">Принят в сервис</span>
                        <span className="font-medium text-[#111111]">{formatDate(ticket.received_at)}</span>
                      </div>
                      <div className="rounded-[6px] bg-[#fafafa] p-2.5 border border-[#f0f0f0]">
                        <span className="text-[#888888] block text-[11px] mb-1">Завершение ремонта</span>
                        <span className="font-medium text-[#111111]">
                          {ticket.completed_at ? formatDate(ticket.completed_at) : "В процессе"}
                        </span>
                      </div>
                      <div className="rounded-[6px] bg-[#fafafa] p-2.5 border border-[#f0f0f0]">
                        <span className="text-[#888888] block text-[11px] mb-1">Выдача клиенту</span>
                        <span className="font-medium text-[#111111]">
                          {ticket.delivered_at ? formatDate(ticket.delivered_at) : "Ожидает выдачи"}
                        </span>
                      </div>
                      <div className="rounded-[6px] bg-[#fafafa] p-2.5 border border-[#f0f0f0]">
                        <span className="text-[#888888] block text-[11px] mb-1">Приоритет наряда</span>
                        <span
                          className={cn(
                            "font-medium",
                            ticket.priority === "urgent"
                              ? "text-rose-600"
                              : ticket.priority === "high"
                                ? "text-amber-600"
                                : ticket.priority === "low"
                                  ? "text-[#888888]"
                                  : "text-[#111111]",
                          )}
                        >
                          {ticket.priority === "urgent"
                            ? "Срочный"
                            : ticket.priority === "high"
                              ? "Высокий"
                              : ticket.priority === "low"
                                ? "Низкий"
                                : "Стандартный"}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2 flex items-center justify-between text-xs border-t border-[#f0f0f0]">
                      <span className="text-[#666666]">Ответственный мастер:</span>
                      <span className="font-medium text-[#111111]">
                        {ticket.master_name || "Не назначен"}
                      </span>
                    </div>
                  </div>

                  {/* Блок 2: Документооборот и гарантия */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
                    <div className="flex items-center gap-2 pb-3 border-b border-[#f0f0f0]">
                      <ShieldCheck className="h-4 w-4 text-[#4a38f5]" />
                      <h3 className="text-[13px] font-semibold text-[#111111]">
                        Документооборот и гарантия
                      </h3>
                    </div>

                    <div className="space-y-2">
                      <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block">
                        Печатные формы
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setReceiptOpen(true)}
                          className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
                        >
                          <Printer className="h-3.5 w-3.5 text-[#666666]" />
                          Акт приемки (Договор)
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorkOrderOpen(true)}
                          className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
                        >
                          <Printer className="h-3.5 w-3.5 text-[#666666]" />
                          Акт выполненных работ
                        </button>
                        {hasFinance && (
                          <button
                            type="button"
                            onClick={() => setInvoiceCreateOpen(true)}
                            className="flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer"
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Счёт на оплату
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[6px] bg-[#fafafa] p-3 border border-[#f0f0f0] space-y-1.5 text-xs">
                      <span className="font-semibold text-[#111111] block">Условия гарантийного обслуживания</span>
                      <p className="text-[#666666] leading-relaxed text-[11px]">
                        Гарантийный срок на произведённые работы составляет 30 календарных дней с момента выдачи оборудования. Гарантия на установленные оригинальные запасные части предоставляется в соответствии с регламентом производителя.
                      </p>
                    </div>
                  </div>

                  {/* Блок 3: Связанная сделка CRM */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-[#f0f0f0]">
                      <div className="flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-[#4a38f5]" />
                        <h3 className="text-[13px] font-semibold text-[#111111]">
                          Связанная сделка CRM
                        </h3>
                      </div>
                      {ticket.deal_id && (
                        <Link
                          href={`/crm/deals?record=${ticket.deal_id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:underline"
                        >
                          Перейти в CRM
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      )}
                    </div>

                    {ticket.deal_id ? (
                      <div className="space-y-3">
                        <div className="rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <Link
                              href={`/crm/deals?record=${ticket.deal_id}`}
                              className="text-[13px] font-semibold text-[#111111] hover:text-[#4a38f5] hover:underline truncate"
                            >
                              {ticket.deal_title || `Сделка по наряду ${ticket.ticket_number}`}
                            </Link>
                            {ticket.deal_budget !== null && ticket.deal_budget !== undefined && (
                              <span className="font-mono tabular-nums font-semibold text-[#111111] text-xs">
                                {formatCost(ticket.deal_budget)}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[#888888]">Этап воронки:</span>
                            <span className="rounded-[4px] bg-white border border-[#e5e5e5] px-2 py-0.5 text-[11px] font-medium text-[#111111]">
                              {ticket.deal_stage_name || "Новый лид"}
                            </span>
                          </div>
                        </div>

                        {ticket.deal_note && (
                          <div className="rounded-[4px] border border-[#fef08a] bg-[#fefce8] p-2.5 text-xs text-[#854d0e] leading-relaxed">
                            <div className="font-medium text-[11px] text-[#854d0e]/80 uppercase mb-0.5">
                              Заметка к сделке
                            </div>
                            {ticket.deal_note}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-[6px] border border-dashed border-[#e5e5e5] p-6 text-center text-xs text-[#888888]">
                        Сделка CRM не привязана к данному наряду.
                      </div>
                    )}
                  </div>

                  {/* Блок 4: Примечания и доверенные лица */}
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-5 shadow-2xs space-y-4">
                    <div className="flex items-center gap-2 pb-3 border-b border-[#f0f0f0]">
                      <Users className="h-4 w-4 text-[#4a38f5]" />
                      <h3 className="text-[13px] font-semibold text-[#111111]">
                        Примечания и доверенные лица
                      </h3>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block mb-1">
                          Примечания к заказу
                        </span>
                        <div className="rounded-[6px] bg-[#fafafa] border border-[#f0f0f0] p-3 text-xs text-[#111111] leading-relaxed min-h-[48px] whitespace-pre-wrap">
                          {ticket.notes || "Примечания не указаны."}
                        </div>
                      </div>

                      <div>
                        <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block mb-1.5">
                          Доверенные лица / Доп. контакты
                        </span>
                        {ticket.additional_contacts && ticket.additional_contacts.length > 0 ? (
                          <div className="space-y-1.5">
                            {ticket.additional_contacts.map((ac, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] px-3 py-2 text-xs"
                              >
                                <div>
                                  <span className="font-medium text-[#111111]">{ac.name}</span>
                                  {ac.role && (
                                    <span className="ml-1.5 text-[11px] text-[#666666]">({ac.role})</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1.5 text-[#666666] font-mono">
                                  <Phone className="h-3 w-3 text-[#888888]" />
                                  <span>{ac.phone}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-[#888888] italic">
                            Доверенные лица не указаны при приёмке.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Вкладка 2: Работы и запчасти */}
              {tab === "work_parts" && (
                <div className="space-y-6">
                  <WorkItemsTable orderId={ticket.id} items={ticket.work_items} />
                  <PartsTable items={ticket.parts_used} onChange={() => {}} />
                </div>
              )}

              {/* Вкладка 3: История (по серийному номеру оборудования) */}
              {tab === "history" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[#111111]">
                        История ремонтов оборудования
                      </h3>
                      <p className="text-xs text-[#666666]">
                        {ticket.equipment.brand} {ticket.equipment.model} (S/N: {ticket.equipment.serial_number || "не указан"})
                      </p>
                    </div>
                  </div>

                  {!serialNumber ? (
                    <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-white p-8 text-center text-xs text-[#888888]">
                      <AlertCircle className="h-6 w-6 text-[#cccccc] mx-auto mb-2" />
                      Укажите серийный номер оборудования в карточке наряда, чтобы просматривать сквозную историю обращений.
                    </div>
                  ) : equipmentHistoryQuery.isLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-[#888888]" />
                    </div>
                  ) : equipmentHistory.length === 0 ? (
                    <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-white p-8 text-center text-xs text-[#888888]">
                      Предыдущих нарядов по данному серийному номеру не найдено.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {equipmentHistory.map((item) => {
                        const badge = getStatusBadge(item.status);
                        const isCurrentTicket = item.id === ticket.id;

                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "rounded-[8px] border bg-white p-4 shadow-2xs transition-colors space-y-3",
                              isCurrentTicket ? "border-[#4a38f5]/40 ring-1 ring-[#4a38f5]/20" : "border-[#e5e5e5] hover:border-[#cccccc]",
                            )}
                          >
                            <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
                              <div className="flex items-center gap-2">
                                <Link
                                  href={`/repairs/${item.id}`}
                                  className="font-mono text-xs font-semibold text-[#4a38f5] hover:underline"
                                >
                                  №{item.ticketNumber}
                                </Link>
                                {isCurrentTicket && (
                                  <span className="rounded bg-[#4a38f5]/10 text-[#4a38f5] text-[10px] font-medium px-1.5 py-0.5">
                                    Текущий заказ
                                  </span>
                                )}
                                <TagPill color={badge.color}>{badge.label}</TagPill>
                              </div>

                              <div className="flex items-center gap-1.5 text-xs text-[#666666]">
                                <Calendar className="h-3.5 w-3.5 text-[#888888]" />
                                <span>{formatDate(item.receivedAt)}</span>
                              </div>
                            </div>

                            {/* Сделка CRM и заказчик */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                              <div>
                                <span className="text-[#888888]">Заказчик:</span>{" "}
                                <span className="font-medium text-[#111111]">
                                  {item.customerName || "—"}
                                </span>
                                {item.customerPhone && (
                                  <span className="text-[#666666] ml-1">({item.customerPhone})</span>
                                )}
                              </div>
                              <div>
                                <span className="text-[#888888]">Сделка CRM:</span>{" "}
                                {item.dealTitle ? (
                                  <Link
                                    href={`/crm/deals?record=${item.dealId}`}
                                    className="font-medium text-[#4a38f5] hover:underline"
                                  >
                                    {item.dealTitle}
                                  </Link>
                                ) : (
                                  <span className="text-[#888888]">—</span>
                                )}
                              </div>
                            </div>

                            {/* Неисправность */}
                            {item.defectDescription && (
                              <div className="text-xs bg-[#fafafa] p-2.5 rounded-[6px] border border-[#f0f0f0]">
                                <span className="text-[#888888] font-medium mr-1.5">Неисправность:</span>
                                <span className="text-[#222222]">{item.defectDescription}</span>
                              </div>
                            )}

                            {/* Выполненные работы */}
                            {item.works && item.works.length > 0 && (
                              <div className="space-y-1">
                                <span className="text-[11px] font-medium text-[#888888]">
                                  Выполненные работы:
                                </span>
                                <div className="space-y-1">
                                  {item.works.map((w) => (
                                    <div
                                      key={w.id}
                                      className="flex items-center justify-between text-xs py-1 px-2 rounded bg-[#fafafa] border border-[#f0f0f0]"
                                    >
                                      <span className="text-[#111111]">{w.description}</span>
                                      <span className="font-mono tabular-nums text-[#666666]">
                                        {formatCost(w.cost)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Мастер и стоимость */}
                            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#f0f0f0] text-xs">
                              <div className="flex items-center gap-1.5 text-[#666666]">
                                <User className="h-3.5 w-3.5 text-[#888888]" />
                                <span>Мастер: <strong className="text-[#111111] font-medium">{item.masterName || "—"}</strong></span>
                              </div>

                              <div className="flex items-center justify-end gap-1.5 text-[#666666]">
                                <Banknote className="h-3.5 w-3.5 text-[#888888]" />
                                <span>
                                  Стоимость:{" "}
                                  <strong className="font-mono tabular-nums text-[#111111]">
                                    {formatCost(item.finalCost ?? item.estimatedCost)}
                                  </strong>
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Вкладка 4: Финансы (агрегация работ/запчастей + создание счета) */}
              {tab === "finance" && (
                <div className="space-y-6 max-w-2xl">
                  <FinancialSummary
                    workItems={ticket.work_items}
                    parts={ticket.parts_used}
                    hasFinanceModule={hasFinance}
                    onGenerateInvoice={() => setInvoiceCreateOpen(true)}
                  />
                </div>
              )}

              {/* Вкладка 5: Встроенный CRM-чат */}
              {tab === "chat" && (
                <div className="h-full min-h-[550px] bg-white rounded-[8px] border border-[#e5e5e5] overflow-hidden">
                  {ticket.deal_id ? (
                    <CrmChatView
                      entityType="deal"
                      entityId={ticket.deal_id}
                      entityName={ticket.deal_title || ticket.ticket_number}
                      className="h-full"
                    />
                  ) : ticket.customer_id ? (
                    <CrmChatView
                      entityType="contact"
                      entityId={ticket.customer_id}
                      entityName={ticket.customer_name}
                      className="h-full"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-20 text-center p-6">
                      <MessageCircle className="h-10 w-10 text-[#cccccc] mb-3" />
                      <p className="text-sm font-semibold text-[#111111]">CRM-чат не привязан</p>
                      <p className="text-xs text-[#888888] mt-1 max-w-sm">
                        Привяжите к наряду сделку или контакт клиента через кнопку «Редактировать», чтобы общаться в Telegram, WhatsApp и онлайн-чате.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RepairReceiptModal open={receiptOpen} ticket={ticket} onClose={() => setReceiptOpen(false)} />
      <RepairWorkOrderModal open={workOrderOpen} ticket={ticket} onClose={() => setWorkOrderOpen(false)} />
      <ContactPickerModal
        open={contactPickerOpen}
        onClose={() => setContactPickerOpen(false)}
        currentContactId={ticket.customer_id}
        onSelect={handleSelectContact}
      />
      <CompanyPickerModal
        open={companyPickerOpen}
        onClose={() => setCompanyPickerOpen(false)}
        currentCompanyId={ticket.company_id}
        onSelect={handleSelectCompany}
      />
      <InvoiceCreateModal
        open={invoiceCreateOpen}
        onClose={() => setInvoiceCreateOpen(false)}
        onSubmit={() => setInvoiceCreateOpen(false)}
        prefilled={[
          ...ticket.work_items.map((wi) => ({
            description: wi.description,
            unit_price: wi.cost,
            source: "repair_work" as const,
            source_label: ticket.ticket_number,
          })),
          ...ticket.parts_used.map((pi) => ({
            description: pi.name,
            unit_price: pi.retail_price,
            source: "repair_part" as const,
            source_label: ticket.ticket_number,
          })),
        ]}
      />
    </Guard>
  );
}
