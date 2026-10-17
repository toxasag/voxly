"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Bot,
  Check,
  Code2,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  MessageSquareText,
  Palette,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChannelAccountDTO, ChannelSummaryDTO } from "@/lib/api/use-channels";
import {
  useCreateChannelAccount,
  useDeleteChannelAccount,
  useUpdateChannelAccount,
} from "@/lib/api/use-channels";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import { WebchatAppearanceSettings } from "./WebchatAppearanceSettings";
import { EmptyState } from "@/components/shared/EmptyState";

interface WebchatManagementViewProps {
  accounts: ChannelAccountDTO[];
  summary?: ChannelSummaryDTO;
  isLoading: boolean;
  limitReached: boolean;
}

export function WebchatManagementView({
  accounts,
  summary,
  isLoading,
  limitReached,
}: WebchatManagementViewProps) {
  // Выбранный сайт для настройки внешнего вида
  const [editingAppearanceId, setEditingAppearanceId] = useState<string | null>(null);

  // Модалка кода для вставки на сайт
  const [codeModalAccount, setCodeModalAccount] = useState<ChannelAccountDTO | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Модалка добавления сайта
  const [addSiteOpen, setAddSiteOpen] = useState(false);
  const [newSiteLabel, setNewSiteLabel] = useState("");
  const [newSiteDomain, setNewSiteDomain] = useState("");
  const [newSiteAgentId, setNewSiteAgentId] = useState<string>("");

  const createAccount = useCreateChannelAccount("webchat");
  const updateAccount = useUpdateChannelAccount("webchat");
  const deleteAccount = useDeleteChannelAccount("webchat");

  const { data: agents = [] } = useAiAgents();

  const selectedAccountForAppearance = useMemo(
    () => accounts.find((a) => a.id === editingAppearanceId),
    [accounts, editingAppearanceId],
  );

  const handleCopyCode = (accountId: string) => {
    const snippet = `<!-- GetVoxly WebChat Widget -->\n<script\n  src="https://api.getvoxly.ru/widget.js"\n  data-account-id="${accountId}"\n  defer\n></script>`;
    navigator.clipboard.writeText(snippet);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2500);
  };

  const handleCreateSite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSiteLabel.trim() || !newSiteDomain.trim()) return;

    createAccount.mutate(
      {
        label: newSiteLabel.trim(),
        external_id: newSiteDomain.trim(),
        agent_id: newSiteAgentId ? newSiteAgentId : null,
      },
      {
        onSuccess: () => {
          setAddSiteOpen(false);
          setNewSiteLabel("");
          setNewSiteDomain("");
          setNewSiteAgentId("");
        },
      },
    );
  };

  // Если выбран сайт для настроек внешнего вида — рендерим экран настроек
  if (selectedAccountForAppearance) {
    return (
      <WebchatAppearanceSettings
        account={selectedAccountForAppearance}
        onBack={() => setEditingAppearanceId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Шапка раздела */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10">
            <MessageSquareText className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-slate-100">Онлайн-чат на сайт</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-400">
                1 сайт бесплатно в тарифе
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              {summary === undefined ? (
                "Управление сайтами и кодами виджета онлайн-чата"
              ) : (
                <>
                  {summary.total} из {summary.quantity} сайтов подключено по тарифу
                  <span className="text-slate-500">
                    {" "}
                    · Дополнительные сайты +500 ₽/мес за каждый
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {limitReached ? (
          <Link
            href="/marketplace"
            className="flex items-center gap-2 rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:border-slate-600 hover:bg-slate-800"
          >
            <ShoppingBag className="h-4 w-4" />
            Увеличить количество сайтов
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setAddSiteOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-amber-400"
          >
            <Plus className="h-4 w-4" />
            Добавить сайт
          </button>
        )}
      </div>

      {/* Список подключенных сайтов */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
          <div className="h-48 animate-pulse rounded-xl border border-slate-800 bg-slate-900" />
        </div>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Сайты пока не подключены"
          description="Добавьте ваш первый сайт, чтобы скопировать готовый код виджета и подключить AI-ассистента."
          action={
            <button
              type="button"
              onClick={() => setAddSiteOpen(true)}
              className="mt-4 flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400"
            >
              <Plus className="h-4 w-4" />
              Добавить первый сайт
            </button>
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {accounts.map((acc) => {
            const creds = (acc.credentials ?? {}) as Record<string, unknown>;
            const accent = typeof creds.accentColor === "string" ? creds.accentColor : "#F59E0B";

            return (
              <div
                key={acc.id}
                className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900 p-5 shadow-sm transition-all hover:border-slate-700"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-950 font-bold"
                        style={{ backgroundColor: accent }}
                      >
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-slate-100">{acc.label}</h3>
                        <p className="flex items-center gap-1.5 text-xs text-slate-400">
                          <span>{acc.externalId}</span>
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span className="text-emerald-400">Активен</span>
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Удалить сайт «${acc.label}» из CRM?`)) {
                          deleteAccount.mutate({ id: acc.id });
                        }
                      }}
                      className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-rose-400"
                      title="Удалить сайт"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Привязанный AI-агент */}
                  <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <Bot className="h-4 w-4 text-amber-400" />
                        <span>AI-ассистент:</span>
                      </div>

                      <select
                        value={acc.boundAgentId ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateAccount.mutate({
                            id: acc.id,
                            agent_id: val ? val : null,
                          });
                        }}
                        disabled={updateAccount.isPending}
                        className="rounded border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-slate-200 focus:border-amber-500 focus:outline-none"
                      >
                        <option value="">Не назначен (без AI)</option>
                        {agents.map((ag) => (
                          <option key={ag.id} value={ag.id}>
                            {ag.name} ({ag.model})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Действия карточки */}
                <div className="mt-5 flex items-center justify-between border-t border-slate-800/80 pt-4">
                  <button
                    type="button"
                    onClick={() => setCodeModalAccount(acc)}
                    className="flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300"
                  >
                    <Code2 className="h-4 w-4" />
                    Код для сайта
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingAppearanceId(acc.id)}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors hover:border-slate-600 hover:bg-slate-800"
                  >
                    <Palette className="h-3.5 w-3.5 text-amber-400" />
                    Настроить виджет
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Модалка: "+ Добавить сайт" */}
      {addSiteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h2 className="text-base font-bold text-slate-100">Добавить сайт</h2>
              <button
                type="button"
                onClick={() => setAddSiteOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-slate-400">Название сайта</label>
                <input
                  type="text"
                  required
                  value={newSiteLabel}
                  onChange={(e) => setNewSiteLabel(e.target.value)}
                  placeholder="Интернет-магазин"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400">Домен / адрес сайта</label>
                <input
                  type="text"
                  required
                  value={newSiteDomain}
                  onChange={(e) => setNewSiteDomain(e.target.value)}
                  placeholder="myshop.ru"
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400">
                  AI-ассистент для сайта (необязательно)
                </label>
                <select
                  value={newSiteAgentId}
                  onChange={(e) => setNewSiteAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-amber-500 focus:outline-none"
                >
                  <option value="">Не назначать (без автоответов)</option>
                  {agents.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name} ({ag.model})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setAddSiteOpen(false)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-300 hover:bg-slate-800"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createAccount.isPending}
                  className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50"
                >
                  {createAccount.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Добавить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Модалка: "Код для сайта" */}
      {codeModalAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-amber-400" />
                <h2 className="text-base font-bold text-slate-100">
                  Код виджета для «{codeModalAccount.label}»
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCodeModalAccount(null)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-400 leading-relaxed">
                Вставьте этот код на страницы вашего сайта перед закрывающим тегом{" "}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-400 font-mono">
                  &lt;/body&gt;
                </code>
                . Виджет загружается асинхронно и не замедляет сайт.
              </p>

              <div className="relative rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-xs text-slate-200">
                <pre className="overflow-x-auto whitespace-pre-wrap">
                  {`<!-- GetVoxly WebChat Widget -->\n<script\n  src="https://api.getvoxly.ru/widget.js"\n  data-account-id="${codeModalAccount.id}"\n  defer\n></script>`}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-slate-500">
                  ID подключения: {codeModalAccount.id}
                </span>

                <button
                  type="button"
                  onClick={() => handleCopyCode(codeModalAccount.id)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  {copiedCode ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Скопировано!
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Скопировать код
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
