"use client";

import Link from "next/link";
import { useState, useMemo, useRef, useCallback, type KeyboardEvent } from "react";
import {
  Wrench,
  Package,
  Boxes,
  BookOpen,
  Plus,
  Minus,
  Trash2,
  Loader2,
  Check,
  AlertCircle,
  Calculator,
  ShoppingCart,
  ExternalLink,
  Pencil,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  useDealItems,
  useAddDealItem,
  useUpdateDealItem,
  useDeleteDealItem,
  type DealDTO,
  type DealItemDTO,
} from "@/lib/api/use-deals";
import {
  useWarehouseItems,
  useWarehouseSettings,
  usePurchaseRequests,
  useCreatePurchaseRequest,
  useDeletePurchaseRequest,
  type WarehouseItemDTO,
} from "@/lib/api/use-warehouse";
import { useServices, useCreateService, type ServiceItemDTO } from "@/lib/api/use-services";
import type { RepairServiceCatalogItemDTO } from "@/lib/api/use-repairs";
import { useDealEconomics } from "@/lib/api/use-invoices";
import { useAuth } from "@/lib/auth/use-auth";
import { isModuleInstalled } from "@/lib/context/tenant";
import { cn, matchesSearchTokens, matchesWarehouseItem } from "@/lib/utils";
import { useClickOutside } from "@/lib/hooks/use-click-outside";
import { formatRub } from "@/lib/utils/format";
import { Skeleton } from "@/components/shared/Skeleton";
import { ServiceCatalogDialog } from "@/components/services/ServiceCatalogDialog";
import { CreateOrEditServiceModal } from "@/components/warehouse/CreateOrEditServiceModal";
import { DealProductAddModal } from "./DealProductAddModal";

const MAX_WAREHOUSE_DROPDOWN_ITEMS = 80;

