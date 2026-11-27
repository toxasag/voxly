"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useCreatePart } from "@/lib/api/use-repairs";
import type { WarehouseItemDTO } from "@/lib/api/use-warehouse";
import { CreateItemModal } from "@/components/warehouse/CreateItemModal";

export interface PartAddModalProps {
  open: boolean;
  onClose: () => void;
  orderId: string;
  initialName?: string;
  initialArticle?: string;
  onSuccess?: () => void;
}

/**
 * Создание нового товара в номенклатуре склада (единая форма из /warehouse)
 * и автоматическое добавление его в текущий наряд.
 */
export function PartAddModal({
  open,
  onClose,
  orderId,
  initialName = "",
  initialArticle = "",
  onSuccess,
}: PartAddModalProps) {
  const createPartMutation = useCreatePart();

  const handleCreated = useCallback(
    async (
      created: WarehouseItemDTO,
      extra: { quantity: number; addToPurchaseRequest: boolean },
    ) => {
      await createPartMutation.mutateAsync({
        orderId,
        payload: {
          warehouse_item_id: created.id,
          name: created.name,
          article: created.sku || "Б/А",
          quantity: Math.max(1, Math.round(extra.quantity)),
          retail_price: Number(created.retailPrice ?? 0),
          cost_price: Number(created.costPrice ?? 0),
          save_to_catalog: false,
          add_to_purchase_request: extra.addToPurchaseRequest,
        },
      });

      toast.success(
        `Товар «${created.name}» создан в номенклатуре и добавлен в наряд${
          extra.addToPurchaseRequest ? " + создана заявка на закупку" : ""
        }`,
      );
      onSuccess?.();
    },
    [createPartMutation, orderId, onSuccess],
  );

  return (
    <CreateItemModal
      open={open}
      onClose={onClose}
      title="Новый товар в номенклатуру"
      subtitle="Создание позиции на складе и добавление в наряд"
      submitLabel="Создать и добавить в наряд"
      initialName={initialName}
      initialSku={initialArticle}
      showQuantity
      initialQuantity={1}
      showPurchaseRequestOption
      purchaseRequestHint="Автоматически сформирует запись в разделе /warehouse (закупки) под этот наряд"
      onCreated={handleCreated}
    />
  );
}
