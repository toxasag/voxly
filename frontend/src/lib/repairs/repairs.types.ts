export type RepairStatus =
  | "intake"
  | "waiting_parts"
  | "ready"
  | "issued"
  | "diagnostics"
  | "approval"
  | "in_progress"
  | "rejected";

export type RepairPriority = "low" | "normal" | "high" | "urgent";

export type RepairPaymentStatus = "unpaid" | "invoiced" | "paid";

export const PAYMENT_STATUS_LABELS: Record<RepairPaymentStatus, string> = {
  unpaid: "Не оплачен",
  invoiced: "Счет выставлен",
  paid: "Оплачен",
};

export const PAYMENT_STATUS_COLORS: Record<RepairPaymentStatus, string> = {
  unpaid: "bg-[#f5f5f5] text-[#666666] border-[#e5e5e5]",
  invoiced: "bg-sky-50 text-sky-700 border-sky-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
};

export function getRepairPaymentStatusLabel(status: RepairPaymentStatus): string {
  return PAYMENT_STATUS_LABELS[status] ?? "Не оплачен";
}

export function getRepairPaymentStatusColors(status: RepairPaymentStatus): string {
  return PAYMENT_STATUS_COLORS[status] ?? PAYMENT_STATUS_COLORS.unpaid;
}

export interface EquipmentInfo {
  type: string;
  brand: string;
  model: string;
  serial_number: string;
  package_contents: string;
  appearance: string;
}

export interface DiagnosticsResult {
  performed_at: string;
  performed_by: string;
  findings: string;
  recommended_action: string;
  condition_notes: string;
}

export interface WorkItem {
  id: string;
  description: string;
  master_name: string;
  master_id: string;
  quantity?: number;
  unit_price?: number;
  cost: number;
}

export interface PartItem {
  id: string;
  warehouse_item_id?: string | null;
  status?: string | null;
  name: string;
  article: string;
  quantity: number;
  retail_price: number;
  cost_price: number;
}

export interface RepairTicket {
  id: string;
  ticket_number: string;
  deal_id?: string | null;
  deal_title?: string | null;
  deal_note?: string | null;
  deal_budget?: number | null;
  deal_stage_name?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  company_inn?: string | null;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  customer_id: string;
  additional_contacts?: { name: string; phone: string; role?: string }[];
  equipment: EquipmentInfo;
  defect_description: string;
  defect_photos: string[];
  status: RepairStatus;
  payment_status: RepairPaymentStatus;
  priority: RepairPriority;
  master_name: string;
  master_id: string;
  estimated_cost: number;
  final_cost: number | null;
  received_at: string;
  completed_at: string | null;
  delivered_at: string | null;
  notes: string;
  diagnostics: DiagnosticsResult | null;
  work_items: WorkItem[];
  parts_used: PartItem[];
  nextStatus: RepairStatus | null;
  allowedTransitions: RepairStatus[];
}

export interface RepairTicketDetail extends RepairTicket {
  works: WorkItem[];
  parts: PartItem[];
  notes_log: RepairNote[];
  photos: RepairPhoto[];
  totals: RepairTotals;
}

export interface RepairNote {
  id: string;
  authorId: string;
  authorName: string;
  kind: string;
  content: string;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}

export interface RepairPhoto {
  id: string;
  url: string;
  caption: string;
  uploadedBy: string;
  createdAt: string;
}

export interface RepairTotals {
  worksTotal: number;
  partsRetailTotal: number;
  partsCostTotal: number;
  grandTotal: number;
  margin: number;
  marginPercent: number;
}

export type RepairFilterStatus = RepairStatus | "all";

export const EQUIPMENT_TYPES = [
  "Смартфон",
  "Планшет",
  "Ноутбук",
  "Компьютер (ПК)",
  "Монитор",
  "Принтер / МФУ",
  "Серверное оборудование",
  "Фото/видеокамера",
  "Смарт-часы",
  "Беспроводные наушники",
  "Игровая приставка",
  "Другое",
] as const;

export type EquipmentType = (typeof EQUIPMENT_TYPES)[number];

const STATUS_LABELS: Record<RepairStatus, string> = {
  intake: "Принят",
  waiting_parts: "Заказ запчастей",
  ready: "Готов",
  issued: "Выдан",
  diagnostics: "Диагностика",
  approval: "Согласование",
  in_progress: "В работе",
  rejected: "Отказ",
};

const STATUS_COLORS: Record<RepairStatus, string> = {
  intake: "bg-[#e0f2fe] text-[#0369a1] border-[#bae6fd]", // Голубой (скриншот 1)
  waiting_parts: "bg-[#fef3c7] text-[#92400e] border-[#fde68a]", // Янтарный
  ready: "bg-[#dcfce7] text-[#15803d] border-[#bbf7d0]", // Изумрудно-зеленый
  issued: "bg-[#f0fdf4] text-[#166534] border-[#bbf7d0]", // Зеленый (скриншот 1)
  diagnostics: "bg-sky-50 text-sky-700 border-sky-200",
  approval: "bg-indigo-50 text-[#4a38f5] border-indigo-200",
  in_progress: "bg-indigo-50 text-[#4a38f5] border-indigo-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

export const STATUS_ORDER: RepairStatus[] = [
  "intake",
  "waiting_parts",
  "ready",
  "issued",
];

export function getRepairStatusLabel(status: RepairStatus): string {
  return STATUS_LABELS[status];
}

export function getRepairStatusColors(status: RepairStatus): string {
  return STATUS_COLORS[status];
}