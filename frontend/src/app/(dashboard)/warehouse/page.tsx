"use client";

import { useState, useMemo, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  Boxes,
  PackagePlus,
  BookOpen,
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
  Truck,
  CreditCard,
  Download,
  Upload,
  SlidersHorizontal,
  ChevronDown,
  X,
  FileSpreadsheet,
} from "lucide-react";
import { toast } from "sonner";
import { Guard } from "@/components/shared/Guard";
import { useAuth } from "@/lib/auth/use-auth";
import { useServices } from "@/lib/api/use-services";
import { ServicesCatalogTab } from "@/components/warehouse/ServicesCatalogTab";
import {
  useWarehouseItems,
  useWarehouseBatches,
  useWarehouseMovements,
  usePurchaseRequests,
  useAggregatedPurchaseRequests,
  useSupplierOrders,
  usePaySupplierOrder,
  useCreateReceiptFromSupplierOrder,
  useWarehouseSettings,
  useUpdateWarehouseSettings,
  useDeleteWarehouseItem,
  useUpdatePurchaseRequest,
  useExportWarehouseItems,
  useBulkDeleteWarehouseItems,
  type WarehouseItemDTO,
  type PurchaseRequestDTO,
  type AggregatedPurchaseRequestDTO,
  type SupplierOrderDTO,
} from "@/lib/api/use-warehouse";
import { CreateItemModal } from "@/components/warehouse/CreateItemModal";
import { IntakeModal } from "@/components/warehouse/IntakeModal";
import { CreateSupplierOrderModal } from "@/components/warehouse/CreateSupplierOrderModal";
import { ProductImportDialog } from "@/components/warehouse/ProductImportDialog";
import { ProductBulkEditDialog } from "@/components/warehouse/ProductBulkEditDialog";
import { cn } from "@/lib/utils";

type WarehouseTab = "items" | "batches" | "purchases" | "supplier_orders" | "movements";

