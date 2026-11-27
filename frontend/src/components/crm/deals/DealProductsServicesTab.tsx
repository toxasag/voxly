"use client";

import Link from "next/link";
import { useState, useMemo, useRef, useCallback, type KeyboardEvent } from "react";
import {
  PackagePlus,
  Boxes,
  BookOpen,
  Plus,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  Calculator,
  ShoppingCart,
  ExternalLink,
  Search,
  X,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import {
  useDealItems,
  useAddDealItem,
  useDeleteDealItem,
  type DealDTO,
  type DealItemDTO,
} from "@/lib/api/use-deals";
import {
  useWarehouseItems,
  useWarehouseSettings,
  usePurchaseRequests,
  useCreatePurchaseRequest,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import { useServices, useCreateService, type ServiceItemDTO } from "@/lib/api/use-services";
import { useDealEconomics } from "@/lib/api/use-invoices";
import { useAuth } from "@/lib/auth/use-auth";
import { isModuleInstalled } from "@/lib/context/tenant";
import { cn, matchesSearchTokens, matchesWarehouseItem } from "@/lib/utils";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { Skeleton } from "@/components/shared/Skeleton";

import { formatRub } from "@/lib/utils/format";

const MAX_DROPDOWN_ITEMS = 80;

export function DealProductsServicesTab({ deal }: { deal: DealDTO }) {
  const { tenant } = useAuth();
  const hasFinance = isModuleInstalled(tenant?.installedModules ?? [], "finance");
  const { data: dealEconomics } = useDealEconomics(deal.id, hasFinance);
  const { data: dealItemsData, isLoading: isItemsLoading } = useDealItems(deal.id);
  const items = useMemo(() => dealItemsData?.data ?? [], [dealItemsData?.data]);
  const totalBudget = dealItemsData?.totalBudget ?? deal.budget ?? 0;

  const addItemMutation = useAddDealItem(deal.id);
  const deleteItemMutation = useDeleteDealItem(deal.id);
  const createPurchaseRequestMutation = useCreatePurchaseRequest();
  const createServiceMutation = useCreateService();

  const {
    data: warehouseItems = [],
    isLoading: isWarehouseLoading,
    isError: isWarehouseError,
  } = useWarehouseItems();
  const { data: warehouseSettings } = useWarehouseSettings();
  const allowNegativeStock = warehouseSettings ? Boolean(warehouseSettings.allowNegativeStock) : true;
  const {
    data: services = [],
    isLoading: isServicesLoading,
    isError: isServicesError,
  } = useServices();
  const { data: purchaseRequests = [] } = usePurchaseRequests(undefined, undefined, deal.id);

  // Add Item Bar State
  const [itemType, setItemType] = useState<"product" | "service">("product");
  const [selectedCatalogId, setSelectedCatalogId] = useState<string>("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");
  const [customSku, setCustomSku] = useState("");
  const [price, setPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("шт");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [saveToCatalog, setSaveToCatalog] = useState(false);
  const [addToPurchaseRequest, setAddToPurchaseRequest] = useState(false);
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const comboboxRef = useRef<HTMLDivElement>(null);
  useClickOutside(comboboxRef, () => setCatalogOpen(false), catalogOpen);

  const warehouseMap = useMemo(
    () => new Map(warehouseItems.map((w) => [w.id, w])),
    [warehouseItems],
  );

  const servicesMap = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );

  const selectedWarehouseItem = useMemo(
    () => (itemType === "product" && selectedCatalogId ? warehouseMap.get(selectedCatalogId) ?? null : null),
    [itemType, selectedCatalogId, warehouseMap],
  );

  const selectedServiceItem = useMemo(
    () => (itemType === "service" && selectedCatalogId ? servicesMap.get(selectedCatalogId) ?? null : null),
    [itemType, selectedCatalogId, servicesMap],
  );

  // Многословный поиск по номенклатуре склада (как в PartsTable СЦ)
  const filteredWarehouseItems = useMemo(
    () => warehouseItems.filter((wi) => matchesWarehouseItem(wi, customName)),
    [warehouseItems, customName],
  );

  // Многословный поиск по справочнику услуг (как в WorkItemsTable СЦ)
  const filteredServices = useMemo(
    () => services.filter((s) => matchesSearchTokens(customName, [s.name, s.description])),
    [services, customName],
  );

  const exactServiceMatchExists = useMemo(() => {
    const trimmed = customName.trim().toLowerCase();
    if (!trimmed) return false;
    return services.some((s) => s.name.trim().toLowerCase() === trimmed);
  }, [services, customName]);

  const parsedQtyNum = parseFloat(quantity) || 1;
  const formShortage = useMemo(() => {
    if (itemType !== "product") return 0;
    if (!selectedWarehouseItem) return 0;
    const avail = Math.max(0, Number(selectedWarehouseItem.availableStock ?? 0));
    return Math.max(0, Math.round((parsedQtyNum - avail) * 100) / 100);
  }, [itemType, selectedWarehouseItem, parsedQtyNum]);

  // Statistics
  const stats = useMemo(() => {
    let productsSum = 0;
    let productsCostSum = 0;
    let servicesSum = 0;
    let productsCount = 0;
    let servicesCount = 0;

    for (const item of items) {
      if (item.itemType === "product") {
        productsSum += item.totalAmount;
        productsCostSum += (item.costPrice ?? 0) * item.quantity;
        productsCount += item.quantity;
      } else {
        servicesSum += item.totalAmount;
        servicesCount += item.quantity;
      }
    }

    const productsProfit = productsSum - productsCostSum;
    const productsMarkupPct =
      productsCostSum > 0 ? Math.round((productsProfit / productsCostSum) * 1000) / 10 : 0;
    const productsMarginPct =
      productsSum > 0 && productsCostSum > 0
        ? Math.round((productsProfit / productsSum) * 1000) / 10
        : 0;

    return {
      productsSum,
      productsCostSum,
      productsProfit,
      productsMarkupPct,
      productsMarginPct,
      servicesSum,
      productsCount,
      servicesCount,
      totalCount: items.length,
      calculatedBudget: productsSum + servicesSum,
    };
  }, [items]);

  const handleSelectWarehouseItem = useCallback(
    (w: WarehouseItemDTO) => {
      setSelectedCatalogId(w.id);
      setCustomName(w.name);
      setCustomDescription(w.category ? `Категория: ${w.category}` : "");
      setCustomSku(w.sku || "");
      setPrice(String(w.retailPrice || w.costPrice || 0));
      const fifoCost = w.fifoCostPrice && w.fifoCostPrice > 0 ? w.fifoCostPrice : w.costPrice;
      setCostPrice(String(fifoCost || 0));
      setUnit(w.unit || "шт");
      const qtyVal = parseFloat(quantity) || 1;
      setAddToPurchaseRequest((w.availableStock ?? 0) < qtyVal);
      setSaveToCatalog(false);
      setCatalogOpen(false);
    },
    [quantity],
  );

  const handleSelectServiceItem = useCallback((s: ServiceItemDTO) => {
    setSelectedCatalogId(s.id);
    setCustomName(s.name);
    setCustomDescription(s.description ?? "");
    setCustomSku("");
    setPrice(String(s.price || s.defaultPrice || 0));
    setCostPrice("0");
    setUnit(s.unit || "усл");
    setAddToPurchaseRequest(false);
    setSaveToCatalog(false);
    setCatalogOpen(false);
  }, []);

  const handleClearCatalogSelection = useCallback(() => {
    setSelectedCatalogId("");
    setCustomName("");
    setCustomDescription("");
    setCustomSku("");
    setPrice("");
    setCostPrice("");
    setSaveToCatalog(false);
    setAddToPurchaseRequest(false);
    setCatalogOpen(true);
  }, []);

  const handleCreateServiceCatalogItem = useCallback(async () => {
    const trimmed = customName.trim();
    if (!trimmed) return;
    const priceNum = parseFloat(price);
    const parsedPrice = !isNaN(priceNum) && priceNum >= 0 ? priceNum : 0;
    try {
      const created = await createServiceMutation.mutateAsync({
        name: trimmed,
        description: customDescription.trim() || undefined,
        default_price: parsedPrice,
        price: parsedPrice,
        unit: unit.trim() || "усл",
      });
      setSelectedCatalogId(created.id);
      setSaveToCatalog(false);
      setCatalogOpen(false);
      toast.success(`Услуга «${trimmed}» сохранена в справочник`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось сохранить услугу в справочник");
    }
  }, [customName, customDescription, price, unit, createServiceMutation]);

  const handleSearchKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setCatalogOpen(false);
    }
  }, []);

  // Switch between Product / Service tab in Add Form
  const handleSwitchType = (type: "product" | "service") => {
    setItemType(type);
    setSelectedCatalogId("");
    setCatalogOpen(false);
    setCustomName("");
    setCustomDescription("");
    setCustomSku("");
    setPrice("");
    setCostPrice("");
    setSaveToCatalog(false);
    setAddToPurchaseRequest(false);
    setUnit(type === "product" ? "шт" : "усл");
  };

  // Submit Add Item
  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = customName.trim();
    if (!trimmedName) {
      toast.error("Укажите наименование позиции");
      return;
    }

    const priceNum = parseFloat(price);
    const parsedPrice = !isNaN(priceNum) && priceNum >= 0 ? priceNum : 0;
    const costNum = parseFloat(costPrice);
    const parsedCost = !isNaN(costNum) && costNum >= 0 ? costNum : undefined;
    const qtyNum = parseFloat(quantity);
    const parsedQty = !isNaN(qtyNum) && qtyNum > 0 ? qtyNum : 1;
    const discNum = parseFloat(discountPercent);
    const parsedDisc = !isNaN(discNum) && discNum >= 0 && discNum <= 100 ? discNum : 0;
    const shouldSaveToCatalog = !selectedCatalogId && saveToCatalog;

    try {
      await addItemMutation.mutateAsync({
        item_type: itemType,
        item_id: selectedCatalogId || null,
        name: trimmedName,
        description: customDescription.trim(),
        sku: customSku.trim(),
        price: parsedPrice,
        cost_price: itemType === "product" ? parsedCost : 0,
        quantity: parsedQty,
        unit: unit.trim() || (itemType === "product" ? "шт" : "усл"),
        discount_percent: parsedDisc,
        save_to_catalog: shouldSaveToCatalog,
        add_to_purchase_request: itemType === "product" ? addToPurchaseRequest : false,
      });

      const suffixes: string[] = [];
      if (shouldSaveToCatalog) {
        suffixes.push(itemType === "product" ? "сохранена на склад" : "сохранена в справочник");
      }
      if (itemType === "product" && addToPurchaseRequest) {
        suffixes.push("создана заявка на закупку");
      }
      toast.success(
        suffixes.length > 0
          ? `Позиция «${trimmedName}» добавлена (${suffixes.join(", ")})`
          : `Позиция «${trimmedName}» добавлена в сделку`,
      );
      setSelectedCatalogId("");
      setCatalogOpen(false);
      setCustomName("");
      setCustomDescription("");
      setCustomSku("");
      setPrice("");
      setCostPrice("");
      setQuantity("1");
      setDiscountPercent("0");
      setSaveToCatalog(false);
      setAddToPurchaseRequest(false);
      setIsAddFormOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось добавить позицию");
    }
  };

  // Quick create purchase request for an existing deal item
  const handleQuickPurchaseRequest = async (item: DealItemDTO) => {
    setRequestingId(item.id);
    try {
      const wh = item.itemId ? warehouseMap.get(item.itemId) : null;
      const avail = wh ? Math.max(0, Number(wh.availableStock ?? 0)) : 0;
      const shortage = Math.max(0, Math.round((item.quantity - avail) * 100) / 100);
      const reqQty = shortage > 0 ? shortage : item.quantity;

      await createPurchaseRequestMutation.mutateAsync({
        deal_id: deal.id,
        deal_item_id: item.id,
        item_id: item.itemId ?? undefined,
        item_name: item.name,
        sku: item.sku || undefined,
        quantity: reqQty,
        unit: item.unit || "шт",
        estimated_price: item.costPrice ?? 0,
        comment: `Заявка из сделки «${deal.title}»`,
      });
      toast.success(`Заявка на закупку (${reqQty} ${item.unit || "шт"}) отправлена в закупки склада`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать заявку на закупку");
    } finally {
      setRequestingId(null);
    }
  };

  // Delete Item
  const handleDeleteItem = async (itemId: string, name: string) => {
    setDeletingId(itemId);
    try {
      await deleteItemMutation.mutateAsync(itemId);
      toast.success(`Позиция «${name}» удалена из сделки`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось удалить позицию");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-5 space-y-4">
      {/* Summary KPI Card Twenty CRM Light */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs">
        <div className="flex items-center gap-3.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-indigo-50 border border-indigo-200 text-[#4a38f5]">
            <Calculator className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Позиций:</span>
                <span className="text-sm font-bold font-mono text-[#111111]">{stats.totalCount}</span>
              </div>
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Услуги:</span>
                <span className="text-xs font-semibold font-mono text-[#111111]">{formatRub(stats.servicesSum)}</span>
              </div>
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Товары:</span>
                <span className="text-xs font-semibold font-mono text-[#111111]">{formatRub(stats.productsSum)}</span>
              </div>
              {stats.productsCostSum > 0 && (
                <>
                  <span className="text-[#e5e5e5]">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#666666]">Себест. (FIFO):</span>
                    <span className="text-xs font-semibold font-mono text-[#111111]">
                      {formatRub(stats.productsCostSum)}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-700">
                      (наценка +{stats.productsMarkupPct}% · маржа {stats.productsMarginPct}%)
                    </span>
                  </div>
                </>
              )}
              <span className="text-[#e5e5e5]">|</span>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-[#666666]">Итого бюджет:</span>
                <span className="text-sm font-bold font-sans tabular-nums text-[#4a38f5]">
                  {formatRub(stats.calculatedBudget || totalBudget)}
                </span>
              </div>
              {hasFinance && dealEconomics && (
                <>
                  <span className="text-[#e5e5e5]">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#666666]">Прямые расходы:</span>
                    <span
                      className={cn(
                        "text-xs font-semibold tabular-nums",
                        dealEconomics.directExpenses > 0 ? "text-rose-700" : "text-[#666666]",
                      )}
                    >
                      {dealEconomics.directExpenses > 0
                        ? `−${formatRub(dealEconomics.directExpenses)}`
                        : formatRub(0)}
                    </span>
                  </div>
                  <span className="text-[#e5e5e5]">|</span>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-[#666666]">Чистая прибыль:</span>
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        dealEconomics.netProfit < 0 ? "text-rose-700" : "text-emerald-700",
                      )}
                    >
                      {formatRub(dealEconomics.netProfit)}
                    </span>
                    {dealEconomics.revenue > 0 && (
                      <span
                        className={cn(
                          "text-[11px] tabular-nums",
                          dealEconomics.netProfit < 0 ? "text-rose-700/80" : "text-emerald-700/80",
                        )}
                      >
                        ({dealEconomics.netMarginPercent}%)
                      </span>
                    )}
                  </div>
                </>
              )}
            </div>
            <p className="text-[11px] text-[#888888] mt-1">
              При закрытии сделки в «Успешно» товары автоматически списываются по FIFO; при нехватке на складе создаётся заявка на закупку
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsAddFormOpen(!isAddFormOpen)}
          className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer shrink-0"
        >
          {isAddFormOpen ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {isAddFormOpen ? "Скрыть форму" : "Добавить позицию"}
        </button>
      </div>

      {/* Add Item Panel */}
      {isAddFormOpen && (
        <div className="rounded-[8px] border border-indigo-200 bg-white p-4 shadow-2xs animate-in fade-in duration-150">
          <div className="flex items-center justify-between mb-3 border-b border-[#f0f0f0] pb-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-[#111111]">Тип позиции:</span>
              <div className="inline-flex rounded-[6px] border border-[#e5e5e5] p-0.5 bg-[#f5f5f5]">
                <button
                  type="button"
                  onClick={() => handleSwitchType("service")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-[4px] font-medium transition-colors cursor-pointer",
                    itemType === "service"
                      ? "bg-white text-[#4a38f5] shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  Услуга
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchType("product")}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-[4px] font-medium transition-colors cursor-pointer",
                    itemType === "product"
                      ? "bg-white text-[#4a38f5] shadow-2xs"
                      : "text-[#666666] hover:text-[#111111]",
                  )}
                >
                  <Boxes className="h-3.5 w-3.5" />
                  Товар
                </button>
              </div>
            </div>

            <span className="text-[11px] text-[#888888]">
              {itemType === "service"
                ? `Справочник услуг (${services.length})`
                : `Номенклатура склада (${warehouseItems.length})`}
            </span>
          </div>

          <form onSubmit={handleAddItem} className="space-y-3">
            <div className={cn("grid grid-cols-1 gap-3", itemType === "product" ? "sm:grid-cols-3" : "sm:grid-cols-1")}>
              {/* Поисковый автокомплит-комбобокс как в СЦ (PartsTable / WorkItemsTable) */}
              <div ref={comboboxRef} className={cn("relative", itemType === "product" ? "sm:col-span-2" : "")}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[11px] font-medium text-[#666666]">
                    {itemType === "product"
                      ? "Поиск по складу или наименование товара"
                      : "Поиск по справочнику или наименование услуги"}{" "}
                    <span className="text-rose-500">*</span>
                  </label>
                  {(selectedWarehouseItem || selectedServiceItem) && (
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                      {itemType === "product" ? "Привязано к складу" : "Из справочника услуг"}
                      <button
                        type="button"
                        onClick={handleClearCatalogSelection}
                        className="ml-0.5 text-[#4a38f5]/70 hover:text-[#4a38f5] cursor-pointer"
                        title="Отвязать и выбрать другую позицию"
                        aria-label="Сбросить выбор из каталога"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  )}
                </div>

                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
                  <input
                    type="text"
                    required
                    role="combobox"
                    aria-expanded={catalogOpen}
                    aria-controls="deal-catalog-listbox"
                    aria-autocomplete="list"
                    placeholder={
                      itemType === "product"
                        ? "Поиск по названию, артикулу, бренду, модели или введите вручную..."
                        : "Поиск по справочнику услуг или введите название..."
                    }
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      if (selectedCatalogId) {
                        setSelectedCatalogId("");
                      }
                      setCatalogOpen(true);
                    }}
                    onFocus={() => setCatalogOpen(true)}
                    onKeyDown={handleSearchKeyDown}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white pl-8 pr-8 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                  />
                  {customName ? (
                    <button
                      type="button"
                      onClick={handleClearCatalogSelection}
                      aria-label="Очистить поиск"
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#888888] hover:text-[#111111] cursor-pointer"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  ) : itemType === "product" ? (
                    <Boxes className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
                  ) : (
                    <BookOpen className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
                  )}
                </div>

                {catalogOpen && (
                  <div
                    id="deal-catalog-listbox"
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg"
                  >
                    <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                      <span>{itemType === "product" ? "Номенклатура склада" : "Справочник услуг"}</span>
                      <span className="font-mono font-normal normal-case text-[10px]">
                        {itemType === "product"
                          ? `Найдено: ${filteredWarehouseItems.length}`
                          : `Найдено: ${filteredServices.length}`}
                      </span>
                    </div>

                    {itemType === "product" ? (
                      <>
                        {isWarehouseLoading && (
                          <div className="flex items-center justify-center py-3 text-xs text-[#888888]">
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка номенклатуры склада...
                          </div>
                        )}
                        {!isWarehouseLoading && isWarehouseError && (
                          <div className="px-2.5 py-2 text-xs text-rose-600">
                            Не удалось загрузить справочник склада. Вы можете ввести позицию вручную.
                          </div>
                        )}
                        {!isWarehouseLoading && !isWarehouseError && filteredWarehouseItems.length > 0 && (
                          <div className="space-y-0.5">
                            {filteredWarehouseItems.slice(0, MAX_DROPDOWN_ITEMS).map((wi) => {
                              const isOutOfStock = wi.availableStock <= 0;
                              const effectiveCost = wi.fifoCostPrice ?? wi.costPrice ?? 0;
                              const margin = (wi.retailPrice ?? 0) - effectiveCost;
                              const markupPct = effectiveCost > 0 ? Math.round((margin / effectiveCost) * 100) : 0;
                              const isSelected = selectedCatalogId === wi.id;
                              return (
                                <button
                                  key={wi.id}
                                  type="button"
                                  onClick={() => handleSelectWarehouseItem(wi)}
                                  className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                                    isSelected ? "bg-[#4a38f5]/8" : "hover:bg-[#fafafa]",
                                  )}
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <span className="font-medium text-[#111111] truncate block">{wi.name}</span>
                                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#888888]">
                                      {wi.sku && <span className="font-mono">{wi.sku}</span>}
                                      {wi.brand && <span>{wi.sku ? "· " : ""}{wi.brand}</span>}
                                      {wi.category && <span>{wi.sku || wi.brand ? "· " : ""}{wi.category}</span>}
                                      {wi.modelNames && wi.modelNames.length > 0 && (
                                        <span className="truncate text-[#666666]">
                                          · {wi.modelNames.join(", ")}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span
                                      className={cn(
                                        "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono",
                                        isOutOfStock
                                          ? "bg-rose-50 text-rose-700 border border-rose-200"
                                          : "bg-emerald-50 text-emerald-700 border border-emerald-200",
                                      )}
                                    >
                                      Доступно: {wi.availableStock} {wi.unit}
                                    </span>
                                    <div className="flex items-center justify-end gap-2 text-[11px] font-mono mt-0.5">
                                      <span className="text-[#111111] font-medium">
                                        Розница: {formatRub(wi.retailPrice)}
                                      </span>
                                      <span className="text-[#666666]">
                                        Закупка{(wi.activeBatchesCount ?? 0) > 0 ? " FIFO" : ""}: {formatRub(effectiveCost)}
                                      </span>
                                      {margin > 0 && effectiveCost > 0 && (
                                        <span className="text-emerald-700 font-medium">+{markupPct}%</span>
                                      )}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                            {filteredWarehouseItems.length > MAX_DROPDOWN_ITEMS && (
                              <div className="px-2.5 py-1.5 text-[11px] text-[#888888] border-t border-[#f0f0f0]">
                                Показаны первые {MAX_DROPDOWN_ITEMS} из {filteredWarehouseItems.length} позиций — уточните запрос
                              </div>
                            )}
                          </div>
                        )}
                        {!isWarehouseLoading && !isWarehouseError && filteredWarehouseItems.length === 0 && (
                          <div className="p-2 space-y-1.5">
                            <div className="text-xs text-[#888888]">
                              {warehouseItems.length === 0
                                ? "Склад пока пуст. Товар можно добавить вручную и сохранить в номенклатуру."
                                : "На складе позиций по запросу не найдено."}
                            </div>
                            {customName.trim().length > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSaveToCatalog(true);
                                  setCatalogOpen(false);
                                }}
                                className="flex w-full items-center gap-1.5 rounded-[6px] bg-[#4a38f5]/5 border border-[#4a38f5]/20 px-2.5 py-1.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors text-left cursor-pointer"
                              >
                                <Warehouse className="h-3.5 w-3.5 shrink-0" />
                                <span>
                                  Добавить «<span className="font-semibold">{customName.trim()}</span>» с сохранением на склад
                                </span>
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {isServicesLoading && (
                          <div className="flex items-center justify-center py-3 text-xs text-[#888888]">
                            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка справочника услуг...
                          </div>
                        )}
                        {!isServicesLoading && isServicesError && (
                          <div className="px-2.5 py-2 text-xs text-rose-600">
                            Не удалось загрузить справочник услуг. Вы можете ввести услугу вручную.
                          </div>
                        )}
                        {!isServicesLoading && !isServicesError && filteredServices.length > 0 && (
                          <div className="space-y-0.5">
                            {filteredServices.slice(0, MAX_DROPDOWN_ITEMS).map((svc) => {
                              const svcPrice = svc.price || svc.defaultPrice || 0;
                              const isSelected = selectedCatalogId === svc.id;
                              return (
                                <button
                                  key={svc.id}
                                  type="button"
                                  onClick={() => handleSelectServiceItem(svc)}
                                  className={cn(
                                    "flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                                    isSelected ? "bg-[#4a38f5]/8" : "hover:bg-[#fafafa]",
                                  )}
                                >
                                  <div className="min-w-0 flex-1 pr-2">
                                    <span className="font-medium text-[#111111] truncate block">{svc.name}</span>
                                    {svc.description && (
                                      <span className="text-[11px] text-[#888888] truncate block">
                                        {svc.description}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-right shrink-0">
                                    <span
                                      className={cn(
                                        "font-mono text-[11px] font-semibold tabular-nums",
                                        svcPrice > 0 ? "text-[#4a38f5]" : "text-[#888888]",
                                      )}
                                    >
                                      {formatRub(svcPrice)}
                                    </span>
                                    {svc.unit && (
                                      <span className="ml-1 text-[10px] text-[#888888]">/ {svc.unit}</span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                            {filteredServices.length > MAX_DROPDOWN_ITEMS && (
                              <div className="px-2.5 py-1.5 text-[11px] text-[#888888] border-t border-[#f0f0f0]">
                                Показаны первые {MAX_DROPDOWN_ITEMS} из {filteredServices.length} услуг — уточните запрос
                              </div>
                            )}
                          </div>
                        )}
                        {!isServicesLoading && !isServicesError && filteredServices.length === 0 && (
                          <div className="px-2.5 py-2 text-xs text-[#888888]">
                            {services.length === 0
                              ? "Справочник услуг пока пуст. Вы можете сохранить первую услугу ниже."
                              : "Услуг по запросу не найдено."}
                          </div>
                        )}
                        {customName.trim().length > 0 && !exactServiceMatchExists && (
                          <div className="mt-1 border-t border-[#f0f0f0] pt-1">
                            <button
                              type="button"
                              onClick={() => void handleCreateServiceCatalogItem()}
                              disabled={createServiceMutation.isPending}
                              className="flex w-full items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-left text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {createServiceMutation.isPending ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Plus className="h-3 w-3" />
                              )}
                              <span>
                                Сохранить в справочник «<span className="font-semibold">{customName.trim()}</span>»
                                {parseFloat(price) > 0 && ` (${formatRub(parseFloat(price))})`}
                              </span>
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {itemType === "product" && (
                <div>
                  <label className="block text-[11px] font-medium text-[#666666] mb-1">
                    Артикул (SKU)
                  </label>
                  <input
                    type="text"
                    placeholder="Б/А"
                    value={customSku}
                    onChange={(e) => setCustomSku(e.target.value)}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              )}
            </div>

            <div className={cn("grid grid-cols-1 gap-3", itemType === "product" ? "sm:grid-cols-5" : "sm:grid-cols-4")}>
              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Цена продажи, ₽
                </label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  placeholder="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              {itemType === "product" && (
                <div>
                  <label className="block text-[11px] font-medium text-[#666666] mb-1">
                    Себестоимость (FIFO), ₽
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    placeholder="0"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Количество
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    value={quantity}
                    onChange={(e) => {
                      const val = e.target.value;
                      setQuantity(val);
                      if (itemType === "product" && selectedWarehouseItem) {
                        const qn = parseFloat(val) || 1;
                        setAddToPurchaseRequest((selectedWarehouseItem.availableStock ?? 0) < qn);
                      }
                    }}
                    className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                  />
                  <input
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="ед."
                    className="w-16 h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-2 text-xs text-center text-[#666666] focus:border-[#4a38f5] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Скидка, %
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="any"
                  placeholder="0"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(e.target.value)}
                  className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#666666] mb-1">
                  Итоговая сумма
                </label>
                <div className="h-8 rounded-[8px] bg-[#f5f5f5] border border-[#e5e5e5] px-3 flex items-center justify-between text-xs font-mono font-bold text-[#111111]">
                  <span>
                    {formatRub(
                      Math.max(
                        0,
                        (parseFloat(price) || 0) * (parseFloat(quantity) || 1) * (1 - (parseFloat(discountPercent) || 0) / 100),
                      ),
                    )}
                  </span>
                </div>
              </div>
            </div>

            {itemType === "product" && (selectedWarehouseItem !== null || customName.trim().length > 0) && (
              <div
                className={cn(
                  "rounded-[8px] border px-3 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs",
                  selectedWarehouseItem && formShortage > 0
                    ? allowNegativeStock
                      ? "border-amber-200 bg-amber-50/70 text-amber-900"
                      : "border-rose-200 bg-rose-50/70 text-rose-900"
                    : "border-[#e5e5e5] bg-[#fbfbfb] text-[#666666]",
                )}
              >
                <div className="flex items-center gap-2">
                  {selectedWarehouseItem ? (
                    formShortage > 0 ? (
                      <>
                        <AlertCircle
                          className={cn(
                            "h-4 w-4 shrink-0",
                            allowNegativeStock ? "text-amber-600" : "text-rose-600",
                          )}
                        />
                        <span>
                          Недостаточно на складе: доступно{" "}
                          <strong className="font-mono">
                            {selectedWarehouseItem.availableStock} {selectedWarehouseItem.unit}
                          </strong>
                          , не хватает{" "}
                          <strong className="font-mono">
                            {formShortage} {selectedWarehouseItem.unit}
                          </strong>
                          .
                        </span>
                      </>
                    ) : (
                      <>
                        <Check className="h-4 w-4 shrink-0 text-emerald-600" />
                        <span>
                          В наличии на складе:{" "}
                          <strong className="font-mono text-emerald-700">
                            {selectedWarehouseItem.availableStock} {selectedWarehouseItem.unit}
                          </strong>
                          {selectedWarehouseItem.fifoCostPrice && selectedWarehouseItem.fifoCostPrice > 0
                            ? ` · FIFO ${formatRub(selectedWarehouseItem.fifoCostPrice)}`
                            : ""}
                        </span>
                      </>
                    )
                  ) : (
                    <>
                      <Warehouse className="h-4 w-4 shrink-0 text-[#888888]" />
                      <span>Товар введён вручную (вне каталога склада).</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  {!selectedWarehouseItem && (
                    <label className="inline-flex items-center gap-2 font-medium text-[#111111] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={saveToCatalog}
                        onChange={(e) => setSaveToCatalog(e.target.checked)}
                        className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                      />
                      <span>Сохранить в номенклатуру склада</span>
                    </label>
                  )}

                  <label className="inline-flex items-center gap-2 font-medium text-[#111111] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={addToPurchaseRequest}
                      onChange={(e) => setAddToPurchaseRequest(e.target.checked)}
                      className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span>Создать заявку на закупку</span>
                  </label>
                </div>
              </div>
            )}

            {itemType === "service" && !selectedServiceItem && customName.trim().length > 0 && !exactServiceMatchExists && (
              <div className="rounded-[8px] border border-[#e5e5e5] bg-[#fbfbfb] px-3 py-2 flex items-center justify-between gap-2 text-xs text-[#666666]">
                <span>Новая услуга (нет в справочнике)</span>
                <label className="inline-flex items-center gap-2 font-medium text-[#111111] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={saveToCatalog}
                    onChange={(e) => setSaveToCatalog(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-[4px] border-[#cccccc] text-[#4a38f5] focus:ring-[#4a38f5]"
                  />
                  <span>Сохранить в справочник услуг</span>
                </label>
              </div>
            )}

            <div>
              <label className="block text-[11px] font-medium text-[#666666] mb-1">
                Описание / примечание к позиции
              </label>
              <input
                type="text"
                placeholder="Дополнительное описание, условия или артикул..."
                value={customDescription}
                onChange={(e) => setCustomDescription(e.target.value)}
                className="w-full h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
              />
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#f0f0f0]">
              <button
                type="button"
                onClick={() => setIsAddFormOpen(false)}
                className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3 text-xs font-medium text-[#111111] hover:bg-[#f0f0f0] transition-colors cursor-pointer"
              >
                Отмена
              </button>
              <button
                type="submit"
                disabled={addItemMutation.isPending || !customName.trim()}
                className="h-8 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
              >
                {addItemMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Добавить в сделку
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Items Table */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs overflow-x-auto">
        {isItemsLoading ? (
          <div className="p-8 space-y-3">
            <Skeleton className="h-8 w-full rounded-[6px]" />
            <Skeleton className="h-8 w-full rounded-[6px]" />
            <Skeleton className="h-8 w-full rounded-[6px]" />
          </div>
        ) : items.length === 0 ? (
          <div className="py-12 px-4 text-center">
            <div className="h-12 w-12 rounded-full bg-[#f5f5f5] flex items-center justify-center mx-auto mb-3">
              <PackagePlus className="h-6 w-6 text-[#888888]" />
            </div>
            <h3 className="text-sm font-semibold text-[#111111] mb-1">
              В сделке пока нет товаров и услуг
            </h3>
            <p className="text-xs text-[#666666] max-w-sm mx-auto mb-4">
              Прикрепляйте позиции со склада или из справочника услуг для точного расчета сметы, FIFO-себестоимости и бюджета сделки
            </p>
            <button
              type="button"
              onClick={() => setIsAddFormOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 py-2 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить первую позицию
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa] text-[11px] font-medium uppercase tracking-wider text-[#666666]">
                <th className="py-2.5 px-4 font-medium w-6">#</th>
                <th className="py-2.5 px-4 font-medium w-1/3">Наименование</th>
                <th className="py-2.5 px-4 font-medium text-center">Тип</th>
                <th className="py-2.5 px-4 font-medium text-right">Себест. (FIFO)</th>
                <th className="py-2.5 px-4 font-medium text-right">Цена</th>
                <th className="py-2.5 px-4 font-medium text-center">Кол-во</th>
                <th className="py-2.5 px-4 font-medium text-right">Скидка</th>
                <th className="py-2.5 px-4 font-medium text-right">Итого</th>
                <th className="py-2.5 px-4 font-medium text-right w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {items.map((item, index) => {
                const isDirectProduct = item.itemType === "product" && !item.id.startsWith("repair-");
                const wh = isDirectProduct && item.itemId ? warehouseMap.get(item.itemId) : null;
                const needsOrder =
                  isDirectProduct &&
                  !item.consumedAt &&
                  (!item.purchaseRequestStatus || item.purchaseRequestStatus === "cancelled") &&
                  (!wh || (wh.availableStock ?? 0) < item.quantity);

                return (
                  <tr key={item.id} className="hover:bg-[#fafafa] transition-colors group">
                    <td className="py-2.5 px-4 text-xs font-mono text-[#888888]">
                      {index + 1}
                    </td>
                    <td className="py-2.5 px-4">
                      <p className="text-[13px] font-medium text-[#111111]">{item.name}</p>
                      {item.description ? (
                        <p className="text-[11px] text-[#666666] line-clamp-1 mt-0.5">{item.description}</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        {item.sku ? (
                          <span className="text-[10px] font-mono text-[#888888]">Арт: {item.sku}</span>
                        ) : null}
                        {isDirectProduct && item.consumedAt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <Check className="h-2.5 w-2.5" />
                            Списано FIFO
                          </span>
                        ) : null}
                        {isDirectProduct && item.costSource === "pending_purchase" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <ShoppingCart className="h-2.5 w-2.5" />
                            Ожидает закупку
                          </span>
                        ) : null}
                        {isDirectProduct && item.purchaseRequestStatus && item.costSource !== "pending_purchase" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                            Заявка: {item.purchaseRequestStatus === "received" ? "поступило" : item.purchaseRequestStatus === "ordered" ? "заказано" : "в ожидании"}
                          </span>
                        ) : null}
                      </div>
                      {item.batchAllocations && item.batchAllocations.length > 0 && (
                        <div className="mt-1 text-[10px] font-mono text-[#666666]">
                          {item.batchAllocations
                            .map((a) => `${a.batchNumber || "Партия"}: ${a.quantity}×${formatRub(a.unitCost)}`)
                            .join(" + ")}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      {item.itemType === "service" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                          <BookOpen className="h-3 w-3" />
                          Услуга
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                          <Boxes className="h-3 w-3" />
                          Товар
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {item.itemType === "product" && (item.costPrice ?? 0) > 0 ? (
                        <div>
                          <span className="text-xs font-mono tabular-nums text-[#666666]">
                            {formatRub(item.costPrice ?? 0)}
                          </span>
                          {item.markupPercent !== undefined && (
                            <div className="text-[10px] font-mono text-emerald-700">
                              +{item.markupPercent}%
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-[#cccccc]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-xs font-mono tabular-nums text-[#111111]">
                        {formatRub(item.price)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-center">
                      <span className="text-xs font-mono tabular-nums font-medium text-[#111111]">
                        {item.quantity} {item.unit || "шт"}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {item.discountPercent > 0 ? (
                        <span className="text-xs font-mono text-emerald-600">
                          -{item.discountPercent}%
                        </span>
                      ) : (
                        <span className="text-xs text-[#cccccc]">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <span className="text-xs font-mono font-bold tabular-nums text-[#111111]">
                        {formatRub(item.totalAmount)}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {needsOrder && (
                          <button
                            type="button"
                            onClick={() => void handleQuickPurchaseRequest(item)}
                            disabled={requestingId === item.id}
                            title="Нет на складе — создать заявку на закупку"
                            className="rounded-[6px] p-1.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {requestingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {!item.id.startsWith("repair-") && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(item.id, item.name)}
                            disabled={deletingId === item.id}
                            title="Удалить из сделки"
                            className="rounded-[6px] p-1.5 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                          >
                            {deletingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#e5e5e5] bg-[#fafafa] font-semibold text-xs text-[#111111]">
                <td colSpan={7} className="py-3 px-4 text-right">
                  ИТОГО ПО СДЕЛКЕ:
                </td>
                <td className="py-3 px-4 text-right font-mono font-bold text-sm text-[#4a38f5]">
                  {formatRub(stats.calculatedBudget || totalBudget)}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {/* Purchase Requests linked to this deal */}
      {purchaseRequests.length > 0 && (
        <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-[#4a38f5]" />
              <h4 className="text-xs font-semibold text-[#111111]">
                Заявки на закупку по этой сделке ({purchaseRequests.length})
              </h4>
            </div>
            <Link
              href="/warehouse"
              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4a38f5] hover:underline"
            >
              <span>Открыть на складе</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
          <div className="divide-y divide-[#f0f0f0] border-t border-[#f0f0f0]">
            {purchaseRequests.map((pr) => {
              const badge = {
                pending: { label: "В ожидании", cls: "bg-amber-50 text-amber-700 border-amber-200" },
                ordered: { label: "Заказано", cls: "bg-sky-50 text-sky-700 border-sky-200" },
                received: { label: "Поступило", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
                cancelled: { label: "Отменено", cls: "bg-rose-50 text-rose-700 border-rose-200" },
              }[pr.status];
              return (
                <div key={pr.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="font-medium text-[#111111]">{pr.itemName}</span>
                    {pr.sku && <span className="ml-1.5 font-mono text-[11px] text-[#888888]">{pr.sku}</span>}
                    {pr.comment && <p className="text-[11px] text-[#666666]">{pr.comment}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-medium text-[#111111]">
                      {pr.quantity} {pr.unit}
                    </span>
                    <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium", badge.cls)}>
                      {badge.label}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
