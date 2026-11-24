"use client";

import { useState, useEffect, useMemo, useRef, Suspense } from "react";
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
  Eye,
  Edit2,
  SquarePen,
  Filter,
  Lock,
  Unlock,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { Guard } from "@/components/shared/Guard";
import { useAuth } from "@/lib/auth/use-auth";
import { useServices } from "@/lib/api/use-services";
import { ServicesCatalogTab } from "@/components/warehouse/ServicesCatalogTab";
import {
  useWarehouse,
  useWarehouseItems,
  useWarehouseBatches,
  useWarehouseMovements,
  usePurchaseRequests,
  useAggregatedPurchaseRequests,
  useSupplierOrders,
  usePaySupplierOrder,
  useCreateReceiptFromSupplierOrder,
  useDeleteSupplierOrder,
  useBulkDeleteSupplierOrders,
  useDeleteWarehouseBatch,
  useBulkDeleteWarehouseBatches,
  useDeleteWarehouseMovement,
  useBulkDeleteWarehouseMovements,
  useBulkDeletePurchaseRequests,
  useWarehouseSettings,
  useUpdateWarehouseSettings,
  useDeleteWarehouseItem,
  useUpdatePurchaseRequest,
  useDeletePurchaseRequest,
  useExportWarehouseItems,
  useBulkDeleteWarehouseItems,
  useBulkCreatePurchaseRequests,
  useWarehouseCategories,
  useWarehouseBrands,
  useWarehouseModels,
  type WarehouseItemDTO,
  type WarehouseItemModelDTO,
  type WarehouseBatchDTO,
  type WarehouseMovementDTO,
  type PurchaseRequestDTO,
  type AggregatedPurchaseRequestDTO,
  type SupplierOrderDTO,
} from "@/lib/api/use-warehouse";
import {
  WarehousePagination,
  WAREHOUSE_LIMITS,
  type WarehouseLimit,
} from "@/components/warehouse/WarehousePagination";
import { CreateItemModal } from "@/components/warehouse/CreateItemModal";
import { WarehouseIntakeDialog } from "@/components/warehouse/WarehouseIntakeDialog";
import { CreateSupplierOrderModal } from "@/components/warehouse/CreateSupplierOrderModal";
import { EditSupplierOrderModal } from "@/components/warehouse/EditSupplierOrderModal";
import { SupplierOrderDetailModal } from "@/components/warehouse/SupplierOrderDetailModal";
import { ReceiptSupplierOrderModal } from "@/components/warehouse/ReceiptSupplierOrderModal";
import { EditBatchModal } from "@/components/warehouse/EditBatchModal";
import { EditMovementModal } from "@/components/warehouse/EditMovementModal";
import { ProductImportDialog } from "@/components/warehouse/ProductImportDialog";
import { ProductBulkEditDialog } from "@/components/warehouse/ProductBulkEditDialog";
import { EditItemModal } from "@/components/warehouse/EditItemModal";
import { EditPurchaseRequestModal } from "@/components/warehouse/EditPurchaseRequestModal";
import { WarehouseDictionariesModal } from "@/components/warehouse/WarehouseDictionariesModal";
import { cn } from "@/lib/utils";

type WarehouseTab = "items" | "batches" | "purchases" | "supplier_orders" | "movements";

const TABS: { key: WarehouseTab; label: string; icon: typeof Boxes }[] = [
  { key: "items", label: "Остатки и номенклатура", icon: Boxes },
  { key: "batches", label: "Партии и приходные накладные", icon: Receipt },
  { key: "purchases", label: "Заявки на закупку", icon: ShoppingCart },
  { key: "supplier_orders", label: "Заказы поставщикам", icon: Truck },
  { key: "movements", label: "Журнал движений", icon: ArrowRightLeft },
];

