"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Wrench,
  Search,
  Printer,
  Phone,
  Building2,
  AlertCircle,
  Trash2,
  Copy,
  ChevronDown,
  FileText,
  CheckSquare,
} from "lucide-react";
import { toast } from "sonner";
import type { RepairTicket, RepairStatus, RepairFilterStatus, RepairPaymentStatus } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";
import { RecordTable, type RecordColumn } from "@/components/crm/shared/RecordTable";
import { RecordCellShell } from "@/components/crm/shared/RecordCell";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  useBatchUpdateRepairStatus,
  useBatchDeleteRepairs,
  useUpdateRepair,
  useUpdateRepairPaymentStatus,
  useBatchUpdateRepairPaymentStatus,
} from "@/lib/api/use-repairs";
import { cn } from "@/lib/utils";

interface RepairsTableProps {
  tickets: RepairTicket[];
  filterStatus: RepairFilterStatus;
  onFilterStatusChange: (status: RepairFilterStatus) => void;
  filterPaymentStatus?: RepairPaymentStatus | "all";
  onFilterPaymentStatusChange?: (status: RepairPaymentStatus | "all") => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onPrintReceipt: (ticket: RepairTicket) => void;
  onPrintWorkOrder?: (ticket: RepairTicket) => void;
  onCopyTicket?: (ticket: RepairTicket) => void;
  isLoading?: boolean;
  isError?: boolean;
  error?: Error | null;
}

// 4 стандартизированных рабочих статуса + таб «Все»
const STATUS_TABS: { value: RepairFilterStatus; label: string }[] = [
  { value: "all", label: "Все" },
  { value: "intake", label: "Принят" },
  { value: "waiting_parts", label: "Заказ запчастей" },
  { value: "ready", label: "Готов" },
  { value: "issued", label: "Выдан" },
];

/**
 * Компактное форматирование номера акта: заменяет громоздкий префикс
 * №ЗН-2026-0001 на компактный вид №0001 с сохранением исходного номера.
 */
export function formatOrderNumber(rawNumber: string): string {
  if (!rawNumber) return "";
  const clean = rawNumber.trim();
  const match = clean.match(/(?:.*-)?(\d+)$/);
  if (match && match[1]) {
    return `№${match[1]}`;
  }
  if (clean.startsWith("№")) return clean;
  return `№${clean}`;
}

function formatDateTime(iso: string): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function formatDateTimeWithFullYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function formatInternationalPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const clean = raw.trim();
  const digits = clean.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 9)} ${digits.slice(9, 11)}`;
  }
  if (digits.length === 10) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6, 8)} ${digits.slice(8, 10)}`;
  }
  if (clean.startsWith("+")) return clean;
  return clean;
}

function getEquipmentDefectLines(ticket: RepairTicket): { primary: string; additional: string } {
  const malfs = ticket.malfunctions && ticket.malfunctions.length > 0 ? ticket.malfunctions : [];
  const desc = (ticket.defect_description || "").trim();

  if (malfs.length > 0) {
    const primary = malfs[0];
    const remainingMalfs = malfs.slice(1).join(", ");
    const additional = desc && desc !== primary ? desc : remainingMalfs;
    return {
      primary,
      additional: additional || (ticket.equipment.appearance ? `Внешний вид: ${ticket.equipment.appearance}` : ""),
    };
  }

  if (desc) {
    const parts = desc.split(/\n|\. (?=[А-ЯA-Z0-9])/);
    if (parts.length > 1 && parts[0].trim().length < 45) {
      return {
        primary: parts[0].trim(),
        additional: parts.slice(1).join(". ").trim(),
      };
    }
    return {
      primary: desc,
      additional: ticket.equipment.appearance ? `Внешний вид: ${ticket.equipment.appearance}` : "",
    };
  }

  return {
    primary: "Без описания дефекта",
    additional: ticket.equipment.appearance ? `Внешний вид: ${ticket.equipment.appearance}` : "",
  };
}

