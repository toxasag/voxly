"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BarChart3,
  Bot,
  Check,
  Code2,
  Copy,
  Globe,
  Loader2,
  MessageSquareText,
  Palette,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import type { ChannelAccountDTO, ChannelSummaryDTO } from "@/lib/api/use-channels";
import {
  useCreateChannelAccount,
  useDeleteChannelAccount,
  useUpdateChannelAccount,
} from "@/lib/api/use-channels";
import { useAiAgents } from "@/lib/api/use-ai-agents";
import { WebchatAppearanceSettings } from "./WebchatAppearanceSettings";
import { WebchatAnalyticsDrawer } from "./WebchatAnalyticsDrawer";
import { EmptyState } from "@/components/shared/EmptyState";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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

  // Выбранный сайт для просмотра воронки и аналитики
  const [analyticsAccount, setAnalyticsAccount] = useState<ChannelAccountDTO | null>(null);

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
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#4a38f5]/10">
            <MessageSquareText className="h-5 w-5 text-[#4a38f5]" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-[#111111]">Онлайн-чат на сайт</h1>
              {summary?.isUnlimited || summary?.is_unlimited ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-[#4a38f5]/30 bg-[#4a38f5]/10 px-2 py-0.5 text-xs font-medium text-[#4a38f5]">
                  Безлимитно
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
                  {summary ? `${summary.quantity} ${summary.quantity === 1 ? "сайт" : "сайтов"} по тарифу` : "1 сайт в тарифе"}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-[#666666]">
              {summary === undefined ? (
                "Управление сайтами и кодами виджета онлайн-чата"
              ) : summary.isUnlimited || summary.is_unlimited ? (
                <>
                  {summary.total} {summary.total === 1 ? "сайт подключен" : "сайтов подключено"} (Безлимитный тариф)
                </>
              ) : (
                <>
                  {summary.total} из {summary.quantity} сайтов подключено по тарифу
                  <span className="text-[#888888]">
                    {" "}
                    · Дополнительные сайты +500 ₽/мес за каждый
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {limitReached ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-[#888888]">Лимит исчерпан ({summary?.quantity})</span>
            <Link
              href="/marketplace"
              className="flex items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-4 py-2.5 text-sm font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
            >
              <ShoppingBag className="h-4 w-4" />
              Увеличить количество сайтов
            </Link>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAddSiteOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#3b2be0]"
          >
            <Plus className="h-4 w-4" />
            Добавить сайт
          </button>
        )}
      </div>

      {/* Подсказка о настройке внешнего вида и капсулы */}
      <div className="rounded-xl border border-[#4a38f5]/20 bg-[#4a38f5]/5 p-4 flex flex-wrap items-center justify-between gap-3 text-xs text-[#111111]">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#4a38f5] text-white">
            <Palette className="h-4 w-4" />
          </div>
          <div>
            <span className="font-semibold text-[#111111]">
              Оформление виджета: информативная капсула и фото консультанта
            </span>
            <p className="text-[#666666] mt-0.5">
              Включите отображение виджета в виде плашки «Имя + Онлайн» (как на скриншоте) в меню «Настроить виджет» нужного сайта.
            </p>
          </div>
        </div>
      </div>

      {/* Список подключенных сайтов */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="h-48 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
          <div className="h-48 animate-pulse rounded-xl border border-[#e5e5e5] bg-[#fafafa]" />
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
              className="mt-4 flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-sm font-semibold text-white hover:bg-[#3b2be0]"
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
            const accent = typeof creds.accentColor === "string" ? creds.accentColor : "#4a38f5";

            return (
              <div
                key={acc.id}
                className="flex flex-col justify-between rounded-xl border border-[#e5e5e5] bg-white p-5 shadow-2xs transition-all hover:border-[#cccccc]"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white font-bold"
                        style={{ backgroundColor: accent }}
                      >
                        <Globe className="h-5 w-5" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-[#111111]">{acc.label}</h3>
                        <p className="flex items-center gap-1.5 text-xs text-[#666666]">
                          <span>{acc.externalId}</span>
                          <span
                            className={cn(
                              "inline-block h-1.5 w-1.5 rounded-full",
                              acc.status === "disabled" ? "bg-slate-400" : "bg-emerald-500",
                            )}
                          />
                          <span
                            className={cn(
                              "font-medium",
                              acc.status === "disabled" ? "text-[#888888]" : "text-emerald-700",
                            )}
                          >
                            {acc.status === "disabled" ? "Отключен" : "Активен"}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center"
                        title={
                          acc.status === "disabled"
                            ? "Виджет отключен и не отображается на сайте"
                            : "Виджет активен и отображается на сайте"
                        }
                      >
                        <Switch
                          checked={acc.status !== "disabled"}
                          disabled={updateAccount.isPending}
                          onCheckedChange={(checked) => {
                            const newStatus = checked ? "connected" : "disabled";
                            updateAccount.mutate(
                              { id: acc.id, status: newStatus, is_enabled: checked },
                              {
                                onSuccess: () => {
                                  toast.success(
                                    checked
                                      ? `Виджет «${acc.label}» включен`
                                      : `Виджет «${acc.label}» отключен`,
                                  );
                                },
                                onError: () => {
                                  toast.error("Не удалось изменить статус виджета");
                                },
                              },
                            );
                          }}
                          aria-label={
                            acc.status === "disabled"
                              ? `Включить виджет: ${acc.label}`
                              : `Отключить виджет: ${acc.label}`
                          }
                        />
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Удалить сайт «${acc.label}» из CRM?`)) {
                            deleteAccount.mutate({ id: acc.id });
                          }
                        }}
                        className="rounded-lg p-1.5 text-[#666666] transition-colors hover:bg-[#f5f5f5] hover:text-rose-600"
                        title="Удалить сайт"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {/* Привязанный AI-агент */}
                  <div className="mt-4 rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-[#666666]">
                        <Bot className="h-4 w-4 text-[#4a38f5]" />
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
                        className="rounded border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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

                  {/* Стиль кнопки виджета на сайте */}
                  <div className="mt-3 flex items-center justify-between text-xs text-[#666666] border-t border-[#f0f0f0] pt-2.5">
                    <span>Стиль кнопки:</span>
                    {creds.launcherStyle === "pill" ? (
                      <span className="inline-flex items-center gap-1 font-medium text-[#4a38f5] bg-[#4a38f5]/10 px-2 py-0.5 rounded-full text-[11px]">
                        Капсула ({String(creds.consultantName || "Консультант")}, {String(creds.statusText || "Онлайн")})
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-medium text-[#666666] bg-[#f0f0f0] px-2 py-0.5 rounded-full text-[11px]">
                        Круглая кнопка
                      </span>
                    )}
                  </div>
                </div>

                {/* Действия карточки */}
                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-[#e5e5e5] pt-4">
                  <button
                    type="button"
                    onClick={() => setCodeModalAccount(acc)}
                    className="flex items-center gap-1.5 text-xs font-medium text-[#4a38f5] hover:text-[#3b2be0]"
                  >
                    <Code2 className="h-4 w-4" />
                    Код для сайта
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAnalyticsAccount(acc)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
                      title="Воронка и конверсии виджета"
                    >
                      <BarChart3 className="h-3.5 w-3.5 text-[#4a38f5]" />
                      Воронка
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingAppearanceId(acc.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
                    >
                      <Palette className="h-3.5 w-3.5 text-[#4a38f5]" />
                      Настроить
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Модалка: "+ Добавить сайт" */}
      {addSiteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#e5e5e5]">
              <h2 className="text-base font-bold text-[#111111]">Добавить сайт</h2>
              <button
                type="button"
                onClick={() => setAddSiteOpen(false)}
                className="rounded-lg p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSite} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-medium text-[#666666]">Название сайта</label>
                <input
                  type="text"
                  required
                  value={newSiteLabel}
                  onChange={(e) => setNewSiteLabel(e.target.value)}
                  placeholder="Интернет-магазин"
                  className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#666666]">Домен / адрес сайта</label>
                <input
                  type="text"
                  required
                  value={newSiteDomain}
                  onChange={(e) => setNewSiteDomain(e.target.value)}
                  placeholder="myshop.ru"
                  className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-[#666666]">
                  AI-ассистент для сайта (необязательно)
                </label>
                <select
                  value={newSiteAgentId}
                  onChange={(e) => setNewSiteAgentId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm text-[#111111] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
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
                  className="rounded-lg border border-[#e5e5e5] bg-white px-4 py-2 text-xs font-medium text-[#111111] hover:bg-[#fafafa]"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  disabled={createAccount.isPending}
                  className="flex items-center gap-2 rounded-lg bg-[#4a38f5] px-4 py-2 text-xs font-semibold text-white hover:bg-[#3b2be0] disabled:opacity-50"
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-[#e5e5e5] bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-[#e5e5e5]">
              <div className="flex items-center gap-2">
                <Code2 className="h-5 w-5 text-[#4a38f5]" />
                <h2 className="text-base font-bold text-[#111111]">
                  Код виджета для «{codeModalAccount.label}»
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setCodeModalAccount(null)}
                className="rounded-lg p-1 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-xs text-[#666666] leading-relaxed">
                Вставьте этот код на страницы вашего сайта перед закрывающим тегом{" "}
                <code className="rounded bg-[#f0f0f0] px-1.5 py-0.5 text-[#111111] font-mono">
                  &lt;/body&gt;
                </code>
                . Виджет загружается асинхронно и не замедляет сайт.
              </p>

              <div className="relative rounded-lg border border-[#e5e5e5] bg-[#fafafa] p-3 font-mono text-xs text-[#111111]">
                <pre className="overflow-x-auto whitespace-pre-wrap">
                  {`<!-- GetVoxly WebChat Widget -->\n<script\n  src="https://api.getvoxly.ru/widget.js"\n  data-account-id="${codeModalAccount.id}"\n  defer\n></script>`}
                </pre>
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-[#888888]">
                  ID подключения: {codeModalAccount.id}
                </span>

                <button
                  type="button"
                  onClick={() => handleCopyCode(codeModalAccount.id)}
                  className="flex items-center gap-1.5 rounded-lg bg-[#4a38f5] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#3b2be0]"
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

      {/* Шторка воронки конверсий и аналитики виджета */}
      <WebchatAnalyticsDrawer
        account={analyticsAccount}
        open={Boolean(analyticsAccount)}
        onClose={() => setAnalyticsAccount(null)}
      />
    </div>
  );
}
