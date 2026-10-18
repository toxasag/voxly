"use client";

import { useState, useCallback, type KeyboardEvent } from "react";
import { Wrench, Plus, Trash2, User } from "lucide-react";
import type { WorkItem } from "@/lib/repairs/repairs.types";
import { MOCK_MASTERS } from "@/lib/repairs/mock-repairs";
import { cn } from "@/lib/utils";

interface WorkItemsTableProps {
  items: WorkItem[];
  onChange: (items: WorkItem[]) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function WorkItemsTable({ items, onChange }: WorkItemsTableProps) {
  const [newDesc, setNewDesc] = useState("");
  const [newMaster, setNewMaster] = useState("");
  const [newCost, setNewCost] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const totalWork = items.reduce((sum, item) => sum + item.cost, 0);

  const handleAdd = useCallback(() => {
    const desc = newDesc.trim();
    const costNum = parseFloat(newCost);
    if (!desc || !newMaster || isNaN(costNum) || costNum < 0) return;

    const master = MOCK_MASTERS.find((m) => m.id === newMaster);
    const newItem: WorkItem = {
      id: `wi${Date.now()}`,
      description: desc,
      master_name: master?.name ?? "Не назначен",
      master_id: newMaster,
      cost: costNum,
    };

    onChange([...items, newItem]);
    setNewDesc("");
    setNewMaster("");
    setNewCost("");
  }, [newDesc, newMaster, newCost, items, onChange]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleAdd();
      }
    },
    [handleAdd],
  );

  const handleDelete = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id));
    },
    [items, onChange],
  );

  const canAdd = newDesc.trim() && newMaster && newCost && !isNaN(parseFloat(newCost)) && parseFloat(newCost) >= 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
        <Wrench className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-200">Выполненные работы</span>
        <span className="ml-auto text-xs text-slate-600">{items.length} позиций</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-800">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">
                Описание
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-[140px]">
                Мастер
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-[100px]">
                Стоимость
              </th>
              <th className="px-4 py-2.5 w-[48px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {items.map((item) => (
              <tr key={item.id} className="transition-colors hover:bg-slate-800/30">
                <td className="px-4 py-3">
                  <p className="text-sm text-slate-300">{item.description}</p>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <User className="h-3 w-3 text-slate-500" />
                    <span className="text-xs text-slate-400">{item.master_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-sm font-semibold text-slate-200">
                    {formatCost(item.cost)}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    onClick={() => handleDelete(item.id)}
                    className="rounded p-1 text-slate-600 hover:text-rose-400 hover:bg-slate-800 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center">
                  <p className="text-sm text-slate-600">Работы пока не добавлены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Row */}
      <div className="border-t border-slate-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Описание работы..."
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          />
          <select
            value={newMaster}
            onChange={(e) => setNewMaster(e.target.value)}
            className="w-[140px] rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 appearance-none focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20"
          >
            <option value="" disabled>
              Мастер...
            </option>
            {MOCK_MASTERS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={0}
            value={newCost}
            onChange={(e) => setNewCost(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="0"
            className="w-[100px] rounded-lg border border-slate-700 bg-slate-950 py-2 px-3 text-sm text-slate-100 placeholder:text-slate-500 text-right focus:border-[#4a38f5] focus:outline-none focus:ring-2 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={cn(
              "shrink-0 rounded-lg p-2 transition-colors",
              canAdd
                ? "bg-[#4a38f5] text-white hover:bg-[#3b2be0]"
                : "bg-slate-800 text-slate-600 cursor-not-allowed",
            )}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Total */}
      {items.length > 0 && (
        <div className="border-t border-slate-800 px-4 py-3 flex items-center justify-end">
          <span className="text-xs text-slate-500 mr-2">Итого по работам:</span>
          <span className="text-sm font-bold text-amber-400">{formatCost(totalWork)}</span>
        </div>
      )}
    </div>
  );
}