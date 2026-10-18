"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Building2, Calendar, Flag, User } from "lucide-react";
import type { DealDTO, StageColorKey } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
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
      className="group cursor-pointer rounded-[8px] border border-[#e5e5e5] bg-white transition-all hover:border-[#cccccc] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-3 space-y-2 active:opacity-30"
    >
      {/* Заголовок с монограммой как в Twenty */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] text-[10px] font-semibold border",
            paletteFor(deal.title),
          )}
          aria-hidden="true"
        >
          {deal.title.trim().charAt(0).toUpperCase()}
        </span>
        <h3 className="line-clamp-2 flex-1 text-[13px] font-medium text-[#111111] leading-snug">
          {deal.title}
        </h3>
      </div>

      {/* Метаданные сделки аккуратным списком как в Twenty */}
      <div className="space-y-1.5 text-xs">
        {show("budget") && (
          <div className="flex items-center gap-2 text-[#333333]">
            <span className="flex h-3.5 w-3.5 items-center justify-center text-[11px] font-medium text-[#888888] shrink-0">
              {deal.currency === "RUB" ? "₽" : deal.currency === "EUR" ? "€" : "$"}
            </span>
            <span className="font-normal text-[#111111] tabular-nums">
              {new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(deal.budget)} {deal.currency === "RUB" ? "₽" : deal.currency}
            </span>
          </div>
        )}

        {show("owner") && (
          <div className="flex items-center gap-2 text-[#666666]">
            <User className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-[11px] text-[#333333]">
              <span
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] text-[8px] font-bold border",
                  paletteFor(manager?.fullName ?? deal.ownerName ?? "System"),
                )}
                aria-hidden="true"
              >
                {manager?.fullName ? chipInitials(manager.fullName) : deal.ownerName ? chipInitials(deal.ownerName) : "S"}
              </span>
              <span className="truncate">{manager?.fullName ?? deal.ownerName ?? "System"}</span>
            </span>
          </div>
        )}

        {show("closeDate") && deal.closeDate !== null && (
          <div className="flex items-center gap-2 text-[#666666]">
            <Calendar className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <span className="text-[#333333]">
              {new Date(deal.closeDate).toLocaleDateString("ru-RU", {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}

        {show("company") && deal.companyName !== null && (
          <div className="flex items-center gap-2 text-[#666666]">
            <Building2 className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
          </div>
        )}

        {show("contact") && deal.contactName !== null && (
          <div className="flex items-center gap-2 text-[#666666]">
            <User className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <EntityChip name={deal.contactName} label={deal.contactName} icon={User} size="sm" />
          </div>
        )}

        {show("stage") && (
          <div className="flex items-center gap-2 text-[#666666]">
            <Flag className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <TagPill color={stageColorKey ? stageTagColor(stageColorKey) : "slate"}>
              {stageName}
            </TagPill>
          </div>
        )}

        {show("description") && (
          <p className="line-clamp-2 text-xs text-[#888888] pt-0.5">{deal.description}</p>
        )}

        {show("latestNote") && Boolean(deal.latestNote) && (
          <div className="rounded-[6px] border border-[#fef08a] bg-[#fefce8] p-2 text-[11px] text-[#854d0e]">
            <div className="line-clamp-3 whitespace-pre-wrap break-words font-normal leading-relaxed">
              {deal.latestNote}
            </div>
          </div>
        )}

        {show("currency") && (
          <div className="text-xs text-[#888888]">Валюта: {deal.currency}</div>
        )}
        {show("createdAt") && (
          <div className="text-xs text-[#888888]">Создана: {new Date(deal.createdAt).toLocaleDateString("ru-RU")}</div>
        )}
        {show("updatedAt") && (
          <div className="text-xs text-[#888888]">Обновлена: {new Date(deal.updatedAt).toLocaleDateString("ru-RU")}</div>
        )}
        {show("closedAt") && deal.closedAt !== null && (
          <div className="text-xs text-[#888888]">Закрыта: {new Date(deal.closedAt).toLocaleDateString("ru-RU")}</div>
        )}
      </div>

      {/* Мобильные стрелки перемещения */}
      <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:h-0 md:overflow-hidden md:p-0 md:group-hover:h-auto md:group-hover:overflow-visible md:group-hover:pt-1 md:group-hover:opacity-100">
        <button
          type="button"
          disabled={!canMoveLeft}
          onClick={(event) => { event.stopPropagation(); onMove(deal.id, -1); }}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-30 md:h-auto md:w-auto md:p-1"
        >
          <ArrowLeft className="h-4 w-4 md:h-3 md:w-3" />
        </button>
        <span className="flex-1 truncate text-center text-xs text-[#888888]">{stageName}</span>
        <button
          type="button"
          disabled={!canMoveRight}
          onClick={(event) => { event.stopPropagation(); onMove(deal.id, 1); }}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-30 md:h-auto md:w-auto md:p-1"
        >
          <ArrowRight className="h-4 w-4 md:h-3 md:w-3" />
        </button>
      </div>
    </div>
  );
});
