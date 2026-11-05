"use client";

import { memo, useCallback, useRef } from "react";
import { X, Printer, FileText } from "lucide-react";
import type { RepairTicket } from "@/lib/repairs/repairs.types";

interface RepairReceiptModalProps {
  open: boolean;
  ticket: RepairTicket | null;
  onClose: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

export const RepairReceiptModal = memo(function RepairReceiptModal({
  open,
  ticket,
  onClose,
}: RepairReceiptModalProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = useCallback(() => {
    if (!printRef.current) return;
    const w = window.open("", "_blank", "width=850,height=1100");
    if (!w) return;
    w.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Акт приемки (Договор) №${ticket?.ticket_number ?? ""}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 11px;
      color: #111111;
      padding: 24px;
      max-width: 800px;
      margin: 0 auto;
      line-height: 1.35;
      background: #ffffff;
    }
    @media print {
      @page {
        size: A4 portrait;
        margin: 10mm 12mm;
      }
      body {
        padding: 0;
        max-width: 100%;
      }
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid #111111;
      padding: 5px 8px;
    }
  </style>
</head>
<body onload="window.print()">
  ${printRef.current.innerHTML}
</body>
</html>`);
    w.document.close();
  }, [ticket]);

  if (!open || !ticket) return null;

  const dateStr = formatDate(ticket.received_at);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 backdrop-blur-[1px] p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-3xl my-6 space-y-3">
        {/* Панель действий вверху */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#4a38f5]/10 text-[#4a38f5]">
              <FileText className="h-4 w-4" />
            </div>
            <div>
              <span className="text-sm font-semibold text-[#111111]">
                Акт приемки (Договор) №{ticket.ticket_number}
              </span>
              <p className="text-xs text-[#666666]">Предпросмотр договора и отрывного талона</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex h-8 items-center gap-1.5 rounded-[8px] bg-[#4a38f5] px-3.5 text-xs font-medium text-white shadow-2xs hover:bg-[#3d2ee0] transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              Печать
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-[6px] p-1.5 text-[#888888] hover:bg-black/5 hover:text-[#111111] transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Печатный лист (Акт приемки + Договор + Отрывной талон) */}
        <div
          ref={printRef}
          className="rounded-[16px] border border-[#e5e5e5] bg-white text-[#111111] p-8 md:p-10 shadow-xl font-sans"
          style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif' }}
        >
          {/* Шапка: Логотип слева + Реквизиты компании справа */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <img
                src="/service-logo.png"
                alt="Логотип сервисного центра"
                style={{ width: "86px", height: "86px", borderRadius: "12px", objectFit: "cover" }}
              />
            </div>
            <div style={{ textAlign: "right", fontSize: "11px", lineHeight: "1.4", color: "#111111" }}>
              <div style={{ fontWeight: 700, fontSize: "13px" }}>
                Ремонт инструмента (Toua, Hybest, VAPP) ИП Сагайдак А.Г.
              </div>
              <div>Москва 3й проезд Марьиной рощи 40с1, 2 этаж, каб. 214</div>
              <div>тел. +7 977 628 20 49 Пн-Пт 10:00-19:00</div>
              <div style={{ fontWeight: 700, marginTop: "2px" }}>САЙТ: РЕМОНТ-ИНСТРУМЕНТ.РФ</div>
            </div>
          </div>

          {/* Заголовок Договора */}
          <div style={{ textAlign: "center", margin: "14px 0 12px 0" }}>
            <h1 style={{ fontSize: "15px", fontWeight: 800, margin: 0, textTransform: "uppercase" }}>
              Договор № {ticket.ticket_number} от {dateStr}
            </h1>
            <div style={{ fontSize: "12px", color: "#333333", marginTop: "2px" }}>
              на оказание услуг по ремонту инструмента
            </div>
          </div>

          {/* Информация о заказе */}
          <div style={{ fontSize: "11px", lineHeight: "1.6", marginBottom: "12px" }}>
            <div>
              <strong>Заказчик:</strong> {ticket.customer_name} {ticket.customer_phone}
              {ticket.company_name ? ` (${ticket.company_name})` : ""}
            </div>
            <div>
              <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
              {ticket.equipment.brand} {ticket.equipment.model} S/N: {ticket.equipment.serial_number || "—"}
            </div>
            <div>
              <strong>Неисправность:</strong> {ticket.defect_description || "Не указана"}
            </div>
          </div>

          {/* Таблица: Комплектация | Неисправность (СТРОГО «Неисправность» вместо внешнего вида!) */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "14px", fontSize: "11px" }}>
            <thead>
              <tr style={{ background: "#fbfbfb" }}>
                <th style={{ border: "1px solid #111111", padding: "5px 8px", textAlign: "left", width: "50%", fontWeight: 700 }}>
                  Комплектация
                </th>
                <th style={{ border: "1px solid #111111", padding: "5px 8px", textAlign: "left", width: "50%", fontWeight: 700 }}>
                  Неисправность
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                  {ticket.equipment.package_contents || "Обойма, 2 АКБ, Кейс"}
                </td>
                <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                  {ticket.defect_description || "Не стреляет"}
                </td>
              </tr>
            </tbody>
          </table>

          {/* 8 пунктов договора-оферты */}
          <div style={{ fontSize: "9.5px", lineHeight: "1.32", color: "#222222", textAlign: "justify", marginBottom: "14px" }}>
            <p style={{ margin: "0 0 4px 0" }}>
              ИП Сагайдак Антон Геннадьевич, именуемый в дальнейшем «Исполнитель» с одной стороны, и гражданин {ticket.customer_name}{ticket.company_name ? ` (${ticket.company_name})` : ""}, именуемый в дальнейшем «Заказчик», с другой стороны, заключили настоящий договор о нижеследующем:
            </p>
            <p style={{ fontWeight: 700, margin: "4px 0 2px 0" }}>ПРЕДМЕТ ДОГОВОРА</p>
            <ol style={{ margin: 0, paddingLeft: "15px" }}>
              <li style={{ marginBottom: "2px" }}>
                По настоящему договору Исполнитель обязуется принять, провести диагностику и при наличии технической возможности выполнить ремонт принятого устройства в указанный срок и за указанную стоимость. По факту выполнения ремонтных работ, Заказчик обязуется забрать устройство и оплатить результат выполненной работы.
              </li>
              <li style={{ marginBottom: "2px" }}>
                После проведения диагностики срок и стоимость ремонта могут быть изменены при обязательном устном согласовании с Заказчиком.
              </li>
              <li style={{ marginBottom: "2px" }}>
                Устройство с согласия Заказчика принято без разборки и без проверки внутренних повреждений. Заказчик согласен, что все неисправности и внутренние повреждения, которые могут быть обнаружены в устройстве при техническом обслуживании, возникли до приема устройства по данному договору.
              </li>
              <li style={{ marginBottom: "2px" }}>
                Исполнитель предупреждает Заказчика о возможном изменении проявления неисправности при проведении диагностики, если неисправность устройства вызвана попаданием жидкости или механическим повреждением.
              </li>
              <li style={{ marginBottom: "2px" }}>
                На выполненную работу и установленные запчасти Исполнитель предоставляет гарантию. Условия и срок гарантии зависят от устраненной неисправности и указаны в Акте выполненных работ.
              </li>
              <li style={{ marginBottom: "2px" }}>
                При утере договора получить аппарат Заказчик может при предъявлении паспорта.
              </li>
              <li style={{ marginBottom: "2px" }}>
                В случае неявки Заказчика за получением результата выполненной работы Исполнитель вправе, письменно предупредив Заказчика, по истечении двух месяцев со дня такого предупреждения продать результат работы за разумную цену, а вырученную сумму, за вычетом всех причитающихся Исполнителю платежей, внести в депозит в порядке, предусмотренном статьей 327 Гражданского кодекса Российской Федерации.
              </li>
              <li style={{ marginBottom: "2px" }}>
                Подписывая настоящий Договор, Заказчик соглашается на предоставление Исполнителю согласия на обработку его персональных данных. Персональные данные требуются исключительно для исполнения договора с Заказчиком.
              </li>
            </ol>
          </div>

          {/* Подписи верхнего блока */}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "12px", marginBottom: "16px" }}>
            <div style={{ width: "45%" }}>
              <div><strong>Заказчик</strong> ____________________</div>
              <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                {ticket.customer_name} {ticket.customer_phone}
              </div>
            </div>
            <div style={{ width: "45%" }}>
              <div><strong>Исполнитель</strong> ____________________</div>
              <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                {ticket.master_name || "ИП Сагайдак Антон Геннадьевич"}
              </div>
            </div>
          </div>

          {/* Пунктирная линия отрыва */}
          <div style={{ borderTop: "1.5px dashed #444444", margin: "14px 0", position: "relative" }}>
            <span style={{ position: "absolute", top: "-8px", left: "16px", background: "#ffffff", padding: "0 6px", fontSize: "9px", color: "#888888" }}>
              линия отрыва
            </span>
          </div>

          {/* Нижний отрывной талон (Заказ-наряд) */}
          <div style={{ marginTop: "10px" }}>
            <div style={{ textAlign: "center", marginBottom: "10px" }}>
              <div style={{ fontWeight: 800, fontSize: "13px", textTransform: "uppercase" }}>
                Заказ-наряд на выполнение работ № {ticket.ticket_number} от {dateStr}
              </div>
            </div>

            <div style={{ fontSize: "11px", lineHeight: "1.5", marginBottom: "10px" }}>
              <div>
                <strong>Заказчик:</strong> {ticket.customer_name} {ticket.customer_phone}
                {ticket.company_name ? ` (${ticket.company_name})` : ""}
              </div>
              <div>
                <strong>Устройство:</strong> {ticket.equipment.type ? `${ticket.equipment.type} ` : ""}
                {ticket.equipment.brand} {ticket.equipment.model} S/N: {ticket.equipment.serial_number || "—"}
              </div>
              <div>
                <strong>Неисправность:</strong> {ticket.defect_description || "—"}
              </div>
            </div>

            {/* Таблица с крупным номером в правой ячейке */}
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "12px", fontSize: "11px" }}>
              <thead>
                <tr style={{ background: "#fbfbfb" }}>
                  <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "left", width: "40%", fontWeight: 700 }}>
                    Комплектация
                  </th>
                  <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "left", width: "40%", fontWeight: 700 }}>
                    Неисправность
                  </th>
                  <th style={{ border: "1px solid #111111", padding: "4px 8px", textAlign: "center", width: "20%", fontWeight: 700 }}>
                    Талон
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                    {ticket.equipment.package_contents || "Обойма, 2 АКБ, Кейс"}
                  </td>
                  <td style={{ border: "1px solid #111111", padding: "6px 8px", verticalAlign: "top" }}>
                    {ticket.defect_description || "Не стреляет"}
                  </td>
                  <td
                    style={{
                      border: "1px solid #111111",
                      padding: "6px 8px",
                      textAlign: "center",
                      verticalAlign: "middle",
                      fontSize: "28px",
                      fontWeight: 800,
                      fontFamily: "monospace",
                    }}
                  >
                    {ticket.ticket_number}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Подписи нижнего блока */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginTop: "10px" }}>
              <div style={{ width: "45%" }}>
                <div><strong>Заказчик</strong> ____________________</div>
                <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                  {ticket.customer_name} {ticket.customer_phone}
                </div>
              </div>
              <div style={{ width: "45%" }}>
                <div><strong>Исполнитель</strong> ____________________</div>
                <div style={{ fontSize: "10px", color: "#555555", marginTop: "2px" }}>
                  {ticket.master_name || "ИП Сагайдак Антон Геннадьевич"}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});
