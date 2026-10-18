"use client";

import { useMemo, useState } from "react";
import { Handshake, Loader2, Plus } from "lucide-react";
import { RecordRelationSection } from "@/components/crm/shared/RecordField";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { Skeleton } from "@/components/shared/Skeleton";
import { useCreateDeal, useDeals, useKanban, usePipelines } from "@/lib/api/use-deals";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Секция «Сделки» на карточке контакта или компании.
//
// Образец — виджет relation в Twenty (`FieldWidgetRelationCard` +
// `RecordDetailRelationSectionDropdownToMany`): список связанных записей и
// кнопка «+», создающая новую уже привязанной к текущей. Как у них, введённый
// текст становится названием новой записи (`buildRecordLabelPayload`), а связь
// подставляется из контекста, а не спрашивается.
//
// Воронка и стадия берутся по умолчанию: первая воронка тенанта и её первая
// стадия. Спрашивать их здесь значило бы повторять форму создания сделки в
// секции, которая должна остаться однострочной.
// ---------------------------------------------------------------------------

interface RecordDealsSectionProps {
  /** Ровно один из двух: сделка привязывается к контакту или к компании. */
  contactId?: string;
  companyId?: string;
  /** Подставляется в название новой сделки: «Сделка — {название}». */
  targetLabel: string;
  canWrite?: boolean;
  onOpenDeal?: (dealId: string) => void;
}

const money = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

export function RecordDealsSection({
  contactId,
  companyId,
  targetLabel,
  canWrite = true,
  onOpenDeal,
}: RecordDealsSectionProps) {
  const deals = useDeals({ contactId, companyId, limit: 20 });
  const pipelines = usePipelines();
  const firstPipelineId = pipelines.data?.[0]?.id ?? null;
  const kanban = useKanban(firstPipelineId);
  const create = useCreateDeal();

  const [composing, setComposing] = useState(false);
  const [title, setTitle] = useState("");

  const firstStageId = useMemo(() => {
    const columns = [...(kanban.data ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
    return columns[0]?.stageId ?? null;
  }, [kanban.data]);

  const items = deals.data?.items ?? [];
  const canCreate = canWrite && firstPipelineId !== null && firstStageId !== null;

  const submit = (): void => {
    const trimmed = title.trim();
    if (trimmed === "" || firstPipelineId === null || firstStageId === null) return;

    create.mutate(
      {
        title: trimmed,
        budget: 0,
        currency: "RUB",
        pipeline_id: firstPipelineId,
        stage_id: firstStageId,
        contact_id: contactId,
        company_id: companyId,
      },
      {
        onSuccess: (deal) => {
          setTitle("");
          setComposing(false);
          toast.success(`Сделка «${deal.title}» создана`);
        },
        onError: (error) => toast.error(error.message),
      },
    );
  };

  return (
    <RecordRelationSection
      title="Сделки"
      count={items.length}
      action={
        canCreate && !composing ? (
          <button
            type="button"
            onClick={() => { setComposing(true); setTitle(`Сделка — ${targetLabel}`); }}
            title="Создать сделку"
            aria-label="Создать сделку"
            className="rounded p-1 text-[#888888] transition-colors hover:bg-[#f5f5f5] hover:text-[#4a38f5]"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        {composing && (
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-2">
            <input
              value={title}
              autoFocus
              onChange={(event) => setTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setComposing(false);
                }
              }}
              placeholder="Название сделки"
              className="w-full rounded border border-[#e5e5e5] bg-white px-2 py-1.5 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
            <div className="mt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setComposing(false)}
                className="rounded px-2 py-1 text-xs text-[#666666] hover:text-[#111111]"
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={create.isPending || title.trim() === ""}
                className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-2.5 py-1 text-xs font-semibold text-white transition-colors hover:bg-[#3d2ee0] disabled:opacity-50"
              >
                {create.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                Создать
              </button>
            </div>
          </div>
        )}

        {deals.isLoading ? (
          <Skeleton className="h-8 w-full" />
        ) : items.length === 0 ? (
          <p className="px-1 text-xs text-[#888888]">
            {canCreate ? "Сделок нет — создайте первую" : "Сделок нет"}
          </p>
        ) : (
          items.map((deal) => (
            <button
              key={deal.id}
              type="button"
              onClick={() => onOpenDeal?.(deal.id)}
              className={cn(
                "flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors",
                onOpenDeal !== undefined && "hover:bg-[#f5f5f5]",
              )}
            >
              <EntityChip name={deal.title} icon={Handshake} size="sm" />
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#111111]">{deal.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-[#666666]">{money.format(deal.budget)}</span>
            </button>
          ))
        )}
      </div>
    </RecordRelationSection>
  );
}
