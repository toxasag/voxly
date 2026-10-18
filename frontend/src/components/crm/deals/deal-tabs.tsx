"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  AlertCircle,
  Banknote,
  Bot,
  Building2,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronUp,
  DollarSign,
  Handshake,
  ListChecks,
  Loader2,
  MessageCircle,
  Paperclip,
  Pencil,
  Search,
  Send,
  User,
  UserCircle2,
  X,
} from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { useDealTimeline, useKanban, useMoveDealStage, useSendDealMessage, useUpdateDeal } from "@/lib/api/use-deals";
import { useTasks } from "@/lib/api/use-tasks";
import { useCompanies } from "@/lib/api/use-companies";
import { contactFullName, useContacts } from "@/lib/api/use-contacts";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { RecordNotesTab } from "@/components/crm/shared/RecordNotesTab";
import type { DealMessageDTO, DealDTO, PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Содержимое карточки сделки: вкладки «Главная», «Чат», «Задачи», «Файлы».
//
// Вынесено из `DealDrawer.tsx`, чтобы у сделки был один экран деталей, а не два.
// Раньше их было два, и второй был слабее: `DealDrawer` давал пять вкладок и
// inline-правку, а `/crm/deals/[id]` — три жёсткие колонки, из которых две
// заполнены заглушками («Эндпоинты связей … реализуются отдельными
// вертикальными срезами»), без задач, заметок и правки, и с сырыми `stageId` /
// `pipelineId` в деталях. Чат был реализован дважды (`ChatTab` здесь и
// `CenterPanel` на странице), и любая правка переписки делалась в двух местах —
// статус доставки сообщения пришлось добавлять дважды буквально.
//
// Удалить страницу было нельзя: на неё ведут уведомления
// (`NotificationDropdown`) и запасная ветка карточки канбана (`DealCard`), и
// ссылки стали бы битыми. Поэтому она осталась точкой входа по ссылке, но
// рендерит это же содержимое.
//
// Границы: здесь только вкладки. Оболочка (панель справа или полный экран) —
// дело вызывающего, потому что она и различает два способа открытия.
// ---------------------------------------------------------------------------

/** Имя и цвет этапа: сделка знает `stageId`, а показать нужно название. */
export interface DealStageInfo {
  name: string;
  colorKey?: string;
  isWon: boolean;
  isLost: boolean;
}

/** Контекст, который приходит со страницы: справочники грузит она, не вкладка. */
export interface DealTabsContext {
  usersById: Map<string, TenantUserDTO>;
  pipelines?: PipelineDTO[];
  stagesById?: Map<string, DealStageInfo>;
}

/**
 * Строка поля карточки записи.
 *
 * Геометрия как у Twenty (`RecordInlineCellContainer`): колонка лейбла 90px,
 * значение слева сразу за ней. Прежний вариант прижимал значение к правому краю
 * — при разной длине значений колонка визуально ломалась, и связанные поля
 * (компания, контакт, владелец) не читались как список.
 */
function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
      <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#111111]">{children}</span>
    </div>
  );
}

