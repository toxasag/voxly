import { z } from "zod";

export const warehouseItemUnitSchema = z.enum(["шт", "комплект", "м", "л", "кг", "упак"]).default("шт");

export const updateWarehouseSettingsSchema = z.object({
  allow_negative_stock: z.boolean(),
});
export type UpdateWarehouseSettingsPayload = z.infer<typeof updateWarehouseSettingsSchema>;

export interface WarehouseSettingsDTO {
  allowNegativeStock: boolean;
}

export const createWarehouseItemSchema = z.object({
  sku: z.string().max(100).optional().default(""),
  name: z.string().min(1, "Name is required").max(300),
  brand: z.string().max(100).optional().default(""),
  category: z.string().max(100).optional().default(""),
  unit: z.string().max(20).default("шт"),
  min_stock: z.number().nonnegative().default(0),
  retail_price: z.number().nonnegative().default(0),
  cost_price: z.number().nonnegative().default(0),
  model_ids: z.array(z.string().uuid()).optional(),
  models: z.array(z.string()).optional(),
});
export type CreateWarehouseItemPayload = z.infer<typeof createWarehouseItemSchema>;

export const updateWarehouseItemSchema = createWarehouseItemSchema
  .partial()
  .extend({
    price: z.number().nonnegative().optional(),
  })
  .transform((val) => {
    if (val.price !== undefined && val.retail_price === undefined) {
      val.retail_price = val.price;
    }
    return val;
  });
export type UpdateWarehouseItemPayload = z.infer<typeof updateWarehouseItemSchema>;

export const intakeBatchSchema = z.object({
  item_id: z.string().uuid().optional(),
  name: z.string().min(1, "Item name is required").max(300),
  sku: z.string().max(100).optional().default(""),
  category: z.string().max(100).optional().default(""),
  unit: z.string().max(20).default("шт"),
  batch_number: z.string().max(100).optional().default(""),
  supplier_name: z.string().max(200).optional().default(""),
  purchase_price: z.number().nonnegative("Purchase price cannot be negative"),
  quantity: z.number().positive("Quantity must be positive"),
  retail_price: z.number().nonnegative().optional(),
  record_finance_expense: z.boolean().default(false),
  cash_account_id: z.string().uuid().optional(),
});
export type IntakeBatchPayload = z.infer<typeof intakeBatchSchema>;

export const purchaseRequestStatusSchema = z.enum(["pending", "ordered", "received", "cancelled"]);
export type PurchaseRequestStatus = z.infer<typeof purchaseRequestStatusSchema>;

export const createPurchaseRequestSchema = z.object({
  repair_order_id: z.string().uuid().optional(),
  deal_id: z.string().uuid().optional(),
  deal_item_id: z.string().uuid().optional(),
  item_id: z.string().uuid().optional(),
  item_name: z.string().min(1, "Item name is required").max(300),
  sku: z.string().max(100).optional().default(""),
  quantity: z.number().positive("Quantity must be positive").default(1),
  unit: z.string().max(20).default("шт"),
  estimated_price: z.number().nonnegative().default(0),
  comment: z.string().max(1000).optional().default(""),
});
export type CreatePurchaseRequestPayload = z.infer<typeof createPurchaseRequestSchema>;

export const updatePurchaseRequestSchema = z.object({
  item_name: z.string().min(1, "Наименование обязательно").max(300).optional(),
  sku: z.string().max(100).optional(),
  quantity: z.number().positive("Количество должно быть больше 0").optional(),
  unit: z.string().min(1).max(20).optional(),
  estimated_price: z.number().nonnegative("Цена не может быть отрицательной").optional(),
  status: purchaseRequestStatusSchema.optional(),
  comment: z.string().max(1000).optional(),
});
export type UpdatePurchaseRequestPayload = z.infer<typeof updatePurchaseRequestSchema>;

export const supplierOrderStatusSchema = z.enum(["draft", "pending_payment", "paid", "received", "cancelled"]);
export type SupplierOrderStatus = z.infer<typeof supplierOrderStatusSchema>;