interface SelectedServiceDraft {
  serviceId: string;
  name: string;
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

function parsePositiveNumber(value: string): number {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed > 0 ? parsed : 0;
}

function parseNonNegativeNumber(value: string): number {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed >= 0 ? parsed : 0;
}

export function DealProductsServicesTab({ deal }: { deal: DealDTO }) {
  const { tenant } = useAuth();
  const hasFinance = isModuleInstalled(tenant?.installedModules ?? [], "finance");
  const { data: dealEconomics } = useDealEconomics(deal.id, hasFinance);
  const { data: dealItemsData, isLoading: isItemsLoading } = useDealItems(deal.id);
  const items = useMemo(() => dealItemsData?.data ?? [], [dealItemsData?.data]);
  const totalBudget = dealItemsData?.totalBudget ?? deal.budget ?? 0;

  const addItemMutation = useAddDealItem(deal.id);
  const updateItemMutation = useUpdateDealItem(deal.id);
  const deleteItemMutation = useDeleteDealItem(deal.id);
  const createPurchaseRequestMutation = useCreatePurchaseRequest();
  const deletePurchaseRequestMutation = useDeletePurchaseRequest();
  const createServiceMutation = useCreateService();
  const [deletingPrId, setDeletingPrId] = useState<string | null>(null);

  const {
    data: warehouseItems = [],
    isLoading: isWarehouseLoading,
    isError: isWarehouseError,
  } = useWarehouseItems();
  const { data: warehouseSettings } = useWarehouseSettings();
  const allowNegativeStock = warehouseSettings ? Boolean(warehouseSettings.allowNegativeStock) : true;
  const {
    data: servicesCatalog = [],
    isLoading: isServicesLoading,
    isError: isServicesError,
  } = useServices();
  const { data: purchaseRequests = [] } = usePurchaseRequests(undefined, undefined, deal.id);

  // Split deal items into Services and Products (1-to-1 with Service Center WorkItemsTable + PartsTable)
  const serviceItems = useMemo(
    () => items.filter((item) => item.itemType === "service"),
    [items],
  );
  const productItems = useMemo(
    () => items.filter((item) => item.itemType === "product"),
    [items],
  );

  const warehouseMap = useMemo(
    () => new Map(warehouseItems.map((w) => [w.id, w])),
    [warehouseItems],
  );

  // ===========================================================================
  // State: Services Block (WorkItemsTable pattern)
  // ===========================================================================
  const [svcDesc, setSvcDesc] = useState("");
  const [svcQty, setSvcQty] = useState("1");
  const [svcUnitPrice, setSvcUnitPrice] = useState("");
  const [svcTotal, setSvcTotal] = useState("");
  const [selectedServices, setSelectedServices] = useState<SelectedServiceDraft[]>([]);
  const [svcCatalogOpen, setSvcCatalogOpen] = useState(false);
  const [isServiceCatalogDialogOpen, setIsServiceCatalogDialogOpen] = useState(false);
  const [createServiceModalOpen, setCreateServiceModalOpen] = useState(false);
  const [isSubmittingServicesBatch, setIsSubmittingServicesBatch] = useState(false);

  const svcComboboxRef = useRef<HTMLDivElement>(null);
  const svcInputRef = useRef<HTMLInputElement>(null);
  useClickOutside(svcComboboxRef, () => setSvcCatalogOpen(false), svcCatalogOpen);

  // ===========================================================================
  // State: Products Block (PartsTable pattern)
  // ===========================================================================
  const [prodName, setProdName] = useState("");
  const [prodSku, setProdSku] = useState("");
  const [prodQty, setProdQty] = useState("1");
  const [prodRetail, setProdRetail] = useState("");
  const [prodCost, setProdCost] = useState("");
  const [selectedWarehouseItem, setSelectedWarehouseItem] = useState<WarehouseItemDTO | null>(null);
  const [whCatalogOpen, setWhCatalogOpen] = useState(false);
  const [prodAddToPurchase, setProdAddToPurchase] = useState(false);
  const [prodSaveToCatalog, setProdSaveToCatalog] = useState(false);
  const [productAddModalOpen, setProductAddModalOpen] = useState(false);
  const [editingPriceItemId, setEditingPriceItemId] = useState<string | null>(null);
  const [editingPriceValue, setEditingPriceValue] = useState("");
  const [savingPriceItemId, setSavingPriceItemId] = useState<string | null>(null);

  const whComboboxRef = useRef<HTMLDivElement>(null);
  useClickOutside(whComboboxRef, () => setWhCatalogOpen(false), whCatalogOpen);

  // Shared action states
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [requestingId, setRequestingId] = useState<string | null>(null);

  // ===========================================================================
  // Summary Statistics
  // ===========================================================================
  const stats = useMemo(() => {
    let productsSum = 0;
    let productsCostSum = 0;
    let servicesSum = 0;

    for (const item of items) {
      if (item.itemType === "product") {
        productsSum += item.totalAmount;
        productsCostSum += (item.costPrice ?? 0) * item.quantity;
      } else {
        servicesSum += item.totalAmount;
      }
    }

    const productsProfit = productsSum - productsCostSum;
    const productsMarkupPct =
      productsCostSum > 0 ? Math.round((productsProfit / productsCostSum) * 100) : 0;
    const productsMarginPct =
      productsSum > 0 && productsCostSum > 0
        ? Math.round((productsProfit / productsSum) * 100)
        : 0;

    return {
      productsSum,
      productsCostSum,
      productsProfit,
      productsMarkupPct,
      productsMarginPct,
      servicesSum,
      totalCount: items.length,
      calculatedBudget: productsSum + servicesSum,
    };
  }, [items]);

  // ===========================================================================
  // Services Block Logic (exact WorkItemsTable UX)
  // ===========================================================================
  const filteredServicesCatalog = useMemo(
    () =>
      servicesCatalog.filter((svc) =>
        matchesSearchTokens(svcDesc, [svc.name, svc.description]),
      ),
    [servicesCatalog, svcDesc],
  );

  const exactServiceMatchExists = useMemo(() => {
    const trimmed = svcDesc.trim().toLowerCase();
    if (!trimmed) return false;
    return servicesCatalog.some((svc) => svc.name.trim().toLowerCase() === trimmed);
  }, [servicesCatalog, svcDesc]);

  const selectedServiceMap = useMemo(() => {
    const map = new Map<string, SelectedServiceDraft>();
    for (const draft of selectedServices) {
      map.set(draft.serviceId, draft);
    }
    return map;
  }, [selectedServices]);

  const allFilteredServicesSelected =
    filteredServicesCatalog.length > 0 &&
    filteredServicesCatalog.every((svc) => selectedServiceMap.has(svc.id));

  const selectedServicesTotalSum = useMemo(
    () =>
      selectedServices.reduce((sum, draft) => {
        const qty = parsePositiveNumber(draft.quantity);
        const unitPrice = parseNonNegativeNumber(draft.unitPrice);
        return sum + Math.round(qty * unitPrice * 100) / 100;
      }, 0),
    [selectedServices],
  );

  const hasInvalidSelectedServiceDraft = useMemo(
    () =>
      selectedServices.some((draft) => {
        const q = parseFloat(draft.quantity);
        const p = draft.unitPrice.trim() === "" ? 0 : parseFloat(draft.unitPrice);
        return isNaN(q) || q <= 0 || isNaN(p) || p < 0;
      }),
    [selectedServices],
  );

  const handleToggleCatalogService = useCallback((svc: ServiceItemDTO) => {
    const basePrice = svc.price || svc.defaultPrice || 0;
    setSelectedServices((prev) => {
      const exists = prev.some((s) => s.serviceId === svc.id);
      if (exists) {
        return prev.filter((s) => s.serviceId !== svc.id);
      }
      return [
        ...prev,
        {
          serviceId: svc.id,
          name: svc.name,
          description: svc.description ?? "",
          unit: svc.unit || "усл",
          quantity: "1",
          unitPrice: String(basePrice),
        },
      ];
    });
  }, []);

  const handleToggleAllFilteredServices = useCallback(() => {
    setSelectedServices((prev) => {
      if (allFilteredServicesSelected) {
        const filteredIds = new Set(filteredServicesCatalog.map((s) => s.id));
        return prev.filter((s) => !filteredIds.has(s.serviceId));
      }
      const existingIds = new Set(prev.map((s) => s.serviceId));
      const additions: SelectedServiceDraft[] = [];
      for (const svc of filteredServicesCatalog) {
        if (!existingIds.has(svc.id)) {
          additions.push({
            serviceId: svc.id,
            name: svc.name,
            description: svc.description ?? "",
            unit: svc.unit || "усл",
            quantity: "1",
            unitPrice: String(svc.price || svc.defaultPrice || 0),
          });
        }
      }
      return [...prev, ...additions];
    });
  }, [allFilteredServicesSelected, filteredServicesCatalog]);

  const handleUpdateSelectedServiceDraft = useCallback(
    (serviceId: string, patch: Partial<Pick<SelectedServiceDraft, "quantity" | "unitPrice">>) => {
      setSelectedServices((prev) =>
        prev.map((s) => (s.serviceId === serviceId ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  const handleStepSelectedServiceQty = useCallback((serviceId: string, delta: number) => {
    setSelectedServices((prev) =>
      prev.map((s) => {
        if (s.serviceId !== serviceId) return s;
        const current = parsePositiveNumber(s.quantity) || 1;
        const next = Math.max(1, Math.round((current + delta) * 100) / 100);
        return { ...s, quantity: String(next) };
      }),
    );
  }, []);

  const handleRemoveSelectedService = useCallback((serviceId: string) => {
    setSelectedServices((prev) => prev.filter((s) => s.serviceId !== serviceId));
  }, []);

  const handleSvcQtyChange = useCallback(
    (val: string) => {
      setSvcQty(val);
      const q = parseFloat(val);
      const up = parseFloat(svcUnitPrice);
      if (!isNaN(q) && q > 0 && !isNaN(up) && up >= 0) {
        setSvcTotal(String(Math.round(q * up * 100) / 100));
      }
    },
    [svcUnitPrice],
  );

  const handleSvcUnitPriceChange = useCallback(
    (val: string) => {
      setSvcUnitPrice(val);
      const q = parseFloat(svcQty);
      const up = parseFloat(val);
      if (!isNaN(q) && q > 0 && !isNaN(up) && up >= 0) {
        setSvcTotal(String(Math.round(q * up * 100) / 100));
      } else if (val === "") {
        setSvcTotal("");
      }
    },
    [svcQty],
  );

  const handleSvcTotalChange = useCallback(
    (val: string) => {
      setSvcTotal(val);
      const q = parseFloat(svcQty);
      const c = parseFloat(val);
      if (!isNaN(q) && q > 0 && !isNaN(c) && c >= 0) {
        setSvcUnitPrice(String(Math.round((c / q) * 100) / 100));
      } else if (val === "") {
        setSvcUnitPrice("");
      }
    },
    [svcQty],
  );

  const handleCreateServiceInCatalog = useCallback(() => {
    const trimmed = svcDesc.trim();
    if (!trimmed) return;
    setSvcCatalogOpen(false);
    setCreateServiceModalOpen(true);
  }, [svcDesc]);

  const handleServiceCreatedInCatalog = useCallback(
    (created: ServiceItemDTO) => {
      toast.success(`Услуга «${created.name}» сохранена в справочник`);
      setSelectedServices((prev) => {
        if (prev.some((s) => s.serviceId === created.id)) return prev;
        return [
          ...prev,
          {
            serviceId: created.id,
            name: created.name,
            description: created.description ?? "",
            unit: created.unit || "усл",
            quantity: svcQty || "1",
            unitPrice: String(created.price || created.defaultPrice || 0),
          },
        ];
      });
      setSvcDesc("");
      setSvcUnitPrice("");
      setSvcTotal("");
      setSvcQty("1");
    },
    [svcQty],
  );

  const submitServicesList = useCallback(
    async (
      drafts: Array<{
        serviceId?: string | null;
        name: string;
        description?: string;
        unit?: string;
        quantity: number;
        unitPrice: number;
      }>,
    ): Promise<boolean> => {
      if (drafts.length === 0) return false;
      setIsSubmittingServicesBatch(true);
      try {
        for (const d of drafts) {
          await addItemMutation.mutateAsync({
            item_type: "service",
            item_id: d.serviceId ?? null,
            name: d.name.trim(),
            description: d.description?.trim() ?? "",
            price: d.unitPrice,
            cost_price: 0,
            quantity: d.quantity,
            unit: d.unit || "усл",
          });
        }
        toast.success(
          drafts.length === 1
            ? `Услуга «${drafts[0].name}» добавлена в сделку`
            : `Добавлено услуг в сделку: ${drafts.length}`,
        );
        return true;
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить услуги");
        return false;
      } finally {
        setIsSubmittingServicesBatch(false);
      }
    },
    [addItemMutation],
  );

  const handleAddSingleService = useCallback(async () => {
    const trimmed = svcDesc.trim();
    if (!trimmed) return;
    const qtyNum = parsePositiveNumber(svcQty) || 1;
    let unitPriceNum = parseFloat(svcUnitPrice);
    if (isNaN(unitPriceNum) || unitPriceNum < 0) {
      const totalNum = parseFloat(svcTotal);
      unitPriceNum = !isNaN(totalNum) && totalNum >= 0 ? Math.round((totalNum / qtyNum) * 100) / 100 : 0;
    }

    const matchedCatalog = servicesCatalog.find(
      (s) => s.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );

    const ok = await submitServicesList([
      {
        serviceId: matchedCatalog?.id ?? null,
        name: trimmed,
        description: matchedCatalog?.description ?? "",
        unit: matchedCatalog?.unit || "усл",
        quantity: qtyNum,
        unitPrice: unitPriceNum,
      },
    ]);
    if (ok) {
      setSvcDesc("");
      setSvcQty("1");
      setSvcUnitPrice("");
      setSvcTotal("");
      setSvcCatalogOpen(false);
    }
  }, [svcDesc, svcQty, svcUnitPrice, svcTotal, servicesCatalog, submitServicesList]);

  const handleAddSelectedServices = useCallback(async () => {
    if (selectedServices.length === 0 || hasInvalidSelectedServiceDraft) return;
    const ok = await submitServicesList(
      selectedServices.map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        description: s.description,
        unit: s.unit,
        quantity: parsePositiveNumber(s.quantity) || 1,
        unitPrice: parseNonNegativeNumber(s.unitPrice),
      })),
    );
    if (ok) {
      setSelectedServices([]);
      setSvcDesc("");
      setSvcQty("1");
      setSvcUnitPrice("");
      setSvcTotal("");
      setSvcCatalogOpen(false);
    }
  }, [selectedServices, hasInvalidSelectedServiceDraft, submitServicesList]);

  const handleAddServicesFromDialog = useCallback(
    async (catalogItems: RepairServiceCatalogItemDTO[]) => {
      if (catalogItems.length === 0) return;
      const ok = await submitServicesList(
        catalogItems.map((svc) => ({
          serviceId: svc.id,
          name: svc.name,
          description: svc.description ?? "",
          unit: svc.unit || "усл",
          quantity: 1,
          unitPrice: svc.defaultPrice ?? 0,
        })),
      );
      if (ok) {
        setIsServiceCatalogDialogOpen(false);
      }
    },
    [submitServicesList],
  );

  const handleSvcKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (selectedServices.length > 0) {
          void handleAddSelectedServices();
        } else {
          void handleAddSingleService();
        }
      } else if (e.key === "Escape") {
        setSvcCatalogOpen(false);
      }
    },
    [selectedServices.length, handleAddSelectedServices, handleAddSingleService],
  );

