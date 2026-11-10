"use client";

import { useState, useMemo, Suspense } from "react";
import Link from "next/link";
import {
  Boxes,
  Plus,
  ArrowDownToLine,
  Search,
  ShoppingCart,
  ArrowRightLeft,
  Receipt,
  AlertCircle,
  CheckCircle2,
  Trash2,
  ExternalLink,
  Loader2,
  Clock,
  Check,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Guard } from "@/components/shared/Guard";
import {
  useWarehouseItems,
  useWarehouseBatches,
  useWarehouseMovements,
  usePurchaseRequests,
  useDeleteWarehouseItem,
  useUpdatePurchaseRequest,
  type WarehouseItemDTO,
  type PurchaseRequestDTO,
} from "@/lib/api/use-warehouse";
import { CreateItemModal } from "@/components/warehouse/CreateItemModal";
import { IntakeModal } from "@/components/warehouse/IntakeModal";
import { cn } from "@/lib/utils";

type WarehouseTab = "items" | "batches" | "purchases" | "movements";

const TABS: { key: WarehouseTab; label: string; icon: typeof Boxes }[] = [
  { key: "items", label: "Остатки и номенклатура", icon: Boxes },
  { key: "batches", label: "Партии и приходные накладные", icon: Receipt },
  { key: "purchases", label: "Заявки на закупку", icon: ShoppingCart },
  { key: "movements", label: "Журнал движений", icon: ArrowRightLeft },
];

