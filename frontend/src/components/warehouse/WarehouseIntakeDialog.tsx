"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  X,
  Loader2,
  ArrowDownToLine,
  Building2,
  Plus,
  Trash2,
  Package,
  Boxes,
  Receipt,
  CreditCard,
  CheckCircle2,
  Clock,
  Search,
  Check,
  Calendar,
  FileText,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { toast } from "sonner";
import {
  useWarehouseItems,
  useSupplierOrders,
  useIntakeWarehouseDocument,
  type WarehouseItemDTO,
  type SupplierOrderDTO,
  type IntakeDocumentBasis,
  type IntakeDocumentPayload,
} from "@/lib/api/use-warehouse";
import { useCompanies, useCreateCompany, type CompanyDTO } from "@/lib/api/use-companies";
import { useAccounts } from "@/lib/api/use-invoices";
import { formatRub } from "@/lib/utils/format";
import { cn } from "@/lib/utils";

export interface WarehouseIntakeDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialSupplierOrderId?: string | null;
  initialItem?: WarehouseItemDTO | null;
  purchaseRequestId?: string | null;
  initialName?: string;
  initialSku?: string;
  initialQty?: number;
  initialPrice?: number;
}

interface IntakeTableRow {
  id: string;
  itemId?: string;
  name: string;
  sku: string;
  category: string;
  unit: string;
  quantity: string;
  purchasePrice: string;
  retailPrice: string;
  batchNumber: string;
}

