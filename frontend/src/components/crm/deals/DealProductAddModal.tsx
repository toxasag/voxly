"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useAddDealItem } from "@/lib/api/use-deals";
import type { WarehouseItemDTO } from "@/lib/api/use-warehouse";
import { CreateItemModal } from "@/components/warehouse/CreateItemModal";

export interface DealProductAddModalProps {
  open: boolean;
  onClose: () => void;
  dealId: string;
  initialName?: string;
  initialSku?: string;
  onSuccess?: () => void;
}

/**
 * Создание нового товара в номенклатуре склада (единая форма из /warehouse)
 * и автоматическое добавление его в сделку CRM.
 */
export function DealProductAddModal({
  open,
  onClose,
  dealId,
  initialName = "",
  initialSku = "",
  onSuccess,
}: DealProductAddModalProps) {
  const addDealItemMutation = useAddDealItem(dealId);

  const handleCreated = useCallback(
    async (
      created: WarehouseItemDTO,
      extra: { quantity: number; addToPurchaseRequest: boolean },
    ) => {
      await addDealItemMutation.mutateAsync({
        item_type: "product",
        item_id: created.id,
        name: created.name,
        sku: created.sku || "Б/А",
        quantity: extra.quantity > 0 ? extra.quantity : 1,
        price: Number(created.retailPrice ?? 0),
        cost_price: Number(created.costPrice ?? 0),
        unit: created.unit || "шт",
        save_to_catalog: false,
        add_to_purchase_request: extra.addToPurchaseRequest,
      });

      toast.success(
        `Товар «${created.name}» создан в номенклатуре и добавлен в сделку${
          extra.addToPurchaseRequest ? " + создана заявка на закупку" : ""
        }`,
      );
      onSuccess?.();
    },
    [addDealItemMutation, onSuccess],
  );

  return (
    <CreateItemModal
      open={open}
      onClose={onClose}
      title="Новый товар в номенклатуру"
      subtitle="Создание позиции на складе и добавление в сделку"
      submitLabel="Создать и добавить в сделку"
      initialName={initialName}
      initialSku={initialSku}
      showQuantity
      initialQuantity={1}
      showPurchaseRequestOption
      purchaseRequestHint="Автоматически сформирует заявку в разделе закупок склада под эту сделку"
      onCreated={handleCreated}
    />
  );
}
