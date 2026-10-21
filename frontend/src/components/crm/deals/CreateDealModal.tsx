"use client";

import { DrawerCreateDeal, type DrawerCreateDealProps } from "@/components/crm/deals/DrawerCreateDeal";

export type CreateDealModalProps = DrawerCreateDealProps;

export function CreateDealModal(props: CreateDealModalProps) {
  return <DrawerCreateDeal {...props} />;
}