  const isAddingServices = isSubmittingServicesBatch || addItemMutation.isPending;
  const canAddSelectedServices =
    !isAddingServices && selectedServices.length > 0 && !hasInvalidSelectedServiceDraft;
  const canAddSingleService =
    !isAddingServices &&
    svcDesc.trim().length > 0 &&
    !isNaN(parseFloat(svcQty)) &&
    parseFloat(svcQty) > 0;

  // ===========================================================================
  // Products Block Logic (exact PartsTable UX)
  // ===========================================================================
  const filteredWarehouseItems = useMemo(
    () => warehouseItems.filter((wi) => matchesWarehouseItem(wi, prodName)),
    [warehouseItems, prodName],
  );

  const requestedProdQty = parsePositiveNumber(prodQty) || 1;
  const isProdStockDeficit = selectedWarehouseItem
    ? (selectedWarehouseItem.availableStock ?? 0) < requestedProdQty
    : false;
  const prodShortage = selectedWarehouseItem
    ? Math.max(0, Math.round((requestedProdQty - Math.max(0, Number(selectedWarehouseItem.availableStock ?? 0))) * 100) / 100)
    : 0;

  const handleSelectWarehouseItem = useCallback(
    (item: WarehouseItemDTO) => {
      setSelectedWarehouseItem(item);
      setProdName(item.name);
      setProdSku(item.sku || "Б/А");
      setProdRetail(String(item.retailPrice ?? 0));
      const fifoCost = item.fifoCostPrice && item.fifoCostPrice > 0 ? item.fifoCostPrice : item.costPrice;
      setProdCost(String(fifoCost ?? 0));
      const q = parsePositiveNumber(prodQty) || 1;
      setProdAddToPurchase((item.availableStock ?? 0) < q);
      setProdSaveToCatalog(false);
      setWhCatalogOpen(false);
    },
    [prodQty],
  );

  const handleAddProduct = useCallback(
    async (forceAddToPurchase = false) => {
      const trimmedName = prodName.trim();
      const qtyNum = parsePositiveNumber(prodQty);
      if (!trimmedName || qtyNum <= 0) return;

      const retailNum = isNaN(parseFloat(prodRetail)) ? 0 : Math.max(0, parseFloat(prodRetail));
      const costNum = isNaN(parseFloat(prodCost)) ? 0 : Math.max(0, parseFloat(prodCost));
      const skuClean = prodSku.trim();
      const shouldSaveToCatalog = !selectedWarehouseItem && prodSaveToCatalog;
      const shouldAddToPurchase = forceAddToPurchase || prodAddToPurchase;

      try {
        await addItemMutation.mutateAsync({
          item_type: "product",
          item_id: selectedWarehouseItem?.id ?? null,
          name: trimmedName,
          description: selectedWarehouseItem?.category ? `Категория: ${selectedWarehouseItem.category}` : "",
          sku: skuClean,
          price: retailNum,
          cost_price: costNum,
          quantity: qtyNum,
          unit: selectedWarehouseItem?.unit || "шт",
          save_to_catalog: shouldSaveToCatalog,
          add_to_purchase_request: shouldAddToPurchase,
        });

        toast.success(
          `Товар «${trimmedName}» добавлен${
            selectedWarehouseItem ? " (со склада)" : shouldSaveToCatalog ? " и сохранён на склад" : ""
          }${shouldAddToPurchase ? " + создана заявка на закупку" : ""}`,
        );

        setProdName("");
        setProdSku("");
        setProdQty("1");
        setProdRetail("");
        setProdCost("");
        setSelectedWarehouseItem(null);
        setProdAddToPurchase(false);
        setProdSaveToCatalog(false);
        setWhCatalogOpen(false);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось добавить товар");
      }
    },
    [
      prodName,
      prodSku,
      prodQty,
      prodRetail,
      prodCost,
      selectedWarehouseItem,
      prodAddToPurchase,
      prodSaveToCatalog,
      addItemMutation,
    ],
  );

