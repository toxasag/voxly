"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, notFound } from "next/navigation";
import {
  ChevronLeft, Wrench, User, Calendar, Banknote, Building2,
  FileText, ClipboardCheck, MessageCircle, Printer, Receipt, CheckCircle2,
  Loader2, Pencil, Check, X, Phone, Mail, Briefcase, Tag, Hash,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { RepairStatusStepper } from "@/components/repairs/detail/RepairStatusStepper";
import { WorkItemsTable } from "@/components/repairs/detail/WorkItemsTable";
import { PartsTable } from "@/components/repairs/detail/PartsTable";
import { DiagnosticsPanel } from "@/components/repairs/detail/DiagnosticsPanel";
import { FinancialSummary } from "@/components/repairs/detail/FinancialSummary";
import { RepairReceiptModal } from "@/components/repairs/RepairReceiptModal";
import { RepairWorkOrderModal } from "@/components/repairs/RepairWorkOrderModal";
import { InvoiceCreateModal } from "@/components/finance/InvoiceCreateModal";
import { Guard } from "@/components/shared/Guard";
import { isModuleInstalled } from "@/lib/context/tenant";
import { useAuth } from "@/lib/auth/use-auth";
import type { WorkItem, PartItem, RepairTicket } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel, getRepairStatusColors, EQUIPMENT_TYPES } from "@/lib/repairs/repairs.types";
import {
  useRepair,
  useChangeRepairStatus,
  useRepairWorks,
  useRepairParts,
  useUpdateRepair,
} from "@/lib/api/use-repairs";
import { useTeamMembers } from "@/lib/api/use-team";
import { cn } from "@/lib/utils";

type DetailTab = "details" | "work_parts" | "diagnostics" | "chat";

