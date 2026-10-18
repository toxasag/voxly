"use client";

import { useState, useCallback } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
import type { PartItem } from "@/lib/repairs/repairs.types";
import { cn } from "@/lib/utils";

interface PartsTableProps {
  items: PartItem[];
  onChange: (items: PartItem[]) => void;
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PartsTable({ items, onChange }: PartsTableProps) {
  const [newName, setNewName] = useState("");
  const [newArticle, setNewArticle] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newRetail, setNewRetail] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");

  const handleAdd = useCallback(() => {
    const name = newName.trim();
    const article = newArticle.trim();
    const qtyNum = parseInt(newQty);
    const retailNum = parseFloat(newRetail);
    const costNum = parseFloat(newCostPrice);

    if (!name || !article || isNaN(qtyNum) || qtyNum < 1 || isNaN(retailNum) || retailNum < 0 || isNaN(costNum) || costNum < 0) return;

    const newItem: PartItem = {
      id: `p${Date.now()}`,
      name,
      article,
      quantity: qtyNum,
      retail_price: retailNum,
      cost_price: costNum,
    };

    onChange([...items, newItem]);
    setNewName("");
    setNewArticle("");
    setNewQty("");
    setNewRetail("");
    setNewCostPrice("");
  }, [newName, newArticle, newQty, newRetail, newCostPrice, items, onChange]);

  const handleDelete = useCallback(
    (id: string) => {
      onChange(items.filter((item) => item.id !== id));
    },
    [items, onChange],
  );

  const canAdd =
    newName.trim() &&
    newArticle.trim() &&
    newQty &&
    !isNaN(parseInt(newQty)) &&
    parseInt(newQty) >= 1 &&
    newRetail &&
    !isNaN(parseFloat(newRetail)) &&
    parseFloat(newRetail) >= 0 &&
    newCostPrice &&
    !isNaN(parseFloat(newCostPrice)) &&
    parseFloat(newCostPrice) >= 0;

  return (
    <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
        <Package className="h-4 w-4 text-[#666666]" />
        <span className="text-sm font-semibold text-[#111111]">Использованные запчасти</span>
        <span className="ml-auto text-xs text-[#888888]">{items.length} позиций</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                Запчасть
              </th>
              <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                Артикул
              </th>
              <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[70px]">
                Кол-во
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                Розница
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                Закупка
              </th>
              <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[80px]">
                Наценка
              </th>
              <th className="px-4 py-2.5 w-[48px]" />
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {items.map((item) => {
              const margin = item.retail_price - item.cost_price;
              const marginPct = item.cost_price > 0
                ? Math.round((margin / item.retail_price) * 100)
                : 0;

              return (
                <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                  <td className="px-4 py-3">
                    <p className="text-[13px] text-[#111111]">{item.name}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-mono text-[#666666]">{item.article}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-[13px] text-[#111111]">{item.quantity}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[13px] font-semibold text-[#111111] font-mono">
                      {formatCost(item.retail_price)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[13px] text-[#666666] font-mono">
                      {formatCost(item.cost_price)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div>
                      <span className="text-[13px] font-semibold text-emerald-700 font-mono">
                        {formatCost(margin)}
                      </span>
                      <span className="block text-xs text-emerald-700/80">
                        {marginPct}%
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center">
                  <p className="text-sm text-[#888888]">Запчасти пока не добавлены.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add Row */}
      <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название запчасти..."
            className="flex-1 rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <input
            type="text"
            value={newArticle}
            onChange={(e) => setNewArticle(e.target.value)}
            placeholder="Артикул..."
            className="w-[110px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
          <input
            type="number"
            min={1}
            value={newQty}
            onChange={(e) => setNewQty(e.target.value)}
            placeholder="1"
            className="w-[60px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-center text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <input
            type="number"
            min={0}
            value={newRetail}
            onChange={(e) => setNewRetail(e.target.value)}
            placeholder="Розница"
            className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-right text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <input
            type="number"
            min={0}
            value={newCostPrice}
            onChange={(e) => setNewCostPrice(e.target.value)}
            placeholder="Закупка"
            className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-3 text-[13px] text-right text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            className={cn(
              "shrink-0 rounded-[8px] p-2 transition-colors",
              canAdd
                ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0]"
                : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
            )}
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}