const TABS: { key: WarehouseTab; label: string; icon: typeof Boxes }[] = [
  { key: "items", label: "Остатки и номенклатура", icon: Boxes },
  { key: "batches", label: "Партии и приходные накладные", icon: Receipt },
  { key: "purchases", label: "Заявки на закупку", icon: ShoppingCart },
  { key: "supplier_orders", label: "Заказы поставщикам", icon: Truck },
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
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab");
  const [mainTab, setMainTab] = useState<"products" | "services">(
    tabParam === "services" ? "services" : "products",
  );
  const { data: servicesList = [] } = useServices();

  const handleSwitchMainTab = (t: "products" | "services") => {
    setMainTab(t);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", t);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const [activeTab, setActiveTab] = useState<WarehouseTab>("items");
  const [searchQuery, setSearchQuery] = useState("");
  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<string>("all");
  const [supplierOrderStatusFilter, setSupplierOrderStatusFilter] = useState<string>("all");

  const [createItemModalOpen, setCreateItemModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [intakeInitialItem, setIntakeInitialItem] = useState<WarehouseItemDTO | null>(null);
  const [intakePurchaseRequest, setIntakePurchaseRequest] = useState<PurchaseRequestDTO | null>(null);
  const [createSupplierOrderModalOpen, setCreateSupplierOrderModalOpen] = useState(false);
  const [selectedAggregatedIds, setSelectedAggregatedIds] = useState<Set<string>>(new Set());

  // Выбор позиций для массовых действий и модалки
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);

  // Настройки склада (продажа в минус)
  const { data: warehouseSettings } = useWarehouseSettings();
  const updateSettingsMutation = useUpdateWarehouseSettings();
  const allowNegativeStock = Boolean(warehouseSettings?.allowNegativeStock);

  // Данные
  const { data: items = [], isLoading: isItemsLoading } = useWarehouseItems();
  const { data: batches = [], isLoading: isBatchesLoading } = useWarehouseBatches();
  const { data: movements = [], isLoading: isMovementsLoading } = useWarehouseMovements();
  const { data: purchaseRequests = [], isLoading: isPurchasesLoading } = usePurchaseRequests();
  const { data: aggregatedPurchases = [], isLoading: isAggregatedLoading } = useAggregatedPurchaseRequests();
  const { data: supplierOrders = [], isLoading: isSupplierOrdersLoading } = useSupplierOrders();

  const deleteItemMutation = useDeleteWarehouseItem();
  const updatePurchaseMutation = useUpdatePurchaseRequest();
  const paySupplierOrderMutation = usePaySupplierOrder();
  const createReceiptMutation = useCreateReceiptFromSupplierOrder();
  const exportMutation = useExportWarehouseItems();
  const bulkDeleteMutation = useBulkDeleteWarehouseItems();

  // Фильтрация номенклатуры
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.sku.toLowerCase().includes(q) ||
        (item.brand && item.brand.toLowerCase().includes(q)) ||
        item.category.toLowerCase().includes(q),
    );
  }, [items, searchQuery]);

  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map((i) => i.id)));
    }
  };

  const handleToggleItem = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedItemIds(next);
  };

  const handleExport = async (format: "xlsx" | "csv", onlySelected = false) => {
    setExportDropdownOpen(false);
    try {
      await exportMutation.mutateAsync({
        format,
        ids: onlySelected && selectedItemIds.size > 0 ? Array.from(selectedItemIds) : undefined,
        search: !onlySelected && searchQuery.trim() ? searchQuery.trim() : undefined,
      });
      toast.success(format === "xlsx" ? "Файл Excel успешно скачан" : "Файл CSV успешно скачан");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось экспортировать");
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(`Удалить выбранные позиции (${selectedItemIds.size} шт.) из номенклатуры?`)) return;

    try {
      const res = await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedItemIds) });
      if (res.errors && res.errors.length > 0) {
        toast.warning(`Удалено ${res.deletedCount} позиций. Предупреждение: ${res.errors[0]}`);
      } else {
        toast.success(`Успешно удалено позиций: ${res.deletedCount}`);
      }
      setSelectedItemIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные позиции");
    }
  };

  // Фильтрация агрегированных заявок на закупку
  const filteredAggregatedPurchases = useMemo(() => {
    return aggregatedPurchases.filter((pr) => {
      if (purchaseStatusFilter !== "all" && pr.status !== purchaseStatusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        pr.itemName.toLowerCase().includes(q) ||
        (pr.sku || "").toLowerCase().includes(q) ||
        (pr.repairOrders || "").toLowerCase().includes(q)
      );
    });
  }, [aggregatedPurchases, purchaseStatusFilter, searchQuery]);

  // Фильтрация заказов поставщикам
  const filteredSupplierOrders = useMemo(() => {
    return supplierOrders.filter((order) => {
      if (supplierOrderStatusFilter !== "all" && order.status !== supplierOrderStatusFilter) return false;
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        order.orderNumber.toLowerCase().includes(q) ||
        order.supplierName.toLowerCase().includes(q) ||
        order.items.some((it) => it.itemName.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q))
      );
    });
  }, [supplierOrders, supplierOrderStatusFilter, searchQuery]);

  // Статистика склада
  const stats = useMemo(() => {
    const totalItemsCount = items.length;
    const lowStockCount = items.filter((i) => i.availableStock <= i.minStock).length;
    const totalValuation = items.reduce((sum, i) => sum + i.totalStock * i.costPrice, 0);
    const pendingPurchasesCount = aggregatedPurchases.filter(
      (p) => p.status === "pending" || p.status === "ordered",
    ).length;

    return { totalItemsCount, lowStockCount, totalValuation, pendingPurchasesCount };
  }, [items, aggregatedPurchases]);

  const handleToggleNegativeStock = async (checked: boolean) => {
    try {
      await updateSettingsMutation.mutateAsync({ allow_negative_stock: checked });
      toast.success(
        checked
          ? "Продажа в минус включена: наряды могут использовать дефицитные запчасти"
          : "Продажа в минус отключена: отпуск при нехватке на складе заблокирован",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось обновить настройки склада");
    }
  };

  const toggleSelectAllPurchases = () => {
    if (selectedAggregatedIds.size === filteredAggregatedPurchases.length) {
      setSelectedAggregatedIds(new Set());
    } else {
      setSelectedAggregatedIds(new Set(filteredAggregatedPurchases.map((p) => p.id)));
    }
  };

  const toggleSelectPurchase = (id: string) => {
    const next = new Set(selectedAggregatedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedAggregatedIds(next);
  };

  const selectedAggregatedRows = useMemo(() => {
    return aggregatedPurchases.filter((p) => selectedAggregatedIds.has(p.id));
  }, [aggregatedPurchases, selectedAggregatedIds]);

  const handlePayOrder = async (order: SupplierOrderDTO) => {
    if (
      !confirm(
        `Подтвердить оплату заказа №${order.orderNumber} на сумму ${formatRub(
          order.totalAmount,
        )}? В кассе будет сформирован расходный ордер (РКО).`,
      )
    ) {
      return;
    }
    try {
      const res = await paySupplierOrderMutation.mutateAsync({ id: order.id });
      toast.success(
        `Заказ №${order.orderNumber} оплачен (РКО создан в Финансах, ID: ${res.transaction_id})`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось оплатить заказ поставщику");
    }
  };

  const handleCreateReceipt = async (order: SupplierOrderDTO) => {
    if (
      !confirm(
        `Сформировать приходную накладную по заказу №${order.orderNumber}? Партии будут оприходованы, а остатки на складе увеличены.`,
      )
    ) {
      return;
    }
    try {
      const res = await createReceiptMutation.mutateAsync(order.id);
      toast.success(
        `Приходная накладная создана: оприходовано партий: ${res.batchesCreated}, статус заказа — Поступило`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать приходную накладную");
    }
  };

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
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-200">
            <PackagePlus className="h-5 w-5 text-[#4a38f5]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-[#111111]">Услуги/Товары</h1>
            <p className="text-xs text-[#666666]">
              Единый каталог номенклатуры, справочник услуг и складской учёт остатков
            </p>
          </div>
        </div>

        {mainTab === "products" && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Переключатель «Продажа в минус» */}
          <div className="flex items-center gap-2 rounded-[8px] border border-[#e5e5e5] bg-white px-3 h-8 shadow-2xs">
            <label className="flex items-center gap-2 cursor-pointer select-none text-xs text-[#111111]">
              <input
                type="checkbox"
                checked={allowNegativeStock}
                onChange={(e) => handleToggleNegativeStock(e.target.checked)}
                disabled={updateSettingsMutation.isPending}
                className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
              />
              <span className="font-medium">Продажа в минус</span>
            </label>
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold border",
                allowNegativeStock
                  ? "bg-amber-50 text-amber-800 border-amber-200"
                  : "bg-neutral-100 text-neutral-600 border-neutral-200",
              )}
            >
              {allowNegativeStock ? "Разрешена" : "Выключена"}
            </span>
          </div>

          {/* Экспорт */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportDropdownOpen((prev) => !prev)}
              disabled={exportMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors"
            >
              {exportMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
              ) : (
                <Download className="h-4 w-4 text-[#666666]" />
              )}
              Экспорт
              <ChevronDown className="h-3 w-3 text-[#888888]" />
            </button>

            {exportDropdownOpen && (
              <div className="absolute right-0 top-full mt-1.5 z-30 w-56 rounded-xl border border-[#e5e5e5] bg-white py-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
                <button
                  type="button"
                  onClick={() => handleExport("xlsx", false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa] transition-colors"
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  <span>Экспорт каталога в Excel (.xlsx)</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv", false)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#111111] hover:bg-[#fafafa] transition-colors"
                >
                  <FileSpreadsheet className="h-4 w-4 text-[#666666]" />
                  <span>Экспорт каталога в CSV (.csv)</span>
                </button>
                {selectedItemIds.size > 0 && (
                  <>
                    <div className="my-1 border-t border-[#f0f0f0]" />
                    <button
                      type="button"
                      onClick={() => handleExport("xlsx", true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#4a38f5] font-medium hover:bg-[#4a38f5]/5 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Выбранные в Excel ({selectedItemIds.size})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("csv", true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#4a38f5] font-medium hover:bg-[#4a38f5]/5 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Выбранные в CSV ({selectedItemIds.size})</span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Импорт */}
          <button
            type="button"
            onClick={() => setImportModalOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors"
          >
            <Upload className="h-4 w-4 text-[#666666]" />
            Импорт
          </button>

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
        )}
      </div>

      {/* Top-Level Tabs: Товары / Услуги */}
      <div className="flex items-center gap-2 border-b border-[#e5e5e5] pb-3">
        <button
          type="button"
          onClick={() => handleSwitchMainTab("products")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer",
            mainTab === "products"
              ? "bg-[#4a38f5] text-white shadow-2xs font-semibold"
              : "bg-white text-[#666666] border border-[#e5e5e5] hover:bg-[#fafafa] hover:text-[#111111]",
          )}
        >
          <Boxes className="h-4 w-4" />
          <span>Товары</span>
          <span
            className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
              mainTab === "products" ? "bg-white/20 text-white" : "bg-[#f0f0f0] text-[#666666]",
            )}
          >
            {items.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => handleSwitchMainTab("services")}
          className={cn(
            "flex items-center gap-2 px-3.5 py-1.5 rounded-[8px] text-xs font-medium transition-all cursor-pointer",
            mainTab === "services"
              ? "bg-[#4a38f5] text-white shadow-2xs font-semibold"
              : "bg-white text-[#666666] border border-[#e5e5e5] hover:bg-[#fafafa] hover:text-[#111111]",
          )}
        >
          <BookOpen className="h-4 w-4" />
          <span>Услуги</span>
          <span
            className={cn(
              "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
              mainTab === "services" ? "bg-white/20 text-white" : "bg-[#f0f0f0] text-[#666666]",
            )}
          >
            {servicesList.length}
          </span>
        </button>
      </div>

      {mainTab === "services" ? (
        <ServicesCatalogTab />
      ) : (
        <>
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
                  <th className="w-[38px] px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={filteredItems.length > 0 && selectedItemIds.size === filteredItems.length}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Артикул
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Наименование
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Бренд
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
                  <th className="px-4 py-2.5 w-[90px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredItems.map((item) => {
                  const isOutOfStock = item.availableStock <= 0;
                  const isLowStock = item.availableStock > 0 && item.availableStock <= item.minStock;
                  const isSelected = selectedItemIds.has(item.id);

                  return (
                    <tr
                      key={item.id}
                      className={cn(
                        "transition-colors hover:bg-[#fafafa]",
                        isSelected && "bg-[#4a38f5]/5 hover:bg-[#4a38f5]/8",
                      )}
                    >
                      <td className="w-[38px] px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleItem(item.id)}
                          className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs text-[#666666]">{item.sku || "—"}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[13px] text-[#111111]">{item.name}</div>
                        {item.category && (
                          <span className="text-[11px] text-[#888888]">{item.category}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#111111] font-medium">{item.brand || "—"}</span>
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
                    <td colSpan={10} className="px-4 py-12 text-center text-sm text-[#888888]">
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

      {/* Вкладка 3: Заявки на закупку (Сводка с агрегацией по нарядам и мультиселектом) */}
      {activeTab === "purchases" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {/* Тулбар мультиселекта */}
          {selectedAggregatedIds.size > 0 && (
            <div className="flex items-center justify-between bg-sky-50 border-b border-sky-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 text-sky-900 font-medium">
                <Check className="h-4 w-4 text-sky-700" />
                <span>
                  Выбрано позиций для заказа поставщику: <b>{selectedAggregatedIds.size}</b>
                </span>
              </div>
              <button
                type="button"
                onClick={() => setCreateSupplierOrderModalOpen(true)}
                className="flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#3d2ee0] shadow-xs transition-colors"
              >
                <Truck className="h-3.5 w-3.5" />
                Сформировать заказ поставщику ({selectedAggregatedIds.size})
              </button>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      checked={
                        filteredAggregatedPurchases.length > 0 &&
                        selectedAggregatedIds.size === filteredAggregatedPurchases.length
                      }
                      onChange={toggleSelectAllPurchases}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                      title="Выбрать все"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Запчасть / Товар
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px]">
                    Требуется
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[130px]">
                    Остаток на складе
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Наряды-заказы
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                    Ориент. цена
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Статус
                  </th>
                  <th className="px-4 py-2.5 w-[130px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredAggregatedPurchases.map((pr) => {
                  const statusMap = {
                    pending: { label: "В ожидании", color: "bg-amber-50 text-amber-700 border-amber-200" },
                    ordered: { label: "Заказано", color: "bg-sky-50 text-sky-700 border-sky-200" },
                    received: { label: "Поступило", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                    cancelled: { label: "Отменено", color: "bg-rose-50 text-rose-700 border-rose-200" },
                  }[pr.status];

                  const isSelected = selectedAggregatedIds.has(pr.id);

                  return (
                    <tr
                      key={pr.id}
                      className={cn(
                        "transition-colors hover:bg-[#fafafa]",
                        isSelected && "bg-sky-50/50",
                      )}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelectPurchase(pr.id)}
                          className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[13px] text-[#111111]">{pr.itemName}</div>
                        {pr.sku && <span className="font-mono text-[11px] text-[#888888]">{pr.sku}</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-mono text-[13px] font-semibold text-[#111111]">
                          {pr.quantity} {pr.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[11px] font-mono font-medium border",
                            pr.availableStock <= 0
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200",
                          )}
                        >
                          {pr.availableStock} / {pr.totalStock} {pr.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {pr.repairOrders ? (
                          <span className="inline-flex items-center gap-1 text-xs font-mono font-medium text-[#4a38f5] bg-[#f0f0ff] px-2 py-0.5 rounded-[4px] border border-[#e0e0ff]">
                            {pr.repairOrders}
                          </span>
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
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAggregatedIds(new Set([pr.id]));
                                setCreateSupplierOrderModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1 rounded bg-[#4a38f5] px-2 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors"
                              title="Сформировать заказ поставщику на эту позицию"
                            >
                              <Truck className="h-3 w-3" />
                              В заказ
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredAggregatedPurchases.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isAggregatedLoading
                        ? "Загрузка заявок на закупку..."
                        : "Заявок на закупку не найдено."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Вкладка 4: Заказы поставщикам */}
      {activeTab === "supplier_orders" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[130px]">
                    Номер
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[180px]">
                    Поставщик
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Состав заказа
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Сумма
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[130px]">
                    Статус
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[150px]">
                    Оплата / Приход
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[240px]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredSupplierOrders.map((order) => {
                  const statusMap: Record<string, { label: string; color: string }> = {
                    draft: { label: "Черновик", color: "bg-neutral-100 text-neutral-700 border-neutral-300" },
                    pending_payment: { label: "Ожидает оплаты", color: "bg-amber-50 text-amber-700 border-amber-200" },
                    paid: { label: "Оплачен", color: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                    received: { label: "Поступил", color: "bg-sky-50 text-sky-700 border-sky-200" },
                    cancelled: { label: "Отменен", color: "bg-rose-50 text-rose-700 border-rose-200" },
                  };
                  const st = statusMap[order.status] ?? { label: order.status, color: "bg-neutral-100 text-neutral-700 border-neutral-200" };

                  const isPaid = order.status === "paid" || order.status === "received";
                  const isReceived = order.status === "received";

                  return (
                    <tr key={order.id} className="transition-colors hover:bg-[#fafafa]">
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold text-[#111111]">
                          {order.orderNumber}
                        </span>
                        <div className="text-[11px] text-[#888888]">{formatDate(order.createdAt)}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-[13px] text-[#111111]">
                          {order.supplierName}
                        </div>
                        {order.createdByName && (
                          <div className="text-[11px] text-[#888888]">
                            Создал: {order.createdByName}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs text-[#111111] line-clamp-2">
                          {order.items && order.items.length > 0
                            ? order.items.map((it) => `${it.itemName} (${it.quantity} ${it.unit})`).join(", ")
                            : "—"}
                        </div>
                        {order.notes && (
                          <div className="text-[11px] text-[#888888] italic mt-0.5">
                            {order.notes}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="font-mono text-[13px] font-bold text-[#111111]">
                          {formatRub(order.totalAmount)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold border", st.color)}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {order.paidAt && (
                          <div className="text-emerald-700 font-medium">
                            Оплачен: {formatDate(order.paidAt)}
                          </div>
                        )}
                        {order.receivedAt && (
                          <div className="text-sky-700 font-medium">
                            Принят: {formatDate(order.receivedAt)}
                          </div>
                        )}
                        {!order.paidAt && !order.receivedAt && (
                          <span className="text-[#888888]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* Кнопка Оплачено */}
                          {!isPaid && order.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handlePayOrder(order)}
                              disabled={paySupplierOrderMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-[6px] bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors"
                              title="Оплатить заказ поставщику (создать расходный ордер в кассе)"
                            >
                              <CreditCard className="h-3 w-3" />
                              Оплачено
                            </button>
                          )}

                          {/* Кнопка Создать приходную накладную */}
                          {!isReceived && order.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handleCreateReceipt(order)}
                              disabled={createReceiptMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] shadow-xs transition-colors"
                              title="Создать приходную накладную и пополнить остатки склада"
                            >
                              <ArrowDownToLine className="h-3 w-3" />
                              Создать накладную
                            </button>
                          )}

                          {isReceived && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              На складе
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSupplierOrders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isSupplierOrdersLoading
                        ? "Загрузка заказов поставщикам..."
                        : "Заказов поставщикам пока нет. Выберите заявки на закупку и нажмите «Сформировать заказ поставщику»."}
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

      <CreateSupplierOrderModal
        open={createSupplierOrderModalOpen}
        onClose={() => setCreateSupplierOrderModalOpen(false)}
        selectedRequests={selectedAggregatedRows}
        onSuccess={() => {
          setSelectedAggregatedIds(new Set());
          setActiveTab("supplier_orders");
        }}
      />

      <ProductImportDialog
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
      />

      <ProductBulkEditDialog
        open={bulkEditModalOpen}
        selectedIds={Array.from(selectedItemIds)}
        onClose={() => setBulkEditModalOpen(false)}
        onSuccess={() => {
          setSelectedItemIds(new Set());
        }}
      />

      {/* Floating Action Bar при выборе позиций */}
      {selectedItemIds.size > 0 && activeTab === "items" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-[#e5e5e5] bg-white px-5 py-3 shadow-2xl animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-2 border-r border-[#e5e5e5] pr-3 text-xs">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#4a38f5] text-[11px] font-bold text-white">
              {selectedItemIds.size}
            </span>
            <span className="font-semibold text-[#111111]">Выбрано позиций</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkEditModalOpen(true)}
              className="flex h-7 items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-3 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Изменить выбранные
            </button>

            <button
              type="button"
              onClick={() => handleExport("xlsx", true)}
              disabled={exportMutation.isPending}
              className="flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Excel
            </button>

            <button
              type="button"
              onClick={() => handleExport("csv", true)}
              disabled={exportMutation.isPending}
              className="flex h-7 items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              CSV
            </button>

            <button
              type="button"
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="flex h-7 items-center gap-1.5 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 text-xs font-medium text-rose-700 shadow-2xs hover:bg-rose-100 transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Удалить
            </button>

            <button
              type="button"
              onClick={() => setSelectedItemIds(new Set())}
              className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors"
              title="Снять выделение"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

export default function WarehousePage() {
  const { tenant } = useAuth();
  const hasAccess =
    tenant?.installedModules.some(
      (m) =>
        m.slug === "products_services" ||
        m.slug === "service_center",
    ) ?? true;

  if (!hasAccess) {
    return (
      <Guard requiredModule="products_services">
        <div />
      </Guard>
    );
  }

  return (
    <Suspense fallback={<div className="p-6 text-sm text-[#888888]">Загрузка каталога...</div>}>
      <WarehouseContent />
    </Suspense>
  );
}