import { formatRub } from "@/lib/utils/format";

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

  // Параметры серверной пагинации и фильтрации номенклатуры склада
  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const rawLimit = parseInt(searchParams.get("limit") ?? "25", 10);
  const limit: WarehouseLimit = WAREHOUSE_LIMITS.includes(rawLimit as WarehouseLimit)
    ? (rawLimit as WarehouseLimit)
    : 25;

  const categoryParam = searchParams.get("category") ?? "";
  const brandParam = searchParams.get("brand") ?? "";
  const modelIdsParam = searchParams.get("model_ids") || searchParams.get("models") || "";

  const initialModelIds = useMemo(() => {
    if (!modelIdsParam) return [];
    return modelIdsParam
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }, [modelIdsParam]);

  const [selectedCategory, setSelectedCategory] = useState<string>(categoryParam);
  const [selectedBrand, setSelectedBrand] = useState<string>(brandParam);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>(initialModelIds);
  const [modelSearchQuery, setModelSearchQuery] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(modelDropdownRef, () => setModelDropdownOpen(false), modelDropdownOpen);

  useEffect(() => {
    setSelectedCategory(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    setSelectedBrand(brandParam);
  }, [brandParam]);

  useEffect(() => {
    setSelectedModelIds(initialModelIds);
  }, [initialModelIds]);

  const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
  const filterPopoverRef = useRef<HTMLDivElement>(null);
  useClickOutside(filterPopoverRef, () => setFilterPopoverOpen(false), filterPopoverOpen);

  const [dictionariesModalOpen, setDictionariesModalOpen] = useState(false);

  const { data: warehouseCategoriesList = [] } = useWarehouseCategories();
  const { data: warehouseBrandsList = [] } = useWarehouseBrands();
  const { data: allWarehouseModels = [] } = useWarehouseModels();

  const availableModels = useMemo(() => {
    if (!selectedBrand) return allWarehouseModels;
    return allWarehouseModels.filter(
      (m) => (m.brandName || "").trim().toLowerCase() === selectedBrand.trim().toLowerCase(),
    );
  }, [allWarehouseModels, selectedBrand]);

  const filteredModelsForPicker = useMemo(() => {
    const q = modelSearchQuery.trim().toLowerCase();
    if (!q) return availableModels;
    return availableModels.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.brandName && m.brandName.toLowerCase().includes(q)),
    );
  }, [availableModels, modelSearchQuery]);

  const activeFiltersCount =
    (selectedCategory ? 1 : 0) +
    (selectedBrand ? 1 : 0) +
    (selectedModelIds.length > 0 ? 1 : 0);

  const updateUrl = (updates: {
    page?: number;
    limit?: number;
    category?: string;
    brand?: string;
    model_ids?: string[];
  }) => {
    const params = new URLSearchParams(searchParams.toString());
    if (updates.page !== undefined) {
      params.set("page", String(updates.page));
    }
    if (updates.limit !== undefined) {
      params.set("limit", String(updates.limit));
    }
    if (updates.category !== undefined) {
      if (updates.category) {
        params.set("category", updates.category);
      } else {
        params.delete("category");
      }
    }
    if (updates.brand !== undefined) {
      if (updates.brand) {
        params.set("brand", updates.brand);
      } else {
        params.delete("brand");
      }
    }
    if (updates.model_ids !== undefined) {
      if (updates.model_ids.length > 0) {
        params.set("model_ids", updates.model_ids.join(","));
      } else {
        params.delete("model_ids");
        params.delete("models");
      }
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleClearFilters = () => {
    setSelectedCategory("");
    setSelectedBrand("");
    setSelectedModelIds([]);
    setModelDropdownOpen(false);
    setFilterPopoverOpen(false);
    updateUrl({ page: 1, category: "", brand: "", model_ids: [] });
  };

  const handleToggleModel = (modelId: string) => {
    const next = selectedModelIds.includes(modelId)
      ? selectedModelIds.filter((id) => id !== modelId)
      : [...selectedModelIds, modelId];
    setSelectedModelIds(next);
    updateUrl({
      page: 1,
      category: selectedCategory,
      brand: selectedBrand,
      model_ids: next,
    });
  };

  const handleRemoveModel = (modelId: string) => {
    const next = selectedModelIds.filter((id) => id !== modelId);
    setSelectedModelIds(next);
    updateUrl({
      page: 1,
      category: selectedCategory,
      brand: selectedBrand,
      model_ids: next,
    });
  };

  const handleSearchChange = (newVal: string) => {
    setSearchQuery(newVal);
    if (page !== 1) {
      updateUrl({ page: 1 });
    }
  };

  const [purchaseStatusFilter, setPurchaseStatusFilter] = useState<string>("all");
  const [supplierOrderStatusFilter, setSupplierOrderStatusFilter] = useState<string>("all");

  const [createItemModalOpen, setCreateItemModalOpen] = useState(false);
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [intakeInitialItem, setIntakeInitialItem] = useState<WarehouseItemDTO | null>(null);
  const [intakePurchaseRequest, setIntakePurchaseRequest] = useState<PurchaseRequestDTO | null>(null);
  const [createSupplierOrderModalOpen, setCreateSupplierOrderModalOpen] = useState(false);
  const [selectedAggregatedIds, setSelectedAggregatedIds] = useState<Set<string>>(new Set());
  const [selectedPurchaseForEdit, setSelectedPurchaseForEdit] = useState<AggregatedPurchaseRequestDTO | null>(null);

  // Модальные окна заказов поставщикам, партий и движений
  const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<SupplierOrderDTO | null>(null);
  const [selectedOrderForDetail, setSelectedOrderForDetail] = useState<SupplierOrderDTO | null>(null);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<SupplierOrderDTO | null>(null);
  const [selectedBatchForEdit, setSelectedBatchForEdit] = useState<WarehouseBatchDTO | null>(null);
  const [selectedMovementForEdit, setSelectedMovementForEdit] = useState<WarehouseMovementDTO | null>(null);

  // Выбор записей для массовых действий на всех вкладках
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [selectedSupplierOrderIds, setSelectedSupplierOrderIds] = useState<Set<string>>(new Set());
  const [selectedMovementIds, setSelectedMovementIds] = useState<Set<string>>(new Set());
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [bulkEditModalOpen, setBulkEditModalOpen] = useState(false);
  const [editItemModalOpen, setEditItemModalOpen] = useState(false);
  const [selectedItemForEdit, setSelectedItemForEdit] = useState<WarehouseItemDTO | null>(null);
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
  const exportDropdownRef = useRef<HTMLDivElement>(null);
  useClickOutside(exportDropdownRef, () => setExportDropdownOpen(false), exportDropdownOpen);

  // Настройки склада (продажа в минус)
  const { data: warehouseSettings } = useWarehouseSettings();
  const updateSettingsMutation = useUpdateWarehouseSettings();
  const allowNegativeStock = Boolean(warehouseSettings?.allowNegativeStock);

  // Данные номенклатуры с серверной пагинацией
  const {
    data: warehouseData,
    isLoading: isItemsLoading,
    isPlaceholderData,
  } = useWarehouse({
    page,
    limit,
    search: searchQuery,
    category: selectedCategory || undefined,
    brand: selectedBrand || undefined,
    model_ids: selectedModelIds.length > 0 ? selectedModelIds : undefined,
  });

  const items = warehouseData?.items ?? [];
  const meta = warehouseData?.meta ?? { total: 0, page: 1, limit: 25, pages: 0 };
  const filteredItems = items;

  type ItemSortField =
    | "sku"
    | "name"
    | "category"
    | "brand"
    | "totalStock"
    | "reservedStock"
    | "availableStock"
    | "minStock"
    | "costPrice"
    | "retailPrice";
  type SortDirection = "asc" | "desc";

  const [sortField, setSortField] = useState<ItemSortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: ItemSortField) => {
    if (sortField === field) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortField(null);
        setSortDirection("asc");
      }
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortField) return filteredItems;
    return [...filteredItems].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];

      if (typeof aVal === "string" && typeof bVal === "string") {
        const cmp = aVal.localeCompare(bVal, "ru", { sensitivity: "base" });
        return sortDirection === "asc" ? cmp : -cmp;
      }

      const aNum = Number(aVal ?? 0);
      const bNum = Number(bVal ?? 0);
      return sortDirection === "asc" ? aNum - bNum : bNum - aNum;
    });
  }, [filteredItems, sortField, sortDirection]);

  const bulkCreatePurchasesMutation = useBulkCreatePurchaseRequests();

  const selectedItemsList = useMemo(() => {
    return Array.from(selectedItemIds)
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is WarehouseItemDTO => Boolean(i));
  }, [selectedItemIds, items]);

  const hasReservedOrDeficit = useMemo(() => {
    return selectedItemsList.some(
      (item) => item.reservedStock > 0 || item.availableStock < 0 || item.status === "reserved",
    );
  }, [selectedItemsList]);

  const handleBulkCreatePurchaseRequest = async () => {
    if (selectedItemIds.size === 0) return;
    try {
      const res = await bulkCreatePurchasesMutation.mutateAsync({
        itemIds: Array.from(selectedItemIds),
        comment: "Сформировано из массовых действий склада",
      });
      toast.success(`Сформировано заявок на закупку: ${res.length}`);
      setSelectedItemIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сформировать заявку на закупку");
    }
  };

  const { data: batches = [], isLoading: isBatchesLoading } = useWarehouseBatches();
  const { data: movements = [], isLoading: isMovementsLoading } = useWarehouseMovements();
  const { data: purchaseRequests = [], isLoading: isPurchasesLoading } = usePurchaseRequests();
  const { data: aggregatedPurchases = [], isLoading: isAggregatedLoading } = useAggregatedPurchaseRequests();
  const { data: supplierOrders = [], isLoading: isSupplierOrdersLoading } = useSupplierOrders();

  const deleteItemMutation = useDeleteWarehouseItem();
  const updatePurchaseMutation = useUpdatePurchaseRequest();
  const deletePurchaseMutation = useDeletePurchaseRequest();
  const bulkDeletePurchasesMutation = useBulkDeletePurchaseRequests();
  const paySupplierOrderMutation = usePaySupplierOrder();
  const createReceiptMutation = useCreateReceiptFromSupplierOrder();
  const deleteSupplierOrderMutation = useDeleteSupplierOrder();
  const bulkDeleteSupplierOrdersMutation = useBulkDeleteSupplierOrders();
  const deleteBatchMutation = useDeleteWarehouseBatch();
  const bulkDeleteBatchesMutation = useBulkDeleteWarehouseBatches();
  const deleteMovementMutation = useDeleteWarehouseMovement();
  const bulkDeleteMovementsMutation = useBulkDeleteWarehouseMovements();
  const exportMutation = useExportWarehouseItems();
  const bulkDeleteMutation = useBulkDeleteWarehouseItems();

  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === sortedItems.length && sortedItems.length > 0) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(sortedItems.map((i) => i.id)));
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
    const selectedItems = filteredItems.filter((i) => selectedItemIds.has(i.id));
    const hasStockItems = selectedItems.some((i) => i.totalStock > 0 || i.reservedStock > 0);
    const confirmText = hasStockItems
      ? `Среди выбранных позиций (${selectedItemIds.size} шт.) есть товары с ненулевым остатком или резервом. При удалении все их партии, резервы и движения будут очищены, а остатки пересчитаны. Удалить принудительно?`
      : `Удалить выбранные позиции (${selectedItemIds.size} шт.) из номенклатуры?`;
    if (!confirm(confirmText)) return;

    try {
      const res = await bulkDeleteMutation.mutateAsync({
        ids: Array.from(selectedItemIds),
        force: hasStockItems,
      });
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

  // Фильтрация партий
  const filteredBatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return batches;
    return batches.filter(
      (b) =>
        (b.itemName || "").toLowerCase().includes(q) ||
        (b.batchNumber || "").toLowerCase().includes(q) ||
        (b.supplierName || "").toLowerCase().includes(q),
    );
  }, [batches, searchQuery]);

  // Фильтрация движений
  const filteredMovements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return movements;
    return movements.filter(
      (m) =>
        (m.itemName || "").toLowerCase().includes(q) ||
        (m.description || "").toLowerCase().includes(q) ||
        (m.repairTicketNumber || "").toLowerCase().includes(q) ||
        (m.dealTitle || "").toLowerCase().includes(q) ||
        (m.createdByName || "").toLowerCase().includes(q),
    );
  }, [movements, searchQuery]);

  // Статистика склада (приоритетно из серверного партионного агрегата по всему складу)
  const stats = useMemo(() => {
    const totalItemsCount = meta.total > 0 ? meta.total : items.length;
    const lowStockCount =
      meta.lowStockCount !== undefined
        ? meta.lowStockCount
        : items.filter((i) => i.availableStock <= i.minStock).length;
    const totalValuation =
      meta.totalValuation !== undefined
        ? meta.totalValuation
        : items.reduce((sum, i) => sum + (i.stockValuation ?? i.totalStock * i.costPrice), 0);
    const pendingPurchasesCount = aggregatedPurchases.filter(
      (p) => p.status === "pending" || p.status === "ordered",
    ).length;

    return { totalItemsCount, lowStockCount, totalValuation, pendingPurchasesCount };
  }, [items, meta, aggregatedPurchases]);

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

  const handleOpenReceiptModal = (order: SupplierOrderDTO) => {
    setSelectedOrderForReceipt(order);
  };

  const handleOpenEditModal = (order: SupplierOrderDTO) => {
    if (order.status === "received") {
      toast.error("Нельзя редактировать заказ, товары по которому уже оприходованы на склад");
      return;
    }
    setSelectedOrderForEdit(order);
  };

  const handleDeleteSupplierOrder = async (order: SupplierOrderDTO) => {
    const isReceived = order.status === "received";
    const confirmMsg = isReceived
      ? `Удалить оприходованный заказ №${order.orderNumber}? Все созданные им партии, движения прихода/резерва и кассовая оплата будут откачены, а заявки вернутся в «В ожидании».`
      : `Удалить заказ поставщику №${order.orderNumber}? Все заявки на закупку вернутся в статус «В ожидании», а оплата (если была) будет отменена.`;
    if (!confirm(confirmMsg)) {
      return;
    }
    try {
      await deleteSupplierOrderMutation.mutateAsync(order.id);
      toast.success(
        isReceived
          ? `Заказ №${order.orderNumber} и связанные партии удалены, остатки и касса пересчитаны`
          : `Заказ №${order.orderNumber} удален, заявки возвращены в очередь`,
      );
      setSelectedSupplierOrderIds((prev) => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
      if (selectedOrderForDetail?.id === order.id) {
        setSelectedOrderForDetail(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить заказ поставщику");
    }
  };

  const handleBulkDeleteSupplierOrders = async () => {
    if (selectedSupplierOrderIds.size === 0) return;
    if (
      !confirm(
        `Удалить выбранные заказы поставщикам (${selectedSupplierOrderIds.size} шт.)? Связанные партии, движения и кассовые проводки будут откачены, а заявки вернутся в «В ожидании».`,
      )
    ) {
      return;
    }
    try {
      const res = await bulkDeleteSupplierOrdersMutation.mutateAsync(Array.from(selectedSupplierOrderIds));
      toast.success(
        `Удалено заказов: ${res.deletedCount}${res.rolledBackBatchesCount > 0 ? ` (откачено партий: ${res.rolledBackBatchesCount})` : ""}`,
      );
      setSelectedSupplierOrderIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные заказы");
    }
  };

  const handleDeleteBatch = async (batch: WarehouseBatchDTO) => {
    if (
      !confirm(
        `Удалить партию ${batch.batchNumber || batch.id.slice(0, 8)} («${batch.itemName ?? "Товар"}»)? Связанные движения, резервы и FIFO-аллокации этой партии будут удалены, а остатки пересчитаны.`,
      )
    ) {
      return;
    }
    try {
      await deleteBatchMutation.mutateAsync(batch.id);
      toast.success("Партия и связанные движения удалены, остатки пересчитаны");
      setSelectedBatchIds((prev) => {
        const next = new Set(prev);
        next.delete(batch.id);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить партию");
    }
  };

  const handleBulkDeleteBatches = async () => {
    if (selectedBatchIds.size === 0) return;
    if (
      !confirm(
        `Удалить выбранные партии (${selectedBatchIds.size} шт.)? Все связанные движения, резервы и аллокации этих партий будут очищены.`,
      )
    ) {
      return;
    }
    try {
      const res = await bulkDeleteBatchesMutation.mutateAsync(Array.from(selectedBatchIds));
      toast.success(`Удалено партий: ${res.deletedCount}`);
      setSelectedBatchIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные партии");
    }
  };

  const handleDeleteMovement = async (movement: WarehouseMovementDTO) => {
    if (
      !confirm(
        `Удалить запись движения по «${movement.itemName ?? "Товар"}» (${movement.quantity} шт.)? Влияние операции на остатки партии / резервы / списания будет откачено.`,
      )
    ) {
      return;
    }
    try {
      await deleteMovementMutation.mutateAsync(movement.id);
      toast.success("Запись движения удалена, остатки пересчитаны");
      setSelectedMovementIds((prev) => {
        const next = new Set(prev);
        next.delete(movement.id);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить движение");
    }
  };

  const handleBulkDeleteMovements = async () => {
    if (selectedMovementIds.size === 0) return;
    if (
      !confirm(
        `Удалить выбранные записи движений (${selectedMovementIds.size} шт.)? Влияние операций на остатки и резервы будет откачено.`,
      )
    ) {
      return;
    }
    try {
      const res = await bulkDeleteMovementsMutation.mutateAsync(Array.from(selectedMovementIds));
      toast.success(`Удалено записей движений: ${res.deletedCount}`);
      setSelectedMovementIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные движения");
    }
  };

  const handleBulkDeletePurchases = async () => {
    if (selectedAggregatedIds.size === 0) return;
    const allIds = filteredAggregatedPurchases
      .filter((pr) => selectedAggregatedIds.has(pr.id))
      .flatMap((pr) => (pr.requestIds && pr.requestIds.length > 0 ? pr.requestIds : [pr.id]));
    if (allIds.length === 0) return;
    if (!confirm(`Удалить выбранные заявки на закупку (${allIds.length} шт.)?`)) return;
    try {
      const res = await bulkDeletePurchasesMutation.mutateAsync(allIds);
      toast.success(`Удалено заявок на закупку: ${res.deletedCount}`);
      setSelectedAggregatedIds(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить заявки на закупку");
    }
  };

  const handleDeleteItem = async (item: WarehouseItemDTO) => {
    const hasStockOrReserve = item.totalStock > 0 || item.reservedStock > 0;
    const confirmMsg = hasStockOrReserve
      ? `У товара «${item.name}» есть остаток (${item.totalStock} ${item.unit}, в резерве: ${item.reservedStock}). При удалении будут очищены все его партии, резервы и движения, а остатки пересчитаны. Удалить принудительно?`
      : `Удалить товар «${item.name}» из номенклатуры?`;
    if (!confirm(confirmMsg)) return;

    try {
      await deleteItemMutation.mutateAsync({ id: item.id, force: hasStockOrReserve });
      toast.success(
        hasStockOrReserve
          ? `Товар «${item.name}» и связанные партии/резервы удалены`
          : `Товар «${item.name}» удален`,
      );
      setSelectedItemIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Ошибка при удалении товара");
    }
  };

  const handleOpenEditItemModal = (item: WarehouseItemDTO) => {
    setSelectedItemForEdit(item);
    setEditItemModalOpen(true);
    const params = new URLSearchParams(searchParams.toString());
    params.set("edit", item.id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleCloseEditItemModal = () => {
    setEditItemModalOpen(false);
    setSelectedItemForEdit(null);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("edit");
    params.delete("record");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const handleBulkEditClick = () => {
    if (selectedItemIds.size === 1) {
      const selectedId = Array.from(selectedItemIds)[0];
      const item = items.find((i) => i.id === selectedId);
      if (item) {
        handleOpenEditItemModal(item);
        return;
      }
    }
    setBulkEditModalOpen(true);
  };

  const editParam = searchParams.get("edit") || searchParams.get("record");
  useEffect(() => {
    if (editParam && !editItemModalOpen) {
      const found = items.find((i) => i.id === editParam);
      if (found) {
        setSelectedItemForEdit(found);
      }
      setEditItemModalOpen(true);
    }
  }, [editParam, items, editItemModalOpen]);

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
          <div ref={exportDropdownRef} className="relative">
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

          {/* Справочники */}
          <button
            type="button"
            onClick={() => setDictionariesModalOpen(true)}
            className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-[13px] font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors"
          >
            <BookOpen className="h-4 w-4 text-[#666666]" />
            Справочники
          </button>

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

      {/* Поисковая строка и фильтры для активной вкладки */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Поиск по названию, артикулу..."
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-8 pr-3 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
              />
            </div>

            {activeTab === "items" && (
              <div ref={filterPopoverRef} className="relative">
                <button
                  type="button"
                  onClick={() => setFilterPopoverOpen((prev) => !prev)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-[8px] border px-2.5 text-[13px] font-medium transition-colors shadow-2xs",
                    activeFiltersCount > 0
                      ? "border-[#4a38f5] bg-[#4a38f5]/5 text-[#4a38f5]"
                      : "border-[#e5e5e5] bg-white text-[#111111] hover:bg-[#fafafa] hover:border-[#cccccc]",
                  )}
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span>Фильтры</span>
                  {activeFiltersCount > 0 && (
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#4a38f5] text-[10px] font-bold text-white">
                      {activeFiltersCount}
                    </span>
                  )}
                </button>

                {filterPopoverOpen && (
                  <div className="absolute left-0 top-full mt-1.5 z-30 w-80 rounded-xl border border-[#e5e5e5] bg-white p-3.5 shadow-xl animate-in fade-in zoom-in-95 duration-100">
                    <div className="flex items-center justify-between pb-2 border-b border-[#f0f0f0]">
                      <span className="text-xs font-semibold text-[#111111]">
                        Фильтры склада
                      </span>
                      {activeFiltersCount > 0 && (
                        <button
                          type="button"
                          onClick={handleClearFilters}
                          className="text-[11px] text-[#4a38f5] hover:underline cursor-pointer"
                        >
                          Сбросить
                        </button>
                      )}
                    </div>

                    <div className="mt-3 space-y-3">
                      <div>
                        <label className="block text-[11px] font-medium text-[#666666] mb-1">
                          Категория
                        </label>
                        <select
                          value={selectedCategory}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedCategory(val);
                            updateUrl({ page: 1, category: val, brand: selectedBrand, model_ids: selectedModelIds });
                          }}
                          className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
                        >
                          <option value="">Все категории</option>
                          {warehouseCategoriesList.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-[#666666] mb-1">
                          Бренд
                        </label>
                        <select
                          value={selectedBrand}
                          onChange={(e) => {
                            const val = e.target.value;
                            setSelectedBrand(val);
                            updateUrl({ page: 1, category: selectedCategory, brand: val, model_ids: selectedModelIds });
                          }}
                          className="h-8 w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none cursor-pointer"
                        >
                          <option value="">Все бренды</option>
                          {warehouseBrandsList.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Фильтр: Подходит к моделям */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-[11px] font-medium text-[#666666]">
                            Подходит к моделям
                          </label>
                          {selectedModelIds.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedModelIds([]);
                                updateUrl({
                                  page: 1,
                                  category: selectedCategory,
                                  brand: selectedBrand,
                                  model_ids: [],
                                });
                              }}
                              className="text-[10px] text-[#888888] hover:text-[#111111] transition-colors cursor-pointer"
                            >
                              Очистить ({selectedModelIds.length})
                            </button>
                          )}
                        </div>

                        {/* Чипы выбранных моделей внутри поповера */}
                        {selectedModelIds.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5 max-h-24 overflow-y-auto pr-0.5">
                            {selectedModelIds.map((id) => {
                              const modelObj = allWarehouseModels.find((m) => m.id === id);
                              const modelName = modelObj ? modelObj.name : id;
                              return (
                                <span
                                  key={id}
                                  className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-1.5 py-0.5 text-[11px] font-medium text-[#4a38f5]"
                                >
                                  <span className="truncate max-w-[140px]">{modelName}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveModel(id)}
                                    className="hover:text-rose-600 transition-colors cursor-pointer"
                                    title="Удалить"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}

                        {/* Кнопка-селектор моделей */}
                        <div className="relative" ref={modelDropdownRef}>
                          <button
                            type="button"
                            onClick={() => setModelDropdownOpen((prev) => !prev)}
                            className={cn(
                              "h-8 w-full rounded-[6px] border bg-white px-2.5 text-xs text-left flex items-center justify-between transition-colors cursor-pointer",
                              modelDropdownOpen
                                ? "border-[#4a38f5] ring-1 ring-[#4a38f5]/20"
                                : "border-[#e5e5e5] hover:border-[#cccccc]",
                            )}
                          >
                            <span className={selectedModelIds.length > 0 ? "text-[#111111] font-medium truncate" : "text-[#888888] truncate"}>
                              {selectedModelIds.length === 0
                                ? "Все модели"
                                : `Выбрано: ${selectedModelIds.length} модел${selectedModelIds.length === 1 ? "ь" : selectedModelIds.length < 5 ? "и" : "ей"}`}
                            </span>
                            <ChevronDown className={cn("h-3.5 w-3.5 text-[#888888] shrink-0 transition-transform", modelDropdownOpen && "rotate-180")} />
                          </button>

                          {modelDropdownOpen && (
                            <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-[8px] border border-[#e5e5e5] bg-white p-2 shadow-lg animate-in fade-in zoom-in-95 duration-100">
                              <div className="relative mb-2">
                                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-[#888888]" />
                                <input
                                  type="text"
                                  value={modelSearchQuery}
                                  onChange={(e) => setModelSearchQuery(e.target.value)}
                                  placeholder="Поиск по моделям..."
                                  className="h-7 w-full rounded-[6px] border border-[#e5e5e5] bg-[#fafafa] pl-7 pr-2 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:bg-white focus:outline-none"
                                />
                                {modelSearchQuery && (
                                  <button
                                    type="button"
                                    onClick={() => setModelSearchQuery("")}
                                    className="absolute right-2 top-2 text-[#888888] hover:text-[#111111] cursor-pointer"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>

                              <div className="max-h-48 overflow-y-auto space-y-0.5 pr-0.5">
                                {filteredModelsForPicker.length === 0 ? (
                                  <div className="py-3 text-center text-xs text-[#888888]">
                                    {allWarehouseModels.length === 0
                                      ? "В справочнике пока нет моделей"
                                      : "Модели не найдены"}
                                  </div>
                                ) : (
                                  filteredModelsForPicker.map((m) => {
                                    const isSelected = selectedModelIds.includes(m.id);
                                    return (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => handleToggleModel(m.id)}
                                        className={cn(
                                          "flex w-full items-center justify-between rounded-[4px] px-2 py-1.5 text-xs text-left transition-colors cursor-pointer",
                                          isSelected
                                            ? "bg-[#4a38f5]/10 text-[#4a38f5] font-medium"
                                            : "text-[#111111] hover:bg-[#f5f5f5]",
                                        )}
                                      >
                                        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
                                          <div
                                            className={cn(
                                              "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                                              isSelected
                                                ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                                                : "border-[#cccccc] bg-white",
                                            )}
                                          >
                                            {isSelected && <Check className="h-2.5 w-2.5 stroke-[3]" />}
                                          </div>
                                          <span className="truncate">{m.name}</span>
                                        </div>
                                        {m.brandName && (
                                          <span className="shrink-0 rounded bg-[#f0f0f0] px-1.5 py-0.2 text-[10px] text-[#666666]">
                                            {m.brandName}
                                          </span>
                                        )}
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#f0f0f0]">
                        <button
                          type="button"
                          onClick={() => setFilterPopoverOpen(false)}
                          className="h-7 rounded-[6px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer"
                        >
                          Готово
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
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

        {activeTab === "supplier_orders" && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setSelectedAggregatedIds(new Set());
                setCreateSupplierOrderModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Заказ поставщику</span>
            </button>
          </div>
        )}
      </div>

      {/* Активные фильтры (чипы) */}
      {activeTab === "items" && activeFiltersCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-[#888888]">Активно:</span>
          {selectedCategory && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs text-[#4a38f5] font-medium">
              <span>Категория: {selectedCategory}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedCategory("");
                  updateUrl({ page: 1, category: "", brand: selectedBrand, model_ids: selectedModelIds });
                }}
                className="hover:text-[#3d2ee0] cursor-pointer"
                title="Удалить фильтр"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {selectedBrand && (
            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs text-[#4a38f5] font-medium">
              <span>Бренд: {selectedBrand}</span>
              <button
                type="button"
                onClick={() => {
                  setSelectedBrand("");
                  updateUrl({ page: 1, category: selectedCategory, brand: "", model_ids: selectedModelIds });
                }}
                className="hover:text-[#3d2ee0] cursor-pointer"
                title="Удалить фильтр"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          )}
          {selectedModelIds.length > 0 &&
            selectedModelIds.map((id) => {
              const modelObj = allWarehouseModels.find((m) => m.id === id);
              const modelName = modelObj ? modelObj.name : id;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-[4px] bg-[#4a38f5]/10 border border-[#4a38f5]/20 px-2 py-0.5 text-xs text-[#4a38f5] font-medium"
                >
                  <span>Модель: {modelName}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveModel(id)}
                    className="hover:text-[#3d2ee0] cursor-pointer"
                    title="Удалить фильтр"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          <button
            type="button"
            onClick={handleClearFilters}
            className="text-[11px] text-[#888888] hover:text-[#111111] hover:underline transition-colors ml-1 cursor-pointer"
          >
            Сбросить все
          </button>
        </div>
      )}
    </div>

      {/* Вкладка 1: Номенклатура и остатки */}
      {activeTab === "items" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full transition-opacity duration-150",
                isPlaceholderData && "opacity-50 pointer-events-none",
              )}
            >
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="w-[38px] px-3 py-2.5 text-center">
                    <input
                      type="checkbox"
                      checked={sortedItems.length > 0 && selectedItemIds.size === sortedItems.length}
                      onChange={handleToggleSelectAll}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <th
                    onClick={() => handleSort("sku")}
                    className={cn(
                      "px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "sku" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по артикулу"
                  >
                    <div className="inline-flex items-center gap-1">
                      <span>Артикул</span>
                      {sortField === "sku" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("name")}
                    className={cn(
                      "px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "name" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по наименованию"
                  >
                    <div className="inline-flex items-center gap-1">
                      <span>Наименование</span>
                      {sortField === "name" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("category")}
                    className={cn(
                      "px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[130px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "category" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по категории"
                  >
                    <div className="inline-flex items-center gap-1">
                      <span>Категория</span>
                      {sortField === "category" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("brand")}
                    className={cn(
                      "px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "brand" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по бренду"
                  >
                    <div className="inline-flex items-center gap-1">
                      <span>Бренд</span>
                      {sortField === "brand" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("totalStock")}
                    className={cn(
                      "px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "totalStock" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по физическому остатку"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Физический</span>
                      {sortField === "totalStock" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("reservedStock")}
                    className={cn(
                      "px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "reservedStock" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по количеству в резерве"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>В резерве</span>
                      {sortField === "reservedStock" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("availableStock")}
                    className={cn(
                      "px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "availableStock" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по доступному остатку"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Доступно</span>
                      {sortField === "availableStock" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("minStock")}
                    className={cn(
                      "px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[95px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "minStock" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по минимальному остатку"
                  >
                    <div className="inline-flex items-center justify-center gap-1">
                      <span>Мин. ост.</span>
                      {sortField === "minStock" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("costPrice")}
                    className={cn(
                      "px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "costPrice" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по себестоимости"
                  >
                    <div className="inline-flex items-center justify-end gap-1">
                      <span>Себестоимость</span>
                      {sortField === "costPrice" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th
                    onClick={() => handleSort("retailPrice")}
                    className={cn(
                      "px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px] select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
                      sortField === "retailPrice" && "text-[#4a38f5] bg-[#4a38f5]/5",
                    )}
                    title="Сортировать по розничной цене"
                  >
                    <div className="inline-flex items-center justify-end gap-1">
                      <span>Розница</span>
                      {sortField === "retailPrice" ? (
                        sortDirection === "asc" ? <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" /> : <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
                      ) : (
                        <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      )}
                    </div>
                  </th>
                  <th className="px-4 py-2.5 w-[90px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {sortedItems.map((item) => {
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
                        {item.models && item.models.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {item.models.map((m) => (
                              <span
                                key={m.id}
                                className="inline-flex items-center rounded-[4px] bg-slate-100 border border-slate-200/80 px-1.5 py-0.2 text-[10px] font-mono text-slate-700"
                              >
                                {m.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#666666]">{item.category || "—"}</span>
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
                      <td className="px-4 py-3 text-center">
                        {item.minStock > 0 ? (
                          <span className="font-mono text-[13px] text-[#666666]">
                            {item.minStock} {item.unit}
                          </span>
                        ) : (
                          <span className="text-xs text-[#888888] font-mono">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex flex-col items-end">
                          <span className="font-mono text-[13px] text-[#666666]" title="Себестоимость следующей списываемой партии (FIFO)">
                            {formatRub(item.fifoCostPrice ?? item.costPrice)}
                          </span>
                          {(item.activeBatchesCount ?? 0) > 1 &&
                            item.avgBatchCostPrice !== undefined &&
                            Math.abs(item.avgBatchCostPrice - (item.fifoCostPrice ?? item.costPrice)) >= 0.01 && (
                              <span
                                className="font-mono text-[10px] text-[#888888]"
                                title={`Активных партий: ${item.activeBatchesCount}. Средняя по остаткам партий.`}
                              >
                                ср. {formatRub(item.avgBatchCostPrice)} ({item.activeBatchesCount} п.)
                              </span>
                            )}
                        </div>
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
                            onClick={() => handleOpenEditItemModal(item)}
                            className="rounded p-1 text-[#888888] hover:text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors"
                            title="Редактировать товар"
                          >
                            <SquarePen className="h-3.5 w-3.5" />
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
                    <td colSpan={12} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isItemsLoading ? (
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-[#4a38f5]" />
                          <span>Загрузка каталога склада...</span>
                        </div>
                      ) : (
                        "Товаров не найдено."
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Серверная пагинация и селектор лимита */}
          <WarehousePagination
            total={meta.total}
            page={meta.page}
            pages={meta.pages}
            limit={meta.limit}
            onPageChange={(newPage) => updateUrl({ page: newPage })}
            onLimitChange={(newLimit) => updateUrl({ limit: newLimit, page: 1 })}
            disabled={isItemsLoading}
          />
        </div>
      )}

      {/* Вкладка 2: Партии и приходные накладные */}
      {activeTab === "batches" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {selectedBatchIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/70 border-b border-indigo-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 text-[#111111] font-medium">
                <Check className="h-4 w-4 text-[#4a38f5]" />
                <span>
                  Выбрано партий: <b className="font-mono">{selectedBatchIds.size}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedBatchIds(new Set())}
                  className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Снять выбор
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteBatches}
                  disabled={bulkDeleteBatchesMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkDeleteBatchesMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Удалить выбранные ({selectedBatchIds.size})
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все партии"
                      checked={
                        filteredBatches.length > 0 &&
                        selectedBatchIds.size === filteredBatches.length
                      }
                      onChange={() => {
                        if (selectedBatchIds.size === filteredBatches.length && filteredBatches.length > 0) {
                          setSelectedBatchIds(new Set());
                        } else {
                          setSelectedBatchIds(new Set(filteredBatches.map((b) => b.id)));
                        }
                      }}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
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
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[95px]">
                    Остаток FIFO
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredBatches.map((b) => {
                  const isSelected = selectedBatchIds.has(b.id);
                  return (
                    <tr
                      key={b.id}
                      className={cn(
                        "transition-colors hover:bg-[#fafafa]",
                        isSelected && "bg-indigo-50/40",
                      )}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать партию ${b.batchNumber || b.id}`}
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selectedBatchIds);
                            if (next.has(b.id)) next.delete(b.id);
                            else next.add(b.id);
                            setSelectedBatchIds(next);
                          }}
                          className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#666666]">{formatDate(b.receivedAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold text-[#111111]">
                          {b.batchNumber || "—"}
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
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedBatchForEdit(b)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
                            title="Редактировать партию"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBatch(b)}
                            disabled={deleteBatchMutation.isPending}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50"
                            title="Удалить партию и откатить связанные движения"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredBatches.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-12 text-center text-sm text-[#888888]">
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
            <div className="flex flex-wrap items-center justify-between gap-2 bg-sky-50 border-b border-sky-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 text-sky-900 font-medium">
                <Check className="h-4 w-4 text-sky-700" />
                <span>
                  Выбрано позиций: <b className="font-mono">{selectedAggregatedIds.size}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAggregatedIds(new Set())}
                  className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Снять выбор
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeletePurchases}
                  disabled={bulkDeletePurchasesMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-rose-700 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkDeletePurchasesMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Удалить выбранные ({selectedAggregatedIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => setCreateSupplierOrderModalOpen(true)}
                  className="flex items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#3d2ee0] shadow-xs transition-colors cursor-pointer"
                >
                  <Truck className="h-3.5 w-3.5" />
                  Сформировать заказ поставщику ({selectedAggregatedIds.size})
                </button>
              </div>
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
                    Наряды / Сделки
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
                              className="inline-flex items-center gap-1 rounded bg-[#4a38f5] px-2 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer"
                              title="Сформировать заказ поставщику на эту позицию"
                            >
                              <Truck className="h-3 w-3" />
                              В заказ
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedPurchaseForEdit(pr)}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:border-[#4a38f5] hover:text-[#4a38f5] transition-colors cursor-pointer"
                            title="Редактировать заявку"
                            aria-label="Редактировать заявку"
                          >
                            <SquarePen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={deletePurchaseMutation.isPending}
                            onClick={async () => {
                              const count = pr.requestIds.length;
                              const promptText =
                                count > 1
                                  ? `Удалить все заявки (${count} шт.) по позиции «${pr.itemName}»?`
                                  : `Удалить заявку на закупку «${pr.itemName}»?`;
                              if (!confirm(promptText)) return;
                              try {
                                await Promise.all(
                                  pr.requestIds.map((reqId) => deletePurchaseMutation.mutateAsync(reqId)),
                                );
                                setSelectedAggregatedIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(pr.id);
                                  return next;
                                });
                                toast.success(
                                  count > 1
                                    ? `Удалено заявок: ${count}`
                                    : `Заявка «${pr.itemName}» удалена`,
                                );
                              } catch (err) {
                                toast.error(
                                  err instanceof Error ? err.message : "Не удалось удалить заявку",
                                );
                              }
                            }}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#e5e5e5] bg-white text-[#888888] hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-50 cursor-pointer"
                            title="Удалить заявку"
                            aria-label="Удалить заявку"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
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
          {selectedSupplierOrderIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/70 border-b border-indigo-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 text-[#111111] font-medium">
                <Check className="h-4 w-4 text-[#4a38f5]" />
                <span>
                  Выбрано заказов: <b className="font-mono">{selectedSupplierOrderIds.size}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedSupplierOrderIds(new Set())}
                  className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Снять выбор
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteSupplierOrders}
                  disabled={bulkDeleteSupplierOrdersMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkDeleteSupplierOrdersMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Удалить выбранные ({selectedSupplierOrderIds.size})
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все заказы поставщикам"
                      checked={
                        filteredSupplierOrders.length > 0 &&
                        selectedSupplierOrderIds.size === filteredSupplierOrders.length
                      }
                      onChange={() => {
                        if (
                          selectedSupplierOrderIds.size === filteredSupplierOrders.length &&
                          filteredSupplierOrders.length > 0
                        ) {
                          setSelectedSupplierOrderIds(new Set());
                        } else {
                          setSelectedSupplierOrderIds(new Set(filteredSupplierOrders.map((o) => o.id)));
                        }
                      }}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
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
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[280px]">
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
                  const isSelected = selectedSupplierOrderIds.has(order.id);

                  return (
                    <tr
                      key={order.id}
                      onClick={() => setSelectedOrderForDetail(order)}
                      className={cn(
                        "transition-colors hover:bg-[#fafafa] cursor-pointer",
                        isSelected && "bg-indigo-50/40",
                      )}
                    >
                      <td
                        className="px-3 py-3 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Выбрать заказ ${order.orderNumber}`}
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selectedSupplierOrderIds);
                            if (next.has(order.id)) next.delete(order.id);
                            else next.add(order.id);
                            setSelectedSupplierOrderIds(next);
                          }}
                          className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                      </td>
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
                        <div
                          className="flex items-center justify-end gap-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* Кнопка Просмотр */}
                          <button
                            type="button"
                            onClick={() => setSelectedOrderForDetail(order)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] shadow-2xs transition-colors"
                            title="Просмотр деталей заказа"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>

                          {/* Кнопка Редактировать — доступна для всех заказов */}
                          <button
                            type="button"
                            onClick={() => handleOpenEditModal(order)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] shadow-2xs transition-colors cursor-pointer"
                            title="Редактировать заказ"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>

                          {/* Кнопка Оплачено */}
                          {!isPaid && order.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handlePayOrder(order)}
                              disabled={paySupplierOrderMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-[6px] bg-emerald-600 px-2.5 h-7 text-xs font-medium text-white hover:bg-emerald-700 shadow-xs transition-colors cursor-pointer"
                              title="Оплатить заказ поставщику (создать расходный ордер в кассе)"
                            >
                              <CreditCard className="h-3 w-3" />
                              Оплачено
                            </button>
                          )}

                          {/* Кнопка Оприходовать */}
                          {!isReceived && order.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handleOpenReceiptModal(order)}
                              disabled={createReceiptMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 h-7 text-xs font-medium text-white hover:bg-[#3d2ee0] shadow-xs transition-colors cursor-pointer"
                              title="Оприходовать заказ на склад"
                            >
                              <ArrowDownToLine className="h-3 w-3" />
                              Оприходовать
                            </button>
                          )}

                          {isReceived && (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              На складе
                            </span>
                          )}

                          {/* Кнопка Удалить — доступна для всех заказов (для оприходованных откатывает партии и кассу) */}
                          <button
                            type="button"
                            onClick={() => handleDeleteSupplierOrder(order)}
                            disabled={deleteSupplierOrderMutation.isPending}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                            title={
                              isReceived
                                ? "Удалить заказ и откатить связанные партии, движения и оплату"
                                : "Удалить заказ поставщику"
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSupplierOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#888888]">
                      {isSupplierOrdersLoading ? (
                        "Загрузка заказов поставщикам..."
                      ) : (
                        <div className="flex flex-col items-center justify-center gap-3">
                          <Truck className="h-8 w-8 text-[#cccccc]" />
                          <div>
                            {searchQuery.trim()
                              ? "Заказов по вашему запросу не найдено."
                              : "Заказов поставщикам пока нет."}
                          </div>
                          {!searchQuery.trim() && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedAggregatedIds(new Set());
                                setCreateSupplierOrderModalOpen(true);
                              }}
                              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-1.5 text-xs font-semibold text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Создать заказ поставщику</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Вкладка 5: Журнал движений */}
      {activeTab === "movements" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {selectedMovementIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 bg-indigo-50/70 border-b border-indigo-200 px-4 py-2 text-xs">
              <div className="flex items-center gap-2 text-[#111111] font-medium">
                <Check className="h-4 w-4 text-[#4a38f5]" />
                <span>
                  Выбрано движений: <b className="font-mono">{selectedMovementIds.size}</b>
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMovementIds(new Set())}
                  className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                >
                  Снять выбор
                </button>
                <button
                  type="button"
                  onClick={handleBulkDeleteMovements}
                  disabled={bulkDeleteMovementsMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-[6px] bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-700 transition-colors cursor-pointer disabled:opacity-50"
                >
                  {bulkDeleteMovementsMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  Удалить выбранные ({selectedMovementIds.size})
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все движения"
                      checked={
                        filteredMovements.length > 0 &&
                        selectedMovementIds.size === filteredMovements.length
                      }
                      onChange={() => {
                        if (
                          selectedMovementIds.size === filteredMovements.length &&
                          filteredMovements.length > 0
                        ) {
                          setSelectedMovementIds(new Set());
                        } else {
                          setSelectedMovementIds(new Set(filteredMovements.map((m) => m.id)));
                        }
                      }}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[150px]">
                    Дата и время
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Товар
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[150px]">
                    Тип операции
                  </th>
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[95px]">
                    Кол-во
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Связь / Описание
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                    Инициатор
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredMovements.map((m) => {
                  const typeMap: Record<string, { label: string; color: string; sign: string }> = {
                    intake: { label: "Приход", color: "bg-emerald-50 text-emerald-700 border-emerald-200", sign: "+" },
                    reserve: { label: "Резерв", color: "bg-amber-50 text-amber-700 border-amber-200", sign: "lock" },
                    release: { label: "Снятие резерва", color: "bg-sky-50 text-sky-700 border-sky-200", sign: "unlock" },
                    write_off: { label: "Списание FIFO", color: "bg-rose-50 text-rose-700 border-rose-200", sign: "-" },
                    repair_consumption: { label: "Списание по наряду", color: "bg-rose-50 text-rose-700 border-rose-200", sign: "-" },
                    consume: { label: "Списание", color: "bg-rose-50 text-rose-700 border-rose-200", sign: "-" },
                    adjustment: { label: "Корректировка", color: "bg-neutral-100 text-neutral-700 border-neutral-300", sign: "±" },
                  };
                  const t = typeMap[m.type] ?? { label: m.type, color: "bg-gray-100 text-gray-700 border-gray-200", sign: "" };
                  const isSelected = selectedMovementIds.has(m.id);

                  return (
                    <tr
                      key={m.id}
                      className={cn(
                        "transition-colors hover:bg-[#fafafa]",
                        isSelected && "bg-indigo-50/40",
                      )}
                    >
                      <td className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          aria-label={`Выбрать движение ${m.itemName ?? m.id}`}
                          checked={isSelected}
                          onChange={() => {
                            const next = new Set(selectedMovementIds);
                            if (next.has(m.id)) next.delete(m.id);
                            else next.add(m.id);
                            setSelectedMovementIds(next);
                          }}
                          className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                        />
                      </td>
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
                        <span className="inline-flex items-center justify-center gap-1 font-mono text-[13px] font-semibold text-[#111111]">
                          {t.sign === "lock" ? (
                            <Lock className="h-3 w-3 text-amber-600" />
                          ) : t.sign === "unlock" ? (
                            <Unlock className="h-3 w-3 text-sky-600" />
                          ) : (
                            <span>{t.sign}</span>
                          )}
                          <span>{m.quantity}</span>
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
                        {!m.repairOrderId && m.dealId && (
                          <Link
                            href={`/crm/deals?record=${m.dealId}`}
                            className="inline-flex items-center gap-1 text-[11px] text-[#4a38f5] hover:underline mt-0.5"
                          >
                            <span>Сделка: {m.dealTitle ?? "Открыть"}</span>
                            <ExternalLink className="h-2.5 w-2.5" />
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-[#888888]">{m.createdByName || "Система"}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setSelectedMovementForEdit(m)}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-[#e5e5e5] bg-white text-[#666666] hover:text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
                            title="Редактировать запись движения"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMovement(m)}
                            disabled={deleteMovementMutation.isPending}
                            className="inline-flex items-center justify-center h-7 w-7 rounded-[6px] border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100 transition-colors cursor-pointer disabled:opacity-50"
                            title="Удалить запись движения и откатить остатки/резерв"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredMovements.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-sm text-[#888888]">
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
      <WarehouseDictionariesModal
        open={dictionariesModalOpen}
        onClose={() => setDictionariesModalOpen(false)}
      />

      <CreateItemModal
        open={createItemModalOpen}
        onClose={() => setCreateItemModalOpen(false)}
      />

      {intakeModalOpen && (
        <WarehouseIntakeDialog
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
      )}

      <CreateSupplierOrderModal
        open={createSupplierOrderModalOpen}
        onClose={() => setCreateSupplierOrderModalOpen(false)}
        selectedRequests={selectedAggregatedRows}
        onSuccess={() => {
          setSelectedAggregatedIds(new Set());
          setActiveTab("supplier_orders");
        }}
      />

      <SupplierOrderDetailModal
        open={Boolean(selectedOrderForDetail)}
        onClose={() => setSelectedOrderForDetail(null)}
        order={selectedOrderForDetail}
        onEdit={(o) => {
          setSelectedOrderForDetail(null);
          handleOpenEditModal(o);
        }}
        onPay={(o) => handlePayOrder(o)}
        onReceipt={(o) => {
          setSelectedOrderForDetail(null);
          handleOpenReceiptModal(o);
        }}
        onDelete={(o) => handleDeleteSupplierOrder(o)}
      />

      <EditSupplierOrderModal
        open={Boolean(selectedOrderForEdit)}
        onClose={() => setSelectedOrderForEdit(null)}
        order={selectedOrderForEdit}
        onSuccess={() => {
          setSelectedOrderForEdit(null);
        }}
      />

      <ReceiptSupplierOrderModal
        open={Boolean(selectedOrderForReceipt)}
        onClose={() => setSelectedOrderForReceipt(null)}
        order={selectedOrderForReceipt}
        onSuccess={() => {
          setSelectedOrderForReceipt(null);
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

      <EditItemModal
        open={editItemModalOpen || Boolean(editParam)}
        itemId={selectedItemForEdit?.id ?? editParam ?? null}
        initialItem={selectedItemForEdit}
        onClose={handleCloseEditItemModal}
        onSuccess={() => {
          setSelectedItemIds(new Set());
        }}
      />

      <EditPurchaseRequestModal
        open={Boolean(selectedPurchaseForEdit)}
        onClose={() => setSelectedPurchaseForEdit(null)}
        aggregatedRow={selectedPurchaseForEdit}
        allRequests={purchaseRequests}
      />

      <EditBatchModal
        open={Boolean(selectedBatchForEdit)}
        onClose={() => setSelectedBatchForEdit(null)}
        batch={selectedBatchForEdit}
      />

      <EditMovementModal
        open={Boolean(selectedMovementForEdit)}
        onClose={() => setSelectedMovementForEdit(null)}
        movement={selectedMovementForEdit}
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
              onClick={handleBulkCreatePurchaseRequest}
              disabled={!hasReservedOrDeficit || bulkCreatePurchasesMutation.isPending}
              className={cn(
                "flex h-7 items-center gap-1.5 rounded-[6px] px-3 text-xs font-medium shadow-xs transition-colors",
                hasReservedOrDeficit && !bulkCreatePurchasesMutation.isPending
                  ? "bg-amber-600 text-white hover:bg-amber-700 cursor-pointer"
                  : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed",
              )}
              title={
                !hasReservedOrDeficit
                  ? "Кнопка активна только для позиций со статусом «В резерве» или дефицитом"
                  : "Сформировать заявку на закупку для выбранных позиций"
              }
            >
              {bulkCreatePurchasesMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShoppingCart className="h-3.5 w-3.5" />
              )}
              Сформировать заявку
            </button>

            <button
              type="button"
              onClick={handleBulkEditClick}
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
