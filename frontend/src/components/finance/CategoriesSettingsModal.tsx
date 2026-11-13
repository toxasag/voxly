"use client";

import { useState } from "react";
import { X, Plus, Pencil, Trash2, Check, Loader2, FolderTree } from "lucide-react";
import { toast } from "sonner";
import {
  useFinanceCategories,
  useCreateFinanceCategory,
  useUpdateFinanceCategory,
  useDeleteFinanceCategory,
  type FinanceCategoryDTO,
} from "@/lib/api/use-invoices";
import { cn } from "@/lib/utils";

interface CategoriesSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function CategoriesSettingsModal({ open, onClose }: CategoriesSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"income" | "expense">("income");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const { data: categories = [], isLoading } = useFinanceCategories();
  const createCategory = useCreateFinanceCategory();
  const updateCategory = useUpdateFinanceCategory();
  const deleteCategory = useDeleteFinanceCategory();

  if (!open) return null;

  const filteredCategories = categories.filter((c) => c.type === activeTab);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;

    try {
      await createCategory.mutateAsync({
        name,
        type: activeTab,
      });
      toast.success(`Статья «${name}» успешно добавлена`);
      setNewCategoryName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать статью");
    }
  };

  const startEdit = (cat: FinanceCategoryDTO) => {
    setEditingId(cat.id);
    setEditingName(cat.name);
  };

  const handleSaveEdit = async (id: string) => {
    const name = editingName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }

    try {
      await updateCategory.mutateAsync({
        id,
        payload: { name },
      });
      toast.success("Статья обновлена");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка обновления");
    }
  };

  const handleDelete = async (cat: FinanceCategoryDTO) => {
    if (!confirm(`Удалить статью «${cat.name}»?`)) return;

    try {
      await deleteCategory.mutateAsync(cat.id);
      toast.success(`Статья «${cat.name}» удалена`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
      <div className="relative w-full max-w-lg rounded-[16px] border border-[#e5e5e5] bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg bg-[#4a38f5]/10 p-2 text-[#4a38f5]">
              <FolderTree className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-[#111111]">Статьи доходов и расходов</h2>
              <p className="text-xs text-[#666666]">Управление категориями для финансовых операций и P&L</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] p-1.5 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Tabs */}
          <div className="flex items-center gap-1 rounded-[8px] bg-[#f5f5f5] p-1 border border-[#e5e5e5]">
            <button
              type="button"
              onClick={() => {
                setActiveTab("income");
                setEditingId(null);
              }}
              className={cn(
                "flex-1 rounded-[6px] py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "income"
                  ? "bg-white text-emerald-700 shadow-2xs font-semibold"
                  : "text-[#666666] hover:text-[#111111]",
              )}
            >
              Доходы ({categories.filter((c) => c.type === "income").length})
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab("expense");
                setEditingId(null);
              }}
              className={cn(
                "flex-1 rounded-[6px] py-1.5 text-xs font-medium transition-colors cursor-pointer",
                activeTab === "expense"
                  ? "bg-white text-rose-700 shadow-2xs font-semibold"
                  : "text-[#666666] hover:text-[#111111]",
              )}
            >
              Расходы ({categories.filter((c) => c.type === "expense").length})
            </button>
          </div>

          {/* Add Category Form */}
          <form onSubmit={handleAdd} className="flex items-center gap-2">
            <input
              type="text"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder={`Новая статья ${activeTab === "income" ? "доходов" : "расходов"}...`}
              className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <button
              type="submit"
              disabled={!newCategoryName.trim() || createCategory.isPending}
              className="flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createCategory.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Добавить
            </button>
          </form>

          {/* Categories List */}
          <div className="max-h-[300px] overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0]">
            {isLoading ? (
              <div className="flex items-center justify-center py-8 text-xs text-[#888888]">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Загрузка статей...
              </div>
            ) : filteredCategories.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#888888]">
                Статьи {activeTab === "income" ? "доходов" : "расходов"} не найдены.
              </div>
            ) : (
              filteredCategories.map((cat) => (
                <div
                  key={cat.id}
                  className="flex items-center justify-between px-3.5 py-2.5 hover:bg-[#fafafa] transition-colors"
                >
                  {editingId === cat.id ? (
                    <div className="flex flex-1 items-center gap-2 mr-2">
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleSaveEdit(cat.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        className="flex-1 rounded-[6px] border border-[#4a38f5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(cat.id)}
                        className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                        title="Сохранить"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded p-1 text-[#888888] hover:bg-[#f0f0f0]"
                        title="Отмена"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-[#111111] truncate">{cat.name}</span>
                  )}

                  {editingId !== cat.id && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(cat)}
                        className="rounded p-1 text-[#888888] hover:text-[#4a38f5] hover:bg-black/[0.04] transition-colors"
                        title="Редактировать"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(cat)}
                        disabled={deleteCategory.isPending}
                        className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-40"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-[#e5e5e5] px-6 py-3 bg-[#fafafa] rounded-b-[16px]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-1.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#f5f5f5] transition-colors"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}
