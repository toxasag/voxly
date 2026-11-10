"use client";

import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  Briefcase,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  DollarSign,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  Tag,
  TrendingUp,
  User,
  UserCheck,
} from "lucide-react";
import { useDealContactHistory } from "@/lib/api/use-deal-contact-history";
import { stageTagColor } from "@/components/crm/deals/stage-colors";
import { TagPill } from "@/components/ui/tag";
import { Skeleton } from "@/components/shared/Skeleton";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatPhone } from "@/lib/utils/phone";
import { timeAgo } from "@/lib/utils";
import { ContactActivityTimeline } from "@/components/crm/shared/ContactActivityTimeline";

interface DealContactHistoryTabProps {
  dealId: string;
}

const formatCurrency = (val: number, currency = "RUB") => {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: currency === "RUB" ? "RUB" : currency,
    maximumFractionDigits: 0,
  }).format(val);
};

const formatDate = (isoString: string | null) => {
  if (!isoString) return "—";
  try {
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(isoString));
  } catch {
    return "—";
  }
};

export function DealContactHistoryTab({ dealId }: DealContactHistoryTabProps) {
  const router = useRouter();
  const historyQuery = useDealContactHistory(dealId);

  if (historyQuery.isLoading) {
    return (
      <div className="space-y-4 p-5">
        <Skeleton className="h-28 w-full rounded-[8px]" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
          <Skeleton className="h-20 w-full rounded-[8px]" />
        </div>
        <Skeleton className="h-48 w-full rounded-[8px]" />
      </div>
    );
  }

  const data = historyQuery.data;
  const contact = data?.contact;
  const metrics = data?.metrics ?? {
    totalDeals: 1,
    wonDeals: 0,
    lostDeals: 0,
    activeDeals: 1,
    totalLtv: 0,
    avgCheck: 0,
    isRepeatClient: false,
  };
  const otherDeals = data?.otherDeals ?? [];
  const timeline = data?.timeline ?? [];

  if (!contact) {
    return (
      <div className="p-5">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white py-12">
          <EmptyState
            title="Контакт не привязан"
            description="К данной сделке пока не привязан контакт. Привяжите контакт на вкладке «Главная», чтобы видеть сквозную историю, LTV и другие сделки."
          />
        </div>
      </div>
    );
  }

  const customFields = contact.customFields || {};
  const ymUid = (customFields.ym_uid || customFields.yandex_client_id) as string | undefined;
  const clientId = (customFields.client_id || customFields.ga_client_id) as string | undefined;
  const utmSource = customFields.utm_source as string | undefined;
  const utmCampaign = customFields.utm_campaign as string | undefined;

  return (
    <div className="space-y-5 p-5">
      {/* 1. Карточка профиля контакта и веб-атрибуции */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f0f0f0] text-[#111111]">
              <User className="h-5 w-5 text-[#666666]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span
                  onClick={() => router.push(`/crm/contacts?record=${contact.id}`)}
                  className="cursor-pointer text-[14px] font-semibold text-[#111111] hover:text-[#4a38f5] hover:underline"
                >
                  {contact.firstName || contact.lastName ? `${contact.firstName} ${contact.lastName}`.trim() : "Max"}
                </span>
                <TagPill color="emerald">Привязан</TagPill>
                {metrics.isRepeatClient ? (
                  <TagPill color="emerald">Повторный клиент</TagPill>
                ) : (
                  <TagPill color="sky">Первичный клиент</TagPill>
                )}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[#666666]">
                {contact.phone && (
                  <a
                    href={`tel:${contact.phone}`}
                    className="flex items-center gap-1 font-mono text-[#111111] hover:text-[#4a38f5]"
                  >
                    <Phone className="h-3 w-3 text-[#888888]" />
                    {formatPhone(contact.phone)}
                  </a>
                )}
                {contact.email && (
                  <a
                    href={`mailto:${contact.email}`}
                    className="flex items-center gap-1 text-[#111111] hover:text-[#4a38f5]"
                  >
                    <Mail className="h-3 w-3 text-[#888888]" />
                    {contact.email}
                  </a>
                )}
                {contact.companyName && (
                  <div className="flex items-center gap-1 text-[#666666]">
                    <Building2 className="h-3 w-3 text-[#888888]" />
                    {contact.companyName}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Атрибуция и трекинг */}
        {(ymUid || clientId || utmSource || utmCampaign) && (
          <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-[#f0f0f0] pt-3 text-[11px]">
            <span className="font-medium text-[#888888]">Атрибуция:</span>
            {ymUid && (
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 font-mono text-[#444444]">
                ym_uid: {ymUid}
              </span>
            )}
            {clientId && (
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 font-mono text-[#444444]">
                client_id: {clientId}
              </span>
            )}
            {utmSource && (
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[#444444]">
                utm_source: {utmSource}
              </span>
            )}
            {utmCampaign && (
              <span className="rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 py-0.5 text-[#444444]">
                utm_campaign: {utmCampaign}
              </span>
            )}
          </div>
        )}
      </div>

      {/* 2. LTV Метрики контакта */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">LTV Клиента</span>
            <DollarSign className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[17px] font-semibold text-[#111111]">
            {formatCurrency(metrics.totalLtv)}
          </div>
          <div className="mt-1 text-[11px] text-[#666666]">
            Выручка от закрытых сделок
          </div>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Средний чек</span>
            <TrendingUp className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[17px] font-semibold text-[#111111]">
            {formatCurrency(metrics.avgCheck)}
          </div>
          <div className="mt-1 text-[11px] text-[#666666]">
            По всем обращениям
          </div>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Сделок в CRM</span>
            <Briefcase className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[17px] font-semibold text-[#111111]">
            {metrics.totalDeals}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[11px]">
            <span className="text-emerald-700">{metrics.wonDeals} выигр.</span>
            <span className="text-rose-600">{metrics.lostDeals} проигр.</span>
            <span className="text-[#666666]">{metrics.activeDeals} акт.</span>
          </div>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-[#666666]">Клиент с нами</span>
            <Calendar className="h-4 w-4 text-[#888888]" />
          </div>
          <div className="mt-1 font-mono text-[14px] font-medium text-[#111111]">
            {formatDate(contact.createdAt)}
          </div>
          <div className="mt-1 text-[11px] text-[#666666]">
            {timeAgo(contact.createdAt)}
          </div>
        </div>
      </div>

      {/* 3. Другие сделки этого контакта */}
      <div>
        <h3 className="mb-2.5 text-[13px] font-semibold text-[#111111]">
          Другие сделки и заказы клиента ({otherDeals.length})
        </h3>
        {otherDeals.length === 0 ? (
          <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-4 text-center text-[12px] text-[#666666]">
            У этого клиента пока нет других сделок.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
            <table className="w-full border-collapse text-left text-[12px]">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium text-[#666666]">
                  <th className="px-3.5 py-2">Сделка</th>
                  <th className="px-3 py-2">Этап</th>
                  <th className="px-3 py-2 text-right">Сумма</th>
                  <th className="px-3.5 py-2 text-right">Создана</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {otherDeals.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => router.push(`/crm/deals?record=${d.id}`)}
                    className="group cursor-pointer transition-colors hover:bg-black/[0.02]"
                  >
                    <td className="px-3.5 py-2.5 font-medium text-[#111111] group-hover:text-[#4a38f5]">
                      {d.title}
                    </td>
                    <td className="px-3 py-2.5">
                      <TagPill color={stageTagColor(d.stageColor)}>{d.stageName}</TagPill>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-medium text-[#111111]">
                      {formatCurrency(d.budget, d.currency)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right font-mono text-[11px] text-[#666666]">
                      {formatDate(d.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Сквозной таймлайн активности контакта */}
      <div>
        <h3 className="mb-2.5 text-[13px] font-semibold text-[#111111]">
          Сквозной таймлайн активности клиента ({timeline.length})
        </h3>
        <ContactActivityTimeline
          contactId={contact.id}
          dealId={dealId}
          initialItems={timeline}
        />
      </div>
    </div>
  );
}
