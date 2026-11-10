"use client";

import { useCallback, useMemo, useState } from "react";
import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Gift, Plug, Plus, ShoppingBag } from "lucide-react";

import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ChannelAccountsTable } from "@/components/integrations/ChannelAccountsTable";
import { ChannelAccountLinksCard } from "@/components/integrations/ChannelAccountLinksCard";
import { ConnectChannelModal } from "@/components/integrations/ConnectChannelModal";
import { ConnectTelegramModal } from "@/components/integrations/ConnectTelegramModal";
import { ConnectWhatsappModal } from "@/components/integrations/ConnectWhatsappModal";
import { ConnectMaxModal } from "@/components/integrations/ConnectMaxModal";
import { channelEntry } from "@/lib/modules/registry";
import { pluralAccounts, useChannelAccounts } from "@/lib/api/use-channels";
import { trialDaysLeft } from "@/lib/api/use-marketplace";
import { WebchatManagementView } from "@/components/integrations/WebchatManagementView";
import { isChannelSlug, type ChannelSlug } from "@/types";

// ---------------------------------------------------------------------------
// Страница канала связи.
//
// Один динамический маршрут на пять каналов, а не пять почти одинаковых страниц:
// различаются только название, иконка и подсказка идентификатора, а они уже
// лежат в реестре модулей. Пять копий разошлись бы при первой правке.
// ---------------------------------------------------------------------------

function ChannelPageContent({ channel }: { channel: ChannelSlug }) {
  const entry = channelEntry(channel);
  const { data, isLoading, isError, error, refetch } = useChannelAccounts(channel);
  const [connectOpen, setConnectOpen] = useState(false);

  const summary = data?.summary;
  const accounts = useMemo(() => data?.items ?? [], [data]);

  // Лимит считается по оплаченному количеству: кнопка не должна предлагать
  // действие, которое сервер отклонит с 409 CHANNEL_LIMIT_REACHED.
  const isUnlimited = Boolean(summary?.isUnlimited || summary?.is_unlimited);
  const limitReached = summary !== undefined && !isUnlimited && summary.total >= summary.quantity;
  const daysLeft = trialDaysLeft(summary?.trialEndsAt ?? null);

  const openConnect = useCallback(() => setConnectOpen(true), []);
  const Icon = entry.icon;

  if (channel === "webchat") {
    return (
      <WebchatManagementView
        accounts={accounts}
        summary={summary}
        isLoading={isLoading}
        limitReached={limitReached}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#4a38f5]/10">
            <Icon className="h-5 w-5 text-[#4a38f5]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[#111111]">{entry.label}</h1>

              {summary?.trialActive === true ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <Gift className="h-3 w-3" />
                  Бесплатно ещё {daysLeft} дн.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  <CheckCircle2 className="h-3 w-3" />
                  Включено в тариф
                </span>
              )}
            </div>

            <p className="mt-1 text-[13px] text-[#666666]">
              {summary === undefined ? (
                "Подключённые аккаунты канала"
              ) : (
                <>
                  {summary.total} из {summary.quantity}{" "}
                  {pluralAccounts(summary.quantity)} по тарифу
                  {summary.connectedCount > 0 && (
                    <span className="text-[#888888]"> · {summary.connectedCount} в сети</span>
                  )}
                </>
              )}
            </p>
          </div>
        </div>

        {/*
          Кнопка скрывается при исчерпанном лимите, а не блокируется: неактивная
          кнопка без объяснения выглядит поломкой. Вместо неё — ссылка туда, где
          количество увеличивается.
        */}
        {limitReached ? (
          <Link
            href="/marketplace"
            className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 py-2 text-[13px] font-medium text-[#111111] shadow-2xs transition-colors hover:bg-[#fafafa]"
          >
            <ShoppingBag className="h-4 w-4 text-[#666666]" />
            Увеличить количество
          </Link>
        ) : (
          <button
            type="button"
            onClick={openConnect}
            className="flex items-center gap-2 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-[13px] font-medium text-white shadow-2xs transition-colors hover:bg-[#3d2ee0]"
          >
            <Plus className="h-4 w-4" />
            Подключить аккаунт
          </button>
        )}
      </div>

      <ChannelAccountLinksCard
        channel={channel}
        accounts={accounts}
        onConnect={limitReached ? undefined : openConnect}
      />

      <ChannelAccountsTable
        channel={channel}
        channelName={entry.label}
        accounts={accounts}
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={() => void refetch()}
        onConnect={openConnect}
        limitReached={limitReached}
      />

      {channel === "telegram" && (
        <ConnectTelegramModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      )}
      {channel === "whatsapp" && (
        <ConnectWhatsappModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      )}
      {channel === "max" && (
        <ConnectMaxModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      )}
      {channel !== "telegram" && channel !== "whatsapp" && channel !== "max" && (
        <ConnectChannelModal
          open={connectOpen}
          channel={channel}
          channelName={entry.label}
          onClose={() => setConnectOpen(false)}
        />
      )}
    </div>
  );
}

export default function ChannelPage() {
  const params = useParams<{ channel: string }>();
  const raw = params.channel;

  // Неизвестный слаг — 404, а не заглушка «нет доступа»: `/integrations/vk` это
  // несуществующий раздел, а не закрытый.
  if (typeof raw !== "string" || !isChannelSlug(raw)) notFound();

  return (
    <Guard
      requiredPermission="tenant:admin"
      requiredModule={raw}
      fallback={
        <EmptyState
          icon={Plug}
          title="Нет доступа к каналам связи"
          description="Раздел доступен владельцу и администраторам компании."
        />
      }
    >
      <ChannelPageContent channel={raw} />
    </Guard>
  );
}
