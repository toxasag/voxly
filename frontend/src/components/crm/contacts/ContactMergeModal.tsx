"use client";

import { useState, useMemo, useCallback } from "react";
import {
  GitMerge,
  ArrowLeftRight,
  Search,
  User,
  Loader2,
  AlertCircle,
  Building2,
  Phone,
  Mail,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import { EntityChip } from "@/components/crm/shared/EntityChip";
import {
  contactFullName,
  useContacts,
  useMergeContacts,
  type ContactDTO,
  type MergeContactsResult,
} from "@/lib/api/use-contacts";
import { formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";
import { useOverlay } from "@/lib/utils/use-scroll-lock";

// ---------------------------------------------------------------------------
// Модальное окно слияния контактов (Twenty CRM Merge Pattern).
//
// Позволяет выбрать основной контакт (keeper) и дубликат (loser), перенести
// все связанные сделки, задачи, телефоны и профили соцсетей, после чего
// архивировать дубликат с сохранением аудита в таймлайне.
// ---------------------------------------------------------------------------

interface ContactMergeModalProps {
  open: boolean;
  onClose: () => void;
  primaryContact: ContactDTO;
  secondaryContact?: ContactDTO | null;
  onMerged?: (result: MergeContactsResult) => void;
}

export function ContactMergeModal({
  open,
  onClose,
  primaryContact,
  secondaryContact = null,
  onMerged,
}: ContactMergeModalProps) {
  const [primary, setPrimary] = useState<ContactDTO>(primaryContact);
  const [secondary, setSecondary] = useState<ContactDTO | null>(secondaryContact);
  const [searchQuery, setSearchQuery] = useState("");

  useOverlay(open, { onEscape: onClose });

  const mergeMutation = useMergeContacts();

  // Поиск кандидатов для слияния
  const contactsQuery = useContacts({
    search: searchQuery.trim().length > 0 ? searchQuery.trim() : undefined,
    limit: 10,
  });

  const candidates = useMemo(() => {
    const list = contactsQuery.data?.items ?? [];
    return list.filter((item) => item.id !== primary.id);
  }, [contactsQuery.data?.items, primary.id]);

  const handleSwap = useCallback(() => {
    if (!secondary) return;
    const temp = primary;
    setPrimary(secondary);
    setSecondary(temp);
  }, [primary, secondary]);

  const handleExecuteMerge = useCallback(async () => {
    if (!secondary) return;

    try {
      const result = await mergeMutation.mutateAsync({
        primary_id: primary.id,
        loser_ids: [secondary.id],
      });

      toast.success(
        `Контакты успешно объединены: перенесено сделок: ${result.dealsRetargeted}, задач: ${result.tasksRetargeted}, добавлено номеров: ${result.phonesAdded}`,
      );
      onMerged?.(result);
      onClose();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Не удалось объединить контакты",
      );
    }
  }, [primary.id, secondary, mergeMutation, onMerged, onClose]);

  if (!open) return null;

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]" resizable>
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <GitMerge className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Слияние контактов</h2>
            <p className="text-xs text-[#666666]">
              Объединение информации дубликата с основной карточкой
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111]">
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Плашка пояснения */}
          <div className="flex items-start gap-2.5 rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-3 text-xs text-[#854d0e]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#ca8a04]" />
            <div className="leading-relaxed">
              Все сделки, задачи, дополнительные номера телефонов и профили соцсетей
              будут перенесены в <strong>Основной контакт</strong>. Запись дубликата будет
              архивирована.
            </div>
          </div>

          {/* Карточки сравнения */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
                Сопоставление записей
              </span>
              {secondary && (
                <button
                  type="button"
                  onClick={handleSwap}
                  className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] transition-colors hover:bg-[#fafafa]"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5 text-[#666666]" />
                  Поменять местами
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Левая колонка: Основной контакт */}
              <div className="rounded-[8px] border-2 border-[#4a38f5] bg-white p-3 shadow-2xs relative">
                <div className="absolute top-2 right-2 flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[#4a38f5]">
                  <CheckCircle2 className="h-3 w-3" />
                  Основной
                </div>
                <div className="flex items-center gap-2 mb-2 pr-16">
                  <EntityChip name={contactFullName(primary)} size="sm" />
                  <span className="font-semibold text-xs text-[#111111] truncate">
                    {contactFullName(primary)}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs text-[#666666] pt-1 border-t border-[#f0f0f0]">
                  <div className="flex items-center gap-1.5 truncate">
                    <Phone className="h-3 w-3 shrink-0 text-[#888888]" />
                    <span>{primary.phone ? formatPhone(primary.phone) : "Нет телефона"}</span>
                  </div>
                  {primary.email && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Mail className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="truncate">{primary.email}</span>
                    </div>
                  )}
                  {primary.companyName && (
                    <div className="flex items-center gap-1.5 truncate">
                      <Building2 className="h-3 w-3 shrink-0 text-[#888888]" />
                      <span className="truncate">{primary.companyName}</span>
                    </div>
                  )}
                  <div className="text-[11px] text-[#888888] pt-1">
                    Сделок: {primary.dealsCount} · Задач: {primary.tasksCount}
                  </div>
                </div>
              </div>

              {/* Правая колонка: Дубликат */}
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 relative">
                {secondary ? (
                  <>
                    <div className="flex items-center justify-between mb-2">
                      <span className="rounded-[4px] bg-rose-50 border border-rose-200 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">
                        Дубликат (удаляется)
                      </span>
                      <button
                        type="button"
                        onClick={() => setSecondary(null)}
                        className="text-[11px] text-[#888888] hover:text-[#111111]"
                      >
                        Сменить
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <EntityChip name={contactFullName(secondary)} size="sm" />
                      <span className="font-semibold text-xs text-[#111111] truncate">
                        {contactFullName(secondary)}
                      </span>
                    </div>
                    <div className="space-y-1.5 text-xs text-[#666666] pt-1 border-t border-[#e5e5e5]">
                      <div className="flex items-center gap-1.5 truncate">
                        <Phone className="h-3 w-3 shrink-0 text-[#888888]" />
                        <span>{secondary.phone ? formatPhone(secondary.phone) : "Нет телефона"}</span>
                      </div>
                      {secondary.email && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Mail className="h-3 w-3 shrink-0 text-[#888888]" />
                          <span className="truncate">{secondary.email}</span>
                        </div>
                      )}
                      {secondary.companyName && (
                        <div className="flex items-center gap-1.5 truncate">
                          <Building2 className="h-3 w-3 shrink-0 text-[#888888]" />
                          <span className="truncate">{secondary.companyName}</span>
                        </div>
                      )}
                      <div className="text-[11px] text-[#888888] pt-1">
                        Сделок: {secondary.dealsCount} · Задач: {secondary.tasksCount}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-6 text-center">
                    <User className="h-6 w-6 text-[#888888] mb-1.5" />
                    <span className="text-xs font-medium text-[#111111]">
                      Выберите дубликат
                    </span>
                    <span className="text-[11px] text-[#888888] mt-0.5">
                      найдите контакт ниже в списке
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Поиск дубликата */}
          {!secondary && (
            <div className="space-y-2">
              <label className="text-xs font-semibold text-[#111111] block">
                Поиск дубликата для объединения
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-[#888888]" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Поиск по имени, телефону или email…"
                  className="h-8 w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
              </div>

              {/* Список найденных контактов */}
              <div className="rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] max-h-[220px] overflow-y-auto">
                {contactsQuery.isLoading ? (
                  <div className="flex items-center justify-center p-4 text-xs text-[#888888]">
                    <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка контактов…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[#888888]">
                    Контакты не найдены
                  </div>
                ) : (
                  candidates.map((contact) => (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() => setSecondary(contact)}
                      className="w-full flex items-center justify-between p-2.5 text-left hover:bg-[#fafafa] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <EntityChip name={contactFullName(contact)} size="sm" />
                        <div className="min-w-0">
                          <div className="text-xs font-medium text-[#111111] truncate">
                            {contactFullName(contact)}
                          </div>
                          <div className="text-[11px] text-[#666666] truncate">
                            {contact.phone ? formatPhone(contact.phone) : "Нет телефона"}
                            {contact.companyName ? ` · ${contact.companyName}` : ""}
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-[#4a38f5] font-medium shrink-0 ml-2">
                        Выбрать
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Подвал с кнопками действия */}
        <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] px-6 py-3 bg-[#fafafa]">
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] transition-colors hover:bg-[#f0f0f0]"
          >
            Отмена
          </button>
          <button
            type="button"
            disabled={!secondary || mergeMutation.isPending}
            onClick={handleExecuteMerge}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs transition-colors hover:bg-[#3d2ee0] disabled:opacity-50 disabled:pointer-events-none",
            )}
          >
            {mergeMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Объединение…
              </>
            ) : (
              <>
                <GitMerge className="h-3.5 w-3.5" />
                Объединить контакты
              </>
            )}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
