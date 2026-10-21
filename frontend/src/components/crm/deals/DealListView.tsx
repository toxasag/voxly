"use client";

import { useCallback, useMemo, useState } from "react";
import {
  Banknote,
  Bot,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  ChevronDown,
  CircleSlash,
  Clock,
  DollarSign,
  FileText,
  Flag,
  Handshake,
  Plus,
  Search,
  Target,
  Trash2,
  User,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import type { DealDTO, KanbanColumnDTO } from "@/lib/api/use-deals";
import { useDeleteDeal, useMoveDealStage, useUpdateDeal } from "@/lib/api/use-deals";
import { useCompanies } from "@/lib/api/use-companies";
import { contactFullName, useContacts } from "@/lib/api/use-contacts";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { TableEmptyState } from "@/components/crm/shared/CrmTable";
import { type RecordColumn } from "@/components/crm/shared/RecordTable";
import { SyncedRecordTable } from "@/components/crm/shared/SyncedRecordTable";
import { RecordCellShell, RecordCellEditor, RecordCellSelectEditor } from "@/components/crm/shared/RecordCell";
import { TagPill } from "@/components/ui/tag";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { CreatorCell } from "@/components/crm/shared/twenty-table-helpers";
import { cn } from "@/lib/utils";

interface DealListViewProps {
  deals: DealDTO[];
  columns: KanbanColumnDTO[];
  pipelineId: string;
  usersById: Map<string, TenantUserDTO>;
  onOpenDeal?: (id: string) => void;
  bulkEnabled: boolean;
}

/** Какая ячейка какой строки сейчас в режиме правки. */
type EditTarget = { rowId: string; columnId: string } | null;

/** Режимы расчёта агрегатов в подвале таблицы (как в Twenty CRM). */
type CalcMode = "none" | "sum" | "avg" | "min" | "max" | "count";

const CALC_OPTIONS: { id: CalcMode; label: string }[] = [
  { id: "sum", label: "Сумма" },
  { id: "avg", label: "Среднее" },
  { id: "min", label: "Минимум" },
  { id: "max", label: "Максимум" },
  { id: "count", label: "Количество" },
  { id: "none", label: "Не рассчитывать" },
];

// Палитра аватаров сделок: пастельные фоны и контрастный текст (Twenty CRM)
const DEAL_AVATAR_PALETTES = [
  "bg-pink-100 text-pink-700 border border-pink-200/60",
  "bg-amber-100 text-amber-800 border border-amber-200/60",
  "bg-emerald-100 text-emerald-800 border border-emerald-200/60",
  "bg-sky-100 text-sky-800 border border-sky-200/60",
  "bg-lime-100 text-lime-800 border border-lime-200/60",
  "bg-stone-100 text-stone-700 border border-stone-200/60",
  "bg-purple-100 text-purple-800 border border-purple-200/60",
  "bg-indigo-100 text-indigo-800 border border-indigo-200/60",
];

function getDealAvatarColor(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  return DEAL_AVATAR_PALETTES[Math.abs(hash) % DEAL_AVATAR_PALETTES.length];
}

function getSingleInitial(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : "?";
}

// Стилизация плашек компаний под Twenty: узнаваемый акцент бренда или детерминированный цвет
function getCompanyBadgeStyle(name: string): { bg: string; text: string; initial: string } {
  const lower = name.toLowerCase().trim();
  if (lower.includes("stripe")) return { bg: "bg-[#635bff]", text: "text-white", initial: "S" };
  if (lower.includes("anthropic")) return { bg: "bg-[#191919]", text: "text-white", initial: "A" };
  if (lower.includes("notion")) return { bg: "bg-[#000000]", text: "text-white", initial: "N" };
  if (lower.includes("airbnb")) return { bg: "bg-[#ff385c]", text: "text-white", initial: "A" };
  if (lower.includes("figma")) return { bg: "bg-[#1e1e1e]", text: "text-white", initial: "F" };

  const colors = [
    { bg: "bg-blue-600", text: "text-white" },
    { bg: "bg-violet-600", text: "text-white" },
    { bg: "bg-emerald-600", text: "text-white" },
    { bg: "bg-amber-600", text: "text-white" },
    { bg: "bg-rose-600", text: "text-white" },
    { bg: "bg-[#4a38f5]", text: "text-white" },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const picked = colors[Math.abs(hash) % colors.length];
  return {
    bg: picked.bg,
    text: picked.text,
    initial: name.trim().charAt(0).toUpperCase() || "C",
  };
}

// Цвета аватаров контактов (Twenty CRM: круглые цветные аватары в нейтральной пилюле)
const CONTACT_AVATAR_COLORS = [
  "bg-emerald-100 text-emerald-800",
  "bg-sky-100 text-sky-800",
  "bg-lime-100 text-lime-800",
  "bg-purple-100 text-purple-800",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-800",
  "bg-indigo-100 text-indigo-800",
];

function getContactAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return CONTACT_AVATAR_COLORS[Math.abs(hash) % CONTACT_AVATAR_COLORS.length];
}

// Форматирование сумм под Twenty: $ 60k, ₽ 100k, $ 45k
function formatBudgetTwenty(budget: number, currency: string = "RUB"): string {
  const symbol = currency === "USD" ? "$" : currency === "EUR" ? "€" : "₽";
  if (budget >= 1000 && budget % 1000 === 0) {
    return `${symbol} ${Math.round(budget / 1000)}k`;
  }
  return `${symbol} ${budget.toLocaleString("ru-RU")}`;
}

// Форматирование даты под Twenty: "31 янв., 2026 19:25"
function formatDateTwenty(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  const formatted = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
  return formatted.replace(" г.", "");
}

/**
 * Таблица сделок по образцу Opportunities в Twenty CRM.
 */
export function DealListView({ deals, columns, pipelineId, usersById, onOpenDeal, bulkEnabled }: DealListViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editing, setEditing] = useState<EditTarget>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [calcMode, setCalcMode] = useState<CalcMode>("none");
  const [calcMenuOpen, setCalcMenuOpen] = useState(false);

  const move = useMoveDealStage();
  const remove = useDeleteDeal();
  const update = useUpdateDeal();

  const companiesQuery = useCompanies({ limit: 100 });
  const contactsQuery = useContacts({ limit: 100 });

  const filteredCompanies = useMemo(() => {
    const items = companiesQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => c.name.toLowerCase().includes(q));
  }, [companiesQuery.data?.items, pickerSearch]);

  const filteredContacts = useMemo(() => {
    const items = contactsQuery.data?.items ?? [];
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((c) => contactFullName(c).toLowerCase().includes(q));
  }, [contactsQuery.data?.items, pickerSearch]);

  const filteredUsers = useMemo(() => {
    const items = Array.from(usersById.values());
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return items;
    return items.filter((u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
  }, [usersById, pickerSearch]);

  const orderedColumns = useMemo(() => [...columns].sort((a, b) => a.sortOrder - b.sortOrder), [columns]);
  const stageById = useMemo(() => new Map(orderedColumns.map((column) => [column.stageId, column])), [orderedColumns]);

  const stageOptions = useMemo(
    () => orderedColumns.map((column) => ({ value: column.stageId, label: column.stageName })),
    [orderedColumns],
  );

  const isEditing = useCallback(
    (rowId: string, columnId: string): boolean => editing?.rowId === rowId && editing.columnId === columnId,
    [editing],
  );

  const commit = useCallback(
    (deal: DealDTO, payload: Parameters<typeof update.mutate>[0]["payload"]) => {
      setEditing(null);
      update.mutate(
        { id: deal.id, pipelineId, payload },
        { onError: (error) => toast.error(error.message) },
      );
    },
    [update, pipelineId],
  );

  const tableColumns = useMemo<RecordColumn<DealDTO>[]>(() => [
    {
      id: "title",
      header: "Имя",
      icon: Target,
      width: 260,
      sortValue: (deal) => deal.title,
      render: (deal) =>
        isEditing(deal.id, "title") ? (
          <RecordCellEditor
            value={deal.title}
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              const trimmed = value.trim();
              if (trimmed.length === 0) {
                toast.error("Название не может быть пустым");
                setEditing(null);
                return;
              }
              commit(deal, { title: trimmed });
            }}
          />
        ) : (
          <RecordCellShell
            editable
            isLabelIdentifier
            onStartEdit={() => setEditing({ rowId: deal.id, columnId: "title" })}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[11px] font-bold shadow-2xs",
                getDealAvatarColor(deal.title),
              )}
            >
              {getSingleInitial(deal.title)}
            </span>
            <span title={`Сделка: ${deal.title}`} className="truncate font-medium text-[13px] text-[#111111]">{deal.title}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "budget",
      header: "Сумма",
      icon: DollarSign,
      width: 130,
      align: "left",
      sortValue: (deal) => deal.budget,
      render: (deal) =>
        isEditing(deal.id, "budget") ? (
          <RecordCellEditor
            value={String(deal.budget)}
            type="number"
            align="left"
            onCancel={() => setEditing(null)}
            onCommit={(value) => {
              const parsed = Number(value);
              if (!Number.isFinite(parsed) || parsed < 0) {
                toast.error("Сумма должна быть неотрицательным числом");
                setEditing(null);
                return;
              }
              commit(deal, { budget: parsed });
            }}
          />
        ) : (
          <RecordCellShell align="left" editable onStartEdit={() => setEditing({ rowId: deal.id, columnId: "budget" })}>
            <span title={`Сумма: ${formatBudgetTwenty(deal.budget, deal.currency)}`} className="font-normal tabular-nums text-[13px] text-[#111111]">
              {formatBudgetTwenty(deal.budget, deal.currency)}
            </span>
          </RecordCellShell>
        ),
    },
    {
      id: "created",
      header: "Создано",
      icon: Clock,
      width: 140,
      align: "left",
      sortValue: (deal) => deal.createdAt,
      render: (deal) => (
        <RecordCellShell align="left">
          <CreatorCell
            createdBy={deal.createdBy}
            createdByName={
              deal.createdBy === "system" || !deal.createdBy
                ? "System"
                : (usersById.get(deal.createdBy)?.fullName ?? deal.createdBy)
            }
          />
        </RecordCellShell>
      ),
    },
    {
      id: "closeDate",
      header: "Дата Закрытия",
      icon: Calendar,
      width: 170,
      sortValue: (deal) => deal.closeDate ?? "",
      render: (deal) =>
        isEditing(deal.id, "closeDate") ? (
          <RecordCellEditor
            value={deal.closeDate ?? ""}
            type="date"
            onCancel={() => setEditing(null)}
            onCommit={(value) => commit(deal, { close_date: value })}
          />
        ) : (
          <RecordCellShell
            editable
            isEmpty={deal.closeDate === null}
            emptyLabel="дату"
            onStartEdit={() => setEditing({ rowId: deal.id, columnId: "closeDate" })}
          >
            {deal.closeDate !== null ? (
              <span
                title={new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(deal.closeDate))}
                className="text-[13px] text-[#111111]"
              >
                {formatDateTwenty(deal.closeDate)}
              </span>
            ) : (
              <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#888888]">
                -
              </span>
            )}
          </RecordCellShell>
        ),
    },
    {
      id: "company",
      header: "Компания",
      icon: Building2,
      width: 190,
      sortValue: (deal) => deal.companyName ?? "",
      render: (deal) => {
        const isCurrentEditing = isEditing(deal.id, "company");
        const badge = deal.companyName ? getCompanyBadgeStyle(deal.companyName) : null;

        return (
          <div className="relative flex h-full w-full items-center">
            <RecordCellShell
              editable
              isEmpty={deal.companyName === null}
              emptyLabel="компанию"
              onStartEdit={() => {
                setEditing({ rowId: deal.id, columnId: "company" });
                setPickerSearch("");
              }}
            >
              {badge !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-[5px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-xs text-[#111111] shadow-2xs">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold",
                      badge.bg,
                      badge.text,
                    )}
                  >
                    {badge.initial}
                  </span>
                  <span className="max-w-[140px] truncate font-medium">{deal.companyName}</span>
                </span>
              ) : (
                <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#888888]">
                  -
                </span>
              )}
            </RecordCellShell>

            {isCurrentEditing && (
              <>
                <div
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setEditing(null)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                  <div className="border-b border-[#f0f0f0] p-1 mb-1">
                    <div className="relative flex items-center">
                      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[#888888]" />
                      <input
                        type="text"
                        placeholder="Поиск компании"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-full rounded-[4px] bg-[#fafafa] py-1 pl-7 pr-2 text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        commit(deal, { company_id: "" });
                        toast.success("Компания очищена");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                        deal.companyId === null && "bg-[#f5f5f5] font-medium",
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
                        <span>Без компании</span>
                      </div>
                      {deal.companyId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                    </button>
                    {filteredCompanies.map((comp) => {
                      const isSelected = comp.id === deal.companyId;
                      const b = getCompanyBadgeStyle(comp.name);
                      return (
                        <button
                          key={comp.id}
                          type="button"
                          onClick={() => {
                            if (comp.id !== deal.companyId) {
                              commit(deal, { company_id: comp.id });
                              toast.success(`Компания «${comp.name}» привязана`);
                            } else {
                              setEditing(null);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                            isSelected && "bg-[#f5f5f5] font-medium",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[10px] font-bold",
                                b.bg,
                                b.text,
                              )}
                            >
                              {b.initial}
                            </span>
                            <span className="truncate">{comp.name}</span>
                          </div>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      },
    },
    {
      id: "contact",
      header: "Контактное лицо",
      icon: User,
      width: 190,
      sortValue: (deal) => deal.contactName ?? "",
      render: (deal) => {
        const isCurrentEditing = isEditing(deal.id, "contact");

        return (
          <div className="relative flex h-full w-full items-center">
            <RecordCellShell
              editable
              isEmpty={deal.contactName === null}
              emptyLabel="контакт"
              onStartEdit={() => {
                setEditing({ rowId: deal.id, columnId: "contact" });
                setPickerSearch("");
              }}
            >
              {deal.contactName !== null ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs text-[#111111]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                      getContactAvatarColor(deal.contactName),
                    )}
                  >
                    {getSingleInitial(deal.contactName)}
                  </span>
                  <span className="max-w-[140px] truncate font-medium">{deal.contactName}</span>
                </span>
              ) : (
                <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#888888]">
                  -
                </span>
              )}
            </RecordCellShell>

            {isCurrentEditing && (
              <>
                <div
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setEditing(null)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                  <div className="border-b border-[#f0f0f0] p-1 mb-1">
                    <div className="relative flex items-center">
                      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[#888888]" />
                      <input
                        type="text"
                        placeholder="Поиск контакта"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-full rounded-[4px] bg-[#fafafa] py-1 pl-7 pr-2 text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        commit(deal, { contact_id: "" });
                        toast.success("Контакт очищен");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                        deal.contactId === null && "bg-[#f5f5f5] font-medium",
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
                        <span>Без контакта</span>
                      </div>
                      {deal.contactId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                    </button>
                    {filteredContacts.map((contact) => {
                      const isSelected = contact.id === deal.contactId;
                      const name = contactFullName(contact);
                      return (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => {
                            if (contact.id !== deal.contactId) {
                              commit(deal, { contact_id: contact.id });
                              toast.success(`Контакт «${name}» привязан`);
                            } else {
                              setEditing(null);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                            isSelected && "bg-[#f5f5f5] font-medium",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                                getContactAvatarColor(name),
                              )}
                            >
                              {getSingleInitial(name)}
                            </span>
                            <span className="truncate">{name}</span>
                          </div>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      },
    },
    {
      id: "stage",
      header: "Этап",
      icon: Flag,
      width: 170,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => stageById.get(deal.stageId)?.sortOrder ?? 999,
      render: (deal) => {
        const isCurrentEditing = isEditing(deal.id, "stage");
        const stage = stageById.get(deal.stageId);

        return (
          <div className="relative flex h-full w-full items-center">
            <RecordCellShell editable onStartEdit={() => setEditing({ rowId: deal.id, columnId: "stage" })}>
              <TagPill color={stage?.isWon ? "emerald" : stage?.isLost ? "rose" : stageTagColor(stage?.stageColor)}>
                {stage?.stageName ?? "—"}
              </TagPill>
            </RecordCellShell>

            {isCurrentEditing && (
              <>
                <div
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setEditing(null)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    {orderedColumns.map((col) => {
                      const isSelected = col.stageId === deal.stageId;
                      return (
                        <button
                          key={col.stageId}
                          type="button"
                          onClick={() => {
                            setEditing(null);
                            if (col.stageId !== deal.stageId) {
                              move.mutate(
                                { id: deal.id, stageId: col.stageId, pipelineId },
                                { onError: (error) => toast.error(error.message) },
                              );
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                            isSelected && "bg-[#f5f5f5] font-medium",
                          )}
                        >
                          <TagPill color={col.isWon ? "emerald" : col.isLost ? "rose" : stageTagColor(col.stageColor)}>
                            {col.stageName}
                          </TagPill>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      },
    },
    {
      id: "owner",
      header: "Ответственный",
      icon: UserCheck,
      width: 180,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => deal.ownerName ?? "",
      render: (deal) => {
        const isCurrentEditing = isEditing(deal.id, "owner");
        const owner = deal.ownerId !== null ? usersById.get(deal.ownerId) : undefined;
        const label = owner?.fullName ?? deal.ownerName;

        return (
          <div className="relative flex h-full w-full items-center">
            <RecordCellShell
              editable
              isEmpty={label === null || label === undefined}
              emptyLabel="ответственного"
              onStartEdit={() => {
                setEditing({ rowId: deal.id, columnId: "owner" });
                setPickerSearch("");
              }}
            >
              {label !== null && label !== undefined ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs text-[#111111]">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                      getContactAvatarColor(label),
                    )}
                  >
                    {getSingleInitial(label)}
                  </span>
                  <span className="max-w-[130px] truncate font-medium">{label}</span>
                </span>
              ) : (
                <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#888888]">
                  -
                </span>
              )}
            </RecordCellShell>

            {isCurrentEditing && (
              <>
                <div
                  className="fixed inset-0 z-40 cursor-default"
                  onClick={() => setEditing(null)}
                />
                <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                  <div className="border-b border-[#f0f0f0] p-1 mb-1">
                    <div className="relative flex items-center">
                      <Search className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-[#888888]" />
                      <input
                        type="text"
                        placeholder="Поиск сотрудника"
                        value={pickerSearch}
                        onChange={(e) => setPickerSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setEditing(null);
                        }}
                        className="w-full rounded-[4px] bg-[#fafafa] py-1 pl-7 pr-2 text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="max-h-52 overflow-y-auto space-y-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        commit(deal, { owner_id: "" });
                        toast.success("Ответственный очищен");
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                        deal.ownerId === null && "bg-[#f5f5f5] font-medium",
                      )}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <CircleSlash className="h-3.5 w-3.5 text-[#888888] shrink-0" />
                        <span>Без ответственного</span>
                      </div>
                      {deal.ownerId === null && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                    </button>
                    {filteredUsers.map((user) => {
                      const isSelected = user.id === deal.ownerId;
                      return (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            if (user.id !== deal.ownerId) {
                              commit(deal, { owner_id: user.id });
                              toast.success(`Ответственный «${user.fullName}» назначен`);
                            } else {
                              setEditing(null);
                            }
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-[5px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer",
                            isSelected && "bg-[#f5f5f5] font-medium",
                          )}
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span
                              className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                                getContactAvatarColor(user.fullName),
                              )}
                            >
                              {getSingleInitial(user.fullName)}
                            </span>
                            <span className="truncate">{user.fullName}</span>
                          </div>
                          {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      },
    },
    {
      id: "updatedAt",
      header: "Последнее обновление",
      icon: CalendarClock,
      width: 170,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => deal.updatedAt,
      render: (deal) => (
        <RecordCellShell>
          <span className="text-[13px] text-[#111111]">
            {formatDateTwenty(deal.updatedAt)}
          </span>
        </RecordCellShell>
      ),
    },
    {
      id: "closedAt",
      header: "Удалено в",
      icon: Calendar,
      width: 170,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => deal.closedAt ?? "",
      render: (deal) => (
        <RecordCellShell isEmpty={deal.closedAt === null} emptyLabel="дату">
          {deal.closedAt !== null ? (
            <span className="text-[13px] text-[#111111]">
              {formatDateTwenty(deal.closedAt)}
            </span>
          ) : (
            <span className="inline-flex h-4 w-5 items-center justify-center rounded-full bg-[#f4f4f5] text-xs font-medium text-[#888888]">
              -
            </span>
          )}
        </RecordCellShell>
      ),
    },
    {
      id: "createdBy",
      header: "Кем обновлено",
      icon: User,
      width: 170,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => usersById.get(deal.createdBy)?.fullName ?? deal.createdBy,
      render: (deal) => {
        const user = usersById.get(deal.createdBy);
        const name = user?.fullName ?? (deal.createdBy === "system" || !deal.createdBy ? "System" : deal.createdBy);
        return (
          <RecordCellShell>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-xs text-[#111111]">
              <span
                aria-hidden="true"
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold",
                  getContactAvatarColor(name),
                )}
              >
                {getSingleInitial(name)}
              </span>
              <span className="max-w-[130px] truncate font-medium">{name}</span>
            </span>
          </RecordCellShell>
        );
      },
    },
    {
      id: "description",
      header: "Описание",
      icon: FileText,
      width: 200,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => deal.description,
      render: (deal) =>
        isEditing(deal.id, "description") ? (
          <RecordCellEditor
            value={deal.description}
            onCancel={() => setEditing(null)}
            onCommit={(val) => commit(deal, { description: val })}
          />
        ) : (
          <RecordCellShell
            editable
            isEmpty={!deal.description}
            emptyLabel="описание"
            onStartEdit={() => setEditing({ rowId: deal.id, columnId: "description" })}
          >
            <span className="truncate text-[13px] text-[#111111]">{deal.description || "—"}</span>
          </RecordCellShell>
        ),
    },
    {
      id: "currency",
      header: "Валюта",
      icon: DollarSign,
      width: 110,
      hideable: true,
      defaultHidden: true,
      sortValue: (deal) => deal.currency,
      render: (deal) => (
        <RecordCellShell>
          <span className="text-[13px] font-medium uppercase text-[#111111]">
            {deal.currency || "RUB"}
          </span>
        </RecordCellShell>
      ),
    },
  ], [isEditing, commit, stageById, stageOptions, move, pipelineId, usersById]);

  const bulkMoveTo = useCallback(async (stageId: string) => {
    for (const id of selected) {
      try {
        await move.mutateAsync({ id, stageId, pipelineId });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось переместить сделку");
        break;
      }
    }
    setSelected(new Set());
  }, [selected, move, pipelineId]);

  const bulkDelete = useCallback(async () => {
    setDeleteConfirmOpen(false);
    for (const id of selected) {
      try {
        await remove.mutateAsync(id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Не удалось удалить сделку");
        break;
      }
    }
    setSelected(new Set());
  }, [selected, remove]);

  const calcResult = useMemo(() => {
    if (deals.length === 0 || calcMode === "none") return undefined;
    const budgets = deals.map((d) => d.budget);
    const sum = budgets.reduce((acc, val) => acc + val, 0);

    let budgetStr = "";
    let titleStr = `${deals.length} записей`;

    switch (calcMode) {
      case "sum":
        budgetStr = formatBudgetTwenty(sum);
        break;
      case "avg":
        titleStr = "Среднее";
        budgetStr = formatBudgetTwenty(Math.round(sum / deals.length));
        break;
      case "min":
        titleStr = "Минимум";
        budgetStr = formatBudgetTwenty(Math.min(...budgets));
        break;
      case "max":
        titleStr = "Максимум";
        budgetStr = formatBudgetTwenty(Math.max(...budgets));
        break;
      case "count":
        titleStr = "Количество";
        budgetStr = `${deals.length}`;
        break;
      default:
        break;
    }

    return {
      title: titleStr,
      budget: <span className="font-semibold text-[#111111] tabular-nums">{budgetStr}</span>,
    };
  }, [deals, calcMode]);

  const calcButtonLabel =
    calcMode === "none" ? "Рассчитать" : CALC_OPTIONS.find((o) => o.id === calcMode)?.label ?? "Рассчитать";

  return (
    <>
      <SyncedRecordTable
        rows={deals}
        columns={tableColumns}
        getRowId={(deal) => deal.id}
        onRowClick={onOpenDeal === undefined || editing !== null ? undefined : (deal) => onOpenDeal(deal.id)}
        tableId="deals"
        onCellEdit={(deal, columnId) => setEditing({ rowId: deal.id, columnId })}
        selectable={true}
        selectedIds={selected}
        onSelectionChange={setSelected}
        footerCells={calcResult}
        emptyState={<TableEmptyState icon={Handshake} title="Сделок нет" description="Под текущий фильтр не попала ни одна сделка" />}
        bulkBar={
          <div className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-2.5 shadow-2xs">
            <span className="text-xs font-medium text-[#111111]">Выбрано: {selected.size}</span>
            <select
              defaultValue=""
              disabled={move.isPending || remove.isPending}
              onChange={(event) => { if (event.target.value !== "") void bulkMoveTo(event.target.value); event.target.value = ""; }}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            >
              <option value="" disabled>Переместить в этап…</option>
              {orderedColumns.map((column) => (
                <option key={column.stageId} value={column.stageId}>{column.stageName}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={move.isPending || remove.isPending}
              className="flex items-center gap-1.5 rounded-[8px] bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />Удалить
            </button>
          </div>
        }
      />

      {/* Нижняя панель действий таблицы по образцу Twenty CRM */}
      <div className="flex flex-col gap-0.5 pt-1">
        {/* Кнопка быстрого добавления новой сделки */}
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new CustomEvent("open-create-deal"));
          }}
          className="inline-flex w-fit items-center gap-1.5 rounded-[5px] px-2 py-1 text-xs font-normal text-[#666666] transition-colors hover:bg-[#f4f4f5] hover:text-[#111111]"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Добавить новый</span>
        </button>

        {/* Выпадающее меню расчёта агрегатов под колонками */}
        <div className="relative inline-block w-fit">
          <button
            type="button"
            onClick={() => setCalcMenuOpen((prev) => !prev)}
            className="inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-xs font-normal text-[#666666] transition-colors hover:bg-[#f4f4f5] hover:text-[#111111]"
          >
            <span>{calcButtonLabel}</span>
            <ChevronDown className="h-3 w-3 text-[#888888]" />
          </button>

          {calcMenuOpen && (
            <>
              <button
                type="button"
                aria-label="Закрыть меню расчёта"
                onClick={() => setCalcMenuOpen(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div className="absolute left-0 top-full z-40 mt-1 min-w-[150px] overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white py-1 shadow-lg">
                {CALC_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setCalcMode(opt.id);
                      setCalcMenuOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center px-3 py-1.5 text-left text-xs transition-colors hover:bg-[#f5f5f5]",
                      calcMode === opt.id ? "font-semibold text-[#111111]" : "text-[#555555]",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={bulkDelete}
        title={`Удалить сделки: ${selected.size}?`}
        description="Сделки будут скрыты из воронки (мягкое удаление). Действие необратимо через интерфейс."
        confirmLabel="Удалить"
        variant="destructive"
        isPending={remove.isPending}
      />
    </>
  );
}
