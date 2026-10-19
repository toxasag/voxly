"use client";

import { memo, useState } from "react";
import {
  GitMerge,
  ArrowRight,
  Phone,
  Mail,
  Building2,
  Briefcase,
  Handshake,
  ListChecks,
  AlertTriangle,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetHeader, SheetContent } from "@/components/ui/sheet";
import {
  contactFullName,
  useMergeContacts,
  type ContactDTO,
} from "@/lib/api/use-contacts";
import { formatPhone } from "@/lib/utils/phone";
import { cn } from "@/lib/utils";

interface ContactMergeModalProps {
  open: boolean;
  currentContact: ContactDTO;
  duplicateContact: ContactDTO | null;
  onClose: () => void;
  onMerged?: (primaryId: string) => void;
}

export const ContactMergeModal = memo(function ContactMergeModal({
  open,
  currentContact,
  duplicateContact,
  onClose,
  onMerged,
}: ContactMergeModalProps) {
  // По умолчанию текущий контакт считается основным
  const [primaryId, setPrimaryId] = useState<string>(currentContact.id);
  const merge = useMergeContacts();

  if (!open || !duplicateContact) return null;

  const isCurrentPrimary = primaryId === currentContact.id;
  const primaryContact = isCurrentPrimary ? currentContact : duplicateContact;
  const secondaryContact = isCurrentPrimary ? duplicateContact : currentContact;

  const handleMerge = async () => {
    try {
      const result = await merge.mutateAsync({
        primary_id: primaryContact.id,
        loser_ids: [secondaryContact.id],
      });

      toast.success(
        `Контакты объединены! Сделок перенесено: ${result.dealsRetargeted}, задач: ${result.tasksRetargeted}, номеров: ${result.phonesAdded}`,
      );
      onMerged?.(primaryContact.id);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Не удалось объединить контакты");
    }
  };

  return (
    <Sheet open={open} onClose={onClose} width="w-[620px]">
      <SheetHeader onClose={onClose}>
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
            <GitMerge className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[#111111]">Слияние контактов</h2>
            <p className="text-xs text-[#666666]">
              Объединение дубликатов в одну запись без потери истории
            </p>
          </div>
        </div>
      </SheetHeader>

      <SheetContent className="flex flex-col h-full bg-white text-[#111111] p-5 space-y-4 overflow-y-auto">
        <div className="rounded-[8px] border border-[#fef08a] bg-[#fefce8] p-3 text-xs text-[#854d0e] flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-[#854d0e]" />
          <div>
            <p className="font-medium">Что произойдёт при слиянии:</p>
            <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px] text-[#854d0e]/90">
              <li>Все связанные сделки и задачи перейдут к основному контакту.</li>
              <li>Номера телефонов и социальные сети добавятся в профиль.</li>
              <li>Вторичный контакт будет архивирован и скрыт из списков.</li>
            </ul>
          </div>
        </div>

        {/* Выбор основного контакта */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-[#666666]">
            Выберите основной контакт (мастер-запись):
          </label>

          <div className="grid grid-cols-2 gap-3">
            {/* Карточка 1 */}
            <div
              onClick={() => setPrimaryId(currentContact.id)}
              className={cn(
                "rounded-[8px] border p-3 cursor-pointer transition-all flex flex-col justify-between",
                primaryId === currentContact.id
                  ? "border-[#4a38f5] bg-[#4a38f5]/[0.02] shadow-2xs ring-1 ring-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      primaryId === currentContact.id
                        ? "bg-[#4a38f5] text-white"
                        : "bg-[#f5f5f5] text-[#888888]",
                    )}
                  >
                    {primaryId === currentContact.id ? "Основной" : "Будет скрыт"}
                  </span>
                  {primaryId === currentContact.id && (
                    <CheckCircle2 className="h-4 w-4 text-[#4a38f5]" />
                  )}
                </div>
                <p className="text-xs font-semibold text-[#111111]">
                  {contactFullName(currentContact)}
                </p>
                <p className="text-[11px] text-[#666666]">
                  {currentContact.companyName || currentContact.jobTitle || "Без компании"}
                </p>
              </div>

              <div className="mt-3 space-y-1 text-[11px] text-[#666666] border-t border-[#f0f0f0] pt-2">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-[#888888]" />
                  <span>{formatPhone(currentContact.phone) || "—"}</span>
                </div>
                {currentContact.email && (
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3 w-3 text-[#888888]" />
                    <span className="truncate">{currentContact.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1 text-[10px] text-[#888888] font-mono">
                  <span>Сделок: {currentContact.dealsCount}</span>
                  <span>Задач: {currentContact.tasksCount}</span>
                </div>
              </div>
            </div>

            {/* Карточка 2 */}
            <div
              onClick={() => setPrimaryId(duplicateContact.id)}
              className={cn(
                "rounded-[8px] border p-3 cursor-pointer transition-all flex flex-col justify-between",
                primaryId === duplicateContact.id
                  ? "border-[#4a38f5] bg-[#4a38f5]/[0.02] shadow-2xs ring-1 ring-[#4a38f5]"
                  : "border-[#e5e5e5] bg-white hover:border-[#cccccc]",
              )}
            >
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-medium",
                      primaryId === duplicateContact.id
                        ? "bg-[#4a38f5] text-white"
                        : "bg-[#f5f5f5] text-[#888888]",
                    )}
                  >
                    {primaryId === duplicateContact.id ? "Основной" : "Будет скрыт"}
                  </span>
                  {primaryId === duplicateContact.id && (
                    <CheckCircle2 className="h-4 w-4 text-[#4a38f5]" />
                  )}
                </div>
                <p className="text-xs font-semibold text-[#111111]">
                  {contactFullName(duplicateContact)}
                </p>
                <p className="text-[11px] text-[#666666]">
                  {duplicateContact.companyName || duplicateContact.jobTitle || "Без компании"}
                </p>
              </div>

              <div className="mt-3 space-y-1 text-[11px] text-[#666666] border-t border-[#f0f0f0] pt-2">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3 w-3 text-[#888888]" />
                  <span>{formatPhone(duplicateContact.phone) || "—"}</span>
                </div>
                {duplicateContact.email && (
                  <div className="flex items-center gap-1.5 truncate">
                    <Mail className="h-3 w-3 text-[#888888]" />
                    <span className="truncate">{duplicateContact.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1 text-[10px] text-[#888888] font-mono">
                  <span>Сделок: {duplicateContact.dealsCount}</span>
                  <span>Задач: {duplicateContact.tasksCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Итог объединения */}
        <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs space-y-2">
          <p className="font-medium text-[#111111] flex items-center gap-1.5">
            <Handshake className="h-3.5 w-3.5 text-[#4a38f5]" />
            Итог после объединения:
          </p>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-[#666666]">
            <div>
              Основной контакт:{" "}
              <strong className="text-[#111111]">{contactFullName(primaryContact)}</strong>
            </div>
            <div>
              Всего сделок:{" "}
              <strong className="text-[#111111]">
                {primaryContact.dealsCount + secondaryContact.dealsCount}
              </strong>
            </div>
            <div>
              Компания:{" "}
              <strong className="text-[#111111]">
                {primaryContact.companyName || secondaryContact.companyName || "—"}
              </strong>
            </div>
            <div>
              Всего задач:{" "}
              <strong className="text-[#111111]">
                {primaryContact.tasksCount + secondaryContact.tasksCount}
              </strong>
            </div>
          </div>
        </div>

        {/* Кнопки действий */}
        <div className="pt-3 border-t border-[#e5e5e5] flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={handleMerge}
            disabled={merge.isPending}
            className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
          >
            {merge.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Объединение...
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
});
