"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Bot,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Clock,
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
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCreateContact, contactFullName } from "@/lib/api/use-contacts";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import { useAuth } from "@/lib/auth/use-auth";
import type { DealDTO } from "@/lib/api/use-deals";
import { cn } from "@/lib/utils";

interface ContactDrawerCardProps {
  deal: DealDTO;
  onBack: () => void;
  onClose: () => void;
  onCreated: (contact: { id: string; name: string }) => void;
  onExpand?: () => void;
}

export function ContactDrawerCard({
  deal,
  onBack,
  onClose,
  onCreated,
  onExpand,
}: ContactDrawerCardProps) {
  const { user } = useAuth();
  const createContact = useCreateContact();

  const [activeTab, setActiveTab] = useState("home");
  const [isFavorite, setIsFavorite] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  // Секции аккордеона
  const [generalOpen, setGeneralOpen] = useState(true);
  const [workOpen, setWorkOpen] = useState(true);
  const [socialOpen, setSocialOpen] = useState(true);
  const [systemOpen, setSystemOpen] = useState(true);

  // Значения полей
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [companyName, setCompanyName] = useState(deal.companyName ?? "");
  const [jobTitle, setJobTitle] = useState("");
  const [linkedin, setLinkedin] = useState("");

  const handleSave = async () => {
    const trimmedName = fullName.trim() || "Без названия";
    const parts = trimmedName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "Без названия";
    const lastName = parts.slice(1).join(" ") || "";

    try {
      const created = await createContact.mutateAsync({
        first_name: firstName,
        last_name: lastName,
        email: email.trim() || undefined,
        phones: phone.trim()
          ? [{ number: phone.trim(), country_code: "RU", calling_code: "+7" }]
          : undefined,
        company_name: companyName.trim() || undefined,
        company_id: deal.companyId || undefined,
        job_title: jobTitle.trim() || undefined,
        linkedin_link: linkedin.trim() || undefined,
        channel: "phone",
      });

      const resultName = contactFullName(created) || trimmedName;
      toast.success(`Контакт «${resultName}» создан`);
      onCreated({ id: created.id, name: resultName });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать контакт");
    }
  };

  const creatorName = user?.name ?? "Tvbox2026 оло";

  return (
    <div className="flex h-full flex-col bg-white text-[#111111]">
      {/* Шапка карточки контакта (Скриншот 3) */}
      <div className="flex items-center justify-between border-b border-[#e5e5e5] px-4 py-3 bg-white shrink-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Кнопка-стрелка «Влево» возвращает на первоначальную карточку (Скриншот 4) */}
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад к сделке"
            title="Назад"
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-[#f5f5f5] text-[#666666] hover:bg-[#ebebeb] hover:text-[#111111] transition-colors cursor-pointer shrink-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          {/* Монограмма-бейдж [-] */}
          <span
            aria-hidden="true"
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border border-[#e5e5e5] bg-[#f5f5f5] text-[10px] text-[#888888] font-bold shadow-2xs select-none"
          >
            -
          </span>

          {/* Инпут имени контакта «Без названия» */}
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Без названия"
            title="ФИО контакта"
            className="rounded-[4px] px-1.5 py-0.5 text-sm font-semibold text-[#111111] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6] min-w-0 w-full transition-colors"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0 ml-2">
          {/* Кнопка «Развернуть» открывает страницу карточки (Скриншот 5) */}
          <button
            type="button"
            onClick={onExpand ?? handleSave}
            aria-label="Развернуть"
            title="Развернуть"
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <Maximize2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            className="rounded-[6px] p-1.5 text-[#666666] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Полоса вкладок: Главная, Временная шкала, Задачи, Заметки, +3 Ещё (Скриншот 3) */}
      <div className="flex items-center px-4 bg-white border-b border-[#e5e5e5] gap-1 shrink-0 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("home")}
          title="Главная"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            activeTab === "home"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <Home className="h-3.5 w-3.5 shrink-0" />
          <span>Главная</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("timeline")}
          title="Временная шкала"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            activeTab === "timeline"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span>Временная шкала</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("tasks")}
          title="Задачи"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            activeTab === "tasks"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <CheckSquare className="h-3.5 w-3.5 shrink-0" />
          <span>Задачи</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("notes")}
          title="Заметки"
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer shrink-0",
            activeTab === "notes"
              ? "border-[#111111] text-[#111111]"
              : "border-transparent text-[#666666] hover:text-[#111111]",
          )}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span>Заметки</span>
        </button>

        <div className="flex items-center gap-1 px-2 py-2 text-xs text-[#888888] cursor-pointer hover:text-[#111111] transition-colors shrink-0" title="Ещё вкладки">
          <span>+3 Ещё</span>
          <ChevronDown className="h-3 w-3" />
        </div>
      </div>

      {/* Тело карточки контакта (Скриншот 3) */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "home" ? (
          <div className="pb-8">
            <div className="px-4 pt-3 pb-1">
              <span className="text-xs font-semibold text-[#666666]">Поля</span>
            </div>

            {/* Аккордеон 1: Общее */}
            <div className="mt-1">
              <button
                type="button"
                onClick={() => setGeneralOpen((prev) => !prev)}
                title="Свернуть/развернуть блок «Общее»"
                className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <span>Общее</span>
                <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !generalOpen && "rotate-180")} />
              </button>

              {generalOpen && (
                <div className="space-y-0.5 py-0.5">
                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Mail className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Электронные...</span>
                    </span>
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Электронные письма"
                      title="Электронная почта"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6]"
                    />
                  </div>

                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Phone className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Телефоны</span>
                    </span>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Телефоны"
                      title="Номер телефона"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Аккордеон 2: Работа */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setWorkOpen((prev) => !prev)}
                title="Свернуть/развернуть блок «Работа»"
                className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <span>Работа</span>
                <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !workOpen && "rotate-180")} />
              </button>

              {workOpen && (
                <div className="space-y-0.5 py-0.5">
                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Building2 className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Компания</span>
                    </span>
                    <input
                      type="text"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Компания"
                      title="Название компании"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6]"
                    />
                  </div>

                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Briefcase className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Должность</span>
                    </span>
                    <input
                      type="text"
                      value={jobTitle}
                      onChange={(e) => setJobTitle(e.target.value)}
                      placeholder="Должность"
                      title="Должность контакта"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Аккордеон 3: Социальные сети */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setSocialOpen((prev) => !prev)}
                title="Свернуть/развернуть блок «Социальные сети»"
                className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <span>Социальные сети</span>
                <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !socialOpen && "rotate-180")} />
              </button>

              {socialOpen && (
                <div className="space-y-0.5 py-0.5">
                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Linkedin className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>LinkedIn</span>
                    </span>
                    <input
                      type="text"
                      value={linkedin}
                      onChange={(e) => setLinkedin(e.target.value)}
                      placeholder="LinkedIn"
                      title="Профиль LinkedIn"
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs text-[#111111] placeholder:text-[#888888] outline-none bg-transparent hover:bg-black/[0.03] focus:bg-white focus:border focus:border-[#3b82f6]"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Аккордеон 4: Система */}
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setSystemOpen((prev) => !prev)}
                title="Свернуть/развернуть блок «Система»"
                className="flex w-full items-center justify-between px-4 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
              >
                <span>Система</span>
                <ChevronUp className={cn("h-3.5 w-3.5 text-[#888888] transition-transform", !systemOpen && "rotate-180")} />
              </button>

              {systemOpen && (
                <div className="space-y-0.5 py-0.5">
                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Calendar className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Дата создания</span>
                    </span>
                    <span title="меньше минуты назад" className="text-xs text-[#111111]">
                      меньше минуты назад
                    </span>
                  </div>

                  <div className="flex items-center gap-2 px-4 py-1 min-h-[30px]">
                    <span className="flex w-[140px] shrink-0 items-center gap-2 text-xs text-[#666666]">
                      <Bot className="h-3.5 w-3.5 shrink-0 text-[#888888]" />
                      <span>Создано</span>
                    </span>
                    <span title={creatorName} className="inline-flex items-center gap-1.5 text-xs text-[#111111]">
                      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-[9px] font-bold text-rose-700">
                        {creatorName.charAt(0).toUpperCase()}
                      </span>
                      <span>{creatorName}</span>
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Секция: Компания (Скриншот 3) */}
            <div className="mt-4 border-t border-[#f0f0f0] pt-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#111111]">Компания</span>
                <button
                  type="button"
                  aria-label="Редактировать компанию"
                  title="Редактировать компанию"
                  className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>

              <div>
                <span
                  title={companyName || "Компания не указана"}
                  className="inline-flex h-5 items-center justify-center rounded-[4px] bg-[#f5f5f5] px-2 text-xs font-normal text-[#888888] select-none"
                >
                  {companyName || "-"}
                </span>
              </div>
            </div>

            {/* Секция: Возможности (Скриншот 3: A AI Model Training) */}
            <div className="mt-3 border-t border-[#f0f0f0] pt-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#111111]">Возможности</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Открыть сделку"
                    title="Открыть сделку"
                    className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label="Редактировать сделку"
                    title="Редактировать"
                    className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div>
                <EntityChip name={deal.title} label={deal.title} size="sm" singleLetter />
              </div>
            </div>

            {/* Секция: Списки (Скриншот 3) */}
            <div className="mt-3 border-t border-[#f0f0f0] pt-3 px-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-[#111111]">Списки</span>
                <button
                  type="button"
                  aria-label="Добавить в список"
                  title="Добавить"
                  className="rounded-[4px] p-1 text-[#888888] hover:bg-black/[0.04] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-xs text-[#888888]">
            Нет данных для отображения
          </div>
        )}
      </div>

      {/* Нижняя фиксированная панель действий (Скриншот 3) */}
      <div className="sticky bottom-0 z-20 flex items-center justify-between border-t border-[#e5e5e5] bg-white px-4 py-2.5 shrink-0">
        <div className="relative flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Больше действий"
            title="Больше действий"
            onClick={() => setMoreMenuOpen((v) => !v)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {moreMenuOpen && (
            <>
              <div className="fixed inset-0 z-30 cursor-default" onClick={() => setMoreMenuOpen(false)} />
              <div className="absolute bottom-full left-0 z-40 mb-1 w-44 rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-xl text-xs">
                <button
                  type="button"
                  onClick={handleSave}
                  title="Сохранить контакт"
                  className="flex w-full items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-xs text-[#111111] hover:bg-[#f5f5f5] transition-colors text-left cursor-pointer"
                >
                  Сохранить контакт
                </button>
              </div>
            </>
          )}

          <button
            type="button"
            aria-label="В избранное"
            title="В избранное"
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
            className="flex items-center gap-1.5 rounded-[6px] bg-[#111111] text-white px-3 py-1.5 text-xs font-medium hover:bg-black/90 transition-colors cursor-pointer disabled:opacity-50"
          >
            {createContact.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : null}
            <span>Создать контакт</span>
          </button>
        </div>
      </div>
    </div>
  );
}
