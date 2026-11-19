"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import {
  X,
  Plus,
  Loader2,
  Trash2,
  Pencil,
  Check,
  Search,
  BookOpen,
  Tag,
  Layers,
  Cpu,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import {
  useRepairDictionaries,
  useRenameRepairDictionaryItem,
  useDeleteRepairDictionaryItem,
  type DictionaryItemDTO,
} from "@/lib/api/use-repairs";
import {
  useWarehouseCategories,
  useCreateWarehouseCategory,
  useWarehouseBrands,
  useCreateWarehouseBrand,
  useWarehouseModels,
  useCreateWarehouseModel,
  useUpdateWarehouseModel,
  useDeleteWarehouseModel,
  type WarehouseItemModelDTO,
} from "@/lib/api/use-warehouse";
import { cn } from "@/lib/utils";

interface WarehouseDictionariesModalProps {
  open: boolean;
  onClose: () => void;
}

type DictionaryTab = "categories" | "brands" | "models";

export function WarehouseDictionariesModal({
  open,
  onClose,
}: WarehouseDictionariesModalProps) {
  const [activeTab, setActiveTab] = useState<DictionaryTab>("categories");
  const [search, setSearch] = useState("");

  // Input states
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newBrandName, setNewBrandName] = useState("");
  const [newModelName, setNewModelName] = useState("");
  const [selectedBrandForModel, setSelectedBrandForModel] = useState<string>("");

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // Queries
  const dictionariesQuery = useRepairDictionaries();
  const categoriesQuery = useWarehouseCategories();
  const brandsQuery = useWarehouseBrands();
  const modelsQuery = useWarehouseModels();

  // Mutations
  const createCategoryMutation = useCreateWarehouseCategory();
  const createBrandMutation = useCreateWarehouseBrand();
  const createModelMutation = useCreateWarehouseModel();
  const updateModelMutation = useUpdateWarehouseModel();
  const deleteModelMutation = useDeleteWarehouseModel();

  const renameDictMutation = useRenameRepairDictionaryItem();
  const deleteDictMutation = useDeleteRepairDictionaryItem();

  // Escape key handler
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  // Categories list
  const categoriesList = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();

    if (dictionariesQuery.data?.categories) {
      for (const item of dictionariesQuery.data.categories) {
        const id = typeof item === "string" ? item : item.id;
        const name = typeof item === "string" ? item : item.name;
        if (name && !seen.has(name.toLowerCase())) {
          list.push({ id, name });
          seen.add(name.toLowerCase());
        }
      }
    }

    if (categoriesQuery.data) {
      for (const name of categoriesQuery.data) {
        if (name && !seen.has(name.toLowerCase())) {
          list.push({ id: name, name });
          seen.add(name.toLowerCase());
        }
      }
    }

    return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [dictionariesQuery.data?.categories, categoriesQuery.data]);

  // Brands list
  const brandsList = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    const seen = new Set<string>();

    if (dictionariesQuery.data?.brands) {
      for (const b of dictionariesQuery.data.brands) {
        if (b.name && !seen.has(b.name.toLowerCase())) {
          list.push({ id: b.id, name: b.name });
          seen.add(b.name.toLowerCase());
        }
      }
    }

    if (brandsQuery.data) {
      for (const name of brandsQuery.data) {
        if (name && !seen.has(name.toLowerCase())) {
          list.push({ id: name, name });
          seen.add(name.toLowerCase());
        }
      }
    }

    return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [dictionariesQuery.data?.brands, brandsQuery.data]);

  // Models list
  const modelsList = useMemo(() => {
    const list: WarehouseItemModelDTO[] = [];
    const seen = new Set<string>();

    if (modelsQuery.data) {
      for (const m of modelsQuery.data) {
        list.push(m);
        seen.add(m.id);
      }
    }

    if (dictionariesQuery.data?.models) {
      for (const m of dictionariesQuery.data.models) {
        if (!seen.has(m.id)) {
          list.push({
            id: m.id,
            name: m.name,
            brandId: m.brandId,
            brandName: m.brandName,
          });
          seen.add(m.id);
        }
      }
    }

    return list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }, [modelsQuery.data, dictionariesQuery.data?.models]);

  if (!open) return null;

  // Filtered lists by search term
  const filteredCategories = categoriesList.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredBrands = brandsList.filter((b) =>
    b.name.toLowerCase().includes(search.toLowerCase()),
  );

  const filteredModels = modelsList.filter((m) => {
    const matchSearch =
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      (m.brandName && m.brandName.toLowerCase().includes(search.toLowerCase()));
    if (!matchSearch) return false;
    if (selectedBrandForModel) {
      return (
        m.brandName?.toLowerCase() === selectedBrandForModel.toLowerCase() ||
        m.brandId === selectedBrandForModel
      );
    }
    return true;
  });

  // Handlers for Categories
  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    try {
      await createCategoryMutation.mutateAsync(name);
      toast.success(`Категория «${name}» добавлена`);
      setNewCategoryName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить категорию");
    }
  };

  const handleRenameCategory = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    try {
      await renameDictMutation.mutateAsync({
        category: "category",
        id,
        name,
      });
      toast.success("Категория переименована");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при переименовании");
    }
  };

  const handleDeleteCategory = async (id: string, name: string) => {
    if (!confirm(`Удалить категорию «${name}» из справочника?`)) return;
    try {
      await deleteDictMutation.mutateAsync({
        category: "category",
        id,
      });
      toast.success(`Категория «${name}» удалена`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении");
    }
  };

  // Handlers for Brands
  const handleAddBrand = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newBrandName.trim();
    if (!name) return;
    try {
      await createBrandMutation.mutateAsync(name);
      toast.success(`Бренд «${name}» добавлен`);
      setNewBrandName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить бренд");
    }
  };

  const handleRenameBrand = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    try {
      await renameDictMutation.mutateAsync({
        category: "brand",
        id,
        name,
      });
      toast.success("Бренд переименован");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при переименовании");
    }
  };

  const handleDeleteBrand = async (id: string, name: string) => {
    if (!confirm(`Удалить бренд «${name}» из справочника?`)) return;
    try {
      await deleteDictMutation.mutateAsync({
        category: "brand",
        id,
      });
      toast.success(`Бренд «${name}» удален`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении");
    }
  };

  // Handlers for Models
  const handleAddModel = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newModelName.trim();
    if (!name) return;
    try {
      await createModelMutation.mutateAsync({
        name,
        brand: selectedBrandForModel || undefined,
      });
      toast.success(`Модель «${name}» добавлена`);
      setNewModelName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить модель");
    }
  };

  const handleRenameModel = async (id: string) => {
    const name = editingName.trim();
    if (!name) return;
    try {
      await updateModelMutation.mutateAsync({
        id,
        payload: { name },
      });
      toast.success("Модель обновлена");
      setEditingId(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при переименовании");
    }
  };

  const handleDeleteModel = async (id: string, name: string) => {
    if (!confirm(`Удалить модель «${name}» из справочника?`)) return;
    try {
      await deleteModelMutation.mutateAsync(id);
      toast.success(`Модель «${name}» удалена`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex h-[620px] w-full max-w-2xl flex-col rounded-2xl border border-[#e5e5e5] bg-white shadow-xl animate-in fade-in zoom-in-95 duration-150 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 border border-[#4a38f5]/20 text-[#4a38f5]">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-[#111111]">
                Справочники склада
              </h2>
              <p className="text-xs text-[#666666]">
                Категории, бренды и модели оборудования
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs & Search toolbar */}
        <div className="flex items-center justify-between border-b border-[#e5e5e5] bg-[#fafafa] px-6 py-2.5 gap-4">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setActiveTab("categories");
                setEditingId(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "categories"
                  ? "bg-white text-[#4a38f5] shadow-2xs border border-[#e5e5e5]"
                  : "text-[#666666] hover:bg-[#f0f0f0]",
              )}
            >
              <Layers className="h-3.5 w-3.5" />
              <span>Категории ({categoriesList.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("brands");
                setEditingId(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "brands"
                  ? "bg-white text-[#4a38f5] shadow-2xs border border-[#e5e5e5]"
                  : "text-[#666666] hover:bg-[#f0f0f0]",
              )}
            >
              <Tag className="h-3.5 w-3.5" />
              <span>Бренды ({brandsList.length})</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab("models");
                setEditingId(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                activeTab === "models"
                  ? "bg-white text-[#4a38f5] shadow-2xs border border-[#e5e5e5]"
                  : "text-[#666666] hover:bg-[#f0f0f0]",
              )}
            >
              <Cpu className="h-3.5 w-3.5" />
              <span>Модели ({modelsList.length})</span>
            </button>
          </div>

          <div className="relative w-48">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск..."
              className="h-7 w-full rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>
        </div>

        {/* Tab Content */}
        <div className="flex flex-1 flex-col overflow-hidden p-6">
          {/* TAB 1: CATEGORIES */}
          {activeTab === "categories" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <form onSubmit={handleAddCategory} className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder="Новая категория (например: Дисплеи, Химия)..."
                  className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newCategoryName.trim() || createCategoryMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Добавить</span>
                </button>
              </form>

              <div className="flex-1 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0]">
                {filteredCategories.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#888888]">
                    {search ? "Ничего не найдено" : "Справочник категорий пуст"}
                  </div>
                ) : (
                  filteredCategories.map((cat) => {
                    const isEditing = editingId === cat.id;
                    return (
                      <div
                        key={cat.id}
                        className="flex items-center justify-between px-3.5 py-2 hover:bg-[#fafafa] transition-colors"
                      >
                        {isEditing ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              autoFocus
                              className="h-7 flex-1 rounded border border-[#4a38f5] px-2 text-xs text-[#111111] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameCategory(cat.id)}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                              title="Сохранить"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title="Отмена"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-medium text-[#111111]">
                              {cat.name}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(cat.id);
                                  setEditingName(cat.name);
                                }}
                                className="rounded p-1 text-slate-400 hover:text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                                title="Переименовать"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCategory(cat.id, cat.name)}
                                className="rounded p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Удалить"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 2: BRANDS */}
          {activeTab === "brands" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <form onSubmit={handleAddBrand} className="mb-4 flex gap-2">
                <input
                  type="text"
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  placeholder="Новый бренд (например: Apple, Samsung, Toua)..."
                  className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!newBrandName.trim() || createBrandMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Добавить</span>
                </button>
              </form>

              <div className="flex-1 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0]">
                {filteredBrands.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#888888]">
                    {search ? "Ничего не найдено" : "Справочник брендов пуст"}
                  </div>
                ) : (
                  filteredBrands.map((b) => {
                    const isEditing = editingId === b.id;
                    return (
                      <div
                        key={b.id}
                        className="flex items-center justify-between px-3.5 py-2 hover:bg-[#fafafa] transition-colors"
                      >
                        {isEditing ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              autoFocus
                              className="h-7 flex-1 rounded border border-[#4a38f5] px-2 text-xs text-[#111111] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameBrand(b.id)}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                              title="Сохранить"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title="Отмена"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <span className="text-xs font-medium text-[#111111]">
                              {b.name}
                            </span>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(b.id);
                                  setEditingName(b.name);
                                }}
                                className="rounded p-1 text-slate-400 hover:text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                                title="Переименовать"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteBrand(b.id, b.name)}
                                className="rounded p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Удалить"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* TAB 3: MODELS */}
          {activeTab === "models" && (
            <div className="flex flex-1 flex-col overflow-hidden">
              <form onSubmit={handleAddModel} className="mb-4 flex gap-2">
                <select
                  value={selectedBrandForModel}
                  onChange={(e) => setSelectedBrandForModel(e.target.value)}
                  className="h-8 w-44 rounded-[8px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">Все бренды</option>
                  {brandsList.map((b) => (
                    <option key={b.id} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </select>

                <input
                  type="text"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="Новая модель оборудования (например: GSN50+)..."
                  className="h-8 flex-1 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                />

                <button
                  type="submit"
                  disabled={!newModelName.trim() || createModelMutation.isPending}
                  className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Добавить</span>
                </button>
              </form>

              <div className="flex-1 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0]">
                {filteredModels.length === 0 ? (
                  <div className="p-8 text-center text-xs text-[#888888]">
                    {search ? "Ничего не найдено" : "Справочник моделей пуст"}
                  </div>
                ) : (
                  filteredModels.map((m) => {
                    const isEditing = editingId === m.id;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between px-3.5 py-2 hover:bg-[#fafafa] transition-colors"
                      >
                        {isEditing ? (
                          <div className="flex flex-1 items-center gap-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              autoFocus
                              className="h-7 flex-1 rounded border border-[#4a38f5] px-2 text-xs text-[#111111] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleRenameModel(m.id)}
                              className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
                              title="Сохранить"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-100"
                              title="Отмена"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-medium text-[#111111]">
                                {m.name}
                              </span>
                              {m.brandName && (
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 border border-slate-200">
                                  {m.brandName}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingId(m.id);
                                  setEditingName(m.name);
                                }}
                                className="rounded p-1 text-slate-400 hover:text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                                title="Переименовать"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteModel(m.id, m.name)}
                                className="rounded p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Удалить"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