function PrintDropdownMenu({
  ticket,
  onPrintReceipt,
  onPrintWorkOrder,
}: {
  ticket: RepairTicket;
  onPrintReceipt: (ticket: RepairTicket) => void;
  onPrintWorkOrder?: (ticket: RepairTicket) => void;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
      return;
    }
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }
    setIsOpen(true);
  };

  const handleReceipt = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    if (onPrintReceipt) {
      onPrintReceipt(ticket);
    } else {
      window.open(`/repairs/${ticket.id}/print/intake`, "_blank");
    }
  };

  const handleWorkOrder = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen(false);
    if (onPrintWorkOrder) {
      onPrintWorkOrder(ticket);
    } else {
      window.open(`/repairs/${ticket.id}/print/completion`, "_blank");
    }
  };

  return (
    <div className="relative inline-flex items-center justify-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#888888] hover:text-[#111111] hover:bg-black/[0.04] transition-colors cursor-pointer"
        aria-label="Печать документов"
        title="Печать документов"
      >
        <Printer className="h-3.5 w-3.5" />
      </button>

      {isOpen && coords && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
          />
          <div
            style={{ top: coords.top, right: coords.right }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[9999] w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg animate-in fade-in zoom-in-95 duration-100"
          >
            <button
              type="button"
              onClick={handleReceipt}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer text-left"
            >
              <FileText className="h-3.5 w-3.5 text-[#666666] shrink-0" />
              <span>Акт приемки (Договор)</span>
            </button>
            <button
              type="button"
              onClick={handleWorkOrder}
              className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer text-left"
            >
              <CheckSquare className="h-3.5 w-3.5 text-[#666666] shrink-0" />
              <span>Акт выполненных работ</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RepairNotePopoverCell({ ticket }: { ticket: RepairTicket }) {
  const [isOpen, setIsOpen] = useState(false);
  const [localNote, setLocalNote] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const cellRef = useRef<HTMLDivElement>(null);
  const updateRepair = useUpdateRepair();

  const noteText = localNote !== null ? localNote : (ticket.notes || ticket.deal_note || "");
  const [draft, setDraft] = useState(noteText);

  useEffect(() => {
    if (!isOpen) {
      setDraft(noteText);
    }
  }, [noteText, isOpen]);

  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (cellRef.current) {
      const rect = cellRef.current.getBoundingClientRect();
      const top = Math.min(rect.bottom + 4, window.innerHeight - 240);
      const left = Math.min(Math.max(rect.left, 16), window.innerWidth - 340);
      setCoords({ top, left, width: Math.max(rect.width, 280) });
    }
    setDraft(noteText);
    setIsOpen(true);
  };

  const handleSave = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const trimmed = draft.trim();
    const previous = noteText;
    setLocalNote(trimmed);
    setIsOpen(false);

    try {
      await updateRepair.mutateAsync({
        id: ticket.id,
        payload: { notes: trimmed, deal_note: trimmed },
      });
      toast.success("Заметка сохранена");
    } catch (err: unknown) {
      setLocalNote(previous);
      const msg = err instanceof Error ? err.message : "Не удалось сохранить заметку";
      toast.error(msg);
    }
  };

  return (
    <div
      ref={cellRef}
      onClick={handleOpen}
      className="group/note flex w-full h-full min-h-[44px] items-center cursor-pointer rounded-[4px] px-1 py-1 hover:bg-black/[0.03] transition-colors"
      title="Нажмите, чтобы изменить заметку"
    >
      {noteText ? (
        <span className="text-xs text-[#111111] line-clamp-5 whitespace-pre-wrap leading-snug break-words">
          {noteText}
        </span>
      ) : (
        <span className="text-xs text-[#888888] italic opacity-60 group-hover/note:opacity-100 transition-opacity">
          + заметка
        </span>
      )}

      {isOpen && coords && (
        <>
          <div
            className="fixed inset-0 z-[9998]"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
          />
          <div
            style={{
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxWidth: 360,
            }}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-[9999] rounded-[10px] border border-[#e5e5e5] bg-white p-3 shadow-xl animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#f0f0f0]">
              <span className="text-xs font-semibold text-[#111111]">Заметка</span>
              <span className="text-[10px] text-[#888888]">Наряд {formatOrderNumber(ticket.ticket_number)}</span>
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Текст заметки..."
              rows={4}
              autoFocus
              className="w-full resize-none rounded-[6px] border border-[#e5e5e5] bg-white p-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 leading-relaxed"
            />
            <div className="mt-2.5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsOpen(false);
                }}
                className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={updateRepair.isPending}
                className="rounded-[6px] bg-[#4a38f5] px-3 py-1 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
              >
                {updateRepair.isPending ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function formatCost(amount: number | null): string {
  if (amount === null || amount === undefined) return "0 ₽";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function renderStatusBadge(status: RepairStatus) {
  switch (status) {
    case "intake":
      return (
        <span className="inline-flex items-center rounded-[4px] border border-[#bae6fd] bg-[#e0f2fe] px-2 py-0.5 text-xs font-medium text-[#0369a1]">
          Принят
        </span>
      );
    case "waiting_parts":
      return (
        <span className="inline-flex items-center rounded-[4px] border border-[#fde68a] bg-[#fef3c7] px-2 py-0.5 text-xs font-medium text-[#92400e]">
          Заказ запчастей
        </span>
      );
    case "ready":
      return (
        <span className="inline-flex items-center rounded-[4px] border border-[#bbf7d0] bg-[#dcfce7] px-2 py-0.5 text-xs font-medium text-[#15803d]">
          Готов
        </span>
      );
    case "issued":
      return (
        <span className="inline-flex items-center rounded-[4px] border border-[#bbf7d0] bg-[#f0fdf4] px-2 py-0.5 text-xs font-medium text-[#166534]">
          Выдан
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center rounded-[4px] border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
          {getRepairStatusLabel(status)}
        </span>
      );
  }
}

function PaymentStatusBadge({
  status,
  onChange,
  disabled,
}: {
  status: RepairPaymentStatus;
  onChange: (newStatus: RepairPaymentStatus) => void;
  disabled?: boolean;
}) {
  const colorClass =
    status === "paid"
      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100/80"
      : status === "invoiced"
        ? "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100/80"
        : "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5] hover:bg-[#ebebeb]";

  return (
    <div
      className="relative inline-flex items-center"
      onClick={(e) => e.stopPropagation()}
    >
      <select
        value={status}
        disabled={disabled}
        onChange={(e) => {
          e.stopPropagation();
          onChange(e.target.value as RepairPaymentStatus);
        }}
        onClick={(e) => e.stopPropagation()}
        title="Быстро сменить статус оплаты"
        className={cn(
          "h-5 appearance-none rounded-[4px] border pl-2 pr-4 text-[10px] font-medium leading-none cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-[#4a38f5]",
          colorClass,
          disabled && "opacity-60 cursor-not-allowed",
        )}
      >
        <option value="unpaid">Не оплачен</option>
        <option value="invoiced">Счет выставлен</option>
        <option value="paid">Оплачен</option>
      </select>
      <ChevronDown className="pointer-events-none absolute right-1 h-2.5 w-2.5 opacity-60" />
    </div>
  );
}

export const RepairsTable = memo(function RepairsTable({
  tickets,
  filterStatus,
  onFilterStatusChange,
  filterPaymentStatus,
  onFilterPaymentStatusChange,
  searchQuery,
  onSearchChange,
  onPrintReceipt,
  onPrintWorkOrder,
  onCopyTicket,
  isLoading,
  isError,
  error,
}: RepairsTableProps) {
  const router = useRouter();

  // Пакетные операции (выбор строк чекбоксами)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [selectedBulkStatus, setSelectedBulkStatus] = useState<string>("");
  const [selectedBulkPaymentStatus, setSelectedBulkPaymentStatus] = useState<string>("");

  const batchStatusMutation = useBatchUpdateRepairStatus();
  const batchDeleteMutation = useBatchDeleteRepairs();
  const updatePaymentStatusMutation = useUpdateRepairPaymentStatus();
  const batchPaymentStatusMutation = useBatchUpdateRepairPaymentStatus();

  const handleRowClick = useCallback(
    (id: string) => {
      router.push(`/repairs/${id}`);
    },
    [router],
  );

  const handleSinglePaymentStatusChange = useCallback(
    async (id: string, newStatus: RepairPaymentStatus) => {
      try {
        await updatePaymentStatusMutation.mutateAsync({
          id,
          paymentStatus: newStatus,
        });
        const label =
          newStatus === "paid" ? "Оплачен" : newStatus === "invoiced" ? "Счет выставлен" : "Не оплачен";
        toast.success(`Статус оплаты изменен на «${label}»`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Ошибка обновления статуса оплаты";
        toast.error(msg);
      }
    },
    [updatePaymentStatusMutation],
  );

  const handleBulkStatusChange = async (newStatus: RepairStatus) => {
    if (selectedIds.size === 0) return;
    try {
      await batchStatusMutation.mutateAsync({
        ids: Array.from(selectedIds),
        status: newStatus,
      });
      toast.success(`Статус обновлен для ${selectedIds.size} наряд-заказов`);
      setSelectedIds(new Set());
      setSelectedBulkStatus("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка при смене статуса";
      toast.error(msg);
    }
  };

  const handleBulkPaymentStatusChange = async (newPaymentStatus: RepairPaymentStatus) => {
    if (selectedIds.size === 0) return;
    try {
      await batchPaymentStatusMutation.mutateAsync({
        ids: Array.from(selectedIds),
        paymentStatus: newPaymentStatus,
      });
      toast.success(`Статус оплаты обновлен для ${selectedIds.size} наряд-заказов`);
      setSelectedIds(new Set());
      setSelectedBulkPaymentStatus("");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка при смене статуса оплаты";
      toast.error(msg);
    }
  };

  const handleBulkDeleteConfirm = async () => {
    if (selectedIds.size === 0) return;
    try {
      await batchDeleteMutation.mutateAsync({
        ids: Array.from(selectedIds),
      });
      toast.success(`Удалено наряд-заказов: ${selectedIds.size}`);
      setSelectedIds(new Set());
      setIsDeleteDialogOpen(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ошибка при удалении";
      toast.error(msg);
    }
  };

  const columns = useMemo<RecordColumn<RepairTicket>[]>(
    () => [
      {
        id: "ticket_number",
        header: "Акт приема",
        width: 160,
        sortValue: (t) => t.ticket_number,
        render: (ticket) => (
          <RecordCellShell isLabelIdentifier>
            <div className="flex flex-col py-1 min-w-0" title={`Исходный номер: ${ticket.ticket_number}`}>
              <span className="font-mono text-xs font-bold text-[#111111] tracking-tight">
                {formatOrderNumber(ticket.ticket_number)}
              </span>
              <span className="text-[11px] text-[#666666] leading-tight mt-0.5 whitespace-nowrap">
                {formatDateTimeWithFullYear(ticket.received_at)}
              </span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "equipment",
        header: "Оборудование",
        width: 250,
        sortValue: (t) => `${t.equipment.brand} ${t.equipment.model}`,
        render: (ticket) => {
          const brand = (ticket.equipment.brand || "").trim();
          const model = (ticket.equipment.model || "").trim();
          const fullModel =
            brand && !model.toLowerCase().includes(brand.toLowerCase())
              ? `${brand} ${model}`
              : model || brand || "Оборудование";
          const type = (ticket.equipment.type || "").trim() || "Оборудование";
          const serial = (ticket.equipment.serial_number || "").trim();
          const defectLines = getEquipmentDefectLines(ticket);

          return (
            <RecordCellShell>
              <div className="flex flex-col py-1 min-w-0 leading-tight w-full">
                {/* 1. Модель крупным/полужирным шрифтом */}
                <span className="truncate text-xs font-bold text-[#111111]" title={fullModel}>
                  {fullModel}
                </span>
                {/* 2. Категория / тип оборудования */}
                <span className="truncate text-[11px] text-[#666666] mt-0.5" title={type}>
                  {type}
                </span>
                {/* 3. Серийный номер */}
                <span className="truncate font-mono text-[10px] text-[#777777] mt-0.5">
                  S/N: {serial || "—"}
                </span>
                {/* 4. Основная заявленная неисправность */}
                <span
                  className="truncate text-[11px] font-medium text-[#111111] mt-0.5"
                  title={defectLines.primary}
                >
                  {defectLines.primary}
                </span>
                {/* 5. Дополнительное описание дефекта (курсив, мягкий перенос) */}
                {defectLines.additional ? (
                  <span
                    className="line-clamp-1 text-[10px] italic text-[#666666] mt-0.5"
                    title={defectLines.additional}
                  >
                    {defectLines.additional}
                  </span>
                ) : (
                  <span className="text-[10px] text-[#aaaaaa] italic mt-0.5">—</span>
                )}
              </div>
            </RecordCellShell>
          );
        },
      },
      {
        id: "customer_name",
        header: "Клиент",
        width: 220,
        sortValue: (t) => t.customer_name,
        render: (ticket) => {
          const compName = (ticket.company_name || "").trim();
          return (
            <RecordCellShell>
              <div className="flex flex-col py-1 min-w-0 leading-tight w-full">
                {/* 1. Имя контактного лица */}
                <span className="truncate text-xs font-semibold text-[#111111]" title={ticket.customer_name}>
                  {ticket.customer_name || "Без имени"}
                </span>
                {/* 2. Организация / юрлицо либо Частное лицо */}
                <div className="flex items-center gap-1 text-[11px] text-[#666666] truncate mt-0.5">
                  {compName ? (
                    <span
                      className="inline-flex items-center gap-1 truncate text-[#555555]"
                      title={`${compName}${ticket.company_inn ? ` (ИНН: ${ticket.company_inn})` : ""}`}
                    >
                      <Building2 className="h-2.5 w-2.5 shrink-0 text-[#888888]" />
                      <span className="truncate">{compName}</span>
                    </span>
                  ) : (
                    <span className="text-[#888888] italic">Частное лицо</span>
                  )}
                </div>
                {/* 3. Телефон в международном формате */}
                <div className="flex items-center gap-1 text-[11px] text-[#666666] mt-0.5">
                  <Phone className="h-2.5 w-2.5 shrink-0 text-[#888888]" />
                  <span className="font-mono text-[11px] text-[#666666]">
                    {formatInternationalPhone(ticket.customer_phone)}
                  </span>
                </div>
              </div>
            </RecordCellShell>
          );
        },
      },
      {
        id: "deal",
        header: "Сделка",
        width: 170,
        sortValue: (t) => t.deal_title ?? "",
        render: (ticket) => (
          <RecordCellShell>
            {ticket.deal_title ? (
              <span
                className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-[11px] font-medium text-[#4a38f5] max-w-[155px] truncate"
                title={ticket.deal_title}
              >
                <span className="truncate">{ticket.deal_title}</span>
              </span>
            ) : (
              <span className="text-xs text-[#888888]">—</span>
            )}
          </RecordCellShell>
        ),
      },
      {
        id: "deal_note",
        header: "Заметка",
        width: 200,
        render: (ticket) => (
          <RecordCellShell>
            <RepairNotePopoverCell ticket={ticket} />
          </RecordCellShell>
        ),
      },
      {
        id: "status",
        header: "Статус",
        width: 140,
        sortValue: (t) => t.status,
        render: (ticket) => (
          <RecordCellShell>
            {renderStatusBadge(ticket.status)}
          </RecordCellShell>
        ),
      },
      {
        id: "team",
        header: "Команда",
        width: 140,
        sortValue: (t) => t.master_name,
        render: (ticket) => (
          <RecordCellShell>
            <div className="flex items-center gap-1.5 truncate text-xs text-[#111111]">
              <Wrench className="h-3 w-3 shrink-0 text-[#888888]" />
              <span className="truncate">{ticket.master_name || "Не назначен"}</span>
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "cost",
        header: "Сумма",
        width: 145,
        align: "right",
        sortValue: (t) => t.final_cost ?? t.estimated_cost ?? 0,
        render: (ticket) => (
          <RecordCellShell align="right">
            <div className="flex flex-col items-end py-0.5 gap-0.5">
              <span className="font-mono text-xs font-bold text-[#111111]">
                {formatCost(ticket.final_cost ?? ticket.estimated_cost)}
              </span>
              <PaymentStatusBadge
                status={ticket.payment_status || (ticket.status === "issued" ? "paid" : "unpaid")}
                onChange={(newStatus) => handleSinglePaymentStatusChange(ticket.id, newStatus)}
                disabled={updatePaymentStatusMutation.isPending}
              />
            </div>
          </RecordCellShell>
        ),
      },
      {
        id: "print",
        header: <Printer className="h-3.5 w-3.5 mx-auto text-[#666666]" />,
        width: 50,
        align: "center",
        render: (ticket) => (
          <RecordCellShell align="center">
            <PrintDropdownMenu
              ticket={ticket}
              onPrintReceipt={onPrintReceipt}
              onPrintWorkOrder={onPrintWorkOrder}
            />
          </RecordCellShell>
        ),
      },
    ],
    [onPrintReceipt, onPrintWorkOrder, handleSinglePaymentStatusChange, updatePaymentStatusMutation.isPending],
  );

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <div className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-2 pl-10 pr-4 text-xs text-[#888888] animate-pulse">
              Загрузка...
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {STATUS_TABS.map((st) => (
              <div key={st.value} className="rounded-[8px] border border-[#e5e5e5] px-2.5 py-1 text-xs text-[#888888] bg-white">
                {st.label}
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-[16px] border border-[#e5e5e5] bg-white p-4">
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-8 w-full bg-[#f5f5f5] rounded animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-[16px] border border-rose-500/30 bg-rose-500/5 p-6 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-rose-500" />
        <div>
          <p className="text-xs font-medium text-rose-600">Не удалось загрузить наряд-заказы</p>
          <p className="text-xs text-[#888888] mt-1">{error?.message ?? "Unknown error"}</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* Top Bar: Search + Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Поиск по наряду, клиенту, бренду..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-9 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
            />
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {STATUS_TABS.map((st) => (
              <button
                key={st.value}
                type="button"
                onClick={() => onFilterStatusChange(st.value)}
                className={cn(
                  "rounded-[8px] border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer",
                  filterStatus === st.value
                    ? "border-[#4a38f5] bg-[#4a38f5]/10 text-[#4a38f5]"
                    : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:text-[#111111]",
                )}
              >
                {st.label}
              </button>
            ))}
          </div>

          {onFilterPaymentStatusChange && (
            <div className="flex items-center gap-1.5 ml-1">
              <span className="text-xs text-[#666666]">Оплата:</span>
              <select
                value={filterPaymentStatus ?? "all"}
                onChange={(e) =>
                  onFilterPaymentStatusChange(e.target.value as RepairPaymentStatus | "all")
                }
                className="h-7 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
              >
                <option value="all">Все</option>
                <option value="unpaid">Не оплачен</option>
                <option value="invoiced">Счет выставлен</option>
                <option value="paid">Оплачен</option>
              </select>
            </div>
          )}

          <span className="ml-auto text-xs text-[#888888]">
            {tickets.length} наряд-заказов
          </span>
        </div>

        {/* RecordTable with Selectable Checkboxes & Floating Bulk Bar */}
        <RecordTable
          rows={tickets}
          columns={columns}
          getRowId={(ticket) => ticket.id}
          tableId="repairs"
          rowHeight={92}
          selectable={true}
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          bulkBar={
            <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 shadow-2xs">
              <span className="text-xs font-medium text-[#111111]">
                Выбрано: <span className="font-mono font-semibold">{selectedIds.size}</span>
              </span>

              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="text-xs text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
              >
                Снять выбор
              </button>

              <div className="h-4 w-px bg-[#e5e5e5]" />

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#666666]">Сменить статус:</span>
                <select
                  value={selectedBulkStatus}
                  onChange={(e) => {
                    const val = e.target.value as RepairStatus;
                    if (val) {
                      setSelectedBulkStatus(val);
                      void handleBulkStatusChange(val);
                    }
                  }}
                  disabled={batchStatusMutation.isPending}
                  className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
                >
                  <option value="">Выберите статус...</option>
                  <option value="intake">Принят</option>
                  <option value="waiting_parts">Заказ запчастей</option>
                  <option value="in_progress">В работе</option>
                  <option value="ready">Готов к выдаче</option>
                  <option value="issued">Выдан</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-[#666666]">Оплата:</span>
                <select
                  value={selectedBulkPaymentStatus}
                  onChange={(e) => {
                    const val = e.target.value as RepairPaymentStatus;
                    if (val) {
                      setSelectedBulkPaymentStatus(val);
                      void handleBulkPaymentStatusChange(val);
                    }
                  }}
                  disabled={batchPaymentStatusMutation.isPending}
                  className="h-7 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
                >
                  <option value="">Сменить оплату...</option>
                  <option value="unpaid">Не оплачен</option>
                  <option value="invoiced">Счет выставлен</option>
                  <option value="paid">Оплачен</option>
                </select>
              </div>

              <div className="ml-auto flex items-center gap-2">
                {selectedIds.size === 1 && onCopyTicket && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = Array.from(selectedIds)[0];
                      const ticket = tickets.find((t) => t.id === id);
                      if (ticket) {
                        onCopyTicket(ticket);
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
                  >
                    <Copy className="h-3.5 w-3.5 text-[#666666]" />
                    Копировать
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setIsDeleteDialogOpen(true)}
                  disabled={batchDeleteMutation.isPending}
                  className="flex items-center gap-1.5 rounded-[6px] bg-rose-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить
                </button>
              </div>
            </div>
          }
          scrollPaddingBottom="pb-4"
          onRowClick={(ticket) => handleRowClick(ticket.id)}
          emptyState={
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <Wrench className="h-8 w-8 text-[#888888]" />
              <p className="text-xs text-[#666666]">Нет наряд-заказов</p>
            </div>
          }
        />

        {/* Модальное окно подтверждения удаления */}
        <ConfirmDialog
          open={isDeleteDialogOpen}
          onClose={() => setIsDeleteDialogOpen(false)}
          onConfirm={handleBulkDeleteConfirm}
          title="Удалить выбранные наряд-заказы?"
          description={`Вы уверены, что хотите удалить ${selectedIds.size} выбранных наряд-заказов? Данные будут перемещены в архив.`}
          confirmLabel="Удалить"
          variant="destructive"
          isPending={batchDeleteMutation.isPending}
        />
      </div>
    </TooltipProvider>
  );
});