function MessageBubble({ message }: { message: DealMessageDTO }) {
  const system = message.source === "system";
  const outbound = message.direction === "outbound";
  const failed = message.deliveryStatus === "failed";
  const pending = message.deliveryStatus === "pending";

  return (
    <div className={cn("flex gap-3", outbound && !system && "flex-row-reverse", system && "justify-center")}>
      <div className={cn("max-w-[75%]", system && "max-w-full")}>
        {!system && (
          <div className={cn("mb-1 flex gap-2", outbound && "justify-end")}>
            <span className="text-xs text-slate-300">{message.senderName}</span>
            <span className={cn(
              "rounded px-1.5 py-0.5 text-xs",
              message.source === "manager" && "text-amber-400 bg-amber-500/10",
              message.source === "client" && "text-sky-400 bg-sky-500/10",
              message.source === "human" && "text-sky-400 bg-sky-500/10",
              message.source === "ai" && "text-violet-400 bg-violet-500/10",
              message.source === "ai_bot" && "text-violet-400 bg-violet-500/10",
              message.source === "system" && "text-slate-400 bg-slate-800",
            )}>
              {message.source}
            </span>
          </div>
        )}
        <div className={cn(
          "rounded-xl px-3.5 py-2.5 text-sm",
          system ? "text-center text-slate-500 italic" :
          // Неотправленное сообщение обязано отличаться от отправленного:
          // иначе менеджер ждёт ответа на то, что до клиента не дошло.
          failed ? "border border-rose-500/30 bg-rose-500/5 text-slate-200" :
          outbound ? "border border-amber-500/20 bg-amber-500/10 text-slate-200" :
          "bg-slate-800 text-slate-200"
        )}>
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
          <p className={cn("mt-1 flex items-center gap-1.5 text-xs", failed ? "text-rose-400" : outbound ? "text-amber-400/70" : "text-slate-500")}>
            {new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}
            {pending && <Loader2 className="h-3 w-3 animate-spin" aria-label="Отправляется" />}
            {failed && <AlertCircle className="h-3 w-3 shrink-0" aria-hidden="true" />}
            {failed && <span>Не доставлено</span>}
          </p>
          {/* Причина у самой строки, а не тостом: тост исчезнет, а сообщение останется. */}
          {failed && message.deliveryError !== null && (
            <p className="mt-1 text-xs text-rose-400/80">{message.deliveryError}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ChatTab({ dealId }: { dealId: string }) {
  // `live`: опрос идёт, пока открыта именно эта вкладка. `TabsContent` не
  // рендерит неактивные вкладки, поэтому компонент размонтируется при уходе с
  // чата и опрос прекращается сам — отдельного флага «вкладка активна» не нужно.
  const timeline = useDealTimeline(dealId, true);
  const send = useSendDealMessage();
  const [input, setInput] = useState("");
  const [channel, setChannel] = useState("telegram");
  const [error, setError] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState(true);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [timeline.data]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || send.isPending) return;
    try {
      setError(null);
      await send.mutateAsync({
        dealId,
        payload: { content: text, channel, source: "manager", direction: "outbound" },
      });
      setInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message");
    }
  }, [input, channel, send, dealId]);

  const handleKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }, [handleSend]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-[#888888]" />
          <span className="text-sm font-semibold text-[#000000]">Хронология и чат</span>
        </div>
        <div className="flex items-center gap-2">
          <Bot className={cn("h-4 w-4", autopilot ? "text-emerald-500" : "text-[#888888]")} />
          <button
            type="button"
            onClick={() => setAutopilot((v) => !v)}
            className={cn(
              "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[#4a38f5] focus:ring-offset-2",
              autopilot ? "bg-emerald-500" : "bg-slate-300"
            )}
            role="switch"
            aria-checked={autopilot}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                autopilot ? "translate-x-4" : "translate-x-0"
              )}
            />
          </button>
          <span className="text-xs text-[#666666]">{autopilot ? "Автопилот включён" : "Автопилот выключен"}</span>
        </div>
      </div>

      <div ref={ref} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {timeline.isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : timeline.isError ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
            <p className="text-sm text-slate-200">Не удалось загрузить хронологию</p>
            <button type="button" onClick={() => void timeline.refetch()} className="mt-2 text-xs text-slate-300">Повторить</button>
          </div>
        ) : timeline.data && timeline.data.length === 0 ? (
          <EmptyState icon={MessageCircle} title="Сообщений пока нет" description="Начните переписку с клиентом" />
        ) : (
          timeline.data?.map((m) => <MessageBubble key={m.id} message={m} />)
        )}
      </div>

      {error && <div className="mx-4 mb-2 rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2 text-xs text-rose-400">{error}</div>}

      <div className="border-t border-[#e5e5e5] p-4">
        <div className="flex gap-2">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#000000]">
            <option value="telegram">Telegram</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
          <div className="relative flex-1">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Написать сообщение..."
              rows={1}
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#000000] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
          <button type="button" onClick={handleSend} disabled={send.isPending || !input.trim()} className="rounded-[8px] bg-[#4a38f5] px-4 py-2 text-sm font-medium text-white hover:bg-[#3b2be0] disabled:opacity-50">
            {send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />}
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Вкладка «Главная» карточки сделки.
 *
 * Группы и порядок полей — из метаданных Twenty
 * (`compute-standard-opportunity-view-fields.util.ts`, представление
 * `opportunityRecordPageFields`):
 *
 *   deal:      amount (0), stage (1), closeDate (2)
 *   relations: company (0), pointOfContact (1), owner (2)
 *   system:    createdAt (0), createdBy (1), updatedAt (2, скрыт)
 *
 * Названия групп — их `getStandardViewFieldGroupNames` (Deal, Relations,
 * System). Воронка — наше поле (у Twenty один пайплайн на объект), отнесено к
 * Deal рядом с этапом: этап без воронки не читается.
 */
