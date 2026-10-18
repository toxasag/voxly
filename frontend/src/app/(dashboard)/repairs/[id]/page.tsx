"use client";

import { useState, useCallback, useEffect } from "react";
import { useParams, notFound } from "next/navigation";
import {
  ChevronLeft, Wrench, User, Calendar, Banknote, Building2,
  FileText, ClipboardCheck, MessageCircle, Printer, Receipt, CheckCircle2, Loader2,
} from "lucide-react";
import Link from "next/link";
import { RepairStatusStepper } from "@/components/repairs/detail/RepairStatusStepper";
import { WorkItemsTable } from "@/components/repairs/detail/WorkItemsTable";
import { PartsTable } from "@/components/repairs/detail/PartsTable";
import { DiagnosticsPanel } from "@/components/repairs/detail/DiagnosticsPanel";
import { FinancialSummary } from "@/components/repairs/detail/FinancialSummary";
import { RepairReceiptModal } from "@/components/repairs/RepairReceiptModal";
import { InvoiceCreateModal } from "@/components/finance/InvoiceCreateModal";
import type { PrefilledInvoicePayload } from "@/components/finance/InvoiceCreateModal";
import { Guard } from "@/components/shared/Guard";
import { isModuleInstalled } from "@/lib/context/tenant";
import { useAuth } from "@/lib/auth/use-auth";
import type { WorkItem, PartItem, RepairStatus, RepairTicket } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel, getRepairStatusColors, STATUS_ORDER } from "@/lib/repairs/repairs.types";
import { useRepair, useChangeRepairStatus, useRepairWorks, useRepairParts } from "@/lib/api/use-repairs";
import { cn } from "@/lib/utils";

type DetailTab = "details" | "work_parts" | "diagnostics" | "chat";

const TABS: { key: DetailTab; label: string; icon: typeof FileText }[] = [
  { key: "details", label: "Данные заказа", icon: FileText },
  { key: "work_parts", label: "Работы и запчасти", icon: Wrench },
  { key: "diagnostics", label: "Диагностика", icon: ClipboardCheck },
  { key: "chat", label: "История / Чат", icon: MessageCircle },
];

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso));
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

function toWorkItem(dto: { id: string; description: string; masterId: string; masterName: string; cost: number; createdAt: string }): WorkItem {
  return { id: dto.id, description: dto.description, master_name: dto.masterName, master_id: dto.masterId, cost: dto.cost };
}

