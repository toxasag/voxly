export type RepairStatus =
  | "intake"
  | "diagnostics"
  | "approval"
  | "in_progress"
  | "ready"
  | "issued"
  | "rejected";

export type RepairPriority = "low" | "normal" | "high" | "urgent";

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
  cost: number;
}

export interface PartItem {
  id: string;
  name: string;
  article: string;
  quantity: number;
  retail_price: number;
  cost_price: number;
}

export interface RepairTicket {
  id: string;
  ticket_number: string;
  customer_name: string;
  customer_phone: string;
  customer_id: string;
  equipment: EquipmentInfo;
  defect_description: string;
  defect_photos: string[];
  status: RepairStatus;
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
  intake: "Приёмка",
  diagnostics: "Диагностика",
  approval: "Согласование",
  in_progress: "В работе",
  ready: "Готов к выдаче",
  issued: "Выдан",
  rejected: "Отказ",
};

const STATUS_COLORS: Record<RepairStatus, string> = {
  intake: "bg-slate-50 text-slate-700 border-slate-200",
  diagnostics: "bg-sky-50 text-sky-700 border-sky-200",
  approval: "bg-indigo-50 text-[#4a38f5] border-indigo-200",
  in_progress: "bg-indigo-50 text-[#4a38f5] border-indigo-200",
  ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
  issued: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

export const STATUS_ORDER: RepairStatus[] = [
  "intake",
  "diagnostics",
  "approval",
  "in_progress",
  "ready",
  "issued",
];

export function getRepairStatusLabel(status: RepairStatus): string {
  return STATUS_LABELS[status];
}

export function getRepairStatusColors(status: RepairStatus): string {
  return STATUS_COLORS[status];
}