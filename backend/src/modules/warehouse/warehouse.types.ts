import { z } from "zod";

export const warehouseItemUnitSchema = z.enum(["шт", "комплект", "м", "л", "кг", "упак"]).default("шт");

export const createWarehouseItemSchema = z.object({
  sku: z.string().max(100).optional().default(""),
  name: z.string().min(1, "Name is required").max(300),
  category: z.string().max(100).optional().default(""),
  unit: z.string().max(20).default("шт"),
  min_stock: z.number().nonnegative().default(0),
  retail_price: z.number().nonnegative().default(0),
  cost_price: z.number().nonnegative().default(0),
});
export type CreateWarehouseItemPayload = z.infer<typeof createWarehouseItemSchema>;

export const updateWarehouseItemSchema = createWarehouseItemSchema.partial();
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
  status: purchaseRequestStatusSchema.optional(),
  comment: z.string().max(1000).optional(),
});
export type UpdatePurchaseRequestPayload = z.infer<typeof updatePurchaseRequestSchema>;

export interface WarehouseItemRow {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  min_stock: string | number;
  retail_price: string | number;
  cost_price: string | number;
  total_stock?: string | number;
  reserved_stock?: string | number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface WarehouseItemDTO {
  id: string;
  sku: string;
  name: string;
  category: string;
  unit: string;
  minStock: number;
  retailPrice: number;
  costPrice: number;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
  createdAt: string;
  updatedAt: string;
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
  repair_ticket_number?: string | null;
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
  repairTicketNumber?: string | null;
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
