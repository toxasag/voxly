"use client";

import { useState } from "react";
import { X, Building2, Wallet, CreditCard, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCreateAccount, type AccountDTO, type AccountType } from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

interface CreateAccountModalProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (account: AccountDTO) => void;
}

const ACCOUNT_TYPES: { type: AccountType; label: string; icon: typeof Wallet; desc: string }[] = [
  { type: "bank", label: "Безналичный счет", icon: Building2, desc: "Расчетный счет юрлица / ИП" },
  { type: "cash", label: "Касса (Наличные)", icon: Wallet, desc: "Физическая касса / наличные" },
  { type: "acquiring", label: "Эквайринг", icon: CreditCard, desc: "Терминал / онлайн-оплата" },
  { type: "safe", label: "Сейф", icon: ShieldCheck, desc: "Резервный фонд / сейф" },
];

export function CreateAccountModal({ open, onClose, onCreated }: CreateAccountModalProps) {
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("bank");
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [isDefault, setIsDefault] = useState(false);

  const createMutation = useCreateAccount();

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Укажите название счёта или кассы");
      return;
    }

    try {
      const created = await createMutation.mutateAsync({
        name: trimmed,
        account_type: accountType,
        currency: "RUB",
        opening_balance: openingBalance >= 0 ? openingBalance : 0,
        is_default: isDefault,
      });

      toast.success(`Счёт «${trimmed}» успешно создан`);
      if (onCreated) {
        onCreated(created);
      }
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать счёт");
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="relative w-full max-w-md rounded-[16px] border border-[#e5e5e5] bg-white shadow-xl animate-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-[#4a38f5]/10 text-[#4a38f5]">
              <Wallet className="h-4 w-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#111111]">Новый счёт или касса</h3>
              <p className="text-xs text-[#666666]">Добавление источника для операций и переводов</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] p-1.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {/* Account Type Grid */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Тип счёта *</label>
            <div className="grid grid-cols-2 gap-2">
              {ACCOUNT_TYPES.map((t) => {
                const Icon = t.icon;
                const isSelected = accountType === t.type;
                return (
                  <button
                    key={t.type}
                    type="button"
                    onClick={() => setAccountType(t.type)}
                    className={cn(
                      "flex flex-col items-start rounded-[8px] border p-2.5 text-left transition-all cursor-pointer",
                      isSelected
                        ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5] ring-1 ring-[#4a38f5]"
                        : "border-[#e5e5e5] bg-white text-[#666666] hover:border-[#cccccc] hover:bg-[#fafafa]",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className={cn("h-4 w-4 shrink-0", isSelected ? "text-[#4a38f5]" : "text-[#888888]")} />
                      <span className="text-xs font-semibold text-[#111111]">{t.label}</span>
                    </div>
                    <span className="mt-1 text-[11px] text-[#888888] line-clamp-1">{t.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Название счёта / кассы *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Т-Банк расчетный, Касса на Ленина..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
          </div>

          {/* Opening Balance */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-[#111111]">Начальный остаток (RUB)</label>
            <div className="relative">
              <input
                type="number"
                min={0}
                step={0.01}
                value={openingBalance === 0 ? "" : openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value === "" ? 0 : parseFloat(e.target.value))}
                placeholder="0"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#888888]">₽</span>
            </div>
          </div>

          {/* Default Switch */}
          <div className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              id="is_default_acc"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="h-3.5 w-3.5 rounded-[4px] border border-[#d1d5db] accent-[#4a38f5] cursor-pointer"
            />
            <label htmlFor="is_default_acc" className="text-xs text-[#666666] cursor-pointer select-none">
              Сделать основным счётом по умолчанию
            </label>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#f0f0f0]">
            <button
              type="button"
              onClick={onClose}
              className="rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs font-medium text-[#666666] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || !name.trim()}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Создать счёт
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
