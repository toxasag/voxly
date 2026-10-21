"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  FileText,
  Heart,
  Home,
  Linkedin,
  Loader2,
  Mail,
  Maximize2,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCreateContact } from "@/lib/api/use-contacts";
import { useCompanies } from "@/lib/api/use-companies";
import { useTenantUsers } from "@/lib/api/use-tenant-users";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { cn } from "@/lib/utils";

import type { DealDTO } from "@/lib/api/use-deals";

export interface DrawerCreateContactProps {
  dealId?: string;
  dealTitle?: string;
  deal?: DealDTO;
  onSuccess?: (contactId: string, contactName: string) => void;
  onCreated?: (contact: { id: string; name: string }) => void;
  onBack: () => void;
  onClose: () => void;
  onExpand?: () => void;
  showHeader?: boolean;
}

function FieldRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 min-h-[30px]">
      <span className="flex w-[120px] shrink-0 items-center gap-2 text-xs text-[#666666]">
        <Icon className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
        <span className="truncate">{label}</span>
      </span>
      <span className="min-w-0 flex-1 text-[13px] text-[#111111]">{children}</span>
    </div>
  );
}

export function DrawerCreateContact({
  dealId: _dealId,
  dealTitle: rawDealTitle,
  deal,
  onSuccess,
  onCreated,
  onBack,
  onClose,
  onExpand,
  showHeader = true,
}: DrawerCreateContactProps) {
  const effectiveDealTitle = rawDealTitle ?? deal?.title ?? "";
  const [tab, setTab] = useState("home");
  const [name, setName] = useState("");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState(deal?.companyName ?? "");
  const [companyId, setCompanyId] = useState(deal?.companyId ?? "");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [isFavorite, setIsFavorite] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Group collapses
  const [generalOpen, setGeneralOpen] = useState(true);
  const [workOpen, setWorkOpen] = useState(true);
  const [socialOpen, setSocialOpen] = useState(true);
  const [systemOpen, setSystemOpen] = useState(false);

  // Company picker
  const [companyPickerOpen, setCompanyPickerOpen] = useState(false);

  const tenantUsers = useTenantUsers();
  const companies = useCompanies({ limit: 50 });
  const createContact = useCreateContact();

  const currentUserName = useMemo(() => {
    const list = tenantUsers.data ?? [];
    return list[0]?.fullName ?? "Tvbox2026 оло";
  }, [tenantUsers.data]);

  const displayTitle = name.trim() || "Без названия";

  const handleSave = () => {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "Новый контакт";
    const lastName = parts.slice(1).join(" ") || "";

    createContact.mutate(
      {
        first_name: firstName,
        last_name: lastName,
        email: email.trim() || undefined,
        phones: phone.trim() ? [{ number: phone.trim(), calling_code: "+7", country_code: "RU" }] : undefined,
        company_name: companyName.trim() || undefined,
        company_id: companyId || undefined,
        job_title: jobTitle.trim() || undefined,
        channel: "phone",
        linkedin_link: linkedin.trim() || undefined,
      },
      {
        onSuccess: (created) => {
          const fullName = [created.firstName, created.lastName].filter(Boolean).join(" ");
          toast.success("Контакт создан");
          onSuccess?.(created.id, fullName);
          onCreated?.({ id: created.id, name: fullName });
        },
        onError: (err) => {
          toast.error(err.message || "Ошибка при создании контакта");
        },
      },
    );
  };

  return (
    <div className="flex h-full flex-col bg-white text-[#111111]">
      {/* Шапка карточки по Скриншоту 3 и 4 */}
      {showHeader && (
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-white shrink-0">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {/* Кнопка-стрелка Влево по Скриншоту 4 */}
            <button
              type="button"
              onClick={onBack}
              title="Назад"
              aria-label="Назад"
              className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>

            {/* Иконка-бейдж [-] */}
            <span
              aria-hidden="true"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] bg-[#f5f5f5] border border-[#e5e5e5] text-[10px] font-bold text-[#888888] shadow-2xs select-none"
            >
              -
            </span>

            {/* Заголовок «Без названия» */}
            {isEditingTitle ? (
              <input
                type="text"
                value={name}
                placeholder="Без названия"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === "Escape") {
                    setIsEditingTitle(false);
                  }
                }}
                onBlur={() => setIsEditingTitle(false)}
                className="rounded-[4px] border border-[#3b82f6] px-1.5 py-0.5 text-sm font-semibold text-[#111111] outline-none bg-white min-w-0 w-full"
                autoFocus
              />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0 group/title">
                <h2
                  onClick={() => setIsEditingTitle(true)}
                  title="Нажмите для редактирования названия"
                  className="truncate text-sm font-semibold text-[#111111] cursor-pointer hover:underline"
                >
                  {displayTitle}
                </h2>
                <button
                  type="button"
                  onClick={() => setIsEditingTitle(true)}
                  title="Редактировать название"
                  aria-label="Редактировать название"
                  className="text-[#999999] opacity-0 group-hover/title:opacity-100 hover:text-[#111111] transition-opacity cursor-pointer"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0 ml-3">
            {/* Кнопка «Развернуть» по Скриншоту 5 */}
            <button
              type="button"
              onClick={onExpand}
              title="Развернуть"
              aria-label="Развернуть"
              className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <Maximize2 className="h-4 w-4" />
            </button>
            {/* Кнопка закрытия */}
            <button
              type="button"
              onClick={onClose}
              title="Закрыть"
              aria-label="Закрыть"
              className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Вкладки: Главная, Временная шкала, Задачи, Заметки, +3 Ещё */}
      <div className="flex items-center px-4 bg-white border-b border-[#e5e5e5] gap-1 shrink-0 overflow-x-auto">
        <button
          type="button"
          onClick={() => setTab("home")}
          title="Главная"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            tab === "home"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <Home className="h-3.5 w-3.5 shrink-0" />
          <span>Главная</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("timeline")}
          title="Временная шкала"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            tab === "timeline"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Временная шкала</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("tasks")}
          title="Задачи"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            tab === "tasks"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <CheckSquare className="h-3.5 w-3.5 shrink-0" />
          <span>Задачи</span>
        </button>
        <button
          type="button"
          onClick={() => setTab("notes")}
          title="Заметки"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            tab === "notes"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span>Заметки</span>
        </button>
        <button
          type="button"
          title="Дополнительные вкладки"
          className="flex items-center gap-1 px-2.5 py-2 text-xs font-medium text-[#888888] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
        >
          <span>+3 Ещё</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {/* Тело карточки по Скриншоту 3 */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-1">
          <span className="text-xs font-semibold text-[#111111]">Поля</span>
        </div>

        {/* Группа 1: Общее */}
        <div>
          <button
            type="button"
            onClick={() => setGeneralOpen((v) => !v)}
            title="Свернуть / Развернуть группу"
            className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <span>Общее</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !generalOpen && "rotate-180")} />
          </button>
          {generalOpen && (
            <div className="space-y-0.5 py-0.5">
              <FieldRow icon={Mail} label="Электронные...">
                <input
                  type="email"
                  placeholder="Электронные письма"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                />
              </FieldRow>
              <FieldRow icon={Phone} label="Телефоны">
                <input
                  type="tel"
                  placeholder="Телефоны"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                />
              </FieldRow>
            </div>
          )}
        </div>

        {/* Группа 2: Социальные сети */}
        <div>
          <button
            type="button"
            onClick={() => setSocialOpen((v) => !v)}
            title="Свернуть / Развернуть группу"
            className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <span>Социальные сети</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !socialOpen && "rotate-180")} />
          </button>
          {socialOpen && (
            <div className="space-y-0.5 py-0.5">
              <FieldRow icon={Linkedin} label="LinkedIn">
                <input
                  type="text"
                  placeholder="LinkedIn"
                  value={linkedin}
                  onChange={(e) => setLinkedin(e.target.value)}
                  className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                />
              </FieldRow>
            </div>
          )}
        </div>

        {/* Группа 3: Работа */}
        <div>
          <button
            type="button"
            onClick={() => setWorkOpen((v) => !v)}
            title="Свернуть / Развернуть группу"
            className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <span>Работа</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !workOpen && "rotate-180")} />
          </button>
          {workOpen && (
            <div className="space-y-0.5 py-0.5">
              <FieldRow icon={Building2} label="Компания">
                <div className="relative inline-block w-full">
                  <button
                    type="button"
                    onClick={() => setCompanyPickerOpen((v) => !v)}
                    title="Нажмите для выбора компании"
                    className="inline-flex items-center gap-1.5 text-xs text-[#111111] hover:text-[#3b82f6] transition-colors cursor-pointer"
                  >
                    {companyName ? (
                      <span>{companyName}</span>
                    ) : (
                      <span className="text-[#888888]">Компания</span>
                    )}
                  </button>
                  {companyPickerOpen && (
                    <>
                      <div className="fixed inset-0 z-30 cursor-default" onClick={() => setCompanyPickerOpen(false)} />
                      <div className="absolute left-0 top-full z-40 mt-1 w-56 rounded-[8px] border border-[#e5e5e5] bg-white p-1.5 shadow-xl">
                        {(companies.data?.items ?? []).map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setCompanyName(c.name);
                              setCompanyId(c.id);
                              setCompanyPickerOpen(false);
                            }}
                            className="flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs hover:bg-[#f5f5f5] text-left cursor-pointer"
                          >
                            <Building2 className="h-3.5 w-3.5 text-[#888888]" />
                            <span className="truncate">{c.name}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </FieldRow>
              <FieldRow icon={Briefcase} label="Должность">
                <input
                  type="text"
                  placeholder="Должность"
                  value={jobTitle}
                  onChange={(e) => setJobTitle(e.target.value)}
                  className="w-full bg-transparent text-xs text-[#111111] placeholder:text-[#888888] outline-none"
                />
              </FieldRow>
            </div>
          )}
        </div>

        {/* Группа 4: Система */}
        <div>
          <button
            type="button"
            onClick={() => setSystemOpen((v) => !v)}
            title="Свернуть / Развернуть группу"
            className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <span>Система</span>
            <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !systemOpen && "rotate-180")} />
          </button>
          {systemOpen && (
            <div className="space-y-0.5 py-0.5">
              <FieldRow icon={Calendar} label="Дата создания">
                <span className="text-[#111111]">меньше минуты назад</span>
              </FieldRow>
              <FieldRow icon={RotateCcw} label="Создано">
                <span className="inline-flex items-center gap-1.5 text-[#111111]">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-[10px] font-bold text-rose-600">
                    {currentUserName.charAt(0).toUpperCase()}
                  </span>
                  <span>{currentUserName}</span>
                </span>
              </FieldRow>
            </div>
          )}
        </div>

        {/* Секция «Компания» по Скриншоту 3 */}
        <div className="border-t border-[#e5e5e5] mt-4 pt-3 px-4">
          <div className="flex items-center justify-between pb-2">
            <span className="text-sm font-semibold text-[#111111]">Компания</span>
            <button
              type="button"
              title="Редактировать компанию"
              aria-label="Редактировать компанию"
              onClick={() => setCompanyPickerOpen(true)}
              className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
          {companyName && (
            <div className="pt-1">
              <EntityChip name={companyName} label={companyName} size="sm" icon={Building2} />
            </div>
          )}
        </div>

        {/* Секция «Возможности» по Скриншоту 3 */}
        <div className="border-t border-[#e5e5e5] mt-2 pt-3 px-4">
          <div className="flex items-center justify-between pb-2">
            <span className="text-sm font-semibold text-[#111111]">Возможности</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                title="Открыть сделку"
                aria-label="Открыть сделку"
                onClick={onBack}
                className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                title="Редактировать связь"
                aria-label="Редактировать связь"
                className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {effectiveDealTitle && (
            <div className="pt-1">
              <EntityChip name={effectiveDealTitle} label={effectiveDealTitle} size="sm" singleLetter />
            </div>
          )}
        </div>

        {/* Секция «Списки» по Скриншоту 3 */}
        <div className="border-t border-[#e5e5e5] mt-2 pt-3 px-4 pb-6">
          <div className="flex items-center justify-between pb-2">
            <span className="text-sm font-semibold text-[#111111]">Списки</span>
            <button
              type="button"
              title="Добавить в список"
              aria-label="Добавить в список"
              className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Нижняя панель действий (Twenty CRM drawer footer) */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-[#e5e5e5] bg-white px-4 py-2.5 shrink-0">
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            title="Больше действий"
            aria-label="Больше действий"
            onClick={() => setMoreMenuOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-30 cursor-default" onClick={() => setMoreMenuOpen(false)} />
              <div className="absolute bottom-full left-0 z-40 mb-1 w-44 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-xl">
                <button
                  type="button"
                  onClick={() => {
                    setMoreMenuOpen(false);
                    onBack();
                  }}
                  className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#666666] hover:bg-[#f5f5f5] transition-colors text-left cursor-pointer"
                >
                  <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                  <span>Отменить создание</span>
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            title="В избранное"
            aria-label="В избранное"
            onClick={() => {
              setIsFavorite((v) => !v);
              toast.success(!isFavorite ? "Добавлено в избранное" : "Удалено из избранного");
            }}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] transition-colors cursor-pointer",
              isFavorite
                ? "border-rose-300 bg-rose-50 text-rose-500 hover:bg-rose-100"
                : "text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111]",
            )}
          >
            <Heart className={cn("h-3.5 w-3.5", isFavorite && "fill-rose-500")} />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            title="Отправить письмо"
            aria-label="Отправить письмо"
            onClick={() => toast.info("Функция отправки письма")}
            className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#f5f5f5] transition-colors cursor-pointer"
          >
            <Mail className="h-3.5 w-3.5 text-[#666666]" />
            <span>Отправить письмо</span>
          </button>

          <button
            type="button"
            onClick={handleSave}
            disabled={createContact.isPending}
            title="Создать контакт"
            aria-label="Создать контакт"
            className="flex items-center gap-1.5 rounded-[6px] bg-[#111111] px-3.5 py-1.5 text-xs font-medium text-white shadow-2xs hover:bg-[#222222] transition-colors cursor-pointer disabled:opacity-60"
          >
            {createContact.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            <span>Сохранить</span>
          </button>
        </div>
      </div>
    </div>
  );
}
