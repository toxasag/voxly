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
import { apiClient } from "@/lib/api/apiClient";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { useTableSelection } from "@/lib/hooks/use-table-selection";
import { TableBulkBar } from "@/components/crm/shared/TableBulkBar";
import { Guard } from "@/components/shared/Guard";
import { useAuth } from "@/lib/auth/use-auth";
import { useServices } from "@/lib/api/use-services";
import { ServicesCatalogTab } from "@/components/warehouse/ServicesCatalogTab";
import {
  useWarehouse,
  useWarehouseBatchesPaginated,
  useWarehouseMovementsPaginated,
  usePurchaseRequests,
  useAggregatedPurchaseRequestsPaginated,
  useSupplierOrdersPaginated,
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
type SortDirection = "asc" | "desc";
const ITEM_SORT_FIELDS = [
  "sku",
  "name",
  "category",
  "brand",
  "totalStock",
  "reservedStock",
  "availableStock",
  "minStock",
  "costPrice",
  "retailPrice",
] as const;
type ItemSortField = (typeof ITEM_SORT_FIELDS)[number];

interface TabSortState<K extends string = string> {
  sortBy: K | null;
  sortDir: SortDirection;
}

function nextTabSort<K extends string>(prev: TabSortState<K>, field: K): TabSortState<K> {
  if (prev.sortBy !== field) return { sortBy: field, sortDir: "asc" };
  if (prev.sortDir === "asc") return { sortBy: field, sortDir: "desc" };
  return { sortBy: null, sortDir: "asc" };
}

function SortableTh({
  label,
  active,
  direction,
  onClick,
  align = "left",
  title,
  className,
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "center" | "right";
  title?: string;
  className?: string;
}) {
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <th
      onClick={onClick}
      className={cn(
        "px-4 py-2.5 text-[11px] font-semibold text-[#666666] uppercase tracking-wider select-none cursor-pointer hover:bg-[#f0f0f0] hover:text-[#111111] transition-colors group",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
        active && "text-[#4a38f5] bg-[#4a38f5]/5",
        className,
      )}
      title={title ?? `Сортировать: ${label}`}
    >
      <div className={cn("inline-flex items-center gap-1", justify)}>
        <span>{label}</span>
        {active ? (
          direction === "asc" ? (
            <ArrowUp className="h-3 w-3 text-[#4a38f5] shrink-0" />
          ) : (
            <ArrowDown className="h-3 w-3 text-[#4a38f5] shrink-0" />
          )
        ) : (
          <ArrowUpDown className="h-2.5 w-2.5 text-[#888888] opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        )}
      </div>
    </th>
  );
}

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

  const sectionParam = searchParams.get("section");
  const initialActiveTab: WarehouseTab =
    sectionParam === "batches" ||
    sectionParam === "purchases" ||
    sectionParam === "supplier_orders" ||
    sectionParam === "movements"
      ? sectionParam
      : "items";
  const [activeTab, setActiveTab] = useState<WarehouseTab>(initialActiveTab);
  const [searchQuery, setSearchQuery] = useState("");

  // Параметры серверной пагинации и фильтрации номенклатуры склада
  const rawPage = parseInt(searchParams.get("page") ?? "1", 10);
  const page = isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;

  const rawLimit = parseInt(searchParams.get("limit") ?? "25", 10);
  const limit: WarehouseLimit = WAREHOUSE_LIMITS.includes(rawLimit as WarehouseLimit)
    ? (rawLimit as WarehouseLimit)
    : 25;

  const rawSortBy = searchParams.get("sort_by") ?? searchParams.get("sort") ?? "";
  const rawSortDir = searchParams.get("sort_dir") ?? searchParams.get("order") ?? "";
  const sortField: ItemSortField | null = ITEM_SORT_FIELDS.includes(rawSortBy as ItemSortField)
    ? (rawSortBy as ItemSortField)
    : null;
  const sortDirection: SortDirection = rawSortDir === "desc" ? "desc" : "asc";

  // Пагинация и серверная сортировка вторичных вкладок
  const [batchesPage, setBatchesPage] = useState(1);
  const [batchesLimit, setBatchesLimit] = useState<WarehouseLimit>(25);
  const [batchesSort, setBatchesSort] = useState<
    TabSortState<"receivedAt" | "batchNumber" | "itemName" | "supplierName" | "purchasePrice" | "initialQuantity" | "remainingQuantity">
  >({ sortBy: null, sortDir: "desc" });

  const [purchasesPage, setPurchasesPage] = useState(1);
  const [purchasesLimit, setPurchasesLimit] = useState<WarehouseLimit>(25);
  const [purchasesSort, setPurchasesSort] = useState<
    TabSortState<"itemName" | "quantity" | "estimatedPrice" | "status">
  >({ sortBy: null, sortDir: "asc" });

  const [ordersPage, setOrdersPage] = useState(1);
  const [ordersLimit, setOrdersLimit] = useState<WarehouseLimit>(25);
  const [ordersSort, setOrdersSort] = useState<
    TabSortState<"orderNumber" | "supplierName" | "totalAmount" | "status" | "paidAt">
  >({ sortBy: null, sortDir: "desc" });

  const [movementsPage, setMovementsPage] = useState(1);
  const [movementsLimit, setMovementsLimit] = useState<WarehouseLimit>(25);
  const [movementsSort, setMovementsSort] = useState<
    TabSortState<"createdAt" | "itemName" | "type" | "quantity" | "createdByName">
  >({ sortBy: null, sortDir: "desc" });

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
    sort_by?: string | null;
    sort_dir?: SortDirection | null;
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
    if (updates.sort_by !== undefined) {
      if (updates.sort_by) {
        params.set("sort_by", updates.sort_by);
      } else {
        params.delete("sort_by");
        params.delete("sort");
      }
    }
    if (updates.sort_dir !== undefined) {
      if (updates.sort_dir && updates.sort_by !== null) {
        params.set("sort_dir", updates.sort_dir);
      } else {
        params.delete("sort_dir");
        params.delete("order");
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
    setBatchesPage(1);
    setPurchasesPage(1);
    setOrdersPage(1);
    setMovementsPage(1);
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
  const [supplierOrderRowsOverride, setSupplierOrderRowsOverride] = useState<AggregatedPurchaseRequestDTO[] | null>(null);
  const [selectedPurchaseForEdit, setSelectedPurchaseForEdit] = useState<AggregatedPurchaseRequestDTO | null>(null);

  // Модальные окна заказов поставщикам, партий и движений
  const [selectedOrderForEdit, setSelectedOrderForEdit] = useState<SupplierOrderDTO | null>(null);
  const [selectedOrderForDetail, setSelectedOrderForDetail] = useState<SupplierOrderDTO | null>(null);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<SupplierOrderDTO | null>(null);
  const [selectedBatchForEdit, setSelectedBatchForEdit] = useState<WarehouseBatchDTO | null>(null);
  const [selectedMovementForEdit, setSelectedMovementForEdit] = useState<WarehouseMovementDTO | null>(null);

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

  // Данные номенклатуры с серверной пагинацией и серверной сортировкой по всему каталогу
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
    sortBy: sortField ?? undefined,
    sortDir: sortField ? sortDirection : undefined,
  });

  const items = warehouseData?.items ?? [];
  const meta = warehouseData?.meta ?? { total: 0, page: 1, limit: 25, pages: 0 };
  const filteredItems = items;
  const sortedItems = items;

  const knownItemsRef = useRef<Map<string, WarehouseItemDTO>>(new Map());
  useEffect(() => {
    for (const item of items) {
      knownItemsRef.current.set(item.id, item);
    }
  }, [items]);

  const itemsFiltersPayload = useMemo(
    () => ({
      search: searchQuery.trim() || undefined,
      category: selectedCategory || undefined,
      brand: selectedBrand || undefined,
      model_ids: selectedModelIds.length > 0 ? selectedModelIds : undefined,
    }),
    [searchQuery, selectedCategory, selectedBrand, selectedModelIds],
  );
  const itemsFilterKey = useMemo(() => JSON.stringify(itemsFiltersPayload), [itemsFiltersPayload]);
  const itemsSelection = useTableSelection({
    filterKey: itemsFilterKey,
    totalCount: meta.total,
  });

  const handleSort = (field: ItemSortField) => {
    let nextField: ItemSortField | null = field;
    let nextDir: SortDirection | null = "asc";
    if (sortField === field) {
      if (sortDirection === "asc") {
        nextDir = "desc";
      } else {
        nextField = null;
        nextDir = null;
      }
    }
    updateUrl({
      page: 1,
      sort_by: nextField,
      sort_dir: nextDir,
    });
  };

  const bulkCreatePurchasesMutation = useBulkCreatePurchaseRequests();

  const selectedItemsList = useMemo(() => {
    return Array.from(itemsSelection.selectedIds)
      .map((id) => items.find((i) => i.id === id) ?? knownItemsRef.current.get(id))
      .filter((i): i is WarehouseItemDTO => Boolean(i));
  }, [itemsSelection.selectedIds, items]);

  const hasReservedOrDeficit = useMemo(() => {
    if (itemsSelection.isAllSelected) return itemsSelection.effectiveSelectedCount > 0;
    return selectedItemsList.some(
      (item) => item.reservedStock > 0 || item.availableStock < 0 || item.status === "reserved",
    );
  }, [itemsSelection.isAllSelected, itemsSelection.effectiveSelectedCount, selectedItemsList]);

  const handleBulkCreatePurchaseRequest = async () => {
    if (itemsSelection.effectiveSelectedCount === 0) return;
    try {
      const scope = itemsSelection.buildBulkPayload(itemsFiltersPayload);
      const res = await bulkCreatePurchasesMutation.mutateAsync({
        ...(scope.mode === "all"
          ? {
              mode: "all",
              filters: scope.filters,
              excluded_ids: scope.excluded_ids,
            }
          : {
              mode: "ids",
              itemIds: scope.ids,
              ids: scope.ids,
            }),
        comment: "Сформировано из массовых действий склада",
      });
      toast.success(`Сформировано заявок на закупку: ${res.length}`);
      itemsSelection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сформировать заявку на закупку");
    }
  };

  // Запросы вторичных вкладок (серверная пагинация + сортировка)
  const batchesQuery = useWarehouseBatchesPaginated(
    {
      page: batchesPage,
      limit: batchesLimit,
      search: searchQuery,
      sortBy: batchesSort.sortBy ?? undefined,
      sortDir: batchesSort.sortBy ? batchesSort.sortDir : undefined,
    },
    { enabled: activeTab === "batches" },
  );
  const batches = batchesQuery.data?.items ?? [];
  const batchesMeta = batchesQuery.data?.meta ?? {
    total: 0,
    page: batchesPage,
    limit: batchesLimit,
    pages: 0,
  };
  const isBatchesLoading = batchesQuery.isLoading;

  const movementsQuery = useWarehouseMovementsPaginated(
    {
      page: movementsPage,
      limit: movementsLimit,
      search: searchQuery,
      sortBy: movementsSort.sortBy ?? undefined,
      sortDir: movementsSort.sortBy ? movementsSort.sortDir : undefined,
    },
    { enabled: activeTab === "movements" },
  );
  const movements = movementsQuery.data?.items ?? [];
  const movementsMeta = movementsQuery.data?.meta ?? {
    total: 0,
    page: movementsPage,
    limit: movementsLimit,
    pages: 0,
  };
  const isMovementsLoading = movementsQuery.isLoading;

  const { data: purchaseRequests = [] } = usePurchaseRequests();
  const purchasesQuery = useAggregatedPurchaseRequestsPaginated(
    {
      page: purchasesPage,
      limit: purchasesLimit,
      search: searchQuery,
      status: purchaseStatusFilter !== "all" ? purchaseStatusFilter : undefined,
      sortBy: purchasesSort.sortBy ?? undefined,
      sortDir: purchasesSort.sortBy ? purchasesSort.sortDir : undefined,
    },
    { enabled: activeTab === "purchases" },
  );
  const aggregatedPurchases = purchasesQuery.data?.items ?? [];
  const purchasesMeta = purchasesQuery.data?.meta ?? {
    total: 0,
    page: purchasesPage,
    limit: purchasesLimit,
    pages: 0,
  };
  const isAggregatedLoading = purchasesQuery.isLoading;

  const pendingBadgeQuery = useAggregatedPurchaseRequestsPaginated({ page: 1, limit: 1, status: "pending" });
  const orderedBadgeQuery = useAggregatedPurchaseRequestsPaginated({ page: 1, limit: 1, status: "ordered" });

  const supplierOrdersQuery = useSupplierOrdersPaginated(
    {
      page: ordersPage,
      limit: ordersLimit,
      search: searchQuery,
      status: supplierOrderStatusFilter !== "all" ? supplierOrderStatusFilter : undefined,
      sortBy: ordersSort.sortBy ?? undefined,
      sortDir: ordersSort.sortBy ? ordersSort.sortDir : undefined,
    },
    { enabled: activeTab === "supplier_orders" },
  );
  const supplierOrders = supplierOrdersQuery.data?.items ?? [];
  const supplierOrdersMeta = supplierOrdersQuery.data?.meta ?? {
    total: 0,
    page: ordersPage,
    limit: ordersLimit,
    pages: 0,
  };
  const isSupplierOrdersLoading = supplierOrdersQuery.isLoading;

  const knownPurchasesRef = useRef<Map<string, AggregatedPurchaseRequestDTO>>(new Map());
  useEffect(() => {
    for (const row of aggregatedPurchases) {
      knownPurchasesRef.current.set(row.id, row);
    }
  }, [aggregatedPurchases]);

  const batchesSelection = useTableSelection({
    filterKey: JSON.stringify({ search: searchQuery.trim() }),
    totalCount: batchesMeta.total,
  });
  const purchasesSelection = useTableSelection({
    filterKey: JSON.stringify({ search: searchQuery.trim(), status: purchaseStatusFilter }),
    totalCount: purchasesMeta.total,
  });
  const ordersSelection = useTableSelection({
    filterKey: JSON.stringify({ search: searchQuery.trim(), status: supplierOrderStatusFilter }),
    totalCount: supplierOrdersMeta.total,
  });
  const movementsSelection = useTableSelection({
    filterKey: JSON.stringify({ search: searchQuery.trim() }),
    totalCount: movementsMeta.total,
  });

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

  const pageItemIds = useMemo(() => sortedItems.map((i) => i.id), [sortedItems]);

  const handleToggleSelectAll = () => {
    itemsSelection.togglePage(pageItemIds);
  };

  const handleToggleItem = (id: string) => {
    itemsSelection.toggleRow(id);
  };

  const handleExport = async (format: "xlsx" | "csv", onlySelected = false) => {
    setExportDropdownOpen(false);
    try {
      const sortParams = {
        sort_by: sortField ?? undefined,
        sort_dir: sortField ? sortDirection : undefined,
      };
      if (onlySelected && itemsSelection.effectiveSelectedCount > 0) {
        const scope = itemsSelection.buildBulkPayload(itemsFiltersPayload);
        await exportMutation.mutateAsync({
          format,
          ...scope,
          ...sortParams,
        });
      } else {
        await exportMutation.mutateAsync({
          format,
          mode: "all",
          filters: itemsFiltersPayload,
          search: searchQuery.trim() || undefined,
          category: selectedCategory || undefined,
          brand: selectedBrand || undefined,
          model_ids: selectedModelIds.length > 0 ? selectedModelIds : undefined,
          ...sortParams,
        });
      }
      toast.success(format === "xlsx" ? "Файл Excel успешно скачан" : "Файл CSV успешно скачан");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось экспортировать");
    }
  };

  const handleBulkDelete = async () => {
    if (itemsSelection.effectiveSelectedCount === 0) return;
    const hasStockItems = itemsSelection.isAllSelected
      ? items.some((i) => i.totalStock > 0 || i.reservedStock > 0)
      : selectedItemsList.some((i) => i.totalStock > 0 || i.reservedStock > 0);
    const forceDelete = hasStockItems || itemsSelection.isAllSelected;
    const count = itemsSelection.effectiveSelectedCount;
    const confirmText = forceDelete
      ? `Среди выбранных позиций (${count} шт.) могут быть товары с остатком или резервом. При удалении все их партии, резервы и движения будут очищены, а остатки пересчитаны. Удалить принудительно?`
      : `Удалить выбранные позиции (${count} шт.) из номенклатуры?`;
    if (!confirm(confirmText)) return;

    try {
      const scope = itemsSelection.buildBulkPayload(itemsFiltersPayload);
      const res = await bulkDeleteMutation.mutateAsync({
        ...scope,
        force: forceDelete,
      });
      if (res.errors && res.errors.length > 0) {
        toast.warning(`Удалено ${res.deletedCount} позиций. Предупреждение: ${res.errors[0]}`);
      } else {
        toast.success(`Успешно удалено позиций: ${res.deletedCount}`);
      }
      itemsSelection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные позиции");
    }
  };

  const filteredAggregatedPurchases = aggregatedPurchases;
  const filteredSupplierOrders = supplierOrders;
  const filteredBatches = batches;
  const filteredMovements = movements;

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
    const pendingPurchasesCount =
      (pendingBadgeQuery.data?.meta.total ?? 0) + (orderedBadgeQuery.data?.meta.total ?? 0);

    return { totalItemsCount, lowStockCount, totalValuation, pendingPurchasesCount };
  }, [items, meta, pendingBadgeQuery.data?.meta.total, orderedBadgeQuery.data?.meta.total]);

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

  const pagePurchaseIds = useMemo(
    () => filteredAggregatedPurchases.map((p) => p.id),
    [filteredAggregatedPurchases],
  );
  const toggleSelectAllPurchases = () => {
    purchasesSelection.togglePage(pagePurchaseIds);
  };
  const toggleSelectPurchase = (id: string) => {
    purchasesSelection.toggleRow(id);
  };

  const selectedAggregatedRows = useMemo(() => {
    return Array.from(purchasesSelection.selectedIds)
      .map((id) => filteredAggregatedPurchases.find((p) => p.id === id) ?? knownPurchasesRef.current.get(id))
      .filter((p): p is AggregatedPurchaseRequestDTO => Boolean(p));
  }, [purchasesSelection.selectedIds, filteredAggregatedPurchases]);

  const handleOpenCreateSupplierOrderFromPurchases = async () => {
    if (purchasesSelection.isAllSelected) {
      try {
        const q = new URLSearchParams();
        q.set("all", "true");
        if (searchQuery.trim()) q.set("search", searchQuery.trim());
        if (purchaseStatusFilter !== "all") q.set("status", purchaseStatusFilter);
        const res = await apiClient.get<AggregatedPurchaseRequestDTO[]>(
          `/api/v1/warehouse/purchase-requests?${q.toString()}`,
        );
        const allRows = (res.data ?? []).filter(
          (row) => !purchasesSelection.excludedIds.has(row.id),
        );
        setSupplierOrderRowsOverride(allRows);
        setCreateSupplierOrderModalOpen(true);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось загрузить выбранные заявки");
      }
      return;
    }
    setSupplierOrderRowsOverride(null);
    setCreateSupplierOrderModalOpen(true);
  };

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
      toast.error("Нельзя редактировать заказ, товары по которому уже полностью оприходованы на склад");
      return;
    }
    setSelectedOrderForEdit(order);
  };

  const handleDeleteSupplierOrder = async (order: SupplierOrderDTO) => {
    const hasReceipts = order.status === "received" || order.status === "partially_received";
    const confirmMsg = hasReceipts
      ? `Удалить оприходованный заказ №${order.orderNumber}? Все созданные им партии, движения прихода/резерва, кассовая оплата и доп. расходы будут откачены, а заявки вернутся в «В ожидании».`
      : `Удалить заказ поставщику №${order.orderNumber}? Все заявки на закупку вернутся в статус «В ожидании», а оплата (если была) будет отменена.`;
    if (!confirm(confirmMsg)) {
      return;
    }
    try {
      await deleteSupplierOrderMutation.mutateAsync(order.id);
      toast.success(
        hasReceipts
          ? `Заказ №${order.orderNumber} и связанные партии удалены, остатки и касса пересчитаны`
          : `Заказ №${order.orderNumber} удален, заявки возвращены в очередь`,
      );
      if (ordersSelection.isRowSelected(order.id)) {
        ordersSelection.toggleRow(order.id);
      }
      if (selectedOrderForDetail?.id === order.id) {
        setSelectedOrderForDetail(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить заказ поставщику");
    }
  };

  const handleBulkDeleteSupplierOrders = async () => {
    const count = ordersSelection.effectiveSelectedCount;
    if (count === 0) return;
    if (
      !confirm(
        `Удалить выбранные заказы поставщикам (${count} шт.)? Связанные партии, движения и кассовые проводки будут откачены, а заявки вернутся в «В ожидании».`,
      )
    ) {
      return;
    }
    try {
      const payload = ordersSelection.buildBulkPayload({
        search: searchQuery.trim() || undefined,
        status: supplierOrderStatusFilter !== "all" ? supplierOrderStatusFilter : undefined,
      });
      const res = await bulkDeleteSupplierOrdersMutation.mutateAsync(payload);
      toast.success(
        `Удалено заказов: ${res.deletedCount}${res.rolledBackBatchesCount > 0 ? ` (откачено партий: ${res.rolledBackBatchesCount})` : ""}`,
      );
      ordersSelection.clear();
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
      if (batchesSelection.isRowSelected(batch.id)) {
        batchesSelection.toggleRow(batch.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить партию");
    }
  };

  const handleBulkDeleteBatches = async () => {
    const count = batchesSelection.effectiveSelectedCount;
    if (count === 0) return;
    if (
      !confirm(
        `Удалить выбранные партии (${count} шт.)? Все связанные движения, резервы и аллокации этих партий будут очищены.`,
      )
    ) {
      return;
    }
    try {
      const payload = batchesSelection.buildBulkPayload({
        search: searchQuery.trim() || undefined,
      });
      const res = await bulkDeleteBatchesMutation.mutateAsync(payload);
      toast.success(`Удалено партий: ${res.deletedCount}`);
      batchesSelection.clear();
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
      if (movementsSelection.isRowSelected(movement.id)) {
        movementsSelection.toggleRow(movement.id);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить движение");
    }
  };

  const handleBulkDeleteMovements = async () => {
    const count = movementsSelection.effectiveSelectedCount;
    if (count === 0) return;
    if (
      !confirm(
        `Удалить выбранные записи движений (${count} шт.)? Влияние операций на остатки и резервы будет откачено.`,
      )
    ) {
      return;
    }
    try {
      const payload = movementsSelection.buildBulkPayload({
        search: searchQuery.trim() || undefined,
      });
      const res = await bulkDeleteMovementsMutation.mutateAsync(payload);
      toast.success(`Удалено записей движений: ${res.deletedCount}`);
      movementsSelection.clear();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить выбранные движения");
    }
  };

  const handleBulkDeletePurchases = async () => {
    if (purchasesSelection.effectiveSelectedCount === 0) return;
    const confirmCount = purchasesSelection.effectiveSelectedCount;
    if (!confirm(`Удалить выбранные заявки (${confirmCount} шт.)?`)) return;
    try {
      if (purchasesSelection.isAllSelected) {
        const expandedExcluded = Array.from(purchasesSelection.excludedIds).flatMap(
          (id) => knownPurchasesRef.current.get(id)?.requestIds ?? [id],
        );
        const res = await bulkDeletePurchasesMutation.mutateAsync({
          mode: "all",
          filters: {
            search: searchQuery.trim() || undefined,
            status: purchaseStatusFilter !== "all" ? purchaseStatusFilter : undefined,
          },
          excluded_ids: expandedExcluded.length > 0 ? expandedExcluded : undefined,
        });
        toast.success(`Удалено заявок на закупку: ${res.deletedCount}`);
      } else {
        const allIds = Array.from(purchasesSelection.selectedIds).flatMap(
          (id) => knownPurchasesRef.current.get(id)?.requestIds ?? [id],
        );
        if (allIds.length === 0) return;
        const res = await bulkDeletePurchasesMutation.mutateAsync({
          mode: "ids",
          ids: allIds,
        });
        toast.success(`Удалено заявок на закупку: ${res.deletedCount}`);
      }
      purchasesSelection.clear();
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
      if (itemsSelection.isRowSelected(item.id)) {
        itemsSelection.toggleRow(item.id);
      }
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
    if (!itemsSelection.isAllSelected && itemsSelection.effectiveSelectedCount === 1) {
      const selectedId = Array.from(itemsSelection.selectedIds)[0];
      const item = items.find((i) => i.id === selectedId) ?? knownItemsRef.current.get(selectedId);
      if (item) {
        handleOpenEditItemModal(item);
        return;
      }
      setEditItemModalOpen(true);
      const params = new URLSearchParams(searchParams.toString());
      params.set("edit", selectedId);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      return;
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
                {itemsSelection.effectiveSelectedCount > 0 && (
                  <>
                    <div className="my-1 border-t border-[#f0f0f0]" />
                    <button
                      type="button"
                      onClick={() => handleExport("xlsx", true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#4a38f5] font-medium hover:bg-[#4a38f5]/5 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Выбранные в Excel ({itemsSelection.effectiveSelectedCount})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport("csv", true)}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-[#4a38f5] font-medium hover:bg-[#4a38f5]/5 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      <span>Выбранные в CSV ({itemsSelection.effectiveSelectedCount})</span>
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
                onClick={() => {
                  setPurchaseStatusFilter(st);
                  setPurchasesPage(1);
                }}
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
                setSupplierOrderRowsOverride([]);
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
          {itemsSelection.effectiveSelectedCount > 0 && (
            <div className="border-b border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <TableBulkBar
                selectedCount={itemsSelection.effectiveSelectedCount}
                totalCount={meta.total}
                isAllSelected={itemsSelection.isAllSelected}
                excludedCount={itemsSelection.excludedCount}
                entityNamePlural="позиций"
                pageItemCount={sortedItems.length}
                onSelectAll={itemsSelection.selectAllAcrossPages}
                onClearSelection={itemsSelection.clear}
                onDelete={handleBulkDelete}
                isDeleting={bulkDeleteMutation.isPending}
              >
                <button
                  type="button"
                  onClick={handleBulkCreatePurchaseRequest}
                  disabled={!hasReservedOrDeficit || bulkCreatePurchasesMutation.isPending}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium transition-colors",
                    hasReservedOrDeficit && !bulkCreatePurchasesMutation.isPending
                      ? "bg-amber-600 text-white hover:bg-amber-700 cursor-pointer"
                      : "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed",
                  )}
                >
                  <ShoppingCart className="h-3.5 w-3.5" />
                  Заявка
                </button>
                <button
                  type="button"
                  onClick={handleBulkEditClick}
                  className="flex h-7 items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-2.5 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer"
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  Изменить
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("xlsx", true)}
                  disabled={exportMutation.isPending}
                  className="flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Excel
                </button>
                <button
                  type="button"
                  onClick={() => handleExport("csv", true)}
                  disabled={exportMutation.isPending}
                  className="flex h-7 items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 text-xs font-medium text-[#111111] hover:bg-[#fafafa] transition-colors cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  CSV
                </button>
              </TableBulkBar>
            </div>
          )}
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
                      aria-label="Выбрать все позиции на странице"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = itemsSelection.isPagePartiallySelected(pageItemIds);
                        }
                      }}
                      checked={itemsSelection.isPageAllSelected(pageItemIds)}
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
                  const isSelected = itemsSelection.isRowSelected(item.id);

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
          {batchesSelection.effectiveSelectedCount > 0 && (
            <div className="border-b border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <TableBulkBar
                selectedCount={batchesSelection.effectiveSelectedCount}
                totalCount={batchesMeta.total}
                isAllSelected={batchesSelection.isAllSelected}
                excludedCount={batchesSelection.excludedCount}
                entityNamePlural="партий"
                pageItemCount={filteredBatches.length}
                onSelectAll={batchesSelection.selectAllAcrossPages}
                onClearSelection={batchesSelection.clear}
                onDelete={handleBulkDeleteBatches}
                isDeleting={bulkDeleteBatchesMutation.isPending}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full transition-opacity duration-150",
                batchesQuery.isPlaceholderData && "opacity-50 pointer-events-none",
              )}
            >
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все партии на странице"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = batchesSelection.isPagePartiallySelected(
                            filteredBatches.map((b) => b.id),
                          );
                        }
                      }}
                      checked={batchesSelection.isPageAllSelected(filteredBatches.map((b) => b.id))}
                      onChange={() => batchesSelection.togglePage(filteredBatches.map((b) => b.id))}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <SortableTh
                    label="Дата прихода"
                    active={batchesSort.sortBy === "receivedAt"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "receivedAt"));
                      setBatchesPage(1);
                    }}
                    className="w-[150px]"
                  />
                  <SortableTh
                    label="Партия / Накладная"
                    active={batchesSort.sortBy === "batchNumber"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "batchNumber"));
                      setBatchesPage(1);
                    }}
                    className="w-[140px]"
                  />
                  <SortableTh
                    label="Товар"
                    active={batchesSort.sortBy === "itemName"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "itemName"));
                      setBatchesPage(1);
                    }}
                  />
                  <SortableTh
                    label="Поставщик"
                    active={batchesSort.sortBy === "supplierName"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "supplierName"));
                      setBatchesPage(1);
                    }}
                  />
                  <SortableTh
                    label="Закупка/ед."
                    align="right"
                    active={batchesSort.sortBy === "purchasePrice"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "purchasePrice"));
                      setBatchesPage(1);
                    }}
                    className="w-[110px]"
                  />
                  <SortableTh
                    label="Принято"
                    align="center"
                    active={batchesSort.sortBy === "initialQuantity"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "initialQuantity"));
                      setBatchesPage(1);
                    }}
                    className="w-[90px]"
                  />
                  <SortableTh
                    label="Остаток FIFO"
                    align="center"
                    active={batchesSort.sortBy === "remainingQuantity"}
                    direction={batchesSort.sortDir}
                    onClick={() => {
                      setBatchesSort((prev) => nextTabSort(prev, "remainingQuantity"));
                      setBatchesPage(1);
                    }}
                    className="w-[95px]"
                  />
                  <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[100px]">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {filteredBatches.map((b) => {
                  const isSelected = batchesSelection.isRowSelected(b.id);
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
                          onChange={() => batchesSelection.toggleRow(b.id)}
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
                        <span className="font-mono tabular-nums text-[13px] font-medium text-[#111111]">
                          {formatRub(b.purchasePrice)}
                        </span>
                        {(b.landedCostTotal ?? 0) > 0 && (
                          <div className="font-mono tabular-nums text-[10px] text-[#4a38f5]">
                            база {formatRub(b.basePurchasePrice ?? b.purchasePrice)} +{" "}
                            {formatRub(b.landedCostPerUnit ?? 0)} доп.
                          </div>
                        )}
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
          <WarehousePagination
            total={batchesMeta.total}
            page={batchesMeta.page}
            pages={batchesMeta.pages}
            limit={batchesMeta.limit}
            entityLabel="партий"
            onPageChange={(newPage) => setBatchesPage(newPage)}
            onLimitChange={(newLimit) => {
              setBatchesLimit(newLimit as WarehouseLimit);
              setBatchesPage(1);
            }}
            disabled={isBatchesLoading}
          />
        </div>
      )}

      {/* Вкладка 3: Заявки на закупку (Сводка с агрегацией по нарядам и мультиселектом) */}
      {activeTab === "purchases" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {purchasesSelection.effectiveSelectedCount > 0 && (
            <div className="border-b border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <TableBulkBar
                selectedCount={purchasesSelection.effectiveSelectedCount}
                totalCount={purchasesMeta.total}
                isAllSelected={purchasesSelection.isAllSelected}
                excludedCount={purchasesSelection.excludedCount}
                entityNamePlural="заявок"
                pageItemCount={filteredAggregatedPurchases.length}
                onSelectAll={purchasesSelection.selectAllAcrossPages}
                onClearSelection={purchasesSelection.clear}
                onDelete={handleBulkDeletePurchases}
                isDeleting={bulkDeletePurchasesMutation.isPending}
              >
                <button
                  type="button"
                  onClick={() => void handleOpenCreateSupplierOrderFromPurchases()}
                  className="flex h-7 items-center gap-1.5 rounded-[6px] bg-[#4a38f5] px-3 text-xs font-semibold text-white shadow-xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
                >
                  <Truck className="h-3.5 w-3.5" />
                  Сформировать заказ поставщику ({purchasesSelection.effectiveSelectedCount})
                </button>
              </TableBulkBar>
            </div>
          )}

          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full transition-opacity duration-150",
                purchasesQuery.isPlaceholderData && "opacity-50 pointer-events-none",
              )}
            >
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все заявки на странице"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = purchasesSelection.isPagePartiallySelected(pagePurchaseIds);
                        }
                      }}
                      checked={purchasesSelection.isPageAllSelected(pagePurchaseIds)}
                      onChange={toggleSelectAllPurchases}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                      title="Выбрать все"
                    />
                  </th>
                  <SortableTh
                    label="Запчасть / Товар"
                    active={purchasesSort.sortBy === "itemName"}
                    direction={purchasesSort.sortDir}
                    onClick={() => {
                      setPurchasesSort((prev) => nextTabSort(prev, "itemName"));
                      setPurchasesPage(1);
                    }}
                  />
                  <SortableTh
                    label="Требуется"
                    align="center"
                    active={purchasesSort.sortBy === "quantity"}
                    direction={purchasesSort.sortDir}
                    onClick={() => {
                      setPurchasesSort((prev) => nextTabSort(prev, "quantity"));
                      setPurchasesPage(1);
                    }}
                    className="w-[100px]"
                  />
                  <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[130px]">
                    Остаток на складе
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Наряды / Сделки
                  </th>
                  <SortableTh
                    label="Ориент. цена"
                    align="right"
                    active={purchasesSort.sortBy === "estimatedPrice"}
                    direction={purchasesSort.sortDir}
                    onClick={() => {
                      setPurchasesSort((prev) => nextTabSort(prev, "estimatedPrice"));
                      setPurchasesPage(1);
                    }}
                    className="w-[110px]"
                  />
                  <SortableTh
                    label="Статус"
                    align="center"
                    active={purchasesSort.sortBy === "status"}
                    direction={purchasesSort.sortDir}
                    onClick={() => {
                      setPurchasesSort((prev) => nextTabSort(prev, "status"));
                      setPurchasesPage(1);
                    }}
                    className="w-[120px]"
                  />
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

                  const isSelected = purchasesSelection.isRowSelected(pr.id);

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
                                setSupplierOrderRowsOverride([pr]);
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
                                if (purchasesSelection.isRowSelected(pr.id)) {
                                  purchasesSelection.toggleRow(pr.id);
                                }
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
          <WarehousePagination
            total={purchasesMeta.total}
            page={purchasesMeta.page}
            pages={purchasesMeta.pages}
            limit={purchasesMeta.limit}
            entityLabel="заявок"
            onPageChange={(newPage) => setPurchasesPage(newPage)}
            onLimitChange={(newLimit) => {
              setPurchasesLimit(newLimit as WarehouseLimit);
              setPurchasesPage(1);
            }}
            disabled={isAggregatedLoading}
          />
        </div>
      )}

      {/* Вкладка 4: Заказы поставщикам */}
      {activeTab === "supplier_orders" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {ordersSelection.effectiveSelectedCount > 0 && (
            <div className="border-b border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <TableBulkBar
                selectedCount={ordersSelection.effectiveSelectedCount}
                totalCount={supplierOrdersMeta.total}
                isAllSelected={ordersSelection.isAllSelected}
                excludedCount={ordersSelection.excludedCount}
                entityNamePlural="заказов"
                pageItemCount={filteredSupplierOrders.length}
                onSelectAll={ordersSelection.selectAllAcrossPages}
                onClearSelection={ordersSelection.clear}
                onDelete={handleBulkDeleteSupplierOrders}
                isDeleting={bulkDeleteSupplierOrdersMutation.isPending}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full transition-opacity duration-150",
                supplierOrdersQuery.isPlaceholderData && "opacity-50 pointer-events-none",
              )}
            >
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все заказы поставщикам на странице"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = ordersSelection.isPagePartiallySelected(
                            filteredSupplierOrders.map((o) => o.id),
                          );
                        }
                      }}
                      checked={ordersSelection.isPageAllSelected(
                        filteredSupplierOrders.map((o) => o.id),
                      )}
                      onChange={() =>
                        ordersSelection.togglePage(filteredSupplierOrders.map((o) => o.id))
                      }
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <SortableTh
                    label="Номер"
                    active={ordersSort.sortBy === "orderNumber"}
                    direction={ordersSort.sortDir}
                    onClick={() => {
                      setOrdersSort((prev) => nextTabSort(prev, "orderNumber"));
                      setOrdersPage(1);
                    }}
                    className="w-[130px]"
                  />
                  <SortableTh
                    label="Поставщик"
                    active={ordersSort.sortBy === "supplierName"}
                    direction={ordersSort.sortDir}
                    onClick={() => {
                      setOrdersSort((prev) => nextTabSort(prev, "supplierName"));
                      setOrdersPage(1);
                    }}
                    className="w-[180px]"
                  />
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Состав заказа
                  </th>
                  <SortableTh
                    label="Сумма"
                    align="right"
                    active={ordersSort.sortBy === "totalAmount"}
                    direction={ordersSort.sortDir}
                    onClick={() => {
                      setOrdersSort((prev) => nextTabSort(prev, "totalAmount"));
                      setOrdersPage(1);
                    }}
                    className="w-[120px]"
                  />
                  <SortableTh
                    label="Статус"
                    align="center"
                    active={ordersSort.sortBy === "status"}
                    direction={ordersSort.sortDir}
                    onClick={() => {
                      setOrdersSort((prev) => nextTabSort(prev, "status"));
                      setOrdersPage(1);
                    }}
                    className="w-[130px]"
                  />
                  <SortableTh
                    label="Оплата / Приход"
                    active={ordersSort.sortBy === "paidAt"}
                    direction={ordersSort.sortDir}
                    onClick={() => {
                      setOrdersSort((prev) => nextTabSort(prev, "paidAt"));
                      setOrdersPage(1);
                    }}
                    className="w-[150px]"
                  />
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
                    partially_received: { label: "Частично оприходован", color: "bg-indigo-50 text-[#4a38f5] border-indigo-200" },
                    received: { label: "Поступил", color: "bg-sky-50 text-sky-700 border-sky-200" },
                    cancelled: { label: "Отменен", color: "bg-rose-50 text-rose-700 border-rose-200" },
                  };
                  const st = statusMap[order.status] ?? { label: order.status, color: "bg-neutral-100 text-neutral-700 border-neutral-200" };

                  const isPaid = Boolean(order.paidAt) || order.status === "paid";
                  const isReceived = order.status === "received";
                  const isPartiallyReceived = order.status === "partially_received";
                  const orderedQtyTotal =
                    order.orderedQuantityTotal ??
                    (order.items ?? []).reduce((s, it) => s + Number(it.quantity ?? 0), 0);
                  const receivedQtyTotal =
                    order.receivedQuantityTotal ??
                    (order.items ?? []).reduce((s, it) => s + Number(it.receivedQuantity ?? 0), 0);
                  const extraCostsTotal = Number(order.extraCostsTotal ?? 0);
                  const isSelected = ordersSelection.isRowSelected(order.id);

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
                          onChange={() => ordersSelection.toggleRow(order.id)}
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
                        <span className="font-mono tabular-nums text-[13px] font-bold text-[#111111]">
                          {formatRub(order.totalAmount)}
                        </span>
                        {extraCostsTotal > 0 && (
                          <div className="font-mono tabular-nums text-[10px] text-[#4a38f5]">
                            +{formatRub(extraCostsTotal)} доп. расх.
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <span className={cn("inline-flex rounded px-2 py-0.5 text-xs font-semibold border", st.color)}>
                            {st.label}
                          </span>
                          {(isPartiallyReceived || (isReceived && orderedQtyTotal > 0)) && (
                            <span className="font-mono tabular-nums text-[10px] text-[#666666]">
                              Принято {receivedQtyTotal} из {orderedQtyTotal}
                            </span>
                          )}
                        </div>
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
                        {isPartiallyReceived && !order.receivedAt && (
                          <div className="text-[#4a38f5] font-medium">
                            Приёмок: {order.receipts?.length ?? 1}
                          </div>
                        )}
                        {!order.paidAt && !order.receivedAt && !isPartiallyReceived && (
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

                          {/* Кнопка Оприходовать / Доприходовать */}
                          {!isReceived && order.status !== "cancelled" && (
                            <button
                              type="button"
                              onClick={() => handleOpenReceiptModal(order)}
                              disabled={createReceiptMutation.isPending}
                              className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 h-7 text-xs font-medium text-white hover:bg-[#3d2ee0] shadow-xs transition-colors cursor-pointer"
                              title={
                                isPartiallyReceived
                                  ? "Доприходовать оставшиеся позиции на склад"
                                  : "Оприходовать заказ на склад"
                              }
                            >
                              <ArrowDownToLine className="h-3 w-3" />
                              {isPartiallyReceived ? "Доприходовать" : "Оприходовать"}
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
                                setSupplierOrderRowsOverride([]);
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
          <WarehousePagination
            total={supplierOrdersMeta.total}
            page={supplierOrdersMeta.page}
            pages={supplierOrdersMeta.pages}
            limit={supplierOrdersMeta.limit}
            entityLabel="заказов"
            onPageChange={(newPage) => setOrdersPage(newPage)}
            onLimitChange={(newLimit) => {
              setOrdersLimit(newLimit as WarehouseLimit);
              setOrdersPage(1);
            }}
            disabled={isSupplierOrdersLoading}
          />
        </div>
      )}

      {/* Вкладка 5: Журнал движений */}
      {activeTab === "movements" && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-hidden">
          {movementsSelection.effectiveSelectedCount > 0 && (
            <div className="border-b border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2">
              <TableBulkBar
                selectedCount={movementsSelection.effectiveSelectedCount}
                totalCount={movementsMeta.total}
                isAllSelected={movementsSelection.isAllSelected}
                excludedCount={movementsSelection.excludedCount}
                entityNamePlural="движений"
                pageItemCount={filteredMovements.length}
                onSelectAll={movementsSelection.selectAllAcrossPages}
                onClearSelection={movementsSelection.clear}
                onDelete={handleBulkDeleteMovements}
                isDeleting={bulkDeleteMovementsMutation.isPending}
              />
            </div>
          )}

          <div className="overflow-x-auto">
            <table
              className={cn(
                "w-full transition-opacity duration-150",
                movementsQuery.isPlaceholderData && "opacity-50 pointer-events-none",
              )}
            >
              <thead>
                <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                  <th className="px-3 py-2.5 text-center w-[40px]">
                    <input
                      type="checkbox"
                      aria-label="Выбрать все движения на странице"
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = movementsSelection.isPagePartiallySelected(
                            filteredMovements.map((m) => m.id),
                          );
                        }
                      }}
                      checked={movementsSelection.isPageAllSelected(
                        filteredMovements.map((m) => m.id),
                      )}
                      onChange={() =>
                        movementsSelection.togglePage(filteredMovements.map((m) => m.id))
                      }
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                    />
                  </th>
                  <SortableTh
                    label="Дата и время"
                    active={movementsSort.sortBy === "createdAt"}
                    direction={movementsSort.sortDir}
                    onClick={() => {
                      setMovementsSort((prev) => nextTabSort(prev, "createdAt"));
                      setMovementsPage(1);
                    }}
                    className="w-[150px]"
                  />
                  <SortableTh
                    label="Товар"
                    active={movementsSort.sortBy === "itemName"}
                    direction={movementsSort.sortDir}
                    onClick={() => {
                      setMovementsSort((prev) => nextTabSort(prev, "itemName"));
                      setMovementsPage(1);
                    }}
                  />
                  <SortableTh
                    label="Тип операции"
                    active={movementsSort.sortBy === "type"}
                    direction={movementsSort.sortDir}
                    onClick={() => {
                      setMovementsSort((prev) => nextTabSort(prev, "type"));
                      setMovementsPage(1);
                    }}
                    className="w-[150px]"
                  />
                  <SortableTh
                    label="Кол-во"
                    align="center"
                    active={movementsSort.sortBy === "quantity"}
                    direction={movementsSort.sortDir}
                    onClick={() => {
                      setMovementsSort((prev) => nextTabSort(prev, "quantity"));
                      setMovementsPage(1);
                    }}
                    className="w-[95px]"
                  />
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                    Связь / Описание
                  </th>
                  <SortableTh
                    label="Инициатор"
                    active={movementsSort.sortBy === "createdByName"}
                    direction={movementsSort.sortDir}
                    onClick={() => {
                      setMovementsSort((prev) => nextTabSort(prev, "createdByName"));
                      setMovementsPage(1);
                    }}
                    className="w-[120px]"
                  />
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
                  const isSelected = movementsSelection.isRowSelected(m.id);

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
                          onChange={() => movementsSelection.toggleRow(m.id)}
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
          <WarehousePagination
            total={movementsMeta.total}
            page={movementsMeta.page}
            pages={movementsMeta.pages}
            limit={movementsMeta.limit}
            entityLabel="движений"
            onPageChange={(newPage) => setMovementsPage(newPage)}
            onLimitChange={(newLimit) => {
              setMovementsLimit(newLimit as WarehouseLimit);
              setMovementsPage(1);
            }}
            disabled={isMovementsLoading}
          />
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
        onClose={() => {
          setCreateSupplierOrderModalOpen(false);
          setSupplierOrderRowsOverride(null);
        }}
        selectedRequests={supplierOrderRowsOverride ?? selectedAggregatedRows}
        onSuccess={() => {
          setSupplierOrderRowsOverride(null);
          purchasesSelection.clear();
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
        selectedIds={Array.from(itemsSelection.selectedIds)}
        selectionMode={itemsSelection.isAllSelected ? "all" : "ids"}
        excludedIds={Array.from(itemsSelection.excludedIds)}
        scopeFilters={itemsFiltersPayload}
        effectiveCount={itemsSelection.effectiveSelectedCount}
        onClose={() => setBulkEditModalOpen(false)}
        onSuccess={() => {
          itemsSelection.clear();
        }}
      />

      <EditItemModal
        open={editItemModalOpen || Boolean(editParam)}
        itemId={selectedItemForEdit?.id ?? editParam ?? null}
        initialItem={selectedItemForEdit}
        onClose={handleCloseEditItemModal}
        onSuccess={() => {
          itemsSelection.clear();
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
      {itemsSelection.effectiveSelectedCount > 0 && activeTab === "items" && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-2xl border border-[#e5e5e5] bg-white px-5 py-3 shadow-2xl animate-in slide-in-from-bottom-5 duration-200">
          <div className="flex items-center gap-2 border-r border-[#e5e5e5] pr-3 text-xs">
            <span className="flex h-5 min-w-5 px-1.5 items-center justify-center rounded-full bg-[#4a38f5] text-[11px] font-bold text-white tabular-nums">
              {itemsSelection.effectiveSelectedCount}
            </span>
            <span className="font-semibold text-[#111111]">
              {itemsSelection.isAllSelected && itemsSelection.excludedCount > 0
                ? `из ${meta.total} выбрано`
                : itemsSelection.isAllSelected
                ? "Выбраны все"
                : "Выбрано позиций"}
            </span>
            {!itemsSelection.isAllSelected &&
              sortedItems.length > 0 &&
              itemsSelection.effectiveSelectedCount >= sortedItems.length &&
              meta.total > sortedItems.length && (
                <button
                  type="button"
                  onClick={itemsSelection.selectAllAcrossPages}
                  className="ml-1 font-medium text-[#4a38f5] hover:text-[#3d2ee0] underline underline-offset-2 cursor-pointer"
                >
                  Выбрать все {meta.total}
                </button>
              )}
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
              onClick={itemsSelection.clear}
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