function HomeTab({
  deal,
  usersById,
  pipelines,
  stagesById,
}: {
  deal: DealDTO;
  usersById: Map<string, TenantUserDTO>;
  pipelines?: PipelineDTO[];
  stagesById?: Map<string, DealStageInfo>;
}) {
  const [dealOpen, setDealOpen] = useState(true);
  const [relationsOpen, setRelationsOpen] = useState(true);
  const [systemOpen, setSystemOpen] = useState(true);

  // Редактирование суммы
  const [isEditingBudget, setIsEditingBudget] = useState(false);
  const [budgetVal, setBudgetVal] = useState(String(deal.budget));

  // Редактирование даты закрытия
  const [isEditingCloseDate, setIsEditingCloseDate] = useState(false);

  // Поповеры выбора: "stage" | "company" | "contact" | "owner"
  const [activePicker, setActivePicker] = useState<"stage" | "company" | "contact" | "owner" | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<"row" | "card">("row");
  const [pickerSearch, setPickerSearch] = useState("");

  const updateDeal = useUpdateDeal();
  const moveStage = useMoveDealStage();

  const kanban = useKanban(deal.pipelineId);
  const companiesQuery = useCompanies({ limit: 100 });
  const contactsQuery = useContacts({ limit: 100 });

  const owner = deal.ownerId !== null ? usersById.get(deal.ownerId) : undefined;
  const creator = usersById.get(deal.createdBy);
  const pipelineName = pipelines?.find((pipeline) => pipeline.id === deal.pipelineId)?.name;
  const stage = stagesById?.get(deal.stageId);

  const fullDate = (iso: string): string =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const dateOnly = (iso: string): string =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));

  const stagesList = useMemo(() => {
    if (kanban.data && kanban.data.length > 0) {
      return kanban.data.map((c) => ({
        stageId: c.stageId,
        stageName: c.stageName,
        stageColor: c.stageColor,
        isWon: c.isWon,
        isLost: c.isLost,
      }));
    }
    if (stagesById) {
      return Array.from(stagesById.entries()).map(([id, info]) => ({
        stageId: id,
        stageName: info.name,
        stageColor: info.colorKey,
        isWon: info.isWon,
        isLost: info.isLost,
      }));
    }
    return [];
  }, [kanban.data, stagesById]);

  const filteredStages = useMemo(() => {
    const q = pickerSearch.trim().toLowerCase();
    if (!q) return stagesList;
    return stagesList.filter((s) => s.stageName.toLowerCase().includes(q));
  }, [stagesList, pickerSearch]);

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

  const commitBudget = () => {
    const num = Number(budgetVal);
    if (!isNaN(num) && num >= 0 && num !== deal.budget) {
      updateDeal.mutate(
        { id: deal.id, pipelineId: deal.pipelineId, payload: { budget: num } },
        {
          onSuccess: () => toast.success("Сумма обновлена"),
          onError: (err) => toast.error(err.message || "Ошибка обновления суммы"),
        },
      );
    }
    setIsEditingBudget(false);
  };

  const openPicker = (type: "stage" | "company" | "contact" | "owner", anchor: "row" | "card") => {
    setActivePicker(type);
    setPickerAnchor(anchor);
    setPickerSearch("");
  };

  const renderCompanyPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-[#f0f0f0] px-2 py-1.5 mb-1">
          <Search className="h-3.5 w-3.5 text-[#888888] shrink-0" />
          <input
            type="text"
            placeholder="Поиск компании..."
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { company_id: "" } },
                {
                  onSuccess: () => toast.success("Компания очищена"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#888888] hover:bg-[#f5f5f5] transition-colors",
              deal.companyId === null && "bg-[#f5f5f5] text-[#111111] font-medium",
            )}
          >
            <span>— Без компании</span>
            {deal.companyId === null && <Check className="h-3.5 w-3.5 text-[#111111]" />}
          </button>
          {filteredCompanies.map((comp) => {
            const isSelected = comp.id === deal.companyId;
            return (
              <button
                key={comp.id}
                type="button"
                onClick={() => {
                  if (comp.id !== deal.companyId) {
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { company_id: comp.id } },
                      {
                        onSuccess: () => toast.success("Компания обновлена"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <EntityChip name={comp.name} label={comp.name} icon={Building2} size="sm" />
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const renderContactPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-[#f0f0f0] px-2 py-1.5 mb-1">
          <Search className="h-3.5 w-3.5 text-[#888888] shrink-0" />
          <input
            type="text"
            placeholder="Поиск контакта..."
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { contact_id: "" } },
                {
                  onSuccess: () => toast.success("Контакт очищен"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#888888] hover:bg-[#f5f5f5] transition-colors",
              deal.contactId === null && "bg-[#f5f5f5] text-[#111111] font-medium",
            )}
          >
            <span>— Без контакта</span>
            {deal.contactId === null && <Check className="h-3.5 w-3.5 text-[#111111]" />}
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
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { contact_id: contact.id } },
                      {
                        onSuccess: () => toast.success("Контакт обновлён"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <EntityChip name={name} label={name} size="sm" />
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  const renderOwnerPicker = () => (
    <>
      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
      <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
        <div className="flex items-center gap-1.5 border-b border-[#f0f0f0] px-2 py-1.5 mb-1">
          <Search className="h-3.5 w-3.5 text-[#888888] shrink-0" />
          <input
            type="text"
            placeholder="Поиск сотрудника..."
            value={pickerSearch}
            onChange={(e) => setPickerSearch(e.target.value)}
            className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none"
            autoFocus
          />
        </div>
        <div className="max-h-56 overflow-y-auto space-y-0.5">
          <button
            type="button"
            onClick={() => {
              updateDeal.mutate(
                { id: deal.id, pipelineId: deal.pipelineId, payload: { owner_id: "" } },
                {
                  onSuccess: () => toast.success("Ответственный очищен"),
                  onError: (err) => toast.error(err.message || "Ошибка"),
                },
              );
              setActivePicker(null);
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#888888] hover:bg-[#f5f5f5] transition-colors",
              deal.ownerId === null && "bg-[#f5f5f5] text-[#111111] font-medium",
            )}
          >
            <span>— Без владельца</span>
            {deal.ownerId === null && <Check className="h-3.5 w-3.5 text-[#111111]" />}
          </button>
          {filteredUsers.map((user) => {
            const isSelected = user.id === deal.ownerId;
            return (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  if (user.id !== deal.ownerId) {
                    updateDeal.mutate(
                      { id: deal.id, pipelineId: deal.pipelineId, payload: { owner_id: user.id } },
                      {
                        onSuccess: () => toast.success("Ответственный обновлён"),
                        onError: (err) => toast.error(err.message || "Ошибка"),
                      },
                    );
                  }
                  setActivePicker(null);
                }}
                className={cn(
                  "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors",
                  isSelected && "bg-[#f5f5f5] font-medium",
                )}
              >
                <div className="flex items-center gap-2 truncate">
                  <UserAvatar user={user} fallbackLabel="?" size="sm" />
                  <span className="truncate">{user.fullName}</span>
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 text-[#111111] shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );

  return (
    <div className="py-2 text-[#111111]">
      {deal.description !== "" && (
        <div className="px-4 pb-3">
          <p className="whitespace-pre-wrap rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] px-3.5 py-2 text-[13px] text-[#333333]">
            {deal.description}
          </p>
        </div>
      )}

      {/* Accordion Group 1: Сделка */}
      <div className="mt-1">
        <button
          type="button"
          onClick={() => setDealOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Сделка</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !dealOpen && "rotate-180")} />
        </button>
        {dealOpen && (
          <div className="space-y-0.5 py-0.5">
            {/* Сумма */}
            <FieldRow icon={DollarSign} label="Сумма">
              {isEditingBudget ? (
                <div className="inline-flex items-center rounded-[6px] border border-[#3b82f6] bg-white shadow-xs overflow-hidden">
                  <div className="flex items-center gap-1 bg-[#fafafa] px-2 py-1 text-xs font-medium text-[#666666] border-r border-[#e5e5e5] select-none">
                    <span>{deal.currency}</span>
                  </div>
                  <div className="flex items-center px-2 py-1 gap-1">
                    <span className="text-xs text-[#888888]">₽</span>
                    <input
                      type="number"
                      min="0"
                      value={budgetVal}
                      onChange={(e) => setBudgetVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitBudget();
                        } else if (e.key === "Escape") {
                          setIsEditingBudget(false);
                        }
                      }}
                      onBlur={commitBudget}
                      className="w-24 bg-transparent text-xs font-medium text-[#111111] outline-none tabular-nums"
                      autoFocus
                    />
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingBudget(true);
                    setBudgetVal(String(deal.budget));
                  }}
                  className="group/btn inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left font-normal text-[#111111] hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                  title="Нажмите для редактирования суммы"
                >
                  <span className="tabular-nums">
                    {new Intl.NumberFormat("ru-RU", { style: "currency", currency: deal.currency, maximumFractionDigits: 0 }).format(deal.budget)}
                  </span>
                  <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                </button>
              )}
            </FieldRow>

            {/* Этап */}
            <FieldRow icon={CheckCircle2} label="Этап">
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => openPicker("stage", "row")}
                  className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                  title="Нажмите для выбора этапа"
                >
                  {stage === undefined ? (
                    <span className="text-[#888888]">—</span>
                  ) : (
                    <TagPill color={stage.isWon ? "emerald" : stage.isLost ? "rose" : stageTagColor(stage.colorKey)}>
                      {stage.name}
                    </TagPill>
                  )}
                </button>

                {activePicker === "stage" && (
                  <>
                    <div className="fixed inset-0 z-30 cursor-default" onClick={() => setActivePicker(null)} />
                    <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                      <div className="px-1.5 pb-1.5 border-b border-[#f0f0f0] mb-1">
                        <input
                          type="text"
                          placeholder="Поиск"
                          value={pickerSearch}
                          onChange={(e) => setPickerSearch(e.target.value)}
                          className="w-full text-xs text-[#111111] placeholder:text-[#999999] bg-transparent outline-none py-0.5"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-56 overflow-y-auto space-y-0.5">
                        {filteredStages.map((st) => {
                          const isSelected = st.stageId === deal.stageId;
                          return (
                            <button
                              key={st.stageId}
                              type="button"
                              onClick={() => {
                                if (st.stageId !== deal.stageId) {
                                  moveStage.mutate(
                                    { id: deal.id, stageId: st.stageId, pipelineId: deal.pipelineId },
                                    {
                                      onSuccess: () => toast.success("Этап обновлён"),
                                      onError: (err) => toast.error(err.message || "Ошибка обновления этапа"),
                                    },
                                  );
                                }
                                setActivePicker(null);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between rounded-[6px] px-2 py-1.5 text-xs transition-colors hover:bg-[#f5f5f5]",
                                isSelected && "bg-[#f5f5f5]",
                              )}
                            >
                              <TagPill color={st.isWon ? "emerald" : st.isLost ? "rose" : stageTagColor(st.stageColor)}>
                                {st.stageName}
                              </TagPill>
                              {isSelected && <Check className="h-3.5 w-3.5 text-[#111111]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </FieldRow>

            {/* Дата Закрытия */}
            <FieldRow icon={Calendar} label="Дата Закрытия">
              {isEditingCloseDate ? (
                <div className="inline-flex items-center gap-2">
                  <input
                    type="date"
                    defaultValue={deal.closeDate ? deal.closeDate.slice(0, 10) : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateDeal.mutate(
                        { id: deal.id, pipelineId: deal.pipelineId, payload: { close_date: val || "" } },
                        {
                          onSuccess: () => toast.success("Дата закрытия обновлена"),
                          onError: (err) => toast.error(err.message || "Ошибка"),
                        },
                      );
                      setIsEditingCloseDate(false);
                    }}
                    onBlur={() => setIsEditingCloseDate(false)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setIsEditingCloseDate(false);
                    }}
                    className="rounded-[6px] border border-[#3b82f6] px-2 py-0.5 text-xs text-[#111111] outline-none"
                    autoFocus
                  />
                  {deal.closeDate && (
                    <button
                      type="button"
                      onClick={() => {
                        updateDeal.mutate(
                          { id: deal.id, pipelineId: deal.pipelineId, payload: { close_date: "" } },
                          {
                            onSuccess: () => toast.success("Дата закрытия очищена"),
                            onError: (err) => toast.error(err.message || "Ошибка"),
                          },
                        );
                        setIsEditingCloseDate(false);
                      }}
                      className="text-[11px] text-[#888888] hover:text-rose-600 transition-colors"
                      title="Очистить"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingCloseDate(true)}
                  className="group/btn inline-flex items-center gap-1.5 rounded-[4px] px-1 py-0.5 -mx-1 text-left hover:bg-[#f5f5f5] transition-colors cursor-pointer"
                  title="Нажмите для редактирования даты"
                >
                  <span className={deal.closeDate !== null ? "text-[#111111]" : "text-[#888888]"}>
                    {deal.closeDate !== null ? dateOnly(deal.closeDate) : "—"}
                  </span>
                  <Pencil className="h-3 w-3 text-[#999999] opacity-0 group-hover/btn:opacity-100 transition-opacity" />
                </button>
              )}
            </FieldRow>

            {/* Воронка */}
            {pipelineName && (
              <FieldRow icon={Handshake} label="Воронка">
                <span className="text-[#111111]">{pipelineName}</span>
              </FieldRow>
            )}
          </div>
        )}
      </div>

      {/* Accordion Group 2: Связи */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setRelationsOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Связи</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !relationsOpen && "rotate-180")} />
        </button>
        {relationsOpen && (
          <div className="space-y-0.5 py-0.5">
            {/* Компания */}
            <FieldRow icon={Building2} label="Компания">
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => openPicker("company", "row")}
                  className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                  title="Нажмите для выбора компании"
                >
                  {deal.companyName !== null && deal.companyName !== "" ? (
                    <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
                  ) : (
                    <span className="text-[#888888] hover:text-[#111111]">—</span>
                  )}
                </button>
                {activePicker === "company" && pickerAnchor === "row" && renderCompanyPicker()}
              </div>
            </FieldRow>

            {/* Контактное лицо */}
            <FieldRow icon={User} label="Контактное лицо">
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => openPicker("contact", "row")}
                  className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                  title="Нажмите для выбора контакта"
                >
                  {deal.contactName !== null && deal.contactName !== "" ? (
                    <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
                  ) : (
                    <span className="text-[#888888] hover:text-[#111111]">—</span>
                  )}
                </button>
                {activePicker === "contact" && pickerAnchor === "row" && renderContactPicker()}
              </div>
            </FieldRow>

            {/* Владелец */}
            <FieldRow icon={UserCircle2} label="Владелец">
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => openPicker("owner", "row")}
                  className="cursor-pointer hover:opacity-85 transition-opacity inline-flex items-center"
                  title="Нажмите для выбора владельца"
                >
                  {owner !== undefined ? (
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                      <UserAvatar user={owner} fallbackLabel="?" size="sm" />
                      <span>{owner.fullName}</span>
                    </span>
                  ) : deal.ownerName !== null && deal.ownerName !== "" ? (
                    <EntityChip name={deal.ownerName} label={deal.ownerName} size="sm" />
                  ) : (
                    <span className="text-[#888888] hover:text-[#111111]">—</span>
                  )}
                </button>
                {activePicker === "owner" && pickerAnchor === "row" && renderOwnerPicker()}
              </div>
            </FieldRow>
          </div>
        )}
      </div>

      {/* Accordion Group 3: Система */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setSystemOpen((prev) => !prev)}
          className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors"
        >
          <span>Система</span>
          <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !systemOpen && "rotate-180")} />
        </button>
        {systemOpen && (
          <div className="space-y-0.5 py-0.5">
            <FieldRow icon={Calendar} label="Дата создания">
              <span title={fullDate(deal.createdAt)} className="text-[#111111]">
                {timeAgo(deal.createdAt)}
              </span>
            </FieldRow>
            <FieldRow icon={Bot} label="Создано">
              <span className="inline-flex items-center gap-1.5 text-[#111111]">
                <Bot className="h-3 w-3 text-[#888888]" />
                <span>{creator !== undefined ? creator.fullName : "System"}</span>
              </span>
            </FieldRow>
          </div>
        )}
      </div>

      {/* Separate Relation Cards with Pencil Edit Icon (matches Twenty Screenshot 2) */}
      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#111111]">Контактное лицо</span>
          <button
            type="button"
            aria-label="Редактировать контактное лицо"
            onClick={() => openPicker("contact", "card")}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => openPicker("contact", "card")}
            className="text-left cursor-pointer hover:opacity-85 transition-opacity"
          >
            {deal.contactName !== null && deal.contactName !== "" ? (
              <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
            ) : (
              <span className="text-xs text-[#888888]">—</span>
            )}
          </button>
          {activePicker === "contact" && pickerAnchor === "card" && renderContactPicker()}
        </div>
      </div>

      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#111111]">Компания</span>
          <button
            type="button"
            aria-label="Редактировать компанию"
            onClick={() => openPicker("company", "card")}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => openPicker("company", "card")}
            className="text-left cursor-pointer hover:opacity-85 transition-opacity"
          >
            {deal.companyName !== null && deal.companyName !== "" ? (
              <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
            ) : (
              <span className="text-xs text-[#888888]">—</span>
            )}
          </button>
          {activePicker === "company" && pickerAnchor === "card" && renderCompanyPicker()}
        </div>
      </div>

      <div className="relative mt-4 border-t border-[#f0f0f0] pt-3 px-4 pb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-[#111111]">Владелец</span>
          <button
            type="button"
            aria-label="Редактировать ответственного"
            onClick={() => openPicker("owner", "card")}
            className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="relative">
          <button
            type="button"
            onClick={() => openPicker("owner", "card")}
            className="text-left cursor-pointer hover:opacity-85 transition-opacity"
          >
            {owner !== undefined ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                <UserAvatar user={owner} fallbackLabel="?" size="sm" />
                <span>{owner.fullName}</span>
              </span>
            ) : deal.ownerName !== null && deal.ownerName !== "" ? (
              <EntityChip name={deal.ownerName} label={deal.ownerName} size="sm" />
            ) : (
              <span className="text-xs text-[#888888]">—</span>
            )}
          </button>
          {activePicker === "owner" && pickerAnchor === "card" && renderOwnerPicker()}
        </div>
      </div>
    </div>
  );
}

function TasksTab({ dealId }: { dealId: string }) {
  const tasks = useTasks({ limit: 50 });

  const dealTasks = tasks.data?.items.filter((t) => t.dealId === dealId || t.linkedEntityId === dealId) ?? [];

  return (
    <div className="px-5 py-4">
      {tasks.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : dealTasks.length === 0 ? (
        <EmptyState icon={ListChecks} title="Задач нет" description="Связанные с этой сделкой задачи появятся здесь" />
      ) : (
        <div className="space-y-2">
          {dealTasks.map((task) => (
            <div key={task.id} className="rounded-[16px] border border-[#e5e5e5] bg-white p-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-[#000000]">{task.title}</p>
                <span className={cn(
                  "rounded-full border px-2 py-0.5 text-xs",
                  task.status === "done" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                  task.status === "in_progress" && "border-amber-500/30 bg-amber-500/10 text-amber-400",
                  task.status === "todo" && "border-slate-700 bg-slate-800 text-slate-400",
                )}>
                  {task.status}
                </span>
              </div>
              {task.dueDate && <p className="mt-1 text-xs text-slate-500">До {new Intl.DateTimeFormat("ru-RU").format(new Date(task.dueDate))}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilesTab() {
  return (
    <div className="px-5 py-4">
      <EmptyState icon={Paperclip} title="Файлы и счета" description="Файлы и счета по этой сделке появятся здесь" />
    </div>
  );
}


/** Идентификаторы вкладок — ключи реестра и строк `page_layout_tabs`. */
export const DEAL_TAB_IDS = ["home", "chat", "tasks", "notes", "files"] as const;
export type DealTabId = (typeof DEAL_TAB_IDS)[number];

/**
 * Реестр «ключ → содержимое» для сделки. Состав и порядок приходят из БД через
 * `useTabsRenderer` / `resolvePageLayoutTabs`; здесь только компоненты.
 *
 * Право на чат дублируется: фильтр по `requiredPermission` прячет вкладку, а
 * `Guard` остаётся страховкой внутри, если фильтр обойдут.
 */
export function dealTabContents(
  deal: DealDTO,
  context: DealTabsContext,
): Record<DealTabId, ReactNode> {
  return {
    home: (
      <HomeTab
        deal={deal}
        usersById={context.usersById}
        pipelines={context.pipelines}
        stagesById={context.stagesById}
      />
    ),
    chat: (
      <Guard
        requiredPermission="deals:write"
        fallback={<div className="p-5 text-sm text-slate-500">Нет доступа к переписке</div>}
      >
        <ChatTab dealId={deal.id} />
      </Guard>
    ),
    tasks: <TasksTab dealId={deal.id} />,
    notes: <RecordNotesTab targetType="deal" targetId={deal.id} />,
    files: <FilesTab />,
  };
}