export const createSupplierOrderSchema = z.object({
  supplier_name: z.string().min(1, "Имя поставщика обязательно").max(200),
  supplier_company_id: z.string().uuid().optional().nullable(),
  purchase_request_ids: z.array(z.string().uuid()).optional(),
  items: z
    .array(
      z.object({
        purchase_request_id: z.string().uuid().optional().nullable(),
        purchase_request_ids: z.array(z.string().uuid()).optional(),
        item_id: z.string().uuid().optional().nullable(),
        item_name: z.string().min(1),
        sku: z.string().default(""),
        requested_quantity: z.number().nonnegative().default(0),
        extra_quantity: z.number().nonnegative().default(0),
        quantity: z.number().positive(),
        unit: z.string().default("шт"),
        price: z.number().nonnegative(),
        repair_order_id: z.string().uuid().optional().nullable(),
        repair_orders: z.string().optional(),
      }),
    )
    .optional(),
  notes: z.string().default(""),
});
export type CreateSupplierOrderPayload = z.infer<typeof createSupplierOrderSchema>;

export const updateSupplierOrderSchema = z.object({
  supplier_name: z.string().min(1).max(200).optional(),
  supplier_company_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
  status: supplierOrderStatusSchema.optional(),
  items: z
    .array(
      z.object({
        id: z.string().uuid().optional(),
        purchase_request_id: z.string().uuid().optional().nullable(),
        purchase_request_ids: z.array(z.string().uuid()).optional(),
        item_id: z.string().uuid().optional().nullable(),
        item_name: z.string().min(1),
        sku: z.string().default(""),
        requested_quantity: z.number().nonnegative().default(0),
        extra_quantity: z.number().nonnegative().default(0),
        quantity: z.number().positive(),
        unit: z.string().default("шт"),
        price: z.number().nonnegative(),
        repair_order_id: z.string().uuid().optional().nullable(),
        repair_orders: z.string().optional(),
      }),
    )
    .optional(),
});
export type UpdateSupplierOrderPayload = z.infer<typeof updateSupplierOrderSchema>;

export const receiptSupplierOrderSchema = z.object({
  cash_account_id: z.string().uuid().optional(),
  mark_paid: z.boolean().default(false),
  comment: z.string().optional(),
});
export type ReceiptSupplierOrderPayload = z.infer<typeof receiptSupplierOrderSchema>;

export const paySupplierOrderSchema = z.object({
  cash_account_id: z.string().uuid().optional(),
  comment: z.string().optional(),
});
export type PaySupplierOrderPayload = z.infer<typeof paySupplierOrderSchema>;

export interface WarehouseItemRow {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  brand?: string;
  category: string;
  unit: string;
  min_stock: string | number;
  retail_price: string | number;
  cost_price: string | number;
  total_stock?: string | number;
  reserved_stock?: string | number;
  stock_valuation?: string | number;
  fifo_cost_price?: string | number | null;
  active_batches_count?: string | number;
  models_json?: WarehouseItemModelDTO[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface WarehouseItemModelDTO {
  id: string;
  name: string;
  brandId?: string;
  brandName?: string;
}

export interface WarehouseItemDTO {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  unit: string;
  minStock: number;
  retailPrice: number;
  price?: number;
  costPrice: number;
  /** Себестоимость ближайшей непустой партии (FIFO) */
  fifoCostPrice?: number;
  /** Средневзвешенная себестоимость по текущим остаткам партий */
  avgBatchCostPrice?: number;
  /** Реальная оценка остатка позиции по партиям SUM(remaining_quantity * purchase_price) */
  stockValuation?: number;
  /** Количество активных непустых партий */
  activeBatchesCount?: number;
  totalStock: number;
  quantity?: number;
  reservedStock: number;
  availableStock: number;
  models?: WarehouseItemModelDTO[];
  modelIds?: string[];
  modelNames?: string[];
  createdAt: string;
  updatedAt: string;
}

export const WAREHOUSE_LIMITS = [25, 50, 75, 100, 150, 200, 250] as const;
export type WarehouseLimit = (typeof WAREHOUSE_LIMITS)[number];

export const warehousePaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce
    .number()
    .int()
    .refine((val) => WAREHOUSE_LIMITS.includes(val as WarehouseLimit), {
      message: `Limit must be one of: ${WAREHOUSE_LIMITS.join(", ")}`,
    })
    .default(25),
  search: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  all: z.preprocess((v) => v === "true" || v === true, z.boolean().optional()),
});
export type WarehousePaginationQuery = z.infer<typeof warehousePaginationQuerySchema>;