function formatRub(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function WarehouseContent() {
  const [activeTab, setActiveTab] = useState<WarehouseTab>("items");
  const [searchQuery, setSearchQuery] = useState("");
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<string>("all");

  const [createItemModalOpen, setCreateItemModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [intakeInitialItem, setIntakeInitialItem] = useState<WarehouseItemDTO | null>(null);
  const [intakePurchaseRequest, setIntakePurchaseRequest] = useState<PurchaseRequestDTO | null>(null);

  // Данные
  const { data: items = [], isLoading: isItemsLoading } = useWarehouseItems();
  const { data: batches = [], isLoading: isBatchesLoading } = useWarehouseBatches();
  const { data: movements = [], isLoading: isMovementsLoading } = useWarehouseMovements();
  const { data: purchaseRequests = [], isLoading: isPurchasesLoading } = usePurchaseRequests();

  const deleteItemMutation = useDeleteWarehouseItem();
  const updatePurchaseMutation = useUpdatePurchaseRequest();

  // Фильтрация номенклатуры
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  // Фильтрация заявок
  const filteredPurchases = useMemo(() => {
    return purchaseRequests.filter((pr) => {
      if (purchaseStatusFilter !== "all" && pr.status !== purchaseStatusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return pr.itemName.toLowerCase().includes(q) || pr.sku.toLowerCase().includes(q);
    });
  }, [purchaseRequests, purchaseStatusFilter, searchQuery]);

  // Статистика склада
  const stats = useMemo(() => {
    const totalItemsCount = items.length;
    const lowStockCount = items.filter((i) => i.availableStock <= i.minStock).length;
    const totalValuation = items.reduce((sum, i) => sum + i.totalStock * i.costPrice, 0);
    const pendingPurchasesCount = purchaseRequests.filter(
      (p) => p.status === "pending" || p.status === "ordered",
    ).length;

    return { totalItemsCount, lowStockCount, totalValuation, pendingPurchasesCount };
  }, [items, purchaseRequests]);

  const handleDeleteItem = async (item: WarehouseItemDTO) => {
    if (item.totalStock > 0 || item.reservedStock > 0) {
      toast.error(`Нельзя удалить товар с ненулевым остатком (в наличии: ${item.totalStock})`);
      return;
    }
    if (!confirm(`Удалить товар «${item.name}» из номенклатуры?`)) return;

    try {
      await deleteItemMutation.mutateAsync(item.id);
      toast.success(`Товар «${item.name}» удален`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении товара");
    }
  };

  const handleOpenIntakeForItem = (item: WarehouseItemDTO) => {
    setIntakeInitialItem(item);
    setIntakePurchaseRequest(null);
    setIntakeModalOpen(true);
  };

  const handleOpenIntakeForPurchase = (pr: PurchaseRequestDTO) => {
    setIntakeInitialItem(null);
    setIntakePurchaseRequest(pr);
    setIntakeModalOpen(true);
  };

  const handleStatusChange = async (prId: string, status: "pending" | "ordered" | "received" | "cancelled") => {
    try {
      await updatePurchaseMutation.mutateAsync({
        id: prId,
        payload: { status },
      });
      toast.success("Статус заявки обновлен");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить статус");
    }
  };

  return (
    <div className="space-y-5 p-6">
      {/* Header Twenty CRM Light */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 border border-amber-200">
            <Boxes className="h-5 w-5 text-amber-700" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#111111]">Складской учет</h1>
            <p className="text-xs text-[#666666]">
              Номенклатура, партионный учет (FIFO), резервирование под наряды и заявки на закупку
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setIntakeInitialItem(null);
              setIntakePurchaseRequest(null);
              setIntakeModalOpen(true);
            }}
            className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-[13px] font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors"
          >
            <ArrowDownToLine className="h-4 w-4" />
            Оприходовать партию
          </button>
          <button
            type="button"
            onClick={() => setCreateItemModalOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors"
          >
            <Plus className="h-4 w-4" />
            Создать товар
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-medium text-[#888888] uppercase tracking-wider">
            Всего номенклатуры
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-[#111111]">{stats.totalItemsCount}</div>
          <span className="text-[11px] text-[#666666]">активных позиций</span>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-medium text-[#888888] uppercase tracking-wider">
            Заканчивается / нет
          </span>
          <div
            className={cn(
              "mt-1 text-xl font-bold font-mono",
              stats.lowStockCount > 0 ? "text-rose-600" : "text-[#111111]",
            )}
          >
            {stats.lowStockCount}
          </div>
          <span className="text-[11px] text-[#666666]">ниже порога мин. запаса</span>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-medium text-[#888888] uppercase tracking-wider">
            Оценка склада (закупка)
          </span>
          <div className="mt-1 text-xl font-bold font-mono text-[#111111]">
            {formatRub(stats.totalValuation)}
          </div>
          <span className="text-[11px] text-[#666666]">по остаткам партий</span>
        </div>

        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3.5 shadow-2xs">
          <span className="text-[11px] font-medium text-[#888888] uppercase tracking-wider">
            Заявки на закупку
          </span>
          <div
            className={cn(
              "mt-1 text-xl font-bold font-mono",
              stats.pendingPurchasesCount > 0 ? "text-amber-600" : "text-[#111111]",
            )}
          >
            {stats.pendingPurchasesCount}
          </div>
          <span className="text-[11px] text-[#666666]">в ожидании поставки</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-[#e5e5e5]">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = activeTab === t.key;
          const badgeCount =
            t.key === "purchases" && stats.pendingPurchasesCount > 0 ? stats.pendingPurchasesCount : null;

          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors cursor-pointer",
                isActive
                  ? "border-[#4a38f5] text-[#4a38f5]"
                  : "border-transparent text-[#666666] hover:text-[#111111]",
              )}
            >
              <Icon className="h-4 w-4" />
              <span>{t.label}</span>
              {badgeCount !== null && (
                <span className="rounded-full bg-amber-100 px-1.5 py-0.2 text-[10px] font-semibold text-amber-800">
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Поисковая строка для активной вкладки */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию, артикулу..."
            className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
          />
        </div>

        {activeTab === "purchases" && (
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#888888]">Статус:</span>
            {(["all", "pending", "ordered", "received", "cancelled"] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setPurchaseStatusFilter(st)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium transition-colors",
                  purchaseStatusFilter === st
                    ? "bg-[#111111] text-white"
                    : "bg-[#fafafa] text-[#666666] hover:bg-[#f0f0f0]",
                )}
              >
                {st === "all"
                  ? "Все"
                  : st === "pending"
                  ? "В ожидании"
                  : st === "ordered"
                  ? "Заказано"
                  : st === "received"
                  ? "Поступило"
                  : "Отменено"}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Вкладка 1: Номенклатура и остатки */}
      {activeTab === "items" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Артикул
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Наименование
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                    Физический
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                    В резерве
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px]">
                    Доступно
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Себестоимость
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Розница
                  </th>
                  <th className="px-4 py-2.5 w-[110px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredItems.map((item) => {
                  const isOutOfStock = item.availableStock <= 0;
                  const isLowStock = item.availableStock > 0 && item.availableStock <= item.minStock;

                  return (
                    <tr key={item.id} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[#666666]">{item.sku}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[13px] text-[#111111]">{item.name}</div>
                        {item.category && (
                          <span className="text-[11px] text-[#888888]">{item.category}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[13px] text-[#111111]">
                          {item.totalStock} {item.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.reservedStock > 0 ? (
                          <span className="inline-flex rounded bg-amber-50 px-2 py-0.5 text-xs font-mono font-medium text-amber-800 border border-amber-200">
                            {item.reservedStock} {item.unit}
                          </span>
                        ) : (
                          <span className="text-xs text-[#888888] font-mono">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex rounded px-2 py-0.5 text-xs font-mono font-semibold border",
                            isOutOfStock
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : isLowStock
                              ? "bg-amber-50 text-amber-700 border-amber-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200",
                          )}
                        >
                          {item.availableStock} {item.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[13px] text-[#666666]">
                          {formatRub(item.costPrice)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[13px] font-semibold text-[#111111]">
                          {formatRub(item.retailPrice)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => handleOpenIntakeForItem(item)}
                            className="rounded p-1 text-[#888888] hover:text-emerald-700 hover:bg-emerald-50 transition-colors"
                            title="Оприходовать партию этого товара"
                          >
                            <ArrowDownToLine className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteItem(item)}
                            className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                            title="Удалить товар"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isItemsLoading ? "Загрузка каталога склада..." : "Товаров не найдено."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Вкладка 2: Партии и приходные накладные */}
      {activeTab === "batches" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[150px]">
                    Дата прихода
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[140px]">
                    Партия / Накладная
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Товар
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Поставщик
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Закупка/ед.
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                    Принято
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                    Остаток FIFO
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {batches.map((b) => (
                  <tr key={b.id} className="transition-colors hover:bg-[#fafafa]">
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#666666]">{formatDate(b.receivedAt)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs font-semibold text-[#111111]">
                        {b.batchNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[13px] font-medium text-[#111111]">
                        {b.itemName ?? "Товар"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-[#666666]">{b.supplierName || "—"}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-mono text-[13px] text-[#111111]">
                        {formatRub(b.purchasePrice)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="font-mono text-xs text-[#666666]">{b.initialQuantity}</span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold",
                          b.remainingQuantity > 0 ? "text-emerald-700" : "text-[#888888]",
                        )}
                      >
                        {b.remainingQuantity}
                      </span>
                    </td>
                  </tr>
                ))}
                {batches.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isBatchesLoading ? "Загрузка партий..." : "Партий пока не оприходовано."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Вкладка 3: Заявки на закупку */}
      {activeTab === "purchases" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[140px]">
                    Дата
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Запчасть / Товар
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[80px]">
                    Кол-во
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[140px]">
                    Наряд-заказ
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Ориент. цена
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Статус
                  </th>
                  <th className="px-4 py-2.5 w-[140px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredPurchases.map((pr) => {
                  const statusMap = {
                    pending: { label: "В ожидании", color: "bg-amber-50 text-amber-700 border-amber-200" },
                    ordered: { label: "Заказано", color: "bg-sky-50 text-sky-700 border-sky-200" },
                    received: { label: "Поступило", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                    cancelled: { label: "Отменено", color: "bg-rose-50 text-rose-700 border-rose-200" },
                  }[pr.status];

                  return (
                    <tr key={pr.id} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#666666]">{formatDate(pr.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[13px] text-[#111111]">{pr.itemName}</div>
                        <span className="font-mono text-[11px] text-[#888888]">{pr.sku}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[13px] text-[#111111]">
                          {pr.quantity} {pr.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pr.repairOrderId ? (
                          <Link
                            href={`/repairs/${pr.repairOrderId}`}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#4a38f5] hover:underline"
                          >
                            <span>Наряд №{pr.repairTicketNumber ?? "—"}</span>
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <span className="text-xs text-[#888888]">Складской резерв</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[13px] text-[#111111]">
                          {pr.estimatedPrice > 0 ? formatRub(pr.estimatedPrice) : "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex rounded px-2 py-0.5 text-xs font-semibold border",
                            statusMap.color,
                          )}
                        >
                          {statusMap.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {pr.status !== "received" && pr.status !== "cancelled" && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleOpenIntakeForPurchase(pr)}
                                className="inline-flex items-center gap-1 rounded bg-[#4a38f5] px-2 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors"
                                title="Оприходовать поступившую деталь"
                              >
                                <ArrowDownToLine className="h-3 w-3" />
                                Принять
                              </button>
                              {pr.status === "pending" && (
                                <button
                                  type="button"
                                  onClick={() => handleStatusChange(pr.id, "ordered")}
                                  className="rounded p-1 text-[#888888] hover:text-sky-600 hover:bg-sky-50 transition-colors"
                                  title="Пометить как заказано"
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => handleStatusChange(pr.id, "cancelled")}
                                className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                title="Отменить заявку"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredPurchases.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isPurchasesLoading ? "Загрузка заявок..." : "Заявок на закупку не найдено."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Вкладка 4: Журнал движений */}
      {activeTab === "movements" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[150px]">
                    Дата и время
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Товар
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[140px]">
                    Тип операции
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                    Кол-во
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Связь / Описание
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Инициатор
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {movements.map((m) => {
                  const typeMap: Record<string, { label: string; color: string; sign: string }> = {
                    intake: { label: "Приход", color: "bg-emerald-50 text-emerald-700 border-emerald-200", sign: "+" },
                    reserve: { label: "Резерв", color: "bg-amber-50 text-amber-700 border-amber-200", sign: "🔒" },
                    release: { label: "Снятие резерва", color: "bg-sky-50 text-sky-700 border-sky-200", sign: "🔓" },
                    repair_consumption: { label: "Списание по наряду", color: "bg-rose-50 text-rose-700 border-rose-200", sign: "-" },
                    consume: { label: "Списание", color: "bg-rose-50 text-rose-700 border-rose-200", sign: "-" },
                    adjustment: { label: "Корректировка", color: "bg-neutral-100 text-neutral-700 border-neutral-300", sign: "±" },
                  };
                  const t = typeMap[m.type] ?? { label: m.type, color: "bg-gray-100 text-gray-700 border-gray-200", sign: "" };

                  return (
                    <tr key={m.id} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#666666]">{formatDate(m.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-medium text-[13px] text-[#111111]">
                          {m.itemName ?? "Товар"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex rounded px-2 py-0.5 text-[11px] font-semibold border",
                            t.color,
                          )}
                        >
                          {t.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[13px] font-semibold text-[#111111]">
                          {t.sign} {m.quantity}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-[#666666]">{m.description || "—"}</div>
                        {m.repairOrderId && (
                          <Link
                            href={`/repairs/${m.repairOrderId}`}
                            className="inline-flex items-center gap-1 text-[11px] text-[#4a38f5] hover:underline mt-0.5"
                          >
                            <span>Наряд №{m.repairTicketNumber ?? "—"}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#888888]">{m.createdByName || "Система"}</span>
                      </td>
                    </tr>
                  );
                })}
                {movements.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isMovementsLoading ? "Загрузка движений..." : "Журнал движений пуст."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Модалки */}
      <CreateItemModal
        open={createItemModalOpen}
        onClose={() => setCreateItemModalOpen(false)}
      />

      <IntakeModal
        open={intakeModalOpen}
        onClose={() => {
          setIntakeModalOpen(false);
          setIntakeInitialItem(null);
          setIntakePurchaseRequest(null);
        }}
        initialItem={intakeInitialItem}
        purchaseRequestId={intakePurchaseRequest?.id}
        initialName={intakePurchaseRequest?.itemName}
        initialSku={intakePurchaseRequest?.sku}
        initialQty={intakePurchaseRequest?.quantity}
        initialPrice={intakePurchaseRequest?.estimatedPrice}
      />
    </div>
  );
}

export default function WarehousePage() {
  return (
    <Guard requiredPermission="service_center:read" requiredModule="service_center">
      <Suspense fallback={<div className="p-6 text-sm text-[#888888]">Загрузка склада...</div>}>
        <WarehouseContent />
      </Suspense>
    </Guard>
  );
}
