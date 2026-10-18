"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertCircle, Banknote, Bot, Building2, CalendarClock, Handshake, ListChecks, Loader2, MessageCircle, Paperclip, Send, UserCircle2 } from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { Skeleton } from "@/components/shared/Skeleton";
import { Guard } from "@/components/shared/Guard";
import { useDealTimeline, useSendDealMessage } from "@/lib/api/use-deals";
import { useTasks } from "@/lib/api/use-tasks";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { RecordNotesTab } from "@/components/crm/shared/RecordNotesTab";
import type { DealMessageDTO, DealDTO, PipelineDTO } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { timeAgo } from "@/lib/utils";
import { cn } from "@/lib/utils";

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
function FieldRow({ icon: Icon, label, children }: { icon: typeof Building2; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 px-4 py-2">
      <span className="flex h-6 w-[100px] shrink-0 items-center gap-1.5 text-xs text-[#666666]">
        <Icon className="h-4 w-4 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 pt-0.5 text-[13px] text-[#000000]">{children}</span>
    </div>
  );
}

function FieldsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-[16px] border border-[#e5e5e5] bg-white shadow-2xs">
      <h3 className="border-b border-[#e5e5e5] bg-[#fafafa] px-4 py-2 text-xs font-semibold uppercase tracking-wider text-[#666666]">{title}</h3>
      <div className="divide-y divide-[#e5e5e5]">{children}</div>
    </section>
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
  // Владелец и создатель — разные поля (миграция 0018): сделку может завести
  // AI-агент, а вести живой менеджер, поэтому owner_id читается отдельно.
  const owner = deal.ownerId !== null ? usersById.get(deal.ownerId) : undefined;
  const creator = usersById.get(deal.createdBy);
  const pipelineName = pipelines?.find((pipeline) => pipeline.id === deal.pipelineId)?.name;
  const stage = stagesById?.get(deal.stageId);

  const fullDate = (iso: string): string =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  const dateOnly = (iso: string): string =>
    new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));

  return (
    <div className="space-y-5 px-5 py-4">
      {deal.description !== "" && (
        <p className="whitespace-pre-wrap rounded-[16px] border border-[#e5e5e5] bg-white px-4 py-3 text-[13px] text-[#333333] shadow-2xs">{deal.description}</p>
      )}

      <FieldsCard title="Сделка">
        <FieldRow icon={Banknote} label="Сумма">
          <span className="font-semibold text-[#000000] tabular-nums">
            {new Intl.NumberFormat("ru-RU", { style: "currency", currency: deal.currency, maximumFractionDigits: 0 }).format(deal.budget)}
          </span>
        </FieldRow>
        <FieldRow icon={ListChecks} label="Этап">
          {stage === undefined ? (
            <span className="text-slate-600">—</span>
          ) : (
            <TagPill color={stage.isWon ? "emerald" : stage.isLost ? "rose" : stageTagColor(stage.colorKey)}>
              {stage.name}
            </TagPill>
          )}
        </FieldRow>
        <FieldRow icon={CalendarClock} label="Дата закрытия">
          {deal.closeDate !== null ? dateOnly(deal.closeDate) : <span className="text-slate-600">—</span>}
        </FieldRow>
        <FieldRow icon={Handshake} label="Воронка">
          {pipelineName ?? <span className="text-slate-600">—</span>}
        </FieldRow>
      </FieldsCard>

      <FieldsCard title="Связи">
        <FieldRow icon={Building2} label="Компания">
          {deal.companyName !== null && deal.companyName !== "" ? (
            <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </FieldRow>
        <FieldRow icon={UserCircle2} label="Контактное лицо">
          {deal.contactName !== null && deal.contactName !== "" ? (
            <EntityChip name={deal.contactName} label={deal.contactName} size="sm" />
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </FieldRow>
        <FieldRow icon={UserCircle2} label="Владелец">
          {owner !== undefined ? (
            <span className="inline-flex items-center gap-2">
              <UserAvatar user={owner} fallbackLabel="?" size="sm" />
              {owner.fullName}
            </span>
          ) : deal.ownerName !== null && deal.ownerName !== "" ? (
            deal.ownerName
          ) : (
            <span className="text-slate-600">—</span>
          )}
        </FieldRow>
      </FieldsCard>

      <FieldsCard title="Система">
        <FieldRow icon={CalendarClock} label="Создана">
          <span title={fullDate(deal.createdAt)}>{timeAgo(deal.createdAt)}</span>
        </FieldRow>
        <FieldRow icon={UserCircle2} label="Создал">
          {creator !== undefined ? creator.fullName : <span className="text-slate-600">Система</span>}
        </FieldRow>
        <FieldRow icon={CalendarClock} label="Обновлена">
          <span title={fullDate(deal.updatedAt)}>{timeAgo(deal.updatedAt)}</span>
        </FieldRow>
      </FieldsCard>
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
