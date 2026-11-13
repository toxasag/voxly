"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Globe,
  Inbox,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Workflow,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { TagPill } from "@/components/ui/tag";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "sonner";
import {
  type SiteIntegrationDTO,
  useDeleteSiteIntegration,
  useSiteIntegrations,
  useToggleSiteActive,
} from "@/lib/api/use-site-integrations";
import { SiteDrawer } from "./SiteDrawer";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string | null): string {
  if (!iso) return "Нет заявок";
  const date = new Date(iso);
  if (isNaN(date.getTime())) return "Нет заявок";

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SiteIntegrationsView() {
  const { data: sites = [], isLoading, isError, refetch } = useSiteIntegrations();
  const deleteMutation = useDeleteSiteIntegration();
  const toggleMutation = useToggleSiteActive();

  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Состояние Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedSite, setSelectedSite] = useState<SiteIntegrationDTO | null>(null);
  const [drawerMode, setDrawerMode] = useState<"create" | "edit" | "guide">("create");

  const filteredSites = useMemo(() => {
    if (!searchQuery.trim()) return sites;
    const q = searchQuery.toLowerCase();
    return sites.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.site_url && s.site_url.toLowerCase().includes(q)) ||
        (s.target_pipeline_name && s.target_pipeline_name.toLowerCase().includes(q)),
    );
  }, [sites, searchQuery]);

  const stats = useMemo(() => {
    const total = sites.length;
    const active = sites.filter((s) => s.is_active).length;
    const totalLeads = sites.reduce((sum, s) => sum + s.leads_count, 0);
    return { total, active, totalLeads };
  }, [sites]);

  const handleOpenCreate = () => {
    setSelectedSite(null);
    setDrawerMode("create");
    setDrawerOpen(true);
  };

  const handleOpenEdit = (site: SiteIntegrationDTO) => {
    setSelectedSite(site);
    setDrawerMode("edit");
    setDrawerOpen(true);
  };

  const handleOpenGuide = (site: SiteIntegrationDTO) => {
    setSelectedSite(site);
    setDrawerMode("guide");
    setDrawerOpen(true);
  };

  const handleCopyUrl = (site: SiteIntegrationDTO) => {
    navigator.clipboard.writeText(site.webhook_url);
    setCopiedId(site.id);
    toast.success("Webhook URL скопирован в буфер обмена");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleToggleActive = (site: SiteIntegrationDTO) => {
    toggleMutation.mutate(
      { id: site.id, is_active: !site.is_active },
      {
        onSuccess: (updated) => {
          toast.success(
            updated.is_active
              ? `Сайт «${updated.name}» включен`
              : `Сайт «${updated.name}» приостановлен`,
          );
        },
        onError: () => {
          toast.error("Не удалось изменить статус сайта");
        },
      },
    );
  };

  const handleDelete = (site: SiteIntegrationDTO) => {
    if (!confirm(`Удалить подключение сайта «${site.name}»? Все ранее созданные сделки останутся в CRM.`)) {
      return;
    }

    deleteMutation.mutate(
      { id: site.id },
      {
        onSuccess: () => {
          toast.success(`Сайт «${site.name}» удалён`);
        },
        onError: () => {
          toast.error("Не удалось удалить сайт");
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      {/* ШАПКА РАЗДЕЛА */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <Globe className="h-4.5 w-4.5" />
            </div>
            <h1 className="text-[18px] font-semibold tracking-tight text-[#111111]">
              Сайты
            </h1>
            <span className="rounded-full bg-[#f0f0f0] px-2 py-0.5 text-[11px] font-medium text-[#666666]">
              {sites.length}
            </span>
          </div>
          <p className="text-[13px] text-[#666666]">
            Приём заявок с внешних сайтов (Tilda, WordPress, Webflow, кастомные формы) прямо в воронку сделок CRM
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleOpenCreate}
            className="h-8 gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] flex items-center"
          >
            <Plus className="h-4 w-4" />
            Добавить сайт
          </button>
        </div>
      </div>

      {/* МЕТРИКИ */}
      {sites.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
              Всего сайтов
            </span>
            <div className="mt-1 text-[20px] font-semibold text-[#111111] tabular-nums">
              {stats.total}
            </div>
          </div>
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
              Активно принимают лиды
            </span>
            <div className="mt-1 text-[20px] font-semibold text-emerald-600 tabular-nums">
              {stats.active}
            </div>
          </div>
          <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
            <span className="text-[11px] font-medium uppercase tracking-wider text-[#888888]">
              Всего принято заявок
            </span>
            <div className="mt-1 text-[20px] font-semibold text-[#4a38f5] tabular-nums">
              {stats.totalLeads}
            </div>
          </div>
        </div>
      )}

      {/* ПОИСК И СПИСОК */}
      {isLoading ? (
        <div className="flex h-48 items-center justify-center rounded-[8px] border border-[#e5e5e5] bg-white">
          <Loader2 className="h-6 w-6 animate-spin text-[#4a38f5]" />
        </div>
      ) : sites.length === 0 ? (
        <EmptyState
          icon={Globe}
          title="Сайты ещё не подключены"
          description="Подключите Tilda, WordPress, Webflow или любую HTML-форму через персональный Webhook URL. Заявки с форм будут мгновенно попадать в воронку сделок CRM с автодедупликацией контактов."
          action={
            <button
              type="button"
              onClick={handleOpenCreate}
              className="h-8 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0]"
            >
              Подключить сайт
            </button>
          }
        />
      ) : (
        <div className="space-y-3">
          {/* Панель поиска */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
              <input
                type="text"
                placeholder="Поиск по сайтам и воронкам..."
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
                className="w-full h-8 rounded-[8px] pl-8 pr-3 text-[12px] border border-[#e5e5e5] bg-white text-[#111111] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>
          </div>

          {/* Карточки сайтов */}
          <div className="grid grid-cols-1 gap-3">
            {filteredSites.map((site) => (
              <div
                key={site.id}
                className={cn(
                  "rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs transition-colors hover:border-[#cccccc]",
                  !site.is_active && "opacity-75 bg-[#fafafa]",
                )}
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  {/* Левая колонка: Название, статус, URL сайта */}
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-[#4a38f5]/10 text-[#4a38f5]">
                        <Globe className="h-3.5 w-3.5" />
                      </div>
                      <h3 className="text-[14px] font-semibold text-[#111111] truncate">
                        {site.name}
                      </h3>
                      {site.is_active ? (
                        <TagPill color="emerald">Активен</TagPill>
                      ) : (
                        <TagPill color="slate">Приостановлен</TagPill>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-[12px] text-[#666666] flex-wrap">
                      {site.site_url ? (
                        <a
                          href={site.site_url.startsWith("http") ? site.site_url : `https://${site.site_url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-[#4a38f5] hover:underline truncate"
                        >
                          {site.site_url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      ) : (
                        <span className="text-[#888888]">Адрес сайта не указан</span>
                      )}

                      <span className="text-[#e5e5e5]">•</span>

                      <span className="flex items-center gap-1 text-[#555555]">
                        <Workflow className="h-3.5 w-3.5 text-[#888888]" />
                        {site.target_pipeline_name || "Воронка по умолчанию"}
                        {site.target_stage_name && (
                          <span className="text-[#888888]">→ {site.target_stage_name}</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Правая колонка: переключатель активности и действия */}
                  <div className="flex items-center gap-2 self-start md:self-center shrink-0">
                    <div className="flex items-center gap-2 mr-2">
                      <span className="text-[11px] text-[#666666]">
                        {site.is_active ? "Вкл" : "Выкл"}
                      </span>
                      <Switch
                        checked={site.is_active}
                        onCheckedChange={() => handleToggleActive(site)}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => handleOpenGuide(site)}
                      className="h-7 gap-1 rounded-[6px] text-[12px] border border-[#e5e5e5] bg-white text-[#333333] hover:bg-[#f5f5f5] px-2.5 flex items-center font-medium transition-colors"
                    >
                      <BookOpen className="h-3.5 w-3.5 text-[#4a38f5]" />
                      Инструкция Tilda
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenEdit(site)}
                      className="h-7 w-7 rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] flex items-center justify-center transition-colors"
                      title="Настройки воронки"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(site)}
                      className="h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-100 hover:text-rose-700 flex items-center justify-center transition-colors"
                      title="Удалить интеграцию"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Полоса с Webhook URL и статистикой */}
                <div className="mt-3.5 pt-3 border-t border-[#f0f0f0] flex flex-col md:flex-row md:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2 flex-1 max-w-2xl">
                    <span className="text-[11px] font-medium text-[#666666] shrink-0">
                      Webhook:
                    </span>
                    <input
                      type="text"
                      readOnly
                      value={site.webhook_url}
                      className="h-6.5 w-full rounded-[4px] border border-[#e5e5e5] bg-[#fafafa] px-2 font-mono text-[11px] text-[#333333] select-all truncate focus:outline-none"
                      onClick={(e: React.MouseEvent<HTMLInputElement>) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyUrl(site)}
                      className="h-6.5 gap-1 rounded-[4px] px-2 text-[11px] font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 shrink-0 flex items-center transition-colors"
                    >
                      {copiedId === site.id ? (
                        <>
                          <Check className="h-3 w-3" />
                          Скопировано
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          Копировать
                        </>
                      )}
                    </button>
                  </div>

                  <div className="flex items-center gap-4 text-[11px] text-[#666666] shrink-0">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Inbox className="h-3.5 w-3.5 text-[#888888]" />
                      Получено заявок: <strong className="text-[#111111]">{site.leads_count}</strong>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-[#888888]" />
                      Последняя: <span className="text-[#111111]">{formatDateTime(site.last_lead_at)}</span>
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Боковая шторка добавления / редактирования / инструкции */}
      <SiteDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        site={selectedSite}
        mode={drawerMode}
        onSwitchMode={(mode) => setDrawerMode(mode)}
      />
    </div>
  );
}
