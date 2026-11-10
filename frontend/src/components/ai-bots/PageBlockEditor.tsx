"use client";

import { useId, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Coins,
  FileText,
  HelpCircle,
  Phone,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";

import { TagPill } from "@/components/ui/tag";
import {
  BLOCK_TYPE_CONFIG,
  type ContentBlock,
  type ContentBlockType,
} from "@/lib/ai-bots/block-parser";
import { cn } from "@/lib/utils";

interface PageBlockEditorProps {
  blocks: ContentBlock[];
  onChange: (blocks: ContentBlock[]) => void;
  canEdit: boolean;
}

export function PageBlockEditor({
  blocks,
  onChange,
  canEdit,
}: PageBlockEditorProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const editorUniqueId = useId();

  // Общее количество символов во всех секциях
  const totalChars = useMemo(() => {
    return blocks.reduce((sum, b) => sum + (b.content?.length || 0), 0);
  }, [blocks]);

  // Фильтрация блоков по поиску
  const filteredBlocksWithOriginalIndex = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return blocks
      .map((block, originalIndex) => ({ block, originalIndex }))
      .filter(({ block }) => {
        if (!q) return true;
        return (
          block.title.toLowerCase().includes(q) ||
          block.content.toLowerCase().includes(q)
        );
      });
  }, [blocks, searchQuery]);

  // Управление блоками
  const handleUpdateBlock = (
    index: number,
    patch: Partial<Omit<ContentBlock, "id">>
  ) => {
    if (!canEdit) return;
    const next = [...blocks];
    next[index] = { ...next[index], ...patch };
    onChange(next);
  };

  const handleToggleCollapse = (index: number) => {
    const next = [...blocks];
    next[index] = { ...next[index], collapsed: !next[index].collapsed };
    onChange(next);
  };

  const handleCollapseAll = (collapsed: boolean) => {
    const next = blocks.map((b) => ({ ...b, collapsed }));
    onChange(next);
  };

  const handleMoveUp = (index: number) => {
    if (!canEdit || index <= 0) return;
    const next = [...blocks];
    const temp = next[index];
    next[index] = next[index - 1];
    next[index - 1] = temp;
    onChange(next);
  };

  const handleMoveDown = (index: number) => {
    if (!canEdit || index >= blocks.length - 1) return;
    const next = [...blocks];
    const temp = next[index];
    next[index] = next[index + 1];
    next[index + 1] = temp;
    onChange(next);
  };

  const handleDeleteBlock = (index: number) => {
    if (!canEdit) return;
    const next = blocks.filter((_, i) => i !== index);
    onChange(next);
  };

  const handleInsertBlock = (
    afterIndex: number,
    type: ContentBlockType = "section"
  ) => {
    if (!canEdit) return;
    const newBlock: ContentBlock = {
      id: `block_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type,
      title: type === "faq" ? "Вопрос-ответ" : type === "pricing" ? "Тарифы и цены" : "Новая секция",
      content: "",
      collapsed: false,
    };

    const next = [...blocks];
    next.splice(afterIndex + 1, 0, newBlock);
    onChange(next);
  };

  const handleCleanWhitespace = (index: number) => {
    if (!canEdit) return;
    const content = blocks[index].content;
    const cleaned = content
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    handleUpdateBlock(index, { content: cleaned });
  };

  const handleInsertTemplate = (index: number, template: string) => {
    if (!canEdit) return;
    const current = blocks[index].content.trim();
    const updated = current ? `${current}\n\n${template}` : template;
    handleUpdateBlock(index, { content: updated });
  };

  const renderTypeIcon = (type: ContentBlockType) => {
    switch (type) {
      case "hero":
        return <Sparkles className="h-3 w-3 shrink-0" />;
      case "pricing":
        return <Coins className="h-3 w-3 shrink-0" />;
      case "faq":
        return <HelpCircle className="h-3 w-3 shrink-0" />;
      case "contacts":
        return <Phone className="h-3 w-3 shrink-0" />;
      case "section":
      default:
        return <FileText className="h-3 w-3 shrink-0" />;
    }
  };

  return (
    <div className="space-y-3">
      {/* Панель управления и статистика */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-2.5 text-xs text-[#666666]">
        <div className="flex items-center gap-3">
          <span>
            Секций:{" "}
            <strong className="font-mono text-[#111111]">{blocks.length}</strong>
          </span>
          <span>·</span>
          <span>
            Символов:{" "}
            <strong className="font-mono text-[#111111]">
              {totalChars.toLocaleString("ru-RU")}
            </strong>
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Быстрый поиск по секциям */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#888888]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по секциям..."
              className="h-7 w-40 rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-2.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 md:w-52"
            />
          </div>

          <button
            type="button"
            onClick={() => handleCollapseAll(true)}
            className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
          >
            Свернуть все
          </button>
          <button
            type="button"
            onClick={() => handleCollapseAll(false)}
            className="rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-[11px] font-medium text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
          >
            Развернуть
          </button>
        </div>
      </div>

      {/* Список блоков */}
      {filteredBlocksWithOriginalIndex.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fbfbfb] p-8 text-center text-[#888888]">
          <FileText className="mb-2 h-8 w-8 text-[#cccccc]" />
          <p className="text-xs font-medium text-[#111111]">
            {searchQuery ? "Ничего не найдено по запросу" : "Нет секций"}
          </p>
          <p className="mt-1 text-[11px] text-[#888888]">
            {searchQuery
              ? "Попробуйте изменить поисковую фразу или очистить поиск"
              : "Создайте первую секцию или переключитесь в режим Сырой Markdown"}
          </p>
          {canEdit && (
            <button
              type="button"
              onClick={() => handleInsertBlock(-1)}
              className="mt-3.5 flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить первую секцию
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredBlocksWithOriginalIndex.map(({ block, originalIndex }) => {
            const isFirst = originalIndex === 0;
            const isLast = originalIndex === blocks.length - 1;
            const meta = BLOCK_TYPE_CONFIG[block.type] || BLOCK_TYPE_CONFIG.section;
            const blockChars = block.content.length;

            return (
              <div key={block.id} className="space-y-2">
                <div
                  className={cn(
                    "rounded-[8px] border bg-white shadow-2xs transition-all duration-150 overflow-hidden",
                    block.collapsed
                      ? "border-[#e5e5e5] hover:border-[#cccccc]"
                      : "border-[#d8d8d8] ring-1 ring-black/[0.03]"
                  )}
                >
                  {/* Заголовок карточки блока */}
                  <div className="flex items-center justify-between gap-2 bg-[#fdfdfd] px-3.5 py-2.5 border-b border-[#f0f0f0]">
                    {/* Левая часть: Номер + Тип + Инпут названия */}
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      {/* Номер секции */}
                      <span className="shrink-0 rounded-[4px] bg-[#f0f0f0] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#666666]">
                        #{originalIndex + 1}
                      </span>

                      {/* Селектор типа секции */}
                      <div className="relative shrink-0">
                        <select
                          value={block.type}
                          onChange={(e) =>
                            handleUpdateBlock(originalIndex, {
                              type: e.target.value as ContentBlockType,
                            })
                          }
                          disabled={!canEdit}
                          className="absolute inset-0 z-10 w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                          title="Изменить семантический тип блока"
                        >
                          {Object.values(BLOCK_TYPE_CONFIG).map((cfg) => (
                            <option key={cfg.type} value={cfg.type}>
                              {cfg.label}
                            </option>
                          ))}
                        </select>
                        <TagPill color={meta.color} className="cursor-pointer gap-1 py-1">
                          {renderTypeIcon(block.type)}
                          <span>{meta.shortLabel}</span>
                          <ChevronDown className="h-2.5 w-2.5 opacity-60" />
                        </TagPill>
                      </div>

                      {/* Название секции */}
                      <input
                        type="text"
                        value={block.title}
                        onChange={(e) =>
                          handleUpdateBlock(originalIndex, { title: e.target.value })
                        }
                        disabled={!canEdit}
                        placeholder="Название секции (например, Условия банкротства)..."
                        className="flex-1 min-w-0 truncate rounded-[6px] border border-transparent bg-transparent px-2 py-0.5 text-xs font-semibold text-[#111111] placeholder:text-[#aaaaaa] hover:border-[#e5e5e5] focus:border-[#4a38f5] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:hover:border-transparent"
                      />
                    </div>

                    {/* Правая часть: Символы + Перемещение + Сворачивание + Удаление */}
                    <div className="flex items-center gap-1 shrink-0 text-[#666666]">
                      <span className="hidden font-mono text-[11px] text-[#888888] sm:inline-block mr-1">
                        {blockChars.toLocaleString("ru-RU")} симв.
                      </span>

                      {/* Кнопки вверх/вниз */}
                      {canEdit && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleMoveUp(originalIndex)}
                            disabled={isFirst}
                            title="Переместить вверх"
                            className="rounded-[4px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveDown(originalIndex)}
                            disabled={isLast}
                            title="Переместить вниз"
                            className="rounded-[4px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111] disabled:opacity-30 disabled:hover:bg-transparent"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}

                      {/* Развернуть / Свернуть */}
                      <button
                        type="button"
                        onClick={() => handleToggleCollapse(originalIndex)}
                        title={block.collapsed ? "Развернуть" : "Свернуть"}
                        className="rounded-[4px] p-1 text-[#888888] hover:bg-[#f0f0f0] hover:text-[#111111]"
                      >
                        {block.collapsed ? (
                          <ChevronRight className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {/* Удаление блока */}
                      {canEdit && (
                        <button
                          type="button"
                          onClick={() => handleDeleteBlock(originalIndex)}
                          title="Удалить секцию"
                          className="rounded-[4px] p-1 text-[#888888] hover:bg-rose-50 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Тело блока (редактируемый текст) */}
                  {!block.collapsed && (
                    <div className="p-3.5 space-y-2.5 bg-white">
                      <textarea
                        value={block.content}
                        onChange={(e) =>
                          handleUpdateBlock(originalIndex, { content: e.target.value })
                        }
                        disabled={!canEdit}
                        rows={Math.min(
                          18,
                          Math.max(4, (block.content || "").split("\n").length + 1)
                        )}
                        placeholder={`Текст секции «${block.title || "без названия"}» (поддерживается разметка Markdown)...`}
                        className="w-full resize-y rounded-[6px] border border-[#e5e5e5] bg-[#fafafa]/50 p-3 font-mono text-xs leading-relaxed text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 disabled:bg-[#fbfbfb]"
                      />

                      {/* Панель быстрых подсказок и форматирования */}
                      {canEdit && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#f5f5f5] text-[11px] text-[#888888]">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] uppercase font-semibold text-[#aaaaaa]">
                              Вставить:
                            </span>

                            {block.type === "faq" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleInsertTemplate(
                                    originalIndex,
                                    "**Вопрос:** \n**Ответ:** "
                                  )
                                }
                                className="rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
                              >
                                + Вопрос-ответ
                              </button>
                            ) : block.type === "pricing" ? (
                              <button
                                type="button"
                                onClick={() =>
                                  handleInsertTemplate(
                                    originalIndex,
                                    "- **Услуга / Тариф:** 0 ₽ — подробное описание условий"
                                  )
                                }
                                className="rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
                              >
                                + Позиция прайса
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() =>
                                  handleInsertTemplate(
                                    originalIndex,
                                    "- Важный пункт или условие\n- Дополнительный пункт"
                                  )
                                }
                                className="rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
                              >
                                + Буллеты
                              </button>
                            )}

                            <button
                              type="button"
                              onClick={() => handleCleanWhitespace(originalIndex)}
                              title="Удалить лишние множественные пробелы и пустые строки"
                              className="flex items-center gap-1 rounded-[4px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-[#666666] hover:bg-[#f5f5f5] hover:text-[#111111] transition-colors"
                            >
                              <Wand2 className="h-3 w-3 text-[#4a38f5]" />
                              Очистить лишние пробелы
                            </button>
                          </div>

                          <div className="font-mono text-[#888888]">
                            Строк: {(block.content || "").split("\n").length}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Тонкий разделитель для добавления секции между блоками */}
                {canEdit && (
                  <div className="group/divider relative flex items-center justify-center py-1">
                    <div className="absolute inset-x-0 h-px bg-transparent group-hover/divider:bg-[#e5e5e5] transition-colors" />
                    <button
                      type="button"
                      onClick={() => handleInsertBlock(originalIndex)}
                      className="relative z-10 hidden group-hover/divider:flex items-center gap-1 rounded-full border border-[#e5e5e5] bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#666666] shadow-xs hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors"
                    >
                      <Plus className="h-3 w-3" />
                      Вставить секцию сюда
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Кнопка добавления новой секции в конец */}
      {canEdit && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => handleInsertBlock(blocks.length - 1)}
            className="flex w-full items-center justify-center gap-2 rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] py-3 text-xs font-medium text-[#666666] hover:border-[#4a38f5] hover:bg-white hover:text-[#4a38f5] transition-all duration-150"
          >
            <Plus className="h-4 w-4" />
            Добавить секцию в конец страницы
          </button>
        </div>
      )}
    </div>
  );
}
