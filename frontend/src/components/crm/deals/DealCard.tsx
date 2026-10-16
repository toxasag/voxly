"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Banknote, ArrowLeft, ArrowRight, Building2, CalendarClock, Flag, User } from "lucide-react";
import type { DealDTO, StageColorKey } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { stageColor } from "@/components/crm/deals/stage-colors";
import {
  defaultDealCardFields,
  hasDealFieldValue,
  type DealCardFieldVisibility,
} from "@/components/crm/deals/deal-card-fields";
import { useIsMobile } from "@/lib/utils/use-is-mobile";
import { cn } from "@/lib/utils";

/**
 * Какие поля сделки показывать на карточке — меню ••• тулбара.
 *
 * Раньше здесь было три флажка: два поля и «Компактно». Теперь состав
 * перечисляет все поля сделки (`DEAL_CARD_FIELDS`), как выбор колонок в списке;
 * «Компактно» убрано — оно меняло отступы, а не состав, и настройкой карточки
 * не было.
 */
export type DealCardOptions = DealCardFieldVisibility;

interface Props {
  deal: DealDTO;
  stageName: string;
  stageColorKey?: StageColorKey;
  isWon: boolean;
  isLost: boolean;
  /** Resolved from createdBy; undefined while the catalog loads or if removed. */
  manager: TenantUserDTO | undefined;
  onMove: (id: string, direction: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onOpen?: (id: string) => void;
}

export const DealCard = memo(function DealCard({
  deal,
  stageName,
  stageColorKey,
  isWon,
  isLost,
  manager,
  onMove,
  canMoveLeft,
  canMoveRight,
  onOpen,
  options = defaultDealCardFields(),
}: Props & { options?: DealCardOptions }) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const drag = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.dataTransfer.setData("text/plain", deal.id);
    event.dataTransfer.effectAllowed = "move";
  }, [deal.id]);

  const handleClick = useCallback(() => {
    if (onOpen) {
      onOpen(deal.id);
    } else {
      router.push(`/crm/deals/${deal.id}`);
    }
  }, [deal.id, onOpen, router]);

  const accent = stageColor(stageColorKey);
  const leftBorderClass = isWon ? "border-l-emerald-500" : isLost ? "border-l-rose-500" : accent.cardBorder;

  // Поле показывается, только когда включено и когда у сделки есть значение:
  // пустая строка «Описание:» занимала бы место, ничего не сообщая.
  const show = (field: keyof DealCardOptions): boolean =>
    options[field] && hasDealFieldValue(deal, field);

  return (
    <div
      // Перетаскивание карточек только на десктопе: пальцем оно конфликтует с
      // горизонтальным скроллом доски — жест начинается одинаково, и либо доска не
      // скроллится, либо карточка не переносится. На мобильном перенос делается
      // стрелками ниже.
      draggable={!isMobile}
      onDragStart={isMobile ? undefined : drag}
      onClick={handleClick}
      className={cn(
        "group cursor-pointer rounded-lg border border-slate-800 border-l-[3px] bg-slate-900 transition-all hover:border-slate-700 hover:bg-slate-800/50",
        leftBorderClass,
        "p-3.5",
      )}
    >
      <div className="space-y-2.5">
        <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">{deal.title}</h3>
        {/* Компания и контактное лицо чипами, как на карточке Opportunity в Twenty. */}
        {((show("company") && deal.companyName !== null) ||
          (show("contact") && deal.contactName !== null)) && (
          <div className="flex flex-wrap gap-1.5">
            {show("company") && deal.companyName !== null && (
              <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" className="text-slate-300" />
            )}
            {show("contact") && deal.contactName !== null && (
              <EntityChip name={deal.contactName} label={deal.contactName} icon={User} size="sm" className="text-slate-400" />
            )}
          </div>
        )}
        {show("budget") && (
          <div className="flex gap-1.5">
            <Banknote className="h-3.5 w-3.5 text-slate-500" />
            <span className="text-sm font-semibold text-amber-400">
              {new Intl.NumberFormat("ru-RU", { style: "currency", currency: deal.currency, maximumFractionDigits: 0 }).format(deal.budget)}
            </span>
          </div>
        )}
        {show("description") && (
          <p className="line-clamp-2 text-xs text-slate-500">{deal.description}</p>
        )}
        {show("closeDate") && deal.closeDate !== null && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <CalendarClock className="h-3.5 w-3.5 text-slate-500" />
            {new Date(deal.closeDate).toLocaleDateString("ru-RU")}
          </div>
        )}
        {show("stage") && (
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Flag className="h-3.5 w-3.5 text-slate-500" />
            {stageName}
          </div>
        )}
        {show("currency") && (
          <div className="text-xs text-slate-500">Валюта: {deal.currency}</div>
        )}
        {show("createdAt") && (
          <div className="text-xs text-slate-500">Создана: {new Date(deal.createdAt).toLocaleDateString("ru-RU")}</div>
        )}
        {show("updatedAt") && (
          <div className="text-xs text-slate-500">Обновлена: {new Date(deal.updatedAt).toLocaleDateString("ru-RU")}</div>
        )}
        {show("closedAt") && deal.closedAt !== null && (
          <div className="text-xs text-slate-500">Закрыта: {new Date(deal.closedAt).toLocaleDateString("ru-RU")}</div>
        )}
        {show("owner") && <UserAvatar user={manager} fallbackLabel="Unassigned" size="sm" />}
        {/*
          На мобильном стрелки видны всегда: `opacity-0 group-hover` рассчитан на
          курсор, которого на телефоне нет, и без этого канбан остался бы вообще без
          способа перенести сделку — перетаскивание там отключено.
        */}
        <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button type="button" disabled={!canMoveLeft} onClick={(event) => { event.stopPropagation(); onMove(deal.id, -1); }} className="flex h-9 w-9 items-center justify-center rounded bg-slate-800 text-slate-400 disabled:opacity-30 md:h-auto md:w-auto md:p-1"><ArrowLeft className="h-4 w-4 md:h-3 md:w-3" /></button>
          <span className="flex-1 truncate text-center text-xs text-slate-500">{stageName}</span>
          <button type="button" disabled={!canMoveRight} onClick={(event) => { event.stopPropagation(); onMove(deal.id, 1); }} className="flex h-9 w-9 items-center justify-center rounded bg-slate-800 text-slate-400 disabled:opacity-30 md:h-auto md:w-auto md:p-1"><ArrowRight className="h-4 w-4 md:h-3 md:w-3" /></button>
        </div>
      </div>
    </div>
  );
});