export function WarehouseIntakeDialog({
  open,
  onClose,
  onSuccess,
  initialSupplierOrderId,
  initialItem,
  purchaseRequestId,
  initialName = "",
  initialSku = "",
  initialQty = 1,
  initialPrice = 0,
}: WarehouseIntakeDialogProps) {
  // 1. Шапка документа
  const [basis, setBasis] = useState<IntakeDocumentBasis>("direct_purchase");
  const [docNumber, setDocNumber] = useState("");
  const [incomingDocNumber, setIncomingDocNumber] = useState("");
  const [docDate, setDocDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");

  // 2. Поставщик / Заказ поставщику
  const [selectedSupplierOrderId, setSelectedSupplierOrderId] = useState<string>("");
  const [selectedCompany, setSelectedCompany] = useState<CompanyDTO | null>(null);
  const [supplierInput, setSupplierInput] = useState("");
  const [isCompanyDropdownOpen, setIsCompanyDropdownOpen] = useState(false);
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);
  const [newCompanyInn, setNewCompanyInn] = useState("");
  const [newCompanyPhone, setNewCompanyPhone] = useState("");

  // 3. Табличная часть
  const [rows, setRows] = useState<IntakeTableRow[]>([]);

  // 4. Финансовый контур
  const [recordFinanceExpense, setRecordFinanceExpense] = useState(false);
  const [cashAccountId, setCashAccountId] = useState("");
  const [paymentComment, setPaymentComment] = useState("");

  // 5. Модалка выбора из номенклатуры каталога
  const [isCatalogPickerOpen, setIsCatalogPickerOpen] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [selectedCatalogItemIds, setSelectedCatalogItemIds] = useState<Set<string>>(new Set());

  // Хуки API
  const { data: allWarehouseItems = [], isLoading: isItemsLoading } = useWarehouseItems();
  const { data: supplierOrders = [], isLoading: isSupplierOrdersLoading } = useSupplierOrders();
  const { data: companiesData } = useCompanies({
    search: supplierInput.trim() || undefined,
    limit: 50,
  });
  const { data: accounts = [] } = useAccounts();
  const createCompanyMutation = useCreateCompany();
  const intakeMutation = useIntakeWarehouseDocument();

  // Реф для клика снаружи дропдауна компании
  const companyDropdownRef = useRef<HTMLDivElement>(null);

  // Выбранный заказ поставщику
  const selectedOrder = useMemo(() => {
    if (!selectedSupplierOrderId) return null;
    return supplierOrders.find((o) => o.id === selectedSupplierOrderId) ?? null;
  }, [supplierOrders, selectedSupplierOrderId]);

  // Заказ уже оплачен через кассу?
  const isOrderAlreadyPaid = Boolean(selectedOrder?.paidAt || selectedOrder?.status === "paid");

  // Генерация номера при смене основания
  const generatePrefixNumber = (b: IntakeDocumentBasis) => {
    const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const rand = Math.floor(100 + Math.random() * 900);
    switch (b) {
      case "initial_balance":
        return `НАЧ-${dateStr}-${rand}`;
      case "inventory_adjustment":
        return `ИЗЛ-${dateStr}-${rand}`;
      case "supplier_order":
        return selectedOrder ? selectedOrder.orderNumber : `ПХ-${dateStr}-${rand}`;
      case "direct_purchase":
      default:
        return `ПХ-${dateStr}-${rand}`;
    }
  };

  // Инициализация при открытии
  useEffect(() => {
    if (!open) return;

    if (initialSupplierOrderId) {
      setBasis("supplier_order");
      setSelectedSupplierOrderId(initialSupplierOrderId);
    } else if (initialItem || purchaseRequestId || initialName) {
      setBasis("direct_purchase");
      setSelectedSupplierOrderId("");
      const singleRow: IntakeTableRow = {
        id: String(Date.now()),
        itemId: initialItem?.id,
        name: initialItem?.name || initialName,
        sku: initialItem?.sku || initialSku,
        category: initialItem?.category || "Запчасти",
        unit: initialItem?.unit || "шт",
        quantity: String(initialQty || 1),
        purchasePrice: String(initialItem?.costPrice || initialPrice || ""),
        retailPrice: initialItem?.retailPrice ? String(initialItem.retailPrice) : "",
        batchNumber: "",
      };
      setRows([singleRow]);
    } else {
      setBasis("direct_purchase");
      setSelectedSupplierOrderId("");
      setRows([
        {
          id: String(Date.now()),
          name: "",
          sku: "",
          category: "Запчасти",
          unit: "шт",
          quantity: "1",
          purchasePrice: "",
          retailPrice: "",
          batchNumber: "",
        },
      ]);
    }

    setDocDate(new Date().toISOString().slice(0, 10));
    setIncomingDocNumber("");
    setNotes("");
    setSupplierInput("");
    setSelectedCompany(null);
    setIsCreatingCompany(false);
    setRecordFinanceExpense(false);
    setPaymentComment("");

    if (accounts.length > 0) {
      const def = accounts.find((a) => a.isDefault) ?? accounts[0];
      setCashAccountId(def.id);
    }
  }, [open, initialSupplierOrderId, initialItem, purchaseRequestId, initialName, initialSku, initialQty, initialPrice, accounts]);

  // Обновление номера документа при смене основания
  useEffect(() => {
    if (open) {
      setDocNumber(generatePrefixNumber(basis));
    }
  }, [basis, selectedOrder, open]);

  // Если выбран заказ поставщику — загружаем из него данные и товары
  useEffect(() => {
    if (basis === "supplier_order" && selectedOrder) {
      setSupplierInput(selectedOrder.supplierName);
      if (selectedOrder.supplierCompanyId) {
        setSelectedCompany({
          id: selectedOrder.supplierCompanyId,
          name: selectedOrder.supplierName,
        } as CompanyDTO);
      }

      if (selectedOrder.items && selectedOrder.items.length > 0) {
        const orderRows: IntakeTableRow[] = selectedOrder.items.map((it, idx) => ({
          id: `${selectedOrder.id}-${idx}`,
          itemId: it.itemId || undefined,
          name: it.itemName,
          sku: it.sku || "",
          category: "Запчасти",
          unit: it.unit || "шт",
          quantity: String(it.quantity || 1),
          purchasePrice: String(it.price || 0),
          retailPrice: it.price ? String(Math.round(Number(it.price) * 1.4)) : "",
          batchNumber: selectedOrder.orderNumber,
        }));
        setRows(orderRows);
      }
    }
  }, [basis, selectedOrder]);

  // Закрытие дропдауна компании при клике вне
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (companyDropdownRef.current && !companyDropdownRef.current.contains(e.target as Node)) {
        setIsCompanyDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Итоги таблицы
  const totals = useMemo(() => {
    let totalQty = 0;
    let totalSum = 0;
    for (const r of rows) {
      const q = parseFloat(r.quantity) || 0;
      const p = parseFloat(r.purchasePrice) || 0;
      totalQty += q;
      totalSum += q * p;
    }
    return {
      rowCount: rows.length,
      totalQty,
      totalSum,
    };
  }, [rows]);

  if (!open) return null;

  // Управление строками таблицы
  const handleAddRow = () => {
    setRows((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        name: "",
        sku: "",
        category: "Запчасти",
        unit: "шт",
        quantity: "1",
        purchasePrice: "",
        retailPrice: "",
        batchNumber: "",
      },
    ]);
  };

  const handleRemoveRow = (rowId: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== rowId) : prev));
  };

  const handleRowChange = (rowId: string, field: keyof IntakeTableRow, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        return { ...r, [field]: value };
      }),
    );
  };

  const handleSelectWarehouseItemForRow = (rowId: string, item: WarehouseItemDTO) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== rowId) return r;
        return {
          ...r,
          itemId: item.id,
          name: item.name,
          sku: item.sku || "",
          category: item.category || "Запчасти",
          unit: item.unit || "шт",
          purchasePrice: item.costPrice > 0 ? String(item.costPrice) : r.purchasePrice,
          retailPrice: item.retailPrice > 0 ? String(item.retailPrice) : r.retailPrice,
        };
      }),
    );
  };

  // Быстрое добавление нескольких позиций из каталога
  const handleApplyCatalogSelection = () => {
    const selectedItems = allWarehouseItems.filter((it) => selectedCatalogItemIds.has(it.id));
    if (selectedItems.length > 0) {
      const newRows: IntakeTableRow[] = selectedItems.map((it) => ({
        id: String(Date.now() + Math.random()),
        itemId: it.id,
        name: it.name,
        sku: it.sku || "",
        category: it.category || "Запчасти",
        unit: it.unit || "шт",
        quantity: "1",
        purchasePrice: it.costPrice > 0 ? String(it.costPrice) : "",
        retailPrice: it.retailPrice > 0 ? String(it.retailPrice) : "",
        batchNumber: "",
      }));

      // Если в таблице была только 1 пустая строка, заменяем её
      if (rows.length === 1 && !rows[0].name.trim() && !rows[0].itemId) {
        setRows(newRows);
      } else {
        setRows((prev) => [...prev, ...newRows]);
      }
    }
    setIsCatalogPickerOpen(false);
    setSelectedCatalogItemIds(new Set());
    setCatalogSearch("");
  };

  // Быстрое создание компании-поставщика
  const handleQuickCreateCompany = async () => {
    const trimmed = supplierInput.trim();
    if (!trimmed) {
      toast.error("Укажите наименование компании-поставщика");
      return;
    }
    try {
      const created = await createCompanyMutation.mutateAsync({
        name: trimmed,
        inn: newCompanyInn.trim() || undefined,
        phone: newCompanyPhone.trim() || undefined,
      });
      setSelectedCompany(created);
      setSupplierInput(created.name);
      setIsCreatingCompany(false);
      setIsCompanyDropdownOpen(false);
      toast.success(`Поставщик «${created.name}» успешно создан`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось создать поставщика");
    }
  };

  // Отправка формы оприходования
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Валидация строк
    const validItems = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const trimmedName = r.name.trim();
      const qtyNum = parseFloat(r.quantity);
      const priceNum = parseFloat(r.purchasePrice);

      if (!trimmedName) {
        toast.error(`Строка №${i + 1}: укажите наименование товара`);
        return;
      }
      if (isNaN(qtyNum) || qtyNum <= 0) {
        toast.error(`Строка №${i + 1} («${trimmedName}»): количество должно быть больше 0`);
        return;
      }
      if (isNaN(priceNum) || priceNum < 0) {
        toast.error(`Строка №${i + 1} («${trimmedName}»): укажите корректную закупочную цену`);
        return;
      }

      validItems.push({
        item_id: r.itemId || undefined,
        name: trimmedName,
        sku: r.sku.trim() || undefined,
        category: r.category.trim() || undefined,
        unit: r.unit.trim() || "шт",
        quantity: qtyNum,
        purchase_price: priceNum,
        retail_price: r.retailPrice ? parseFloat(r.retailPrice) : undefined,
        batch_number: r.batchNumber.trim() || undefined,
      });
    }

    if (validItems.length === 0) {
      toast.error("Добавьте хотя бы одну позицию для оприходования");
      return;
    }

    // 2. Валидация поставщика для оснований, требующих контрагента
    let finalSupplierName = "";
    if (basis === "supplier_order") {
      if (!selectedSupplierOrderId) {
        toast.error("Выберите заказ поставщику");
        return;
      }
      finalSupplierName = selectedOrder?.supplierName || supplierInput.trim() || "Поставщик";
    } else if (basis === "direct_purchase") {
      finalSupplierName = selectedCompany ? selectedCompany.name : supplierInput.trim();
      if (!finalSupplierName) {
        toast.error("Укажите наименование поставщика");
        return;
      }
    } else if (basis === "initial_balance") {
      finalSupplierName = "Ввод начальных остатков";
    } else if (basis === "inventory_adjustment") {
      finalSupplierName = "Инвентаризация (излишки)";
    }

    // 3. Формирование payload
    const shouldRecordExpense =
      (basis === "direct_purchase" && recordFinanceExpense) ||
      (basis === "supplier_order" && !isOrderAlreadyPaid && recordFinanceExpense);

    const payload: IntakeDocumentPayload = {
      basis,
      supplier_order_id: basis === "supplier_order" ? selectedSupplierOrderId : null,
      supplier_name: finalSupplierName,
      supplier_company_id: selectedCompany?.id ?? null,
      incoming_document_number: incomingDocNumber.trim() || undefined,
      document_date: docDate || undefined,
      notes: notes.trim() || undefined,
      items: validItems,
      record_finance_expense: shouldRecordExpense,
      cash_account_id: shouldRecordExpense ? cashAccountId || undefined : null,
      payment_comment: paymentComment.trim() || undefined,
    };

    try {
      const res = await intakeMutation.mutateAsync(payload);
      toast.success(
        `Оприходование №${res.documentNumber} успешно проведено: создано партий: ${res.batchesCreated}, всего единиц: ${res.totalQuantity}`,
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Не удалось провести оприходование");
    }
  };

  // Фильтрация товаров каталога для модалки множественного выбора
  const filteredCatalogItems = useMemo(() => {
    const q = catalogSearch.trim().toLowerCase();
    if (!q) return allWarehouseItems;
    return allWarehouseItems.filter(
      (it) =>
        it.name.toLowerCase().includes(q) ||
        (it.sku && it.sku.toLowerCase().includes(q)) ||
        (it.category && it.category.toLowerCase().includes(q)),
    );
  }, [allWarehouseItems, catalogSearch]);

  const toggleCatalogItem = (id: string) => {
    setSelectedCatalogItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-4 backdrop-blur-xs animate-in fade-in-0 duration-150">
      <div className="w-full max-w-5xl rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl max-h-[94vh] flex flex-col overflow-hidden text-[13px]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-3.5 border-b border-[#e5e5e5] bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4a38f5]/10 text-[#4a38f5] border border-[#4a38f5]/20">
              <ArrowDownToLine className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-[#111111]">
                  Оприходование на склад
                </h2>
                <span className="font-mono text-xs text-[#888888] font-medium px-2 py-0.5 rounded bg-[#f5f5f5] border border-[#e5e5e5]">
                  {docNumber || "Новый документ"}
                </span>
              </div>
              <p className="text-xs text-[#666666]">
                Формирование приходной накладной, оприходование партий и связь с кассой
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[#888888] hover:bg-[#fafafa] hover:text-[#111111] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 1. Блок оснований документа (Pills) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-[#111111]">
              Основание документа / Вид поступления <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                onClick={() => setBasis("direct_purchase")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] border text-xs font-medium transition-all text-left cursor-pointer",
                  basis === "direct_purchase"
                    ? "bg-[#4a38f5]/10 border-[#4a38f5] text-[#4a38f5] font-semibold"
                    : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]",
                )}
              >
                <Package className="h-4 w-4 shrink-0" />
                <div className="truncate">
                  <div>Прямое поступление</div>
                  <div className="text-[10px] opacity-70">Закупка у поставщика</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBasis("supplier_order")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] border text-xs font-medium transition-all text-left cursor-pointer",
                  basis === "supplier_order"
                    ? "bg-[#4a38f5]/10 border-[#4a38f5] text-[#4a38f5] font-semibold"
                    : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]",
                )}
              >
                <Receipt className="h-4 w-4 shrink-0" />
                <div className="truncate">
                  <div>Заказ поставщику</div>
                  <div className="text-[10px] opacity-70">По ранее оформленному</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBasis("initial_balance")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] border text-xs font-medium transition-all text-left cursor-pointer",
                  basis === "initial_balance"
                    ? "bg-[#4a38f5]/10 border-[#4a38f5] text-[#4a38f5] font-semibold"
                    : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]",
                )}
              >
                <Boxes className="h-4 w-4 shrink-0" />
                <div className="truncate">
                  <div>Начальные остатки</div>
                  <div className="text-[10px] opacity-70">Без списания кассы</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBasis("inventory_adjustment")}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-[8px] border text-xs font-medium transition-all text-left cursor-pointer",
                  basis === "inventory_adjustment"
                    ? "bg-[#4a38f5]/10 border-[#4a38f5] text-[#4a38f5] font-semibold"
                    : "bg-white border-[#e5e5e5] text-[#666666] hover:bg-[#fafafa] hover:text-[#111111]",
                )}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <div className="truncate">
                  <div>Излишки склада</div>
                  <div className="text-[10px] opacity-70">Инвентаризация</div>
                </div>
              </button>
            </div>
          </div>

          {/* Информационные плашки по основаниям */}
          {basis === "initial_balance" && (
            <div className="rounded-[8px] border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900 flex items-start gap-2.5">
              <Boxes className="h-4 w-4 text-sky-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Режим ввода начальных остатков:</span> Фиксирует существующее имущество склада на момент старта учёта. Формируются складские партии FIFO с указанной себестоимостью для корректных списаний в ремонтах. Денежные средства из кассы не расходуются.
              </div>
            </div>
          )}

          {basis === "inventory_adjustment" && (
            <div className="rounded-[8px] border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 flex items-start gap-2.5">
              <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Оприходование излишков:</span> Товары ставятся на баланс по результатам инвентаризации. Денежные средства не расходуются.
              </div>
            </div>
          )}

          {/* 2. Реквизиты документа и выбор поставщика / заказа */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#fbfbfb] p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Дата прихода */}
              <div>
                <label className="block text-xs font-medium text-[#666666] mb-1 flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-[#888888]" />
                  Дата документа
                </label>
                <input
                  type="date"
                  required
                  value={docDate}
                  onChange={(e) => setDocDate(e.target.value)}
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              {/* Номер входящей накладной (УПД/ТТН) */}
              <div>
                <label className="block text-xs font-medium text-[#666666] mb-1 flex items-center gap-1">
                  <FileText className="h-3.5 w-3.5 text-[#888888]" />
                  Входящий номер накладной (УПД / ТТН)
                </label>
                <input
                  type="text"
                  value={incomingDocNumber}
                  onChange={(e) => setIncomingDocNumber(e.target.value)}
                  placeholder="например, УПД-142 от поставщика"
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                />
              </div>

              {/* Склад назначения */}
              <div>
                <label className="block text-xs font-medium text-[#666666] mb-1">
                  Склад поступления
                </label>
                <select
                  disabled
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-[#f5f5f5] px-3 py-1.5 text-xs text-[#111111] cursor-not-allowed"
                >
                  <option value="main">Основной склад сервиса</option>
                </select>
              </div>
            </div>

            {/* Специфика основания: Заказ поставщику */}
            {basis === "supplier_order" && (
              <div className="space-y-2 pt-2 border-t border-[#e5e5e5]">
                <label className="block text-xs font-medium text-[#111111]">
                  Выберите заказ поставщику <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedSupplierOrderId}
                  onChange={(e) => setSelectedSupplierOrderId(e.target.value)}
                  required
                  className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-2 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                >
                  <option value="">-- Выберите заказ из списка --</option>
                  {supplierOrders
                    .filter((o) => o.status !== "cancelled")
                    .map((o) => {
                      const isPaid = Boolean(o.paidAt) || o.status === "paid";
                      return (
                        <option key={o.id} value={o.id}>
                          Заказ №{o.orderNumber} — {o.supplierName} ({formatRub(o.totalAmount)}) [
                          {isPaid ? "Оплачен" : "Ожидает оплаты"}
                          {o.status === "received" ? " / Уже на складе" : ""}]
                        </option>
                      );
                    })}
                </select>

                {selectedOrder && (
                  <div className="rounded-[8px] border border-[#e5e5e5] bg-white p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-[#4a38f5]" />
                      <span className="font-semibold text-[#111111]">{selectedOrder.supplierName}</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-[#666666]">
                        Сумма заказа: <b className="font-mono text-[#111111]">{formatRub(selectedOrder.totalAmount)}</b>
                      </div>
                      {isOrderAlreadyPaid ? (
                        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="h-3 w-3" /> Оплачен через кассу
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                          <Clock className="h-3 w-3" /> Ожидает оплаты
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Специфика основания: Прямое поступление (Выбор компании-поставщика) */}
            {basis === "direct_purchase" && (
              <div className="space-y-1.5 pt-2 border-t border-[#e5e5e5]" ref={companyDropdownRef}>
                <label className="block text-xs font-medium text-[#111111]">
                  Контрагент / Поставщик <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#888888]">
                    <Building2 className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    required
                    value={supplierInput}
                    onChange={(e) => {
                      setSupplierInput(e.target.value);
                      setSelectedCompany(null);
                      setIsCompanyDropdownOpen(true);
                    }}
                    onFocus={() => setIsCompanyDropdownOpen(true)}
                    placeholder="Выберите компанию или начните вводить наименование..."
                    className="w-full rounded-[8px] border border-[#e5e5e5] bg-white pl-9 pr-8 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  />
                  {selectedCompany && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCompany(null);
                        setSupplierInput("");
                      }}
                      className="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[#888888] hover:text-[#111111]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {/* Дропдаун поиска и быстрого создания */}
                  {isCompanyDropdownOpen && (
                    <div className="absolute top-full left-0 right-0 z-30 mt-1 rounded-[8px] border border-[#e5e5e5] bg-white shadow-lg overflow-hidden">
                      {!isCreatingCompany ? (
                        <div className="max-h-56 overflow-y-auto divide-y divide-[#f0f0f0] p-1">
                          {companiesData?.items && companiesData.items.length > 0 ? (
                            companiesData.items.map((comp) => (
                              <button
                                key={comp.id}
                                type="button"
                                onClick={() => {
                                  setSelectedCompany(comp);
                                  setSupplierInput(comp.name);
                                  setIsCompanyDropdownOpen(false);
                                }}
                                className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#fafafa] rounded-[4px] flex items-center justify-between transition-colors cursor-pointer"
                              >
                                <span className="font-medium text-[#111111]">{comp.name}</span>
                                {comp.requisites?.inn && (
                                  <span className="font-mono text-[11px] text-[#888888]">
                                    ИНН {comp.requisites.inn}
                                  </span>
                                )}
                              </button>
                            ))
                          ) : (
                            <div className="px-3 py-2 text-xs text-[#888888] text-center">
                              {supplierInput.trim() ? "Компаний с таким именем не найдено" : "Начните ввод..."}
                            </div>
                          )}

                          <button
                            type="button"
                            onClick={() => setIsCreatingCompany(true)}
                            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#4a38f5] hover:bg-[#4a38f5]/5 rounded-[4px] transition-colors cursor-pointer"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Создать нового поставщика «{supplierInput.trim() || "нового"}»
                          </button>
                        </div>
                      ) : (
                        <div className="p-3 bg-[#fafafa] space-y-2.5">
                          <div className="text-xs font-semibold text-[#111111]">
                            Быстрое создание контрагента-поставщика
                          </div>
                          <div>
                            <input
                              type="text"
                              value={supplierInput}
                              onChange={(e) => setSupplierInput(e.target.value)}
                              placeholder="Название компании *"
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input
                              type="text"
                              value={newCompanyInn}
                              onChange={(e) => setNewCompanyInn(e.target.value)}
                              placeholder="ИНН (опционально)"
                              className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            />
                            <input
                              type="text"
                              value={newCompanyPhone}
                              onChange={(e) => setNewCompanyPhone(e.target.value)}
                              placeholder="Телефон (опционально)"
                              className="rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setIsCreatingCompany(false)}
                              className="px-2.5 py-1 rounded-[6px] text-xs font-medium text-[#666666] hover:bg-[#f0f0f0]"
                            >
                              Отмена
                            </button>
                            <button
                              type="button"
                              onClick={handleQuickCreateCompany}
                              disabled={createCompanyMutation.isPending || !supplierInput.trim()}
                              className="px-3 py-1 rounded-[6px] bg-[#4a38f5] text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50"
                            >
                              {createCompanyMutation.isPending ? "Создание..." : "Создать и выбрать"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Табличная часть: Товары прихода */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-[#111111]">
                  Позиции поступления
                </span>
                <span className="text-xs text-[#888888]">({rows.length})</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCatalogPickerOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1 text-xs font-medium text-[#111111] hover:bg-[#fafafa] shadow-2xs transition-colors cursor-pointer"
                >
                  <FolderOpen className="h-3.5 w-3.5 text-[#4a38f5]" />
                  Выбрать из каталога
                </button>
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1 rounded-[6px] bg-[#4a38f5] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#3d2ee0] shadow-xs transition-colors cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Добавить строку
                </button>
              </div>
            </div>

            {/* Таблица */}
            <div className="rounded-xl border border-[#e5e5e5] bg-white overflow-hidden shadow-2xs">
              <div className="overflow-x-auto max-h-[380px]">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-[#fafafa] border-b border-[#e5e5e5] text-[#666666] font-medium sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2 w-10 text-center">№</th>
                      <th className="px-3 py-2 min-w-[220px]">Товар / Номенклатура *</th>
                      <th className="px-2 py-2 w-28">Артикул</th>
                      <th className="px-2 py-2 w-20">Ед. изм.</th>
                      <th className="px-2 py-2 w-24">Кол-во *</th>
                      <th className="px-2 py-2 w-28">Закупка (₽) *</th>
                      <th className="px-2 py-2 w-28">Сумма (₽)</th>
                      <th className="px-2 py-2 w-28">Розница (₽)</th>
                      <th className="px-2 py-2 w-10 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0f0f0]">
                    {rows.map((row, idx) => {
                      const qty = parseFloat(row.quantity) || 0;
                      const price = parseFloat(row.purchasePrice) || 0;
                      const sum = qty * price;

                      return (
                        <tr key={row.id} className="hover:bg-[#fbfbfb] transition-colors">
                          <td className="px-3 py-1.5 text-center text-[#888888] font-mono">
                            {idx + 1}
                          </td>

                          {/* Наименование + автодополнение */}
                          <td className="px-3 py-1.5">
                            <div className="relative">
                              <input
                                type="text"
                                required
                                value={row.name}
                                onChange={(e) => handleRowChange(row.id, "name", e.target.value)}
                                placeholder="Введите название или выберите..."
                                list={`items-datalist-${row.id}`}
                                className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] placeholder:text-[#aaaaaa] focus:border-[#4a38f5] focus:outline-none"
                              />
                              <datalist id={`items-datalist-${row.id}`}>
                                {allWarehouseItems.map((it) => (
                                  <option key={it.id} value={it.name}>
                                    {it.sku ? `[${it.sku}] ` : ""}Остаток: {it.availableStock} {it.unit}
                                  </option>
                                ))}
                              </datalist>
                            </div>
                          </td>

                          {/* Артикул */}
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={row.sku}
                              onChange={(e) => handleRowChange(row.id, "sku", e.target.value)}
                              placeholder="Артикул"
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] placeholder:text-[#aaaaaa] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </td>

                          {/* Ед. изм. */}
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              value={row.unit}
                              onChange={(e) => handleRowChange(row.id, "unit", e.target.value)}
                              placeholder="шт"
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                            />
                          </td>

                          {/* Количество */}
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              required
                              value={row.quantity}
                              onChange={(e) => handleRowChange(row.id, "quantity", e.target.value)}
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none text-right"
                            />
                          </td>

                          {/* Закупка (₽) */}
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              required
                              value={row.purchasePrice}
                              onChange={(e) => handleRowChange(row.id, "purchasePrice", e.target.value)}
                              placeholder="0"
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none text-right"
                            />
                          </td>

                          {/* Сумма (₽) */}
                          <td className="px-2 py-1.5 text-right font-mono font-medium text-[#111111]">
                            {formatRub(sum)}
                          </td>

                          {/* Розница (₽) */}
                          <td className="px-2 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={row.retailPrice}
                              onChange={(e) => handleRowChange(row.id, "retailPrice", e.target.value)}
                              placeholder="0"
                              className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-mono text-[#111111] focus:border-[#4a38f5] focus:outline-none text-right"
                            />
                          </td>

                          {/* Удалить */}
                          <td className="px-2 py-1.5 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveRow(row.id)}
                              disabled={rows.length <= 1}
                              className="p-1 rounded text-[#888888] hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 transition-colors cursor-pointer"
                              title="Удалить строку"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Итоги под таблицей */}
              <div className="bg-[#fbfbfb] px-4 py-2.5 border-t border-[#e5e5e5] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="text-[#666666] flex items-center gap-3">
                  <span>Позиций: <b className="text-[#111111]">{totals.rowCount}</b></span>
                  <span>•</span>
                  <span>Всего единиц: <b className="font-mono text-[#111111]">{totals.totalQty}</b></span>
                </div>

                <div className="text-right">
                  <span className="text-[#888888] mr-2">Итого к приходу:</span>
                  <span className="font-mono text-base font-bold text-[#111111]">
                    {formatRub(totals.totalSum)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Блок оплаты через кассу / ДДС */}
          {basis !== "initial_balance" && basis !== "inventory_adjustment" && (
            <div className="rounded-xl border border-[#e5e5e5] bg-[#fafafa] p-4 space-y-3">
              {basis === "supplier_order" && isOrderAlreadyPaid ? (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    Заказ №{selectedOrder?.orderNumber} уже оплачен через кассу. Повторное кассовое списание не требуется.
                  </span>
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={recordFinanceExpense}
                      onChange={(e) => setRecordFinanceExpense(e.target.checked)}
                      className="h-4 w-4 rounded-[4px] border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                    />
                    <span className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                      <CreditCard className="h-4 w-4 text-[#4a38f5]" />
                      Списать оплату из кассы / счёта сейчас (формирование расхода в ДДС)
                    </span>
                  </label>

                  {recordFinanceExpense && (
                    <div className="pl-6 space-y-2.5 pt-2 border-t border-[#eeeeee]">
                      <div className="text-xs text-[#666666]">
                        Сумма списания:{" "}
                        <b className="font-mono text-sm text-[#111111]">
                          {formatRub(totals.totalSum)}
                        </b>{" "}
                        по статье «Закупка запчастей и комплектующих».
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] text-[#666666] mb-1">
                            Расчетный счет / касса списания
                          </label>
                          <select
                            value={cashAccountId}
                            onChange={(e) => setCashAccountId(e.target.value)}
                            className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          >
                            {accounts.map((acc) => (
                              <option key={acc.id} value={acc.id}>
                                {acc.name} ({formatRub(acc.balance)})
                              </option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="block text-[11px] text-[#666666] mb-1">
                            Комментарий к платежу (РКО)
                          </label>
                          <input
                            type="text"
                            value={paymentComment}
                            onChange={(e) => setPaymentComment(e.target.value)}
                            placeholder="например, Оплата поставщику по накладной"
                            className="w-full rounded-[6px] border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* 5. Примечания */}
          <div>
            <label className="block text-xs font-medium text-[#666666] mb-1">
              Примечания / Комментарий к приёмке (опционально)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Экспедитор, номер ТТН, состояние коробок..."
              className="w-full rounded-[8px] border border-[#e5e5e5] bg-white px-3 py-1.5 text-xs text-[#111111] focus:border-[#4a38f5] focus:outline-none"
            />
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-4 border-t border-[#e5e5e5]">
            <button
              type="button"
              onClick={onClose}
              disabled={intakeMutation.isPending}
              className="h-8 rounded-[8px] border border-[#e5e5e5] bg-white px-3.5 text-xs font-medium text-[#111111] shadow-2xs hover:bg-[#fafafa] transition-colors cursor-pointer"
            >
              Отмена
            </button>

            <button
              type="submit"
              disabled={intakeMutation.isPending}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-4 text-xs font-medium text-white shadow-xs hover:bg-[#3d2ee0] transition-colors disabled:opacity-50 cursor-pointer"
            >
              {intakeMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Оприходование...
                </>
              ) : (
                <>
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                  Подтвердить оприходование ({totals.rowCount} поз., {formatRub(totals.totalSum)})
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Модалка выбора из номенклатуры каталога */}
      {isCatalogPickerOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4 animate-in fade-in-0 duration-150">
          <div className="w-full max-w-2xl rounded-2xl border border-[#e5e5e5] bg-white shadow-2xl max-h-[85vh] flex flex-col overflow-hidden text-xs">
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#e5e5e5] bg-white">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-[#4a38f5]" />
                <h3 className="font-semibold text-[#111111] text-sm">
                  Выбор товаров из номенклатуры склада
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCatalogPickerOpen(false)}
                className="p-1 text-[#888888] hover:text-[#111111]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 border-b border-[#e5e5e5] bg-[#fafafa]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#888888]" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                  placeholder="Поиск по наименованию, артикулу или категории..."
                  className="w-full rounded-[6px] border border-[#e5e5e5] bg-white pl-8 pr-3 py-1.5 text-xs text-[#111111] placeholder:text-[#888888] focus:border-[#4a38f5] focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-2 divide-y divide-[#f0f0f0]">
              {filteredCatalogItems.length === 0 ? (
                <div className="py-8 text-center text-[#888888]">
                  {catalogSearch.trim() ? "Товары не найдены" : "Каталог пуст"}
                </div>
              ) : (
                filteredCatalogItems.map((it) => {
                  const isChecked = selectedCatalogItemIds.has(it.id);
                  return (
                    <label
                      key={it.id}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 rounded-[6px] hover:bg-[#fafafa] cursor-pointer transition-colors",
                        isChecked && "bg-[#4a38f5]/5",
                      )}
                    >
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleCatalogItem(it.id)}
                          className="h-4 w-4 rounded border-[#e5e5e5] text-[#4a38f5] focus:ring-[#4a38f5]"
                        />
                        <div>
                          <div className="font-medium text-[#111111]">{it.name}</div>
                          <div className="text-[11px] text-[#888888] flex items-center gap-2">
                            {it.sku && <span className="font-mono">Арт: {it.sku}</span>}
                            <span>•</span>
                            <span>Категория: {it.category || "Общая"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-[#111111] font-medium">
                          {formatRub(it.costPrice)}
                        </div>
                        <div className="text-[10px] text-[#666666]">
                          Остаток: {it.availableStock} {it.unit}
                        </div>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-t border-[#e5e5e5] bg-[#fafafa]">
              <span className="text-[#666666]">
                Выбрано: <b className="text-[#111111]">{selectedCatalogItemIds.size}</b> поз.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCatalogPickerOpen(false)}
                  className="px-3 py-1 rounded-[6px] border border-[#e5e5e5] bg-white text-xs font-medium text-[#111111]"
                >
                  Отмена
                </button>
                <button
                  type="button"
                  onClick={handleApplyCatalogSelection}
                  disabled={selectedCatalogItemIds.size === 0}
                  className="px-3.5 py-1 rounded-[6px] bg-[#4a38f5] text-xs font-medium text-white hover:bg-[#3d2ee0] disabled:opacity-50"
                >
                  Добавить выбранные ({selectedCatalogItemIds.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