function toPartItem(dto: { id: string; name: string; article: string; quantity: number; retailPrice: number; costPrice: number }): PartItem {
  return { id: dto.id, name: dto.name, article: dto.article, quantity: dto.quantity, retail_price: dto.retailPrice, cost_price: dto.costPrice };
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
  const changeStatusMutation = useChangeRepairStatus();

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [invoiceCreateOpen, setInvoiceCreateOpen] = useState(false);

  useEffect(() => {
    if (detail && !isLoading) {
      setReceiptOpen(false);
      setInvoiceCreateOpen(false);
    }
  }, [detail, isLoading]);

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
        customer_name: detail.customerName,
        customer_phone: detail.customerPhone,
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
        work_items: works.map(w => ({ id: w.id, description: w.description, master_name: w.masterName, master_id: w.masterId, cost: w.cost })),
        parts_used: parts.map(p => ({ id: p.id, name: p.name, article: p.article, quantity: p.quantity, retail_price: p.retailPrice, cost_price: p.costPrice })),
        nextStatus: detail.nextStatus,
        allowedTransitions: detail.allowedTransitions,
      }
    : null;

  if (!ticket && !isLoading) {
    if (isError) return <div className="m-6 rounded-[8px] border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">Ошибка загрузки: {error?.message}</div>;
    notFound();
  }

  const workTotal = works.reduce((s, w) => s + w.cost, 0);
  const partsRetail = parts.reduce((s, p) => s + p.retailPrice * p.quantity, 0);
  const partsCost = parts.reduce((s, p) => s + p.costPrice * p.quantity, 0);
  const grandTotal = workTotal + partsRetail;

  if (isLoading || !ticket) {
    return (
      <Guard requiredPermission="service_center:read" requiredModule="service_center">
      {/*
        Жёсткая высота только с md: на телефоне две области с собственной
        прокруткой поделили бы экран пополам, и в каждой осталось бы по паре
        строк. Вместо этого страница прокручивается целиком.
      */}
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
        {/*
          Top Bar. `flex-wrap` и `gap-y`: три кнопки с подписями («Печать
          квитанции», «Создать счёт», «Завершить и выдать») плюс номер заявки и
          статус в один ряд на 360px не влезают — без переноса правая группа
          уезжала за край экрана.
        */}
        <div className="shrink-0 flex flex-wrap items-center justify-between gap-y-2 border-b border-[#e5e5e5] bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <Link href="/repairs" className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] transition-colors"><ChevronLeft className="h-4 w-4" />Назад</Link>
            <div className="h-4 w-px bg-[#e5e5e5]" />
            <span className="text-[13px] font-mono tabular-nums font-semibold text-[#111111]">{ticket.ticket_number}</span>
            <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", getRepairStatusColors(ticket.status))}>{getRepairStatusLabel(ticket.status)}</span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setReceiptOpen(true)} className="flex items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"><Printer className="h-3.5 w-3.5 text-[#666666]" />Печать квитанции</button>
            {hasFinance && (
              <button type="button" onClick={() => setInvoiceCreateOpen(true)} className="flex items-center gap-1.5 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 transition-colors"><Receipt className="h-3.5 w-3.5" />Создать счёт</button>
            )}
            {ticket.status === "ready" && (
              <button type="button" onClick={handleIssue} disabled={changeStatusMutation.isPending} className="flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 transition-colors disabled:opacity-50"><CheckCircle2 className="h-3.5 w-3.5" />Завершить и выдать</button>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="shrink-0 px-6 py-4 bg-[#fbfbfb] border-b border-[#e5e5e5]">
          <RepairStatusStepper current={ticket.status} onAdvance={handleStatusAdvance} />
        </div>

        {/* Content */}
        <div className="flex flex-col md:flex-row flex-1 min-h-0 bg-white">
          {/*
            Left sidebar — Info. `min-w-[320px]` не давал колонке сжаться: на
            360px экране она занимала весь экран, а контент рядом получал
            отрицательное место и уезжал за край. На телефоне колонка становится
            обычным блоком сверху, с md: возвращается фиксированная ширина.
          */}
          <div className="w-full shrink-0 border-b border-[#e5e5e5] p-6 space-y-4 md:w-[320px] md:min-w-[320px] md:border-b-0 md:border-r md:overflow-y-auto bg-white">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f0f0f0] text-sm font-semibold text-[#111111]">{ticket.customer_name[0]}</div>
              <div><p className="text-sm font-medium text-[#111111]">{ticket.customer_name}</p><p className="text-xs text-[#666666]">{ticket.customer_phone}</p></div>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-2">
              <p className="text-sm font-semibold text-[#111111]">{ticket.equipment.brand} {ticket.equipment.model}</p>
              <div className="text-xs text-[#666666]">Тип: {ticket.equipment.type} · S/N: <span className="font-mono tabular-nums">{ticket.equipment.serial_number}</span></div>
              <div className="text-xs text-[#666666]">Комплектация: {ticket.equipment.package_contents}</div>
              <div className="text-xs text-[#666666]">Внешний вид: {ticket.equipment.appearance}</div>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
              <div className="flex items-center gap-2"><User className="h-4 w-4 text-[#888888]" /><span className="text-xs text-[#666666]">Мастер</span><span className="text-sm font-medium text-[#111111] ml-auto">{ticket.master_name}</span></div>
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
              <div className="flex items-center justify-between"><span className="text-xs text-[#666666]">Предв. стоимость</span><span className="text-sm font-semibold text-[#111111] tabular-nums font-mono">{formatCost(ticket.estimated_cost)}</span></div>
              {grandTotal > 0 && <div className="flex items-center justify-between mt-2 pt-2 border-t border-[#e5e5e5]"><span className="text-xs text-[#666666]">Сумма</span><span className="text-sm font-bold text-[#111111] tabular-nums font-mono">{formatCost(grandTotal)}</span></div>}
            </div>
            <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-2">
              <span className="text-xs font-medium text-[#888888] uppercase tracking-wider">Неисправность</span>
              <p className="text-sm text-[#111111] leading-relaxed">{ticket.defect_description}</p>
            </div>
          </div>

          {/* Tab Bar + Content */}
          <div className="flex-1 flex flex-col min-w-0 bg-white">
            {/* overflow-x-auto: четыре вкладки с иконками не влезают в 360px. */}
            <div className="shrink-0 flex items-center gap-1 overflow-x-auto border-b border-[#e5e5e5] bg-[#fbfbfb] px-6 py-2">
              {TABS.map(t => {
                const Icon = t.icon;
                return (
                  <button key={t.key} type="button" onClick={() => setTab(t.key)}
                    className={cn("flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-xs font-medium transition-colors", tab === t.key ? "bg-[#4a38f5] text-white shadow-2xs" : "text-[#666666] hover:text-[#111111] hover:bg-[#f0f0f0]")}>
                    <Icon className="h-3.5 w-3.5" />{t.label}</button>
                );
              })}
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-[#fbfbfb]">
              {tab === "details" && (
                <div className="space-y-4">
                  <div className="text-sm text-[#111111] leading-relaxed whitespace-pre-wrap">{ticket.notes || "Дополнительных примечаний нет."}</div>
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
                    <p className="text-xs text-[#666666]">Создан {formatDate(ticket.received_at)}</p>
                    {ticket.completed_at && <p className="text-xs text-[#666666] mt-1">Завершён {formatDate(ticket.completed_at)}</p>}
                    {ticket.delivered_at && <p className="text-xs text-[#666666] mt-1">Выдан {formatDate(ticket.delivered_at)}</p>}
                  </div>
                </div>
              )}
              {tab === "work_parts" && (
                <div className="space-y-6">
                  <WorkItemsTable items={ticket.work_items} onChange={() => {}} />
                  <PartsTable items={ticket.parts_used} onChange={() => {}} />
                  <FinancialSummary workItems={ticket.work_items} parts={ticket.parts_used} hasFinanceModule={hasFinance} onGenerateInvoice={() => setInvoiceCreateOpen(true)} />
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
      <InvoiceCreateModal
        open={invoiceCreateOpen}
        onClose={() => setInvoiceCreateOpen(false)}
        onSubmit={() => setInvoiceCreateOpen(false)}
        prefilled={[
          ...ticket.work_items.map(wi => ({ description: wi.description, unit_price: wi.cost, source: "repair_work" as const, source_label: ticket.ticket_number })),
          ...ticket.parts_used.map(pi => ({ description: pi.name, unit_price: pi.retail_price, source: "repair_part" as const, source_label: ticket.ticket_number })),
        ]}
      />
    </Guard>
  );
}