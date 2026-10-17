"use client";

import { useCallback, useMemo, useState } from "react";
import { notFound, useParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Gift, Plug, Plus, ShoppingBag } from "lucide-react";

import { Guard } from "@/components/shared/Guard";
import { EmptyState } from "@/components/shared/EmptyState";
import { ChannelAccountsTable } from "@/components/integrations/ChannelAccountsTable";
import { ConnectChannelModal } from "@/components/integrations/ConnectChannelModal";
import { ConnectTelegramModal } from "@/components/integrations/ConnectTelegramModal";
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
  const limitReached = summary !== undefined && summary.total >= summary.quantity;
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
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
            <Icon className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100">{entry.label}</h1>

              {summary?.trialActive === true ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  <Gift className="h-3 w-3" />
                  Бесплатно ещё {daysLeft} дн.
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  Активен
                </span>
              )}
            </div>

            <p className="mt-1 text-sm text-slate-400">
              {summary === undefined ? (
                "Подключённые аккаунты канала"
              ) : (
                <>
                  {summary.total} из {summary.quantity}{" "}
                  {pluralAccounts(summary.quantity)} по тарифу
                  {summary.connectedCount > 0 && (
                    <span className="text-slate-500"> · {summary.connectedCount} в сети</span>
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
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
          >
            <ShoppingBag className="h-4 w-4" />
            Увеличить количество
          </Link>
        ) : (
          <button
            type="button"
            onClick={openConnect}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" />
            Подключить аккаунт
          </button>
        )}
      </div>

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

      {/*
        Telegram подключается по коду из приложения (MTProto), остальные каналы —
        простой записью аккаунта: у них транспорт ещё не реализован, и мастер с
        кодом обещал бы работающее соединение, которого нет.
      */}
      {channel === "telegram" ? (
        <ConnectTelegramModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      ) : (
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
