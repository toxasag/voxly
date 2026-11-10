"use client";

import { memo, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  Flag,
  Globe,
  Mail,
  MapPin,
  Phone,
  User,
} from "lucide-react";
import type { DealDTO, StageColorKey } from "@/lib/api/use-deals";
import type { TenantUserDTO } from "@/lib/api/use-tenant-users";
import { EntityChip, chipInitials, paletteFor } from "@/components/crm/shared/EntityChip";
import { TagPill } from "@/components/ui/tag";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import {
  defaultDealCardFields,
  type DealCardFieldVisibility,
} from "@/components/crm/deals/deal-card-fields";
import { useIsMobile } from "@/lib/utils/use-is-mobile";
import { cn, formatDateTime } from "@/lib/utils";

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

  const companyFields = options.companyFields ?? {
    name: true,
    phone: true,
    email: true,
    website: true,
    city: true,
  };

  const contactFields = options.contactFields ?? {
    name: true,
    jobTitle: true,
    phone: true,
    email: true,
  };

  return (
    <div
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
        {/* Бюджет */}
        {Boolean(options.budget) && (
          <div className="flex items-center gap-2 text-[#333333]">
            <span className="flex h-3.5 w-3.5 items-center justify-center text-[11px] font-medium text-[#888888] shrink-0">
              {deal.currency === "RUB" ? "₽" : deal.currency === "EUR" ? "€" : "$"}
            </span>
            <span className="font-normal text-[#111111] tabular-nums">
              {deal.budget > 0
                ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(deal.budget)} ${deal.currency === "RUB" ? "₽" : deal.currency}`
                : `0 ${deal.currency === "RUB" ? "₽" : deal.currency}`}
            </span>
          </div>
        )}

        {/* Ответственный */}
        {Boolean(options.owner) && (
          <div className="flex items-center gap-2 text-[#666666]">
            <User className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            {manager?.fullName || deal.ownerName ? (
              <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#e5e5e5] bg-white px-1.5 py-0.5 text-[11px] text-[#333333]">
                <span
                  className={cn(
                    "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] text-[8px] font-bold border",
                    paletteFor(manager?.fullName ?? deal.ownerName ?? "System"),
                  )}
                  aria-hidden="true"
                >
                  {manager?.fullName
                    ? chipInitials(manager.fullName)
                    : deal.ownerName
                    ? chipInitials(deal.ownerName)
                    : "S"}
                </span>
                <span className="truncate">{manager?.fullName ?? deal.ownerName}</span>
              </span>
            ) : (
              <span className="text-[#888888]">Ответственный: —</span>
            )}
          </div>
        )}

        {/* Дата закрытия / срок */}
        {Boolean(options.closeDate) && (
          <div className="flex items-center gap-2 text-[#666666]">
            <Calendar className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <span className={deal.closeDate ? "text-[#333333]" : "text-[#888888]"}>
              {deal.closeDate
                ? new Date(deal.closeDate).toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : "Срок: —"}
            </span>
          </div>
        )}

        {/* Задачи */}
        {Boolean(options.tasks) && (
          <div className="flex flex-col gap-1 rounded-[6px] border border-[#f0f0f0] bg-[#fafafa] p-1.5 text-xs">
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 text-[#555555]">
                <CheckSquare className="h-3.5 w-3.5 text-[#4a38f5] shrink-0" />
                <span className="font-medium text-[11px]">Задачи</span>
              </div>
              {deal.pendingTasksCount !== undefined && deal.pendingTasksCount > 0 ? (
                <span className="rounded-full bg-indigo-50 px-1.5 py-0.2 text-[10px] font-semibold text-[#4a38f5] border border-indigo-200">
                  {deal.pendingTasksCount} в работе
                </span>
              ) : deal.tasksCount !== undefined && deal.tasksCount > 0 ? (
                <span className="rounded-full bg-emerald-50 px-1.5 py-0.2 text-[10px] font-semibold text-emerald-700 border border-emerald-200">
                  выполнены
                </span>
              ) : (
                <span className="text-[10px] text-[#888888]">нет</span>
              )}
            </div>
            {deal.nextTaskTitle && (
              <div className="flex items-center gap-1 text-[11px] text-[#333333] truncate pl-5">
                <span className="truncate">{deal.nextTaskTitle}</span>
                {deal.nextTaskDueDate && (
                  <span className="shrink-0 text-[10px] text-[#888888]">
                    ({new Date(deal.nextTaskDueDate).toLocaleDateString("ru-RU", { day: "numeric", month: "short" })})
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Компания (с раскрытыми подполями) */}
        {Boolean(options.company) && (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2 text-[#666666]">
              <Building2 className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              {deal.companyName ? (
                companyFields.name ? (
                  <EntityChip name={deal.companyName} label={deal.companyName} icon={Building2} size="sm" />
                ) : (
                  <span className="font-medium text-[#111111]">{deal.companyName}</span>
                )
              ) : (
                <span className="text-[#888888]">Компания: —</span>
              )}
            </div>
            {deal.companyName && (
              <div className="pl-5 space-y-0.5 text-[11px] text-[#666666]">
                {companyFields.phone && deal.companyPhone && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <Phone className="h-3 w-3 text-[#888888] shrink-0" />
                    <span>{deal.companyPhone}</span>
                  </div>
                )}
                {companyFields.email && deal.companyEmail && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <Mail className="h-3 w-3 text-[#888888] shrink-0" />
                    <span className="truncate">{deal.companyEmail}</span>
                  </div>
                )}
                {companyFields.website && deal.companyWebsite && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <Globe className="h-3 w-3 text-[#888888] shrink-0" />
                    <span className="truncate">{deal.companyWebsite}</span>
                  </div>
                )}
                {companyFields.city && deal.companyCity && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <MapPin className="h-3 w-3 text-[#888888] shrink-0" />
                    <span>{deal.companyCity}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Контакт (с раскрытыми подполями) */}
        {Boolean(options.contact) && (
          <div className="space-y-1 text-xs">
            <div className="flex items-center gap-2 text-[#666666]">
              <User className="h-3.5 w-3.5 text-[#888888] shrink-0" />
              {deal.contactName ? (
                contactFields.name ? (
                  <EntityChip name={deal.contactName} label={deal.contactName} icon={User} size="sm" />
                ) : (
                  <span className="font-medium text-[#111111]">{deal.contactName}</span>
                )
              ) : (
                <span className="text-[#888888]">Контакт: —</span>
              )}
            </div>
            {deal.contactName && (
              <div className="pl-5 space-y-0.5 text-[11px] text-[#666666]">
                {contactFields.jobTitle && deal.contactJobTitle && (
                  <div className="flex items-center gap-1.5 text-[#666666]">
                    <Briefcase className="h-3 w-3 text-[#888888] shrink-0" />
                    <span>{deal.contactJobTitle}</span>
                  </div>
                )}
                {contactFields.phone && deal.contactPhone && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <Phone className="h-3 w-3 text-[#888888] shrink-0" />
                    <span>{deal.contactPhone}</span>
                  </div>
                )}
                {contactFields.email && deal.contactEmail && (
                  <div className="flex items-center gap-1.5 text-[#555555]">
                    <Mail className="h-3 w-3 text-[#888888] shrink-0" />
                    <span className="truncate">{deal.contactEmail}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Этап */}
        {Boolean(options.stage) && (
          <div className="flex items-center gap-2 text-[#666666]">
            <Flag className="h-3.5 w-3.5 text-[#888888] shrink-0" />
            <TagPill color={stageColorKey ? stageTagColor(stageColorKey) : "slate"}>
              {stageName}
            </TagPill>
          </div>
        )}

        {/* Заметка */}
        {Boolean(options.latestNote) && (
          deal.latestNote ? (
            <div className="rounded-[6px] border border-[#fef08a] bg-[#fefce8] p-2 text-[11px] text-[#854d0e]">
              <div className="line-clamp-3 whitespace-pre-wrap break-words font-normal leading-relaxed">
                {deal.latestNote}
              </div>
            </div>
          ) : (
            <div className="text-xs text-[#888888]">Заметка: —</div>
          )
        )}

        {/* Валюта */}
        {Boolean(options.currency) && (
          <div className="text-xs text-[#888888]">Валюта: {deal.currency}</div>
        )}

        {/* Дата создания */}
        {Boolean(options.createdAt) && (
          <div className="text-xs text-[#888888]">
            Создана: {formatDateTime(deal.createdAt)}
          </div>
        )}

        {/* Дата обновления */}
        {Boolean(options.updatedAt) && (
          <div className="text-xs text-[#888888]">
            Обновлена: {formatDateTime(deal.updatedAt)}
          </div>
        )}

        {/* Дата закрытия (факт) */}
        {Boolean(options.closedAt) && (
          <div className="text-xs text-[#888888]">
            {deal.closedAt
              ? `Закрыта: ${formatDateTime(deal.closedAt)}`
              : "Закрыта: —"}
          </div>
        )}
      </div>

      {/* Мобильные стрелки перемещения */}
      <div className="flex items-center gap-1 opacity-100 transition-opacity md:opacity-0 md:h-0 md:overflow-hidden md:p-0 md:group-hover:h-auto md:group-hover:overflow-visible md:group-hover:pt-1 md:group-hover:opacity-100">
        <button
          type="button"
          disabled={!canMoveLeft}
          onClick={(event) => {
            event.stopPropagation();
            onMove(deal.id, -1);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-30 md:h-auto md:w-auto md:p-1"
        >
          <ArrowLeft className="h-4 w-4 md:h-3 md:w-3" />
        </button>
        <span className="flex-1 truncate text-center text-xs text-[#888888]">{stageName}</span>
        <button
          type="button"
          disabled={!canMoveRight}
          onClick={(event) => {
            event.stopPropagation();
            onMove(deal.id, 1);
          }}
          className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa] hover:text-[#000000] disabled:opacity-30 md:h-auto md:w-auto md:p-1"
        >
          <ArrowRight className="h-4 w-4 md:h-3 md:w-3" />
        </button>
      </div>
    </div>
  );
});