  const handleProdKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void handleAddProduct();
      } else if (e.key === "Escape") {
        setWhCatalogOpen(false);
      }
    },
    [handleAddProduct],
  );

  const handleStartEditPrice = useCallback((item: DealItemDTO) => {
    setEditingPriceItemId(item.id);
    setEditingPriceValue(String(item.price));
  }, []);

  const handleCancelEditPrice = useCallback(() => {
    setEditingPriceItemId(null);
    setEditingPriceValue("");
  }, []);

  const handleSaveEditPrice = useCallback(
    async (item: DealItemDTO) => {
      const parsed = parseFloat(editingPriceValue.replace(",", "."));
      if (isNaN(parsed) || parsed < 0) {
        toast.error("Укажите корректную цену (≥ 0)");
        return;
      }
      if (Math.abs(parsed - item.price) < 0.001) {
        handleCancelEditPrice();
        return;
      }
      setSavingPriceItemId(item.id);
      try {
        await updateItemMutation.mutateAsync({
          itemId: item.id,
          payload: { price: parsed },
        });
        toast.success(`Цена «${item.name}» обновлена`);
        handleCancelEditPrice();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось обновить цену");
      } finally {
        setSavingPriceItemId(null);
      }
    },
    [editingPriceValue, updateItemMutation, handleCancelEditPrice],
  );

  const handleQuickPurchaseRequest = useCallback(
    async (item: DealItemDTO) => {
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
        toast.success(`Заявка на закупку (${reqQty} ${item.unit || "шт"}) отправлена на склад`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось создать заявку на закупку");
      } finally {
        setRequestingId(null);
      }
    },
    [warehouseMap, createPurchaseRequestMutation, deal.id, deal.title],
  );

  const handleCreatePurchaseFromDraft = useCallback(async () => {
    if (!selectedWarehouseItem) return;
    await handleAddProduct(true);
  }, [selectedWarehouseItem, handleAddProduct]);

  const handleDeletePurchaseRequest = useCallback(
    async (prId: string, itemName: string) => {
      setDeletingPrId(prId);
      try {
        await deletePurchaseRequestMutation.mutateAsync(prId);
        toast.success(`Заявка на закупку «${itemName}» удалена`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить заявку на закупку");
      } finally {
        setDeletingPrId(null);
      }
    },
    [deletePurchaseRequestMutation],
  );

  const handleDeleteItem = useCallback(
    async (itemId: string, name: string) => {
      setDeletingId(itemId);
      try {
        await deleteItemMutation.mutateAsync(itemId);
        toast.success(`Позиция «${name}» удалена из сделки`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Не удалось удалить позицию");
      } finally {
        setDeletingId(null);
      }
    },
    [deleteItemMutation],
  );

  const canAddProduct =
    !addItemMutation.isPending && prodName.trim().length > 0 && requestedProdQty > 0;

  if (isItemsLoading) {
    return (
      <div className="p-5 space-y-4">
        <Skeleton className="h-16 w-full rounded-[8px]" />
        <Skeleton className="h-44 w-full rounded-[8px]" />
        <Skeleton className="h-44 w-full rounded-[8px]" />
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      {/* Compact Summary KPI Card (Twenty CRM Light) */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[#e5e5e5] bg-white px-4 py-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-indigo-50 border border-indigo-200 text-[#4a38f5]">
            <Calculator className="h-4 w-4" />
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#666666]">Позиций:</span>
              <span className="text-xs font-bold font-mono text-[#111111]">{stats.totalCount}</span>
            </div>
            <span className="text-[#e5e5e5]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#666666]">Услуги:</span>
              <span className="text-xs font-semibold font-mono text-[#111111]">
                {formatRub(stats.servicesSum)}
              </span>
            </div>
            <span className="text-[#e5e5e5]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#666666]">Товары:</span>
              <span className="text-xs font-semibold font-mono text-[#111111]">
                {formatRub(stats.productsSum)}
              </span>
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
                    (+{stats.productsMarkupPct}%)
                  </span>
                </div>
              </>
            )}
            <span className="text-[#e5e5e5]">|</span>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#666666]">Итого бюджет:</span>
              <span className="text-sm font-bold font-mono tabular-nums text-[#4a38f5]">
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
                      "text-xs font-semibold font-mono tabular-nums",
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
                      "text-sm font-bold font-mono tabular-nums",
                      dealEconomics.netProfit < 0 ? "text-rose-700" : "text-emerald-700",
                    )}
                  >
                    {formatRub(dealEconomics.netProfit)}
                  </span>
                  {dealEconomics.revenue > 0 && (
                    <span
                      className={cn(
                        "text-[11px] font-mono tabular-nums",
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
        </div>
      </div>

      {/* ===================================================================== */}
      {/* BLOCK 1: УСЛУГИ (1-to-1 with Service Center WorkItemsTable)           */}
      {/* ===================================================================== */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
        <div className="flex items-center gap-2 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
          <Wrench className="h-4 w-4 text-[#666666]" />
          <span className="text-sm font-semibold text-[#111111]">Услуги</span>
          <div className="ml-auto flex items-center gap-2.5">
            <span className="text-xs text-[#888888]">{serviceItems.length} позиций</span>
            <button
              type="button"
              onClick={() => setIsServiceCatalogDialogOpen(true)}
              className="flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] hover:border-[#cccccc] transition-colors cursor-pointer"
            >
              <BookOpen className="h-3.5 w-3.5 text-[#4a38f5]" />
              Справочник услуг
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                  Описание
                </th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[75px]">
                  Кол-во
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                  Цена/ед.
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                  Стоимость
                </th>
                <th className="px-4 py-2.5 w-[44px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {serviceItems.map((item) => {
                const isFromRepair = item.id.startsWith("repair-");
                return (
                  <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-[13px] text-[#111111]">{item.name}</p>
                        {isFromRepair && (
                          <span className="inline-flex items-center rounded-[4px] bg-[#f5f5f5] border border-[#e5e5e5] px-1.5 py-0.5 text-[10px] font-medium text-[#666666]">
                            Из наряда
                          </span>
                        )}
                      </div>
                      {item.description ? (
                        <p className="text-[11px] text-[#888888] mt-0.5 line-clamp-1">
                          {item.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[13px] font-mono text-[#666666] tabular-nums">
                        {item.quantity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[13px] font-mono text-[#666666] tabular-nums">
                        {formatRub(item.price)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[13px] font-mono font-semibold text-[#111111] tabular-nums">
                        {formatRub(item.totalAmount)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {!isFromRepair && (
                        <button
                          type="button"
                          onClick={() => void handleDeleteItem(item.id, item.name)}
                          disabled={deletingId === item.id}
                          aria-label={`Удалить услугу ${item.name}`}
                          className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                          title="Удалить услугу"
                        >
                          {deletingId === item.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {serviceItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center">
                    <p className="text-xs text-[#888888]">Услуги пока не добавлены.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Always-visible Add Service Row (exact WorkItemsTable pattern) */}
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 space-y-2.5">
          {/* Selected Services Drafts Bar */}
          {selectedServices.length > 0 && (
            <div className="rounded-[8px] border border-[#4a38f5]/25 bg-white shadow-2xs overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#f0f0f0] bg-[#4a38f5]/[0.04] px-3 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold text-[#111111]">
                    Выбранные услуги ({selectedServices.length})
                  </span>
                  <span className="text-[#888888]">·</span>
                  <span className="font-mono font-semibold text-[#4a38f5] tabular-nums">
                    {formatRub(selectedServicesTotalSum)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedServices([])}
                    disabled={isAddingServices}
                    className="text-xs text-[#666666] hover:text-[#111111] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Очистить
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAddSelectedServices()}
                    disabled={!canAddSelectedServices}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1 text-xs font-medium transition-colors",
                      canAddSelectedServices
                        ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer shadow-2xs"
                        : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                    )}
                  >
                    {isSubmittingServicesBatch ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Plus className="h-3.5 w-3.5" />
                    )}
                    Добавить выбранные ({selectedServices.length})
                  </button>
                </div>
              </div>

              <div className="max-h-48 overflow-y-auto divide-y divide-[#f0f0f0]">
                {selectedServices.map((draft) => {
                  const qtyNum = parsePositiveNumber(draft.quantity);
                  const priceNum = parseNonNegativeNumber(draft.unitPrice);
                  const lineTotal = Math.round(qtyNum * priceNum * 100) / 100;
                  return (
                    <div
                      key={draft.serviceId}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[#fafafa]"
                    >
                      <span className="flex-1 min-w-0 font-medium text-[#111111] truncate">
                        {draft.name}
                      </span>
                      <input
                        type="number"
                        min={0.01}
                        step={1}
                        value={draft.quantity}
                        onChange={(e) =>
                          handleUpdateSelectedServiceDraft(draft.serviceId, { quantity: e.target.value })
                        }
                        aria-label={`Количество: ${draft.name}`}
                        title="Количество"
                        className="w-[56px] rounded-[6px] border border-[#e5e5e5] bg-white py-1 px-1.5 text-xs text-center font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="text-[#888888]">×</span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={draft.unitPrice}
                        onChange={(e) =>
                          handleUpdateSelectedServiceDraft(draft.serviceId, { unitPrice: e.target.value })
                        }
                        aria-label={`Цена: ${draft.name}`}
                        title="Цена за единицу"
                        className="w-[82px] rounded-[6px] border border-[#e5e5e5] bg-white py-1 px-2 text-xs text-right font-mono tabular-nums text-[#111111] focus:border-[#4a38f5] focus:outline-none [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      />
                      <span className="w-[78px] text-right font-mono font-semibold text-[#111111] tabular-nums shrink-0">
                        {formatRub(lineTotal)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveSelectedService(draft.serviceId)}
                        aria-label={`Убрать услугу ${draft.name}`}
                        title="Убрать из выбранных"
                        className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {/* Service Catalog Combobox */}
            <div ref={svcComboboxRef} className="relative flex-1 min-w-[200px]">
              <div className="relative">
                <input
                  ref={svcInputRef}
                  type="text"
                  value={svcDesc}
                  onChange={(e) => {
                    setSvcDesc(e.target.value);
                    setSvcCatalogOpen(true);
                  }}
                  onFocus={() => setSvcCatalogOpen(true)}
                  onKeyDown={handleSvcKeyDown}
                  placeholder={
                    selectedServices.length > 0
                      ? "Поиск и выбор ещё услуг из каталога..."
                      : "Выберите из каталога или введите услугу..."
                  }
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-3 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <button
                  type="button"
                  onClick={() => setIsServiceCatalogDialogOpen(true)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#888888] hover:text-[#4a38f5] p-0.5 transition-colors cursor-pointer"
                  title="Управление справочником услуг"
                  aria-label="Открыть справочник услуг"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                </button>
              </div>

              {svcCatalogOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 flex max-h-80 flex-col overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg">
                  <div className="flex items-center justify-between gap-2 border-b border-[#f0f0f0] px-2.5 py-1.5 bg-[#fafafa]">
                    <span className="text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                      Справочник услуг
                    </span>
                    <div className="flex items-center gap-2.5">
                      {filteredServicesCatalog.length > 0 && (
                        <button
                          type="button"
                          onClick={handleToggleAllFilteredServices}
                          className="text-[11px] font-medium text-[#666666] hover:text-[#111111] transition-colors cursor-pointer"
                        >
                          {allFilteredServicesSelected ? "Снять все" : "Выбрать все"}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setSvcCatalogOpen(false);
                          setIsServiceCatalogDialogOpen(true);
                        }}
                        className="text-[11px] text-[#4a38f5] hover:underline font-medium cursor-pointer"
                      >
                        Управление
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-1">
                    {isServicesLoading && (
                      <div className="flex items-center justify-center py-4 text-xs text-[#888888]">
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка справочника...
                      </div>
                    )}

                    {!isServicesLoading && isServicesError && (
                      <div className="px-2.5 py-2 text-xs text-rose-600">
                        Не удалось загрузить справочник услуг.
                      </div>
                    )}

                    {!isServicesLoading && !isServicesError && filteredServicesCatalog.length > 0 && (
                      <div className="space-y-0.5">
                        {filteredServicesCatalog.map((svc) => {
                          const selectedDraft = selectedServiceMap.get(svc.id);
                          const isSelected = Boolean(selectedDraft);
                          const svcPrice = svc.price || svc.defaultPrice || 0;
                          return (
                            <div
                              key={svc.id}
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => handleToggleCatalogService(svc)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-xs transition-colors cursor-pointer select-none",
                                isSelected
                                  ? "bg-[#4a38f5]/[0.06] hover:bg-[#4a38f5]/[0.10]"
                                  : "hover:bg-[#fafafa]",
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                                    isSelected
                                      ? "border-[#4a38f5] bg-[#4a38f5] text-white"
                                      : "border-[#cccccc] bg-white",
                                  )}
                                >
                                  {isSelected && <Check className="h-3 w-3" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <span className="block font-medium text-[#111111] truncate">
                                    {svc.name}
                                  </span>
                                  {svc.description ? (
                                    <span className="block text-[11px] text-[#888888] truncate">
                                      {svc.description}
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                {isSelected && selectedDraft && (
                                  <div
                                    className="flex items-center rounded-[6px] border border-[#e5e5e5] bg-white"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => handleStepSelectedServiceQty(svc.id, -1)}
                                      aria-label={`Уменьшить количество: ${svc.name}`}
                                      className="px-1.5 py-0.5 text-[#666666] hover:text-[#111111] hover:bg-[#f5f5f5] rounded-l-[5px] cursor-pointer"
                                    >
                                      <Minus className="h-3 w-3" />
                                    </button>
                                    <span className="min-w-[22px] text-center font-mono text-[11px] font-medium text-[#111111] tabular-nums">
                                      {selectedDraft.quantity}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => handleStepSelectedServiceQty(svc.id, 1)}
                                      aria-label={`Увеличить количество: ${svc.name}`}
                                      className="px-1.5 py-0.5 text-[#666666] hover:text-[#111111] hover:bg-[#f5f5f5] rounded-r-[5px] cursor-pointer"
                                    >
                                      <Plus className="h-3 w-3" />
                                    </button>
                                  </div>
                                )}
                                <span
                                  className={cn(
                                    "font-mono text-[11px] tabular-nums",
                                    svcPrice > 0
                                      ? "font-semibold text-[#4a38f5]"
                                      : "text-[#888888]",
                                  )}
                                >
                                  {formatRub(svcPrice)}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!isServicesLoading && !isServicesError && filteredServicesCatalog.length === 0 && (
                      <div className="px-2.5 py-2 text-xs text-[#888888]">
                        {servicesCatalog.length === 0
                          ? "Справочник пока пуст. Вы можете сохранить первую услугу ниже."
                          : "Услуг по запросу не найдено."}
                      </div>
                    )}

                    {svcDesc.trim().length > 0 && !exactServiceMatchExists && (
                      <div className="mt-1 border-t border-[#f0f0f0] pt-1">
                        <button
                          type="button"
                          onClick={() => void handleCreateServiceInCatalog()}
                          disabled={createServiceMutation.isPending}
                          className="flex w-full items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-left text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors cursor-pointer"
                        >
                          {createServiceMutation.isPending ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          <span>
                            Сохранить в справочник «<span className="font-semibold">{svcDesc.trim()}</span>»
                            {parseFloat(svcTotal || svcUnitPrice) > 0 &&
                              ` (${formatRub(parseFloat(svcTotal || svcUnitPrice))})`}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {selectedServices.length > 0 && (
                    <div className="flex items-center justify-between gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-2.5 py-2">
                      <div className="flex items-center gap-2 text-xs text-[#666666] min-w-0">
                        <span className="shrink-0">
                          Выбрано:{" "}
                          <span className="font-mono font-semibold text-[#111111]">
                            {selectedServices.length}
                          </span>
                        </span>
                        <span className="text-[#cccccc]">·</span>
                        <span className="font-mono font-semibold text-[#111111] tabular-nums truncate">
                          {formatRub(selectedServicesTotalSum)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelectedServices([])}
                          className="text-[11px] text-[#666666] hover:text-[#111111] cursor-pointer"
                        >
                          Сбросить
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleAddSelectedServices()}
                          disabled={!canAddSelectedServices}
                          className={cn(
                            "inline-flex items-center gap-1 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors",
                            canAddSelectedServices
                              ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer"
                              : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                          )}
                        >
                          {isSubmittingServicesBatch ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Plus className="h-3 w-3" />
                          )}
                          Добавить ({selectedServices.length})
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {selectedServices.length === 0 ? (
              <>
                <input
                  type="number"
                  min={0.01}
                  step={0.1}
                  value={svcQty}
                  onChange={(e) => handleSvcQtyChange(e.target.value)}
                  onKeyDown={handleSvcKeyDown}
                  placeholder="Кол-во"
                  title="Количество"
                  className="w-[65px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-center text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={svcUnitPrice}
                  onChange={(e) => handleSvcUnitPriceChange(e.target.value)}
                  onKeyDown={handleSvcKeyDown}
                  placeholder="Цена/ед."
                  title="Цена за единицу"
                  className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] text-[#111111] placeholder:text-[#888888] text-right focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={svcTotal}
                  onChange={(e) => handleSvcTotalChange(e.target.value)}
                  onKeyDown={handleSvcKeyDown}
                  placeholder="Итого ₽"
                  title="Итоговая сумма"
                  className="w-[95px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] font-semibold text-[#111111] placeholder:text-[#888888] text-right focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 font-mono [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() => void handleAddSingleService()}
                  disabled={!canAddSingleService}
                  aria-label="Добавить услугу"
                  title="Добавить услугу"
                  className={cn(
                    "shrink-0 rounded-[8px] p-2 transition-colors",
                    canAddSingleService
                      ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer"
                      : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                  )}
                >
                  {isAddingServices ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => void handleAddSelectedServices()}
                disabled={!canAddSelectedServices}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors",
                  canAddSelectedServices
                    ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer shadow-2xs"
                    : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
                )}
              >
                {isSubmittingServicesBatch ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Добавить ({selectedServices.length})
              </button>
            )}
          </div>
        </div>

        {serviceItems.length > 0 && (
          <div className="flex items-center justify-end gap-2 border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-2.5 text-xs">
            <span className="text-[#666666]">Итого по услугам:</span>
            <span className="text-sm font-bold font-mono text-[#111111] tabular-nums">
              {formatRub(stats.servicesSum)}
            </span>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* BLOCK 2: ТОВАРЫ (1-to-1 with Service Center PartsTable)               */}
      {/* ===================================================================== */}
      <div className="rounded-[8px] border border-[#e5e5e5] bg-white shadow-2xs">
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e5e5e5] px-4 py-3 bg-[#fafafa]">
          <Package className="h-4 w-4 text-[#666666]" />
          <span className="text-sm font-semibold text-[#111111]">Товары</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-[#888888]">{productItems.length} позиций</span>
            <button
              type="button"
              onClick={() => setProductAddModalOpen(true)}
              className="flex items-center gap-1 rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-0.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 hover:border-[#4a38f5]/30 transition-colors cursor-pointer shadow-2xs"
              title="Добавить новый товар в сделку и на склад"
            >
              <Plus className="h-3 w-3" /> Добавить товар
            </button>
            <span className="flex items-center gap-1 rounded-[4px] bg-[#f0f0f0] px-2 py-0.5 text-[11px] text-[#666666]">
              <Boxes className="h-3 w-3 text-[#4a38f5]" /> Списание FIFO со склада
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#e5e5e5] bg-[#fafafa]">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider">
                  Товар
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[120px]">
                  Артикул
                </th>
                <th className="px-4 py-2.5 text-center text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[70px]">
                  Кол-во
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[110px]">
                  Розница
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[105px]">
                  Закупка
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold text-[#666666] uppercase tracking-wider w-[90px]">
                  Наценка
                </th>
                <th className="px-4 py-2.5 w-[150px] text-right" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f0f0f0]">
              {productItems.map((item) => {
                const isFromRepair = item.id.startsWith("repair-");
                const isDirectProduct = !isFromRepair;
                const itemTotalRetail = item.totalAmount;
                const itemTotalCost = (item.costPrice ?? 0) * item.quantity;
                const margin = itemTotalRetail - itemTotalCost;
                const markupPct = itemTotalCost > 0 ? Math.round((margin / itemTotalCost) * 100) : 0;

                const whItem =
                  isDirectProduct && item.itemId ? warehouseMap.get(item.itemId) : null;
                const hasActivePurchase = Boolean(
                  item.purchaseRequestStatus && item.purchaseRequestStatus !== "cancelled",
                );
                const isOutOfStock =
                  isDirectProduct &&
                  !item.consumedAt &&
                  (!whItem || (whItem.availableStock ?? 0) < item.quantity);

                return (
                  <tr key={item.id} className="transition-colors hover:bg-[#f5f5f5]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-[13px] font-medium text-[#111111]">{item.name}</p>
                        {isDirectProduct && item.itemId && (
                          <span className="inline-flex items-center rounded-[4px] bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700 border border-sky-200">
                            Склад
                          </span>
                        )}
                        {isFromRepair && (
                          <span className="inline-flex items-center rounded-[4px] bg-[#f5f5f5] px-1.5 py-0.5 text-[10px] font-medium text-[#666666] border border-[#e5e5e5]">
                            Из наряда
                          </span>
                        )}
                        {isDirectProduct && item.consumedAt && (
                          <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                            <Check className="h-2.5 w-2.5" />
                            Списано FIFO
                          </span>
                        )}
                        {isDirectProduct && item.costSource === "pending_purchase" && (
                          <span className="inline-flex items-center gap-0.5 rounded-[4px] bg-amber-50 border border-amber-200 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <ShoppingCart className="h-2.5 w-2.5" />
                            Ожидает закупку
                          </span>
                        )}
                        {isDirectProduct &&
                          item.purchaseRequestStatus &&
                          item.costSource !== "pending_purchase" && (
                            <span className="inline-flex items-center rounded-[4px] bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-[#4a38f5]">
                              Заявка:{" "}
                              {item.purchaseRequestStatus === "received"
                                ? "поступило"
                                : item.purchaseRequestStatus === "ordered"
                                  ? "заказано"
                                  : "в ожидании"}
                            </span>
                          )}
                      </div>
                      {item.batchAllocations && item.batchAllocations.length > 0 && (
                        <div className="mt-0.5 text-[10px] font-mono text-[#666666]">
                          {item.batchAllocations
                            .map((a) => `${a.batchNumber || "Партия"}: ${a.quantity}×${formatRub(a.unitCost)}`)
                            .join(" + ")}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-mono text-[#666666]">
                        {item.sku || "Б/А"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[13px] font-mono text-[#111111] tabular-nums">
                        {item.quantity} {item.unit || "шт"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingPriceItemId === item.id ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <input
                            type="number"
                            min={0}
                            step="any"
                            value={editingPriceValue}
                            onChange={(e) => setEditingPriceValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void handleSaveEditPrice(item);
                              } else if (e.key === "Escape") {
                                handleCancelEditPrice();
                              }
                            }}
                            autoFocus
                            className="w-[74px] rounded-[6px] border border-[#4a38f5] bg-white px-1.5 py-0.5 text-right text-xs font-mono text-[#111111] focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void handleSaveEditPrice(item)}
                            disabled={savingPriceItemId === item.id}
                            className="rounded p-0.5 text-emerald-600 hover:bg-emerald-50 cursor-pointer"
                            title="Сохранить"
                          >
                            {savingPriceItemId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Check className="h-3.5 w-3.5" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={handleCancelEditPrice}
                            className="rounded p-0.5 text-[#888888] hover:bg-[#f0f0f0] cursor-pointer"
                            title="Отмена"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="inline-flex items-center justify-end gap-1 group">
                          <span className="text-[13px] font-mono font-semibold text-[#111111] tabular-nums">
                            {formatRub(itemTotalRetail)}
                          </span>
                          {isDirectProduct && (
                            <button
                              type="button"
                              onClick={() => handleStartEditPrice(item)}
                              className="rounded p-0.5 text-[#888888] opacity-0 group-hover:opacity-100 hover:text-[#4a38f5] hover:bg-[#f0f0f0] transition-all cursor-pointer"
                              title="Изменить розничную цену"
                            >
                              <Pencil className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-[13px] font-mono text-[#666666] tabular-nums">
                        {itemTotalCost > 0 ? formatRub(itemTotalCost) : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {itemTotalCost > 0 ? (
                        <span
                          className={cn(
                            "text-xs font-mono font-medium tabular-nums",
                            margin >= 0 ? "text-emerald-700" : "text-rose-600",
                          )}
                        >
                          {margin >= 0 ? `+${markupPct}%` : `${markupPct}%`}
                        </span>
                      ) : (
                        <span className="text-xs text-[#cccccc]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center justify-end gap-1">
                        {isDirectProduct && !hasActivePurchase && isOutOfStock && (
                          <button
                            type="button"
                            onClick={() => void handleQuickPurchaseRequest(item)}
                            disabled={requestingId === item.id}
                            className="inline-flex items-center gap-1 rounded-[6px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100 transition-colors cursor-pointer disabled:opacity-40"
                            title="Сформировать заявку на закупку (нет в наличии)"
                          >
                            {requestingId === item.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-3 w-3 text-amber-700" />
                            )}
                            Для заказа
                          </button>
                        )}
                        {isDirectProduct && !hasActivePurchase && !isOutOfStock && (
                          <button
                            type="button"
                            onClick={() => void handleQuickPurchaseRequest(item)}
                            disabled={requestingId === item.id}
                            className="rounded p-1 text-[#888888] hover:text-[#4a38f5] hover:bg-[#f0f0f0] transition-colors cursor-pointer disabled:opacity-40"
                            title="Создать заявку на закупку"
                          >
                            {requestingId === item.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <ShoppingCart className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                        {isDirectProduct && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteItem(item.id, item.name)}
                            disabled={deletingId === item.id}
                            aria-label={`Удалить товар ${item.name}`}
                            className="rounded p-1 text-[#888888] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer disabled:opacity-40"
                            title="Удалить товар"
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
              {productItems.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center">
                    <p className="text-xs text-[#888888]">Товары пока не добавлены.</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Always-visible Add Product Row (exact PartsTable pattern) */}
        <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 space-y-2">
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {/* Warehouse Autocomplete Combobox */}
            <div ref={whComboboxRef} className="relative flex-1 min-w-[200px]">
              <div className="relative">
                <input
                  type="text"
                  role="combobox"
                  aria-expanded={whCatalogOpen}
                  aria-controls="deal-warehouse-listbox"
                  aria-autocomplete="list"
                  value={prodName}
                  onChange={(e) => {
                    setProdName(e.target.value);
                    setSelectedWarehouseItem(null);
                    setWhCatalogOpen(true);
                  }}
                  onFocus={() => setWhCatalogOpen(true)}
                  onKeyDown={handleProdKeyDown}
                  placeholder="Поиск по складу или название товара..."
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-3 pr-8 text-[13px] text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
                />
                <Boxes className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
              </div>

              {whCatalogOpen && (
                <div
                  id="deal-warehouse-listbox"
                  role="listbox"
                  className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-[8px] border border-[#e5e5e5] bg-white p-1 shadow-lg"
                >
                  <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-[#888888] uppercase tracking-wider">
                    <span>Номенклатура склада</span>
                    <span className="font-mono font-normal normal-case text-[10px]">
                      Найдено: {filteredWarehouseItems.length}
                    </span>
                  </div>

                  {isWarehouseLoading && (
                    <div className="flex items-center justify-center py-3 text-xs text-[#888888]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> Загрузка остатков...
                    </div>
                  )}

                  {!isWarehouseLoading && isWarehouseError && (
                    <div className="px-2.5 py-2 text-xs text-rose-600">
                      Не удалось загрузить номенклатуру склада.
                    </div>
                  )}

                  {!isWarehouseLoading && !isWarehouseError && filteredWarehouseItems.length > 0 && (
                    <div className="space-y-0.5">
                      {filteredWarehouseItems.slice(0, MAX_WAREHOUSE_DROPDOWN_ITEMS).map((wi) => {
                        const isOutOfStock = wi.availableStock <= 0;
                        const effectiveCost = wi.fifoCostPrice ?? wi.costPrice ?? 0;
                        const margin = (wi.retailPrice ?? 0) - effectiveCost;
                        const markupPct =
                          effectiveCost > 0 ? Math.round((margin / effectiveCost) * 100) : 0;
                        return (
                          <button
                            key={wi.id}
                            type="button"
                            onClick={() => handleSelectWarehouseItem(wi)}
                            className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-[#fafafa] cursor-pointer"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <span className="font-medium text-[#111111] truncate block">
                                {wi.name}
                              </span>
                              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[#888888]">
                                {wi.sku && <span className="font-mono">{wi.sku}</span>}
                                {wi.brand && (
                                  <span>
                                    {wi.sku ? "· " : ""}
                                    {wi.brand}
                                  </span>
                                )}
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
                                  Закупка{(wi.activeBatchesCount ?? 0) > 0 ? " FIFO" : ""}:{" "}
                                  {formatRub(effectiveCost)}
                                </span>
                                {margin > 0 && effectiveCost > 0 && (
                                  <span className="text-emerald-700 font-medium">
                                    Наценка: +{markupPct}%
                                  </span>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                      {filteredWarehouseItems.length > MAX_WAREHOUSE_DROPDOWN_ITEMS && (
                        <div className="px-2.5 py-1.5 text-[11px] text-[#888888] border-t border-[#f0f0f0]">
                          Показаны первые {MAX_WAREHOUSE_DROPDOWN_ITEMS} из{" "}
                          {filteredWarehouseItems.length} позиций — уточните запрос
                        </div>
                      )}
                    </div>
                  )}

                  {!isWarehouseLoading && !isWarehouseError && filteredWarehouseItems.length === 0 && (
                    <div className="p-2 space-y-1.5">
                      <div className="text-xs text-[#888888]">
                        {warehouseItems.length === 0
                          ? "Склад пока пуст. Товар можно добавить вручную или через форму."
                          : "На складе позиций не найдено."}
                      </div>
                      {prodName.trim().length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setWhCatalogOpen(false);
                            setProductAddModalOpen(true);
                          }}
                          className="flex w-full items-center gap-1.5 rounded-[6px] bg-[#4a38f5]/5 border border-[#4a38f5]/20 px-2.5 py-1.5 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/10 transition-colors text-left cursor-pointer"
                        >
                          <Plus className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Добавить «<span className="font-semibold">{prodName.trim()}</span>» через форму
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <input
              type="text"
              value={prodSku}
              onChange={(e) => setProdSku(e.target.value)}
              onKeyDown={handleProdKeyDown}
              placeholder="Артикул"
              className="w-[105px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2.5 text-[13px] font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20"
            />
            <input
              type="number"
              min={0.01}
              step="any"
              value={prodQty}
              onChange={(e) => {
                const val = e.target.value;
                setProdQty(val);
                if (selectedWarehouseItem) {
                  const q = parsePositiveNumber(val) || 1;
                  setProdAddToPurchase((selectedWarehouseItem.availableStock ?? 0) < q);
                }
              }}
              onKeyDown={handleProdKeyDown}
              placeholder="1"
              title="Количество"
              className="w-[58px] rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 px-2 text-[13px] text-center font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <div className="relative w-[108px]">
              <input
                type="number"
                min={0}
                step={1}
                value={prodRetail}
                onChange={(e) => setProdRetail(e.target.value)}
                onKeyDown={handleProdKeyDown}
                placeholder="0"
                title="Розничная цена"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-2 pr-12 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#888888]">
                ₽ розн.
              </span>
            </div>
            <div className="relative w-[108px]">
              <input
                type="number"
                min={0}
                step={1}
                value={prodCost}
                onChange={(e) => setProdCost(e.target.value)}
                onKeyDown={handleProdKeyDown}
                placeholder="0"
                title="Себестоимость (закупка)"
                className="w-full rounded-[8px] border border-[#e5e5e5] bg-white py-1.5 pl-2 pr-11 text-[13px] text-right font-mono text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none focus:ring-1 focus:ring-[#4a38f5]/20 [-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[#888888]">
                ₽ зак.
              </span>
            </div>
            <button
              type="button"
              onClick={() => void handleAddProduct()}
              disabled={!canAddProduct}
              aria-label="Добавить товар в сделку"
              title="Добавить товар в сделку"
              className={cn(
                "shrink-0 rounded-[8px] p-2 transition-colors",
                canAddProduct
                  ? "bg-[#4a38f5] text-white hover:bg-[#3d2ee0] cursor-pointer"
                  : "bg-[#f0f0f0] text-[#888888] cursor-not-allowed",
              )}
            >
              {addItemMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Stock Status & Purchase Checkbox (exact PartsTable pattern) */}
          {selectedWarehouseItem ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-[6px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs">
              <div className="flex items-center gap-2">
                {!isProdStockDeficit ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                    <span className="text-[#111111]">
                      В наличии на складе: <b>{selectedWarehouseItem.availableStock}</b>{" "}
                      {selectedWarehouseItem.unit}
                    </span>
                  </>
                ) : (
                  <>
                    <AlertCircle
                      className={cn(
                        "h-3.5 w-3.5 shrink-0",
                        allowNegativeStock ? "text-amber-600" : "text-rose-600",
                      )}
                    />
                    <span
                      className={cn(
                        "font-medium",
                        allowNegativeStock ? "text-amber-800" : "text-rose-800",
                      )}
                    >
                      Недостаточно на складе: доступно{" "}
                      <b>{selectedWarehouseItem.availableStock}</b> {selectedWarehouseItem.unit}
                      {prodShortage > 0 ? ` (не хватает ${prodShortage})` : ""}
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs text-[#111111] select-none hover:text-[#4a38f5] transition-colors">
                  <input
                    type="checkbox"
                    checked={prodAddToPurchase}
                    onChange={(e) => setProdAddToPurchase(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                  />
                  <span className="text-xs font-medium">В заявку на закупку</span>
                </label>

                {isProdStockDeficit && (
                  <button
                    type="button"
                    onClick={() => void handleCreatePurchaseFromDraft()}
                    disabled={addItemMutation.isPending}
                    title="Добавить товар в сделку и создать привязанную заявку на закупку"
                    className="flex items-center gap-1.5 rounded-[4px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <ShoppingCart className="h-3 w-3" />
                    Добавить и в закупку
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-4 pt-0.5">
              <label className="flex items-center gap-2 cursor-pointer text-xs text-[#111111] select-none hover:text-[#4a38f5] transition-colors">
                <input
                  type="checkbox"
                  checked={prodAddToPurchase}
                  onChange={(e) => setProdAddToPurchase(e.target.checked)}
                  className="h-3.5 w-3.5 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                />
                <span className="font-medium">В заявку на закупку</span>
              </label>

              {prodName.trim().length > 0 && (
                <label className="flex items-center gap-2 cursor-pointer text-xs text-[#111111] select-none hover:text-[#4a38f5] transition-colors">
                  <input
                    type="checkbox"
                    checked={prodSaveToCatalog}
                    onChange={(e) => setProdSaveToCatalog(e.target.checked)}
                    className="h-3.5 w-3.5 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5] cursor-pointer"
                  />
                  <span className="font-medium">Сохранить в номенклатуру склада</span>
                </label>
              )}
            </div>
          )}
        </div>

        {productItems.length > 0 && (
          <div className="border-t border-[#e5e5e5] bg-[#fafafa] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-4 text-[#666666]">
              <span>
                Закупка:{" "}
                <b className="font-mono text-[#111111]">{formatRub(stats.productsCostSum)}</b>
              </span>
              <span>
                Маржа:{" "}
                <b className="font-mono text-emerald-700">{formatRub(stats.productsProfit)}</b>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[#666666]">Итого розница:</span>
              <span className="text-sm font-bold text-[#111111] font-mono tabular-nums">
                {formatRub(stats.productsSum)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* BLOCK 3: ЗАЯВКИ НА ЗАКУПКУ ПО СДЕЛКЕ                                  */}
      {/* ===================================================================== */}
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
              href="/warehouse?section=purchases"
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
              const canDeletePr = pr.status === "pending" && !pr.supplierOrderId;
              return (
                <div key={pr.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                  <div className="min-w-0">
                    <span className="font-medium text-[#111111]">{pr.itemName}</span>
                    {pr.sku && (
                      <span className="ml-1.5 font-mono text-[11px] text-[#888888]">{pr.sku}</span>
                    )}
                    {pr.comment && <p className="text-[11px] text-[#666666]">{pr.comment}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono font-medium text-[#111111]">
                      {pr.quantity} {pr.unit}
                    </span>
                    <span
                      className={cn(
                        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                        badge.cls,
                      )}
                    >
                      {badge.label}
                    </span>
                    {canDeletePr && (
                      <button
                        type="button"
                        onClick={() => void handleDeletePurchaseRequest(pr.id, pr.itemName)}
                        disabled={deletingPrId === pr.id}
                        title="Удалить заявку на закупку"
                        aria-label={`Удалить заявку ${pr.itemName}`}
                        className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-[#888888] hover:bg-rose-50 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {deletingPrId === pr.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Dialogs reused from Service Center */}
      <ServiceCatalogDialog
        open={isServiceCatalogDialogOpen}
        onClose={() => setIsServiceCatalogDialogOpen(false)}
        onSelectServices={handleAddServicesFromDialog}
        isSubmittingMultiple={isSubmittingServicesBatch}
        catalogSource="services"
        subtitle="Каталог типовых услуг и базовых цен"
      />

      {/* Единая каноническая модалка создания услуги из /warehouse */}
      <CreateOrEditServiceModal
        open={createServiceModalOpen}
        onClose={() => setCreateServiceModalOpen(false)}
        initialName={svcDesc.trim()}
        initialPrice={svcUnitPrice || svcTotal}
        onCreated={handleServiceCreatedInCatalog}
      />

      <DealProductAddModal
        open={productAddModalOpen}
        onClose={() => setProductAddModalOpen(false)}
        dealId={deal.id}
        initialName={prodName}
        initialSku={prodSku}
        onSuccess={() => {
          setProdName("");
          setProdSku("");
          setProdQty("1");
          setProdRetail("");
          setProdCost("");
          setSelectedWarehouseItem(null);
          setProdAddToPurchase(false);
          setProdSaveToCatalog(false);
        }}
      />
    </div>
  );
}
