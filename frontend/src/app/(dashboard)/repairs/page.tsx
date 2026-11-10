"use client";

import { useState, useCallback, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Plus, Wrench, Clock, CheckCircle2 } from "lucide-react";
import { RepairsTable } from "@/components/repairs/RepairsTable";
import { RepairIntakeModal } from "@/components/repairs/RepairIntakeModal";
import { RepairReceiptModal } from "@/components/repairs/RepairReceiptModal";
import { RepairWorkOrderModal } from "@/components/repairs/RepairWorkOrderModal";
import { Guard } from "@/components/shared/Guard";
import type { RepairTicket, RepairFilterStatus, RepairPaymentStatus } from "@/lib/repairs/repairs.types";
import type { RepairOrderDTO, EquipmentIntakeItem, CreateBatchRepairPayload } from "@/lib/api/use-repairs";
import { useRepairs, useCreateRepair, useCreateBatchRepair } from "@/lib/api/use-repairs";
import type { CreateRepairPayload } from "@/schemas/repair.schema";
import { cn } from "@/lib/utils";

export default function RepairsPage() {
  return (
    <Suspense fallback={null}>
      <RepairsPageContent />
    </Suspense>
  );
}

function RepairsPageContent() {
  const [filterStatus, setFilterStatus] = useState<RepairFilterStatus>("all");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState<RepairPaymentStatus | "all">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [copyTargetTicket, setCopyTargetTicket] = useState<RepairTicket | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<RepairTicket | null>(null);
  const [workOrderTarget, setWorkOrderTarget] = useState<RepairTicket | null>(null);
  const searchParams = useSearchParams();

  const { data, isLoading, isError, error } = useRepairs({
    status: filterStatus === "all" ? undefined : filterStatus,
    paymentStatus: filterPaymentStatus === "all" ? undefined : filterPaymentStatus,
    search: searchQuery || undefined,
    limit: 25,
    offset: 0,
  });

  const createMutation = useCreateRepair();
  const createBatchMutation = useCreateBatchRepair();

  useEffect(() => {
    if (searchParams.get("create") === "1" || searchParams.get("action") === "intake") {
      setCreateModalOpen(true);
    }
  }, [searchParams]);

  const tickets = useMemo(() => {
    if (!data?.items) return [];
    return data.items.map((item: RepairOrderDTO): RepairTicket => ({
      id: item.id,
      ticket_number: item.ticketNumber,
      deal_id: item.dealId ?? null,
      deal_title: item.dealTitle ?? null,
      deal_note: item.dealNote ?? null,
      company_id: item.companyId ?? null,
      company_name: item.companyName ?? null,
      company_inn: item.companyInn ?? null,
      customer_name: item.customerName,
      customer_phone: item.customerPhone,
      customer_email: item.customerEmail ?? null,
      customer_id: item.customerId,
      additional_contacts: item.additionalContacts ?? [],
      equipment: {
        type: item.equipment.type,
        brand: item.equipment.brand,
        model: item.equipment.model,
        serial_number: item.equipment.serialNumber,
        package_contents: item.equipment.packageContents,
        appearance: item.equipment.appearance,
      },
      defect_description: item.defectDescription,
      malfunctions: item.malfunctions ?? [],
      defect_photos: item.defectPhotos,
      status: item.status,
      payment_status: item.paymentStatus || (item.status === "issued" ? "paid" : "unpaid"),
      priority: item.priority,
      master_name: item.masterName,
      master_id: item.masterId,
      estimated_cost: item.estimatedCost,
      final_cost: item.finalCost,
      received_at: item.receivedAt,
      completed_at: item.completedAt,
      delivered_at: item.deliveredAt,
      notes: item.notes,
      diagnostics: item.diagnostics
        ? {
            performed_at: item.diagnostics.performed_at,
            performed_by: item.diagnostics.performed_by,
            findings: item.diagnostics.findings,
            recommended_action: item.diagnostics.recommended_action,
            condition_notes: item.diagnostics.condition_notes,
          }
        : null,
      work_items: [],
      parts_used: [],
      nextStatus: item.nextStatus,
      allowedTransitions: item.allowedTransitions,
    }));
  }, [data]);

  const statsTotal = data?.total ?? 0;
  const statsInProgress = tickets.filter(
    (t) =>
      t.status === "intake" ||
      t.status === "waiting_parts" ||
      t.status === "diagnostics" ||
      t.status === "approval" ||
      t.status === "in_progress",
  ).length;
  const statsReady = tickets.filter((t) => t.status === "ready").length;

  const handleCreateRepair = useCallback(
    async (payload: CreateRepairPayload & { equipments?: EquipmentIntakeItem[] }) => {
      try {
        let createdOrders: RepairOrderDTO[] = [];

        if (payload.equipments && payload.equipments.length > 0) {
          const batchPayload: CreateBatchRepairPayload = {
            customer_id: payload.customer_id,
            customer_name: payload.customer_name,
            customer_phone: payload.customer_phone,
            customer_email: payload.customer_email,
            additional_contacts: payload.additional_contacts,
            company_id: payload.company_id,
            company_name: payload.company_name,
            company_inn: payload.company_inn,
            company_ogrn: payload.company_ogrn,
            company_bik: payload.company_bik,
            company_account_number: payload.company_account_number,
            company_legal_address: payload.company_legal_address,
            deal_id: payload.deal_id,
            priority: payload.priority,
            master_id: payload.master_id ?? "",
            master_name: payload.master_name,
            estimated_cost: payload.estimated_cost,
            notes: payload.notes,
            equipments: payload.equipments,
          };
          createdOrders = await createBatchMutation.mutateAsync(batchPayload);
        } else {
          const single = await createMutation.mutateAsync(payload);
          createdOrders = [single];
        }

        if (createdOrders.length > 0 && createdOrders[0]) {
          const created = createdOrders[0];
          toast.success(
            createdOrders.length > 1
              ? `Оформлен пакет ремонтов (${createdOrders.length} шт.)`
              : `Наряд-заказ ${created.ticketNumber} успешно создан`,
          );
        }
      } catch (err: unknown) {
        console.error("Ошибка при создании наряда:", err);
        const msg = err instanceof Error ? err.message : "Не удалось оформить наряд";
        toast.error(msg);
        throw err;
      }
    },
    [createBatchMutation, createMutation],
  );

  const handleCopyTicket = useCallback((ticket: RepairTicket) => {
    setCopyTargetTicket(ticket);
    setCreateModalOpen(true);
  }, []);

  return (
    <Guard requiredPermission="service_center:read" requiredModule="service_center">
      <div className="space-y-3.5">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[15px] font-semibold text-[#111111]">Сервисный центр</h1>
            <p className="mt-0.5 text-xs text-[#666666]">
              Приёмка оборудования в ремонт, диагностика и контроль
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className={cn(
              "flex items-center gap-2 rounded-[8px] px-3.5 py-1.5 text-[13px] font-medium transition-colors shadow-2xs",
              "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]",
            )}
          >
            <Plus className="h-4 w-4" />
            Новая приёмка
          </button>
        </div>

        {/* Компактный Stats Bar */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="rounded-[4px] border border-sky-200 bg-sky-50 p-1">
                <Wrench className="h-3.5 w-3.5 text-sky-700" />
              </div>
              <span className="text-[12px] font-medium text-[#666666]">Всего наряд-заказов</span>
            </div>
            <span className="font-mono text-[14px] font-semibold tabular-nums text-[#111111]">{statsTotal}</span>
          </div>
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="rounded-[4px] border border-amber-200 bg-amber-50 p-1">
                <Clock className="h-3.5 w-3.5 text-amber-700" />
              </div>
              <span className="text-[12px] font-medium text-[#666666]">В работе</span>
            </div>
            <span className="font-mono text-[14px] font-semibold tabular-nums text-[#111111]">{statsInProgress}</span>
          </div>
          <div className="flex items-center justify-between rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 shadow-2xs">
            <div className="flex items-center gap-2">
              <div className="rounded-[4px] border border-emerald-200 bg-emerald-50 p-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" />
              </div>
              <span className="text-[12px] font-medium text-[#666666]">Готовы к выдаче</span>
            </div>
            <span className="font-mono text-[14px] font-semibold tabular-nums text-[#111111]">{statsReady}</span>
          </div>
        </div>

        {/* Table */}
        <RepairsTable
          tickets={tickets}
          filterStatus={filterStatus}
          onFilterStatusChange={setFilterStatus}
          filterPaymentStatus={filterPaymentStatus}
          onFilterPaymentStatusChange={setFilterPaymentStatus}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onPrintReceipt={(ticket) => setReceiptTarget(ticket)}
          onPrintWorkOrder={(ticket) => setWorkOrderTarget(ticket)}
          onCopyTicket={handleCopyTicket}
          isLoading={isLoading}
          isError={isError}
          error={error}
        />

        {/* Modals */}
        <RepairIntakeModal
          open={createModalOpen}
          onClose={() => {
            setCreateModalOpen(false);
            setCopyTargetTicket(null);
          }}
          onSubmit={handleCreateRepair}
          initialCustomerId={searchParams.get("customer_id") ?? undefined}
          initialDealId={searchParams.get("dealId") ?? undefined}
          copyFromTicket={copyTargetTicket}
          isSubmitting={createMutation.isPending || createBatchMutation.isPending}
        />
        <RepairReceiptModal
          open={!!receiptTarget}
          ticket={receiptTarget}
          onClose={() => setReceiptTarget(null)}
        />
        <RepairWorkOrderModal
          open={!!workOrderTarget}
          ticket={workOrderTarget}
          onClose={() => setWorkOrderTarget(null)}
        />
      </div>
    </Guard>
  );
}
