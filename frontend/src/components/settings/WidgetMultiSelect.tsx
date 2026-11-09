"use client";

import { useId } from "react";
import { Check, Globe, Layers, SlidersHorizontal } from "lucide-react";
import { TagPill } from "@/components/ui/tag";
import { type SimpleWidgetDTO } from "@/lib/api/use-bitrix24";

interface WidgetMultiSelectProps {
  widgets: SimpleWidgetDTO[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
}

export function WidgetMultiSelect({
  widgets,
  selectedIds,
  onChange,
  disabled = false,
  isLoading = false,
}: WidgetMultiSelectProps) {
  const isSpecificMode = selectedIds.length > 0;
  const radioName = useId();

  const handleModeChange = (specific: boolean) => {
    if (!specific) {
      // Режим «Все виджеты» — пустой массив означает отсутствие ограничений
      onChange([]);
    } else {
      // Режим «Выбранные виджеты» — если ничего не выбрано, выбираем все по умолчанию для удобства
      if (widgets.length > 0 && selectedIds.length === 0) {
        onChange(widgets.map((w) => w.id));
      }
    }
  };

  const toggleWidget = (widgetId: string) => {
    if (selectedIds.includes(widgetId)) {
      const next = selectedIds.filter((id) => id !== widgetId);
      onChange(next);
    } else {
      onChange([...selectedIds, widgetId]);
    }
  };

  const handleSelectAll = () => {
    onChange(widgets.map((w) => w.id));
  };

  const handleClearAll = () => {
    onChange([]);
  };

  if (isLoading) {
    return (
      <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#888888] animate-pulse">
        Загрузка виджетов тенанта...
      </div>
    );
  }

  if (widgets.length === 0) {
    return (
      <div className="rounded-[8px] border border-dashed border-[#e5e5e5] bg-[#fafafa] p-3 text-xs text-[#666666] flex items-center gap-2">
        <Globe className="h-4 w-4 text-[#888888] shrink-0" />
        <span>Онлайн-виджеты пока не созданы. Лиды будут поступать со всех будущих виджетов.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <label className="text-xs font-medium text-[#111111] flex items-center gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5 text-[#4a38f5]" />
          <span>Фильтрация по виджетам на сайтах</span>
        </label>

        {isSpecificMode && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-[#666666]">
              Выбрано: <strong className="text-[#111111]">{selectedIds.length}</strong> из {widgets.length}
            </span>
            <span className="text-[#cccccc]">|</span>
            <button
              type="button"
              onClick={handleSelectAll}
              disabled={disabled || selectedIds.length === widgets.length}
              className="text-[#4a38f5] hover:underline disabled:opacity-40"
            >
              Все
            </button>
            <span className="text-[#cccccc]">·</span>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={disabled || selectedIds.length === 0}
              className="text-[#666666] hover:text-rose-600 hover:underline disabled:opacity-40"
            >
              Сброс
            </button>
          </div>
        )}
      </div>

      {/* Переключатель: Все виджеты vs Конкретные */}
      <div className="grid grid-cols-2 gap-2">
        <label
          className={`flex items-center gap-2.5 p-2.5 rounded-[8px] border cursor-pointer transition-colors text-xs ${
            !isSpecificMode
              ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111] font-medium"
              : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]"
          } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <input
            type="radio"
            name={radioName}
            checked={!isSpecificMode}
            onChange={() => handleModeChange(false)}
            className="sr-only"
            disabled={disabled}
          />
          <div
            className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
              !isSpecificMode ? "border-[#4a38f5] bg-[#4a38f5]" : "border-[#cccccc] bg-white"
            }`}
          >
            {!isSpecificMode && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
          <div>
            <span className="block leading-tight">Все виджеты</span>
            <span className="text-[10px] text-[#888888] block mt-0.5">Экспорт с любых лендингов и сайтов</span>
          </div>
        </label>

        <label
          className={`flex items-center gap-2.5 p-2.5 rounded-[8px] border cursor-pointer transition-colors text-xs ${
            isSpecificMode
              ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#111111] font-medium"
              : "border-[#e5e5e5] bg-white text-[#666666] hover:bg-[#fafafa]"
          } ${disabled ? "opacity-50 pointer-events-none" : ""}`}
        >
          <input
            type="radio"
            name={radioName}
            checked={isSpecificMode}
            onChange={() => handleModeChange(true)}
            className="sr-only"
            disabled={disabled}
          />
          <div
            className={`h-4 w-4 rounded-full border flex items-center justify-center shrink-0 ${
              isSpecificMode ? "border-[#4a38f5] bg-[#4a38f5]" : "border-[#cccccc] bg-white"
            }`}
          >
            {isSpecificMode && <div className="h-1.5 w-1.5 rounded-full bg-white" />}
          </div>
          <div>
            <span className="block leading-tight">Выбранные виджеты</span>
            <span className="text-[10px] text-[#888888] block mt-0.5">Только отмеченные в списке ниже</span>
          </div>
        </label>
      </div>

      {/* Список конкретных виджетов с чекбоксами */}
      {isSpecificMode && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white divide-y divide-[#f0f0f0] max-h-56 overflow-y-auto">
          {widgets.map((widget) => {
            const isChecked = selectedIds.includes(widget.id);
            return (
              <label
                key={widget.id}
                className={`flex items-center justify-between p-2.5 text-xs cursor-pointer hover:bg-[#fafafa] transition-colors ${
                  isChecked ? "bg-black/[0.02]" : ""
                } ${disabled ? "pointer-events-none opacity-50" : ""}`}
              >
                <div className="flex items-center gap-2.5 min-w-0 pr-2">
                  <div
                    onClick={(e) => {
                      e.preventDefault();
                      toggleWidget(widget.id);
                    }}
                    className={`h-4 w-4 rounded-[4px] border flex items-center justify-center shrink-0 transition-colors ${
                      isChecked
                        ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                        : "border-[#cccccc] bg-white hover:border-[#999999]"
                    }`}
                  >
                    {isChecked && <Check className="h-3 w-3 stroke-[3]" />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-medium text-[#111111] truncate">{widget.name}</span>
                      {widget.status === "connected" && (
                        <TagPill color="emerald" className="scale-90 origin-left">
                          Активен
                        </TagPill>
                      )}
                    </div>
                    {widget.site_domain && (
                      <span className="text-[11px] text-[#888888] font-mono block truncate">
                        {widget.site_domain}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0 flex items-center gap-1 text-[11px] text-[#888888]">
                  <Layers className="h-3 w-3 text-[#aaaaaa]" />
                  <span className="font-mono text-[10px]">{widget.id.slice(0, 8)}...</span>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
