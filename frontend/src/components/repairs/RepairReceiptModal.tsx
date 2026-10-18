"use client";

import { memo, useCallback, useRef } from "react";
import { X, Printer } from "lucide-react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";
import { getRepairStatusLabel } from "@/lib/repairs/repairs.types";

interface RepairReceiptModalProps {
  open: boolean;
  ticket: RepairTicket | null;
  onClose: () => void;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function formatCost(amount: number): string {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(amount);
}

export const RepairReceiptModal = memo(function RepairReceiptModal({ open, ticket, onClose }: RepairReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=800,height=1000");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:-apple-system,sans-serif;font-size:13px;color:#1e1e1e;padding:40px;max-width:700px;margin:0 auto;}@media print{@page{margin:15mm}}.barcode{text-align:center;margin:12px 0}.barcode span{font-family:'Courier New',monospace;font-size:22px;letter-spacing:3px}.line{border-bottom:1px solid #ddd;padding:4px 0;margin:2px 0}.label{color:#888;font-size:11px}.val{font-weight:700}.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:8px 0}.sig{display:flex;justify-content:space-between;gap:40px;margin-top:40px}.sig .s{flex:1}.sig .s .l{border-bottom:1px solid #1e1e1e;margin-top:26px}.sig .s .t{text-align:center;font-size:11px;color:#888;margin-top:4px}h1{font-size:20px;font-weight:800;margin-bottom:4px}.sub{font-size:12px;color:#666}</style></head><body onload="window.print()">${printRef.current.innerHTML}</body></html>`);
    w.document.close();
  }, []);

  if (!open || !ticket) return null;

  const workTotal = ticket.work_items.reduce((s, w) => s + w.cost, 0);
  const partsRetail = ticket.parts_used.reduce((s, p) => s + p.retail_price * p.quantity, 0);
  const partsCost = ticket.parts_used.reduce((s, p) => s + p.cost_price * p.quantity, 0);
  const grandTotal = workTotal + partsRetail;
  const margin = grandTotal - partsCost;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 backdrop-blur-[0.5px] p-4 overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-2xl my-8 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-[#111111]">Предпросмотр квитанции</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={handlePrint} className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3 text-xs font-medium text-white hover:bg-[#3b2be0] transition-colors">
              <Printer className="h-3.5 w-3.5" /> Печать</button>
            <button type="button" onClick={onClose} className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div ref={printRef} className="rounded-[16px] border border-[#e5e5e5] bg-white text-slate-900 p-10 shadow-2xl font-sans">
          <div className="text-center mb-6">
            <h1>GETVOXLY Сервисный центр</h1>
            <p className="sub">Квитанция о приёмке оборудования</p>
          </div>

          <div className="barcode"><span>||| |||||| ||| || |||||| ||| |||||| |||</span></div>
          <div className="text-center mb-6">
            <p style={{ fontSize: "16px", fontWeight: 800, fontFamily: "'Courier New', monospace" }}>{ticket.ticket_number}</p>
          </div>

          <div className="line"><span className="label">Клиент:</span> <span className="val">{ticket.customer_name}</span></div>
          <div className="line"><span className="label">Телефон:</span> <span className="val">{ticket.customer_phone}</span></div>
          <div className="line"><span className="label">Статус:</span> <span className="val">{getRepairStatusLabel(ticket.status)}</span></div>
          <div className="line"><span className="label">Принято:</span> <span className="val">{formatDate(ticket.received_at)}</span></div>

          <div style={{ margin: "14px 0" }}><strong>Оборудование</strong></div>
          <div className="grid">
            <div><span className="label">Тип</span><br /><span className="val">{ticket.equipment.type}</span></div>
            <div><span className="label">Бренд</span><br /><span className="val">{ticket.equipment.brand}</span></div>
            <div><span className="label">Модель</span><br /><span className="val">{ticket.equipment.model}</span></div>
            <div><span className="label">S/N</span><br /><span className="val">{ticket.equipment.serial_number}</span></div>
          </div>

          <div className="line"><span className="label">Комплектация:</span> <span className="val">{ticket.equipment.package_contents}</span></div>
          <div className="line"><span className="label">Внешний вид:</span> <span className="val">{ticket.equipment.appearance}</span></div>

          <div style={{ margin: "14px 0" }}><strong>Заявленная неисправность</strong></div>
          <p style={{ padding: "10px", background: "#f5f5f5", borderRadius: "6px", fontSize: "12px", color: "#444" }}>{ticket.defect_description}</p>

          <div style={{ margin: "14px 0" }}><strong>Расчёт стоимости</strong></div>
          <div className="line"><span className="label">Работы ({ticket.work_items.length}):</span> <span className="val">{formatCost(workTotal)}</span></div>
          <div className="line"><span className="label">Запчасти ({ticket.parts_used.length}):</span> <span className="val">{formatCost(partsRetail)}</span></div>
          <div className="line" style={{ fontWeight: 800, fontSize: "15px", borderBottom: "2px solid #1e1e1e" }}><span>Итого к оплате:</span> <span className="val">{formatCost(grandTotal)}</span></div>
          {margin > 0 && <div className="line"><span className="label" style={{ color: "#059669" }}>Наценка:</span> <span className="val" style={{ color: "#059669" }}>{formatCost(margin)}</span></div>}

          {ticket.notes && <div style={{ margin: "14px 0", padding: "10px", background: "#fff8e1", borderLeft: "3px solid #f59e0b", borderRadius: "4px" }}><span className="label">Примечания:</span> {ticket.notes}</div>}

          <div className="sig">
            <div className="s"><div className="l"></div><div className="t">Подпись клиента</div></div>
            <div className="s"><div className="l"></div><div className="t">Мастер: {ticket.master_name}</div></div>
          </div>
          <div style={{ marginTop: "20px", textAlign: "right", fontSize: "10px", color: "#aaa", fontStyle: "italic" }}>Сформировано в GETVOXLY · {formatDate(new Date().toISOString())}</div>
        </div>
      </div>
    </div>
  );
});