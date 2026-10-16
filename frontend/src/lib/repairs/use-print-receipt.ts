"use client";

import { useCallback } from "react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";

function formatDateFull(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatCostPrint(amount: number): string {
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function usePrintReceipt() {
  return useCallback((ticket: RepairTicket) => {
    const printWindow = window.open("", "_blank", "width=700,height=900");
    if (!printWindow) return;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Receipt ${ticket.ticket_number}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px; color: #1e1e1e; line-height: 1.5; padding: 40px; max-width: 700px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 24px; }
    .header h1 { font-size: 20px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
    .header .subtitle { font-size: 12px; color: #666; }
    .receipt-number { text-align: right; font-size: 14px; font-weight: 700; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid #1e1e1e; }
    .section { margin-bottom: 16px; }
    .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 6px; }
    .row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee; }
    .row .label { color: #666; }
    .row .value { font-weight: 600; text-align: right; }
    .equipment-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
    .equipment-grid .item { padding: 4px 0; border-bottom: 1px solid #eee; }
    .equipment-grid .item .label { font-size: 11px; color: #888; }
    .equipment-grid .item .value { font-size: 13px; font-weight: 600; }
    .defect-box { padding: 10px; background: #f5f5f5; border-radius: 6px; font-size: 12px; color: #444; margin-top: 4px; line-height: 1.6; }
    .notes-box { padding: 10px; background: #fff8e1; border-left: 3px solid #f59e0b; border-radius: 4px; font-size: 12px; color: #8b6914; margin-top: 4px; }
    .cost-row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 14px; }
    .cost-row.total { font-weight: 800; font-size: 16px; border-bottom: 2px solid #1e1e1e; margin-top: 4px; padding-top: 8px; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; }
    .footer .signature-line { display: flex; justify-content: space-between; gap: 40px; margin-top: 20px; }
    .footer .sig { flex: 1; }
    .footer .sig .line { border-bottom: 1px solid #1e1e1e; margin-top: 30px; }
    .footer .sig .label { font-size: 11px; color: #888; text-align: center; margin-top: 4px; }
    .stamp { margin-top: 20px; text-align: right; font-size: 10px; color: #aaa; font-style: italic; }
    @media print {
      body { padding: 20px; }
      @page { margin: 15mm; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>GETVOXLY Service Center</h1>
    <div class="subtitle">Equipment Intake Receipt</div>
  </div>

  <div class="receipt-number">${ticket.ticket_number}</div>

  <div class="section">
    <div class="section-title">Client Information</div>
    <div class="row">
      <span class="label">Name</span>
      <span class="value">${ticket.customer_name}</span>
    </div>
    <div class="row">
      <span class="label">Phone</span>
      <span class="value">${ticket.customer_phone}</span>
    </div>
    <div class="row">
      <span class="label">Received</span>
      <span class="value">${formatDateFull(ticket.received_at)}</span>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Equipment</div>
    <div class="equipment-grid">
      <div class="item">
        <div class="label">Type</div>
        <div class="value">${ticket.equipment.type}</div>
      </div>
      <div class="item">
        <div class="label">Brand</div>
        <div class="value">${ticket.equipment.brand}</div>
      </div>
      <div class="item">
        <div class="label">Model</div>
        <div class="value">${ticket.equipment.model}</div>
      </div>
      <div class="item">
        <div class="label">Serial Number</div>
        <div class="value">${ticket.equipment.serial_number}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Declared Defect</div>
    <div class="defect-box">${ticket.defect_description}</div>
  </div>

  <div class="section">
    <div class="section-title">Cost Details</div>
    <div class="cost-row">
      <span class="label">Estimated Repair Cost</span>
      <span class="value">${formatCostPrint(ticket.estimated_cost)}</span>
    </div>
    ${
      ticket.final_cost
        ? `<div class="cost-row total"><span class="label">Final Cost</span><span class="value">${formatCostPrint(ticket.final_cost)}</span></div>`
        : `<div class="cost-row total"><span class="label">Final cost to be determined after diagnostics</span></div>`
    }
  </div>

  ${
    ticket.notes
      ? `<div class="section"><div class="section-title">Notes</div><div class="notes-box">${ticket.notes}</div></div>`
      : ""
  }

  <div class="footer">
    <p style="font-size:12px;color:#666;">By signing this receipt, the client confirms the equipment has been accepted for repair under the stated conditions. The final cost may vary from the estimate upon additional diagnostics.</p>
    <div class="signature-line">
      <div class="sig">
        <div class="line"></div>
        <div class="label">Client Signature</div>
      </div>
      <div class="sig">
        <div class="line"></div>
        <div class="label">Master: ${ticket.master_name}</div>
      </div>
    </div>
    <div class="stamp">Generated by GETVOXLY · ${formatDateFull(new Date().toISOString())}</div>
  </div>
  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

    printWindow.document.write(html);
    printWindow.document.close();
  }, []);
}