export interface WarehousePaginationMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
  /** Полная оценка всего склада по остаткам партий SUM(remaining_quantity * purchase_price) */
  totalValuation?: number;
  /** Позиций ниже порога min_stock по всему складу */
  lowStockCount?: number;
}

export interface PaginatedWarehouseItemsDTO {
  data: WarehouseItemDTO[];
  meta: WarehousePaginationMeta;
}

export interface WarehouseBatchRow {
  id: string;
  tenant_id: string;
  item_id: string;
  item_name?: string;
  batch_number: string;
  supplier_name: string;
  purchase_price: string | number;
  initial_quantity: string | number;
  remaining_quantity: string | number;
  received_at: Date | string;
  created_at: Date | string;
}

export interface WarehouseBatchDTO {
  id: string;
  itemId: string;
  itemName?: string;
  batchNumber: string;
  supplierName: string;
  purchasePrice: number;
  initialQuantity: number;
  remainingQuantity: number;
  receivedAt: string;
  createdAt: string;
}

export interface WarehouseMovementRow {
  id: string;
  tenant_id: string;
  item_id: string;
  item_name?: string;
  batch_id: string | null;
  repair_order_id: string | null;
  repair_ticket_number?: string | null;
  deal_id?: string | null;
  deal_item_id?: string | null;
  deal_title?: string | null;
  type: string;
  quantity: string | number;
  cost_price: string | number;
  description: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: Date | string;
}

export interface WarehouseMovementDTO {
  id: string;
  itemId: string;
  itemName?: string;
  batchId: string | null;
  repairOrderId: string | null;
  repairTicketNumber?: string | null;
  dealId?: string | null;
  dealItemId?: string | null;
  dealTitle?: string | null;
  type: string;
  quantity: number;
  costPrice: number;
  description: string;
  createdByName?: string | null;
  createdAt: string;
}