const TABS: { key: DetailTab; label: string; icon: typeof FileText }[] = [
  { key: "details", label: "Данные заказа", icon: FileText },
  { key: "work_parts", label: "Работы и запчасти", icon: Wrench },
  { key: "diagnostics", label: "Диагностика", icon: ClipboardCheck },
  { key: "chat", label: "История / Чат", icon: MessageCircle },
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
          customer_name: editForm.customerName.trim() || undefined,
          customer_phone: editForm.customerPhone.trim() || undefined,
          customer_email: editForm.customerEmail.trim() || undefined,
          company_name: editForm.companyName.trim() || undefined,
          company_inn: editForm.companyInn.trim() || undefined,
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

  const handleStatusAdvance = useCallback(() => {
    if (!detail) return;
    const next = detail.nextStatus;
    if (!next) return;
    changeStatusMutation.mutate(
      { id: detail.id, payload: { status: next, comment: `Advanced to ${next}` } },
      {
        onSettled: () => {
          // query invalidation handled by hook
        },
      },
    );
  }, [detail, changeStatusMutation]);

  const handleIssue = useCallback(() => {
    if (!detail) return;
    changeStatusMutation.mutate(
      { id: detail.id, payload: { status: "issued", comment: "Order issued to client" } },
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
        {/* Top Bar */}
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
              №{ticket.ticket_number}
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
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-[#666666]" />
              Печать квитанции
            </button>
            <button
              type="button"
              onClick={() => setWorkOrderOpen(true)}
              className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"
            >
              <Printer className="h-3.5 w-3.5 text-[#666666]" />
              Печать заказ-наряда
            </button>
            {hasFinance && (
              <button
                type="button"
                onClick={() => setInvoiceCreateOpen(true)}
                className="flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"
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
                className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Завершить и выдать
              </button>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="shrink-0 px-6 py-4 bg-[#fbfbfb] border-b border-[#e5e5e5]">
          <RepairStatusStepper current={ticket.status} onAdvance={handleStatusAdvance} />
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-white">
          {/* Left sidebar — Full Info & Inline Editing */}
          <div className="w-full shrink-0 border-b border-[#e5e5e5] p-5 space-y-4 md:w-[360px] md:min-w-[360px] md:border-b-0 md:border-r md:overflow-y-auto bg-white">
            {/* Header with edit toggle */}
            <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Карточка наряда
              </span>
              {!isEditing ? (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
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
                    className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-xs font-medium text-[#666666] hover:bg-[#f0f0f0] transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Отмена
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={updateMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
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
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                Клиент и компания
              </span>

              {!isEditing ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] text-sm font-semibold text-[#111111]">
                      {ticket.customer_name ? ticket.customer_name[0] : "К"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-[#111111] truncate">
                        {ticket.customer_name}
                      </p>
                      <div className="flex items-center gap-1.5 text-xs text-[#666666]">
                        <Phone className="h-3 w-3 text-[#888888]" />
                        <span>{ticket.customer_phone}</span>
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
                      <div className="flex items-center gap-1.5 font-medium text-[#111111]">
                        <Building2 className="h-3.5 w-3.5 text-[#666666]" />
                        <span className="truncate">{ticket.company_name}</span>
                      </div>
                      {ticket.company_inn && (
                        <p className="mt-0.5 text-[11px] text-[#666666] font-mono">
                          ИНН: {ticket.company_inn}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#888888]">Физ. лицо (без компании)</p>
                  )}
                </div>
              ) : (
                <div className="space-y-2 text-xs">
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">ФИО клиента *</label>
                    <input
                      type="text"
                      value={editForm.customerName}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, customerName: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Телефон *</label>
                    <input
                      type="text"
                      value={editForm.customerPhone}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, customerPhone: e.target.value }))}
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Email</label>
                    <input
                      type="email"
                      value={editForm.customerEmail}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, customerEmail: e.target.value }))}
                      placeholder="client@mail.ru"
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div className="border-t border-[#f0f0f0] pt-2">
                    <label className="text-[11px] text-[#666666] mb-0.5 block">Компания</label>
                    <input
                      type="text"
                      value={editForm.companyName}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, companyName: e.target.value }))}
                      placeholder="ООО «Ромашка»"
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-[#666666] mb-0.5 block">ИНН компании</label>
                    <input
                      type="text"
                      value={editForm.companyInn}
                      onChange={(e) => setEditForm((prev) => ({ ...prev, companyInn: e.target.value }))}
                      placeholder="10-12 цифр"
                      className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none font-mono"
                    />
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
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
              <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider block mb-2">
                Ответственный мастер
              </span>

              {!isEditing ? (
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-[#888888]" />
                  <span className="text-xs font-medium text-[#111111]">
                    {ticket.master_name || "Не назначен"}
                  </span>
                </div>
              ) : (
                <select
                  value={editForm.masterId}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, masterId: e.target.value }))}
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">Не назначен</option>
                  {teamMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              )}
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
                      "flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors",
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
              {tab === "details" && (
                <div className="space-y-4">
                  <div className="text-sm text-[#111111] leading-relaxed whitespace-pre-wrap">
                    {ticket.notes || "Дополнительных примечаний нет."}
                  </div>
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-1.5">
                    <p className="text-xs text-[#666666]">Создан: {formatDate(ticket.received_at)}</p>
                    {ticket.completed_at && (
                      <p className="text-xs text-[#666666]">Завершён: {formatDate(ticket.completed_at)}</p>
                    )}
                    {ticket.delivered_at && (
                      <p className="text-xs text-[#666666]">Выдан: {formatDate(ticket.delivered_at)}</p>
                    )}
                  </div>
                </div>
              )}

              {tab === "work_parts" && (
                <div className="space-y-6">
                  {/* WorkItemsTable с привязкой orderId для прямой работы с API */}
                  <WorkItemsTable orderId={ticket.id} items={ticket.work_items} />
                  <PartsTable items={ticket.parts_used} onChange={() => {}} />
                  <FinancialSummary
                    workItems={ticket.work_items}
                    parts={ticket.parts_used}
                    hasFinanceModule={hasFinance}
                    onGenerateInvoice={() => setInvoiceCreateOpen(true)}
                  />
                </div>
              )}

              {tab === "diagnostics" && (
                <DiagnosticsPanel diagnostics={ticket.diagnostics} status={ticket.status} />
              )}

              {tab === "chat" && (
                <div className="flex flex-col items-center justify-center py-20">
                  <MessageCircle className="h-10 w-10 text-[#cccccc] mb-3" />
                  <p className="text-sm text-[#888888]">Здесь появится история чата</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RepairReceiptModal open={receiptOpen} ticket={ticket} onClose={() => setReceiptOpen(false)} />
      <RepairWorkOrderModal open={workOrderOpen} ticket={ticket} onClose={() => setWorkOrderOpen(false)} />
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