export interface PurchaseRequestRow {
  id: string;
  tenant_id: string;
  repair_order_id: string | null;
  deal_id?: string | null;
  deal_item_id?: string | null;
  supplier_order_id: string | null;
  repair_ticket_number?: string | null;
  deal_title?: string | null;
  item_id: string | null;
  item_name: string;
  sku: string;
  quantity: string | number;
  unit: string;
  estimated_price: string | number;
  status: string;
  comment: string;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface PurchaseRequestDTO {
  id: string;
  repairOrderId: string | null;
  dealId?: string | null;
  dealItemId?: string | null;
  supplierOrderId?: string | null;
  repairTicketNumber?: string | null;
  dealTitle?: string | null;
  itemId: string | null;
  itemName: string;
  sku: string;
  quantity: number;
  unit: string;
  estimatedPrice: number;
  status: PurchaseRequestStatus;
  comment: string;
  createdByName?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AggregatedPurchaseRequestDTO {
  id: string;
  itemId: string | null;
  itemName: string;
  sku: string;
  unit: string;
  quantity: number;
  estimatedPrice: number;
  status: PurchaseRequestStatus;
  repairOrders: string;
  repair_orders: string;
  requestIds: string[];
  availableStock: number;
  totalStock: number;
}

export interface SupplierOrderItemRow {
  id: string;
  tenant_id: string;
  supplier_order_id: string;
  purchase_request_id: string | null;
  item_id: string | null;
  item_name: string;
  sku: string;
  requested_quantity?: string | number;
  extra_quantity?: string | number;
  repair_order_id?: string | null;
  purchase_request_ids?: string[] | null;
  quantity: string | number;
  unit: string;
  price: string | number;
  total_price: string | number;
  created_at: Date | string;
}

export interface SupplierOrderItemDTO {
  id: string;
  supplierOrderId: string;
  purchaseRequestId: string | null;
  itemId: string | null;
  itemName: string;
  sku: string;
  requestedQuantity: number;
  extraQuantity: number;
  repairOrderId?: string | null;
  purchaseRequestIds?: string[];
  repairOrders?: string;
  quantity: number;
  unit: string;
  price: number;
  totalPrice: number;
  createdAt: string;
}

export interface SupplierOrderRow {
  id: string;
  tenant_id: string;
  order_number: string;
  supplier_name: string;
  supplier_company_id?: string | null;
  status: string;
  total_amount: string | number;
  cash_account_id: string | null;
  finance_transaction_id: string | null;
  notes: string;
  paid_at: Date | string | null;
  received_at: Date | string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SupplierOrderDTO {
  id: string;
  orderNumber: string;
  supplierName: string;
  supplierCompanyId: string | null;
  status: SupplierOrderStatus;
  totalAmount: number;
  cashAccountId: string | null;
  financeTransactionId: string | null;
  notes: string;
  paidAt: string | null;
  receivedAt: string | null;
  createdBy: string | null;
  createdByName?: string | null;
  items: SupplierOrderItemDTO[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Export / Import / Bulk Operations
// ---------------------------------------------------------------------------

export const exportWarehouseItemsSchema = z.object({
  format: z.enum(["xlsx", "csv"]).default("xlsx"),
  ids: z.array(z.string().uuid()).optional(),
  search: z.string().optional(),
});
export type ExportWarehouseItemsPayload = z.infer<typeof exportWarehouseItemsSchema>;

export interface ImportParseResultDTO {
  headers: string[];
  sampleRows: string[][];
  rows: string[][];
  totalRows: number;
  detectedDelimiter?: string;
  suggestedMapping: Record<string, string>;
}

export const importValidateSchema = z.object({
  rows: z.array(z.array(z.string())),
  mapping: z.record(z.string()),
  skipFirstRow: z.boolean().default(true),
});
export type ImportValidatePayload = z.infer<typeof importValidateSchema>;

export interface ImportParsedItem {
  rowNumber: number;
  name: string;
  sku: string;
  brand: string;
  category: string;
  unit: string;
  costPrice: number;
  retailPrice: number;
  minStock: number;
}

export interface ImportDuplicateConflictDTO {
  rowNumber: number;
  reason: "sku_match" | "name_match";
  matchKey: string;
  existing: {
    id: string;
    sku: string;
    name: string;
    brand: string;
    category: string;
    unit: string;
    costPrice: number;
    retailPrice: number;
    minStock: number;
    totalStock?: number;
  };
  incoming: ImportParsedItem;
}

export interface ImportValidateResultDTO {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  errorCount: number;
  duplicates: ImportDuplicateConflictDTO[];
  sampleValid: ImportParsedItem[];
  errors: { rowNumber: number; message: string }[];
}

export const importCommitSchema = z.object({
  rows: z.array(z.array(z.string())),
  mapping: z.record(z.string()),
  skipFirstRow: z.boolean().default(true),
  resolutions: z.record(z.enum(["overwrite", "skip", "keep_both"])).optional().default({}),
  defaultResolution: z.enum(["overwrite", "skip"]).optional().default("skip"),
});
export type ImportCommitPayload = z.infer<typeof importCommitSchema>;

export interface ImportErrorDetailDTO {
  rowNumber: number;
  reason: string;
}

export interface ImportCommitResultDTO {
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errorCount: number;
  total?: number;
  errors?: ImportErrorDetailDTO[];
}

export const priceAdjustmentActionSchema = z.object({
  mode: z.enum(["set", "percent", "delta"]),
  value: z.number(),
});
export type PriceAdjustmentAction = z.infer<typeof priceAdjustmentActionSchema>;

export const bulkUpdateWarehouseItemsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least 1 item"),
  category: z.string().max(100).optional(),
  brand: z.string().max(100).optional(),
  unit: z.string().max(20).optional(),
  min_stock: z.number().nonnegative().optional(),
  retail_price_action: priceAdjustmentActionSchema.optional(),
  cost_price_action: priceAdjustmentActionSchema.optional(),
});
export type BulkUpdateWarehouseItemsPayload = z.infer<typeof bulkUpdateWarehouseItemsSchema>;

export const bulkDeleteWarehouseItemsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1, "Select at least 1 item"),
});
export type BulkDeleteWarehouseItemsPayload = z.infer<typeof bulkDeleteWarehouseItemsSchema>;

